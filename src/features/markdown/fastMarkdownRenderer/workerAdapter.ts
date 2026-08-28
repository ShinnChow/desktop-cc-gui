import {
  compileFastMarkdown,
  finalizeFastMarkdownArtifact,
  getCachedFastMarkdownResult,
} from "./compile";
import { createFastMarkdownCompileIdentity } from "./compileCore";
import { workerDiagnostics } from "./workerAdapterDiagnostics";
import { hashStableString } from "../../files/utils/fileMarkdownDocument";
import {
  appendRendererDiagnostic,
  buildDiagnosticSourceLocation,
} from "../../../services/rendererDiagnostics";
import type {
  CompileFastMarkdownArgs,
  FastMarkdownRenderResult,
  FastMarkdownUnsafeArtifact,
  FastMarkdownWorkerRequestMeta,
  FastMarkdownWorkerDiagnostics,
} from "./types";

type FastMarkdownWorkerResponse =
  | {
      type: "fast-markdown-result";
      requestId: string;
      result: FastMarkdownUnsafeArtifact;
    }
  | {
      type: "fast-markdown-error";
      requestId: string;
      error: {
        name: string;
        message: string;
      };
    };

type PendingWorkerRequest = {
  expectedCacheKey: string;
  expectedRendererProfile: CompileFastMarkdownArgs["rendererProfile"];
  resolve: (result: FastMarkdownUnsafeArtifact) => void;
  reject: (error: Error) => void;
  requestMeta: FastMarkdownWorkerRequestMeta;
  timeoutId: ReturnType<typeof setTimeout> | null;
};

type CompileFastMarkdownWorkerOptions = {
  shouldAcceptWorkerArtifact?: () => boolean;
};

export type PrecomputeFastMarkdownWorkerOptions = {
  timeoutMs?: number;
};

let sharedWorker: Worker | null = null;
let listenersAttached = false;
let nextRequestOrdinal = 1;
const persistedWorkerFailureAtByReason = new Map<string, number>();
const WORKER_FAILURE_PERSIST_INTERVAL_MS = 60_000;
const DEFAULT_WORKER_REQUEST_TIMEOUT_MS = 15_000;
const MAX_WORKER_REQUEST_TIMEOUT_MS = 60_000;
// 崩溃循环退避：崩溃的 worker 若每次请求都重建再崩，每个请求都要白付一次
// 「建 worker → 崩」往返（实测 88–325ms × 同内容 10 次）。首崩立即重建，
// 连续第 2 次起按 30s 起步指数退避，5min 封顶；成功响应清零计数。
const WORKER_CRASH_BACKOFF_BASE_MS = 30_000;
const WORKER_CRASH_BACKOFF_MAX_MS = 300_000;
let consecutiveWorkerCrashes = 0;
let workerBackoffUntilMs = 0;

const pendingRequests = new Map<string, PendingWorkerRequest>();

export async function compileFastMarkdownWithWorkerFallback(
  args: CompileFastMarkdownArgs,
  options: CompileFastMarkdownWorkerOptions = {},
): Promise<FastMarkdownRenderResult> {
  const cached = getCachedFastMarkdownResult(args);
  if (cached) {
    throwIfWorkerRequestIsStale(options);
    return cached;
  }
  let workerArtifact: FastMarkdownUnsafeArtifact | null = null;
  try {
    workerArtifact = await precomputeFastMarkdownInWorker(args);
  } catch (error: unknown) {
    throwIfWorkerRequestIsStale(options);
    reportWorkerFallback(error);
    workerDiagnostics.recordFallback("worker-request-failed");
    return compileFastMarkdown(args);
  }
  throwIfWorkerRequestIsStale(options);
  if (workerArtifact) {
    return finalizeFastMarkdownArtifact(workerArtifact);
  }
  workerDiagnostics.recordFallback("worker-not-available");
  return compileFastMarkdown(args);
}

export function compileFastMarkdownInWorker(
  args: CompileFastMarkdownArgs,
  options: PrecomputeFastMarkdownWorkerOptions = {},
): Promise<FastMarkdownRenderResult> | null {
  const artifactPromise = precomputeFastMarkdownInWorker(args, options);
  return artifactPromise?.then(finalizeFastMarkdownArtifact) ?? null;
}

