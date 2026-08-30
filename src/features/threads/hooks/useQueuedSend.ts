import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ConversationItem,
  EngineType,
  MessageSendOptions,
  QueuedMessage,
  SharedQueuedExecutionTarget,
  WorkspaceInfo,
} from "../../../types";
import {
  ensureInteractiveInputHooks,
  hadRecentInteractiveInput,
} from "../../../utils/interactiveMainThread";
import {
  getStartupTraceSnapshot,
  subscribeStartupTrace,
} from "../../startup-orchestration/utils/startupTrace";
import {
  isStartupForceEntered,
  subscribeStartupForceEnter,
} from "../../startup-orchestration/utils/startupForceEnter";
import {
  dispatchSharedSendEvent,
  getSharedSendActiveAttemptId,
  getSharedSendState,
  getSharedSendStateRevision,
  useSharedSendState,
} from "../../shared-session/runtime/sharedSendStateStore";
import {
  invalidateRecoveryOwnerPrefetch,
  resolveSharedRecoveryOwner,
} from "../../shared-session/runtime/recoveryClickPath";
import { sharedSessionV2AbandonUnresolvedAttempt } from "../../shared-session/services/sharedSessions";
import { getSharedTargetState } from "../../shared-session/target/targetStore";
import {
  isResolvedExecutionTarget,
} from "../../shared-session/target/types";
import type { SharedSendState } from "../../shared-session/target/sendStateMachine";
import {
  buildQueuedHandoffBubbleItem,
  doesConversationItemMatchUserBubble,
  type QueuedHandoffBubble,
} from "../utils/queuedHandoffBubble";
import {
  readSharedQueuedFollowUps,
  writeSharedQueuedFollowUps,
} from "../utils/sharedQueuedFollowUpStore";
import {
  createEngineMessageDeliveryDiagnostic,
  decideEngineMessageDelivery,
  type EngineMessageDeliveryDiagnostic,
} from "../contracts/engineMessageDelivery";
import type { ThreadMessageDispatchResult } from "./useThreadMessaging";
import {
  MAX_BACKGROUND_QUEUE_DRAIN,
  NATIVE_INFLIGHT_SETTLE_FALLBACK_MS,
  OPENCODE_INFLIGHT_STALL_MS,
  QUEUED_HANDOFF_BUBBLE_TTL_MS,
  buildQueueDrainSignal,
  canExecuteSlashCommand,
  classifySharedDispatchResult,
  cloneSharedExecutionTarget,
  getEnableBackgroundQueueDrain,
  isImplicitModeQuery,
  isQueuedMessageFuseEligible,
  isSameSharedExecutionTarget,
  isSharedFollowUpState,
  parseSlashCommand,
  resolveSharedQueuePersistenceOwner,
  FUSION_RESUME_TIMEOUT_MS,
  DELIVERY_DIAGNOSTIC_LIMIT,
  type QueuedDispatchResult,
  type QueueThreadStatusSnapshot,
  type SlashCommandKind,
  type ThreadFusionState,
} from "./queuedSendHelpers";
export {
  ENABLE_BACKGROUND_QUEUE_DRAIN,
  buildQueueDrainSignal,
  MAX_BACKGROUND_QUEUE_DRAIN,
  __setEnableBackgroundQueueDrainForTests,
  getEnableBackgroundQueueDrain,
} from "./queuedSendHelpers";

