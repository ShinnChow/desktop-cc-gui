import type { AppServerEvent } from "../../../types";
import { buildAgentCanvasThreadId } from "../../multi-agent/runtime/agentCanvasThread";
import { getAppServerEventBackpressureForTests, resetAppServerEventBackpressureForTests, subscribeRawAppServerEvents } from "../../../services/events";
import { resolveSharedSessionBindingByNativeThread, resolveSharedSessionBindingFromRuntimeOwner } from "../../shared-session/runtime/sharedSessionBridge";
import { isAgentAttempt, resolveAgentAttemptOwner } from "../../multi-agent/store/agentStore";
import { isAppServerEventBatchConsumerEnabled, readStreamingScheduleTier } from "../../threads/utils/realtimePerfFlags";
import { noteThreadAppServerEventReceived } from "../../threads/utils/streamLatencyDiagnostics";
import { rememberCollabWorkerNativeThreadId } from "../../multi-agent/runtime/collabNativeHideRegistry";
import { resolveDispatchSchedule } from "../../threads/utils/renderSchedulingPolicy";
import { useAppServerEventBatchDispatch } from "./useAppServerEventBatchDispatch";
import { useCallback, useEffect, useRef } from "react";
import { useRenderScheduler } from "../../../hooks/useRenderScheduler";
import type { AppServerEventHandlers, DispatchAppServerEventBatchOptions, DispatchAppServerEventOptions, UseAppServerEventsOptions } from "./appServerEventTypes";
import { DEFAULT_APP_SERVER_EVENT_BATCH_CHUNK_SIZE } from "./appServerEventTypes";
import type { ThreadAgentCompletedItemTracker, ThreadAgentSnapshotItemTracker } from "./appServerEventExtractors";
import { buildDshContextUsagePatch, coalesceAppServerEventBatch, extractAgentMessageDeltaPayload, extractThreadIdFromParams, inferRawMethodEngine, isCodexRawGeneratedImageEvent, isProviderContinuationBootstrapEvent, resolveCodexOwnerThreadId } from "./appServerEventExtractors";
import { maybeCaptureRuntimeReceipt } from "./appServerEventEmitters";
import { tryRouteNormalizedRealtimeEvent } from "./appServerEventNormalizedRouting";
import { dispatchCollabFamily } from "./appServerEventDispatch/collabDispatch";
import { dispatchItemFamily } from "./appServerEventDispatch/itemDispatch";
import { dispatchThreadFamily } from "./appServerEventDispatch/threadDispatch";
import { dispatchTurnFamily } from "./appServerEventDispatch/turnDispatch";
import type { AppServerEventDispatchContext } from "./appServerEventDispatch/types";
export type {
  AppServerEventHandlers,
  DispatchAppServerEventBatchOptions,
  DispatchAppServerEventOptions,
} from "./appServerEventTypes";
export {
  coalesceAppServerEventBatch,
} from "./appServerEventExtractors";

