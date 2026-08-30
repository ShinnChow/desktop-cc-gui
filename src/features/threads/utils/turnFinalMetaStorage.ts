import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import type { ConversationItem } from "../../../types";

/** threads client store key — per-thread final footer meta sidecar. */
export const TURN_FINAL_META_STORE_KEY = "turnFinalMeta";

/** Soft caps keep the store small; oldest threads/entries are pruned first. */
// F2c（fix-session-switch-jank-red-lines）：500 线程上限曾把存量堆到 633KB（全 map
// 随每次 turn 结束全量 stringify）；收敛到 200 只保留近期活跃线程。
export const MAX_TURN_FINAL_META_THREADS = 200;
export const MAX_TURN_FINAL_META_ENTRIES_PER_THREAD = 200;

export type TurnFinalMetaRecord = {
  assistantItemId: string;
  turnId?: string;
  finalCompletedAt?: number;
  finalDurationMs?: number;
  finalInputTokens?: number;
  finalOutputTokens?: number;
  updatedAt: number;
};

export type TurnFinalMetaMap = Record<string, TurnFinalMetaRecord[]>;

// role 在 ConversationItem 上是 "user" | "assistant" 联合，不能用
// Extract<..., { role: "assistant" }>（会得到 never）；先抽 message 再交叉收窄。
type MessageConversationItem = Extract<ConversationItem, { kind: "message" }>;
type AssistantMessageItem = MessageConversationItem & { role: "assistant" };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function asPositiveTimestamp(value: unknown): number | undefined {
  const parsed = asNonNegativeNumber(value);
  if (parsed === undefined || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isAssistantMessageItem(item: ConversationItem): item is AssistantMessageItem {
  return item.kind === "message" && item.role === "assistant";
}

function isUsefulMetaRecord(record: TurnFinalMetaRecord): boolean {
  return (
    typeof record.finalCompletedAt === "number" ||
    typeof record.finalDurationMs === "number" ||
    typeof record.finalInputTokens === "number" ||
    typeof record.finalOutputTokens === "number"
  );
}

export function normalizeTurnFinalMetaRecord(
  value: unknown,
): TurnFinalMetaRecord | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const assistantItemId = asNonEmptyString(value.assistantItemId);
  if (!assistantItemId) {
    return null;
  }
  const turnId = asNonEmptyString(value.turnId);
  const finalCompletedAt = asPositiveTimestamp(value.finalCompletedAt);
  const finalDurationMs = asNonNegativeNumber(value.finalDurationMs);
  const finalInputTokens = asNonNegativeNumber(value.finalInputTokens);
  const finalOutputTokens = asNonNegativeNumber(value.finalOutputTokens);
  const updatedAt =
    asPositiveTimestamp(value.updatedAt) ??
    finalCompletedAt ??
    Date.now();
  const record: TurnFinalMetaRecord = {
    assistantItemId,
    updatedAt,
    ...(turnId ? { turnId } : {}),
    ...(finalCompletedAt !== undefined ? { finalCompletedAt } : {}),
    ...(finalDurationMs !== undefined ? { finalDurationMs } : {}),
    ...(finalInputTokens !== undefined ? { finalInputTokens } : {}),
    ...(finalOutputTokens !== undefined ? { finalOutputTokens } : {}),
  };
  return isUsefulMetaRecord(record) ? record : null;
}

export function normalizeTurnFinalMetaMap(raw: unknown): TurnFinalMetaMap {
  if (!isPlainRecord(raw)) {
    return {};
  }
  const normalized: TurnFinalMetaMap = {};
  for (const [threadId, entries] of Object.entries(raw)) {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId || !Array.isArray(entries)) {
      continue;
    }
    const nextEntries: TurnFinalMetaRecord[] = [];
    for (const entry of entries) {
      const record = normalizeTurnFinalMetaRecord(entry);
      if (record) {
        nextEntries.push(record);
      }
    }
    if (nextEntries.length > 0) {
      normalized[normalizedThreadId] = pruneTurnFinalMetaEntries(nextEntries);
    }
  }
  return pruneTurnFinalMetaMap(normalized);
}

export function pruneTurnFinalMetaEntries(
  entries: TurnFinalMetaRecord[],
  maxEntries: number = MAX_TURN_FINAL_META_ENTRIES_PER_THREAD,
): TurnFinalMetaRecord[] {
  if (entries.length <= maxEntries) {
    return entries;
  }
  return [...entries]
    .sort((left, right) => left.updatedAt - right.updatedAt)
    .slice(entries.length - maxEntries);
}

