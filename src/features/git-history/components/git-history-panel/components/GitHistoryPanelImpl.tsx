import { ask } from "@tauri-apps/plugin-dialog";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import {
  clampRendererContextMenuPosition,
  type RendererContextMenuItem,
  type RendererContextMenuState,
} from "../../../../../components/ui/RendererContextMenu";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import Download from "lucide-react/dist/esm/icons/download";
import History from "lucide-react/dist/esm/icons/history";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import ChevronsDownUp from "lucide-react/dist/esm/icons/chevrons-down-up";
import ChevronsUpDown from "lucide-react/dist/esm/icons/chevrons-up-down";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check";
import Cloud from "lucide-react/dist/esm/icons/cloud";
import CloudDownload from "lucide-react/dist/esm/icons/cloud-download";
import Copy from "lucide-react/dist/esm/icons/copy";
import FileText from "lucide-react/dist/esm/icons/file-text";
import Folder from "lucide-react/dist/esm/icons/folder";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import GitCommit from "lucide-react/dist/esm/icons/git-commit-horizontal";
import GitMerge from "lucide-react/dist/esm/icons/git-merge";
import GitPullRequestCreate from "lucide-react/dist/esm/icons/git-pull-request-create";
import HardDrive from "lucide-react/dist/esm/icons/hard-drive";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import MessageSquareText from "lucide-react/dist/esm/icons/message-square-text";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Repeat from "lucide-react/dist/esm/icons/repeat";
import Search from "lucide-react/dist/esm/icons/search";
import ShieldAlert from "lucide-react/dist/esm/icons/shield-alert";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Upload from "lucide-react/dist/esm/icons/upload";
import X from "lucide-react/dist/esm/icons/x";
import type {
  GitBranchListItem,
  GitCommitDiff,
  GitCommitDetails,
  GitHistoryCommit,
  GitPrWorkflowDefaults,
  GitPrWorkflowResult,
  WorkspaceInfo,
} from "../../../../../types";

import type {
  CommitMessageEngine,
  CommitMessageLanguage,
} from "../../../../../services/tauri/commitMessage";
import {
  checkoutGitBranch,
  cherryPickCommit,
  createGitPrWorkflow,
  createGitBranchFromBranch,
  createGitBranchFromCommit,
  deleteGitBranch,
  fetchGit,
  getGitPrWorkflowDefaults,
  type GitPullStrategyOption,
  getGitBranchCompareCommits,
  getGitCommitDiff,
  getGitDiffs,
  getGitFileFullDiff,
  getGitStatus,
  getGitCommitDetails,
  getGitPushPreview,
  getGitWorktreeDiffAgainstBranch,
  getGitWorktreeDiffFileAgainstBranch,
  generatePullRequestContent,
  listGitRoots,
  mergeGitBranch,
  pullGit,
  pushGit,
  rebaseGitBranch,
  renameGitBranch,
  resetGitCommit,
  revertCommit,
  syncGit,
  updateGitBranch,
} from "../../../../../services/tauri";
import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../../../services/clientStorage";
import { copyTextToClipboard } from "../../../../../utils/clipboard";
import { isEngineExecutionEnabled } from "../../../../../utils/engineExecutionPolicy";
import {
  readLastCommitMessageConfig,
  saveLastCommitMessageConfig,
} from "../../../../../utils/commitMessage";
import { pushErrorToast } from "../../../../../services/toasts";
import { FileIcon } from "../../../../../components/FileIcon";
import { GitDiffViewer } from "../../../../git/components/GitDiffViewer";
import { GitHistoryWorktreePanel } from "../../GitHistoryWorktreePanel";
import {
  isWorkingTreeDirtyBlockingError,
  localizeGitErrorMessage,
} from "../../../gitErrorI18n";
import { useGitHistoryPanelInteractions } from "../hooks/useGitHistoryPanelInteractions";
import { useGitHistoryPanelDataLoading } from "./useGitHistoryPanelDataLoading";
import { useGitHistoryRepositoryOptions } from "../hooks/useGitHistoryRepositoryOptions";
import {
  buildSingleRepositoryBranchCatalog,
  useGitHistoryRepositoryBranchCatalogs,
} from "../hooks/useGitHistoryRepositoryBranchCatalogs";
import {
  useGitHistoryCommitFilters,
  type GitHistoryRequestFilters,
} from "../hooks/useGitHistoryCommitFilters";
import { buildGitHistoryGraphLayout } from "../utils/gitHistoryGraphLayout";
import type { GitHistoryCommitFiltersProps } from "./GitHistoryCommitFilters";
import {
  GIT_REPOSITORY_ACTION_LABEL_KEYS,
  subscribeGitRepositoryActionIntent,
} from "../../../../git/types/gitRepositoryActions";
import { renderGitHistoryPanelView } from "./GitHistoryPanelView";
import {
  BRANCHES_MIN_WIDTH,
  COMMITS_MIN_WIDTH,
  COMPACT_LAYOUT_BREAKPOINT,
  CREATE_PR_PREVIEW_COMMIT_LIMIT,
  DEFAULT_DETAILS_SPLIT,
  DETAILS_MIN_WIDTH,
  DETAILS_SPLIT_MAX,
  DETAILS_SPLIT_MIN,
  DISABLE_HISTORY_ACTION_BUTTONS,
  DISABLE_HISTORY_COMMIT_ACTIONS,
  OVERVIEW_MIN_WIDTH,
  PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT,
  PUSH_TARGET_MENU_MAX_HEIGHT,
  PUSH_TARGET_MENU_MIN_HEIGHT,
  PUSH_TARGET_MENU_VIEWPORT_PADDING,
  VERTICAL_SPLITTER_SIZE,
  buildCreatePrInitialStages,
  clamp,
  extractCommitBody,
  getCommitActionIcon,
  getDefaultColumnWidths,
  getSortOrderValue,
  mapCreatePrStagesFromResult,
  scrollElementToTop,
  sortOptionsWithPriority,
  splitGitHubRepo,
  uniqueNonEmpty,
  type CreatePrStageView,
} from "./GitHistoryPanelImplHelpers";
import type {
  BranchGroup,
  BranchMenuSource,
  BranchContextMenuState,
  BranchDiffState,
  CommitContextMenuState,
  CreatePrFormState,
  ForceDeleteDialogMode,
  ForceDeleteDialogState,
  GitHistoryPanelProps,
  GitHistoryPanelPersistedState,
  GitOperationErrorState,
  GitOperationNoticeState,
  GitResetMode,
  PushTargetBranchGroup,
  WorktreePreviewFile,
} from "./GitHistoryPanelTypes";
import {
  ActionSurface,
  GitHistoryInlinePicker,
  GitHistoryProjectPicker,
  type GitHistoryInlinePickerOption,
  type GitHistoryPickerOption,
} from "./GitHistoryPanelPickers";
import {
  formatRelativeTime,
  statusLabel,
  buildFileKey,
  getTreeLineOpacity,
  renderChangedFilesSummary,
  getPathLeafName,
  collectDirPaths,
  pickSelectedFileKey,
  buildFileTreeItems,
  getBranchScope,
  getBranchLeafName,
  trimRemotePrefix,
  getSpecialBranchBadges,
} from "../utils/gitHistoryPanelSharedUtils";
import type { GitPushTargetHistoryEntry } from "../utils/pushTargetHistory";

export { getDefaultColumnWidths } from "./GitHistoryPanelImplHelpers";

