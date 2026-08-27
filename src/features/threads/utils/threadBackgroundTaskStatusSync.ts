/**
 * 后台任务 running 计数 → threadStatusById 单订阅 sync（design D2）。
 *
 * backgroundTaskStore 的四路写入（item/started、receipt/notification、
 * registry watcher、历史 hydrate）+ clearBackgroundTasks 全部经版本号订阅
 * 汇入本模块：diff 出计数变化的线程后 dispatch markBackgroundTaskActivity，
 * reducer 侧完成 0 跨越收口（非活跃线程标 unread）。
 *
 * Render Perf 红线：纯事件驱动订阅，禁止轮询；仅在生命周期事件（start /
 * terminal / clear）上 dispatch，不触碰秒级频率；本模块是 app 级单例挂载
 * （useThreadEventHandlers），不是 per-row。
 */
import { useEffect } from "react";
import type { Dispatch } from "react";
import {
  listBackgroundTaskRunningCounts,
  subscribeBackgroundTaskStore,
} from "../../messages/utils/backgroundTaskStore";
import type { ThreadAction } from "../hooks/threadReducerTypes";

export type BackgroundTaskRunningCountEntry = {
  workspaceId: string;
  threadId: string;
  runningCount: number;
};

/** 与 backgroundTaskStore.threadKey 同源的分隔符（\u0000）。 */
const THREAD_KEY_SEPARATOR = "\u0000";

function entryKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}${THREAD_KEY_SEPARATOR}${threadId}`;
}

function parseEntryKey(key: string): BackgroundTaskRunningCountEntry {
  const separatorIndex = key.indexOf(THREAD_KEY_SEPARATOR);
  return {
    workspaceId: key.slice(0, separatorIndex),
    threadId: key.slice(separatorIndex + 1),
    runningCount: 0,
  };
}

/**
 * 快照 diff：只返回需要 dispatch 的条目。
 * - 新出现且计数为 0 的线程跳过（reducer 缺省即 0，省一次 no-op dispatch）；
 * - lastKnown 里有、next 里没有（表被清理）且原计数 > 0 → 补 0 触发终态收口。
 */
export function diffBackgroundTaskRunningCounts(
  lastKnown: readonly BackgroundTaskRunningCountEntry[],
  next: readonly BackgroundTaskRunningCountEntry[],
): BackgroundTaskRunningCountEntry[] {
  const lastByKey = new Map(
    lastKnown.map((entry) => [
      entryKey(entry.workspaceId, entry.threadId),
      entry.runningCount,
    ]),
  );
  const changes: BackgroundTaskRunningCountEntry[] = [];
  const nextKeys = new Set<string>();
  for (const entry of next) {
    const key = entryKey(entry.workspaceId, entry.threadId);
    nextKeys.add(key);
    if ((lastByKey.get(key) ?? 0) !== entry.runningCount) {
      changes.push(entry);
    }
  }
  for (const [key, previousCount] of lastByKey) {
    if (nextKeys.has(key) || previousCount === 0) {
      continue;
    }
    changes.push(parseEntryKey(key));
  }
  return changes;
}

/** 订阅 store 并把 diff 结果 dispatch 进 threads reducer；dispose 退订。 */
export function createBackgroundTaskStatusSync(
  dispatch: Dispatch<ThreadAction>,
): { dispose: () => void } {
  let lastKnown: BackgroundTaskRunningCountEntry[] = [];
  const flush = () => {
    const next = listBackgroundTaskRunningCounts();
    const changes = diffBackgroundTaskRunningCounts(lastKnown, next);
    lastKnown = next;
    for (const change of changes) {
      dispatch({
        type: "markBackgroundTaskActivity",
        workspaceId: change.workspaceId,
        threadId: change.threadId,
        runningCount: change.runningCount,
      });
    }
  };
  const unsubscribe = subscribeBackgroundTaskStore(flush);
  // 先订阅再对齐当前快照：挂载晚于在途写入时也能把 reducer 拉平。
  flush();
  return { dispose: unsubscribe };
}

/** app 级单例挂载（useThreadEventHandlers）；dispatch 为裸 useReducer dispatch，引用稳定。 */
export function useThreadBackgroundTaskStatusSync(
  dispatch: Dispatch<ThreadAction>,
): void {
  useEffect(() => {
    const sync = createBackgroundTaskStatusSync(dispatch);
    return () => sync.dispose();
  }, [dispatch]);
}
