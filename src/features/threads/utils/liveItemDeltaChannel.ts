// 流式 reasoning / toolOutput 电报外部化通道（perf flag: liveDeltaExternalization）。
//
// 背景：A4 一期只给「AI 正文」修了专线（liveAssistantTextChannel）；思考过程
// （reasoningContent / reasoningSummary）与工具输出（toolOutput）三类 delta 仍
// 每 32ms 攒一批 dispatch 进根 reducer，长思考回合里以 ~30 次/秒的频率打醒
// AppShell 大子树。本通道照 A4 正文专线的模子加 lane 维度泛化：首条 delta 建壳、
// 后续 delta 只更新此处并按 cadence 通知订阅行、settle 时 drain 尾部一次性落回
// reducer。
//
// 设计要点（与 liveAssistantTextChannel 一一对应）：
// - 按 threadId 建模，线程内以 `${itemId}:${lane}` 区分条目；三类 lane 互不串。
// - 纯内存、无持久化；「这行是否消费通道文本」由渲染层 isStreaming/isLive 判定，
//   reducer 对 reasoning item id 的 -seg-N 改写由消费侧匹配器容忍。
// - 首条 delta 全量记录（text 从首段起累计），渲染侧直接用条目全文，无需与壳
//   文本拼接；drain 只返回「尚未落 reducer 的尾段」（全长减建壳首段）。
// - 终端命令（toolOutput + commandExecution）写入前套 boundToolOutput；
//   published 快照只发最后 200 行。fileChange / 思考 lane 不走这顶帽。
// 方案文档：docs/perf/a4-live-text-externalization-plan.md（§2.3 预留的二期）

import { doesLiveAssistantTextMatchItem } from "./liveAssistantTextChannel";
import { boundToolOutput, COMMAND_EXECUTION_OUTPUT_HEAD } from "./boundToolOutput";
import { isLiveToolOutputStreamingTailEnabled } from "./realtimePerfFlags";

export type LiveItemDeltaLane =
  | "reasoningContent"
  | "reasoningSummary"
  | "toolOutput";

export type LiveItemDeltaEntry = {
  itemId: string;
  lane: LiveItemDeltaLane;
  text: string;
  version: number;
  /** 首条 delta（已随建壳 dispatch 落入 reducer）的长度，供 settle 时 drain 尾段。 */
  shellTextLength: number;
  /** toolOutput 才有：用来把 256KiB 帽只套在终端命令，不误伤 fileChange。 */
  toolType?: string;
};

/** 与 BashToolBlock settle 显示帽对齐：settled 后 durable 输出按这个行数展示。 */
export const LIVE_TOOL_OUTPUT_DISPLAY_LINES = 200;

/**
 * live 流式期 published 快照行数帽（低于 settle 帽）：
 * published 快照只在流式期被订阅消费，降档直接降低 48ms 每轮的
 * split / DOM reflow 规模（openspec/changes/perf-live-tool-output-render-budget）。
 */
export const LIVE_TOOL_OUTPUT_DISPLAY_LINES_STREAMING = 100;

export function takeLastLines(text: string, maxLines: number): string {
  if (maxLines <= 0 || text.length === 0) {
    return text;
  }
  let newlineCount = 0;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (text[i] !== "\n") {
      continue;
    }
    newlineCount += 1;
    if (newlineCount === maxLines) {
      return text.slice(i + 1);
    }
  }
  return text;
}

function takeLiveToolOutputSnapshot(text: string): string {
  const streamingTail = isLiveToolOutputStreamingTailEnabled();
  const lineCap = streamingTail
    ? LIVE_TOOL_OUTPUT_DISPLAY_LINES_STREAMING
    : LIVE_TOOL_OUTPUT_DISPLAY_LINES;
  const tailed = takeLastLines(text, lineCap);
  if (tailed.length <= COMMAND_EXECUTION_OUTPUT_HEAD) {
    return tailed;
  }
  return tailed.slice(tailed.length - COMMAND_EXECUTION_OUTPUT_HEAD);
}

function resolveToolOutputType(
  existingType: string | undefined,
  incomingType: string | undefined,
): string {
  return incomingType ?? existingType ?? "commandExecution";
}

