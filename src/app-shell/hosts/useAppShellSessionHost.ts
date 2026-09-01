import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebugLog } from "../../features/debug/hooks/useDebugLog";
import { useLayoutController } from "../../features/app/hooks/useLayoutController";
import { useAppSettingsController } from "../../features/app/hooks/useAppSettingsController";
import { useUpdaterController } from "../../features/app/hooks/useUpdaterController";
import { useReleaseNotes } from "../../features/update/hooks/useReleaseNotes";
import { useErrorToasts } from "../../features/notifications/hooks/useErrorToasts";
import { useSettingsModalState } from "../../features/app/hooks/useSettingsModalState";
import { useLoadingProgressDialogState } from "../../features/app/hooks/useLoadingProgressDialogState";
import { useLiquidGlassEffect } from "../../features/app/hooks/useLiquidGlassEffect";
import { normalizeFsPath } from "../../utils/workspacePaths";
import type { AppMode } from "../../types";
import { useCodeCssVars } from "../../features/app/hooks/useCodeCssVars";
import { useWorkspaceSessionHost } from "../domains/useWorkspaceSessionHost";
import { useCreateSessionLoading } from "../sections/useCreateSessionLoading";
import type { AgentTaskScrollRequest } from "../../features/messages";
import { useAppShellComposerPrefsPersistence } from "../domains/useAppShellComposerPrefsPersistence";
import { useAppShellModelSettingsAction } from "../sections/useAppShellModelSettingsAction";
import { useAppShellEditorLayoutSection } from "../sections/useAppShellEditorLayoutSection";
import { useAppShellSearchPaletteSection } from "../sections/useAppShellSearchPaletteSection";
import { usePanelLockState } from "../sections/usePanelLockState";
import { useAppShellClaudeThinkingSection } from "../sections/useAppShellClaudeThinkingSection";
import { usePublishHostSlice } from "./appShellHostBus";

