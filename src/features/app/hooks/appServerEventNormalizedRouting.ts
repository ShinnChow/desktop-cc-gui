import type { MutableRefObject } from "react";
import type { NormalizedThreadEvent } from "../../threads/contracts/conversationCurtainContracts";
import type { SharedSessionNativeBinding } from "../../shared-session/runtime/sharedSessionBridge";
import { getActiveTurnTargetForAttempt } from "../../shared-session/target/targetStore";
import { getNativeTurnTarget } from "../../threads/utils/nativeTurnTargetLedger";
import { getRealtimeAdapterByEngine, inferRealtimeAdapterEngine } from "../../threads/adapters/realtimeAdapterRegistry";
import { getRuntimeReceipt } from "../../threads/utils/runtimeModelReceipt";
import { isAgentCanvasThreadId, parseAgentCanvasThreadId } from "../../multi-agent/runtime/agentCanvasThread";
import { resolveConversationAssemblyMigrationGate } from "../../threads/assembly/conversationMigrationGates";
import { AppServerEventHandlers } from "./appServerEventTypes";
import { ThreadAgentCompletedItemTracker, ThreadAgentSnapshotItemTracker, cloneMessageWithThreadId, extractTokenUsageFromNormalizedEvent, hasThreadAgentSnapshotSeen, markThreadAgentCompletionSeen, markThreadAgentSnapshotSeen, shouldIgnoreAgentMessageSnapshot } from "./appServerEventExtractors";
import { asString, emitCommandOutputDelta, emitFileChangeOutputDelta, emitReasoningSummaryBoundary, emitReasoningSummaryDelta, emitReasoningTextDelta } from "./appServerEventEmitters";

