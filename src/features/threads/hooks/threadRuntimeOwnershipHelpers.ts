import type { ThreadSummary } from "../../../types";
import type {
  PendingAssistantCompletion,
  PendingMemoryCapture,
} from "./threadMemoryCaptureHelpers";
import {
  workspaceScopedDelete,
  workspaceScopedGet,
  workspaceScopedSet,
  type WorkspaceScopedMap,
} from "./workspaceScopedMap";

const THREAD_ITEM_CACHE_DEFAULT_MAX = 12;
export const THREAD_ITEM_CACHE_TRIM_WATERMARK = 2;

export type CodexOwnershipFallbackCandidateInput = {
  id: string;
  engineSource?: ThreadSummary["engineSource"] | null;
  selectedEngine?: ThreadSummary["selectedEngine"] | null;
  threadKind?: ThreadSummary["threadKind"] | null;
};

export type PendingMemoryCaptureBucket = Record<string, PendingMemoryCapture>;
export type PendingAssistantCompletionBucket = Record<
  string,
  PendingAssistantCompletion
>;

export function isCodexOwnershipFallbackCandidate(
  thread: CodexOwnershipFallbackCandidateInput,
): boolean {
  const explicitEngine = thread.engineSource ?? thread.selectedEngine;
  if (explicitEngine) {
    return explicitEngine === "codex";
  }
  const normalizedId = thread.id.trim().toLowerCase();
  if (normalizedId.startsWith("shared:")) {
    return false;
  }
  return !(
    normalizedId.startsWith("claude:") ||
    normalizedId.startsWith("claude-pending-") ||
    normalizedId.startsWith("gemini:") ||
    normalizedId.startsWith("gemini-pending-") ||
    normalizedId.startsWith("grok:") ||
    normalizedId.startsWith("grok-pending-") ||
    normalizedId.startsWith("kimi:") ||
    normalizedId.startsWith("kimi-pending-") ||
    normalizedId.startsWith("pi:") ||
    normalizedId.startsWith("pi-pending-") ||
    normalizedId.startsWith("qoder:") ||
    normalizedId.startsWith("qoder-pending-") ||
    normalizedId.startsWith("opencode:") ||
    normalizedId.startsWith("opencode-pending-") ||
    normalizedId.startsWith("dsh:") ||
    normalizedId.startsWith("dsh-pending-")
  );
}

// chat-stream-render-isolation-2026-06 task 5: LRU adaptive. When
// multiple threads stream in parallel we want the cache to grow so
// the reducer hot path does not thrash evicted thread items back into
// state. The formula is intentionally simple: in-flight count plus
// a baseline headroom. When no thread is processing, the formula
// returns the original `THREAD_ITEM_CACHE_DEFAULT_MAX` (backward-compat
// with the prior 12-entry budget).
export function computeThreadItemCacheMax(inFlightCount: number): number {
  if (!Number.isFinite(inFlightCount) || inFlightCount <= 0) {
    return THREAD_ITEM_CACHE_DEFAULT_MAX;
  }
  return Math.max(THREAD_ITEM_CACHE_DEFAULT_MAX, inFlightCount * 2 + 6);
}

// perf-cold-start-click-storm-convergence F3：在 activity LRU + protected 之上
// 叠加「近期切换保护集」——来回点击超过 cacheMax 时，刚看过的会话不再被整轮
// 驱逐、重进不重付全额 history load。保护集有硬上限（内存上界
// cacheMax + RECENT_PROTECT_MAX），超限按 activity LRU 在保护集内部淘汰。
export const THREAD_ITEM_CACHE_RECENT_SWITCH_WINDOW_MS = 10 * 60 * 1000;
export const THREAD_ITEM_CACHE_RECENT_PROTECT_MAX = 8;

export type SelectEvictableThreadIdsInput = {
  loadedThreadIds: readonly string[];
  cacheMax: number;
  protectedThreadIds: ReadonlySet<string>;
  /** threadId → 最近一次切换时刻（epoch ms）；由切换路径维护。 */
  recentSwitches: ReadonlyMap<string, number>;
  nowMs: number;
  itemCount: (threadId: string) => number;
  activityAt: (threadId: string) => number;
  recentWindowMs?: number;
  recentProtectMax?: number;
};

