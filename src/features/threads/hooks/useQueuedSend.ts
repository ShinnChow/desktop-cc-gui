import { useCallback, useMemo, useRef, useState } from "react";
import type {
  ConversationItem,
  EngineType,
  MessageSendOptions,
  QueuedMessage,
  SharedQueuedExecutionTarget,
  WorkspaceInfo,
} from "../../../types";
import { getStartupTraceSnapshot } from "../../startup-orchestration/utils/startupTrace";
import { isStartupForceEntered } from "../../startup-orchestration/utils/startupForceEnter";
import {
  dispatchSharedSendEvent,
  getSharedSendActiveAttemptId,
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
import { useQueuedFusion } from "./useQueuedFusion";
import { useQueueDrainEffects } from "./useQueueDrainEffects";
import {
  buildQueueDrainSignal,
  canExecuteSlashCommand,
  classifySharedDispatchResult,
  cloneSharedExecutionTarget,
  getEnableBackgroundQueueDrain,
  isImplicitModeQuery,
  isSharedFollowUpState,
  parseSlashCommand,
  resolveSharedQueuePersistenceOwner,
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
  const [fusionByThread, setFusionByThread] = useState<
    Record<string, ThreadFusionState | null>
  >({});
  const queuedAfterTerminalPulseRef = useRef(new Map<string, number>());
  const queuedAfterSharedRevisionRef = useRef(new Map<string, number>());
  const deliveryDiagnosticsRef = useRef<EngineMessageDeliveryDiagnostic[]>([]);
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

  const { fuseQueuedMessage } = useQueuedFusion({
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
  });

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

  // Codex handoff: clear state once real user bubble is visible (not only skip-append).
  // 用长度+末 id 信号代替 activeItems 全表依赖，避免流式每 delta 都跑 effect。
  const activeItemsTailSignal = `${activeItems.length}:${
    activeItems[activeItems.length - 1]?.id ?? ""
  }`;
  useQueueDrainEffects({
    isVitest,
    queueDrainReleased,
    setQueueDrainReleased,
    queuedByThread,
    queuedByThreadRef,
    setQueuedByThreadState,
    initialSharedQueueOwner,
    activeThreadId,
    activeWorkspace,
    isSharedSession,
    resolveCanonicalThreadId,
    setQueuedByThread,
    setInFlightByThread,
    setQueuedHandoffByThread,
    setFusionByThread,
    queuedHandoffByThread,
    queueDrainSignal,
    inFlightByThread,
    activeEngine,
    isProcessing,
    isReviewing,
    isContextCompacting,
    activeTerminalPulse,
    hasPendingUserInput,
    threadStatusById,
    activeItems,
    activeItemsTailSignal,
    fusionByThread,
    dispatchQueuedMessage,
    prependQueuedMessage,
    replaceQueuedMessage,
    resolveWorkspace,
    queuedAfterTerminalPulseRef,
    queuedAfterSharedRevisionRef,
  });

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
