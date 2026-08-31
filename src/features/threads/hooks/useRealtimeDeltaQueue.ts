import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { WorkspaceScopedMap } from "./workspaceScopedMap";
import {
  appendLiveItemDelta,
  type LiveItemDeltaLane,
} from "../utils/liveItemDeltaChannel";
import { getNativeTurnIngestMeta } from "../utils/nativeTurnTargetLedger";
import { isLiveDeltaExternalizationEnabled } from "../utils/realtimePerfFlags";
import { noteThreadReducerWorkMeasured } from "../utils/streamLatencyDiagnostics";
import { recordHotspotSample } from "../../../services/perfBaseline/hotspotTracker";
import { inferEngineFromLegacyThreadId } from "../contracts/engineRuntimeIdentity";
import type { ThreadAction } from "./useThreadsReducer";
import {
  canProgressEventStartProcessing,
  isDshEventThread,
  isGeminiEventThread,
  isGrokEventThread,
  isInterruptedThread,
  isKimiEventThread,
  isPiEventThread,
  isQoderEventThread,
  readHighResolutionNowMs,
  type ReasoningEngineHint,
} from "./threadItemEventPredicates";

// A4 二期：reasoningContent / reasoningSummary / toolOutput 三类电报外部化
//（liveItemDeltaChannel）。同样模块加载时读一次，翻转 flag 需刷新页面。
const LIVE_DELTA_EXTERNALIZATION_ENABLED = isLiveDeltaExternalizationEnabled();

const inferEngineFromThreadId = inferEngineFromLegacyThreadId;

type RealtimeDeltaOperation =
  | {
      kind: "agentDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      turnId?: string | null;
    }
  | {
      kind: "reasoningSummaryDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      engineHint?: ReasoningEngineHint;
      turnId?: string | null;
    }
  | {
      kind: "reasoningSummaryBoundary";
      workspaceId: string;
      threadId: string;
      itemId: string;
      engineHint?: ReasoningEngineHint;
      turnId?: string | null;
    }
  | {
      kind: "reasoningContentDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      engineHint?: ReasoningEngineHint;
      turnId?: string | null;
    }
  | {
      kind: "toolOutputDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      turnId?: string | null;
      toolType?: "commandExecution" | "fileChange";
    };

// 32ms (~30 flush/s)：12ms 时顶层 thread reducer 每秒最高 dispatch ~83 次，
// 每次 flush 都触发 app-shell 大子树 re-render，是流式卡顿的放大器。
// 视觉平滑度由 Markdown streaming throttle + progressive reveal 保证。
// A4 二期：liveDeltaExternalization 开时 reasoning/toolOutput 三类 delta
// 不再入此队列（走 liveItemDeltaChannel 48ms 节奏，见 enqueueRealtimeDeltaOperation）。
const REALTIME_DELTA_BATCH_FLUSH_MS = 32;

type UseRealtimeDeltaQueueParams = {
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  resolveCanonicalThreadId?: (threadId: string) => string;
  safeMessageActivity: () => void;
  isRealtimeTurnTerminal: (
    threadId: string,
    turnId?: string | null,
    options?: {
      allowActiveTurnFallback?: boolean;
    },
  ) => boolean;
  droppedLateRealtimeEventCountRef: MutableRefObject<number>;
  enableRealtimeBatchingRef: MutableRefObject<boolean>;
};

