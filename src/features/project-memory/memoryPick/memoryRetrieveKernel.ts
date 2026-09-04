/**
 * 统一记忆检索核：lexical 池 + 可选 semantic + hybridRerank。
 * Pick 与 Scout 共享；无 provider 时诚实报 retrievalMode=lexical。
 */
import type { ProjectMemoryItem } from "../../../services/tauri";
import {
  normalizeQueryTerms,
  RELEVANCE_THRESHOLD,
  scoreMemoryRelevance,
} from "../utils/memoryContextInjection";
import {
  resolveProjectMemoryCompactSummary,
  resolveProjectMemoryCompactTitle,
} from "../utils/projectMemoryDisplay";
import type { ProjectMemoryListResult } from "../../../services/tauri";
import { retrieveProjectMemorySemanticCandidates, type ProjectMemoryEmbeddingIndexRecord, type ProjectMemoryEmbeddingProvider, type ProjectMemoryRetrievalMode } from "../utils/projectMemorySemanticRetrieval";
import {
  PICK_CANDIDATE_LIMIT,
  PICK_LIST_TIMEOUT_MS,
  type MemoryPickCandidate,
  type MemoryPickRetrieveResult,
  type MemoryRetrieveDiagnostics,
  type MemoryRetrieveEmptyReason,
  type MemoryRetrieveMode,
  type MemoryRetrieveProviderStatus,
} from "./memoryPickTypes";

/** 与 Scout fallback 页大小对齐；避免 import memoryScout 形成环 */
const LIST_PAGE_SIZE = 200;

export type MemoryRetrieveListFn = (params: {
  workspaceId: string;
  query?: string | null;
  importance?: string | null;
  page?: number | null;
  pageSize?: number | null;
}) => Promise<ProjectMemoryListResult>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("memory-pick-timeout"));
    }, ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        window.clearTimeout(timer);
        reject(error);
      });
  });
}

function toCandidate(
  memory: ProjectMemoryItem,
  score: number,
): MemoryPickCandidate {
  return {
    id: memory.id,
    title: resolveProjectMemoryCompactTitle(memory),
    summary: resolveProjectMemoryCompactSummary(memory),
    score,
    kind: memory.kind ?? memory.recordKind ?? undefined,
    importance: memory.importance ?? undefined,
    tags: memory.tags ?? undefined,
    engine: memory.engine ?? null,
    threadId: memory.threadId ?? null,
    updatedAt: memory.updatedAt,
    detail: memory.detail ?? memory.cleanText ?? memory.rawText ?? null,
    rawItem: memory,
  };
}

function buildDiagnostics(partial: {
  retrievalMode: MemoryRetrieveMode;
  emptyReason: MemoryRetrieveEmptyReason;
  providerStatus: MemoryRetrieveProviderStatus;
  scannedCount: number;
  candidateCount: number;
  startedAt: number;
  fallbackReason?: string | null;
}): MemoryRetrieveDiagnostics {
  return {
    retrievalMode: partial.retrievalMode,
    emptyReason: partial.emptyReason,
    providerStatus: partial.providerStatus,
    scannedCount: partial.scannedCount,
    candidateCount: partial.candidateCount,
    elapsedMs: Math.max(0, Date.now() - partial.startedAt),
    fallbackReason: partial.fallbackReason ?? null,
  };
}

function aggregateRetrievalMode(
  modes: ProjectMemoryRetrievalMode[],
): MemoryRetrieveMode {
  if (modes.includes("hybrid")) return "hybrid";
  if (modes.includes("semantic")) return "semantic";
  return "lexical";
}

/**
 * 统一检索：normalize → list → lexical score → optional semantic hybrid → slice。
 */
