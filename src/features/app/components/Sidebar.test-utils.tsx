import { createRef } from "react";
import type React from "react";
import { vi } from "vitest";
import {
  writeClientStoreData,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY } from "../hooks/useSidebarSettingsPinnedActions";
import {
  assignWorkspaceSessionFolder,
  assignWorkspaceSessionFolders,
  createWorkspaceSessionFolder,
  deleteWorkspaceSessionFolder,
  getClaudeProviders,
  getCodexProviders,
  getKimiProviders,
  getOpenCodeProviders,
  listWorkspaceSessionFolders,
  renameWorkspaceSessionFolder,
} from "../../../services/tauri";

vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: () => {} },
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "sidebar.addWorkspace": "Add workspace",
        "sidebar.workspaceSettings": "Workspace settings",
        "sidebar.workspaceSettingsTitle": "Workspace settings",
        "sidebar.workspaceSettingsDescription":
          "These preferences apply to every project.",
        "sidebar.workspaceSettingsVisibleCountLabel":
          "Default visible sessions",
        "sidebar.workspaceSettingsVisibleCountHint":
          "Default {{defaultCount}}, range {{min}}-{{max}}.",
        "common.cancel": "Cancel",
        "common.delete": "Delete",
        "sidebar.sessionActionsGroup": "New Session",
        "sidebar.newSharedSession": "Shared CLI",
        "sidebar.newSessionInFolder": "New session in project",
        "sidebar.workspaceActionsGroup": "Workspace actions",
        "sidebar.toggleSearch": "Toggle search",
        "sidebar.searchProjects": "Search projects",
        "sidebar.activateWorkspace": "Open in main panel",
        "sidebar.setWorkspaceAlias": "Set alias",
        "sidebar.workspaceAliasPrompt": "Alias prompt",
        "sidebar.workspaceAliasBadge": "A",
        "sidebar.workspaceAliasBadgeTitle": "Workspace alias. Original name: service",
        "sidebar.emptyWorkspaceSessions": "No sessions yet.",
        "sidebar.loadingWorkspaceSessions": "Loading…",
        "sidebar.loadingWorkspaceSessionsIndex": "Reading session index…",
        "sidebar.loadingWorkspaceSessionsDeep": "Deep-scanning local sessions…",
        "sidebar.newSessionFolder": "New folder",
        "sidebar.newSessionFolderIn": "New folder in project",
        "sidebar.renameSessionFolder": "Rename folder",
        "sidebar.deleteSessionFolder": "Delete folder",
        "sidebar.sessionFolderActions": "Folder actions",
        "sidebar.collapseSessionFolder": "Collapse folder",
        "sidebar.expandSessionFolder": "Expand folder",
        "sidebar.sessionFolderContextMenuPrompt": "Type an action",
        "sidebar.sessionFolderNamePrompt": "Folder name",
        "sidebar.sessionFolderRenamePrompt": "Rename folder",
        "sidebar.sessionFolderDeleteTitle": "Delete folder",
        "sidebar.sessionFolderDeleteMessage": "Delete folder message",
        "sidebar.sessionFolderDeleteHint": "Clear non-empty folders first.",
        "sidebar.sessionFolderCreateFailed": "Could not create folder",
        "sidebar.sessionFolderRenameFailed": "Could not rename folder",
        "sidebar.sessionFolderDeleteFailed": "Could not delete folder",
        "sidebar.sessionFolderMoveFailed": "Could not move session",
        "sidebar.loadingProgressMoveSessionTitle": "Moving session...",
        "sidebar.loadingProgressMoveSessionMessage": "Moving this session to {{folder}}.",
        "sidebar.sessionFolderCrossProjectBlocked": "Sessions cannot be moved across projects.",
        "sidebar.sessionFolderCount": "session count",
        "sidebar.sessionFolderLoadFailed": "Session folders unavailable.",
        "sidebar.quickNewThread": "Home",
        "sidebar.quickSearch": "Search",
        "quickSwitcher.open": "Quick Switcher",
        "sidebar.hideThreadsSidebar": "Hide conversation sidebar",
        "sidebar.quickSkills": "Skills",
        "sidebar.plugins": "Market",
        "sidebar.extensions": "Extensions",
        "lockScreen.lock": "Lock",
        "sidebar.projects": "Projects",
        "sidebar.mcpSkillsMarket": "MCP & Skills Market",
        "sidebar.longTermMemory": "Long-term Memory",
        "sidebar.pluginMarket": "Plugin Market",
        "sidebar.specHub": "Spec Hub",
        "sidebar.openHome": "Open home",
        "panels.memory": "Project Memory",
        "common.terminal": "Terminal",
        "common.refresh": "Refresh",
        "common.toggleTerminalPanel": "Toggle terminal panel",
        "common.showBesideSettings": "Show next to settings",
        "common.showBesideSettingsLimit": "You can pin up to 4 items. Uncheck one first.",
        "git.logMode": "Git",
        "git.historyQuickAction": "Git Graph",
        "sidebar.releaseNotes": "Release Notes",
        "sidebar.comingSoon": "Coming soon",
        "sidebar.comingSoonMessage": "This feature is coming soon",
        "sidebar.threadsSection": "Threads",
        "threads.degradedWorkspaceRefreshAriaLabel": "Refresh incomplete thread list",
        "threads.degradedWorkspaceRefreshTooltip":
          "This project's thread list is not fully refreshed yet and may be missing some conversations. Click to refresh it again.",
        "threads.hideExitedSessions": "Hide exited sessions",
        "threads.showExitedSessions": "Show exited sessions",
        "threads.exitedSessionsHidden": "{{count}} exited hidden",
        "threads.subagentTreeExpanded": "Subagent tree expanded",
        "threads.subagentTreeExpand": "Expand subagent tree",
        "threads.subagentTreeCollapse": "Collapse subagent tree",
        "threads.moveToFolder": "Move to folder",
        "threads.moveToProjectRoot": "Project root",
        "threads.searchFolderTargets": "Search folders...",
        "threads.more": "More...",
        "threads.loading": "Loading...",
        "threads.searchOlder": "Search older...",
        "threads.loadOlder": "Load older...",
        "workspace.engineClaudeCode": "Claude Code",
        "workspace.engineCodex": "Codex",
        "workspace.engineOpenCode": "OpenCode",
        "workspace.engineGemini": "Gemini",
        "workspace.engineKimi": "Kimi CLI",
        "workspace.engineGrok": "Grok CLI",
        "providers.localConfig": "本地配置",
        "sidebar.cliNotInstalled": "CLI not installed",
        "settings.title": "Settings",
        "settings.behaviorProxyTitle": "Network Proxy",
        "settings.behaviorProxyEnabled": "Enable proxy",
        "settings.behaviorProxyAddress": "Proxy address",
        "settings.behaviorProxyAddressPlaceholder": "http://127.0.0.1:7890",
        "settings.behaviorProxySave": "Save proxy settings",
        "settings.behaviorProxyDesc": "Use this proxy for network requests.",
        "settings.behaviorProxyHint": "Supports http(s) and socks5.",
        "settings.behaviorProxyRequired": "A proxy address is required.",
        "settings.behaviorProxySaved": "Proxy settings saved.",
        "settings.behaviorProxyEnabledSuccess": "Proxy enabled.",
        "settings.behaviorProxyDisabledSuccess": "Proxy disabled.",
        "runtimeNotice.title": "Runtime Notice",
        "tabbar.primaryNavigation": "Primary navigation",
      };
      return translations[key] ?? key;
    },
    i18n: {
      language: "en",
      changeLanguage: vi.fn(),
    },
  }),
}));

