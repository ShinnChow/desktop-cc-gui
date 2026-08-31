import { hashStableString } from "../files/utils/fileMarkdownDocument";
import { precomputeFastMarkdownInWorker } from "./fastMarkdownRenderer/workerAdapter";
import type {
  FastMarkdownRendererProfileId,
  FastMarkdownUnsafeArtifact,
} from "./fastMarkdownRenderer/types";
import { classifyMessageMarkdownHeavyIslands } from "./messageMarkdownHeavyIslands";

export const MESSAGE_MARKDOWN_PRECOMPUTE_SCHEMA_VERSION = "message-markdown-precompute:v1";
export const MESSAGE_MARKDOWN_PRECOMPUTE_MIN_LENGTH = 10_000;
export const MESSAGE_MARKDOWN_PRECOMPUTE_TIMEOUT_MS = 1_500;

export type MessageMarkdownPrecomputeMode =
  | "worker-precompute"
  | "main"
  | "cache-hit"
  | "fallback";

export type MessageMarkdownPrecomputeCacheState = "hit" | "miss" | "unsupported";

export type MessageMarkdownThresholdReason =
  | "length"
  | "complexity"
  | "below-threshold";

export type MessageMarkdownPrecomputeFallbackReason =
  | "none"
  | "below-threshold"
  | "worker-unsupported"
  | "worker-timeout"
  | "worker-error";

export type MessageMarkdownRendererOptions = {
  softBreaks: boolean;
  codeBlockStyle: "default" | "message";
  preserveFormatting: boolean;
  hasFileLinkHandlers: boolean;
  hasMathContent: boolean;
};

export type MessageMarkdownPrecomputeRequest = {
  requestId: string;
  messageId: string;
  contentHash: string;
  rendererProfile: FastMarkdownRendererProfileId;
  optionsHash: string;
  schemaVersion: string;
  sourceLength: number;
  source: string;
  thresholdReason: MessageMarkdownThresholdReason;
  timeoutMs: number;
};

export type MessageMarkdownPrecomputeMetadata = {
  totalHeadings: number;
  totalHeavyBlocks: number;
  totalSourceLines: number;
  unsafeHtmlBoundary: "main-thread-sanitized-rich-render";
};

export type MessageMarkdownPrecomputeResult = {
  requestId: string;
  messageId: string;
  contentHash: string;
  optionsHash: string;
  schemaVersion: string;
  mode: MessageMarkdownPrecomputeMode;
  cacheState: MessageMarkdownPrecomputeCacheState;
  durationMs: number;
  sourceLength: number;
  thresholdReason: MessageMarkdownThresholdReason;
  fallbackReason: MessageMarkdownPrecomputeFallbackReason;
  evidenceClass: "measured" | "proxy" | "manual-only" | "unsupported";
  precomputeResult: MessageMarkdownPrecomputeMetadata | null;
};

export type MessageMarkdownVisibleSource = {
  messageId: string;
  contentHash: string;
  optionsHash: string;
  schemaVersion: string;
};

type CacheEntry = {
  key: string;
  result: MessageMarkdownPrecomputeResult;
};

type RunPrecomputeOptions = {
  compileInWorker?: typeof precomputeFastMarkdownInWorker;
  now?: () => number;
  timeoutMs?: number;
};

const MAX_MESSAGE_MARKDOWN_PRECOMPUTE_CACHE_ENTRIES = 40;
const precomputeCache = new Map<string, CacheEntry>();
let nextRequestOrdinal = 1;

export function createMessageMarkdownOptionsHash(options: MessageMarkdownRendererOptions) {
  return hashStableString(JSON.stringify({
    codeBlockStyle: options.codeBlockStyle,
    hasFileLinkHandlers: options.hasFileLinkHandlers,
    hasMathContent: options.hasMathContent,
    preserveFormatting: options.preserveFormatting,
    softBreaks: options.softBreaks,
  }));
}

export function classifyMessageMarkdownPrecomputeThreshold(
  source: string,
): MessageMarkdownThresholdReason {
  if (source.length >= MESSAGE_MARKDOWN_PRECOMPUTE_MIN_LENGTH) {
    return "length";
  }
  return classifyMessageMarkdownHeavyIslands(source).totalHeavyIslands > 0
    ? "complexity"
    : "below-threshold";
}



export function createMessageMarkdownPrecomputeRequest(input: {
  messageId: string;
  source: string;
  rendererProfile?: FastMarkdownRendererProfileId;
  optionsHash: string;
  thresholdReason?: MessageMarkdownThresholdReason;
  timeoutMs?: number;
}): MessageMarkdownPrecomputeRequest {
  const contentHash = hashStableString(input.source);
  const requestOrdinal = nextRequestOrdinal;
  nextRequestOrdinal += 1;
  return {
    requestId: `${input.messageId}:${contentHash}:${requestOrdinal}`,
    messageId: input.messageId,
    contentHash,
    rendererProfile: input.rendererProfile ?? "fast-html",
    optionsHash: input.optionsHash,
    schemaVersion: MESSAGE_MARKDOWN_PRECOMPUTE_SCHEMA_VERSION,
    sourceLength: input.source.length,
    source: input.source,
    thresholdReason:
      input.thresholdReason ?? classifyMessageMarkdownPrecomputeThreshold(input.source),
    timeoutMs: input.timeoutMs ?? MESSAGE_MARKDOWN_PRECOMPUTE_TIMEOUT_MS,
  };
}

export function createMessageMarkdownPrecomputeCacheKey(input: {
  rendererProfile: FastMarkdownRendererProfileId;
  messageId: string;
  contentHash: string;
  optionsHash: string;
  schemaVersion?: string;
}) {
  return [
    input.rendererProfile,
    input.messageId,
    input.contentHash,
    input.optionsHash,
    input.schemaVersion ?? MESSAGE_MARKDOWN_PRECOMPUTE_SCHEMA_VERSION,
  ].join(":");
}