export function useRealtimeDeltaQueue({
  dispatch,
  getCustomName,
  interruptedThreadsRef,
  markProcessing,
  resolveCanonicalThreadId,
  safeMessageActivity,
  isRealtimeTurnTerminal,
  droppedLateRealtimeEventCountRef,
  enableRealtimeBatchingRef,
}: UseRealtimeDeltaQueueParams) {
  const pendingRealtimeDeltaOpsRef = useRef<RealtimeDeltaOperation[]>([]);
  const realtimeFlushTimerRef = useRef<number | null>(null);
  const isFlushingRealtimeDeltaOpsRef = useRef(false);

  const applyRealtimeDeltaOperation = useCallback(
    (
      operation: RealtimeDeltaOperation,
      context?: {
        ensuredThreads?: Set<string>;
        markedProcessingThreads?: Set<string>;
      },
    ) => {
      const threadId =
        resolveCanonicalThreadId?.(operation.threadId) ?? operation.threadId;
      if (
        isInterruptedThread(
          interruptedThreadsRef,
          operation.workspaceId,
          threadId,
        )
      ) {
        return;
      }
      if (isRealtimeTurnTerminal(threadId, operation.turnId)) {
        droppedLateRealtimeEventCountRef.current += 1;
        return;
      }
      // A4 二期：flag 开时三类文本 delta 先累积进 liveItemDeltaChannel。
      // 非首条直接返回——不打根 dispatch（连 ensureThread 也不发），订阅行按
      // 通道 48ms 节奏渲染；首条落回原路径建壳，保证 durable item 存在、key
      // 稳定（与 A4 正文同款做法）。reasoningSummaryBoundary 是边界事件
      //（每回合仅几次，不是 30 次/秒的来源），不在此列，仍走原 dispatch。
      if (
        LIVE_DELTA_EXTERNALIZATION_ENABLED &&
        (operation.kind === "reasoningContentDelta" ||
          operation.kind === "reasoningSummaryDelta" ||
          operation.kind === "toolOutputDelta")
      ) {
        const lane: LiveItemDeltaLane =
          operation.kind === "reasoningContentDelta"
            ? "reasoningContent"
            : operation.kind === "reasoningSummaryDelta"
              ? "reasoningSummary"
              : "toolOutput";
        const { isFirst } = appendLiveItemDelta(
          threadId,
          operation.itemId,
          lane,
          operation.delta,
          operation.kind === "toolOutputDelta" ? operation.toolType : undefined,
        );
        if (!isFirst) {
          return;
        }
      }
      const ensuredThreads = context?.ensuredThreads;
      const markedProcessingThreads = context?.markedProcessingThreads;
      if (!ensuredThreads || !ensuredThreads.has(threadId)) {
        dispatch({
          type: "ensureThread",
          workspaceId: operation.workspaceId,
          threadId,
          engine: inferEngineFromThreadId(threadId),
        });
        ensuredThreads?.add(threadId);
      }
      const reasoningEngineHint =
        "engineHint" in operation ? operation.engineHint : undefined;
      const isGeminiReasoningDelta =
        (isGeminiEventThread(threadId, reasoningEngineHint) ||
          isGrokEventThread(threadId, reasoningEngineHint) ||
          isKimiEventThread(threadId, reasoningEngineHint) ||
          isPiEventThread(threadId, reasoningEngineHint) ||
          isQoderEventThread(threadId, reasoningEngineHint) ||
          isDshEventThread(threadId, reasoningEngineHint)) &&
        (operation.kind === "reasoningSummaryDelta" ||
          operation.kind === "reasoningSummaryBoundary" ||
          operation.kind === "reasoningContentDelta");
      if (
        !isGeminiReasoningDelta &&
        canProgressEventStartProcessing(inferEngineFromThreadId(threadId)) &&
        (!markedProcessingThreads || !markedProcessingThreads.has(threadId))
      ) {
        markProcessing(threadId, true);
        markedProcessingThreads?.add(threadId);
      }

      if (operation.kind === "agentDelta") {
        const dispatchStartedAt = readHighResolutionNowMs();
        dispatch({
          type: "appendAgentDelta",
          workspaceId: operation.workspaceId,
          threadId,
          itemId: operation.itemId,
          delta: operation.delta,
          hasCustomName: Boolean(
            getCustomName(operation.workspaceId, threadId),
          ),
          ...getNativeTurnIngestMeta(operation.workspaceId, threadId),
        });
        const dispatchCostMs = readHighResolutionNowMs() - dispatchStartedAt;
        noteThreadReducerWorkMeasured(threadId, {
          itemId: operation.itemId,
          textLength: operation.delta.length,
          mergeCostMs: dispatchCostMs,
          normalizationCostMs: dispatchCostMs,
        });
        return;
      }
      if (operation.kind === "reasoningSummaryDelta") {
        dispatch({
          type: "appendReasoningSummary",
          threadId,
          itemId: operation.itemId,
          delta: operation.delta,
        });
        return;
      }
      if (operation.kind === "reasoningSummaryBoundary") {
        dispatch({
          type: "appendReasoningSummaryBoundary",
          threadId,
          itemId: operation.itemId,
        });
        return;
      }
      if (operation.kind === "reasoningContentDelta") {
        dispatch({
          type: "appendReasoningContent",
          threadId,
          itemId: operation.itemId,
          delta: operation.delta,
        });
        return;
      }

      dispatch({
        type: "appendToolOutput",
        threadId,
        itemId: operation.itemId,
        delta: operation.delta,
      });
    },
    [
      dispatch,
      getCustomName,
      interruptedThreadsRef,
      isRealtimeTurnTerminal,
      markProcessing,
      resolveCanonicalThreadId,
    ],
  );

  const flushRealtimeDeltaOps = useCallback(() => {
    if (!enableRealtimeBatchingRef.current) {
      return;
    }
    if (isFlushingRealtimeDeltaOpsRef.current) {
      return;
    }
    if (realtimeFlushTimerRef.current !== null) {
      window.clearTimeout(realtimeFlushTimerRef.current);
      realtimeFlushTimerRef.current = null;
    }
    if (pendingRealtimeDeltaOpsRef.current.length === 0) {
      return;
    }
    isFlushingRealtimeDeltaOpsRef.current = true;
    const flushStartedAt = readHighResolutionNowMs();
    let flushedOpCount = 0;
    try {
      const bufferedOps = pendingRealtimeDeltaOpsRef.current;
      pendingRealtimeDeltaOpsRef.current = [];
      flushedOpCount = bufferedOps.length;
      const ensuredThreads = new Set<string>();
      const markedProcessingThreads = new Set<string>();
      for (const operation of bufferedOps) {
        applyRealtimeDeltaOperation(operation, {
          ensuredThreads,
          markedProcessingThreads,
        });
      }
      safeMessageActivity();
    } finally {
      isFlushingRealtimeDeltaOpsRef.current = false;
      recordHotspotSample(
        "realtime-delta-flush",
        readHighResolutionNowMs() - flushStartedAt,
        `ops=${flushedOpCount}`,
      );
    }
  }, [applyRealtimeDeltaOperation, safeMessageActivity]);

  const flushRealtimeDeltaOpsForThread = useCallback(
    (threadId: string) => {
      if (isFlushingRealtimeDeltaOpsRef.current) {
        return;
      }
      const matchingOperations: RealtimeDeltaOperation[] = [];
      const deferredOperations: RealtimeDeltaOperation[] = [];
      for (const operation of pendingRealtimeDeltaOpsRef.current) {
        if (operation.threadId === threadId) {
          matchingOperations.push(operation);
        } else {
          deferredOperations.push(operation);
        }
      }
      if (matchingOperations.length === 0) {
        return;
      }
      pendingRealtimeDeltaOpsRef.current = deferredOperations;
      if (
        deferredOperations.length === 0 &&
        realtimeFlushTimerRef.current !== null
      ) {
        window.clearTimeout(realtimeFlushTimerRef.current);
        realtimeFlushTimerRef.current = null;
      }
      const ensuredThreads = new Set<string>();
      const markedProcessingThreads = new Set<string>();
      for (const operation of matchingOperations) {
        applyRealtimeDeltaOperation(operation, {
          ensuredThreads,
          markedProcessingThreads,
        });
      }
      safeMessageActivity();
    },
    [applyRealtimeDeltaOperation, safeMessageActivity],
  );

  const enqueueRealtimeDeltaOperation = useCallback(
    (operation: RealtimeDeltaOperation, options: { urgent?: boolean } = {}) => {
      if (options.urgent) {
        // 首个 assistant shell 是结构性 lifecycle 事件。先提交已排队的前一段
        // tail，再同步建壳；其它 thread 的队列保持原 cadence。
        flushRealtimeDeltaOpsForThread(operation.threadId);
        applyRealtimeDeltaOperation(operation);
        safeMessageActivity();
        return;
      }
      // A4 二期：flag 开时三类 delta 不再进 32ms 批量队列——liveItemDeltaChannel
      // 自带 48ms 发布节奏，排队只会延迟建壳与通道累积。同步 apply（内部首条
      // 建壳、其余只进通道），urgent 语义仍由上方 urgent 分支保留。
      if (
        LIVE_DELTA_EXTERNALIZATION_ENABLED &&
        (operation.kind === "reasoningContentDelta" ||
          operation.kind === "reasoningSummaryDelta" ||
          operation.kind === "toolOutputDelta")
      ) {
        applyRealtimeDeltaOperation(operation);
        safeMessageActivity();
        return;
      }
      if (!enableRealtimeBatchingRef.current) {
        applyRealtimeDeltaOperation(operation);
        safeMessageActivity();
        return;
      }
      pendingRealtimeDeltaOpsRef.current.push(operation);
      if (realtimeFlushTimerRef.current !== null) {
        return;
      }
      realtimeFlushTimerRef.current = window.setTimeout(() => {
        flushRealtimeDeltaOps();
      }, REALTIME_DELTA_BATCH_FLUSH_MS);
    },
    [
      applyRealtimeDeltaOperation,
      flushRealtimeDeltaOps,
      flushRealtimeDeltaOpsForThread,
      safeMessageActivity,
    ],
  );

  return {
    pendingRealtimeDeltaOpsRef,
    realtimeFlushTimerRef,
    flushRealtimeDeltaOps,
    flushRealtimeDeltaOpsForThread,
    enqueueRealtimeDeltaOperation,
  };
}
