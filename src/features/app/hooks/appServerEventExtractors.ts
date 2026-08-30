import type { AppServerEvent } from "../../../types";
import type { ConversationEngine, NormalizedThreadEvent } from "../../threads/contracts/conversationCurtainContracts";
import type { MutableRefObject } from "react";
import { canonicalQoderThreadId, parseQoderSessionIdentity } from "../../threads/utils/qoderSessionIdentity";
import { classifyCodexEventRisk, resolveCodexEventOwnership } from "./codexEventOwnership";
import { inferRealtimeAdapterEngine } from "../../threads/adapters/realtimeAdapterRegistry";
import { isGeneratedImageToolName } from "../../../utils/generatedImageArtifacts";
import { AppServerEventHandlers } from "./appServerEventTypes";
import { asString } from "./appServerEventEmitters";

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function parseOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
  }
  return null;
}

export function extractCompactionSourceFlags(params: Record<string, unknown>) {
  const auto = parseOptionalBoolean(params.auto ?? params.automatic);
  const manual = parseOptionalBoolean(params.manual);
  if (auto === null && manual === null) {
    return null;
  }
  return { auto, manual };
}

/** pi compaction_end 的触发原因（threshold/overflow/manual）；缺失为 null。 */
export function parseCompactionReason(value: unknown): "threshold" | "overflow" | "manual" | null {
  return value === "threshold" || value === "overflow" || value === "manual"
    ? value
    : null;
}

export function parseNullableTokenCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => asString(entry).trim())
    .filter((entry) => entry.length > 0);
}

export function extractRuntimeEndedTurnMap(value: unknown): Map<string, string> {
  const turnMap = new Map<string, string>();
  if (!Array.isArray(value)) {
    return turnMap;
  }
  value.forEach((entry) => {
    const objectEntry =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    if (!objectEntry) {
      return;
    }
    const threadId = asString(
      objectEntry.threadId ?? objectEntry.thread_id,
    ).trim();
    const turnId = asString(objectEntry.turnId ?? objectEntry.turn_id).trim();
    if (!threadId || !turnId) {
      return;
    }
    turnMap.set(threadId, turnId);
  });
  return turnMap;
}

export function extractThreadIdFromParams(params: Record<string, unknown>): string {
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const threadObj =
    (params.thread as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.threadId ??
      params.thread_id ??
      turn.threadId ??
      turn.thread_id ??
      threadObj.threadId ??
      threadObj.thread_id ??
      threadObj.id ??
      "",
  ).trim();
}

export function resolveCodexOwnerThreadId(
  handlers: AppServerEventHandlers,
  workspaceId: string,
  method: string,
  params: Record<string, unknown>,
): string {
  const explicitThreadId = extractThreadIdFromParams(params);
  const fallbackThreadId = explicitThreadId
    ? null
    : (handlers.getSingleProcessingCodexThreadId?.(workspaceId) ?? null);
  const ownership = resolveCodexEventOwnership({
    workspaceId,
    risk: classifyCodexEventRisk(method),
    explicitThreadId,
    explicitTurnId: extractTurnIdFromParams(params),
    ...(explicitThreadId ? { explicitSource: "payload" as const } : {}),
    boundedFallbackThreadIds: fallbackThreadId ? [fallbackThreadId] : [],
  });
  return ownership.kind === "explicit" || ownership.kind === "boundedFallback"
    ? ownership.threadId
    : "";
}

export function getAppServerEventMethod(payload: AppServerEvent): string {
  return String(payload.message.method ?? "");
}

export function getAppServerEventParams(
  payload: AppServerEvent,
): Record<string, unknown> {
  return (payload.message.params as Record<string, unknown> | undefined) ?? {};
}

export function buildCoalescibleAppServerEventKey(
  payload: AppServerEvent,
): string | null {
  const method = getAppServerEventMethod(payload);
  const params = getAppServerEventParams(payload);
  switch (method) {
    case "processing/heartbeat":
    case "thread/tokenUsage/updated":
    case "thread/compacting":
    case "turn/diff/updated": {
      const threadId = extractThreadIdFromParams(params);
      return threadId
        ? `${payload.workspace_id}\0${method}\0${threadId}`
        : null;
    }
    case "account/rateLimits/updated":
      return `${payload.workspace_id}\0${method}`;
    default:
      return null;
  }
}

