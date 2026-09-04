import type {
  EngineType,
  QueuedMessage,
  SharedQueuedExecutionTarget,
} from "../../../types";
import type { SharedSendState } from "../../shared-session/target/sendStateMachine";
import {
  type ResolvedExecutionTarget,
} from "../../shared-session/target/types";

export const OPENCODE_INFLIGHT_STALL_MS = 18_000;
export const FUSION_RESUME_TIMEOUT_MS = 48_000;
export const QUEUED_HANDOFF_BUBBLE_TTL_MS = 60_000;
export const DELIVERY_DIAGNOSTIC_LIMIT = 100;
/**
 * S1 安全版：后台 drain 并发上限（active 不占配额）。
 * 事故教训：cap=3 会三路齐飞打爆主线程/引擎；默认 1。
 */
export const MAX_BACKGROUND_QUEUE_DRAIN = 1;
/**
 * 后台 auto-drain 总闸。安全版默认开启；
 * 仍保留 test setter，便于单测隔离。
 * 防重发三闸（completed-id / terminal-pulse / inFlight）必须始终开启，与本闸无关。
 */
let enableBackgroundQueueDrain = true;
export function getEnableBackgroundQueueDrain(): boolean {
  return enableBackgroundQueueDrain;
}
/** @internal test-only */
export function __setEnableBackgroundQueueDrainForTests(enabled: boolean): void {
  enableBackgroundQueueDrain = enabled;
}
/** @deprecated 使用 getEnableBackgroundQueueDrain()；保留导出名避免外部误引用常量快照 */

/** native 成功后若 isProcessing 边沿丢失，超时清 inFlight（不重发，仅放行下一条）。 */
export const NATIVE_INFLIGHT_SETTLE_FALLBACK_MS = 3_000;

/**
 * 仅由「有队列 / inFlight 的 thread」状态拼出 drain 触发信号。
 * 纯函数便于测试：无关会话 heartbeat 不得改变返回值。
 *
 * 写法要点（相对 dc97acd5c 对抗式门控的正确化）：
 * - **不**再强制把 activeThreadId 塞进集合（无队列时 active 心跳会无意义刷新 signal）
 * - 无任何 queue/inflight 时返回稳定 empty 信号，effect 不因 status 表 churn 重跑
 */
export function buildQueueDrainSignal(input: {
  queuedByThread: Record<string, QueuedMessage[] | undefined>;
  inFlightByThread: Record<string, QueuedMessage | null | undefined>;
  activeThreadId: string | null;
  threadStatusById?: Record<string, QueueThreadStatusSnapshot | undefined>;
  isProcessing: boolean;
  isReviewing: boolean;
  isContextCompacting: boolean;
  activeTerminalPulse: number;
  hasPendingUserInput: boolean;
  backgroundEnabled: boolean;
}): string {
  const ids = new Set<string>();
  for (const [threadId, queue] of Object.entries(input.queuedByThread)) {
    if ((queue?.length ?? 0) > 0) {
      ids.add(threadId);
    }
  }
  for (const [threadId, inflight] of Object.entries(input.inFlightByThread)) {
    if (inflight) {
      ids.add(threadId);
    }
  }
  if (ids.size === 0) {
    return `empty|bg:${input.backgroundEnabled ? 1 : 0}`;
  }
  const parts: string[] = [];
  for (const threadId of [...ids].sort()) {
    const status = input.threadStatusById?.[threadId];
    // 非 active 且 status 未知时记为 busy(p1)，这样 status 首次落到 idle(p0)
    // 时 signal 会变，后台 drain 才能被唤醒（否则永久静默 hold）。
    const processing =
      typeof status?.isProcessing === "boolean"
        ? status.isProcessing
        : threadId === input.activeThreadId
          ? input.isProcessing
          : true;
    const reviewing =
      typeof status?.isReviewing === "boolean"
        ? status.isReviewing
        : threadId === input.activeThreadId
          ? input.isReviewing
          : false;
    const compacting =
      typeof status?.isContextCompacting === "boolean"
        ? status.isContextCompacting
        : threadId === input.activeThreadId
          ? input.isContextCompacting
          : false;
    const terminal =
      typeof status?.terminalPulse === "number"
        ? status.terminalPulse
        : threadId === input.activeThreadId
          ? input.activeTerminalPulse
          : 0;
    const queueLen = input.queuedByThread[threadId]?.length ?? 0;
    const inflightId = input.inFlightByThread[threadId]?.id ?? "-";
    parts.push(
      `${threadId}:p${processing ? 1 : 0}:r${reviewing ? 1 : 0}:c${compacting ? 1 : 0}:t${terminal}:q${queueLen}:i${inflightId}`,
    );
  }
  return `${parts.join("|")}|active:${input.activeThreadId ?? "-"}|pend:${input.hasPendingUserInput ? 1 : 0}|bg:${input.backgroundEnabled ? 1 : 0}`;
}