export {
  getAppServerEventBackpressureForTests,
  resetAppServerEventBackpressureForTests,
};
export function dispatchAppServerEvent(
  handlers: AppServerEventHandlers,
  payload: AppServerEvent,
  options: DispatchAppServerEventOptions,
): void {
  const {
    useNormalizedRealtimeAdapters,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  } = options;
  // Provider continuation bootstrap 是 control plane，不是用户 Turn。
  // 在统一入口隔离，避免它进入 processing/reasoning/message/title 链路。
  if (isProviderContinuationBootstrapEvent(payload)) {
    return;
  }
  handlers.onAppServerEvent?.(payload);

  const { workspace_id, message } = payload;
  const method = String(message.method ?? "");
  const earlyParams = (message.params as Record<string, unknown>) ?? {};

  if (method === "dsh/raw") {
    const kind = String(earlyParams.kind ?? "");
    const threadId = String(earlyParams.threadId ?? earlyParams.thread_id ?? "");
    if (kind === "dsh-session-stats") {
      const sessionStats =
        (earlyParams.sessionStats as Record<string, unknown> | undefined) ??
        (earlyParams.session_stats as Record<string, unknown> | undefined);
      if (threadId && sessionStats) {
        handlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, {
          sessionStats,
        });
      }
      return;
    }
    if (kind === "dsh-todos") {
      if (threadId) {
        handlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, {
          dshTodos: Array.isArray(earlyParams.todos) ? earlyParams.todos : [],
        });
      }
      return;
    }
    if (kind === "dsh-context-usage") {
      if (threadId) {
        const patch = buildDshContextUsagePatch(earlyParams);
        if (patch) {
          handlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, {
            dshContextPatch: patch,
          });
        }
      }
      return;
    }
  }

  if (method === "codex/connected") {
    handlers.onWorkspaceConnected?.(workspace_id);
    return;
  }

  const params = (message.params as Record<string, unknown>) ?? {};
  noteThreadAppServerEventReceived({
    workspaceId: workspace_id,
    method,
    params,
  });
  const rawThreadId = extractThreadIdFromParams(params);
  const rawMethodEngine = inferRawMethodEngine(method);
  const shouldForceNormalizedRealtimeRoute = isCodexRawGeneratedImageEvent(
    method,
    params,
  );
  const fallbackGeneratedImageThreadId =
    !rawThreadId &&
    shouldForceNormalizedRealtimeRoute &&
    rawMethodEngine === "codex"
      ? resolveCodexOwnerThreadId(handlers, workspace_id, method, params)
      : "";
  const realtimeThreadId = rawThreadId || fallbackGeneratedImageThreadId;
  let sharedBridge =
    resolveSharedSessionBindingFromRuntimeOwner(workspace_id, params) ??
    (realtimeThreadId
      ? resolveSharedSessionBindingByNativeThread(workspace_id, realtimeThreadId)
      : null);
  maybeCaptureRuntimeReceipt(
    handlers,
    workspace_id,
    method,
    params,
    sharedBridge?.sharedThreadId ?? null,
    {
      skip:
        isAgentAttempt(sharedBridge?.attemptId) ||
        Boolean(sharedBridge?.bindingKey?.startsWith("squad:")),
    },
  );
  // Multi-Agent worker realtime：不进主幕 shared: 时间线，但必须复用主幕同源
  // adapter + liveAssistantTextChannel（agent-canvas: 作用域）。禁止旁路抠字。
  if (
    isAgentAttempt(sharedBridge?.attemptId) ||
    sharedBridge?.bindingKey?.startsWith("squad:")
  ) {
    // 侧栏 hide：立刻登记 native id（含改名 Agent N 后的 catalog id）
    if (realtimeThreadId) {
      rememberCollabWorkerNativeThreadId(realtimeThreadId);
    }
    const nativeFromBridge =
      typeof (sharedBridge as { nativeThreadId?: string } | null)
        ?.nativeThreadId === "string"
        ? (sharedBridge as { nativeThreadId?: string }).nativeThreadId
        : null;
    if (nativeFromBridge) {
      rememberCollabWorkerNativeThreadId(nativeFromBridge);
    }
    const owner = resolveAgentAttemptOwner({
      attemptId: sharedBridge?.attemptId,
      bindingKey: sharedBridge?.bindingKey,
    });
    if (!owner) {
      return;
    }
    const canvasThreadId = buildAgentCanvasThreadId(
      owner.threadId,
      owner.attemptId,
    );
    if (!canvasThreadId) {
      return;
    }
    const engineOverride =
      sharedBridge?.engine ??
      (rawMethodEngine as
        | "claude"
        | "codex"
        | "gemini"
        | "grok"
        | "kimi"
        | "opencode"
        | "dsh"
        | "pi"
        | "omp"
        | "qoder"
        | undefined);
    if (
      tryRouteNormalizedRealtimeEvent({
        handlers,
        workspaceId: workspace_id,
        message,
        sharedBinding: sharedBridge,
        ...(engineOverride ? { engineOverride } : {}),
        threadIdOverride: canvasThreadId,
        threadAgentDeltaSeenRef,
        threadAgentCompletedSeenRef,
        threadAgentSnapshotSeenRef,
      })
    ) {
      return;
    }
    const agentDeltaPayload = extractAgentMessageDeltaPayload(method, params);
    if (agentDeltaPayload) {
      threadAgentDeltaSeenRef.current[canvasThreadId] = true;
      handlers.onAgentMessageDelta?.({
        workspaceId: workspace_id,
        threadId: canvasThreadId,
        itemId: agentDeltaPayload.itemId,
        delta: agentDeltaPayload.delta,
        ...(agentDeltaPayload.turnId
          ? { turnId: agentDeltaPayload.turnId }
          : {}),
      });
      return;
    }
    // 未识别的 worker 事件不落入主幕 shared 时间线
    return;
  }
  const ctx: AppServerEventDispatchContext = {
    handlers,
    params,
    rawThreadId,
    sharedBridge,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  };
  if (dispatchCollabFamily(ctx, method, payload)) {
    return;
  }

  if (
    (useNormalizedRealtimeAdapters ||
      shouldForceNormalizedRealtimeRoute ||
      Boolean(sharedBridge?.executionTargetSnapshot)) &&
    tryRouteNormalizedRealtimeEvent({
      handlers,
      workspaceId: workspace_id,
      message,
      sharedBinding: sharedBridge,
      ...(sharedBridge
        ? {
            engineOverride: sharedBridge.engine,
            threadIdOverride: sharedBridge.sharedThreadId,
          }
        : rawMethodEngine
          ? {
              engineOverride: rawMethodEngine,
              ...(fallbackGeneratedImageThreadId
                ? { threadIdOverride: fallbackGeneratedImageThreadId }
                : {}),
            }
          : {}),
      threadAgentDeltaSeenRef,
      threadAgentCompletedSeenRef,
      threadAgentSnapshotSeenRef,
    })
  ) {
    return;
  }

  const agentDeltaPayload = extractAgentMessageDeltaPayload(method, params);
  if (agentDeltaPayload) {
    const effectiveThreadId =
      sharedBridge?.sharedThreadId ?? agentDeltaPayload.threadId;
    threadAgentDeltaSeenRef.current[effectiveThreadId] = true;
    handlers.onAgentMessageDelta?.({
      workspaceId: workspace_id,
      threadId: effectiveThreadId,
      itemId: agentDeltaPayload.itemId,
      delta: agentDeltaPayload.delta,
      ...(agentDeltaPayload.turnId ? { turnId: agentDeltaPayload.turnId } : {}),
    });
    return;
  }

  if (dispatchItemFamily(ctx, method, payload)) {
    return;
  }
  if (dispatchTurnFamily(ctx, method, payload)) {
    return;
  }
  if (dispatchThreadFamily(ctx, method, payload)) {
    return;
  }
}
export function dispatchAppServerEventBatch(
  handlers: AppServerEventHandlers,
  batch: readonly AppServerEvent[],
  options: DispatchAppServerEventBatchOptions,
): () => void {
  const events = coalesceAppServerEventBatch(batch);
  const chunkSize = Math.max(
    1,
    Math.trunc(options.chunkSize ?? DEFAULT_APP_SERVER_EVENT_BATCH_CHUNK_SIZE),
  );
  let cursor = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  let completed = false;

  const completeOnce = () => {
    if (completed) {
      return;
    }
    completed = true;
    options.onComplete?.();
  };

  const processNextChunk = () => {
    timeoutId = null;
    if (cancelled) {
      completeOnce();
      return;
    }
    const end = Math.min(cursor + chunkSize, events.length);
    while (cursor < end) {
      dispatchAppServerEvent(handlers, events[cursor], options);
      cursor += 1;
    }
    if (cursor >= events.length) {
      completeOnce();
      return;
    }
    timeoutId = setTimeout(processNextChunk, 0);
  };

  processNextChunk();

  return () => {
    cancelled = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    completeOnce();
  };
}

