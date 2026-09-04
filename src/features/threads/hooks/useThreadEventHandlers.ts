import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import { workspaceScopedHas } from "./workspaceScopedMap";
import type {
  AppServerEvent,
  CollaborationModeBlockedRequest,
  CollaborationModeResolvedRequest,
  RequestUserInputRequest,
} from "../../../types";
import { useThreadApprovalEvents } from "./useThreadApprovalEvents";
import { useThreadItemEvents } from "./useThreadItemEvents";
import { useThreadBackgroundTaskStatusSync } from "../utils/threadBackgroundTaskStatusSync";
import { useBackgroundTaskRegistryWatcherForRunningThreads } from "../../messages/utils/useBackgroundTaskRegistryWatcher";
import { isSalvageableTerminalAssistantComplete } from "../contracts/realtimeEventContract";
import { useThreadTurnEvents } from "./useThreadTurnEvents";
import { useThreadUserInputEvents } from "./useThreadUserInputEvents";
import { useTurnDiagnosticsRuntime } from "./useTurnDiagnosticsRuntime";
import { useTurnLifecycleHandlers } from "./useTurnLifecycleHandlers";
import { useDeferredCompletionReconciliation } from "./useDeferredCompletionReconciliation";
import { drainLiveAssistantTextTail } from "../utils/liveAssistantTextChannel";
import type { NormalizedThreadEvent } from "../contracts/conversationCurtainContracts";
import type { ThreadEventHandlersOptions } from "./threadEventHandlerTypes";
import { handleThreadAppServerEventDiagnostics } from "./threadAppServerEventDiagnostics";
import {
  asString,
  extractTurnIdFromRawItem,
  inferRawItemEngine,
  inferThreadEngine,
  isRequestUserInputModeBlocked,
} from "./threadEventDiagnostics";
export { CODEX_EXECUTION_ACTIVE_NO_PROGRESS_STALL_MS, CODEX_TURN_NO_PROGRESS_STALL_MS } from "./threadEventDiagnostics";
export function useThreadEventHandlers({
  activeThreadId,
  dispatch,
  getCustomName,
  resolveCanonicalThreadId,
  resolveCollaborationUiMode,
  isAutoTitlePending,
  isThreadHidden,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  codexCompactionInFlightByThreadRef,
  safeMessageActivity,
  recordThreadActivity,
  pushThreadErrorMessage,
  onDebug,
  onWorkspaceConnected,
  applyCollabThreadLinks,
  approvalAllowlistRef,
  pendingInterruptsRef,
  interruptedThreadsRef,
  renameCustomNameKey,
  renameAutoTitlePendingKey,
  renameThreadTitleMapping,
  resolveClaudeContinuationThreadId,
  resolvePendingThreadForSession,
  resolvePendingThreadForTurn,
  getActiveTurnIdForThread,
  getThreadProviderProfileId,
  hasEstablishedThreadItems,
  renamePendingMemoryCaptureKey,
  onAgentMessageCompletedExternal,
  onTurnCompletedExternal,
  onTurnTerminalExternal,
  onThreadTransientCleanupReady,
  onDurableRealtimeTurnSettlementReady,
  onCollaborationModeResolved,
  onExitPlanModeToolCompleted,
  domainEventController = null,
}: ThreadEventHandlersOptions) {
  // 后台任务 running 计数 → threadStatusById 单订阅 sync（app 级单例挂载，
  // 见 threadBackgroundTaskStatusSync 头注释）。
  useThreadBackgroundTaskStatusSync(dispatch);
  // App 级 registry watcher：枚举所有 running>0 会话探测终态 metadata，
  // 经 sink 全路径回写（store + 时间线卡片 + pill + 会话行）。切走会话
  // 依然兜底（strip 上的旧挂载只探活跃会话，已移除）。
  useBackgroundTaskRegistryWatcherForRunningThreads();
  const diagnostics = useTurnDiagnosticsRuntime({
    activeThreadId,
    dispatch,
    markProcessing,
    setActiveTurnId,
    interruptedThreadsRef,
    onDebug,
    onThreadTransientCleanupReady,
  });
  const {
    turnDiagnosticsRef,
    flushDeferredTurnCompletionRef,
    getThreadLifecycleSnapshot,
    markProcessingTracked,
    setActiveTurnIdTracked,
    emitForegroundSettlementDiagnostic,
    noteCodexTurnProgressEvidence,
    noteNonTextRuntimeProgress,
    shouldSkipCodexTurnEvent,
    captureTurnItemDiagnostic,
    recordAssistantCompletionEvidence,
    recordAssistantStreamIngress,
    maybeRecordAgentMessageSnapshotIngress,
  } = diagnostics;
  const onApprovalRequest = useThreadApprovalEvents({
    dispatch,
    approvalAllowlistRef,
    markProcessing: markProcessingTracked,
    setActiveTurnId: setActiveTurnIdTracked,
    resolveClaudeContinuationThreadId,
  });
  const enqueueUserInputRequest = useThreadUserInputEvents({
    dispatch,
    resolveClaudeContinuationThreadId,
  });
  const flushPendingRealtimeEventsRef = useRef<(() => void) | null>(null);
  const drainLiveItemDeltasForThreadRef = useRef<
    ((threadId: string) => void) | null
  >(null);
  const settleThreadWaitingForUserChoice = useCallback(
    (threadId: string, workspaceId?: string | null) => {
      if (!threadId) {
        return;
      }
      if (workspaceId) {
        flushPendingRealtimeEventsRef.current?.();
        drainLiveItemDeltasForThreadRef.current?.(threadId);
        const liveTextTail = drainLiveAssistantTextTail(threadId);
        if (liveTextTail) {
          dispatch({
            type: "appendAgentDelta",
            workspaceId,
            threadId,
            itemId: liveTextTail.itemId,
            delta: liveTextTail.tailDelta,
            hasCustomName: true,
          });
        }
      }
      // User-choice gates are no longer normal foreground processing.
      markProcessingTracked(threadId, false);
      setActiveTurnIdTracked(threadId, null);
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
    },
    [dispatch, markProcessingTracked, setActiveTurnIdTracked],
  );
  const onRequestUserInput = useCallback(
    (request: RequestUserInputRequest) => {
      enqueueUserInputRequest(request);
      const threadId =
        request.shared_runtime_owner?.sharedThreadId ??
        resolveClaudeContinuationThreadId?.(
          request.workspace_id,
          request.params.thread_id,
          request.params.turn_id,
        ) ??
        request.params.thread_id;
      if (!threadId) {
        return;
      }
      settleThreadWaitingForUserChoice(threadId, request.workspace_id);
    },
    [
      enqueueUserInputRequest,
      resolveClaudeContinuationThreadId,
      settleThreadWaitingForUserChoice,
    ],
  );
  const onModeBlocked = useCallback(
    (event: CollaborationModeBlockedRequest) => {
      const rawThreadId = event.params.thread_id;
      const threadId =
        event.shared_runtime_owner?.sharedThreadId ??
        resolveClaudeContinuationThreadId?.(event.workspace_id, rawThreadId) ??
        rawThreadId;
      if (!threadId) {
        return;
      }
      const requestUserInputBlocked = isRequestUserInputModeBlocked(event);
      const requestId = event.params.request_id;
      if (requestId !== null && requestId !== undefined) {
        dispatch({
          type: "removeUserInputRequest",
          requestId,
          workspaceId: event.workspace_id,
          ...(event.shared_runtime_owner
            ? { sharedRuntimeOwner: event.shared_runtime_owner }
            : {}),
        });
      }
      if (requestUserInputBlocked) {
        settleThreadWaitingForUserChoice(threadId, event.workspace_id);
      }
      const reason =
        event.params.reason.trim() ||
        "This request is blocked while effective mode is code.";
      const suggestion =
        (event.params.suggestion ?? "").trim() ||
        "Switch to Plan mode and retry if user input is required.";
      const blockedMethod = asString(event.params.blocked_method).trim();
      const blockedDetail = blockedMethod || (
        requestUserInputBlocked ? "item/tool/requestUserInput" : "modeBlocked"
      );
      const blockedTitle = requestUserInputBlocked
        ? "Tool: askuserquestion"
        : "Tool: mode policy";
      const eventId = requestId !== null && requestId !== undefined
        ? String(requestId)
        : `${Date.now()}`;
      dispatch({
        type: "upsertItem",
        workspaceId: event.workspace_id,
        threadId,
        item: {
          id: `mode-blocked-${threadId}-${eventId}`,
          kind: "tool",
          toolType: "modeBlocked",
          title: blockedTitle,
          detail: blockedDetail,
          status: "completed",
          output: `${reason}\n\n${suggestion}`,
        },
        hasCustomName: Boolean(getCustomName(event.workspace_id, threadId)),
      });
    },
    [dispatch, getCustomName, resolveClaudeContinuationThreadId, settleThreadWaitingForUserChoice],
  );

  const onModeResolved = useCallback(
    (event: CollaborationModeResolvedRequest) => {
      onCollaborationModeResolved?.(event);
    },
    [onCollaborationModeResolved],
  );

  const {
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
    flushPendingRealtimeEvents,
    isRealtimeTurnTerminalExact,
    isRealtimeTurnInFlight,
    noteRealtimeTurnStarted,
    markRealtimeTurnTerminal,
    drainLiveItemDeltasForThread,
  } = useThreadItemEvents({
    activeThreadId,
    dispatch,
    resolveCanonicalThreadId,
    getCustomName,
    resolveCollaborationUiMode,
    markProcessing: markProcessingTracked,
    markReviewing,
    safeMessageActivity,
    recordThreadActivity,
    applyCollabThreadLinks,
    interruptedThreadsRef,
    onDebug,
    onAgentMessageCompletedExternal,
    onExitPlanModeToolCompleted,
  });
  flushPendingRealtimeEventsRef.current = flushPendingRealtimeEvents;
  drainLiveItemDeltasForThreadRef.current = drainLiveItemDeltasForThread;

  const settleDurableRealtimeTurn = useCallback(
    (threadId: string, runtimeTurnId: string) => {
      const normalizedThreadId = threadId.trim();
      const normalizedRuntimeTurnId = runtimeTurnId.trim();
      if (!normalizedThreadId || !normalizedRuntimeTurnId) {
        return;
      }
      // Durable Shared commit 是 control authority。先收敛已排队内容，再建立
      // exact-turn barrier，后续迟到 event 只能被丢弃，不能复燃 processing。
      flushPendingRealtimeEvents();
      // A4 二期：barrier 建立前把 reasoning/toolOutput 通道尾段灌回 durable
      // items——结算不越过正文（与正文 drain 同一道 terminal causal barrier）。
      drainLiveItemDeltasForThread(normalizedThreadId);
      markRealtimeTurnTerminal(normalizedThreadId, normalizedRuntimeTurnId);
      onDebug?.({
        id: `${Date.now()}-shared-durable-terminal-barrier-installed`,
        timestamp: Date.now(),
        source: "event",
        label: "thread/session:shared-durable-terminal-barrier-installed",
        payload: {
          threadId: normalizedThreadId,
          runtimeTurnId: normalizedRuntimeTurnId,
        },
      });
    },
    [drainLiveItemDeltasForThread, flushPendingRealtimeEvents, markRealtimeTurnTerminal, onDebug],
  );
  useLayoutEffect(() => {
    return onDurableRealtimeTurnSettlementReady?.(settleDurableRealtimeTurn);
  }, [
    onDurableRealtimeTurnSettlementReady,
    settleDurableRealtimeTurn,
  ]);

  const {
    onThreadStarted,
    onTurnStarted,
    onTurnCompleted,
    onTurnPlanUpdated,
    onThreadTokenUsageUpdated: onThreadTokenUsageUpdatedBase,
    onAssistantRuntimeReceipt,
    onAccountRateLimitsUpdated,
    onTurnError,
    onTurnStalled,
    onContextCompacting,
    onContextCompacted,
    onContextCompactionFailed,
    onThreadSessionIdUpdated,
  } = useThreadTurnEvents({
    activeThreadId,
    dispatch,
    getCustomName,
    resolveCanonicalThreadId,
    isAutoTitlePending,
    isThreadHidden,
    markProcessing: markProcessingTracked,
    markReviewing,
    setActiveTurnId: setActiveTurnIdTracked,
    codexCompactionInFlightByThreadRef,
    pendingInterruptsRef,
    interruptedThreadsRef,
    pushThreadErrorMessage,
    safeMessageActivity,
    recordThreadActivity,
    renameCustomNameKey,
    renameAutoTitlePendingKey,
    renameThreadTitleMapping,
    resolvePendingThreadForSession,
    resolvePendingThreadForTurn,
    getActiveTurnIdForThread,
    isTurnInFlightForThread: isRealtimeTurnInFlight,
    getThreadProviderProfileId,
    hasEstablishedThreadItems,
    renamePendingMemoryCaptureKey,
    onDebug,
  });

  const onThreadTokenUsageUpdatedTracked = useCallback(
    (workspaceId: string, threadId: string, tokenUsage: Record<string, unknown>) => {
      onThreadTokenUsageUpdatedBase(workspaceId, threadId, tokenUsage);
      noteCodexTurnProgressEvidence(workspaceId, threadId, "thread-token-usage");
    },
    [noteCodexTurnProgressEvidence, onThreadTokenUsageUpdatedBase],
  );

  const onBackgroundThreadAction = useCallback(
    (workspaceId: string, threadId: string, action: string) => {
      if (action !== "hide") {
        return;
      }
      dispatch({ type: "hideThread", workspaceId, threadId });
    },
    [dispatch],
  );

  const onProcessingHeartbeat = useCallback(
    (_workspaceId: string, threadId: string, pulse: number) => {
      if (!threadId || pulse <= 0) {
        return;
      }
      dispatch({ type: "markHeartbeat", threadId, pulse });
      dispatch({ type: "markContinuationEvidence", threadId, at: Date.now() });
      noteCodexTurnProgressEvidence(_workspaceId, threadId, "processing-heartbeat");
      safeMessageActivity();
    },
    [dispatch, noteCodexTurnProgressEvidence, safeMessageActivity],
  );
  const {
    onTurnStartedTracked,
    onSharedRuntimeTurnStarted,
    onTurnErrorTracked,
    onTurnStalledTracked,
    settleCompletedTurn,
  } = useTurnLifecycleHandlers({
    dispatch,
    diagnostics,
    flushPendingRealtimeEvents,
    drainLiveItemDeltasForThread,
    markRealtimeTurnTerminal,
    noteRealtimeTurnStarted,
    onTurnStarted,
    onTurnCompleted,
    onTurnError,
    onTurnStalled,
    pendingInterruptsRef,
    interruptedThreadsRef,
    onTurnCompletedExternal,
    onTurnTerminalExternal,
    domainEventController,
  });
  const { onTurnCompletedTracked } = useDeferredCompletionReconciliation({
    activeThreadId,
    diagnostics,
    settleCompletedTurn,
  });
  const onAgentMessageDeltaTracked = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      turnId?: string | null;
    }) => {
      const eventTurnId = asString(payload.turnId).trim();
      if (
        eventTurnId &&
        isRealtimeTurnTerminalExact(payload.threadId, eventTurnId)
      ) {
        return;
      }
      if (
        eventTurnId &&
        shouldSkipCodexTurnEvent({
          engine: inferThreadEngine(payload.threadId),
          workspaceId: payload.workspaceId,
          threadId: payload.threadId,
          turnId: eventTurnId,
          operation: "appendAgentMessageDelta",
          sourceMethod: "item/agentMessage/delta",
        })
      ) {
        return;
      }
      onAgentMessageDelta(payload);
      dispatch({ type: "markContinuationEvidence", threadId: payload.threadId, at: Date.now() });
      if (workspaceScopedHas(interruptedThreadsRef.current, payload.workspaceId, payload.threadId)) {
        return;
      }
      noteCodexTurnProgressEvidence(payload.workspaceId, payload.threadId, "agent-message-delta");
      recordAssistantStreamIngress({
        workspaceId: payload.workspaceId,
        threadId: payload.threadId,
        itemId: payload.itemId,
        textLength: payload.delta.length,
        source: "delta",
      });
    },
    [
      dispatch,
      interruptedThreadsRef,
      isRealtimeTurnTerminalExact,
      noteCodexTurnProgressEvidence,
      onAgentMessageDelta,
      recordAssistantStreamIngress,
      shouldSkipCodexTurnEvent,
    ],
  );

  const onAgentMessageCompletedTracked = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
      turnId?: string | null;
    }) => {
      const eventTurnId = asString(payload.turnId).trim();
      if (eventTurnId && isRealtimeTurnTerminalExact(payload.threadId, eventTurnId)) {
        return;
      }
      onAgentMessageCompleted(payload);
      if (workspaceScopedHas(interruptedThreadsRef.current, payload.workspaceId, payload.threadId) || payload.text.length === 0) {
        return;
      }
      recordAssistantCompletionEvidence(payload.threadId, payload.itemId);
      recordAssistantStreamIngress({
        workspaceId: payload.workspaceId,
        threadId: payload.threadId,
        itemId: payload.itemId,
        textLength: payload.text.length,
        source: "completion",
      });
    },
    [
      interruptedThreadsRef,
      isRealtimeTurnTerminalExact,
      onAgentMessageCompleted,
      recordAssistantCompletionEvidence,
      recordAssistantStreamIngress,
    ],
  );

  const onItemStartedTracked = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const eventTurnId = extractTurnIdFromRawItem(item);
      if (eventTurnId && isRealtimeTurnTerminalExact(threadId, eventTurnId)) {
        return;
      }
      if (
        shouldSkipCodexTurnEvent({
          engine: inferRawItemEngine(threadId, item),
          workspaceId,
          threadId,
          turnId: eventTurnId,
          operation: "itemStarted",
          sourceMethod: "item/started",
        })
      ) {
        return;
      }
      onItemStarted(workspaceId, threadId, item);
      dispatch({ type: "markContinuationEvidence", threadId, at: Date.now() });
      noteCodexTurnProgressEvidence(workspaceId, threadId, "item-started");
      maybeRecordAgentMessageSnapshotIngress(workspaceId, threadId, item);
      captureTurnItemDiagnostic(workspaceId, threadId, "started", item);
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      maybeRecordAgentMessageSnapshotIngress,
      noteCodexTurnProgressEvidence,
      onItemStarted,
      shouldSkipCodexTurnEvent,
    ],
  );

  const onItemUpdatedTracked = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const eventTurnId = extractTurnIdFromRawItem(item);
      if (eventTurnId && isRealtimeTurnTerminalExact(threadId, eventTurnId)) {
        return;
      }
      if (
        shouldSkipCodexTurnEvent({
          engine: inferRawItemEngine(threadId, item),
          workspaceId,
          threadId,
          turnId: eventTurnId,
          operation: "itemUpdated",
          sourceMethod: "item/updated",
        })
      ) {
        return;
      }
      onItemUpdated(workspaceId, threadId, item);
      dispatch({ type: "markContinuationEvidence", threadId, at: Date.now() });
      noteCodexTurnProgressEvidence(workspaceId, threadId, "item-updated");
      maybeRecordAgentMessageSnapshotIngress(workspaceId, threadId, item);
      captureTurnItemDiagnostic(workspaceId, threadId,
        "updated", item);
      flushDeferredTurnCompletionRef.current?.(threadId, "item-terminal");
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      maybeRecordAgentMessageSnapshotIngress,
      noteCodexTurnProgressEvidence,
      onItemUpdated,
      shouldSkipCodexTurnEvent,
    ],
  );

  const onItemCompletedTracked = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const eventTurnId = extractTurnIdFromRawItem(item);
      if (eventTurnId && isRealtimeTurnTerminalExact(threadId, eventTurnId)) {
        return;
      }
      if (
        shouldSkipCodexTurnEvent({
          engine: inferRawItemEngine(threadId, item),
          workspaceId,
          threadId,
          turnId: eventTurnId,
          operation: "itemCompleted",
          sourceMethod: "item/completed",
        })
      ) {
        return;
      }
      onItemCompleted(workspaceId, threadId, item);
      dispatch({ type: "markContinuationEvidence", threadId, at: Date.now() });
      noteCodexTurnProgressEvidence(workspaceId, threadId, "item-completed");
      captureTurnItemDiagnostic(workspaceId, threadId,
        "completed", item);
      flushDeferredTurnCompletionRef.current?.(threadId, "item-terminal");
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      noteCodexTurnProgressEvidence,
      onItemCompleted,
      shouldSkipCodexTurnEvent,
    ],
  );

  const shouldSkipLateCodexNormalizedEvent = useCallback(
    (event: NormalizedThreadEvent) => {
      return shouldSkipCodexTurnEvent({
        engine: event.engine,
        workspaceId: event.workspaceId,
        threadId: event.threadId,
        turnId: asString(event.turnId).trim(),
        operation: event.operation,
        sourceMethod: event.sourceMethod,
      });
    },
    [shouldSkipCodexTurnEvent],
  );

  const onNormalizedRealtimeEventTracked = useCallback(
    (event: NormalizedThreadEvent) => {
      // fix-turn-terminal-live-text-commit-loss：exact-guard 与 quarantine 均仅
      // 放行非空 assistant 终稿（salvageable complete），由下游 applyNormalized
      // 统一同步合入 durable；其余迟到事件维持丢弃。quarantine 的目的防复燃，
      // salvage 不复活 processing（turnId 全局唯一不会串 turn），且 codex 正常
      // 完成即 quarantine——不放宽则迟到终稿永远被丢，正是本 change 要修的形态。
      const salvageableTerminalComplete =
        isSalvageableTerminalAssistantComplete(event);
      if (
        event.turnId &&
        isRealtimeTurnTerminalExact(event.threadId, event.turnId) &&
        !salvageableTerminalComplete
      ) {
        onDebug?.({
          id: `${Date.now()}-realtime-terminal-exact-drop`,
          timestamp: Date.now(),
          source: "event",
          label: "thread/session:realtime-terminal-exact-drop",
          payload: {
            threadId: event.threadId,
            turnId: event.turnId,
            operation: event.operation,
            sourceMethod: event.sourceMethod,
          },
        });
        return;
      }
      if (
        !salvageableTerminalComplete &&
        shouldSkipLateCodexNormalizedEvent(event)
      ) {
        return;
      }
      onNormalizedRealtimeEvent(event);
      dispatch({ type: "markContinuationEvidence", threadId: event.threadId, at: Date.now() });
      noteCodexTurnProgressEvidence(event.workspaceId, event.threadId, `normalized:${event.operation}`);
      if (event.operation === "appendAgentMessageDelta") {
        const textLength =
          event.delta?.length ??
          (event.item.kind === "message" ? event.item.text.length : 0);
        if (textLength > 0 && event.item.kind === "message") {
          recordAssistantStreamIngress({
            workspaceId: event.workspaceId,
            threadId: event.threadId,
            itemId: event.item.id,
            textLength,
            source:
              event.sourceMethod === "item/started" ||
              event.sourceMethod === "item/updated"
                ? "snapshot"
                : "delta",
          });
        }
      }
      if (event.operation === "appendToolOutputDelta" && event.item.kind === "tool") {
        noteNonTextRuntimeProgress(event.threadId, "normalized-tool-output-delta", {
          itemType: event.item.toolType,
          itemId: event.item.id,
          itemEventKind: "output-delta",
          outputLength: (event.delta ?? event.item.output ?? "").length,
        });
      }
      if (
        event.operation === "completeAgentMessage" &&
        event.item.kind === "message" &&
        event.item.role === "assistant" &&
        event.item.text.length > 0
      ) {
        recordAssistantStreamIngress({
          workspaceId: event.workspaceId,
          threadId: event.threadId,
          itemId: event.item.id,
          textLength: event.item.text.length,
          source: "completion",
        });
        recordAssistantCompletionEvidence(event.threadId, event.item.id);
      }
      if (!event.rawItem) {
        return;
      }
      if (event.operation === "itemStarted" || event.operation === "itemUpdated") {
        maybeRecordAgentMessageSnapshotIngress(
          event.workspaceId,
          event.threadId,
          event.rawItem,
        );
      }
      if (event.operation === "itemStarted") {
        captureTurnItemDiagnostic(event.workspaceId, event.threadId,
        "started", event.rawItem);
        return;
      }
      if (event.operation === "itemUpdated") {
        captureTurnItemDiagnostic(event.workspaceId, event.threadId,
        "updated", event.rawItem);
        flushDeferredTurnCompletionRef.current?.(event.threadId, "item-terminal");
        return;
      }
      if (event.operation === "itemCompleted") {
        captureTurnItemDiagnostic(event.workspaceId, event.threadId,
        "completed", event.rawItem);
        flushDeferredTurnCompletionRef.current?.(event.threadId, "item-terminal");
      }
    },
    [
      captureTurnItemDiagnostic,
      dispatch,
      isRealtimeTurnTerminalExact,
      maybeRecordAgentMessageSnapshotIngress,
      noteCodexTurnProgressEvidence,
      noteNonTextRuntimeProgress,
      onDebug,
      onNormalizedRealtimeEvent,
      recordAssistantCompletionEvidence,
      recordAssistantStreamIngress,
      shouldSkipLateCodexNormalizedEvent,
    ],
  );

  const onCommandOutputDeltaTracked = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      onCommandOutputDelta(workspaceId, threadId, itemId, delta, turnId);
      if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        return;
      }
      noteNonTextRuntimeProgress(threadId, "command-output-delta", {
        itemType: "commandExecution",
        itemId,
        itemEventKind: "output-delta",
        outputLength: delta.length,
      });
    },
    [interruptedThreadsRef, noteNonTextRuntimeProgress, onCommandOutputDelta],
  );

  const onFileChangeOutputDeltaTracked = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      delta: string,
      turnId?: string | null,
    ) => {
      onFileChangeOutputDelta(workspaceId, threadId, itemId, delta, turnId);
      if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        return;
      }
      noteNonTextRuntimeProgress(threadId, "file-change-output-delta", {
        itemType: "fileChange",
        itemId,
        itemEventKind: "output-delta",
        outputLength: delta.length,
      });
    },
    [interruptedThreadsRef, noteNonTextRuntimeProgress, onFileChangeOutputDelta],
  );

  const onTerminalInteractionTracked = useCallback(
    (
      workspaceId: string,
      threadId: string,
      itemId: string,
      stdin: string,
      turnId?: string | null,
    ) => {
      onTerminalInteraction(workspaceId, threadId, itemId, stdin, turnId);
      if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        return;
      }
      noteNonTextRuntimeProgress(threadId, "terminal-interaction", {
        itemType: "commandExecution",
        itemId,
        itemEventKind: "output-delta",
        outputLength: stdin.length,
      });
    },
    [interruptedThreadsRef, noteNonTextRuntimeProgress, onTerminalInteraction],
  );
  const onAppServerEvent = useCallback(
    (event: AppServerEvent) => {
      handleThreadAppServerEventDiagnostics({
        event,
        onDebug,
        getThreadLifecycleSnapshot,
        getExpectedTurnId: (threadId) =>
          turnDiagnosticsRef.current.get(threadId)?.turnId ??
          getThreadLifecycleSnapshot(threadId).activeTurnId,
        emitForegroundSettlementDiagnostic,
        noteCodexTurnProgressEvidence,
      });
    },
    [
      emitForegroundSettlementDiagnostic,
      getThreadLifecycleSnapshot,
      onDebug,
      noteCodexTurnProgressEvidence,
    ],
  );

  const handlers = useMemo(
    () => ({
      onWorkspaceConnected,
      onApprovalRequest,
      onRequestUserInput,
      onModeBlocked,
      onModeResolved,
      onBackgroundThreadAction,
      onAppServerEvent,
      onAgentMessageDelta: onAgentMessageDeltaTracked,
      onAgentMessageCompleted: onAgentMessageCompletedTracked,
      onNormalizedRealtimeEvent: onNormalizedRealtimeEventTracked,
      onItemStarted: onItemStartedTracked,
      onItemUpdated: onItemUpdatedTracked,
      onItemCompleted: onItemCompletedTracked,
      onBackgroundTaskUpdated,
      onReasoningSummaryDelta,
      onReasoningSummaryBoundary,
      onReasoningTextDelta,
      onCommandOutputDelta: onCommandOutputDeltaTracked,
      onTerminalInteraction: onTerminalInteractionTracked,
      onFileChangeOutputDelta: onFileChangeOutputDeltaTracked,
      onThreadStarted,
      onTurnStarted: onTurnStartedTracked,
      onSharedRuntimeTurnStarted,
      onTurnCompleted: onTurnCompletedTracked,
      onProcessingHeartbeat,
      onTurnPlanUpdated,
      onThreadTokenUsageUpdated: onThreadTokenUsageUpdatedTracked,
      onAssistantRuntimeReceipt,
      onAccountRateLimitsUpdated,
      onTurnError: onTurnErrorTracked,
      onTurnStalled: onTurnStalledTracked,
      onContextCompacting,
      onContextCompacted,
      onContextCompactionFailed,
      onThreadSessionIdUpdated,
    }),
    [
      onWorkspaceConnected,
      onApprovalRequest,
      onRequestUserInput,
      onModeBlocked,
      onModeResolved,
      onBackgroundThreadAction,
      onAppServerEvent,
      onAgentMessageDeltaTracked,
      onAgentMessageCompletedTracked,
      onNormalizedRealtimeEventTracked,
      onItemStartedTracked,
      onItemUpdatedTracked,
      onItemCompletedTracked,
      onBackgroundTaskUpdated,
      onReasoningSummaryDelta,
      onReasoningSummaryBoundary,
      onReasoningTextDelta,
      onCommandOutputDeltaTracked,
      onTerminalInteractionTracked,
      onFileChangeOutputDeltaTracked,
      onThreadStarted,
      onTurnStartedTracked,
      onSharedRuntimeTurnStarted,
      onTurnCompletedTracked,
      onProcessingHeartbeat,
      onTurnPlanUpdated,
      onThreadTokenUsageUpdatedTracked,
      onAssistantRuntimeReceipt,
      onAccountRateLimitsUpdated,
      onTurnErrorTracked,
      onTurnStalledTracked,
      onContextCompacting,
      onContextCompacted,
      onContextCompactionFailed,
      onThreadSessionIdUpdated,
    ],
  );

  return handlers;
}
