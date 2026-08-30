import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";
import { isCodexSubagentActivityItem } from "../utils/codexSubagentIdentity";
import type { NormalizedThreadEvent } from "../contracts/conversationCurtainContracts";
import {
  createRealtimeEventBatcher,
  type RealtimeBatcherFlush,
  type RealtimeBatcherFlushReason,
} from "../contracts/realtimeEventBatcher";
import { isSalvageableTerminalAssistantComplete } from "../contracts/realtimeEventContract";
import { asString } from "../utils/threadNormalize";
import type { ConversationItem } from "../../../types";
import type { ThreadAction } from "./useThreadsReducer";
import { noteRealtimeCoalescedFlush } from "../utils/streamLatencyDiagnostics";
import { recordHotspotSample } from "../../../services/perfBaseline/hotspotTracker";
import {
  canProgressEventStartProcessing,
  readHighResolutionNowMs,
} from "./threadItemEventPredicates";

const NORMALIZED_REALTIME_BATCH_FLUSH_MS = 32;

export type PendingNormalizedRealtimeOperation = {
  event: NormalizedThreadEvent;
  hasCustomName: boolean;
};

function isCodexAssistantMessageItem(
  item: NormalizedThreadEvent["item"],
): item is Extract<ConversationItem, { kind: "message"; role: "assistant" }> {
  return item.kind === "message" && item.role === "assistant";
}

export function shouldBatchNormalizedRealtimeEvent(event: NormalizedThreadEvent) {
  return (
    (isCodexAssistantMessageItem(event.item) &&
      (event.operation === "itemStarted" ||
        event.operation === "itemUpdated")) ||
    event.operation === "appendReasoningContentDelta" ||
    event.operation === "appendReasoningSummaryDelta" ||
    event.operation === "appendToolOutputDelta"
  );
}

export function shouldUseContractRealtimeBatcher(event: NormalizedThreadEvent) {
  return event.operation === "appendAgentMessageDelta";
}

export function shouldUrgentlyDispatchReasoningDelta(
  event: NormalizedThreadEvent,
  flushReason: RealtimeBatcherFlushReason,
) {
  return (
    event.operation === "appendReasoningContentDelta" &&
    flushReason === "first-token"
  );
}

function shouldDispatchNormalizedRealtimeEventUrgently(
  event: NormalizedThreadEvent,
  flushReason: RealtimeBatcherFlushReason,
) {
  return (
    event.operation === "appendAgentMessageDelta" ||
    shouldUrgentlyDispatchReasoningDelta(event, flushReason)
  );
}

function buildPendingNormalizedRealtimeOperationKey(
  event: NormalizedThreadEvent,
) {
  return `${event.threadId}\u0000${event.item.kind}\u0000${event.item.id}`;
}

export function normalizeTurnId(value: unknown) {
  return asString(value).trim();
}

export function extractTurnIdFromRawItem(item: Record<string, unknown>) {
  const turn =
    item.turn && typeof item.turn === "object"
      ? (item.turn as Record<string, unknown>)
      : null;
  return normalizeTurnId(
    item.turnId ??
      item.turn_id ??
      turn?.id ??
      turn?.turnId ??
      turn?.turn_id ??
      "",
  );
}

function extractTurnIdFromNormalizedRealtimeEvent(
  event: NormalizedThreadEvent,
) {
  const eventTurnId = normalizeTurnId(event.turnId);
  if (eventTurnId) {
    return eventTurnId;
  }
  if (!event.rawItem) {
    return "";
  }
  return extractTurnIdFromRawItem(event.rawItem);
}

type UseNormalizedRealtimePipelineParams = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  recordThreadActivity: (
    workspaceId: string,
    threadId: string,
    timestamp?: number,
  ) => void;
  scheduleRealtimeDispatch: (run: () => void) => void;
  applyCollabThreadLinks: (
    threadId: string,
    item: Record<string, unknown>,
    workspaceId?: string,
  ) => void;
  onAgentMessageCompletedExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId?: string | null;
    itemId: string;
    text: string;
  }) => void;
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