export function coalesceAppServerEventBatch(
  batch: readonly AppServerEvent[],
): AppServerEvent[] {
  const coalesced: AppServerEvent[] = [];
  let previousCoalesceKey: string | null = null;
  for (const payload of batch) {
    const coalesceKey = buildCoalescibleAppServerEventKey(payload);
    if (
      coalesceKey &&
      previousCoalesceKey === coalesceKey &&
      coalesced.length > 0
    ) {
      coalesced[coalesced.length - 1] = payload;
    } else {
      coalesced.push(payload);
    }
    previousCoalesceKey = coalesceKey;
  }
  return coalesced;
}

export function extractTurnIdFromParams(params: Record<string, unknown>): string {
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.turnId ??
      params.turn_id ??
      turn.id ??
      turn.turnId ??
      turn.turn_id ??
      "",
  ).trim();
}

export const PROVIDER_CONTINUATION_BOOTSTRAP_TURN_PREFIX =
  "provider-continuation-";

export function isProviderContinuationBootstrapEvent(
  payload: AppServerEvent,
): boolean {
  const params = getAppServerEventParams(payload);
  return extractTurnIdFromParams(params).startsWith(
    PROVIDER_CONTINUATION_BOOTSTRAP_TURN_PREFIX,
  );
}

export function extractItemIdFromParams(params: Record<string, unknown>): string {
  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const itemObj = (params.item as Record<string, unknown> | undefined) ?? {};
  const messageObj =
    (params.message as Record<string, unknown> | undefined) ?? {};
  const partObj = (params.part as Record<string, unknown> | undefined) ?? {};
  const contentObj =
    (params.content as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.itemId ??
      params.item_id ??
      partObj.itemId ??
      partObj.item_id ??
      itemObj.id ??
      itemObj.itemId ??
      itemObj.item_id ??
      messageObj.id ??
      contentObj.itemId ??
      contentObj.item_id ??
      turn.itemId ??
      turn.item_id ??
      "",
  ).trim();
}

export function extractReasoningDeltaFromParams(
  params: Record<string, unknown>,
): string {
  const partObj = (params.part as Record<string, unknown> | undefined) ?? {};
  const itemObj = (params.item as Record<string, unknown> | undefined) ?? {};
  const contentObj =
    (params.content as Record<string, unknown> | undefined) ?? {};
  return asString(
    params.delta ??
      params.text ??
      params.summary ??
      partObj.delta ??
      partObj.text ??
      partObj.summary ??
      itemObj.delta ??
      itemObj.text ??
      itemObj.summary ??
      contentObj.delta ??
      contentObj.text ??
      contentObj.summary ??
      "",
  ).trim();
}

export function extractAgentMessageDeltaPayload(
  method: string,
  params: Record<string, unknown>,
): {
  threadId: string;
  itemId: string;
  delta: string;
  turnId: string | null;
} | null {
  const isTextAliasMethod = method === "text:delta" || method === "text/delta";
  const isAgentDeltaMethod =
    method === "item/agentMessage/delta" ||
    method === "item/agentMessage/textDelta" ||
    method === "item/agentMessage/text/delta" ||
    isTextAliasMethod;
  if (!isAgentDeltaMethod) {
    return null;
  }

  const turn = (params.turn as Record<string, unknown> | undefined) ?? {};
  const itemObj = (params.item as Record<string, unknown> | undefined) ?? {};
  const messageObj =
    (params.message as Record<string, unknown> | undefined) ?? {};
  const partObj = (params.part as Record<string, unknown> | undefined) ?? {};
  const threadId = extractThreadIdFromParams(params);
  const turnId = extractTurnIdFromParams(params);
  if (
    isTextAliasMethod &&
    !isClaudeThreadId(threadId) &&
    !isGeminiThreadId(threadId) &&
    !isGrokThreadId(threadId) &&
    !isKimiThreadId(threadId) &&
    !isPiThreadId(threadId) &&
    !isQoderThreadId(threadId) &&
    !isDshThreadId(threadId)
  ) {
    return null;
  }
  const rawItemId = asString(
    params.itemId ??
      params.item_id ??
      itemObj.id ??
      messageObj.id ??
      partObj.itemId ??
      partObj.item_id ??
      turn.itemId ??
      turn.item_id ??
      (!isTextAliasMethod ? turn.id : "") ??
      "",
  ).trim();
  const itemId =
    rawItemId || (isTextAliasMethod ? `${threadId}:text-delta` : "");
  const delta = asString(
    params.delta ??
      params.text ??
      params.output_text ??
      params.outputText ??
      params.content ??
      partObj.delta ??
      partObj.text ??
      partObj.content ??
      itemObj.delta ??
      itemObj.text ??
      itemObj.content ??
      messageObj.delta ??
      messageObj.text ??
      messageObj.content ??
      "",
  );

  if (!threadId || !itemId || !delta) {
    return null;
  }
  return { threadId, itemId, delta, turnId: turnId || null };
}

