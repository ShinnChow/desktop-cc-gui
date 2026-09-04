import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
} from "react";
import type { LucideProps } from "lucide-react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import { renderGitHistoryPanelDialogs } from "./GitHistoryPanelDialogs";
import { renderGitHistoryPanelBranchDiffSection } from "./GitHistoryPanelBranchDiffSection";
import { renderGitHistoryPanelCreatePrDialog } from "./GitHistoryPanelCreatePrDialog";
import type { GitHistoryPanelViewScope } from "./GitHistoryPanelTypes";

import {
  DiffFileRow,
  DiffFolderRow,
} from "../../../../git/components/GitDiffPanelFileSections";
import { WorkspaceEditableDiffReviewSurface } from "../../../../git/components/WorkspaceEditableDiffReviewSurface";
import { RendererContextMenu } from "../../../../../components/ui/RendererContextMenu";
import { PersonaAvatar } from "../../../../subagent-ui";
import { resolveGitHistoryAuthorAvatar } from "../utils/gitHistoryAuthorAvatar";
import { getGitHistoryAuthorColorSlot } from "../utils/gitHistoryAuthorPalette";
import { getBranchAheadBehindTooltip } from "../utils/gitHistoryPanelSharedUtils";
import type { GitHistoryRepositoryBranchCatalog } from "../hooks/useGitHistoryRepositoryBranchCatalogs";
import { GitHistoryCommitFilters } from "./GitHistoryCommitFilters";
import { GitHistoryGraphCell } from "./GitHistoryGraphCell";
import { GitHistoryMultiRepositoryBranchTree } from "./GitHistoryMultiRepositoryBranchTree";
import { GitHistoryBranchStatusBadge } from "./GitHistoryPanelPickers";
const EMPTY_REPOSITORY_BRANCH_CATALOGS: ReadonlyMap<
  string,
  GitHistoryRepositoryBranchCatalog
> = new Map();

type ListViewMode = "flat" | "tree";
type ListViewIcon = ComponentType<LucideProps>;

const LIST_VIEW_OPTIONS: ReadonlyArray<{
  value: ListViewMode;
  icon: ListViewIcon;
  labelKey: "git.listFlat" | "git.listTree";
}> = [
  { value: "flat", icon: LayoutGrid, labelKey: "git.listFlat" },
  { value: "tree", icon: FolderTree, labelKey: "git.listTree" },
];