function boundLiveLaneText(
  lane: LiveItemDeltaLane,
  text: string,
  toolType: string | undefined,
): string {
  if (lane !== "toolOutput" || toolType !== "commandExecution") {
    return text;
  }
  return boundToolOutput(text, "commandExecution");
}

function snapshotTextForEntry(entry: LiveItemDeltaEntry): string {
  if (
    entry.lane === "toolOutput" &&
    (entry.toolType ?? "commandExecution") === "commandExecution"
  ) {
    return takeLiveToolOutputSnapshot(entry.text);
  }
  return entry.text;
}

export const LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS = 48;

function laneKey(itemId: string, lane: LiveItemDeltaLane): string {
  return `${itemId}:${lane}`;
}

/** 每条 delta 的权威内存累积值；settle drain 必须从这里读取。 */
const entriesByThread = new Map<string, Map<string, LiveItemDeltaEntry>>();
/** React 可观察快照；仅允许在 notify 前换引用（useSyncExternalStore 要求稳定）。 */
const publishedEntriesByThread = new Map<string, ReadonlyMap<string, string>>();
const listenersByThread = new Map<string, Set<() => void>>();
const publishTimersByThread = new Map<string, ReturnType<typeof setTimeout>>();
const lastPublishedAtByThread = new Map<string, number>();

/** 空快照共享引用：无条目线程的 getSnapshot 必须返回同一引用。 */
const EMPTY_PUBLISHED_SNAPSHOT: ReadonlyMap<string, string> = new Map();

function notifyThread(threadId: string): void {
  const listeners = listenersByThread.get(threadId);
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error("[liveItemDeltaChannel] listener failed", error);
    }
  }
}

function cancelPendingPublish(threadId: string): void {
  const timer = publishTimersByThread.get(threadId);
  if (timer !== undefined) {
    clearTimeout(timer);
    publishTimersByThread.delete(threadId);
  }
}

function publishThreadEntries(threadId: string): void {
  cancelPendingPublish(threadId);
  const entries = entriesByThread.get(threadId);
  const nextPublished = new Map<string, string>();
  if (entries) {
    for (const [key, entry] of entries) {
      nextPublished.set(key, snapshotTextForEntry(entry));
    }
  }
  publishedEntriesByThread.set(threadId, nextPublished);
  lastPublishedAtByThread.set(threadId, Date.now());
  notifyThread(threadId);
}

function scheduleThreadPublish(threadId: string): void {
  const lastPublishedAt = lastPublishedAtByThread.get(threadId);
  const elapsed = lastPublishedAt === undefined
    ? LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS
    : Date.now() - lastPublishedAt;
  if (elapsed >= LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS) {
    publishThreadEntries(threadId);
    return;
  }
  if (publishTimersByThread.has(threadId)) {
    return;
  }
  publishTimersByThread.set(
    threadId,
    setTimeout(() => {
      publishTimersByThread.delete(threadId);
      publishThreadEntries(threadId);
    }, LIVE_ITEM_DELTA_PUBLISH_INTERVAL_MS - elapsed),
  );
}

/**
 * 累计一条 reasoning/toolOutput delta。
 * - 该 `${itemId}:${lane}` 无条目（新回合/新 item/新 lane）→ 建条目并返回
 *   isFirst=true，调用方应照旧 dispatch 该条 delta 以便 reducer 建壳。
 * - 否则追加文本并按 publish cadence 通知订阅者，返回 isFirst=false，
 *   调用方跳过 dispatch。
 * - toolOutput + commandExecution：写入前套 boundToolOutput（256KiB 头+尾）。
 *   fileChange / 其它 toolType 不走 256KiB 帽。
 */