export function withRealtimeItemEventContext(
  item: Record<string, unknown>,
  params: Record<string, unknown>,
  engineSource?: ConversationEngine,
): Record<string, unknown> {
  const turnId = extractTurnIdFromParams(params);
  const existingTurnId = asString(item.turnId ?? item.turn_id).trim();
  return {
    ...item,
    ...(turnId && !existingTurnId ? { turnId } : {}),
    ...(engineSource ? { engineSource } : {}),
  };
}

export function resolveEventEngine(
  threadId: string,
  engineHint?: ConversationEngine | null,
): ConversationEngine {
  return engineHint ?? inferRealtimeAdapterEngine(threadId);
}

export function cloneMessageWithThreadId(
  message: Record<string, unknown>,
  threadId: string,
): Record<string, unknown> {
  const params = (message.params as Record<string, unknown> | undefined) ?? {};
  const nextParams: Record<string, unknown> = {
    ...params,
    threadId,
    thread_id: threadId,
  };
  const turn = (params.turn as Record<string, unknown> | undefined) ?? null;
  if (turn) {
    nextParams.turn = {
      ...turn,
      threadId,
      thread_id: threadId,
    };
  }
  const thread = (params.thread as Record<string, unknown> | undefined) ?? null;
  if (thread) {
    nextParams.thread = {
      ...thread,
      id: threadId,
    };
  }
  return {
    ...message,
    params: nextParams,
  };
}

export function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export function toOptionalNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function isClaudeThreadId(threadId: string): boolean {
  return (
    threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")
  );
}

export function resolveLegacyModelContextWindow(
  threadId: string,
  value: unknown,
): number | null {
  const parsed = toOptionalNumber(value);
  if (parsed !== null && parsed > 0) {
    return parsed;
  }
  // Claude/Codex（含 codex-pending）不伪造 200K 默认窗口：三方 provider 的真实
  // 窗口未知（128K~1M 都有可能），伪造值只会产生误导百分比；window 未上报时
  // 透传 null，context 指示器按「未上报」降级
  // （fix-codex-third-party-provider-model-catalog）。其他引擎维持原行为。
  if (
    isClaudeThreadId(threadId) ||
    threadId.startsWith("codex:") ||
    threadId.startsWith("codex-pending-")
  ) {
    return null;
  }
  return 200000;
}

export function isGeminiThreadId(threadId: string): boolean {
  return (
    threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")
  );
}

export function isKimiThreadId(threadId: string): boolean {
  return (
    threadId.startsWith("kimi:") || threadId.startsWith("kimi-pending-")
  );
}

export function isPiThreadId(threadId: string): boolean {
  return threadId.startsWith("pi:") || threadId.startsWith("pi-pending-");
}

export function isQoderThreadId(threadId: string): boolean {
  return threadId.startsWith("qoder:") || threadId.startsWith("qoder-pending-");
}

export function isGrokThreadId(threadId: string): boolean {
  return (
    threadId.startsWith("grok:") || threadId.startsWith("grok-pending-")
  );
}

