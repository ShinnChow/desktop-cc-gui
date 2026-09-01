import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { DebugEntry, WorkspaceInfo } from "../../../types";
import {
  engineInterrupt as engineInterruptService,
  engineInterruptTurn as engineInterruptTurnService,
  interruptTurn as interruptTurnService,
} from "../../../services/tauri";
import { isSharedV2SendEnabled } from "../../shared-session/runtime/sharedV2SendFlag";
import { sharedSessionV2InterruptTurn as sharedSessionV2InterruptTurnService } from "../../shared-session/services/sharedSessions";
import {
  dispatchSharedSendEvent,
  getSharedSendActiveAttemptId,
  getSharedSendState,
  setSharedSendActiveAttempt,
} from "../../shared-session/runtime/sharedSendStateStore";
import { getSharedTargetState } from "../../shared-session/target/targetStore";
import { cancelSharedProviderRetry } from "../../shared-session/provider-retry/noteSharedProviderRetryTurn";
import {
  canonicalQoderProviderProfileId,
  parseQoderSessionIdentity,
} from "../utils/qoderSessionIdentity";
import { drainLiveAssistantTextTail } from "../utils/liveAssistantTextChannel";
import { drainLiveItemDeltaTail } from "../utils/liveItemDeltaChannel";
import { isUnknownEngineInterruptTurnMethodError } from "./threadMessagingHelpers";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";
import type { WorkspaceScopedMap } from "./workspaceScopedMap";
import { workspaceScopedSet } from "./workspaceScopedMap";

type ThreadEngine =
  | "claude"
  | "codex"
  | "gemini"
  | "grok"
  | "kimi"
  | "opencode"
  | "pi"
  | "omp"
  | "dsh"
  | "qoder";

type InterruptTurnOptions = {
  reason?: "user-stop" | "queue-fusion" | "plan-handoff";
};

type UseThreadInterruptTurnOptions = {
  activeThreadId: string | null;
  activeTurnIdByThread: ThreadState["activeTurnIdByThread"];
  activeWorkspace: WorkspaceInfo | null;
  dispatch: Dispatch<ThreadAction>;
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  onDebug?: (entry: DebugEntry) => void;
  pendingInterruptsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  getThreadProviderProfileId?: (
    workspaceId: string,
    threadId: string,
  ) => string | null | undefined;
  resolveThreadEngine: (workspaceId: string, threadId: string) => ThreadEngine;
  resolveThreadKind: (
    workspaceId: string,
    threadId: string,
  ) => "native" | "shared";
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  threadStatusById: ThreadState["threadStatusById"];
};

