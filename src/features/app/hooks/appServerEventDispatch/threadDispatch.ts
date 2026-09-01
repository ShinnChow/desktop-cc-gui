import type { AppServerEvent } from "../../../../types";
import { getRuntimeReceipt } from "../../../threads/utils/runtimeModelReceipt";
import { hasPendingSharedSessionBindingForEngine, rebindSharedSessionNativeThread, resolvePendingSharedSessionBindingForEngine, resolvePendingSharedSessionBindingForTarget, resolveSharedSessionBindingByNativeThread } from "../../../shared-session/runtime/sharedSessionBridge";
import { isAgentAttempt } from "../../../multi-agent/store/agentStore";
import { isSharedSessionSupportedEngine } from "../../../shared-session/utils/sharedSessionEngines";
import { isSharedV2SendEnabled } from "../../../shared-session/runtime/sharedV2SendFlag";
import { migrateThreadAgentEventTracking } from "../appServerEventAgentTracking";
import { updateSharedSessionNativeBinding as updateSharedSessionNativeBindingService } from "../../../shared-session/services/sharedSessions";
import { classifyCodexEventRisk, resolveCodexEventOwnership } from "../codexEventOwnership";
import { asString, emitAssistantRuntimeReceipt } from "../appServerEventEmitters";
import { asStringArray, extractCompactionSourceFlags, extractRuntimeEndedTurnMap, extractThreadIdFromParams, extractTurnIdFromParams, parseCompactionReason, parseNullableTokenCount, resolveCodexOwnerThreadId, resolveEventEngine, resolveFinalizedSharedNativeThreadId, resolveLegacyModelContextWindow, resolveThreadStartedProviderProfileId, shouldRebindSharedNativeThreadOnStartedEvent } from "../appServerEventExtractors";
import type { AppServerEventDispatchContext } from "./types";

export function dispatchThreadFamily(
  ctx: AppServerEventDispatchContext,
  method: string,
  payload: AppServerEvent,
): boolean {
  const {
    handlers,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  } = ctx;
  let sharedBridge = ctx.sharedBridge;
  const { workspace_id, message } = payload;

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
      rawEngine === "omp" ||
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
        eventEngine !== "omp" &&
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
      return true;
    }
    if (skipNativeThreadStart) {
      return true;
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
    return true;
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
      return true;
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
    return true;
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
      return true;
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
    return true;
  }

  if (method === "codex/backgroundThread") {
    if (sharedBridge) {
      return true;
    }
    const params = message.params as Record<string, unknown>;
    const threadId = String(params.threadId ?? params.thread_id ?? "");
    const action = String(params.action ?? "hide");
    if (threadId) {
      handlers.onBackgroundThreadAction?.(workspace_id, threadId, action);
    }
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }

  if (method === "thread/compactionFailed") {
    const params = message.params as Record<string, unknown>;
    const threadId =
      sharedBridge?.sharedThreadId ?? extractThreadIdFromParams(params);
    if (threadId) {
      const reason = String(params.reason ?? "").trim();
      handlers.onContextCompactionFailed?.(workspace_id, threadId, reason);
    }
    return true;
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
    return true;
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
      return true;
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
    return true;
  }

  if (method === "account/rateLimits/updated") {
    const params = message.params as Record<string, unknown>;
    const rateLimits =
      (params.rateLimits as Record<string, unknown> | undefined) ??
      (params.rate_limits as Record<string, unknown> | undefined);
    if (rateLimits) {
      handlers.onAccountRateLimitsUpdated?.(workspace_id, rateLimits);
    }
    return true;
  }
  return false;
}
