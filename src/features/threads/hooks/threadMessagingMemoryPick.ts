import { projectMemoryFacade } from "../../project-memory/services/projectMemoryFacade";
import { emitMemoryPickComposerMode } from "../../project-memory/memoryPick/memoryPickEvents";
import {
  emitMemoryPickTelemetry,
  hashQueryForTelemetry,
} from "../../project-memory/memoryPick/memoryPickTelemetry";
import { retrieveMemoryPickCandidates } from "../../project-memory/memoryPick/memoryPickRetrieval";
import { formatMemoryPickEmptyTimelineItemText } from "../../project-memory/memoryPick/memoryEmptyReasonToast";
import type {
  MemoryPickComposerMode,
  MemoryRetrieveEmptyReason,
} from "../../project-memory/memoryPick/memoryPickTypes";

export function emitMemoryPickComposerModeSync(
  workspaceId: string,
  threadId: string,
  mode: MemoryPickComposerMode,
) {
  emitMemoryPickComposerMode({ mode, workspaceId, threadId });
}

/**
 * Pick 检索 + telemetry。
 * 空结果可感改走主幕时间线（见 dispatchMemoryPickEmptyTimelineNotice），不用全局 toast。
 * 仅消费侧；不碰 capture 时序。
 */
export async function resolvePickSemanticContext(workspaceId: string) {
  const [{ resolveSemanticProviderForRetrieve }, { loadPersistedEmbeddingIndex }] =
    await Promise.all([
      import("../../project-memory/utils/resolveSemanticProviderForRetrieve"),
      import("../../project-memory/utils/projectMemoryEmbeddingIndexWorker"),
    ]);
  const semanticProvider = await resolveSemanticProviderForRetrieve();
  const indexRecords = semanticProvider
    ? await loadPersistedEmbeddingIndex(workspaceId)
    : undefined;
  return {
    semanticProvider,
    indexRecords:
      indexRecords && indexRecords.length > 0 ? indexRecords : undefined,
  };
}

export async function retrieveMemoryPickWithObservability(params: {
  workspaceId: string;
  query: string;
}) {
  const { semanticProvider, indexRecords } = await resolvePickSemanticContext(
    params.workspaceId,
  );
  const result = await retrieveMemoryPickCandidates({
    workspaceId: params.workspaceId,
    query: params.query,
    listFn: projectMemoryFacade.listSummary,
    semanticProvider,
    indexRecords,
  });
  const d = result.diagnostics;
  emitMemoryPickTelemetry("memory_pick_retrieve", {
    emptyReason: d.emptyReason,
    retrievalMode: d.retrievalMode,
    providerStatus: d.providerStatus,
    ms: d.elapsedMs,
    candidateCount: d.candidateCount,
    scannedCount: d.scannedCount,
    queryLength: params.query.length,
    queryHash: hashQueryForTelemetry(params.query),
    error: result.error,
    fallbackReason: d.fallbackReason ?? null,
  });
  return result;
}

/** 空/超时/失败：主幕时间线轻量 status（非旧摘要卡） */
export function buildMemoryPickEmptyTimelineText(
  emptyReason: MemoryRetrieveEmptyReason,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  return formatMemoryPickEmptyTimelineItemText(emptyReason, {
    includeNoQueryTerms: true,
    copy: {
      title: t("memoryPick.toast.title", { defaultValue: "记忆参考" }),
      timeout: t("memoryPick.toast.timeout", {
        defaultValue: "记忆检索超时，已按原文发送（未注入记忆）",
      }),
      no_match: t("memoryPick.toast.noMatch", {
        defaultValue: "未找到相关记忆，已按原文发送",
      }),
      error: t("memoryPick.toast.error", {
        defaultValue: "记忆检索失败，已按原文发送",
      }),
      no_query_terms: t("memoryPick.toast.noQueryTerms", {
        defaultValue: "当前输入缺少可检索关键词，已按原文发送",
      }),
    },
  });
}