export function pruneTurnFinalMetaMap(
  map: TurnFinalMetaMap,
  maxThreads: number = MAX_TURN_FINAL_META_THREADS,
): TurnFinalMetaMap {
  const threadIds = Object.keys(map);
  if (threadIds.length <= maxThreads) {
    return map;
  }
  const ranked = threadIds
    .map((threadId) => {
      const entries = map[threadId] ?? [];
      const latestUpdatedAt = entries.reduce(
        (max, entry) => Math.max(max, entry.updatedAt),
        0,
      );
      return { threadId, latestUpdatedAt };
    })
    .sort((left, right) => left.latestUpdatedAt - right.latestUpdatedAt);
  const dropCount = threadIds.length - maxThreads;
  const next: TurnFinalMetaMap = { ...map };
  for (let index = 0; index < dropCount; index += 1) {
    const threadId = ranked[index]?.threadId;
    if (threadId) {
      delete next[threadId];
    }
  }
  return next;
}

export function loadTurnFinalMetaMap(): TurnFinalMetaMap {
  return normalizeTurnFinalMetaMap(
    getClientStoreSync<unknown>("threads", TURN_FINAL_META_STORE_KEY),
  );
}

export function loadTurnFinalMetaForThread(threadId: string): TurnFinalMetaRecord[] {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return [];
  }
  return loadTurnFinalMetaMap()[normalizedThreadId] ?? [];
}

function saveTurnFinalMetaMap(map: TurnFinalMetaMap): void {
  writeClientStoreValue(
    "threads",
    TURN_FINAL_META_STORE_KEY,
    pruneTurnFinalMetaMap(map),
  );
}

export function recordFromAssistantMessage(
  item: AssistantMessageItem,
  updatedAt: number = Date.now(),
): TurnFinalMetaRecord | null {
  if (item.isFinal !== true) {
    return null;
  }
  const record: TurnFinalMetaRecord = {
    assistantItemId: item.id,
    updatedAt,
    ...(typeof item.turnId === "string" && item.turnId.trim()
      ? { turnId: item.turnId.trim() }
      : {}),
    ...(typeof item.finalCompletedAt === "number" && item.finalCompletedAt > 0
      ? { finalCompletedAt: item.finalCompletedAt }
      : {}),
    ...(typeof item.finalDurationMs === "number" && item.finalDurationMs >= 0
      ? { finalDurationMs: item.finalDurationMs }
      : {}),
    ...(typeof item.finalInputTokens === "number" && item.finalInputTokens >= 0
      ? { finalInputTokens: item.finalInputTokens }
      : {}),
    ...(typeof item.finalOutputTokens === "number" && item.finalOutputTokens >= 0
      ? { finalOutputTokens: item.finalOutputTokens }
      : {}),
  };
  return isUsefulMetaRecord(record) ? record : null;
}

/**
 * Upsert one record into a thread's list.
 * Same assistantItemId or turnId updates in place and merges richer numeric fields.
 */
export function upsertTurnFinalMetaRecord(
  entries: TurnFinalMetaRecord[],
  incoming: TurnFinalMetaRecord,
): TurnFinalMetaRecord[] {
  const matchIndex = entries.findIndex((entry) => {
    if (entry.assistantItemId === incoming.assistantItemId) {
      return true;
    }
    if (
      entry.turnId &&
      incoming.turnId &&
      entry.turnId === incoming.turnId
    ) {
      return true;
    }
    return false;
  });
  if (matchIndex < 0) {
    return pruneTurnFinalMetaEntries([...entries, incoming]);
  }
  const existing = entries[matchIndex]!;
  const merged: TurnFinalMetaRecord = {
    assistantItemId: incoming.assistantItemId || existing.assistantItemId,
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
    ...(existing.turnId || incoming.turnId
      ? { turnId: incoming.turnId ?? existing.turnId }
      : {}),
    finalCompletedAt: pickMaxNumber(
      existing.finalCompletedAt,
      incoming.finalCompletedAt,
    ),
    finalDurationMs: pickMaxNumber(
      existing.finalDurationMs,
      incoming.finalDurationMs,
    ),
    finalInputTokens: pickMaxNumber(
      existing.finalInputTokens,
      incoming.finalInputTokens,
    ),
    finalOutputTokens: pickMaxNumber(
      existing.finalOutputTokens,
      incoming.finalOutputTokens,
    ),
  };
  // Drop undefined optional fields for stable serialization.
  const cleaned = normalizeTurnFinalMetaRecord(merged);
  if (!cleaned) {
    return entries;
  }
  const next = [...entries];
  next[matchIndex] = cleaned;
  return pruneTurnFinalMetaEntries(next);
}

function pickMaxNumber(
  left: number | undefined,
  right: number | undefined,
): number | undefined {
  if (typeof left === "number" && typeof right === "number") {
    return Math.max(left, right);
  }
  return right ?? left;
}

