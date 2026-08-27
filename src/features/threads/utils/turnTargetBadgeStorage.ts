import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import type {
  ConversationItem,
  ExecutionTargetSnapshot,
  RuntimeModelReceipt,
} from "../../../types";
import { isNativeTurnTargetLedgerScope } from "./nativeTurnTargetLedger";

/**
 * Native turn-target badge 历史侧车。
 *
 * 内存账本（nativeTurnTargetLedger）只活在会话内；重开/重载后历史行没有
 * provenance。本侧车在发送边界把每轮快照追加进 per-thread ring，历史加载时
 * 在 setThreadItems 里从尾部按「用户消息轮次」对齐补挂（与 turnFinalMeta
 * 的冷加载补挂同一模式）。对齐只从尾部取最近 K 轮：远古合成 user 行导致
 * 序号漂移时，只有更老的轮次不挂，近期轮次始终正确。
 *
 * 快照不可变语义与 shared 一致：已有值的 item 一律不覆盖。
 */

export const TURN_TARGET_BADGE_STORE_KEY = "turnTargetBadges";

/** Soft caps keep the store small; oldest threads/entries are pruned first. */
export const MAX_TURN_TARGET_BADGE_THREADS = 500;
export const MAX_TURN_TARGET_BADGE_ENTRIES_PER_THREAD = 200;

export type TurnTargetBadgeRecord = {
  snapshot: ExecutionTargetSnapshot;
  recordedAt: number;
};

export type TurnTargetBadgeMap = Record<string, TurnTargetBadgeRecord[]>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 只保留足以渲染显示条的字段；未知/畸形值丢弃，不伪造 provenance。 */
function normalizeSnapshot(value: unknown): ExecutionTargetSnapshot | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const engine =
    typeof value.engine === "string" ? value.engine.trim() : "";
  if (!engine) {
    return null;
  }
  // 缺失字段直接省略（与 freezeTurnSnapshot 输出形态一致，不落显式 null）。
  const optionalTrimmed = (input: unknown): string | undefined => {
    const text = typeof input === "string" ? input.trim() : "";
    return text ? text : undefined;
  };
  const reasoningRecord =
    isPlainRecord(value.reasoning) &&
    typeof value.reasoning.effort === "string" &&
    value.reasoning.effort.trim()
      ? { effort: value.reasoning.effort.trim() }
      : null;
  const providerProfileId = optionalTrimmed(value.providerProfileId);
  const modelCatalogEntryId = optionalTrimmed(value.modelCatalogEntryId);
  const model = optionalTrimmed(value.model);
  const providerProfileNameSnapshot = optionalTrimmed(
    value.providerProfileNameSnapshot,
  );
  const providerProfileSource =
    value.providerProfileSource === "local" ||
    value.providerProfileSource === "managed" ||
    value.providerProfileSource === "disk"
      ? value.providerProfileSource
      : undefined;
  const runtimeCapabilityFingerprint = optionalTrimmed(
    value.runtimeCapabilityFingerprint,
  );
  return {
    engine: engine as ExecutionTargetSnapshot["engine"],
    ...(providerProfileId !== undefined ? { providerProfileId } : {}),
    ...(modelCatalogEntryId !== undefined ? { modelCatalogEntryId } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(reasoningRecord ? { reasoning: reasoningRecord } : {}),
    ...(providerProfileNameSnapshot !== undefined
      ? { providerProfileNameSnapshot }
      : {}),
    ...(providerProfileSource !== undefined ? { providerProfileSource } : {}),
    ...(runtimeCapabilityFingerprint !== undefined
      ? { runtimeCapabilityFingerprint }
      : {}),
  };
}

function normalizeRecord(value: unknown): TurnTargetBadgeRecord | null {
  if (!isPlainRecord(value)) {
    return null;
  }
  const snapshot = normalizeSnapshot(value.snapshot);
  if (!snapshot) {
    return null;
  }
  const recordedAt =
    typeof value.recordedAt === "number" &&
    Number.isFinite(value.recordedAt) &&
    value.recordedAt > 0
      ? value.recordedAt
      : Date.now();
  return { snapshot, recordedAt };
}

function pruneEntries(
  entries: TurnTargetBadgeRecord[],
): TurnTargetBadgeRecord[] {
  return entries.slice(-MAX_TURN_TARGET_BADGE_ENTRIES_PER_THREAD);
}

function pruneMap(map: TurnTargetBadgeMap): TurnTargetBadgeMap {
  const threadIds = Object.keys(map);
  if (threadIds.length <= MAX_TURN_TARGET_BADGE_THREADS) {
    return map;
  }
  const kept = threadIds.slice(-MAX_TURN_TARGET_BADGE_THREADS);
  const next: TurnTargetBadgeMap = {};
  for (const threadId of kept) {
    next[threadId] = map[threadId]!;
  }
  return next;
}

export function normalizeTurnTargetBadgeMap(raw: unknown): TurnTargetBadgeMap {
  if (!isPlainRecord(raw)) {
    return {};
  }
  const normalized: TurnTargetBadgeMap = {};
  for (const [threadId, entries] of Object.entries(raw)) {
    const trimmedThreadId = threadId.trim();
    if (!trimmedThreadId || !Array.isArray(entries)) {
      continue;
    }
    const nextEntries: TurnTargetBadgeRecord[] = [];
    for (const entry of entries) {
      const record = normalizeRecord(entry);
      if (record) {
        nextEntries.push(record);
      }
    }
    if (nextEntries.length > 0) {
      normalized[trimmedThreadId] = pruneEntries(nextEntries);
    }
  }
  return pruneMap(normalized);
}

