import type { AppServerEvent } from "../../../../types";
import { hydrateToolSnapshotWithEventParams } from "../../../threads/adapters/toolSnapshotHydration";
import { resolveSharedRuntimeControlOwner, resolveSharedSessionBindingByNativeThread } from "../../../shared-session/runtime/sharedSessionBridge";
import { extractItemIdFromParams, extractReasoningDeltaFromParams, extractThreadIdFromParams, extractTurnIdFromParams, hasAgentMessageSnapshotText, inferGeminiReasoningHintFromThreadId, markThreadAgentCompletionSeen, markThreadAgentSnapshotSeen, resolveCodexOwnerThreadId, resolveLegacyModelContextWindow, shouldIgnoreAgentMessageSnapshot, withRealtimeItemEventContext } from "../appServerEventExtractors";
import { asString, emitCommandOutputDelta, emitFileChangeOutputDelta, emitReasoningSummaryBoundary, emitReasoningSummaryDelta, emitReasoningTextDelta, emitTerminalInteraction } from "../appServerEventEmitters";
import type { AppServerEventDispatchContext } from "./types";

export function dispatchItemFamily(
  ctx: AppServerEventDispatchContext,
  method: string,
  payload: AppServerEvent,
): boolean {
  const {
    handlers,
    rawThreadId,
    sharedBridge,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  } = ctx;
  const { workspace_id, message } = payload;

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
      return true;
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
      return true;
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
    return true;
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
    return true;
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
        return true;
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
    return true;
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
        return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
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
    return true;
  }
  return false;
}