export function persistTurnFinalMetaFromAssistant(
  threadId: string,
  item: ConversationItem,
): void {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId || !isAssistantMessageItem(item)) {
    return;
  }
  const record = recordFromAssistantMessage(item);
  if (!record) {
    return;
  }
  const map = loadTurnFinalMetaMap();
  const existing = map[normalizedThreadId] ?? [];
  const nextEntries = upsertTurnFinalMetaRecord(existing, record);
  if (nextEntries === existing) {
    return;
  }
  saveTurnFinalMetaMap({
    ...map,
    [normalizedThreadId]: nextEntries,
  });
}

/** Persist meta for every final assistant that has useful footer fields. */
export function persistTurnFinalMetaFromItems(
  threadId: string,
  items: ConversationItem[],
): void {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return;
  }
  let map = loadTurnFinalMetaMap();
  let entries = map[normalizedThreadId] ?? [];
  let changed = false;
  for (const item of items) {
    if (!isAssistantMessageItem(item)) {
      continue;
    }
    const record = recordFromAssistantMessage(item);
    if (!record) {
      continue;
    }
    const nextEntries = upsertTurnFinalMetaRecord(entries, record);
    if (nextEntries !== entries) {
      entries = nextEntries;
      changed = true;
    }
  }
  if (!changed) {
    return;
  }
  map = {
    ...map,
    [normalizedThreadId]: entries,
  };
  saveTurnFinalMetaMap(map);
}

export function deleteTurnFinalMetaForThread(threadId: string): void {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return;
  }
  const map = loadTurnFinalMetaMap();
  if (!(normalizedThreadId in map)) {
    return;
  }
  const next = { ...map };
  delete next[normalizedThreadId];
  saveTurnFinalMetaMap(next);
}

export function renameTurnFinalMetaThreadId(
  oldThreadId: string,
  newThreadId: string,
): void {
  const fromId = oldThreadId.trim();
  const toId = newThreadId.trim();
  if (!fromId || !toId || fromId === toId) {
    return;
  }
  const map = loadTurnFinalMetaMap();
  const fromEntries = map[fromId];
  if (!fromEntries || fromEntries.length === 0) {
    return;
  }
  const toEntries = map[toId] ?? [];
  let merged = toEntries;
  for (const entry of fromEntries) {
    merged = upsertTurnFinalMetaRecord(merged, entry);
  }
  const next = { ...map };
  delete next[fromId];
  next[toId] = merged;
  saveTurnFinalMetaMap(next);
}

function itemNeedsMetaFill(item: AssistantMessageItem): boolean {
  return (
    typeof item.finalCompletedAt !== "number" ||
    typeof item.finalDurationMs !== "number" ||
    typeof item.finalInputTokens !== "number" ||
    typeof item.finalOutputTokens !== "number"
  );
}

function applyRecordToItem(
  item: AssistantMessageItem,
  record: TurnFinalMetaRecord,
): AssistantMessageItem {
  // Precedence: explicit item fields win; sidecar only fills gaps.
  const finalCompletedAt =
    typeof item.finalCompletedAt === "number" && item.finalCompletedAt > 0
      ? item.finalCompletedAt
      : record.finalCompletedAt;
  const finalDurationMs =
    typeof item.finalDurationMs === "number" && item.finalDurationMs >= 0
      ? item.finalDurationMs
      : record.finalDurationMs;
  const finalInputTokens =
    typeof item.finalInputTokens === "number" && item.finalInputTokens >= 0
      ? item.finalInputTokens
      : record.finalInputTokens;
  const finalOutputTokens =
    typeof item.finalOutputTokens === "number" && item.finalOutputTokens >= 0
      ? item.finalOutputTokens
      : record.finalOutputTokens;

  if (
    item.finalCompletedAt === finalCompletedAt &&
    item.finalDurationMs === finalDurationMs &&
    item.finalInputTokens === finalInputTokens &&
    item.finalOutputTokens === finalOutputTokens &&
    item.isFinal === true
  ) {
    return item;
  }

  return {
    ...item,
    isFinal: true,
    ...(typeof finalCompletedAt === "number" ? { finalCompletedAt } : {}),
    ...(typeof finalDurationMs === "number" ? { finalDurationMs } : {}),
    ...(typeof finalInputTokens === "number" ? { finalInputTokens } : {}),
    ...(typeof finalOutputTokens === "number" ? { finalOutputTokens } : {}),
  };
}

