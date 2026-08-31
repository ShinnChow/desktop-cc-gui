import type { AppServerEvent } from "../../../types";
import { buildAgentCanvasThreadId } from "../../multi-agent/runtime/agentCanvasThread";
import { classifyCodexEventRisk, resolveCodexEventOwnership } from "./codexEventOwnership";
import { getAppServerEventBackpressureForTests, resetAppServerEventBackpressureForTests, subscribeRawAppServerEvents } from "../../../services/events";
import { getRuntimeReceipt } from "../../threads/utils/runtimeModelReceipt";
import { hasPendingSharedSessionBindingForEngine, rebindSharedSessionNativeThread, resolvePendingSharedSessionBindingForEngine, resolvePendingSharedSessionBindingForTarget, resolveSharedRuntimeControlOwner, resolveSharedSessionBindingByNativeThread, resolveSharedSessionBindingFromRuntimeOwner } from "../../shared-session/runtime/sharedSessionBridge";
import { hydrateToolSnapshotWithEventParams } from "../../threads/adapters/toolSnapshotHydration";
import { isAgentAttempt, resolveAgentAttemptOwner } from "../../multi-agent/store/agentStore";
import { isAppServerEventBatchConsumerEnabled, readStreamingScheduleTier } from "../../threads/utils/realtimePerfFlags";
import { isSharedSessionSupportedEngine } from "../../shared-session/utils/sharedSessionEngines";
import { isSharedV2SendEnabled } from "../../shared-session/runtime/sharedV2SendFlag";
import { migrateThreadAgentEventTracking } from "./appServerEventAgentTracking";
import { noteThreadAppServerEventReceived } from "../../threads/utils/streamLatencyDiagnostics";
import { rememberCollabWorkerNativeThreadId } from "../../multi-agent/runtime/collabNativeHideRegistry";
import { resolveDispatchSchedule } from "../../threads/utils/renderSchedulingPolicy";
import { updateSharedSessionNativeBinding as updateSharedSessionNativeBindingService } from "../../shared-session/services/sharedSessions";
import { useAppServerEventBatchDispatch } from "./useAppServerEventBatchDispatch";
import { useCallback, useEffect, useRef } from "react";
import { useRenderScheduler } from "../../../hooks/useRenderScheduler";
import type { AppServerEventHandlers, DispatchAppServerEventBatchOptions, DispatchAppServerEventOptions, UseAppServerEventsOptions } from "./appServerEventTypes";
import { DEFAULT_APP_SERVER_EVENT_BATCH_CHUNK_SIZE } from "./appServerEventTypes";
import type { ThreadAgentCompletedItemTracker, ThreadAgentSnapshotItemTracker } from "./appServerEventExtractors";
import { asStringArray, buildDshContextUsagePatch, coalesceAppServerEventBatch, extractAgentMessageDeltaPayload, extractCompactionSourceFlags, extractItemIdFromParams, extractReasoningDeltaFromParams, extractRuntimeEndedTurnMap, extractThreadIdFromParams, extractTurnIdFromParams, hasAgentMessageSnapshotText, hasThreadAgentCompletion, inferGeminiReasoningHintFromThreadId, inferRawMethodEngine, isCodexRawGeneratedImageEvent, isProviderContinuationBootstrapEvent, markThreadAgentCompletionSeen, markThreadAgentSnapshotSeen, parseCompactionReason, parseNullableTokenCount, resolveCodexOwnerThreadId, resolveEventEngine, resolveFinalizedSharedNativeThreadId, resolveLatestThreadAgentSnapshotItemId, resolveLegacyModelContextWindow, resolveThreadStartedProviderProfileId, shouldIgnoreAgentMessageSnapshot, shouldRebindSharedNativeThreadOnStartedEvent, withRealtimeItemEventContext } from "./appServerEventExtractors";
import { asString, emitAssistantRuntimeReceipt, emitCommandOutputDelta, emitFileChangeOutputDelta, emitReasoningSummaryBoundary, emitReasoningSummaryDelta, emitReasoningTextDelta, emitTerminalInteraction, maybeCaptureRuntimeReceipt } from "./appServerEventEmitters";
import { tryRouteNormalizedRealtimeEvent } from "./appServerEventNormalizedRouting";
export type {
  AgentDelta,
  AppServerEventHandlers,
  DispatchAppServerEventBatchOptions,
  DispatchAppServerEventOptions,
} from "./appServerEventTypes";
export {
  buildCoalescibleAppServerEventKey,
  coalesceAppServerEventBatch,
  isProviderContinuationBootstrapEvent,
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
  const requestIdValue = message.id ?? params.requestId ?? params.request_id;
  const requestId =
    typeof requestIdValue === "number" || typeof requestIdValue === "string"
      ? requestIdValue
      : null;
  const hasRequestId = requestId !== null;

  if (
    (method.includes("requestApproval") || method === "approval/request") &&
    hasRequestId
  ) {
    const sharedControlOwner = resolveSharedRuntimeControlOwner(
      workspace_id,
      params,
    );
    const hasSharedControlClaim =
      params.sharedOwner !== undefined ||
      rawThreadId.startsWith("shared:") ||
      Boolean(sharedBridge);
    if (hasSharedControlClaim && !sharedControlOwner) {
      return;
    }
    handlers.onApprovalRequest?.({
      workspace_id,
      request_id: requestId,
      method,
      params,
      ...(sharedControlOwner
        ? { shared_runtime_owner: sharedControlOwner }
        : {}),
    });
    return;
  }

  if (method === "collaboration/modeBlocked") {
    const sharedControlOwner = resolveSharedRuntimeControlOwner(
      workspace_id,
      params,
    );
    const hasSharedControlClaim =
      params.sharedOwner !== undefined ||
      rawThreadId.startsWith("shared:") ||
      Boolean(sharedBridge);
    if (hasSharedControlClaim && !sharedControlOwner) {
      return;
    }
    const requestIdValue = params.requestId ?? params.request_id;
    const requestId =
      typeof requestIdValue === "number" || typeof requestIdValue === "string"
        ? requestIdValue
        : null;
    const reasonCodeValue = params.reasonCode ?? params.reason_code;
    const parsedReasonCode =
      reasonCodeValue === undefined || reasonCodeValue === null
        ? undefined
        : String(reasonCodeValue);
    handlers.onModeBlocked?.({
      workspace_id,
      ...(sharedControlOwner
        ? { shared_runtime_owner: sharedControlOwner }
        : {}),
      params: {
        thread_id: String(params.threadId ?? params.thread_id ?? ""),
        blocked_method: String(
          params.blockedMethod ?? params.blocked_method ?? "",
        ),
        effective_mode: String(
          params.effectiveMode ?? params.effective_mode ?? "",
        ),
        ...(parsedReasonCode ? { reason_code: parsedReasonCode } : {}),
        reason: String(params.reason ?? ""),
        suggestion:
          params.suggestion === undefined || params.suggestion === null
            ? undefined
            : String(params.suggestion),
        request_id: requestId,
      },
    });
    return;
  }

  if (method === "collaboration/modeResolved") {
    const params = (message.params as Record<string, unknown>) ?? {};
    const selectedUiModeRaw = String(
      params.selectedUiMode ?? params.selected_ui_mode ?? "",
    )
      .trim()
      .toLowerCase();
    const effectiveRuntimeModeRaw = String(
      params.effectiveRuntimeMode ?? params.effective_runtime_mode ?? "",
    )
      .trim()
      .toLowerCase();
    const effectiveUiModeRaw = String(
      params.effectiveUiMode ?? params.effective_ui_mode ?? "",
    )
      .trim()
      .toLowerCase();
    const fallbackReasonRaw = params.fallbackReason ?? params.fallback_reason;
    const selectedUiMode = selectedUiModeRaw === "plan" ? "plan" : "default";
    const effectiveRuntimeMode =
      effectiveRuntimeModeRaw === "plan" ? "plan" : "code";
    const effectiveUiMode = effectiveUiModeRaw === "plan" ? "plan" : "default";
    handlers.onModeResolved?.({
      workspace_id,
      params: {
        thread_id: String(params.threadId ?? params.thread_id ?? ""),
        selected_ui_mode: selectedUiMode,
        effective_runtime_mode: effectiveRuntimeMode,
        effective_ui_mode: effectiveUiMode,
        fallback_reason:
          fallbackReasonRaw === undefined || fallbackReasonRaw === null
            ? null
            : String(fallbackReasonRaw),
      },
    });
    return;
  }

  if (method === "item/tool/requestUserInput") {
    const params = (message.params as Record<string, unknown>) ?? {};
    // Prefer explicit requestId fields for requestUserInput events.
    // Some runtimes may use top-level message.id for transport-level ids.
    const requestIdValue = params.requestId ?? params.request_id ?? message.id;
    const requestId =
      typeof requestIdValue === "number" || typeof requestIdValue === "string"
        ? requestIdValue
        : null;
    if (requestId === null) {
      return;
    }
    const sharedControlOwner = resolveSharedRuntimeControlOwner(
      workspace_id,
      params,
    );
    const hasSharedControlClaim =
      params.sharedOwner !== undefined ||
      rawThreadId.startsWith("shared:") ||
      Boolean(sharedBridge);
    if (hasSharedControlClaim && !sharedControlOwner) {
      return;
    }
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const effectiveThreadId =
      sharedControlOwner?.sharedThreadId ?? resolvedThreadId;
    const completed = Boolean(params.completed);
    const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
    const questionsRaw = Array.isArray(params.questions)
      ? params.questions
      : [];
    const questions = questionsRaw
      .map((entry) => {
        const question = entry as Record<string, unknown>;
        const optionsRaw = Array.isArray(question.options)
          ? question.options
          : [];
        const options = optionsRaw
          .map((option) => {
            const record = option as Record<string, unknown>;
            const label = String(record.label ?? "").trim();
            const description = String(record.description ?? "").trim();
            if (!label && !description) {
              return null;
            }
            return { label, description };
          })
          .filter((option): option is { label: string; description: string } =>
            Boolean(option),
          );
        return {
          id: String(question.id ?? "").trim(),
          header: String(question.header ?? ""),
          question: String(question.question ?? ""),
          isOther: Boolean(question.isOther ?? question.is_other),
          isSecret: Boolean(question.isSecret ?? question.is_secret),
          ...((question.multiSelect ?? question.multi_select)
            ? { multiSelect: true }
            : {}),
          options: options.length ? options : undefined,
        };
      })
      .filter((question) => question.id);
    handlers.onRequestUserInput?.({
      workspace_id,
      request_id: requestId,
      ...(sharedControlOwner
        ? { shared_runtime_owner: sharedControlOwner }
        : {}),
      params: {
        thread_id: effectiveThreadId,
        turn_id: String(params.turnId ?? params.turn_id ?? turn.id ?? ""),
        item_id: String(
          params.itemId ?? params.item_id ?? turn.itemId ?? turn.item_id ?? "",
        ),
        questions,
        ...(completed ? { completed: true } : {}),
      },
    });
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

  if (method === "turn/started") {
    const params = message.params as Record<string, unknown>;
    const turn = params.turn as Record<string, unknown> | undefined;
    const rawTurnThreadId = String(
      params.threadId ??
        params.thread_id ??
        turn?.threadId ??
        turn?.thread_id ??
        "",
    );
    const threadId = sharedBridge?.sharedThreadId ?? rawTurnThreadId;
    const turnId = asString(
      params.turnId ?? params.turn_id ?? turn?.id ?? "",
    ).trim();
    if (threadId) {
      delete threadAgentDeltaSeenRef.current[threadId];
      delete threadAgentCompletedSeenRef.current[threadId];
      delete threadAgentSnapshotSeenRef.current[threadId];
      // Shared V2 caller 已在 attempt admission 时建立 processing lifecycle。
      // Rust 投影的 delayed turn/started 只提供 Runtime evidence；若再进入通用
      // Native handler，会在 canonical commit 后复活 activeTurnId / Stop。
      const isOwnedSharedV2Projection =
        Boolean(sharedBridge) && params.sharedOwner !== undefined;
      if (isOwnedSharedV2Projection) {
        // Shared projection 不进入 generic Native lifecycle，但 exact Runtime identity
        // 仍需更新 realtime ledger，解除上一 Turn 的 thread-level terminal fallback。
        handlers.onSharedRuntimeTurnStarted?.(threadId, turnId);
      } else {
        handlers.onTurnStarted?.(workspace_id, threadId, turnId);
      }
    }
    return;
  }

  if (method === "thread/started") {
    const params = message.params as Record<string, unknown>;
    const thread =
      (params.thread as Record<string, unknown> | undefined) ?? null;
    const threadId = String(
      thread?.id ?? params.threadId ?? params.thread_id ?? "",
    );
    const sessionId = String(params.sessionId ?? params.session_id ?? "");
    const turnId = String(params.turnId ?? params.turn_id ?? "").trim();
    const rawEngine = String(params.engine ?? "").toLowerCase();
    const eventEngine =
      rawEngine === "claude" ||
      rawEngine === "opencode" ||
      rawEngine === "codex" ||
      rawEngine === "grok" ||
      rawEngine === "kimi" ||
      rawEngine === "gemini" ||
      rawEngine === "pi" ||
      rawEngine === "dsh" ||
      rawEngine === "qoder"
        ? rawEngine
        : null;

    const eventProviderProfileId = resolveThreadStartedProviderProfileId({
      params,
      thread,
      threadId,
      sessionId,
      eventEngine,
    });
    let skipNativeThreadStart = false;
    if (
      !sharedBridge &&
      threadId &&
      eventEngine &&
      isSharedSessionSupportedEngine(eventEngine)
    ) {
      const pendingBinding =
        resolvePendingSharedSessionBindingForTarget(
          workspace_id,
          eventEngine,
          eventProviderProfileId,
        ) ??
        (eventEngine === "qoder" && !eventProviderProfileId
          ? resolvePendingSharedSessionBindingForEngine(workspace_id, eventEngine)
          : null);
      if (pendingBinding) {
        if (pendingBinding.nativeThreadId !== threadId) {
          const rebound = rebindSharedSessionNativeThread({
            workspaceId: workspace_id,
            oldNativeThreadId: pendingBinding.nativeThreadId,
            newNativeThreadId: threadId,
          });
          if (rebound) {
            sharedBridge = rebound;
            // V2 Binding 的唯一 durable authority 是 Rust SQLite。这里的
            // frontend bridge 只负责 event projection；仅显式回滚 V0 时写
            // legacy Shared meta binding。
            if (!isSharedV2SendEnabled()) {
              void updateSharedSessionNativeBindingService(
                workspace_id,
                rebound.sharedThreadId,
                rebound.engine,
                pendingBinding.nativeThreadId,
                threadId,
                rebound.providerProfileId ?? null,
              ).catch(() => {});
            }
          }
        } else {
          sharedBridge = pendingBinding;
        }
      } else if (
        hasPendingSharedSessionBindingForEngine(workspace_id, eventEngine)
      ) {
        // 同 engine 多条 pending 无法唯一认主时，禁止 Native 开行。
        skipNativeThreadStart = true;
      }
    }

    if (sharedBridge) {
      if (
        threadId &&
        sessionId &&
        sessionId !== "pending" &&
        eventEngine &&
        eventEngine !== "dsh" &&
        shouldRebindSharedNativeThreadOnStartedEvent(eventEngine)
      ) {
        const finalizedNativeThreadId = resolveFinalizedSharedNativeThreadId(
          eventEngine,
          sessionId,
          eventProviderProfileId ?? sharedBridge.providerProfileId ?? null,
        );
        if (finalizedNativeThreadId && threadId !== finalizedNativeThreadId) {
          const rebound = rebindSharedSessionNativeThread({
            workspaceId: workspace_id,
            oldNativeThreadId: threadId,
            newNativeThreadId: finalizedNativeThreadId,
          });
          if (rebound) {
            if (!isSharedV2SendEnabled()) {
              void updateSharedSessionNativeBindingService(
                workspace_id,
                rebound.sharedThreadId,
                rebound.engine,
                threadId,
                finalizedNativeThreadId,
                rebound.providerProfileId ?? null,
              ).catch(() => {});
            }
          }
        }
      }
      return;
    }
    if (skipNativeThreadStart) {
      return;
    }

    if (
      threadId &&
      sessionId &&
      sessionId !== "pending" &&
      eventEngine &&
      threadId.startsWith(`${eventEngine}-pending-`)
    ) {
      const migratedThreadId =
        eventEngine === "qoder"
          ? resolveFinalizedSharedNativeThreadId(
              eventEngine,
              sessionId,
              eventProviderProfileId,
            )
          : `${eventEngine}:${sessionId}`;
      if (migratedThreadId) {
        migrateThreadAgentEventTracking({
          sourceThreadId: threadId,
          targetThreadId: migratedThreadId,
          threadAgentDeltaSeenRef,
          nestedTrackerRefs: [
            threadAgentCompletedSeenRef,
            threadAgentSnapshotSeenRef,
          ],
        });
      }
    }

    // If we have a real sessionId (not "pending"), notify for thread ID update
    if (threadId && sessionId && sessionId !== "pending") {
      handlers.onThreadSessionIdUpdated?.(
        workspace_id,
        threadId,
        sessionId,
        eventEngine,
        turnId || null,
      );
    }

    if (thread && threadId) {
      handlers.onThreadStarted?.(workspace_id, thread);
    }
    return;
  }

  if (method === "codex/parseError") {
    const params = (message.params as Record<string, unknown>) ?? {};
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const threadId = sharedBridge?.sharedThreadId ?? resolvedThreadId;
    if (!threadId) {
      return;
    }
    const parseErrorText = String(params.error ?? "").trim();
    const rawText = String(params.raw ?? "").trim();
    const detail = rawText ? `\n${rawText}` : "";
    const messageText = parseErrorText
      ? `Codex stream parse error: ${parseErrorText}${detail}`
      : `Codex stream parse error${detail}`;
    handlers.onTurnError?.(workspace_id, threadId, "", {
      message: messageText,
      willRetry: false,
      engine: "codex",
      ...(sharedBridge?.executionTargetSnapshot
        ? { executionTargetSnapshot: sharedBridge.executionTargetSnapshot }
        : {}),
    });
    return;
  }

  if (method === "runtime/ended") {
    const params = (message.params as Record<string, unknown>) ?? {};
    const reasonCode = asString(params.reasonCode ?? params.reason_code).trim();
    const rawMessage = asString(params.message).trim();
    const affectedThreadIds = asStringArray(
      params.affectedThreadIds ?? params.affected_thread_ids,
    );
    const affectedTurnIds = asStringArray(
      params.affectedTurnIds ?? params.affected_turn_ids,
    );
    const affectedActiveTurns = extractRuntimeEndedTurnMap(
      params.affectedActiveTurns ?? params.affected_active_turns,
    );
    const pendingRequestCount = Number(
      params.pendingRequestCount ?? params.pending_request_count ?? 0,
    );
    const hadActiveLease = Boolean(
      params.hadActiveLease ?? params.had_active_lease ?? false,
    );
    const normalizedPendingRequestCount =
      Number.isFinite(pendingRequestCount) && pendingRequestCount > 0
        ? Math.trunc(pendingRequestCount)
        : 0;
    const runtimeGeneration = asString(
      params.runtimeGeneration ?? params.runtime_generation,
    ).trim();
    const shutdownSource = asString(
      params.shutdownSource ?? params.shutdown_source,
    ).trim();
    const rawRuntimeProcessId = Number(
      params.runtimeProcessId ?? params.runtime_process_id ?? 0,
    );
    const rawRuntimeStartedAtMs = Number(
      params.runtimeStartedAtMs ?? params.runtime_started_at_ms ?? 0,
    );
    const runtimeIdentityPayload = {
      ...(runtimeGeneration ? { runtimeGeneration } : {}),
      ...(Number.isFinite(rawRuntimeProcessId) && rawRuntimeProcessId > 0
        ? { runtimeProcessId: Math.trunc(rawRuntimeProcessId) }
        : {}),
      ...(Number.isFinite(rawRuntimeStartedAtMs) && rawRuntimeStartedAtMs > 0
        ? { runtimeStartedAtMs: Math.trunc(rawRuntimeStartedAtMs) }
        : {}),
    };

    handlers.onRuntimeEnded?.(workspace_id, {
      reasonCode,
      message: rawMessage,
      affectedThreadIds,
      affectedTurnIds,
      pendingRequestCount: normalizedPendingRequestCount,
      hadActiveLease,
      ...runtimeIdentityPayload,
    });

    const isRecoverableRuntimeShutdownSource =
      shutdownSource === "stale_reuse_cleanup" ||
      shutdownSource === "internal_replacement";
    const isBenignManualShutdown =
      reasonCode === "manual_shutdown" &&
      !isRecoverableRuntimeShutdownSource &&
      !hadActiveLease &&
      normalizedPendingRequestCount === 0 &&
      affectedThreadIds.length === 0 &&
      affectedTurnIds.length === 0 &&
      affectedActiveTurns.size === 0;
    if (isBenignManualShutdown) {
      return;
    }

    const explicitRuntimeThreadId = extractThreadIdFromParams(params);
    const explicitRuntimeTurnId = extractTurnIdFromParams(params);
    const hasExplicitRuntimeOwner =
      Boolean(explicitRuntimeThreadId) ||
      affectedThreadIds.length > 0 ||
      affectedActiveTurns.size > 0;
    const singleProcessingFallbackThreadId =
      hasExplicitRuntimeOwner
        ? null
        : (handlers.getSingleProcessingCodexThreadId?.(workspace_id) ?? null);
    const fallbackOwnership = resolveCodexEventOwnership({
      workspaceId: workspace_id,
      risk: classifyCodexEventRisk(method),
      explicitThreadId: explicitRuntimeThreadId,
      explicitTurnId: explicitRuntimeTurnId,
      ...(explicitRuntimeThreadId ? { explicitSource: "payload" as const } : {}),
      runtimeGeneration,
      boundedFallbackThreadIds: singleProcessingFallbackThreadId
        ? [singleProcessingFallbackThreadId]
        : [],
    });
    const normalizedMessage = rawMessage.startsWith("[RUNTIME_ENDED]")
      ? rawMessage
      : rawMessage
        ? `[RUNTIME_ENDED] ${rawMessage}`
        : "[RUNTIME_ENDED] Managed runtime ended unexpectedly before the turn settled.";
    const targetThreadIds = affectedThreadIds.length
      ? affectedThreadIds
      : affectedActiveTurns.size
        ? Array.from(affectedActiveTurns.keys())
        : fallbackOwnership.kind === "explicit" ||
            fallbackOwnership.kind === "boundedFallback"
          ? [fallbackOwnership.threadId]
          : [];
    const uniqueTargetThreadIds = Array.from(new Set(targetThreadIds));
    const shouldUseSingleAffectedTurnId =
      uniqueTargetThreadIds.length === 1 && affectedTurnIds.length === 1;
    uniqueTargetThreadIds.forEach((targetThreadId) => {
      const reboundBinding = resolveSharedSessionBindingByNativeThread(
        workspace_id,
        targetThreadId,
      );
      const reboundThreadId = reboundBinding?.sharedThreadId ?? targetThreadId;
      if (!reboundThreadId) {
        return;
      }
      const targetTurnId =
        affectedActiveTurns.get(targetThreadId) ??
        (shouldUseSingleAffectedTurnId
          ? (affectedTurnIds[0] ?? "")
          : fallbackOwnership.kind === "explicit" &&
              fallbackOwnership.threadId === targetThreadId
            ? (fallbackOwnership.turnId ?? "")
            : "");
      handlers.onTurnError?.(workspace_id, reboundThreadId, targetTurnId, {
        message: normalizedMessage,
        willRetry: false,
        engine: resolveEventEngine(reboundThreadId, reboundBinding?.engine),
        ...(reboundBinding?.executionTargetSnapshot
          ? { executionTargetSnapshot: reboundBinding.executionTargetSnapshot }
          : {}),
      });
    });
    return;
  }

  if (method === "turn/error") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const turnId = String(params.turnId ?? params.turn_id ?? "");
    const willRetry = Boolean(params.willRetry ?? params.will_retry);
    const errorValue = params.error;
    const messageText =
      typeof errorValue === "string"
        ? errorValue
        : typeof errorValue === "object" && errorValue
          ? String((errorValue as Record<string, unknown>).message ?? "")
          : "";
    const suppressMessage =
      Boolean(sharedBridge) &&
      String(
        params.sharedRecoveryReason ?? params.shared_recovery_reason ?? "",
      ) === "native-session-not-found";
    if (threadId) {
      handlers.onTurnError?.(workspace_id, threadId, turnId, {
        message: messageText,
        willRetry,
        ...(suppressMessage ? { suppressMessage: true } : {}),
        engine: resolveEventEngine(threadId, sharedBridge?.engine),
        ...(sharedBridge?.executionTargetSnapshot
          ? { executionTargetSnapshot: sharedBridge.executionTargetSnapshot }
          : {}),
      });
    }
    return;
  }

  if (method === "turn/stalled") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const turnId = String(params.turnId ?? params.turn_id ?? "");
    const rawStartedAtMs = Number(
      params.startedAtMs ?? params.started_at_ms ?? 0,
    );
    const rawTimeoutMs = Number(params.timeoutMs ?? params.timeout_ms ?? 0);
    const runtimeGeneration = asString(
      params.runtimeGeneration ?? params.runtime_generation,
    ).trim();
    const rawRuntimeProcessId = Number(
      params.runtimeProcessId ?? params.runtime_process_id ?? 0,
    );
    const rawRuntimeStartedAtMs = Number(
      params.runtimeStartedAtMs ?? params.runtime_started_at_ms ?? 0,
    );
    if (threadId) {
      handlers.onTurnStalled?.(workspace_id, threadId, turnId, {
        message: String(params.message ?? ""),
        reasonCode: String(params.reasonCode ?? params.reason_code ?? ""),
        stage: String(params.stage ?? ""),
        source: String(params.source ?? ""),
        ...(runtimeGeneration ? { runtimeGeneration } : {}),
        ...(Number.isFinite(rawRuntimeProcessId) && rawRuntimeProcessId > 0
          ? { runtimeProcessId: Math.trunc(rawRuntimeProcessId) }
          : {}),
        ...(Number.isFinite(rawRuntimeStartedAtMs) && rawRuntimeStartedAtMs > 0
          ? { runtimeStartedAtMs: Math.trunc(rawRuntimeStartedAtMs) }
          : {}),
        startedAtMs:
          Number.isFinite(rawStartedAtMs) && rawStartedAtMs > 0
            ? Math.trunc(rawStartedAtMs)
            : null,
        timeoutMs:
          Number.isFinite(rawTimeoutMs) && rawTimeoutMs > 0
            ? Math.trunc(rawTimeoutMs)
            : null,
        engine: resolveEventEngine(threadId, sharedBridge?.engine),
      });
    }
    return;
  }

  if (method === "codex/backgroundThread") {
    if (sharedBridge) {
      return;
    }
    const params = message.params as Record<string, unknown>;
    const threadId = String(params.threadId ?? params.thread_id ?? "");
    const action = String(params.action ?? "hide");
    if (threadId) {
      handlers.onBackgroundThreadAction?.(workspace_id, threadId, action);
    }
    return;
  }

  if (method === "error") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const turnId = String(params.turnId ?? params.turn_id ?? "");
    const error = (params.error as Record<string, unknown> | undefined) ?? {};
    const messageText = String(error.message ?? "");
    const willRetry = Boolean(params.willRetry ?? params.will_retry);
    const suppressMessage =
      Boolean(sharedBridge) &&
      String(
        params.sharedRecoveryReason ?? params.shared_recovery_reason ?? "",
      ) === "native-session-not-found";
    if (threadId) {
      handlers.onTurnError?.(workspace_id, threadId, turnId, {
        message: messageText,
        willRetry,
        ...(suppressMessage ? { suppressMessage: true } : {}),
        engine: resolveEventEngine(threadId, sharedBridge?.engine),
        ...(sharedBridge?.executionTargetSnapshot
          ? { executionTargetSnapshot: sharedBridge.executionTargetSnapshot }
          : {}),
      });
    }
    return;
  }

  if (method === "thread/runSettled") {
    // pi：run 彻底 settle 的生命周期信号（pump agent_settled → 转发器转换）。
    // 供完成音等「整轮结束」语义消费；不进入 turn 状态机（turn/completed
    // 已逐原生 turn 结算）。
    const params = message.params as Record<string, unknown>;
    const threadId = sharedBridge?.sharedThreadId ?? extractThreadIdFromParams(params);
    const turnId = asString(
      params.turnId ?? params.turn_id ?? "",
    ).trim();
    if (threadId) {
      handlers.onThreadRunSettled?.(workspace_id, threadId, turnId);
    }
    return;
  }

  if (method === "turn/completed") {
    const params = message.params as Record<string, unknown>;
    const turn = params.turn as Record<string, unknown> | undefined;
    const rawCompletedThreadId = String(
      params.threadId ??
        params.thread_id ??
        turn?.threadId ??
        turn?.thread_id ??
        "",
    );
    const threadId = sharedBridge?.sharedThreadId ?? rawCompletedThreadId;
    const turnId = asString(
      params.turnId ?? params.turn_id ?? turn?.id ?? "",
    ).trim();
    if (threadId) {
      const seenDelta = Boolean(threadAgentDeltaSeenRef.current[threadId]);
      const seenCompleted = hasThreadAgentCompletion(
        threadAgentCompletedSeenRef,
        threadId,
      );
      const result =
        (params.result as Record<string, unknown> | undefined) ?? undefined;
      const textFromResult = [
        typeof params.text === "string" ? params.text : "",
        typeof result?.text === "string" ? String(result.text) : "",
        typeof result?.output_text === "string"
          ? String(result.output_text)
          : "",
        typeof result?.outputText === "string" ? String(result.outputText) : "",
        typeof result?.content === "string" ? String(result.content) : "",
      ]
        .map((item) => item.trim())
        .find((item) => item.length > 0);
      const shouldSettleTerminalFinal =
        Boolean(textFromResult) &&
        !seenCompleted &&
        (!seenDelta || Boolean(sharedBridge));
      const emitSharedTerminalProjection = (
        itemId: string,
        text: string,
      ): boolean => {
        if (
          !sharedBridge?.executionTargetSnapshot ||
          !handlers.onNormalizedRealtimeEvent
        ) {
          return false;
        }
        const runtimeReceipt = getRuntimeReceipt(workspace_id, threadId);
        handlers.onNormalizedRealtimeEvent({
          engine: sharedBridge.engine,
          workspaceId: workspace_id,
          threadId,
          eventId: `shared-terminal:${turnId || itemId}`,
          itemKind: "message",
          timestampMs: Date.now(),
          item: {
            id: itemId,
            kind: "message",
            role: "assistant",
            text,
            isFinal: true,
            engineSource: sharedBridge.engine,
            executionTargetSnapshot: sharedBridge.executionTargetSnapshot,
            ...(runtimeReceipt ? { runtimeReceipt } : {}),
          },
          operation: "completeAgentMessage",
          sourceMethod: method,
          turnId: turnId || null,
        });
        return true;
      };
      if (shouldSettleTerminalFinal && textFromResult) {
        const fallbackItemId =
          (sharedBridge
            ? resolveLatestThreadAgentSnapshotItemId(
                threadAgentSnapshotSeenRef,
                threadId,
              )
            : null) ||
          turnId ||
          `assistant-final-${Date.now()}`;
        if (
          markThreadAgentCompletionSeen(
            threadAgentCompletedSeenRef,
            threadId,
            fallbackItemId,
            textFromResult,
          )
        ) {
          // Shared canvas projection is best-effort; project-memory fusion always
          // needs onAgentMessageCompleted even when projection already succeeded.
          emitSharedTerminalProjection(fallbackItemId, textFromResult);
          handlers.onAgentMessageCompleted?.({
            workspaceId: workspace_id,
            threadId,
            itemId: fallbackItemId,
            text: textFromResult,
            ...(turnId ? { turnId } : {}),
          });
        }
      }
      if (
        !textFromResult &&
        !seenCompleted &&
        !seenDelta &&
        sharedBridge?.executionTargetSnapshot
      ) {
        const provenanceAnchorId =
          resolveLatestThreadAgentSnapshotItemId(
            threadAgentSnapshotSeenRef,
            threadId,
          ) ||
          turnId ||
          `assistant-provenance-${Date.now()}`;
        if (
          markThreadAgentCompletionSeen(
            threadAgentCompletedSeenRef,
            threadId,
            provenanceAnchorId,
            "",
          )
        ) {
          emitSharedTerminalProjection(provenanceAnchorId, "");
        }
      }
      delete threadAgentDeltaSeenRef.current[threadId];
      delete threadAgentCompletedSeenRef.current[threadId];
      delete threadAgentSnapshotSeenRef.current[threadId];
      handlers.onTurnCompleted?.(workspace_id, threadId, turnId);

      // Try to extract usage data from turn/completed (Codex may include it here)
      const usage =
        (params.usage as Record<string, unknown> | undefined) ??
        ((params.result as Record<string, unknown> | undefined)?.usage as
          | Record<string, unknown>
          | undefined);

      if (usage) {
        const inputTokens = Number(
          usage.input_tokens ?? usage.inputTokens ?? 0,
        );
        const outputTokens = Number(
          usage.output_tokens ?? usage.outputTokens ?? 0,
        );
        const cachedInputTokens = Number(
          usage.cached_input_tokens ??
            usage.cache_read_input_tokens ??
            usage.cachedInputTokens ??
            usage.cacheReadInputTokens ??
            0,
        );
        const modelContextWindow = resolveLegacyModelContextWindow(
          threadId,
          usage.model_context_window ?? usage.modelContextWindow,
        );

        if (inputTokens > 0 || outputTokens > 0) {
          const tokenUsage = {
            total: {
              inputTokens,
              outputTokens,
              cachedInputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            last: {
              inputTokens,
              outputTokens,
              cachedInputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            modelContextWindow,
            contextUsageSource: "turn_completed_usage",
            contextUsageFreshness: "estimated",
          };
          handlers.onThreadTokenUsageUpdated?.(
            workspace_id,
            threadId,
            tokenUsage,
          );
        }
      }
    }
    return;
  }

  if (method === "processing/heartbeat") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const pulse = Number(params.pulse ?? 0);
    if (threadId && Number.isFinite(pulse) && pulse > 0) {
      handlers.onProcessingHeartbeat?.(workspace_id, threadId, pulse);
    }
    return;
  }

  if (method === "thread/compacted") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ?? extractThreadIdFromParams(params);
    const turnId = extractTurnIdFromParams(params);
    if (threadId) {
      const sourceFlags = extractCompactionSourceFlags(params);
      const compactionMarkerPayload = {
        ...(sourceFlags ?? {}),
        reason: parseCompactionReason(params.reason),
        tokensBefore: parseNullableTokenCount(params.tokensBefore),
        estimatedTokensAfter: parseNullableTokenCount(
          params.estimatedTokensAfter,
        ),
      };
      handlers.onContextCompacted?.(
        workspace_id,
        threadId,
        turnId,
        compactionMarkerPayload,
      );
    }
    return;
  }

  if (method === "thread/compacting") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ?? extractThreadIdFromParams(params);
    if (threadId) {
      const usagePercentRaw = Number(
        params.usagePercent ?? params.usage_percent,
      );
      const thresholdPercentRaw = Number(
        params.thresholdPercent ?? params.threshold_percent,
      );
      const targetPercentRaw = Number(
        params.targetPercent ?? params.target_percent,
      );
      const sourceFlags = extractCompactionSourceFlags(params);
      const compactionPayload: {
        usagePercent: number | null;
        thresholdPercent: number | null;
        targetPercent: number | null;
        auto?: boolean | null;
        manual?: boolean | null;
      } = {
        usagePercent: Number.isFinite(usagePercentRaw) ? usagePercentRaw : null,
        thresholdPercent: Number.isFinite(thresholdPercentRaw)
          ? thresholdPercentRaw
          : null,
        targetPercent: Number.isFinite(targetPercentRaw)
          ? targetPercentRaw
          : null,
      };
      if (sourceFlags?.auto !== null && sourceFlags?.auto !== undefined) {
        compactionPayload.auto = sourceFlags.auto;
      }
      if (sourceFlags?.manual !== null && sourceFlags?.manual !== undefined) {
        compactionPayload.manual = sourceFlags.manual;
      }
      handlers.onContextCompacting?.(workspace_id, threadId, compactionPayload);
    }
    return;
  }

  if (method === "thread/compactionFailed") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ?? extractThreadIdFromParams(params);
    if (threadId) {
      const reason = String(params.reason ?? "").trim();
      handlers.onContextCompactionFailed?.(workspace_id, threadId, reason);
    }
    return;
  }

  if (method === "turn/plan/updated") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const turnId = String(params.turnId ?? params.turn_id ?? "");
    if (threadId) {
      handlers.onTurnPlanUpdated?.(workspace_id, threadId, turnId, {
        explanation: params.explanation,
        plan: params.plan,
      });
    }
    return;
  }

  if (method === "turn/diff/updated") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const diff = String(params.diff ?? "");
    if (threadId && diff) {
      handlers.onTurnDiffUpdated?.(workspace_id, threadId, diff);
    }
    return;
  }

  if (method === "thread/tokenUsage/updated") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ??
      String(params.threadId ?? params.thread_id ?? "");
    const tokenUsage =
      (params.tokenUsage as Record<string, unknown> | undefined) ??
      (params.token_usage as Record<string, unknown> | undefined);
    if (threadId && tokenUsage) {
      handlers.onThreadTokenUsageUpdated?.(workspace_id, threadId, tokenUsage);
      const windowTokens = Number(
        tokenUsage.modelContextWindow ?? tokenUsage.model_context_window,
      );
      if (
        threadId.startsWith("shared:") &&
        !isAgentAttempt(sharedBridge?.attemptId) &&
        !sharedBridge?.bindingKey?.startsWith("squad:") &&
        Number.isFinite(windowTokens) &&
        windowTokens > 0
      ) {
        emitAssistantRuntimeReceipt(handlers, workspace_id, threadId, {
          model: getRuntimeReceipt(workspace_id, threadId)?.model,
          contextWindowTokens: windowTokens,
          contextWindowSource: "live",
        });
      }
    }
    return;
  }

  // Handle Codex token_count events (Codex sends usage data this way)
  // Format: {"method":"token_count","params":{"info":{"total_token_usage":{...}}}}
  if (method === "token_count") {
    const params = message.params as Record<string, unknown>;
    const info = params.info as Record<string, unknown> | undefined;
    let threadId = String(params.threadId ?? params.thread_id ?? "");
    if (sharedBridge?.sharedThreadId) {
      threadId = sharedBridge.sharedThreadId;
    }

    if (!threadId) {
      threadId = resolveCodexOwnerThreadId(
        handlers,
        workspace_id,
        method,
        params,
      );
    }

    // Skip this event if threadId is still unavailable
    if (!threadId) {
      return;
    }

    if (info) {
      const totalUsageData =
        (info.total_token_usage as Record<string, unknown> | undefined) ??
        (info.totalTokenUsage as Record<string, unknown> | undefined);
      const lastUsageData =
        (info.last_token_usage as Record<string, unknown> | undefined) ??
        (info.lastTokenUsage as Record<string, unknown> | undefined);
      // Prefer last/current snapshot, fallback to total when unavailable.
      const fallbackUsageData = lastUsageData ?? totalUsageData;

      if (fallbackUsageData) {
        const normalizeUsage = (usageData: Record<string, unknown>) => {
          const inputTokens = Number(
            usageData.input_tokens ?? usageData.inputTokens ?? 0,
          );
          const outputTokens = Number(
            usageData.output_tokens ?? usageData.outputTokens ?? 0,
          );
          const cachedInputTokens = Number(
            usageData.cached_input_tokens ??
              usageData.cache_read_input_tokens ??
              usageData.cachedInputTokens ??
              usageData.cacheReadInputTokens ??
              0,
          );
          return {
            inputTokens,
            outputTokens,
            cachedInputTokens,
            totalTokens: inputTokens + outputTokens,
          };
        };

        const totalUsage = normalizeUsage(totalUsageData ?? fallbackUsageData);
        const lastUsage = lastUsageData
          ? normalizeUsage(lastUsageData)
          : {
              inputTokens: 0,
              outputTokens: 0,
              cachedInputTokens: 0,
              totalTokens: 0,
            };
        const modelContextWindow = resolveLegacyModelContextWindow(
          threadId,
          lastUsageData?.model_context_window ??
            lastUsageData?.modelContextWindow ??
            totalUsageData?.model_context_window ??
            totalUsageData?.modelContextWindow ??
            info.model_context_window ??
            info.modelContextWindow,
        );

        const tokenUsage = {
          total: totalUsage,
          last: lastUsage,
          modelContextWindow,
          contextUsageSource: "token_count",
          contextUsageFreshness: "live",
        };

        handlers.onThreadTokenUsageUpdated?.(
          workspace_id,
          threadId,
          tokenUsage,
        );
      }
    }
    return;
  }

  if (method === "account/rateLimits/updated") {
    const params = message.params as Record<string, unknown>;
    const rateLimits =
      (params.rateLimits as Record<string, unknown> | undefined) ??
      (params.rate_limits as Record<string, unknown> | undefined);
    if (rateLimits) {
      handlers.onAccountRateLimitsUpdated?.(workspace_id, rateLimits);
    }
    return;
  }

  if (method === "item/completed") {
    const params = message.params as Record<string, unknown>;
    const rawItemThreadId = extractThreadIdFromParams(params);
    const itemBridge = rawItemThreadId
      ? resolveSharedSessionBindingByNativeThread(workspace_id, rawItemThreadId)
      : null;
    const threadId = itemBridge?.sharedThreadId ?? rawItemThreadId;
    const item =
      params.item && typeof params.item === "object"
        ? hydrateToolSnapshotWithEventParams(
            params.item as Record<string, unknown>,
            params,
          )
        : undefined;
    if (threadId && item) {
      const contextualItem = withRealtimeItemEventContext(
        item,
        params,
        itemBridge?.engine,
      );
      handlers.onItemCompleted?.(workspace_id, threadId, contextualItem);

      // Try to extract usage data from item/completed (Codex may include it here)
      const usage =
        (contextualItem.usage as Record<string, unknown> | undefined) ??
        (params.usage as Record<string, unknown> | undefined);

      if (usage) {
        const inputTokens = Number(
          usage.input_tokens ?? usage.inputTokens ?? 0,
        );
        const outputTokens = Number(
          usage.output_tokens ?? usage.outputTokens ?? 0,
        );
        const cachedInputTokens = Number(
          usage.cached_input_tokens ??
            usage.cache_read_input_tokens ??
            usage.cachedInputTokens ??
            usage.cacheReadInputTokens ??
            0,
        );
        const modelContextWindow = resolveLegacyModelContextWindow(
          threadId,
          usage.model_context_window ?? usage.modelContextWindow,
        );

        if (inputTokens > 0 || outputTokens > 0 || cachedInputTokens > 0) {
          const tokenUsage = {
            total: {
              inputTokens,
              outputTokens,
              cachedInputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            last: {
              inputTokens,
              outputTokens,
              cachedInputTokens,
              totalTokens: inputTokens + outputTokens,
            },
            modelContextWindow,
            contextUsageSource: "item_completed_usage",
            contextUsageFreshness: "estimated",
          };
          handlers.onThreadTokenUsageUpdated?.(
            workspace_id,
            threadId,
            tokenUsage,
          );
        }
      }
    }
    if (threadId && item?.type === "agentMessage") {
      const contextualItem = withRealtimeItemEventContext(
        item,
        params,
        itemBridge?.engine,
      );
      const itemId = String(contextualItem.id ?? "");
      const text = String(contextualItem.text ?? "");
      const turnId = asString(
        contextualItem.turnId ?? contextualItem.turn_id,
      ).trim();
      if (
        itemId &&
        markThreadAgentCompletionSeen(
          threadAgentCompletedSeenRef,
          threadId,
          itemId,
          text,
        )
      ) {
        handlers.onAgentMessageCompleted?.({
          workspaceId: workspace_id,
          threadId,
          itemId,
          text,
          ...(turnId ? { turnId } : {}),
        });
      }
    }
    return;
  }

  if (method === "item/started") {
    const params = message.params as Record<string, unknown>;
    const rawItemThreadId = extractThreadIdFromParams(params);
    const itemBridge = rawItemThreadId
      ? resolveSharedSessionBindingByNativeThread(workspace_id, rawItemThreadId)
      : null;
    const threadId = itemBridge?.sharedThreadId ?? rawItemThreadId;
    const item =
      params.item && typeof params.item === "object"
        ? hydrateToolSnapshotWithEventParams(
            params.item as Record<string, unknown>,
            params,
          )
        : undefined;
    if (threadId && item) {
      const contextualItem = withRealtimeItemEventContext(
        item,
        params,
        itemBridge?.engine,
      );
      if (
        shouldIgnoreAgentMessageSnapshot({
          threadId,
          itemType: String(contextualItem.type ?? ""),
          method,
          threadAgentDeltaSeenRef,
        })
      ) {
        return;
      }
      if (
        String(contextualItem.type ?? "") === "agentMessage" &&
        hasAgentMessageSnapshotText(contextualItem)
      ) {
        threadAgentDeltaSeenRef.current[threadId] = true;
        markThreadAgentSnapshotSeen(
          threadAgentSnapshotSeenRef,
          threadId,
          String(contextualItem.id ?? ""),
        );
      }
      handlers.onItemStarted?.(workspace_id, threadId, contextualItem);
    }
    return;
  }

  if (method === "item/updated") {
    const params = message.params as Record<string, unknown>;
    const rawItemThreadId = extractThreadIdFromParams(params);
    const itemBridge = rawItemThreadId
      ? resolveSharedSessionBindingByNativeThread(workspace_id, rawItemThreadId)
      : null;
    const threadId = itemBridge?.sharedThreadId ?? rawItemThreadId;
    const item =
      params.item && typeof params.item === "object"
        ? hydrateToolSnapshotWithEventParams(
            params.item as Record<string, unknown>,
            params,
          )
        : undefined;
    if (threadId && item) {
      const contextualItem = withRealtimeItemEventContext(
        item,
        params,
        itemBridge?.engine,
      );
      if (
        shouldIgnoreAgentMessageSnapshot({
          threadId,
          itemType: String(contextualItem.type ?? ""),
          method,
          threadAgentDeltaSeenRef,
        })
      ) {
        return;
      }
      if (
        String(contextualItem.type ?? "") === "agentMessage" &&
        hasAgentMessageSnapshotText(contextualItem)
      ) {
        threadAgentDeltaSeenRef.current[threadId] = true;
        markThreadAgentSnapshotSeen(
          threadAgentSnapshotSeenRef,
          threadId,
          String(contextualItem.id ?? ""),
        );
      }
      handlers.onItemUpdated?.(workspace_id, threadId, contextualItem);
    }
    return;
  }

  if (method === "item/backgroundTask/updated") {
    const params = message.params as Record<string, unknown>;
    const rawItemThreadId = extractThreadIdFromParams(params);
    const itemBridge = rawItemThreadId
      ? resolveSharedSessionBindingByNativeThread(workspace_id, rawItemThreadId)
      : null;
    const threadId = itemBridge?.sharedThreadId ?? rawItemThreadId;
    const task =
      params.task && typeof params.task === "object"
        ? (params.task as Record<string, unknown>)
        : null;
    if (threadId && task) {
      handlers.onBackgroundTaskUpdated?.(workspace_id, threadId, {
        toolId: typeof params.toolId === "string" ? params.toolId : null,
        task,
        source: asString(params.source ?? ""),
      });
    }
    return;
  }

  if (
    method === "item/reasoning/summaryTextDelta" ||
    method === "response.reasoning_summary_text.delta" ||
    method === "response.reasoning_summary_text.done" ||
    method === "response.reasoning_summary.delta" ||
    method === "response.reasoning_summary.done" ||
    method === "response.reasoning_summary_part.done"
  ) {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const sharedBridge = resolveSharedSessionBindingByNativeThread(
      workspace_id,
      resolvedThreadId,
    );
    const threadId = sharedBridge?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const delta = extractReasoningDeltaFromParams(params);
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId && delta) {
      const engineHint = inferGeminiReasoningHintFromThreadId(resolvedThreadId);
      emitReasoningSummaryDelta(
        handlers,
        workspace_id,
        threadId,
        itemId,
        delta,
        engineHint,
        turnId,
      );
    }
    return;
  }

  if (
    method === "item/reasoning/summaryPartAdded" ||
    method === "response.reasoning_summary_part.added"
  ) {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const sharedBridge = resolveSharedSessionBindingByNativeThread(
      workspace_id,
      resolvedThreadId,
    );
    const threadId = sharedBridge?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId) {
      const engineHint = inferGeminiReasoningHintFromThreadId(resolvedThreadId);
      emitReasoningSummaryBoundary(
        handlers,
        workspace_id,
        threadId,
        itemId,
        engineHint,
        turnId,
      );
    }
    return;
  }

  if (
    method === "item/reasoning/textDelta" ||
    method === "response.reasoning_text.delta" ||
    method === "response.reasoning_text.done"
  ) {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const sharedBridge = resolveSharedSessionBindingByNativeThread(
      workspace_id,
      resolvedThreadId,
    );
    const threadId = sharedBridge?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const delta = extractReasoningDeltaFromParams(params);
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId && delta) {
      const engineHint = inferGeminiReasoningHintFromThreadId(resolvedThreadId);
      emitReasoningTextDelta(
        handlers,
        workspace_id,
        threadId,
        itemId,
        delta,
        engineHint,
        turnId,
      );
    }
    return;
  }

  // Compatibility for Codex app-server variants that emit reasoning deltas
  // without the "textDelta" suffix.
  if (method === "item/reasoning/delta") {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = resolveCodexOwnerThreadId(
      handlers,
      workspace_id,
      method,
      params,
    );
    const sharedBridge = resolveSharedSessionBindingByNativeThread(
      workspace_id,
      resolvedThreadId,
    );
    const threadId = sharedBridge?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const delta = extractReasoningDeltaFromParams(params);
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId && delta) {
      const engineHint = inferGeminiReasoningHintFromThreadId(resolvedThreadId);
      emitReasoningTextDelta(
        handlers,
        workspace_id,
        threadId,
        itemId,
        delta,
        engineHint,
        turnId,
      );
    }
    return;
  }

  if (method === "item/commandExecution/outputDelta") {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = extractThreadIdFromParams(params);
    const threadId =
      resolveSharedSessionBindingByNativeThread(workspace_id, resolvedThreadId)
        ?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const delta = String(params.delta ?? "");
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId && delta) {
      emitCommandOutputDelta(
        handlers,
        workspace_id,
        threadId,
        itemId,
        delta,
        turnId,
      );
    }
    return;
  }

  if (method === "item/commandExecution/terminalInteraction") {
    const params = message.params as Record<string, unknown>;
    const resolvedThreadId = extractThreadIdFromParams(params);
    const threadId =
      resolveSharedSessionBindingByNativeThread(workspace_id, resolvedThreadId)
        ?.sharedThreadId ?? resolvedThreadId;
    const itemId = extractItemIdFromParams(params);
    const stdin = String(params.stdin ?? "");
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId) {
      emitTerminalInteraction(
        handlers,
        workspace_id,
        threadId,
        itemId,
        stdin,
        turnId,
      );
    }
    return;
  }

  if (method === "item/fileChange/outputDelta") {
    const params = message.params as Record<string, unknown>;
    const threadId = extractThreadIdFromParams(params);
    const itemId = extractItemIdFromParams(params);
    const delta = String(params.delta ?? "");
    const turnId = extractTurnIdFromParams(params) || null;
    if (threadId && itemId && delta) {
      emitFileChangeOutputDelta(
        handlers,
        workspace_id,
        threadId,
        itemId,
        delta,
        turnId,
      );
    }
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
