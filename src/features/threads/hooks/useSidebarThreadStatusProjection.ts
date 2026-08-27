import { useRef } from "react";

// Sidebar / topbar tabs / session activity 只消费三个布尔位 + 后台任务计数，
// 但 reducer 里的 threadStatusById 每次 heartbeatPulse / continuationPulse 变化都会换引用，
// 直接透传会击穿这些 memo 组件，导致整棵 sidebar 树（含所有 Popover/Tooltip）随心跳全量重渲染。
// 这里做一次「布尔位投影 + 引用稳定化」：仅当任一线程的三个布尔/计数真正变化时才返回新引用。

export type SidebarThreadRowStatus = {
  isProcessing: boolean;
  hasUnread: boolean;
  isReviewing: boolean;
  /** 后台任务运行中计数；旧形状/缺失视为 0。 */
  backgroundTaskRunningCount?: number;
};

type SourceThreadStatus = {
  isProcessing?: boolean;
  hasUnread?: boolean;
  isReviewing?: boolean;
  backgroundTaskRunningCount?: number;
};

export function projectSidebarThreadStatus(
  previous: Record<string, SidebarThreadRowStatus> | null,
  source: Record<string, SourceThreadStatus | undefined>,
): Record<string, SidebarThreadRowStatus> {
  const sourceKeys = Object.keys(source);
  let reusePrevious =
    previous !== null && Object.keys(previous).length === sourceKeys.length;
  const next: Record<string, SidebarThreadRowStatus> = {};
  for (const key of sourceKeys) {
    const entry = source[key];
    const isProcessing = entry?.isProcessing ?? false;
    const hasUnread = entry?.hasUnread ?? false;
    const isReviewing = entry?.isReviewing ?? false;
    const backgroundTaskRunningCount =
      entry?.backgroundTaskRunningCount ?? 0;
    const previousEntry = previous?.[key];
    if (
      previousEntry &&
      previousEntry.isProcessing === isProcessing &&
      previousEntry.hasUnread === hasUnread &&
      previousEntry.isReviewing === isReviewing &&
      (previousEntry.backgroundTaskRunningCount ?? 0) ===
        backgroundTaskRunningCount
    ) {
      next[key] = previousEntry;
      continue;
    }
    next[key] = {
      isProcessing,
      hasUnread,
      isReviewing,
      backgroundTaskRunningCount,
    };
    reusePrevious = false;
  }
  return reusePrevious && previous ? previous : next;
}

export function useSidebarThreadStatusProjection(
  source: Record<string, SourceThreadStatus | undefined>,
) {
  const projectedRef = useRef<Record<string, SidebarThreadRowStatus> | null>(null);
  const lastSourceRef = useRef<typeof source | null>(null);
  if (lastSourceRef.current !== source) {
    projectedRef.current = projectSidebarThreadStatus(projectedRef.current, source);
    lastSourceRef.current = source;
  }
  return projectedRef.current ?? {};
}