export function useNormalizedRealtimePipeline({
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
}: UseNormalizedRealtimePipelineParams) {
  const pendingNormalizedRealtimeOpsRef = useRef<
    Map<string, PendingNormalizedRealtimeOperation>
  >(new Map());
  const normalizedRealtimeBatcherRef = useRef(createRealtimeEventBatcher());
  const normalizedRealtimeFlushTimerRef = useRef<number | null>(null);
  const isFlushingNormalizedRealtimeOpsRef = useRef(false);

  const dispatchNormalizedRealtimeEvent = useCallback(
    (
      normalizedEvent: NormalizedThreadEvent,
      hasCustomName: boolean,
      options: {
        ensuredThreads?: Set<string>;
        markedProcessingThreads?: Set<string>;
        useTransitionForDispatch?: boolean;
        allowTerminalCompleteSalvage?: boolean;
      } = {},
    ) => {
      const { ensuredThreads, markedProcessingThreads } = options;
      const eventTurnId =
        extractTurnIdFromNormalizedRealtimeEvent(normalizedEvent);
      const isEventTurnTerminal = () =>
        isRealtimeTurnTerminal(normalizedEvent.threadId, eventTurnId);
      const shouldMarkProcessing =
        normalizedEvent.operation !== "itemCompleted";
      const markProcessingIfNeeded = () => {
        if (!shouldMarkProcessing) {
          return;
        }
        if (!canProgressEventStartProcessing(normalizedEvent.engine)) {
          return;
        }
        if (markedProcessingThreads?.has(normalizedEvent.threadId)) {
          return;
        }
        if (isEventTurnTerminal()) {
          return;
        }
        markProcessing(normalizedEvent.threadId, true);
        markedProcessingThreads?.add(normalizedEvent.threadId);
      };
      const run = (runOptions: { skipProcessingMark?: boolean } = {}) => {
        // fix-turn-terminal-live-text-commit-loss：terminal barrier 之后到达的
        // 非空 assistant 终稿改为 salvage 落盘（reducer merge 取更长者），不再
        // 静默丢全文。processing 复燃由 markProcessingIfNeeded 内部的
        // isEventTurnTerminal 早退天然防住。
        if (
          isEventTurnTerminal() &&
          !(
            options.allowTerminalCompleteSalvage === true &&
            isSalvageableTerminalAssistantComplete(normalizedEvent)
          )
        ) {
          droppedLateRealtimeEventCountRef.current += 1;
          return;
        }
        if (!ensuredThreads?.has(normalizedEvent.threadId)) {
          dispatch({
            type: "ensureThread",
            workspaceId: normalizedEvent.workspaceId,
            threadId: normalizedEvent.threadId,
            engine: normalizedEvent.engine,
          });
          ensuredThreads?.add(normalizedEvent.threadId);
        }
        if (!runOptions.skipProcessingMark) {
          markProcessingIfNeeded();
        }
        dispatch({
          type: "applyNormalizedRealtimeEvent",
          workspaceId: normalizedEvent.workspaceId,
          threadId: normalizedEvent.threadId,
          event: normalizedEvent,
          hasCustomName,
        });
        if (
          normalizedEvent.operation === "completeAgentMessage" &&
          normalizedEvent.item.kind === "message" &&
          normalizedEvent.item.role === "assistant"
        ) {
          const timestamp = Date.now();
          dispatch({
            type: "setThreadTimestamp",
            workspaceId: normalizedEvent.workspaceId,
            threadId: normalizedEvent.threadId,
            timestamp,
          });
          dispatch({
            type: "setLastAgentMessage",
            threadId: normalizedEvent.threadId,
            text: normalizedEvent.item.text,
            timestamp,
          });
          if (normalizedEvent.threadId !== activeThreadId) {
            dispatch({
              type: "markUnread",
              threadId: normalizedEvent.threadId,
              hasUnread: true,
            });
          }
          recordThreadActivity(
            normalizedEvent.workspaceId,
            normalizedEvent.threadId,
            timestamp,
          );
        }
      };
      if (options.useTransitionForDispatch === false) {
        run();
        return;
      }
      markProcessingIfNeeded();
      scheduleRealtimeDispatch(() => run({ skipProcessingMark: true }));
    },
    [
      activeThreadId,
      dispatch,
      isRealtimeTurnTerminal,
      markProcessing,
      recordThreadActivity,
      scheduleRealtimeDispatch,
    ],
  );

  const runNormalizedRealtimeEventSideEffects = useCallback(
    (
      normalizedEvent: NormalizedThreadEvent,
      options: {
        skipMessageActivity?: boolean;
      } = {},
    ) => {
      if (normalizedEvent.rawItem) {
        if (isCodexSubagentActivityItem(normalizedEvent.rawItem)) {
          applyCollabThreadLinks(
            normalizedEvent.threadId,
            normalizedEvent.rawItem,
            normalizedEvent.workspaceId,
          );
        } else {
          applyCollabThreadLinks(
            normalizedEvent.threadId,
            normalizedEvent.rawItem,
          );
        }
      }
      if (
        normalizedEvent.operation === "completeAgentMessage" &&
        normalizedEvent.item.kind === "message" &&
        normalizedEvent.item.role === "assistant"
      ) {
        onAgentMessageCompletedExternal?.({
          workspaceId: normalizedEvent.workspaceId,
          threadId: normalizedEvent.threadId,
          ...(normalizedEvent.turnId ? { turnId: normalizedEvent.turnId } : {}),
          itemId: normalizedEvent.item.id,
          text: normalizedEvent.item.text,
        });
      }
      if (!options.skipMessageActivity) {
        safeMessageActivity();
      }
    },
    [
      applyCollabThreadLinks,
      onAgentMessageCompletedExternal,
      safeMessageActivity,
    ],
  );

  const applyNormalizedRealtimeEventNow = useCallback(
    (
      operation: PendingNormalizedRealtimeOperation,
      options: {
        ensuredThreads?: Set<string>;
        markedProcessingThreads?: Set<string>;
        useTransitionForDispatch?: boolean;
        skipMessageActivity?: boolean;
      } = {},
    ) => {
      // fix-turn-terminal-live-text-commit-loss：非空 assistant 终稿即使在
      // terminal barrier 之后到达也要放行，由 dispatch 层按 salvage 同步合入，
      // 避免 normalized 路由（codex/shared/agent-canvas）终稿被静默丢弃。
      const allowTerminalCompleteSalvage =
        isSalvageableTerminalAssistantComplete(operation.event);
      if (
        isRealtimeTurnTerminal(
          operation.event.threadId,
          extractTurnIdFromNormalizedRealtimeEvent(operation.event),
        ) &&
        !allowTerminalCompleteSalvage
      ) {
        return;
      }
      dispatchNormalizedRealtimeEvent(
        operation.event,
        operation.hasCustomName,
        {
          ensuredThreads: options.ensuredThreads,
          markedProcessingThreads: options.markedProcessingThreads,
          useTransitionForDispatch: options.useTransitionForDispatch,
          allowTerminalCompleteSalvage,
        },
      );
      runNormalizedRealtimeEventSideEffects(operation.event, {
        skipMessageActivity: options.skipMessageActivity,
      });
    },
    [
      dispatchNormalizedRealtimeEvent,
      isRealtimeTurnTerminal,
      runNormalizedRealtimeEventSideEffects,
    ],
  );

  const flushNormalizedRealtimeOps = useCallback(() => {
    if (isFlushingNormalizedRealtimeOpsRef.current) {
      return;
    }
    if (normalizedRealtimeFlushTimerRef.current !== null) {
      window.clearTimeout(normalizedRealtimeFlushTimerRef.current);
      normalizedRealtimeFlushTimerRef.current = null;
    }
    if (pendingNormalizedRealtimeOpsRef.current.size === 0) {
      return;
    }
    isFlushingNormalizedRealtimeOpsRef.current = true;
    const flushStartedAt = readHighResolutionNowMs();
    let flushedOpCount = 0;
    try {
      const bufferedOps = Array.from(
        pendingNormalizedRealtimeOpsRef.current.values(),
      );
      pendingNormalizedRealtimeOpsRef.current.clear();
      flushedOpCount = bufferedOps.length;
      const ensuredThreads = new Set<string>();
      const markedProcessingThreads = new Set<string>();
      for (const operation of bufferedOps) {
        applyNormalizedRealtimeEventNow(operation, {
          ensuredThreads,
          markedProcessingThreads,
          useTransitionForDispatch: false,
          skipMessageActivity: true,
        });
      }
      safeMessageActivity();
    } finally {
      isFlushingNormalizedRealtimeOpsRef.current = false;
      recordHotspotSample(
        "normalized-realtime-flush",
        readHighResolutionNowMs() - flushStartedAt,
        `ops=${flushedOpCount}`,
      );
    }
  }, [applyNormalizedRealtimeEventNow, safeMessageActivity]);

  const applyNormalizedRealtimeBatcherFlushes = useCallback(
    (
      flushes: readonly RealtimeBatcherFlush[],
      operation: PendingNormalizedRealtimeOperation,
    ) => {
      if (flushes.length === 0) {
        return;
      }
      flushNormalizedRealtimeOps();
      const ensuredThreads = new Set<string>();
      const markedProcessingThreads = new Set<string>();
      const flushEndedAt = Date.now();
      for (const flush of flushes) {
        // Reconstruct the batch wait window from event timestamps, but measure
        // actual route work separately so evidence does not treat long streams
        // as one giant route operation.
        let batchStart = flushEndedAt;
        for (const event of flush.events) {
          if (
            typeof event.timestampMs === "number" &&
            event.timestampMs < batchStart
          ) {
            batchStart = event.timestampMs;
          }
        }
        const routeStartedAt = readHighResolutionNowMs();
        for (const event of flush.events) {
          const useTransitionForDispatch =
            flush.reason !== "terminal" &&
            !shouldDispatchNormalizedRealtimeEventUrgently(event, flush.reason);
          applyNormalizedRealtimeEventNow(
            {
              event,
              hasCustomName: operation.hasCustomName,
            },
            {
              ensuredThreads,
              markedProcessingThreads,
              useTransitionForDispatch,
              skipMessageActivity: false,
            },
          );
        }
        const routeEndedAt = readHighResolutionNowMs();
        recordHotspotSample(
          "codex-batcher-flush",
          routeEndedAt - routeStartedAt,
          `${flush.reason} events=${flush.events.length}`,
        );
        noteRealtimeCoalescedFlush({
          reason: flush.reason,
          eventCount: flush.events.length,
          engine: operation.event.engine,
          workspaceId: operation.event.workspaceId,
          threadId: operation.event.threadId,
          turnId: operation.event.turnId ?? null,
          itemKind: operation.event.itemKind,
          startedAt: batchStart,
          endedAt: flushEndedAt,
          routeStartedAt: Math.round(routeStartedAt),
          routeEndedAt: Math.round(routeEndedAt),
          queueDepthAfter: 0,
        });
      }
    },
    [applyNormalizedRealtimeEventNow, flushNormalizedRealtimeOps],
  );

  const enqueueNormalizedRealtimeEvent = useCallback(
    (operation: PendingNormalizedRealtimeOperation) => {
      if (!enableRealtimeBatchingRef.current) {
        applyNormalizedRealtimeEventNow(operation, {
          useTransitionForDispatch: false,
        });
        return;
      }
      if (
        isCodexAssistantMessageItem(operation.event.item) &&
        (operation.event.operation === "itemStarted" ||
          operation.event.operation === "itemUpdated")
      ) {
        pendingNormalizedRealtimeOpsRef.current.set(
          buildPendingNormalizedRealtimeOperationKey(operation.event),
          operation,
        );
        if (normalizedRealtimeFlushTimerRef.current !== null) {
          return;
        }
        normalizedRealtimeFlushTimerRef.current = window.setTimeout(() => {
          flushNormalizedRealtimeOps();
        }, NORMALIZED_REALTIME_BATCH_FLUSH_MS);
        return;
      }
      const flushes = normalizedRealtimeBatcherRef.current.push(
        operation.event,
      );
      if (flushes.some((flush) => flush.reason === "first-token")) {
        for (const flush of flushes) {
          for (const event of flush.events) {
            applyNormalizedRealtimeEventNow(
              {
                event,
                hasCustomName: operation.hasCustomName,
              },
              {
                useTransitionForDispatch:
                  !shouldDispatchNormalizedRealtimeEventUrgently(
                    event,
                    flush.reason,
                  ),
              },
            );
          }
        }
        return;
      }
      applyNormalizedRealtimeBatcherFlushes(flushes, operation);
      if (normalizedRealtimeFlushTimerRef.current !== null) {
        return;
      }
      normalizedRealtimeFlushTimerRef.current = window.setTimeout(() => {
        const flush = normalizedRealtimeBatcherRef.current.flush("cadence");
        if (flush) {
          applyNormalizedRealtimeBatcherFlushes([flush], operation);
        }
      }, NORMALIZED_REALTIME_BATCH_FLUSH_MS);
    },
    [
      applyNormalizedRealtimeBatcherFlushes,
      applyNormalizedRealtimeEventNow,
      flushNormalizedRealtimeOps,
    ],
  );

  const flushNormalizedRealtimeOpsForThread = useCallback(
    (threadId: string) => {
      const matchingOperations: PendingNormalizedRealtimeOperation[] = [];
      for (const [
        operationKey,
        operation,
      ] of pendingNormalizedRealtimeOpsRef.current) {
        if (operation.event.threadId !== threadId) {
          continue;
        }
        pendingNormalizedRealtimeOpsRef.current.delete(operationKey);
        matchingOperations.push(operation);
      }
      if (matchingOperations.length === 0) {
        return;
      }
      if (
        pendingNormalizedRealtimeOpsRef.current.size === 0 &&
        normalizedRealtimeFlushTimerRef.current !== null
      ) {
        window.clearTimeout(normalizedRealtimeFlushTimerRef.current);
        normalizedRealtimeFlushTimerRef.current = null;
      }
      for (const operation of matchingOperations) {
        applyNormalizedRealtimeEventNow(operation, {
          useTransitionForDispatch: false,
        });
      }
    },
    [applyNormalizedRealtimeEventNow],
  );

  return {
    pendingNormalizedRealtimeOpsRef,
    normalizedRealtimeBatcherRef,
    normalizedRealtimeFlushTimerRef,
    flushNormalizedRealtimeOps,
    flushNormalizedRealtimeOpsForThread,
    enqueueNormalizedRealtimeEvent,
    applyNormalizedRealtimeEventNow,
  };
}