export type QueueThreadStatusSnapshot = {
  isProcessing?: boolean;
  isReviewing?: boolean;
  isContextCompacting?: boolean;
  terminalPulse?: number;
  continuationPulse?: number;
};

export type ThreadFusionState = {
  messageId: string;
  turnIdBeforeFusion: string | null;
  mode: "same-run" | "cutover";
  stage:
    "awaiting-predecessor-settlement" | "dispatching" | "awaiting-continuation";
  startedAtMs: number;
  continuationPulseAtStart: number;
  terminalPulseAtStart: number;
};

export type QueuedDispatchResult =
  "committed" | "dispatched" | "blocked" | "ambiguous";

export function resolveSharedQueuePersistenceOwner(
  threadId: string,
  previousQueue: QueuedMessage[] | undefined,
  nextQueue: QueuedMessage[] | undefined,
): { workspaceId: string; threadId: string } | null {
  const scopedItems = [...(nextQueue ?? []), ...(previousQueue ?? [])];
  const owner = scopedItems.find(
    (item) =>
      item.ownerWorkspaceId?.trim() && item.ownerThreadId === threadId,
  );
  if (!owner?.ownerWorkspaceId) {
    return null;
  }
  const workspaceId = owner.ownerWorkspaceId.trim();
  const ownerMatches = scopedItems.every(
    (item) =>
      item.ownerWorkspaceId === workspaceId && item.ownerThreadId === threadId,
  );
  return ownerMatches ? { workspaceId, threadId } : null;
}

export type SlashCommandKind =
  | "fork"
  | "fast"
  | "clear"
  | "mcp"
  | "new"
  | "resume"
  | "specRoot"
  | "review"
  | "status"
  | "context"
  | "export"
  | "import"
  | "lsp"
  | "share"
  | "compact"
  | "plan"
  | "defaultMode"
  | "code"
  | "mode";

export const MODE_QUERY_DENYLIST =
  /(区别|差别|不同|怎么|如何|为什么|为何|影响|不影响|约束|规则|行为|能力|planfirst|agents\.?md)/i;

export function readSlashCommandToken(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const withoutSlash = trimmed.slice(1);
  if (!withoutSlash) {
    return null;
  }
  const firstToken = withoutSlash.split(/\s+/, 1)[0]?.trim();
  if (!firstToken) {
    return null;
  }
  return firstToken.toLowerCase();
}

