import { type MutableRefObject } from "react";
import type { ThreadSummary } from "../../../types";
import {
  getOpenCodeSessionList as getOpenCodeSessionListService,
  listThreads as listThreadsService,
} from "../../../services/tauri";
import {
  getThreadTimestamp,
  previewThreadName,
} from "../../../utils/threadItems";
import { asString } from "../utils/threadNormalize";
import type { createThreadHistoryLoaderForThread } from "./useThreadActions.historyLoaderFactory";
import {
  collectKnownCodexThreadIds,
  normalizeComparableWorkspacePath,
} from "./useThreadActions.workspacePath";
import {
  extractThreadSizeBytes,
  inferThreadEngineSource,
  isLocalSessionScanUnavailable,
  listReplacementThreadCandidates,
  mapWithConcurrency,
  mergeRecoveredThreadSummaries,
  resolveThreadSourceMeta,
  selectRecoveredNewThreadDecision,
  selectReplacementThreadByMessageHistoryDecision,
  selectReplacementThreadDecision,
  shouldIncludeWorkspaceThreadEntry,
  type ThreadRecoveryDecision,
} from "./useThreadActions.helpers";
import { buildPartialHistoryDiagnostic } from "../utils/stabilityDiagnostics";
import {
  RELATED_THREAD_LOAD_CONCURRENCY,
  THREAD_LIST_LOAD_OLDER_PAGE_SIZE,
  THREAD_RECOVERY_HISTORY_MATCH_CANDIDATES,
  THREAD_RECOVERY_MAX_FETCH_DURATION_MS,
  THREAD_RECOVERY_MAX_PAGES,
} from "./useThreadActions.threadList";
import { type UseThreadActionsOptions } from "./useThreadActions.types";

type ResumeHistoryLoader = ReturnType<typeof createThreadHistoryLoaderForThread>;

type ResumeHistorySnapshot = Awaited<ReturnType<ResumeHistoryLoader["load"]>>;

export type RecoverReplacementThreadParams = {
  workspaceId: string;
  threadId: string;
  itemsByThread: UseThreadActionsOptions["itemsByThread"];
  threadsByWorkspace: UseThreadActionsOptions["threadsByWorkspace"];
  activeThreadIdByWorkspace: UseThreadActionsOptions["activeThreadIdByWorkspace"];
  latestThreadsByWorkspaceRef: MutableRefObject<
    Record<string, ThreadSummary[]>
  >;
  previousThreadsByWorkspaceRef: MutableRefObject<
    Record<string, ThreadSummary[]>
  >;
  threadActivityRef: UseThreadActionsOptions["threadActivityRef"];
  workspacePathsByIdRef: MutableRefObject<Record<string, string>>;
  resolveWorkspacePath: UseThreadActionsOptions["resolveWorkspacePath"];
  getCustomName: UseThreadActionsOptions["getCustomName"];
  onDebug: UseThreadActionsOptions["onDebug"];
  dispatch: UseThreadActionsOptions["dispatch"];
  isCurrentResumeRequest: () => boolean;
  createHistoryLoader: (targetThreadId: string) => {
    load: (
      ...loadArgs: Parameters<ResumeHistoryLoader["load"]>
    ) => Promise<ResumeHistorySnapshot>;
  };
};

