import type {
  CSSProperties,
  Dispatch,
  Key,
  KeyboardEvent,
  MemoExoticComponent,
  MouseEvent,
  ReactElement,
  ReactNode,
  ReactPortal,
  RefObject,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import type { useVirtualizer } from "@tanstack/react-virtual";
import type { TFunction } from "i18next";
import type { LucideIcon } from "lucide-react";
import type { ConfirmDialogOptions } from "@tauri-apps/plugin-dialog";
import type {
  GitBranchCompareCommitSets,
  GitBranchListItem,
  GitBranchUpdateResult,
  GitCommitDetails,
  GitCommitDiff,
  GitCommitFileChange,
  GitFileDiff,
  GitFileStatus,
  GitHistoryCommit,
  GitPrWorkflowDefaults,
  GitPrWorkflowResult,
  GitPrWorkflowStage,
  GitPushPreviewResponse,
  GitRepositorySummary,
  WorkspaceInfo,
} from "../../../../../types";
import type {
  CodeAnnotationBridgeProps,
  CodeAnnotationDraftInput,
  CodeAnnotationSelection,
} from "../../../../code-annotations/types";
import type {
  CreateGitPrWorkflowOptions,
  GitPullStrategyOption,
  getGitPushPreview,
  pullGit,
  pushGit,
} from "../../../../../services/tauri";
import type { GitDiffViewer } from "../../../../git/components/GitDiffViewer";
import type { CommitMessageEngine } from "../../../../../services/tauri/commitMessage";
import type { FileIconProps } from "../../../../../components/FileIcon";
import type { RendererContextMenuState } from "../../../../../components/ui/RendererContextMenu";
import type { GitHistoryWorktreePanelProps } from "../../GitHistoryWorktreePanel";
import type { GitHistoryRepositoryBranchCatalog } from "../hooks/useGitHistoryRepositoryBranchCatalogs";
import type { useGitHistoryPanelInteractions } from "../hooks/useGitHistoryPanelInteractions";
import type { GitHistoryGraphLayout } from "../utils/gitHistoryGraphLayout";
import type { FileTreeItem } from "../utils/gitHistoryPanelSharedUtils";
import type { GitPushTargetHistoryEntry } from "../utils/pushTargetHistory";
import type { GitHistoryCommitFiltersProps } from "./GitHistoryCommitFilters";
import type {
  CommitActionId,
  CreatePrStageView,
} from "./GitHistoryPanelImplHelpers";
import type {
  ActionSurfaceProps,
  GitHistoryInlinePickerOption,
  GitHistoryInlinePickerProps,
  GitHistoryProjectPickerProps,
} from "./GitHistoryPanelPickers";
import type { GitHistoryDatePreset } from "../utils/gitHistoryCommitFilters";

export type GitHistoryPanelProps = CodeAnnotationBridgeProps & {
  workspace: WorkspaceInfo | null;
  workspaces?: WorkspaceInfo[];
  groupedWorkspaces?: Array<{
    id: string | null;
    name: string;
    workspaces: WorkspaceInfo[];
  }>;
  selectedProjectWorkspaceId?: string | null;
  repositories?: GitRepositorySummary[];
  selectedRepositoryRoot?: string | null;
  onSelectRepository?: (repositoryRoot: string) => Promise<void> | void;
  onSelectWorkspace?: (workspaceId: string) => void;
  onSelectWorkspacePath?: (path: string) => Promise<void> | void;
  onOpenDiffPath?: (path: string) => void;
  onRequestClose?: () => void;
  /** Shared with main Git panel `gitDiffListView` — flat/tree stay in sync. */
  listView?: "flat" | "tree";
  onListViewChange?: (view: "flat" | "tree") => void;
  toolbarTabsNode?: ReactNode;
  documentContentNode?: ReactNode;
  activeDocumentTabId?: string;
};

export type BranchGroup = {
  key: string;
  label: string;
  items: GitBranchListItem[];
};

export type GitHistoryPanelPersistedState = {
  overviewWidth?: number;
  branchesWidth?: number;
  commitsWidth?: number;
  detailsSplitRatio?: number;
  selectedBranch?: string;
  commitQuery?: string;
  commitAuthor?: string;
  commitDatePreset?: GitHistoryDatePreset;
  selectedCommitSha?: string | null;
  diffStyle?: "split" | "unified";
};

export type GitOperationErrorState = {
  userMessage: string;
  debugMessage: string;
  retryable: boolean;
};

export type GitOperationNoticeState = {
  kind: "success" | "error";
  message: string;
  debugMessage?: string;
};

export type ForceDeleteDialogMode = "notMerged" | "worktreeOccupied";

export type ForceDeleteDialogState = {
  mode: ForceDeleteDialogMode;
  branch: string;
  worktreePath: string | null;
};

export type GitResetMode = "soft" | "mixed" | "hard" | "keep";

export type BranchMenuSource = "local" | "remote";

export type BranchContextMenuState = {
  x: number;
  y: number;
  branch: GitBranchListItem;
  source: BranchMenuSource;
};

export type BranchContextAction = {
  id: string;
  label: string;
  icon: ReactNode;
  tone?: "normal" | "danger";
  disabled?: boolean;
  disabledReason?: string | null;
  dividerBefore?: boolean;
  onSelect: () => void;
};

export type WorktreeBranchDiffState = {
  mode: "worktree";
  requestToken: number;
  branch: string;
  compareBranch: string;
  files: Pick<GitCommitDiff, "path" | "status">[];
  selectedPath: string | null;
  loading: boolean;
  error: string | null;
  selectedDiff: GitCommitDiff | null;
  selectedDiffLoading: boolean;
  selectedDiffError: string | null;
};

export type BranchCompareDirection = "targetOnly" | "currentOnly";

export type BranchCompareState = {
  mode: "branch";
  requestToken: number;
  branch: string;
  compareBranch: string;
  targetOnlyCommits: GitHistoryCommit[];
  currentOnlyCommits: GitHistoryCommit[];
  loading: boolean;
  error: string | null;
  selectedDirection: BranchCompareDirection | null;
  selectedCommitSha: string | null;
  selectedCommitDetails: GitCommitDetails | null;
  selectedCommitLoading: boolean;
  selectedCommitError: string | null;
};

export type BranchDiffState = WorktreeBranchDiffState | BranchCompareState;

export type CommitContextMenuState = {
  x: number;
  y: number;
  commitSha: string;
};

export type CommitActionDescriptor = {
  id: CommitActionId;
  label: string;
  group: "quick" | "branch" | "write";
  disabled: boolean;
  disabledReason?: string;
};

export type PushTargetBranchGroup = {
  scope: string;
  label: string;
  items: string[];
};

export type WorktreePreviewFile = GitFileDiff & {
  status: string;
  additions: number;
  deletions: number;
};

export type CreatePrFormState = {
  upstreamRepo: string;
  baseBranch: string;
  headOwner: string;
  headBranch: string;
  title: string;
  body: string;
  commentAfterCreate: boolean;
  commentBody: string;
};

export type GitHistoryPanelInteractionScope = {
  BRANCHES_MIN_WIDTH: number;
  COMMITS_MIN_WIDTH: number;
  COMPACT_LAYOUT_BREAKPOINT: number;
  CREATE_PR_PREVIEW_COMMIT_LIMIT: number;
  DETAILS_MIN_WIDTH: number;
  DETAILS_SPLIT_MAX: number;
  DETAILS_SPLIT_MIN: number;
  DISABLE_HISTORY_COMMIT_ACTIONS: boolean;
  Download: LucideIcon;
  FileText: LucideIcon;
  FolderTree: LucideIcon;
  GitBranch: LucideIcon;
  GitMerge: LucideIcon;
  OVERVIEW_MIN_WIDTH: number;
  Pencil: LucideIcon;
  Plus: LucideIcon;
  RefreshCw: LucideIcon;
  Repeat: LucideIcon;
  Trash2: LucideIcon;
  Upload: LucideIcon;
  VERTICAL_SPLITTER_SIZE: number;
  ask: (
    message: string,
    options?: string | ConfirmDialogOptions,
  ) => Promise<boolean>;
  branchCompareDetailsCacheRef: RefObject<Map<string, GitCommitDetails>>;
  branchContextMenu: BranchContextMenuState | null;
  branchContextMenuRef: RefObject<HTMLDivElement | null>;
  branchDiffCacheRef: RefObject<Map<string, GitCommitDiff>>;
  branchesWidth: number;
  buildCreatePrInitialStages: (
    t: (key: string) => string,
  ) => CreatePrStageView[];
  checkoutGitBranch: (
    targetWorkspaceId: string,
    name: string,
  ) => Promise<unknown>;
  cherryPickCommit: (workspaceId: string, commitHash: string) => Promise<void>;
  clamp: (value: number, min: number, max: number) => number;
  clearOperationNotice: () => void;
  closeBranchContextMenu: () => void;
  commitContextMenu: CommitContextMenuState | null;
  commitListRef: RefObject<HTMLDivElement | null>;
  /** Commits rendered in the list / graph (may be projected: first-parent / hide-noise). */
  commits: GitHistoryCommit[];
  /** Raw loaded history length used as pagination offset (must not use projected length). */
  historyLoadedCount: number;
  commitsWidth: number;
  createBranchName: string;
  createBranchSource: string;
  createBranchSourceOptions: string[];
  createGitBranchFromBranch: (
    workspaceId: string,
    name: string,
    sourceBranch: string,
  ) => Promise<unknown>;
  createGitBranchFromCommit: (
    workspaceId: string,
    name: string,
    commitHash: string,
  ) => Promise<unknown>;
  createGitPrWorkflow: (
    workspaceId: string,
    options: CreateGitPrWorkflowOptions,
  ) => Promise<GitPrWorkflowResult>;
  createOperationErrorState: (rawMessage: string) => GitOperationErrorState;
  createPrCanConfirm: boolean;
  createPrCanOpen: boolean;
  createPrDefaultsLoadTokenRef: RefObject<number>;
  createPrDefaultsLoading: boolean;
  createPrDialogOpen: boolean;
  createPrForm: CreatePrFormState;
  createPrPreviewBaseRef: string;
  createPrPreviewBaseRemoteName: string;
  createPrPreviewDetailsCacheRef: RefObject<Map<string, GitCommitDetails>>;
  createPrPreviewDetailsLoadTokenRef: RefObject<number>;
  createPrPreviewHeadRef: string;
  createPrPreviewLoadTokenRef: RefObject<number>;
  createPrPreviewSelectedSha: string | null;
  createPrProgressTimerRef: RefObject<number | null>;
  createPrResult: GitPrWorkflowResult | null;
  createPrSubmitting: boolean;
  currentBranch: string | null;
  currentLocalBranchEntry: GitBranchListItem | null;
  deleteGitBranch: (
    workspaceId: string,
    name: string,
    options?: { force?: boolean; removeOccupiedWorktree?: boolean },
  ) => Promise<unknown>;
  desktopSplitLayout: boolean;
  details: GitCommitDetails | null;
  detailsBodyRef: RefObject<HTMLDivElement | null>;
  extractWorktreePathFromDeleteError: (rawMessage: string) => string | null;
  fallbackGitRoots: string[];
  fallbackGitRootsLoading: boolean;
  fallbackSelectingRoot: string | null;
  fetchGit: (
    targetWorkspaceId: string,
    remote?: string | null,
  ) => Promise<void>;
  getDefaultColumnWidths: (containerWidth: number) => {
    overviewWidth: number;
    branchesWidth: number;
    commitsWidth: number;
  };
  getGitBranchCompareCommits: (
    workspaceId: string,
    targetBranch: string,
    currentBranch: string,
    limit?: number,
  ) => Promise<GitBranchCompareCommitSets>;
  getGitCommitDetails: (
    targetWorkspaceId: string,
    commitHash: string,
    maxDiffLines?: number,
  ) => Promise<GitCommitDetails>;
  getGitDiffs: (targetWorkspaceId: string) => Promise<GitFileDiff[]>;
  getGitPrWorkflowDefaults: (
    workspaceId: string,
  ) => Promise<GitPrWorkflowDefaults>;
  getGitPushPreview: (
    targetWorkspaceId: string,
    options: Parameters<typeof getGitPushPreview>[1],
  ) => Promise<GitPushPreviewResponse>;
  getGitStatus: (targetWorkspaceId: string) => Promise<{
    isGitRepository?: boolean;
    branchName: string;
    files: GitFileStatus[];
    stagedFiles: GitFileStatus[];
    unstagedFiles: GitFileStatus[];
    totalAdditions: number;
    totalDeletions: number;
  }>;
  getGitWorktreeDiffAgainstBranch: (
    workspaceId: string,
    branch: string,
  ) => Promise<GitCommitDiff[]>;
  getGitWorktreeDiffFileAgainstBranch: (
    workspaceId: string,
    branch: string,
    path: string,
  ) => Promise<GitCommitDiff>;
  getOperationDisplayName: (operationName: string) => string;
  historyHasMore: boolean;
  historyLoading: boolean;
  historyLoadingMore: boolean;
  isBranchDeleteNotFullyMergedError: (rawMessage: string) => boolean;
  isBranchDeleteUsedByWorktreeError: (rawMessage: string) => boolean;
  listGitRoots: (workspace_id: string, depth: number) => Promise<string[]>;
  loadHistory: (append: boolean, startOffset?: number) => Promise<void>;
  localBranches: GitBranchListItem[];
  localizeKnownGitError: (message: string | null) => string | null;
  mainGridRef: RefObject<HTMLDivElement | null>;
  mapCreatePrStagesFromResult: (
    t: (key: string) => string,
    stages: GitPrWorkflowStage[],
  ) => CreatePrStageView[];
  mergeGitBranch: (workspaceId: string, name: string) => Promise<unknown>;
  onOpenDiffPath: ((path: string) => void) | undefined;
  onSelectWorkspace: ((workspaceId: string) => void) | undefined;
  onSelectWorkspacePath: ((path: string) => Promise<void> | void) | undefined;
  operationLoading: string | null;
  overviewWidth: number;
  owner: string;
  projectOptions: WorkspaceInfo[];
  promptForceDeleteDialog: (
    mode: ForceDeleteDialogMode,
    branch: string,
    worktreePath: string | null,
  ) => Promise<boolean>;
  pullGit: (
    targetWorkspaceId: string,
    options?: Parameters<typeof pullGit>[1],
  ) => Promise<void>;
  pullNoCommit: boolean;
  pullNoVerify: boolean;
  pullRemote: string;
  pullRemoteOptions: string[];
  pullStrategy: GitPullStrategyOption | null;
  pullTargetBranch: string;
  pushCanConfirm: boolean;
  pushCc: string;
  pushDialogOpen: boolean;
  pushForceWithLease: boolean;
  pushGit: (
    targetWorkspaceId: string,
    options?: Parameters<typeof pushGit>[1],
  ) => Promise<void>;
  pushPreviewDetailsLoadTokenRef: RefObject<number>;
  pushPreviewLoadTokenRef: RefObject<number>;
  pushPreviewSelectedSha: string | null;
  pushRemoteOptions: string[];
  pushRemoteTrimmed: string;
  pushReviewers: string;
  pushRunHooks: boolean;
  pushTags: boolean;
  pushTargetBranchTrimmed: string;
  pushTargetHistory: GitPushTargetHistoryEntry[];
  pushToGerrit: boolean;
  pushTopic: string;
  rebaseGitBranch: (
    workspaceId: string,
    ontoBranch: string,
  ) => Promise<unknown>;
  refreshAll: () => Promise<void>;
  renameBranchCanConfirm: boolean;
  renameBranchNameTrimmed: string;
  renameBranchSource: string;
  renameBranchSubmitting: boolean;
  renameGitBranch: (
    workspaceId: string,
    oldName: string,
    newName: string,
  ) => Promise<unknown>;
  repositoryUnavailable: boolean;
  resetGitCommit: (
    workspaceId: string,
    commitHash: string,
    mode: GitResetMode,
  ) => Promise<void>;
  resetMode: GitResetMode;
  resetTargetSha: string | null;
  resolveGitRootPath: (workspacePath: string, relativeRoot: string) => string;
  resolvePushTargetBranchOptions: (remoteName: string) => string[];
  resolveUpstreamTarget: (upstream: string | null | undefined) => {
    remote: string;
    branch: string;
  };
  revertCommit: (workspaceId: string, commitHash: string) => Promise<void>;
  runOperation: (name: string, action: () => Promise<void>) => Promise<void>;
  selectedBranch: string;
  selectedCommitSha: string | null;
  setBranchContextMenu: Dispatch<SetStateAction<BranchContextMenuState | null>>;
  setBranchDiffState: Dispatch<SetStateAction<BranchDiffState | null>>;
  setBranchesWidth: Dispatch<SetStateAction<number>>;
  setCommitContextMenu: Dispatch<SetStateAction<CommitContextMenuState | null>>;
  setCommitContextMoreOpen: Dispatch<SetStateAction<boolean>>;
  setCommitsWidth: Dispatch<SetStateAction<number>>;
  setComparePreviewFileKey: Dispatch<SetStateAction<string | null>>;
  setCreateBranchDialogOpen: Dispatch<SetStateAction<boolean>>;
  setCreateBranchName: Dispatch<SetStateAction<string>>;
  setCreateBranchSource: Dispatch<SetStateAction<string>>;
  setCreatePrCopiedPrUrl: Dispatch<SetStateAction<boolean>>;
  setCreatePrCopiedRetryCommand: Dispatch<SetStateAction<boolean>>;
  setCreatePrDefaults: Dispatch<SetStateAction<GitPrWorkflowDefaults | null>>;
  setCreatePrDefaultsError: Dispatch<SetStateAction<string | null>>;
  setCreatePrDefaultsLoading: Dispatch<SetStateAction<boolean>>;
  setCreatePrDialogOpen: Dispatch<SetStateAction<boolean>>;
  setCreatePrForm: Dispatch<SetStateAction<CreatePrFormState>>;
  setCreatePrPreviewBaseOnlyCount: Dispatch<SetStateAction<number>>;
  setCreatePrPreviewCommits: Dispatch<SetStateAction<GitHistoryCommit[]>>;
  setCreatePrPreviewDetails: Dispatch<SetStateAction<GitCommitDetails | null>>;
  setCreatePrPreviewDetailsError: Dispatch<SetStateAction<string | null>>;
  setCreatePrPreviewDetailsLoading: Dispatch<SetStateAction<boolean>>;
  setCreatePrPreviewError: Dispatch<SetStateAction<string | null>>;
  setCreatePrPreviewExpanded: Dispatch<SetStateAction<boolean>>;
  setCreatePrPreviewLoading: Dispatch<SetStateAction<boolean>>;
  setCreatePrPreviewSelectedSha: Dispatch<SetStateAction<string | null>>;
  setCreatePrResult: Dispatch<SetStateAction<GitPrWorkflowResult | null>>;
  setCreatePrStages: Dispatch<SetStateAction<CreatePrStageView[]>>;
  setDesktopSplitLayout: Dispatch<SetStateAction<boolean>>;
  setDetailsSplitRatio: Dispatch<SetStateAction<number>>;
  setExpandedDirs: Dispatch<SetStateAction<Set<string>>>;
  setExpandedLocalScopes: Dispatch<SetStateAction<Set<string>>>;
  setExpandedRemoteScopes: Dispatch<SetStateAction<Set<string>>>;
  setFallbackGitRoots: Dispatch<SetStateAction<string[]>>;
  setFallbackGitRootsError: Dispatch<SetStateAction<string | null>>;
  setFallbackGitRootsLoading: Dispatch<SetStateAction<boolean>>;
  setFallbackSelectingRoot: Dispatch<SetStateAction<string | null>>;
  setFetchDialogOpen: Dispatch<SetStateAction<boolean>>;
  setIsCreatePrDialogMaximized: Dispatch<SetStateAction<boolean>>;
  setOperationLoading: Dispatch<SetStateAction<string | null>>;
  setOverviewWidth: Dispatch<SetStateAction<number>>;
  setPullDialogOpen: Dispatch<SetStateAction<boolean>>;
  setPullNoCommit: Dispatch<SetStateAction<boolean>>;
  setPullNoVerify: Dispatch<SetStateAction<boolean>>;
  setPullOptionsMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullRemote: Dispatch<SetStateAction<string>>;
  setPullRemoteMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullRemoteMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPullStrategy: Dispatch<SetStateAction<GitPullStrategyOption | null>>;
  setPullTargetBranch: Dispatch<SetStateAction<string>>;
  setPullTargetBranchMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullTargetBranchMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPullTargetBranchQuery: Dispatch<SetStateAction<string>>;
  setPushCc: Dispatch<SetStateAction<string>>;
  setPushDialogOpen: Dispatch<SetStateAction<boolean>>;
  setPushForceWithLease: Dispatch<SetStateAction<boolean>>;
  setPushPreviewCommits: Dispatch<SetStateAction<GitHistoryCommit[]>>;
  setPushPreviewDetails: Dispatch<SetStateAction<GitCommitDetails | null>>;
  setPushPreviewDetailsError: Dispatch<SetStateAction<string | null>>;
  setPushPreviewDetailsLoading: Dispatch<SetStateAction<boolean>>;
  setPushPreviewError: Dispatch<SetStateAction<string | null>>;
  setPushPreviewExpandedDirs: Dispatch<SetStateAction<Set<string>>>;
  setPushPreviewHasMore: Dispatch<SetStateAction<boolean>>;
  setPushPreviewLoading: Dispatch<SetStateAction<boolean>>;
  setPushPreviewSelectedSha: Dispatch<SetStateAction<string | null>>;
  setPushPreviewTargetFound: Dispatch<SetStateAction<boolean>>;
  setPushRemote: Dispatch<SetStateAction<string>>;
  setPushRemoteMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPushReviewers: Dispatch<SetStateAction<string>>;
  setPushRunHooks: Dispatch<SetStateAction<boolean>>;
  setPushTags: Dispatch<SetStateAction<boolean>>;
  setPushTargetBranch: Dispatch<SetStateAction<string>>;
  setPushTargetBranchMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPushTargetBranchMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPushTargetBranchQuery: Dispatch<SetStateAction<string>>;
  setPushTargetHistory: Dispatch<SetStateAction<GitPushTargetHistoryEntry[]>>;
  setPushToGerrit: Dispatch<SetStateAction<boolean>>;
  setPushTopic: Dispatch<SetStateAction<string>>;
  setRefreshDialogOpen: Dispatch<SetStateAction<boolean>>;
  setRenameBranchDialogOpen: Dispatch<SetStateAction<boolean>>;
  setRenameBranchName: Dispatch<SetStateAction<string>>;
  setRenameBranchSource: Dispatch<SetStateAction<string>>;
  setResetDialogOpen: Dispatch<SetStateAction<boolean>>;
  setResetMode: Dispatch<SetStateAction<GitResetMode>>;
  setResetTargetSha: Dispatch<SetStateAction<string | null>>;
  setSelectedBranch: Dispatch<SetStateAction<string>>;
  setSelectedCommitSha: Dispatch<SetStateAction<string | null>>;
  setSyncDialogOpen: Dispatch<SetStateAction<boolean>>;
  setSyncPreviewCommits: Dispatch<SetStateAction<GitHistoryCommit[]>>;
  setSyncPreviewError: Dispatch<SetStateAction<string | null>>;
  setSyncPreviewLoading: Dispatch<SetStateAction<boolean>>;
  setSyncPreviewTargetBranch: Dispatch<SetStateAction<string>>;
  setSyncPreviewTargetFound: Dispatch<SetStateAction<boolean>>;
  setSyncPreviewTargetRemote: Dispatch<SetStateAction<string>>;
  setWorkingTreeChangedFiles: Dispatch<SetStateAction<number>>;
  setWorkingTreeTotalAdditions: Dispatch<SetStateAction<number>>;
  setWorkingTreeTotalDeletions: Dispatch<SetStateAction<number>>;
  setWorkspaceSelectingId: Dispatch<SetStateAction<string | null>>;
  setWorktreePreviewError: Dispatch<SetStateAction<string | null>>;
  setWorktreePreviewFile: Dispatch<SetStateAction<WorktreePreviewFile | null>>;
  setWorktreePreviewLoading: Dispatch<SetStateAction<boolean>>;
  showOperationNotice: (notice: GitOperationNoticeState) => void;
  splitGitHubRepo: (value: string) => { owner: string; repo: string };
  syncDialogOpen: boolean;
  syncGit: (targetWorkspaceId: string) => Promise<void>;
  syncPreviewTargetBranch: string;
  syncPreviewTargetRemote: string;
  t: TFunction<"translation", undefined>;
  trimmed: (value: string) => string;
  updateGitBranch: (
    targetWorkspaceId: string,
    branchName: string,
  ) => Promise<GitBranchUpdateResult>;
  useCallback: typeof useCallback;
  useEffect: typeof useEffect;
  useMemo: typeof useMemo;
  useVirtualizer: typeof useVirtualizer;
  workbenchGridRef: RefObject<HTMLDivElement | null>;
  workspace: WorkspaceInfo | null;
  workspaceId: string | null;
  workspaceSelectingId: string | null;
  workspaces: WorkspaceInfo[];
};

type GitHistoryPanelInteractionResult = ReturnType<
  typeof useGitHistoryPanelInteractions
>;

export type GitHistoryPanelViewScope = {
  ActionSurface: ({
    className,
    children,
    disabled,
    active,
    onActivate,
    onContextMenu,
    title,
    ariaLabel,
    style,
  }: ActionSurfaceProps) => ReactElement;
  CREATE_PR_PREVIEW_COMMIT_LIMIT: number;
  ChevronDown: LucideIcon;
  ChevronLeft: LucideIcon;
  ChevronRight: LucideIcon;
  ChevronsDownUp: LucideIcon;
  ChevronsUpDown: LucideIcon;
  CircleAlert: LucideIcon;
  CircleCheck: LucideIcon;
  Cloud: LucideIcon;
  CloudDownload: LucideIcon;
  Copy: LucideIcon;
  DEFAULT_DETAILS_SPLIT: number;
  DISABLE_HISTORY_ACTION_BUTTONS: boolean;
  Download: LucideIcon;
  FileIcon: MemoExoticComponent<
    ({
      filePath,
      fileName,
      isFolder,
      isOpen,
      size,
      className,
    }: FileIconProps) => ReactElement
  >;
  FileText: LucideIcon;
  Folder: LucideIcon;
  FolderOpen: LucideIcon;
  FolderTree: LucideIcon;
  GitBranch: LucideIcon;
  GitCommit: LucideIcon;
  GitDiffViewer: typeof GitDiffViewer;
  GitHistoryInlinePicker: ({
    label,
    value,
    options,
    disabled,
    searchPlaceholder,
    emptyText,
    triggerIcon,
    optionIcon,
    dropdownAlign,
    onSelect,
  }: GitHistoryInlinePickerProps) => ReactElement;
  GitHistoryProjectPicker: ({
    sections,
    selectedId,
    selectedLabel,
    ariaLabel,
    searchPlaceholder,
    emptyText,
    icon,
    disabled,
    onSelect,
  }: GitHistoryProjectPickerProps) => ReactElement;
  GitHistoryWorktreePanel: ({
    workspaceId,
    repositoryRoot,
    listView,
    commitSectionCollapsed,
    rootFolderName,
    onMutated,
    onOpenDiffPath,
    onSummaryChange,
  }: GitHistoryWorktreePanelProps) => ReactElement;
  GitMerge: LucideIcon;
  GitPullRequestCreate: LucideIcon;
  HardDrive: LucideIcon;
  History: LucideIcon;
  LayoutGrid: LucideIcon;
  LoaderCircle: LucideIcon;
  MessageSquareText: LucideIcon;
  Pencil: LucideIcon;
  Plus: LucideIcon;
  RefreshCw: LucideIcon;
  Repeat: LucideIcon;
  Search: LucideIcon;
  ShieldAlert: LucideIcon;
  Trash2: LucideIcon;
  Upload: LucideIcon;
  X: LucideIcon;
  branchContextActions: BranchContextAction[];
  branchContextMenu: BranchContextMenuState | null;
  branchContextMenuRef: RefObject<HTMLDivElement | null>;
  branchContextMenuStyle: CSSProperties | undefined;
  branchContextTrackingSummary: string | null;
  branchDiffState: BranchDiffState | null;
  branchQuery: string;
  branchesWidth: number;
  buildFileKey: (change: GitCommitFileChange) => string;
  clearOperationNotice: () => void;
  closeBranchContextMenu: () => void;
  closeBranchDiff: () => void;
  closeCreatePrDialog: GitHistoryPanelInteractionResult["closeCreatePrDialog"];
  closeForceDeleteDialog: (confirmed: boolean) => void;
  closeRenameBranchDialog: GitHistoryPanelInteractionResult["closeRenameBranchDialog"];
  closeWorktreePreview: GitHistoryPanelInteractionResult["closeWorktreePreview"];
  codeAnnotations: CodeAnnotationSelection[] | undefined;
  commitContextMenu: CommitContextMenuState | null;
  commitContextMoreOpen: boolean;
  commitFilterSurface: Omit<GitHistoryCommitFiltersProps, "headerTitle">;
  commitListRef: RefObject<HTMLDivElement | null>;
  commitRowVirtualizer: GitHistoryPanelInteractionResult["commitRowVirtualizer"];
  commits: GitHistoryCommit[];
  commitGraphLayout: GitHistoryGraphLayout;
  commitsWidth: number;
  comparePreviewDetailFile: GitCommitFileChange | null;
  comparePreviewDetailFileDiff: string | null;
  comparePreviewDiffEntries: { path: string; status: string; diff: string }[];
  comparePreviewFileKey: string | null;
  contextMoreDisabledReason: string | undefined;
  contextPrimaryActionGroups: Array<{
    groupKey: "quick" | "branch";
    items: CommitActionDescriptor[];
  }>;
  contextWriteActions: CommitActionDescriptor[];
  createBranchCanConfirm: boolean;
  createBranchDialogOpen: boolean;
  createBranchName: string;
  createBranchNameInputRef: RefObject<HTMLInputElement | null>;
  createBranchSource: string;
  createBranchSourceOptions: string[];
  createBranchSubmitting: boolean;
  createPortal: (
    children: ReactNode,
    container: Element | DocumentFragment,
    key?: Key | null,
  ) => ReactPortal;
  createPrBaseBranchOptions: GitHistoryInlinePickerOption[];
  createPrBaseRepoOptions: GitHistoryInlinePickerOption[];
  createPrCanConfirm: boolean;
  createPrCanOpen: boolean;
  createPrCompareBranchOptions: GitHistoryInlinePickerOption[];
  createPrContentElapsedSec: number;
  createPrContentEngine: CommitMessageEngine;
  createPrContentError: string | null;
  createPrContentGenerating: boolean;
  createPrContentSlow: boolean;
  createPrContentSuccessAt: number | null;
  createPrCopiedPrUrl: boolean;
  createPrCopiedRetryCommand: boolean;
  createPrDefaultsError: string | null;
  createPrDefaultsLoading: boolean;
  createPrDialogOpen: boolean;
  createPrForm: CreatePrFormState;
  createPrFormFlashAt: number | null;
  createPrHeadRepoOptions: {
    value: string;
    label: string;
    description: string;
    group: string;
  }[];
  createPrHeadRepositoryValue: string;
  createPrPreviewBaseOnlyCount: number;
  createPrPreviewBaseRef: string;
  createPrPreviewCommits: GitHistoryCommit[];
  createPrPreviewDetails: GitCommitDetails | null;
  createPrPreviewDetailsError: string | null;
  createPrPreviewDetailsLoading: boolean;
  createPrPreviewError: string | null;
  createPrPreviewExpanded: boolean;
  createPrPreviewHasMore: boolean;
  createPrPreviewHeadRef: string;
  createPrPreviewLoading: boolean;
  createPrPreviewSelectedCommit: GitHistoryCommit | null;
  createPrPreviewSelectedSha: string | null;
  createPrResult: GitPrWorkflowResult | null;
  createPrResultHeadline: string;
  createPrStages: CreatePrStageView[];
  createPrSubmitting: boolean;
  createPrToolbarDisabledReason: string | null;
  currentBranch: string | null;
  currentLocalBranchEntry: GitBranchListItem | null;
  desktopSplitLayout: boolean;
  details: GitCommitDetails | null;
  detailsBodyRef: RefObject<HTMLDivElement | null>;
  detailsError: string | null;
  detailsLoading: boolean;
  detailsMessageContent: string;
  detailsSplitRatio: number;
  diffViewMode: "split" | "unified";
  emptyStateStatusText: GitHistoryPanelInteractionResult["emptyStateStatusText"];
  expandedLocalScopes: Set<string>;
  expandedRemoteScopes: Set<string>;
  extractCommitBody: (summary: string, message: string) => string;
  fallbackGitRoots: string[];
  fallbackGitRootsError: string | null;
  fallbackGitRootsLoading: boolean;
  fallbackSelectingRoot: string | null;
  fetchDialogOpen: boolean;
  fetchSubmitting: boolean;
  fileTreeItems: FileTreeItem[];
  forceDeleteCopiedPath: boolean;
  forceDeleteCountdown: number;
  forceDeleteDialogState: ForceDeleteDialogState | null;
  formatRelativeTime: (
    timestampSec: number,
    translate: (key: string, options?: Record<string, unknown>) => string,
  ) => string;
  getBranchLeafName: (name: string) => string;
  getBranchScope: (name: string) => string;
  getCommitActionIcon: (actionId: CommitActionId, size: number) => ReactNode;
  getCurrentDefaultColumnWidths: GitHistoryPanelInteractionResult["getCurrentDefaultColumnWidths"];
  getSpecialBranchBadges: (
    branchName: string,
    t: (key: string, options?: Record<string, unknown>) => string,
  ) => string[];
  getTreeLineOpacity: (depth: number) => string;
  groupedLocalBranches: BranchGroup[];
  groupedRemoteBranches: { remote: string; items: GitBranchListItem[] }[];
  handleBranchContextMenuKeyDown: (
    event: KeyboardEvent<HTMLDivElement>,
  ) => void;
  handleBranchesSplitResizeStart: GitHistoryPanelInteractionResult["handleBranchesSplitResizeStart"];
  handleCommitsSplitResizeStart: GitHistoryPanelInteractionResult["handleCommitsSplitResizeStart"];
  handleConfirmCreatePr: GitHistoryPanelInteractionResult["handleConfirmCreatePr"];
  handleConfirmFetch: GitHistoryPanelInteractionResult["handleConfirmFetch"];
  handleConfirmPull: GitHistoryPanelInteractionResult["handleConfirmPull"];
  handleConfirmPush: GitHistoryPanelInteractionResult["handleConfirmPush"];
  handleConfirmRefresh: GitHistoryPanelInteractionResult["handleConfirmRefresh"];
  handleConfirmResetCommit: GitHistoryPanelInteractionResult["handleConfirmResetCommit"];
  handleConfirmSync: GitHistoryPanelInteractionResult["handleConfirmSync"];
  handleCopyCreatePrRetryCommand: GitHistoryPanelInteractionResult["handleCopyCreatePrRetryCommand"];
  handleCopyCreatePrUrl: GitHistoryPanelInteractionResult["handleCopyCreatePrUrl"];
  handleCopyForceDeleteWorktreePath: () => Promise<void>;
  handleCreateBranch: GitHistoryPanelInteractionResult["handleCreateBranch"];
  handleCreateBranchConfirm: GitHistoryPanelInteractionResult["handleCreateBranchConfirm"];
  handleCreatePrHeadRepositoryChange: GitHistoryPanelInteractionResult["handleCreatePrHeadRepositoryChange"];
  handleDeleteBranch: GitHistoryPanelInteractionResult["handleDeleteBranch"];
  handleDetailsSplitResizeStart: GitHistoryPanelInteractionResult["handleDetailsSplitResizeStart"];
  handleFallbackGitRootSelect: GitHistoryPanelInteractionResult["handleFallbackGitRootSelect"];
  handleFileTreeDirToggle: GitHistoryPanelInteractionResult["handleFileTreeDirToggle"];
  handleMergeBranch: GitHistoryPanelInteractionResult["handleMergeBranch"];
  handleOpenBranchContextMenu: (
    event: MouseEvent<HTMLDivElement>,
    branch: GitBranchListItem,
    source: BranchMenuSource,
  ) => void;
  handleOpenCommitContextMenu: GitHistoryPanelInteractionResult["handleOpenCommitContextMenu"];
  handleOpenCreatePrDialog: GitHistoryPanelInteractionResult["handleOpenCreatePrDialog"];
  handleOpenFetchDialog: GitHistoryPanelInteractionResult["handleOpenFetchDialog"];
  handleOpenPullDialog: GitHistoryPanelInteractionResult["handleOpenPullDialog"];
  handleOpenPushDialog: GitHistoryPanelInteractionResult["handleOpenPushDialog"];
  handleOpenRefreshDialog: GitHistoryPanelInteractionResult["handleOpenRefreshDialog"];
  handleOpenRenameBranchDialog: GitHistoryPanelInteractionResult["handleOpenRenameBranchDialog"];
  handleOpenSyncDialog: GitHistoryPanelInteractionResult["handleOpenSyncDialog"];
  handleOpenWorktreePreview: GitHistoryPanelInteractionResult["handleOpenWorktreePreview"];
  handleOverviewSplitResizeStart: GitHistoryPanelInteractionResult["handleOverviewSplitResizeStart"];
  handlePushPreviewDirToggle: GitHistoryPanelInteractionResult["handlePushPreviewDirToggle"];
  handleRenameBranchConfirm: GitHistoryPanelInteractionResult["handleRenameBranchConfirm"];
  handleSelectBranchCompareCommit: (
    branch: string,
    compareBranch: string,
    direction: BranchCompareDirection,
    commit: { sha: string },
  ) => Promise<void>;
  handleSelectPullRemote: GitHistoryPanelInteractionResult["handleSelectPullRemote"];
  handleSelectPullTargetBranch: GitHistoryPanelInteractionResult["handleSelectPullTargetBranch"];
  handleSelectPushRemote: GitHistoryPanelInteractionResult["handleSelectPushRemote"];
  handleSelectPushTargetBranch: GitHistoryPanelInteractionResult["handleSelectPushTargetBranch"];
  handleSelectPushHistory: GitHistoryPanelInteractionResult["handleSelectPushHistory"];
  handleSelectWorktreeDiffFile: (
    branch: string,
    compareBranch: string,
    file: { path: string; status: string },
  ) => Promise<void>;
  handleToggleLocalScope: GitHistoryPanelInteractionResult["handleToggleLocalScope"];
  handleToggleRemoteScope: GitHistoryPanelInteractionResult["handleToggleRemoteScope"];
  handleWorktreeSummaryChange: GitHistoryPanelInteractionResult["handleWorktreeSummaryChange"];
  historyError: string | null;
  historyLoading: boolean;
  historyPreviewHeaderControlsTarget: HTMLDivElement | null;
  historyTotal: number;
  isCreatePrDialogMaximized: boolean;
  isHistoryDiffModalMaximized: boolean;
  loadCreatePrCommitPreview: GitHistoryPanelInteractionResult["loadCreatePrCommitPreview"];
  localSectionExpanded: boolean;
  localizeKnownGitError: (message: string | null) => string | null;
  localizedOperationName: string | null;
  mainGridRef: RefObject<HTMLDivElement | null>;
  mainGridStyle: { gridTemplateColumns: string } | undefined;
  onCreateCodeAnnotation:
    ((annotation: CodeAnnotationDraftInput) => void) | undefined;
  onRemoveCodeAnnotation: ((annotationId: string) => void) | undefined;
  onOpenDiffPath: ((path: string) => void) | undefined;
  onRequestClose: (() => void) | undefined;
  onSelectRepository:
    ((repositoryRoot: string) => Promise<void> | void) | undefined;
  onSelectWorkspace: ((workspaceId: string) => void) | undefined;
  openPrContentGenerationMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  openPullTargetBranchMenu: (resetQuery: boolean) => void;
  openPushTargetBranchMenu: (resetQuery: boolean) => void;
  operationLoading: string | null;
  operationNotice: GitOperationNoticeState | null;
  overviewCommitSectionCollapsed: boolean;
  overviewListView: "flat" | "tree";
  overviewWidth: number;
  prContentMenu: RendererContextMenuState | null;
  previewDetailFile: GitCommitFileChange | null;
  previewDetailFileDiff: string | null;
  previewDiffEntries: { path: string; status: string; diff: string }[];
  previewModalFullDiffLoader: (path: string) => Promise<string>;
  projectOptions: WorkspaceInfo[];
  projectSections: {
    id: string | null;
    name: string;
    options: {
      id: string;
      label: string;
      kind: "main" | "worktree";
      parentLabel: string | null;
      selected: boolean;
    }[];
  }[];
  pullDialogOpen: boolean;
  pullNoCommit: boolean;
  pullNoVerify: boolean;
  pullOptionsMenuOpen: boolean;
  pullOptionsMenuRef: RefObject<HTMLDivElement | null>;
  pullRemote: string;
  pullRemoteGroups: PushTargetBranchGroup[];
  pullRemoteMenuOpen: boolean;
  pullRemoteMenuPlacement: "down" | "up";
  pullRemotePickerRef: RefObject<HTMLDivElement | null>;
  pullRemoteTrimmed: string;
  pullSelectedOptions: { id: string; label: string; onRemove: () => void }[];
  pullStrategy: GitPullStrategyOption | null;
  pullSubmitting: boolean;
  pullTargetBranch: string;
  pullTargetBranchActiveScopeTab: string | null;
  pullTargetBranchFieldRef: RefObject<HTMLLabelElement | null>;
  pullTargetBranchGroups: PushTargetBranchGroup[];
  pullTargetBranchMenuOpen: boolean;
  pullTargetBranchMenuPlacement: "down" | "up";
  pullTargetBranchMenuRef: RefObject<HTMLDivElement | null>;
  pullTargetBranchPickerRef: RefObject<HTMLDivElement | null>;
  pullTargetBranchTrimmed: string;
  pushCanConfirm: boolean;
  pushCc: string;
  pushDialogOpen: boolean;
  pushForceWithLease: boolean;
  pushHasOutgoingCommits: boolean;
  pushIsNewBranchTarget: boolean;
  pushPreviewCommits: GitHistoryCommit[];
  pushPreviewDetails: GitCommitDetails | null;
  pushPreviewDetailsError: string | null;
  pushPreviewDetailsLoading: boolean;
  pushPreviewError: string | null;
  pushPreviewFileTreeItems: FileTreeItem[];
  pushPreviewHasMore: boolean;
  pushPreviewLoading: boolean;
  pushPreviewModalDiffEntries: { path: string; status: string; diff: string }[];
  pushPreviewModalFile: GitCommitFileChange | null;
  pushPreviewModalFileDiff: string | null;
  pushPreviewModalFullDiffLoader: (path: string) => Promise<string>;
  pushPreviewSelectedCommit: GitHistoryCommit | null;
  pushPreviewSelectedFileKey: string | null;
  pushPreviewSelectedSha: string | null;
  pushRemoteMenuOpen: boolean;
  pushRemoteMenuPlacement: "down" | "up";
  pushRemoteOptions: string[];
  pushRemotePickerRef: RefObject<HTMLDivElement | null>;
  pushRemoteTrimmed: string;
  pushReviewers: string;
  pushRunHooks: boolean;
  pushSubmitting: boolean;
  pushTags: boolean;
  pushTargetBranch: string;
  pushTargetBranchActiveScopeTab: string | null;
  pushTargetBranchFieldRef: RefObject<HTMLLabelElement | null>;
  pushTargetBranchGroups: PushTargetBranchGroup[];
  pushTargetBranchMenuOpen: boolean;
  pushTargetBranchMenuPlacement: "down" | "up";
  pushTargetBranchMenuRef: RefObject<HTMLDivElement | null>;
  pushTargetBranchPickerRef: RefObject<HTMLDivElement | null>;
  pushTargetBranchTrimmed: string;
  pushTargetHistory: GitPushTargetHistoryEntry[];
  pushTargetSummaryBranch: string;
  pushToGerrit: boolean;
  pushTopic: string;
  refreshAll: () => Promise<void>;
  refreshDialogOpen: boolean;
  refreshSubmitting: boolean;
  remoteSectionExpanded: boolean;
  renameBranchCanConfirm: boolean;
  renameBranchDialogOpen: boolean;
  renameBranchName: string;
  renameBranchNameInputRef: RefObject<HTMLInputElement | null>;
  renameBranchSource: string;
  renameBranchSubmitting: boolean;
  renameBranchToolbarDisabledReason: string | null;
  renderChangedFilesSummary: (
    translate: (key: string, options?: Record<string, unknown>) => string,
    count: number,
    additions: number,
    deletions: number,
  ) => ReactNode;
  repositories: GitRepositorySummary[];
  repositoryBranchCatalogs: Map<string, GitHistoryRepositoryBranchCatalog>;
  repositoryRootName: string;
  repositoryUnavailable: boolean;
  resetDialogOpen: boolean;
  resetMode: GitResetMode;
  resetTargetCommit: GitHistoryPanelInteractionResult["resetTargetCommit"];
  resetTargetSha: string | null;
  runCommitAction: GitHistoryPanelInteractionResult["runCommitAction"];
  selectedBranch: string;
  selectedCommitSha: string | null;
  selectedFileKey: string | null;
  selectedLocalBranchForRename: string | null;
  selectedRepositoryRoot: string | null;
  setBranchQuery: Dispatch<SetStateAction<string>>;
  setBranchesWidth: Dispatch<SetStateAction<number>>;
  setCommitContextMenu: Dispatch<SetStateAction<CommitContextMenuState | null>>;
  setCommitContextMoreOpen: Dispatch<SetStateAction<boolean>>;
  setCommitsWidth: Dispatch<SetStateAction<number>>;
  setComparePreviewFileKey: Dispatch<SetStateAction<string | null>>;
  setCreateBranchDialogOpen: Dispatch<SetStateAction<boolean>>;
  setCreateBranchName: Dispatch<SetStateAction<string>>;
  setCreateBranchSource: Dispatch<SetStateAction<string>>;
  setCreatePrForm: Dispatch<SetStateAction<CreatePrFormState>>;
  setCreatePrPreviewExpanded: Dispatch<SetStateAction<boolean>>;
  setCreatePrPreviewSelectedSha: Dispatch<SetStateAction<string | null>>;
  setDetailsSplitRatio: Dispatch<SetStateAction<number>>;
  setDiffViewMode: Dispatch<SetStateAction<"split" | "unified">>;
  setFallbackSelectingRoot: Dispatch<SetStateAction<string | null>>;
  setFetchDialogOpen: Dispatch<SetStateAction<boolean>>;
  setHistoryPreviewHeaderControlsTarget: Dispatch<
    SetStateAction<HTMLDivElement | null>
  >;
  setIsCreatePrDialogMaximized: Dispatch<SetStateAction<boolean>>;
  setIsHistoryDiffModalMaximized: Dispatch<SetStateAction<boolean>>;
  setLocalSectionExpanded: Dispatch<SetStateAction<boolean>>;
  setOverviewCommitSectionCollapsed: Dispatch<SetStateAction<boolean>>;
  setOverviewListView: Dispatch<SetStateAction<"flat" | "tree">>;
  setOverviewWidth: Dispatch<SetStateAction<number>>;
  setPrContentMenu: Dispatch<SetStateAction<RendererContextMenuState | null>>;
  setPreviewFileKey: Dispatch<SetStateAction<string | null>>;
  setPullDialogOpen: Dispatch<SetStateAction<boolean>>;
  setPullNoCommit: Dispatch<SetStateAction<boolean>>;
  setPullNoVerify: Dispatch<SetStateAction<boolean>>;
  setPullOptionsMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullRemoteMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullStrategy: Dispatch<SetStateAction<GitPullStrategyOption | null>>;
  setPullTargetBranch: Dispatch<SetStateAction<string>>;
  setPullTargetBranchActiveScopeTab: Dispatch<SetStateAction<string | null>>;
  setPullTargetBranchMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullTargetBranchQuery: Dispatch<SetStateAction<string>>;
  setPushCc: Dispatch<SetStateAction<string>>;
  setPushDialogOpen: Dispatch<SetStateAction<boolean>>;
  setPushForceWithLease: Dispatch<SetStateAction<boolean>>;
  setPushPreviewModalFileKey: Dispatch<SetStateAction<string | null>>;
  setPushPreviewSelectedFileKey: Dispatch<SetStateAction<string | null>>;
  setPushPreviewSelectedSha: Dispatch<SetStateAction<string | null>>;
  setPushRemoteMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPushReviewers: Dispatch<SetStateAction<string>>;
  setPushRunHooks: Dispatch<SetStateAction<boolean>>;
  setPushTags: Dispatch<SetStateAction<boolean>>;
  setPushTargetBranch: Dispatch<SetStateAction<string>>;
  setPushTargetBranchActiveScopeTab: Dispatch<SetStateAction<string | null>>;
  setPushTargetBranchMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPushTargetBranchQuery: Dispatch<SetStateAction<string>>;
  setPushToGerrit: Dispatch<SetStateAction<boolean>>;
  setPushTopic: Dispatch<SetStateAction<string>>;
  setRefreshDialogOpen: Dispatch<SetStateAction<boolean>>;
  setRemoteSectionExpanded: Dispatch<SetStateAction<boolean>>;
  setRenameBranchName: Dispatch<SetStateAction<string>>;
  setResetDialogOpen: Dispatch<SetStateAction<boolean>>;
  setResetMode: Dispatch<SetStateAction<GitResetMode>>;
  setSelectedBranch: Dispatch<SetStateAction<string>>;
  setSelectedCommitSha: Dispatch<SetStateAction<string | null>>;
  setSelectedFileKey: Dispatch<SetStateAction<string | null>>;
  setSyncDialogOpen: Dispatch<SetStateAction<boolean>>;
  setWorkspaceSelectingId: Dispatch<SetStateAction<string | null>>;
  shouldShowWorkspacePickerPage: boolean;
  statusLabel: (change: GitCommitFileChange) => string;
  strokeWidth: number;
  syncDialogOpen: boolean;
  syncPreviewCommits: GitHistoryCommit[];
  syncPreviewError: string | null;
  syncPreviewLoading: boolean;
  syncPreviewTargetBranch: string;
  syncPreviewTargetFound: boolean;
  syncPreviewTargetRemote: string;
  syncSubmitting: boolean;
  t: TFunction<"translation", undefined>;
  trimRemotePrefix: (name: string, remote: string) => string;
  updatePullRemoteMenuPlacement: () => void;
  updatePushRemoteMenuPlacement: () => void;
  virtualCommitRows: ReturnType<
    ReturnType<typeof useVirtualizer>["getVirtualItems"]
  >;
  visiblePullTargetBranchGroups: PushTargetBranchGroup[];
  visiblePushTargetBranchGroups: PushTargetBranchGroup[];
  workbenchGridRef: RefObject<HTMLDivElement | null>;
  workbenchGridStyle: undefined;
  workingTreeChangedFiles: number;
  workingTreeSummaryLabel: string;
  workingTreeTotalAdditions: number;
  workingTreeTotalDeletions: number;
  workspace: WorkspaceInfo | null;
  workspaceId: string | null;
  workspacePickerMessage: string;
  workspaceSelectingId: string | null;
  worktreePreviewDiffEntries: {
    path: string;
    status: string;
    diff: string;
    isImage: boolean | undefined;
    oldImageData: string | null | undefined;
    newImageData: string | null | undefined;
    oldImageMime: string | null | undefined;
    newImageMime: string | null | undefined;
  }[];
  worktreePreviewDiffText: string | null;
  worktreePreviewError: string | null;
  worktreePreviewFile: WorktreePreviewFile | null;
  worktreePreviewFullDiffLoader: (path: string) => Promise<string>;
  worktreePreviewLoading: boolean;
  toolbarTabsNode: ReactNode;
  documentContentNode: ReactNode;
  activeDocumentTabId: string | undefined;
};