export function getCachedMessageMarkdownPrecompute(
  request: MessageMarkdownPrecomputeRequest,
): MessageMarkdownPrecomputeResult | null {
  const key = createMessageMarkdownPrecomputeCacheKey(request);
  const cached = precomputeCache.get(key);
  if (!cached) {
    return null;
  }
  precomputeCache.delete(key);
  precomputeCache.set(key, cached);
  return {
    ...cached.result,
    mode: "cache-hit",
    cacheState: "hit",
    durationMs: 0,
  };
}

export function clearMessageMarkdownPrecomputeCache() {
  precomputeCache.clear();
}

export function getMessageMarkdownPrecomputeCacheSize() {
  return precomputeCache.size;
}

export function isStaleMessageMarkdownPrecomputeResult(
  result: Pick<MessageMarkdownPrecomputeResult, "messageId" | "contentHash" | "optionsHash" | "schemaVersion">,
  visibleSource: MessageMarkdownVisibleSource,
) {
  return (
    result.messageId !== visibleSource.messageId ||
    result.contentHash !== visibleSource.contentHash ||
    result.optionsHash !== visibleSource.optionsHash ||
    result.schemaVersion !== visibleSource.schemaVersion
  );
}

export async function runMessageMarkdownPrecompute(
  request: MessageMarkdownPrecomputeRequest,
  options: RunPrecomputeOptions = {},
): Promise<MessageMarkdownPrecomputeResult> {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();

  if (request.thresholdReason === "below-threshold") {
    return createResult(request, {
      cacheState: "unsupported",
      durationMs: now() - startedAt,
      evidenceClass: "unsupported",
      fallbackReason: "below-threshold",
      mode: "main",
      precomputeResult: null,
    });
  }

  const cached = getCachedMessageMarkdownPrecompute(request);
  if (cached) {
    return cached;
  }

  const compileInWorker = options.compileInWorker ?? precomputeFastMarkdownInWorker;
  const timeoutMs = options.timeoutMs ?? request.timeoutMs;
  const workerPromise = compileInWorker({
    documentKey: request.messageId,
    rawMarkdown: request.source,
    rendererProfile: request.rendererProfile,
    featureFlags: {
      fastHtmlRendererEnabled: true,
      boundedFastHtmlRendererEnabled: false,
    },
  }, {
    timeoutMs,
  });

  if (!workerPromise) {
    return createResult(request, {
      cacheState: "unsupported",
      durationMs: now() - startedAt,
      evidenceClass: "unsupported",
      fallbackReason: "worker-unsupported",
      mode: "fallback",
      precomputeResult: null,
    });
  }

  try {
    const workerResult = await withTimeout(
      workerPromise,
      timeoutMs,
    );
    const result = createResult(request, {
      cacheState: "miss",
      durationMs: now() - startedAt,
      evidenceClass: "measured",
      fallbackReason: "none",
      mode: "worker-precompute",
      precomputeResult: toPrecomputeMetadata(workerResult),
    });
    setCachedMessageMarkdownPrecompute(request, result);
    return result;
  } catch (error) {
    const fallbackResult = createResult(request, {
      cacheState: "miss",
      durationMs: now() - startedAt,
      evidenceClass: "unsupported",
      fallbackReason: isTimeoutError(error) ? "worker-timeout" : "worker-error",
      mode: "fallback",
      precomputeResult: null,
    });
    // 负缓存：崩溃的 worker 常态是「每次请求都重建再崩」，同一 request 身份重复
    // 付 worker 往返（实测同 contentHash 10 次、每次 88–325ms）。缓存 fallback
    // 结果后二次调用直接命中，fallbackReason 保留供诊断区分。
    setCachedMessageMarkdownPrecompute(request, fallbackResult);
    return fallbackResult;
  }
}

function setCachedMessageMarkdownPrecompute(
  request: MessageMarkdownPrecomputeRequest,
  result: MessageMarkdownPrecomputeResult,
) {
  const key = createMessageMarkdownPrecomputeCacheKey(request);
  precomputeCache.delete(key);
  precomputeCache.set(key, { key, result });
  while (precomputeCache.size > MAX_MESSAGE_MARKDOWN_PRECOMPUTE_CACHE_ENTRIES) {
    const oldestKey = precomputeCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    precomputeCache.delete(oldestKey);
  }
}

function toPrecomputeMetadata(
  result: FastMarkdownUnsafeArtifact,
): MessageMarkdownPrecomputeMetadata {
  return {
    totalHeadings: result.diagnostics.totalHeadings,
    totalHeavyBlocks: result.diagnostics.totalHeavyBlocks,
    totalSourceLines: result.diagnostics.totalSourceLines,
    unsafeHtmlBoundary: "main-thread-sanitized-rich-render",
  };
}

function createResult(
  request: MessageMarkdownPrecomputeRequest,
  data: Pick<
    MessageMarkdownPrecomputeResult,
    | "mode"
    | "cacheState"
    | "durationMs"
    | "fallbackReason"
    | "evidenceClass"
    | "precomputeResult"
  >,
): MessageMarkdownPrecomputeResult {
  return {
    requestId: request.requestId,
    messageId: request.messageId,
    contentHash: request.contentHash,
    optionsHash: request.optionsHash,
    schemaVersion: request.schemaVersion,
    sourceLength: request.sourceLength,
    thresholdReason: request.thresholdReason,
    ...data,
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("message-markdown-worker-timeout"));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message === "message-markdown-worker-timeout" ||
      error.message === "fast-markdown-worker-request-timeout")
  );
}