// 段级外移（大文件拆分 A3）：原 useThreadActionsResumeThread.ts 内
// recoverReplacementThread 的逐字搬运，闭包依赖经参数对象注入（每渲染新建）。
export async function recoverReplacementThreadForResume(
  params: RecoverReplacementThreadParams,
): Promise<{
  threadId: string;
  decision: ThreadRecoveryDecision;
  snapshot?: ResumeHistorySnapshot;
} | null> {
  const {
    workspaceId,
    threadId,
    itemsByThread,
    threadsByWorkspace,
    activeThreadIdByWorkspace,
    latestThreadsByWorkspaceRef,
    previousThreadsByWorkspaceRef,
    threadActivityRef,
    workspacePathsByIdRef,
    resolveWorkspacePath,
    getCustomName,
    onDebug,
    dispatch,
    isCurrentResumeRequest,
    createHistoryLoader,
  } = params;
  const existingSummaries =
    latestThreadsByWorkspaceRef.current[workspaceId] ??
    threadsByWorkspace[workspaceId] ??
    [];
  const recoveryBaselineSummaries =
    previousThreadsByWorkspaceRef.current[workspaceId] ??
    threadsByWorkspace[workspaceId] ??
    [];
  const staleSummary =
    existingSummaries.find((entry) => entry.id === threadId) ??
    (threadsByWorkspace[workspaceId] ?? []).find(
      (entry) => entry.id === threadId,
    );
  const engineSource = inferThreadEngineSource(threadId, staleSummary);
  const fallbackStaleActivityAt =
    (threadActivityRef.current[workspaceId] ?? {})[threadId] ?? 0;
  const effectiveStaleSummary =
    staleSummary ??
    (fallbackStaleActivityAt > 0
      ? {
          id: threadId,
          name: getCustomName(workspaceId, threadId) ?? "",
          updatedAt: fallbackStaleActivityAt,
          engineSource,
          threadKind: "native",
        }
      : undefined);
  let nextSummaries = existingSummaries;
  let directRecoveredDecision: ThreadRecoveryDecision | null = null;
  if (engineSource === "codex") {
    const workspacePath = normalizeComparableWorkspacePath(
      workspacePathsByIdRef.current[workspaceId] ??
        resolveWorkspacePath?.(workspaceId) ??
        "",
    );
    if (workspacePath) {
      const activeThreadId =
        activeThreadIdByWorkspace[workspaceId] ?? "";
      const knownCodexThreadIds = collectKnownCodexThreadIds(
        existingSummaries,
        activeThreadId,
      );
      const matchingThreads: Record<string, unknown>[] = [];
      const recoveryStartedAt = Date.now();
      let pagesFetched = 0;
      let cursor: string | null = null;
      do {
        pagesFetched += 1;
        const response = (await listThreadsService(
          workspaceId,
          cursor,
          // Recovery scans need larger pages than first-paint (5).
          THREAD_LIST_LOAD_OLDER_PAGE_SIZE,
        )) as Record<string, unknown>;
        if (!isCurrentResumeRequest()) {
          return null;
        }
        const result = (response.result ?? response) as Record<
          string,
          unknown
        >;
        const data = Array.isArray(result.data)
          ? (result.data as Record<string, unknown>[])
          : [];
        const allowKnownCodexWithoutCwd =
          isLocalSessionScanUnavailable(result);
        matchingThreads.push(
          ...data.filter((entry) =>
            shouldIncludeWorkspaceThreadEntry(
              entry,
              workspacePath,
              knownCodexThreadIds,
              allowKnownCodexWithoutCwd,
            ),
          ),
        );
        cursor = (result.nextCursor ?? result.next_cursor ?? null) as
          string | null;
        const replacementCandidate = selectReplacementThreadDecision({
          staleThreadId: threadId,
          staleSummary: effectiveStaleSummary,
          summaries: mergeRecoveredThreadSummaries(
            existingSummaries,
            matchingThreads
              .map((entry, index) => {
                const id = asString(entry.id).trim();
                const preview = asString(entry.preview).trim();
                const customName = getCustomName(workspaceId, id);
                const fallbackName = `Agent ${index + 1}`;
                return {
                  id,
                  name: customName
                    ? customName
                    : preview.length > 0
                      ? previewThreadName(preview, fallbackName)
                      : fallbackName,
                  updatedAt: getThreadTimestamp(entry),
                  sizeBytes: extractThreadSizeBytes(entry),
                  engineSource: "codex" as const,
                  threadKind: "native" as const,
                  ...resolveThreadSourceMeta(entry),
                } satisfies ThreadSummary;
              })
              .filter((entry) => entry.id),
            "codex",
          ),
        });
        if (
          replacementCandidate.summary &&
          (replacementCandidate.isPersistent || !cursor)
        ) {
          break;
        }
        if (pagesFetched >= THREAD_RECOVERY_MAX_PAGES) {
          break;
        }
        if (
          Date.now() - recoveryStartedAt >=
          THREAD_RECOVERY_MAX_FETCH_DURATION_MS
        ) {
          break;
        }
      } while (cursor);
      const refreshedCodexSummaries = matchingThreads
        .map((entry, index) => {
          const id = asString(entry.id).trim();
          const preview = asString(entry.preview).trim();
          const customName = getCustomName(workspaceId, id);
          const fallbackName = `Agent ${index + 1}`;
          return {
            id,
            name: customName
              ? customName
              : preview.length > 0
                ? previewThreadName(preview, fallbackName)
                : fallbackName,
            updatedAt: getThreadTimestamp(entry),
            sizeBytes: extractThreadSizeBytes(entry),
            engineSource: "codex" as const,
            threadKind: "native" as const,
            ...resolveThreadSourceMeta(entry),
          } satisfies ThreadSummary;
        })
        .filter((entry) => entry.id);
      directRecoveredDecision = selectRecoveredNewThreadDecision({
        staleThreadId: threadId,
        previousSummaries: recoveryBaselineSummaries,
        summaries: refreshedCodexSummaries,
        staleSummary: effectiveStaleSummary,
      });
      nextSummaries = mergeRecoveredThreadSummaries(
        existingSummaries,
        refreshedCodexSummaries,
        "codex",
      );
    }
  } else if (engineSource === "opencode") {
    const sessions = await getOpenCodeSessionListService(
      workspaceId,
    ).catch(() => []);
    if (!isCurrentResumeRequest()) {
      return null;
    }
    const refreshedOpenCodeSummaries = (
      Array.isArray(sessions) ? sessions : []
    )
      .map((session) => {
        const sessionUpdatedAt =
          typeof session.updatedAt === "number" &&
          Number.isFinite(session.updatedAt)
            ? Math.max(0, session.updatedAt)
            : 0;
        const id = `opencode:${session.sessionId}`;
        return {
          id,
          name:
            getCustomName(workspaceId, id) ||
            previewThreadName(session.title, "OpenCode Session"),
          updatedAt: sessionUpdatedAt,
          sizeBytes: extractThreadSizeBytes(
            session as Record<string, unknown>,
          ),
          engineSource: "opencode" as const,
          threadKind: "native" as const,
        } satisfies ThreadSummary;
      })
      .filter((entry) => entry.id);
    nextSummaries = mergeRecoveredThreadSummaries(
      existingSummaries,
      refreshedOpenCodeSummaries,
      "opencode",
    );
  }
  if (nextSummaries !== existingSummaries) {
    dispatch({
      type: "setThreads",
      workspaceId,
      threads: nextSummaries,
    });
    latestThreadsByWorkspaceRef.current = {
      ...latestThreadsByWorkspaceRef.current,
      [workspaceId]: nextSummaries,
    };
  }
  const summaryMatch = selectReplacementThreadDecision({
    staleThreadId: threadId,
    summaries: nextSummaries,
    staleSummary: effectiveStaleSummary,
  });
  if (summaryMatch.summary) {
    return {
      threadId: summaryMatch.summary.id,
      decision: summaryMatch,
    };
  }
  const newlyRecoveredMatch = selectRecoveredNewThreadDecision({
    staleThreadId: threadId,
    previousSummaries: recoveryBaselineSummaries,
    summaries: nextSummaries,
    staleSummary: effectiveStaleSummary,
  });
  if (newlyRecoveredMatch.summary) {
    return {
      threadId: newlyRecoveredMatch.summary.id,
      decision: newlyRecoveredMatch,
    };
  }
  if (directRecoveredDecision?.summary) {
    return {
      threadId: directRecoveredDecision.summary.id,
      decision: directRecoveredDecision,
    };
  }

  const staleItems = itemsByThread[threadId] ?? [];
  if (staleItems.length === 0) {
    return null;
  }

  const historyCandidates = listReplacementThreadCandidates({
    staleThreadId: threadId,
    summaries: nextSummaries,
    staleSummary,
  })
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, THREAD_RECOVERY_HISTORY_MATCH_CANDIDATES);
  if (historyCandidates.length === 0) {
    return null;
  }
  const historyCandidateById = new Map(
    historyCandidates.map((summary) => [summary.id, summary] as const),
  );

  const candidateSnapshots = await mapWithConcurrency(
    historyCandidates.map((summary) => summary.id),
    RELATED_THREAD_LOAD_CONCURRENCY,
    async (candidateThreadId) => {
      const summary = historyCandidateById.get(candidateThreadId);
      if (!summary) {
        return null;
      }
      try {
        const snapshot = await createHistoryLoader(summary.id).load(
          summary.id,
        );
        if (!isCurrentResumeRequest()) {
          return null;
        }
        return { summary, snapshot };
      } catch (candidateError) {
        if (!isCurrentResumeRequest()) {
          return null;
        }
        const diagnostic = buildPartialHistoryDiagnostic(
          candidateError instanceof Error
            ? candidateError.message
            : String(candidateError),
        );
        onDebug?.({
          id: `${Date.now()}-history-loader-recovery-candidate-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/history recovery candidate error",
          payload: {
            workspaceId,
            staleThreadId: threadId,
            candidateThreadId: summary.id,
            diagnosticCategory: diagnostic.category,
            error:
              candidateError instanceof Error
                ? candidateError.message
                : String(candidateError),
          },
        });
        return null;
      }
    },
  );
  if (!isCurrentResumeRequest()) {
    return null;
  }
  const historyMatch = selectReplacementThreadByMessageHistoryDecision({
    staleThreadId: threadId,
    staleItems,
    candidates: candidateSnapshots
      .filter(
        (
          candidate,
        ): candidate is {
          summary: (typeof historyCandidates)[number];
          snapshot: Awaited<
            ReturnType<ReturnType<typeof createHistoryLoader>["load"]>
          >;
        } => candidate !== null,
      )
      .map(({ summary, snapshot }) => ({
        summary,
        items: snapshot.items,
      })),
  });
  if (!historyMatch.summary) {
    return null;
  }
  const matchedSnapshot = candidateSnapshots.find(
    (candidate) => candidate?.summary.id === historyMatch.summary?.id,
  )?.snapshot;
  return {
    threadId: historyMatch.summary.id,
    decision: historyMatch,
    ...(matchedSnapshot ? { snapshot: matchedSnapshot } : {}),
  };
}
