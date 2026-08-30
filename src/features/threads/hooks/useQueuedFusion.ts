import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  EngineType,
  QueuedMessage,
  WorkspaceInfo,
} from "../../../types";
import {
  getSharedSendActiveAttemptId,
  getSharedSendStateRevision,
} from "../../shared-session/runtime/sharedSendStateStore";
import { getSharedTargetState } from "../../shared-session/target/targetStore";
import { isResolvedExecutionTarget } from "../../shared-session/target/types";
import type { SharedSendState } from "../../shared-session/target/sendStateMachine";
import {
  createEngineMessageDeliveryDiagnostic,
  decideEngineMessageDelivery,
  type EngineMessageDeliveryDiagnostic,
} from "../contracts/engineMessageDelivery";
import {
  FUSION_RESUME_TIMEOUT_MS,
  isQueuedMessageFuseEligible,
  isSameSharedExecutionTarget,
  isSharedFollowUpState,
  type QueuedDispatchResult,
  type ThreadFusionState,
} from "./queuedSendHelpers";

/** dispatchQueuedMessage 签名：drain / fusion 子 hook 共用的注入类型。 */
export type QueuedMessageDispatcher = (
  item: QueuedMessage,
  options?: {
    targetThreadId?: string | null;
    targetWorkspace?: WorkspaceInfo | null;
    /** When true, never fall back to active-bound sendUserMessage. */
    requireThreadTarget?: boolean;
  },
) => Promise<QueuedDispatchResult>;

/** setQueuedByThread 签名：带 shared 持久化副作用的队列写入口。 */
export type SetQueuedByThread = (
  updater: (
    previous: Record<string, QueuedMessage[]>,
  ) => Record<string, QueuedMessage[]>,
) => void;

type UseQueuedFusionParams = {
  activeThreadId: string | null;
  activeTurnId: string | null | undefined;
  activeContinuationPulse: number;
  activeTerminalPulse: number;
  activeSharedSendState: SharedSendState;
  activeEngine: EngineType;
  activeWorkspace: WorkspaceInfo | null;
  isProcessing: boolean;
  isReviewing: boolean;
  isContextCompacting: boolean;
  isSharedSession: boolean;
  isClaudePendingBootstrapThread: boolean;
  steerEnabled: boolean;
  fusionByThread: Record<string, ThreadFusionState | null>;
  queuedByThread: Record<string, QueuedMessage[]>;
  inFlightByThread: Record<string, QueuedMessage | null>;
  setFusionByThread: Dispatch<
    SetStateAction<Record<string, ThreadFusionState | null>>
  >;
  setQueuedByThread: SetQueuedByThread;
  queuedAfterTerminalPulseRef: MutableRefObject<Map<string, number>>;
  queuedAfterSharedRevisionRef: MutableRefObject<Map<string, number>>;
  dispatchQueuedMessage: QueuedMessageDispatcher;
  replaceQueuedMessage: (threadId: string, item: QueuedMessage) => void;
  recordDeliveryDecision: (diagnostic: EngineMessageDeliveryDiagnostic) => void;
  interruptTurn?: (options?: {
    reason?: "user-stop" | "queue-fusion";
  }) => Promise<void>;
  handleFusionStalled?: (
    threadId: string,
    options?: { message?: string | null },
  ) => void;
};

