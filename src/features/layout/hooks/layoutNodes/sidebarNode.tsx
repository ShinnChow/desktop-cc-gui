import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from "react";
import { Sidebar } from "../../../app/components/Sidebar";
import type { useGlobalRuntimeNoticeDock } from "../../../notifications/hooks/useGlobalRuntimeNoticeDock";
import type { useSidebarThreadStatusProjection } from "../../../threads/hooks/useSidebarThreadStatusProjection";
import type { ShellRuntimeSummary } from "../layoutShellSummary";
import type { LayoutNodesFlatOptions } from "../layoutNodesTypes";

export type BuildSidebarNodeInput = Pick<
  LayoutNodesFlatOptions,
  | "workspaces"
  | "groupedWorkspaces"
  | "hasWorkspaceGroups"
  | "deletingWorktreeIds"
  | "threadsByWorkspace"
  | "threadParentById"
  | "runningSessionCountByWorkspaceId"
  | "recentCompletedSessionCountByWorkspaceId"
  | "hydratedThreadListWorkspaceIds"
  | "threadListLoadingByWorkspace"
  | "threadListPagingByWorkspace"
  | "threadListCursorByWorkspace"
  | "activeWorkspaceId"
  | "activeThreadId"
  | "systemProxyEnabled"
  | "systemProxyUrl"
  | "onUpdateSystemProxy"
  | "activeRateLimits"
  | "usageShowRemaining"
  | "showSidebarProviderLabels"
  | "defaultVisibleThreadRootCount"
  | "onChangeDefaultVisibleThreadRootCount"
  | "accountInfo"
  | "onSwitchAccount"
  | "onCancelSwitchAccount"
  | "accountSwitching"
  | "onOpenSettings"
  | "onOpenSessionManagement"
  | "onOpenDebug"
  | "showDebugButton"
  | "onAddWorkspace"
  | "onSelectHome"
  | "onSelectWorkspace"
  | "onReorderWorkspaces"
  | "onConnectWorkspace"
  | "onAddAgent"
  | "engineOptions"
  | "onRefreshEngineOptions"
  | "onAddSharedAgent"
  | "onAddWorktreeAgent"
  | "onAddCloneAgent"
  | "onToggleWorkspaceCollapse"
  | "onSelectThread"
  | "onProviderContinuationTargetReady"
  | "onDeleteThread"
  | "onArchiveThread"
  | "deleteConfirmThreadId"
  | "deleteConfirmWorkspaceId"
  | "deleteConfirmBusy"
  | "onCancelDeleteConfirm"
  | "onConfirmDeleteConfirm"
  | "renameThreadId"
  | "renameWorkspaceId"
  | "renameName"
  | "onRenameChange"
  | "onRenameCancel"
  | "onRenameConfirm"
  | "onSyncThread"
  | "pinThread"
  | "unpinThread"
  | "isThreadPinned"
  | "isThreadAutoNaming"
  | "getPinTimestamp"
  | "pinnedThreadsVersion"
  | "onRenameThread"
  | "onAutoNameThread"
  | "onOpenClaudeTui"
  | "onDeleteWorkspace"
  | "onDeleteWorktree"
  | "onRenameWorkspaceAlias"
  | "workspaceGroups"
  | "onAssignWorkspaceGroup"
  | "onLoadOlderThreads"
  | "onReloadWorkspaceThreads"
  | "onQuickReloadWorkspaceThreads"
  | "onRequestRootSessionFolderDraft"
  | "isExitedSessionsHidden"
  | "onToggleExitedSessionsHidden"
  | "rootSessionFolderDraftRequestByWorkspaceId"
  | "workspaceDropTargetRef"
  | "isWorkspaceDropActive"
  | "workspaceDropText"
  | "onWorkspaceDragOver"
  | "onWorkspaceDragEnter"
  | "onWorkspaceDragLeave"
  | "onWorkspaceDrop"
  | "appMode"
  | "onAppModeChange"
  | "onOpenHomeChat"
  | "onLockPanel"
  | "onOpenProjectMemory"
  | "onOpenReleaseNotes"
  | "onOpenGlobalSearch"
  | "onOpenQuickSwitcher"
  | "onCollapseSidebar"
  | "globalSearchShortcut"
  | "openChatShortcut"
  | "openSettingsShortcut"
  | "showLoadingProgressDialog"
  | "hideLoadingProgressDialog"
  | "onOpenSpecHub"
  | "onOpenWorkspaceHome"
  | "showTerminalButton"
  | "terminalOpen"
  | "onToggleTerminal"
  | "isPhone"
> & {
  handleRuntimeProfileRender: ProfilerOnRenderCallback;
  sidebarActiveItems: ShellRuntimeSummary["sidebarSubagentItems"];
  sidebarThreadStatusById: ReturnType<typeof useSidebarThreadStatusProjection>;
  sidebarRuntimeNoticeDockNode: ReactNode;
  showGlobalRuntimeNoticeDock: boolean;
  globalRuntimeNoticeDock: ReturnType<typeof useGlobalRuntimeNoticeDock>;
};