function findRecordForItem(
  item: AssistantMessageItem,
  entries: TurnFinalMetaRecord[],
  usedIndexes: Set<number>,
  finalAssistantOrdinal: number,
  finalAssistantCount: number,
): TurnFinalMetaRecord | null {
  for (let index = 0; index < entries.length; index += 1) {
    if (usedIndexes.has(index)) {
      continue;
    }
    const entry = entries[index]!;
    if (entry.assistantItemId === item.id) {
      usedIndexes.add(index);
      return entry;
    }
  }
  if (typeof item.turnId === "string" && item.turnId.trim()) {
    const turnId = item.turnId.trim();
    for (let index = 0; index < entries.length; index += 1) {
      if (usedIndexes.has(index)) {
        continue;
      }
      const entry = entries[index]!;
      if (entry.turnId && entry.turnId === turnId) {
        usedIndexes.add(index);
        return entry;
      }
    }
  }
  if (typeof item.finalCompletedAt === "number" && item.finalCompletedAt > 0) {
    for (let index = 0; index < entries.length; index += 1) {
      if (usedIndexes.has(index)) {
        continue;
      }
      const entry = entries[index]!;
      if (
        typeof entry.finalCompletedAt === "number" &&
        Math.abs(entry.finalCompletedAt - item.finalCompletedAt) <= 1_000
      ) {
        usedIndexes.add(index);
        return entry;
      }
    }
  }
  // Ordinal fallback: when history reloads rewrite item ids, align by final-assistant order.
  // Use absolute chrono rank so sequential finals map 1:1 even after earlier ranks are claimed.
  if (
    finalAssistantCount > 0 &&
    entries.length > 0 &&
    finalAssistantCount === entries.length
  ) {
    const sorted = entries
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => {
        const leftAt = left.entry.finalCompletedAt ?? left.entry.updatedAt;
        const rightAt = right.entry.finalCompletedAt ?? right.entry.updatedAt;
        return leftAt - rightAt;
      });
    const candidate = sorted[finalAssistantOrdinal];
    if (candidate && !usedIndexes.has(candidate.index)) {
      usedIndexes.add(candidate.index);
      return candidate.entry;
    }
  }
  return null;
}

/**
 * Fill missing final footer fields on assistant messages from the local sidecar.
 * Existing explicit values are never overwritten.
 */
export function mergeTurnFinalMetaIntoItems(
  threadId: string,
  items: ConversationItem[],
  records: TurnFinalMetaRecord[] = loadTurnFinalMetaForThread(threadId),
): ConversationItem[] {
  if (!items.length || !records.length) {
    return items;
  }
  const finalAssistantIndexes: number[] = [];
  items.forEach((item, index) => {
    if (isAssistantMessageItem(item) && (item.isFinal === true || itemNeedsMetaFill(item))) {
      // Prefer true finals; also consider assistants that already have partial final* from loaders.
      if (
        item.isFinal === true ||
        typeof item.finalCompletedAt === "number" ||
        typeof item.finalDurationMs === "number" ||
        typeof item.finalInputTokens === "number" ||
        typeof item.finalOutputTokens === "number"
      ) {
        finalAssistantIndexes.push(index);
      }
    }
  });
  // If history did not mark isFinal, still try the last assistant per user turn later via ordinal of all assistants with any meta need.
  if (finalAssistantIndexes.length === 0) {
    items.forEach((item, index) => {
      if (isAssistantMessageItem(item) && itemNeedsMetaFill(item)) {
        finalAssistantIndexes.push(index);
      }
    });
  }
  if (finalAssistantIndexes.length === 0) {
    return items;
  }

  const usedIndexes = new Set<number>();
  let changed = false;
  const next = items.slice();
  finalAssistantIndexes.forEach((itemIndex, ordinal) => {
    const item = next[itemIndex];
    if (!item || !isAssistantMessageItem(item)) {
      return;
    }
    if (!itemNeedsMetaFill(item) && item.isFinal === true) {
      return;
    }
    const record = findRecordForItem(
      item,
      records,
      usedIndexes,
      ordinal,
      finalAssistantIndexes.length,
    );
    if (!record) {
      return;
    }
    const merged = applyRecordToItem(item, record);
    if (merged !== item) {
      next[itemIndex] = merged;
      changed = true;
    }
  });
  return changed ? next : items;
}

/**
 * Best-effort async persist so reducers stay non-blocking.
 * Failures are swallowed — footer meta is non-critical.
 */
export function schedulePersistTurnFinalMetaFromItems(
  threadId: string,
  items: ConversationItem[],
): void {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId || items.length === 0) {
    return;
  }
  queueMicrotask(() => {
    try {
      persistTurnFinalMetaFromItems(normalizedThreadId, items);
    } catch {
      // best effort
    }
  });
}

export function scheduleRenameTurnFinalMetaThreadId(
  oldThreadId: string,
  newThreadId: string,
): void {
  queueMicrotask(() => {
    try {
      renameTurnFinalMetaThreadId(oldThreadId, newThreadId);
    } catch {
      // best effort
    }
  });
}

export function scheduleDeleteTurnFinalMetaForThread(threadId: string): void {
  queueMicrotask(() => {
    try {
      deleteTurnFinalMetaForThread(threadId);
    } catch {
      // best effort
    }
  });
}