export function isDshThreadId(threadId: string): boolean {
  return (
    threadId.startsWith("dsh:") || threadId.startsWith("dsh-pending-")
  );
}

export function inferGeminiReasoningHintFromThreadId(
  threadId: string,
): "gemini" | "grok" | "kimi" | "pi" | "dsh" | "qoder" | null {
  if (!threadId) {
    return null;
  }
  if (isGrokThreadId(threadId)) {
    return "grok";
  }
  if (isKimiThreadId(threadId)) {
    return "kimi";
  }
  if (isPiThreadId(threadId)) {
    return "pi";
  }
  if (isQoderThreadId(threadId)) {
    return "qoder";
  }
  if (isDshThreadId(threadId)) {
    return "dsh";
  }
  return isGeminiThreadId(threadId) ? "gemini" : null;
}

export function inferRawMethodEngine(
  method: string,
): "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "dsh" | "qoder" | undefined {
  switch (method) {
    case "claude/raw":
      return "claude";
    case "codex/raw":
      return "codex";
    case "gemini/raw":
      return "gemini";
    case "grok/raw":
      return "grok";
    case "kimi/raw":
      return "kimi";
    case "opencode/raw":
      return "opencode";
    case "pi/raw":
      return "pi";
    case "qoder/raw":
      return "qoder";
    case "dsh/raw":
      return "dsh";
    default:
      return undefined;
  }
}

export function isCodexRawGeneratedImageEvent(
  method: string,
  params: Record<string, unknown>,
): boolean {
  if (method !== "codex/raw") {
    return false;
  }
  const rawEntryType = asString(params.type ?? "")
    .trim()
    .toLowerCase();
  if (rawEntryType !== "event_msg" && rawEntryType !== "response_item") {
    return false;
  }
  const payload =
    params.payload && typeof params.payload === "object"
      ? (params.payload as Record<string, unknown>)
      : null;
  if (!payload) {
    return false;
  }
  const payloadType = asString(payload.type ?? "")
    .trim()
    .toLowerCase();
  if (payloadType === "function_call") {
    return isGeneratedImageToolName(
      asString(payload.name ?? payload.tool ?? ""),
    );
  }
  return (
    payloadType === "image_generation_call" ||
    payloadType === "image_generation_end" ||
    payloadType === "function_call_output"
  );
}

export function shouldRebindSharedNativeThreadOnStartedEvent(
  engine: "claude" | "opencode" | "codex" | "gemini" | "grok" | "kimi" | "pi" | "qoder",
): boolean {
  // Claude 与 local CLIs 在 thread/started 上可能从 pending 占位收敛到
  // `engine:{sessionId}`；Codex 使用 raw thread id，不在此路径做前缀 rebind。
  // Qoder 终态 id 额外带 distribution：`qoder:<profile>:<sessionId>`。
  return (
    engine === "claude" ||
    engine === "kimi" ||
    engine === "grok" ||
    engine === "pi" ||
    engine === "opencode" ||
    engine === "qoder"
  );
}

