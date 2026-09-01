import { cloneElement, isValidElement, Suspense } from "react";
import type * as React from "react";
import { AppLayout } from "../../features/app/components/AppLayout";
import { AppModals } from "../../features/app/components/AppModals";
import { LockScreenOverlay } from "../../features/app/components/LockScreenOverlay";
import { RuntimeConsoleDock } from "../../features/app/components/RuntimeConsoleDock";
import { VendorModelManagerDialogHost } from "../../features/vendors/components/VendorModelManagerDialogHost";
import {
  GlobalSearchTitlebarButton,
  QuickSwitcherTitlebarButton,
  SidebarCollapseButton,
  TitlebarExpandControls,
} from "../../features/layout/components/SidebarToggleControls";
import {
  shouldShowFloatingTitlebarSidebarToggle,
  shouldShowMainTopbarSidebarToggle,
  shouldShowSidebarTopbarSidebarToggle,
} from "../../features/layout/utils/sidebarTogglePlacement";
import { formatShortcutForPlatform } from "../../utils/shortcuts";
import {
  mergeAppShellDomainBag,
  selectAppShellDomainBag,
  type DomainFlattenIdentityCache,
} from "../domains/selectAppShellDomainBag";
import { APP_SHELL_CONSUMER_DOMAIN_SELECTION } from "../domains/appShellDomainContexts";
import {
  ExtensionsView,
  GitHistoryPanel,
  QuickSwitcher,
  ReleaseNotesModal,
  SearchPalette,
  SpecHub,
} from "./lazyViews";
import type {
  RenderAppShellContext,
  RenderAppShellFlattenedContext,
} from "./renderAppShellTypes";

/** bag-split PR-2：render 读侧最小域（见 APP_SHELL_CONSUMER_DOMAIN_SELECTION） */
const RENDER_APP_SHELL_DOMAIN_NAMES = APP_SHELL_CONSUMER_DOMAIN_SELECTION.render;

/** AppShell 单例渲染路径：按 domain 身份复用 flatten bag */
const renderDomainFlattenCache: DomainFlattenIdentityCache = {
  domainValues: null,
  flattened: null,
};

export function injectSidebarTopbarNode(
  sidebarNode: React.ReactNode,
  topbarNode: React.ReactNode,
) {
  if (!topbarNode || !isValidElement(sidebarNode)) {
    return sidebarNode;
  }

  const sidebarProps = sidebarNode.props as { children?: React.ReactNode };
  if (isValidElement(sidebarProps.children)) {
    return cloneElement(
      sidebarNode as React.ReactElement<{ children?: React.ReactNode }>,
      {
        children: cloneElement(
          sidebarProps.children as React.ReactElement<{
            topbarNode?: React.ReactNode;
          }>,
          { topbarNode },
        ),
      },
    );
  }

  return cloneElement(
    sidebarNode as React.ReactElement<{ topbarNode?: React.ReactNode }>,
    { topbarNode },
  );
}