/**
 * 返回本轮应驱逐的 threadId（activity 最旧的尾部）。
 * 语义与既有驱逐 effect 对齐：protected（active/in-flight/pinned）不驱逐、
 * 空条目不驱逐、keepableSlots = cacheMax - protected - recentProtected。
 */
export function selectEvictableThreadIds(
  input: SelectEvictableThreadIdsInput,
): string[] {
  const recentWindowMs =
    input.recentWindowMs ?? THREAD_ITEM_CACHE_RECENT_SWITCH_WINDOW_MS;
  const recentProtectMax =
    input.recentProtectMax ?? THREAD_ITEM_CACHE_RECENT_PROTECT_MAX;

  let protectedLoadedCount = 0;
  const evictable: { threadId: string; activityTimestamp: number }[] = [];
  const recent: { threadId: string; activityTimestamp: number }[] = [];

  for (const threadId of input.loadedThreadIds) {
    if (input.protectedThreadIds.has(threadId)) {
      protectedLoadedCount += 1;
      continue;
    }
    if (input.itemCount(threadId) <= 0) {
      continue;
    }
    const activityTimestamp = input.activityAt(threadId);
    const switchedAt = input.recentSwitches.get(threadId);
    const sinceSwitch = typeof switchedAt === "number" ? input.nowMs - switchedAt : Number.NaN;
    const isRecent = sinceSwitch >= 0 && sinceSwitch < recentWindowMs;
    (isRecent ? recent : evictable).push({ threadId, activityTimestamp });
  }

  recent.sort((left, right) => right.activityTimestamp - left.activityTimestamp);
  const recentProtectedCount = Math.min(recent.length, recentProtectMax);
  const keepableSlots = Math.max(
    0,
    input.cacheMax - protectedLoadedCount - recentProtectedCount,
  );
  const candidates = evictable.concat(recent.slice(recentProtectMax));
  candidates.sort((left, right) => right.activityTimestamp - left.activityTimestamp);
  return candidates.slice(keepableSlots).map((entry) => entry.threadId);
}

export function getPendingMemoryEntries<T extends { threadId: string }>(
  store: WorkspaceScopedMap<Record<string, T>>,
  workspaceId: string | null | undefined,
  threadIds: readonly string[],
) {
  return threadIds.flatMap((threadId) => {
    const bucket = workspaceScopedGet(store, workspaceId, threadId);
    if (!bucket) {
      return [];
    }
    return Object.entries(bucket).map(([key, entry]) => ({ key, threadId, entry }));
  });
}

export function setPendingMemoryEntry<T>(
  store: WorkspaceScopedMap<Record<string, T>>,
  workspaceId: string | null | undefined,
  threadId: string,
  key: string,
  entry: T,
) {
  const bucket = {
    ...(workspaceScopedGet(store, workspaceId, threadId) ?? {}),
    [key]: entry,
  };
  workspaceScopedSet(store, workspaceId, threadId, bucket);
}

export function deletePendingMemoryEntry<T>(
  store: WorkspaceScopedMap<Record<string, T>>,
  workspaceId: string | null | undefined,
  threadId: string,
  key: string,
) {
  const bucket = workspaceScopedGet(store, workspaceId, threadId);
  if (!bucket || !(key in bucket)) {
    return;
  }
  const nextBucket = { ...bucket };
  delete nextBucket[key];
  if (Object.keys(nextBucket).length === 0) {
    workspaceScopedDelete(store, workspaceId, threadId);
    return;
  }
  workspaceScopedSet(store, workspaceId, threadId, nextBucket);
}

export function shouldKeepPendingCaptureForAdditionalAssistantSegments(
  pending: Pick<PendingMemoryCapture, "engine" | "threadId">,
) {
  return pending.engine === "codex" || !pending.threadId.includes(":");
}