vi.mock("../../../services/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/tauri")>();
  return {
    ...actual,
    assignWorkspaceSessionFolder: vi.fn(),
    assignWorkspaceSessionFolders: vi.fn(),
    createWorkspaceSessionFolder: vi.fn(),
    deleteWorkspaceSessionFolder: vi.fn(),
    getClaudeProviders: vi.fn(),
    getCodexProviders: vi.fn(),
    getKimiProviders: vi.fn(),
    getOpenCodeProviders: vi.fn(),
    listWorkspaceSessionFolders: vi.fn(),
    renameWorkspaceSessionFolder: vi.fn(),
  };
});

vi.mock("../../../services/toasts", () => ({
  pushErrorToast: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ scaleFactor: () => 1 }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalPosition: class LogicalPosition {
    x: number;
    y: number;
    constructor(x: number, y: number) {
      this.x = x;
      this.y = y;
    }
  },
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({
    children,
    viewportRef,
    onViewportScroll,
    className,
  }: {
    children: React.ReactNode;
    viewportRef?: React.Ref<HTMLDivElement>;
    onViewportScroll?: React.UIEventHandler<HTMLDivElement>;
    className?: string;
  }) => (
    <div className={className} onScroll={onViewportScroll} ref={viewportRef}>
      {children}
    </div>
  ),
  ScrollBar: () => null,
}));