export function useQueuedFusion({
  activeThreadId,
  activeTurnId,
  activeContinuationPulse,
  activeTerminalPulse,
  activeSharedSendState,
  activeEngine,
  activeWorkspace,
  isProcessing,
  isReviewing,
  isContextCompacting,
  isSharedSession,
  isClaudePendingBootstrapThread,
  steerEnabled,
  fusionByThread,
  queuedByThread,
  inFlightByThread,
  setFusionByThread,
  setQueuedByThread,
  queuedAfterTerminalPulseRef,
  queuedAfterSharedRevisionRef,
  dispatchQueuedMessage,
  replaceQueuedMessage,
  recordDeliveryDecision,
  interruptTurn,
  handleFusionStalled,
}: UseQueuedFusionParams): {
  fuseQueuedMessage: (threadId: string, messageId: string) => Promise<void>;
} {
  const fusionDispatchingRef = useRef(new Set<string>());

  const dispatchFusionSuccessor = useCallback(
    async (
      threadId: string,
      messageId: string,
      fusionOverride?: ThreadFusionState,
    ) => {
      const dispatchKey = `${threadId}:${messageId}`;
      if (fusionDispatchingRef.current.has(dispatchKey)) {
        return;
      }
      const fusion = fusionOverride ?? fusionByThread[threadId];
      const item = (queuedByThread[threadId] ?? []).find(
        (entry) => entry.id === messageId,
      );
      if (!fusion || !item) {
        return;
      }
      fusionDispatchingRef.current.add(dispatchKey);
      const dispatchItem: QueuedMessage = isSharedSession
        ? { ...item, sharedDispatchState: "pending-ack" }
        : item;
      if (isSharedSession) {
        replaceQueuedMessage(threadId, dispatchItem);
      }
      setFusionByThread((prev) => {
        const current = prev[threadId];
        if (!current || current.messageId !== messageId) {
          return prev;
        }
        return {
          ...prev,
          [threadId]: {
            ...current,
            stage: "dispatching",
            startedAtMs: Date.now(),
            turnIdBeforeFusion: activeTurnId ?? null,
            continuationPulseAtStart: activeContinuationPulse,
            terminalPulseAtStart: activeTerminalPulse,
          },
        };
      });
      const successorItem =
        fusion.mode === "cutover"
          ? {
              ...dispatchItem,
              sendOptions: {
                ...(dispatchItem.sendOptions ?? {}),
                resumeSource: "queue-fusion-cutover" as const,
                resumeTurnId: fusion.turnIdBeforeFusion,
              },
            }
          : dispatchItem;
      try {
        const dispatchResult = await dispatchQueuedMessage(successorItem, {
          targetThreadId:
            isSharedSession || activeEngine === "codex" ? threadId : null,
        });
        const dispatchAccepted =
          dispatchResult === "committed" ||
          (!isSharedSession && dispatchResult === "dispatched");
        if (!dispatchAccepted) {
          if (isSharedSession && dispatchResult === "blocked") {
            replaceQueuedMessage(threadId, {
              ...dispatchItem,
              sharedDispatchState: undefined,
            });
            if (activeWorkspace) {
              queuedAfterSharedRevisionRef.current.set(
                messageId,
                getSharedSendStateRevision(activeWorkspace.id, threadId),
              );
            }
          }
          queuedAfterTerminalPulseRef.current.set(
            messageId,
            activeTerminalPulse,
          );
          setFusionByThread((prev) => ({ ...prev, [threadId]: null }));
          return;
        }
        if (dispatchResult === "committed") {
          // canonical commit 比 successor-start 更强：已证明 successor 启动且结算。
          queuedAfterTerminalPulseRef.current.delete(messageId);
          queuedAfterSharedRevisionRef.current.delete(messageId);
          setQueuedByThread((prev) => ({
            ...prev,
            [threadId]: (prev[threadId] ?? []).filter(
              (entry) => entry.id !== messageId,
            ),
          }));
          setFusionByThread((prev) => ({ ...prev, [threadId]: null }));
          return;
        }
        setFusionByThread((prev) => {
          const current = prev[threadId];
          if (!current || current.messageId !== messageId) {
            return prev;
          }
          return {
            ...prev,
            [threadId]: {
              ...current,
              stage: "awaiting-continuation",
              startedAtMs: Date.now(),
            },
          };
        });
      } catch (error) {
        queuedAfterTerminalPulseRef.current.set(messageId, activeTerminalPulse);
        setFusionByThread((prev) => ({ ...prev, [threadId]: null }));
        throw error;
      } finally {
        fusionDispatchingRef.current.delete(dispatchKey);
      }
    },
    [
      activeContinuationPulse,
      activeEngine,
      activeTerminalPulse,
      activeTurnId,
      activeWorkspace,
      dispatchQueuedMessage,
      fusionByThread,
      isSharedSession,
      queuedByThread,
      replaceQueuedMessage,
      setQueuedByThread,
    ],
  );

  const fuseQueuedMessage = useCallback(
    async (threadId: string, messageId: string) => {
      if (!activeThreadId || threadId !== activeThreadId) {
        return;
      }
      if (isClaudePendingBootstrapThread) {
        return;
      }
      if (!activeWorkspace || !isProcessing || isReviewing) {
        return;
      }
      if (
        isContextCompacting ||
        (isSharedSession &&
          !isSharedFollowUpState(activeSharedSendState))
      ) {
        return;
      }
      if (fusionByThread[threadId] || inFlightByThread[threadId]) {
        return;
      }
      const item = (queuedByThread[threadId] ?? []).find(
        (entry) => entry.id === messageId,
      );
      if (!item || !isQueuedMessageFuseEligible(item)) {
        return;
      }
      if (
        isSharedSession &&
        (!item.sharedPredecessorAttemptId ||
          item.sharedPredecessorAttemptId !==
            getSharedSendActiveAttemptId(activeWorkspace.id, threadId))
      ) {
        return;
      }
      if (isSharedSession) {
        const currentTarget = getSharedTargetState(
          activeWorkspace.id,
          threadId,
        ).selectedNextTarget;
        if (
          !item.sharedExecutionTarget ||
          !isResolvedExecutionTarget(currentTarget) ||
          !isSameSharedExecutionTarget(
            currentTarget,
            item.sharedExecutionTarget,
          )
        ) {
          return;
        }
      }
      const deliveryRequest = {
        intent: "steer" as const,
        engine: activeEngine,
        sessionId: threadId,
        activeRunId: activeTurnId ?? null,
      };
      const steeringDecision = decideEngineMessageDelivery(deliveryRequest);
      recordDeliveryDecision(
        createEngineMessageDeliveryDiagnostic(
          deliveryRequest,
          steeringDecision,
        ),
      );
      // 同 activeFusionCapability：capability supported 即放行 same-run steer。
      const useSameRunContinuation =
        (steerEnabled ||
          steeringDecision.evidence.midTurnCapability === "supported") &&
        steeringDecision.status !== "rejected" &&
        steeringDecision.route === "steer";
      const useSafeCutover =
        !useSameRunContinuation &&
        steeringDecision.evidence.midTurnCapability === "compat-input" &&
        typeof interruptTurn === "function";
      if (!useSameRunContinuation && !useSafeCutover) {
        return;
      }

      const nextFusion: ThreadFusionState = {
        messageId,
        turnIdBeforeFusion: activeTurnId ?? null,
        mode: useSameRunContinuation ? "same-run" : "cutover",
        stage: useSameRunContinuation
          ? "dispatching"
          : "awaiting-predecessor-settlement",
        startedAtMs: Date.now(),
        continuationPulseAtStart: activeContinuationPulse,
        terminalPulseAtStart: activeTerminalPulse,
      };
      setFusionByThread((prev) => ({
        ...prev,
        [threadId]: nextFusion,
      }));

      if (useSameRunContinuation) {
        await dispatchFusionSuccessor(threadId, messageId, nextFusion);
        return;
      }
      await interruptTurn?.({ reason: "queue-fusion" });
    },
    [
      activeEngine,
      activeThreadId,
      activeContinuationPulse,
      activeTerminalPulse,
      activeTurnId,
      activeWorkspace,
      dispatchFusionSuccessor,
      fusionByThread,
      inFlightByThread,
      interruptTurn,
      activeSharedSendState,
      isClaudePendingBootstrapThread,
      isContextCompacting,
      isProcessing,
      isReviewing,
      isSharedSession,
      queuedByThread,
      recordDeliveryDecision,
      steerEnabled,
    ],
  );

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    if (
      !fusion ||
      fusion.mode !== "same-run" ||
      fusion.stage !== "dispatching"
    ) {
      return;
    }
    void dispatchFusionSuccessor(activeThreadId, fusion.messageId).catch(
      () => undefined,
    );
  }, [activeThreadId, dispatchFusionSuccessor, fusionByThread]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    const predecessorSettled = isSharedSession
      ? activeSharedSendState === "idle"
      : activeTerminalPulse > (fusion?.terminalPulseAtStart ?? Infinity);
    if (
      !fusion ||
      fusion.stage !== "awaiting-predecessor-settlement" ||
      !predecessorSettled ||
      isProcessing ||
      (isSharedSession && isContextCompacting)
    ) {
      return;
    }
    void dispatchFusionSuccessor(activeThreadId, fusion.messageId).catch(
      () => undefined,
    );
  }, [
    activeSharedSendState,
    activeTerminalPulse,
    activeThreadId,
    dispatchFusionSuccessor,
    fusionByThread,
    isContextCompacting,
    isProcessing,
    isSharedSession,
  ]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    if (!fusion || fusion.stage !== "awaiting-continuation") {
      return;
    }
    const hasSameRunContinuation =
      fusion.mode === "same-run"
      && activeContinuationPulse > fusion.continuationPulseAtStart;
    const hasCutoverContinuation =
      fusion.mode === "cutover" &&
      Boolean(activeTurnId) &&
      activeTurnId !== fusion.turnIdBeforeFusion;
    if (!hasSameRunContinuation && !hasCutoverContinuation) {
      return;
    }
    queuedAfterTerminalPulseRef.current.delete(fusion.messageId);
    queuedAfterSharedRevisionRef.current.delete(fusion.messageId);
    setQueuedByThread((prev) => ({
      ...prev,
      [activeThreadId]: (prev[activeThreadId] ?? []).filter(
        (entry) => entry.id !== fusion.messageId,
      ),
    }));
    setFusionByThread((prev) => ({
      ...prev,
      [activeThreadId]: null,
    }));
  }, [
    activeContinuationPulse,
    activeThreadId,
    activeTurnId,
    fusionByThread,
    setQueuedByThread,
  ]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const fusion = fusionByThread[activeThreadId];
    if (
      !fusion ||
      (fusion.stage !== "awaiting-predecessor-settlement" &&
        fusion.stage !== "awaiting-continuation")
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      setFusionByThread((prev) => {
        const current = prev[activeThreadId];
        if (
          !current ||
          (current.stage !== "awaiting-predecessor-settlement" &&
            current.stage !== "awaiting-continuation")
        ) {
          return prev;
        }
        // Timeout 后无法证明 successor 是否已接受；保留 item，但禁止
        // auto-drain 盲重放。用户仍可显式再次 Fusion 或删除该 item。
        queuedAfterTerminalPulseRef.current.set(
          current.messageId,
          Number.MAX_SAFE_INTEGER,
        );
        return {
          ...prev,
          [activeThreadId]: null,
        };
      });
      handleFusionStalled?.(activeThreadId);
    }, FUSION_RESUME_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThreadId, fusionByThread, handleFusionStalled]);

  return { fuseQueuedMessage };
}