/** 刀 3：session / chrome / settings 冷-中频 Host。 */
export function useAppShellSessionHost() {

  const { t } = useTranslation();
  const handleOpenGitHistoryFromFileHistory = useCallback(() => {
    setAppMode("gitHistory");
  }, []);

  const {
    claudeThinkingVisible,
    handleResolvedClaudeThinkingVisibleChange,
  } = useAppShellClaudeThinkingSection();

  const {
    appSettings,
    setAppSettings,
    doctor,
    claudeDoctor,
    kimiDoctor,
    grokDoctor,
    opencodeDoctor,
    piDoctor,
    ompDoctor,
    qoderDoctor,
    appSettingsLoading,
    reduceTransparency,
    setReduceTransparency,
    windowTransparencyEnabled,
    setWindowTransparencyEnabled,
    windowOpacity,
    setWindowOpacity,
    scaleShortcutTitle,
    scaleShortcutText,
    queueSaveSettings,
    increaseUiScale,
    decreaseUiScale,
    resetUiScale,
  } = useAppSettingsController();
  useCodeCssVars(appSettings);
  const {
    activeEngineRef,
    persistClaudeCollaborationMode,
    persistComposerEnginePref,
  } = useAppShellComposerPrefsPersistence({
    appSettings,
    appSettingsLoading,
  });
  const {
    debugOpen,
    setDebugOpen,
    debugEntries,
    showDebugButton,
    addDebugEntry,
    handleCopyDebug,
    clearDebugEntries,
  } = useDebugLog();
  useLiquidGlassEffect({
    reduceTransparency,
    onDebug: addDebugEntry,
  });
  const [activeTab, setActiveTab] = useState<
    "projects" | "codex" | "spec" | "git" | "log"
  >("codex");
  const tabletTab = activeTab === "projects" ? "codex" : activeTab;
  const {
    workspaces,
    workspaceGroups,
    groupedWorkspaces,
    getWorkspaceGroupName,
    ungroupedLabel,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    addWorkspace,
    addWorkspaceFromPath,
    addCloneAgent,
    addWorktreeAgent,
    connectWorkspace,
    markWorkspaceConnected,
    updateWorkspaceSettings,
    updateWorkspaceCodexBin,
    createWorkspaceGroup,
    renameWorkspaceGroup,
    moveWorkspaceGroup,
    deleteWorkspaceGroup,
    assignWorkspaceGroup,
    removeWorkspace,
    removeWorktree,
    renameWorktree,
    renameWorktreeUpstream,
    deletingWorktreeIds,
    hasLoaded,
    refreshWorkspaces,
    homeOpen,
    homeWorkspaceDefaultId,
    homeWorkspaceSelectedId,
    setHomeOpen,
    workspacesById,
    workspacesByPath,
  } = useWorkspaceSessionHost({
    appSettings,
    appSettingsLoading,
    addDebugEntry,
    queueSaveSettings,
  });
  const {
    sidebarWidth,
    rightPanelWidth,
    setRightPanelWidth,
    onSidebarResizeStart,
    onRightPanelResizeStart,
    planPanelHeight,
    onPlanPanelResizeStart,
    terminalPanelHeight,
    onTerminalPanelResizeStart,
    debugPanelHeight,
    onDebugPanelResizeStart,
    isCompact,
    isTablet,
    isPhone,
    sidebarCollapsed,
    rightPanelCollapsed,
    collapseSidebar,
    expandSidebar,
    collapseRightPanel,
    expandRightPanel,
    terminalOpen,
    handleDebugClick,
    handleToggleTerminal,
    openTerminal,
    closeTerminal: closeTerminalPanel,
  } = useLayoutController({
    activeWorkspaceId,
    setActiveTab,
    setDebugOpen,
    toggleDebugPanelShortcut: appSettings.toggleDebugPanelShortcut,
    toggleTerminalShortcut: appSettings.toggleTerminalShortcut,
  });
  const [appMode, setAppMode] = useState<AppMode>("chat");
  const [agentTaskScrollRequest, setAgentTaskScrollRequest] =
    useState<AgentTaskScrollRequest | null>(null);
  const {
    activeEditorLineRange,
    appRootRef,
    editorSplitLayout,
    fileReferenceMode,
    gitHistoryPanelHeight,
    isEditorFileMaximized,
    liveEditPreviewEnabled,
    onGitHistoryPanelResizeStart,
    requestEditorOpenLayout,
    resetSoloSplitToHalf,
    setActiveEditorLineRange,
    setEditorSplitLayout,
    setFileReferenceMode,
    setIsEditorFileMaximized,
    setLiveEditPreviewEnabled,
  } = useAppShellEditorLayoutSection({
    collapseSidebar,
    setAppMode,
    setRightPanelWidth,
  });

  const {
    settingsOpen,
    settingsSection,
    settingsHighlightTarget,
    openSettings,
    closeSettings,
  } = useSettingsModalState();
  const {
    loadingProgressDialog,
    showLoadingProgressDialog,
    hideLoadingProgressDialog,
    dismissLoadingProgressDialog,
  } = useLoadingProgressDialogState();

  const runWithCreateSessionLoading = useCreateSessionLoading({
    hideLoadingProgressDialog,
    showLoadingProgressDialog,
    t,
  });

  const handleOpenModelSettings = useAppShellModelSettingsAction();

  const {
    globalSearchFilesByWorkspace, isSearchPaletteOpen, searchContentFilters,
    searchPaletteQuery, searchPaletteSelectedIndex, searchScope,
    setGlobalSearchFilesByWorkspace, setIsSearchPaletteOpen,
    setSearchContentFilters, setSearchPaletteQuery, setSearchPaletteSelectedIndex,
    setSearchScope,
  } = useAppShellSearchPaletteSection();
  const {
    isPanelLocked,
    handleLockPanel,
    handleUnlockPanel,
  } = usePanelLockState();
  const completionTrackerReadyRef = useRef(false);
  const completionTrackerBySessionRef = useRef<Record<string, any>>({});
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const {
    updaterState,
    startUpdate,
    checkForUpdates,
    dismissUpdate,
    handleTestNotificationSound,
  } = useUpdaterController({
    notificationSoundsEnabled: appSettings.notificationSoundsEnabled,
    notificationSoundId: appSettings.notificationSoundId,
    notificationSoundCustomPath: appSettings.notificationSoundCustomPath,
    onDebug: addDebugEntry,
  });
  const {
    isOpen: releaseNotesOpen,
    entries: releaseNotesEntries,
    activeIndex: releaseNotesActiveIndex,
    loading: releaseNotesLoading,
    error: releaseNotesError,
    openReleaseNotes,
    closeReleaseNotes,
    goToPrevious: showPreviousReleaseNotes,
    goToNext: showNextReleaseNotes,
    retryLoad: retryReleaseNotesLoad,
  } = useReleaseNotes({
    onDebug: addDebugEntry,
  });

  const { errorToasts, dismissErrorToast } = useErrorToasts();
  const normalizePath = useCallback(
    (path: string) => normalizeFsPath(path).trim(),
    [],
  );

  const session = {
    t,
    handleOpenGitHistoryFromFileHistory,
    claudeThinkingVisible,
    handleResolvedClaudeThinkingVisibleChange,
    appSettings,
    setAppSettings,
    doctor,
    claudeDoctor,
    kimiDoctor,
    grokDoctor,
    opencodeDoctor,
    piDoctor,
    ompDoctor,
    qoderDoctor,
    appSettingsLoading,
    reduceTransparency,
    setReduceTransparency,
    windowTransparencyEnabled,
    setWindowTransparencyEnabled,
    windowOpacity,
    setWindowOpacity,
    scaleShortcutTitle,
    scaleShortcutText,
    queueSaveSettings,
    increaseUiScale,
    decreaseUiScale,
    resetUiScale,
    activeEngineRef,
    persistClaudeCollaborationMode,
    persistComposerEnginePref,
    debugOpen,
    setDebugOpen,
    debugEntries,
    showDebugButton,
    addDebugEntry,
    handleCopyDebug,
    clearDebugEntries,
    activeTab,
    setActiveTab,
    tabletTab,
    workspaces,
    workspaceGroups,
    groupedWorkspaces,
    getWorkspaceGroupName,
    ungroupedLabel,
    activeWorkspace,
    activeWorkspaceId,
    setActiveWorkspaceId,
    addWorkspace,
    addWorkspaceFromPath,
    addCloneAgent,
    addWorktreeAgent,
    connectWorkspace,
    markWorkspaceConnected,
    updateWorkspaceSettings,
    updateWorkspaceCodexBin,
    createWorkspaceGroup,
    renameWorkspaceGroup,
    moveWorkspaceGroup,
    deleteWorkspaceGroup,
    assignWorkspaceGroup,
    removeWorkspace,
    removeWorktree,
    renameWorktree,
    renameWorktreeUpstream,
    deletingWorktreeIds,
    hasLoaded,
    refreshWorkspaces,
    homeOpen,
    homeWorkspaceDefaultId,
    homeWorkspaceSelectedId,
    setHomeOpen,
    workspacesById,
    workspacesByPath,
    sidebarWidth,
    rightPanelWidth,
    setRightPanelWidth,
    onSidebarResizeStart,
    onRightPanelResizeStart,
    planPanelHeight,
    onPlanPanelResizeStart,
    terminalPanelHeight,
    onTerminalPanelResizeStart,
    debugPanelHeight,
    onDebugPanelResizeStart,
    isCompact,
    isTablet,
    isPhone,
    sidebarCollapsed,
    rightPanelCollapsed,
    collapseSidebar,
    expandSidebar,
    collapseRightPanel,
    expandRightPanel,
    terminalOpen,
    handleDebugClick,
    handleToggleTerminal,
    openTerminal,
    closeTerminalPanel,
    appMode,
    setAppMode,
    agentTaskScrollRequest,
    setAgentTaskScrollRequest,
    activeEditorLineRange,
    appRootRef,
    editorSplitLayout,
    fileReferenceMode,
    gitHistoryPanelHeight,
    isEditorFileMaximized,
    liveEditPreviewEnabled,
    onGitHistoryPanelResizeStart,
    requestEditorOpenLayout,
    resetSoloSplitToHalf,
    setActiveEditorLineRange,
    setEditorSplitLayout,
    setFileReferenceMode,
    setIsEditorFileMaximized,
    setLiveEditPreviewEnabled,
    settingsOpen,
    settingsSection,
    settingsHighlightTarget,
    openSettings,
    closeSettings,
    loadingProgressDialog,
    showLoadingProgressDialog,
    hideLoadingProgressDialog,
    dismissLoadingProgressDialog,
    runWithCreateSessionLoading,
    handleOpenModelSettings,
    globalSearchFilesByWorkspace,
    isSearchPaletteOpen,
    searchContentFilters,
    searchPaletteQuery,
    searchPaletteSelectedIndex,
    searchScope,
    setGlobalSearchFilesByWorkspace,
    setIsSearchPaletteOpen,
    setSearchContentFilters,
    setSearchPaletteQuery,
    setSearchPaletteSelectedIndex,
    setSearchScope,
    isPanelLocked,
    handleLockPanel,
    handleUnlockPanel,
    completionTrackerReadyRef,
    completionTrackerBySessionRef,
    composerInputRef,
    updaterState,
    startUpdate,
    checkForUpdates,
    dismissUpdate,
    handleTestNotificationSound,
    releaseNotesOpen,
    releaseNotesEntries,
    releaseNotesActiveIndex,
    releaseNotesLoading,
    releaseNotesError,
    openReleaseNotes,
    closeReleaseNotes,
    showPreviousReleaseNotes,
    showNextReleaseNotes,
    retryReleaseNotesLoad,
    errorToasts,
    dismissErrorToast,
    normalizePath,
  };
  usePublishHostSlice("session", session);
  return session;
}