export function buildSidebarNode({
  workspaces,
  groupedWorkspaces,
  hasWorkspaceGroups,
  deletingWorktreeIds,
  threadsByWorkspace,
  threadParentById,
  runningSessionCountByWorkspaceId,
  recentCompletedSessionCountByWorkspaceId,
  hydratedThreadListWorkspaceIds,
  threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  activeWorkspaceId,
  activeThreadId,
  systemProxyEnabled,
  systemProxyUrl,
  onUpdateSystemProxy,
  activeRateLimits,
  usageShowRemaining,
  showSidebarProviderLabels,
  defaultVisibleThreadRootCount,
  onChangeDefaultVisibleThreadRootCount,
  accountInfo,
  onSwitchAccount,
  onCancelSwitchAccount,
  accountSwitching,
  onOpenSettings,
  onOpenSessionManagement,
  onOpenDebug,
  showDebugButton,
  onAddWorkspace,
  onSelectHome,
  onSelectWorkspace,
  onReorderWorkspaces,
  onConnectWorkspace,
  onAddAgent,
  engineOptions,
  onRefreshEngineOptions,
  onAddSharedAgent,
  onAddWorktreeAgent,
  onAddCloneAgent,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onProviderContinuationTargetReady,
  onDeleteThread,
  onArchiveThread,
  deleteConfirmThreadId,
  deleteConfirmWorkspaceId,
  deleteConfirmBusy,
  onCancelDeleteConfirm,
  onConfirmDeleteConfirm,
  renameThreadId,
  renameWorkspaceId,
  renameName,
  onRenameChange,
  onRenameCancel,
  onRenameConfirm,
  onSyncThread,
  pinThread,
  unpinThread,
  isThreadPinned,
  isThreadAutoNaming,
  getPinTimestamp,
  pinnedThreadsVersion,
  onRenameThread,
  onAutoNameThread,
  onOpenClaudeTui,
  onDeleteWorkspace,
  onDeleteWorktree,
  onRenameWorkspaceAlias,
  workspaceGroups,
  onAssignWorkspaceGroup,
  onLoadOlderThreads,
  onReloadWorkspaceThreads,
  onQuickReloadWorkspaceThreads,
  onRequestRootSessionFolderDraft,
  isExitedSessionsHidden,
  onToggleExitedSessionsHidden,
  rootSessionFolderDraftRequestByWorkspaceId,
  workspaceDropTargetRef,
  isWorkspaceDropActive,
  workspaceDropText,
  onWorkspaceDragOver,
  onWorkspaceDragEnter,
  onWorkspaceDragLeave,
  onWorkspaceDrop,
  appMode,
  onAppModeChange,
  onOpenHomeChat,
  onLockPanel,
  onOpenProjectMemory,
  onOpenReleaseNotes,
  onOpenGlobalSearch,
  onOpenQuickSwitcher,
  onCollapseSidebar,
  globalSearchShortcut,
  openChatShortcut,
  openSettingsShortcut,
  showLoadingProgressDialog,
  hideLoadingProgressDialog,
  onOpenSpecHub,
  onOpenWorkspaceHome,
  showTerminalButton,
  terminalOpen,
  onToggleTerminal,
  isPhone,
  handleRuntimeProfileRender,
  sidebarActiveItems,
  sidebarThreadStatusById,
  sidebarRuntimeNoticeDockNode,
  showGlobalRuntimeNoticeDock,
  globalRuntimeNoticeDock,
}: BuildSidebarNodeInput): ReactNode {
  return (
    <Profiler id="sidebar" onRender={handleRuntimeProfileRender}>
      <Sidebar
        workspaces={workspaces}
        groupedWorkspaces={groupedWorkspaces}
        hasWorkspaceGroups={hasWorkspaceGroups}
        deletingWorktreeIds={deletingWorktreeIds}
        threadsByWorkspace={threadsByWorkspace}
        activeItems={sidebarActiveItems}
        threadParentById={threadParentById}
        threadStatusById={sidebarThreadStatusById}
        runningSessionCountByWorkspaceId={
          runningSessionCountByWorkspaceId
        }
        recentSessionCountByWorkspaceId={
          recentCompletedSessionCountByWorkspaceId
        }
        hydratedThreadListWorkspaceIds={hydratedThreadListWorkspaceIds}
        threadListLoadingByWorkspace={threadListLoadingByWorkspace}
        threadListPagingByWorkspace={threadListPagingByWorkspace}
        threadListCursorByWorkspace={threadListCursorByWorkspace}
        activeWorkspaceId={activeWorkspaceId}
        activeThreadId={activeThreadId}
        systemProxyEnabled={systemProxyEnabled}
        systemProxyUrl={systemProxyUrl}
        onUpdateSystemProxy={onUpdateSystemProxy}
        accountRateLimits={activeRateLimits}
        usageShowRemaining={usageShowRemaining}
        showProviderLabels={showSidebarProviderLabels}
        defaultVisibleThreadRootCount={defaultVisibleThreadRootCount}
        onChangeDefaultVisibleThreadRootCount={
          onChangeDefaultVisibleThreadRootCount
        }
        accountInfo={accountInfo}
        onSwitchAccount={onSwitchAccount}
        onCancelSwitchAccount={onCancelSwitchAccount}
        accountSwitching={accountSwitching}
        onOpenSettings={onOpenSettings}
        onOpenSessionManagement={onOpenSessionManagement}
        onOpenDebug={onOpenDebug}
        showDebugButton={showDebugButton}
        onAddWorkspace={onAddWorkspace}
        onSelectHome={onSelectHome}
        onSelectWorkspace={onSelectWorkspace}
        onReorderWorkspaces={onReorderWorkspaces}
        onConnectWorkspace={onConnectWorkspace}
        onAddAgent={onAddAgent}
        engineOptions={engineOptions}
        onRefreshEngineOptions={onRefreshEngineOptions}
        onAddSharedAgent={onAddSharedAgent}
        onAddWorktreeAgent={onAddWorktreeAgent}
        onAddCloneAgent={onAddCloneAgent}
        onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
        onSelectThread={onSelectThread}
        onProviderContinuationTargetReady={
          onProviderContinuationTargetReady
        }
        onDeleteThread={onDeleteThread}
        onArchiveThread={onArchiveThread}
        deleteConfirmThreadId={deleteConfirmThreadId}
        deleteConfirmWorkspaceId={deleteConfirmWorkspaceId}
        deleteConfirmBusy={deleteConfirmBusy}
        onCancelDeleteConfirm={onCancelDeleteConfirm}
        onConfirmDeleteConfirm={onConfirmDeleteConfirm}
        renameThreadId={renameThreadId}
        renameWorkspaceId={renameWorkspaceId}
        renameName={renameName}
        onRenameChange={onRenameChange}
        onRenameCancel={onRenameCancel}
        onRenameConfirm={onRenameConfirm}
        onSyncThread={onSyncThread}
        pinThread={pinThread}
        unpinThread={unpinThread}
        isThreadPinned={isThreadPinned}
        isThreadAutoNaming={isThreadAutoNaming}
        getPinTimestamp={getPinTimestamp}
        pinnedThreadsVersion={pinnedThreadsVersion}
        onRenameThread={onRenameThread}
        onAutoNameThread={onAutoNameThread}
        onOpenClaudeTui={onOpenClaudeTui}
        onDeleteWorkspace={onDeleteWorkspace}
        onDeleteWorktree={onDeleteWorktree}
        onRenameWorkspaceAlias={onRenameWorkspaceAlias}
        workspaceGroups={workspaceGroups}
        onAssignWorkspaceGroup={onAssignWorkspaceGroup}
        onLoadOlderThreads={onLoadOlderThreads}
        onReloadWorkspaceThreads={onReloadWorkspaceThreads}
        onQuickReloadWorkspaceThreads={onQuickReloadWorkspaceThreads}
        onRequestRootSessionFolderDraft={onRequestRootSessionFolderDraft}
        isExitedSessionsHidden={isExitedSessionsHidden}
        onToggleExitedSessionsHidden={onToggleExitedSessionsHidden}
        rootSessionFolderDraftRequestByWorkspaceId={
          rootSessionFolderDraftRequestByWorkspaceId
        }
        workspaceDropTargetRef={workspaceDropTargetRef}
        isWorkspaceDropActive={isWorkspaceDropActive}
        workspaceDropText={workspaceDropText}
        onWorkspaceDragOver={onWorkspaceDragOver}
        onWorkspaceDragEnter={onWorkspaceDragEnter}
        onWorkspaceDragLeave={onWorkspaceDragLeave}
        onWorkspaceDrop={onWorkspaceDrop}
        appMode={appMode}
        onAppModeChange={onAppModeChange}
        onOpenHomeChat={onOpenHomeChat}
        onLockPanel={onLockPanel}
        onOpenProjectMemory={onOpenProjectMemory}
        onOpenReleaseNotes={onOpenReleaseNotes}
        onOpenGlobalSearch={onOpenGlobalSearch}
        onOpenQuickSwitcher={onOpenQuickSwitcher}
        onCollapseSidebar={onCollapseSidebar}
        globalSearchShortcut={globalSearchShortcut}
        openChatShortcut={openChatShortcut}
        openSettingsShortcut={openSettingsShortcut}
        showLoadingProgressDialog={showLoadingProgressDialog}
        hideLoadingProgressDialog={hideLoadingProgressDialog}
        onOpenSpecHub={onOpenSpecHub}
        onOpenWorkspaceHome={onOpenWorkspaceHome}
        showTerminalButton={showTerminalButton}
        isTerminalOpen={terminalOpen}
        onToggleTerminal={onToggleTerminal}
        runtimeNoticeDockNode={sidebarRuntimeNoticeDockNode}
        onOpenRuntimeNotice={
          showGlobalRuntimeNoticeDock ? globalRuntimeNoticeDock.expand : undefined
        }
        showRuntimeNoticeMenuItem={
          Boolean(showGlobalRuntimeNoticeDock && !isPhone)
        }
        runtimeNoticeHasError={globalRuntimeNoticeDock.status === "has-error"}
      />
    </Profiler>
  );
}
