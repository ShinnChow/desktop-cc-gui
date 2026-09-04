export type TokenUsageBreakdown = {
  totalTokens: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

/** DSH host `sessionStats` projection — whole-log wall times, not the paged window. */
export type DshSessionStats = {
  turns: number;
  steps: number;
  llmMs: number;
  toolMs: number;
  ttftMs: number;
  ttftSteps: number;
  decodeMs: number;
  decodeTokens: number;
};

export type DshTodoItem = {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
};

export type ThreadTokenUsage = {
  total: TokenUsageBreakdown;
  last: TokenUsageBreakdown;
  /** Optional DSH-only speed projection; other engines leave this unset. */
  sessionStats?: DshSessionStats | null;
  /** Optional DSH billed cache-write bucket used only for cache-hit %. */
  cacheWriteInputTokens?: number | null;
  /**
   * DSH host `todos` snapshot. `undefined` / omitted = never received
   * (Composer may scan TodoWrite tools). `[]` = host cleared the standing plan.
   */
  dshTodos?: DshTodoItem[] | null;
  modelContextWindow: number | null;
  contextUsageSource?: string | null;
  contextUsageFreshness?:
    | "live"
    | "restored"
    | "estimated"
    | "pending"
    | string
    | null;
  contextUsedTokens?: number | null;
  contextUsedPercent?: number | null;
  contextRemainingPercent?: number | null;
  contextToolUsages?: Array<{
    name: string;
    server?: string | null;
    tokens: number;
  }> | null;
  contextToolUsagesTruncated?: boolean | null;
  contextCategoryUsages?: Array<{
    name: string;
    tokens: number;
    percent?: number | null;
  }> | null;
};

export type LocalUsageDay = {
  day: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  agentTimeMs: number;
  agentRuns: number;
};

export type LocalUsageTotals = {
  last7DaysTokens: number;
  last30DaysTokens: number;
  averageDailyTokens: number;
  cacheHitRatePercent: number;
  peakDay: string | null;
  peakDayTokens: number;
};

export type LocalUsageModel = {
  model: string;
  tokens: number;
  sharePercent: number;
};

export type LocalUsageSnapshot = {
  updatedAt: number;
  days: LocalUsageDay[];
  totals: LocalUsageTotals;
  topModels: LocalUsageModel[];
};

export type LocalUsageUsageData = {
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
};