export function isImplicitModeQuery(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 64) {
    return false;
  }
  if (MODE_QUERY_DENYLIST.test(trimmed)) {
    return false;
  }
  const normalized = trimmed.toLowerCase();
  if (
    /^(?:mode|current\s+mode|what(?:'s| is)\s+(?:the\s+)?(?:current\s+)?mode|am i in (?:plan|default) mode)\s*[?]?$/i
      .test(normalized)
  ) {
    return true;
  }
  if (/^(现在呢|当前呢|此时呢)\s*[？?]?$/u.test(trimmed)) {
    return true;
  }
  return /^(现在|当前|此时).{0,24}(模式|计划模式|default|默认).{0,24}(吗|呢)?\s*[？?]?$/u
    .test(trimmed);
}

export function parseSlashCommand(text: string): SlashCommandKind | null {
  const commandToken = readSlashCommandToken(text);
  if (commandToken === "fork") {
    return "fork";
  }
  if (commandToken === "fast") {
    return "fast";
  }
  if (commandToken === "clear" || commandToken === "reset") {
    return "clear";
  }
  if (commandToken === "mcp") {
    return "mcp";
  }
  if (commandToken === "review") {
    return "review";
  }
  if (commandToken === "new") {
    return "new";
  }
  if (commandToken === "resume") {
    return "resume";
  }
  if (commandToken === "spec-root") {
    return "specRoot";
  }
  if (commandToken === "status") {
    return "status";
  }
  if (commandToken === "context") {
    return "context";
  }
  if (commandToken === "export") {
    return "export";
  }
  if (commandToken === "import") {
    return "import";
  }
  if (commandToken === "lsp") {
    return "lsp";
  }
  if (commandToken === "share") {
    return "share";
  }
  if (commandToken === "compact") {
    return "compact";
  }
  if (commandToken === "plan") {
    return "plan";
  }
  if (commandToken === "default") {
    return "defaultMode";
  }
  if (commandToken === "code") {
    return "code";
  }
  if (commandToken === "mode") {
    return "mode";
  }
  return null;
}

export function isQueuedMessageFuseEligible(item: QueuedMessage): boolean {
  return (
    readSlashCommandToken(item.text) === null &&
    item.sharedDispatchState !== "pending-ack"
  );
}

export function cloneSharedExecutionTarget(
  target: ResolvedExecutionTarget,
): SharedQueuedExecutionTarget {
  return {
    engine: target.engine,
    providerProfileId: target.providerProfileId?.trim() || null,
    modelCatalogEntryId: target.modelCatalogEntryId,
    model: target.model,
    reasoning: target.reasoning ? { effort: target.reasoning.effort } : null,
    providerProfileNameSnapshot: target.providerProfileNameSnapshot,
    providerProfileSource: target.providerProfileSource,
  };
}

export function isSharedFollowUpState(state: SharedSendState): boolean {
  return state === "running" || state === "settling";
}

export function isSameSharedExecutionTarget(
  current: ResolvedExecutionTarget,
  frozen: SharedQueuedExecutionTarget,
): boolean {
  return (
    current.engine === frozen.engine &&
    normalizeOptionalIdentity(current.providerProfileId) ===
      normalizeOptionalIdentity(frozen.providerProfileId) &&
    current.modelCatalogEntryId === frozen.modelCatalogEntryId &&
    current.model === frozen.model &&
    normalizeOptionalIdentity(current.reasoning?.effort) ===
      normalizeOptionalIdentity(frozen.reasoning?.effort) &&
    current.providerProfileNameSnapshot ===
      frozen.providerProfileNameSnapshot &&
    current.providerProfileSource === frozen.providerProfileSource
  );
}

export function normalizeOptionalIdentity(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function classifySharedDispatchResult(
  value: unknown,
  expectedTarget: SharedQueuedExecutionTarget | undefined,
): QueuedDispatchResult {
  if (!value || typeof value !== "object") {
    return "ambiguous";
  }
  const response = value as Record<string, unknown>;
  const v2 =
    response.v2 && typeof response.v2 === "object"
      ? (response.v2 as Record<string, unknown>)
      : null;
  if (
    response.status === "accepted" &&
    v2?.committed === true &&
    normalizeOptionalIdentity(v2.attemptId) !== null &&
    normalizeOptionalIdentity(v2.logicalTurnId) !== null &&
    expectedTarget !== undefined &&
    response.engine === expectedTarget.engine &&
    normalizeOptionalIdentity(response.providerProfileId) ===
      normalizeOptionalIdentity(expectedTarget.providerProfileId) &&
    normalizeOptionalIdentity(response.model) === expectedTarget.model &&
    normalizeOptionalIdentity(response.reasoningEffort) ===
      normalizeOptionalIdentity(expectedTarget.reasoning?.effort)
  ) {
    return "committed";
  }
  if (
    response.status === "blocked" ||
    response.status === "cancelled" ||
    response.status === "recovery-required" ||
    response.status === "target-unavailable"
  ) {
    return "blocked";
  }
  return "ambiguous";
}

export function isCodexOnlyCommand(command: SlashCommandKind): boolean {
  return (
    command === "fast" ||
    command === "plan" ||
    command === "defaultMode" ||
    command === "code" ||
    command === "mode"
  );
}

export function isClaudeOnlyCommand(command: SlashCommandKind): boolean {
  return command === "compact";
}

export function canExecuteSlashCommand(
  command: SlashCommandKind | null,
  activeEngine: EngineType,
  activeThreadId: string | null,
): command is SlashCommandKind {
  if (!command) {
    return false;
  }
  if (command === "clear" && activeEngine !== "claude") {
    return false;
  }
  if (isCodexOnlyCommand(command) && activeEngine !== "codex") {
    return false;
  }
  if (isClaudeOnlyCommand(command)) {
    if (activeEngine === "claude") {
      return true;
    }
    return Boolean(
      activeThreadId &&
        (activeThreadId.startsWith("claude:")
          || activeThreadId.startsWith("claude-pending-")),
    );
  }
  return true;
}