export function useThreadInterruptTurn({
  activeThreadId,
  activeTurnIdByThread,
  activeWorkspace,
  dispatch,
  interruptedThreadsRef,
  markProcessing,
  onDebug,
  pendingInterruptsRef,
  getThreadProviderProfileId,
  resolveThreadEngine,
  resolveThreadKind,
  setActiveTurnId,
  t,
  threadStatusById,
}: UseThreadInterruptTurnOptions) {
  const interruptTurn = useCallback(
    async (options?: InterruptTurnOptions) => {
      if (!activeWorkspace || !activeThreadId) {
        return;
      }
      const reason = options?.reason ?? "user-stop";
      if (activeWorkspace && activeThreadId) {
        cancelSharedProviderRetry(activeWorkspace.id, activeThreadId, "stopped");
      }
      const activeThreadKind = resolveThreadKind(
        activeWorkspace.id,
        activeThreadId,
      );
      const usesSharedV2Control =
        activeThreadKind === "shared" && isSharedV2SendEnabled();
      const sharedAttemptId = usesSharedV2Control
        ? getSharedSendActiveAttemptId(activeWorkspace.id, activeThreadId)
        : null;
      const activeTurnId = activeTurnIdByThread[activeThreadId] ?? null;
      const activeThreadIsProcessing =
        threadStatusById[activeThreadId]?.isProcessing ?? false;
      if (!activeTurnId && !activeThreadIsProcessing && !usesSharedV2Control) {
        onDebug?.({
          id: `${Date.now()}-client-turn-interrupt-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "turn/interrupt skipped",
          payload: {
            workspaceId: activeWorkspace.id,
            threadId: activeThreadId,
            reason,
            cause: "no-active-or-processing-turn",
          },
        });
        return;
      }
      if (usesSharedV2Control && !sharedAttemptId) {
        const sharedSendState = getSharedSendState(
          activeWorkspace.id,
          activeThreadId,
        ).state;
        if (
          sharedSendState === "idle" &&
          (activeTurnId || activeThreadIsProcessing)
        ) {
          // canonical commit 已把 Shared send state 收口并释放 Attempt；此时只剩
          // frontend lifecycle residue。它不再需要、也不允许触发 Runtime interrupt。
          markProcessing(activeThreadId, false);
          setActiveTurnId(activeThreadId, null);
          onDebug?.({
            id: `${Date.now()}-client-shared-turn-residue-converged`,
            timestamp: Date.now(),
            source: "client",
            label: "shared-session/turn residue converged",
            payload: {
              workspaceId: activeWorkspace.id,
              threadId: activeThreadId,
              reason,
              sharedSendState,
            },
          });
          return;
        }
        onDebug?.({
          id: `${Date.now()}-client-turn-interrupt-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "turn/interrupt skipped",
          payload: {
            workspaceId: activeWorkspace.id,
            threadId: activeThreadId,
            reason,
            cause: "shared-attempt-owner-missing",
            sharedSendState,
          },
        });
        return;
      }
      if (sharedAttemptId) {
        try {
          const interruptResult = await sharedSessionV2InterruptTurnService(
            activeWorkspace.id,
            activeThreadId,
            sharedAttemptId,
          );
          if (interruptResult.status === "terminal-committed") {
            dispatchSharedSendEvent(activeWorkspace.id, activeThreadId, {
              type: "terminalCommitted",
            });
            setSharedSendActiveAttempt(
              activeWorkspace.id,
              activeThreadId,
              null,
            );
            markProcessing(activeThreadId, false);
            setActiveTurnId(activeThreadId, null);
            return;
          }
        } catch (error) {
          onDebug?.({
            id: `${Date.now()}-client-turn-interrupt-error`,
            timestamp: Date.now(),
            source: "error",
            label: "turn/interrupt error",
            payload: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }
      const turnId = activeTurnId ?? "pending";
      const shouldGuardInterruptedThread = reason !== "queue-fusion";
      // A4 live-text 外部化：中断前把通道里「尚未落 reducer 的尾段」灌回 items，
      // 否则中断后该行会从通道全量文本回退到壳首段。hasCustomName: true 表示
      // 灌回不参与线程自动命名。
      const liveTextTail = drainLiveAssistantTextTail(activeThreadId);
      if (liveTextTail) {
        dispatch({
          type: "appendAgentDelta",
          workspaceId: activeWorkspace.id,
          threadId: activeThreadId,
          itemId: liveTextTail.itemId,
          delta: liveTextTail.tailDelta,
          hasCustomName: true,
        });
      }
      // A4 二期：中断同样把 reasoning/toolOutput 通道里「尚未落 reducer 的尾段」
      // 灌回 items（flag 关时通道为空、天然 no-op），否则中断后这些行会回退到
      // 建壳首段。
      for (const tail of drainLiveItemDeltaTail(activeThreadId)) {
        if (tail.lane === "reasoningContent") {
          dispatch({
            type: "appendReasoningContent",
            threadId: activeThreadId,
            itemId: tail.itemId,
            delta: tail.text,
          });
        } else if (tail.lane === "reasoningSummary") {
          dispatch({
            type: "appendReasoningSummary",
            threadId: activeThreadId,
            itemId: tail.itemId,
            delta: tail.text,
          });
        } else {
          dispatch({
            type: "appendToolOutput",
            threadId: activeThreadId,
            itemId: tail.itemId,
            delta: tail.text,
          });
        }
      }
      // Queue fusion immediately starts a successor turn on the same curtain; a
      // long-lived interrupted guard would drop that successor's realtime output.
      if (shouldGuardInterruptedThread) {
        workspaceScopedSet(
          interruptedThreadsRef.current,
          activeWorkspace.id,
          activeThreadId,
          true,
        );
      }
      markProcessing(activeThreadId, false);
      setActiveTurnId(activeThreadId, null);
      const interruptNotice =
        reason === "queue-fusion"
          ? t("threads.sessionStoppedForFusion")
          : reason === "plan-handoff"
            ? null
            : t("threads.sessionStopped");
      if (interruptNotice) {
        dispatch({
          type: "addAssistantMessage",
          threadId: activeThreadId,
          text: interruptNotice,
        });
      }
      if (!activeTurnId && shouldGuardInterruptedThread) {
        workspaceScopedSet(
          pendingInterruptsRef.current,
          activeWorkspace.id,
          activeThreadId,
          true,
        );
      }

      // Determine whether this thread is backed by a local CLI session.
      const resolvedThreadEngine = resolveThreadEngine(
        activeWorkspace.id,
        activeThreadId,
      );
      const isCliManagedEngine = resolvedThreadEngine !== "codex";

      onDebug?.({
        id: `${Date.now()}-client-turn-interrupt`,
        timestamp: Date.now(),
        source: "client",
        label: "turn/interrupt",
        payload: {
          workspaceId: activeWorkspace.id,
          threadId: activeThreadId,
          turnId,
          queued: !activeTurnId,
          engine: resolvedThreadEngine,
          reason,
        },
      });
      try {
        const sharedProviderProfileId =
          activeThreadKind === "shared"
            ? (getSharedTargetState(activeWorkspace.id, activeThreadId)
                .activeTurnTarget?.providerProfileId ?? null)
            : null;
        // Qoder Global/CN are two runtimes behind one engine id. Native Qoder
        // threads must carry their persisted distribution binding when
        // interrupting; omitting it intentionally resolves the legacy Global
        // runtime in Rust.
        const nativeQoderStoredProfileId =
          activeThreadKind === "native" && resolvedThreadEngine === "qoder"
            ? (getThreadProviderProfileId?.(
                activeWorkspace.id,
                activeThreadId,
              ) ?? null)
            : null;
        const nativeQoderIdentity =
          activeThreadKind === "native" &&
          resolvedThreadEngine === "qoder" &&
          activeThreadId.startsWith("qoder:")
            ? parseQoderSessionIdentity(
                activeThreadId,
                nativeQoderStoredProfileId,
              )
            : null;
        if (
          activeThreadKind === "native" &&
          resolvedThreadEngine === "qoder" &&
          activeThreadId.startsWith("qoder:") &&
          !nativeQoderIdentity
        ) {
          onDebug?.({
            id: `${Date.now()}-client-qoder-interrupt-identity-rejected`,
            timestamp: Date.now(),
            source: "client",
            label: "turn/interrupt Qoder identity rejected",
            payload: { workspaceId: activeWorkspace.id, threadId: activeThreadId },
          });
          return;
        }
        const nativeQoderProviderProfileId =
          resolvedThreadEngine === "qoder"
            ? (nativeQoderIdentity?.providerProfileId ??
              canonicalQoderProviderProfileId(nativeQoderStoredProfileId))
            : null;
        if (usesSharedV2Control) {
          // Shared V2 已由 durable attempt owner 精确中断；禁止再走 mutable
          // target / workspace-wide fallback 产生第二次 control side effect。
          onDebug?.({
            id: `${Date.now()}-server-turn-interrupt`,
            timestamp: Date.now(),
            source: "server",
            label: "turn/interrupt response",
            payload: { success: true },
          });
          return;
        }
        if (isCliManagedEngine) {
          // Claude/OpenCode/Gemini: target only the current turn process.
          // If turn id is not known yet, keep pending interrupt and let onTurnStarted
          // execute a precise kill once the backend emits the real turn id.
          if (activeTurnId) {
            try {
              if (activeThreadKind === "shared" || nativeQoderProviderProfileId) {
                await engineInterruptTurnService(
                  activeWorkspace.id,
                  activeTurnId,
                  resolvedThreadEngine,
                  sharedProviderProfileId ?? nativeQoderProviderProfileId,
                );
              } else {
                await engineInterruptTurnService(
                  activeWorkspace.id,
                  activeTurnId,
                  resolvedThreadEngine,
                );
              }
            } catch (error) {
              if (
                isUnknownEngineInterruptTurnMethodError(error) &&
                resolvedThreadEngine !== "qoder"
              ) {
                // Compatibility fallback for stale daemon/runtime that doesn't
                // implement engine_interrupt_turn yet.
                await engineInterruptService(activeWorkspace.id);
              } else {
                // Qoder Global/CN 不能降级到 workspace-wide interrupt：旧 RPC
                // 无法携带 distribution，可能误中断同 workspace 的另一套 runtime。
                throw error;
              }
            }
          }
        } else {
          // Codex: notify daemon via turn_interrupt RPC, plus engine_interrupt fallback.
          // B.5：Shared Thread 按 active Turn 的 Execution Target provider 路由，
          // 避免同 engine 双 Provider 并行时中断打到 default Provider 会话。
          await Promise.allSettled([
            interruptTurnService(
              activeWorkspace.id,
              activeThreadId,
              turnId,
              sharedProviderProfileId,
            ),
            engineInterruptService(activeWorkspace.id),
          ]);
        }
        onDebug?.({
          id: `${Date.now()}-server-turn-interrupt`,
          timestamp: Date.now(),
          source: "server",
          label: "turn/interrupt response",
          payload: { success: true },
        });
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-turn-interrupt-error`,
          timestamp: Date.now(),
          source: "error",
          label: "turn/interrupt error",
          payload: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [
      activeThreadId,
      activeTurnIdByThread,
      activeWorkspace,
      dispatch,
      interruptedThreadsRef,
      markProcessing,
      onDebug,
      pendingInterruptsRef,
      getThreadProviderProfileId,
      resolveThreadEngine,
      resolveThreadKind,
      setActiveTurnId,
      t,
      threadStatusById,
    ],
  );

  return interruptTurn;
}