export function appendLiveItemDelta(
  threadId: string,
  itemId: string,
  lane: LiveItemDeltaLane,
  delta: string,
  toolType?: string,
): { isFirst: boolean } {
  let entries = entriesByThread.get(threadId);
  if (!entries) {
    entries = new Map();
    entriesByThread.set(threadId, entries);
  }
  const key = laneKey(itemId, lane);
  const existing = entries.get(key);
  const resolvedToolType =
    lane === "toolOutput"
      ? resolveToolOutputType(existing?.toolType, toolType)
      : undefined;
  if (!existing) {
    const text = boundLiveLaneText(lane, delta, resolvedToolType);
    entries.set(key, {
      itemId,
      lane,
      text,
      version: 1,
      shellTextLength: text.length,
      toolType: resolvedToolType,
    });
    publishThreadEntries(threadId);
    return { isFirst: true };
  }
  entries.set(key, {
    ...existing,
    toolType: resolvedToolType,
    text: boundLiveLaneText(lane, `${existing.text}${delta}`, resolvedToolType),
    version: existing.version + 1,
  });
  scheduleThreadPublish(threadId);
  return { isFirst: false };
}

/**
 * 读权威累积文本（未节流的 entries），不是 48ms publish 后的 published 快照。
 * settle / drain 判定时必须用这个，否则会漏掉尚未 publish 的尾段。
 */
export function peekLiveItemDelta(
  threadId: string,
  itemId: string,
  lane: LiveItemDeltaLane,
): string {
  return entriesByThread.get(threadId)?.get(laneKey(itemId, lane))?.text ?? "";
}

/**
 * 读权威累积条目（含 shellTextLength 等元数据）；无条目返回 null。
 */
export function peekLiveItemDeltaEntry(
  threadId: string,
  itemId: string,
  lane: LiveItemDeltaLane,
): LiveItemDeltaEntry | null {
  return entriesByThread.get(threadId)?.get(laneKey(itemId, lane)) ?? null;
}

/**
 * settle / 中断时取走「尚未落入 reducer 的尾段」并清除该线程全部条目。
 * 返回数组中每项的 text 仅为尾段（全长减建壳首段），调用方应把它作为一条
 * 普通 delta dispatch 回落 durable items；只有建壳首段、无尾段的条目不出现
 * 在结果里。条目清除后订阅行切回读 durable 文本。
 */
export function drainLiveItemDeltaTail(
  threadId: string,
): Array<{ itemId: string; lane: LiveItemDeltaLane; text: string }> {
  const entries = entriesByThread.get(threadId);
  if (!entries || entries.size === 0) {
    return [];
  }
  cancelPendingPublish(threadId);
  entriesByThread.delete(threadId);
  lastPublishedAtByThread.delete(threadId);
  const drained: Array<{ itemId: string; lane: LiveItemDeltaLane; text: string }> = [];
  for (const entry of entries.values()) {
    if (entry.text.length > entry.shellTextLength) {
      drained.push({
        itemId: entry.itemId,
        lane: entry.lane,
        text: entry.text.slice(entry.shellTextLength),
      });
    }
  }
  if (publishedEntriesByThread.delete(threadId)) {
    notifyThread(threadId);
  }
  return drained;
}

/** 回合结束/线程删除时清除条目（订阅行随之切回读 durable 文本）。 */
export function clearLiveItemDelta(threadId: string): void {
  cancelPendingPublish(threadId);
  entriesByThread.delete(threadId);
  lastPublishedAtByThread.delete(threadId);
  if (publishedEntriesByThread.delete(threadId)) {
    notifyThread(threadId);
  }
}

/**
 * 清除某 item 的全部 lane 条目（item 级完成快照是权威文本时调用）。
 * 不清其它 item 的条目；返回是否有条目被清除。
 */
export function clearLiveItemDeltaForItem(
  threadId: string,
  itemId: string,
): boolean {
  const entries = entriesByThread.get(threadId);
  if (!entries) {
    return false;
  }
  let removed = false;
  for (const lane of ["reasoningContent", "reasoningSummary", "toolOutput"] as const) {
    removed = entries.delete(laneKey(itemId, lane)) || removed;
  }
  if (entries.size === 0) {
    entriesByThread.delete(threadId);
  }
  if (removed) {
    // 立即重发布，订阅行在同一帧内切回 durable 文本，避免残留旧快照。
    publishThreadEntries(threadId);
  }
  return removed;
}