export async function retrieveMemoryCandidatesKernel(params: {
  workspaceId: string;
  query: string;
  listFn: MemoryRetrieveListFn;
  limit?: number;
  timeoutMs?: number;
  semanticProvider?: ProjectMemoryEmbeddingProvider | null;
  allowTestSemanticProvider?: boolean;
  /** 持久 embed index；提供时跳过检索路径全量 build */
  indexRecords?: ProjectMemoryEmbeddingIndexRecord[];
}): Promise<MemoryPickRetrieveResult> {
  const limit = params.limit ?? PICK_CANDIDATE_LIMIT;
  const timeoutMs = params.timeoutMs ?? PICK_LIST_TIMEOUT_MS;
  const startedAt = Date.now();
  const queryTerms = normalizeQueryTerms(params.query);

  // 无有效检索词：不强行塞无关记忆
  if (queryTerms.length === 0) {
    return {
      candidates: [],
      error: null,
      diagnostics: buildDiagnostics({
        retrievalMode: "lexical",
        emptyReason: "no_query_terms",
        providerStatus: "skipped",
        scannedCount: 0,
        candidateCount: 0,
        startedAt,
      }),
    };
  }

  let pool: ProjectMemoryItem[] = [];
  try {
    const result = await withTimeout(
      params.listFn({
        workspaceId: params.workspaceId,
        query: null,
        importance: null,
        page: 0,
        pageSize: LIST_PAGE_SIZE,
      }),
      timeoutMs,
    );
    pool = result.items ?? [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("memory-pick-timeout")) {
      return {
        candidates: [],
        error: "timeout",
        diagnostics: buildDiagnostics({
          retrievalMode: "lexical",
          emptyReason: "timeout",
          providerStatus: params.semanticProvider ? "skipped" : "skipped",
          scannedCount: 0,
          candidateCount: 0,
          startedAt,
        }),
      };
    }
    return {
      candidates: [],
      error: "retrieve_failed",
      diagnostics: buildDiagnostics({
        retrievalMode: "lexical",
        emptyReason: "error",
        providerStatus: "error",
        scannedCount: 0,
        candidateCount: 0,
        startedAt,
        fallbackReason: message.slice(0, 80),
      }),
    };
  }

  if (pool.length === 0) {
    return {
      candidates: [],
      error: null,
      diagnostics: buildDiagnostics({
        retrievalMode: "lexical",
        emptyReason: "no_match",
        providerStatus: "skipped",
        scannedCount: 0,
        candidateCount: 0,
        startedAt,
      }),
    };
  }

  // —— lexical 路径（无 provider 或 semantic 失败时的诚实输出）——
  const lexicalScored = pool
    .map((memory) => ({
      memory,
      score: scoreMemoryRelevance(memory, queryTerms, {
        queryText: params.query,
      }),
    }))
    .filter((entry) => entry.score >= RELEVANCE_THRESHOLD)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.memory.updatedAt - a.memory.updatedAt;
    });

  let providerStatus: MemoryRetrieveProviderStatus = "skipped";
  let fallbackReason: string | null = null;
  let retrievalMode: MemoryRetrieveMode = "lexical";
  let finalCandidates: MemoryPickCandidate[] = lexicalScored
    .slice(0, limit)
    .map((entry) => toCandidate(entry.memory, entry.score));

  const provider = params.semanticProvider ?? null;
  if (provider) {
    try {
      const semanticResult = await retrieveProjectMemorySemanticCandidates({
        workspaceId: params.workspaceId,
        query: params.query,
        memories: pool,
        provider,
        allowTestProvider: params.allowTestSemanticProvider,
        topK: limit,
        indexRecords: params.indexRecords,
      });

      if (
        semanticResult.status === "available" ||
        semanticResult.status === "indexing"
      ) {
        providerStatus = "available";
        if (semanticResult.candidates.length > 0) {
          retrievalMode = aggregateRetrievalMode(
            semanticResult.candidates.map((c) => c.retrievalMode),
          );
          // 诚实性：仅当确有 vector 分量时才允许 hybrid/semantic
          const hasVector = semanticResult.candidates.some(
            (c) => c.score.vectorScore != null,
          );
          if (!hasVector) {
            retrievalMode = "lexical";
          }
          // 展示分已在 scoreCandidate 做词面满分抬升；再滤一层防弱分漏网
          finalCandidates = semanticResult.candidates
            .filter(
              (c) =>
                c.score.lexicalScore >= RELEVANCE_THRESHOLD ||
                c.score.finalScore >= RELEVANCE_THRESHOLD,
            )
            .slice(0, limit)
            .map((c) => toCandidate(c.memory, c.score.finalScore));
        } else {
          // provider 可用但 0 语义命中：保留 lexical 排序，mode 仍 lexical
          retrievalMode = "lexical";
          fallbackReason =
            semanticResult.diagnostics.fallbackReason ?? "semantic_empty";
        }
      } else {
        providerStatus =
          semanticResult.status === "error" ? "error" : "unavailable";
        fallbackReason =
          semanticResult.diagnostics.fallbackReason ?? semanticResult.status;
        // 降级：lexical 结果不变
        retrievalMode = "lexical";
      }
    } catch (error) {
      providerStatus = "error";
      fallbackReason =
        error instanceof Error ? error.message.slice(0, 80) : "semantic_error";
      retrievalMode = "lexical";
    }
  }

  const emptyReason: MemoryRetrieveEmptyReason =
    finalCandidates.length > 0 ? "ok" : "no_match";

  return {
    candidates: finalCandidates,
    error: null,
    diagnostics: buildDiagnostics({
      retrievalMode,
      emptyReason,
      providerStatus,
      scannedCount: pool.length,
      candidateCount: finalCandidates.length,
      startedAt,
      fallbackReason,
    }),
  };
}

/**
 * 对已加载 pool 做 hybrid 重排（Scout 等可复用）。
 * 无 semanticMatches 时等价于 lexical finalScore 排序。
 */