export function useAppServerEvents(
  handlers: AppServerEventHandlers,
  options: UseAppServerEventsOptions = {},
) {
  const eventsEnabled = options.enabled !== false;
  const threadAgentDeltaSeenRef = useRef<Record<string, true>>({});
  const threadAgentCompletedSeenRef = useRef<ThreadAgentCompletedItemTracker>(
    {},
  );
  const threadAgentSnapshotSeenRef = useRef<ThreadAgentSnapshotItemTracker>({});
  // Per design §1.1: handlers and dispatcher options must be reached via
  // refs so the effect can keep a stable subscription identity while still
  // seeing the latest closure values on every event.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const dispatcherOptionsRef = useRef({
    useNormalizedRealtimeAdapters:
      options.useNormalizedRealtimeAdapters === true,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  });
  dispatcherOptionsRef.current = {
    useNormalizedRealtimeAdapters:
      options.useNormalizedRealtimeAdapters === true,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  };
  const batchConsumerEnabled =
    eventsEnabled && isAppServerEventBatchConsumerEnabled();
  const rawFallbackQueueRef = useRef<AppServerEvent[]>([]);
  const rawFallbackSchedule = resolveDispatchSchedule({
    tier: readStreamingScheduleTier(),
    isLiveRow: false,
    isHeavy: false,
    isCritical: false,
  });
  const rawFallbackScheduleRef = useRef(rawFallbackSchedule);
  rawFallbackScheduleRef.current = rawFallbackSchedule;
  const rawFallbackScheduler = useRenderScheduler({
    budgetMs: rawFallbackSchedule.budgetMs,
    idleTimeoutMs: rawFallbackSchedule.idleTimeoutMs,
  });
  const dispatchRawFallbackQueue = useCallback((): boolean => {
    const startedAt =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
    let dispatchedInChunk = 0;
    while (
      rawFallbackQueueRef.current.length > 0 &&
      dispatchedInChunk < DEFAULT_APP_SERVER_EVENT_BATCH_CHUNK_SIZE
    ) {
      const elapsed =
        (typeof performance !== "undefined" &&
        typeof performance.now === "function"
          ? performance.now()
          : Date.now()) - startedAt;
      if (
        dispatchedInChunk > 0 &&
        rawFallbackScheduleRef.current.budgetMs > 0 &&
        elapsed >= rawFallbackScheduleRef.current.budgetMs
      ) {
        break;
      }
      const next = rawFallbackQueueRef.current.shift()!;
      dispatchedInChunk += 1;
      try {
        dispatchAppServerEvent(
          handlersRef.current,
          next,
          dispatcherOptionsRef.current,
        );
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[useAppServerEvents] raw fallback dispatch failed", error);
      }
    }
    return rawFallbackQueueRef.current.length > 0;
  }, []);
  useAppServerEventBatchDispatch(handlers, {
    ...dispatcherOptionsRef.current,
    enableInternalBatchSubscription: batchConsumerEnabled && eventsEnabled,
  });

  useEffect(() => {
    if (!eventsEnabled || batchConsumerEnabled) {
      return undefined;
    }
    const rawFallbackQueue = rawFallbackQueueRef.current;
    const unsubscribe = subscribeRawAppServerEvents((payload) => {
      rawFallbackQueue.push(payload);
      rawFallbackScheduler.scheduleChunk(dispatchRawFallbackQueue);
    });
    return () => {
      unsubscribe();
      rawFallbackQueue.length = 0;
      rawFallbackScheduler.cancel();
    };
  }, [
    batchConsumerEnabled,
    dispatchRawFallbackQueue,
    eventsEnabled,
    rawFallbackScheduler,
  ]);
}