/**
 * React 可观察快照：key = `${itemId}:${lane}`，value = 已发布文本。
 * 终端命令只发显示尾（最后 200 行 / 64KiB）；权威全文仍在 peek。
 * 无条目线程返回共享空 Map（引用稳定）。
 */
export function getLiveItemDeltaSnapshot(
  threadId: string,
): ReadonlyMap<string, string> {
  return publishedEntriesByThread.get(threadId) ?? EMPTY_PUBLISHED_SNAPSHOT;
}

/**
 * 快照 key 是否命中「某 item 的某 lane」。reducer 会把 reasoning item id 改写成
 * `base-seg-N`（agentSegment 递增后），事件层 itemId 与 renderItem.id 常不一致，
 * 复用正文通道的 doesLiveAssistantTextMatchItem 容忍双向 -seg- 前缀。
 */
function matchesLaneSnapshotKey(
  key: string,
  itemId: string,
  lane: LiveItemDeltaLane,
): boolean {
  const suffix = `:${lane}`;
  if (!key.endsWith(suffix)) {
    return false;
  }
  const keyItemId = key.slice(0, key.length - suffix.length);
  return doesLiveAssistantTextMatchItem(keyItemId, itemId);
}

/** 在已发布快照里按 itemId（容忍 -seg-N 改写）取某 lane 的文本；无命中返回 null。 */
export function resolveLiveItemDeltaSnapshotText(
  snapshot: ReadonlyMap<string, string>,
  itemId: string,
  lane: LiveItemDeltaLane,
): string | null {
  const exact = snapshot.get(laneKey(itemId, lane));
  if (exact !== undefined) {
    return exact;
  }
  for (const [key, text] of snapshot) {
    if (matchesLaneSnapshotKey(key, itemId, lane)) {
      return text;
    }
  }
  return null;
}

/** 在权威累积里按 itemId（容忍 -seg-N 改写）取某 lane 条目；无命中返回 null。 */
export function peekLiveItemDeltaMatching(
  threadId: string,
  itemId: string,
  lane: LiveItemDeltaLane,
): LiveItemDeltaEntry | null {
  const entries = entriesByThread.get(threadId);
  if (!entries) {
    return null;
  }
  const exact = entries.get(laneKey(itemId, lane));
  if (exact) {
    return exact;
  }
  for (const [key, entry] of entries) {
    if (matchesLaneSnapshotKey(key, itemId, lane)) {
      return entry;
    }
  }
  return null;
}

/** 会话 id 迁移（pending → canonical）时随迁条目。 */
export function renameLiveItemDeltaThread(
  oldThreadId: string,
  newThreadId: string,
): void {
  if (oldThreadId === newThreadId) {
    return;
  }
  const entries = entriesByThread.get(oldThreadId);
  const published = publishedEntriesByThread.get(oldThreadId);
  if (!entries && !published) {
    return;
  }
  cancelPendingPublish(oldThreadId);
  cancelPendingPublish(newThreadId);
  entriesByThread.delete(oldThreadId);
  publishedEntriesByThread.delete(oldThreadId);
  lastPublishedAtByThread.delete(oldThreadId);
  if (entries) {
    entriesByThread.set(newThreadId, entries);
    publishThreadEntries(newThreadId);
  } else if (published) {
    publishedEntriesByThread.set(newThreadId, published);
    lastPublishedAtByThread.set(newThreadId, Date.now());
    notifyThread(newThreadId);
  }
  if (published) {
    notifyThread(oldThreadId);
  }
}

export function subscribeLiveItemDelta(
  threadId: string,
  listener: () => void,
): () => void {
  let listeners = listenersByThread.get(threadId);
  if (!listeners) {
    listeners = new Set();
    listenersByThread.set(threadId, listeners);
  }
  listeners.add(listener);
  return () => {
    const current = listenersByThread.get(threadId);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      listenersByThread.delete(threadId);
    }
  };
}

export function resetLiveItemDeltaChannelForTests(): void {
  for (const timer of publishTimersByThread.values()) {
    clearTimeout(timer);
  }
  publishTimersByThread.clear();
  entriesByThread.clear();
  publishedEntriesByThread.clear();
  lastPublishedAtByThread.clear();
  listenersByThread.clear();
}