function GitHistoryChangedFilesListSelect({
  listView,
  onListViewChange,
  title,
  listViewLabel,
  flatLabel,
  treeLabel,
}: {
  listView: ListViewMode;
  onListViewChange: (view: ListViewMode) => void;
  title: string;
  listViewLabel: string;
  flatLabel: string;
  treeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const CurrentIcon = listView === "tree" ? FolderTree : LayoutGrid;
  const optionLabels: Record<ListViewMode, string> = {
    flat: flatLabel,
    tree: treeLabel,
  };

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!rootRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="git-history-details-list-select" ref={rootRef}>
      <button
        type="button"
        className={`git-history-details-list-trigger${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${title} · ${listViewLabel}`}
        title={`${title} · ${optionLabels[listView]}`}
        onClick={() => setOpen((value) => !value)}
      >
        <CurrentIcon size={14} aria-hidden />
        <span className="git-history-details-list-title">{title}</span>
        <ChevronDown
          size={12}
          className="git-history-details-list-caret"
          aria-hidden
        />
      </button>
      {open ? (
        <div
          className="git-history-details-list-menu popover-surface"
          role="menu"
          aria-label={listViewLabel}
        >
          <div className="git-history-details-list-menu-title">
            {listViewLabel}
          </div>
          {LIST_VIEW_OPTIONS.map((option) => {
            const isActive = listView === option.value;
            const OptionIcon = option.icon;
            const label = optionLabels[option.value];
            return (
              <button
                key={option.value}
                type="button"
                className={`git-history-details-list-option${
                  isActive ? " is-active" : ""
                }`}
                role="menuitemradio"
                aria-checked={isActive}
                aria-label={label}
                onClick={() => {
                  onListViewChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="git-history-details-list-option-main">
                  <OptionIcon size={13} aria-hidden />
                  <span>{label}</span>
                </span>
                <span
                  className={`git-history-details-list-option-check${
                    isActive ? " is-active" : ""
                  }`}
                  aria-hidden
                >
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function renderGitHistoryPanelView(scope: GitHistoryPanelViewScope) {
  const {
    ActionSurface,
    CREATE_PR_PREVIEW_COMMIT_LIMIT,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    CircleAlert,
    CircleCheck,
    Cloud,
    CloudDownload,
    Copy,
    DEFAULT_DETAILS_SPLIT,
    DISABLE_HISTORY_ACTION_BUTTONS,
    Download,
    FileIcon,
    FileText,
    Folder,
    FolderOpen,
    FolderTree,
    GitBranch,
    GitCommit,
    GitDiffViewer,
    GitHistoryInlinePicker,
    GitHistoryProjectPicker,
    GitHistoryWorktreePanel,
    GitMerge,
    GitPullRequestCreate,
    HardDrive,
    LayoutGrid,
    LoaderCircle,
    MessageSquareText,
    Pencil,
    Plus,
    RefreshCw,
    Repeat,
    Search,
    Trash2,
    Upload,
    X,
    branchContextActions,
    branchContextMenu,
    branchContextMenuRef,
    branchContextMenuStyle,
    branchContextTrackingSummary,
    branchDiffState,
    branchQuery,
    buildFileKey,
    clearOperationNotice,
    closeBranchContextMenu,
    closeBranchDiff,
    closeCreatePrDialog,
    closeRenameBranchDialog,
    closeWorktreePreview,
    codeAnnotations,
    commitContextMenu,
    commitContextMoreOpen,
    commitListRef,
    commitRowVirtualizer,
    commits,
    commitGraphLayout,
    comparePreviewDetailFile,
    comparePreviewDetailFileDiff,
    comparePreviewDiffEntries,
    comparePreviewFileKey,
    contextMoreDisabledReason,
    contextPrimaryActionGroups,
    contextWriteActions,
    createBranchDialogOpen,
    createBranchSourceOptions,
    createBranchSubmitting,
    createPortal,
    createPrBaseBranchOptions,
    createPrBaseRepoOptions,
    createPrCanConfirm,
    createPrCanOpen,
    createPrCompareBranchOptions,
    createPrCopiedPrUrl,
    createPrCopiedRetryCommand,
    createPrDefaultsError,
    createPrDefaultsLoading,
    createPrDialogOpen,
    createPrForm,
    createPrHeadRepoOptions,
    createPrHeadRepositoryValue,
    createPrPreviewBaseOnlyCount,
    createPrPreviewBaseRef,
    createPrPreviewCommits,
    createPrPreviewDetails,
    createPrPreviewDetailsError,
    createPrPreviewDetailsLoading,
    createPrPreviewError,
    createPrPreviewExpanded,
    createPrPreviewHasMore,
    createPrPreviewHeadRef,
    createPrPreviewLoading,
    createPrPreviewSelectedCommit,
    createPrPreviewSelectedSha,
    createPrResult,
    createPrResultHeadline,
    createPrStages,
    createPrSubmitting,
    createPrToolbarDisabledReason,
    createPrContentGenerating,
    createPrContentError,
    createPrContentSuccessAt,
    createPrContentSlow,
    createPrContentElapsedSec,
    createPrFormFlashAt,
    createPrContentEngine,
    openPrContentGenerationMenu,
    prContentMenu,
    setPrContentMenu,
    currentBranch,
    desktopSplitLayout,
    details,
    detailsBodyRef,
    detailsError,
    detailsLoading,
    detailsMessageContent,
    detailsSplitRatio,
    diffViewMode,
    emptyStateStatusText,
    expandedLocalScopes,
    expandedRemoteScopes,
    extractCommitBody,
    fallbackGitRoots,
    fallbackGitRootsError,
    fallbackGitRootsLoading,
    fallbackSelectingRoot,
    fetchDialogOpen,
    fetchSubmitting,
    fileTreeItems,
    formatRelativeTime,
    getBranchLeafName,
    getCommitActionIcon,
    getCurrentDefaultColumnWidths,
    getSpecialBranchBadges,
    groupedLocalBranches,
    groupedRemoteBranches,
    handleBranchContextMenuKeyDown,
    handleBranchesSplitResizeStart,
    handleCommitsSplitResizeStart,
    handleConfirmCreatePr,
    handleCopyCreatePrRetryCommand,
    handleCopyCreatePrUrl,
    handleCreateBranch,
    handleCreatePrHeadRepositoryChange,
    handleDeleteBranch,
    handleDetailsSplitResizeStart,
    handleFallbackGitRootSelect,
    handleFileTreeDirToggle,
    handleMergeBranch,
    handleOpenBranchContextMenu,
    handleOpenCommitContextMenu,
    handleOpenCreatePrDialog,
    handleOpenFetchDialog,
    handleOpenPullDialog,
    handleOpenPushDialog,
    handleOpenRefreshDialog,
    handleOpenRenameBranchDialog,
    handleOpenSyncDialog,
    handleOpenWorktreePreview,
    handleSelectBranchCompareCommit,
    handleSelectWorktreeDiffFile,
    handleToggleLocalScope,
    handleToggleRemoteScope,
    handleWorktreeSummaryChange,
    historyError,
    historyLoading,
    historyPreviewHeaderControlsTarget,
    historyTotal,
    isCreatePrDialogMaximized,
    isHistoryDiffModalMaximized,
    loadCreatePrCommitPreview,
    localSectionExpanded,
    localizeKnownGitError,
    localizedOperationName,
    mainGridRef,
    mainGridStyle,
    onCreateCodeAnnotation,
    onRemoveCodeAnnotation,
    onRequestClose,
    onSelectWorkspace,
    operationLoading,
    operationNotice,
    overviewCommitSectionCollapsed,
    overviewListView,
    previewDetailFile,
    previewDetailFileDiff,
    previewDiffEntries,
    previewModalFullDiffLoader,
    projectOptions,
    projectSections,
    pullDialogOpen,
    pullRemoteMenuOpen,
    pullSubmitting,
    pullTargetBranchMenuOpen,
    pushDialogOpen,
    pushRemoteMenuOpen,
    pushSubmitting,
    pushTargetBranchMenuOpen,
    refreshAll,
    refreshDialogOpen,
    refreshSubmitting,
    remoteSectionExpanded,
    renameBranchDialogOpen,
    renameBranchToolbarDisabledReason,
    renderChangedFilesSummary,
    repositoryRootName,
    repositoryUnavailable,
    resetDialogOpen,
    runCommitAction,
    selectedBranch,
    selectedCommitSha,
    selectedFileKey,
    selectedLocalBranchForRename,
    setBranchQuery,
    setBranchesWidth,
    setCommitContextMenu,
    setCommitContextMoreOpen,
    setCommitsWidth,
    setComparePreviewFileKey,
    setCreateBranchDialogOpen,
    setCreatePrForm,
    setCreatePrPreviewExpanded,
    setCreatePrPreviewSelectedSha,
    setDetailsSplitRatio,
    setDiffViewMode,
    setFallbackSelectingRoot,
    setFetchDialogOpen,
    setHistoryPreviewHeaderControlsTarget,
    setIsCreatePrDialogMaximized,
    setIsHistoryDiffModalMaximized,
    setLocalSectionExpanded,
    setOverviewCommitSectionCollapsed,
    setOverviewListView,
    setPreviewFileKey,
    setPullDialogOpen,
    setPullRemoteMenuOpen,
    setPullTargetBranchMenuOpen,
    setPushDialogOpen,
    setPushRemoteMenuOpen,
    setPushTargetBranchMenuOpen,
    setRefreshDialogOpen,
    setRemoteSectionExpanded,
    setResetDialogOpen,
    setSelectedBranch,
    setSelectedCommitSha,
    setSelectedFileKey,
    setSyncDialogOpen,
    setWorkspaceSelectingId,
    shouldShowWorkspacePickerPage,
    statusLabel,
    syncDialogOpen,
    syncSubmitting,
    t,
    trimRemotePrefix,
    virtualCommitRows,
    workbenchGridRef,
    workbenchGridStyle,
    workingTreeChangedFiles,
    workingTreeSummaryLabel,
    workingTreeTotalAdditions,
    workingTreeTotalDeletions,
    workspace,
    workspaceId,
    workspacePickerMessage,
    workspaceSelectingId,
    worktreePreviewDiffEntries,
    worktreePreviewDiffText,
    worktreePreviewError,
    worktreePreviewFile,
    worktreePreviewFullDiffLoader,
    worktreePreviewLoading,
  } = scope;
  const {
    commitFilterSurface,
    toolbarTabsNode = null,
    documentContentNode = null,
    activeDocumentTabId,
    repositories = [],
    repositoryBranchCatalogs = EMPTY_REPOSITORY_BRANCH_CATALOGS,
    selectedRepositoryRoot = null,
    onSelectRepository,
  } = scope;
  const hasRepositoryTree = repositories.length > 0;
  const createPrContentPrerequisitesMissing =
    !createPrPreviewBaseRef?.trim() || !createPrPreviewHeadRef?.trim();
  const activeAuthorFilter = commitFilterSurface.values.author
    .trim()
    .toLowerCase();
  const selectedProjectOption = projectSections
    .flatMap(
      (section: {
        options: Array<{ id: string; label: string; selected?: boolean }>;
      }) => section.options,
    )
    .find((option: { selected?: boolean }) => option.selected);
  const repositoryPickerEntries = repositories.map((repository) => ({
    id: `repository:${encodeURIComponent(repository.repositoryRoot)}`,
    label: repository.displayName,
    repositoryRoot: repository.repositoryRoot,
  }));
  const selectedRepository = repositories.find(
    (repository) => repository.repositoryRoot === selectedRepositoryRoot,
  );
  const repositoryPicker =
    repositoryPickerEntries.length > 1 && onSelectRepository ? (
      <GitHistoryProjectPicker
        sections={[{ id: null, name: "", options: repositoryPickerEntries }]}
        selectedId={
          selectedRepository
            ? `repository:${encodeURIComponent(selectedRepository.repositoryRoot)}`
            : null
        }
        selectedLabel={
          selectedRepository?.displayName ??
          workspace?.name ??
          t("git.historyProject")
        }
        ariaLabel={t("git.chooseRepo")}
        searchPlaceholder={t("workspace.searchProjects")}
        emptyText={t("git.noRepositoriesFound")}
        icon={<HardDrive size={13} />}
        onSelect={(optionId) => {
          const selected = repositoryPickerEntries.find(
            (entry) => entry.id === optionId,
          );
          if (selected) {
            void onSelectRepository(selected.repositoryRoot);
          }
        }}
      />
    ) : null;

  if (shouldShowWorkspacePickerPage) {
    const canPickFallbackGitRoot =
      repositoryUnavailable && Boolean(workspace) && !repositoryPicker;
    const isEmptyStateSelecting = Boolean(
      fallbackSelectingRoot || workspaceSelectingId,
    );
    return (
      <div
        className={`git-history-workbench${documentContentNode ? " has-document-content" : ""}`}
        id={documentContentNode ? undefined : "git-history-panel-graph"}
        role={documentContentNode ? undefined : "tabpanel"}
        aria-labelledby={
          documentContentNode ? undefined : "git-history-tab-graph"
        }
      >
        <div className="git-history-toolbar git-history-empty-toolbar">
          <div className="git-history-toolbar-left">
            <span className="git-history-empty-inline-text">
              {workspacePickerMessage}
            </span>
            {projectOptions.length > 0 && onSelectWorkspace ? (
              <GitHistoryProjectPicker
                sections={projectSections}
                selectedId={selectedProjectOption?.id ?? workspace?.id ?? null}
                selectedLabel={
                  selectedProjectOption?.label ??
                  workspace?.name ??
                  t("git.historyProject")
                }
                ariaLabel={t("git.historyProject")}
                searchPlaceholder={t("workspace.searchProjects")}
                emptyText={t("workspace.noProjectsFound")}
                disabled={isEmptyStateSelecting}
                onSelect={(nextWorkspaceId) => {
                  if (
                    nextWorkspaceId &&
                    nextWorkspaceId !== selectedProjectOption?.id
                  ) {
                    setWorkspaceSelectingId(nextWorkspaceId);
                    onSelectWorkspace(nextWorkspaceId);
                  }
                }}
              />
            ) : null}
            {repositoryPicker}
            {canPickFallbackGitRoot ? (
              <GitHistoryProjectPicker
                sections={[
                  {
                    id: null,
                    name: "",
                    options: fallbackGitRoots.map((root) => ({
                      id: root,
                      label: root,
                    })),
                  },
                ]}
                selectedId={fallbackSelectingRoot}
                selectedLabel={
                  fallbackSelectingRoot ||
                  (fallbackGitRootsLoading
                    ? t("git.scanningRepositories")
                    : fallbackGitRoots.length > 0
                      ? t("git.chooseRepo")
                      : t("git.noRepositoriesFound"))
                }
                ariaLabel={t("git.chooseRepo")}
                searchPlaceholder={t("workspace.searchProjects")}
                emptyText={t("git.noRepositoriesFound")}
                disabled={
                  fallbackGitRootsLoading ||
                  isEmptyStateSelecting ||
                  fallbackGitRoots.length === 0
                }
                onSelect={(selectedRoot) => {
                  if (!selectedRoot) {
                    return;
                  }
                  void (async () => {
                    setFallbackSelectingRoot(selectedRoot);
                    try {
                      await handleFallbackGitRootSelect(selectedRoot);
                    } finally {
                      setFallbackSelectingRoot(null);
                    }
                  })();
                }}
              />
            ) : null}
            {fallbackGitRootsError ? (
              <span className="git-history-empty-inline-text">
                {localizeKnownGitError(fallbackGitRootsError) ??
                  fallbackGitRootsError}
              </span>
            ) : null}
            {toolbarTabsNode}
          </div>
          {onRequestClose ? (
            <div className="git-history-toolbar-actions">
              <ActionSurface
                className="git-history-close-chip"
                onActivate={() => onRequestClose()}
                title={t("git.historyClosePanel")}
              >
                <X size={14} />
              </ActionSurface>
            </div>
          ) : null}
        </div>
        {documentContentNode ? (
          <div
            id="git-history-panel-file"
            className="git-history-document-panel"
            role="tabpanel"
            aria-labelledby={activeDocumentTabId}
          >
            {documentContentNode}
          </div>
        ) : (
          <div className="git-history-empty git-history-empty-body">
            <div className="git-history-empty-guide">
              <div className="git-history-empty-guide-title">
                {t("git.historyWorkspacePickerGuideTitle")}
              </div>
              <p className="git-history-empty-guide-line">
                {t("git.historyWorkspacePickerGuideStepCheck")}
              </p>
              <p className="git-history-empty-guide-line">
                {t("git.historyWorkspacePickerGuideStepScan")}
              </p>
              <p className="git-history-empty-guide-line">
                {t("git.historyWorkspacePickerGuideStepSelect")}
              </p>
            </div>
            <div
              className={`git-history-empty-progress ${isEmptyStateSelecting ? "is-busy" : ""}`}
            >
              {emptyStateStatusText}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`git-history-workbench${documentContentNode ? " has-document-content" : ""}`}
      id={documentContentNode ? undefined : "git-history-panel-graph"}
      role={documentContentNode ? undefined : "tabpanel"}
      aria-labelledby={
        documentContentNode ? undefined : "git-history-tab-graph"
      }
      tabIndex={0}
      onKeyDown={(event) => {
        if (branchDiffState && event.key === "Escape") {
          event.preventDefault();
          closeBranchDiff();
          return;
        }
        if (branchContextMenu && event.key === "Escape") {
          event.preventDefault();
          closeBranchContextMenu();
          return;
        }
        if (pushDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (pushRemoteMenuOpen || pushTargetBranchMenuOpen) {
            setPushRemoteMenuOpen(false);
            setPushTargetBranchMenuOpen(false);
            return;
          }
          if (!pushSubmitting) {
            setPushDialogOpen(false);
          }
          return;
        }
        if (createPrDialogOpen && event.key === "Escape") {
          event.preventDefault();
          closeCreatePrDialog();
          return;
        }
        if (pullDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (pullRemoteMenuOpen || pullTargetBranchMenuOpen) {
            setPullRemoteMenuOpen(false);
            setPullTargetBranchMenuOpen(false);
            return;
          }
          if (!pullSubmitting) {
            setPullDialogOpen(false);
          }
          return;
        }
        if (syncDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (!syncSubmitting) {
            setSyncDialogOpen(false);
          }
          return;
        }
        if (fetchDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (!fetchSubmitting) {
            setFetchDialogOpen(false);
          }
          return;
        }
        if (refreshDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (!refreshSubmitting) {
            setRefreshDialogOpen(false);
          }
          return;
        }
        if (resetDialogOpen && event.key === "Escape") {
          event.preventDefault();
          setResetDialogOpen(false);
          return;
        }
        if (createBranchDialogOpen && event.key === "Escape") {
          event.preventDefault();
          if (!createBranchSubmitting) {
            setCreateBranchDialogOpen(false);
          }
          return;
        }
        if (renameBranchDialogOpen && event.key === "Escape") {
          event.preventDefault();
          closeRenameBranchDialog();
          return;
        }
        if (
          createBranchDialogOpen ||
          renameBranchDialogOpen ||
          resetDialogOpen ||
          pushDialogOpen ||
          createPrDialogOpen ||
          pullDialogOpen ||
          syncDialogOpen ||
          fetchDialogOpen ||
          refreshDialogOpen ||
          branchContextMenu ||
          branchDiffState
        ) {
          return;
        }
        const target = event.target as HTMLElement | null;
        const isTypingTarget = Boolean(
          target &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable),
        );
        if (isTypingTarget) {
          return;
        }
        if (!commits.length) {
          return;
        }
        const currentIndex = commits.findIndex(
          (entry) => entry.sha === selectedCommitSha,
        );
        if (event.key === "ArrowDown") {
          event.preventDefault();
          const nextIndex =
            currentIndex < 0
              ? 0
              : Math.min(currentIndex + 1, commits.length - 1);
          setSelectedCommitSha(commits[nextIndex].sha);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          const nextIndex =
            currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
          setSelectedCommitSha(commits[nextIndex].sha);
        } else if (event.key === "Escape") {
          onRequestClose?.();
        }
      }}
    >
      <div className="git-history-toolbar">
        <div className="git-history-toolbar-left">
          <h2>{t("git.historyTitle")}</h2>
          {projectOptions.length > 0 && onSelectWorkspace ? (
            <GitHistoryProjectPicker
              sections={projectSections}
              selectedId={selectedProjectOption?.id ?? workspace?.id ?? null}
              selectedLabel={selectedProjectOption?.label ?? workspace?.name ?? ""}
              ariaLabel={t("git.historyProject")}
              searchPlaceholder={t("workspace.searchProjects")}
              emptyText={t("workspace.noProjectsFound")}
              onSelect={(nextWorkspaceId) => {
                if (
                  nextWorkspaceId &&
                  nextWorkspaceId !== selectedProjectOption?.id
                ) {
                  setWorkspaceSelectingId(nextWorkspaceId);
                  onSelectWorkspace(nextWorkspaceId);
                }
              }}
            />
          ) : null}
          {hasRepositoryTree ? null : repositoryPicker}
          <div className="git-history-toolbar-meta">
            <span className="git-history-head-pill">HEAD</span>
            <code className="git-history-current-branch">
              {currentBranch ?? workspace?.name ?? ""}
            </code>
            <span
              className={`git-history-toolbar-worktree ${
                workingTreeChangedFiles > 0 ? "is-dirty" : "is-clean"
              }`}
            >
              {workingTreeSummaryLabel}
            </span>
            {workingTreeChangedFiles > 0 ? (
              <span className="git-history-toolbar-lines">
                <span className="git-history-diff-add">
                  +{workingTreeTotalAdditions}
                </span>
                <span className="git-history-diff-sep" aria-hidden>
                  /
                </span>
                <span className="git-history-diff-del">
                  -{workingTreeTotalDeletions}
                </span>
              </span>
            ) : null}
            <span className="git-history-toolbar-count">
              {t("git.historyCommitCount", { count: historyTotal })}
            </span>
          </div>
          {toolbarTabsNode}
        </div>
        <div className="git-history-toolbar-actions">
          <div className="git-history-toolbar-action-group">
            <ActionSurface
              className="git-history-chip git-history-chip-pr"
              active={createPrDialogOpen}
              onActivate={handleOpenCreatePrDialog}
              disabled={!createPrCanOpen}
              title={createPrToolbarDisabledReason ?? t("git.historyCreatePr")}
            >
              <GitPullRequestCreate size={13} />
              <span>{t("git.historyCreatePr")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip"
              active={pullDialogOpen}
              onActivate={handleOpenPullDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.pull")}
            >
              <Download size={13} />
              <span>{t("git.pull")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip"
              active={pushDialogOpen}
              onActivate={handleOpenPushDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.push")}
            >
              <Upload size={13} />
              <span>{t("git.push")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip"
              active={syncDialogOpen}
              onActivate={handleOpenSyncDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.sync")}
            >
              <Repeat size={13} />
              <span>{t("git.sync")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip"
              active={fetchDialogOpen}
              onActivate={handleOpenFetchDialog}
              disabled={Boolean(operationLoading)}
              title={t("git.fetch")}
            >
              <CloudDownload size={13} />
              <span>{t("git.fetch")}</span>
            </ActionSurface>
            <ActionSurface
              className="git-history-chip"
              active={refreshDialogOpen}
              onActivate={handleOpenRefreshDialog}
              disabled={Boolean(operationLoading) || historyLoading}
              title={t("git.refresh")}
            >
              <RefreshCw size={13} />
              <span>{t("git.refresh")}</span>
            </ActionSurface>
          </div>
          <ActionSurface
            className="git-history-close-chip"
            onActivate={() => onRequestClose?.()}
            title={t("git.historyClosePanel")}
          >
            <X size={14} />
          </ActionSurface>
        </div>
      </div>

      {documentContentNode ? (
        <div
          id="git-history-panel-file"
          className="git-history-document-panel"
          role="tabpanel"
          aria-labelledby={activeDocumentTabId}
        >
          {documentContentNode}
        </div>
      ) : null}

      {operationNotice && (
        <div
          className={
            operationNotice.kind === "error"
              ? "git-history-error"
              : "git-history-success"
          }
          title={operationNotice.debugMessage}
        >
          <span>{operationNotice.message}</span>
          {operationNotice.kind === "error" ? (
            <button
              type="button"
              className="git-history-notice-close"
              onClick={clearOperationNotice}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      )}
      {localizedOperationName && (
        <div className="git-history-status">
          {t("git.historyRunningOperation", {
            operation: localizedOperationName,
          })}
        </div>
      )}

      <div
        className={`git-history-grid${desktopSplitLayout ? " with-vertical-resizers" : ""}`}
        ref={workbenchGridRef}
        style={workbenchGridStyle}
      >
        <aside className="git-history-overview" hidden aria-hidden="true">
          <div className="git-history-overview-toolbar is-files-top-row">
            <div
              className="git-history-overview-list-toggle"
              role="group"
              aria-label={t("git.listView")}
            >
              <button
                type="button"
                className={`git-history-overview-list-tab${
                  overviewListView === "flat" ? " is-active" : ""
                }`}
                onClick={() => setOverviewListView("flat")}
                aria-pressed={overviewListView === "flat"}
                aria-label={t("git.listFlat")}
                title={t("git.listFlat")}
              >
                <LayoutGrid size={13} />
                <span>{t("git.listFlat")}</span>
              </button>
              <button
                type="button"
                className={`git-history-overview-list-tab${
                  overviewListView === "tree" ? " is-active" : ""
                }`}
                onClick={() => setOverviewListView("tree")}
                aria-pressed={overviewListView === "tree"}
                aria-label={t("git.listTree")}
                title={t("git.listTree")}
              >
                <FolderTree size={13} />
                <span>{t("git.listTree")}</span>
              </button>
              <button
                type="button"
                className={`git-history-overview-list-tab${
                  !overviewCommitSectionCollapsed ? " is-active" : ""
                }`}
                onClick={() =>
                  setOverviewCommitSectionCollapsed((value) => !value)
                }
                aria-pressed={!overviewCommitSectionCollapsed}
                aria-label={t("git.toggleCommitSection")}
                title={
                  overviewCommitSectionCollapsed
                    ? t("git.expandCommitSection")
                    : t("git.collapseCommitSection")
                }
              >
                {!overviewCommitSectionCollapsed ? (
                  <ChevronsDownUp size={13} />
                ) : (
                  <ChevronsUpDown size={13} />
                )}
                <span>{t("git.commit")}</span>
              </button>
            </div>
          </div>
          <GitHistoryWorktreePanel
            key={`${workspace?.id ?? "none"}:${selectedRepositoryRoot === null ? "legacy" : `repository:${selectedRepositoryRoot}`}`}
            workspaceId={workspace?.id ?? ""}
            repositoryRoot={selectedRepositoryRoot}
            listView={overviewListView}
            commitSectionCollapsed={overviewCommitSectionCollapsed}
            rootFolderName={repositoryRootName}
            onMutated={() => refreshAll()}
            onSummaryChange={handleWorktreeSummaryChange}
            onOpenDiffPath={(path) => {
              void handleOpenWorktreePreview(path);
            }}
          />
        </aside>

        <div
          className={`git-history-main-grid${desktopSplitLayout ? " with-vertical-resizers" : ""}`}
          ref={mainGridRef}
          style={mainGridStyle}
        >
          <section className="git-history-branches">
            <div className="git-history-column-header">
              <span>
                <GitBranch size={14} /> {t("git.historyBranches")}
              </span>
              <div className="git-history-branch-actions">
                <ActionSurface
                  className="git-history-mini-chip"
                  onActivate={() => void handleCreateBranch()}
                  disabled={
                    Boolean(operationLoading) ||
                    createBranchSourceOptions.length === 0
                  }
                  title={t("git.historyNew")}
                  ariaLabel={t("git.historyNew")}
                >
                  <Plus size={13} aria-hidden />
                </ActionSurface>
                <ActionSurface
                  className="git-history-mini-chip"
                  onActivate={() =>
                    handleOpenRenameBranchDialog(selectedLocalBranchForRename)
                  }
                  disabled={Boolean(
                    DISABLE_HISTORY_ACTION_BUTTONS ||
                    renameBranchToolbarDisabledReason,
                  )}
                  title={
                    renameBranchToolbarDisabledReason ?? t("git.historyRename")
                  }
                  ariaLabel={t("git.historyRename")}
                >
                  <Pencil size={13} aria-hidden />
                </ActionSurface>
                <ActionSurface
                  className="git-history-mini-chip"
                  onActivate={() => void handleDeleteBranch()}
                  title={t("git.historyDelete")}
                  ariaLabel={t("git.historyDelete")}
                >
                  <Trash2 size={13} aria-hidden />
                </ActionSurface>
                <ActionSurface
                  className="git-history-mini-chip"
                  onActivate={() => void handleMergeBranch()}
                  title={t("git.historyMerge")}
                  ariaLabel={t("git.historyMerge")}
                >
                  <GitMerge size={13} aria-hidden />
                </ActionSurface>
              </div>
            </div>
            <label className="git-history-search">
              <Search size={14} />
              <input
                value={branchQuery}
                onChange={(event) => setBranchQuery(event.target.value)}
                placeholder={t("git.historySearchBranches")}
              />
            </label>
            <div className="git-history-branch-list scrollable">
              {hasRepositoryTree ? (
                <GitHistoryMultiRepositoryBranchTree
                  repositories={repositories}
                  catalogs={repositoryBranchCatalogs}
                  selectedRepositoryRoot={selectedRepositoryRoot}
                  selectedBranch={selectedBranch}
                  query={branchQuery}
                  t={t}
                  onSelectBranch={async (repositoryRoot, branchName) => {
                    if (
                      repositoryRoot !== selectedRepositoryRoot &&
                      onSelectRepository
                    ) {
                      await onSelectRepository(repositoryRoot);
                    }
                    setSelectedBranch(branchName);
                  }}
                  onOpenBranchContextMenu={async (
                    event,
                    repositoryRoot,
                    branch,
                    source,
                  ) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (
                      repositoryRoot !== selectedRepositoryRoot &&
                      onSelectRepository
                    ) {
                      await onSelectRepository(repositoryRoot);
                      setSelectedBranch(branch.name);
                    }
                    handleOpenBranchContextMenu(event, branch, source);
                  }}
                />
              ) : (
                <>
                  <ActionSurface
                    className="git-history-branch-item git-history-branch-all-item"
                    active={selectedBranch === "all"}
                    onActivate={() => setSelectedBranch("all")}
                  >
                    <span>{t("git.historyAllBranches")}</span>
                  </ActionSurface>

                  <div className="git-history-tree-section">
                    <ActionSurface
                      className="git-history-tree-section-toggle"
                      onActivate={() =>
                        setLocalSectionExpanded((prev) => !prev)
                      }
                      ariaLabel={t("git.historyToggleLocalBranches")}
                    >
                      <HardDrive size={13} />
                      <span>{t("git.historyLocal")}</span>
                    </ActionSurface>
                    {localSectionExpanded && (
                      <div className="git-history-tree-section-body">
                        {groupedLocalBranches.map((group) => {
                          const scopeExpanded = expandedLocalScopes.has(
                            group.key,
                          );
                          return (
                            <div
                              key={`local-group-${group.key}`}
                              className="git-history-tree-scope-group"
                            >
                              <ActionSurface
                                className="git-history-tree-scope-toggle"
                                onActivate={() =>
                                  handleToggleLocalScope(group.key)
                                }
                                ariaLabel={t("git.historyToggleLocalGroup", {
                                  group: group.label,
                                })}
                              >
                                {scopeExpanded ? (
                                  <ChevronDown size={12} />
                                ) : (
                                  <ChevronRight size={12} />
                                )}
                                {scopeExpanded ? (
                                  <FolderOpen size={12} />
                                ) : (
                                  <Folder size={12} />
                                )}
                                <span className="git-history-tree-scope-label">
                                  {group.label}
                                </span>
                              </ActionSurface>
                              {scopeExpanded &&
                                group.items.map((entry) => (
                                  <div
                                    key={`local-${entry.name}`}
                                    className="git-history-branch-row"
                                    onContextMenu={(event) =>
                                      handleOpenBranchContextMenu(
                                        event,
                                        entry,
                                        "local",
                                      )
                                    }
                                  >
                                    <ActionSurface
                                      className={`git-history-branch-item git-history-branch-item-tree ${
                                        entry.isCurrent ? "is-head-branch" : ""
                                      }`}
                                      active={selectedBranch === entry.name}
                                      onActivate={() =>
                                        setSelectedBranch(entry.name)
                                      }
                                    >
                                      <span className="git-history-tree-branch-main">
                                        <GitBranch size={11} />
                                        <span className="git-history-branch-name">
                                          {getBranchLeafName(entry.name)}
                                        </span>
                                      </span>
                                      <span className="git-history-branch-badges">
                                        {entry.isCurrent ? (
                                          <em className="is-head">HEAD</em>
                                        ) : null}
                                        {getSpecialBranchBadges(
                                          entry.name,
                                          t,
                                        ).map((badge) => (
                                          <i
                                            key={`${entry.name}-${badge}`}
                                            className="is-special"
                                          >
                                            {badge}
                                          </i>
                                        ))}
                                        {entry.ahead > 0 ? (
                                          <GitHistoryBranchStatusBadge
                                            kind="ahead"
                                            count={entry.ahead}
                                            tooltip={getBranchAheadBehindTooltip(
                                              "ahead",
                                              entry.ahead,
                                              entry.upstream,
                                              t,
                                            )}
                                          />
                                        ) : null}
                                        {entry.behind > 0 ? (
                                          <GitHistoryBranchStatusBadge
                                            kind="behind"
                                            count={entry.behind}
                                            tooltip={getBranchAheadBehindTooltip(
                                              "behind",
                                              entry.behind,
                                              entry.upstream,
                                              t,
                                            )}
                                          />
                                        ) : null}
                                      </span>
                                    </ActionSurface>
                                  </div>
                                ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="git-history-tree-section">
                    <ActionSurface
                      className="git-history-tree-section-toggle"
                      onActivate={() =>
                        setRemoteSectionExpanded((prev) => !prev)
                      }
                      ariaLabel={t("git.historyToggleRemoteBranches")}
                    >
                      <Cloud size={13} />
                      <span>{t("git.historyRemote")}</span>
                    </ActionSurface>
                    {remoteSectionExpanded && (
                      <div className="git-history-tree-section-body">
                        {groupedRemoteBranches.map((group) => {
                          const scopeExpanded = expandedRemoteScopes.has(
                            group.remote,
                          );
                          return (
                            <div
                              key={`remote-group-${group.remote}`}
                              className="git-history-tree-scope-group"
                            >
                              <ActionSurface
                                className="git-history-tree-scope-toggle"
                                onActivate={() =>
                                  handleToggleRemoteScope(group.remote)
                                }
                                ariaLabel={t("git.historyToggleRemoteGroup", {
                                  group: group.remote,
                                })}
                              >
                                {scopeExpanded ? (
                                  <ChevronDown size={12} />
                                ) : (
                                  <ChevronRight size={12} />
                                )}
                                {scopeExpanded ? (
                                  <FolderOpen size={12} />
                                ) : (
                                  <Folder size={12} />
                                )}
                                <span className="git-history-tree-scope-label">
                                  {group.remote}
                                </span>
                              </ActionSurface>
                              {scopeExpanded &&
                                group.items.map((entry) => (
                                  <div
                                    key={`remote-${entry.name}`}
                                    className="git-history-branch-row git-history-branch-row-remote"
                                    onContextMenu={(event) =>
                                      handleOpenBranchContextMenu(
                                        event,
                                        entry,
                                        "remote",
                                      )
                                    }
                                  >
                                    <ActionSurface
                                      className="git-history-branch-item git-history-branch-item-remote-tree"
                                      active={selectedBranch === entry.name}
                                      onActivate={() =>
                                        setSelectedBranch(entry.name)
                                      }
                                    >
                                      <span className="git-history-tree-branch-main">
                                        <GitBranch size={11} />
                                        <span className="git-history-branch-name">
                                          {trimRemotePrefix(
                                            entry.name,
                                            group.remote,
                                          )}
                                        </span>
                                      </span>
                                      <span className="git-history-branch-badges">
                                        {getSpecialBranchBadges(
                                          entry.name,
                                          t,
                                        ).map((badge) => (
                                          <i
                                            key={`${entry.name}-${badge}`}
                                            className="is-special"
                                          >
                                            {badge}
                                          </i>
                                        ))}
                                      </span>
                                    </ActionSurface>
                                  </div>
                                ))}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>

          {desktopSplitLayout && (
            <div
              className="git-history-vertical-resizer"
              role="separator"
              aria-orientation="vertical"
              onMouseDown={handleBranchesSplitResizeStart}
              onDoubleClick={() => {
                const defaults = getCurrentDefaultColumnWidths();
                setBranchesWidth(defaults.branchesWidth);
                setCommitsWidth(defaults.commitsWidth);
              }}
            />
          )}

          <section className="git-history-commits">
            <GitHistoryCommitFilters
              {...commitFilterSurface}
              headerTitle={
                <>
                  <GitCommit size={14} /> {t("git.historyCommits")}
                </>
              }
            />

            {historyError && (
              <div className="git-history-error">
                {localizeKnownGitError(historyError) ?? historyError}
              </div>
            )}
            {!historyError && historyLoading && (
              <div className="git-history-empty">
                {t("git.historyLoadingCommits")}
              </div>
            )}
            {!historyLoading && !commits.length && (
              <div className="git-history-empty">
                {t("git.historyNoCommitsFound")}
              </div>
            )}

            <div className="git-history-commit-list scrollable" ref={commitListRef}>
              <div
                className="git-history-commit-list-virtual"
                style={{ height: `${commitRowVirtualizer.getTotalSize()}px` }}
              >
                {virtualCommitRows.map((virtualRow) => {
                  const entry = commits[virtualRow.index];
                  if (!entry) {
                    return null;
                  }
                  const active = selectedCommitSha === entry.sha;
                  const authorColorSlot = getGitHistoryAuthorColorSlot(
                    entry.authorEmail,
                    entry.author,
                  );
                  const authorDisplayName = entry.author || t("git.unknown");
                  const authorAvatar = resolveGitHistoryAuthorAvatar(
                    entry.authorEmail,
                    entry.author,
                  );
                  const normalizedAuthorName = entry.author
                    .trim()
                    .toLowerCase();
                  const normalizedAuthorEmail = entry.authorEmail
                    .trim()
                    .toLowerCase();
                  const showMatchedAuthorEmail = Boolean(
                    activeAuthorFilter &&
                    !normalizedAuthorName.includes(activeAuthorFilter) &&
                    normalizedAuthorEmail.includes(activeAuthorFilter),
                  );
                  const graphRow = commitGraphLayout.rows[virtualRow.index];

                  return (
                    <div
                      key={entry.sha}
                      data-index={virtualRow.index}
                      ref={commitRowVirtualizer.measureElement}
                      className="git-history-commit-row-host"
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <ActionSurface
                        className={`git-history-commit-row git-history-author-color-${authorColorSlot}`}
                        active={active}
                        onActivate={() => setSelectedCommitSha(entry.sha)}
                        onContextMenu={(event) =>
                          handleOpenCommitContextMenu(event, entry.sha)
                        }
                      >
                        <GitHistoryGraphCell
                          row={graphRow}
                          height={virtualRow.size}
                          active={active}
                          isFirst={virtualRow.index === 0}
                          isLast={virtualRow.index === commits.length - 1}
                        />
                        <span className="git-history-commit-content">
                          <span
                            className="git-history-commit-summary"
                            title={entry.summary || t("git.historyNoMessage")}
                          >
                            {entry.summary || t("git.historyNoMessage")}
                          </span>
                          <span className="git-history-commit-meta">
                            <code>{entry.shortSha}</code>
                            {/* Author chip is redundant when already filtered by user;
                                only keep email when the filter matched email, not name. */}
                            {!activeAuthorFilter ? (
                              <span className="git-history-commit-author">
                                <PersonaAvatar
                                  displayName={authorDisplayName}
                                  avatarSrc={authorAvatar.avatarSrc}
                                  githubProfileUrl={authorAvatar.githubProfileUrl}
                                  size={14}
                                  className="git-history-commit-author-avatar"
                                />
                                <em title={authorDisplayName}>{authorDisplayName}</em>
                              </span>
                            ) : showMatchedAuthorEmail ? (
                              <span className="git-history-commit-author-email">
                                &lt;{entry.authorEmail}&gt;
                              </span>
                            ) : null}
                            <time>{formatRelativeTime(entry.timestamp, t)}</time>
                          </span>
                          {entry.refs.length > 0 && (
                            <span
                              className="git-history-commit-refs"
                              title={entry.refs.join(", ")}
                            >
                              {entry.refs.slice(0, 3).join(" · ")}
                            </span>
                          )}
                        </span>
                      </ActionSurface>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {desktopSplitLayout && (
            <div
              className="git-history-vertical-resizer"
              role="separator"
              aria-orientation="vertical"
              onMouseDown={handleCommitsSplitResizeStart}
              onDoubleClick={() => {
                const defaults = getCurrentDefaultColumnWidths();
                setCommitsWidth(defaults.commitsWidth);
              }}
            />
          )}

          <section className="git-history-details">
            <div className="git-history-column-header">
              {details ? (
                <GitHistoryChangedFilesListSelect
                  listView={overviewListView}
                  onListViewChange={(view) => setOverviewListView(view)}
                  title={t("git.historyChangedFiles")}
                  listViewLabel={t("git.listView")}
                  flatLabel={t("git.listFlat")}
                  treeLabel={t("git.listTree")}
                />
              ) : (
                <span>
                  <FileText size={14} />
                  {t("git.historyCommitDetails")}
                </span>
              )}
              {details ? (
                <span className="git-history-file-tree-head-summary">
                  {renderChangedFilesSummary(
                    t,
                    details.files.length,
                    details.totalAdditions,
                    details.totalDeletions,
                  )}
                </span>
              ) : null}
            </div>

            {detailsError && (
              <div className="git-history-error">
                {localizeKnownGitError(detailsError) ?? detailsError}
              </div>
            )}
            {!detailsError && detailsLoading && (
              <div className="git-history-empty">
                {t("git.historyLoadingCommitDetails")}
              </div>
            )}
            {!detailsLoading && !details && (
              <div className="git-history-empty">
                {t("git.historySelectCommitToViewDetails")}
              </div>
            )}

            {details && (
              <>
                <div
                  className="git-history-details-body"
                  ref={detailsBodyRef}
                  style={{
                    gridTemplateRows: `minmax(140px, ${detailsSplitRatio}%) 8px minmax(0, 1fr)`,
                  }}
                >
                  <div
                    className={`git-history-file-list git-filetree-section${
                      overviewListView === "tree"
                        ? " diff-section-tree-list git-filetree-list--tree"
                        : ""
                    }`}
                  >
                    {details.files.length === 0 ? (
                      <div className="git-history-empty">
                        {t("git.historyNoFileChangesInCommit")}
                      </div>
                    ) : overviewListView === "flat" ? (
                      details.files.map((file) => {
                        const fileKey = buildFileKey(file);
                        const active = selectedFileKey === fileKey;
                        return (
                          <DiffFileRow
                            key={fileKey}
                            file={{ ...file, mutationDisabled: true }}
                            className="git-history-tree-item git-history-file-item"
                            showStats
                            section="unstaged"
                            isSelected={false}
                            isActive={active}
                            inclusionState="none"
                            inclusionDisabled
                            treeItem={false}
                            showDirectory
                            onClick={() => {
                              setSelectedFileKey(fileKey);
                              setPreviewFileKey(fileKey);
                            }}
                            onKeySelect={() => {
                              setSelectedFileKey(fileKey);
                              setPreviewFileKey(fileKey);
                            }}
                            onOpenPreview={() => setPreviewFileKey(fileKey)}
                            onContextMenu={() => undefined}
                          />
                        );
                      })
                    ) : (
                      fileTreeItems.map((item) => {
                        if (item.type === "dir") {
                          return (
                            <DiffFolderRow
                              key={item.id}
                              name={item.label}
                              iconName={item.path}
                              depth={item.depth}
                              indentStep={14}
                              collapsed={!item.expanded}
                              className="git-history-tree-item git-history-tree-dir"
                              onToggle={() => handleFileTreeDirToggle(item.path)}
                            />
                          );
                        }

                        const file = item.change;
                        const active = selectedFileKey === buildFileKey(file);
                        return (
                          <DiffFileRow
                            key={item.id}
                            file={{ ...file, mutationDisabled: true }}
                            className="git-history-tree-item git-history-file-item"
                            showStats
                            section="unstaged"
                            isSelected={false}
                            isActive={active}
                            inclusionState="none"
                            inclusionDisabled
                            treeItem
                            treeDepth={item.depth + 1}
                            indentLevel={item.depth * 2}
                            showDirectory={false}
                            onClick={() => {
                              const fileKey = buildFileKey(file);
                              setSelectedFileKey(fileKey);
                              setPreviewFileKey(fileKey);
                            }}
                            onKeySelect={() => {
                              const fileKey = buildFileKey(file);
                              setSelectedFileKey(fileKey);
                              setPreviewFileKey(fileKey);
                            }}
                            onOpenPreview={() =>
                              setPreviewFileKey(buildFileKey(file))
                            }
                            onContextMenu={() => undefined}
                          />
                        );
                      })
                    )}
                  </div>

                  <div
                    className="git-history-details-resizer"
                    role="separator"
                    aria-orientation="horizontal"
                    aria-label={t("git.historyResizeFileListAndDiff")}
                    onMouseDown={handleDetailsSplitResizeStart}
                    onDoubleClick={() =>
                      setDetailsSplitRatio(DEFAULT_DETAILS_SPLIT)
                    }
                  />

                  <div className="git-history-diff-view">
                    <div className="git-history-message-panel">
                      <div className="git-history-message-row">
                        <span className="git-history-message-label">
                          {t("git.historyCommitMetaTitleLabel")}
                        </span>
                        <strong className="git-history-message-title">
                          {details.summary || t("git.historyNoMessage")}
                        </strong>
                      </div>
                      <div className="git-history-message-row">
                        <span className="git-history-message-label">
                          {t("git.historyCommitMetaContentLabel")}
                        </span>
                        <div className="git-history-message-content">
                          {detailsMessageContent}
                        </div>
                      </div>
                      <div className="git-history-message-meta-row">
                        <span className="git-history-message-meta-item">
                          <i>{t("git.historyCommitMetaAuthorLabel")}</i>
                          <span>{details.author || t("git.unknown")}</span>
                        </span>
                        <span className="git-history-message-meta-item">
                          <i>{t("git.historyCommitMetaTimeLabel")}</i>
                          <time>
                            {new Date(
                              details.commitTime * 1000,
                            ).toLocaleString()}
                          </time>
                        </span>
                        <span className="git-history-message-meta-item">
                          <i>{t("git.historyCommitMetaIdLabel")}</i>
                          <code>{details.sha}</code>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {previewDetailFile && (
                  <div
                    className="git-history-diff-modal-overlay"
                    role="presentation"
                    onClick={() => setPreviewFileKey(null)}
                  >
                    <div
                      className={`git-history-diff-modal ${isHistoryDiffModalMaximized ? "is-maximized" : ""}`}
                      role="dialog"
                      aria-modal="true"
                      aria-label={previewDetailFile.path}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="git-history-diff-modal-header">
                        <div className="git-history-diff-modal-title">
                          <span
                            className={`git-history-file-status git-status-${previewDetailFile.status.toLowerCase()}`}
                          >
                            {previewDetailFile.status}
                          </span>
                          <span
                            className="git-history-tree-icon is-file"
                            aria-hidden
                          >
                            <FileIcon filePath={previewDetailFile.path} />
                          </span>
                          <span className="git-history-diff-modal-path">
                            {previewDetailFile.path}
                          </span>
                          <span className="git-history-diff-modal-stats">
                            <span className="is-add">
                              +{previewDetailFile.additions}
                            </span>
                            <span className="is-sep">/</span>
                            <span className="is-del">
                              -{previewDetailFile.deletions}
                            </span>
                          </span>
                        </div>
                        <div
                          className="git-history-diff-modal-actions"
                          ref={setHistoryPreviewHeaderControlsTarget}
                        >
                          <button
                            type="button"
                            className="git-history-diff-modal-close"
                            onClick={() =>
                              setIsHistoryDiffModalMaximized((value) => !value)
                            }
                            aria-label={
                              isHistoryDiffModalMaximized
                                ? t("common.restore")
                                : t("menu.maximize")
                            }
                            title={
                              isHistoryDiffModalMaximized
                                ? t("common.restore")
                                : t("menu.maximize")
                            }
                          >
                            <span
                              className="git-history-diff-modal-close-glyph"
                              aria-hidden
                            >
                              {isHistoryDiffModalMaximized ? "❐" : "□"}
                            </span>
                          </button>
                        </div>
                      </div>

                      {previewDetailFile.truncated &&
                        !previewDetailFile.isBinary && (
                          <div className="git-history-warning">
                            {t("git.historyDiffTooLargeTruncated", {
                              lineCount: previewDetailFile.lineCount,
                            })}
                          </div>
                        )}
                      {previewDetailFile.isBinary ? (
                        <pre className="git-history-diff-modal-code">
                          {previewDetailFileDiff}
                        </pre>
                      ) : (
                        <div className="git-history-diff-modal-viewer">
                          <WorkspaceEditableDiffReviewSurface
                            workspaceId={workspaceId}
                            workspacePath={workspace?.path ?? null}
                            files={previewDiffEntries.map((entry) => ({
                              filePath: entry.path,
                              status: entry.status,
                              additions: previewDetailFile.additions,
                              deletions: previewDetailFile.deletions,
                              diff: entry.diff,
                            }))}
                            selectedPath={previewDetailFile.path}
                            stickyHeaderMode="controls-only"
                            embeddedAnchorVariant="modal-pager"
                            toolbarLayout="inline-actions"
                            headerControlsTarget={
                              historyPreviewHeaderControlsTarget
                            }
                            onRequestClose={() => setPreviewFileKey(null)}
                            focusSelectedFileOnly
                            allowEditing={false}
                            readOnlyAlignedCompare
                            fullDiffLoader={previewModalFullDiffLoader}
                            fullDiffSourceKey={selectedCommitSha}
                            diffStyle={diffViewMode}
                            onDiffStyleChange={setDiffViewMode}
                            onCreateCodeAnnotation={onCreateCodeAnnotation}
                            onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                            codeAnnotations={codeAnnotations}
                            codeAnnotationSurface="modal-diff-view"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
          {worktreePreviewFile && (
            <div
              className="git-history-diff-modal-overlay"
              role="presentation"
              onClick={closeWorktreePreview}
            >
              <div
                className={`git-history-diff-modal ${isHistoryDiffModalMaximized ? "is-maximized" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={worktreePreviewFile.path}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="git-history-diff-modal-header">
                  <div className="git-history-diff-modal-title">
                    <span
                      className={`git-history-file-status git-status-${worktreePreviewFile.status.toLowerCase()}`}
                    >
                      {worktreePreviewFile.status}
                    </span>
                    <span className="git-history-tree-icon is-file" aria-hidden>
                      <FileIcon filePath={worktreePreviewFile.path} />
                    </span>
                    <span className="git-history-diff-modal-path">
                      {worktreePreviewFile.path}
                    </span>
                    <span className="git-history-diff-modal-stats">
                      <span className="is-add">
                        +{worktreePreviewFile.additions}
                      </span>
                      <span className="is-sep">/</span>
                      <span className="is-del">
                        -{worktreePreviewFile.deletions}
                      </span>
                    </span>
                  </div>
                  <div
                    className="git-history-diff-modal-actions"
                    ref={setHistoryPreviewHeaderControlsTarget}
                  >
                    <button
                      type="button"
                      className="git-history-diff-modal-close"
                      onClick={() =>
                        setIsHistoryDiffModalMaximized((value) => !value)
                      }
                      aria-label={
                        isHistoryDiffModalMaximized
                          ? t("common.restore")
                          : t("menu.maximize")
                      }
                      title={
                        isHistoryDiffModalMaximized
                          ? t("common.restore")
                          : t("menu.maximize")
                      }
                    >
                      <span
                        className="git-history-diff-modal-close-glyph"
                        aria-hidden
                      >
                        {isHistoryDiffModalMaximized ? "❐" : "□"}
                      </span>
                    </button>
                  </div>
                </div>
                {worktreePreviewError ? (
                  <div className="git-history-error">
                    {localizeKnownGitError(worktreePreviewError) ??
                      worktreePreviewError}
                  </div>
                ) : null}
                {worktreePreviewLoading ? (
                  <div className="git-history-empty">{t("common.loading")}</div>
                ) : worktreePreviewFile.isBinary ||
                  !(worktreePreviewFile.diff ?? "").trim() ? (
                  <pre className="git-history-diff-modal-code">
                    {worktreePreviewDiffText}
                  </pre>
                ) : (
                  <div className="git-history-diff-modal-viewer">
                    <WorkspaceEditableDiffReviewSurface
                      workspaceId={workspaceId}
                      workspacePath={workspace?.path ?? null}
                      files={worktreePreviewDiffEntries.map((entry) => ({
                        filePath: entry.path,
                        status: entry.status,
                        additions: worktreePreviewFile.additions,
                        deletions: worktreePreviewFile.deletions,
                        diff: entry.diff,
                        isImage: entry.isImage,
                        oldImageData: entry.oldImageData,
                        newImageData: entry.newImageData,
                        oldImageMime: entry.oldImageMime,
                        newImageMime: entry.newImageMime,
                      }))}
                      selectedPath={worktreePreviewFile.path}
                      stickyHeaderMode="controls-only"
                      embeddedAnchorVariant="modal-pager"
                      toolbarLayout="inline-actions"
                      headerControlsTarget={historyPreviewHeaderControlsTarget}
                      onRequestClose={closeWorktreePreview}
                      focusSelectedFileOnly
                      allowEditing
                      fullDiffLoader={worktreePreviewFullDiffLoader}
                      fullDiffSourceKey={worktreePreviewFile.path}
                      diffStyle={diffViewMode}
                      onDiffStyleChange={setDiffViewMode}
                      onCreateCodeAnnotation={onCreateCodeAnnotation}
                      onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                      codeAnnotations={codeAnnotations}
                      codeAnnotationSurface="modal-diff-view"
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        {renderGitHistoryPanelBranchDiffSection({
          FolderTree,
          GitCommit,
          GitDiffViewer,
          X,
          branchDiffState,
          buildFileKey,
          closeBranchDiff,
          codeAnnotations,
          comparePreviewFileKey,
          diffViewMode,
          formatRelativeTime,
          handleSelectBranchCompareCommit,
          handleSelectWorktreeDiffFile,
          isHistoryDiffModalMaximized,
          onCreateCodeAnnotation,
          onRemoveCodeAnnotation,
          renderChangedFilesSummary,
          setComparePreviewFileKey,
          setDiffViewMode,
          setIsHistoryDiffModalMaximized,
          statusLabel,
          t,
          workspaceId,
        })}
        {comparePreviewDetailFile ? (
          <div
            className="git-history-diff-modal-overlay"
            role="presentation"
            onClick={() => setComparePreviewFileKey(null)}
          >
            <div
              className={`git-history-diff-modal ${isHistoryDiffModalMaximized ? "is-maximized" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={comparePreviewDetailFile.path}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="git-history-diff-modal-header">
                <div className="git-history-diff-modal-title">
                  <span
                    className={`git-history-file-status git-status-${comparePreviewDetailFile.status.toLowerCase()}`}
                  >
                    {comparePreviewDetailFile.status}
                  </span>
                  <span className="git-history-diff-modal-path">
                    {comparePreviewDetailFile.path}
                  </span>
                  <span className="git-history-diff-modal-stats">
                    +{comparePreviewDetailFile.additions} / -
                    {comparePreviewDetailFile.deletions}
                  </span>
                </div>
                <div className="git-history-diff-modal-actions">
                  <button
                    type="button"
                    className="git-history-diff-modal-close"
                    onClick={() =>
                      setIsHistoryDiffModalMaximized((value) => !value)
                    }
                    aria-label={
                      isHistoryDiffModalMaximized
                        ? t("common.restore")
                        : t("menu.maximize")
                    }
                    title={
                      isHistoryDiffModalMaximized
                        ? t("common.restore")
                        : t("menu.maximize")
                    }
                  >
                    <span
                      className="git-history-diff-modal-close-glyph"
                      aria-hidden
                    >
                      {isHistoryDiffModalMaximized ? "❐" : "□"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-history-diff-modal-close"
                    onClick={() => setComparePreviewFileKey(null)}
                    aria-label={t("common.close")}
                    title={t("common.close")}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              {comparePreviewDetailFile.truncated &&
                !comparePreviewDetailFile.isBinary && (
                  <div className="git-history-warning">
                    {t("git.historyDiffTooLargeTruncated", {
                      lineCount: comparePreviewDetailFile.lineCount,
                    })}
                  </div>
                )}
              {comparePreviewDetailFile.isBinary ? (
                <pre className="git-history-diff-modal-code">
                  {comparePreviewDetailFileDiff}
                </pre>
              ) : (
                <div className="git-history-diff-modal-viewer">
                  <GitDiffViewer
                    workspaceId={workspaceId}
                    diffs={comparePreviewDiffEntries}
                    selectedPath={comparePreviewDetailFile.path}
                    isLoading={false}
                    error={null}
                    listView="flat"
                    stickyHeaderMode="controls-only"
                    embeddedAnchorVariant="modal-pager"
                    showContentModeControls
                    diffStyle={diffViewMode}
                    onDiffStyleChange={setDiffViewMode}
                    onCreateCodeAnnotation={onCreateCodeAnnotation}
                    onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                    codeAnnotations={codeAnnotations}
                    codeAnnotationSurface="modal-diff-view"
                  />
                </div>
              )}
            </div>
          </div>
        ) : null}
        {branchContextMenu ? (
          <div className="git-history-branch-context-backdrop">
            <div
              ref={branchContextMenuRef}
              className="git-history-branch-context-menu"
              role="menu"
              style={branchContextMenuStyle}
              onKeyDown={handleBranchContextMenuKeyDown}
            >
              {branchContextTrackingSummary ? (
                <div
                  className="git-history-branch-context-tracking"
                  aria-label={t("git.upstream")}
                >
                  <span className="git-history-branch-context-tracking-text">
                    {branchContextTrackingSummary}
                  </span>
                </div>
              ) : null}
              {branchContextActions.map((action) => (
                <div
                  key={action.id}
                  className={`git-history-branch-context-item-wrap${action.dividerBefore ? " with-divider" : ""}`}
                >
                  <button
                    type="button"
                    className={`git-history-branch-context-item${action.disabled ? " is-disabled" : ""}${
                      action.tone === "danger" ? " is-danger" : ""
                    }`}
                    role="menuitem"
                    disabled={action.disabled}
                    title={action.disabledReason ?? undefined}
                    onClick={() => {
                      action.onSelect();
                    }}
                  >
                    <span className="git-history-branch-context-item-main">
                      <span className="git-history-branch-context-item-icon">
                        {action.icon}
                      </span>
                      <span className="git-history-branch-context-item-label">
                        {action.label}
                      </span>
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {commitContextMenu ? (
          <div
            className="git-history-commit-context-menu"
            role="menu"
            style={{
              top: Math.max(8, commitContextMenu.y),
              left: Math.max(8, commitContextMenu.x),
            }}
            onClick={(event) => event.stopPropagation()}
          >
            {contextPrimaryActionGroups.map(({ groupKey, items }) => (
              <div key={groupKey} className="git-history-commit-context-group">
                {items.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    role="menuitem"
                    className="git-history-commit-context-item"
                    disabled={action.disabled}
                    title={action.disabledReason ?? action.label}
                    onClick={() => {
                      if (action.disabled) {
                        return;
                      }
                      runCommitAction(action.id, commitContextMenu.commitSha);
                      setCommitContextMenu(null);
                    }}
                  >
                    <span
                      className="git-history-commit-context-item-icon"
                      aria-hidden
                    >
                      {getCommitActionIcon(action.id, 13)}
                    </span>
                    <span className="git-history-commit-context-item-label">
                      {action.label}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            {contextWriteActions.length > 0 ? (
              <div className="git-history-commit-context-group">
                <button
                  type="button"
                  role="menuitem"
                  className="git-history-commit-context-item is-more"
                  disabled={contextWriteActions.every(
                    (action) => action.disabled,
                  )}
                  title={
                    contextMoreDisabledReason ?? t("git.historyMoreOperations")
                  }
                  onClick={() => setCommitContextMoreOpen((prev) => !prev)}
                >
                  <span
                    className="git-history-commit-context-item-icon"
                    aria-hidden
                  >
                    <LayoutGrid size={13} strokeWidth={1.9} />
                  </span>
                  <span className="git-history-commit-context-item-label">
                    {t("git.historyMoreOperations")}
                  </span>
                  <span
                    className={`git-history-commit-context-item-chevron${commitContextMoreOpen ? " is-open" : ""}`}
                    aria-hidden
                  >
                    <ChevronRight size={13} strokeWidth={2} />
                  </span>
                </button>
                {commitContextMoreOpen ? (
                  <div
                    className="git-history-commit-context-submenu"
                    role="menu"
                  >
                    {contextWriteActions.map((action) => (
                      <button
                        key={action.id}
                        type="button"
                        role="menuitem"
                        className="git-history-commit-context-item"
                        disabled={action.disabled}
                        title={action.disabledReason ?? action.label}
                        onClick={() => {
                          if (action.disabled) {
                            return;
                          }
                          runCommitAction(
                            action.id,
                            commitContextMenu.commitSha,
                          );
                          setCommitContextMenu(null);
                        }}
                      >
                        <span
                          className="git-history-commit-context-item-icon"
                          aria-hidden
                        >
                          {getCommitActionIcon(action.id, 13)}
                        </span>
                        <span className="git-history-commit-context-item-label">
                          {action.label}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {prContentMenu ? (
          <RendererContextMenu
            menu={prContentMenu}
            onClose={() => setPrContentMenu(null)}
          />
        ) : null}
        {renderGitHistoryPanelCreatePrDialog({
          CREATE_PR_PREVIEW_COMMIT_LIMIT,
          ChevronDown,
          ChevronLeft,
          CircleAlert,
          CircleCheck,
          Copy,
          FileText,
          FolderTree,
          GitBranch,
          GitCommit,
          GitHistoryInlinePicker,
          GitPullRequestCreate,
          HardDrive,
          LoaderCircle,
          MessageSquareText,
          RefreshCw,
          buildFileKey,
          closeCreatePrDialog,
          createPortal,
          createPrBaseBranchOptions,
          createPrBaseRepoOptions,
          createPrCanConfirm,
          createPrCompareBranchOptions,
          createPrContentElapsedSec,
          createPrContentEngine,
          createPrContentError,
          createPrContentGenerating,
          createPrContentPrerequisitesMissing,
          createPrContentSlow,
          createPrContentSuccessAt,
          createPrCopiedPrUrl,
          createPrCopiedRetryCommand,
          createPrDefaultsError,
          createPrDefaultsLoading,
          createPrDialogOpen,
          createPrForm,
          createPrFormFlashAt,
          createPrHeadRepoOptions,
          createPrHeadRepositoryValue,
          createPrPreviewBaseOnlyCount,
          createPrPreviewBaseRef,
          createPrPreviewCommits,
          createPrPreviewDetails,
          createPrPreviewDetailsError,
          createPrPreviewDetailsLoading,
          createPrPreviewError,
          createPrPreviewExpanded,
          createPrPreviewHasMore,
          createPrPreviewHeadRef,
          createPrPreviewLoading,
          createPrPreviewSelectedCommit,
          createPrPreviewSelectedSha,
          createPrResult,
          createPrResultHeadline,
          createPrStages,
          createPrSubmitting,
          documentContentNode,
          extractCommitBody,
          formatRelativeTime,
          handleConfirmCreatePr,
          handleCopyCreatePrRetryCommand,
          handleCopyCreatePrUrl,
          handleCreatePrHeadRepositoryChange,
          isCreatePrDialogMaximized,
          loadCreatePrCommitPreview,
          localizeKnownGitError,
          openPrContentGenerationMenu,
          setCreatePrForm,
          setCreatePrPreviewExpanded,
          setCreatePrPreviewSelectedSha,
          setIsCreatePrDialogMaximized,
          t,
        })}
        {documentContentNode ? null : renderGitHistoryPanelDialogs(scope)}
      </div>
    </div>
  );
}
