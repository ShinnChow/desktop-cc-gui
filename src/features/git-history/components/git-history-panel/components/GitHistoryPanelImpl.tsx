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
} from "../../../../../types";

import type {
  CommitMessageEngine,
} from "../../../../../services/tauri/commitMessage";
import {
  cherryPickCommit,
  createGitPrWorkflow,
  createGitBranchFromBranch,
  createGitBranchFromCommit,
  deleteGitBranch,
  getGitPrWorkflowDefaults,
  type GitPullStrategyOption,
  getGitBranchCompareCommits,
  getGitWorktreeDiffAgainstBranch,
  getGitWorktreeDiffFileAgainstBranch,
  listGitRoots,
  mergeGitBranch,
  rebaseGitBranch,
  renameGitBranch,
  resetGitCommit,
  revertCommit,
} from "../../../../../services/tauri";
import {
  getClientStoreSync,
} from "../../../../../services/clientStorage";
import { pushErrorToast } from "../../../../../services/toasts";
import { FileIcon } from "../../../../../components/FileIcon";
import { GitDiffViewer } from "../../../../git/components/GitDiffViewer";
import { GitHistoryWorktreePanel } from "../../GitHistoryWorktreePanel";
import { useGitHistoryPanelInteractions } from "../hooks/useGitHistoryPanelInteractions";
import { useGitHistoryPanelDataLoading } from "./useGitHistoryPanelDataLoading";
import { useGitHistoryPanelBranchList } from "./useGitHistoryPanelBranchList";
import { useGitHistoryPanelCreatePrDerived } from "./useGitHistoryPanelCreatePrDerived";
import { useGitHistoryPanelDialogEffects } from "./useGitHistoryPanelDialogEffects";
import { useGitHistoryPanelOperationFeedback } from "./useGitHistoryPanelOperationFeedback";
import { useGitHistoryPanelPrContentGeneration } from "./useGitHistoryPanelPrContentGeneration";
import { useGitHistoryPanelPreviewDerivations } from "./useGitHistoryPanelPreviewDerivations";
import { useGitHistoryPanelProjectSections } from "./useGitHistoryPanelProjectSections";
import { useGitHistoryPanelPushPullMenus } from "./useGitHistoryPanelPushPullMenus";
import { useGitHistoryPanelRemoteBranchOptions } from "./useGitHistoryPanelRemoteBranchOptions";
import { useGitHistoryPanelScopedServices } from "./useGitHistoryPanelScopedServices";
import { useGitHistoryPanelShellEffects } from "./useGitHistoryPanelShellEffects";
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
  VERTICAL_SPLITTER_SIZE,
  buildCreatePrInitialStages,
  clamp,
  extractCommitBody,
  getCommitActionIcon,
  getDefaultColumnWidths,
  mapCreatePrStagesFromResult,
  splitGitHubRepo,
  type CreatePrStageView,
} from "./GitHistoryPanelImplHelpers";
import type {
  BranchMenuSource,
  BranchContextMenuState,
  BranchDiffState,
  CommitContextMenuState,
  CreatePrFormState,
  ForceDeleteDialogState,
  GitHistoryPanelProps,
  GitHistoryPanelPersistedState,
  GitOperationNoticeState,
  GitResetMode,
  WorktreePreviewFile,
} from "./GitHistoryPanelTypes";
import {
  ActionSurface,
  GitHistoryInlinePicker,
  GitHistoryProjectPicker,
} from "./GitHistoryPanelPickers";
import {
  formatRelativeTime,
  statusLabel,
  buildFileKey,
  getTreeLineOpacity,
  renderChangedFilesSummary,
  getPathLeafName,
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
  const {
    scopedCheckoutGitBranch,
    scopedFetchGit,
    scopedGetGitCommitDetails,
    scopedGetGitDiffs,
    scopedGetGitPushPreview,
    scopedGetGitStatus,
    scopedPullGit,
    scopedPushGit,
    scopedSyncGit,
    scopedUpdateGitBranch,
  } = useGitHistoryPanelScopedServices({
    selectedRepositoryRoot,
  });
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

  const {
    createBranchSourceOptions,
    groupedLocalBranches,
    groupedRemoteBranches,
  } = useGitHistoryPanelBranchList({
    branchCompareDetailsCacheRef,
    branchContextMenu,
    branchContextMenuRef,
    branchDiffCacheRef,
    branchQuery,
    closeBranchContextMenu,
    createBranchDialogOpen,
    createBranchNameInputRef,
    currentBranch,
    localBranches,
    remoteBranches,
    renameBranchDialogOpen,
    renameBranchNameInputRef,
    setBranchDiffState,
    setComparePreviewFileKey,
    setExpandedLocalScopes,
    setExpandedRemoteScopes,
    setLocalSectionExpanded,
    setRemoteSectionExpanded,
    t,
    workspaceId,
  });

  const {
    comparePreviewDetailFile,
    comparePreviewDetailFileDiff,
    comparePreviewDiffEntries,
    detailsMessageContent,
    fileTreeItems,
    previewDetailFile,
    previewDetailFileDiff,
    previewDiffEntries,
    previewModalFullDiffLoader,
    pushPreviewFileTreeItems,
    pushPreviewModalDiffEntries,
    pushPreviewModalFile,
    pushPreviewModalFileDiff,
    pushPreviewModalFullDiffLoader,
    worktreePreviewDiffEntries,
    worktreePreviewDiffText,
    worktreePreviewFullDiffLoader,
  } = useGitHistoryPanelPreviewDerivations({
    branchDiffState,
    commitFullDiffCacheRef,
    comparePreviewFileKey,
    details,
    expandedDirs,
    previewFileKey,
    pushPreviewDetails,
    pushPreviewExpandedDirs,
    pushPreviewModalFileKey,
    pushPreviewSelectedSha,
    repositoryRootName,
    selectedCommitSha,
    selectedRepositoryRoot,
    setComparePreviewFileKey,
    setIsHistoryDiffModalMaximized,
    setPreviewFileKey,
    setPushPreviewModalFileKey,
    setWorktreePreviewError,
    setWorktreePreviewFile,
    setWorktreePreviewLoading,
    t,
    workspaceId,
    worktreePreviewFile,
  });

  useGitHistoryPanelDialogEffects({
    commitContextMenu,
    previewDetailFile,
    previewFileKey,
    pullDialogOpen,
    pullOptionsMenuOpen,
    pullOptionsMenuRef,
    pullRemoteMenuOpen,
    pullRemotePickerRef,
    pullTargetBranchFieldRef,
    pullTargetBranchMenuOpen,
    pushDialogOpen,
    pushPreviewDetails,
    pushPreviewDetailsLoadTokenRef,
    pushPreviewLoadTokenRef,
    pushPreviewModalFile,
    pushPreviewModalFileKey,
    pushRemoteMenuOpen,
    pushRemotePickerRef,
    pushTargetBranchFieldRef,
    pushTargetBranchMenuOpen,
    setCommitContextMenu,
    setCommitContextMoreOpen,
    setPreviewFileKey,
    setPullOptionsMenuOpen,
    setPullRemoteMenuOpen,
    setPullRemoteMenuPlacement,
    setPullTargetBranchMenuOpen,
    setPullTargetBranchMenuPlacement,
    setPullTargetBranchQuery,
    setPushPreviewCommits,
    setPushPreviewDetails,
    setPushPreviewDetailsError,
    setPushPreviewDetailsLoading,
    setPushPreviewError,
    setPushPreviewExpandedDirs,
    setPushPreviewHasMore,
    setPushPreviewLoading,
    setPushPreviewModalFileKey,
    setPushPreviewSelectedFileKey,
    setPushPreviewSelectedSha,
    setPushPreviewTargetFound,
    setPushRemoteMenuOpen,
    setPushRemoteMenuPlacement,
    setPushTargetBranchMenuOpen,
    setPushTargetBranchMenuPlacement,
    setPushTargetBranchQuery,
    setSyncPreviewCommits,
    setSyncPreviewError,
    setSyncPreviewLoading,
    setSyncPreviewTargetFound,
    syncDialogOpen,
  });

  const {
    closeForceDeleteDialog,
    clearOperationNotice,
    createOperationErrorState,
    extractWorktreePathFromDeleteError,
    getOperationDisplayName,
    handleCopyForceDeleteWorktreePath,
    isBranchDeleteNotFullyMergedError,
    isBranchDeleteUsedByWorktreeError,
    localizeKnownGitError,
    localizedOperationName,
    promptForceDeleteDialog,
    runOperation,
    showOperationNotice,
  } = useGitHistoryPanelOperationFeedback({
    createPrProgressTimerRef,
    forceDeleteDialogResolverRef,
    forceDeleteDialogState,
    operationLoading,
    operationNoticeTimerRef,
    refreshAll,
    setForceDeleteCopiedPath,
    setForceDeleteCountdown,
    setForceDeleteDialogState,
    setOperationLoading,
    setOperationNotice,
    t,
  });

  const {
    createBranchCanConfirm,
    createBranchSubmitting,
    createPrBaseBranchOptions,
    createPrBaseRepoOptions,
    createPrCanConfirm,
    createPrCanOpen,
    createPrCompareBranchOptions,
    createPrHeadRepoOptions,
    createPrHeadRepositoryValue,
    createPrPreviewBaseRef,
    createPrPreviewBaseRemoteName,
    createPrPreviewHasMore,
    createPrPreviewHeadRef,
    createPrPreviewSelectedCommit,
    createPrResultHeadline,
    createPrSubmitting,
    createPrToolbarDisabledReason,
    renameBranchCanConfirm,
    renameBranchNameTrimmed,
    renameBranchSubmitting,
    renameBranchToolbarDisabledReason,
    selectedLocalBranchForRename,
  } = useGitHistoryPanelCreatePrDerived({
    createBranchName,
    createBranchSource,
    createPrDefaults,
    createPrDefaultsError,
    createPrDefaultsLoading,
    createPrForm,
    createPrPreviewCommits,
    createPrPreviewSelectedSha,
    createPrResult,
    currentBranch,
    localBranches,
    operationLoading,
    remoteBranches,
    renameBranchName,
    renameBranchSource,
    repositoryUnavailable,
    selectedBranch,
    t,
    workspaceId,
  });
  const {
    fetchSubmitting,
    pullRemoteGroups,
    pullRemoteOptions,
    pullRemoteTrimmed,
    pullSelectedOptions,
    pullSubmitting,
    pullTargetBranchGroups,
    pullTargetBranchTrimmed,
    pushRemoteOptions,
    pushRemoteTrimmed,
    pushSubmitting,
    pushTargetBranchGroups,
    pushTargetBranchTrimmed,
    refreshSubmitting,
    resolvePushTargetBranchOptions,
    syncSubmitting,
    visiblePullTargetBranchGroups,
    visiblePushTargetBranchGroups,
  } = useGitHistoryPanelRemoteBranchOptions({
    operationLoading,
    pullNoCommit,
    pullNoVerify,
    pullRemote,
    pullStrategy,
    pullTargetBranch,
    pullTargetBranchActiveScopeTab,
    pullTargetBranchQuery,
    pushRemote,
    pushTargetBranch,
    pushTargetBranchActiveScopeTab,
    pushTargetBranchQuery,
    remoteBranches,
    setPullNoCommit,
    setPullNoVerify,
    setPullStrategy,
    t,
  });

  const {
    openPullTargetBranchMenu,
    openPushTargetBranchMenu,
    pushCanConfirm,
    pushHasOutgoingCommits,
    pushIsNewBranchTarget,
    pushPreviewSelectedCommit,
    pushTargetSummaryBranch,
    updatePullRemoteMenuPlacement,
    updatePushRemoteMenuPlacement,
  } = useGitHistoryPanelPushPullMenus({
    currentBranch,
    pullDialogOpen,
    pullRemoteMenuOpen,
    pullSubmitting,
    pullTargetBranchActiveScopeTab,
    pullTargetBranchGroups,
    pullTargetBranchMenuOpen,
    pullTargetBranchMenuRef,
    pullTargetBranchPickerRef,
    pullTargetBranchTrimmed,
    pushDialogOpen,
    pushPreviewCommits,
    pushPreviewError,
    pushPreviewLoading,
    pushPreviewSelectedSha,
    pushPreviewTargetFound,
    pushRemoteMenuOpen,
    pushRemoteTrimmed,
    pushSubmitting,
    pushTargetBranchActiveScopeTab,
    pushTargetBranchGroups,
    pushTargetBranchMenuOpen,
    pushTargetBranchMenuRef,
    pushTargetBranchPickerRef,
    pushTargetBranchTrimmed,
    pushToGerrit,
    setPullOptionsMenuOpen,
    setPullRemoteMenuOpen,
    setPullRemoteMenuPlacement,
    setPullTargetBranchActiveScopeTab,
    setPullTargetBranchMenuOpen,
    setPullTargetBranchMenuPlacement,
    setPullTargetBranchQuery,
    setPushRemoteMenuOpen,
    setPushRemoteMenuPlacement,
    setPushTargetBranchActiveScopeTab,
    setPushTargetBranchMenuOpen,
    setPushTargetBranchMenuPlacement,
    setPushTargetBranchQuery,
    workspaceId,
  });

  const {
    projectOptions,
    projectSections,
    workingTreeSummaryLabel,
  } = useGitHistoryPanelProjectSections({
    groupedWorkspaces,
    selectedProjectWorkspaceId,
    t,
    workspace,
    workspaces,
    workingTreeChangedFiles,
  });
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
  const {
    openPrContentGenerationMenu,
  } = useGitHistoryPanelPrContentGeneration({
    createPrContentGenerating,
    createPrContentGenerationTokenRef,
    createPrContentStartedAt,
    createPrContentSuccessAt,
    createPrDialogOpen,
    createPrFormFlashAt,
    createPrPreviewBaseRef,
    createPrPreviewHeadRef,
    setCreatePrContentElapsedSec,
    setCreatePrContentEngine,
    setCreatePrContentError,
    setCreatePrContentGenerating,
    setCreatePrContentSlow,
    setCreatePrContentStartedAt,
    setCreatePrContentSuccessAt,
    setCreatePrForm,
    setCreatePrFormFlashAt,
    setPrContentMenu,
    t,
    workspace,
  });

  useGitHistoryPanelShellEffects({
    branchesWidth,
    commitAuthor,
    commitDatePreset,
    commitQuery,
    commitsWidth,
    detailsSplitRatio,
    diffViewMode,
    handleOpenFetchDialog,
    handleOpenPullDialog,
    handleOpenPushDialog,
    openResetDialog,
    overviewWidth,
    persistenceKey,
    refreshAll,
    selectedBranch,
    selectedCommitSha,
    showOperationNotice,
    t,
  });

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