export function loadTurnTargetBadgesForThread(
  threadId: string,
): TurnTargetBadgeRecord[] {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId || !isNativeTurnTargetLedgerScope(normalizedThreadId)) {
    return [];
  }
  const raw = getClientStoreSync<unknown>("threads", TURN_TARGET_BADGE_STORE_KEY);
  const map = normalizeTurnTargetBadgeMap(raw);
  return map[normalizedThreadId] ?? [];
}

/**
 * 发送边界追加一轮快照；同轮重试（连续 record）以最新为准——ring 最后一项
 * 与上一项间隔小于 1s 且同一 send 边界时视为重复（latest-wins 覆盖尾部）。
 */
export function appendTurnTargetBadge(
  threadId: string,
  snapshot: ExecutionTargetSnapshot | null | undefined,
  recordedAt: number = Date.now(),
): void {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId || !isNativeTurnTargetLedgerScope(normalizedThreadId)) {
    return;
  }
  const record = normalizeRecord({ snapshot, recordedAt });
  if (!record) {
    return;
  }
  const map = normalizeTurnTargetBadgeMap(
    getClientStoreSync<unknown>("threads", TURN_TARGET_BADGE_STORE_KEY),
  );
  const entries = map[normalizedThreadId] ?? [];
  const last = entries[entries.length - 1];
  const isSameSendBurst =
    last != null && record.recordedAt - last.recordedAt < 1_000;
  const nextEntries = isSameSendBurst
    ? [...entries.slice(0, -1), record]
    : [...entries, record];
  map[normalizedThreadId] = pruneEntries(nextEntries);
  writeClientStoreValue("threads", TURN_TARGET_BADGE_STORE_KEY, pruneMap(map));
}

/**
 * pending → 正式 thread id 迁移：旧 key 的轮次记录按 recordedAt 合并进新 key
 * （不覆盖目标已有记录——resume 换绑同一正式 id 时两段轮次都保留）。缺这步
 * 迁移时，历史冷加载按正式 id 读侧车，改名前（通常首轮）的 badge 会丢。
 */
export function renameTurnTargetBadgeThread(
  oldThreadId: string,
  newThreadId: string,
): void {
  const from = oldThreadId.trim();
  const to = newThreadId.trim();
  if (!from || !to || from === to) {
    return;
  }
  const map = normalizeTurnTargetBadgeMap(
    getClientStoreSync<unknown>("threads", TURN_TARGET_BADGE_STORE_KEY),
  );
  const sourceEntries = map[from];
  if (!sourceEntries || sourceEntries.length === 0) {
    return;
  }
  delete map[from];
  map[to] = pruneEntries(
    [...(map[to] ?? []), ...sourceEntries].sort(
      (a, b) => a.recordedAt - b.recordedAt,
    ),
  );
  writeClientStoreValue("threads", TURN_TARGET_BADGE_STORE_KEY, pruneMap(map));
}

/**
 * 历史加载补挂：按用户消息切分轮次、从尾部对齐最近 K 轮 ring 记录，
 * 仅给缺失 executionTargetSnapshot 的助手消息落地。不做任何覆盖。
 */
export function mergeTurnTargetBadgesIntoItems(
  threadId: string,
  items: ConversationItem[],
  entries: TurnTargetBadgeRecord[] = loadTurnTargetBadgesForThread(threadId),
): ConversationItem[] {
  const normalizedThreadId = threadId.trim();
  if (
    !normalizedThreadId ||
    !isNativeTurnTargetLedgerScope(normalizedThreadId) ||
    entries.length === 0 ||
    items.length === 0
  ) {
    return items;
  }

  // 切分轮次边界：每个 user 消息开启新一轮；其后的 assistant 归属该轮。
  type TurnBucket = { startIndex: number; itemIndexes: number[] };
  const buckets: TurnBucket[] = [];
  const leadingAssistantIndexes: number[] = [];
  let current: TurnBucket | null = null;
  items.forEach((item, index) => {
    if (item.kind !== "message") {
      current?.itemIndexes.push(index);
      return;
    }
    if (item.role === "user") {
      current = { startIndex: index, itemIndexes: [] };
      buckets.push(current);
      return;
    }
    if (current) {
      current.itemIndexes.push(index);
    } else {
      leadingAssistantIndexes.push(index);
    }
  });

  // 头部无 user 前缀的 assistant（如注入摘要卡）不属于任何发送轮次，不挂。
  const tailBuckets = buckets.slice(-entries.length);
  // entries 也从尾部对齐：最后一个 bucket 配最后一条记录。
  const entriesOffset = entries.length - tailBuckets.length;

  let changed = false;
  const nextItems = [...items];
  tailBuckets.forEach((bucket, bucketIndex) => {
    const record = entries[entriesOffset + bucketIndex];
    if (!record) {
      return;
    }
    // 与实时链路对齐：send.request 记账让 pi 等无回执事件的引擎
    // 在历史里同样出现 Ⓡ 尾巴与可展开面板（回执来源如实标注请求名语义）。
    const derivedReceipt: RuntimeModelReceipt | undefined = record.snapshot.model
      ? { model: record.snapshot.model, modelSource: "send.request" }
      : undefined;
    for (const itemIndex of bucket.itemIndexes) {
      const item = nextItems[itemIndex];
      if (
        item?.kind === "message" &&
        item.role === "assistant" &&
        !item.executionTargetSnapshot
      ) {
        nextItems[itemIndex] = {
          ...item,
          executionTargetSnapshot: record.snapshot,
          ...(derivedReceipt && !item.runtimeReceipt
            ? { runtimeReceipt: derivedReceipt }
            : {}),
        };
        changed = true;
      }
    }
  });
  void leadingAssistantIndexes;
  return changed ? nextItems : items;
}

export function resetTurnTargetBadgeStorageForTests(): void {
  writeClientStoreValue("threads", TURN_TARGET_BADGE_STORE_KEY, {});
}
