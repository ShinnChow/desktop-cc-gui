import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  ConversationItem,
  EngineType,
  QueuedMessage,
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
  getSharedSendState,
  getSharedSendStateRevision,
} from "../../shared-session/runtime/sharedSendStateStore";
import {
  buildQueuedHandoffBubbleItem,
  doesConversationItemMatchUserBubble,
  type QueuedHandoffBubble,
} from "../utils/queuedHandoffBubble";
import { readSharedQueuedFollowUps } from "../utils/sharedQueuedFollowUpStore";
import {
  MAX_BACKGROUND_QUEUE_DRAIN,
  NATIVE_INFLIGHT_SETTLE_FALLBACK_MS,
  OPENCODE_INFLIGHT_STALL_MS,
  QUEUED_HANDOFF_BUBBLE_TTL_MS,
  getEnableBackgroundQueueDrain,
  isImplicitModeQuery,
  parseSlashCommand,
  type QueueThreadStatusSnapshot,
  type ThreadFusionState,
} from "./queuedSendHelpers";
import type {
  QueuedMessageDispatcher,
  SetQueuedByThread,
} from "./useQueuedFusion";

type UseQueueDrainEffectsParams = {
  isVitest: boolean;
  queueDrainReleased: boolean;
  setQueueDrainReleased: Dispatch<SetStateAction<boolean>>;
  queuedByThread: Record<string, QueuedMessage[]>;
  queuedByThreadRef: MutableRefObject<Record<string, QueuedMessage[]>>;
  setQueuedByThreadState: Dispatch<
    SetStateAction<Record<string, QueuedMessage[]>>
  >;
  initialSharedQueueOwner: string | null;
  activeThreadId: string | null;
  activeWorkspace: WorkspaceInfo | null;
  isSharedSession: boolean;
  resolveCanonicalThreadId: (threadId: string) => string;
  setQueuedByThread: SetQueuedByThread;
  setInFlightByThread: Dispatch<
    SetStateAction<Record<string, QueuedMessage | null>>
  >;
  setQueuedHandoffByThread: Dispatch<
    SetStateAction<Record<string, QueuedHandoffBubble | null>>
  >;
  setFusionByThread: Dispatch<
    SetStateAction<Record<string, ThreadFusionState | null>>
  >;
  queuedHandoffByThread: Record<string, QueuedHandoffBubble | null>;
  queueDrainSignal: string;
  inFlightByThread: Record<string, QueuedMessage | null>;
  activeEngine: EngineType;
  isProcessing: boolean;
  isReviewing: boolean;
  isContextCompacting: boolean;
  activeTerminalPulse: number;
  hasPendingUserInput: boolean;
  threadStatusById: Record<string, QueueThreadStatusSnapshot | undefined> | undefined;
  activeItems: ConversationItem[];
  activeItemsTailSignal: string;
  fusionByThread: Record<string, ThreadFusionState | null>;
  dispatchQueuedMessage: QueuedMessageDispatcher;
  prependQueuedMessage: (threadId: string, item: QueuedMessage) => void;
  replaceQueuedMessage: (threadId: string, item: QueuedMessage) => void;
  resolveWorkspace?: (workspaceId: string) => WorkspaceInfo | null;
  queuedAfterTerminalPulseRef: MutableRefObject<Map<string, number>>;
  queuedAfterSharedRevisionRef: MutableRefObject<Map<string, number>>;
};

export function useQueueDrainEffects({
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
}: UseQueueDrainEffectsParams): void {
  const [hasStartedByThread, setHasStartedByThread] = useState<
    Record<string, boolean>
  >({});
  const previousActiveThreadIdRef = useRef<string | null>(activeThreadId);
  const hydratedSharedQueueOwnersRef = useRef(
    new Set(initialSharedQueueOwner ? [initialSharedQueueOwner] : []),
  );
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
  const queueDrainReleasedRef = useRef(queueDrainReleased);
  queueDrainReleasedRef.current = queueDrainReleased;
  const activeItemsRef = useRef(activeItems);
  activeItemsRef.current = activeItems;

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
}
