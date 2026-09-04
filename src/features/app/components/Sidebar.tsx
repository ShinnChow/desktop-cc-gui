import type { ThreadSummary, WorkspaceInfo } from "../../../types";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { ThreadList } from "./ThreadList";
import { ThreadLoadingState } from "./ThreadLoadingState";
import { WorktreeSection } from "./WorktreeSection";
import { PinnedThreadList } from "./PinnedThreadList";
import { WorkspaceCard } from "./WorkspaceCard";
import type { WorkspaceRowPinnedAction } from "./WorkspaceCard";
import { WorkspaceGroup } from "./WorkspaceGroup";
import { WorkspaceSessionFolderTree } from "./WorkspaceSessionFolderTree";
import { WorkspaceSettingsDialog } from "./WorkspaceSettingsDialog";
import { SidebarFolderMovePicker } from "./SidebarFolderMovePicker";
import { SidebarSearchBox } from "./SidebarSearchBox";
import { SidebarSettingsMenu } from "./SidebarSettingsMenu";
import { SystemProxyDrawer } from "./SystemProxyDrawer";
import { SidebarTopbarSlot } from "./SidebarTopbarSlot";
import { SidebarVersionTag } from "./SidebarVersionTag";
import { SidebarWorkspaceDropOverlay } from "./SidebarWorkspaceDropOverlay";
import { SidebarWorkspaceMenuOverlay } from "./SidebarWorkspaceMenuOverlay";
import {
  SidebarWorkspaceSortableList,
  type SidebarWorkspaceDragChrome,
} from "./SidebarWorkspaceSortableList";
import { ProviderContinuationDialog } from "./ProviderContinuationDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RendererContextMenu } from "../../../components/ui/RendererContextMenu";
import { useCollapsedGroups } from "../hooks/useCollapsedGroups";
import { useExitedSessionVisibility } from "../hooks/useExitedSessionVisibility";
import {
  PINNABLE_WORKSPACE_ACTION_IDS,
  useSidebarWorkspacePinnedActions,
} from "../hooks/useSidebarWorkspacePinnedActions";
import { registerKeydownHandler } from "../hooks/keyboardDispatcher";
import { useSidebarMenus } from "../hooks/useSidebarMenus";
import { useSidebarScrollFade } from "../hooks/useSidebarScrollFade";
import { useThreadRows } from "../hooks/useThreadRows";
import {
  formatShortcutForPlatform,
  formatShortcutLabelOrNull,
  isMacPlatform,
} from "../../../utils/shortcuts";
import { isMacPlatform as isMacDesktopHost } from "../../../utils/platform";
import { formatRelativeTimeShort } from "../../../utils/time";
import { EngineIcon } from "../../engine/components/EngineIcon";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";
import { SharedSessionIcon } from "../../shared-session/components/SharedSessionIcon";
import { pushErrorToast } from "../../../services/toasts";
import {
  EMPTY_SESSION_FOLDERS,
  updateCollapsedSessionFolderIdsForWorkspace,
  writePersistedCollapsedSessionFolderIds,
} from "./sidebarInternals";
import ChevronsDownUp from "lucide-react/dist/esm/icons/chevrons-down-up";
import Settings from "lucide-react/dist/esm/icons/settings";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import Eye from "lucide-react/dist/esm/icons/eye";
import EyeOff from "lucide-react/dist/esm/icons/eye-off";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import GalleryVerticalEnd from "lucide-react/dist/esm/icons/gallery-vertical-end";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import House from "lucide-react/dist/esm/icons/house";
import Blocks from "lucide-react/dist/esm/icons/blocks";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Store from "lucide-react/dist/esm/icons/store";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import {
  getWorkspaceSidebarAlias,
  getWorkspaceSidebarLabel,
} from "../utils/workspaceSidebarLabel";
import {
  normalizeGlobalVisibleThreadRootCount,
  planThreadListPageAdvance,
  resolveVisibleThreadRootLimit,
  resolveVisibleThreadRootPageSize,
} from "../constants";
import type { SidebarProps } from "./sidebarTypes";
import {
  collectDefaultWorkspaceEntries,
  collectNamedWorkspaceGroups,
  collectUngroupedWorkspaceEntries,
  filterOutDefaultWorkspaceEntries,
  filterWorkspaceGroupSections,
  isWorkspaceSearchMatch,
} from "./sidebarSearch";
import { useSidebarProviderCatalogs } from "./useSidebarProviderCatalogs";
import { useSidebarThreadProjections } from "./useSidebarThreadProjections";
import { useSessionFolderActions } from "./useSessionFolderActions";
import { useSidebarCollapseAll } from "./useSidebarCollapseAll";
/** 与 useAppShellQuickSwitcherSection 硬编码 shortcut 一致 */
const QUICK_SWITCHER_SHORTCUT = "cmd+e";

