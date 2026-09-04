import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  workspaceScopedHas,
  type WorkspaceScopedMap,
} from "./workspaceScopedMap";
import type { Dispatch, MutableRefObject } from "react";
import { buildConversationItem } from "../../../utils/threadItems";
import { isCodexSubagentActivityItem } from "../utils/codexSubagentIdentity";
import type { NormalizedThreadEvent } from "../contracts/conversationCurtainContracts";
import { asString } from "../utils/threadNormalize";
import type { ConversationItem, DebugEntry } from "../../../types";
import type { ThreadAction } from "./useThreadsReducer";
import {
  isRealtimeBatchingEnabled,
  readStreamingScheduleTier,
} from "../utils/realtimePerfFlags";
import {
  resolveDispatchSubmitMode,
  type DispatchSubmitMode,
} from "../utils/renderSchedulingPolicy";
import {
  buildToolOutputKey,
  createToolOutputTailGate,
  type ToolOutputKey,
} from "./useToolOutputTailGate";
import {
  applyPendingClaudeMcpOutputNoticeToAgentCompleted,
  applyPendingClaudeMcpOutputNoticeToAgentDelta,
} from "../utils/claudeMcpRuntimeSnapshot";
import {
  appendLiveAssistantShadowDelta,
  settleLiveAssistantShadowTranscript,
  upsertLiveAssistantShadowSnapshot,
} from "../utils/liveAssistantShadowTranscript";
import {
  appendLiveAssistantText,
  clearLiveAssistantText,
  drainLiveAssistantTextTail,
  drainLiveAssistantTextTailIfItemChanged,
  resolveLiveAssistantSettlementText,
  updateLiveAssistantTextSnapshot,
} from "../utils/liveAssistantTextChannel";
import { getNativeTurnIngestMeta } from "../utils/nativeTurnTargetLedger";
import {
  clearLiveItemDeltaForItem,
  drainLiveItemDeltaTail,
  peekLiveItemDeltaEntry,
  type LiveItemDeltaLane,
} from "../utils/liveItemDeltaChannel";
import {
  isLiveDeltaExternalizationEnabled,
  isLiveTextExternalizationEnabled,
} from "../utils/realtimePerfFlags";
import {
  noteThreadReducerWorkMeasured,
} from "../utils/streamLatencyDiagnostics";
import {
  applyBackgroundTaskUpdate,
  noteBackgroundTaskStarted,
  setBackgroundTaskUpdateSink,
} from "../../messages/utils/backgroundTaskStore";
import { inferEngineFromLegacyThreadId } from "../contracts/engineRuntimeIdentity";
import {
  canProgressEventStartProcessing,
  createDebugPreview,
  isClaudeStreamDebugEnabled,
  isClaudeThread,
  inferItemEngineSource,
  isInterruptedThread,
  readHighResolutionNowMs,
  type ReasoningEngineHint,
} from "./threadItemEventPredicates";
export { canProgressEventStartProcessing } from "./threadItemEventPredicates";
import { useRealtimeDeltaQueue } from "./useRealtimeDeltaQueue";
import {
  extractTurnIdFromRawItem,
  normalizeTurnId,
  shouldBatchNormalizedRealtimeEvent,
  shouldUseContractRealtimeBatcher,
  useNormalizedRealtimePipeline,
  type PendingNormalizedRealtimeOperation,
} from "./useNormalizedRealtimePipeline";


// A4 流式正文外部化（docs/perf/a4-live-text-externalization-plan.md）：
// 模块加载时读一次，翻转 flag 需刷新页面（与其余 perf flag 同语义）。
const LIVE_TEXT_EXTERNALIZATION_ENABLED = isLiveTextExternalizationEnabled();
// A4 二期：reasoningContent / reasoningSummary / toolOutput 三类电报外部化
//（liveItemDeltaChannel）。同样模块加载时读一次，翻转 flag 需刷新页面。
const LIVE_DELTA_EXTERNALIZATION_ENABLED = isLiveDeltaExternalizationEnabled();

/**
 * Infer engine type from thread ID.
 * Claude/Gemini/Kimi/OpenCode threads use "<engine>:" or "<engine>-pending-" prefixes.
 */
const inferEngineFromThreadId = inferEngineFromLegacyThreadId;

type UseThreadItemEventsOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  resolveCanonicalThreadId?: (threadId: string) => string;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  resolveCollaborationUiMode?: (threadId: string) => "plan" | "code" | null;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  markReviewing: (threadId: string, isReviewing: boolean) => void;
  safeMessageActivity: () => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  applyCollabThreadLinks: (
    threadId: string,
    item: Record<string, unknown>,
    workspaceId?: string,
  ) => void;
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  onDebug?: (entry: DebugEntry) => void;
  onAgentMessageCompletedExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId?: string | null;
    itemId: string;
    text: string;
  }) => void;
  onExitPlanModeToolCompleted?: (payload: {
    workspaceId: string;
    threadId: string;
    itemId: string;
  }) => void;
  scheduleRealtimeDispatch?: (run: () => void) => void;
};

// 全局已终态 turnId 的保留上限。turnId 全局唯一（claude-turn-<uuid>），
// 因此改为按 turnId 而非按线程分桶，容量相应放大。
const MAX_TERMINAL_TURN_IDS = 256;

