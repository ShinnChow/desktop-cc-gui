/**
 * 会话级 PI 后台任务状态表（design D3/D5）：taskId → 运行记录。
 *
 * 数据源三路（design §1）：
 * - item/started（type=backgroundTask）：建卡，itemId = toolId；
 * - item/backgroundTask/updated source=receipt：绑定 taskId ↔ toolId，写快照；
 * - item/backgroundTask/updated source=notification：按 taskId 驱动终态折叠；
 * （P2 将新增 registry watcher 第四路，同表复用。）
 *
 * Render Perf 红线：本表是模块级 Map，事件驱动写入，不挂根 hook 链；
 * pill / 卡片需要的读副本通过版本号 + 订阅暴露，禁止轮询。
 */

export type BackgroundTaskLiveRecord = {
  taskId: string;
  /** receipt 到达前为 null（item/started 只有 toolId）。 */
  toolId: string | null;
  /** 时间线条目 id（= toolId；无卡兜底为 `backgroundTask-<taskId>`）。 */
  itemId: string;
  toolName: string | null;
  /** 工具参数（name/command 等，receipt 前唯一信息源）。 */
  input: unknown;
  /** 最新 canonical 快照（receipt / notification 合并视图）。 */
  task: Record<string, unknown>;
  /** 最近一次更新来源："started" | "receipt" | "notification" | "registry"(P2)。 */
  source: string;
  updatedAtMs: number;
};

export type BackgroundTaskUpdatePayload = {
  toolId: string | null;
  task: Record<string, unknown>;
  source: string;
};

type ThreadTaskTable = Map<string, BackgroundTaskLiveRecord>;

/**
 * registry watcher 的消费 sink（P2）：与 receipt/notification 的
 * `onBackgroundTaskUpdated` 同构——「store 合并 + 合成 item 写 reducer」完整路径。
 * 由 useThreadItemEvents 挂载时注册；watcher 有 sink 时走 sink（timeline 与
 * pill 同步翻终态），无 sink（纯 pill 场景/测试）降级直写 store。
 */
type BackgroundTaskUpdateSink = (
  workspaceId: string,
  threadId: string,
  payload: BackgroundTaskUpdatePayload,
) => void;

let updateSink: BackgroundTaskUpdateSink | null = null;

export function setBackgroundTaskUpdateSink(
  sink: BackgroundTaskUpdateSink | null,
): void {
  updateSink = sink;
}

export function getBackgroundTaskUpdateSink(): BackgroundTaskUpdateSink | null {
  return updateSink;
}

const tablesByThread = new Map<string, ThreadTaskTable>();
const listeners = new Set<() => void>();
let storeVersion = 0;

function threadKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}\u0000${threadId}`;
}

function emitChange(): void {
  storeVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isTerminalBackgroundTaskStatus(status: unknown): boolean {
  return ["completed", "failed", "killed", "cancelled", "canceled"].includes(
    String(status ?? "")
      .trim()
      .toLowerCase(),
  );
}

function getOrCreateTable(key: string): ThreadTaskTable {
  let table = tablesByThread.get(key);
  if (!table) {
    table = new Map();
    tablesByThread.set(key, table);
  }
  return table;
}

/** item/started（type=backgroundTask）：登记卡片身份。 */
export function noteBackgroundTaskStarted(
  workspaceId: string,
  threadId: string,
  item: Record<string, unknown>,
): void {
  const toolId = asNonEmptyString(item.id);
  if (!toolId) return;
  const key = threadKey(workspaceId, threadId);
  const table = getOrCreateTable(key);
  const taskId = asNonEmptyString(
    (item.task as Record<string, unknown> | undefined)?.id,
  );
  const toolName = asNonEmptyString(item.tool ?? item.title);
  const input = item.input ?? item.arguments ?? null;
  if (taskId) {
    const existing = table.get(taskId);
    table.set(taskId, {
      taskId,
      toolId,
      itemId: toolId,
      toolName: toolName ?? existing?.toolName ?? null,
      input: input ?? existing?.input ?? null,
      task: existing?.task ?? {},
      source: existing?.source ?? "started",
      updatedAtMs: Date.now(),
    });
  } else {
    // receipt 前：以 toolId 为占位 key，receipt 到达后迁移到 taskId。
    const placeholderKey = `tool:${toolId}`;
    const existing = table.get(placeholderKey);
    table.set(placeholderKey, {
      taskId: placeholderKey,
      toolId,
      itemId: toolId,
      toolName: toolName ?? existing?.toolName ?? null,
      input: input ?? existing?.input ?? null,
      task: existing?.task ?? {},
      source: "started",
      updatedAtMs: Date.now(),
    });
  }
  emitChange();
}

/**
 * item/backgroundTask/updated：合并快照并返回时间线条目合成载荷
 * （喂给 buildConversationItem → upsertItem；title/detail 由 merge 保留）。
 * task.id 缺失时返回 null（降级：不动时间线）。
 */
export function applyBackgroundTaskUpdate(
  workspaceId: string,
  threadId: string,
  payload: BackgroundTaskUpdatePayload,
): {
  item: Record<string, unknown>;
  record: BackgroundTaskLiveRecord;
} | null {
  const taskId = asNonEmptyString(payload.task.id);
  if (!taskId) return null;
  const key = threadKey(workspaceId, threadId);
  const table = getOrCreateTable(key);

  // receipt：可能命中 started 占位（tool:<toolId>），迁移到 taskId key。
  let record: BackgroundTaskLiveRecord | undefined = table.get(taskId);
  if (!record && payload.toolId) {
    const placeholder = table.get(`tool:${payload.toolId}`);
    if (placeholder) {
      table.delete(placeholder.taskId);
      record = { ...placeholder, taskId };
    }
  }
  if (!record) {
    record = {
      taskId,
      toolId: payload.toolId,
      itemId: payload.toolId ?? `backgroundTask-${taskId}`,
      toolName: null,
      input: null,
      task: {},
      source: payload.source,
      updatedAtMs: Date.now(),
    };
  }
  const merged: BackgroundTaskLiveRecord = {
    ...record,
    toolId: payload.toolId ?? record.toolId,
    itemId: payload.toolId ?? record.itemId,
    task: { ...record.task, ...payload.task },
    source: payload.source || record.source,
    updatedAtMs: Date.now(),
  };
  table.set(taskId, merged);
  emitChange();

  const status =
    asNonEmptyString(merged.task.status) ??
    (payload.source === "receipt" ? "running" : "");
  return {
    item: {
      id: merged.itemId,
      type: "backgroundTask",
      // notification-first（未先收 item/started）时卡片需自洽：
      // tool/input 由 record 保留；reducer merge 缺省时也保留建卡值。
      tool: merged.toolName ?? undefined,
      title: merged.toolName ?? undefined,
      input: merged.input ?? undefined,
      task: merged.task,
      status,
    },
    record: merged,
  };
}

/** 读取某会话的全部任务记录（pill / panel 数据源）。 */
export function listBackgroundTasks(
  workspaceId: string,
  threadId: string,
): BackgroundTaskLiveRecord[] {
  const table = tablesByThread.get(threadKey(workspaceId, threadId));
  if (!table) return [];
  return [...table.values()]
    .filter((record) => !record.taskId.startsWith("tool:"))
    .sort((a, b) => a.updatedAtMs - b.updatedAtMs);
}

/** 运行中任务数（pill 计数）。 */


/**
 * 枚举全部会话的 running 计数（thread-status 单订阅 sync 专用读副本）。
 * key 与 threadKey 同源（\u0000 分隔）；表被 clearBackgroundTasks 删除后不再
 * 出现在结果里，sync 据此补 0 让 reducer 走终态收口。
 */
export function listBackgroundTaskRunningCounts(): Array<{
  workspaceId: string;
  threadId: string;
  runningCount: number;
}> {
  const entries: Array<{
    workspaceId: string;
    threadId: string;
    runningCount: number;
  }> = [];
  for (const [key, table] of tablesByThread) {
    const separatorIndex = key.indexOf("\u0000");
    if (separatorIndex <= 0) continue;
    const runningCount = [...table.values()].filter((record) => {
      if (record.taskId.startsWith("tool:")) return false;
      // 终态口径与 isTerminalBackgroundTaskStatus 一致（含 cancelled/canceled），
      // 与 countRunningBackgroundTasks / awaiting curtain 同步收口。
      return !isTerminalBackgroundTaskStatus(record.task.status);
    }).length;
    entries.push({
      workspaceId: key.slice(0, separatorIndex),
      threadId: key.slice(separatorIndex + 1),
      runningCount,
    });
  }
  return entries;
}

/** 版本号（订阅制读副本用；useSyncExternalStore）。 */
export function getBackgroundTaskStoreVersion(): number {
  return storeVersion;
}

export function subscribeBackgroundTaskStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * 历史重载 hydrate（1.5/pill 联动）：把 piHistoryParser 合并好的任务回灌
 * 进 store，让 composer 后台任务 pill 在重开的会话里仍然出现。只补缺——
 * 已有同 taskId 的 live 记录（receipt/notification/registry 写过）不覆盖，
 * 避免 hydrate 与在途事件竞态回退状态。幂等：重复 hydrate 无副作用。
 */
export function hydrateBackgroundTasksFromHistory(
  workspaceId: string,
  threadId: string,
  mergedTasks: Array<{
    taskId: string;
    itemId: string;
    toolName: string | null;
    input: unknown;
    task: Record<string, unknown>;
  }>,
): void {
  if (mergedTasks.length === 0) return;
  const table = getOrCreateTable(threadKey(workspaceId, threadId));
  let mutated = false;
  for (const merged of mergedTasks) {
    if (!merged.taskId || table.has(merged.taskId)) continue;
    table.set(merged.taskId, {
      taskId: merged.taskId,
      toolId: merged.itemId.startsWith("backgroundTask-")
        ? null
        : merged.itemId,
      itemId: merged.itemId,
      toolName: merged.toolName,
      input: merged.input ?? null,
      task: merged.task,
      source: "history",
      updatedAtMs: Date.now(),
    });
    mutated = true;
  }
  if (mutated) {
    emitChange();
  }
}

/**
 * pending→final rename 时随迁任务表（P1 review 修复）：key 是 threadId，
 * 不随迁则 watcher 枚举 / sink 回写 / 时间线 upsert 全挂旧 id——终态写进
 * 幽灵条目，新会话的卡片与 pill 永不更新。幂等：旧表不存在时 no-op。
 * 迁移后 emitChange 一次，sync 订阅据此重算两侧计数。
 */
export function renameBackgroundTasksForThread(
  workspaceId: string,
  oldThreadId: string,
  newThreadId: string,
): void {
  if (oldThreadId === newThreadId) return;
  const oldKey = threadKey(workspaceId, oldThreadId);
  const table = tablesByThread.get(oldKey);
  if (!table) return;
  tablesByThread.delete(oldKey);
  const newKey = threadKey(workspaceId, newThreadId);
  const existing = tablesByThread.get(newKey);
  if (existing) {
    // 新 id 已有记录（极少见）：逐 taskId 合并，旧记录只补缺，live 不被覆盖。
    for (const [taskId, record] of table) {
      if (!existing.has(taskId)) {
        existing.set(taskId, record);
      }
    }
  } else {
    tablesByThread.set(newKey, table);
  }
  emitChange();
}

/** 会话销毁/工作区清理时调用，避免跨会话泄漏。 */
export function clearBackgroundTasks(
  workspaceId: string,
  threadId: string,
): void {
  if (tablesByThread.delete(threadKey(workspaceId, threadId))) {
    emitChange();
  }
}

/** 测试专用：全量清空。 */
export function resetBackgroundTaskStoreForTests(): void {
  tablesByThread.clear();
  emitChange();
}