function SidebarImpl({
  workspaces,
  groupedWorkspaces,
  hasWorkspaceGroups: _hasWorkspaceGroups,
  deletingWorktreeIds,
  threadsByWorkspace,
  activeItems,
  threadParentById,
  threadStatusById,
  hydratedThreadListWorkspaceIds,
  runningSessionCountByWorkspaceId: _runningSessionCountByWorkspaceId = {},
  recentSessionCountByWorkspaceId: _recentSessionCountByWorkspaceId = {},
  threadListLoadingByWorkspace,
  threadListPagingByWorkspace,
  threadListCursorByWorkspace,
  activeWorkspaceId,
  activeThreadId,
  systemProxyEnabled = false,
  systemProxyUrl = null,
  onUpdateSystemProxy = async () => undefined,
  showProviderLabels = false,
  defaultVisibleThreadRootCount,
  onChangeDefaultVisibleThreadRootCount,
  accountInfo: _accountInfo,
  onSwitchAccount: _onSwitchAccount,
  onCancelSwitchAccount: _onCancelSwitchAccount,
  accountSwitching: _accountSwitching,
  onOpenSettings,
  onOpenSessionManagement,
  onOpenDebug: _onOpenDebug,
  showTerminalButton: _showTerminalButton,
  isTerminalOpen: _isTerminalOpen,
  onToggleTerminal: _onToggleTerminal,
  onAddWorkspace,
  onSelectHome: _onSelectHome,
  onSelectWorkspace,
  onReorderWorkspaces,
  onConnectWorkspace,
  onAddAgent,
  engineOptions = [],
  onRefreshEngineOptions,
  onAddSharedAgent,
  onAddWorktreeAgent,
  onAddCloneAgent: _onAddCloneAgent,
  onOpenClaudeTui,
  onToggleWorkspaceCollapse,
  onSelectThread,
  onProviderContinuationTargetReady,
  onDeleteThread,
  onArchiveThread,
  deleteConfirmThreadId = null,
  deleteConfirmWorkspaceId = null,
  deleteConfirmBusy = false,
  onCancelDeleteConfirm,
  onConfirmDeleteConfirm,
  renameThreadId = null,
  renameWorkspaceId = null,
  renameName = "",
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
  onDeleteWorkspace,
  onDeleteWorktree,
  onRenameWorkspaceAlias,
  workspaceGroups = [],
  onAssignWorkspaceGroup,
  onLoadOlderThreads,
  onReloadWorkspaceThreads,
  onQuickReloadWorkspaceThreads,
  onRequestRootSessionFolderDraft,
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
  onOpenSpecHub,
  onOpenWorkspaceHome,
  onOpenGlobalSearch,
  onOpenQuickSwitcher,
  onCollapseSidebar,
  globalSearchShortcut,
  openChatShortcut,
  openSettingsShortcut,
  isExitedSessionsHidden: controlledIsExitedSessionsHidden,
  onToggleExitedSessionsHidden: controlledToggleExitedSessionsHidden,
  rootSessionFolderDraftRequestByWorkspaceId:
    controlledRootSessionFolderDraftRequestByWorkspaceId,
  showLoadingProgressDialog,
  hideLoadingProgressDialog,
  topbarNode,
  runtimeNoticeDockNode = null,
  onOpenRuntimeNotice,
  showRuntimeNoticeMenuItem = false,
  runtimeNoticeHasError = false,
}: SidebarProps) {
  const { t } = useTranslation();
  const quickSearchLabel = t("sidebar.quickSearch");
  const quickSwitcherLabel = t("quickSwitcher.open");
  const isMac = isMacPlatform();
  // mac titlebar 已有搜索 / Quick Switcher / 收起侧栏；Win 与 non-Tauri 走主导航与设置菜单
  const showWinChromeEntries = !isMacDesktopHost();
  const showPrimaryNavQuickSwitcher =
    showWinChromeEntries && Boolean(onOpenQuickSwitcher);
  const showHideThreadsSidebar =
    showWinChromeEntries && Boolean(onCollapseSidebar);
  const quickChatShortcutLabel = useMemo(
    () => formatShortcutForPlatform(openChatShortcut, isMac),
    [isMac, openChatShortcut],
  );
  const quickSwitcherShortcutLabel = useMemo(
    () => formatShortcutForPlatform(QUICK_SWITCHER_SHORTCUT, isMac),
    [isMac],
  );
  const quickSearchShortcutLabel = useMemo(
    () => formatShortcutForPlatform(globalSearchShortcut, isMac),
    [globalSearchShortcut, isMac],
  );
  const openSettingsShortcutLabel = useMemo(
    () => formatShortcutLabelOrNull(openSettingsShortcut, isMac),
    [openSettingsShortcut, isMac],
  );

  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const resolvedDefaultVisibleThreadRootCount =
    normalizeGlobalVisibleThreadRootCount(defaultVisibleThreadRootCount);
  const [threadListPageByWorkspace, setThreadListPageByWorkspace] = useState<
    Record<string, number>
  >({});
  const [collapsedWorktreeSections, setCollapsedWorktreeSections] = useState<
    Set<string>
  >(() => new Set());
  const internalExitedSessionVisibility = useExitedSessionVisibility();
  const isExitedSessionsHidden =
    controlledIsExitedSessionsHidden ??
    internalExitedSessionVisibility.isExitedSessionsHidden;
  const toggleExitedSessionsHidden =
    controlledToggleExitedSessionsHidden ??
    internalExitedSessionVisibility.toggleExitedSessionsHidden;
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isSearchOpen] = useState(false);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [isSystemProxyDrawerOpen, setIsSystemProxyDrawerOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const { collapsedGroups, toggleGroupCollapse, replaceCollapsedGroups } =
    useCollapsedGroups();
  const { getThreadRows } = useThreadRows(threadParentById);
  const {
    claudeProviderProfiles,
    codexProviderProfiles,
    kimiProviderProfiles,
    grokProviderProfiles,
    openCodeProviderProfiles,
  } = useSidebarProviderCatalogs();
  const normalizedQuery = debouncedQuery.trim().toLowerCase();
  const isWorkspaceMatch = useCallback(
    (workspace: WorkspaceInfo) =>
      isWorkspaceSearchMatch(workspace, normalizedQuery),
    [normalizedQuery],
  );
  const filteredGroupedWorkspaces = useMemo(
    () => filterWorkspaceGroupSections(groupedWorkspaces, isWorkspaceMatch),
    [groupedWorkspaces, isWorkspaceMatch],
  );
  const defaultWorkspaceEntries = useMemo(
    () => collectDefaultWorkspaceEntries(filteredGroupedWorkspaces),
    [filteredGroupedWorkspaces],
  );
  const filteredGroupedWorkspacesWithoutDefault = useMemo(
    () => filterOutDefaultWorkspaceEntries(filteredGroupedWorkspaces),
    [filteredGroupedWorkspaces],
  );
  const ungroupedWorkspaceEntries = useMemo(
    () =>
      collectUngroupedWorkspaceEntries(filteredGroupedWorkspacesWithoutDefault),
    [filteredGroupedWorkspacesWithoutDefault],
  );
  const namedGroupedWorkspaces = useMemo(
    () =>
      collectNamedWorkspaceGroups(filteredGroupedWorkspacesWithoutDefault),
    [filteredGroupedWorkspacesWithoutDefault],
  );
  const isSearchActive = Boolean(normalizedQuery);
  const {
    getProjectedThreads,
    shouldShowExitedSessionsToggle,
    pinnedThreadRows,
    threadRowsByWorkspace,
  } = useSidebarThreadProjections({
    activeItems,
    threadsByWorkspace,
    activeWorkspaceId,
    activeThreadId,
    workspaces,
    pinnedThreadsVersion,
    isThreadPinned,
    getPinTimestamp,
    getThreadRows,
    isWorkspaceMatch,
    filteredGroupedWorkspaces,
    collapsedGroups,
    threadListPageByWorkspace,
    resolvedDefaultVisibleThreadRootCount,
    isExitedSessionsHidden,
    threadStatusById,
  });
  const {
    sessionFoldersByWorkspaceId,
    sessionFolderErrorByWorkspaceId,
    collapsedSessionFolderIdsByWorkspaceId,
    setCollapsedSessionFolderIdsByWorkspaceId,
    localRootSessionFolderDraftRequestByWorkspaceId,
    folderMovePicker,
    folderMovePickerQuery,
    setFolderMovePickerQuery,
    filteredFolderMoveTargets,
    handleOpenRootSessionFolderDraft,
    assignNewSessionToFolder,
    moveThreadSubtreeToFolder,
    openThreadFolderMovePicker,
    closeFolderMovePicker,
    selectFolderMoveTarget,
    handleCreateSessionFolder,
    handleRenameSessionFolder,
    handleDeleteSessionFolder,
    handleToggleSessionFolderCollapsed,
    moveFolderTargetsByWorkspaceId,
    getWorkspaceSessionFolderProjection,
  } = useSessionFolderActions({
    getProjectedThreads,
    threadParentById,
    threadsByWorkspace,
    filteredGroupedWorkspaces,
    onQuickReloadWorkspaceThreads,
    onToggleWorkspaceCollapse,
    onRequestRootSessionFolderDraft,
    showLoadingProgressDialog,
    hideLoadingProgressDialog,
  });
  // 项目行外显的快捷动作：由「...」菜单勾选决定，事件驱动同步。
  const { pinnedIds: pinnedRowActionIds } = useSidebarWorkspacePinnedActions();
  const buildWorkspaceRowPinnedActions = useCallback(
    (
      entry: WorkspaceInfo,
      hideExitedSessions: boolean,
    ): WorkspaceRowPinnedAction[] => {
      if (pinnedRowActionIds.length === 0) {
        return [];
      }
      const byId: Record<
        (typeof PINNABLE_WORKSPACE_ACTION_IDS)[number],
        WorkspaceRowPinnedAction
      > = {
        "activate-workspace": {
          id: "activate-workspace",
          label: t("sidebar.activateWorkspace"),
          icon: <ArrowRight size={16} aria-hidden />,
          onSelect: () => onSelectWorkspace(entry.id),
        },
        "reload-threads": {
          id: "reload-threads",
          label: t("threads.reloadThreads"),
          icon: <RefreshCw size={16} aria-hidden />,
          onSelect: () =>
            (onQuickReloadWorkspaceThreads ?? onReloadWorkspaceThreads)(
              entry.id,
            ),
        },
        "toggle-exited-sessions": {
          id: "toggle-exited-sessions",
          label: hideExitedSessions
            ? t("threads.showExitedSessions")
            : t("threads.hideExitedSessions"),
          icon: hideExitedSessions ? (
            <EyeOff size={16} aria-hidden />
          ) : (
            <Eye size={16} aria-hidden />
          ),
          active: hideExitedSessions,
          className: "workspace-exited-toggle",
          onSelect: () => toggleExitedSessionsHidden(entry.path),
        },
        "create-session-folder": {
          id: "create-session-folder",
          label: t("sidebar.newSessionFolder"),
          icon: <FolderTree size={16} aria-hidden />,
          onSelect: () => handleOpenRootSessionFolderDraft(entry.id),
        },
      };
      return PINNABLE_WORKSPACE_ACTION_IDS.filter((id) =>
        pinnedRowActionIds.includes(id),
      ).map((id) => byId[id]);
    },
    [
      pinnedRowActionIds,
      t,
      onSelectWorkspace,
      onQuickReloadWorkspaceThreads,
      onReloadWorkspaceThreads,
      toggleExitedSessionsHidden,
      handleOpenRootSessionFolderDraft,
    ],
  );
  const {
    showThreadMenu,
    showPinScopeMenu,
    showWorkspaceMenu,
    showWorkspaceSessionMenu,
    showWorktreeMenu,
    workspaceMenuState,
    sidebarContextMenuState,
    providerContinuationDialogState,
    closeWorkspaceMenu,
    closeSidebarContextMenu,
    closeProviderContinuationDialog,
    confirmProviderContinuation,
    onWorkspaceMenuAction,
  } = useSidebarMenus({
    onAddAgent,
    claudeProviderProfiles,
    codexProviderProfiles,
    kimiProviderProfiles,
    grokProviderProfiles,
    opencodeProviderProfiles: openCodeProviderProfiles,
    engineOptions,
    onRefreshEngineOptions,
    onAddSharedAgent,
    onAssignNewSessionToFolder: assignNewSessionToFolder,
    onDeleteThread,
    onArchiveThread,
    onOpenSessionManagement,
    onSyncThread,
    onPinThread: pinThread,
    onUnpinThread: unpinThread,
    isThreadPinned,
    isThreadAutoNaming,
    onRenameThread,
    onAutoNameThread,
    onMoveThreadToFolder: async (workspaceId, threadId, folderId) => {
      try {
        await moveThreadSubtreeToFolder(workspaceId, threadId, folderId);
      } catch (error: unknown) {
        pushErrorToast({
          title: t("sidebar.sessionFolderMoveFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    onOpenThreadFolderPicker: openThreadFolderMovePicker,
    onOpenClaudeTui,
    onReloadWorkspaceThreads:
      onQuickReloadWorkspaceThreads ?? onReloadWorkspaceThreads,
    threadListLoadingByWorkspace,
    onSelectThread,
    onProviderContinuationTargetReady,
    isThreadAvailable: (workspaceId, threadId) =>
      getProjectedThreads(workspaceId).some((thread) => thread.id === threadId),
    getThreadSummary: (workspaceId, threadId) =>
      getProjectedThreads(workspaceId).find((thread) => thread.id === threadId),
    onActivateWorkspace: onSelectWorkspace,
    onCreateSessionFolder: handleOpenRootSessionFolderDraft,
    onToggleExitedSessions: toggleExitedSessionsHidden,
    shouldShowExitedSessionsToggle,
    isExitedSessionsHidden,
    onDeleteWorkspace,
    onDeleteWorktree,
    onRenameWorkspaceAlias,
    workspaceGroups,
    onAssignWorkspaceGroup,
    onAddWorktreeAgent,
  });

  useEffect(() => {
    if (!workspaceMenuState) {
      return;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeWorkspaceMenu();
      }
    };
    return registerKeydownHandler(handleWindowKeyDown);
  }, [workspaceMenuState, closeWorkspaceMenu]);

  const renderWorkspaceMenuIcon = useCallback((iconKind: string) => {
    switch (iconKind) {
      case "engine-claude":
        return <EngineIcon engine="claude" size={14} />;
      case "engine-codex":
        return <EngineIcon engine="codex" size={14} />;
      case "engine-opencode":
        return <EngineIcon engine="opencode" size={14} />;
      case "engine-gemini":
        return <EngineIcon engine="gemini" size={14} />;
      case "engine-kimi":
        return <EngineIcon engine="kimi" size={14} />;
      case "engine-grok":
        return <EngineIcon engine="grok" size={14} />;
      case "engine-pi":
        return <EngineIcon engine="pi" size={14} />;
      case "engine-omp":
        return <EngineIcon engine="omp" size={14} />;
      case "engine-dsh":
        return <EngineIcon engine="dsh" size={14} />;
      case "engine-qoder":
        return <EngineIcon engine="qoder" size={14} />;
      case "reload":
        return <RefreshCw size={13} />;
      case "activate":
        return <ArrowRight size={13} />;
      case "exited-sessions-hidden":
        return <EyeOff size={13} />;
      case "exited-sessions-visible":
        return <Eye size={13} />;
      case "new-folder":
        return <FolderTree size={13} />;
      case "new-shared":
        return <SharedSessionIcon size={13} />;
      case "alias":
        return <Pencil size={13} />;
      case "assign-group":
        return <LayoutGrid size={13} />;
      case "remove":
        return <Trash2 size={13} />;
      case "new-worktree":
        return <GitBranch size={13} />;
      default:
        return null;
    }
  }, []);

  const renderHighlightedName = useCallback(
    (name: string) => {
      if (!normalizedQuery) {
        return name;
      }
      const lower = name.toLowerCase();
      const parts: React.ReactNode[] = [];
      let cursor = 0;
      let matchIndex = lower.indexOf(normalizedQuery, cursor);

      while (matchIndex !== -1) {
        if (matchIndex > cursor) {
          parts.push(name.slice(cursor, matchIndex));
        }
        parts.push(
          <span
            key={`${matchIndex}-${cursor}`}
            className="workspace-name-match"
          >
            {name.slice(matchIndex, matchIndex + normalizedQuery.length)}
          </span>,
        );
        cursor = matchIndex + normalizedQuery.length;
        matchIndex = lower.indexOf(normalizedQuery, cursor);
      }

      if (cursor < name.length) {
        parts.push(name.slice(cursor));
      }

      return parts.length ? parts : name;
    },
    [normalizedQuery],
  );

  const { sidebarBodyRef, scrollFade, updateScrollFade } = useSidebarScrollFade(
    groupedWorkspaces,
    threadsByWorkspace,
    threadListPageByWorkspace,
    normalizedQuery,
  );

  const worktreesByParent = useMemo(() => {
    const worktrees = new Map<string, WorkspaceInfo[]>();
    workspaces
      .filter(
        (entry) => (entry.kind ?? "main") === "worktree" && entry.parentId,
      )
      .forEach((entry) => {
        const parentId = entry.parentId as string;
        const list = worktrees.get(parentId) ?? [];
        list.push(entry);
        worktrees.set(parentId, list);
      });
    worktrees.forEach((entries) => {
      entries.sort((a, b) => a.name.localeCompare(b.name));
    });
    return worktrees;
  }, [workspaces]);

  const hasRunningThreadByWorkspaceId = useMemo(() => {
    const next = new Map<string, boolean>();
    Object.entries(threadsByWorkspace).forEach(([workspaceId, threads]) => {
      next.set(
        workspaceId,
        threads.some((thread) =>
          Boolean(threadStatusById[thread.id]?.isProcessing),
        ),
      );
    });
    return next;
  }, [threadStatusById, threadsByWorkspace]);

  const hasRunningSessionByProjectId = useMemo(() => {
    const next = new Map<string, boolean>();
    workspaces
      .filter((entry) => (entry.kind ?? "main") !== "worktree")
      .forEach((entry) => {
        const hasRunningThreadOnWorkspace =
          hasRunningThreadByWorkspaceId.get(entry.id) ?? false;
        const hasRunningThreadOnWorktree = (
          worktreesByParent.get(entry.id) ?? []
        ).some(
          (worktree) => hasRunningThreadByWorkspaceId.get(worktree.id) ?? false,
        );
        next.set(
          entry.id,
          hasRunningThreadOnWorkspace || hasRunningThreadOnWorktree,
        );
      });
    return next;
  }, [hasRunningThreadByWorkspaceId, workspaces, worktreesByParent]);

  const handleShowMoreThreads = useCallback(
    (workspaceId: string) => {
      const workspace =
        workspaces.find((entry) => entry.id === workspaceId) ?? null;
      const pageSize = resolveVisibleThreadRootPageSize(
        workspace?.settings.visibleThreadRootCount,
        resolvedDefaultVisibleThreadRootCount,
      );
      const currentPage = Math.max(
        1,
        threadListPageByWorkspace[workspaceId] ?? 1,
      );
      const currentLimit = resolveVisibleThreadRootLimit(
        pageSize,
        currentPage,
        resolvedDefaultVisibleThreadRootCount,
      );
      const isWorktree = (workspace?.kind ?? "main") === "worktree";
      const threads = isWorktree
        ? (threadsByWorkspace[workspaceId] ?? [])
        : getProjectedThreads(workspaceId);
      const { totalRoots } = getThreadRows(
        threads,
        false,
        workspaceId,
        getPinTimestamp,
        currentLimit,
      );
      const plan = planThreadListPageAdvance({
        totalRoots,
        currentLimit,
        nextCursor: threadListCursorByWorkspace[workspaceId],
        isPaging: threadListPagingByWorkspace[workspaceId] ?? false,
      });
      if (!plan.advance) {
        return;
      }
      setThreadListPageByWorkspace((prev) => ({
        ...prev,
        [workspaceId]: currentPage + 1,
      }));
      if (plan.fetch) {
        onLoadOlderThreads(workspaceId);
      }
    },
    [
      getPinTimestamp,
      getProjectedThreads,
      getThreadRows,
      onLoadOlderThreads,
      resolvedDefaultVisibleThreadRootCount,
      threadListCursorByWorkspace,
      threadListPageByWorkspace,
      threadListPagingByWorkspace,
      threadsByWorkspace,
      workspaces,
    ],
  );

  const handleCollapseThreadList = useCallback((workspaceId: string) => {
    setThreadListPageByWorkspace((prev) => {
      if ((prev[workspaceId] ?? 1) <= 1) {
        return prev;
      }
      return { ...prev, [workspaceId]: 1 };
    });
  }, []);

  const handleToggleWorktreeSection = useCallback((workspaceId: string) => {
    setCollapsedWorktreeSections((previous) => {
      const next = new Set(previous);
      if (next.has(workspaceId)) {
        next.delete(workspaceId);
      } else {
        next.add(workspaceId);
      }
      return next;
    });
  }, []);

  const { isAllCollapsed, handleToggleCollapseAll } = useSidebarCollapseAll({
    workspaces,
    groupedWorkspaces,
    collapsedWorktreeSections,
    setCollapsedWorktreeSections,
    collapsedGroups,
    replaceCollapsedGroups,
    onToggleWorkspaceCollapse,
  });

  const getThreadTime = useCallback((thread: ThreadSummary) => {
    const timestamp = thread.updatedAt ?? null;
    return timestamp ? formatRelativeTimeShort(timestamp) : null;
  }, []);

  useEffect(() => {
    if (!isSettingsMenuOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        settingsMenuRef.current &&
        !settingsMenuRef.current.contains(target) &&
        settingsButtonRef.current &&
        !settingsButtonRef.current.contains(target)
      ) {
        setIsSettingsMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSettingsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isSettingsMenuOpen]);

  useEffect(() => {
    if (!isSystemProxyDrawerOpen) {
      return;
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsSystemProxyDrawerOpen(false);
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isSystemProxyDrawerOpen]);

  useEffect(() => {
    if (!isSearchOpen && searchQuery) {
      setSearchQuery("");
    }
  }, [isSearchOpen, searchQuery]);

  useEffect(() => {
    if (debouncedQuery === searchQuery) {
      return;
    }
    const handle = window.setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 150);
    return () => window.clearTimeout(handle);
  }, [debouncedQuery, searchQuery]);

  const handleToggleThreadPin = useCallback(
    (workspaceId: string, threadId: string) => {
      // 两作用域互斥：已置顶（全局或项目内）→ 取消当前作用域；未置顶 → 兜底全局置顶
      // （未置顶的正常入口是 onShowPinScopeMenu 的 2 选菜单，此分支仅兜底）。
      if (
        isThreadPinned(workspaceId, threadId) ||
        isThreadPinned(workspaceId, threadId, "workspace")
      ) {
        unpinThread(workspaceId, threadId);
        return;
      }
      pinThread(workspaceId, threadId);
    },
    [isThreadPinned, pinThread, unpinThread],
  );

  const handleOpenSessionFolderSessionMenu = useCallback(
    (event: ReactMouseEvent, workspaceId: string, folderId: string) => {
      const workspace = workspaces.find((entry) => entry.id === workspaceId);
      if (!workspace) {
        return;
      }
      onToggleWorkspaceCollapse(workspaceId, false);
      setCollapsedSessionFolderIdsByWorkspaceId((current) => {
        const nextIds = (current[workspaceId] ?? []).filter(
          (id) => id !== folderId,
        );
        if (nextIds.length === (current[workspaceId] ?? []).length) {
          return current;
        }
        const next = updateCollapsedSessionFolderIdsForWorkspace(
          current,
          workspaceId,
          nextIds,
        );
        writePersistedCollapsedSessionFolderIds(next);
        return next;
      });
      showWorkspaceSessionMenu(event, workspace, { targetFolderId: folderId });
    },
    [
      onToggleWorkspaceCollapse,
      setCollapsedSessionFolderIdsByWorkspaceId,
      showWorkspaceSessionMenu,
      workspaces,
    ],
  );

  const renderWorkspaceEntry = useCallback(
    (entry: WorkspaceInfo, drag: SidebarWorkspaceDragChrome | null = null) => {
      const threads = threadsByWorkspace[entry.id] ?? [];
      const isCollapsed = entry.settings.sidebarCollapsed;
      const threadListPage = Math.max(
        1,
        threadListPageByWorkspace[entry.id] ?? 1,
      );
      const isExpanded = threadListPage > 1;
      const threadRows = threadRowsByWorkspace.get(entry.id);
      const unpinnedRows = threadRows?.unpinnedRows ?? [];
      const workspacePinnedRows = threadRows?.workspacePinnedRows ?? [];
      const totalThreadRoots = threadRows?.totalRoots ?? 0;
      const nextCursor = threadListCursorByWorkspace[entry.id] ?? null;
      const isThreadListHydrated = hydratedThreadListWorkspaceIds.has(entry.id);
      const isPaging = threadListPagingByWorkspace[entry.id] ?? false;
      const worktrees = worktreesByParent.get(entry.id) ?? [];
      // First-paint / cold start: prefer snapshot or last-good threads immediately.
      // Only spin when the workspace is connected, has nothing to show yet, and has
      // not finished its first hydration. Masking cached sessions behind "加载中…"
      // made the whole sidebar look frozen while orchestrator work ran, and
      // disconnected workspaces never hydrate so they spun forever.
      const hasCachedThreadList = threads.length > 0 || Boolean(nextCursor);
      // Connected + no cache + not hydrated: show 加载中 while first-paint runs.
      // Hydration must actually start without a click (see thread-list hydration).
      const showThreadLoadingState =
        !isThreadListHydrated &&
        worktrees.length === 0 &&
        !hasCachedThreadList &&
        entry.connected;
      const showThreadList = !showThreadLoadingState && hasCachedThreadList;
      const isWorktreeSectionCollapsed = collapsedWorktreeSections.has(
        entry.id,
      );
      const hasPrimaryActiveThread =
        entry.id === activeWorkspaceId && Boolean(activeThreadId);
      const hasRunningSession =
        hasRunningSessionByProjectId.get(entry.id) ?? false;
      const workspaceSidebarAlias = getWorkspaceSidebarAlias(entry);
      const visibleThreadRootCount = resolveVisibleThreadRootLimit(
        entry.settings.visibleThreadRootCount,
        threadListPage,
        resolvedDefaultVisibleThreadRootCount,
      );
      const hideExitedSessions = isExitedSessionsHidden(entry.path);
      const sessionFolders =
        sessionFoldersByWorkspaceId[entry.id] ?? EMPTY_SESSION_FOLDERS;
      const collapsedSessionFolderIds = new Set(
        collapsedSessionFolderIdsByWorkspaceId[entry.id] ?? [],
      );
      const rootFolderDraftRequestKey =
        (localRootSessionFolderDraftRequestByWorkspaceId[entry.id] ?? 0) +
        (controlledRootSessionFolderDraftRequestByWorkspaceId?.[entry.id] ?? 0);
      const { folderMoveTargets, folderProjection } =
        getWorkspaceSessionFolderProjection(entry.id, unpinnedRows);
      const hasVisibleFolderTree =
        sessionFolders.length > 0 || folderProjection.rootRows.length > 0;
      const hasRootFolderDraftRequest = rootFolderDraftRequestKey > 0;
      const showFolderProjection =
        (showThreadList || hasRootFolderDraftRequest) &&
        (hasVisibleFolderTree || hasRootFolderDraftRequest);
      return (
        <WorkspaceCard
          key={entry.id}
          workspace={entry}
          workspaceName={renderHighlightedName(getWorkspaceSidebarLabel(entry))}
          workspaceAliasOriginalName={workspaceSidebarAlias ? entry.name : null}
          isActive={entry.id === activeWorkspaceId}
          hasPrimaryActiveThread={hasPrimaryActiveThread}
          hasRunningSession={hasRunningSession}
          isCollapsed={isCollapsed}
          onShowWorkspaceMenu={showWorkspaceMenu}
          onOpenWorkspaceHome={onOpenWorkspaceHome}
          onSelectWorkspace={onSelectWorkspace}
          onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
          pinnedRowActions={buildWorkspaceRowPinnedActions(
            entry,
            hideExitedSessions,
          )}
          isDragging={drag?.isDragging ?? false}
          collapsePointerHandlers={drag?.collapsePointerHandlers ?? null}
        >
          {worktrees.length > 0 && (
            <WorktreeSection
              parentWorkspaceId={entry.id}
              worktrees={worktrees}
              isSectionCollapsed={isWorktreeSectionCollapsed}
              onToggleSectionCollapse={handleToggleWorktreeSection}
              deletingWorktreeIds={deletingWorktreeIds}
              threadsByWorkspace={threadsByWorkspace}
              threadStatusById={threadStatusById}
              threadListLoadingByWorkspace={threadListLoadingByWorkspace}
              threadListPagingByWorkspace={threadListPagingByWorkspace}
              threadListCursorByWorkspace={threadListCursorByWorkspace}
              threadListPageByWorkspace={threadListPageByWorkspace}
              activeWorkspaceId={activeWorkspaceId}
              activeThreadId={activeThreadId}
              systemProxyEnabled={systemProxyEnabled}
              systemProxyUrl={systemProxyUrl}
              showProviderLabels={showProviderLabels}
              defaultVisibleThreadRootCount={
                resolvedDefaultVisibleThreadRootCount
              }
              moveFolderTargetsByWorkspaceId={moveFolderTargetsByWorkspaceId}
              getThreadRows={getThreadRows}
              getThreadTime={getThreadTime}
              isThreadPinned={isThreadPinned}
              isThreadAutoNaming={isThreadAutoNaming}
              onToggleThreadPin={handleToggleThreadPin}
              onShowPinScopeMenu={showPinScopeMenu}
              getPinTimestamp={getPinTimestamp}
              onConnectWorkspace={onConnectWorkspace}
              onShowWorktreeSessionMenu={showWorkspaceSessionMenu}
              onQuickReloadWorkspaceThreads={onQuickReloadWorkspaceThreads}
              onSelectWorkspace={onSelectWorkspace}
              onToggleWorkspaceCollapse={onToggleWorkspaceCollapse}
              isExitedSessionsHidden={isExitedSessionsHidden}
              onToggleExitedSessionsHidden={toggleExitedSessionsHidden}
              onSelectThread={onSelectThread}
              onShowThreadMenu={showThreadMenu}
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
              onShowWorktreeMenu={showWorktreeMenu}
              onToggleExpanded={handleCollapseThreadList}
              onLoadOlderThreads={handleShowMoreThreads}
            />
          )}
          {showFolderProjection ? (
            <WorkspaceSessionFolderTree
              workspaceId={entry.id}
              workspacePath={entry.path}
              folders={folderProjection.folders}
              rootRows={folderProjection.rootRows}
              workspacePinnedRows={workspacePinnedRows}
              totalThreadRoots={totalThreadRoots}
              isExpanded={isExpanded}
              rootDraftRequestKey={rootFolderDraftRequestKey}
              moveFolderTargets={folderMoveTargets}
              collapsedFolderIds={collapsedSessionFolderIds}
              onNewFolder={handleCreateSessionFolder}
              onRenameFolder={handleRenameSessionFolder}
              onDeleteFolder={handleDeleteSessionFolder}
              onToggleFolderCollapsed={handleToggleSessionFolderCollapsed}
              onNewSessionInFolder={handleOpenSessionFolderSessionMenu}
              threadListProps={{
                visibleThreadRootCount,
                hideExitedSessions,
                activeWorkspaceId,
                activeThreadId,
                systemProxyEnabled,
                systemProxyUrl,
                showProviderLabels,
                threadStatusById,
                getThreadTime,
                isThreadPinned,
                isThreadAutoNaming,
                onToggleThreadPin: handleToggleThreadPin,
                onShowPinScopeMenu: showPinScopeMenu,
                onToggleExpanded: handleCollapseThreadList,
                onLoadOlderThreads: handleShowMoreThreads,
                onSelectThread,
                onShowThreadMenu: showThreadMenu,
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
                nextCursor,
                isPaging,
                showPagingControls: true,
              }}
            />
          ) : null}
          {showThreadList && !showFolderProjection ? (
            <ThreadList
              workspaceId={entry.id}
              workspacePath={entry.path}
              pinnedRows={workspacePinnedRows}
              unpinnedRows={unpinnedRows}
              totalThreadRoots={totalThreadRoots}
              visibleThreadRootCount={visibleThreadRootCount}
              isExpanded={isExpanded}
              nextCursor={nextCursor}
              isPaging={isPaging}
              moveFolderTargets={folderMoveTargets}
              hideExitedSessions={hideExitedSessions}
              activeWorkspaceId={activeWorkspaceId}
              activeThreadId={activeThreadId}
              systemProxyEnabled={systemProxyEnabled}
              systemProxyUrl={systemProxyUrl}
              showProviderLabels={showProviderLabels}
              threadStatusById={threadStatusById}
              getThreadTime={getThreadTime}
              isThreadPinned={isThreadPinned}
              isThreadAutoNaming={isThreadAutoNaming}
              onToggleThreadPin={handleToggleThreadPin}
              onShowPinScopeMenu={showPinScopeMenu}
              onToggleExpanded={handleCollapseThreadList}
              onLoadOlderThreads={handleShowMoreThreads}
              onSelectThread={onSelectThread}
              onShowThreadMenu={showThreadMenu}
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
            />
          ) : null}
          {sessionFolderErrorByWorkspaceId[entry.id] ? (
            <div className="workspace-session-folder-error">
              {t("sidebar.sessionFolderLoadFailed")}
            </div>
          ) : null}
          {showThreadLoadingState ? <ThreadLoadingState /> : null}
        </WorkspaceCard>
      );
    },
    [
      activeThreadId,
      activeWorkspaceId,
      collapsedWorktreeSections,
      collapsedSessionFolderIdsByWorkspaceId,
      deleteConfirmBusy,
      deleteConfirmThreadId,
      deleteConfirmWorkspaceId,
      renameName,
      renameThreadId,
      renameWorkspaceId,
      onRenameCancel,
      onRenameChange,
      onRenameConfirm,
      deletingWorktreeIds,
      threadListPageByWorkspace,
      getPinTimestamp,
      getThreadRows,
      getThreadTime,
      handleToggleThreadPin,
      handleShowMoreThreads,
      handleCollapseThreadList,
      handleToggleWorktreeSection,
      handleCreateSessionFolder,
      handleOpenSessionFolderSessionMenu,
      handleRenameSessionFolder,
      handleDeleteSessionFolder,
      handleToggleSessionFolderCollapsed,
      getWorkspaceSessionFolderProjection,
      buildWorkspaceRowPinnedActions,
      isThreadAutoNaming,
      isThreadPinned,
      hasRunningSessionByProjectId,
      onQuickReloadWorkspaceThreads,
      onCancelDeleteConfirm,
      onConfirmDeleteConfirm,
      onConnectWorkspace,
      onOpenWorkspaceHome,
      onSelectWorkspace,
      onSelectThread,
      showThreadMenu,
      showPinScopeMenu,
      showWorkspaceSessionMenu,
      showWorkspaceMenu,
      showWorktreeMenu,
      systemProxyEnabled,
      systemProxyUrl,
      showProviderLabels,
      resolvedDefaultVisibleThreadRootCount,
      onToggleWorkspaceCollapse,
      renderHighlightedName,
      hydratedThreadListWorkspaceIds,
      isExitedSessionsHidden,
      moveFolderTargetsByWorkspaceId,
      sessionFolderErrorByWorkspaceId,
      sessionFoldersByWorkspaceId,
      localRootSessionFolderDraftRequestByWorkspaceId,
      controlledRootSessionFolderDraftRequestByWorkspaceId,
      t,
      threadListCursorByWorkspace,
      threadListPagingByWorkspace,
      threadRowsByWorkspace,
      threadStatusById,
      threadsByWorkspace,
      toggleExitedSessionsHidden,
      worktreesByParent,
      threadListLoadingByWorkspace,
    ],
  );

  const isWorkspaceReorderDisabled = isSearchActive || !onReorderWorkspaces;

  const handleReorderUngrouped = useCallback(
    (orderedWorkspaceIds: string[]) => {
      void onReorderWorkspaces?.({
        groupId: null,
        orderedWorkspaceIds,
      });
    },
    [onReorderWorkspaces],
  );

  const handleReorderNamedGroup = useCallback(
    (groupId: string, orderedWorkspaceIds: string[]) => {
      void onReorderWorkspaces?.({
        groupId,
        orderedWorkspaceIds,
      });
    },
    [onReorderWorkspaces],
  );

  return (
    <aside
      className={`sidebar${isSearchOpen ? " search-open" : ""}`}
      ref={workspaceDropTargetRef}
      onDragOver={onWorkspaceDragOver}
      onDragEnter={onWorkspaceDragEnter}
      onDragLeave={onWorkspaceDragLeave}
      onDrop={onWorkspaceDrop}
    >
      <SidebarTopbarSlot topbarNode={topbarNode} />
      <SidebarSearchBox
        isOpen={isSearchOpen}
        query={searchQuery}
        t={t}
        onQueryChange={setSearchQuery}
        onClear={() => setSearchQuery("")}
      />
      <SidebarWorkspaceDropOverlay
        isActive={isWorkspaceDropActive}
        text={workspaceDropText}
        t={t}
      />
      <div className="sidebar-body">
        <div className="sidebar-body-layout">
          <nav
            className="sidebar-primary-nav"
            aria-label={t("tabbar.primaryNavigation")}
          >
            <button
              type="button"
              className={`sidebar-primary-nav-item sidebar-primary-nav-mode-item ${appMode === "chat" ? "is-active" : ""}`}
              onClick={onOpenHomeChat}
              title={`${t("sidebar.quickNewThread")} (${quickChatShortcutLabel})`}
              aria-label={t("sidebar.quickNewThread")}
              data-tauri-drag-region="false"
            >
              <House
                className="sidebar-primary-nav-icon"
                aria-hidden
                size={20}
                strokeWidth={1.8}
              />
              <span className="sidebar-primary-nav-text">
                {t("sidebar.quickNewThread")}
              </span>
            </button>
            <button
              type="button"
              className="sidebar-primary-nav-item sidebar-primary-nav-subitem is-disabled"
              title={t("sidebar.plugins")}
              aria-label={t("sidebar.plugins")}
              data-tauri-drag-region="false"
              disabled
            >
              <Store
                className="sidebar-primary-nav-icon"
                aria-hidden
                size={20}
                strokeWidth={1.8}
              />
              <span className="sidebar-primary-nav-text">
                {t("sidebar.plugins")}
              </span>
            </button>
            <button
              type="button"
              className={`sidebar-primary-nav-item sidebar-primary-nav-subitem ${appMode === "extensions" ? "is-active" : ""}`}
              onClick={() => onAppModeChange("extensions")}
              title={t("sidebar.extensions")}
              aria-label={t("sidebar.extensions")}
              data-tauri-drag-region="false"
            >
              <Blocks
                className="sidebar-primary-nav-icon"
                aria-hidden
                size={20}
                strokeWidth={1.8}
              />
              <span className="sidebar-primary-nav-text">
                {t("sidebar.extensions")}
              </span>
            </button>
            {showWinChromeEntries ? (
              <button
                type="button"
                className="sidebar-primary-nav-item sidebar-primary-nav-subitem"
                onClick={onOpenGlobalSearch}
                title={`${quickSearchLabel} (${quickSearchShortcutLabel})`}
                aria-label={quickSearchLabel}
                data-tauri-drag-region="false"
              >
                <svg
                  className="sidebar-primary-nav-icon"
                  aria-hidden
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M17.2888 17.2899L13.7734 13.7745"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9.19094 15.67C12.7697 15.67 15.6709 12.7688 15.6709 9.18996C15.6709 5.61116 12.7697 2.70996 9.19094 2.70996C5.61213 2.70996 2.71094 5.61116 2.71094 9.18996C2.71094 12.7688 5.61213 15.67 9.19094 15.67Z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="sidebar-primary-nav-text">
                  {quickSearchLabel}
                </span>
                <span className="sidebar-primary-nav-shortcut" aria-hidden>
                  {quickSearchShortcutLabel}
                </span>
              </button>
            ) : null}
            {showPrimaryNavQuickSwitcher ? (
              <button
                type="button"
                className="sidebar-primary-nav-item sidebar-primary-nav-subitem"
                onClick={onOpenQuickSwitcher}
                title={`${quickSwitcherLabel} (${quickSwitcherShortcutLabel})`}
                aria-label={quickSwitcherLabel}
                data-tauri-drag-region="false"
              >
                <GalleryVerticalEnd
                  className="sidebar-primary-nav-icon"
                  aria-hidden
                  size={20}
                  strokeWidth={1.8}
                />
                <span className="sidebar-primary-nav-text">
                  {quickSwitcherLabel}
                </span>
                <span className="sidebar-primary-nav-shortcut" aria-hidden>
                  {quickSwitcherShortcutLabel}
                </span>
              </button>
            ) : null}
          </nav>
          <ScrollArea
            className={`sidebar-content-column${scrollFade.top ? " fade-top" : ""}${
              scrollFade.bottom ? " fade-bottom" : ""
            }`}
            onViewportScroll={updateScrollFade}
            viewportRef={sidebarBodyRef}
          >
            {pinnedThreadRows.length > 0 && (
              <PinnedThreadList
                rows={pinnedThreadRows}
                activeWorkspaceId={activeWorkspaceId}
                activeThreadId={activeThreadId}
                systemProxyEnabled={systemProxyEnabled}
                systemProxyUrl={systemProxyUrl}
                showProviderLabels={showProviderLabels}
                threadStatusById={threadStatusById}
                moveFolderTargetsByWorkspaceId={moveFolderTargetsByWorkspaceId}
                getThreadTime={getThreadTime}
                isThreadPinned={isThreadPinned}
                isThreadAutoNaming={isThreadAutoNaming}
                onToggleThreadPin={handleToggleThreadPin}
                onSelectThread={onSelectThread}
                onShowThreadMenu={showThreadMenu}
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
              />
            )}
            <div className="sidebar-section-header">
              <div className="sidebar-section-title">
                {t("sidebar.projects")}
              </div>
              <button
                className="sidebar-title-add sidebar-title-toggle-all"
                onClick={handleToggleCollapseAll}
                data-tauri-drag-region="false"
                aria-label={
                  isAllCollapsed
                    ? t("sidebar.expandAllSections")
                    : t("sidebar.collapseAllSections")
                }
                type="button"
                title={
                  isAllCollapsed
                    ? t("sidebar.expandAllSections")
                    : t("sidebar.collapseAllSections")
                }
              >
                <ChevronsDownUp size={14} aria-hidden />
              </button>
              <TooltipIconButton
                className="sidebar-title-add"
                onClick={onAddWorkspace}
                data-tauri-drag-region="false"
                label={t("sidebar.addWorkspace")}
              >
                <span
                  className="codicon codicon-new-folder"
                  aria-hidden
                  style={{ fontSize: "16px" }}
                />
              </TooltipIconButton>
              <TooltipIconButton
                className="sidebar-title-add"
                onClick={() => setWorkspaceSettingsOpen(true)}
                data-tauri-drag-region="false"
                data-testid="workspace-settings-button"
                label={t("sidebar.workspaceSettings")}
              >
                <Settings size={14} aria-hidden />
              </TooltipIconButton>
            </div>
            <div className="workspace-list">
              {defaultWorkspaceEntries.map((entry) =>
                renderWorkspaceEntry(entry),
              )}
              {ungroupedWorkspaceEntries.length > 0 ? (
                <SidebarWorkspaceSortableList
                  groupId={null}
                  workspaces={ungroupedWorkspaceEntries}
                  isDragDisabled={isWorkspaceReorderDisabled}
                  onReorder={handleReorderUngrouped}
                  renderWorkspace={renderWorkspaceEntry}
                />
              ) : null}
              {namedGroupedWorkspaces.map((group) => {
                const toggleId = group.id;
                const isGroupCollapsed = Boolean(
                  toggleId && collapsedGroups.has(toggleId),
                );
                const visibleWorkspaces = isGroupCollapsed
                  ? []
                  : group.workspaces;

                return (
                  <WorkspaceGroup
                    key={group.id}
                    toggleId={toggleId}
                    name={group.name}
                    showHeader
                    isCollapsed={isGroupCollapsed}
                    onToggleCollapse={toggleGroupCollapse}
                  >
                    {visibleWorkspaces.length > 0 ? (
                      <SidebarWorkspaceSortableList
                        groupId={group.id}
                        workspaces={visibleWorkspaces}
                        isDragDisabled={isWorkspaceReorderDisabled}
                        onReorder={(orderedWorkspaceIds) =>
                          handleReorderNamedGroup(group.id, orderedWorkspaceIds)
                        }
                        renderWorkspace={renderWorkspaceEntry}
                      />
                    ) : null}
                  </WorkspaceGroup>
                );
              })}
              {!namedGroupedWorkspaces.length &&
                ungroupedWorkspaceEntries.length === 0 &&
                defaultWorkspaceEntries.length === 0 && (
                  <div className="empty">
                    {isSearchActive
                      ? t("sidebar.noProjectsMatch")
                      : t("sidebar.addWorkspaceToStart")}
                  </div>
                )}
            </div>
          </ScrollArea>
          <div className="sidebar-bottom-nav">
            <SidebarSettingsMenu
              isOpen={isSettingsMenuOpen}
              appMode={appMode}
              menuRef={settingsMenuRef}
              buttonRef={settingsButtonRef}
              t={t}
              onToggleOpen={() => setIsSettingsMenuOpen((prev) => !prev)}
              onClose={() => setIsSettingsMenuOpen(false)}
              onLockPanel={onLockPanel}
              onOpenSpecHub={onOpenSpecHub}
              onOpenProjectMemory={onOpenProjectMemory}
              onOpenSettings={onOpenSettings}
              onToggleSystemProxy={() =>
                setIsSystemProxyDrawerOpen((open) => !open)
              }
              systemProxyDrawerOpen={isSystemProxyDrawerOpen}
              onAppModeChange={onAppModeChange}
              onOpenRuntimeNotice={onOpenRuntimeNotice}
              showRuntimeNotice={showRuntimeNoticeMenuItem}
              runtimeNoticeHasError={runtimeNoticeHasError}
              showHideThreadsSidebar={showHideThreadsSidebar}
              onCollapseSidebar={onCollapseSidebar}
              openSettingsShortcutLabel={openSettingsShortcutLabel}
            />
            {/* 锚点保留在侧栏底部供展开面板定位；外显气泡入口已收入设置二级菜单 */}
            {runtimeNoticeDockNode}
            <SidebarVersionTag t={t} onOpenReleaseNotes={onOpenReleaseNotes} />
          </div>
        </div>
      </div>
      {isSystemProxyDrawerOpen ? (
        <SystemProxyDrawer
          systemProxyEnabled={systemProxyEnabled}
          systemProxyUrl={systemProxyUrl}
          onUpdateSystemProxy={onUpdateSystemProxy}
          onClose={() => setIsSystemProxyDrawerOpen(false)}
          t={t}
        />
      ) : null}
      {folderMovePicker ? (
        <SidebarFolderMovePicker
          picker={folderMovePicker}
          query={folderMovePickerQuery}
          targets={filteredFolderMoveTargets}
          t={t}
          onQueryChange={setFolderMovePickerQuery}
          onClose={closeFolderMovePicker}
          onSelectTarget={(target) => void selectFolderMoveTarget(target)}
        />
      ) : null}
      {workspaceMenuState ? (
        <SidebarWorkspaceMenuOverlay
          menu={workspaceMenuState}
          t={t}
          onClose={closeWorkspaceMenu}
          onAction={onWorkspaceMenuAction}
          renderIcon={renderWorkspaceMenuIcon}
        />
      ) : null}
      {sidebarContextMenuState ? (
        <RendererContextMenu
          menu={sidebarContextMenuState}
          onClose={closeSidebarContextMenu}
          className="renderer-context-menu sidebar-renderer-context-menu"
        />
      ) : null}
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        defaultVisibleThreadRootCount={resolvedDefaultVisibleThreadRootCount}
        onOpenChange={setWorkspaceSettingsOpen}
        onSaveDefaultVisibleThreadRootCount={async (count) => {
          await onChangeDefaultVisibleThreadRootCount?.(count);
        }}
      />
      <ProviderContinuationDialog
        state={providerContinuationDialogState}
        onCancel={closeProviderContinuationDialog}
        onConfirm={confirmProviderContinuation}
      />
    </aside>
  );
}

export const Sidebar = memo(SidebarImpl);
Sidebar.displayName = "Sidebar";