export function useThreadItemEvents({
  activeThreadId,
  dispatch,
  resolveCanonicalThreadId,
  getCustomName,
  resolveCollaborationUiMode,
  markProcessing,
  markReviewing,
  safeMessageActivity,
  recordThreadActivity,
  applyCollabThreadLinks,
  interruptedThreadsRef,
  onDebug,
  onAgentMessageCompletedExternal,
  onExitPlanModeToolCompleted,
  scheduleRealtimeDispatch = startTransition,
}: UseThreadItemEventsOptions) {
  const enableRealtimeBatchingRef = useRef(isRealtimeBatchingEnabled());
  const activeRealtimeTurnIdByThreadRef = useRef<Map<string, string>>(
    new Map(),
  );
  // 在途 turn 集合（按线程）：多 turn 交错（pi 双 send/后台唤醒）时同一线程
  // 可同时有多个未结算 turn，结算守卫按集合成员判定而非单 activeTurnId。
  const inFlightRealtimeTurnIdsByThreadRef = useRef<Map<string, Set<string>>>(
    new Map(),
  );
  // 全局已终态 turnId 集合。按 turnId（回合的全局唯一身份）判定终态，
  // 使迟到事件无论落在主线程还是别名线程都能被识别为已结束，避免复燃。
  const terminalRealtimeTurnIdsRef = useRef<Set<string>>(new Set());
  // 已结算且尚未开始新回合的线程，用于拦截「无 turnId」的迟到复燃事件。
  const settledRealtimeThreadsRef = useRef<Set<string>>(new Set());
  // 诊断：被终态守卫拦下（本会把线程复燃为「处理中」）的迟到事件计数，
  // 结算时汇总上报，用于量化「结束后仍显示生成中」的根因频率。
  const droppedLateRealtimeEventCountRef = useRef(0);

  const normalizeToolIdentifier = useCallback((value: string) => {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }, []);

  const isClaudeExitPlanModeTool = useCallback(
    (item: Extract<ConversationItem, { kind: "tool" }>) => {
      const normalizedToolType = normalizeToolIdentifier(item.toolType);
      const normalizedTitle = normalizeToolIdentifier(item.title);
      return (
        normalizedToolType === "exitplanmode" ||
        normalizedToolType.endsWith("exitplanmode") ||
        normalizedTitle.includes("exitplanmode")
      );
    },
    [normalizeToolIdentifier],
  );

  const logReasoningRoute = useCallback(
    (
      label: string,
      payload: {
        workspaceId: string;
        threadId: string;
        itemId: string;
        deltaLength?: number;
        skipped?: boolean;
        reason?: string;
      },
    ) => {
      onDebug?.({
        id: `${Date.now()}-thread-reasoning-route`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:${label}`,
        payload: {
          ...payload,
          activeThreadId,
        },
      });
    },
    [activeThreadId, onDebug],
  );

  const logClaudeStream = useCallback(
    (
      label: string,
      payload: {
        workspaceId: string;
        threadId: string;
        itemId?: string;
        itemType?: string;
        deltaLength?: number;
        textPreview?: string;
        skipped?: boolean;
        reason?: string;
      },
    ) => {
      if (
        !onDebug ||
        !isClaudeThread(payload.threadId) ||
        !isClaudeStreamDebugEnabled()
      ) {
        return;
      }
      onDebug({
        id: `${Date.now()}-claude-stream-${label}`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:claude-stream:${label}`,
        payload: {
          ...payload,
          activeThreadId,
        },
      });
    },
    [activeThreadId, onDebug],
  );

  const isRealtimeTurnTerminal = useCallback(
    (
      threadId: string,
      turnId?: string | null,
      options: {
        allowActiveTurnFallback?: boolean;
      } = {},
    ) => {
      const normalizedTurnId = normalizeTurnId(turnId);
      if (normalizedTurnId) {
        // 带 turnId：按回合的全局唯一身份判定终态，与线程别名无关。
        // 这样迟到事件即便落在别名线程上，只要其 turnId 已结算就会被拒绝，
        // 不再把线程复燃为「处理中」。
        return terminalRealtimeTurnIdsRef.current.has(normalizedTurnId);
      }
      if (options.allowActiveTurnFallback === false) {
        return false;
      }
      const activeTurnId =
        activeRealtimeTurnIdByThreadRef.current.get(threadId);
      if (activeTurnId) {
        return terminalRealtimeTurnIdsRef.current.has(activeTurnId);
      }
      // 无 turnId 且该线程已无进行中回合：结算过则视为终态，
      // 拒绝迟到事件把它复燃。新线程（从未结算）仍放行首个事件。
      return settledRealtimeThreadsRef.current.has(threadId);
    },
    [],
  );

  const noteRealtimeTurnStarted = useCallback(
    (threadId: string, turnId: string) => {
      const normalizedTurnId = normalizeTurnId(turnId);
      if (!threadId || !normalizedTurnId) {
        return;
      }
      activeRealtimeTurnIdByThreadRef.current.set(threadId, normalizedTurnId);
      // 在途 turn 集合：同一线程允许多个 turn 流交错（如 pi 同 resident 双
      // send、后台唤醒 turn 与新 send 交错），结算守卫按集合成员判定而非
      // 单 activeTurnId，错配不再永久丢结算。
      const inFlightSet =
        inFlightRealtimeTurnIdsByThreadRef.current.get(threadId) ??
        new Set<string>();
      inFlightSet.add(normalizedTurnId);
      inFlightRealtimeTurnIdsByThreadRef.current.set(threadId, inFlightSet);
      // 新回合开始：解除该线程的「已结算」态，避免上一回合的结算态
      // 误杀本回合的无 turnId 事件。
      settledRealtimeThreadsRef.current.delete(threadId);
    },
    [],
  );

  const markRealtimeTurnTerminal = useCallback(
    (threadId: string, turnId: string) => {
      const normalizedTurnId = normalizeTurnId(turnId);
      if (!threadId || !normalizedTurnId) {
        return;
      }
      const terminalTurnIds = terminalRealtimeTurnIdsRef.current;
      terminalTurnIds.delete(normalizedTurnId);
      terminalTurnIds.add(normalizedTurnId);
      while (terminalTurnIds.size > MAX_TERMINAL_TURN_IDS) {
        const oldestTurnId = terminalTurnIds.values().next().value;
        if (!oldestTurnId) {
          break;
        }
        terminalTurnIds.delete(oldestTurnId);
      }
      // 该线程回合已结算：登记结算态并清掉活跃记录，使后续「无 turnId」
      // 的迟到事件不再复燃它（配合 isRealtimeTurnTerminal 的无 id 分支）。
      const settledThreads = settledRealtimeThreadsRef.current;
      settledThreads.delete(threadId);
      settledThreads.add(threadId);
      while (settledThreads.size > MAX_TERMINAL_TURN_IDS) {
        const oldestThreadId = settledThreads.values().next().value;
        if (!oldestThreadId) {
          break;
        }
        settledThreads.delete(oldestThreadId);
      }
      // 该 turn 落终态：移出在途集合（多 turn 交错时其余 turn 不受影响）。
      const inFlightSet = inFlightRealtimeTurnIdsByThreadRef.current.get(threadId);
      inFlightSet?.delete(normalizedTurnId);
      if (!inFlightSet || inFlightSet.size === 0) {
        inFlightRealtimeTurnIdsByThreadRef.current.delete(threadId);
        activeRealtimeTurnIdByThreadRef.current.delete(threadId);
      } else if (
        activeRealtimeTurnIdByThreadRef.current.get(threadId) === normalizedTurnId
      ) {
        // 保留一个仍在途的 turn 作为线程级 active id，避免 A 先结束时把
        // B 的实时状态清成 null。
        activeRealtimeTurnIdByThreadRef.current.set(
          threadId,
          inFlightSet.values().next().value as string,
        );
      }
      // 诊断汇总：本回合期间被终态守卫拦下的迟到事件数（>0 表示确有
      // 迟到事件试图复燃线程，这正是「结束后仍显示生成中」的根因）。
      const droppedLateEvents = droppedLateRealtimeEventCountRef.current;
      if (droppedLateEvents > 0) {
        droppedLateRealtimeEventCountRef.current = 0;
        onDebug?.({
          id: `${Date.now()}-realtime-late-event-drop`,
          timestamp: Date.now(),
          source: "event",
          label: "thread/session:realtime-late-event-drop",
          payload: {
            threadId,
            turnId: normalizedTurnId,
            droppedLateEvents,
            activeThreadId,
          },
        });
      }
    },
    [activeThreadId, onDebug],
  );

  const isRealtimeTurnTerminalExact = useCallback(
    (threadId: string, turnId?: string | null) =>
      isRealtimeTurnTerminal(threadId, turnId, {
        allowActiveTurnFallback: false,
      }),
    [isRealtimeTurnTerminal],
  );

  /** turnId 是否为本线程当前在途（已 started、未 terminal）的 turn。 */
  const isRealtimeTurnInFlight = useCallback(
    (threadId: string, turnId?: string | null) => {
      const normalizedTurnId = normalizeTurnId(turnId);
      if (!threadId) {
        return false;
      }
      const inFlightSet = inFlightRealtimeTurnIdsByThreadRef.current.get(threadId);
      // 空 turnId 查询线程是否仍有其他 turn 在途。
      if (!normalizedTurnId) return (inFlightSet?.size ?? 0) > 0;
      return inFlightSet?.has(normalizedTurnId) ?? false;
    },
    [],
  );

  const {
    pendingRealtimeDeltaOpsRef,
    realtimeFlushTimerRef,
    flushRealtimeDeltaOps,
    flushRealtimeDeltaOpsForThread,
    enqueueRealtimeDeltaOperation,
  } = useRealtimeDeltaQueue({
    dispatch,
    getCustomName,
    interruptedThreadsRef,
    markProcessing,
    resolveCanonicalThreadId,
    safeMessageActivity,
    isRealtimeTurnTerminal,
    droppedLateRealtimeEventCountRef,
    enableRealtimeBatchingRef,
  });

  // A4 二期 settle 对齐：把某 lane 的通道尾段作为一条普通 delta 直接 dispatch
  // 回根 reducer（与 A4 正文 drain 同款做法；reducer merge 对「快照已覆盖」做
  // 重叠去重，幂等）。不走 applyRealtimeDeltaOperation——中断/终态守卫只拦
  // 实时事件，不该拦结算灌回。
  const dispatchLiveItemDeltaTail = useCallback(
    (
      threadId: string,
      itemId: string,
      lane: LiveItemDeltaLane,
      tail: string,
    ) => {
      if (!tail) {
        return;
      }
      if (lane === "reasoningContent") {
        dispatch({
          type: "appendReasoningContent",
          threadId,
          itemId,
          delta: tail,
        });
        return;
      }
      if (lane === "reasoningSummary") {
        dispatch({
          type: "appendReasoningSummary",
          threadId,
          itemId,
          delta: tail,
        });
        return;
      }
      dispatch({ type: "appendToolOutput", threadId, itemId, delta: tail });
    },
    [dispatch],
  );

  // item 完成快照是权威文本：快照 upsert 落地后，把该 item 各 lane 尚未落账的
  // 尾段灌回 durable items，再清 lane 条目，避免 turn settle 时重复灌回。
  const settleLiveItemDeltaForCompletedItem = useCallback(
    (threadId: string, itemId: string) => {
      if (!LIVE_DELTA_EXTERNALIZATION_ENABLED || !itemId) {
        return;
      }
      const lanes: LiveItemDeltaLane[] = [
        "reasoningContent",
        "reasoningSummary",
        "toolOutput",
      ];
      for (const lane of lanes) {
        const entry = peekLiveItemDeltaEntry(threadId, itemId, lane);
        if (!entry) {
          continue;
        }
        dispatchLiveItemDeltaTail(
          threadId,
          itemId,
          lane,
          entry.text.slice(entry.shellTextLength),
        );
      }
      clearLiveItemDeltaForItem(threadId, itemId);
    },
    [dispatchLiveItemDeltaTail],
  );

  // 回合结算（terminal causal barrier 建立前） drain 全线程通道尾段。
  // 对齐正文 drain 的既有接线：先收敛未落账内容，再由调用方立 exact-turn
  // barrier——结算不越过正文。
  const drainLiveItemDeltasForThread = useCallback(
    (threadId: string) => {
      if (!LIVE_DELTA_EXTERNALIZATION_ENABLED || !threadId) {
        return;
      }
      const drained = drainLiveItemDeltaTail(threadId);
      for (const entry of drained) {
        dispatchLiveItemDeltaTail(
          threadId,
          entry.itemId,
          entry.lane,
          entry.text,
        );
      }
    },
    [dispatchLiveItemDeltaTail],
  );

  const {
    pendingNormalizedRealtimeOpsRef,
    normalizedRealtimeBatcherRef,
    normalizedRealtimeFlushTimerRef,
    flushNormalizedRealtimeOps,
    flushNormalizedRealtimeOpsForThread,
    enqueueNormalizedRealtimeEvent,
    applyNormalizedRealtimeEventNow,
  } = useNormalizedRealtimePipeline({
    activeThreadId,
    dispatch,
    markProcessing,
    recordThreadActivity,
    scheduleRealtimeDispatch,
    applyCollabThreadLinks,
    onAgentMessageCompletedExternal,
    safeMessageActivity,
    isRealtimeTurnTerminal,
    droppedLateRealtimeEventCountRef,
    enableRealtimeBatchingRef,
  });

  useEffect(() => {
    if (!activeThreadId?.startsWith("shared:")) {
      return;
    }
    flushRealtimeDeltaOpsForThread(activeThreadId);
    flushNormalizedRealtimeOpsForThread(activeThreadId);
  }, [
    activeThreadId,
    flushNormalizedRealtimeOpsForThread,
    flushRealtimeDeltaOpsForThread,
  ]);

  const flushRealtimeDeltaOpsForUnmountRef = useRef(flushRealtimeDeltaOps);
  const flushNormalizedRealtimeOpsForUnmountRef = useRef(
    flushNormalizedRealtimeOps,
  );
  useEffect(() => {
    flushRealtimeDeltaOpsForUnmountRef.current = flushRealtimeDeltaOps;
    flushNormalizedRealtimeOpsForUnmountRef.current =
      flushNormalizedRealtimeOps;
  }, [flushNormalizedRealtimeOps, flushRealtimeDeltaOps]);

  useEffect(
    () => () => {
      flushRealtimeDeltaOpsForUnmountRef.current();
      flushNormalizedRealtimeOpsForUnmountRef.current();
      if (realtimeFlushTimerRef.current !== null) {
        window.clearTimeout(realtimeFlushTimerRef.current);
        realtimeFlushTimerRef.current = null;
      }
      if (normalizedRealtimeFlushTimerRef.current !== null) {
        window.clearTimeout(normalizedRealtimeFlushTimerRef.current);
        normalizedRealtimeFlushTimerRef.current = null;
      }
      pendingRealtimeDeltaOpsRef.current = [];
      pendingNormalizedRealtimeOpsRef.current.clear();
      activeRealtimeTurnIdByThreadRef.current.clear();
      terminalRealtimeTurnIdsRef.current.clear();
      settledRealtimeThreadsRef.current.clear();
    },
    [],
  );

  const flushPendingRealtimeEvents = useCallback(() => {
    flushRealtimeDeltaOps();
    flushNormalizedRealtimeOps();
    // fix-turn-terminal-live-text-commit-loss：contract batcher 的积压 delta
    // 也必须在 terminal barrier 建立前同步落 durable。此前只有 legacy 两条
    // 队列被 flush，batcher 的 cadence flush（startTransition）在 barrier 之后
    // 会被 isRealtimeTurnTerminal 静默丢弃，导致末段正文冻结在 first-token 壳。
    const batcherFlush = normalizedRealtimeBatcherRef.current.flush("terminal");
    if (batcherFlush && batcherFlush.events.length > 0) {
      const ensuredThreads = new Set<string>();
      const markedProcessingThreads = new Set<string>();
      for (const event of batcherFlush.events) {
        applyNormalizedRealtimeEventNow(
          {
            event,
            // drain 时现算 custom-name（比 push 时闭包捕获更新鲜），
            // 避免把错误线程的命名状态带进 auto-rename。
            hasCustomName: Boolean(
              getCustomName(event.workspaceId, event.threadId),
            ),
          },
          {
            ensuredThreads,
            markedProcessingThreads,
            useTransitionForDispatch: false,
          },
        );
      }
      safeMessageActivity();
    }
  }, [
    applyNormalizedRealtimeEventNow,
    flushNormalizedRealtimeOps,
    flushRealtimeDeltaOps,
    getCustomName,
    safeMessageActivity,
  ]);

  // \u00a76.3 / \u00a76.4: dispatch \u8c03\u5ea6\u4e0e\u4eea\u8868\u62ee\u53d6
  const submitScheduleInstrumentationRef = useRef({
    urgentDispatchCount: 0,
    transitionDispatchCount: 0,
    idleDispatchCount: 0,
    totalDispatchCostMs: 0,
    lastDispatchAtMs: 0,
  });

  const dispatchWithSchedule = useCallback(
    (
      action: ThreadAction,
      options: {
        isLiveRow?: boolean;
        isCritical?: boolean;
      } = {},
    ) => {
      const tier = readStreamingScheduleTier();
      const isLiveRow = options.isLiveRow ?? false;
      const isCritical = options.isCritical ?? false;
      const mode: DispatchSubmitMode = resolveDispatchSubmitMode({
        tier,
        isLiveRow,
        isHeavy: false,
        isCritical,
      });
      const startedAt =
        typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now();
      // §6.4: instrumentation \u5728 submit-mode \u9009\u5b9a\u540e\u7acb\u5373\u8bb0\u5f55,
      // \u4e0d\u7b49 dispatch \u5b8c\u6210\u3002\u8fd9\u6837 test \u4ee5 act() \u540c\u6b65\u8c03\u7528\u540e\u7acb\u5373\u80fd\u770b\u5230
      // \u8ba1\u6570\u4e0a\u53b8\u3002
      const inst0 = submitScheduleInstrumentationRef.current;
      if (mode === "urgent") inst0.urgentDispatchCount += 1;
      else if (mode === "transition") inst0.transitionDispatchCount += 1;
      else inst0.idleDispatchCount += 1;
      const finalize = () => {
        const endedAt =
          typeof performance !== "undefined" &&
          typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        inst0.totalDispatchCostMs += Math.max(0, endedAt - startedAt);
        inst0.lastDispatchAtMs = endedAt;
        dispatch(action);
      };
      if (mode === "urgent") {
        finalize();
        return;
      }
      if (mode === "transition") {
        startTransition(() => {
          finalize();
        });
        return;
      }
      // mode === "idle"
      if (
        typeof (globalThis as { requestIdleCallback?: unknown })
          .requestIdleCallback === "function"
      ) {
        // SAFETY: the preceding typeof guard proves this browser global is callable.
        (
          globalThis as unknown as {
            requestIdleCallback: (cb: () => void) => void;
          }
        ).requestIdleCallback(() => {
          finalize();
        });
        return;
      }
      // fallback: setTimeout(0)
      globalThis.setTimeout(() => {
        finalize();
      }, 0);
    },
    [dispatch],
  );

  const __getSubmitScheduleInstrumentationForTests = useCallback(
    () => submitScheduleInstrumentationRef.current,
    [],
  );

  const handleItemUpdate = useCallback(
    (
      workspaceId: string,
      threadId: string,
      item: Record<string, unknown>,
      shouldMarkProcessing: boolean,
      shouldIncrementAgentSegment: boolean,
      options?: {
        /** backgroundTask 终态合成 item：合法的 post-settle 迟到更新，绕过 turn 终态守卫。 */
        skipTurnTerminalGuard?: boolean;
      },
    ) => {
      if (isInterruptedThread(interruptedThreadsRef, workspaceId, threadId)) {
        return;
      }
      flushRealtimeDeltaOps();
      const turnId = extractTurnIdFromRawItem(item);
      if (
        !options?.skipTurnTerminalGuard &&
        isRealtimeTurnTerminal(threadId, turnId)
      ) {
        return;
      }
      // \u00a76.3: \u5165\u53e3 ensureThread \u8d70 dispatchWithSchedule\u3002
      // baseline \u4e0e isLiveRow / isCritical \u90fd\u9000\u5316\u4e3a urgent\uff0c\u8bed\u4e49\u4e0e\u539f\u540c\u3002
      // \u4f4e\u4f18\u5148\u7ea7\u4f1a\u8bdd\uff08threadId !== activeThreadId\uff09+ guarded / aggressive \u8d70 transition / idle \u3002
      const isLiveRow = threadId === activeThreadId;
      dispatchWithSchedule(
        {
          type: "ensureThread",
          workspaceId,
          threadId,
          engine: inferEngineFromThreadId(threadId),
        },
        { isLiveRow, isCritical: false },
      );
      const itemType = asString(item?.type ?? "");
      const itemId = asString(item?.id ?? "");
      const itemEngineSource = inferItemEngineSource(item, threadId);
      // PI 后台任务卡：登记 toolId→taskId 身份（幂等 merge），
      // receipt / notification 更新按 taskId 关联到同一张卡。
      if (itemType === "backgroundTask") {
        noteBackgroundTaskStarted(workspaceId, threadId, item);
      }
      const shouldSuppressGeminiReasoningProcessing =
        itemType === "reasoning" &&
        (itemEngineSource === "gemini" || itemEngineSource === "kimi");
      if (
        shouldMarkProcessing &&
        !shouldSuppressGeminiReasoningProcessing &&
        canProgressEventStartProcessing(itemEngineSource)
      ) {
        markProcessing(threadId, true);
      }
      if (isCodexSubagentActivityItem(item)) {
        applyCollabThreadLinks(threadId, item, workspaceId);
      } else {
        applyCollabThreadLinks(threadId, item);
      }
      const agentMessageSnapshotText = asString(
        item?.text ??
          item?.content ??
          item?.output_text ??
          item?.outputText ??
          "",
      );
      if (itemType === "agentMessage" || itemType === "reasoning") {
        logClaudeStream("item-snapshot", {
          workspaceId,
          threadId,
          itemId,
          itemType,
          deltaLength: agentMessageSnapshotText.length,
          textPreview: createDebugPreview(agentMessageSnapshotText),
        });
      }
      if (itemType === "enteredReviewMode") {
        markReviewing(threadId, true);
      } else if (itemType === "exitedReviewMode") {
        markReviewing(threadId, false);
        markProcessing(threadId, false);
      }

      // 当 tool item 开始时，增加分段计数，确保后续文本创建新的 message
      // 这样可以实现文本和工具调用交替显示
      const isToolItem = [
        "commandExecution",
        "fileChange",
        "mcpToolCall",
        "collabToolCall",
        "collabAgentToolCall",
        "webSearch",
        "imageView",
        "generatedImage",
        "generated_image",
        "image_generation_call",
        "image_generation_end",
        "backgroundTask",
      ].includes(itemType);
      if (shouldMarkProcessing && shouldIncrementAgentSegment && isToolItem) {
        // A4 live-text 外部化：本段正文只有建壳首段落进了 reducer，其余都停在通道里。
        // 分段前必须把尾段灌回，否则 incrementAgentSegment 之后通道条目会被下一段的
        // 首 delta 顶掉，本段正文永久丢失。dispatch 必须早于 incrementAgentSegment，
        // 好让 reducer 用「旧 segment」解析出本段的 assistant item id。
        // hasCustomName: true 表示灌回不参与线程自动命名（与中断 drain 一致）。
        if (LIVE_TEXT_EXTERNALIZATION_ENABLED) {
          const liveTextTail = drainLiveAssistantTextTail(threadId);
          if (liveTextTail) {
            dispatch({
              type: "appendAgentDelta",
              workspaceId,
              threadId,
              itemId: liveTextTail.itemId,
              delta: liveTextTail.tailDelta,
              hasCustomName: true,
              ...getNativeTurnIngestMeta(workspaceId, threadId),
            });
          }
        }
        // A4 二期思考外置与正文同契约：分段前灌回 reasoning/toolOutput 尾段。
        // Grok jsonl 工具会多次 increment；不灌回则 durable 只剩建壳首 token，
        // collapse 再用 `\n\n` 拼成孤立标点 / 半截英文。
        if (LIVE_DELTA_EXTERNALIZATION_ENABLED) {
          drainLiveItemDeltasForThread(threadId);
        }
        dispatch({ type: "incrementAgentSegment", threadId });
      }

      if (itemType === "agentMessage") {
        // item completed（shouldMarkProcessing=false）时 snapshot 可能偏短/空，
        // 必须在 clear 通道前与 live 全文合并，否则只剩建壳首段（如 `**`）。
        const settledSnapshotText =
          LIVE_TEXT_EXTERNALIZATION_ENABLED && !shouldMarkProcessing
            ? resolveLiveAssistantSettlementText(
                threadId,
                agentMessageSnapshotText,
              )
            : agentMessageSnapshotText;
        if (settledSnapshotText) {
          upsertLiveAssistantShadowSnapshot({
            engine: inferEngineFromThreadId(threadId),
            workspaceId,
            threadId,
            itemId,
            text: settledSnapshotText,
            turnId,
          });
          // 同 delta 路径：snapshot 换 itemId 时先 drain 上一段，避免只剩建壳首字。
          if (LIVE_TEXT_EXTERNALIZATION_ENABLED && shouldMarkProcessing) {
            const previousTail = drainLiveAssistantTextTailIfItemChanged(
              threadId,
              itemId,
            );
            if (previousTail) {
              dispatch({
                type: "appendAgentDelta",
                workspaceId,
                threadId,
                itemId: previousTail.itemId,
                delta: previousTail.tailDelta,
                hasCustomName: true,
                ...getNativeTurnIngestMeta(workspaceId, threadId),
              });
            }
          }
          const liveSnapshotUpdate =
            LIVE_TEXT_EXTERNALIZATION_ENABLED && shouldMarkProcessing
              ? updateLiveAssistantTextSnapshot(
                  threadId,
                  itemId,
                  settledSnapshotText,
                )
              : "replacement";
          const shouldDispatchSnapshot =
            liveSnapshotUpdate === "first" ||
            liveSnapshotUpdate === "replacement";
          if (shouldDispatchSnapshot) {
            const dispatchStartedAt = readHighResolutionNowMs();
            dispatch({
              type: "appendAgentDelta",
              workspaceId,
              threadId,
              itemId,
              delta: settledSnapshotText,
              hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
              ...getNativeTurnIngestMeta(workspaceId, threadId),
            });
            const dispatchCostMs =
              readHighResolutionNowMs() - dispatchStartedAt;
            noteThreadReducerWorkMeasured(threadId, {
              itemId,
              textLength: settledSnapshotText.length,
              mergeCostMs: dispatchCostMs,
              normalizationCostMs: dispatchCostMs,
            });
          }
          if (liveSnapshotUpdate === "replacement") {
            clearLiveAssistantText(threadId);
          }
          logClaudeStream("agent-snapshot-routed", {
            workspaceId,
            threadId,
            itemId,
            itemType,
            deltaLength: settledSnapshotText.length,
            textPreview: createDebugPreview(settledSnapshotText),
          });
        }
        safeMessageActivity();
        return;
      }

      const converted = buildConversationItem(item);
      if (converted) {
        const itemEngineSource = asString(
          item.engineSource ?? item.engine_source ?? "",
        )
          .trim()
          .toLowerCase();
        const normalizedConverted =
          itemEngineSource === "claude" ||
          itemEngineSource === "gemini" ||
          itemEngineSource === "grok" ||
          itemEngineSource === "kimi" ||
          itemEngineSource === "opencode" ||
          itemEngineSource === "pi" ||
          itemEngineSource === "omp" ||
          itemEngineSource === "dsh" ||
          itemEngineSource === "qoder" ||
          itemEngineSource === "codex"
            ? {
                ...converted,
                engineSource: itemEngineSource as
                  | "claude"
                  | "codex"
                  | "gemini"
                  | "grok"
                  | "kimi"
                  | "opencode"
                  | "pi"
                  | "omp"
                  | "dsh"
                  | "qoder",
              }
            : converted;
        const threadEngine = inferEngineFromThreadId(threadId);
        // Claude reasoning should converge to the persisted history shape.
        // Accept snapshot items so final/live state can be enriched by the
        // server snapshot instead of staying delta-only.
        if (
          threadEngine === "claude" &&
          normalizedConverted.kind === "reasoning"
        ) {
          logReasoningRoute("reasoning-snapshot-accepted", {
            workspaceId,
            threadId,
            itemId: normalizedConverted.id,
            skipped: false,
            reason: "claude-snapshot-enriches-live-state",
          });
          logClaudeStream("reasoning-snapshot-upsert", {
            workspaceId,
            threadId,
            itemId: normalizedConverted.id,
            itemType,
            deltaLength:
              `${normalizedConverted.summary}${normalizedConverted.content}`
                .length,
            textPreview: createDebugPreview(
              normalizedConverted.content || normalizedConverted.summary || "",
            ),
          });
        }
        const normalizedItem =
          normalizedConverted.kind === "message" &&
          normalizedConverted.role === "user" &&
          !normalizedConverted.collaborationMode
            ? {
                ...normalizedConverted,
                collaborationMode:
                  resolveCollaborationUiMode?.(threadId) ?? null,
              }
            : normalizedConverted;
        // Native turn-target 显示条：转换型 assistant message 缺快照时补账本值
        // （shared canonical 注入的既有值绝不覆盖）。
        const stampedItem =
          normalizedItem.kind === "message" &&
          normalizedItem.role === "assistant" &&
          !normalizedItem.executionTargetSnapshot
            ? {
                ...normalizedItem,
                ...getNativeTurnIngestMeta(workspaceId, threadId),
              }
            : normalizedItem;
        dispatch({
          type: "upsertItem",
          workspaceId,
          threadId,
          item: stampedItem,
          hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
        });
        if (
          !shouldMarkProcessing &&
          inferEngineFromThreadId(threadId) === "claude" &&
          stampedItem.kind === "tool" &&
          isClaudeExitPlanModeTool(stampedItem)
        ) {
          onExitPlanModeToolCompleted?.({
            workspaceId,
            threadId,
            itemId: normalizedItem.id,
          });
        }
      }
      // A4 二期：itemCompleted（shouldMarkProcessing=false）的完成快照是权威
      // 文本。快照 upsert 落地后灌回该 item 各 lane 的通道尾段并清条目——
      // 结算不越过正文，也避免 turn settle 时重复灌回。
      if (!shouldMarkProcessing) {
        settleLiveItemDeltaForCompletedItem(threadId, itemId);
      }
      safeMessageActivity();
    },
    [
      activeThreadId,
      applyCollabThreadLinks,
      dispatch,
      dispatchWithSchedule,
      flushRealtimeDeltaOps,
      getCustomName,
      interruptedThreadsRef,
      isRealtimeTurnTerminal,
      isClaudeExitPlanModeTool,
      logClaudeStream,
      logReasoningRoute,
      markProcessing,
      markReviewing,
      onExitPlanModeToolCompleted,
      resolveCollaborationUiMode,
      safeMessageActivity,
      settleLiveItemDeltaForCompletedItem,
      drainLiveItemDeltasForThread,
    ],
  );

  // 2026-06-24-harden-realtime-interaction-jank-during-tool-call §5.2
  // Tool output tail gate. Coalesces per-item deltas at 32ms (or 16ms in
  // aggressive tier) and caps the per-key buffer at 1 MiB. The flush
  // handler enqueues a single `toolOutputDelta` op into the existing
  // realtime delta queue, preserving the contract with
  // `applyRealtimeDeltaOperation`. The gate can be disabled at runtime
  // via `localStorage.setItem("ccgui.perf.toolOutputTailGate", "off")`,
  // in which case the flush handler is invoked synchronously per submit.
  const toolOutputMetadataRef = useRef(
    new Map<ToolOutputKey, { threadId: string; turnId: string | null }>(),
  );

  const toolOutputTailGate = useMemo(
    () =>
      createToolOutputTailGate({
        onEntryEvicted: (key) => {
          toolOutputMetadataRef.current.delete(key);
        },
        flushHandler: (key, fullText) => {
          // Re-decompose the key into the original tuple. The gate is
          // append-only, so we forward the merged text as a single delta.
          // The reducer is idempotent for repeated text appends.
          const [workspaceId, itemId, kindToken] = key.split("\0");
          const metadata = toolOutputMetadataRef.current.get(key);
          const threadId = metadata?.threadId ?? "";
          if (!workspaceId || !threadId || !itemId) return;
          enqueueRealtimeDeltaOperation({
            kind: "toolOutputDelta",
            workspaceId,
            threadId,
            itemId,
            delta: fullText,
            turnId: metadata?.turnId ?? null,
            toolType:
              kindToken === "fileChange" ? "fileChange" : "commandExecution",
          });
        },
      }),
    [enqueueRealtimeDeltaOperation],
  );

  // Flush the tool output gate on item completion / turn completion so the
  // user sees the final tail before the next reducer turn kicks in.
  useEffect(() => {
    return () => {
      // Drain on unmount so any buffered deltas land before the hook is
      // torn down. Tests can call __flushAllForTests synchronously.
      toolOutputTailGate.flushAll();
    };
  }, [toolOutputTailGate]);

  const handleToolOutputDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      kind: "commandExecution" | "fileChange",
      turnId?: string | null,
    ) => {
      // 2026-06-24-harden-realtime-interaction-jank-during-tool-call §5.2
      // Forward the delta into the tail gate instead of the realtime delta
      // queue directly. The gate coalesces and forwards the merged text
      // to `enqueueRealtimeDeltaOperation` at its 32ms cadence.
      const key = buildToolOutputKey(workspaceId, itemId, kind);
      toolOutputMetadataRef.current.set(key, {
        threadId,
        turnId: turnId ?? null,
      });
      toolOutputTailGate.submit(key, delta);
    },
    [toolOutputTailGate],
  );

  const flushToolOutputForItem = useCallback(
    (workspaceId: string, itemId: string) => {
      for (const kind of ["commandExecution", "fileChange"] as const) {
        const key = buildToolOutputKey(workspaceId, itemId, kind);
        toolOutputTailGate.flush(key);
        toolOutputTailGate.reset(key);
        toolOutputMetadataRef.current.delete(key);
      }
    },
    [toolOutputTailGate],
  );

  const handleTerminalInteraction = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      stdin: string,
      turnId?: string | null,
    ) => {
      if (!stdin) {
        return;
      }
      const normalized = stdin.replace(/\r\n/g, "\n");
      const suffix = normalized.endsWith("\n") ? "" : "\n";
      handleToolOutputDelta(
        workspaceId,
        threadId,
        itemId,
        `\n[stdin]\n${normalized}${suffix}`,
        "commandExecution",
        turnId,
      );
    },
    [handleToolOutputDelta],
  );
  const onAgentMessageDelta = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      delta,
      turnId,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      turnId?: string | null;
    }) => {
      // Skip late-arriving deltas for threads that have been interrupted
      if (isInterruptedThread(interruptedThreadsRef, workspaceId, threadId)) {
        logClaudeStream("agent-delta-skipped", {
          workspaceId,
          threadId,
          itemId,
          deltaLength: delta.length,
          textPreview: createDebugPreview(delta),
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      const resolvedDelta = applyPendingClaudeMcpOutputNoticeToAgentDelta(
        workspaceId,
        threadId,
        delta,
      );
      appendLiveAssistantShadowDelta({
        engine: inferEngineFromThreadId(threadId),
        workspaceId,
        threadId,
        itemId,
        delta: resolvedDelta,
        turnId,
      });
      // A4：flag 开启时，首条 delta（或 itemId 变化）仍走 reducer 建壳；
      // 后续 delta 只累计进 live 通道（订阅的 MessageRow 小树渲染），
      // 不再逐条 dispatch 打根。终稿由 completed 全量落地。
      //
      // Text↔Reasoning 交错会换 itemId（Gemini/Grok/Kimi 的 text-N run）。
      // 换 id 前必须先 drain 上一段尾部；否则上段只剩建壳首字，历史重载才完整。
      if (LIVE_TEXT_EXTERNALIZATION_ENABLED) {
        const previousTail = drainLiveAssistantTextTailIfItemChanged(
          threadId,
          itemId,
        );
        if (previousTail) {
          enqueueRealtimeDeltaOperation({
            kind: "agentDelta",
            workspaceId,
            threadId,
            itemId: previousTail.itemId,
            delta: previousTail.tailDelta,
            turnId,
          });
        }
      }
      const liveTextResult = LIVE_TEXT_EXTERNALIZATION_ENABLED
        ? appendLiveAssistantText(threadId, itemId, resolvedDelta)
        : null;
      if (!liveTextResult || liveTextResult.isFirst) {
        enqueueRealtimeDeltaOperation(
          {
            kind: "agentDelta",
            workspaceId,
            threadId,
            itemId,
            delta: resolvedDelta,
            turnId,
          },
          {
            urgent:
              (threadId.startsWith("shared:") ||
                threadId.startsWith("agent-canvas:")) &&
              liveTextResult?.isFirst === true,
          },
        );
      }
      logClaudeStream("agent-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: resolvedDelta.length,
        textPreview: createDebugPreview(resolvedDelta),
      });
    },
    [enqueueRealtimeDeltaOperation, interruptedThreadsRef, logClaudeStream],
  );

  const onAgentMessageCompleted = useCallback(
    ({
      workspaceId,
      threadId,
      itemId,
      text,
      turnId,
    }: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
      turnId?: string | null;
    }) => {
      if (isInterruptedThread(interruptedThreadsRef, workspaceId, threadId)) {
        return;
      }
      const resolvedText = applyPendingClaudeMcpOutputNoticeToAgentCompleted(
        workspaceId,
        threadId,
        text,
      );
      // A4：provider 终稿可能短于通道累积全文（或仅为建壳 `**`）。
      // clear 前先与权威 live 合并，否则 isStreaming 结束后只剩壳文本。
      const settledText = LIVE_TEXT_EXTERNALIZATION_ENABLED
        ? resolveLiveAssistantSettlementText(threadId, resolvedText)
        : resolvedText;
      settleLiveAssistantShadowTranscript({
        engine: inferEngineFromThreadId(threadId),
        workspaceId,
        threadId,
        itemId,
        text: settledText,
        turnId,
        providerFinalObserved: true,
      });
      flushRealtimeDeltaOps();
      if (isRealtimeTurnTerminal(threadId, turnId)) {
        // 回合已 terminal：turn settle 通常已把 live 全文落盘。
        // 仍须无条件把 settledText 写入 durable state——不能依赖 residual 仍在：
        // 1) resolve 时通道有全文，随后 turn 已 clear；2) provider 终稿本身完整
        // 但 residual 为空。旧逻辑「仅 residual 存在才 salvage」会在 isStreaming
        // 结束后只剩建壳首段（如「已」），重开历史才恢复。
        if (LIVE_TEXT_EXTERNALIZATION_ENABLED && settledText) {
          const timestamp = Date.now();
          dispatch({
            type: "ensureThread",
            workspaceId,
            threadId,
            engine: inferEngineFromThreadId(threadId),
          });
          dispatch({
            type: "flushAgentCompletedBatch",
            workspaceId,
            threadId,
            itemId,
            text: settledText,
            hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
            timestamp,
            isActiveThread: threadId === activeThreadId,
            ...getNativeTurnIngestMeta(workspaceId, threadId),
          });
          clearLiveAssistantText(threadId);
          recordThreadActivity(workspaceId, threadId, timestamp);
          safeMessageActivity();
          onAgentMessageCompletedExternal?.({
            workspaceId,
            threadId,
            ...(turnId ? { turnId } : {}),
            itemId,
            text: settledText,
          });
          logClaudeStream("agent-completed-terminal-salvage", {
            workspaceId,
            threadId,
            itemId,
            deltaLength: settledText.length,
            textPreview: createDebugPreview(settledText),
          });
        }
        return;
      }
      const timestamp = Date.now();
      // \u00a76.2: \u4fdd\u8bc1\u4e0a\u4e0b\u6587\u5148 ensureThread (\u539f\u987a\u5e8f)
      dispatch({
        type: "ensureThread",
        workspaceId,
        threadId,
        engine: inferEngineFromThreadId(threadId),
      });
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      // \u00a76.2: \u4e00\u6b21\u6027\u5408\u5e76 completeAgentMessage + setThreadTimestamp +
      // setLastAgentMessage + (\u6761\u4ef6) markUnread\uff0c\u51cf\u5c11 reducer \u8c03\u5ea6\u6b21\u6570\u3002
      dispatch({
        type: "flushAgentCompletedBatch",
        workspaceId,
        threadId,
        itemId,
        text: settledText,
        hasCustomName,
        timestamp,
        isActiveThread: threadId === activeThreadId,
        ...getNativeTurnIngestMeta(workspaceId, threadId),
      });
      // A4：终稿已全量落 reducer，清 live 通道；订阅行在同一批提交内
      // 切回读 item.text（终稿），无闪烁。
      if (LIVE_TEXT_EXTERNALIZATION_ENABLED) {
        clearLiveAssistantText(threadId);
      }
      recordThreadActivity(workspaceId, threadId, timestamp);
      safeMessageActivity();
      onAgentMessageCompletedExternal?.({
        workspaceId,
        threadId,
        ...(turnId ? { turnId } : {}),
        itemId,
        text: settledText,
      });
      logClaudeStream("agent-completed", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: settledText.length,
        textPreview: createDebugPreview(settledText),
      });
    },
    [
      activeThreadId,
      dispatch,
      flushRealtimeDeltaOps,
      getCustomName,
      logClaudeStream,
      onAgentMessageCompletedExternal,
      recordThreadActivity,
      safeMessageActivity,
      interruptedThreadsRef,
      isRealtimeTurnTerminal,
    ],
  );

  const onItemStarted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, true, true);
    },
    [handleItemUpdate],
  );

  const onItemUpdated = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      handleItemUpdate(workspaceId, threadId, item, true, false);
    },
    [handleItemUpdate],
  );

  const onItemCompleted = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const itemId = asString(item.id ?? "");
      if (itemId) {
        flushToolOutputForItem(workspaceId, itemId);
      }
      handleItemUpdate(workspaceId, threadId, item, false, false);
    },
    [flushToolOutputForItem, handleItemUpdate],
  );

  // 1.4 PI 后台任务状态更新（receipt 快照 / 终态通知）：会话级状态表合并后，
  // 合成 backgroundTask item 走与 item/updated 相同的 upsert 路径（含 reducer
  // mergeToolItemPreservingSnapshot 语义：title/detail 缺省时保留建卡值）。
  const onBackgroundTaskUpdated = useCallback(
    (
      workspaceId: string,
      threadId: string,
      payload: {
        toolId: string | null;
        task: Record<string, unknown>;
        source: string;
      },
    ) => {
      const result = applyBackgroundTaskUpdate(workspaceId, threadId, payload);
      if (!result) {
        return;
      }
      // skipTurnTerminalGuard：post-settle 后台任务终态是合法迟到事件——
      // 合成 item 无 turnId，会命中「无 id 分支」的 settled 线程守卫被丢弃
      // （时间线卡片永停运行中）。shouldMarkProcessing 必须为 false：绕过
      // 守卫后 markProcessing(true) 会把已 settle 的会话复燃成「响应中」
      // 且无人再发 false（2026-08-28 真机回归）。
      handleItemUpdate(workspaceId, threadId, result.item, false, false, {
        skipTurnTerminalGuard: true,
      });
    },
    [handleItemUpdate],
  );

  // P2 registry watcher sink：与 onBackgroundTaskUpdated 同构（store 合并 +
  // reducer upsert），保证 registry 兜底路径下 timeline 卡片与 pill 同步翻终态。
  useEffect(() => {
    setBackgroundTaskUpdateSink(onBackgroundTaskUpdated);
    return () => {
      setBackgroundTaskUpdateSink(null);
    };
  }, [onBackgroundTaskUpdated]);

  const onReasoningSummaryDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      engineHint?: ReasoningEngineHint,
      turnId?: string | null,
    ) => {
      logReasoningRoute("reasoning-summary-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
      });
      if (
        workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)
      ) {
        logClaudeStream("reasoning-summary-delta-skipped", {
          workspaceId,
          threadId,
          itemId,
          deltaLength: delta.length,
          textPreview: createDebugPreview(delta),
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      enqueueRealtimeDeltaOperation({
        kind: "reasoningSummaryDelta",
        workspaceId,
        threadId,
        itemId,
        delta,
        engineHint,
        turnId,
      });
      logClaudeStream("reasoning-summary-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
        textPreview: createDebugPreview(delta),
      });
    },
    [
      enqueueRealtimeDeltaOperation,
      interruptedThreadsRef,
      logClaudeStream,
      logReasoningRoute,
    ],
  );

  const onReasoningSummaryBoundary = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      engineHint?: ReasoningEngineHint,
      turnId?: string | null,
    ) => {
      logReasoningRoute("reasoning-summary-boundary", {
        workspaceId,
        threadId,
        itemId,
      });
      if (
        workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)
      ) {
        logClaudeStream("reasoning-summary-boundary-skipped", {
          workspaceId,
          threadId,
          itemId,
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      enqueueRealtimeDeltaOperation({
        kind: "reasoningSummaryBoundary",
        workspaceId,
        threadId,
        itemId,
        engineHint,
        turnId,
      });
      logClaudeStream("reasoning-summary-boundary", {
        workspaceId,
        threadId,
        itemId,
      });
    },
    [
      enqueueRealtimeDeltaOperation,
      interruptedThreadsRef,
      logClaudeStream,
      logReasoningRoute,
    ],
  );

  const onReasoningTextDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      engineHint?: ReasoningEngineHint,
      turnId?: string | null,
    ) => {
      logReasoningRoute("reasoning-text-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
      });
      if (
        workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)
      ) {
        logClaudeStream("reasoning-text-delta-skipped", {
          workspaceId,
          threadId,
          itemId,
          deltaLength: delta.length,
          textPreview: createDebugPreview(delta),
          skipped: true,
          reason: "interrupted-thread",
        });
        return;
      }
      enqueueRealtimeDeltaOperation({
        kind: "reasoningContentDelta",
        workspaceId,
        threadId,
        itemId,
        delta,
        engineHint,
        turnId,
      });
      logClaudeStream("reasoning-text-delta", {
        workspaceId,
        threadId,
        itemId,
        deltaLength: delta.length,
        textPreview: createDebugPreview(delta),
      });
    },
    [
      enqueueRealtimeDeltaOperation,
      interruptedThreadsRef,
      logClaudeStream,
      logReasoningRoute,
    ],
  );

  const onCommandOutputDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      handleToolOutputDelta(
        workspaceId,
        threadId,
        itemId,
        delta,
        "commandExecution",
        turnId,
      );
    },
    [handleToolOutputDelta],
  );

  const onTerminalInteraction = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      stdin: string,
      turnId?: string | null,
    ) => {
      handleTerminalInteraction(workspaceId, threadId, itemId, stdin, turnId);
    },
    [handleTerminalInteraction],
  );

  const onFileChangeOutputDelta = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      handleToolOutputDelta(
        workspaceId,
        threadId,
        itemId,
        delta,
        "fileChange",
        turnId,
      );
    },
    [handleToolOutputDelta],
  );

  const onNormalizedRealtimeEvent = useCallback(
    (event: NormalizedThreadEvent) => {
      const { workspaceId, threadId } = event;
      if (isInterruptedThread(interruptedThreadsRef, workspaceId, threadId)) {
        return;
      }
      const hasCustomName = Boolean(getCustomName(workspaceId, threadId));
      const normalizedItem =
        event.item.kind === "message" &&
        event.item.role === "user" &&
        !event.item.collaborationMode
          ? {
              ...event.item,
              collaborationMode: resolveCollaborationUiMode?.(threadId) ?? null,
            }
          : event.item;
      const normalizedEvent =
        normalizedItem === event.item
          ? event
          : {
              ...event,
              item: normalizedItem,
            };
      const operation = {
        event: normalizedEvent,
        hasCustomName,
      } satisfies PendingNormalizedRealtimeOperation;
      if (
        shouldBatchNormalizedRealtimeEvent(normalizedEvent) ||
        (enableRealtimeBatchingRef.current &&
          shouldUseContractRealtimeBatcher(normalizedEvent))
      ) {
        enqueueNormalizedRealtimeEvent(operation);
        return;
      }
      flushNormalizedRealtimeOps();
      applyNormalizedRealtimeEventNow(operation, {
        useTransitionForDispatch:
          normalizedEvent.operation !== "completeAgentMessage",
      });
    },
    [
      applyNormalizedRealtimeEventNow,
      enqueueNormalizedRealtimeEvent,
      flushNormalizedRealtimeOps,
      getCustomName,
      interruptedThreadsRef,
      resolveCollaborationUiMode,
    ],
  );

  return {
    onAgentMessageDelta,
    onAgentMessageCompleted,
    onItemStarted,
    onItemUpdated,
    onItemCompleted,
    onBackgroundTaskUpdated,
    onNormalizedRealtimeEvent,
    onReasoningSummaryDelta,
    onReasoningSummaryBoundary,
    onReasoningTextDelta,
    onCommandOutputDelta,
    onTerminalInteraction,
    onFileChangeOutputDelta,
    // §6.4: instrumentation test surface
    __getSubmitScheduleInstrumentationForTests,
    flushPendingRealtimeEvents,
    isRealtimeTurnTerminalExact,
    isRealtimeTurnInFlight,
    noteRealtimeTurnStarted,
    markRealtimeTurnTerminal,
    drainLiveItemDeltasForThread,
  };
}
