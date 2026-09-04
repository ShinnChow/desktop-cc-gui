import type {
  AccountSnapshot,
  AppMode,
  ConversationItem,
  EngineType,
  RateLimitSnapshot,
  ThreadSummary,
  WorkspaceGroup as WorkspaceGroupConfig,
  WorkspaceInfo,
} from "../../../types";
import type { SharedSessionSupportedEngine } from "../../shared-session/utils/sharedSessionEngines";
import type { ReactNode, RefObject } from "react";
import type { SidebarWorkspaceReorderRequest } from "../../workspaces/utils/sidebarWorkspaceReorder";
import type { ThreadPinScope } from "../../threads/utils/threadStorage";
import type {
  EngineDisplayInfo,
  EngineRefreshResult,
} from "../../engine/hooks/useEngineController";
import type { EngineProviderProfileSelection } from "../../threads/constants/codexProviderProfiles";
import type { WorkspaceGroupSection } from "./sidebarInternals";
import type { LoadingProgressController } from "../utils/loadingProgressActions";

export type SidebarProps = {
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: WorkspaceGroupSection[];
  hasWorkspaceGroups: boolean;
  deletingWorktreeIds: Set<string>;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  activeItems: ConversationItem[];
  threadParentById: Record<string, string>;
  threadStatusById: Record<
    string,
    { isProcessing: boolean; hasUnread: boolean; isReviewing: boolean }
  >;
  hydratedThreadListWorkspaceIds: ReadonlySet<string>;
  runningSessionCountByWorkspaceId?: Record<string, number>;
  recentSessionCountByWorkspaceId?: Record<string, number>;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  systemProxyEnabled?: boolean;
  systemProxyUrl?: string | null;
  onUpdateSystemProxy?: (patch: {
    systemProxyEnabled: boolean;
    systemProxyUrl: string | null;
  }) => Promise<unknown>;
  accountRateLimits: RateLimitSnapshot | null;
  usageShowRemaining: boolean;
  showProviderLabels?: boolean;
  defaultVisibleThreadRootCount?: number;
  onChangeDefaultVisibleThreadRootCount?: (
    count: number,
  ) => void | Promise<unknown>;
  accountInfo: AccountSnapshot | null;
  onSwitchAccount: () => void;
  onCancelSwitchAccount: () => void;
  accountSwitching: boolean;
  onOpenSettings: () => void;
  onOpenSessionManagement?: () => void;
  onOpenDebug: () => void;
  showDebugButton?: boolean;
  showTerminalButton?: boolean;
  isTerminalOpen?: boolean;
  onToggleTerminal?: () => void;
  onAddWorkspace: () => void;
  onSelectHome: () => void;
  onSelectWorkspace: (id: string) => void;
  onReorderWorkspaces?: (
    input: SidebarWorkspaceReorderRequest,
  ) => void | Promise<void>;
  onConnectWorkspace: (workspace: WorkspaceInfo) => void;
  onAddAgent: (
    workspace: WorkspaceInfo,
    engine?: EngineType,
    options?: { folderId?: string | null } & EngineProviderProfileSelection,
  ) => Promise<string | null> | string | null | void;
  engineOptions?: EngineDisplayInfo[];
  onRefreshEngineOptions?: () =>
    | Promise<EngineRefreshResult | void>
    | EngineRefreshResult
    | void;
  onAddSharedAgent?: (
    workspace: WorkspaceInfo,
    engine: SharedSessionSupportedEngine,
    options?: { providerProfileId?: string },
  ) => Promise<string | null> | string | null | void;
  onAddWorktreeAgent: (workspace: WorkspaceInfo) => void;
  onAddCloneAgent: (workspace: WorkspaceInfo) => void;
  onOpenClaudeTui?: (input: {
    workspaceId: string;
    workspacePath: string;
    sessionId: string;
  }) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onSelectThread: (workspaceId: string, threadId: string) => void;
  onProviderContinuationTargetReady?: (input: {
    workspaceId: string;
    threadId: string;
    engine: string;
    providerProfileId: string | null;
    modelId: string | null;
    modelRuntime?: string | null;
    effort: string | null;
  }) => void | Promise<void>;
  onDeleteThread: (workspaceId: string, threadId: string) => void;
  onArchiveThread: (workspaceId: string, threadId: string) => void;
  deleteConfirmThreadId?: string | null;
  deleteConfirmWorkspaceId?: string | null;
  deleteConfirmBusy?: boolean;
  onCancelDeleteConfirm?: () => void;
  onConfirmDeleteConfirm?: () => void;
  renameThreadId?: string | null;
  renameWorkspaceId?: string | null;
  renameName?: string;
  onRenameChange?: (value: string) => void;
  onRenameCancel?: () => void;
  onRenameConfirm?: () => void;
  onSyncThread: (workspaceId: string, threadId: string) => void;
  pinThread: (
    workspaceId: string,
    threadId: string,
    scope?: ThreadPinScope,
  ) => boolean;
  unpinThread: (workspaceId: string, threadId: string) => void;
  isThreadPinned: (
    workspaceId: string,
    threadId: string,
    scope?: ThreadPinScope,
  ) => boolean;
  isThreadAutoNaming: (workspaceId: string, threadId: string) => boolean;
  getPinTimestamp: (
    workspaceId: string,
    threadId: string,
    scope?: ThreadPinScope,
  ) => number | null;
  pinnedThreadsVersion: number;
  onRenameThread: (workspaceId: string, threadId: string) => void;
  onAutoNameThread: (workspaceId: string, threadId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
  onDeleteWorktree: (workspaceId: string) => void;
  onRenameWorkspaceAlias: (workspace: WorkspaceInfo) => void;
  workspaceGroups?: WorkspaceGroupConfig[];
  onAssignWorkspaceGroup?: (
    workspaceId: string,
    groupId: string | null,
  ) => void | Promise<unknown>;
  onLoadOlderThreads: (workspaceId: string) => void;
  onReloadWorkspaceThreads: (workspaceId: string) => Promise<void> | void;
  onQuickReloadWorkspaceThreads?: (workspaceId: string) => Promise<void> | void;
  onRequestRootSessionFolderDraft?: (workspaceId: string) => void;
  workspaceDropTargetRef: RefObject<HTMLElement | null>;
  isWorkspaceDropActive: boolean;
  workspaceDropText: string;
  onWorkspaceDragOver: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragEnter: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDragLeave: (event: React.DragEvent<HTMLElement>) => void;
  onWorkspaceDrop: (event: React.DragEvent<HTMLElement>) => void;
  appMode: AppMode;
  onAppModeChange: (mode: AppMode) => void;
  onOpenHomeChat: () => void;
  onLockPanel?: () => void;
  onOpenProjectMemory: () => void;
  onOpenReleaseNotes: () => void;
  onOpenSpecHub: () => void;
  onOpenWorkspaceHome: (workspaceId?: string) => void;
  onOpenGlobalSearch: () => void;
  /** non-macOS 主导航 Quick Switcher（Ctrl+E）；mac 用 titlebar */
  onOpenQuickSwitcher?: () => void;
  /** non-macOS 设置菜单「隐藏对话侧边栏」；mac 用 titlebar */
  onCollapseSidebar?: () => void;
  globalSearchShortcut: string | null;
  openChatShortcut: string | null;
  openSettingsShortcut?: string | null;
  isExitedSessionsHidden?: (workspacePath: string) => boolean;
  onToggleExitedSessionsHidden?: (workspacePath: string) => void;
  rootSessionFolderDraftRequestByWorkspaceId?: Record<string, number>;
  showLoadingProgressDialog?: LoadingProgressController["showLoadingProgressDialog"];
  hideLoadingProgressDialog?: LoadingProgressController["hideLoadingProgressDialog"];
  topbarNode?: ReactNode;
  runtimeNoticeDockNode?: ReactNode;
  /** 打开运行时提示（入口在设置二级菜单，不在侧栏底部外显） */
  onOpenRuntimeNotice?: () => void;
  showRuntimeNoticeMenuItem?: boolean;
  /** 运行时提示是否有失败（控制设置菜单/固定入口的对号↔叹号） */
  runtimeNoticeHasError?: boolean;
};