export function routeNormalizedRealtimeEvent({
  handlers,
  workspaceId,
  event,
  threadAgentDeltaSeenRef,
  threadAgentCompletedSeenRef,
  threadAgentSnapshotSeenRef,
}: {
  handlers: AppServerEventHandlers;
  workspaceId: string;
  event: NormalizedThreadEvent;
  threadAgentDeltaSeenRef: MutableRefObject<Record<string, true>>;
  threadAgentCompletedSeenRef: MutableRefObject<ThreadAgentCompletedItemTracker>;
  threadAgentSnapshotSeenRef: MutableRefObject<ThreadAgentSnapshotItemTracker>;
}): boolean {
  const threadId = event.threadId;
  const itemId = event.item.id;
  const turnId = event.turnId ?? null;
  const shouldRouteDirectly =
    Boolean(handlers.onNormalizedRealtimeEvent) &&
    (event.engine === "codex" ||
      event.threadId.startsWith("shared:") ||
      // 协作节点 Inspector 幕布：与 shared 同源 normalized 路由
      event.threadId.startsWith("agent-canvas:"));
  switch (event.operation) {
    case "itemStarted":
      if (
        event.engine === "codex" &&
        event.item.kind === "message" &&
        event.item.role === "assistant"
      ) {
        markThreadAgentSnapshotSeen(
          threadAgentSnapshotSeenRef,
          threadId,
          itemId,
        );
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.(event);
        return true;
      }
      if (event.rawItem) {
        handlers.onItemStarted?.(workspaceId, threadId, event.rawItem);
        return true;
      }
      return false;
    case "itemUpdated":
      if (
        event.engine === "codex" &&
        event.item.kind === "message" &&
        event.item.role === "assistant"
      ) {
        markThreadAgentSnapshotSeen(
          threadAgentSnapshotSeenRef,
          threadId,
          itemId,
        );
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.(event);
        return true;
      }
      if (event.rawItem) {
        handlers.onItemUpdated?.(workspaceId, threadId, event.rawItem);
        return true;
      }
      return false;
    case "itemCompleted":
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.(event);
        const tokenUsage = extractTokenUsageFromNormalizedEvent(event);
        if (tokenUsage) {
          handlers.onThreadTokenUsageUpdated?.(
            workspaceId,
            threadId,
            tokenUsage,
          );
        }
        return true;
      }
      if (event.rawItem) {
        handlers.onItemCompleted?.(workspaceId, threadId, event.rawItem);
        const tokenUsage = extractTokenUsageFromNormalizedEvent(event);
        if (tokenUsage) {
          handlers.onThreadTokenUsageUpdated?.(
            workspaceId,
            threadId,
            tokenUsage,
          );
        }
        return true;
      }
      return false;
    case "appendAgentMessageDelta": {
      if (
        shouldIgnoreAgentMessageSnapshot({
          threadId,
          itemType: "agentMessage",
          method: event.sourceMethod,
          threadAgentDeltaSeenRef,
        })
      ) {
        // Claude should accept growing item/updated snapshots so the curtain can
        // reveal long Markdown before completion, but item/started snapshots are
        // still treated as setup noise. Other engines only ignore snapshot aliases
        // after a real streaming delta has already arrived.
        return true;
      }
      const delta =
        event.delta ?? (event.item.kind === "message" ? event.item.text : "");
      if (!delta) {
        return false;
      }
      if (
        event.engine === "codex" &&
        hasThreadAgentSnapshotSeen(threadAgentSnapshotSeenRef, threadId, itemId)
      ) {
        return true;
      }
      markThreadAgentSnapshotSeen(
        threadAgentSnapshotSeenRef,
        threadId,
        itemId,
      );
      threadAgentDeltaSeenRef.current[threadId] = true;
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.({
          ...event,
          delta,
          item:
            event.item.kind === "message"
              ? { ...event.item, text: delta }
              : event.item,
        });
        return true;
      }
      handlers.onAgentMessageDelta?.({
        workspaceId,
        threadId,
        itemId,
        delta,
        ...(turnId ? { turnId } : {}),
      });
      return true;
    }
    case "completeAgentMessage": {
      const text = event.item.kind === "message" ? event.item.text : "";
      const tokenUsage = extractTokenUsageFromNormalizedEvent(event);
      if (tokenUsage) {
        handlers.onThreadTokenUsageUpdated?.(workspaceId, threadId, tokenUsage);
      }
      if (
        !markThreadAgentCompletionSeen(
          threadAgentCompletedSeenRef,
          threadId,
          itemId,
          text,
        )
      ) {
        return true;
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.(event);
        return true;
      }
      if (event.rawItem) {
        handlers.onItemCompleted?.(workspaceId, threadId, event.rawItem);
      }
      handlers.onAgentMessageCompleted?.({
        workspaceId,
        threadId,
        itemId,
        text,
        ...(turnId ? { turnId } : {}),
      });
      return true;
    }
    case "appendReasoningSummaryDelta": {
      const delta = event.delta ?? "";
      if (!delta) {
        return false;
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.({
          ...event,
          delta,
          item:
            event.item.kind === "reasoning"
              ? {
                  ...event.item,
                  summary: delta,
                }
              : event.item,
        });
        return true;
      }
      emitReasoningSummaryDelta(
        handlers,
        workspaceId,
        threadId,
        itemId,
        delta,
        event.engine === "gemini" || event.engine === "grok" || event.engine === "kimi" || event.engine === "pi" || event.engine === "omp" || event.engine === "qoder" ? event.engine : null,
        turnId,
      );
      return true;
    }
    case "appendReasoningSummaryBoundary":
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.(event);
        return true;
      }
      emitReasoningSummaryBoundary(
        handlers,
        workspaceId,
        threadId,
        itemId,
        event.engine === "gemini" || event.engine === "grok" || event.engine === "kimi" || event.engine === "pi" || event.engine === "omp" || event.engine === "qoder" ? event.engine : null,
        turnId,
      );
      return true;
    case "appendReasoningContentDelta": {
      const delta = event.delta ?? "";
      if (!delta) {
        return false;
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.({
          ...event,
          delta,
          item:
            event.item.kind === "reasoning"
              ? {
                  ...event.item,
                  content: delta,
                }
              : event.item,
        });
        return true;
      }
      emitReasoningTextDelta(
        handlers,
        workspaceId,
        threadId,
        itemId,
        delta,
        event.engine === "gemini" || event.engine === "grok" || event.engine === "kimi" || event.engine === "pi" || event.engine === "omp" || event.engine === "qoder" ? event.engine : null,
        turnId,
      );
      return true;
    }
    case "appendToolOutputDelta": {
      const delta = event.delta ?? "";
      if (!delta || event.item.kind !== "tool") {
        return false;
      }
      if (shouldRouteDirectly) {
        handlers.onNormalizedRealtimeEvent?.({
          ...event,
          delta,
          item: {
            ...event.item,
            output: delta,
          },
        });
        return true;
      }
      if (event.item.toolType === "fileChange") {
        emitFileChangeOutputDelta(
          handlers,
          workspaceId,
          threadId,
          itemId,
          delta,
          turnId,
        );
      } else {
        emitCommandOutputDelta(
          handlers,
          workspaceId,
          threadId,
          itemId,
          delta,
          turnId,
        );
      }
      return true;
    }
    default:
      return false;
  }
}