type UseQueuedSendOptions = {
  activeThreadId: string | null;
  activeTurnId?: string | null;
  activeContinuationPulse?: number;
  activeTerminalPulse?: number;
  isProcessing: boolean;
  isReviewing: boolean;
  isContextCompacting?: boolean;
  // True while an AskUserQuestion dialog is open for the active thread. The CLI
  // turn is blocked awaiting the answer, so the queue must NOT flush into it —
  // isProcessing can drop to false mid-ask, which would otherwise send queued
  // messages as fresh turns and strand the pending answer. See handleSend +
  // the auto-flush effect below.
  hasPendingUserInput?: boolean;
  /**
   * Per-thread activity for S1 background drain. Missing non-active entries are
   * treated as non-ready (hold) so we never blind-fire without status.
   */
  threadStatusById?: Record<string, QueueThreadStatusSnapshot | undefined>;
  /** Active timeline items; used to clear Codex handoff once real user bubble exists. */
  activeItems?: ConversationItem[];
  /** Resolve workspace by id for owner-bound background dispatch. */
  resolveWorkspace?: (workspaceId: string) => WorkspaceInfo | null;
  steerEnabled: boolean;
  activeWorkspace: WorkspaceInfo | null;
  activeEngine?: EngineType;
  isSharedSession?: boolean;
  resolveCanonicalThreadId: (threadId: string) => string;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      activate?: boolean;
      engine?: EngineType;
      folderId?: string | null;
    },
  ) => Promise<string | null>;
  sendUserMessage: (
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  sendUserMessageToThread: (
    workspace: WorkspaceInfo,
    threadId: string,
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<ThreadMessageDispatchResult>;
  startFork: (text: string, options?: MessageSendOptions) => Promise<void>;
  startReview: (text: string) => Promise<void>;
  startResume: (text: string) => Promise<void>;
  startMcp: (text: string) => Promise<void>;
  startSpecRoot: (text: string) => Promise<void>;
  startStatus: (text: string) => Promise<void>;
  startContext: (text: string) => Promise<void>;
  startExport: (text: string) => Promise<void>;
  startImport: (text: string) => Promise<void>;
  startLsp: (text: string) => Promise<void>;
  startShare: (text: string) => Promise<void>;
  startCompact: (text: string) => Promise<void>;
  startFast: (text: string) => Promise<void>;
  startMode: (text: string) => Promise<void>;
  setCodexCollaborationMode?: (mode: "plan" | "code") => void;
  getCodexCollaborationMode?: () => "plan" | "code" | null;
  getCodexCollaborationPayload?: () => Record<string, unknown> | null;
  interruptTurn?: (options?: {
    reason?: "user-stop" | "queue-fusion";
  }) => Promise<void>;
  handleFusionStalled?: (
    threadId: string,
    options?: { message?: string | null },
  ) => void;
  clearActiveImages: () => void;
};


type UseQueuedSendResult = {
  queuedByThread: Record<string, QueuedMessage[]>;
  activeQueue: QueuedMessage[];
  activeQueuedHandoffBubble: QueuedHandoffBubble | null;
  handleSend: (
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  queueMessage: (
    text: string,
    images?: string[],
    options?: MessageSendOptions,
  ) => Promise<void>;
  removeQueuedMessage: (
    threadId: string,
    messageId: string,
    options?: { confirmedPendingAck?: boolean },
  ) => Promise<boolean>;
  fuseQueuedMessage: (threadId: string, messageId: string) => Promise<void>;
  canFuseActiveQueue: boolean;
  /** 全局融合不可用时的 i18n key；canFuse 时为 null。 */
  fuseDisabledReasonKey: string | null;
  activeFusingMessageId: string | null;
};


export function useQueuedSend({
  activeThreadId,
  activeTurnId,
  activeContinuationPulse = 0,
  activeTerminalPulse = 0,
  isProcessing,
  isReviewing,
  isContextCompacting = false,
  hasPendingUserInput = false,
  threadStatusById,
  activeItems = [],
  resolveWorkspace,
  steerEnabled,
  activeWorkspace,
  activeEngine = "claude",
  isSharedSession = false,
  resolveCanonicalThreadId,
  connectWorkspace,
  startThreadForWorkspace,
  sendUserMessage,
  sendUserMessageToThread,
  startFork,
  startReview,
  startResume,
  startMcp,
  startSpecRoot,
  startStatus,
  startContext,
  startExport,
  startImport,
  startLsp,
  startShare,
  startCompact,
  startFast,
  startMode,
  setCodexCollaborationMode,
  getCodexCollaborationMode,
  getCodexCollaborationPayload,
  interruptTurn,
  handleFusionStalled,
  clearActiveImages,
}: UseQueuedSendOptions): UseQueuedSendResult {
  const isClaudePendingBootstrapThread =
    activeEngine === "claude" &&
    Boolean(activeThreadId?.startsWith("claude-pending-"));
  const sharedSendEntry = useSharedSendState(
    isSharedSession ? (activeWorkspace?.id ?? "") : "",
    isSharedSession ? (activeThreadId ?? "") : "",
  );
  const activeSharedSendState: SharedSendState = isSharedSession
    ? sharedSendEntry.state
    : "idle";
  const initialSharedQueueOwner =
    isSharedSession && activeWorkspace && activeThreadId
      ? `${activeWorkspace.id}::${activeThreadId}`
      : null;
  const [queuedByThread, setQueuedByThreadState] = useState<
    Record<string, QueuedMessage[]>
  >(() =>
    isSharedSession && activeWorkspace && activeThreadId
      ? {
          [activeThreadId]: readSharedQueuedFollowUps(
            activeWorkspace.id,
            activeThreadId,
          ),
        }
      : {},
  );
  const queuedByThreadRef = useRef(queuedByThread);
  const [inFlightByThread, setInFlightByThread] = useState<
    Record<string, QueuedMessage | null>
  >({});
  const [queuedHandoffByThread, setQueuedHandoffByThread] = useState<
    Record<string, QueuedHandoffBubble | null>
  >({});
  const [hasStartedByThread, setHasStartedByThread] = useState<
    Record<string, boolean>
  >({});
  const [fusionByThread, setFusionByThread] = useState<
    Record<string, ThreadFusionState | null>
  >({});
  const previousActiveThreadIdRef = useRef<string | null>(activeThreadId);
  const queuedAfterTerminalPulseRef = useRef(new Map<string, number>());
  const queuedAfterSharedRevisionRef = useRef(new Map<string, number>());
  const deliveryDiagnosticsRef = useRef<EngineMessageDeliveryDiagnostic[]>([]);
  const hydratedSharedQueueOwnersRef = useRef(
    new Set(initialSharedQueueOwner ? [initialSharedQueueOwner] : []),
  );
  const fusionDispatchingRef = useRef(new Set<string>());
  const queueDispatchingRef = useRef(new Set<string>());
  /** 已成功 dispatch 的 queue item id，禁止回队后再次发送（防重发洪水）。 */
  const completedQueueDispatchIdsRef = useRef(new Set<string>());
  /** 避免 hasStarted 进 effect deps 造成自激；仅 settlement / opencode stall 读写。 */
  const hasStartedByThreadRef = useRef<Record<string, boolean>>({});
  /** native 成功但 processing 边沿可能丢失时的兜底计时。 */
  const nativeInFlightSinceRef = useRef<Record<string, number>>({});
  /** 最新 status 快照：drain 读 ref，不把整表 threadStatusById 放进 effect deps。 */
  const threadStatusByIdRef = useRef(threadStatusById);
  threadStatusByIdRef.current = threadStatusById;
  const isProcessingRef = useRef(isProcessing);
  isProcessingRef.current = isProcessing;
  const isReviewingRef = useRef(isReviewing);
  isReviewingRef.current = isReviewing;
  const isContextCompactingRef = useRef(isContextCompacting);
  isContextCompactingRef.current = isContextCompacting;
  const activeTerminalPulseRef = useRef(activeTerminalPulse);
  activeTerminalPulseRef.current = activeTerminalPulse;
  const hasPendingUserInputRef = useRef(hasPendingUserInput);
  hasPendingUserInputRef.current = hasPendingUserInput;
  /**
   * 产品化冷启门：startup-gate-ready（或 force-enter）之后，再等一小段无点击才放行 drain。
   * 不是「对抗」关掉 S1，而是 drain 调度与启动门对齐；用户 handleSend/queueMessage 始终可用。
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isVitest =
    typeof import.meta !== "undefined" &&
    (import.meta as any).env?.MODE === "test";
  const [queueDrainReleased, setQueueDrainReleased] = useState(() => {
    if (isVitest) {
      return true;
    }
    return (
      Boolean(getStartupTraceSnapshot().milestones["startup-gate-ready"]) ||
      isStartupForceEntered()
    );
  });
  const queueDrainReleasedRef = useRef(queueDrainReleased);
  queueDrainReleasedRef.current = queueDrainReleased;

  useEffect(() => {
    if (isVitest || queueDrainReleased) {
      return;
    }
    ensureInteractiveInputHooks();
    let cancelled = false;
    let quietTimer: number | null = null;

    const clearQuietTimer = () => {
      if (quietTimer != null) {
        window.clearTimeout(quietTimer);
        quietTimer = null;
      }
    };

    const tryRelease = (): boolean => {
      if (cancelled) {
        return false;
      }
      const gateOpen =
        Boolean(getStartupTraceSnapshot().milestones["startup-gate-ready"]) ||
        isStartupForceEntered();
      if (!gateOpen) {
        return false;
      }
      // gate 已开：仍等短静默，避免 unmask 瞬间与猛点叠 drain
      if (hadRecentInteractiveInput(400)) {
        clearQuietTimer();
        quietTimer = window.setTimeout(() => {
          void tryRelease();
        }, 200);
        return false;
      }
      setQueueDrainReleased(true);
      return true;
    };

    if (tryRelease()) {
      return () => {
        cancelled = true;
        clearQuietTimer();
      };
    }

    const unsubTrace = subscribeStartupTrace(() => {
      void tryRelease();
    });
    // force-enter 会 stampStartupGateReady → recordStartupMilestone → 通知
    // trace 订阅者，上面的 unsubTrace 已能覆盖；这里再直订 force-enter 双保险。
    // 原 250ms 兜底轮询已删：冷启脆弱窗内不再有亚秒级空转
    // （windows-cold-start-click-freeze gate；quiet 迟到场景由 tryRelease
    // 内部的 200ms quietTimer 自递归覆盖，有界）。
    const unsubForceEnter = subscribeStartupForceEnter(() => {
      void tryRelease();
    });
    // 单发兜底（非周期轮询）：事件链异常缺失时 30s 后强制补一次。
    const fallbackTimer = window.setTimeout(() => {
      void tryRelease();
    }, 30_000);

    return () => {
      cancelled = true;
      clearQuietTimer();
      unsubTrace();
      unsubForceEnter();
      window.clearTimeout(fallbackTimer);
    };
  }, [isVitest, queueDrainReleased]);

  useEffect(() => {
    queuedByThreadRef.current = queuedByThread;
  }, [queuedByThread]);

  useEffect(() => {
    if (!isSharedSession || !activeWorkspace || !activeThreadId) {
      return;
    }
    const ownerKey = `${activeWorkspace.id}::${activeThreadId}`;
    if (hydratedSharedQueueOwnersRef.current.has(ownerKey)) {
      return;
    }
    hydratedSharedQueueOwnersRef.current.add(ownerKey);
    const persisted = readSharedQueuedFollowUps(
      activeWorkspace.id,
      activeThreadId,
    );
    setQueuedByThreadState((prev) => {
      if (prev[activeThreadId]) {
        return prev;
      }
      const next = {
        ...prev,
        [activeThreadId]: persisted,
      };
      queuedByThreadRef.current = next;
      return next;
    });
  }, [activeThreadId, activeWorkspace, isSharedSession]);

  const setQueuedByThread = useCallback(
    (
      updater: (
        previous: Record<string, QueuedMessage[]>,
      ) => Record<string, QueuedMessage[]>,
    ) => {
      const previous = queuedByThreadRef.current;
      const next = updater(previous);
      if (Object.is(next, previous)) {
        return;
      }
      queuedByThreadRef.current = next;
      setQueuedByThreadState(next);
      if (isSharedSession) {
        const affectedThreadIds = new Set([
          ...Object.keys(previous),
          ...Object.keys(next),
        ]);
        for (const threadId of affectedThreadIds) {
          const previousQueue = previous[threadId];
          const nextQueue = next[threadId];
          if (Object.is(previousQueue, nextQueue)) {
            continue;
          }
          const owner = resolveSharedQueuePersistenceOwner(
            threadId,
            previousQueue,
            nextQueue,
          );
          if (owner) {
            writeSharedQueuedFollowUps(
              owner.workspaceId,
              owner.threadId,
              nextQueue ?? [],
            );
          }
        }
      }
    },
    [isSharedSession],
  );

  const recordDeliveryDecision = useCallback(
    (diagnostic: EngineMessageDeliveryDiagnostic) => {
      deliveryDiagnosticsRef.current = [
        ...deliveryDiagnosticsRef.current.slice(-(DELIVERY_DIAGNOSTIC_LIMIT - 1)),
        diagnostic,
      ];
    },
    [],
  );

  const activeQueue = useMemo(
    () => (activeThreadId ? (queuedByThread[activeThreadId] ?? []) : []),
    [activeThreadId, queuedByThread],
  );
  const activeFusion = useMemo(
    () => (activeThreadId ? (fusionByThread[activeThreadId] ?? null) : null),
    [activeThreadId, fusionByThread],
  );
  const activeQueuedHandoffBubble = useMemo(
    () =>
      activeThreadId ? (queuedHandoffByThread[activeThreadId] ?? null) : null,
    [activeThreadId, queuedHandoffByThread],
  );
  const activeFusingMessageId = activeFusion?.messageId ?? null;
  const activeFusionCapability = useMemo(() => {
    if (!activeThreadId || !activeTurnId) {
      return { sameRun: false, cutover: false };
    }
    const decision = decideEngineMessageDelivery({
      intent: "steer",
      engine: activeEngine,
      sessionId: activeThreadId,
      activeRunId: activeTurnId,
    });
    // capability 即准入：input.mid-turn=supported 的引擎（pi RPC steer、
    // dsh）原生支持 same-run steer，不要求 experimental steer 总开关；
    // compat-input 引擎（claude/codex cutover）仍走既有 steerEnabled 门。
    const steerAllowed =
      steerEnabled || decision.evidence.midTurnCapability === "supported";
    return {
      sameRun:
        steerAllowed &&
        decision.status !== "rejected" &&
        decision.route === "steer",
      cutover:
        decision.evidence.midTurnCapability === "compat-input" &&
        typeof interruptTurn === "function",
    };
  }, [activeEngine, activeThreadId, activeTurnId, interruptTurn, steerEnabled]);
  const fuseDisabledReasonKey = useMemo((): string | null => {
    if (!activeThreadId || !activeWorkspace) {
      return "chat.fuseDisabledNoSession";
    }
    if (activeQueue.length === 0) {
      return "chat.fuseDisabledEmptyQueue";
    }
    if (activeFusion) {
      return "chat.fuseDisabledAlreadyFusing";
    }
    if (isClaudePendingBootstrapThread) {
      return "chat.fuseDisabledBootstrap";
    }
    if (isContextCompacting) {
      return "chat.fuseDisabledCompacting";
    }
    if (!isProcessing) {
      return "chat.fuseDisabledNoActiveTurn";
    }
    if (isReviewing) {
      return "chat.fuseDisabledReviewing";
    }
    if (
      isSharedSession &&
      !isSharedFollowUpState(activeSharedSendState)
    ) {
      return activeSharedSendState === "recovery-required"
        ? "chat.fuseDisabledSharedRecovery"
        : "chat.fuseDisabledSharedNotReady";
    }
    if (!(activeFusionCapability.sameRun || activeFusionCapability.cutover)) {
      return "chat.fuseDisabledCapability";
    }
    return null;
  }, [
    activeFusion,
    activeQueue.length,
    activeThreadId,
    activeFusionCapability,
    activeWorkspace,
    activeSharedSendState,
    isClaudePendingBootstrapThread,
    isContextCompacting,
    isProcessing,
    isReviewing,
    isSharedSession,
  ]);
  const canFuseActiveQueue = fuseDisabledReasonKey === null;

  useEffect(() => {
    if (previousActiveThreadIdRef.current === activeThreadId) {
      return;
    }
    const oldThreadId = previousActiveThreadIdRef.current;
    const newThreadId = activeThreadId;
    previousActiveThreadIdRef.current = newThreadId;
    if (!oldThreadId || !newThreadId) {
      return;
    }
    const isClaudeSessionTransition =
      oldThreadId.startsWith("claude-pending-") && newThreadId.startsWith("claude:");
    // Optimistic codex threads rename from `codex-pending-*` to a bare
    // backend thread id (codex ids carry no engine prefix), so id shape alone
    // cannot distinguish the finalize rebind from the user manually switching
    // to another codex thread. Require the alias the finalize flow records
    // (onCodexPendingThreadFinalized -> rememberThreadAlias) to confirm that
    // newThreadId really is oldThreadId's finalized identity.
    const isCodexSessionTransition =
      oldThreadId.startsWith("codex-pending-") &&
      resolveCanonicalThreadId(oldThreadId) === newThreadId;
    if (!isClaudeSessionTransition && !isCodexSessionTransition) {
      return;
    }

    setQueuedByThread((prev) => {
      const pendingQueue = prev[oldThreadId] ?? [];
      if (pendingQueue.length < 1) {
        return prev;
      }
      const nextQueue = prev[newThreadId] ?? [];
      const next = {
        ...prev,
        [newThreadId]: [...pendingQueue, ...nextQueue],
      };
      delete next[oldThreadId];
      return next;
    });

    setInFlightByThread((prev) => {
      const pendingInFlight = prev[oldThreadId];
      if (pendingInFlight === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingInFlight;
      }
      delete next[oldThreadId];
      return next;
    });

    setHasStartedByThread((prev) => {
      const pendingStarted = prev[oldThreadId];
      if (pendingStarted === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingStarted;
      }
      delete next[oldThreadId];
      return next;
    });

    setQueuedHandoffByThread((prev) => {
      const pendingHandoff = prev[oldThreadId];
      if (pendingHandoff === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingHandoff;
      }
      delete next[oldThreadId];
      return next;
    });

    setFusionByThread((prev) => {
      const pendingFusion = prev[oldThreadId];
      if (pendingFusion === undefined) {
        return prev;
      }
      const next = { ...prev };
      if (next[newThreadId] === undefined) {
        next[newThreadId] = pendingFusion;
      }
      delete next[oldThreadId];
      return next;
    });
  }, [activeThreadId, resolveCanonicalThreadId, setQueuedByThread]);

  const buildQueuedMessage = useCallback(
    (
      text: string,
      images: string[] = [],
      options?: MessageSendOptions,
    ): QueuedMessage => {
      let sharedExecutionTarget: SharedQueuedExecutionTarget | undefined;
      let sharedPredecessorAttemptId: string | null | undefined;
      if (isSharedSession) {
        if (!activeWorkspace || !activeThreadId) {
          throw new Error("Shared follow-up 缺少 workspace/thread owner。");
        }
        const selectedTarget = getSharedTargetState(
          activeWorkspace.id,
          activeThreadId,
        ).selectedNextTarget;
        if (!isResolvedExecutionTarget(selectedTarget)) {
          throw new Error(
            "Shared follow-up Target 不完整，请重新选择 CLI、Provider 和 Model。",
          );
        }
        sharedExecutionTarget = cloneSharedExecutionTarget(selectedTarget);
        sharedPredecessorAttemptId = getSharedSendActiveAttemptId(
          activeWorkspace.id,
          activeThreadId,
        );
        if (
          isSharedFollowUpState(activeSharedSendState) &&
          !sharedPredecessorAttemptId
        ) {
          throw new Error(
            "Shared follow-up 缺少 durable predecessor Attempt，已拒绝入队。",
          );
        }
      }
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        createdAt: Date.now(),
        images: [...images],
        sendOptions:
          options === undefined ? undefined : structuredClone(options),
        sharedExecutionTarget,
        sharedPredecessorAttemptId,
        ownerWorkspaceId: activeWorkspace?.id,
        ownerThreadId: activeThreadId ?? undefined,
      };
    },
    [activeSharedSendState, activeThreadId, activeWorkspace, isSharedSession],
  );

  const enqueueMessage = useCallback(
    (threadId: string, item: QueuedMessage) => {
      setQueuedByThread((prev) => ({
        ...prev,
        [threadId]: [...(prev[threadId] ?? []), item],
      }));
    },
    [setQueuedByThread],
  );

  const removeQueuedMessage = useCallback(
    async (
      threadId: string,
      messageId: string,
      options?: { confirmedPendingAck?: boolean },
    ): Promise<boolean> => {
      const queuedItem = (queuedByThreadRef.current[threadId] ?? []).find(
        (entry) => entry.id === messageId,
      );
      if (!queuedItem) {
        return false;
      }
      if (queuedItem.sharedDispatchState === "pending-ack") {
        if (!options?.confirmedPendingAck) {
          return false;
        }
        const ownerWorkspaceId = queuedItem.ownerWorkspaceId?.trim();
        if (!ownerWorkspaceId || queuedItem.ownerThreadId !== threadId) {
          return false;
        }
        let owner;
        try {
          owner = await resolveSharedRecoveryOwner(ownerWorkspaceId, threadId);
          if (owner.kind === "ambiguous") {
            return false;
          }
          invalidateRecoveryOwnerPrefetch(ownerWorkspaceId, threadId);
          if (owner.kind === "attempt") {
            const abandonResult = await sharedSessionV2AbandonUnresolvedAttempt(
              ownerWorkspaceId,
              threadId,
              { attemptId: owner.attemptId, forceStop: true },
            );
            if (abandonResult.status === "clear") {
              dispatchSharedSendEvent(ownerWorkspaceId, threadId, {
                type: "probeNotAccepted",
              });
            } else {
              dispatchSharedSendEvent(ownerWorkspaceId, threadId, {
                type: "commitCancelled",
              });
            }
          } else {
            // StatusBar 的既有约定：不存在未决 attempt 时以 durable state 解锁。
            dispatchSharedSendEvent(ownerWorkspaceId, threadId, {
              type: "probeNotAccepted",
            });
          }
          dispatchSharedSendEvent(ownerWorkspaceId, threadId, {
            type: "canonicalCommitted",
          });
        } catch {
          return false;
        }
        queuedAfterTerminalPulseRef.current.delete(messageId);
        queuedAfterSharedRevisionRef.current.delete(messageId);
        setInFlightByThread((prev) =>
          prev[threadId]?.id === messageId
            ? { ...prev, [threadId]: null }
            : prev,
        );
        setQueuedByThread((prev) => ({
          ...prev,
          [threadId]: (prev[threadId] ?? []).filter(
            (entry) => entry.id !== messageId,
          ),
        }));
        return true;
      }
      if (inFlightByThread[threadId]?.id === messageId) {
        return false;
      }
      queuedAfterTerminalPulseRef.current.delete(messageId);
      queuedAfterSharedRevisionRef.current.delete(messageId);
      setQueuedByThread((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] ?? []).filter(
          (entry) => entry.id !== messageId,
        ),
      }));
      return true;
    },
    [inFlightByThread, setQueuedByThread],
  );

  const insertQueuedMessageAt = useCallback(
    (threadId: string, item: QueuedMessage, index: number) => {
      setQueuedByThread((prev) => {
        const threadQueue = [...(prev[threadId] ?? [])];
        const boundedIndex = Math.max(0, Math.min(index, threadQueue.length));
        threadQueue.splice(boundedIndex, 0, item);
        return {
          ...prev,
          [threadId]: threadQueue,
        };
      });
    },
    [setQueuedByThread],
  );

  const prependQueuedMessage = useCallback(
    (threadId: string, item: QueuedMessage) => {
      insertQueuedMessageAt(threadId, item, 0);
    },
    [insertQueuedMessageAt],
  );

  const replaceQueuedMessage = useCallback(
    (threadId: string, item: QueuedMessage) => {
      setQueuedByThread((prev) => ({
        ...prev,
        [threadId]: (prev[threadId] ?? []).map((entry) =>
          entry.id === item.id ? item : entry,
        ),
      }));
    },
    [setQueuedByThread],
  );

  const withCodexCollaborationMode = useCallback(
    (options?: MessageSendOptions): MessageSendOptions | undefined => {
      if (activeEngine !== "codex") {
        return options;
      }
      const existingPayload = options?.collaborationMode;
      const existingModeRaw =
        existingPayload &&
          typeof existingPayload === "object" &&
          !Array.isArray(existingPayload)
          ? (existingPayload as Record<string, unknown>).mode
          : null;
      const existingMode = typeof existingModeRaw === "string"
        ? existingModeRaw.trim().toLowerCase()
        : null;
      if (existingMode === "plan" || existingMode === "code" || existingMode === "default") {
        return options;
      }
      const currentPayload = getCodexCollaborationPayload?.();
      if (
        currentPayload &&
        typeof currentPayload === "object" &&
        !Array.isArray(currentPayload)
      ) {
        return {
          ...(options ?? {}),
          collaborationMode: { ...currentPayload },
        };
      }
      const currentMode = getCodexCollaborationMode?.();
      if (currentMode !== "plan" && currentMode !== "code") {
        return options;
      }
      return {
        ...(options ?? {}),
        collaborationMode: {
          mode: currentMode,
          settings: {},
        },
      };
    },
    [
      activeEngine,
      getCodexCollaborationMode,
      getCodexCollaborationPayload,
    ],
  );

  const runSlashCommand = useCallback(
    async (
      command: SlashCommandKind,
      trimmed: string,
      options?: MessageSendOptions,
    ): Promise<boolean> => {
      if (
        (command === "plan" || command === "defaultMode" || command === "code") &&
        activeEngine === "codex" &&
        setCodexCollaborationMode
      ) {
        const targetMode = command === "plan" ? "plan" : "code";
        setCodexCollaborationMode(targetMode);
        const rest = trimmed
          .replace(/^\/(?:plan|default|code)\b/i, "")
          .trim();
        if (rest) {
          const modeOverrideOptions: MessageSendOptions = {
            ...(options ?? {}),
            collaborationMode: {
              mode: targetMode,
              settings: {},
            },
          };
          if (options) {
            await sendUserMessage(rest, [], modeOverrideOptions);
          } else {
            await sendUserMessage(rest, [], modeOverrideOptions);
          }
        }
        return true;
      }
      if (command === "mode" && activeEngine === "codex") {
        await startMode(trimmed);
        return true;
      }
      if (command === "fast" && activeEngine === "codex") {
        await startFast(trimmed);
        return true;
      }
      if (command === "fork") {
        await startFork(trimmed, withCodexCollaborationMode(options));
        return true;
      }
      if (command === "review") {
        await startReview(trimmed);
        return true;
      }
      if (command === "resume") {
        await startResume(trimmed);
        return true;
      }
      if (command === "mcp") {
        await startMcp(trimmed);
        return true;
      }
      if (command === "specRoot") {
        await startSpecRoot(trimmed);
        return true;
      }
      if (command === "status") {
        await startStatus(trimmed);
        return true;
      }
      if (command === "context") {
        await startContext(trimmed);
        return true;
      }
      if (command === "export") {
        await startExport(trimmed);
        return true;
      }
      if (command === "import") {
        await startImport(trimmed);
        return true;
      }
      if (command === "lsp") {
        await startLsp(trimmed);
        return true;
      }
      if (command === "share") {
        await startShare(trimmed);
        return true;
      }
      if (command === "compact") {
        await startCompact(trimmed);
        return true;
      }
      if (command === "clear" && activeWorkspace) {
        const threadId = await startThreadForWorkspace(activeWorkspace.id, { engine: activeEngine });
        const rest = trimmed.replace(/^\/(?:clear|reset)\b/i, "").trim();
        const effectiveOptions = withCodexCollaborationMode(options);
        if (threadId && rest) {
          if (effectiveOptions) {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, [], effectiveOptions);
          } else {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, []);
          }
        }
        return true;
      }
      if (command === "new" && activeWorkspace) {
        const threadId = await startThreadForWorkspace(activeWorkspace.id, { engine: activeEngine });
        const rest = trimmed.replace(/^\/new\b/i, "").trim();
        const effectiveOptions = withCodexCollaborationMode(options);
        if (threadId && rest) {
          if (effectiveOptions) {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, [], effectiveOptions);
          } else {
            await sendUserMessageToThread(activeWorkspace, threadId, rest, []);
          }
        }
        return true;
      }
      return false;
    },
    [
      activeWorkspace,
      activeEngine,
      setCodexCollaborationMode,
      sendUserMessage,
      sendUserMessageToThread,
      startFork,
      startReview,
      startResume,
      startMcp,
      startSpecRoot,
      startStatus,
      startContext,
      startExport,
      startImport,
      startLsp,
      startShare,
      startCompact,
      startFast,
      startMode,
      startThreadForWorkspace,
      withCodexCollaborationMode,
    ],
  );

  const dispatchQueuedMessage = useCallback(
    async (
      item: QueuedMessage,
      options?: {
        targetThreadId?: string | null;
        targetWorkspace?: WorkspaceInfo | null;
        /** When true, never fall back to active-bound sendUserMessage. */
        requireThreadTarget?: boolean;
      },
    ): Promise<QueuedDispatchResult> => {
      const trimmed = item.text.trim();
      // Explicit drain target wins; otherwise fall back to item owner / active.
      const explicitTargetThreadId = options?.targetThreadId?.trim() || null;
      const ownerThreadId =
        explicitTargetThreadId ||
        item.ownerThreadId?.trim() ||
        activeThreadId?.trim() ||
        "";
      const ownerWorkspace =
        options?.targetWorkspace ??
        (item.ownerWorkspaceId
          ? resolveWorkspace?.(item.ownerWorkspaceId) ?? null
          : null) ??
        (item.ownerWorkspaceId &&
        activeWorkspace &&
        activeWorkspace.id === item.ownerWorkspaceId
          ? activeWorkspace
          : null) ??
        (ownerThreadId === activeThreadId || !explicitTargetThreadId
          ? activeWorkspace
          : null);

      const command = parseSlashCommand(trimmed);
      const commandEnabled = canExecuteSlashCommand(
        command,
        activeEngine,
        ownerThreadId || activeThreadId,
      );
      if (ownerWorkspace && !ownerWorkspace.connected) {
        await connectWorkspace(ownerWorkspace);
      } else if (
        activeWorkspace &&
        !activeWorkspace.connected &&
        (!ownerThreadId || ownerThreadId === activeThreadId)
      ) {
        await connectWorkspace(activeWorkspace);
      }
      // Slash / mode only when targeting active (or no explicit foreign target).
      const targetsActive =
        !ownerThreadId || ownerThreadId === activeThreadId;
      if (commandEnabled && command && targetsActive) {
        const handled = await runSlashCommand(command, trimmed, item.sendOptions);
        if (handled) {
          return "dispatched";
        }
      }
      const implicitModeQuery =
        activeEngine === "codex" &&
        !command &&
        (item.images?.length ?? 0) === 0 &&
        isImplicitModeQuery(trimmed);
      if (implicitModeQuery && targetsActive) {
        await startMode(trimmed);
        return "dispatched";
      }
      const frozenTargetOptions = item.sharedExecutionTarget
        ? {
            ...(item.sendOptions ?? {}),
            sharedExecutionTarget: item.sharedExecutionTarget,
          }
        : item.sendOptions;
      const effectiveOptions = withCodexCollaborationMode(frozenTargetOptions);
      const isBackgroundTarget =
        options?.requireThreadTarget === true ||
        Boolean(explicitTargetThreadId && explicitTargetThreadId !== activeThreadId);
      const ownerIsShared =
        ownerThreadId.startsWith("shared:") ||
        (isSharedSession &&
          (!explicitTargetThreadId || explicitTargetThreadId === activeThreadId));
      // Preserve historical active handleSend path:
      // - Shared always thread-send
      // - Codex thread-send only when drain passes explicit targetThreadId
      // - Background always thread-send (never active sendUserMessage)
      const shouldUseDirectThreadSend =
        Boolean(ownerWorkspace && ownerThreadId) &&
        (isBackgroundTarget ||
          isSharedSession ||
          ownerIsShared ||
          (activeEngine === "codex" && Boolean(explicitTargetThreadId)));

      if (shouldUseDirectThreadSend && ownerWorkspace && ownerThreadId) {
        const response = await sendUserMessageToThread(
          ownerWorkspace,
          ownerThreadId,
          trimmed,
          item.images ?? [],
          effectiveOptions,
        );
        // 仅 owner 为 Shared 时走 V2 classify；禁止用 active 的 isSharedSession
        // 污染后台 native/codex 响应（否则 ambiguous → 回队 → 重发）。
        return ownerIsShared
          ? classifySharedDispatchResult(response, item.sharedExecutionTarget)
          : "dispatched";
      }

      if (isBackgroundTarget) {
        // 不串线：后台/非 active 禁止落到 active sendUserMessage。
        return "blocked";
      }

      if (effectiveOptions) {
        await sendUserMessage(trimmed, item.images ?? [], effectiveOptions);
      } else {
        await sendUserMessage(trimmed, item.images ?? []);
      }
      return "dispatched";
    },
    [
      activeEngine,
      activeThreadId,
      activeWorkspace,
      connectWorkspace,
      isSharedSession,
      resolveWorkspace,
      runSlashCommand,
      sendUserMessage,
      sendUserMessageToThread,
      startMode,
      withCodexCollaborationMode,
    ],
  );

  const handleSend = useCallback(
    async (
      text: string,
      images: string[] = [],
      options?: MessageSendOptions,
    ) => {
      const trimmed = text.trim();
      const command = parseSlashCommand(trimmed);
      const commandEnabled = canExecuteSlashCommand(
        command,
        activeEngine,
        activeThreadId,
      );
      const nextImages = commandEnabled ? [] : images;
      if (!trimmed && nextImages.length === 0) {
        return;
      }
      if (activeThreadId && isReviewing) {
        return;
      }
      const shouldQueueSharedFollowUp =
        isSharedSession && isSharedFollowUpState(activeSharedSendState);
      const shouldQueueSharedCompaction =
        isSharedSession && isContextCompacting;
      if (
        isSharedSession &&
        activeSharedSendState !== "idle" &&
        !shouldQueueSharedFollowUp
      ) {
        return;
      }
      const shouldQueueWhileProcessing =
        isProcessing && (!steerEnabled || isClaudePendingBootstrapThread);
      const deliveryRequest = {
        intent: isProcessing && steerEnabled ? "steer" : "prompt",
        engine: activeEngine,
        sessionId: activeThreadId,
        activeRunId: isProcessing ? (activeTurnId ?? null) : null,
        allowFollowUpFallback: true,
      } as const;
      const deliveryResult = decideEngineMessageDelivery(deliveryRequest);
      recordDeliveryDecision(
        createEngineMessageDeliveryDiagnostic(deliveryRequest, deliveryResult),
      );
      // A pending AskUserQuestion also holds the queue: the turn is alive but
      // blocked on the answer, so a fresh send must queue rather than dispatch.
      if (
        activeThreadId &&
        (shouldQueueSharedFollowUp ||
          shouldQueueSharedCompaction ||
          shouldQueueWhileProcessing ||
          hasPendingUserInput ||
          (deliveryResult.status === "degraded" &&
            deliveryResult.route === "queue") ||
          (deliveryResult.status === "accepted" && deliveryResult.route === "queue"))
      ) {
        // Shared durable queue only accepts user prompts. Local slash commands
        // have no canonical V2 commit ACK and would otherwise execute once while
        // leaving a permanent pending-ack item behind.
        if (isSharedSession && command) {
          return;
        }
        const item = buildQueuedMessage(trimmed, nextImages, options);
        if (isProcessing && activeTurnId) {
          queuedAfterTerminalPulseRef.current.set(item.id, activeTerminalPulse);
        }
        enqueueMessage(activeThreadId, item);
        clearActiveImages();
        return;
      }
      if (deliveryResult.status === "rejected") {
        throw new Error(`Message delivery rejected: ${deliveryResult.reason}`);
      }
      await dispatchQueuedMessage(buildQueuedMessage(trimmed, nextImages, options));
      clearActiveImages();
    },
    [
      activeEngine,
      activeSharedSendState,
      activeThreadId,
      activeTerminalPulse,
      activeTurnId,
      buildQueuedMessage,
      clearActiveImages,
      dispatchQueuedMessage,
      enqueueMessage,
      hasPendingUserInput,
      isClaudePendingBootstrapThread,
      isContextCompacting,
      isProcessing,
      isReviewing,
      isSharedSession,
      recordDeliveryDecision,
      steerEnabled,
    ],
  );

  const queueMessage = useCallback(
    async (
      text: string,
      images: string[] = [],
      options?: MessageSendOptions,
    ) => {
      const trimmed = text.trim();
      const command = parseSlashCommand(trimmed);
      const commandEnabled = canExecuteSlashCommand(
        command,
        activeEngine,
        activeThreadId,
      );
      const nextImages = commandEnabled ? [] : images;
      if (!trimmed && nextImages.length === 0) {
        return;
      }
      if (activeThreadId && isReviewing) {
        return;
      }
      if (!activeThreadId) {
        return;
      }
      if (
        isSharedSession &&
        !isSharedFollowUpState(activeSharedSendState) &&
        !(activeSharedSendState === "idle" && isContextCompacting)
      ) {
        return;
      }
      if (isSharedSession && command) {
        return;
      }
      const item = buildQueuedMessage(trimmed, nextImages, options);
      if (isProcessing && activeTurnId) {
        queuedAfterTerminalPulseRef.current.set(item.id, activeTerminalPulse);
      }
      enqueueMessage(activeThreadId, item);
      clearActiveImages();
    },
    [
      activeEngine,
      activeSharedSendState,
      activeThreadId,
      activeTerminalPulse,
      activeTurnId,
      buildQueuedMessage,
      clearActiveImages,
      enqueueMessage,
      isProcessing,
      isReviewing,
      isContextCompacting,
      isSharedSession,
    ],
  );

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
    const handoffBubble = queuedHandoffByThread[activeThreadId];
    if (!handoffBubble) {
      return;
    }
    const timer = window.setTimeout(() => {
      setQueuedHandoffByThread((prev) => {
        const current = prev[activeThreadId];
        if (!current || current.id !== handoffBubble.id) {
          return prev;
        }
        return {
          ...prev,
          [activeThreadId]: null,
        };
      });
    }, QUEUED_HANDOFF_BUBBLE_TTL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeThreadId, queuedHandoffByThread]);

  /**
   * 每帧从「当前 props」抽出 signal 字符串（O(有队列会话数)）。
   * effect 只依赖该字符串：无关会话 heartbeat 换 threadStatusById 引用但
   * 相关 p/t 不变 → 字符串相同 → effect 不跑。
   * 不再把 threadStatusById 对象放进 useMemo deps（避免无意义重算链）。
   */
  const queueDrainSignal = buildQueueDrainSignal({
    queuedByThread,
    inFlightByThread,
    activeThreadId,
    threadStatusById,
    isProcessing,
    isReviewing,
    isContextCompacting,
    activeTerminalPulse,
    hasPendingUserInput,
    backgroundEnabled:
      getEnableBackgroundQueueDrain() && queueDrainReleased,
  });

  useEffect(() => {
    // 启动门未放行 / 刚有点击：跳过 settlement 写状态（让出主线程）
    if (!queueDrainReleasedRef.current || hadRecentInteractiveInput(300)) {
      return;
    }
    // Per-thread inFlight settlement（只用 ref 记 hasStarted，deps 不含 hasStarted state）。
    const statusMap = threadStatusByIdRef.current;
    let nextInFlight: Record<string, QueuedMessage | null> | null = null;
    let touchHasStartedState = false;
    const now = Date.now();
    for (const [threadId, inFlight] of Object.entries(inFlightByThread)) {
      if (!inFlight) {
        continue;
      }
      if (threadId.startsWith("shared:")) {
        continue;
      }
      if (isSharedSession && threadId === activeThreadId) {
        continue;
      }
      const status = statusMap?.[threadId];
      const processing =
        typeof status?.isProcessing === "boolean"
          ? status.isProcessing
          : threadId === activeThreadId
            ? isProcessingRef.current
            : false;
      const reviewing =
        typeof status?.isReviewing === "boolean"
          ? status.isReviewing
          : threadId === activeThreadId
            ? isReviewingRef.current
            : false;
      if (processing || reviewing) {
        if (!hasStartedByThreadRef.current[threadId]) {
          hasStartedByThreadRef.current[threadId] = true;
          touchHasStartedState = true;
        }
        continue;
      }
      const started = hasStartedByThreadRef.current[threadId] === true;
      const since = nativeInFlightSinceRef.current[threadId] ?? 0;
      const completed = completedQueueDispatchIdsRef.current.has(inFlight.id);
      const timedOut =
        completed &&
        since > 0 &&
        now - since >= NATIVE_INFLIGHT_SETTLE_FALLBACK_MS;
      if (started || timedOut) {
        hasStartedByThreadRef.current[threadId] = false;
        delete nativeInFlightSinceRef.current[threadId];
        nextInFlight = {
          ...(nextInFlight ?? inFlightByThread),
          [threadId]: null,
        };
        touchHasStartedState = true;
      }
    }
    if (nextInFlight) {
      setInFlightByThread(nextInFlight);
    }
    // 批量同步 opencode stall 用的 state，避免 settlement deps 含 hasStarted 自激。
    if (touchHasStartedState) {
      setHasStartedByThread({ ...hasStartedByThreadRef.current });
    }
  }, [
    activeThreadId,
    inFlightByThread,
    isSharedSession,
    queueDrainSignal,
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

  useEffect(() => {
    if (activeEngine !== "opencode") {
      return;
    }
    if (!activeThreadId || isProcessing || isReviewing) {
      return;
    }
    const inFlight = inFlightByThread[activeThreadId];
    if (!inFlight) {
      return;
    }
    if (hasStartedByThread[activeThreadId]) {
      return;
    }
    const timer = window.setTimeout(() => {
      setInFlightByThread((prev) => {
        const current = prev[activeThreadId];
        if (!current || current.id !== inFlight.id) {
          return prev;
        }
        return { ...prev, [activeThreadId]: null };
      });
      setHasStartedByThread((prev) => ({ ...prev, [activeThreadId]: false }));
      // stall 重试允许再发：撤掉 completed 标记与 terminal 闸门。
      completedQueueDispatchIdsRef.current.delete(inFlight.id);
      queuedAfterTerminalPulseRef.current.delete(inFlight.id);
      delete nativeInFlightSinceRef.current[activeThreadId];
      hasStartedByThreadRef.current[activeThreadId] = false;
      prependQueuedMessage(activeThreadId, inFlight);
    }, OPENCODE_INFLIGHT_STALL_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    activeEngine,
    activeThreadId,
    hasStartedByThread,
    inFlightByThread,
    isProcessing,
    isReviewing,
    prependQueuedMessage,
  ]);

  // Codex handoff: clear state once real user bubble is visible (not only skip-append).
  // 用长度+末 id 信号代替 activeItems 全表依赖，避免流式每 delta 都跑 effect。
  const activeItemsRef = useRef(activeItems);
  activeItemsRef.current = activeItems;
  const activeItemsTailSignal = `${activeItems.length}:${
    activeItems[activeItems.length - 1]?.id ?? ""
  }`;
  useEffect(() => {
    if (!activeThreadId) {
      return;
    }
    const handoff = queuedHandoffByThread[activeThreadId];
    if (!handoff) {
      return;
    }
    const hasMatch = activeItemsRef.current.some((item) =>
      doesConversationItemMatchUserBubble(item, handoff),
    );
    if (!hasMatch) {
      return;
    }
    setQueuedHandoffByThread((prev) => {
      if (!prev[activeThreadId]) {
        return prev;
      }
      return { ...prev, [activeThreadId]: null };
    });
  }, [activeItemsTailSignal, activeThreadId, queuedHandoffByThread]);

  useEffect(() => {
    // 启动门未放行：禁止 auto-drain（用户显式 handleSend/queueMessage 仍可用）
    if (!queueDrainReleasedRef.current) {
      return;
    }
    // 刚有点击：让出一帧级调度，不和 hit-test 硬撞
    if (hadRecentInteractiveInput(300)) {
      return;
    }
    const readThreadProcessing = (threadId: string): boolean => {
      const status = threadStatusByIdRef.current?.[threadId];
      if (status && typeof status.isProcessing === "boolean") {
        return status.isProcessing;
      }
      if (threadId === activeThreadId) {
        return isProcessingRef.current;
      }
      // Missing non-active status → hold (do not blind-fire).
      return true;
    };
    const readThreadReviewing = (threadId: string): boolean => {
      const status = threadStatusByIdRef.current?.[threadId];
      if (status && typeof status.isReviewing === "boolean") {
        return status.isReviewing;
      }
      return threadId === activeThreadId ? isReviewingRef.current : false;
    };
    const readThreadCompacting = (threadId: string): boolean => {
      const status = threadStatusByIdRef.current?.[threadId];
      if (status && typeof status.isContextCompacting === "boolean") {
        return status.isContextCompacting;
      }
      return threadId === activeThreadId
        ? isContextCompactingRef.current
        : false;
    };
    const readTerminalPulse = (threadId: string): number => {
      const status = threadStatusByIdRef.current?.[threadId];
      if (status && typeof status.terminalPulse === "number") {
        return status.terminalPulse;
      }
      return threadId === activeThreadId ? activeTerminalPulseRef.current : 0;
    };
    const readPendingUserInput = (threadId: string): boolean =>
      threadId === activeThreadId ? hasPendingUserInputRef.current : false;

    const isThreadShared = (threadId: string): boolean =>
      threadId.startsWith("shared:") ||
      (isSharedSession && threadId === activeThreadId);

    const resolveOwnerWorkspace = (
      threadId: string,
      item: QueuedMessage,
    ): WorkspaceInfo | null => {
      if (!item.ownerWorkspaceId || item.ownerThreadId !== threadId) {
        return null;
      }
      const resolved = resolveWorkspace?.(item.ownerWorkspaceId) ?? null;
      if (resolved) {
        return resolved;
      }
      if (activeWorkspace?.id === item.ownerWorkspaceId) {
        return activeWorkspace;
      }
      return null;
    };

    const countBackgroundInFlight = (): number => {
      let count = 0;
      for (const [threadId, inflight] of Object.entries(inFlightByThread)) {
        if (!inflight) {
          continue;
        }
        if (threadId === activeThreadId) {
          continue;
        }
        count += 1;
      }
      return count;
    };

    const tryDrainThread = (threadId: string): boolean => {
      if (readThreadProcessing(threadId) || readThreadReviewing(threadId)) {
        return false;
      }
      if (readPendingUserInput(threadId)) {
        return false;
      }
      if (fusionByThread[threadId]) {
        return false;
      }
      if (inFlightByThread[threadId]) {
        return false;
      }
      const threadIsShared = isThreadShared(threadId);
      if (threadIsShared) {
        const ownerWsId = queuedByThread[threadId]?.[0]?.ownerWorkspaceId ?? "";
        if (!ownerWsId) {
          return false;
        }
        const sharedState = getSharedSendState(ownerWsId, threadId).state;
        if (sharedState !== "idle" || readThreadCompacting(threadId)) {
          return false;
        }
      }
      const queue = queuedByThread[threadId] ?? [];
      if (queue.length === 0) {
        return false;
      }
      const nextItem = queue[0];
      if (!nextItem || nextItem.sharedDispatchState === "pending-ack") {
        return false;
      }
      // 已成功发出过的 id：直接丢弃，绝不重发（截图「你在干啥呢」洪水根治）。
      if (completedQueueDispatchIdsRef.current.has(nextItem.id)) {
        setQueuedByThread((prev) => ({
          ...prev,
          [threadId]: (prev[threadId] ?? []).filter(
            (entry) => entry.id !== nextItem.id,
          ),
        }));
        return false;
      }
      const queueDispatchKey = `${threadId}:${nextItem.id}`;
      if (queueDispatchingRef.current.has(queueDispatchKey)) {
        return false;
      }
      const ownerWorkspace = resolveOwnerWorkspace(threadId, nextItem);
      const isBackground = threadId !== activeThreadId;
      if (!ownerWorkspace && (isBackground || threadIsShared)) {
        // 不串线：无 owner 禁止 drain 到 active。
        return false;
      }
      if (
        (isBackground || threadIsShared) &&
        nextItem.ownerThreadId &&
        nextItem.ownerThreadId !== threadId
      ) {
        return false;
      }

      const blockedAtSharedRevision =
        queuedAfterSharedRevisionRef.current.get(nextItem.id);
      if (
        threadIsShared &&
        ownerWorkspace &&
        blockedAtSharedRevision !== undefined &&
        getSharedSendStateRevision(ownerWorkspace.id, threadId) <=
          blockedAtSharedRevision
      ) {
        return false;
      }
      const predecessorTerminalPulse =
        queuedAfterTerminalPulseRef.current.get(nextItem.id);
      const threadTerminalPulse = readTerminalPulse(threadId);
      if (
        !threadIsShared &&
        predecessorTerminalPulse !== undefined &&
        threadTerminalPulse <= predecessorTerminalPulse
      ) {
        return false;
      }

      const nextTrimmedText = nextItem.text.trim();
      const shouldCreateHandoffBubble =
        !threadIsShared &&
        activeEngine === "codex" &&
        !parseSlashCommand(nextTrimmedText) &&
        !(
          (nextItem.images?.length ?? 0) === 0 &&
          isImplicitModeQuery(nextTrimmedText)
        );

      // P0: optimistic dequeue for native (single owner). Shared keeps pending-ack in strip.
      if (!threadIsShared) {
        setQueuedByThread((prev) => ({
          ...prev,
          [threadId]: (prev[threadId] ?? []).filter(
            (entry) => entry.id !== nextItem.id,
          ),
        }));
      }
      if (shouldCreateHandoffBubble) {
        setQueuedHandoffByThread((prev) => ({
          ...prev,
          [threadId]: buildQueuedHandoffBubbleItem(nextItem),
        }));
      }
      const dispatchItem: QueuedMessage = threadIsShared
        ? {
            ...nextItem,
            sharedDispatchState: "pending-ack",
            ownerThreadId: nextItem.ownerThreadId ?? threadId,
            ownerWorkspaceId:
              nextItem.ownerWorkspaceId ?? ownerWorkspace?.id,
          }
        : {
            ...nextItem,
            ownerThreadId: nextItem.ownerThreadId ?? threadId,
            ownerWorkspaceId:
              nextItem.ownerWorkspaceId ?? ownerWorkspace?.id,
          };
      if (threadIsShared) {
        replaceQueuedMessage(threadId, dispatchItem);
      }
      setInFlightByThread((prev) => ({ ...prev, [threadId]: dispatchItem }));
      hasStartedByThreadRef.current[threadId] = false;
      setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
      delete nativeInFlightSinceRef.current[threadId];
      // 注意：失败回队后靠 terminal-pulse 闸门；成功后才清除。
      // 禁止在 dispatch 前 delete pulse，否则 fail/catch 回队会立刻无闸重发。
      queueDispatchingRef.current.add(queueDispatchKey);

      void (async () => {
        const blockFurtherAutoDrain = () => {
          // 用当前 pulse 卡住自动重试；需新的 terminal 边沿才允许再试。
          const pulseNow =
            threadStatusByIdRef.current?.[threadId]?.terminalPulse ??
            (threadId === activeThreadId
              ? activeTerminalPulseRef.current
              : threadTerminalPulse);
          queuedAfterTerminalPulseRef.current.set(
            nextItem.id,
            Math.max(threadTerminalPulse, pulseNow),
          );
        };
        try {
          const dispatchResult = await dispatchQueuedMessage(dispatchItem, {
            targetThreadId: threadId,
            targetWorkspace: ownerWorkspace,
            requireThreadTarget:
              isBackground || threadIsShared || activeEngine === "codex",
          });
          const dispatchAccepted =
            dispatchResult === "committed" ||
            (!threadIsShared && dispatchResult === "dispatched");
          if (dispatchAccepted) {
            // 成功：永远记 completed，禁止同 id 再发（防「你在干啥呢」洪水）。
            completedQueueDispatchIdsRef.current.add(nextItem.id);
            queuedAfterTerminalPulseRef.current.delete(nextItem.id);
            queuedAfterSharedRevisionRef.current.delete(nextItem.id);
            setQueuedByThread((prev) => ({
              ...prev,
              [threadId]: (prev[threadId] ?? []).filter(
                (entry) => entry.id !== nextItem.id,
              ),
            }));
            if (threadIsShared) {
              // Shared：V2 commit 已确认，立刻清 inFlight。
              delete nativeInFlightSinceRef.current[threadId];
              hasStartedByThreadRef.current[threadId] = false;
              setInFlightByThread((prev) => ({ ...prev, [threadId]: null }));
              setHasStartedByThread((prev) => ({
                ...prev,
                [threadId]: false,
              }));
            } else {
              // Native：保留 inFlight 防同线程连发；记录时间供 settlement 超时兜底。
              const acceptedItemId = nextItem.id;
              nativeInFlightSinceRef.current[threadId] = Date.now();
              const statusNow = threadStatusByIdRef.current?.[threadId];
              const alreadyProcessing =
                typeof statusNow?.isProcessing === "boolean"
                  ? statusNow.isProcessing
                  : threadId === activeThreadId
                    ? isProcessingRef.current
                    : false;
              if (alreadyProcessing) {
                hasStartedByThreadRef.current[threadId] = true;
                setHasStartedByThread((prev) => ({
                  ...prev,
                  [threadId]: true,
                }));
              }
              // processing 边沿丢失时：超时清 inFlight（completed 已记，不会重发同 id）。
              window.setTimeout(() => {
                setInFlightByThread((prev) => {
                  const current = prev[threadId];
                  if (!current || current.id !== acceptedItemId) {
                    return prev;
                  }
                  if (
                    !completedQueueDispatchIdsRef.current.has(acceptedItemId)
                  ) {
                    return prev;
                  }
                  const status = threadStatusByIdRef.current?.[threadId];
                  const stillProcessing =
                    typeof status?.isProcessing === "boolean"
                      ? status.isProcessing
                      : threadId === activeThreadId
                        ? isProcessingRef.current
                        : false;
                  if (stillProcessing) {
                    return prev;
                  }
                  delete nativeInFlightSinceRef.current[threadId];
                  hasStartedByThreadRef.current[threadId] = false;
                  return { ...prev, [threadId]: null };
                });
              }, NATIVE_INFLIGHT_SETTLE_FALLBACK_MS);
            }
            return;
          }
          // Restore queue on failure (native was optimistically removed).
          if (!threadIsShared) {
            prependQueuedMessage(threadId, {
              ...nextItem,
              sharedDispatchState: undefined,
            });
            blockFurtherAutoDrain();
          }
          if (threadIsShared && dispatchResult === "blocked") {
            replaceQueuedMessage(threadId, {
              ...dispatchItem,
              sharedDispatchState: undefined,
            });
            if (ownerWorkspace) {
              queuedAfterSharedRevisionRef.current.set(
                nextItem.id,
                getSharedSendStateRevision(ownerWorkspace.id, threadId),
              );
            }
          }
          // Shared ambiguous：保持 pending-ack，禁止自动重放（原契约）。
          delete nativeInFlightSinceRef.current[threadId];
          hasStartedByThreadRef.current[threadId] = false;
          setInFlightByThread((prev) => ({ ...prev, [threadId]: null }));
          setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
          setQueuedHandoffByThread((prev) => ({ ...prev, [threadId]: null }));
        } catch {
          if (!threadIsShared) {
            prependQueuedMessage(threadId, {
              ...nextItem,
              sharedDispatchState: undefined,
            });
            // native catch 必须写闸门，否则会无间隔重发洪水。
            blockFurtherAutoDrain();
          }
          delete nativeInFlightSinceRef.current[threadId];
          hasStartedByThreadRef.current[threadId] = false;
          setInFlightByThread((prev) => ({ ...prev, [threadId]: null }));
          setHasStartedByThread((prev) => ({ ...prev, [threadId]: false }));
          setQueuedHandoffByThread((prev) => ({ ...prev, [threadId]: null }));
        } finally {
          queueDispatchingRef.current.delete(queueDispatchKey);
        }
      })();
      return true;
    };

    const candidateThreadIds = new Set<string>();
    for (const threadId of Object.keys(queuedByThread)) {
      if ((queuedByThread[threadId] ?? []).length > 0) {
        candidateThreadIds.add(threadId);
      }
    }
    if (activeThreadId) {
      candidateThreadIds.add(activeThreadId);
    }

    const ordered = [...candidateThreadIds].sort((a, b) => {
      if (a === activeThreadId) {
        return -1;
      }
      if (b === activeThreadId) {
        return 1;
      }
      return a.localeCompare(b);
    });

    let backgroundStarted = 0;
    const backgroundInFlight = countBackgroundInFlight();

    for (const threadId of ordered) {
      const isActive = threadId === activeThreadId;
      if (!isActive && !getEnableBackgroundQueueDrain()) {
        continue;
      }
      if (
        !isActive &&
        backgroundInFlight + backgroundStarted >= MAX_BACKGROUND_QUEUE_DRAIN
      ) {
        continue;
      }
      const started = tryDrainThread(threadId);
      if (started && !isActive) {
        backgroundStarted += 1;
      }
    }
  }, [
    activeEngine,
    activeThreadId,
    activeWorkspace,
    dispatchQueuedMessage,
    fusionByThread,
    // queueDrainSignal 已覆盖：queued/inFlight 长度与 id、各相关 thread 的
    // processing/terminal、active pending、bg 闸。禁止再依赖整表 threadStatusById。
    queueDrainSignal,
    prependQueuedMessage,
    replaceQueuedMessage,
    resolveWorkspace,
    setQueuedByThread,
  ]);

  return {
    queuedByThread,
    activeQueue,
    activeQueuedHandoffBubble,
    handleSend,
    queueMessage,
    removeQueuedMessage,
    fuseQueuedMessage,
    canFuseActiveQueue,
    fuseDisabledReasonKey,
    activeFusingMessageId,
  };
}
