import { extractRuntimeModelFromPayload, rememberRuntimeReceipt } from "../../threads/utils/runtimeModelReceipt";
import { AppServerEventHandlers } from "./appServerEventTypes";
import { asRecord, extractThreadIdFromParams } from "./appServerEventExtractors";

export function asString(value: unknown): string {
  return typeof value === "string" ? value : value ? String(value) : "";
}

export function emitAssistantRuntimeReceipt(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  incoming: Parameters<typeof rememberRuntimeReceipt>[2],
) {
  const receipt = rememberRuntimeReceipt(workspaceId, threadId, incoming);
  if (!receipt) {
    return;
  }
  handlers.onAssistantRuntimeReceipt?.(workspaceId, threadId, receipt);
}

export function maybeCaptureRuntimeReceipt(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  method: string,
  params: Record<string, unknown>,
  sharedThreadId?: string | null,
  options?: { skip?: boolean },
) {
  if (options?.skip) {
    return;
  }
  const isRaw = method.endsWith("/raw");
  const isTurnCompleted = method === "turn/completed";
  if (!isRaw && !isTurnCompleted) {
    return;
  }
  const rawType = asString(params.type).trim().toLowerCase();
  const subtype = asString(params.subtype).trim().toLowerCase();
  const isRuntimeModelSidecar = rawType === "runtime_model";
  const isAssistantIdentity =
    rawType === "assistant" ||
    subtype === "assistant.message.model" ||
    subtype.includes("assistant");
  const isInitIdentity =
    rawType === "system" ||
    subtype === "system.init.model" ||
    subtype.includes("init");
  if (isRaw && !isRuntimeModelSidecar && !isAssistantIdentity && !isInitIdentity) {
    return;
  }
  const threadId = sharedThreadId || extractThreadIdFromParams(params);
  if (
    !threadId ||
    // 排除式门：Shared canonical attribution 之外，协作画布与 shared-pending
    // 别名不入账；其余（含 native 各引擎与 shared 本体）同吃 source-rank 回写链。
    threadId.startsWith("agent-canvas:") ||
    threadId.includes("-pending-shared-")
  ) {
    return;
  }
  const result = asRecord(params.result);
  const model = extractRuntimeModelFromPayload(params) ??
    extractRuntimeModelFromPayload(result);
  if (!model) {
    return;
  }
  const modelSource = isTurnCompleted
    ? "turn.completed"
    : isRuntimeModelSidecar && isInitIdentity
      ? "system.init.model"
      : isAssistantIdentity || isRuntimeModelSidecar
        ? "assistant.message.model"
        : isInitIdentity
          ? "system.init.model"
          : "assistant.message.model";
  emitAssistantRuntimeReceipt(handlers, workspaceId, threadId, {
    model,
    modelSource,
  });
}

export function emitReasoningSummaryDelta(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  delta: string,
  engineHint: "gemini" | "grok" | "kimi" | "pi" | "dsh" | "qoder" | null,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onReasoningSummaryDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      engineHint,
      turnId,
    );
    return;
  }
  if (engineHint) {
    handlers.onReasoningSummaryDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      engineHint,
    );
    return;
  }
  handlers.onReasoningSummaryDelta?.(workspaceId, threadId, itemId, delta);
}

export function emitReasoningSummaryBoundary(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  engineHint: "gemini" | "grok" | "kimi" | "pi" | "dsh" | "qoder" | null,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onReasoningSummaryBoundary?.(
      workspaceId,
      threadId,
      itemId,
      engineHint,
      turnId,
    );
    return;
  }
  if (engineHint) {
    handlers.onReasoningSummaryBoundary?.(
      workspaceId,
      threadId,
      itemId,
      engineHint,
    );
    return;
  }
  handlers.onReasoningSummaryBoundary?.(workspaceId, threadId, itemId);
}

export function emitReasoningTextDelta(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  delta: string,
  engineHint: "gemini" | "grok" | "kimi" | "pi" | "dsh" | "qoder" | null,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onReasoningTextDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      engineHint,
      turnId,
    );
    return;
  }
  if (engineHint) {
    handlers.onReasoningTextDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      engineHint,
    );
    return;
  }
  handlers.onReasoningTextDelta?.(workspaceId, threadId, itemId, delta);
}

export function emitCommandOutputDelta(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  delta: string,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onCommandOutputDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      turnId,
    );
    return;
  }
  handlers.onCommandOutputDelta?.(workspaceId, threadId, itemId, delta);
}

export function emitFileChangeOutputDelta(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  delta: string,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onFileChangeOutputDelta?.(
      workspaceId,
      threadId,
      itemId,
      delta,
      turnId,
    );
    return;
  }
  handlers.onFileChangeOutputDelta?.(workspaceId, threadId, itemId, delta);
}

export function emitTerminalInteraction(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  threadId: string,
  itemId: string,
  stdin: string,
  turnId: string | null,
): void {
  if (turnId) {
    handlers.onTerminalInteraction?.(
      workspaceId,
      threadId,
      itemId,
      stdin,
      turnId,
    );
    return;
  }
  handlers.onTerminalInteraction?.(workspaceId, threadId, itemId, stdin);
}

