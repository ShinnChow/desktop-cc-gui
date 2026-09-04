import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { ConversationItem, ThreadSummary } from "../../../types";
import {
  loadClaudeSession as loadClaudeSessionService,
  resumeThread as resumeThreadService,
} from "../../../services/tauri";
import {
  buildItemsFromThread,
  getThreadTimestamp,
  isReviewingFromThread,
  mergeThreadItems,
  previewThreadName,
} from "../../../utils/threadItems";
import { extractClaudeHistoryTokenUsage } from "../loaders/claudeHistoryLoader";
import {
  createHydrateHistoryWorkingSet,
  hydrateHistory,
  hydrateItemsIntoWorkingSet,
  mergeHistoryProjectionItems,
} from "../assembly/conversationAssembler";
import { asString } from "../utils/threadNormalize";
import {
  appendRendererDiagnostic,
  hashDiagnosticText,
} from "../../../services/rendererDiagnostics";
import { mergeHydratedItemsPreservePrefix } from "../utils/mergeHydratedItemsPreservePrefix";
import {
  createThreadHistoryContinuationDecisionDebugEntry,
  createThreadHistoryReadableSurfaceDebugEntry,
} from "./useThreadActions.recoveryDiagnostics";
import {
  collectRelatedThreadIdsFromSnapshot,
  isAskUserQuestionToolItem,
  isTerminalToolStatus,
  isThreadResumeNotFoundError,
  isPendingThreadId,
  restoreThreadParentLinksFromSnapshot,
  shouldReplaceUserInputQueueFromSnapshot,
} from "./useThreadActions.helpers";
import {
  buildPartialHistoryDiagnostic,
  resolveThreadStabilityDiagnostic,
} from "../utils/stabilityDiagnostics";
import { isClaudeForkThreadId } from "../utils/claudeForkThread";
import { createThreadHistoryLoaderForThread } from "./useThreadActions.historyLoaderFactory";
import { runLegacyEngineHistoryFallback } from "./useThreadActionsResumeThread.legacyFallback";
import { recoverReplacementThreadForResume } from "./useThreadActionsResumeThread.recoveryProbe";
import { parseDshHostDownError } from "../../vendors/utils/dshHostStatus";
import { type UseThreadActionsOptions } from "./useThreadActions.types";
import type { HistoryLoadingProgress } from "../utils/historyLoadingProgress";
import {
  buildNativeHistoryFinalizeProgress,
  buildNativeHistoryHydrateProgress,
  yieldHistoryLoadingPaint,
} from "../utils/historyLoadingProgress";
import { dispatchThreadItemsProgressively } from "../utils/dispatchThreadItemsProgressively";
import {
  clearPendingOlderHistory,
  getPendingOlderHistory,
  rememberFullHistoryForWindow,
  replacePendingOlderHistoryItems,
} from "../utils/pendingOlderHistory";
import { setOlderHistoryRequester } from "../utils/olderHistoryRequestBridge";
import { createOlderHistoryRequester } from "../utils/createOlderHistoryRequester";
import { publishThreadDiskHistoryWindows } from "../utils/threadDiskHistoryWindowStore";
import { notifyOlderHistoryBeforePrepend } from "../utils/olderHistoryScrollRestoreBridge";

function buildHistorySnapshotPaintKey(snapshot: {
  threadId?: string;
  items: Array<{ id?: string }>;
}): string {
  const items = snapshot.items;
  return [
    snapshot.threadId ?? "",
    String(items.length),
    items[0]?.id ?? "",
    items[items.length - 1]?.id ?? "",
  ].join(":");
}

export type ResumeThreadForWorkspaceOptions = {
  preferLocalCodexHistory?: boolean;
  /**
   * fix-claude-history-window-message-loss：post-turn reconcile（自动 refresh）
   * 专用。hydrated window 仅覆盖尾部时保留当前列表中窗口之外的旧消息
   * （preserve-prefix merge）。显式 rewind / fork / delete 不得开启。
   */
  mergeHydratedPrefix?: boolean;
};

type ResumeThreadForWorkspaceContext = UseThreadActionsOptions & {
  reconcileMissingClaudeThread: (
    workspaceId: string,
    threadId: string,
  ) => boolean;
  workspacePathsByIdRef: MutableRefObject<Record<string, string>>;
  latestThreadsByWorkspaceRef: MutableRefObject<
    Record<string, ThreadSummary[]>
  >;
  previousThreadsByWorkspaceRef: MutableRefObject<
    Record<string, ThreadSummary[]>
  >;
  setThreadHistoryRecoveryFailed: (threadId: string, failed: boolean) => void;
  setThreadHistoryLoading?: (threadId: string, isLoading: boolean) => void;
  setThreadHistoryLoadingProgress?: (
    threadId: string,
    progress: HistoryLoadingProgress | null,
  ) => void;
};

type ResumeThreadForWorkspaceCallback = (
  workspaceId: string,
  threadId: string,
  force?: boolean,
  replaceLocal?: boolean,
  options?: ResumeThreadForWorkspaceOptions,
) => Promise<string | null>;