export function tryRouteNormalizedRealtimeEvent({
  handlers,
  workspaceId,
  message,
  engineOverride,
  threadIdOverride,
  sharedBinding,
  threadAgentDeltaSeenRef,
  threadAgentCompletedSeenRef,
  threadAgentSnapshotSeenRef,
}: {
  handlers: AppServerEventHandlers;
  workspaceId: string;
  message: Record<string, unknown>;
  engineOverride?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
  threadIdOverride?: string;
  sharedBinding?: SharedSessionNativeBinding | null;
  threadAgentDeltaSeenRef: MutableRefObject<Record<string, true>>;
  threadAgentCompletedSeenRef: MutableRefObject<ThreadAgentCompletedItemTracker>;
  threadAgentSnapshotSeenRef: MutableRefObject<ThreadAgentSnapshotItemTracker>;
}): boolean {
  const params = (message.params as Record<string, unknown> | undefined) ?? {};
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const rawThreadId = asString(
    params.threadId ??
      params.thread_id ??
      turn.threadId ??
      turn.thread_id ??
      "",
  );
  const effectiveThreadId = threadIdOverride || rawThreadId;
  if (!effectiveThreadId) {
    return false;
  }
  const engine =
    engineOverride ?? inferRealtimeAdapterEngine(effectiveThreadId);
  const migrationGate = resolveConversationAssemblyMigrationGate(engine);
  if (migrationGate && !migrationGate.assemblerEnabled) {
    return false;
  }
  const adapter = getRealtimeAdapterByEngine(engine);
  const shouldInjectThreadId = Boolean(threadIdOverride);
  const normalized = adapter.mapEvent({
    workspaceId,
    message: shouldInjectThreadId
      ? cloneMessageWithThreadId(message, effectiveThreadId)
      : message,
  });
  if (!normalized) {
    return false;
  }
  const isSharedOwnerProjection = effectiveThreadId.startsWith("shared:");
  const isAgentCanvasProjection = isAgentCanvasThreadId(effectiveThreadId);
  // Shared 投影读同一 store；native 打开同款注入，Ⓡ 尾巴与展开面板随之可用。
  const runtimeReceipt =
    isSharedOwnerProjection || (!isAgentCanvasProjection && !sharedBinding)
      ? getRuntimeReceipt(workspaceId, effectiveThreadId)
      : null;
  // Native turn-target：codex 等走 normalized 直达路由的引擎也按发送边界账本
  // 标注本轮 provenance（shared canonical / attempt 注入优先级不变）。
  const nativeExecutionTargetSnapshot =
    !isSharedOwnerProjection && !isAgentCanvasProjection
      ? getNativeTurnTarget(workspaceId, effectiveThreadId)
      : null;
  if (
    shouldInjectThreadId ||
    isSharedOwnerProjection ||
    Boolean(nativeExecutionTargetSnapshot)
  ) {
    // agent-canvas: 事件写到隔离 thread，但 activeTurn 挂在 shared: 上
    const activeTurnThreadId = isAgentCanvasProjection
      ? parseAgentCanvasThreadId(effectiveThreadId)?.sharedThreadId ??
        effectiveThreadId
      : effectiveThreadId;
    const executionTargetSnapshot =
      sharedBinding?.executionTargetSnapshot ??
      (sharedBinding?.attemptId
        ? getActiveTurnTargetForAttempt(
            workspaceId,
            activeTurnThreadId,
            sharedBinding.attemptId,
          )
        : null) ?? nativeExecutionTargetSnapshot;
    if (shouldInjectThreadId || isSharedOwnerProjection) {
      normalized.threadId = effectiveThreadId;
    }
    normalized.item =
      // context-event 留痕不携带 engineSource（合成 item，非引擎产物）。
      normalized.item.kind === "context-event"
        ? normalized.item
        : {
            ...normalized.item,
            engineSource: engine,
            ...(normalized.item.kind === "message" &&
            normalized.item.role === "assistant"
              ? {
                  ...(executionTargetSnapshot ? { executionTargetSnapshot } : {}),
                  ...(runtimeReceipt ? { runtimeReceipt } : {}),
                }
              : {}),
          };
    if (normalized.rawItem) {
      normalized.rawItem = {
        ...normalized.rawItem,
        engineSource: engine,
      };
    }
  }
  return routeNormalizedRealtimeEvent({
    handlers,
    workspaceId,
    event: normalized,
    threadAgentDeltaSeenRef,
    threadAgentCompletedSeenRef,
    threadAgentSnapshotSeenRef,
  });
}

/**
 * Module-level dispatcher for a single `AppServerEvent`.
 *
 * Extracted from the `useAppServerEvents` `useEffect` callback so both the
 * fallback raw subscription and the v2 scheduled consumer share one routing
 * path. Sharing matters: a per-event closure copy would double-register
 * handlers and cause duplicate reducer dispatches when multiple channels are
 * active.
 *
 * All closure-captured state (handlers, refs, runtime options) is
 * passed explicitly so the dispatcher has no hidden dependencies and is
 * unit-testable in isolation.
 */