export function resetSidebarTestMocks() {
  vi.clearAllMocks();
  writeClientStoreData("threads", {});
  writeClientStoreData("layout", {});
  writeClientStoreValue("app", SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY, []);
  vi.mocked(listWorkspaceSessionFolders).mockResolvedValue({
    workspaceId: "default",
    folders: [],
  });
  vi.mocked(assignWorkspaceSessionFolder).mockResolvedValue({
    sessionId: "default-session",
    folderId: null,
  });
  vi.mocked(assignWorkspaceSessionFolders).mockResolvedValue({
    results: [{ sessionId: "default-session", ok: true }],
  });
  vi.mocked(createWorkspaceSessionFolder).mockResolvedValue({
    folder: {
      id: "created-folder",
      workspaceId: "default",
      parentId: null,
      name: "Created",
      createdAt: 1,
      updatedAt: 1,
    },
  });
  vi.mocked(renameWorkspaceSessionFolder).mockResolvedValue({
    folder: {
      id: "renamed-folder",
      workspaceId: "default",
      parentId: null,
      name: "Renamed",
      createdAt: 1,
      updatedAt: 2,
    },
  });
  vi.mocked(deleteWorkspaceSessionFolder).mockResolvedValue(undefined);
  vi.mocked(getClaudeProviders).mockResolvedValue([]);
  vi.mocked(getCodexProviders).mockResolvedValue([]);
  vi.mocked(getKimiProviders).mockResolvedValue([]);
  vi.mocked(getOpenCodeProviders).mockResolvedValue([]);
}

export const baseProps = {
  workspaces: [],
  groupedWorkspaces: [],
  hasWorkspaceGroups: false,
  deletingWorktreeIds: new Set<string>(),
  threadsByWorkspace: {},
  activeItems: [],
  threadParentById: {},
  threadStatusById: {},
  hydratedThreadListWorkspaceIds: new Set<string>(),
  threadListLoadingByWorkspace: {},
  threadListPagingByWorkspace: {},
  threadListCursorByWorkspace: {},
  activeWorkspaceId: null,
  activeThreadId: null,
  accountRateLimits: null,
  usageShowRemaining: false,
  accountInfo: null,
  onSwitchAccount: vi.fn(),
  onCancelSwitchAccount: vi.fn(),
  accountSwitching: false,
  onOpenSettings: vi.fn(),
  onOpenDebug: vi.fn(),
  showDebugButton: false,
  onAddWorkspace: vi.fn(),
  onSelectHome: vi.fn(),
  onSelectWorkspace: vi.fn(),
  onConnectWorkspace: vi.fn(),
  onAddAgent: vi.fn(),
  onAddWorktreeAgent: vi.fn(),
  onAddCloneAgent: vi.fn(),
  onToggleWorkspaceCollapse: vi.fn(),
  onSelectThread: vi.fn(),
  onDeleteThread: vi.fn(),
  onArchiveThread: vi.fn(),
  onSyncThread: vi.fn(),
  pinThread: vi.fn(() => false),
  unpinThread: vi.fn(),
  isThreadPinned: vi.fn(() => false),
  isThreadAutoNaming: vi.fn(() => false),
  getPinTimestamp: vi.fn(() => null),
  pinnedThreadsVersion: 0,
  onRenameThread: vi.fn(),
  onAutoNameThread: vi.fn(),
  onDeleteWorkspace: vi.fn(),
  onDeleteWorktree: vi.fn(),
  onRenameWorkspaceAlias: vi.fn(),
  onLoadOlderThreads: vi.fn(),
  onReloadWorkspaceThreads: vi.fn(),
  onQuickReloadWorkspaceThreads: vi.fn(),
  workspaceDropTargetRef: createRef<HTMLElement>(),
  isWorkspaceDropActive: false,
  workspaceDropText: "Drop Project Here",
  onWorkspaceDragOver: vi.fn(),
  onWorkspaceDragEnter: vi.fn(),
  onWorkspaceDragLeave: vi.fn(),
  onWorkspaceDrop: vi.fn(),
  appMode: "chat" as const,
  onAppModeChange: vi.fn(),
  onOpenHomeChat: vi.fn(),
  onOpenMemory: vi.fn(),
  onLockPanel: vi.fn(),
  onOpenProjectMemory: vi.fn(),
  onOpenReleaseNotes: vi.fn(),
  onOpenGlobalSearch: vi.fn(),
  globalSearchShortcut: "cmd+o",
  openChatShortcut: "cmd+j",
  onOpenSpecHub: vi.fn(),
  onOpenWorkspaceHome: vi.fn(),
};
