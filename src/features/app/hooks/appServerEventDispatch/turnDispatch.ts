import type { AppServerEvent } from "../../../../types";
import { getRuntimeReceipt } from "../../../threads/utils/runtimeModelReceipt";
import { asString } from "../appServerEventEmitters";
import { hasThreadAgentCompletion, markThreadAgentCompletionSeen, resolveEventEngine, resolveLatestThreadAgentSnapshotItemId, resolveLegacyModelContextWindow } from "../appServerEventExtractors";
import type { AppServerEventDispatchContext } from "./types";

export function dispatchTurnFamily(
  ctx: AppServerEventDispatchContext,
  method: string,
  payload: AppServerEvent,
): boolean {
  const {
    handlers,
    sharedBridge,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  } = ctx;
  const { workspace_id, message } = payload;

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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }
  return false;
}