export function readEventProviderProfileId(
  params: Record<string, unknown>,
  thread: Record<string, unknown> | null,
): string | null {
  const owner =
    params.sharedOwner && typeof params.sharedOwner === "object"
      ? (params.sharedOwner as Record<string, unknown>)
      : null;
  const snapshot =
    owner?.executionTargetSnapshot &&
    typeof owner.executionTargetSnapshot === "object"
      ? (owner.executionTargetSnapshot as Record<string, unknown>)
      : null;
  const candidates = [
    params.providerProfileId,
    params.provider_profile_id,
    thread?.providerProfileId,
    thread?.provider_profile_id,
    owner?.providerProfileId,
    owner?.provider_profile_id,
    snapshot?.providerProfileId,
    snapshot?.provider_profile_id,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function resolveThreadStartedProviderProfileId(params: {
  params: Record<string, unknown>;
  thread: Record<string, unknown> | null;
  threadId: string;
  sessionId: string;
  eventEngine: string | null;
}): string | null {
  const fromEvent = readEventProviderProfileId(params.params, params.thread);
  if (fromEvent) {
    return fromEvent;
  }
  if (params.eventEngine !== "qoder") {
    return null;
  }
  for (const value of [params.threadId, params.sessionId]) {
    const identity = parseQoderSessionIdentity(value);
    if (identity && !identity.isLegacy) {
      return identity.providerProfileId;
    }
  }
  return null;
}

export function resolveFinalizedSharedNativeThreadId(
  eventEngine:
    | "claude"
    | "opencode"
    | "codex"
    | "gemini"
    | "grok"
    | "kimi"
    | "pi"
    | "qoder",
  sessionId: string,
  providerProfileId: string | null,
): string | null {
  if (eventEngine === "qoder") {
    return canonicalQoderThreadId(sessionId, providerProfileId);
  }
  return `${eventEngine}:${sessionId}`;
}

export function isAgentMessageSnapshotMethod(method: string): boolean {
  return method === "item/started" || method === "item/updated";
}

export function shouldIgnoreAgentMessageSnapshot(params: {
  threadId: string;
  itemType: string;
  method: string;
  threadAgentDeltaSeenRef: MutableRefObject<Record<string, true>>;
}): boolean {
  const { threadId, itemType, method, threadAgentDeltaSeenRef } = params;
  if (itemType !== "agentMessage" || !isAgentMessageSnapshotMethod(method)) {
    return false;
  }
  if (isClaudeThreadId(threadId)) {
    return method !== "item/updated";
  }
  return Boolean(threadAgentDeltaSeenRef.current[threadId]);
}

export function hasAgentMessageSnapshotText(item: Record<string, unknown>): boolean {
  const text = asString(
    item.text ?? item.content ?? item.output_text ?? item.outputText ?? "",
  ).trim();
  return text.length > 0;
}

export function optionalFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function buildDshContextUsagePatch(
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const pressure =
    params.contextPressure && typeof params.contextPressure === "object"
      ? (params.contextPressure as Record<string, unknown>)
      : null;
  const breakdown =
    params.contextBreakdown && typeof params.contextBreakdown === "object"
      ? (params.contextBreakdown as Record<string, unknown>)
      : null;
  if (!pressure && !breakdown) {
    return null;
  }
  const patch: Record<string, unknown> = {
    contextUsageSource: "dsh-context-pressure",
    contextUsageFreshness: "live",
  };
  if (pressure) {
    const used =
      optionalFiniteNumber(pressure.projectedTokens) ??
      optionalFiniteNumber(pressure.pressureTokens);
    const window = optionalFiniteNumber(pressure.contextWindow);
    if (used !== null) {
      patch.contextUsedTokens = used;
    }
    if (window !== null && window > 0) {
      patch.modelContextWindow = window;
    }
    if (used !== null && window !== null && window > 0) {
      const percent = (used / window) * 100;
      patch.contextUsedPercent = percent;
      patch.contextRemainingPercent = Math.max(100 - percent, 0);
    }
  }
  if (breakdown) {
    const rows = [
      ["system", breakdown.systemTokens],
      ["tools", breakdown.toolsTokens],
      ["messages", breakdown.messageTokens],
    ]
      .map(([name, tokens]) => {
        const value = optionalFiniteNumber(tokens);
        return value === null ? null : { name, tokens: value };
      })
      .filter((row): row is { name: string; tokens: number } => row !== null);
    if (rows.length > 0) {
      patch.contextCategoryUsages = rows;
    }
  }
  return Object.keys(patch).length > 2 ? patch : patch;
}

export function extractTokenUsageFromNormalizedEvent(
  event: NormalizedThreadEvent,
): Record<string, unknown> | null {
  const usageFromItem =
    event.rawItem &&
    typeof event.rawItem.usage === "object" &&
    event.rawItem.usage
      ? (event.rawItem.usage as Record<string, unknown>)
      : null;
  const usage = event.rawUsage ?? usageFromItem;
  if (!usage) {
    return null;
  }

  const inputTokens = toNumber(usage.input_tokens ?? usage.inputTokens);
  const outputTokens = toNumber(usage.output_tokens ?? usage.outputTokens);
  const cachedInputTokens = toNumber(
    usage.cached_input_tokens ??
      usage.cache_read_input_tokens ??
      usage.cachedInputTokens ??
      usage.cacheReadInputTokens,
  );
  const modelContextWindow = toNumber(
    usage.model_context_window ?? usage.modelContextWindow,
  );
  if (inputTokens <= 0 && outputTokens <= 0 && cachedInputTokens <= 0) {
    return null;
  }
  const contextUsedPercent = toOptionalNumber(
    usage.context_used_percent ?? usage.contextUsedPercent,
  );
  const contextRemainingPercent = toOptionalNumber(
    usage.context_remaining_percent ?? usage.contextRemainingPercent,
  );
  const contextUsedTokens = toOptionalNumber(
    usage.context_used_tokens ?? usage.contextUsedTokens,
  );
  const contextUsageSource =
    typeof (usage.context_usage_source ?? usage.contextUsageSource) === "string"
      ? String(usage.context_usage_source ?? usage.contextUsageSource)
      : null;
  const contextUsageFreshness =
    typeof (usage.context_usage_freshness ?? usage.contextUsageFreshness) ===
    "string"
      ? String(usage.context_usage_freshness ?? usage.contextUsageFreshness)
      : null;
  return {
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
    modelContextWindow: modelContextWindow > 0 ? modelContextWindow : null,
    contextUsageSource,
    contextUsageFreshness,
    contextUsedTokens:
      contextUsedTokens !== null && contextUsedTokens >= 0
        ? contextUsedTokens
        : null,
    contextUsedPercent:
      contextUsedPercent !== null && contextUsedPercent >= 0
        ? contextUsedPercent
        : null,
    contextRemainingPercent:
      contextRemainingPercent !== null && contextRemainingPercent >= 0
        ? contextRemainingPercent
        : null,
  };
}

export type ThreadAgentCompletedItemTracker = Record<string, Record<string, true>>;
export type ThreadAgentSnapshotItemTracker = Record<string, Record<string, true>>;

export function resolveAgentCompletionKey(itemId: string, text: string): string {
  const normalizedItemId = itemId.trim();
  if (normalizedItemId) {
    return `item:${normalizedItemId}`;
  }
  const normalizedText = text.trim();
  if (normalizedText) {
    return `text:${normalizedText}`;
  }
  return "";
}

export function hasThreadAgentCompletion(
  trackerRef: MutableRefObject<ThreadAgentCompletedItemTracker>,
  threadId: string,
): boolean {
  const threadTracker = trackerRef.current[threadId];
  return Boolean(threadTracker && Object.keys(threadTracker).length > 0);
}

export function markThreadAgentCompletionSeen(
  trackerRef: MutableRefObject<ThreadAgentCompletedItemTracker>,
  threadId: string,
  itemId: string,
  text: string,
): boolean {
  const completionKey = resolveAgentCompletionKey(itemId, text);
  if (!completionKey) {
    return true;
  }
  const threadTracker = trackerRef.current[threadId] ?? {};
  if (threadTracker[completionKey]) {
    return false;
  }
  threadTracker[completionKey] = true;
  trackerRef.current[threadId] = threadTracker;
  return true;
}

export function markThreadAgentSnapshotSeen(
  trackerRef: MutableRefObject<ThreadAgentSnapshotItemTracker>,
  threadId: string,
  itemId: string,
): void {
  if (!threadId || !itemId) {
    return;
  }
  const threadTracker = trackerRef.current[threadId] ?? {};
  threadTracker[itemId] = true;
  trackerRef.current[threadId] = threadTracker;
}

export function hasThreadAgentSnapshotSeen(
  trackerRef: MutableRefObject<ThreadAgentSnapshotItemTracker>,
  threadId: string,
  itemId: string,
): boolean {
  if (!threadId || !itemId) {
    return false;
  }
  return Boolean(trackerRef.current[threadId]?.[itemId]);
}

export function resolveLatestThreadAgentSnapshotItemId(
  trackerRef: MutableRefObject<ThreadAgentSnapshotItemTracker>,
  threadId: string,
): string | null {
  const itemIds = Object.keys(trackerRef.current[threadId] ?? {});
  return itemIds[itemIds.length - 1] ?? null;
}

