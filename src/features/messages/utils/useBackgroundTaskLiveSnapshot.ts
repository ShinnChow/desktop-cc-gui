/**
 * 后台任务卡片的权威快照直读（真机防御性兜底）：
 * 时间线 item 的 output 快照依赖 sink 全路径 upsert，任何一环丢失（如并行
 * 双 resident 的运行时条件）卡片就永停「运行中」。backgroundTaskStore 是
 * 四路合流（receipt/notification/registry/历史）的会话级权威状态表，卡片
 * 经本 hook 直接订阅该 toolId 的最新记录——时间线更新丢失时自愈。
 *
 * Render Perf 红线：useSyncExternalStore 事件驱动订阅（版本号），无轮询；
 * 每会话挂载卡片数 = 任务数，量级小。
 */
import { useMemo, useSyncExternalStore } from "react";
import type { BackgroundTaskLiveRecord } from "./backgroundTaskStore";
import {
  getBackgroundTaskStoreVersion,
  listBackgroundTasks,
  subscribeBackgroundTaskStore,
} from "./backgroundTaskStore";

export function useBackgroundTaskLiveSnapshot(
  workspaceId: string | null | undefined,
  threadId: string | null | undefined,
  itemId: string | null | undefined,
): BackgroundTaskLiveRecord | null {
  const version = useSyncExternalStore(
    subscribeBackgroundTaskStore,
    getBackgroundTaskStoreVersion,
  );
  return useMemo(() => {
    if (!workspaceId || !threadId || !itemId) return null;
    const matched = listBackgroundTasks(workspaceId, threadId).find(
      (record) => record.itemId === itemId || record.toolId === itemId,
    );
    return matched ?? null;
    // SAFETY: version 是 store 写入序号（intentional cache-buster，不是读值）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, workspaceId, threadId, itemId]);
}
