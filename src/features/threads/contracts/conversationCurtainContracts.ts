import type {
  ConversationItem,
  RequestUserInputRequest,
  ThreadTokenUsage,
  TurnPlan,
} from "../../../types";

export type ConversationEngine =
  | "claude"
  | "codex"
  | "gemini"
  | "grok"
  | "kimi"
  | "opencode"
  | "pi"
  | "dsh"
  | "qoder";

export const NORMALIZED_ITEM_KINDS = [
  "message",
  "reasoning",
  "diff",
  "review",
  "explore",
  "generatedImage",
  "tool",
  // 引擎侧上下文事件留痕（压缩完成等）：合成 item，不经引擎事件归一化产生，
  // 但随 reducer 流转需要在 kind 字典里可表达。
  "context-event",
] as const;

export type NormalizedConversationItemKind = (typeof NORMALIZED_ITEM_KINDS)[number];

// 统一事件字典：将引擎私有事件名归一化到幕布语义类型。
export const NORMALIZED_EVENT_DICTIONARY: Readonly<Record<string, NormalizedConversationItemKind>> = {
  message: "message",
  assistant_message: "message",
  assistant_message_delta: "message",
  reasoning: "reasoning",
  reasoning_delta: "reasoning",
  diff: "diff",
  review: "review",
  explore: "explore",
  generated_image: "generatedImage",
  generatedImage: "generatedImage",
  image_generation_call: "generatedImage",
  image_generation_end: "generatedImage",
  tool: "tool",
  tool_call: "tool",
  tool_result: "tool",
  "qoder/raw": "tool",
};

export type NormalizedThreadEvent = {
  engine: ConversationEngine;
  workspaceId: string;
  threadId: string;
  eventId: string;
  itemKind: NormalizedConversationItemKind;
  timestampMs: number;
  item: ConversationItem;
  operation:
    | "itemStarted"
    | "itemUpdated"
    | "itemCompleted"
    | "appendAgentMessageDelta"
    | "completeAgentMessage"
    | "appendReasoningSummaryDelta"
    | "appendReasoningSummaryBoundary"
    | "appendReasoningContentDelta"
    | "appendToolOutputDelta";
  sourceMethod: string;
  delta?: string | null;
  rawItem?: Record<string, unknown> | null;
  rawUsage?: Record<string, unknown> | null;
  turnId?: string | null;
};

export type ConversationMeta = {
  workspaceId: string;
  threadId: string;
  engine: ConversationEngine;
  activeTurnId: string | null;
  isThinking: boolean;
  /** Detached PI task work; unlike isThinking it does not represent a foreground turn. */
  backgroundTaskRunningCount?: number;
  heartbeatPulse: number | null;
  historyRestoredAtMs: number | null;
  historyHasMore?: boolean | null;
  historyNextCursor?: string | null;
};

export type SnapshotFallbackWarning = {
  level: "warning";
  code: "missing_items" | "missing_plan" | "missing_user_input_queue" | "missing_meta";
  message: string;
};

export type NormalizedHistorySnapshot = {
  engine: ConversationEngine;
  workspaceId: string;
  threadId: string;
  items: ConversationItem[];
  plan: TurnPlan | null;
  userInputQueue: RequestUserInputRequest[];
  meta: ConversationMeta;
  fallbackWarnings: SnapshotFallbackWarning[];
  /** 历史里恢复出的 token 用量（可选，目前仅 Claude loader 提供）。 */
  tokenUsage?: ThreadTokenUsage | null;
};

export type ConversationState = {
  items: ConversationItem[];
  plan: TurnPlan | null;
  userInputQueue: RequestUserInputRequest[];
  meta: ConversationMeta;
};

export type RealtimeAdapter = {
  engine: ConversationEngine;
  mapEvent(input: unknown): NormalizedThreadEvent | null;
};

export type HistoryLoader = {
  engine: ConversationEngine;
  load(threadId: string): Promise<NormalizedHistorySnapshot>;
};

export type ConversationAssembler = {
  appendEvent(state: ConversationState, event: NormalizedThreadEvent): ConversationState;
  hydrateHistory(snapshot: NormalizedHistorySnapshot): ConversationState;
};

export function createConversationState(meta: ConversationMeta): ConversationState {
  return {
    items: [],
    plan: null,
    userInputQueue: [],
    meta,
  };
}

export function normalizeHistorySnapshot(
  input: Partial<NormalizedHistorySnapshot> & Pick<NormalizedHistorySnapshot, "engine" | "workspaceId" | "threadId">,
): NormalizedHistorySnapshot {
  const fallbackWarnings: SnapshotFallbackWarning[] = [];
  const timestamp = Date.now();
  const items = Array.isArray(input.items) ? input.items : [];
  if (!Array.isArray(input.items)) {
    fallbackWarnings.push({
      level: "warning",
      code: "missing_items",
      message: "History snapshot missing items; fallback to empty list.",
    });
  }
  const userInputQueue = Array.isArray(input.userInputQueue) ? input.userInputQueue : [];
  if (!Array.isArray(input.userInputQueue)) {
    fallbackWarnings.push({
      level: "warning",
      code: "missing_user_input_queue",
      message: "History snapshot missing user input queue; fallback to empty queue.",
    });
  }
  if (typeof input.plan === "undefined") {
    fallbackWarnings.push({
      level: "warning",
      code: "missing_plan",
      message: "History snapshot missing plan; fallback to null.",
    });
  }
  const meta: ConversationMeta = input.meta ?? {
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    engine: input.engine,
    activeTurnId: null,
    isThinking: false,
    heartbeatPulse: null,
    historyRestoredAtMs: timestamp,
  };
  if (!input.meta) {
    fallbackWarnings.push({
      level: "warning",
      code: "missing_meta",
      message: "History snapshot missing meta; fallback meta generated.",
    });
  }
  return {
    engine: input.engine,
    workspaceId: input.workspaceId,
    threadId: input.threadId,
    items,
    plan: input.plan ?? null,
    userInputQueue,
    meta,
    fallbackWarnings: [...(input.fallbackWarnings ?? []), ...fallbackWarnings],
    tokenUsage: input.tokenUsage ?? null,
  };
}