export function useThreadActionsResumeThreadForWorkspace(
  deps: ResumeThreadForWorkspaceContext,
): ResumeThreadForWorkspaceCallback {
  const {
    activeThreadIdByWorkspace,
    applyCollabThreadLinksFromThread,
    dispatch: rawDispatch,
    getCustomName,
    itemsByThread,
    historyWindowByThread,
    tokenUsageByThread = {},
    loadedThreadsRef,
    onDebug,
    resolveCanonicalThreadId,
    rememberThreadAlias,
    clearThreadAlias,
    replaceOnResumeRef,
    reconcileMissingClaudeThread,
    resolveWorkspacePath,
    threadActivityRef,
    threadStatusById,
    threadsByWorkspace,
    updateThreadParent,
    userInputRequests,
    useUnifiedHistoryLoader = false,
    workspacePathsByIdRef,
    latestThreadsByWorkspaceRef,
    previousThreadsByWorkspaceRef,
    setThreadHistoryRecoveryFailed: rawSetThreadHistoryRecoveryFailed,
    setThreadHistoryLoading,
    setThreadHistoryLoadingProgress,
  } = deps;
  const resumeRequestGenerationByScopeRef = useRef<Record<string, number>>({});
  const automaticRecoveryFailedByScopeRef = useRef<Record<string, true>>({});
  // harden-pi-session-curtain-fidelity：pi load 失败重试计数（按线程）。
  const piHistoryLoadFailureCountByThreadRef = useRef<Record<string, number>>(
    {},
  );
  // Late Shared projection merge must read the live canvas, not resume-start snapshot.
  const itemsByThreadRef = useRef(itemsByThread);
  itemsByThreadRef.current = itemsByThread;
  const threadStatusByIdRef = useRef(threadStatusById);
  threadStatusByIdRef.current = threadStatusById;
  const historyWindowByThreadRef = useRef(historyWindowByThread ?? {});
  historyWindowByThreadRef.current = historyWindowByThread ?? {};
  const threadsByWorkspaceRef = useRef(threadsByWorkspace);
  threadsByWorkspaceRef.current = threadsByWorkspace;
  const activeThreadIdByWorkspaceRef = useRef(activeThreadIdByWorkspace);
  activeThreadIdByWorkspaceRef.current = activeThreadIdByWorkspace;
  const olderHistoryInFlightByThreadRef = useRef(
    new Map<string, { cursor: string; epoch: number }>(),
  );
  const olderHistoryDiskPageEpochByThreadRef = useRef<Record<string, number>>(
    {},
  );

  useEffect(() => {
    publishThreadDiskHistoryWindows(historyWindowByThread);
  }, [historyWindowByThread]);

  useEffect(() => {
    const activeThreadIds = new Set(
      Object.values(activeThreadIdByWorkspace).filter(
        (threadId): threadId is string => Boolean(threadId),
      ),
    );
    for (const threadId of olderHistoryInFlightByThreadRef.current.keys()) {
      if (activeThreadIds.has(threadId)) {
        continue;
      }
      olderHistoryDiskPageEpochByThreadRef.current[threadId] =
        (olderHistoryDiskPageEpochByThreadRef.current[threadId] ?? 0) + 1;
      olderHistoryInFlightByThreadRef.current.delete(threadId);
    }
  }, [activeThreadIdByWorkspace]);

  useEffect(() => {
    const requester = createOlderHistoryRequester({
      dispatch: rawDispatch,
      getHistoryWindow: (targetThreadId) =>
        historyWindowByThreadRef.current[targetThreadId],
      resolveWorkspace: (targetThreadId) => {
        for (const [workspaceId, threads] of Object.entries(
          threadsByWorkspaceRef.current,
        )) {
          if (!threads.some((thread) => thread.id === targetThreadId)) {
            continue;
          }
          const workspacePath =
            workspacePathsByIdRef.current[workspaceId] ??
            resolveWorkspacePath?.(workspaceId) ??
            "";
          if (!workspacePath) {
            return null;
          }
          return { workspaceId, workspacePath };
        }
        for (const [workspaceId, activeThreadId] of Object.entries(
          activeThreadIdByWorkspaceRef.current,
        )) {
          if (activeThreadId !== targetThreadId) {
            continue;
          }
          const workspacePath =
            workspacePathsByIdRef.current[workspaceId] ??
            resolveWorkspacePath?.(workspaceId) ??
            "";
          if (!workspacePath) {
            return null;
          }
          return { workspaceId, workspacePath };
        }
        return null;
      },
      getDiskPageEpoch: (targetThreadId) =>
        olderHistoryDiskPageEpochByThreadRef.current[targetThreadId] ?? 0,
      inFlightByThread: olderHistoryInFlightByThreadRef.current,
      notifyBeforePrepend: notifyOlderHistoryBeforePrepend,
    });
    setOlderHistoryRequester(requester);
    return () => {
      setOlderHistoryRequester(null);
    };
  }, [rawDispatch, resolveWorkspacePath, workspacePathsByIdRef]);

  const resumeThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      force = false,
      replaceLocal = false,
      options?: ResumeThreadForWorkspaceOptions,
    ) => {
      if (!threadId) {
        return null;
      }
      const canonicalThreadId =
        resolveCanonicalThreadId?.(threadId) ?? threadId;
      const requestScopeKey = `${workspaceId}\u0000${canonicalThreadId}`;
      if (
        !force &&
        automaticRecoveryFailedByScopeRef.current[requestScopeKey]
      ) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: {
            workspaceId,
            threadId: canonicalThreadId,
            reason: "automatic-history-recovery-failed",
          },
        });
        return canonicalThreadId;
      }
      if (force) {
        delete automaticRecoveryFailedByScopeRef.current[requestScopeKey];
        rawSetThreadHistoryRecoveryFailed(canonicalThreadId, false);
      }
      const requestGeneration =
        (resumeRequestGenerationByScopeRef.current[requestScopeKey] ?? 0) + 1;
      resumeRequestGenerationByScopeRef.current[requestScopeKey] =
        requestGeneration;
      const isCurrentResumeRequest = () =>
        resumeRequestGenerationByScopeRef.current[requestScopeKey] ===
        requestGeneration;
      const dispatch: typeof rawDispatch = (action) => {
        if (isCurrentResumeRequest()) {
          rawDispatch(action);
        }
      };
      const setThreadHistoryRecoveryFailed = (
        targetThreadId: string,
        failed: boolean,
      ) => {
        if (isCurrentResumeRequest()) {
          const targetCanonicalThreadId =
            resolveCanonicalThreadId?.(targetThreadId) ?? targetThreadId;
          const targetScopeKey = `${workspaceId}\u0000${targetCanonicalThreadId}`;
          if (failed) {
            automaticRecoveryFailedByScopeRef.current[targetScopeKey] = true;
          } else {
            delete automaticRecoveryFailedByScopeRef.current[targetScopeKey];
          }
          rawSetThreadHistoryRecoveryFailed(targetThreadId, failed);
        }
      };
      const setThreadLoaded = (targetThreadId: string, loaded: boolean) => {
        if (isCurrentResumeRequest()) {
          loadedThreadsRef.current[targetThreadId] = loaded;
        }
      };
      const mergeHydratedPrefix = options?.mergeHydratedPrefix === true;
      const applyHydratedItems = async (
        targetThreadId: string,
        items: ConversationItem[],
        options?: { mode?: "tail-first" | "atomic" },
      ) => {
        // fix-claude-history-window-message-loss：post-turn reconcile（force+replace）
        // 的 hydrated window 只覆盖尾部，整体替换会裁掉窗口之外已展示的旧消息。
        // preserve-prefix merge：锚点对齐保留前缀；无法对齐时回退信任磁盘。
        let effectiveItems = items;
        if (mergeHydratedPrefix) {
          const merged = mergeHydratedItemsPreservePrefix(localItems, items);
          // harden-pi-session-curtain-fidelity：锚点 miss 时 merge 返回
          // hydrated 原引用（回退信任磁盘整体替换）。这是「吞」感知的
          // 高危路径，打点留痕供 debug 面板归因；纯观测，不改合并结果。
          if (localItems.length > 0 && merged === items) {
            onDebug?.({
              id: `${Date.now()}-client-hydrated-anchor-miss-fallback`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/hydrated merge anchor-miss fallback-to-disk",
              payload: {
                workspaceId,
                threadId: targetThreadId,
                itemCountBefore: localItems.length,
                itemCountAfter: merged.length,
              },
            });
          }
          effectiveItems = merged;
        }
        const result = await dispatchThreadItemsProgressively(
          dispatch,
          targetThreadId,
          effectiveItems,
          {
            mode: options?.mode ?? "tail-first",
            shouldContinue: () => isCurrentResumeRequest(),
          },
        );
        if (!isCurrentResumeRequest()) {
          return null;
        }
        if (result.remainingOlderCount > 0) {
          rememberFullHistoryForWindow(
            targetThreadId,
            effectiveItems,
            result.displayedCount,
          );
        } else {
          clearPendingOlderHistory(targetThreadId);
        }
        // F4（enhance-perf-diagnostics-evidence）：返回 dispatch 结果供
        // perf.thread-switch 计时证据使用（null = 请求失效）。
        return result;
      };
      const localItems = itemsByThread[threadId] ?? [];
      if (isPendingThreadId(threadId) || isClaudeForkThreadId(threadId)) {
        setThreadLoaded(threadId, true);
        setThreadHistoryRecoveryFailed(threadId, false);
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: {
            workspaceId,
            threadId,
            reason: isClaudeForkThreadId(threadId)
              ? "provisional-claude-fork"
              : "optimistic-pending-thread",
          },
        });
        return threadId;
      }
      const markHistoryRecoveryFailure = (
        targetThreadId: string,
        targetLocalItems: ConversationItem[],
        reasonCode: string,
        fallbackWarningCount = 0,
      ) => {
        setThreadLoaded(targetThreadId, false);
        setThreadHistoryRecoveryFailed(targetThreadId, true);
        onDebug?.(
          createThreadHistoryReadableSurfaceDebugEntry({
            workspaceId,
            threadId: targetThreadId,
            sourceThreadId: threadId,
            reopenOutcome:
              targetLocalItems.length > 0 ? "degraded-readable" : "failed",
            reasonCode:
              targetLocalItems.length > 0
                ? "last-good-local-items-preserved"
                : reasonCode,
            localItemCount: targetLocalItems.length,
            snapshotItemCount: 0,
            fallbackWarningCount,
          }),
        );
      };
      const status = threadStatusById[threadId];
      if (!force && status?.isProcessing && localItems.length > 0) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: { workspaceId, threadId, reason: "active-turn" },
        });
        return threadId;
      }
      const shouldPreserveLocalClaudeRealtimeItems =
        !force &&
        threadId.startsWith("claude:") &&
        localItems.length > 0 &&
        !replaceLocal &&
        replaceOnResumeRef.current[threadId] !== true;
      if (shouldPreserveLocalClaudeRealtimeItems) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: {
            workspaceId,
            threadId,
            reason: "local-claude-realtime-items",
          },
        });
        setThreadLoaded(threadId, true);
        // 本地实时消息保留时不重放历史，但应用重启后 token 用量 store 是空的
        //（消息来自持久化快照、用量不持久化），单独从历史 JSONL 回填一次。
        if (!tokenUsageByThread[threadId]) {
          const usageWorkspacePath =
            workspacePathsByIdRef.current[workspaceId] ??
            resolveWorkspacePath?.(workspaceId) ??
            "";
          const usageSessionId = threadId.slice("claude:".length);
          if (usageWorkspacePath && usageSessionId) {
            void loadClaudeSessionService(usageWorkspacePath, usageSessionId)
              .then((result) => {
                if (!isCurrentResumeRequest()) {
                  return;
                }
                const tokenUsage = extractClaudeHistoryTokenUsage(result);
                if (tokenUsage) {
                  dispatch({
                    type: "setThreadTokenUsage",
                    threadId,
                    tokenUsage,
                  });
                }
              })
              .catch((error) => {
                if (!isCurrentResumeRequest()) {
                  return;
                }
                onDebug?.({
                  id: `${Date.now()}-claude-history-usage-backfill-error`,
                  timestamp: Date.now(),
                  source: "error",
                  label: "thread/claude history usage backfill error",
                  payload: {
                    workspaceId,
                    threadId,
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                });
              });
          }
        }
        return threadId;
      }
      if (useUnifiedHistoryLoader) {
        // hydrateHistorySnapshot is assigned below; Shared soft-timeout merge calls it late.
        let phaseAPaintedSnapshotKey: string | null = null;
        let hydrateHistorySnapshot: (
          effectiveThreadId: string,
          snapshot: Awaited<
            ReturnType<
              ReturnType<typeof createThreadHistoryLoaderForThread>["load"]
            >
          >,
          options?: { mode?: "tail-first" | "atomic" },
        ) => Promise<boolean> = async () => false;

        // F4（enhance-perf-diagnostics-evidence）：loader 发起时刻，供
        // perf.thread-switch 计时（loader 发起 → items 落库）。首份证据消费后清除。
        const loaderStartedAtMsByThread: Record<string, number> = {};

        const createHistoryLoader = (targetThreadId: string) => {
          const loader = createThreadHistoryLoaderForThread({
            targetThreadId,
            workspaceId,
            workspacePath:
              workspacePathsByIdRef.current[workspaceId] ??
              resolveWorkspacePath?.(workspaceId) ??
              null,
            providerProfileId:
              latestThreadsByWorkspaceRef.current[workspaceId]?.find(
                (thread) => thread.id === targetThreadId,
              )?.providerProfileId ??
              threadsByWorkspaceRef.current[workspaceId]?.find(
                (thread) => thread.id === targetThreadId,
              )?.providerProfileId ??
              null,
            preferLocalCodexHistory: options?.preferLocalCodexHistory === true,
            onHistoryProgress: setThreadHistoryLoadingProgress
              ? (progress) => {
                  if (!isCurrentResumeRequest()) {
                    return;
                  }
                  setThreadHistoryLoadingProgress(targetThreadId, progress);
                }
              : undefined,
            onSharedPhaseAReady: (phaseASnapshot) => {
              // V0 is enough to paint. Drop the blocking curtain before
              // projection starts or times out (D1). Empty V0 must not
              // hydrate during Phase-A — wait for the open path to finish
              // so we do not mark loaded before projection settles.
              if (!isCurrentResumeRequest()) {
                return;
              }
              // Stamp before the first await so load() cannot re-hydrate the
              // same V0 on the same turn (projection skip / fast return).
              if (phaseASnapshot.items.length > 0) {
                phaseAPaintedSnapshotKey =
                  buildHistorySnapshotPaintKey(phaseASnapshot);
              }
              void (async () => {
                if (phaseASnapshot.items.length > 0) {
                  await hydrateHistorySnapshot(
                    targetThreadId,
                    phaseASnapshot,
                  );
                }
                if (!isCurrentResumeRequest()) {
                  return;
                }
                setThreadHistoryLoading?.(targetThreadId, false);
              })();
            },
            onSharedProjectionMerged: (mergedSnapshot) => {
              // Recovery「已解锁」与 history projection 解耦：后台 merge 不得挡发送。
              // 仅在仍是本次 resume 且线程未在跑 live turn 时应用。
              if (!isCurrentResumeRequest()) {
                return;
              }
              if (threadStatusByIdRef.current[targetThreadId]?.isProcessing) {
                return;
              }
              // 用「缓存全量 ⊕ 迟到 projection」而不是整表从头刷。
              const liveItems =
                itemsByThreadRef.current[targetThreadId] ?? [];
              const cached = getPendingOlderHistory(targetThreadId);
              const baseItems = cached?.items ?? liveItems;
              const projectionItems = mergedSnapshot.items;
              const nextItems =
                baseItems.length > 0
                  ? mergeHistoryProjectionItems(
                      baseItems,
                      projectionItems,
                      {
                        workspaceId,
                        threadId: targetThreadId,
                        engine: mergedSnapshot.engine,
                      },
                    )
                  : projectionItems;
              if (cached) {
                const pending = replacePendingOlderHistoryItems(
                  targetThreadId,
                  nextItems,
                );
                if (pending) {
                  dispatch({
                    type: "setThreadItems",
                    threadId: targetThreadId,
                    items: nextItems.slice(-pending.displayedCount),
                  });
                  return;
                }
              }
              void hydrateHistorySnapshot(
                targetThreadId,
                {
                  ...mergedSnapshot,
                  items: nextItems,
                },
              );
            },
          });
          return {
            load: async (
              ...loadArgs: Parameters<typeof loader.load>
            ) => {
              loaderStartedAtMsByThread[targetThreadId] =
                typeof performance !== "undefined"
                  ? performance.now()
                  : Date.now();
              return loader.load(...loadArgs);
            },
          };
        };
        hydrateHistorySnapshot = async (
          effectiveThreadId: string,
          snapshot: Awaited<
            ReturnType<ReturnType<typeof createHistoryLoader>["load"]>
          >,
          options?: { mode?: "tail-first" | "atomic" },
        ) => {
          if (!isCurrentResumeRequest()) {
            return false;
          }
          // F4 分段计时（enhance 续）：区分「resolve+load+桥转换」与「前端组装」。
          const ipcCompletedAtMs =
            typeof performance !== "undefined"
              ? performance.now()
              : Date.now();
          // 组装段（fix-session-load-bridge-freeze）：只同步组装尾部窗口
          // （首屏 shown=300 + 预备 prepend 余量），2140 条大会话的首屏组装从
          // ~3s 降到数百 ms；窗口外的更早消息在首屏上屏后分片渐进组装，
          // 完成后并入 pendingOlderHistory（「更早/All」语义不变）。
          const TAIL_ASSEMBLE_WINDOW = 400;
          const rawHistoryItems = snapshot.items;
          const tailRaw =
            rawHistoryItems.length > TAIL_ASSEMBLE_WINDOW
              ? rawHistoryItems.slice(
                  rawHistoryItems.length - TAIL_ASSEMBLE_WINDOW,
                )
              : rawHistoryItems;
          const remainderRaw =
            rawHistoryItems.length > TAIL_ASSEMBLE_WINDOW
              ? rawHistoryItems.slice(
                  0,
                  rawHistoryItems.length - TAIL_ASSEMBLE_WINDOW,
                )
              : [];
          const assembledSnapshot = hydrateHistory({
            ...snapshot,
            items: tailRaw,
          });
          const assembledAtMs =
            typeof performance !== "undefined"
              ? performance.now()
              : Date.now();
          const snapshotItems = assembledSnapshot.items;
          const effectiveLocalItems =
            effectiveThreadId === threadId
              ? localItems
              : (itemsByThread[effectiveThreadId] ?? []);
          // F4（fix-session-switch-jank-red-lines）：ensureThread 不再在 curtain
          // yield 前单独 dispatch（那会让侧栏/全树为 curtain 多付一次根级 commit），
          // 改为合入 applyHydratedItems 之后的 hydrateThreadHistorySnapshot 组合
          // action，与 items/元数据同 commit 上屏。
          if (snapshot.fallbackWarnings.length > 0) {
            const partialHistoryDiagnostic = buildPartialHistoryDiagnostic(
              snapshot.fallbackWarnings
                .map((entry) => String(entry.code ?? "unknown"))
                .join(", "),
            );
            onDebug?.({
              id: `${Date.now()}-history-loader-fallback`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/history fallback",
              payload: {
                workspaceId,
                threadId: effectiveThreadId,
                warnings: snapshot.fallbackWarnings,
                diagnosticCategory: partialHistoryDiagnostic.category,
                diagnosticMessage: partialHistoryDiagnostic.rawMessage,
              },
            });
          }
          if (snapshotItems.length === 0) {
            if (effectiveThreadId.startsWith("shared:")) {
              setThreadHistoryRecoveryFailed(effectiveThreadId, false);
              dispatch({
                type: "setThreadHistoryRestoredAt",
                threadId: effectiveThreadId,
                timestamp: assembledSnapshot.meta.historyRestoredAtMs,
              });
              onDebug?.(
                createThreadHistoryReadableSurfaceDebugEntry({
                  workspaceId,
                  threadId: effectiveThreadId,
                  sourceThreadId: threadId,
                  reopenOutcome: "recovered",
                  localItemCount: effectiveLocalItems.length,
                  snapshotItemCount: 0,
                  fallbackWarningCount: snapshot.fallbackWarnings.length,
                }),
              );
              setThreadLoaded(effectiveThreadId, true);
              return true;
            }
            markHistoryRecoveryFailure(
              effectiveThreadId,
              effectiveLocalItems,
              "history-hydrate-empty",
              snapshot.fallbackWarnings.length,
            );
            return false;
          }
          setThreadHistoryRecoveryFailed(effectiveThreadId, false);
          if (!effectiveThreadId.startsWith("shared:")) {
            setThreadHistoryLoadingProgress?.(
              effectiveThreadId,
              buildNativeHistoryHydrateProgress("start", snapshotItems.length),
            );
            await yieldHistoryLoadingPaint();
            if (!isCurrentResumeRequest()) {
              return false;
            }
          }
          const applied = await applyHydratedItems(
            effectiveThreadId,
            snapshotItems,
            { mode: options?.mode ?? "tail-first" },
          );
          if (!applied) {
            return false;
          }
          // F4：ensure + plan + restoredAt + window + tokenUsage 单次状态转移，
          // 与上面的 items dispatch 同宏任务 → 同一次根级 commit。
          dispatch({
            type: "hydrateThreadHistorySnapshot",
            workspaceId,
            threadId: effectiveThreadId,
            engine: assembledSnapshot.meta.engine,
            plan: assembledSnapshot.plan,
            historyRestoredAtMs: assembledSnapshot.meta.historyRestoredAtMs,
            historyHasMore: assembledSnapshot.meta.historyHasMore === true,
            historyNextCursor: assembledSnapshot.meta.historyNextCursor ?? null,
            tokenUsage: snapshot.tokenUsage ?? undefined,
          });
          // F4（enhance-perf-diagnostics-evidence）：切会话计时证据。loader 发起 →
          // items 落库（本组合 action）耗时；threadId 以短哈希落盘（隐私口径）。
          // 首份证据消费后清掉起点，同一 resume 的后续 merge 不重复计时。
          if (remainderRaw.length > 0) {
            const remainderForBackground = remainderRaw;
            const backgroundThreadId = effectiveThreadId;
            const backgroundEngine = assembledSnapshot.meta.engine;
            const tailItems = snapshotItems;
            const displayedCount = applied?.displayedCount ?? tailItems.length;
            void (async () => {
              const workingSet = createHydrateHistoryWorkingSet();
              const chunkSize = 150;
              for (
                let offset = 0;
                offset < remainderForBackground.length;
                offset += chunkSize
              ) {
                if (!isCurrentResumeRequest()) {
                  return;
                }
                hydrateItemsIntoWorkingSet(
                  workingSet,
                  remainderForBackground.slice(offset, offset + chunkSize),
                  {
                    engine: backgroundEngine,
                    threadId: backgroundThreadId,
                  },
                );
                // 每片之间让出主线程（setTimeout 全栈可用，Win WebView2 / WKWebView 一致）
                await new Promise((resolve) => {
                  setTimeout(resolve, 0);
                });
              }
              if (!isCurrentResumeRequest()) {
                return;
              }
              // 已组装余量并入 pendingOlderHistory：「更早/All」消费语义不变
              rememberFullHistoryForWindow(
                backgroundThreadId,
                [...workingSet.items, ...tailItems],
                displayedCount,
              );
            })();
          }
          const loaderStartedAtMs = loaderStartedAtMsByThread[effectiveThreadId];
          if (typeof loaderStartedAtMs === "number") {
            delete loaderStartedAtMsByThread[effectiveThreadId];
            const completedAtMs =
              typeof performance !== "undefined"
                ? performance.now()
                : Date.now();
            const durationMs = completedAtMs - loaderStartedAtMs;
            appendRendererDiagnostic("perf.thread-switch", {
              durationMs: Math.round(durationMs),
              loadMs: Math.round(ipcCompletedAtMs - loaderStartedAtMs),
              assembleMs: Math.round(assembledAtMs - ipcCompletedAtMs),
              itemCount: snapshotItems.length,
              displayedCount: applied?.displayedCount ?? snapshotItems.length,
              mode: options?.mode ?? "tail-first",
              engineSource: assembledSnapshot.meta.engine ?? null,
              threadIdHash: hashDiagnosticText(effectiveThreadId),
              fallbackWarningCount: snapshot.fallbackWarnings.length,
            });
          }
          onDebug?.(
            createThreadHistoryReadableSurfaceDebugEntry({
              workspaceId,
              threadId: effectiveThreadId,
              sourceThreadId: threadId,
              reopenOutcome: "recovered",
              localItemCount: effectiveLocalItems.length,
              snapshotItemCount: snapshotItems.length,
              fallbackWarningCount: snapshot.fallbackWarnings.length,
            }),
          );
          const hasLocalPendingQueue = userInputRequests.some(
            (request) =>
              request.workspace_id === workspaceId &&
              request.params.thread_id === effectiveThreadId,
          );
          const hasLocalPendingAskTool = effectiveLocalItems.some(
            (item) =>
              isAskUserQuestionToolItem(item) &&
              !isTerminalToolStatus(item.status),
          );
          if (
            shouldReplaceUserInputQueueFromSnapshot(
              snapshotItems,
              assembledSnapshot.userInputQueue.length,
              hasLocalPendingQueue || hasLocalPendingAskTool,
            )
          ) {
            dispatch({
              type: "clearUserInputRequestsForThread",
              workspaceId,
              threadId: effectiveThreadId,
            });
          }
          restoreThreadParentLinksFromSnapshot(
            effectiveThreadId,
            snapshotItems,
            updateThreadParent,
          );
          const relatedThreadIds = collectRelatedThreadIdsFromSnapshot(
            effectiveThreadId,
            snapshotItems,
          );
          relatedThreadIds.forEach((relatedThreadId) => {
            dispatch({
              type: "ensureThread",
              workspaceId,
              threadId: relatedThreadId,
              engine: "codex",
            });
          });
          if (relatedThreadIds.length > 0) {
            onDebug?.({
              id: `${Date.now()}-history-loader-related-deferred`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/history related deferred",
              payload: {
                workspaceId,
                threadId: effectiveThreadId,
                relatedThreadCount: relatedThreadIds.length,
              },
            });
          }
          assembledSnapshot.userInputQueue.forEach((request) => {
            dispatch({ type: "addUserInputRequest", request });
          });
          setThreadLoaded(effectiveThreadId, true);
          if (!effectiveThreadId.startsWith("shared:")) {
            setThreadHistoryLoadingProgress?.(
              effectiveThreadId,
              buildNativeHistoryFinalizeProgress(),
            );
          }
          return true;
        };
        // end hydrateHistorySnapshot assignment
        const loadHistorySnapshotWithBoundedEmptyRecovery = async (
          targetThreadId: string,
          initialSnapshot?: Awaited<
            ReturnType<ReturnType<typeof createHistoryLoader>["load"]>
          >,
        ) => {
          const firstSnapshot =
            initialSnapshot ??
            (await createHistoryLoader(targetThreadId).load(targetThreadId));
          if (!isCurrentResumeRequest()) {
            return firstSnapshot;
          }
          // Raw items already mean this snapshot is not an empty-loader miss.
          // Do not classify the full transcript just to decide whether to retry.
          if (firstSnapshot.items.length > 0) {
            return firstSnapshot;
          }
          if (targetThreadId.startsWith("shared:")) {
            return firstSnapshot;
          }
          onDebug?.({
            id: `${Date.now()}-history-loader-empty-retry`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/history empty retry",
            payload: {
              workspaceId,
              threadId: targetThreadId,
              reasonCode: "history-empty-first-attempt",
            },
          });
          try {
            return await createHistoryLoader(targetThreadId).load(
              targetThreadId,
            );
          } catch (retryError) {
            if (!isCurrentResumeRequest()) {
              return firstSnapshot;
            }
            onDebug?.({
              id: `${Date.now()}-history-loader-empty-retry-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/history empty retry error",
              payload: {
                workspaceId,
                threadId: targetThreadId,
                error:
                  retryError instanceof Error
                    ? retryError.message
                    : String(retryError),
              },
            });
            return firstSnapshot;
          }
        };
        try {
          const snapshot =
            await loadHistorySnapshotWithBoundedEmptyRecovery(threadId);
          if (!isCurrentResumeRequest()) {
            return threadId;
          }
          if (
            phaseAPaintedSnapshotKey &&
            buildHistorySnapshotPaintKey(snapshot) === phaseAPaintedSnapshotKey
          ) {
            return threadId;
          }
          await hydrateHistorySnapshot(threadId, snapshot);
          if (!isCurrentResumeRequest()) {
            return threadId;
          }
          return threadId;
        } catch (error) {
          if (!isCurrentResumeRequest()) {
            return threadId;
          }
          if (threadId.startsWith("shared:")) {
            // F4（perf-cold-start-click-storm-convergence）：宿主熔断 Down 是
            // 不可重试信号——记单条 down 状态事件，不计入 loader error 刷屏。
            const downSignal = parseDshHostDownError(error);
            if (downSignal) {
              onDebug?.({
                id: `${Date.now()}-dsh-host-down`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/dsh host down",
                payload: {
                  workspaceId,
                  threadId,
                  reason: downSignal.reason,
                  retryAfterMs: downSignal.retryAfterMs,
                },
              });
              setThreadLoaded(threadId, false);
              setThreadHistoryRecoveryFailed(threadId, false);
              return threadId;
            }
            const diagnostic =
              error instanceof Error
                ? resolveThreadStabilityDiagnostic(error.message)
                : resolveThreadStabilityDiagnostic(String(error));
            onDebug?.({
              id: `${Date.now()}-shared-history-loader-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/shared history loader error",
              payload: {
                workspaceId,
                threadId,
                error: error instanceof Error ? error.message : String(error),
                diagnosticCategory:
                  diagnostic?.category ?? "shared_projection_unavailable",
              },
            });
            setThreadLoaded(threadId, false);
            setThreadHistoryRecoveryFailed(threadId, false);
            return threadId;
          }
          if (isThreadResumeNotFoundError(error)) {
            try {
              const recoveredThread = await recoverReplacementThreadForResume({
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
              });
              if (!isCurrentResumeRequest()) {
                return threadId;
              }
              if (recoveredThread) {
                const replacementThreadId = recoveredThread.threadId;
                const replacementSnapshot =
                  await loadHistorySnapshotWithBoundedEmptyRecovery(
                    replacementThreadId,
                    recoveredThread.snapshot,
                  );
                if (!isCurrentResumeRequest()) {
                  return threadId;
                }
                const replacementHydrated = await hydrateHistorySnapshot(
                  replacementThreadId,
                  replacementSnapshot,
                );
                if (!isCurrentResumeRequest()) {
                  return threadId;
                }
                if (!replacementHydrated) {
                  markHistoryRecoveryFailure(
                    threadId,
                    localItems,
                    "replacement-history-hydrate-empty",
                    replacementSnapshot.fallbackWarnings.length,
                  );
                  return threadId;
                }
                onDebug?.(
                  createThreadHistoryContinuationDecisionDebugEntry({
                    workspaceId,
                    staleThreadId: threadId,
                    replacementThreadId,
                    decision: recoveredThread.decision,
                  }),
                );
                dispatch({
                  type: "clearUserInputRequestsForThread",
                  workspaceId,
                  threadId,
                });
                setThreadLoaded(threadId, false);
                if (recoveredThread.decision.isPersistent) {
                  rememberThreadAlias?.(threadId, replacementThreadId);
                } else {
                  clearThreadAlias?.(threadId);
                }
                dispatch({
                  type: "setActiveThreadId",
                  workspaceId,
                  threadId: replacementThreadId,
                });
                onDebug?.({
                  id: `${Date.now()}-history-loader-recovered-thread-alias`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "thread/history recovered stale thread",
                  payload: {
                    workspaceId,
                    staleThreadId: threadId,
                    replacementThreadId,
                    recoveryStrategy: recoveredThread.decision.strategy,
                    recoveryConfidence: recoveredThread.decision.confidence,
                    recoveryScoreGap: recoveredThread.decision.scoreGap,
                    recoveryReasonCode: recoveredThread.decision.reasonCode,
                    recoveryFeatureSignals:
                      recoveredThread.decision.featureSignals,
                    aliasPersisted: recoveredThread.decision.isPersistent,
                  },
                });
                return replacementThreadId;
              }
            } catch (recoveryError) {
              if (!isCurrentResumeRequest()) {
                return threadId;
              }
              const diagnostic = buildPartialHistoryDiagnostic(
                recoveryError instanceof Error
                  ? recoveryError.message
                  : String(recoveryError),
              );
              onDebug?.({
                id: `${Date.now()}-history-loader-recovery-error`,
                timestamp: Date.now(),
                source: "error",
                label: "thread/history recovery error",
                payload: {
                  diagnosticCategory: diagnostic.category,
                  error:
                    recoveryError instanceof Error
                      ? recoveryError.message
                      : String(recoveryError),
                },
              });
            }
          }
          // F4：宿主熔断 Down 不可重试，也不落 legacy fallback（同宿主注定再败）。
          const downSignal = parseDshHostDownError(error);
          if (downSignal) {
            onDebug?.({
              id: `${Date.now()}-dsh-host-down`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/dsh host down",
              payload: {
                workspaceId,
                threadId,
                reason: downSignal.reason,
                retryAfterMs: downSignal.retryAfterMs,
              },
            });
            setThreadLoaded(threadId, false);
            return threadId;
          }
          const stabilityDiagnostic =
            error instanceof Error
              ? resolveThreadStabilityDiagnostic(error.message)
              : resolveThreadStabilityDiagnostic(String(error));
          onDebug?.({
            id: `${Date.now()}-history-loader-error`,
            timestamp: Date.now(),
            source: "error",
            label: "thread/history loader error",
            payload: {
              error: error instanceof Error ? error.message : String(error),
              diagnosticCategory:
                stabilityDiagnostic?.category ?? "partial_history",
              recoveryReason: stabilityDiagnostic?.reconnectReason ?? null,
            },
          });
          // Fallback to legacy path to preserve recovery.
        }
      }
      // Claude sessions don't use Codex thread/resume RPC —
      // per-engine legacy fallback 分支段已段级外移至
      // useThreadActionsResumeThread.legacyFallback.ts；返回 undefined 表示
      // 非 legacy 引擎线程，继续走下方 codex resume RPC 尾段。
      const legacyFallbackResult = await runLegacyEngineHistoryFallback({
        workspaceId,
        threadId,
        force,
        localItems,
        dispatch,
        isCurrentResumeRequest,
        setThreadLoaded,
        setThreadHistoryRecoveryFailed,
        markHistoryRecoveryFailure,
        applyHydratedItems,
        setThreadHistoryLoadingProgress,
        loadedThreadsRef,
        reconcileMissingClaudeThread,
        onDebug,
        piHistoryLoadFailureCountByThreadRef,
        latestThreadsByWorkspaceRef,
        threadsByWorkspaceRef,
        itemsByThread,
        workspacePathsByIdRef,
        resolveWorkspacePath,
      });
      if (legacyFallbackResult !== undefined) {
        return legacyFallbackResult;
      }
      if (!force && loadedThreadsRef.current[threadId]) {
        return threadId;
      }
      if (
        status?.isProcessing &&
        loadedThreadsRef.current[threadId] &&
        !force
      ) {
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/resume skipped",
          payload: { workspaceId, threadId, reason: "active-turn" },
        });
        return threadId;
      }
      onDebug?.({
        id: `${Date.now()}-client-thread-resume`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/resume",
        payload: { workspaceId, threadId },
      });
      try {
        const response = (await resumeThreadService(
          workspaceId,
          threadId,
        )) as Record<string, unknown> | null;
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        onDebug?.({
          id: `${Date.now()}-server-thread-resume`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/resume response",
          payload: response,
        });
        const result = (response?.result ?? response) as Record<
          string,
          unknown
        > | null;
        const thread = (result?.thread ?? response?.thread ?? null) as Record<
          string,
          unknown
        > | null;
        if (thread) {
          dispatch({
            type: "ensureThread",
            workspaceId,
            threadId,
            engine: "codex",
          });
          applyCollabThreadLinksFromThread(threadId, thread);
          const items = buildItemsFromThread(thread);
          const localItems = itemsByThread[threadId] ?? [];
          const shouldReplace =
            replaceLocal || replaceOnResumeRef.current[threadId] === true;
          if (shouldReplace) {
            replaceOnResumeRef.current[threadId] = false;
          }
          if (localItems.length > 0 && !shouldReplace) {
            if (items.length === 0) {
              markHistoryRecoveryFailure(
                threadId,
                localItems,
                "history-hydrate-empty",
              );
              return threadId;
            }
            setThreadHistoryRecoveryFailed(threadId, false);
            dispatch({
              type: "setThreadHistoryRestoredAt",
              threadId,
              timestamp: Date.now(),
            });
            setThreadLoaded(threadId, true);
            return threadId;
          }
          const hasOverlap =
            items.length > 0 &&
            localItems.length > 0 &&
            items.some((item) =>
              localItems.some((local) => local.id === item.id),
            );
          const mergedItems =
            items.length > 0
              ? shouldReplace
                ? items
                : localItems.length > 0 && !hasOverlap
                  ? localItems
                  : mergeThreadItems(items, localItems)
              : localItems;
          if (mergedItems.length > 0) {
            setThreadHistoryRecoveryFailed(threadId, false);
            const appliedMergedItems = await applyHydratedItems(
              threadId,
              mergedItems,
            );
            if (!appliedMergedItems) {
              return threadId;
            }
          } else {
            markHistoryRecoveryFailure(
              threadId,
              localItems,
              "history-hydrate-empty",
            );
            return threadId;
          }
          dispatch({
            type: "setThreadHistoryRestoredAt",
            threadId,
            timestamp: Date.now(),
          });
          dispatch({
            type: "markReviewing",
            threadId,
            isReviewing: isReviewingFromThread(thread),
          });
          const preview = asString(thread?.preview ?? "");
          const customName = getCustomName(workspaceId, threadId);
          if (!customName && preview) {
            dispatch({
              type: "setThreadName",
              workspaceId,
              threadId,
              name: previewThreadName(preview, `Agent ${threadId.slice(0, 4)}`),
            });
          }
          const lastAgentMessage = [...mergedItems]
            .reverse()
            .find(
              (item) => item.kind === "message" && item.role === "assistant",
            ) as ConversationItem | undefined;
          const lastText =
            lastAgentMessage && lastAgentMessage.kind === "message"
              ? lastAgentMessage.text
              : preview;
          if (lastText) {
            dispatch({
              type: "setLastAgentMessage",
              threadId,
              text: lastText,
              timestamp: getThreadTimestamp(thread),
            });
          }
          setThreadLoaded(threadId, true);
          return threadId;
        }
        markHistoryRecoveryFailure(
          threadId,
          localItems,
          "history-response-missing",
        );
        return threadId;
      } catch (error) {
        if (!isCurrentResumeRequest()) {
          return threadId;
        }
        markHistoryRecoveryFailure(threadId, localItems, "history-load-failed");
        onDebug?.({
          id: `${Date.now()}-client-thread-resume-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/resume error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [
      activeThreadIdByWorkspace,
      applyCollabThreadLinksFromThread,
      updateThreadParent,
      rawDispatch,
      getCustomName,
      itemsByThread,
      tokenUsageByThread,
      latestThreadsByWorkspaceRef,
      loadedThreadsRef,
      onDebug,
      clearThreadAlias,
      previousThreadsByWorkspaceRef,
      rememberThreadAlias,
      replaceOnResumeRef,
      reconcileMissingClaudeThread,
      resolveCanonicalThreadId,
      resolveWorkspacePath,
      threadActivityRef,
      threadStatusById,
      threadsByWorkspace,
      userInputRequests,
      useUnifiedHistoryLoader,
      workspacePathsByIdRef,
      rawSetThreadHistoryRecoveryFailed,
      setThreadHistoryLoading,
      setThreadHistoryLoadingProgress,
    ],
  );
  return resumeThreadForWorkspace;
}