export function renderAppShell(ctx: RenderAppShellContext) {
  // T4.2：selected domain bag API（非 Legacy 命名）
  const domainBag = selectAppShellDomainBag(
    ctx.appShellDomainContexts,
    RENDER_APP_SHELL_DOMAIN_NAMES,
    renderDomainFlattenCache,
  );
  const legacyCtx = mergeAppShellDomainBag<RenderAppShellFlattenedContext>(
    domainBag,
    ctx.searchAndComposerSection as Record<string, unknown>,
    ctx.sections as Record<string, unknown>,
    ctx.layoutNodes as Record<string, unknown>,
    {
      isPullRequestComposer: ctx.isPullRequestComposer,
      isPullRequestComposerFromSections: ctx.isPullRequestComposerFromSections,
      sections: ctx.sections,
    },
  );
  const {
    GitHubPanelData,
    SettingsView,
    activeEngine,
    activeEditorFilePath,
    activeTab,
    activeThreadId,
    activeWorkspace,
    appClassName,
    appRootRef,
    appSettings,
    approvalToastsNode,
    assignWorkspaceGroup,
    cancelClonePrompt,
    cancelWorktreePrompt,
    centerMode,
    checkForUpdates,
    chooseCloneCopiesFolder,
    clearCloneCopiesFolder,
    clonePrompt,
    closeReleaseNotes,
    closeSearchPalette,
    closeQuickSwitcher,
    closeSettings,
    closeWorktreeCreateResult,
    dismissLoadingProgressDialog,
    codeAnnotationBridgeProps,
    compactEmptyCodexNode,
    compactEmptyGitNode,
    compactEmptySpecNode,
    compactGitBackNode,
    composerNode,
    confirmClonePrompt,
    confirmWorktreePrompt,
    createWorkspaceGroup,
    debugPanelFullNode,
    debugPanelHeight,
    debugPanelNode,
    deleteWorkspaceGroup,
    desktopTopbarLeftNode,
    diffSource,
    directories,
    doctor,
    claudeDoctor,
    kimiDoctor,
    grokDoctor,
    opencodeDoctor,
    piDoctor,
    ompDoctor,
    qoderDoctor,
    editorSplitCompanion,
    editorSplitLayout,
    errorToastsNode,
    fileViewPanelNode,
    noteCardsPanelNode,
    fileComparePanelNode,
    fileHistoryTabs,
    activeGitHistoryTabId,
    projectMapPanelNode,
    intentCanvasPanelNode,
    browserDockNode,
    files,
    gitDiffListView,
    gitDiffPanelNode,
    gitDiffViewerNode,
    gitHistoryPanelHeight,
    gitHistoryProjectWorkspace,
    gitHistoryRepositoryRoot,
    gitHistoryWorkspace,
    gitPanelMode,
    groupedWorkspaces,
    handleCloseGitHistoryPanel,
    handleActivateGitHistoryTab,
    handleCloseFileHistory,
    handleCloseOtherFileHistories,
    handleCloseAllFileHistories,
    handleDeleteWorkspaceConversationsInSettings,
    handleEnsureWorkspaceThreadsForSettings,
    handleGitIssuesChange,
    handleGitPullRequestCommentsChange,
    handleGitPullRequestDiffsChange,
    handleGitPullRequestsChange,
    handleMoveWorkspace,
    handleOpenMailSession,
    handleOpenSearchPalette,
    handleOpenQuickSwitcher,
    handleQuickSwitcherNavigate,
    handleQuickSwitcherSelectFile,
    handleQuickSwitcherSelectSession,
    handleSearchPaletteMoveSelection,
    handleSelectDiffForPanel,
    handleSelectSearchResult,
    handleSelectWorkspacePathForGitHistory,
    handleSelectRepositoryForGitHistory,
    handleTestNotificationSound,
    handleToggleSearchContentFilter,
    handleUnlockPanel,
    hasActivePlan,
    homeNode,
    globalRuntimeNoticeDockNode,
    isCompact,
    isEditorFileMaximized,
    isMacDesktop,
    isPanelLocked,
    isSearchPaletteOpen,
    isQuickSwitcherOpen,
    isSoloMode,
    lockLiveSessions,
    loadingProgressDialog,
    mainHeaderNode,
    messagesNode,
    moveWorkspaceGroup,
    onGitHistoryPanelResizeStart,
    onPlanPanelResizeStart,
    onRightPanelResizeStart,
    onSidebarResizeStart,
    openAppIconById,
    planPanelHeight,
    planPanelNode,
    queueSaveSettings,
    quickSwitcherSessionGroups,
    quickSwitcherRunningSessions,
    quickSwitcherActiveNavigationIds,
    reduceTransparency,
    windowTransparencyEnabled,
    windowOpacity,
    releaseNotesActiveIndex,
    releaseNotesEntries,
    releaseNotesError,
    releaseNotesLoading,
    releaseNotesOpen,
    removeWorkspace,
    renameWorkspaceGroup,
    retryReleaseNotesLoad,
    rightPanelCollapsed,
    rightPanelToolbarNode,
    rightPanelWidth,
    runtimeRunState,
    scaleShortcutText,
    scaleShortcutTitle,
    searchContentFilters,
    searchApiHydrationStatus,
    searchFileHydrationStatus,
    searchPaletteQuery,
    searchPaletteSelectedIndex,
    searchResults,
    searchScope,
    selectedPullRequest,
    setActiveTab,
    setAppSettings,
    setGitDiffListView,
    setReduceTransparency,
    setWindowTransparencyEnabled,
    setWindowOpacity,
    setSearchPaletteQuery,
    setSearchPaletteSelectedIndex,
    setSearchScope,
    selectGitHistoryWorkspace,
    settingsHighlightTarget,
    settingsOpen,
    settingsSection,
    shouldLoadDiffs,
    shouldLoadGitHubPanelData,
    shouldMountSpecHub,
    showGitDetail,
    showGitHistory,
    showExtensions,
    showHome,
    showNextReleaseNotes,
    showPreviousReleaseNotes,
    startUpdate,
    showSpecHub,
    showWorkspaceHome,
    sidebarCollapsed,
    sidebarNode,
    sidebarToggleProps,
    sidebarWidth,
    sessionRadarRecentCompletedSessions,
    tabBarNode,
    tabletNavNode,
    tabletTab,
    terminalDockNode,
    terminalPanelHeight,
    threadListLoadingByWorkspace,
    threadsByWorkspace,
    ungroupedLabel,
    updateCloneCopyName,
    updateToastNode,
    updaterState,
    updateWorkspaceCodexBin,
    updateWorkspaceSettings,
    updateWorktreeBaseRef,
    updateWorktreeBranch,
    updateWorktreePublishToOrigin,
    updateWorktreeSetupScript,
    useSuggestedCloneCopiesFolder,
    workspaceAliasPromptNode,
    workspaceGroups,
    workspaces,
    worktreeCreateResult,
    worktreePrompt,
  } = legacyCtx;

  const specHubNode = shouldMountSpecHub ? (
    <Suspense fallback={null}>
      <SpecHub
        workspaceId={activeWorkspace?.id ?? null}
        workspaceName={activeWorkspace?.name ?? null}
        files={files}
        directories={directories}
        onBackToChat={() => setActiveTab("codex")}
      />
    </Suspense>
  ) : null;

  const workspaceHomeNode = showWorkspaceHome ? homeNode : null;

  const workspacePrimaryNode = showWorkspaceHome
    ? workspaceHomeNode
    : messagesNode;

  const mainMessagesNode = shouldMountSpecHub ? (
    <div className="workspace-chat-stack">
      <div
        className={`workspace-chat-layer ${showSpecHub ? "is-hidden" : "is-active"}`}
      >
        {workspacePrimaryNode}
      </div>
      <div
        className={`workspace-spec-layer ${showSpecHub ? "is-active" : "is-hidden"}`}
      >
        {specHubNode}
      </div>
    </div>
  ) : (
    workspacePrimaryNode
  );

  const gitHistoryNode = showGitHistory ? (
    <Suspense fallback={null}>
      <GitHistoryPanel
        workspace={gitHistoryWorkspace ?? activeWorkspace}
        workspaces={workspaces}
        groupedWorkspaces={groupedWorkspaces}
        selectedProjectWorkspaceId={gitHistoryProjectWorkspace?.id ?? null}
        selectedRepositoryRoot={gitHistoryRepositoryRoot}
        onSelectRepository={handleSelectRepositoryForGitHistory}
        onSelectWorkspace={selectGitHistoryWorkspace}
        onSelectWorkspacePath={handleSelectWorkspacePathForGitHistory}
        onOpenDiffPath={handleSelectDiffForPanel}
        onRequestClose={handleCloseGitHistoryPanel}
        listView={gitDiffListView === "tree" ? "tree" : "flat"}
        onListViewChange={setGitDiffListView}
        fileHistoryTabs={fileHistoryTabs}
        activeTabId={activeGitHistoryTabId}
        onActivateTab={handleActivateGitHistoryTab}
        onCloseFileHistoryTab={handleCloseFileHistory}
        onCloseOtherFileHistoryTabs={handleCloseOtherFileHistories}
        onCloseAllFileHistoryTabs={handleCloseAllFileHistories}
        {...codeAnnotationBridgeProps}
      />
    </Suspense>
  ) : null;

  const showSidebarTopbarSidebarToggle = shouldShowSidebarTopbarSidebarToggle({
    isCompact,
    isMacDesktop,
    isSoloMode,
    sidebarCollapsed,
  });
  const showMainTopbarSidebarToggle = shouldShowMainTopbarSidebarToggle({
    isCompact,
    isMacDesktop,
    isSoloMode,
    sidebarCollapsed,
  });
  const showFloatingTitlebarSidebarToggle =
    shouldShowFloatingTitlebarSidebarToggle({
      showHome,
      showMainTopbarSidebarToggle,
    });

  const desktopTopbarLeftNodeWithToggle = showMainTopbarSidebarToggle ? (
    <div className="topbar-leading">
      <SidebarCollapseButton {...sidebarToggleProps} />
      {desktopTopbarLeftNode}
    </div>
  ) : (
    desktopTopbarLeftNode
  );
  const sidebarTopbarToggleNode = showSidebarTopbarSidebarToggle ? (
    <div
      className={`sidebar-titlebar-toggle${
        sidebarToggleProps.isLayoutSwapped ? " is-layout-swapped" : ""
      }`}
      data-tauri-drag-region="false"
    >
      {isMacDesktop ? (
        <>
          <GlobalSearchTitlebarButton
            onOpen={handleOpenSearchPalette}
            shortcutLabel={formatShortcutForPlatform(
              appSettings.toggleGlobalSearchShortcut,
              true,
            )}
          />
          <QuickSwitcherTitlebarButton
            onOpen={handleOpenQuickSwitcher}
            shortcutLabel="⌘E"
          />
        </>
      ) : null}
      <SidebarCollapseButton {...sidebarToggleProps} />
    </div>
  ) : null;
  const sidebarNodeWithTopbar =
    sidebarTopbarToggleNode !== null
      ? injectSidebarTopbarNode(sidebarNode, sidebarTopbarToggleNode)
      : sidebarNode;
  const runtimeConsoleDockNode = (
    <RuntimeConsoleDock
      isVisible={runtimeRunState.runtimeConsoleVisible}
      status={runtimeRunState.runtimeConsoleStatus}
      commandPreview={runtimeRunState.runtimeConsoleCommandPreview}
      log={runtimeRunState.runtimeConsoleLog}
      error={runtimeRunState.runtimeConsoleError}
      exitCode={runtimeRunState.runtimeConsoleExitCode}
      truncated={runtimeRunState.runtimeConsoleTruncated}
      autoScroll={runtimeRunState.runtimeAutoScroll}
      wrapLines={runtimeRunState.runtimeWrapLines}
      commandPresetOptions={runtimeRunState.runtimeCommandPresetOptions}
      commandPresetId={runtimeRunState.runtimeCommandPresetId}
      commandInput={runtimeRunState.runtimeCommandInput}
      onRun={runtimeRunState.onRunProject}
      onCommandPresetChange={runtimeRunState.onSelectRuntimeCommandPreset}
      onCommandInputChange={runtimeRunState.onChangeRuntimeCommandInput}
      onStop={runtimeRunState.onStopProject}
      onClear={runtimeRunState.onClearRuntimeLogs}
      onCopy={runtimeRunState.onCopyRuntimeLogs}
      onToggleAutoScroll={runtimeRunState.onToggleRuntimeAutoScroll}
      onToggleWrapLines={runtimeRunState.onToggleRuntimeWrapLines}
    />
  );

  return (
    <div
      ref={appRootRef}
      className={appClassName}
      style={
        {
          "--sidebar-width": `${
            isCompact
              ? sidebarWidth
              : settingsOpen
                ? 0
                : sidebarCollapsed
                  ? 0
                  : sidebarWidth
          }px`,
          "--right-panel-width": `${
            isCompact
              ? rightPanelWidth
              : rightPanelCollapsed
                ? 0
                : rightPanelWidth
          }px`,
          "--plan-panel-height": `${planPanelHeight}px`,
          "--terminal-panel-height": `${terminalPanelHeight}px`,
          "--debug-panel-height": `${debugPanelHeight}px`,
          "--git-history-panel-height": `${gitHistoryPanelHeight}px`,
          "--ui-font-family": appSettings.uiFontFamily,
          "--code-font-family": appSettings.codeFontFamily,
          "--code-font-size": `${appSettings.codeFontSize}px`,
        } as React.CSSProperties
      }
    >
      <div className="drag-strip" id="titlebar" data-tauri-drag-region />
      <TitlebarExpandControls
        {...sidebarToggleProps}
        showSidebarTitlebarToggle={showFloatingTitlebarSidebarToggle}
      />
      {shouldLoadGitHubPanelData ? (
        <Suspense fallback={null}>
          <GitHubPanelData
            activeWorkspace={activeWorkspace}
            gitPanelMode={gitPanelMode}
            shouldLoadDiffs={shouldLoadDiffs}
            diffSource={diffSource}
            selectedPullRequestNumber={selectedPullRequest?.number ?? null}
            onIssuesChange={handleGitIssuesChange}
            onPullRequestsChange={handleGitPullRequestsChange}
            onPullRequestDiffsChange={handleGitPullRequestDiffsChange}
            onPullRequestCommentsChange={handleGitPullRequestCommentsChange}
          />
        </Suspense>
      ) : null}
      <AppLayout
        showHome={showHome}
        showExtensions={showExtensions}
        showGitHistory={showGitHistory}
        hideRightPanel={activeTab === "spec" && rightPanelCollapsed}
        isSoloMode={isSoloMode}
        extensionsNode={
          showExtensions ? (
            <Suspense fallback={null}>
              <ExtensionsView activeWorkspace={activeWorkspace} />
            </Suspense>
          ) : null
        }
        gitHistoryNode={gitHistoryNode}
        showGitDetail={showGitDetail}
        activeTab={activeTab}
        tabletTab={tabletTab}
        centerMode={centerMode}
        editorSplitLayout={editorSplitLayout}
        editorSplitCompanion={editorSplitCompanion}
        isEditorFileMaximized={isEditorFileMaximized}
        hasActivePlan={hasActivePlan}
        activeWorkspace={Boolean(activeWorkspace)}
        activeWorkspaceId={activeWorkspace?.id ?? null}
        activeWorkspacePath={activeWorkspace?.path ?? null}
        sidebarNode={sidebarNodeWithTopbar}
        messagesNode={mainMessagesNode}
        composerNode={showWorkspaceHome ? null : composerNode}
        approvalToastsNode={approvalToastsNode}
        updateToastNode={updateToastNode}
        errorToastsNode={errorToastsNode}
        globalRuntimeNoticeDockNode={globalRuntimeNoticeDockNode}
        homeNode={homeNode}
        mainHeaderNode={mainHeaderNode}
        desktopTopbarLeftNode={desktopTopbarLeftNodeWithToggle}
        tabletNavNode={tabletNavNode}
        tabBarNode={tabBarNode}
        rightPanelToolbarNode={rightPanelToolbarNode}
        gitDiffPanelNode={gitDiffPanelNode}
        gitDiffViewerNode={gitDiffViewerNode}
        fileViewPanelNode={fileViewPanelNode}
        noteCardsPanelNode={noteCardsPanelNode}
        fileComparePanelNode={fileComparePanelNode}
        projectMapPanelNode={projectMapPanelNode}
        intentCanvasPanelNode={intentCanvasPanelNode}
        browserDockNode={browserDockNode}
        planPanelNode={planPanelNode}
        runtimeConsoleDockNode={runtimeConsoleDockNode}
        debugPanelNode={debugPanelNode}
        debugPanelFullNode={debugPanelFullNode}
        terminalDockNode={terminalDockNode}
        compactEmptyCodexNode={compactEmptyCodexNode}
        compactEmptySpecNode={compactEmptySpecNode}
        compactEmptyGitNode={compactEmptyGitNode}
        compactGitBackNode={compactGitBackNode}
        settingsOpen={settingsOpen}
        settingsNode={
          settingsOpen ? (
            <Suspense fallback={null}>
              <SettingsView
                workspaceGroups={workspaceGroups}
                groupedWorkspaces={groupedWorkspaces}
                allWorkspaces={workspaces}
                ungroupedLabel={ungroupedLabel}
                onMoveWorkspace={handleMoveWorkspace}
                onDeleteWorkspace={(workspaceId: string) => {
                  void removeWorkspace(workspaceId);
                }}
                onCreateWorkspaceGroup={createWorkspaceGroup}
                onRenameWorkspaceGroup={renameWorkspaceGroup}
                onMoveWorkspaceGroup={moveWorkspaceGroup}
                onDeleteWorkspaceGroup={deleteWorkspaceGroup}
                onAssignWorkspaceGroup={assignWorkspaceGroup}
                reduceTransparency={reduceTransparency}
                onToggleTransparency={setReduceTransparency}
                windowTransparencyEnabled={windowTransparencyEnabled}
                onToggleWindowTransparency={setWindowTransparencyEnabled}
                windowOpacity={windowOpacity}
                onWindowOpacityChange={setWindowOpacity}
                appSettings={appSettings}
                openAppIconById={openAppIconById}
                onUpdateAppSettings={async (next: any) => {
                  setAppSettings(next);
                  await queueSaveSettings(next);
                }}
                onOpenMailSession={handleOpenMailSession}
                onRunCodexDoctor={doctor}
                onRunClaudeDoctor={claudeDoctor}
                onRunKimiDoctor={kimiDoctor}
                onRunGrokDoctor={grokDoctor}
                onRunOpenCodeDoctor={opencodeDoctor}
                onRunPiDoctor={piDoctor}
                onRunOmpDoctor={ompDoctor}
                onRunQoderDoctor={qoderDoctor}
                activeWorkspace={activeWorkspace}
                activeThreadId={activeThreadId}
                activeEngine={activeEngine}
                onUpdateWorkspaceCodexBin={async (
                  id: string,
                  codexBin: string,
                ) => {
                  await updateWorkspaceCodexBin(id, codexBin);
                }}
                onUpdateWorkspaceSettings={async (
                  id: string,
                  settings: any,
                ) => {
                  await updateWorkspaceSettings(id, settings);
                }}
                workspaceThreadsById={threadsByWorkspace}
                workspaceThreadListLoadingById={threadListLoadingByWorkspace}
                sessionRadarRecentCompletedSessions={
                  sessionRadarRecentCompletedSessions
                }
                onEnsureWorkspaceThreads={
                  handleEnsureWorkspaceThreadsForSettings
                }
                onDeleteWorkspaceThreads={
                  handleDeleteWorkspaceConversationsInSettings
                }
                scaleShortcutTitle={scaleShortcutTitle}
                scaleShortcutText={scaleShortcutText}
                onTestNotificationSound={handleTestNotificationSound}
                onClose={closeSettings}
                initialSection={settingsSection ?? undefined}
                initialHighlightTarget={settingsHighlightTarget ?? undefined}
              />
            </Suspense>
          ) : null
        }
        onSidebarResizeStart={onSidebarResizeStart}
        onRightPanelResizeStart={onRightPanelResizeStart}
        onPlanPanelResizeStart={onPlanPanelResizeStart}
        onGitHistoryPanelResizeStart={onGitHistoryPanelResizeStart}
      />
      <LockScreenOverlay
        isOpen={isPanelLocked}
        onUnlock={handleUnlockPanel}
        liveSessions={lockLiveSessions}
        dockIconId={appSettings?.dockIconId}
      />
      {isSearchPaletteOpen ? (
        <Suspense fallback={null}>
          <SearchPalette
            isOpen={isSearchPaletteOpen}
            scope={searchScope}
            contentFilters={searchContentFilters}
            workspaceName={activeWorkspace?.name ?? null}
            query={searchPaletteQuery}
            results={searchResults}
            apiHydrationStatus={searchApiHydrationStatus}
            fileHydrationStatus={searchFileHydrationStatus}
            selectedIndex={searchPaletteSelectedIndex}
            onQueryChange={setSearchPaletteQuery}
            onMoveSelection={handleSearchPaletteMoveSelection}
            onSelect={(result) => {
              void handleSelectSearchResult(result);
            }}
            onScopeChange={(nextScope) => {
              setSearchScope(nextScope);
              setSearchPaletteSelectedIndex(0);
            }}
            onContentFilterToggle={handleToggleSearchContentFilter}
            onClose={closeSearchPalette}
          />
        </Suspense>
      ) : null}
      {isQuickSwitcherOpen ? (
        <Suspense fallback={null}>
          <QuickSwitcher
            activeWorkspaceId={activeWorkspace?.id ?? null}
            activeThreadId={activeThreadId}
            activeFilePath={activeEditorFilePath}
            workspaces={workspaces}
            sessionGroups={quickSwitcherSessionGroups}
            runningSessions={quickSwitcherRunningSessions}
            activeNavigationIds={quickSwitcherActiveNavigationIds}
            onNavigate={handleQuickSwitcherNavigate}
            onSelectSession={handleQuickSwitcherSelectSession}
            onSelectFile={handleQuickSwitcherSelectFile}
            onClose={closeQuickSwitcher}
          />
        </Suspense>
      ) : null}
      {releaseNotesOpen ? (
        <Suspense fallback={null}>
          <ReleaseNotesModal
            isOpen={releaseNotesOpen}
            entries={releaseNotesEntries}
            activeIndex={releaseNotesActiveIndex}
            loading={releaseNotesLoading}
            error={releaseNotesError}
            updaterState={updaterState}
            onClose={closeReleaseNotes}
            onPrev={showPreviousReleaseNotes}
            onNext={showNextReleaseNotes}
            onRetry={retryReleaseNotesLoad}
            onCheckForUpdates={() => {
              void checkForUpdates({
                announceNoUpdate: true,
                interactive: true,
              });
            }}
            onStartUpdate={startUpdate}
          />
        </Suspense>
      ) : null}
      {workspaceAliasPromptNode}
      <AppModals
        loadingProgressDialog={loadingProgressDialog}
        onLoadingProgressDialogClose={dismissLoadingProgressDialog}
        worktreePrompt={worktreePrompt}
        onWorktreePromptChange={updateWorktreeBranch}
        onWorktreePromptBaseRefChange={updateWorktreeBaseRef}
        onWorktreePromptPublishChange={updateWorktreePublishToOrigin}
        onWorktreeSetupScriptChange={updateWorktreeSetupScript}
        onWorktreePromptCancel={cancelWorktreePrompt}
        onWorktreePromptConfirm={confirmWorktreePrompt}
        worktreeCreateResult={worktreeCreateResult}
        onWorktreeCreateResultClose={closeWorktreeCreateResult}
        clonePrompt={clonePrompt}
        onClonePromptCopyNameChange={updateCloneCopyName}
        onClonePromptChooseCopiesFolder={chooseCloneCopiesFolder}
        onClonePromptUseSuggestedFolder={useSuggestedCloneCopiesFolder}
        onClonePromptClearCopiesFolder={clearCloneCopiesFolder}
        onClonePromptCancel={cancelClonePrompt}
        onClonePromptConfirm={confirmClonePrompt}
      />
      {/* 当前页弹「添加模型」管理弹窗,不跳设置 */}
      <VendorModelManagerDialogHost />
    </div>
  );
}