export function precomputeFastMarkdownInWorker(
  args: CompileFastMarkdownArgs,
  options: PrecomputeFastMarkdownWorkerOptions = {},
): Promise<FastMarkdownUnsafeArtifact> | null {
  const worker = getSharedWorker();
  if (!worker) {
    workerDiagnostics.setHasWorker(false);
    return null;
  }

  const requestId = createRequestId(args.documentKey);
  const compileIdentity = createFastMarkdownCompileIdentity(args);
  const requestMeta = createWorkerRequestMeta(
    requestId,
    args,
    compileIdentity.contentHash,
  );
  workerDiagnostics.setPendingCount(pendingRequests.size + 1);
  return new Promise<FastMarkdownUnsafeArtifact>((resolve, reject) => {
    pendingRequests.set(requestId, {
      expectedCacheKey: compileIdentity.cacheKey,
      expectedRendererProfile: args.rendererProfile,
      resolve,
      reject,
      requestMeta,
      timeoutId: null,
    });
    const requestTimeoutMs = normalizeWorkerRequestTimeoutMs(options.timeoutMs);
    const pending = pendingRequests.get(requestId);
    if (pending) {
      pending.timeoutId = setTimeout(() => {
        const timedOut = takePendingWorkerRequest(requestId);
        if (!timedOut) {
          return;
        }
        workerDiagnostics.recordFallback("worker-request-timeout");
        persistWorkerFailureDiagnostic("worker-request-timeout");
        timedOut.reject(new Error("fast-markdown-worker-request-timeout"));
      }, requestTimeoutMs);
    }
    try {
      worker.postMessage({
        type: "compile-fast-markdown",
        requestId,
        requestMeta,
        args,
      });
    } catch (error: unknown) {
      const failed = takePendingWorkerRequest(requestId);
      workerDiagnostics.recordPostMessageFailure();
      workerDiagnostics.recordFallback("worker-post-message-failed");
      persistWorkerFailureDiagnostic("worker-post-message-failed");
      failed?.reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function getFastMarkdownWorkerDiagnostics(): FastMarkdownWorkerDiagnostics {
  return workerDiagnostics.snapshot();
}

export function resetFastMarkdownWorkerDiagnostics(): void {
  workerDiagnostics.reset();
  workerDiagnostics.setPendingCount(pendingRequests.size);
  persistedWorkerFailureAtByReason.clear();
}

export function disposeFastMarkdownWorker() {
  if (sharedWorker) {
    sharedWorker.terminate();
  }
  sharedWorker = null;
  listenersAttached = false;
  rejectAllPendingRequests(new Error("Fast Markdown worker disposed"));
  workerDiagnostics.recordDispose();
  workerDiagnostics.setHasWorker(false);
}

export function __resetFastMarkdownWorkerBackoffForTests() {
  if (sharedWorker) {
    sharedWorker.terminate();
  }
  sharedWorker = null;
  listenersAttached = false;
  rejectAllPendingRequests(new Error("Fast Markdown worker disposed"));
  consecutiveWorkerCrashes = 0;
  workerBackoffUntilMs = 0;
  persistedWorkerFailureAtByReason.clear();
}

function getSharedWorker(): Worker | null {
  if (typeof Worker === "undefined") {
    return null;
  }
  if (Date.now() < workerBackoffUntilMs) {
    workerDiagnostics.setHasWorker(false);
    return null;
  }
  if (!sharedWorker) {
    try {
      sharedWorker = new Worker(
        new URL("./fastMarkdown.worker.ts", import.meta.url),
        {
          type: "module",
        },
      );
      workerDiagnostics.setHasWorker(true);
    } catch {
      sharedWorker = null;
      workerDiagnostics.setHasWorker(false);
      workerDiagnostics.recordFallback("worker-creation-failed");
      persistWorkerFailureDiagnostic("worker-creation-failed");
      return null;
    }
  }
  attachWorkerListeners(sharedWorker);
  return sharedWorker;
}

function attachWorkerListeners(worker: Worker) {
  if (listenersAttached) {
    return;
  }
  worker.addEventListener("message", handleWorkerMessage);
  worker.addEventListener("error", handleWorkerError);
  listenersAttached = true;
}

function handleWorkerMessage(event: MessageEvent<unknown>) {
  const message = event.data;
  if (
    isRecord(message) &&
    (message as { type?: unknown }).type === "fast-markdown-worker-scope-error"
  ) {
    handleWorkerScopeError(
      message as { detail?: Record<string, unknown> },
    );
    return;
  }
  if (!isWorkerResponse(message)) {
    workerDiagnostics.recordUnknownResponse();
    const requestId =
      isRecord(message) && typeof message.requestId === "string"
        ? message.requestId
        : null;
    const pending = requestId ? takePendingWorkerRequest(requestId) : null;
    if (pending) {
      workerDiagnostics.recordFallback("worker-invalid-response");
      persistWorkerFailureDiagnostic("worker-invalid-response");
      pending.reject(
        new Error("Fast Markdown worker returned an invalid response"),
      );
    }
    return;
  }

  const pending = takePendingWorkerRequest(message.requestId);
  if (!pending) {
    workerDiagnostics.recordUnknownResponse();
    return;
  }

  if (message.type === "fast-markdown-error") {
    workerDiagnostics.recordFallback("worker-compile-error");
    persistWorkerFailureDiagnostic("worker-compile-error");
    pending.reject(createWorkerError(message.error));
    return;
  }
  if (!matchesPendingWorkerRequestIdentity(message.result, pending)) {
    workerDiagnostics.recordFallback("worker-identity-mismatch");
    persistWorkerFailureDiagnostic("worker-identity-mismatch");
    pending.reject(
      new Error("Fast Markdown worker returned mismatched request identity"),
    );
    return;
  }
  // 成功响应证明 worker 健康，连续崩溃计数与退避窗一并清零。
  consecutiveWorkerCrashes = 0;
  workerBackoffUntilMs = 0;
  pending.resolve(message.result);
}

export function classifyFastMarkdownWorkerRuntimeError(
  message: string | null | undefined,
): string {
  const text = (message ?? "").trim().toLowerCase();
  if (!text || text === "script error." || text === "script error") {
    return "script-error";
  }
  if (text.includes("out of memory") || /\boom\b/.test(text)) {
    return "out-of-memory";
  }
  if (
    text.includes("failed to fetch") ||
    text.includes("failed to load") ||
    text.includes("loading chunk") ||
    text.includes("networkerror") ||
    text.includes("network error")
  ) {
    return "worker-load-failed";
  }
  return "worker-uncaught";
}

function handleWorkerError(event: ErrorEvent) {
  const message = event.message || "Fast Markdown worker failed";
  const errorName =
    event.error instanceof Error && event.error.name
      ? event.error.name
      : "Error";
  // fix-diagnostics-forensics-hardening：抛错模块定位（basename），下一轮日志
  // 直读「哪个模块哪一行」，不再依赖 console 完整文本。
  const sourceLocation = buildDiagnosticSourceLocation(
    event.filename,
    event.lineno,
    event.colno,
  );
  // F3（fix-session-switch-jank-red-lines）：error 事件≠worker 已死（引擎语义上未捕获
  // 异常不终止 DedicatedWorker）。空闲期（无在途请求）错误先探活，存活则保留 worker，
  // 避免「同一句错误 → 处决 → 重建 → 同一句错误」的重建循环（实测同指纹一天 4 次）。
  // 在途期间错误无法归因来源，维持既有处决语义。
  if (pendingRequests.size === 0 && sharedWorker && !healthProbeInFlight) {
    void probeWorkerHealthAfterIdleError(errorName, message, sourceLocation);
    return;
  }
  disposeBrokenWorker(new Error(message), errorName, sourceLocation);
}

const WORKER_HEALTH_PROBE_TIMEOUT_MS = 2_000;
const WORKER_HEALTH_PROBE_ARGS = {
  documentKey: "doc-health-probe",
  rawMarkdown: "# probe",
  rendererProfile: "fast-html" as const,
  featureFlags: {
    fastHtmlRendererEnabled: true,
    boundedFastHtmlRendererEnabled: false,
  },
};
let healthProbeInFlight = false;

async function probeWorkerHealthAfterIdleError(
  errorName: string,
  message: string,
  sourceLocation?: ReturnType<typeof buildDiagnosticSourceLocation>,
): Promise<void> {
  const workerAtProbeStart = sharedWorker;
  if (!workerAtProbeStart) {
    return;
  }
  healthProbeInFlight = true;
  try {
    await precomputeFastMarkdownInWorker(WORKER_HEALTH_PROBE_ARGS, {
      timeoutMs: WORKER_HEALTH_PROBE_TIMEOUT_MS,
    });
  } catch {
    // 探活失败/超时：worker 真不可用，走既有 dispose + 退避。
    healthProbeInFlight = false;
    if (sharedWorker === workerAtProbeStart) {
      disposeBrokenWorker(
        new Error(message || "Fast Markdown worker health probe failed"),
        errorName,
        sourceLocation,
      );
    }
    return;
  }
  healthProbeInFlight = false;
  if (sharedWorker !== workerAtProbeStart) {
    return;
  }
  // 探活成功：worker 存活，保留服务；成功响应已顺带清零崩溃计数。
  workerDiagnostics.recordFallback("worker-error-kept-alive");
  persistWorkerFailureDiagnostic(
    "worker-error-kept-alive",
    classifyFastMarkdownWorkerRuntimeError(message),
    buildWorkerErrorFingerprint(errorName, message, sourceLocation),
  );
}

function buildWorkerErrorFingerprint(
  errorName: string,
  message: string,
  sourceLocation?: ReturnType<typeof buildDiagnosticSourceLocation>,
) {
  return {
    errorName,
    messageHash: hashStableString(message).slice(0, 16),
    messageLength: message.length,
    ...(sourceLocation ?? {}),
  };
}

function disposeBrokenWorker(
  error: Error,
  errorName?: string,
  sourceLocation?: ReturnType<typeof buildDiagnosticSourceLocation>,
) {
  if (sharedWorker) {
    sharedWorker.terminate();
  }
  sharedWorker = null;
  listenersAttached = false;
  rejectAllPendingRequests(error);
  workerDiagnostics.recordFallback("worker-disposed-after-error");
  workerDiagnostics.setHasWorker(false);
  consecutiveWorkerCrashes += 1;
  const backoffMs = currentWorkerCrashBackoffMs();
  workerBackoffUntilMs = backoffMs > 0 ? Date.now() + backoffMs : 0;
  // 完整 message 只进 console（不受 diagnostics 脱敏约束），落盘只留指纹。
  if (typeof console !== "undefined") {
    console.warn(
      "[fast-markdown-worker] worker crashed and was disposed; falling back to main-thread compile.",
      error,
    );
  }
  const message = error.message ?? "";
  persistWorkerFailureDiagnostic(
    "worker-runtime-error",
    classifyFastMarkdownWorkerRuntimeError(message),
    buildWorkerErrorFingerprint(errorName ?? "Error", message, sourceLocation),
  );
}

function handleWorkerScopeError(message: { detail?: Record<string, unknown> }) {
  // F6：作用域错误详情指纹落盘；全文进 console。worker 存活，不 dispose。
  const detail = message.detail ?? {};
  const text = typeof detail.message === "string" ? detail.message : "";
  const sourceLocation = buildDiagnosticSourceLocation(
    typeof detail.filename === "string" ? detail.filename : null,
    typeof detail.lineno === "number" ? detail.lineno : null,
    typeof detail.colno === "number" ? detail.colno : null,
  );
  const stack = typeof detail.stack === "string" ? detail.stack : null;
  if (typeof console !== "undefined") {
    console.warn(
      "[fast-markdown-worker] scope error captured (worker kept alive):",
      detail,
    );
  }
  persistWorkerFailureDiagnostic(
    "worker-scope-error",
    classifyFastMarkdownWorkerRuntimeError(text),
    {
      errorName:
        typeof detail.errorName === "string" ? detail.errorName : "Error",
      messageHash: hashStableString(text).slice(0, 16),
      messageLength: text.length,
      stackHash: stack ? hashStableString(stack).slice(0, 16) : null,
      stackLength: stack ? stack.length : 0,
      ...sourceLocation,
    },
  );
}

function currentWorkerCrashBackoffMs(): number {
  // 首崩不退避：多数崩溃是偶发（如单次 OOM），立即重建代价最低。
  const excessCrashes = consecutiveWorkerCrashes - 1;
  if (excessCrashes <= 0) {
    return 0;
  }
  const exponentialMs =
    WORKER_CRASH_BACKOFF_BASE_MS * 2 ** Math.min(excessCrashes - 1, 4);
  return Math.min(exponentialMs, WORKER_CRASH_BACKOFF_MAX_MS);
}

function rejectAllPendingRequests(error: Error) {
  for (const pending of pendingRequests.values()) {
    clearPendingWorkerRequestTimeout(pending);
    pending.reject(error);
  }
  pendingRequests.clear();
  workerDiagnostics.setPendingCount(0);
}

function normalizeWorkerRequestTimeoutMs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_WORKER_REQUEST_TIMEOUT_MS;
  }
  return Math.min(
    MAX_WORKER_REQUEST_TIMEOUT_MS,
    Math.max(1, Math.round(value)),
  );
}

function clearPendingWorkerRequestTimeout(pending: PendingWorkerRequest): void {
  if (pending.timeoutId !== null) {
    clearTimeout(pending.timeoutId);
    pending.timeoutId = null;
  }
}

function takePendingWorkerRequest(
  requestId: string,
): PendingWorkerRequest | null {
  const pending = pendingRequests.get(requestId) ?? null;
  if (!pending) {
    return null;
  }
  pendingRequests.delete(requestId);
  clearPendingWorkerRequestTimeout(pending);
  workerDiagnostics.setPendingCount(pendingRequests.size);
  return pending;
}

function createRequestId(documentKey: string) {
  const ordinal = nextRequestOrdinal;
  nextRequestOrdinal += 1;
  return `${documentKey}:${ordinal}`;
}

function createWorkerRequestMeta(
  requestId: string,
  args: CompileFastMarkdownArgs,
  contentHash: string,
): FastMarkdownWorkerRequestMeta {
  return {
    requestId,
    documentKey: args.documentKey,
    contentHash,
    optionsHash: hashStableString(
      JSON.stringify({
        rendererProfile: args.rendererProfile,
        featureFlags: args.featureFlags ?? null,
        options: args.options ?? null,
        bodyStartLine: args.bodyStartLine ?? null,
      }),
    ),
    schemaVersion: "fast-markdown-worker-v1",
    createdAtMs: Date.now(),
  };
}

function matchesPendingWorkerRequestIdentity(
  artifact: FastMarkdownUnsafeArtifact,
  pending: PendingWorkerRequest,
): boolean {
  return (
    artifact.cacheKey === pending.expectedCacheKey &&
    artifact.contentHash === pending.requestMeta.contentHash &&
    artifact.rendererProfile === pending.expectedRendererProfile &&
    artifact.diagnostics.cacheKey === artifact.cacheKey &&
    artifact.diagnostics.contentHash === artifact.contentHash &&
    artifact.diagnostics.profile === artifact.rendererProfile
  );
}

function isWorkerResponse(value: unknown): value is FastMarkdownWorkerResponse {
  if (!isRecord(value)) {
    return false;
  }
  if (
    value.type !== "fast-markdown-result" &&
    value.type !== "fast-markdown-error"
  ) {
    return false;
  }
  if (typeof value.requestId !== "string") {
    return false;
  }
  if (value.type === "fast-markdown-result") {
    return isFastMarkdownUnsafeArtifact(value.result);
  }
  return isRecord(value.error) && typeof value.error.message === "string";
}

function isFastMarkdownUnsafeArtifact(
  value: unknown,
): value is FastMarkdownUnsafeArtifact {
  if (!isRecord(value) || !isRecord(value.diagnostics)) {
    return false;
  }
  return (
    value.sanitization === "main-thread-required" &&
    typeof value.cacheKey === "string" &&
    typeof value.contentHash === "string" &&
    typeof value.unsafeHtml === "string" &&
    typeof value.rendererProfile === "string" &&
    Array.isArray(value.outline) &&
    Array.isArray(value.sourceLineAnchors) &&
    Array.isArray(value.heavyBlocks) &&
    typeof value.diagnostics.fallbackReason === "string"
  );
}

function createWorkerError(error: { name: string; message: string }) {
  const workerError = new Error(
    error.message || "Fast Markdown worker compile failed",
  );
  workerError.name = error.name || "Error";
  return workerError;
}

function reportWorkerFallback(error: unknown) {
  const normalized = error instanceof Error ? error : new Error(String(error));
  console.warn(
    "[file-markdown-preview] Fast Markdown worker failed; falling back to main-thread compile.",
    normalized,
  );
}

function throwIfWorkerRequestIsStale(
  options: CompileFastMarkdownWorkerOptions,
): void {
  if (options.shouldAcceptWorkerArtifact?.() !== false) {
    return;
  }
  workerDiagnostics.recordStaleDrop();
  throw new Error("fast-markdown-worker-result-stale");
}

function persistWorkerFailureDiagnostic(
  reasonCode: string,
  errorClass?: string,
  fingerprint?: {
    errorName?: string;
    messageHash: string;
    messageLength: number;
    stackHash?: string | null;
    stackLength?: number;
    sourceModule?: string | null;
    sourceLine?: number | null;
    sourceCol?: number | null;
  },
) {
  const now = Date.now();
  const previousAt = persistedWorkerFailureAtByReason.get(reasonCode);
  if (
    typeof previousAt === "number" &&
    now - previousAt < WORKER_FAILURE_PERSIST_INTERVAL_MS
  ) {
    return;
  }
  persistedWorkerFailureAtByReason.set(reasonCode, now);
  const snapshot = workerDiagnostics.snapshot();
  appendRendererDiagnostic("fast-markdown-worker/failed", {
    reasonCode,
    errorClass: errorClass ?? reasonCode,
    fallbackCount: snapshot.fallbackCount,
    pendingRequestCount: snapshot.pendingRequestCount,
    postMessageFailureCount: snapshot.postMessageFailureCount,
    ...(fingerprint ?? {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