export const GitHistoryPanel = memo(function GitHistoryPanel({
  workspace,
  workspaces = [],
  groupedWorkspaces = [],
  selectedProjectWorkspaceId = workspace?.id ?? null,
  repositories: repositoriesOverride,
  selectedRepositoryRoot = null,
  onSelectRepository,
  onSelectWorkspace,
  onSelectWorkspacePath,
  onOpenDiffPath,
  onRequestClose,
  listView: listViewProp,
  onListViewChange,
  toolbarTabsNode,
  documentContentNode,
  activeDocumentTabId,
  onCreateCodeAnnotation,
  onRemoveCodeAnnotation,
  codeAnnotations,
}: GitHistoryPanelProps) {
  const { t } = useTranslation();
  const owner = workspace?.name ?? "";
  const trimmed = (value: string) => value.trim();
  const strokeWidth = 1.5;
  const workspaceId = workspace?.id ?? null;
  const scopedGetGitStatus = useCallback(
    (targetWorkspaceId: string) =>
      selectedRepositoryRoot === null
        ? getGitStatus(targetWorkspaceId)
        : getGitStatus(targetWorkspaceId, selectedRepositoryRoot),
    [selectedRepositoryRoot],
  );
  const scopedGetGitDiffs = useCallback(
    (targetWorkspaceId: string) =>
      selectedRepositoryRoot === null
        ? getGitDiffs(targetWorkspaceId)
        : getGitDiffs(targetWorkspaceId, selectedRepositoryRoot),
    [selectedRepositoryRoot],
  );
  const scopedGetGitCommitDetails = useCallback(
    (targetWorkspaceId: string, commitHash: string, maxDiffLines?: number) =>
      selectedRepositoryRoot === null
        ? maxDiffLines === undefined
          ? getGitCommitDetails(targetWorkspaceId, commitHash)
          : getGitCommitDetails(targetWorkspaceId, commitHash, maxDiffLines)
        : getGitCommitDetails(
            targetWorkspaceId,
            commitHash,
            maxDiffLines ?? 10_000,
            selectedRepositoryRoot,
          ),
    [selectedRepositoryRoot],
  );
  const scopedGetGitPushPreview = useCallback(
    (
      targetWorkspaceId: string,
      options: Parameters<typeof getGitPushPreview>[1],
    ) =>
      getGitPushPreview(
        targetWorkspaceId,
        selectedRepositoryRoot === null
          ? options
          : { ...options, repositoryRoot: selectedRepositoryRoot },
      ),
    [selectedRepositoryRoot],
  );
  const scopedCheckoutGitBranch = useCallback(
    (targetWorkspaceId: string, name: string) =>
      selectedRepositoryRoot === null
        ? checkoutGitBranch(targetWorkspaceId, name)
        : checkoutGitBranch(targetWorkspaceId, name, selectedRepositoryRoot),
    [selectedRepositoryRoot],
  );
  const scopedFetchGit = useCallback(
    (targetWorkspaceId: string, remote?: string | null) =>
      selectedRepositoryRoot === null
        ? remote === undefined
          ? fetchGit(targetWorkspaceId)
          : fetchGit(targetWorkspaceId, remote)
        : fetchGit(targetWorkspaceId, remote, selectedRepositoryRoot),
    [selectedRepositoryRoot],
  );
  const scopedPullGit = useCallback(
    (targetWorkspaceId: string, options?: Parameters<typeof pullGit>[1]) =>
      selectedRepositoryRoot === null
        ? pullGit(targetWorkspaceId, options)
        : pullGit(targetWorkspaceId, options, selectedRepositoryRoot),
    [selectedRepositoryRoot],
  );
  const scopedPushGit = useCallback(
    (targetWorkspaceId: string, options?: Parameters<typeof pushGit>[1]) =>
      selectedRepositoryRoot === null
        ? pushGit(targetWorkspaceId, options)
        : pushGit(targetWorkspaceId, options, selectedRepositoryRoot),
    [selectedRepositoryRoot],
  );
  const scopedSyncGit = useCallback(
    (targetWorkspaceId: string) =>
      selectedRepositoryRoot === null
        ? syncGit(targetWorkspaceId)
        : syncGit(targetWorkspaceId, selectedRepositoryRoot),
    [selectedRepositoryRoot],
  );
  const scopedUpdateGitBranch = useCallback(
    (targetWorkspaceId: string, branchName: string) =>
      selectedRepositoryRoot === null
        ? updateGitBranch(targetWorkspaceId, branchName)
        : updateGitBranch(
            targetWorkspaceId,
            branchName,
            selectedRepositoryRoot,
          ),
    [selectedRepositoryRoot],
  );
  const projectWorkspace =
    workspaces.find((entry) => entry.id === selectedProjectWorkspaceId) ??
    (workspace?.id === selectedProjectWorkspaceId ? workspace : null);
  const handleRepositoryOptionsError = useCallback(
    (message: string) => {
      pushErrorToast({ title: t("git.historyTitle"), message });
    },
    [t],
  );
  const repositories = useGitHistoryRepositoryOptions({
    workspace: projectWorkspace,
    repositoriesOverride,
    onError: handleRepositoryOptionsError,
  });
  const [
    repositoryBranchCatalogRefreshKey,
    setRepositoryBranchCatalogRefreshKey,
  ] = useState(0);
  const multiRepositoryBranchCatalogs = useGitHistoryRepositoryBranchCatalogs({
    workspaceId,
    repositories,
    enabled: repositories.length > 1 && Boolean(onSelectRepository),
    refreshKey: repositoryBranchCatalogRefreshKey,
  });
  const repositoryRootName = useMemo(() => {
    const selectedRepositoryName = repositories
      .find(
        (repository) => repository.repositoryRoot === selectedRepositoryRoot,
      )
      ?.displayName?.trim();
    return (
      selectedRepositoryName ||
      getPathLeafName(selectedRepositoryRoot) ||
      getPathLeafName(workspace?.settings?.gitRoot) ||
      getPathLeafName(workspace?.path) ||
      workspace?.name?.trim() ||
      workspace?.id ||
      ""
    );
  }, [
    repositories,
    selectedRepositoryRoot,
    workspace?.id,
    workspace?.name,
    workspace?.path,
    workspace?.settings?.gitRoot,
  ]);
  const persistenceKey = useMemo(
    () => `gitHistoryPanel:${workspaceId ?? "default"}`,
    [workspaceId],
  );
  const persistedPanelState = useMemo(
    () =>
      getClientStoreSync<GitHistoryPanelPersistedState>(
        "layout",
        persistenceKey,
      ) ?? {},
    [persistenceKey],
  );
  const workbenchGridRef = useRef<HTMLDivElement | null>(null);
  const mainGridRef = useRef<HTMLDivElement | null>(null);
  const detailsBodyRef = useRef<HTMLDivElement | null>(null);
  const commitListRef = useRef<HTMLDivElement | null>(null);
  const branchContextMenuRef = useRef<HTMLDivElement | null>(null);
  const historySnapshotIdRef = useRef<string | null>(null);
  const historyRequestFiltersRef = useRef<GitHistoryRequestFilters | null>(
    null,
  );
  const historyRequestGenerationRef = useRef(0);
  const historyFirstPageLoadingRef = useRef(false);
  const historyAppendLoadingRef = useRef(false);
  const createBranchNameInputRef = useRef<HTMLInputElement | null>(null);
  const renameBranchNameInputRef = useRef<HTMLInputElement | null>(null);
  const commitFullDiffCacheRef = useRef(new Map<string, Map<string, string>>());
  const branchDiffCacheRef = useRef<Map<string, GitCommitDiff>>(new Map());
  const branchCompareDetailsCacheRef = useRef<Map<string, GitCommitDetails>>(
    new Map(),
  );
  const initialColumnWidths = useMemo(
    () =>
      getDefaultColumnWidths(
        typeof window !== "undefined" ? window.innerWidth : 1600,
      ),
    [],
  );

  const [localBranches, setLocalBranches] = useState<GitBranchListItem[]>([]);
  const [remoteBranches, setRemoteBranches] = useState<GitBranchListItem[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const repositoryBranchCatalogs = useMemo(
    () =>
      repositories.length === 1
        ? buildSingleRepositoryBranchCatalog(
            repositories[0],
            localBranches,
            remoteBranches,
            currentBranch,
          )
        : multiRepositoryBranchCatalogs,
    [
      currentBranch,
      localBranches,
      multiRepositoryBranchCatalogs,
      remoteBranches,
      repositories,
    ],
  );
  const [branchQuery, setBranchQuery] = useState("");
  const [localSectionExpanded, setLocalSectionExpanded] = useState(true);
  const [remoteSectionExpanded, setRemoteSectionExpanded] = useState(true);
  const [expandedLocalScopes, setExpandedLocalScopes] = useState<Set<string>>(
    new Set(),
  );
  const [expandedRemoteScopes, setExpandedRemoteScopes] = useState<Set<string>>(
    new Set(),
  );
  const isListViewControlled = onListViewChange !== undefined;
  const [uncontrolledListView, setUncontrolledListView] = useState<
    "flat" | "tree"
  >(listViewProp ?? "flat");
  const overviewListView = isListViewControlled
    ? (listViewProp ?? "flat")
    : uncontrolledListView;
  const setOverviewListView = useCallback(
    (value: SetStateAction<"flat" | "tree">) => {
      const resolveNext = (previous: "flat" | "tree") =>
        typeof value === "function" ? value(previous) : value;
      if (isListViewControlled) {
        const next = resolveNext(listViewProp ?? "flat");
        onListViewChange?.(next);
        return;
      }
      setUncontrolledListView((previous) => resolveNext(previous));
    },
    [isListViewControlled, listViewProp, onListViewChange],
  );

  useEffect(() => {
    if (!isListViewControlled && listViewProp) {
      setUncontrolledListView(listViewProp);
    }
  }, [isListViewControlled, listViewProp]);
  const [overviewCommitSectionCollapsed, setOverviewCommitSectionCollapsed] =
    useState(true);
  const [workingTreeChangedFiles, setWorkingTreeChangedFiles] = useState(0);
  const [workingTreeTotalAdditions, setWorkingTreeTotalAdditions] = useState(0);
  const [workingTreeTotalDeletions, setWorkingTreeTotalDeletions] = useState(0);
  const [, setWorkingTreeStatusError] = useState<string | null>(null);

  const [commits, setCommits] = useState<GitHistoryCommit[]>([]);
  const [graphFirstParentOnly, setGraphFirstParentOnly] = useState(false);
  const [graphHideNoise, setGraphHideNoise] = useState(false);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const {
    selectedBranch,
    setSelectedBranch,
    commitQuery,
    commitAuthor,
    commitDatePreset,
    createHistoryRequestFilters,
    commitFilterSurface: baseCommitFilterSurface,
  } = useGitHistoryCommitFilters({
    workspaceId,
    selectedRepositoryRoot,
    persistedPanelState,
    currentBranch,
    localBranches,
    remoteBranches,
    commits,
  });

  // Author / query / date filters return a sparse subset whose parent SHAs often
  // point at commits not on the page. Compact those links so the graph does not
  // open phantom rainbow lanes with no nodes.
  const graphSparseList = Boolean(
    commitAuthor.trim()
    || commitQuery.trim()
    || commitDatePreset !== "all",
  );
  const graphProjection = useMemo(
    () =>
      buildGitHistoryGraphLayout(commits, {
        firstParentOnly: graphFirstParentOnly,
        hideNoise: graphHideNoise,
        sparseList: graphSparseList,
      }),
    [commits, graphFirstParentOnly, graphHideNoise, graphSparseList],
  );
  const displayCommits = graphProjection.commits as GitHistoryCommit[];
  const commitGraphLayout = graphProjection.layout;

  const commitFilterSurface = useMemo<
    Omit<GitHistoryCommitFiltersProps, "headerTitle">
  >(
    () => ({
      ...baseCommitFilterSurface,
      graphFirstParentOnly,
      graphHideNoise,
      onGraphFirstParentOnlyChange: setGraphFirstParentOnly,
      onGraphHideNoiseChange: setGraphHideNoise,
    }),
    [
      baseCommitFilterSurface,
      graphFirstParentOnly,
      graphHideNoise,
    ],
  );

  const [selectedCommitSha, setSelectedCommitSha] = useState<string | null>(
    () => persistedPanelState.selectedCommitSha ?? null,
  );

  useEffect(() => {
    if (!selectedCommitSha || displayCommits.length === 0) {
      return;
    }
    if (!displayCommits.some((entry) => entry.sha === selectedCommitSha)) {
      setSelectedCommitSha(displayCommits[0]?.sha ?? null);
    }
  }, [displayCommits, selectedCommitSha]);

  const [details, setDetails] = useState<GitCommitDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null);
  const [previewFileKey, setPreviewFileKey] = useState<string | null>(null);
  const [comparePreviewFileKey, setComparePreviewFileKey] = useState<
    string | null
  >(null);
  const [isHistoryDiffModalMaximized, setIsHistoryDiffModalMaximized] =
    useState(false);
  const [
    historyPreviewHeaderControlsTarget,
    setHistoryPreviewHeaderControlsTarget,
  ] = useState<HTMLDivElement | null>(null);
  const [worktreePreviewFile, setWorktreePreviewFile] =
    useState<WorktreePreviewFile | null>(null);
  const [worktreePreviewLoading, setWorktreePreviewLoading] = useState(false);
  const [worktreePreviewError, setWorktreePreviewError] = useState<
    string | null
  >(null);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const [detailsSplitRatio, setDetailsSplitRatio] = useState(() =>
    clamp(
      persistedPanelState.detailsSplitRatio ?? DEFAULT_DETAILS_SPLIT,
      DETAILS_SPLIT_MIN,
      DETAILS_SPLIT_MAX,
    ),
  );
  const [overviewWidth, setOverviewWidth] = useState(
    () =>
      persistedPanelState.overviewWidth ?? initialColumnWidths.overviewWidth,
  );
  const [branchesWidth, setBranchesWidth] = useState(
    () =>
      persistedPanelState.branchesWidth ?? initialColumnWidths.branchesWidth,
  );
  const [commitsWidth, setCommitsWidth] = useState(
    () => persistedPanelState.commitsWidth ?? initialColumnWidths.commitsWidth,
  );
  const [diffViewMode, setDiffViewMode] = useState<"split" | "unified">(
    () => persistedPanelState.diffStyle ?? "split",
  );
  const [desktopSplitLayout, setDesktopSplitLayout] = useState(() =>
    typeof window !== "undefined"
      ? window.innerWidth > COMPACT_LAYOUT_BREAKPOINT
      : true,
  );

  const [operationLoading, setOperationLoading] = useState<string | null>(null);
  const [operationNotice, setOperationNotice] =
    useState<GitOperationNoticeState | null>(null);
  const operationNoticeTimerRef = useRef<number | null>(null);
  const createPrProgressTimerRef = useRef<number | null>(null);
  const createPrDefaultsLoadTokenRef = useRef(0);
  const createPrPreviewLoadTokenRef = useRef(0);
  const createPrPreviewDetailsLoadTokenRef = useRef(0);
  const createPrContentGenerationTokenRef = useRef(0);
  const createPrPreviewDetailsCacheRef = useRef<Map<string, GitCommitDetails>>(
    new Map(),
  );
  const [forceDeleteDialogState, setForceDeleteDialogState] =
    useState<ForceDeleteDialogState | null>(null);
  const forceDeleteDialogResolverRef = useRef<
    ((confirmed: boolean) => void) | null
  >(null);
  const [forceDeleteCountdown, setForceDeleteCountdown] = useState(0);
  const [forceDeleteCopiedPath, setForceDeleteCopiedPath] = useState(false);
  const [createPrDialogOpen, setCreatePrDialogOpen] = useState(false);
  const [isCreatePrDialogMaximized, setIsCreatePrDialogMaximized] =
    useState(false);
  const [createPrDefaultsLoading, setCreatePrDefaultsLoading] = useState(false);
  const [createPrDefaultsError, setCreatePrDefaultsError] = useState<
    string | null
  >(null);
  const [createPrDefaults, setCreatePrDefaults] =
    useState<GitPrWorkflowDefaults | null>(null);
  const [createPrForm, setCreatePrForm] = useState<CreatePrFormState>({
    upstreamRepo: "",
    baseBranch: "",
    headOwner: "",
    headBranch: "",
    title: "",
    body: "",
    commentAfterCreate: true,
    commentBody: "",
  });
  const [createPrStages, setCreatePrStages] = useState<CreatePrStageView[]>(
    () => buildCreatePrInitialStages((key) => key),
  );
  const [createPrResult, setCreatePrResult] =
    useState<GitPrWorkflowResult | null>(null);
  const [createPrCopiedPrUrl, setCreatePrCopiedPrUrl] = useState(false);
  const [createPrCopiedRetryCommand, setCreatePrCopiedRetryCommand] =
    useState(false);
  const [createPrPreviewLoading, setCreatePrPreviewLoading] = useState(false);
  const [createPrPreviewError, setCreatePrPreviewError] = useState<
    string | null
  >(null);
  const [createPrPreviewCommits, setCreatePrPreviewCommits] = useState<
    GitHistoryCommit[]
  >([]);
  const [createPrPreviewBaseOnlyCount, setCreatePrPreviewBaseOnlyCount] =
    useState(0);
  const [createPrPreviewSelectedSha, setCreatePrPreviewSelectedSha] = useState<
    string | null
  >(null);
  const [createPrPreviewExpanded, setCreatePrPreviewExpanded] = useState(false);
  const [createPrContentGenerating, setCreatePrContentGenerating] =
    useState(false);
  const [createPrContentError, setCreatePrContentError] = useState<
    string | null
  >(null);
  const [createPrContentSuccessAt, setCreatePrContentSuccessAt] = useState<
    number | null
  >(null);
  const [createPrFormFlashAt, setCreatePrFormFlashAt] = useState<number | null>(
    null,
  );
  const [createPrContentStartedAt, setCreatePrContentStartedAt] = useState<
    number | null
  >(null);
  const [createPrContentSlow, setCreatePrContentSlow] = useState(false);
  const [createPrContentElapsedSec, setCreatePrContentElapsedSec] = useState(0);
  const [createPrContentEngine, setCreatePrContentEngine] =
    useState<CommitMessageEngine>("codex");
  const [createPrPreviewDetails, setCreatePrPreviewDetails] =
    useState<GitCommitDetails | null>(null);
  const [createPrPreviewDetailsLoading, setCreatePrPreviewDetailsLoading] =
    useState(false);
  const [createPrPreviewDetailsError, setCreatePrPreviewDetailsError] =
    useState<string | null>(null);
  const [pushDialogOpen, setPushDialogOpen] = useState(false);
  const [pullDialogOpen, setPullDialogOpen] = useState(false);
  const [pullRemote, setPullRemote] = useState("origin");
  const [pullTargetBranch, setPullTargetBranch] = useState("");
  const [pullTargetBranchQuery, setPullTargetBranchQuery] = useState("");
  const [pullRemoteMenuOpen, setPullRemoteMenuOpen] = useState(false);
  const [pullRemoteMenuPlacement, setPullRemoteMenuPlacement] = useState<
    "down" | "up"
  >("up");
  const [pullTargetBranchMenuOpen, setPullTargetBranchMenuOpen] =
    useState(false);
  const [pullTargetBranchActiveScopeTab, setPullTargetBranchActiveScopeTab] =
    useState<string | null>(null);
  const [pullTargetBranchMenuPlacement, setPullTargetBranchMenuPlacement] =
    useState<"down" | "up">("down");
  const [pullOptionsMenuOpen, setPullOptionsMenuOpen] = useState(false);
  const [pullStrategy, setPullStrategy] =
    useState<GitPullStrategyOption | null>(null);
  const [pullNoCommit, setPullNoCommit] = useState(false);
  const [pullNoVerify, setPullNoVerify] = useState(false);
  const pullRemotePickerRef = useRef<HTMLDivElement | null>(null);
  const pullTargetBranchPickerRef = useRef<HTMLDivElement | null>(null);
  const pullTargetBranchFieldRef = useRef<HTMLLabelElement | null>(null);
  const pullTargetBranchMenuRef = useRef<HTMLDivElement | null>(null);
  const pullOptionsMenuRef = useRef<HTMLDivElement | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [fetchDialogOpen, setFetchDialogOpen] = useState(false);
  const [refreshDialogOpen, setRefreshDialogOpen] = useState(false);
  const [syncPreviewLoading, setSyncPreviewLoading] = useState(false);
  const [syncPreviewError, setSyncPreviewError] = useState<string | null>(null);
  const [syncPreviewTargetRemote, setSyncPreviewTargetRemote] =
    useState("origin");
  const [syncPreviewTargetBranch, setSyncPreviewTargetBranch] = useState("");
  const [syncPreviewCommits, setSyncPreviewCommits] = useState<
    GitHistoryCommit[]
  >([]);
  const [syncPreviewTargetFound, setSyncPreviewTargetFound] = useState(true);
  const [pushRemote, setPushRemote] = useState("origin");
  const [pushTargetBranch, setPushTargetBranch] = useState("");
  const [pushTargetBranchQuery, setPushTargetBranchQuery] = useState("");
  const [pushTags, setPushTags] = useState(false);
  const [pushRunHooks, setPushRunHooks] = useState(true);
  const [pushForceWithLease, setPushForceWithLease] = useState(false);
  const [pushToGerrit, setPushToGerrit] = useState(false);
  const [pushTopic, setPushTopic] = useState("");
  const [pushReviewers, setPushReviewers] = useState("");
  const [pushCc, setPushCc] = useState("");
  const [pushTargetHistory, setPushTargetHistory] = useState<
    GitPushTargetHistoryEntry[]
  >([]);
  const [pushRemoteMenuOpen, setPushRemoteMenuOpen] = useState(false);
  const [pushRemoteMenuPlacement, setPushRemoteMenuPlacement] = useState<
    "down" | "up"
  >("up");
  const [pushTargetBranchMenuOpen, setPushTargetBranchMenuOpen] =
    useState(false);
  const [pushTargetBranchActiveScopeTab, setPushTargetBranchActiveScopeTab] =
    useState<string | null>(null);
  const [pushTargetBranchMenuPlacement, setPushTargetBranchMenuPlacement] =
    useState<"down" | "up">("down");
  const pushRemotePickerRef = useRef<HTMLDivElement | null>(null);
  const pushTargetBranchPickerRef = useRef<HTMLDivElement | null>(null);
  const pushTargetBranchFieldRef = useRef<HTMLLabelElement | null>(null);
  const pushTargetBranchMenuRef = useRef<HTMLDivElement | null>(null);
  const [pushPreviewLoading, setPushPreviewLoading] = useState(false);
  const [pushPreviewError, setPushPreviewError] = useState<string | null>(null);
  const [pushPreviewTargetFound, setPushPreviewTargetFound] = useState(true);
  const [pushPreviewHasMore, setPushPreviewHasMore] = useState(false);
  const [pushPreviewCommits, setPushPreviewCommits] = useState<
    GitHistoryCommit[]
  >([]);
  const [pushPreviewSelectedSha, setPushPreviewSelectedSha] = useState<
    string | null
  >(null);
  const [pushPreviewDetails, setPushPreviewDetails] =
    useState<GitCommitDetails | null>(null);
  const [pushPreviewDetailsLoading, setPushPreviewDetailsLoading] =
    useState(false);
  const [pushPreviewDetailsError, setPushPreviewDetailsError] = useState<
    string | null
  >(null);
  const [pushPreviewExpandedDirs, setPushPreviewExpandedDirs] = useState<
    Set<string>
  >(new Set());
  const [pushPreviewSelectedFileKey, setPushPreviewSelectedFileKey] = useState<
    string | null
  >(null);
  const [pushPreviewModalFileKey, setPushPreviewModalFileKey] = useState<
    string | null
  >(null);
  const pushPreviewLoadTokenRef = useRef(0);
  const pushPreviewDetailsLoadTokenRef = useRef(0);
  const [branchContextMenu, setBranchContextMenu] =
    useState<BranchContextMenuState | null>(null);
  const [branchDiffState, setBranchDiffState] =
    useState<BranchDiffState | null>(null);
  const [commitContextMenu, setCommitContextMenu] =
    useState<CommitContextMenuState | null>(null);
  const [prContentMenu, setPrContentMenu] =
    useState<RendererContextMenuState | null>(null);
  const [commitContextMoreOpen, setCommitContextMoreOpen] = useState(false);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetTargetSha, setResetTargetSha] = useState<string | null>(null);
  const [resetMode, setResetMode] = useState<GitResetMode>("mixed");
  const [createBranchDialogOpen, setCreateBranchDialogOpen] = useState(false);
  const [createBranchSource, setCreateBranchSource] = useState("");
  const [createBranchName, setCreateBranchName] = useState("");
  const [renameBranchDialogOpen, setRenameBranchDialogOpen] = useState(false);
  const [renameBranchSource, setRenameBranchSource] = useState("");
  const [renameBranchName, setRenameBranchName] = useState("");
  const [repositoryUnavailable, setRepositoryUnavailable] = useState(false);
  const [fallbackGitRoots, setFallbackGitRoots] = useState<string[]>([]);
  const [fallbackGitRootsLoading, setFallbackGitRootsLoading] = useState(false);
  const [fallbackGitRootsError, setFallbackGitRootsError] = useState<
    string | null
  >(null);
  const [fallbackSelectingRoot, setFallbackSelectingRoot] = useState<
    string | null
  >(null);
  const [workspaceSelectingId, setWorkspaceSelectingId] = useState<
    string | null
  >(null);
  const currentLocalBranchEntry = useMemo(() => {
    if (!currentBranch) {
      return null;
    }
    return localBranches.find((entry) => entry.name === currentBranch) ?? null;
  }, [currentBranch, localBranches]);
  const resolveUpstreamTarget = useCallback(
    (upstream: string | null | undefined) => {
      const value = upstream?.trim();
      if (!value) {
        return {
          remote: "origin",
          branch: currentBranch ?? "main",
        };
      }
      const normalized = value
        .replace(/^refs\/remotes\//, "")
        .replace(/^remotes\//, "");
      const slashIndex = normalized.indexOf("/");
      if (slashIndex <= 0 || slashIndex === normalized.length - 1) {
        return {
          remote: "origin",
          branch: currentBranch ?? "main",
        };
      }
      return {
        remote: normalized.slice(0, slashIndex),
        branch: normalized.slice(slashIndex + 1),
      };
    },
    [currentBranch],
  );
  const closeBranchContextMenu = useCallback(() => {
    setBranchContextMenu(null);
  }, []);
  const closeBranchDiff = useCallback(() => {
    setBranchDiffState(null);
    setComparePreviewFileKey(null);
  }, []);
  const handleOpenBranchContextMenu = useCallback(
    (
      event: MouseEvent<HTMLDivElement>,
      branch: GitBranchListItem,
      source: BranchMenuSource,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedBranch(branch.name);
      setCommitContextMenu(null);
      setBranchContextMenu({
        x: event.clientX,
        y: event.clientY,
        branch,
        source,
      });
    },
    [setSelectedBranch],
  );

  const applyHistorySnapshotId = useCallback((snapshotId: string | null) => {
    historySnapshotIdRef.current = snapshotId;
  }, []);

  const resolveGitRootPath = useCallback(
    (workspacePath: string, relativeRoot: string) => {
      const useBackslash =
        workspacePath.includes("\\") && !workspacePath.includes("/");
      const separator = useBackslash ? "\\" : "/";
      const normalizedRelative = relativeRoot.split("/").join(separator);
      if (workspacePath.endsWith("/") || workspacePath.endsWith("\\")) {
        return `${workspacePath}${normalizedRelative}`;
      }
      return `${workspacePath}${separator}${normalizedRelative}`;
    },
    [],
  );

  const clearCommitAndDetailColumns = useCallback(() => {
    setCommits([]);
    setHistoryTotal(0);
    setHistoryHasMore(false);
    applyHistorySnapshotId(null);
    setSelectedCommitSha(null);
    setDetails(null);
    setDetailsError(null);
    setSelectedFileKey(null);
    setPreviewFileKey(null);
    setExpandedDirs(new Set());
  }, [applyHistorySnapshotId]);

  const clearHistoryColumns = useCallback(() => {
    setLocalBranches([]);
    setRemoteBranches([]);
    setCurrentBranch(null);
    setSelectedBranch("all");
    clearCommitAndDetailColumns();
  }, [clearCommitAndDetailColumns, setSelectedBranch]);

  const { loadHistory, refreshAll } = useGitHistoryPanelDataLoading({
    applyHistorySnapshotId,
    clearCommitAndDetailColumns,
    clearHistoryColumns,
    commitFullDiffCacheRef,
    createHistoryRequestFilters,
    historyAppendLoadingRef,
    historyFirstPageLoadingRef,
    historyRequestFiltersRef,
    historyRequestGenerationRef,
    historySnapshotIdRef,
    persistedPanelState,
    selectedCommitSha,
    selectedRepositoryRoot,
    setCommits,
    setCreateBranchDialogOpen,
    setCreateBranchName,
    setCreateBranchSource,
    setCurrentBranch,
    setDetails,
    setDetailsError,
    setDetailsLoading,
    setExpandedDirs,
    setHistoryError,
    setHistoryHasMore,
    setHistoryLoading,
    setHistoryLoadingMore,
    setHistoryTotal,
    setLocalBranches,
    setPreviewFileKey,
    setRemoteBranches,
    setRepositoryBranchCatalogRefreshKey,
    setRepositoryUnavailable,
    setSelectedBranch,
    setSelectedCommitSha,
    setSelectedFileKey,
    setWorkingTreeChangedFiles,
    setWorkingTreeStatusError,
    setWorkingTreeTotalAdditions,
    setWorkingTreeTotalDeletions,
    workspaceId,
  });

  const filteredLocalBranches = useMemo(() => {
    const needle = branchQuery.trim().toLowerCase();
    if (!needle) {
      return localBranches;
    }
    return localBranches.filter((entry) =>
      entry.name.toLowerCase().includes(needle),
    );
  }, [branchQuery, localBranches]);

  const filteredRemoteBranches = useMemo(() => {
    const needle = branchQuery.trim().toLowerCase();
    if (!needle) {
      return remoteBranches;
    }
    return remoteBranches.filter((entry) =>
      entry.name.toLowerCase().includes(needle),
    );
  }, [branchQuery, remoteBranches]);

  const groupedRemoteBranches = useMemo(() => {
    const groups = new Map<string, GitBranchListItem[]>();
    for (const entry of filteredRemoteBranches) {
      const group = entry.remote ?? entry.name.split("/")[0] ?? "remote";
      const existing = groups.get(group) ?? [];
      existing.push(entry);
      groups.set(group, existing);
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([remote, items]) => ({
        remote,
        items: items
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name)),
      }));
  }, [filteredRemoteBranches]);

  const groupedLocalBranches = useMemo<BranchGroup[]>(() => {
    const groups = new Map<string, GitBranchListItem[]>();
    for (const entry of filteredLocalBranches) {
      const scope = getBranchScope(entry.name);
      const items = groups.get(scope) ?? [];
      items.push(entry);
      groups.set(scope, items);
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => {
        if (left === "__root__") {
          return -1;
        }
        if (right === "__root__") {
          return 1;
        }
        return left.localeCompare(right);
      })
      .map(([key, items]) => ({
        key,
        label:
          key === "__root__" ? t("git.historyRootGroup") : key.toUpperCase(),
        items: items
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name)),
      }));
  }, [filteredLocalBranches, t]);

  const createBranchSourceOptions = useMemo(() => {
    const names = new Set(localBranches.map((entry) => entry.name));
    if (currentBranch) {
      names.add(currentBranch);
    }
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [currentBranch, localBranches]);

  useEffect(() => {
    if (branchQuery.trim()) {
      setLocalSectionExpanded(true);
      setRemoteSectionExpanded(true);
    }
  }, [branchQuery]);

  useEffect(() => {
    setExpandedLocalScopes((prev) => {
      const next = new Set<string>();
      const activeScope = currentBranch ? getBranchScope(currentBranch) : null;
      const searching = branchQuery.trim().length > 0;
      for (const group of groupedLocalBranches) {
        if (
          searching ||
          prev.has(group.key) ||
          group.key === "__root__" ||
          group.key === activeScope
        ) {
          next.add(group.key);
        }
      }
      return next;
    });
  }, [branchQuery, currentBranch, groupedLocalBranches]);

  useEffect(() => {
    setExpandedRemoteScopes((prev) => {
      const next = new Set<string>();
      const searching = branchQuery.trim().length > 0;
      for (const group of groupedRemoteBranches) {
        if (searching || prev.has(group.remote)) {
          next.add(group.remote);
        }
      }
      return next;
    });
  }, [branchQuery, groupedRemoteBranches]);

  useEffect(() => {
    if (!createBranchDialogOpen) {
      return;
    }
    createBranchNameInputRef.current?.focus();
  }, [createBranchDialogOpen]);

  useEffect(() => {
    if (!renameBranchDialogOpen) {
      return;
    }
    renameBranchNameInputRef.current?.focus();
    renameBranchNameInputRef.current?.select();
  }, [renameBranchDialogOpen]);

  useEffect(() => {
    setBranchDiffState(null);
    branchDiffCacheRef.current.clear();
    branchCompareDetailsCacheRef.current.clear();
    setComparePreviewFileKey(null);
  }, [workspaceId]);

  useEffect(() => {
    if (createBranchDialogOpen && branchContextMenu) {
      closeBranchContextMenu();
    }
  }, [branchContextMenu, closeBranchContextMenu, createBranchDialogOpen]);

  useEffect(() => {
    if (renameBranchDialogOpen && branchContextMenu) {
      closeBranchContextMenu();
    }
  }, [branchContextMenu, closeBranchContextMenu, renameBranchDialogOpen]);

  useEffect(() => {
    if (!branchContextMenu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!branchContextMenuRef.current?.contains(target)) {
        closeBranchContextMenu();
      }
    };
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBranchContextMenu();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [branchContextMenu, closeBranchContextMenu]);

  const fileTreeItems = useMemo(() => {
    if (!details) {
      return [];
    }
    return buildFileTreeItems(details.files, expandedDirs, repositoryRootName);
  }, [details, expandedDirs, repositoryRootName]);

  const detailsMessageContent = useMemo(() => {
    if (!details) {
      return "";
    }
    const commitBody = extractCommitBody(details.summary, details.message);
    return commitBody || t("git.historyCommitMetaNoContent");
  }, [details, t]);

  const previewDetailFile = useMemo(() => {
    if (!details || !previewFileKey) {
      return null;
    }
    return (
      details.files.find((entry) => buildFileKey(entry) === previewFileKey) ??
      null
    );
  }, [details, previewFileKey]);

  const previewDetailFileDiff = useMemo(() => {
    if (!previewDetailFile) {
      return null;
    }
    if (previewDetailFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (previewDetailFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [previewDetailFile, t]);

  const previewDiffEntries = useMemo(() => {
    if (!previewDetailFile) {
      return [];
    }
    return [
      {
        path: previewDetailFile.path,
        status: previewDetailFile.status,
        diff: previewDetailFile.diff ?? "",
      },
    ];
  }, [previewDetailFile]);

  const comparePreviewDetailFile = useMemo(() => {
    if (
      !comparePreviewFileKey ||
      !branchDiffState ||
      branchDiffState.mode !== "branch"
    ) {
      return null;
    }
    const selectedCommitDetails = branchDiffState.selectedCommitDetails;
    if (!selectedCommitDetails) {
      return null;
    }
    return (
      selectedCommitDetails.files.find(
        (entry) => buildFileKey(entry) === comparePreviewFileKey,
      ) ?? null
    );
  }, [branchDiffState, comparePreviewFileKey]);

  const comparePreviewDetailFileDiff = useMemo(() => {
    if (!comparePreviewDetailFile) {
      return null;
    }
    if (comparePreviewDetailFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (comparePreviewDetailFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [comparePreviewDetailFile, t]);

  const comparePreviewDiffEntries = useMemo(() => {
    if (!comparePreviewDetailFile) {
      return [];
    }
    return [
      {
        path: comparePreviewDetailFile.path,
        status: comparePreviewDetailFile.status,
        diff: comparePreviewDetailFile.diff ?? "",
      },
    ];
  }, [comparePreviewDetailFile]);

  const worktreePreviewDiffText = useMemo(() => {
    if (!worktreePreviewFile) {
      return null;
    }
    if (worktreePreviewFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (worktreePreviewFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [worktreePreviewFile, t]);

  const worktreePreviewDiffEntries = useMemo(() => {
    if (!worktreePreviewFile) {
      return [];
    }
    return [
      {
        path: worktreePreviewFile.path,
        status: worktreePreviewFile.status,
        diff: worktreePreviewFile.diff ?? "",
        isImage: worktreePreviewFile.isImage,
        oldImageData: worktreePreviewFile.oldImageData,
        newImageData: worktreePreviewFile.newImageData,
        oldImageMime: worktreePreviewFile.oldImageMime,
        newImageMime: worktreePreviewFile.newImageMime,
      },
    ];
  }, [worktreePreviewFile]);

  const pushPreviewFileTreeItems = useMemo(() => {
    if (!pushPreviewDetails) {
      return [];
    }
    return buildFileTreeItems(
      pushPreviewDetails.files,
      pushPreviewExpandedDirs,
      repositoryRootName,
    );
  }, [pushPreviewDetails, pushPreviewExpandedDirs, repositoryRootName]);

  const pushPreviewModalFile = useMemo(() => {
    if (!pushPreviewDetails || !pushPreviewModalFileKey) {
      return null;
    }
    return (
      pushPreviewDetails.files.find(
        (entry) => buildFileKey(entry) === pushPreviewModalFileKey,
      ) ?? null
    );
  }, [pushPreviewDetails, pushPreviewModalFileKey]);

  const pushPreviewModalFileDiff = useMemo(() => {
    if (!pushPreviewModalFile) {
      return null;
    }
    if (pushPreviewModalFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (pushPreviewModalFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [pushPreviewModalFile, t]);

  const pushPreviewModalDiffEntries = useMemo(() => {
    if (!pushPreviewModalFile) {
      return [];
    }
    return [
      {
        path: pushPreviewModalFile.path,
        status: pushPreviewModalFile.status,
        diff: pushPreviewModalFile.diff ?? "",
      },
    ];
  }, [pushPreviewModalFile]);

  const activeHistoryDiffModalKey = useMemo(() => {
    if (previewDetailFile) {
      return `commit:${previewDetailFile.path}`;
    }
    if (worktreePreviewFile) {
      return `worktree:${worktreePreviewFile.path}`;
    }
    if (branchDiffState) {
      return `branch:${branchDiffState.mode}:${branchDiffState.branch}:${branchDiffState.compareBranch ?? ""}`;
    }
    if (comparePreviewDetailFile) {
      return `compare:${comparePreviewDetailFile.path}`;
    }
    if (pushPreviewModalFile) {
      return `push:${pushPreviewModalFile.path}`;
    }
    return null;
  }, [
    branchDiffState,
    comparePreviewDetailFile,
    previewDetailFile,
    pushPreviewModalFile,
    worktreePreviewFile,
  ]);

  useEffect(() => {
    setIsHistoryDiffModalMaximized(false);
  }, [activeHistoryDiffModalKey]);

  const loadCommitFileFullDiff = useCallback(
    async (commitSha: string, path: string): Promise<string> => {
      if (!workspaceId) {
        return "";
      }
      const normalizedPath = path.replace(/^(?:a|b)\//, "");
      const cachePathKey = `full_ctx200k:${normalizedPath}`;
      const cachedByPath = commitFullDiffCacheRef.current.get(commitSha);
      if (cachedByPath && cachedByPath.has(cachePathKey)) {
        return cachedByPath.get(cachePathKey) ?? "";
      }

      const commitDiffs = await getGitCommitDiff(workspaceId, commitSha, {
        path: normalizedPath,
        contextLines: 200_000,
        ...(selectedRepositoryRoot === null
          ? {}
          : { repositoryRoot: selectedRepositoryRoot }),
      });
      const fullDiff =
        commitDiffs.find((entry) => entry.path === normalizedPath)?.diff ??
        commitDiffs[0]?.diff ??
        "";

      const nextCache = cachedByPath
        ? new Map(cachedByPath)
        : new Map<string, string>();
      nextCache.set(cachePathKey, fullDiff);
      commitFullDiffCacheRef.current.set(commitSha, nextCache);
      return fullDiff;
    },
    [workspaceId, selectedRepositoryRoot],
  );

  const previewModalFullDiffLoader = useCallback(
    (path: string) => {
      if (!selectedCommitSha) {
        return Promise.resolve("");
      }
      return loadCommitFileFullDiff(selectedCommitSha, path);
    },
    [loadCommitFileFullDiff, selectedCommitSha],
  );

  const pushPreviewModalFullDiffLoader = useCallback(
    (path: string) => {
      if (!pushPreviewSelectedSha) {
        return Promise.resolve("");
      }
      return loadCommitFileFullDiff(pushPreviewSelectedSha, path);
    },
    [loadCommitFileFullDiff, pushPreviewSelectedSha],
  );

  const worktreePreviewFullDiffLoader = useCallback(
    (path: string) => {
      if (!workspaceId) {
        return Promise.resolve("");
      }
      const normalizedPath = path.replace(/^(?:a|b)\//, "");
      return selectedRepositoryRoot === null
        ? getGitFileFullDiff(workspaceId, normalizedPath)
        : getGitFileFullDiff(
            workspaceId,
            normalizedPath,
            selectedRepositoryRoot,
          );
    },
    [workspaceId, selectedRepositoryRoot],
  );

  useEffect(() => {
    if (!previewFileKey) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewFileKey(null);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [previewFileKey]);

  useEffect(() => {
    if (!comparePreviewFileKey) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setComparePreviewFileKey(null);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [comparePreviewFileKey]);

  useEffect(() => {
    if (!pushPreviewModalFileKey) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setPushPreviewModalFileKey(null);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [pushPreviewModalFileKey]);

  useEffect(() => {
    if (!worktreePreviewFile) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorktreePreviewFile(null);
        setWorktreePreviewError(null);
        setWorktreePreviewLoading(false);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [worktreePreviewFile]);

  useEffect(() => {
    if (comparePreviewFileKey && !comparePreviewDetailFile) {
      setComparePreviewFileKey(null);
    }
  }, [comparePreviewDetailFile, comparePreviewFileKey]);

  useEffect(() => {
    if (!commitContextMenu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".git-history-commit-context-menu")
      ) {
        return;
      }
      setCommitContextMenu(null);
    };
    const handleScroll = () => setCommitContextMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommitContextMenu(null);
      }
    };
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, scrollOptions);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, scrollOptions);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [commitContextMenu]);

  useEffect(() => {
    if (!commitContextMenu) {
      setCommitContextMoreOpen(false);
    }
  }, [commitContextMenu]);

  useEffect(() => {
    if (!pullDialogOpen) {
      setPullRemoteMenuOpen(false);
      setPullRemoteMenuPlacement("up");
      setPullOptionsMenuOpen(false);
      setPullTargetBranchQuery("");
      setPullTargetBranchMenuOpen(false);
      setPullTargetBranchMenuPlacement("down");
    }
  }, [pullDialogOpen]);

  useEffect(() => {
    if (!syncDialogOpen) {
      setSyncPreviewLoading(false);
      setSyncPreviewError(null);
      setSyncPreviewCommits([]);
      setSyncPreviewTargetFound(true);
    }
  }, [syncDialogOpen]);

  useEffect(() => {
    if (!pullDialogOpen || !pullOptionsMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!pullOptionsMenuRef.current?.contains(target)) {
        setPullOptionsMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pullDialogOpen, pullOptionsMenuOpen]);

  useEffect(() => {
    if (!pullDialogOpen || (!pullRemoteMenuOpen && !pullTargetBranchMenuOpen)) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (pullRemotePickerRef.current?.contains(target)) {
        return;
      }
      if (pullTargetBranchFieldRef.current?.contains(target)) {
        return;
      }
      setPullRemoteMenuOpen(false);
      setPullTargetBranchMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pullDialogOpen, pullRemoteMenuOpen, pullTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pushDialogOpen) {
      setPushRemoteMenuOpen(false);
      setPushRemoteMenuPlacement("up");
      setPushTargetBranchMenuOpen(false);
      setPushTargetBranchMenuPlacement("down");
      setPushTargetBranchQuery("");
      pushPreviewLoadTokenRef.current += 1;
      pushPreviewDetailsLoadTokenRef.current += 1;
      setPushPreviewLoading(false);
      setPushPreviewError(null);
      setPushPreviewTargetFound(true);
      setPushPreviewHasMore(false);
      setPushPreviewCommits([]);
      setPushPreviewSelectedSha(null);
      setPushPreviewDetails(null);
      setPushPreviewDetailsLoading(false);
      setPushPreviewDetailsError(null);
      setPushPreviewExpandedDirs(new Set());
      setPushPreviewSelectedFileKey(null);
      setPushPreviewModalFileKey(null);
    }
  }, [pushDialogOpen]);

  useEffect(() => {
    if (!pushDialogOpen || (!pushRemoteMenuOpen && !pushTargetBranchMenuOpen)) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (pushRemotePickerRef.current?.contains(target)) {
        return;
      }
      if (pushTargetBranchFieldRef.current?.contains(target)) {
        return;
      }
      setPushRemoteMenuOpen(false);
      setPushTargetBranchMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pushDialogOpen, pushRemoteMenuOpen, pushTargetBranchMenuOpen]);

  useEffect(() => {
    if (previewFileKey && !previewDetailFile) {
      setPreviewFileKey(null);
    }
  }, [previewDetailFile, previewFileKey]);

  useEffect(() => {
    if (!pushPreviewDetails) {
      setPushPreviewExpandedDirs(new Set());
      setPushPreviewSelectedFileKey(null);
      setPushPreviewModalFileKey(null);
      return;
    }
    setPushPreviewExpandedDirs(collectDirPaths(pushPreviewDetails.files));
    setPushPreviewSelectedFileKey((previousKey) =>
      pickSelectedFileKey(previousKey, pushPreviewDetails.files),
    );
    // Diff modal should only open when user explicitly clicks a file item.
    setPushPreviewModalFileKey(null);
  }, [pushPreviewDetails]);

  useEffect(() => {
    if (pushPreviewModalFileKey && !pushPreviewModalFile) {
      setPushPreviewModalFileKey(null);
    }
  }, [pushPreviewModalFile, pushPreviewModalFileKey]);

  const getOperationDisplayName = useCallback(
    (operationName: string) => {
      const nameMap: Record<string, string> = {
        pull: t("git.pull"),
        push: t("git.push"),
        createPr: t("git.historyOperationCreatePr"),
        sync: t("git.sync"),
        fetch: t("git.fetch"),
        refresh: t("git.refresh"),
        checkout: t("git.historyOperationCheckout"),
        createBranch: t("git.historyOperationCreateBranch"),
        createFromCommit: t("git.historyOperationCreateFromCommit"),
        deleteBranch: t("git.historyOperationDeleteBranch"),
        renameBranch: t("git.historyOperationRenameBranch"),
        mergeBranch: t("git.historyOperationMergeBranch"),
        checkoutRebase: t("git.historyOperationCheckoutAndRebase"),
        rebaseBranch: t("git.historyOperationRebaseCurrentBranch"),
        reset: t("git.historyOperationReset"),
        revert: t("git.historyOperationRevertCommit"),
        "cherry-pick": t("git.historyOperationCherryPick"),
        updateBranch: t("git.historyOperationUpdateBranch"),
      };
      return nameMap[operationName] ?? operationName;
    },
    [t],
  );

  const clearOperationNotice = useCallback(() => {
    if (operationNoticeTimerRef.current !== null) {
      window.clearTimeout(operationNoticeTimerRef.current);
      operationNoticeTimerRef.current = null;
    }
    setOperationNotice(null);
  }, []);

  const showOperationNotice = useCallback((notice: GitOperationNoticeState) => {
    if (operationNoticeTimerRef.current !== null) {
      window.clearTimeout(operationNoticeTimerRef.current);
      operationNoticeTimerRef.current = null;
    }
    setOperationNotice(notice);
    if (notice.kind === "success") {
      operationNoticeTimerRef.current = window.setTimeout(() => {
        setOperationNotice(null);
        operationNoticeTimerRef.current = null;
      }, 5000);
    }
  }, []);

  const clearCreatePrProgressTimer = useCallback(() => {
    if (createPrProgressTimerRef.current !== null) {
      window.clearInterval(createPrProgressTimerRef.current);
      createPrProgressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (operationNoticeTimerRef.current !== null) {
        window.clearTimeout(operationNoticeTimerRef.current);
      }
      clearCreatePrProgressTimer();
      if (forceDeleteDialogResolverRef.current) {
        forceDeleteDialogResolverRef.current(false);
        forceDeleteDialogResolverRef.current = null;
      }
    };
  }, [clearCreatePrProgressTimer]);

  const localizedOperationName = useMemo(() => {
    if (!operationLoading) {
      return null;
    }
    return getOperationDisplayName(operationLoading);
  }, [getOperationDisplayName, operationLoading]);

  const localizeKnownGitError = useCallback(
    (message: string | null): string | null => {
      return localizeGitErrorMessage(message, t);
    },
    [t],
  );

  const createOperationErrorState = useCallback(
    (rawMessage: string): GitOperationErrorState => {
      const normalized = rawMessage.toLowerCase();
      if (isWorkingTreeDirtyBlockingError(rawMessage)) {
        return {
          userMessage: t("git.historyErrorWorkingTreeDirty"),
          debugMessage: rawMessage,
          retryable: true,
        };
      }
      if (normalized.includes("snapshot expired")) {
        return {
          userMessage: t("git.historySnapshotExpired"),
          debugMessage: rawMessage,
          retryable: true,
        };
      }
      return {
        userMessage: localizeKnownGitError(rawMessage) ?? rawMessage,
        debugMessage: rawMessage,
        retryable: true,
      };
    },
    [localizeKnownGitError, t],
  );

  const isBranchDeleteNotFullyMergedError = useCallback(
    (rawMessage: string): boolean => {
      const normalized = rawMessage.toLowerCase();
      return normalized.includes("is not fully merged");
    },
    [],
  );

  const isBranchDeleteUsedByWorktreeError = useCallback(
    (rawMessage: string): boolean => {
      const normalized = rawMessage.toLowerCase();
      return (
        normalized.includes("cannot delete branch") &&
        normalized.includes("used by worktree")
      );
    },
    [],
  );

  const extractWorktreePathFromDeleteError = useCallback(
    (rawMessage: string): string | null => {
      const matched = rawMessage.match(
        /used by worktree at ['"]?([^'"\n]+)['"]?/i,
      );
      const path = matched?.[1]?.trim();
      return path ? path : null;
    },
    [],
  );

  const promptForceDeleteDialog = useCallback(
    (
      mode: ForceDeleteDialogMode,
      branch: string,
      worktreePath: string | null,
    ) =>
      new Promise<boolean>((resolve) => {
        forceDeleteDialogResolverRef.current = resolve;
        setForceDeleteDialogState({ mode, branch, worktreePath });
      }),
    [],
  );

  const closeForceDeleteDialog = useCallback((confirmed: boolean) => {
    setForceDeleteDialogState(null);
    const resolver = forceDeleteDialogResolverRef.current;
    forceDeleteDialogResolverRef.current = null;
    resolver?.(confirmed);
  }, []);

  useEffect(() => {
    if (!forceDeleteDialogState) {
      setForceDeleteCountdown(0);
      setForceDeleteCopiedPath(false);
      return;
    }
    setForceDeleteCountdown(2);
    setForceDeleteCopiedPath(false);
    const timer = window.setInterval(() => {
      setForceDeleteCountdown((previous) => (previous > 0 ? previous - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [forceDeleteDialogState]);

  const handleCopyForceDeleteWorktreePath = useCallback(async () => {
    const path = forceDeleteDialogState?.worktreePath;
    if (!path) {
      return;
    }
    if (await copyTextToClipboard(path)) {
      setForceDeleteCopiedPath(true);
      window.setTimeout(() => setForceDeleteCopiedPath(false), 1200);
    } else {
      setForceDeleteCopiedPath(false);
    }
  }, [forceDeleteDialogState?.worktreePath]);

  const runOperation = useCallback(
    async (name: string, action: () => Promise<void>) => {
      clearOperationNotice();
      setOperationLoading(name);
      try {
        await action();
        await refreshAll();
        showOperationNotice({
          kind: "success",
          message: t("git.historyOperationSucceeded", {
            operation: getOperationDisplayName(name),
          }),
        });
      } catch (error) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        const operationState = createOperationErrorState(rawMessage);
        showOperationNotice({
          kind: "error",
          message: `${t("git.historyOperationFailed", {
            operation: getOperationDisplayName(name),
          })} ${operationState.userMessage}${
            operationState.retryable
              ? ` ${t("git.historyOperationRetryHint")}`
              : ""
          }`,
          debugMessage: operationState.debugMessage,
        });
      } finally {
        setOperationLoading(null);
      }
    },
    [
      clearOperationNotice,
      createOperationErrorState,
      getOperationDisplayName,
      refreshAll,
      showOperationNotice,
      t,
    ],
  );

  const createBranchNameTrimmed = createBranchName.trim();
  const createBranchSubmitting = operationLoading === "createBranch";
  const createBranchCanConfirm = Boolean(
    workspaceId &&
    !createBranchSubmitting &&
    createBranchSource.trim() &&
    createBranchNameTrimmed,
  );
  const renameBranchNameTrimmed = renameBranchName.trim();
  const renameBranchSubmitting = operationLoading === "renameBranch";
  const renameBranchCanConfirm = Boolean(
    workspaceId &&
    !renameBranchSubmitting &&
    renameBranchSource.trim() &&
    renameBranchNameTrimmed &&
    renameBranchNameTrimmed !== renameBranchSource,
  );
  const createPrSubmitting = operationLoading === "createPr";
  const createPrToolbarDisabledReason = !currentBranch
    ? t("git.historyCreatePrUnavailableNoBranch")
    : null;
  const createPrCanOpen = Boolean(
    workspaceId && !operationLoading && currentBranch && !repositoryUnavailable,
  );
  const createPrUpstreamParts = useMemo(
    () => splitGitHubRepo(createPrForm.upstreamRepo),
    [createPrForm.upstreamRepo],
  );
  const createPrHeadRepositoryValue = useMemo(() => {
    const owner = createPrForm.headOwner.trim();
    if (!owner) {
      return "";
    }
    if (!createPrUpstreamParts.repo) {
      return owner;
    }
    return `${owner}/${createPrUpstreamParts.repo}`;
  }, [createPrForm.headOwner, createPrUpstreamParts.repo]);
  const createPrBaseRepoOptions = useMemo<GitHistoryInlinePickerOption[]>(
    () =>
      uniqueNonEmpty([
        createPrForm.upstreamRepo,
        createPrDefaults?.upstreamRepo ?? "",
      ]).map((repo) => ({
        value: repo,
        label: repo,
        description: t("git.historyCreatePrFieldUpstreamRepo"),
        group: t("git.historyCreatePrGroupSuggested"),
      })),
    [createPrDefaults?.upstreamRepo, createPrForm.upstreamRepo, t],
  );
  const createPrHeadRepoOptions = useMemo(() => {
    const upstreamOwner = createPrUpstreamParts.owner;
    const repoName = createPrUpstreamParts.repo;
    const ownerCandidates = uniqueNonEmpty([
      createPrForm.headOwner,
      createPrDefaults?.headOwner ?? "",
      upstreamOwner,
    ]);
    return ownerCandidates.map((owner) => {
      const repo = repoName ? `${owner}/${repoName}` : owner;
      return {
        value: repo,
        label: repo,
        description: t("git.historyCreatePrFieldHeadOwner"),
        group: t("git.historyCreatePrGroupSuggested"),
      } satisfies GitHistoryInlinePickerOption;
    });
  }, [
    createPrDefaults?.headOwner,
    createPrForm.headOwner,
    createPrUpstreamParts.owner,
    createPrUpstreamParts.repo,
    t,
  ]);
  const createPrUpstreamRemoteName = useMemo(() => {
    const remoteNames = uniqueNonEmpty(
      remoteBranches
        .map((entry) => entry.remote?.trim() ?? "")
        .filter((name) => name.length > 0),
    );
    const explicitUpstream = remoteNames.find(
      (name) => name.toLowerCase() === "upstream",
    );
    return explicitUpstream ?? null;
  }, [remoteBranches]);
  const createPrPreviewBaseRemoteName =
    createPrUpstreamRemoteName ?? "upstream";
  const createPrPreviewHeadRef = createPrForm.headBranch.trim();
  const createPrPreviewBaseRef = createPrForm.baseBranch.trim()
    ? `${createPrPreviewBaseRemoteName}/${createPrForm.baseBranch.trim()}`
    : "";
  const createPrBaseBranchOptions = useMemo<
    GitHistoryInlinePickerOption[]
  >(() => {
    const remoteBranchLeaves = remoteBranches
      .filter((entry) => {
        if (!createPrUpstreamRemoteName) {
          return true;
        }
        return (entry.remote?.trim() ?? "") === createPrUpstreamRemoteName;
      })
      .map((entry) => {
        const remoteName = entry.remote?.trim();
        if (remoteName && entry.name.startsWith(`${remoteName}/`)) {
          return entry.name.slice(remoteName.length + 1);
        }
        const slashIndex = entry.name.indexOf("/");
        return slashIndex >= 0 ? entry.name.slice(slashIndex + 1) : entry.name;
      });
    const prioritized = sortOptionsWithPriority(
      uniqueNonEmpty([
        ...remoteBranchLeaves,
        createPrForm.baseBranch,
        createPrDefaults?.baseBranch ?? "",
      ]),
      [
        createPrForm.baseBranch,
        createPrDefaults?.baseBranch ?? "",
        "main",
        "master",
        "develop",
      ],
    );
    const suggested = new Set(
      uniqueNonEmpty([
        createPrForm.baseBranch,
        createPrDefaults?.baseBranch ?? "",
        "main",
        "master",
        "develop",
      ]),
    );
    return prioritized.map((branch) => ({
      value: branch,
      label: branch,
      description: t("git.historyCreatePrFieldBaseBranch"),
      group: suggested.has(branch)
        ? t("git.historyCreatePrGroupSuggested")
        : t("git.historyCreatePrGroupRemote"),
    }));
  }, [
    createPrDefaults?.baseBranch,
    createPrForm.baseBranch,
    createPrUpstreamRemoteName,
    remoteBranches,
    t,
  ]);
  const createPrCompareBranchOptions = useMemo<GitHistoryInlinePickerOption[]>(
    () =>
      sortOptionsWithPriority(
        uniqueNonEmpty([
          ...localBranches.map((entry) => entry.name),
          createPrForm.headBranch,
          currentBranch ?? "",
        ]),
        [createPrForm.headBranch, currentBranch ?? ""],
      ).map((branch) => {
        const scope = getBranchScope(branch);
        return {
          value: branch,
          label: getBranchLeafName(branch),
          description: t("git.historyCreatePrFieldHeadBranch"),
          group:
            scope === "__root__" ? t("git.historyPushDialogGroupRoot") : scope,
        };
      }),
    [createPrForm.headBranch, currentBranch, localBranches, t],
  );
  const createPrCanConfirm = Boolean(
    workspaceId &&
    !createPrSubmitting &&
    !createPrDefaultsLoading &&
    !createPrDefaultsError &&
    (createPrDefaults?.canCreate ?? true) &&
    createPrForm.upstreamRepo.trim() &&
    createPrForm.baseBranch.trim() &&
    createPrForm.headOwner.trim() &&
    createPrForm.headBranch.trim() &&
    createPrForm.title.trim(),
  );
  const createPrResultHeadline = useMemo(() => {
    if (!createPrResult) {
      return "";
    }
    if (createPrResult.status === "existing") {
      return t("git.historyCreatePrResultExisting");
    }
    if (createPrResult.ok) {
      return t("git.historyCreatePrResultSuccess");
    }
    return t("git.historyCreatePrResultFailed");
  }, [createPrResult, t]);
  const createPrPreviewHasMore =
    createPrPreviewCommits.length >= CREATE_PR_PREVIEW_COMMIT_LIMIT;
  const createPrPreviewSelectedCommit = useMemo(
    () =>
      createPrPreviewCommits.find(
        (entry) => entry.sha === createPrPreviewSelectedSha,
      ) ?? null,
    [createPrPreviewCommits, createPrPreviewSelectedSha],
  );
  const selectedLocalBranchForRename = useMemo(() => {
    const candidate = selectedBranch === "all" ? currentBranch : selectedBranch;
    if (!candidate) {
      return null;
    }
    return localBranches.some((entry) => entry.name === candidate)
      ? candidate
      : null;
  }, [currentBranch, localBranches, selectedBranch]);
  const renameBranchToolbarDisabledReason = useMemo(() => {
    if (operationLoading) {
      return t("git.historyBranchMenuUnavailableBusy");
    }
    if (
      selectedBranch !== "all" &&
      selectedBranch &&
      !localBranches.some((entry) => entry.name === selectedBranch)
    ) {
      return t("git.historyBranchMenuUnavailableRemote");
    }
    if (!selectedLocalBranchForRename) {
      return t("git.historyBranchMenuUnavailableNoCurrent");
    }
    return null;
  }, [
    localBranches,
    operationLoading,
    selectedBranch,
    selectedLocalBranchForRename,
    t,
  ]);
  const pullSubmitting = operationLoading === "pull";
  const syncSubmitting = operationLoading === "sync";
  const fetchSubmitting = operationLoading === "fetch";
  const refreshSubmitting = operationLoading === "refresh";
  const pushSubmitting = operationLoading === "push";
  const pullRemoteTrimmed = pullRemote.trim();
  const pushRemoteTrimmed = pushRemote.trim();
  const pushTargetBranchTrimmed = pushTargetBranch.trim();
  const pushTargetBranchQueryTrimmed = pushTargetBranchQuery.trim();

  const resolvePushTargetBranchOptions = useCallback(
    (remoteName: string): string[] => {
      const normalizedRemote = remoteName.trim();
      if (!normalizedRemote) {
        return [];
      }
      const branchSet = new Set<string>();
      const remotePrefix = `${normalizedRemote}/`;
      for (const branch of remoteBranches) {
        const fromMeta = branch.remote?.trim();
        if (fromMeta && fromMeta !== normalizedRemote) {
          continue;
        }
        const normalizedName = branch.name.trim();
        if (normalizedName.startsWith(remotePrefix)) {
          const leaf = normalizedName.slice(remotePrefix.length).trim();
          if (leaf) {
            branchSet.add(leaf);
          }
        }
      }
      return Array.from(branchSet).sort((a, b) => a.localeCompare(b));
    },
    [remoteBranches],
  );

  const pushRemoteOptions = useMemo(() => {
    const set = new Set<string>();
    for (const branch of remoteBranches) {
      if (branch.remote?.trim()) {
        set.add(branch.remote.trim());
      }
      const slashIndex = branch.name.indexOf("/");
      if (slashIndex > 0) {
        set.add(branch.name.slice(0, slashIndex));
      }
    }
    if (!set.size) {
      set.add("origin");
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [remoteBranches]);

  const pushTargetBranchOptions = useMemo(
    () => resolvePushTargetBranchOptions(pushRemoteTrimmed || pushRemote),
    [pushRemote, pushRemoteTrimmed, resolvePushTargetBranchOptions],
  );

  const filteredPushTargetBranchOptions = useMemo(() => {
    const keyword = pushTargetBranchQueryTrimmed.toLowerCase();
    if (!keyword) {
      return pushTargetBranchOptions;
    }
    const matched = pushTargetBranchOptions.filter((branchName) =>
      branchName.toLowerCase().includes(keyword),
    );
    return matched.length > 0 ? matched : pushTargetBranchOptions;
  }, [pushTargetBranchOptions, pushTargetBranchQueryTrimmed]);

  const pushTargetBranchGroups = useMemo<PushTargetBranchGroup[]>(() => {
    const grouped = new Map<string, string[]>();
    for (const branchName of filteredPushTargetBranchOptions) {
      const scope = getBranchScope(branchName);
      const bucket = grouped.get(scope) ?? [];
      bucket.push(branchName);
      grouped.set(scope, bucket);
    }
    const sortedScopes = Array.from(grouped.keys()).sort((a, b) => {
      if (a === "__root__") {
        return -1;
      }
      if (b === "__root__") {
        return 1;
      }
      return a.localeCompare(b);
    });
    return sortedScopes.map((scope) => ({
      scope,
      label: scope === "__root__" ? t("git.historyPushDialogGroupRoot") : scope,
      items: (grouped.get(scope) ?? []).sort((a, b) => a.localeCompare(b)),
    }));
  }, [filteredPushTargetBranchOptions, t]);
  const visiblePushTargetBranchGroups = useMemo(() => {
    if (pushTargetBranchGroups.length <= 1) {
      return pushTargetBranchGroups;
    }
    const activeScope =
      pushTargetBranchActiveScopeTab ??
      pushTargetBranchGroups[0]?.scope ??
      null;
    return pushTargetBranchGroups.filter(
      (group) => group.scope === activeScope,
    );
  }, [pushTargetBranchActiveScopeTab, pushTargetBranchGroups]);

  const pullRemoteOptions = pushRemoteOptions;
  const pullRemoteGroups = useMemo<PushTargetBranchGroup[]>(() => {
    const sortedRemotes = [...pullRemoteOptions].sort((left, right) =>
      left.localeCompare(right),
    );
    if (!sortedRemotes.length) {
      return [];
    }
    return [
      {
        scope: "__root__",
        label: t("git.historyPushDialogGroupRoot"),
        items: sortedRemotes,
      },
    ];
  }, [pullRemoteOptions, t]);
  const pullTargetBranchTrimmed = pullTargetBranch.trim();
  const pullTargetBranchQueryTrimmed = pullTargetBranchQuery.trim();
  const pullTargetBranchOptions = useMemo(
    () => resolvePushTargetBranchOptions(pullRemoteTrimmed || "origin"),
    [pullRemoteTrimmed, resolvePushTargetBranchOptions],
  );
  const filteredPullTargetBranchOptions = useMemo(() => {
    const keyword = pullTargetBranchQueryTrimmed.toLowerCase();
    if (!keyword) {
      return pullTargetBranchOptions;
    }
    const matched = pullTargetBranchOptions.filter((branchName) =>
      branchName.toLowerCase().includes(keyword),
    );
    return matched.length > 0 ? matched : pullTargetBranchOptions;
  }, [pullTargetBranchOptions, pullTargetBranchQueryTrimmed]);
  const pullTargetBranchGroups = useMemo<PushTargetBranchGroup[]>(() => {
    const grouped = new Map<string, string[]>();
    for (const branchName of filteredPullTargetBranchOptions) {
      const scope = getBranchScope(branchName);
      const bucket = grouped.get(scope) ?? [];
      bucket.push(branchName);
      grouped.set(scope, bucket);
    }
    const sortedScopes = Array.from(grouped.keys()).sort((a, b) => {
      if (a === "__root__") {
        return -1;
      }
      if (b === "__root__") {
        return 1;
      }
      return a.localeCompare(b);
    });
    return sortedScopes.map((scope) => ({
      scope,
      label: scope === "__root__" ? t("git.historyPushDialogGroupRoot") : scope,
      items: (grouped.get(scope) ?? []).sort((a, b) => a.localeCompare(b)),
    }));
  }, [filteredPullTargetBranchOptions, t]);
  const visiblePullTargetBranchGroups = useMemo(() => {
    if (pullTargetBranchGroups.length <= 1) {
      return pullTargetBranchGroups;
    }
    const activeScope =
      pullTargetBranchActiveScopeTab ??
      pullTargetBranchGroups[0]?.scope ??
      null;
    return pullTargetBranchGroups.filter(
      (group) => group.scope === activeScope,
    );
  }, [pullTargetBranchActiveScopeTab, pullTargetBranchGroups]);
  const pullSelectedOptions = useMemo(() => {
    const options: Array<{ id: string; label: string; onRemove: () => void }> =
      [];
    if (pullStrategy) {
      options.push({
        id: pullStrategy,
        label: pullStrategy,
        onRemove: () => setPullStrategy(null),
      });
    }
    if (pullNoCommit) {
      options.push({
        id: "--no-commit",
        label: "--no-commit",
        onRemove: () => setPullNoCommit(false),
      });
    }
    if (pullNoVerify) {
      options.push({
        id: "--no-verify",
        label: "--no-verify",
        onRemove: () => setPullNoVerify(false),
      });
    }
    return options;
  }, [pullNoCommit, pullNoVerify, pullStrategy]);

  useEffect(() => {
    if (!pullTargetBranchMenuOpen) {
      return;
    }
    const availableScopes = pullTargetBranchGroups.map((group) => group.scope);
    const currentBranchScope = currentBranch
      ? getBranchScope(currentBranch)
      : null;
    const selectedScope = pullTargetBranchTrimmed
      ? getBranchScope(pullTargetBranchTrimmed)
      : null;
    setPullTargetBranchActiveScopeTab((previous) => {
      if (currentBranchScope && availableScopes.includes(currentBranchScope)) {
        return currentBranchScope;
      }
      if (selectedScope && availableScopes.includes(selectedScope)) {
        return selectedScope;
      }
      if (previous && availableScopes.includes(previous)) {
        return previous;
      }
      return availableScopes[0] ?? null;
    });
  }, [
    currentBranch,
    pullTargetBranchGroups,
    pullTargetBranchMenuOpen,
    pullTargetBranchTrimmed,
  ]);

  useEffect(() => {
    if (!pushTargetBranchMenuOpen) {
      return;
    }
    const availableScopes = pushTargetBranchGroups.map((group) => group.scope);
    const currentBranchScope = currentBranch
      ? getBranchScope(currentBranch)
      : null;
    const selectedScope = pushTargetBranchTrimmed
      ? getBranchScope(pushTargetBranchTrimmed)
      : null;
    setPushTargetBranchActiveScopeTab((previous) => {
      if (currentBranchScope && availableScopes.includes(currentBranchScope)) {
        return currentBranchScope;
      }
      if (selectedScope && availableScopes.includes(selectedScope)) {
        return selectedScope;
      }
      if (previous && availableScopes.includes(previous)) {
        return previous;
      }
      return availableScopes[0] ?? null;
    });
  }, [
    currentBranch,
    pushTargetBranchGroups,
    pushTargetBranchMenuOpen,
    pushTargetBranchTrimmed,
  ]);

  const updatePullTargetBranchMenuPlacement = useCallback(() => {
    if (typeof window === "undefined") {
      setPullTargetBranchMenuPlacement("down");
      return;
    }
    const anchorElement = pullTargetBranchPickerRef.current;
    if (!anchorElement) {
      setPullTargetBranchMenuPlacement("down");
      return;
    }
    const anchorRect = anchorElement.getBoundingClientRect();
    const spaceAbove = anchorRect.top - PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const spaceBelow =
      window.innerHeight -
      anchorRect.bottom -
      PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const estimatedRowCount = pullTargetBranchGroups.reduce(
      (total, group) => total + group.items.length + 1,
      0,
    );
    const estimatedMenuHeight = Math.max(
      PUSH_TARGET_MENU_MIN_HEIGHT,
      Math.min(
        PUSH_TARGET_MENU_MAX_HEIGHT,
        estimatedRowCount * PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT + 28,
      ),
    );
    const shouldOpenUpward =
      spaceBelow < estimatedMenuHeight &&
      spaceAbove > spaceBelow &&
      spaceAbove > PUSH_TARGET_MENU_MIN_HEIGHT;
    setPullTargetBranchMenuPlacement(shouldOpenUpward ? "up" : "down");
  }, [pullTargetBranchGroups]);

  const updatePullRemoteMenuPlacement = useCallback(() => {
    setPullRemoteMenuPlacement("up");
  }, []);

  const openPullTargetBranchMenu = useCallback(
    (resetQuery: boolean) => {
      if (pullSubmitting) {
        return;
      }
      setPullRemoteMenuOpen(false);
      setPullOptionsMenuOpen(false);
      if (resetQuery) {
        setPullTargetBranchQuery("");
      }
      updatePullTargetBranchMenuPlacement();
      setPullTargetBranchMenuOpen(true);
    },
    [pullSubmitting, updatePullTargetBranchMenuPlacement],
  );

  useEffect(() => {
    if (!pullDialogOpen || !pullTargetBranchMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePullTargetBranchMenuPlacement();
    handleLayoutChange();
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, scrollOptions);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, scrollOptions);
    };
  }, [
    pullDialogOpen,
    pullTargetBranchMenuOpen,
    updatePullTargetBranchMenuPlacement,
  ]);

  useEffect(() => {
    if (!pullTargetBranchMenuOpen) {
      return;
    }
    scrollElementToTop(pullTargetBranchMenuRef.current);
  }, [pullTargetBranchActiveScopeTab, pullTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pullDialogOpen || !pullRemoteMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePullRemoteMenuPlacement();
    handleLayoutChange();
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, scrollOptions);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, scrollOptions);
    };
  }, [pullDialogOpen, pullRemoteMenuOpen, updatePullRemoteMenuPlacement]);

  const updatePushTargetBranchMenuPlacement = useCallback(() => {
    if (typeof window === "undefined") {
      setPushTargetBranchMenuPlacement("down");
      return;
    }
    const anchorElement = pushTargetBranchPickerRef.current;
    if (!anchorElement) {
      setPushTargetBranchMenuPlacement("down");
      return;
    }
    const anchorRect = anchorElement.getBoundingClientRect();
    const spaceAbove = anchorRect.top - PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const spaceBelow =
      window.innerHeight -
      anchorRect.bottom -
      PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const estimatedRowCount = pushTargetBranchGroups.reduce(
      (total, group) => total + group.items.length + 1,
      0,
    );
    const estimatedMenuHeight = Math.max(
      PUSH_TARGET_MENU_MIN_HEIGHT,
      Math.min(
        PUSH_TARGET_MENU_MAX_HEIGHT,
        estimatedRowCount * PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT + 28,
      ),
    );
    const shouldOpenUpward =
      spaceBelow < estimatedMenuHeight &&
      spaceAbove > spaceBelow &&
      spaceAbove > PUSH_TARGET_MENU_MIN_HEIGHT;
    setPushTargetBranchMenuPlacement(shouldOpenUpward ? "up" : "down");
  }, [pushTargetBranchGroups]);

  const updatePushRemoteMenuPlacement = useCallback(() => {
    setPushRemoteMenuPlacement("up");
  }, []);

  const openPushTargetBranchMenu = useCallback(
    (resetQuery: boolean) => {
      if (pushSubmitting) {
        return;
      }
      setPushRemoteMenuOpen(false);
      if (resetQuery) {
        setPushTargetBranchQuery("");
      }
      updatePushTargetBranchMenuPlacement();
      setPushTargetBranchMenuOpen(true);
    },
    [pushSubmitting, updatePushTargetBranchMenuPlacement],
  );

  useEffect(() => {
    if (!pushDialogOpen || !pushTargetBranchMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePushTargetBranchMenuPlacement();
    handleLayoutChange();
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, scrollOptions);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, scrollOptions);
    };
  }, [
    pushDialogOpen,
    pushTargetBranchMenuOpen,
    updatePushTargetBranchMenuPlacement,
  ]);

  useEffect(() => {
    if (!pushTargetBranchMenuOpen) {
      return;
    }
    scrollElementToTop(pushTargetBranchMenuRef.current);
  }, [pushTargetBranchActiveScopeTab, pushTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pushDialogOpen || !pushRemoteMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePushRemoteMenuPlacement();
    handleLayoutChange();
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, scrollOptions);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, scrollOptions);
    };
  }, [pushDialogOpen, pushRemoteMenuOpen, updatePushRemoteMenuPlacement]);

  const pushHasOutgoingCommits = pushPreviewCommits.length > 0;
  const pushIsNewBranchTarget = Boolean(
    pushDialogOpen &&
    !pushPreviewLoading &&
    !pushPreviewError &&
    !pushPreviewTargetFound,
  );
  const pushTargetSummaryBranch = useMemo(() => {
    const targetBranch = pushTargetBranchTrimmed || currentBranch || "main";
    if (pushToGerrit) {
      return `refs/for/${targetBranch}`;
    }
    return targetBranch;
  }, [currentBranch, pushTargetBranchTrimmed, pushToGerrit]);
  const pushPreviewSelectedCommit = useMemo(
    () =>
      pushPreviewCommits.find(
        (entry) => entry.sha === pushPreviewSelectedSha,
      ) ?? null,
    [pushPreviewCommits, pushPreviewSelectedSha],
  );

  const pushCanConfirm = Boolean(
    workspaceId &&
    !pushSubmitting &&
    pushRemoteTrimmed &&
    pushTargetBranchTrimmed &&
    !pushPreviewLoading &&
    !pushPreviewError &&
    pushHasOutgoingCommits,
  );

  const workingTreeSummaryLabel =
    workingTreeChangedFiles > 0
      ? t("git.filesChanged", { count: workingTreeChangedFiles })
      : t("git.workingTreeClean");
  const projectOptions = useMemo(() => {
    if (workspaces.length > 0) {
      return workspaces;
    }
    return workspace ? [workspace] : [];
  }, [workspace, workspaces]);
  const projectSections = useMemo(() => {
    const worktreesByParent = new Map<string, WorkspaceInfo[]>();
    for (const entry of workspaces) {
      if ((entry.kind ?? "main") !== "worktree" || !entry.parentId) {
        continue;
      }
      const bucket = worktreesByParent.get(entry.parentId) ?? [];
      bucket.push(entry);
      worktreesByParent.set(entry.parentId, bucket);
    }
    for (const bucket of worktreesByParent.values()) {
      bucket.sort((a, b) => {
        const orderDiff =
          getSortOrderValue(a.settings.sortOrder) -
          getSortOrderValue(b.settings.sortOrder);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return a.name.localeCompare(b.name);
      });
    }

    const toOption = (
      entry: WorkspaceInfo,
      kind: "main" | "worktree",
      parentLabel?: string | null,
    ) =>
      ({
        id: entry.id,
        label: entry.name,
        kind,
        parentLabel: parentLabel ?? null,
        selected: entry.id === selectedProjectWorkspaceId,
      }) satisfies GitHistoryPickerOption;

    if (groupedWorkspaces.length > 0) {
      return groupedWorkspaces
        .map((section) => ({
          id: section.id,
          name: section.name,
          options: section.workspaces.flatMap((entry) => {
            const worktreeOptions = (worktreesByParent.get(entry.id) ?? []).map(
              (worktree) => toOption(worktree, "worktree", entry.name),
            );
            return [toOption(entry, "main"), ...worktreeOptions];
          }),
        }))
        .filter((section) => section.options.length > 0);
    }
    return [
      {
        id: null,
        name: "",
        options: projectOptions.map((entry) =>
          toOption(
            entry,
            (entry.kind ?? "main") === "worktree" ? "worktree" : "main",
          ),
        ),
      },
    ];
  }, [
    groupedWorkspaces,
    projectOptions,
    selectedProjectWorkspaceId,
    workspaces,
  ]);
  const shouldShowWorkspacePickerPage = !workspace || repositoryUnavailable;
  const workspacePickerMessage = repositoryUnavailable
    ? t("git.historySelectGitWorkspace")
    : t("git.historySelectWorkspace");

  const {
    handleFallbackGitRootSelect,
    emptyStateStatusText,
    handleWorktreeSummaryChange,
    handleToggleLocalScope,
    handleToggleRemoteScope,
    handleCreateBranch,
    handleCreateBranchConfirm,
    handleCreatePrHeadRepositoryChange,
    loadCreatePrCommitPreview,
    handleOpenCreatePrDialog,
    closeCreatePrDialog,
    handleCopyCreatePrUrl,
    handleCopyCreatePrRetryCommand,
    handleConfirmCreatePr,
    handleOpenPullDialog,
    handleSelectPullTargetBranch,
    handleSelectPullRemote,
    handleConfirmPull,
    handleOpenSyncDialog,
    handleConfirmSync,
    handleOpenFetchDialog,
    handleConfirmFetch,
    handleOpenRefreshDialog,
    handleConfirmRefresh,
    handleSelectPushRemote,
    handleSelectPushTargetBranch,
    handleSelectPushHistory,
    handleOpenPushDialog,
    handleConfirmPush,
    handleDeleteBranch,
    handleOpenRenameBranchDialog,
    closeRenameBranchDialog,
    handleRenameBranchConfirm,
    handleMergeBranch,
    handleSelectWorktreeDiffFile,
    handleSelectBranchCompareCommit,
    openResetDialog,
    handleConfirmResetCommit,
    handleFileTreeDirToggle,
    handlePushPreviewDirToggle,
    closeWorktreePreview,
    handleOpenWorktreePreview,
    resetTargetCommit,
    branchContextTrackingSummary,
    branchContextActions,
    handleBranchContextMenuKeyDown,
    branchContextMenuStyle,
    contextPrimaryActionGroups,
    contextWriteActions,
    contextMoreDisabledReason,
    runCommitAction,
    handleOpenCommitContextMenu,
    getCurrentDefaultColumnWidths,
    handleOverviewSplitResizeStart,
    handleBranchesSplitResizeStart,
    handleCommitsSplitResizeStart,
    handleDetailsSplitResizeStart,
    workbenchGridStyle,
    mainGridStyle,
    commitRowVirtualizer,
    virtualCommitRows,
  } = useGitHistoryPanelInteractions({
    BRANCHES_MIN_WIDTH,
    COMMITS_MIN_WIDTH,
    COMPACT_LAYOUT_BREAKPOINT,
    CREATE_PR_PREVIEW_COMMIT_LIMIT,
    DETAILS_MIN_WIDTH,
    DETAILS_SPLIT_MAX,
    DETAILS_SPLIT_MIN,
    DISABLE_HISTORY_COMMIT_ACTIONS,
    Download,
    FileText,
    FolderTree,
    GitBranch,
    GitMerge,
    OVERVIEW_MIN_WIDTH,
    Pencil,
    Plus,
    RefreshCw,
    Repeat,
    Trash2,
    Upload,
    VERTICAL_SPLITTER_SIZE,
    ask,
    branchCompareDetailsCacheRef,
    branchContextMenu,
    branchContextMenuRef,
    branchDiffCacheRef,
    branchesWidth,
    buildCreatePrInitialStages,
    checkoutGitBranch: scopedCheckoutGitBranch,
    cherryPickCommit,
    clamp,
    clearOperationNotice,
    closeBranchContextMenu,
    commitContextMenu,
    commitListRef,
    commits: displayCommits,
    historyLoadedCount: commits.length,
    commitsWidth,
    createBranchName,
    createBranchSource,
    createBranchSourceOptions,
    createGitBranchFromBranch,
    createGitBranchFromCommit,
    createGitPrWorkflow,
    createOperationErrorState,
    createPrCanConfirm,
    createPrCanOpen,
    createPrDefaultsLoadTokenRef,
    createPrDefaultsLoading,
    createPrDialogOpen,
    createPrForm,
    createPrPreviewBaseRef,
    createPrPreviewBaseRemoteName,
    createPrPreviewDetailsCacheRef,
    createPrPreviewDetailsLoadTokenRef,
    createPrPreviewHeadRef,
    createPrPreviewLoadTokenRef,
    createPrPreviewSelectedSha,
    createPrProgressTimerRef,
    createPrResult,
    createPrSubmitting,
    currentBranch,
    currentLocalBranchEntry,
    deleteGitBranch,
    desktopSplitLayout,
    details,
    detailsBodyRef,
    extractWorktreePathFromDeleteError,
    fallbackGitRoots,
    fallbackGitRootsLoading,
    fallbackSelectingRoot,
    fetchGit: scopedFetchGit,
    getDefaultColumnWidths,
    getGitBranchCompareCommits,
    getGitCommitDetails: scopedGetGitCommitDetails,
    getGitDiffs: scopedGetGitDiffs,
    getGitPrWorkflowDefaults,
    getGitPushPreview: scopedGetGitPushPreview,
    getGitStatus: scopedGetGitStatus,
    getGitWorktreeDiffAgainstBranch,
    getGitWorktreeDiffFileAgainstBranch,
    getOperationDisplayName,
    historyHasMore,
    historyLoading,
    historyLoadingMore,
    isBranchDeleteNotFullyMergedError,
    isBranchDeleteUsedByWorktreeError,
    listGitRoots,
    loadHistory,
    localBranches,
    localizeKnownGitError,
    mainGridRef,
    mapCreatePrStagesFromResult,
    mergeGitBranch,
    onOpenDiffPath,
    onSelectWorkspace,
    onSelectWorkspacePath,
    operationLoading,
    overviewWidth,
    owner,
    projectOptions,
    promptForceDeleteDialog,
    pullGit: scopedPullGit,
    pullNoCommit,
    pullNoVerify,
    pullRemote,
    pullRemoteOptions,
    pullStrategy,
    pullTargetBranch,
    pushCanConfirm,
    pushCc,
    pushDialogOpen,
    pushForceWithLease,
    pushGit: scopedPushGit,
    pushPreviewDetailsLoadTokenRef,
    pushPreviewLoadTokenRef,
    pushPreviewSelectedSha,
    pushRemoteOptions,
    pushRemoteTrimmed,
    pushReviewers,
    pushRunHooks,
    pushTags,
    pushTargetBranchTrimmed,
    pushTargetHistory,
    pushToGerrit,
    pushTopic,
    rebaseGitBranch,
    refreshAll,
    renameBranchCanConfirm,
    renameBranchNameTrimmed,
    renameBranchSource,
    renameBranchSubmitting,
    renameGitBranch,
    repositoryUnavailable,
    resetGitCommit,
    resetMode,
    resetTargetSha,
    resolveGitRootPath,
    resolvePushTargetBranchOptions,
    resolveUpstreamTarget,
    revertCommit,
    runOperation,
    selectedBranch,
    selectedCommitSha,
    setBranchContextMenu,
    setBranchDiffState,
    setBranchesWidth,
    setCommitContextMenu,
    setCommitContextMoreOpen,
    setCommitsWidth,
    setComparePreviewFileKey,
    setCreateBranchDialogOpen,
    setCreateBranchName,
    setCreateBranchSource,
    setCreatePrCopiedPrUrl,
    setCreatePrCopiedRetryCommand,
    setCreatePrDefaults,
    setCreatePrDefaultsError,
    setCreatePrDefaultsLoading,
    setCreatePrDialogOpen,
    setCreatePrForm,
    setCreatePrPreviewBaseOnlyCount,
    setCreatePrPreviewCommits,
    setCreatePrPreviewDetails,
    setCreatePrPreviewDetailsError,
    setCreatePrPreviewDetailsLoading,
    setCreatePrPreviewError,
    setCreatePrPreviewExpanded,
    setCreatePrPreviewLoading,
    setCreatePrPreviewSelectedSha,
    setCreatePrResult,
    setCreatePrStages,
    setDesktopSplitLayout,
    setDetailsSplitRatio,
    setExpandedDirs,
    setExpandedLocalScopes,
    setExpandedRemoteScopes,
    setFallbackGitRoots,
    setFallbackGitRootsError,
    setFallbackGitRootsLoading,
    setFallbackSelectingRoot,
    setFetchDialogOpen,
    setIsCreatePrDialogMaximized,
    setOperationLoading,
    setOverviewWidth,
    setPullDialogOpen,
    setPullNoCommit,
    setPullNoVerify,
    setPullOptionsMenuOpen,
    setPullRemote,
    setPullRemoteMenuOpen,
    setPullRemoteMenuPlacement,
    setPullStrategy,
    setPullTargetBranch,
    setPullTargetBranchMenuOpen,
    setPullTargetBranchMenuPlacement,
    setPullTargetBranchQuery,
    setPushCc,
    setPushDialogOpen,
    setPushForceWithLease,
    setPushPreviewCommits,
    setPushPreviewDetails,
    setPushPreviewDetailsError,
    setPushPreviewDetailsLoading,
    setPushPreviewError,
    setPushPreviewExpandedDirs,
    setPushPreviewHasMore,
    setPushPreviewLoading,
    setPushPreviewSelectedSha,
    setPushPreviewTargetFound,
    setPushRemote,
    setPushRemoteMenuOpen,
    setPushReviewers,
    setPushRunHooks,
    setPushTags,
    setPushTargetBranch,
    setPushTargetBranchMenuOpen,
    setPushTargetBranchMenuPlacement,
    setPushTargetBranchQuery,
    setPushTargetHistory,
    setPushToGerrit,
    setPushTopic,
    setRefreshDialogOpen,
    setRenameBranchDialogOpen,
    setRenameBranchName,
    setRenameBranchSource,
    setResetDialogOpen,
    setResetMode,
    setResetTargetSha,
    setSelectedBranch,
    setSelectedCommitSha,
    setSyncDialogOpen,
    setSyncPreviewCommits,
    setSyncPreviewError,
    setSyncPreviewLoading,
    setSyncPreviewTargetBranch,
    setSyncPreviewTargetFound,
    setSyncPreviewTargetRemote,
    setWorkingTreeChangedFiles,
    setWorkingTreeTotalAdditions,
    setWorkingTreeTotalDeletions,
    setWorkspaceSelectingId,
    setWorktreePreviewError,
    setWorktreePreviewFile,
    setWorktreePreviewLoading,
    showOperationNotice,
    splitGitHubRepo,
    syncDialogOpen,
    syncGit: scopedSyncGit,
    syncPreviewTargetBranch,
    syncPreviewTargetRemote,
    t,
    trimmed,
    updateGitBranch: scopedUpdateGitBranch,
    useCallback,
    useEffect,
    useMemo,
    useVirtualizer,
    workbenchGridRef,
    workspace,
    workspaceId,
    workspaceSelectingId,
    workspaces,
  });
  // ponytail: PR generation 状态机留在 impl，避免扩大 giant interaction-hook 的 scope。
  useEffect(() => {
    if (!createPrContentStartedAt) {
      setCreatePrContentElapsedSec(0);
      return;
    }
    const tick = () =>
      setCreatePrContentElapsedSec(
        Math.floor((Date.now() - createPrContentStartedAt) / 1000),
      );
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [createPrContentStartedAt]);
  useEffect(() => {
    if (createPrFormFlashAt === null) return;
    const timer = window.setTimeout(() => setCreatePrFormFlashAt(null), 1200);
    return () => window.clearTimeout(timer);
  }, [createPrFormFlashAt]);
  useEffect(() => {
    if (createPrContentSuccessAt === null) return;
    const timer = window.setTimeout(
      () => setCreatePrContentSuccessAt(null),
      3000,
    );
    return () => window.clearTimeout(timer);
  }, [createPrContentSuccessAt]);
  const triggerPrContentGeneration = useCallback(
    async (engine: CommitMessageEngine, language: CommitMessageLanguage) => {
      if (!workspace || !createPrPreviewBaseRef || !createPrPreviewHeadRef) {
        setCreatePrContentError(
          t("git.historyGeneratePrMissingBaseOrHead", {
            defaultValue:
              "Cannot generate PR content: base or head branch is missing",
          }),
        );
        return;
      }
      if (!isEngineExecutionEnabled(engine)) {
        setCreatePrContentError(
          t("git.historyGeneratePrUnsupportedEngine", {
            defaultValue: "The selected engine is unavailable",
          }),
        );
        return;
      }

      setCreatePrContentEngine(engine);
      setCreatePrContentGenerating(true);
      setCreatePrContentError(null);
      setCreatePrContentSuccessAt(null);
      setCreatePrFormFlashAt(null);
      setCreatePrContentSlow(false);
      setCreatePrContentStartedAt(Date.now());
      const generationToken = ++createPrContentGenerationTokenRef.current;
      saveLastCommitMessageConfig({ engine, language });

      try {
        const result = await generatePullRequestContent(
          workspace.id,
          language,
          engine,
          createPrPreviewBaseRef,
          createPrPreviewHeadRef,
          (event) => {
            if (
              generationToken === createPrContentGenerationTokenRef.current &&
              event.kind === "soft-warn"
            ) {
              setCreatePrContentSlow(true);
            }
          },
        );
        if (generationToken !== createPrContentGenerationTokenRef.current)
          return;

        setCreatePrForm((previous) => ({
          ...previous,
          title: result.title,
          body: result.body,
        }));
        setCreatePrFormFlashAt(Date.now());
        setCreatePrContentSuccessAt(Date.now());
      } catch (error) {
        if (generationToken !== createPrContentGenerationTokenRef.current)
          return;
        const raw = error instanceof Error ? error.message : String(error);
        const localized = /timed out/i.test(raw)
          ? t("git.historyGeneratePrTimeout", {
              defaultValue: "AI generation timed out, please retry",
            })
          : /unsupported_engine|unsupported engine/i.test(raw)
            ? t("git.historyGeneratePrUnsupportedEngine", {
                defaultValue: "The selected engine is unavailable",
              })
            : t("git.historyGeneratePrError", {
                error: raw,
                defaultValue: "PR content generation failed: {{error}}",
              });
        setCreatePrContentError(localized);
      } finally {
        if (generationToken === createPrContentGenerationTokenRef.current) {
          setCreatePrContentGenerating(false);
          setCreatePrContentStartedAt(null);
          setCreatePrContentSlow(false);
        }
      }
    },
    [createPrPreviewBaseRef, createPrPreviewHeadRef, t, workspace],
  );
  useEffect(() => {
    if (createPrDialogOpen) return;
    createPrContentGenerationTokenRef.current += 1;
    setCreatePrContentGenerating(false);
    setCreatePrContentStartedAt(null);
    setCreatePrContentSlow(false);
    setCreatePrContentError(null);
    setCreatePrContentSuccessAt(null);
    setPrContentMenu(null);
  }, [createPrDialogOpen]);
  const openPrContentGenerationMenu = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (createPrContentGenerating) return;

      const triggerRect = event.currentTarget.getBoundingClientRect();
      const menuSize = { width: 260, height: 240 };
      const position = clampRendererContextMenuPosition(
        triggerRect.right - menuSize.width,
        triggerRect.bottom + 8,
        menuSize,
      );
      const lastConfig = readLastCommitMessageConfig();
      const engineItems: Array<{ engine: CommitMessageEngine; label: string }> =
        [
          { engine: "codex", label: t("git.historyGeneratePrMenuCodex") },
          { engine: "claude", label: t("git.historyGeneratePrMenuClaude") },
        ];
      setPrContentMenu({
        ...position,
        label: t("git.historyGeneratePrMenuTitle"),
        items: [
          {
            type: "item",
            id: "pr-content-last-config",
            label: t("git.historyGeneratePrMenuLastConfig"),
            disabled: !lastConfig,
            onSelect: () => {
              if (lastConfig) {
                void triggerPrContentGeneration(
                  lastConfig.engine,
                  lastConfig.language,
                );
              }
            },
          },
          { type: "separator", id: "pr-content-last-config-separator" },
          ...engineItems.map<RendererContextMenuItem>(({ engine, label }) => ({
            type: "submenu",
            id: `pr-content-engine-${engine}`,
            label,
            items: [
              {
                type: "item",
                id: `pr-content-${engine}-lang-zh`,
                label: t("git.historyGeneratePrMenuZh"),
                onSelect: () => triggerPrContentGeneration(engine, "zh"),
              },
              {
                type: "item",
                id: `pr-content-${engine}-lang-en`,
                label: t("git.historyGeneratePrMenuEn"),
                onSelect: () => triggerPrContentGeneration(engine, "en"),
              },
            ],
          })),
        ],
      });
    },
    [createPrContentGenerating, t, triggerPrContentGeneration],
  );

  useEffect(
    () =>
      subscribeGitRepositoryActionIntent((intent) => {
        if (intent.action === "push") {
          handleOpenPushDialog();
          return;
        }
        if (intent.action === "pull") {
          handleOpenPullDialog();
          return;
        }
        if (intent.action === "fetch") {
          handleOpenFetchDialog();
          return;
        }
        if (intent.action === "reset-head") {
          openResetDialog(selectedCommitSha);
          return;
        }
        if (intent.action === "show-history") {
          void refreshAll();
          return;
        }
        showOperationNotice({
          kind: "success",
          message: t("git.repositoryMenuContinueInHistory", {
            action: t(GIT_REPOSITORY_ACTION_LABEL_KEYS[intent.action]),
          }),
        });
      }),
    [
      handleOpenFetchDialog,
      handleOpenPullDialog,
      handleOpenPushDialog,
      openResetDialog,
      refreshAll,
      selectedCommitSha,
      showOperationNotice,
      t,
    ],
  );

  useEffect(() => {
    writeClientStoreValue("layout", persistenceKey, {
      overviewWidth,
      branchesWidth,
      commitsWidth,
      detailsSplitRatio,
      selectedBranch,
      commitQuery,
      commitAuthor,
      commitDatePreset,
      selectedCommitSha,
      diffStyle: diffViewMode,
    } satisfies GitHistoryPanelPersistedState);
  }, [
    branchesWidth,
    commitAuthor,
    commitDatePreset,
    commitQuery,
    commitsWidth,
    detailsSplitRatio,
    diffViewMode,
    overviewWidth,
    persistenceKey,
    selectedBranch,
    selectedCommitSha,
  ]);

  return renderGitHistoryPanelView({
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
    History,
    LayoutGrid,
    LoaderCircle,
    MessageSquareText,
    Pencil,
    Plus,
    RefreshCw,
    Repeat,
    Search,
    ShieldAlert,
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
    branchesWidth,
    buildFileKey,
    clearOperationNotice,
    closeBranchContextMenu,
    closeBranchDiff,
    closeCreatePrDialog,
    closeForceDeleteDialog,
    closeRenameBranchDialog,
    closeWorktreePreview,
    codeAnnotations,
    commitContextMenu,
    commitContextMoreOpen,
    commitFilterSurface,
    commitListRef,
    commitRowVirtualizer,
    commits: displayCommits,
    commitGraphLayout,
    commitsWidth,
    comparePreviewDetailFile,
    comparePreviewDetailFileDiff,
    comparePreviewDiffEntries,
    comparePreviewFileKey,
    contextMoreDisabledReason,
    contextPrimaryActionGroups,
    contextWriteActions,
    createBranchCanConfirm,
    createBranchDialogOpen,
    createBranchName,
    createBranchNameInputRef,
    createBranchSource,
    createBranchSourceOptions,
    createBranchSubmitting,
    createPortal,
    createPrBaseBranchOptions,
    createPrBaseRepoOptions,
    createPrCanConfirm,
    createPrCanOpen,
    createPrCompareBranchOptions,
    createPrContentElapsedSec,
    createPrContentEngine,
    createPrContentError,
    createPrContentGenerating,
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
    createPrToolbarDisabledReason,
    currentBranch,
    currentLocalBranchEntry,
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
    forceDeleteCopiedPath,
    forceDeleteCountdown,
    forceDeleteDialogState,
    formatRelativeTime,
    getBranchLeafName,
    getBranchScope,
    getCommitActionIcon,
    getCurrentDefaultColumnWidths,
    getSpecialBranchBadges,
    getTreeLineOpacity,
    groupedLocalBranches,
    groupedRemoteBranches,
    handleBranchContextMenuKeyDown,
    handleBranchesSplitResizeStart,
    handleCommitsSplitResizeStart,
    handleConfirmCreatePr,
    handleConfirmFetch,
    handleConfirmPull,
    handleConfirmPush,
    handleConfirmRefresh,
    handleConfirmResetCommit,
    handleConfirmSync,
    handleCopyCreatePrRetryCommand,
    handleCopyCreatePrUrl,
    handleCopyForceDeleteWorktreePath,
    handleCreateBranch,
    handleCreateBranchConfirm,
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
    handleOverviewSplitResizeStart,
    handlePushPreviewDirToggle,
    handleRenameBranchConfirm,
    handleSelectBranchCompareCommit,
    handleSelectPullRemote,
    handleSelectPullTargetBranch,
    handleSelectPushRemote,
    handleSelectPushTargetBranch,
    handleSelectPushHistory,
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
    onOpenDiffPath,
    onRequestClose,
    onSelectRepository,
    onSelectWorkspace,
    openPrContentGenerationMenu,
    openPullTargetBranchMenu,
    openPushTargetBranchMenu,
    operationLoading,
    operationNotice,
    overviewCommitSectionCollapsed,
    overviewListView,
    overviewWidth,
    prContentMenu,
    previewDetailFile,
    previewDetailFileDiff,
    previewDiffEntries,
    previewModalFullDiffLoader,
    projectOptions,
    projectSections,
    pullDialogOpen,
    pullNoCommit,
    pullNoVerify,
    pullOptionsMenuOpen,
    pullOptionsMenuRef,
    pullRemote,
    pullRemoteGroups,
    pullRemoteMenuOpen,
    pullRemoteMenuPlacement,
    pullRemotePickerRef,
    pullRemoteTrimmed,
    pullSelectedOptions,
    pullStrategy,
    pullSubmitting,
    pullTargetBranch,
    pullTargetBranchActiveScopeTab,
    pullTargetBranchFieldRef,
    pullTargetBranchGroups,
    pullTargetBranchMenuOpen,
    pullTargetBranchMenuPlacement,
    pullTargetBranchMenuRef,
    pullTargetBranchPickerRef,
    pullTargetBranchTrimmed,
    pushCanConfirm,
    pushCc,
    pushDialogOpen,
    pushForceWithLease,
    pushHasOutgoingCommits,
    pushIsNewBranchTarget,
    pushPreviewCommits,
    pushPreviewDetails,
    pushPreviewDetailsError,
    pushPreviewDetailsLoading,
    pushPreviewError,
    pushPreviewFileTreeItems,
    pushPreviewHasMore,
    pushPreviewLoading,
    pushPreviewModalDiffEntries,
    pushPreviewModalFile,
    pushPreviewModalFileDiff,
    pushPreviewModalFullDiffLoader,
    pushPreviewSelectedCommit,
    pushPreviewSelectedFileKey,
    pushPreviewSelectedSha,
    pushRemoteMenuOpen,
    pushRemoteMenuPlacement,
    pushRemoteOptions,
    pushRemotePickerRef,
    pushRemoteTrimmed,
    pushReviewers,
    pushRunHooks,
    pushSubmitting,
    pushTags,
    pushTargetBranch,
    pushTargetBranchActiveScopeTab,
    pushTargetBranchFieldRef,
    pushTargetBranchGroups,
    pushTargetBranchMenuOpen,
    pushTargetBranchMenuPlacement,
    pushTargetBranchMenuRef,
    pushTargetBranchPickerRef,
    pushTargetBranchTrimmed,
    pushTargetHistory,
    pushTargetSummaryBranch,
    pushToGerrit,
    pushTopic,
    refreshAll,
    refreshDialogOpen,
    refreshSubmitting,
    remoteSectionExpanded,
    renameBranchCanConfirm,
    renameBranchDialogOpen,
    renameBranchName,
    renameBranchNameInputRef,
    renameBranchSource,
    renameBranchSubmitting,
    renameBranchToolbarDisabledReason,
    renderChangedFilesSummary,
    repositories,
    repositoryBranchCatalogs,
    repositoryRootName,
    repositoryUnavailable,
    resetDialogOpen,
    resetMode,
    resetTargetCommit,
    resetTargetSha,
    runCommitAction,
    selectedBranch,
    selectedCommitSha,
    selectedFileKey,
    selectedLocalBranchForRename,
    selectedRepositoryRoot,
    setBranchQuery,
    setBranchesWidth,
    setCommitContextMenu,
    setCommitContextMoreOpen,
    setCommitsWidth,
    setComparePreviewFileKey,
    setCreateBranchDialogOpen,
    setCreateBranchName,
    setCreateBranchSource,
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
    setOverviewWidth,
    setPrContentMenu,
    setPreviewFileKey,
    setPullDialogOpen,
    setPullNoCommit,
    setPullNoVerify,
    setPullOptionsMenuOpen,
    setPullRemoteMenuOpen,
    setPullStrategy,
    setPullTargetBranch,
    setPullTargetBranchActiveScopeTab,
    setPullTargetBranchMenuOpen,
    setPullTargetBranchQuery,
    setPushCc,
    setPushDialogOpen,
    setPushForceWithLease,
    setPushPreviewModalFileKey,
    setPushPreviewSelectedFileKey,
    setPushPreviewSelectedSha,
    setPushRemoteMenuOpen,
    setPushReviewers,
    setPushRunHooks,
    setPushTags,
    setPushTargetBranch,
    setPushTargetBranchActiveScopeTab,
    setPushTargetBranchMenuOpen,
    setPushTargetBranchQuery,
    setPushToGerrit,
    setPushTopic,
    setRefreshDialogOpen,
    setRemoteSectionExpanded,
    setRenameBranchName,
    setResetDialogOpen,
    setResetMode,
    setSelectedBranch,
    setSelectedCommitSha,
    setSelectedFileKey,
    setSyncDialogOpen,
    setWorkspaceSelectingId,
    shouldShowWorkspacePickerPage,
    statusLabel,
    strokeWidth,
    syncDialogOpen,
    syncPreviewCommits,
    syncPreviewError,
    syncPreviewLoading,
    syncPreviewTargetBranch,
    syncPreviewTargetFound,
    syncPreviewTargetRemote,
    syncSubmitting,
    t,
    trimRemotePrefix,
    updatePullRemoteMenuPlacement,
    updatePushRemoteMenuPlacement,
    virtualCommitRows,
    visiblePullTargetBranchGroups,
    visiblePushTargetBranchGroups,
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
    toolbarTabsNode,
    documentContentNode,
    activeDocumentTabId,
  });
});
