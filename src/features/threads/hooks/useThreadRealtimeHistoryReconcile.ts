import { useCallback, useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { ConversationItem, DebugEntry, ThreadSummary } from "../../../types";
import { hasPendingOptimisticUserBubble } from "../utils/queuedHandoffBubble";
import type { ThreadState } from "./useThreadsReducer";

const CODEX_REALTIME_HISTORY_RECONCILE_DELAY_MS = 1_200;
const CODEX_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS = 2_800;
const CLAUDE_REALTIME_HISTORY_RECONCILE_DELAY_MS = 1_200;
const CLAUDE_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS = 2_800;
/** Mid-turn / post-send blank curtain: first probe sooner than normal settle reconcile. */
const CLAUDE_BLANK_CURTAIN_INITIAL_DELAY_MS = 700;
const CLAUDE_BLANK_CURTAIN_RETRY_DELAY_MS = 1_600;
const CLAUDE_BLANK_CURTAIN_MAX_ATTEMPTS = 4;

type TurnCompletedPayload = {
  workspaceId: string;
  threadId: string;
  turnId: string;
};

type UseThreadRealtimeHistoryReconcileOptions = {
  itemsByThreadRef: MutableRefObject<Record<string, ConversationItem[]>>;
  onDebug?: (entry: DebugEntry) => void;
  refreshThread: (workspaceId: string, threadId: string) => Promise<unknown>;
  resolveCanonicalThreadId: (threadId: string) => string;
  threadStatusByIdRef: MutableRefObject<ThreadState["threadStatusById"]>;
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
};

function isClaudeSessionThreadId(threadId: string): boolean {
  return threadId.startsWith("claude:");
}

export function useThreadRealtimeHistoryReconcile({
  itemsByThreadRef,
  onDebug,
  refreshThread,
  resolveCanonicalThreadId,
  threadStatusByIdRef,
  threadsByWorkspace,
}: UseThreadRealtimeHistoryReconcileOptions) {
  const codexRealtimeReconciledTurnByThreadRef = useRef<Record<string, string>>(
    {},
  );
  const codexRealtimeReconcileTimerByThreadRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const claudeRealtimeReconciledTurnByThreadRef = useRef<Record<string, string>>(
    {},
  );
  const claudeRealtimeReconcileTimerByThreadRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const claudeBlankCurtainTimerByThreadRef = useRef<
    Record<string, ReturnType<typeof setTimeout> | null>
  >({});
  const claudeBlankCurtainAttemptByThreadRef = useRef<Record<string, number>>(
    {},
  );

  useEffect(() => {
    return () => {
      Object.values(codexRealtimeReconcileTimerByThreadRef.current).forEach(
        (timer) => {
          if (timer) {
            clearTimeout(timer);
          }
        },
      );
      Object.values(claudeRealtimeReconcileTimerByThreadRef.current).forEach(
        (timer) => {
          if (timer) {
            clearTimeout(timer);
          }
        },
      );
      Object.values(claudeBlankCurtainTimerByThreadRef.current).forEach(
        (timer) => {
          if (timer) {
            clearTimeout(timer);
          }
        },
      );
      codexRealtimeReconcileTimerByThreadRef.current = {};
      codexRealtimeReconciledTurnByThreadRef.current = {};
      claudeRealtimeReconcileTimerByThreadRef.current = {};
      claudeRealtimeReconciledTurnByThreadRef.current = {};
      claudeBlankCurtainTimerByThreadRef.current = {};
      claudeBlankCurtainAttemptByThreadRef.current = {};
    };
  }, []);

  const shouldReconcileCodexRealtimeThread = useCallback(
    (workspaceId: string, threadId: string) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (
        canonicalThreadId.startsWith("claude:") ||
        canonicalThreadId.startsWith("claude-pending-") ||
        canonicalThreadId.startsWith("gemini:") ||
        canonicalThreadId.startsWith("gemini-pending-") ||
        canonicalThreadId.startsWith("grok:") ||
        canonicalThreadId.startsWith("grok-pending-") ||
        canonicalThreadId.startsWith("kimi:") ||
        canonicalThreadId.startsWith("kimi-pending-") ||
        canonicalThreadId.startsWith("opencode:") ||
        canonicalThreadId.startsWith("opencode-pending-") ||
        canonicalThreadId.startsWith("dsh:") ||
        canonicalThreadId.startsWith("dsh-pending-") ||
        // harden-pi-session-curtain-fidelity：pi 无 window 加载、无 cursor
        // 语义，codex refresh 分支对其是错误分支；列表 miss / rename 未落地
        // 时误入会触发 refreshThread，merge 锚点 miss 回退整体替换可能裁掉
        // 磁盘 flush 前的 live 尾部。
        canonicalThreadId.startsWith("pi:") ||
        canonicalThreadId.startsWith("pi-pending-") ||
        canonicalThreadId.startsWith("shared:")
      ) {
        return false;
      }
      const thread = (threadsByWorkspace[workspaceId] ?? []).find(
        (entry: ThreadSummary) => entry.id === canonicalThreadId,
      );
      if (thread?.threadKind === "shared") {
        return false;
      }
      return !thread?.engineSource || thread.engineSource === "codex";
    },
    [resolveCanonicalThreadId, threadsByWorkspace],
  );

  const scheduleCodexRealtimeHistoryReconcile = useCallback(
    (workspaceId: string, threadId: string, turnId: string, attempt = 0) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (!shouldReconcileCodexRealtimeThread(workspaceId, canonicalThreadId)) {
        return;
      }
      const reconciliationThreadKey = `${workspaceId}:${canonicalThreadId}`;
      const reconciliationTurnId = turnId.trim() || "__unknown_turn__";
      if (
        attempt === 0 &&
        codexRealtimeReconciledTurnByThreadRef.current[
          reconciliationThreadKey
        ] === reconciliationTurnId
      ) {
        return;
      }
      codexRealtimeReconciledTurnByThreadRef.current[reconciliationThreadKey] =
        reconciliationTurnId;
      const previousTimer =
        codexRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey];
      if (previousTimer) {
        clearTimeout(previousTimer);
      }
      const delay =
        attempt > 0
          ? CODEX_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS
          : CODEX_REALTIME_HISTORY_RECONCILE_DELAY_MS;
      codexRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey] =
        setTimeout(() => {
          delete codexRealtimeReconcileTimerByThreadRef.current[
            reconciliationThreadKey
          ];
          const status = threadStatusByIdRef.current[canonicalThreadId];
          if (status?.isProcessing && attempt === 0) {
            scheduleCodexRealtimeHistoryReconcile(
              workspaceId,
              canonicalThreadId,
              reconciliationTurnId,
              attempt + 1,
            );
            return;
          }
          if (
            attempt === 0 &&
            hasPendingOptimisticUserBubble(
              itemsByThreadRef.current[canonicalThreadId] ?? [],
            )
          ) {
            scheduleCodexRealtimeHistoryReconcile(
              workspaceId,
              canonicalThreadId,
              reconciliationTurnId,
              attempt + 1,
            );
            return;
          }
          onDebug?.({
            id: `${Date.now()}-codex-realtime-history-reconcile`,
            timestamp: Date.now(),
            source: "client",
            label: "codex/realtime history reconcile",
            payload: {
              workspaceId,
              threadId: canonicalThreadId,
              turnId: reconciliationTurnId,
              attempt,
            },
          });
          void refreshThread(workspaceId, canonicalThreadId).catch((error) => {
            onDebug?.({
              id: `${Date.now()}-codex-realtime-history-reconcile-error`,
              timestamp: Date.now(),
              source: "error",
              label: "codex/realtime history reconcile error",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                turnId: reconciliationTurnId,
                attempt,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          });
        }, delay);
    },
    [
      itemsByThreadRef,
      onDebug,
      refreshThread,
      resolveCanonicalThreadId,
      shouldReconcileCodexRealtimeThread,
      threadStatusByIdRef,
    ],
  );

  const shouldReconcileClaudeRealtimeThread = useCallback(
    (threadId: string) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      return isClaudeSessionThreadId(canonicalThreadId);
    },
    [resolveCanonicalThreadId],
  );

  const getClaudeItemCount = useCallback(
    (threadId: string) =>
      itemsByThreadRef.current[threadId]?.length ?? 0,
    [itemsByThreadRef],
  );

  const scheduleClaudeRealtimeHistoryReconcile = useCallback(
    (workspaceId: string, threadId: string, turnId: string, attempt = 0) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (!shouldReconcileClaudeRealtimeThread(canonicalThreadId)) {
        return;
      }
      const reconciliationThreadKey = `${workspaceId}:${canonicalThreadId}`;
      const reconciliationTurnId = turnId.trim() || "__unknown_turn__";
      if (
        attempt === 0 &&
        claudeRealtimeReconciledTurnByThreadRef.current[
          reconciliationThreadKey
        ] === reconciliationTurnId
      ) {
        return;
      }
      claudeRealtimeReconciledTurnByThreadRef.current[reconciliationThreadKey] =
        reconciliationTurnId;
      const previousTimer =
        claudeRealtimeReconcileTimerByThreadRef.current[
          reconciliationThreadKey
        ];
      if (previousTimer) {
        clearTimeout(previousTimer);
      }
      const delay =
        attempt > 0
          ? CLAUDE_REALTIME_HISTORY_RECONCILE_RETRY_DELAY_MS
          : CLAUDE_REALTIME_HISTORY_RECONCILE_DELAY_MS;
      claudeRealtimeReconcileTimerByThreadRef.current[reconciliationThreadKey] =
        setTimeout(() => {
          delete claudeRealtimeReconcileTimerByThreadRef.current[
            reconciliationThreadKey
          ];
          const status = threadStatusByIdRef.current[canonicalThreadId];
          if (status?.isProcessing && attempt === 0) {
            scheduleClaudeRealtimeHistoryReconcile(
              workspaceId,
              canonicalThreadId,
              reconciliationTurnId,
              attempt + 1,
            );
            return;
          }
          // fix-claude-history-window-message-loss：待定乐观用户气泡未被磁盘
          // window 覆盖，整体替换会把气泡吞掉；与 codex 路径对齐先延迟一次。
          if (
            attempt === 0 &&
            hasPendingOptimisticUserBubble(
              itemsByThreadRef.current[canonicalThreadId] ?? [],
            )
          ) {
            scheduleClaudeRealtimeHistoryReconcile(
              workspaceId,
              canonicalThreadId,
              reconciliationTurnId,
              attempt + 1,
            );
            return;
          }
          onDebug?.({
            id: `${Date.now()}-claude-realtime-history-reconcile`,
            timestamp: Date.now(),
            source: "client",
            label: "claude/realtime history reconcile",
            payload: {
              workspaceId,
              threadId: canonicalThreadId,
              turnId: reconciliationTurnId,
              attempt,
              itemCountBefore: getClaudeItemCount(canonicalThreadId),
            },
          });
          void refreshThread(workspaceId, canonicalThreadId)
            .then(() => {
              const itemCountAfter = getClaudeItemCount(canonicalThreadId);
              // Transcript may still be flushing after turn/completed; keep
              // probing until the curtain has rows or attempts exhaust.
              if (
                itemCountAfter === 0 &&
                attempt + 1 < CLAUDE_BLANK_CURTAIN_MAX_ATTEMPTS
              ) {
                scheduleClaudeRealtimeHistoryReconcile(
                  workspaceId,
                  canonicalThreadId,
                  reconciliationTurnId,
                  attempt + 1,
                );
              }
            })
            .catch((error) => {
              onDebug?.({
                id: `${Date.now()}-claude-realtime-history-reconcile-error`,
                timestamp: Date.now(),
                source: "error",
                label: "claude/realtime history reconcile error",
                payload: {
                  workspaceId,
                  threadId: canonicalThreadId,
                  turnId: reconciliationTurnId,
                  attempt,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
              if (attempt + 1 < CLAUDE_BLANK_CURTAIN_MAX_ATTEMPTS) {
                scheduleClaudeRealtimeHistoryReconcile(
                  workspaceId,
                  canonicalThreadId,
                  reconciliationTurnId,
                  attempt + 1,
                );
              }
            });
        }, delay);
    },
    [
      getClaudeItemCount,
      itemsByThreadRef,
      onDebug,
      refreshThread,
      resolveCanonicalThreadId,
      shouldReconcileClaudeRealtimeThread,
      threadStatusByIdRef,
    ],
  );

  /**
   * In-place blank-curtain recovery for Claude sessions that stay empty while
   * the user remains on the same thread (no page switch). Distinct from the
   * turn-completed settle path so mid-turn / post-send empties can rehydrate
   * from disk without waiting for a reselect.
   */
  const scheduleClaudeBlankCurtainRecovery = useCallback(
    (
      workspaceId: string,
      threadId: string,
      reason: string,
      attempt = 0,
    ) => {
      const canonicalThreadId = resolveCanonicalThreadId(threadId);
      if (!isClaudeSessionThreadId(canonicalThreadId)) {
        return;
      }
      if (getClaudeItemCount(canonicalThreadId) > 0) {
        delete claudeBlankCurtainAttemptByThreadRef.current[
          `${workspaceId}:${canonicalThreadId}`
        ];
        return;
      }
      if (attempt >= CLAUDE_BLANK_CURTAIN_MAX_ATTEMPTS) {
        return;
      }
      const recoveryKey = `${workspaceId}:${canonicalThreadId}`;
      // Coalesce concurrent kickers (active-thread effect, turn-complete, etc.)
      // so a pending probe is not reset back to attempt 0 forever.
      if (attempt === 0) {
        if (claudeBlankCurtainTimerByThreadRef.current[recoveryKey]) {
          return;
        }
        const inFlightAttempt =
          claudeBlankCurtainAttemptByThreadRef.current[recoveryKey];
        if (inFlightAttempt !== undefined && inFlightAttempt > 0) {
          return;
        }
      } else {
        const previousTimer =
          claudeBlankCurtainTimerByThreadRef.current[recoveryKey];
        if (previousTimer) {
          clearTimeout(previousTimer);
        }
      }
      const delay =
        attempt > 0
          ? CLAUDE_BLANK_CURTAIN_RETRY_DELAY_MS
          : CLAUDE_BLANK_CURTAIN_INITIAL_DELAY_MS;
      claudeBlankCurtainAttemptByThreadRef.current[recoveryKey] = attempt;
      claudeBlankCurtainTimerByThreadRef.current[recoveryKey] = setTimeout(
        () => {
          delete claudeBlankCurtainTimerByThreadRef.current[recoveryKey];
          if (getClaudeItemCount(canonicalThreadId) > 0) {
            delete claudeBlankCurtainAttemptByThreadRef.current[recoveryKey];
            return;
          }
          onDebug?.({
            id: `${Date.now()}-claude-blank-curtain-recovery`,
            timestamp: Date.now(),
            source: "client",
            label: "claude/blank curtain recovery",
            payload: {
              workspaceId,
              threadId: canonicalThreadId,
              reason,
              attempt,
            },
          });
          void refreshThread(workspaceId, canonicalThreadId)
            .then(() => {
              if (getClaudeItemCount(canonicalThreadId) > 0) {
                delete claudeBlankCurtainAttemptByThreadRef.current[recoveryKey];
                return;
              }
              scheduleClaudeBlankCurtainRecovery(
                workspaceId,
                canonicalThreadId,
                reason,
                attempt + 1,
              );
            })
            .catch((error) => {
              onDebug?.({
                id: `${Date.now()}-claude-blank-curtain-recovery-error`,
                timestamp: Date.now(),
                source: "error",
                label: "claude/blank curtain recovery error",
                payload: {
                  workspaceId,
                  threadId: canonicalThreadId,
                  reason,
                  attempt,
                  error:
                    error instanceof Error ? error.message : String(error),
                },
              });
              scheduleClaudeBlankCurtainRecovery(
                workspaceId,
                canonicalThreadId,
                reason,
                attempt + 1,
              );
            });
        },
        delay,
      );
    },
    [
      getClaudeItemCount,
      onDebug,
      refreshThread,
      resolveCanonicalThreadId,
    ],
  );

  const handleTurnCompletedForHistoryReconcile = useCallback(
    (payload: TurnCompletedPayload) => {
      const canonicalThreadId = resolveCanonicalThreadId(payload.threadId);
      if (isClaudeSessionThreadId(canonicalThreadId)) {
        scheduleClaudeRealtimeHistoryReconcile(
          payload.workspaceId,
          canonicalThreadId,
          payload.turnId,
        );
        // If the live projection never painted (blank curtain), also start the
        // dedicated empty-surface recovery so we do not rely on page switch.
        if (getClaudeItemCount(canonicalThreadId) === 0) {
          scheduleClaudeBlankCurtainRecovery(
            payload.workspaceId,
            canonicalThreadId,
            "turn-completed-empty-surface",
          );
        }
        return;
      }
      scheduleCodexRealtimeHistoryReconcile(
        payload.workspaceId,
        payload.threadId,
        payload.turnId,
      );
    },
    [
      getClaudeItemCount,
      resolveCanonicalThreadId,
      scheduleClaudeBlankCurtainRecovery,
      scheduleClaudeRealtimeHistoryReconcile,
      scheduleCodexRealtimeHistoryReconcile,
    ],
  );

  return {
    handleTurnCompletedForHistoryReconcile,
    scheduleClaudeBlankCurtainRecovery,
  };
}
