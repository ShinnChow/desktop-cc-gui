import type { WorkspaceLayoutNodesOptions } from "../../../features/layout/hooks/layoutNodesTypes";

// B4 三期：useLayoutNodes 的 workspace options 对象逐字外移；键名/语句/注释保持原样，
// hook 局部变量统一经 bag 传入（引用名不改）。
export function buildLayoutNodesWorkspaceOptions(
  bag: Record<string, any>,
): WorkspaceLayoutNodesOptions {
  const {
    workspaces,
    groupedWorkspaces,
    workspaceGroups,
    deletingWorktreeIds,
    threadsByWorkspace,
    threadParentById,
    threadStatusById,
    historyLoadingByThreadId,
    historyLoadingProgressByThreadId,
    historyRestoredAtMsByThread,
    runningSessionCountByWorkspaceId,
    recentCompletedSessionCountByWorkspaceId,
    hydratedThreadListWorkspaceIds,
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadListCursorByWorkspace,
    activeWorkspaceId,
    activeThreadId,
    isPhone,
    isTablet,
    appSettings,
    handleUpdateSystemProxy,
  } = bag;
  return {
    workspaces,
    groupedWorkspaces,
    hasWorkspaceGroups: workspaceGroups.length > 0,
    deletingWorktreeIds,
    threadsByWorkspace,
    threadParentById,
    threadStatusById,
    historyLoadingByThreadId,
    historyLoadingProgressByThreadId,
    historyRestoredAtMsByThread,
    runningSessionCountByWorkspaceId,
    recentCompletedSessionCountByWorkspaceId,
    // Prefer state snapshot (new Set identity on each mark) over the ref so
    // memo(Sidebar) actually re-renders when hydration completes / times out.
    hydratedThreadListWorkspaceIds:
      hydratedThreadListWorkspaceIds instanceof Set
        ? hydratedThreadListWorkspaceIds
        : new Set<string>(),
    threadListLoadingByWorkspace,
    threadListPagingByWorkspace,
    threadListCursorByWorkspace,
    activeWorkspaceId,
    activeThreadId,
    isPhone,
    isTablet,
    systemProxyEnabled: appSettings.systemProxyEnabled,
    systemProxyUrl: appSettings.systemProxyUrl,
    onUpdateSystemProxy: handleUpdateSystemProxy,
  };
}
