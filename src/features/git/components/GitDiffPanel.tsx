import type { GitFileDiff, GitHubPullRequest, GitLogEntry } from "../../../types";
import {
  getGitDiffs,
  getGitFileFullDiff,
  openFolderInFileManager,
  revealInFileManager,
  type CommitMessageEngine,
} from "../../../services/tauri";
import type {
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { openUrl } from "@tauri-apps/plugin-opener";
import { loadDiffStyles } from "../../../styles/featureStyleLoaders";
import { useFeatureStylesReady } from "../../../styles/useFeatureStylesReady";
import ArrowLeftRight from "lucide-react/dist/esm/icons/arrow-left-right";
import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import GitPullRequest from "lucide-react/dist/esm/icons/git-pull-request";
import HardDrive from "lucide-react/dist/esm/icons/hard-drive";
import History from "lucide-react/dist/esm/icons/history";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid";
import MessageSquareWarning from "lucide-react/dist/esm/icons/message-square-warning";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import Search from "lucide-react/dist/esm/icons/search";
import Upload from "lucide-react/dist/esm/icons/upload";
import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { copyTextToClipboard } from "../../../utils/clipboard";
import { matchesShortcutForPlatform } from "../../../utils/shortcuts";
import { formatRelativeTime } from "../../../utils/time";
import { FileIcon } from "../../../components/FileIcon";
import { FloatingTooltipButton } from "@/components/ui/floating-tooltip-button";
import { DiffTreeSection } from "./GitDiffPanelTreeSection";
import { UnsavedChangesDialog } from "../../../components/ui/UnsavedChangesDialog";
import {
  useGitCommitSelection,
} from "./GitDiffPanelCommitScope";
import { GitCommitComposer } from "./GitCommitComposer";
import {
  DiffSection,
  type DiffFile,
  isDeletedDiffFile,
} from "./GitDiffPanelFileSections";
import {
  buildDiffTree,
  compactDiffTree,
} from "../utils/diffTree";
import { WorkspaceEditableDiffReviewSurface } from "./WorkspaceEditableDiffReviewSurface";
import type { EditableDiffDraftActions } from "./WorkspaceEditableDiffCompare";
import {
  normalizeDiffPath,
} from "./GitDiffPanelInclusion";
import {
  clampRendererContextMenuPosition,
  estimateRendererContextMenuHeight,
  RendererContextMenu,
  type RendererContextMenuItem,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";
import type { GitDiffPanelProps } from "./GitDiffPanelTypes";
import {
  joinWorkspaceAbsolutePath,
  resolveGitRootWorkspacePrefix,
} from "../../../utils/workspacePaths";
import {
  GitMultiRepositoryChanges,
  type RepositoryCommitSelection,
} from "./GitMultiRepositoryChanges";
import { countDiffStats } from "../utils/gitChangeModel";
import { useGitCommitComposerPlacement } from "../hooks/useGitCommitComposerPlacement";
import { useCommitMessageGenerationMenu } from "../hooks/useCommitMessageGenerationMenu";
import { readInitialCommitMessageMenuEngine } from "../utils/commitMessageMenuConfig";
import {
  getPathLeafName,
  isMissingRepo,
  normalizeRootPath,
} from "./gitDiffPanelLayout";
import { buildGitDiffPanelFileContextMenuItems } from "./GitDiffPanelFileContextMenu";
import {
  resolveGitDiffFileHistoryTarget,
  resolveRepositoryWorkspaceFilePath,
} from "./GitDiffPanelFileScope";
import {
  formatOpenHtmlInBrowserError,
  openHtmlInBrowser,
} from "../../files/utils/openHtmlInBrowser";
import { pushErrorToast } from "../../../services/toasts";
import { getRevealInOsFileManagerLabelKey } from "../../../utils/rendererPlatform";

type ModeMenuLayout = {
  align: "left" | "right";
  width: number;
};

export { resolveBottomCommitMessageMenuPosition } from "./gitDiffPanelLayout";

function GitModeSelectorMount({ target, children }: { target: HTMLElement | null; children: ReactNode }) {
  return target ? createPortal(children, target) : children;
}

type GitDiffSectionKey = "staged" | "unstaged";

type GitPanelContextMenuState = RendererContextMenuState & {
  source?: "git-diff-file";
};

type PreviewFileState = DiffFile & {
  section: GitDiffSectionKey;
  repositoryRoot: string | null;
  scopedDiffEntry: GitFileDiff | null;
  isDiffLoading: boolean;
  // 单文件兜底结果：批量 diff 列表缺失/为空时通过 get_git_file_full_diff 取回。
  fallbackDiffEntry: GitFileDiff | null;
  // 兜底取回成功但内容为空：文件没有文本级差异（如 CRLF 幻影修改），而非加载失败。
  fallbackResolvedEmpty: boolean;
};

function renderModeIcon(mode: GitDiffPanelProps["mode"], className: string, size = 12) {
  switch (mode) {
    case "diff":
      return <ArrowLeftRight className={className} size={size} aria-hidden />;
    case "log":
      return <History className={className} size={size} aria-hidden />;
    case "issues":
      return <MessageSquareWarning className={className} size={size} aria-hidden />;
    case "prs":
      return <GitPullRequest className={className} size={size} aria-hidden />;
    default:
      return <ArrowLeftRight className={className} size={size} aria-hidden />;
  }
}

const DEPTH_OPTIONS = [1, 2, 3, 4, 5, 6];
const DISALLOWED_GIT_LIST_VIEW_SHORTCUTS = new Set([
  "cmd+f",
  "ctrl+f",
  "cmd+o",
  "ctrl+o",
  "cmd+n",
  "ctrl+n",
  "ctrl+c",
  "ctrl+shift+c",
]);

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"]',
    ),
  );
}

export { buildDiffTree, compactDiffTree };

export function isFileMutationDisabled(file: { isDiffOnlyFallback?: boolean; mutationDisabled?: boolean }) {
  return Boolean(file.isDiffOnlyFallback || file.mutationDisabled);
}


type GitLogEntryRowProps = {
  entry: GitLogEntry;
  isSelected: boolean;
  compact?: boolean;
  onSelect?: (entry: GitLogEntry) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

function GitLogEntryRow({
  entry,
  isSelected,
  compact = false,
  onSelect,
  onContextMenu,
}: GitLogEntryRowProps) {
  return (
    <div
      className={`git-log-entry ${compact ? "git-log-entry-compact" : ""} ${isSelected ? "active" : ""}`}
      onClick={() => onSelect?.(entry)}
      onContextMenu={onContextMenu}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect?.(entry);
        }
      }}
    >
      <div className="git-log-summary">{entry.summary || "No message"}</div>
      <div className="git-log-meta">
        <span className="git-log-sha">{entry.sha.slice(0, 7)}</span>
        <span className="git-log-sep">·</span>
        <span className="git-log-author">{entry.author || "Unknown"}</span>
        <span className="git-log-sep">·</span>
        <span className="git-log-date">
          {formatRelativeTime(entry.timestamp * 1000)}
        </span>
      </div>
    </div>
  );
}

export function GitDiffPanel(props: GitDiffPanelProps) {
  const stylesReady = useFeatureStylesReady(loadDiffStyles);
  if (!stylesReady) {
    return null;
  }

  return <GitDiffPanelImpl {...props} />;
}

type DiscardDialogTarget =
  | { scope: "current-repository"; paths: string[] }
  | { scope: "explicit-repository"; repositoryRoot: string; paths: string[] };

function GitDiffPanelImpl({
  workspaceId = null,
  workspacePath = null,
  headerControlsTarget = null,
  mode,
  onModeChange,
  diffEntries = [],
  gitDiffListView = "flat",
  onGitDiffListViewChange,
  toggleGitDiffListViewShortcut = "alt+shift+v",
  filePanelMode: _filePanelMode,
  onFilePanelModeChange: _onFilePanelModeChange,
  onOpenGitHistoryPanel,
  isGitHistoryOpen = false,
  worktreeApplyTitle = null,
  worktreeApplyLoading = false,
  worktreeApplyError = null,
  worktreeApplySuccess = false,
  onApplyWorktreeChanges,
  onRevertAllChanges: _onRevertAllChanges,
  branchName,
  totalAdditions,
  totalDeletions,
  fileStatus,
  diffViewStyle = "split",
  onDiffViewStyleChange,
  error,
  logError,
  logLoading = false,
  logTotal = 0,
  gitRemoteUrl = null,
  onSelectFile,
  onOpenFile,
  onOpenFileHistory,
  logEntries,
  logAhead = 0,
  logBehind = 0,
  logAheadEntries = [],
  logBehindEntries = [],
  logUpstream = null,
  selectedCommitSha = null,
  onSelectCommit,
  issues = [],
  issuesTotal = 0,
  issuesLoading = false,
  issuesError = null,
  pullRequests = [],
  pullRequestsTotal = 0,
  pullRequestsLoading = false,
  pullRequestsError = null,
  selectedPullRequest = null,
  onSelectPullRequest,
  gitRoot = null,
  gitRootCandidates = [],
  gitRootScanDepth = 2,
  gitRootScanLoading = false,
  gitRootScanError = null,
  gitRootScanHasScanned = false,
  selectedPath = null,
  stagedFiles = [],
  unstagedFiles = [],
  onStageAllChanges,
  onStageFile,
  onUnstageAllChanges,
  onUnstageFile,
  onUnstageFiles,
  onRevertFile,
  onRevertFiles,
  onGitRootScanDepthChange,
  onScanGitRoots,
  onSelectGitRoot,
  onClearGitRoot,
  onPickGitRoot: _onPickGitRoot,
  commitMessage = "",
  commitMessageLoading = false,
  commitMessageError = null,
  onCommitMessageChange,
  onGenerateCommitMessage,
  onCommit,
  onCommitAndPush: _onCommitAndPush,
  onCommitAndSync: _onCommitAndSync,
  onPush,
  onSync: _onSync,
  commitLoading = false,
  pushLoading = false,
  syncLoading: _syncLoading = false,
  commitError = null,
  pushError = null,
  syncError = null,
  commitsAhead = 0,
  onRefreshGitStatus,
  onRefreshGitDiffs,
  onRefreshGitLog,
  onCreateCodeAnnotation,
  onRemoveCodeAnnotation,
  codeAnnotations = [],
  modalPreviewRequest = null,
  multiRepositoryMode = false,
  repositoryStatuses = [],
  repositoryStatusesLoading = false,
  onRefreshRepositoryStatuses,
  onStageRepositoryFile,
  onUnstageRepositoryFile,
  onUnstageRepositoryAll,
  onUnstageRepositoryFiles,
  onRevertRepositoryFile,
  onRevertRepositoryFiles,
  onStageRepositoryAll,
  onCommitRepositories,
  repositoryCommitSummary = null,
}: GitDiffPanelProps) {
  const { t } = useTranslation();
  // Multi-select state for file list
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [lastClickedFile, setLastClickedFile] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<GitDiffSectionKey>>(new Set());
  const [discardDialogTarget, setDiscardDialogTarget] = useState<DiscardDialogTarget | null>(null);
  const discardDialogPaths = discardDialogTarget?.paths ?? null;
  const [discardDialogSubmitting, setDiscardDialogSubmitting] = useState(false);
  const [gitContextMenu, setGitContextMenu] =
    useState<GitPanelContextMenuState | null>(null);
  const gitStatusRefreshSpinTimerRef = useRef<number | null>(null);
  const gitStatusRefreshSpinRafRef = useRef<number | null>(null);
  const [isGitStatusRefreshing, setIsGitStatusRefreshing] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFileState | null>(null);
  const [isPreviewModalMaximized, setIsPreviewModalMaximized] = useState(false);
  const [isPreviewModalDirty, setIsPreviewModalDirty] = useState(false);
  const [isPreviewSaveInFlight, setIsPreviewSaveInFlight] = useState(false);
  const [isUnsavedCloseDialogOpen, setIsUnsavedCloseDialogOpen] = useState(false);
  const [previewHeaderControlsTarget, setPreviewHeaderControlsTarget] = useState<HTMLDivElement | null>(null);
  const previewDraftActionsRef = useRef<EditableDiffDraftActions | null>(null);
  const handledModalPreviewRequestIdRef = useRef<number | null>(null);
  const scopedPreviewRequestIdRef = useRef(0);
  const previewContextKeyRef = useRef<string | null>(null);
  const [isModeMenuOpen, setIsModeMenuOpen] = useState(false);
  const [commitMessageMenuEngine, setCommitMessageMenuEngine] =
    useState<CommitMessageEngine>(() => readInitialCommitMessageMenuEngine());
  const [isGitRootPanelOpen, setIsGitRootPanelOpen] = useState(
    () =>
      isMissingRepo(error) ||
      gitRootScanLoading ||
      gitRootScanHasScanned ||
      Boolean(gitRootScanError) ||
      gitRootCandidates.length > 0,
  );
  const [modeMenuLayout, setModeMenuLayout] = useState<ModeMenuLayout>({
    align: "right",
    width: 246,
  });
  const commitComposerPlacement = useGitCommitComposerPlacement();
  const panelRef = useRef<HTMLElement | null>(null);
  const modeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const modeMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (multiRepositoryMode) {
      return;
    }
    setGitContextMenu((currentMenu) =>
      currentMenu?.source === "git-diff-file" ? null : currentMenu,
    );
  }, [
    gitRoot,
    multiRepositoryMode,
    onRevertFile,
    onOpenFileHistory,
    onStageFile,
    onUnstageFile,
    stagedFiles,
    unstagedFiles,
    workspaceId,
    workspacePath,
  ]);

  useEffect(() => {
    if (!multiRepositoryMode) {
      return;
    }
    setGitContextMenu((currentMenu) =>
      currentMenu?.source === "git-diff-file" ? null : currentMenu,
    );
  }, [
    multiRepositoryMode,
    onRefreshRepositoryStatuses,
    onRevertRepositoryFile,
    onOpenFileHistory,
    onStageRepositoryFile,
    onUnstageRepositoryFile,
    repositoryStatuses,
    repositoryStatusesLoading,
    workspaceId,
    workspacePath,
  ]);

  // Combine staged and unstaged files for range selection
  const allFiles = useMemo(
    () => [
      ...stagedFiles.map(f => ({ ...f, section: "staged" as const })),
      ...unstagedFiles.map(f => ({ ...f, section: "unstaged" as const })),
    ],
    [stagedFiles, unstagedFiles],
  );
  const stagedCommitFiles = useMemo(
    () => stagedFiles.filter((file) => !isFileMutationDisabled(file)),
    [stagedFiles],
  );
  const unstagedCommitFiles = useMemo(
    () => unstagedFiles.filter((file) => !isFileMutationDisabled(file)),
    [unstagedFiles],
  );
  const {
    selectedCommitPaths,
    selectedCommitCount,
    hasExplicitCommitSelection,
    includedCommitPaths,
    excludedCommitPaths,
    partialCommitPaths,
    isCommitPathLocked,
    setCommitSelection,
  } = useGitCommitSelection({
    stagedFiles: stagedCommitFiles,
    unstagedFiles: unstagedCommitFiles,
  });
  const previewDiffEntry = useMemo(
    () => {
      if (!previewFile) {
        return null;
      }
      if (previewFile.fallbackDiffEntry) {
        return previewFile.fallbackDiffEntry;
      }
      if (previewFile.repositoryRoot !== null) {
        return previewFile.scopedDiffEntry;
      }
      return diffEntries.find(
        (entry) => normalizeDiffPath(entry.path) === normalizeDiffPath(previewFile.path),
      ) ?? null;
    },
    [diffEntries, previewFile],
  );
  const previewStats = useMemo(() => {
    if (previewFile && (previewFile.additions !== 0 || previewFile.deletions !== 0)) {
      return { additions: previewFile.additions, deletions: previewFile.deletions };
    }
    if (previewDiffEntry && !previewDiffEntry.isImage) {
      return countDiffStats(previewDiffEntry.diff ?? "");
    }
    return { additions: previewFile?.additions ?? 0, deletions: previewFile?.deletions ?? 0 };
  }, [previewDiffEntry, previewFile]);
  const closePreviewModalNow = useCallback(() => {
    scopedPreviewRequestIdRef.current += 1;
    setIsPreviewModalDirty(false);
    setIsPreviewSaveInFlight(false);
    setIsUnsavedCloseDialogOpen(false);
    setPreviewFile(null);
    setIsPreviewModalMaximized(false);
  }, []);
  const discardAndClosePreviewModal = useCallback(() => {
    previewDraftActionsRef.current?.discard();
    closePreviewModalNow();
  }, [closePreviewModalNow]);
  const closePreviewModal = useCallback(() => {
    if (isPreviewModalDirty) {
      setIsUnsavedCloseDialogOpen(true);
      return;
    }
    closePreviewModalNow();
  }, [closePreviewModalNow, isPreviewModalDirty]);
  const handlePreviewDraftActionsChange = useCallback((actions: EditableDiffDraftActions | null) => {
    previewDraftActionsRef.current = actions;
    setIsPreviewSaveInFlight(actions?.isSaving ?? false);
  }, []);
  const saveAndClosePreviewModal = useCallback(async () => {
    const saved = await previewDraftActionsRef.current?.save();
    if (!saved) {
      return false;
    }
    closePreviewModalNow();
    return true;
  }, [closePreviewModalNow]);

  const handleOpenInlinePreview = useCallback(
    (path: string) => {
      setSelectedFiles(new Set([path]));
      setLastClickedFile(path);
      onSelectFile?.(path);
    },
    [onSelectFile],
  );

  const handleOpenRepositoryInlinePreview = useCallback(
    (repositoryRoot: string, path: string) => {
      onSelectFile?.(path, repositoryRoot);
    },
    [onSelectFile],
  );

  const openLocalHtmlInBuiltInBrowser = useCallback(
    (repositoryRoot: string | null | undefined, path: string) => {
      if (!workspaceId?.trim() || !workspacePath?.trim()) {
        pushErrorToast({
          title: t("files.openInBrowser"),
          message: t("files.openInBrowserNoWorkspace"),
        });
        return;
      }
      const workspaceRelativePath = resolveRepositoryWorkspaceFilePath(
        workspacePath,
        repositoryRoot ?? gitRoot,
        path,
      );
      const absolutePath = joinWorkspaceAbsolutePath(
        workspacePath,
        workspaceRelativePath,
      );
      void openHtmlInBrowser(absolutePath, {
        workspaceId,
        ownerSurface: "git-diff-file-list",
      }).catch((error) => {
        console.warn("[git-diff] openHtmlInBrowser failed", error);
        pushErrorToast({
          title: t("files.openInBrowser"),
          message: formatOpenHtmlInBrowserError(error, t),
        });
      });
    },
    [gitRoot, t, workspaceId, workspacePath],
  );

  const revealLocalFileInOsFileManager = useCallback(
    (repositoryRoot: string | null | undefined, file: Pick<DiffFile, "path" | "status">) => {
      if (!workspacePath?.trim()) {
        pushErrorToast({
          title: t(getRevealInOsFileManagerLabelKey()),
          message: t("files.revealFailed", {
            message: t("files.openInBrowserNoWorkspace"),
          }),
        });
        return;
      }
      const workspaceRelativePath = resolveRepositoryWorkspaceFilePath(
        workspacePath,
        repositoryRoot ?? gitRoot,
        file.path,
      );
      const absolutePath = joinWorkspaceAbsolutePath(
        workspacePath,
        workspaceRelativePath,
      );
      const reveal = isDeletedDiffFile(file)
        ? openFolderInFileManager(absolutePath)
        : revealInFileManager(absolutePath);
      void reveal.catch((error) => {
        console.warn("[git-diff] revealInFileManager failed", error);
        pushErrorToast({
          title: t(getRevealInOsFileManagerLabelKey()),
          message: t("files.revealFailed", {
            message: error instanceof Error ? error.message : String(error),
          }),
        });
      });
    },
    [gitRoot, t, workspacePath],
  );

  const handleRevealInFileManager = useCallback(
    (path: string) => {
      const file = allFiles.find(
        (entry) => normalizeDiffPath(entry.path) === normalizeDiffPath(path),
      );
      revealLocalFileInOsFileManager(gitRoot, file ?? { path, status: "M" });
    },
    [allFiles, gitRoot, revealLocalFileInOsFileManager],
  );

  const handleRevealRepositoryInFileManager = useCallback(
    (repositoryRoot: string, path: string) => {
      const repositoryStatus = repositoryStatuses.find(
        (status) => status.repositoryRoot === repositoryRoot,
      );
      const file = [
        ...(repositoryStatus?.stagedFiles ?? []),
        ...(repositoryStatus?.unstagedFiles ?? []),
      ].find((entry) => normalizeDiffPath(entry.path) === normalizeDiffPath(path));
      revealLocalFileInOsFileManager(repositoryRoot, file ?? { path, status: "M" });
    },
    [repositoryStatuses, revealLocalFileInOsFileManager],
  );

  const handleOpenInBrowser = useCallback(
    (path: string) => {
      openLocalHtmlInBuiltInBrowser(gitRoot, path);
    },
    [gitRoot, openLocalHtmlInBuiltInBrowser],
  );

  const handleOpenRepositoryInBrowser = useCallback(
    (repositoryRoot: string, path: string) => {
      openLocalHtmlInBuiltInBrowser(repositoryRoot, path);
    },
    [openLocalHtmlInBuiltInBrowser],
  );

  const resolvePreviewRepositoryRoot = useCallback((repositoryRoot: string | null) => {
    if (repositoryRoot !== null) {
      return repositoryRoot;
    }
    if (gitRoot === "") {
      return "";
    }
    if (workspacePath && gitRoot) {
      return resolveGitRootWorkspacePrefix(workspacePath, gitRoot);
    }
    return null;
  }, [gitRoot, workspacePath]);
  // 批量 diff 列表缺失/为空时的单文件兜底：内容非空则回填弹窗，空则标记
  // 「无文本差异」，失败则回落「差异不可用」。请求过期（关闭/换文件）直接丢弃。
  const loadPreviewFallbackDiff = useCallback(async (target: PreviewFileState) => {
    if (!workspaceId) {
      return;
    }
    const requestId = scopedPreviewRequestIdRef.current;
    const repositoryRoot = resolvePreviewRepositoryRoot(target.repositoryRoot);
    try {
      const fullDiff = await getGitFileFullDiff(workspaceId, target.path, repositoryRoot);
      if (scopedPreviewRequestIdRef.current !== requestId) {
        return;
      }
      setPreviewFile((current) => {
        if (
          !current
          || current.path !== target.path
          || current.section !== target.section
          || current.repositoryRoot !== target.repositoryRoot
        ) {
          return current;
        }
        if (fullDiff.trim().length === 0) {
          return { ...current, isDiffLoading: false, fallbackResolvedEmpty: true };
        }
        return {
          ...current,
          isDiffLoading: false,
          fallbackDiffEntry: { path: current.path, diff: fullDiff },
        };
      });
    } catch (error) {
      console.error("Failed to load preview fallback git diff", error);
      if (scopedPreviewRequestIdRef.current !== requestId) {
        return;
      }
      setPreviewFile((current) => {
        if (
          !current
          || current.path !== target.path
          || current.section !== target.section
          || current.repositoryRoot !== target.repositoryRoot
        ) {
          return current;
        }
        return { ...current, isDiffLoading: false };
      });
    }
  }, [resolvePreviewRepositoryRoot, workspaceId]);

  const handleOpenFilePreview = useCallback((
    file: DiffFile,
    section: "staged" | "unstaged",
    maximized = false,
  ) => {
    scopedPreviewRequestIdRef.current += 1;
    setIsPreviewModalDirty(false);
    setIsPreviewModalMaximized(maximized);
    const normalizedPath = normalizeDiffPath(file.path);
    const existingEntry = diffEntries.find(
      (entry) => normalizeDiffPath(entry.path) === normalizedPath,
    ) ?? null;
    const existingEntryHasContent = Boolean(
      existingEntry
      && (existingEntry.isImage || existingEntry.diff.trim().length > 0),
    );
    const target: PreviewFileState = {
      ...file,
      section,
      repositoryRoot: null,
      scopedDiffEntry: null,
      fallbackDiffEntry: null,
      fallbackResolvedEmpty: false,
      isDiffLoading: !existingEntryHasContent,
    };
    setPreviewFile(target);
    if (!existingEntryHasContent) {
      void loadPreviewFallbackDiff(target);
    }
  }, [diffEntries, loadPreviewFallbackDiff]);
  const handleOpenRepositoryFilePreview = useCallback(async (
    repositoryRoot: string,
    file: DiffFile,
    section: GitDiffSectionKey,
  ) => {
    if (!workspaceId) {
      return;
    }
    const requestId = scopedPreviewRequestIdRef.current + 1;
    scopedPreviewRequestIdRef.current = requestId;
    setIsPreviewModalDirty(false);
    setIsPreviewModalMaximized(false);
    setPreviewFile({
      ...file,
      section,
      repositoryRoot,
      scopedDiffEntry: null,
      fallbackDiffEntry: null,
      fallbackResolvedEmpty: false,
      isDiffLoading: true,
    });
    try {
      const scopedDiffs = await getGitDiffs(workspaceId, repositoryRoot);
      if (scopedPreviewRequestIdRef.current !== requestId) {
        return;
      }
      const normalizedPath = normalizeDiffPath(file.path);
      const scopedDiffEntry = scopedDiffs.find(
        (entry) => normalizeDiffPath(entry.path) === normalizedPath,
      ) ?? null;
      const scopedDiffEntryHasContent = Boolean(
        scopedDiffEntry
        && (scopedDiffEntry.isImage || scopedDiffEntry.diff.trim().length > 0),
      );
      const target: PreviewFileState = {
        ...file,
        section,
        repositoryRoot,
        scopedDiffEntry,
        fallbackDiffEntry: null,
        fallbackResolvedEmpty: false,
        isDiffLoading: !scopedDiffEntryHasContent,
      };
      setPreviewFile(target);
      if (!scopedDiffEntryHasContent) {
        void loadPreviewFallbackDiff(target);
      }
    } catch (error) {
      if (scopedPreviewRequestIdRef.current !== requestId) {
        return;
      }
      console.error("Failed to load repository-scoped git diff", error);
      setPreviewFile({
        ...file,
        section,
        repositoryRoot,
        scopedDiffEntry: null,
        fallbackDiffEntry: null,
        fallbackResolvedEmpty: false,
        isDiffLoading: false,
      });
    }
  }, [loadPreviewFallbackDiff, workspaceId]);
  const previewFullDiffLoader = useMemo(() => {
    if (!workspaceId || !previewFile) {
      return null;
    }
    const repositoryRoot = previewFile.repositoryRoot !== null
      ? previewFile.repositoryRoot
      : gitRoot === ""
        ? ""
        : workspacePath && gitRoot
          ? resolveGitRootWorkspacePrefix(workspacePath, gitRoot)
          : null;
    if (repositoryRoot === null) {
      return null;
    }
    return (path: string) => getGitFileFullDiff(workspaceId, path, repositoryRoot);
  }, [gitRoot, previewFile, workspaceId, workspacePath]);
  const previewContextKey = JSON.stringify([
    workspaceId,
    multiRepositoryMode ? "multi" : "single",
    multiRepositoryMode ? null : gitRoot,
  ]);
  useEffect(() => {
    if (previewContextKeyRef.current === null) {
      previewContextKeyRef.current = previewContextKey;
      return;
    }
    if (previewContextKeyRef.current === previewContextKey) {
      return;
    }
    previewContextKeyRef.current = previewContextKey;
    previewDraftActionsRef.current?.discard();
    closePreviewModalNow();
  }, [closePreviewModalNow, previewContextKey]);
  useEffect(() => {
    if (
      !modalPreviewRequest ||
      handledModalPreviewRequestIdRef.current === modalPreviewRequest.requestId
    ) {
      return;
    }
    const requestedFile = allFiles.find(
      (file) => normalizeDiffPath(file.path) === normalizeDiffPath(modalPreviewRequest.path),
    );
    if (requestedFile) {
      handledModalPreviewRequestIdRef.current = modalPreviewRequest.requestId;
      handleOpenFilePreview(
        requestedFile,
        requestedFile.section,
        modalPreviewRequest.maximized === true,
      );
    }
  }, [allFiles, handleOpenFilePreview, modalPreviewRequest]);
  const modeOptions = useMemo(
    () => [
      {
        value: "diff" as const,
        label: t("git.diffMode"),
        description: t("git.diffModeDescription"),
      },
      {
        value: "log" as const,
        label: t("git.logMode"),
        description: t("git.logModeDescription"),
      },
      {
        value: "issues" as const,
        label: t("git.issuesMode"),
        description: t("git.issuesModeDescription"),
      },
      {
        value: "prs" as const,
        label: t("git.prsMode"),
        description: t("git.prsModeDescription"),
      },
    ],
    [t],
  );
  const currentModeOption = useMemo(
    () =>
      modeOptions.find((option) => option.value === mode) ??
      modeOptions[0] ?? {
        value: "diff" as const,
        label: t("git.changesMode"),
        description: t("git.changesModeDescription"),
      },
    [mode, modeOptions, t],
  );
  const layoutOptions = useMemo(
    () => [
      { value: "flat" as const, label: t("git.listFlat"), icon: LayoutGrid },
      { value: "tree" as const, label: t("git.listTree"), icon: FolderTree },
    ],
    [t],
  );

  const handleModeSelect = useCallback(
    (nextMode: GitDiffPanelProps["mode"]) => {
      setIsModeMenuOpen(false);
      if (nextMode === mode) {
        return;
      }
      onModeChange(nextMode);
    },
    [mode, onModeChange],
  );
  const updateModeMenuLayout = useCallback(() => {
    const panelElement = panelRef.current;
    const triggerElement = modeTriggerRef.current;
    if (!panelElement || !triggerElement) {
      return;
    }

    const viewportPadding = 12;
    const preferredWidth = 246;
    const minimumWidth = 160;
    const panelRect = panelElement.getBoundingClientRect();
    const triggerRect = triggerElement.getBoundingClientRect();
    const boundedPanelLeft = Math.max(panelRect.left, viewportPadding);
    const boundedPanelRight = Math.min(panelRect.right, window.innerWidth - viewportPadding);
    const availableByRightAlign = Math.max(0, triggerRect.right - boundedPanelLeft);
    const availableByLeftAlign = Math.max(0, boundedPanelRight - triggerRect.left);
    const align: ModeMenuLayout["align"] =
      availableByRightAlign >= availableByLeftAlign ? "right" : "left";
    const maxAvailable = align === "right" ? availableByRightAlign : availableByLeftAlign;
    if (maxAvailable <= 0) {
      setModeMenuLayout({ align: "right", width: preferredWidth });
      return;
    }
    const width = Math.max(Math.min(preferredWidth, maxAvailable), Math.min(minimumWidth, maxAvailable));
    setModeMenuLayout({ align, width: Math.round(width) });
  }, []);
  const handleModeMenuToggle = useCallback(() => {
    if (!isModeMenuOpen) updateModeMenuLayout();
    setIsModeMenuOpen((current) => !current);
  }, [isModeMenuOpen, updateModeMenuLayout]);
  useEffect(() => {
    return () => {
      if (gitStatusRefreshSpinTimerRef.current !== null) {
        window.clearTimeout(gitStatusRefreshSpinTimerRef.current);
        gitStatusRefreshSpinTimerRef.current = null;
      }
      if (gitStatusRefreshSpinRafRef.current !== null) {
        window.cancelAnimationFrame(gitStatusRefreshSpinRafRef.current);
        gitStatusRefreshSpinRafRef.current = null;
      }
    };
  }, []);

  const handleRefreshGitStatusClick = useCallback(() => {
    if (gitStatusRefreshSpinTimerRef.current !== null) {
      window.clearTimeout(gitStatusRefreshSpinTimerRef.current);
      gitStatusRefreshSpinTimerRef.current = null;
    }
    if (gitStatusRefreshSpinRafRef.current !== null) {
      window.cancelAnimationFrame(gitStatusRefreshSpinRafRef.current);
      gitStatusRefreshSpinRafRef.current = null;
    }

    setIsGitStatusRefreshing(false);
    gitStatusRefreshSpinRafRef.current = window.requestAnimationFrame(() => {
      gitStatusRefreshSpinRafRef.current = null;
      setIsGitStatusRefreshing(true);
      gitStatusRefreshSpinTimerRef.current = window.setTimeout(() => {
        setIsGitStatusRefreshing(false);
        gitStatusRefreshSpinTimerRef.current = null;
      }, 520);
    });

    onRefreshGitStatus?.();
    onRefreshGitDiffs?.();
    onRefreshGitLog?.();
    void onRefreshRepositoryStatuses?.();
  }, [
    onRefreshGitDiffs,
    onRefreshGitLog,
    onRefreshGitStatus,
    onRefreshRepositoryStatuses,
  ]);

  const handleFileActivation = useCallback(
    (path: string, section: "staged" | "unstaged") => {
      setSelectedFiles(new Set([path]));
      setLastClickedFile(path);
      const file = (section === "staged" ? stagedFiles : unstagedFiles).find(
        (candidate) => candidate.path === path,
      );
      // Default row activation opens the editable DIFF modal so users can
      // review and patch changes without hunting for the preview action.
      if (file) {
        handleOpenFilePreview(file, section);
        return;
      }
      onSelectFile?.(path);
    },
    [
      handleOpenFilePreview,
      onSelectFile,
      stagedFiles,
      unstagedFiles,
    ],
  );

  // Row "open file" action (former modal-preview entry): open workspace file
  // content. Deleted files have no working-tree content, so fall back to DIFF.
  const handleOpenFileContent = useCallback((
    file: DiffFile,
    section: "staged" | "unstaged",
  ) => {
    setSelectedFiles(new Set([file.path]));
    setLastClickedFile(file.path);
    if (isDeletedDiffFile(file) || !onOpenFile) {
      handleOpenFilePreview(file, section);
      return;
    }
    onOpenFile(file.path);
  }, [handleOpenFilePreview, onOpenFile]);

  const handleFileClick = useCallback(
    (
      event: ReactMouseEvent<HTMLDivElement>,
      path: string,
      section: "staged" | "unstaged",
    ) => {
      const isMetaKey = event.metaKey || event.ctrlKey;
      const isShiftKey = event.shiftKey;

      if (isMetaKey) {
        // Cmd/Ctrl+click: toggle selection
        setSelectedFiles((prev) => {
          const next = new Set(prev);
          if (next.has(path)) {
            next.delete(path);
          } else {
            next.add(path);
          }
          return next;
        });
        setLastClickedFile(path);
      } else if (isShiftKey && lastClickedFile) {
        // Shift+click: select range
        const currentIndex = allFiles.findIndex((f) => f.path === path);
        const lastIndex = allFiles.findIndex((f) => f.path === lastClickedFile);
        if (currentIndex !== -1 && lastIndex !== -1) {
          const start = Math.min(currentIndex, lastIndex);
          const end = Math.max(currentIndex, lastIndex);
          const range = allFiles.slice(start, end + 1).map((f) => f.path);
          setSelectedFiles((prev) => {
            const next = new Set(prev);
            for (const p of range) {
              next.add(p);
            }
            return next;
          });
        }
      } else {
        // Regular click: select single file and view it
        handleFileActivation(path, section);
      }
    },
    [
      allFiles,
      handleFileActivation,
      lastClickedFile,
    ],
  );

  // Clear selection when files change. Keep section/folder collapse prefs —
  // git watch refreshes often and resetting expand state is disruptive.
  const filesKey = useMemo(
    () => [...stagedFiles, ...unstagedFiles].map((f) => f.path).join(","),
    [stagedFiles, unstagedFiles],
  );
  const prevFilesKeyRef = useRef(filesKey);
  useEffect(() => {
    if (filesKey === prevFilesKeyRef.current) {
      return;
    }
    prevFilesKeyRef.current = filesKey;
    setSelectedFiles(new Set());
    setLastClickedFile(null);
    setDiscardDialogTarget(null);
    setDiscardDialogSubmitting(false);
    if (!previewFile) {
      return;
    }
    const previewFileStillExists = allFiles.some(
      (file) => file.path === previewFile.path && file.section === previewFile.section,
    );
    if (previewFileStillExists) {
      return;
    }
    if (isPreviewModalDirty) {
      setIsUnsavedCloseDialogOpen(true);
      return;
    }
    closePreviewModalNow();
  }, [allFiles, closePreviewModalNow, filesKey, isPreviewModalDirty, previewFile]);

  useEffect(() => {
    if (!previewFile) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isUnsavedCloseDialogOpen) {
        return;
      }
      if (event.key === "Escape") {
        closePreviewModal();
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [closePreviewModal, isUnsavedCloseDialogOpen, previewFile]);

  useEffect(() => {
    if (!isModeMenuOpen) {
      return;
    }

    updateModeMenuLayout();

    const handleWindowMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (modeTriggerRef.current?.contains(target) || modeMenuRef.current?.contains(target)) {
        return;
      }
      setIsModeMenuOpen(false);
    };

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setIsModeMenuOpen(false);
      modeTriggerRef.current?.focus();
    };

    const handleWindowResize = () => {
      updateModeMenuLayout();
    };

    window.addEventListener("mousedown", handleWindowMouseDown);
    window.addEventListener("keydown", handleWindowKeyDown);
    window.addEventListener("resize", handleWindowResize);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            updateModeMenuLayout();
          });
    if (resizeObserver) {
      if (panelRef.current) {
        resizeObserver.observe(panelRef.current);
      }
      if (modeTriggerRef.current) {
        resizeObserver.observe(modeTriggerRef.current);
      }
    }

    return () => {
      window.removeEventListener("mousedown", handleWindowMouseDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.removeEventListener("resize", handleWindowResize);
      resizeObserver?.disconnect();
    };
  }, [isModeMenuOpen, updateModeMenuLayout]);

  useEffect(() => {
    setIsModeMenuOpen(false);
  }, [mode]);

  const shouldAutoOpenGitRootPanel =
    isMissingRepo(error) ||
    gitRootScanLoading ||
    Boolean(gitRootScanError) ||
    gitRootCandidates.length > 0;
  const shouldAutoCollapseGitRootPanelAfterScan =
    gitRootScanHasScanned &&
    !gitRootScanLoading &&
    !gitRootScanError &&
    gitRootCandidates.length === 0;

  useEffect(() => {
    if (shouldAutoOpenGitRootPanel) {
      setIsGitRootPanelOpen(true);
      return;
    }
    if (shouldAutoCollapseGitRootPanelAfterScan) {
      setIsGitRootPanelOpen(false);
    }
  }, [shouldAutoCollapseGitRootPanelAfterScan, shouldAutoOpenGitRootPanel]);

  useEffect(() => {
    if (mode !== "diff" || !onGitDiffListViewChange) {
      return;
    }
    const normalizedShortcut = (toggleGitDiffListViewShortcut ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "");
    if (
      !normalizedShortcut ||
      DISALLOWED_GIT_LIST_VIEW_SHORTCUTS.has(normalizedShortcut)
    ) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) {
        return;
      }
      const panelElement = panelRef.current;
      const activeElement = document.activeElement;
      if (
        panelElement &&
        activeElement instanceof HTMLElement &&
        !panelElement.contains(activeElement)
      ) {
        return;
      }
      if (!matchesShortcutForPlatform(event, normalizedShortcut)) {
        return;
      }
      event.preventDefault();
      onGitDiffListViewChange(gitDiffListView === "tree" ? "flat" : "tree");
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    gitDiffListView,
    mode,
    onGitDiffListViewChange,
    toggleGitDiffListViewShortcut,
  ]);

  const handleDiffListClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".diff-row")) {
        return;
      }
      setSelectedFiles(new Set());
      setLastClickedFile(null);
    },
    [],
  );
  const handleToggleFolder = useCallback((key: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);
  const handleToggleSection = useCallback((section: GitDiffSectionKey) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  }, []);

  const githubBaseUrl = useMemo(() => {
    if (!gitRemoteUrl) {
      return null;
    }
    const trimmed = gitRemoteUrl.trim();
    if (!trimmed) {
      return null;
    }
    let path = "";
    if (trimmed.startsWith("git@github.com:")) {
      path = trimmed.slice("git@github.com:".length);
    } else if (trimmed.startsWith("ssh://git@github.com/")) {
      path = trimmed.slice("ssh://git@github.com/".length);
    } else if (trimmed.includes("github.com/")) {
      path = trimmed.split("github.com/")[1] ?? "";
    }
    path = path.replace(/\.git$/, "").replace(/\/$/, "");
    if (!path) {
      return null;
    }
    return `https://github.com/${path}`;
  }, [gitRemoteUrl]);

  const showLogMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, entry: GitLogEntry) => {
      event.preventDefault();
      event.stopPropagation();
      const items: RendererContextMenuItem[] = [
        {
          type: "item",
          id: "copy-sha",
          label: "Copy SHA",
          onSelect: async () => {
            await copyTextToClipboard(entry.sha);
          },
        },
      ];
      if (githubBaseUrl) {
        items.push({
          type: "item",
          id: "open-github",
          label: "Open on GitHub",
          onSelect: async () => {
            await openUrl(`${githubBaseUrl}/commit/${entry.sha}`);
          },
        });
      }
      const position = clampRendererContextMenuPosition(event.clientX, event.clientY, {
        width: 220,
        height: githubBaseUrl ? 120 : 80,
      });
      setGitContextMenu({
        ...position,
        label: "Commit actions",
        items,
      });
    },
    [githubBaseUrl],
  );

  const showPullRequestMenu = useCallback(
    (
      event: ReactMouseEvent<HTMLDivElement>,
      pullRequest: GitHubPullRequest,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const position = clampRendererContextMenuPosition(event.clientX, event.clientY, {
        width: 220,
        height: 80,
      });
      setGitContextMenu({
        ...position,
        label: "Pull request actions",
        items: [
          {
            type: "item",
            id: "open-github",
            label: "Open on GitHub",
            onSelect: async () => {
              await openUrl(pullRequest.url);
            },
          },
        ],
      });
    },
    [],
  );

  const discardFiles = useCallback(
    async (paths: string[]) => {
      if ((!onRevertFile && !onRevertFiles) || paths.length === 0 || discardDialogSubmitting) {
        return;
      }
      setDiscardDialogTarget({ scope: "current-repository", paths });
    },
    [discardDialogSubmitting, onRevertFile, onRevertFiles],
  );

  const discardRepositoryFile = useCallback(
    async (repositoryRoot: string, path: string) => {
      if (
        (!onRevertRepositoryFile && !onRevertRepositoryFiles)
        || !path
        || discardDialogSubmitting
      ) {
        return;
      }
      setDiscardDialogTarget({
        scope: "explicit-repository",
        repositoryRoot,
        paths: [path],
      });
    },
    [discardDialogSubmitting, onRevertRepositoryFile, onRevertRepositoryFiles],
  );

  const discardRepositoryFiles = useCallback(
    async (repositoryRoot: string, paths: string[]) => {
      if (
        (!onRevertRepositoryFile && !onRevertRepositoryFiles)
        || paths.length === 0
        || discardDialogSubmitting
      ) {
        return;
      }
      setDiscardDialogTarget({
        scope: "explicit-repository",
        repositoryRoot,
        paths,
      });
    },
    [discardDialogSubmitting, onRevertRepositoryFile, onRevertRepositoryFiles],
  );

  const handleConfirmDiscardFiles = useCallback(async () => {
    if (!discardDialogTarget || discardDialogTarget.paths.length === 0 || discardDialogSubmitting) {
      return;
    }
    if (
      discardDialogTarget.scope === "current-repository"
      && !onRevertFiles
      && !onRevertFile
    ) {
      return;
    }
    if (
      discardDialogTarget.scope === "explicit-repository"
      && !onRevertRepositoryFiles
      && !onRevertRepositoryFile
    ) {
      return;
    }
    const target = discardDialogTarget;
    setDiscardDialogSubmitting(true);
    try {
      if (target.scope === "explicit-repository") {
        if (onRevertRepositoryFiles) {
          await onRevertRepositoryFiles(target.repositoryRoot, target.paths);
        } else {
          for (const path of target.paths) {
            await onRevertRepositoryFile?.(target.repositoryRoot, path);
          }
        }
        await onRefreshRepositoryStatuses?.();
      } else if (onRevertFiles) {
        await onRevertFiles(target.paths);
      } else {
        for (const path of target.paths) {
          await onRevertFile?.(path);
        }
      }
      setDiscardDialogTarget(null);
    } finally {
      setDiscardDialogSubmitting(false);
    }
  }, [
    discardDialogSubmitting,
    discardDialogTarget,
    onRefreshRepositoryStatuses,
    onRevertFile,
    onRevertFiles,
    onRevertRepositoryFile,
    onRevertRepositoryFiles,
  ]);

  const closeDiscardDialog = useCallback(() => {
    if (discardDialogSubmitting) {
      return;
    }
    setDiscardDialogTarget(null);
  }, [discardDialogSubmitting]);

  const discardFile = useCallback(
    async (path: string) => {
      await discardFiles([path]);
    },
    [discardFiles],
  );

  const showFileMenu = useCallback(
    (
      event: ReactMouseEvent<HTMLDivElement>,
      path: string,
      section: GitDiffSectionKey,
    ) => {
      event.preventDefault();
      event.stopPropagation();

      const sectionFiles = section === "staged" ? stagedFiles : unstagedFiles;
      const filesByNormalizedPath = new Map(
        sectionFiles.map((file) => [normalizeDiffPath(file.path), file]),
      );
      const clickedFile = filesByNormalizedPath.get(normalizeDiffPath(path));
      if (!clickedFile) {
        setGitContextMenu(null);
        return;
      }

      const mutationEnabled = !isFileMutationDisabled(clickedFile);
      const isInSelection =
        mutationEnabled &&
        Array.from(selectedFiles).some(
          (selectedPath) =>
            normalizeDiffPath(selectedPath) === normalizeDiffPath(path),
        );
      const selectedTargetPaths =
        mutationEnabled && isInSelection && selectedFiles.size > 1
          ? Array.from(selectedFiles)
          : mutationEnabled
            ? [path]
            : [];
      const targetPaths = mutationEnabled
        ? Array.from(
            new Map(
              selectedTargetPaths
                .map((selectedPath) =>
                  filesByNormalizedPath.get(normalizeDiffPath(selectedPath)),
                )
                .filter(
                  (file): file is DiffFile =>
                    file !== undefined && !isFileMutationDisabled(file),
                )
                .map((file) => [normalizeDiffPath(file.path), file.path]),
            ).values(),
          )
        : [];

      if (mutationEnabled && !isInSelection) {
        setSelectedFiles(new Set([path]));
        setLastClickedFile(path);
      }

      const fileHistoryTarget = onOpenFileHistory
        ? resolveGitDiffFileHistoryTarget({
            workspaceId,
            workspacePath,
            gitRoot,
            path: clickedFile.path,
          })
        : null;
      const items = buildGitDiffPanelFileContextMenuItems({
        t,
        unstageAction:
          mutationEnabled
          && section === "staged"
          && (onUnstageFiles || onUnstageFile)
            ? {
                count: targetPaths.length,
                onSelect: async () => {
                  if (onUnstageFiles) {
                    await onUnstageFiles(targetPaths);
                    return;
                  }
                  for (const targetPath of targetPaths) {
                    await onUnstageFile?.(targetPath);
                  }
                },
              }
            : undefined,
        stageAction:
          mutationEnabled && section === "unstaged" && onStageFile
            ? {
                count: targetPaths.length,
                onSelect: async () => {
                  for (const targetPath of targetPaths) {
                    await onStageFile(targetPath);
                  }
                },
              }
            : undefined,
        historyAction:
          fileHistoryTarget && onOpenFileHistory
            ? {
                onSelect: () => onOpenFileHistory(fileHistoryTarget),
              }
            : undefined,
        discardAction:
          mutationEnabled && section === "unstaged" && onRevertFile
            ? {
                count: targetPaths.length,
                onSelect: () => discardFiles(targetPaths),
              }
            : undefined,
      });
      if (items.length === 0) {
        setGitContextMenu(null);
        return;
      }

      const position = clampRendererContextMenuPosition(event.clientX, event.clientY, {
        width: 260,
        height: estimateRendererContextMenuHeight(items),
      });
      setGitContextMenu({
        ...position,
        label: t("git.fileActions"),
        items,
        source: "git-diff-file",
      });
    },
    [
      discardFiles,
      onRevertFile,
      onOpenFileHistory,
      onStageFile,
      onUnstageFile,
      onUnstageFiles,
      selectedFiles,
      stagedFiles,
      t,
      unstagedFiles,
      workspaceId,
      workspacePath,
      gitRoot,
    ],
  );

  const showRepositoryFileMenu = useCallback(
    (
      event: ReactMouseEvent<HTMLDivElement>,
      repositoryRoot: string,
      path: string,
      section: GitDiffSectionKey,
    ) => {
      event.preventDefault();
      event.stopPropagation();

      const repositoryStatus = repositoryStatuses.find(
        (status) => status.repositoryRoot === repositoryRoot,
      );
      const sectionFiles =
        section === "staged"
          ? repositoryStatus?.stagedFiles
          : repositoryStatus?.unstagedFiles;
      const targetFile = sectionFiles?.find(
        (file) => normalizeDiffPath(file.path) === normalizeDiffPath(path),
      );
      if (repositoryStatus?.error || !targetFile) {
        setGitContextMenu(null);
        return;
      }

      const mutationEnabled = !isFileMutationDisabled(targetFile);
      const fileHistoryTarget = onOpenFileHistory
        ? resolveGitDiffFileHistoryTarget({
            workspaceId,
            workspacePath,
            repositoryRoot,
            path: targetFile.path,
          })
        : null;
      const items = buildGitDiffPanelFileContextMenuItems({
        t,
        unstageAction:
          mutationEnabled && section === "staged" && onUnstageRepositoryFile
            ? {
                count: 1,
                onSelect: async () => {
                  await onUnstageRepositoryFile(repositoryRoot, targetFile.path);
                  await onRefreshRepositoryStatuses?.();
                },
              }
            : undefined,
        stageAction:
          mutationEnabled && section === "unstaged" && onStageRepositoryFile
            ? {
                count: 1,
                onSelect: async () => {
                  await onStageRepositoryFile(repositoryRoot, targetFile.path);
                  await onRefreshRepositoryStatuses?.();
                },
              }
            : undefined,
        historyAction:
          fileHistoryTarget && onOpenFileHistory
            ? {
                onSelect: () => onOpenFileHistory(fileHistoryTarget),
              }
            : undefined,
        discardAction:
          mutationEnabled && section === "unstaged" && onRevertRepositoryFile
            ? {
                count: 1,
                onSelect: () =>
                  discardRepositoryFile(repositoryRoot, targetFile.path),
              }
            : undefined,
      });
      if (items.length === 0) {
        setGitContextMenu(null);
        return;
      }

      const position = clampRendererContextMenuPosition(event.clientX, event.clientY, {
        width: 260,
        height: estimateRendererContextMenuHeight(items),
      });
      setGitContextMenu({
        ...position,
        label: t("git.fileActions"),
        items,
        source: "git-diff-file",
      });
    },
    [
      discardRepositoryFile,
      onRefreshRepositoryStatuses,
      onRevertRepositoryFile,
      onOpenFileHistory,
      onStageRepositoryFile,
      onUnstageRepositoryFile,
      repositoryStatuses,
      t,
      workspaceId,
      workspacePath,
    ],
  );
  const logCountLabel = logTotal
    ? `${logTotal} commit${logTotal === 1 ? "" : "s"}`
    : logEntries.length
      ? `${logEntries.length} commit${logEntries.length === 1 ? "" : "s"}`
    : "No commits";
  const logSyncLabel = logUpstream
    ? `↑${logAhead} ↓${logBehind}`
    : "No upstream configured";
  const logUpstreamLabel = logUpstream ? `Upstream ${logUpstream}` : "";
  const showAheadSection = logUpstream && logAhead > 0;
  const showBehindSection = logUpstream && logBehind > 0;
  const hasDiffTotals = totalAdditions > 0 || totalDeletions > 0;
  const primaryTreeSection =
    stagedFiles.length > 0 ? "staged" : unstagedFiles.length > 0 ? "unstaged" : null;
  const diffTotalsNode = (
    <>
      <span className="diff-status-add">+{totalAdditions}</span>
      <span className="diff-status-sep" aria-hidden>
        /
      </span>
      <span className="diff-status-del">-{totalDeletions}</span>
    </>
  );
  const diffStatusNode = hasDiffTotals
    ? (
        <>
          {logUpstream && (
            <>
              <span>{logSyncLabel}</span>
              <span className="diff-status-sep" aria-hidden>
                ·
              </span>
            </>
          )}
          {diffTotalsNode}
        </>
      )
    : logUpstream
      ? `${logSyncLabel} · ${fileStatus}`
      : fileStatus;
  const gitStatusRefreshButton =
    mode === "diff" && (
      onRefreshGitStatus ||
      onRefreshGitDiffs ||
      onRefreshGitLog ||
      onRefreshRepositoryStatuses
    ) ? (
      <button
        type="button"
        className={`git-status-refresh-button${isGitStatusRefreshing ? " is-spinning" : ""}`}
        onClick={(event) => {
          event.stopPropagation();
          handleRefreshGitStatusClick();
        }}
        aria-label={t("git.refreshStatus")}
        title={t("git.refreshStatus")}
      >
        <RefreshCw className="git-status-refresh-icon" size={13} aria-hidden />
      </button>
    ) : null;
  const gitStatusPushButton =
    mode === "diff" && commitsAhead > 0 && onPush ? (
      <button
        type="button"
        className="git-status-push-button"
        onClick={(event) => {
          event.stopPropagation();
          void onPush();
        }}
        disabled={pushLoading}
        aria-label={t("git.pushCommits", { count: commitsAhead })}
        title={t("git.pushCommits", { count: commitsAhead })}
      >
        {pushLoading ? (
          <span className="commit-button-spinner" aria-hidden />
        ) : (
          <Upload size={13} aria-hidden />
        )}
        <span className="git-status-push-count">{commitsAhead}</span>
      </button>
    ) : null;
  const hasGitRoot = Boolean(gitRoot && gitRoot.trim());
  const activeRootPath = (gitRoot ?? "").trim() || (workspacePath ?? "").trim() || (workspaceId ?? "").trim();
  const activeRootPathDisplay = activeRootPath || t("git.unknown");
  const showActiveRootSummary = mode !== "issues";
  const rootAlertText =
    mode === "diff"
      ? isMissingRepo(error)
        ? t("git.noRepositoriesFound")
        : error
          ? t("git.statusUnavailable")
          : null
      : null;
  const normalizedGitRoot = normalizeRootPath(gitRoot);
  const normalizedWorkspacePath = normalizeRootPath(workspacePath);
  const repositoryRootName =
    getPathLeafName(normalizedGitRoot) ||
    getPathLeafName(normalizedWorkspacePath) ||
    (workspaceId?.trim() ?? "");
  const hasAnyChanges = stagedFiles.length > 0 || unstagedFiles.length > 0;
  const commitScopeHint =
    selectedCommitCount > 0
      ? t("git.selectedFilesForCommit", { count: selectedCommitCount })
      : hasAnyChanges
        ? t("git.selectFilesToCommit")
        : t("git.noChangesToCommit");
  const useCompactTreeSectionHeaders = gitDiffListView === "tree" && Boolean(repositoryRootName);
  const useUnifiedDiffSummary = mode === "diff" && hasAnyChanges;
  const showApplyWorktree =
    mode === "diff" && Boolean(onApplyWorktreeChanges) && hasAnyChanges;
  const canGenerateCommitMessage = hasAnyChanges;
  const showGenerateCommitMessage =
    mode === "diff" && Boolean(onGenerateCommitMessage) && hasAnyChanges;
  const worktreeApplyIcon = worktreeApplySuccess ? (
    <Check size={12} aria-hidden />
  ) : (
    <Upload size={12} aria-hidden />
  );
  const selectedPathsForGeneration = useMemo(
    () =>
      selectedCommitCount > 0
        ? selectedCommitPaths
        : hasExplicitCommitSelection
          ? []
          : undefined,
    [selectedCommitCount, selectedCommitPaths, hasExplicitCommitSelection],
  );
  const { runGeneration: runCommitMessageGeneration } =
    useCommitMessageGenerationMenu<RepositoryCommitSelection[]>({
      t,
      busy: commitMessageLoading || commitLoading,
      canGenerate: (repositorySelections) =>
        Boolean(onGenerateCommitMessage) &&
        (repositorySelections
          ? repositorySelections.length > 0
          : canGenerateCommitMessage),
      generate: async (language, engine, repositorySelections) => {
        if (!onGenerateCommitMessage) {
          return;
        }
        if (repositorySelections) {
          await onGenerateCommitMessage(
            language,
            engine,
            undefined,
            repositorySelections,
          );
          return;
        }
        if (selectedPathsForGeneration) {
          await onGenerateCommitMessage(
            language,
            engine,
            selectedPathsForGeneration,
          );
          return;
        }
        await onGenerateCommitMessage(language, engine);
      },
      setEngine: setCommitMessageMenuEngine,
      currentEngine: commitMessageMenuEngine,
    });
  const singleCommitComposer =
    showGenerateCommitMessage && !multiRepositoryMode ? (
      <GitCommitComposer
        commitMessage={commitMessage}
        onCommitMessageChange={onCommitMessageChange}
        selectedCount={selectedCommitCount}
        hasAnyChanges={hasAnyChanges}
        canGenerate={canGenerateCommitMessage}
        commitLoading={commitLoading}
        commitMessageLoading={commitMessageLoading}
        commitError={commitError}
        commitMessageError={commitMessageError}
        extraErrors={[pushError, syncError]}
        hint={commitScopeHint}
        placement={commitComposerPlacement}
        engine={commitMessageMenuEngine}
        onEngineChange={setCommitMessageMenuEngine}
        onGenerate={(language, engine) => {
          void runCommitMessageGeneration(language, engine);
        }}
        onCommit={() => {
          void onCommit?.(selectedCommitPaths);
        }}
      />
    ) : null;
  return (
    <aside
      className={`diff-panel diff-panel--floating-git-actions${
        headerControlsTarget ? " has-external-mode-selector" : ""
      }${showApplyWorktree ? " has-floating-git-action" : ""}`}
      ref={panelRef}
    >
      <div
        className={`git-panel-header git-panel-header--hover-actions${
          headerControlsTarget && !showApplyWorktree ? " is-empty" : ""
        }`}
      >
        <div className="git-panel-actions" role="group" aria-label="Git panel">
          <GitModeSelectorMount target={headerControlsTarget}>
            <>
              <div className="git-panel-select">
                <button
                  ref={modeTriggerRef}
                  type="button"
                  className={`git-panel-select-trigger${isModeMenuOpen ? " is-open" : ""}`}
                  aria-label={t("git.panelView")}
                  aria-haspopup="menu"
                  aria-expanded={isModeMenuOpen}
                  onClick={handleModeMenuToggle}
                >
                  {renderModeIcon(currentModeOption.value, "git-panel-select-icon", 13)}
                  <span className="git-panel-select-label">{currentModeOption.label}</span>
                  <ChevronDown className="git-panel-select-caret" size={12} aria-hidden />
                </button>
                {isModeMenuOpen && (
                  <div
                    ref={modeMenuRef}
                    className="git-panel-select-menu"
                    role="menu"
                    aria-label={t("git.panelView")}
                    style={{
                      left: modeMenuLayout.align === "left" ? 0 : "auto",
                      right: modeMenuLayout.align === "right" ? 0 : "auto",
                      width: `${modeMenuLayout.width}px`,
                    }}
                  >
                    <div className="git-panel-select-menu-title">{currentModeOption.label}</div>
                    {modeOptions.filter((option) => option.value !== "log").map((option) => {
                      const isActive = option.value === mode;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          className={`git-panel-select-option${isActive ? " is-active" : ""}`}
                          role="menuitemradio"
                          aria-checked={isActive}
                          onClick={() => handleModeSelect(option.value)}
                        >
                          <span className="git-panel-select-option-text">
                            <span className="git-panel-select-option-icon" aria-hidden>
                              {renderModeIcon(option.value, "git-panel-select-option-icon-glyph", 13)}
                            </span>
                            <span className="git-panel-select-option-copy">
                              <span className="git-panel-select-option-label">{option.label}</span>
                              <span className="git-panel-select-option-description">
                                {option.description}
                              </span>
                            </span>
                          </span>
                          <span
                            className={`git-panel-select-option-check${isActive ? " is-active" : ""}`}
                            aria-hidden
                          >
                            ✓
                          </span>
                        </button>
                      );
                    })}
                    {mode === "diff" && onGitDiffListViewChange ? (
                      <>
                        <div className="git-panel-select-menu-divider" role="separator" />
                        <div className="git-panel-select-menu-title">{t("git.listView")}</div>
                        {layoutOptions.map((option) => {
                          const isActive = gitDiffListView === option.value;
                          const OptionIcon = option.icon;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              className={`git-panel-select-option${isActive ? " is-active" : ""}`}
                              role="menuitemradio"
                              aria-checked={isActive}
                              onClick={() => {
                                onGitDiffListViewChange?.(option.value);
                                setIsModeMenuOpen(false);
                              }}
                            >
                              <span className="git-panel-select-option-text">
                                <span className="git-panel-select-option-icon" aria-hidden>
                                  <OptionIcon size={13} />
                                </span>
                                <span className="git-panel-select-option-copy">
                                  <span className="git-panel-select-option-label">{option.label}</span>
                                </span>
                              </span>
                              <span
                                className={`git-panel-select-option-check${isActive ? " is-active" : ""}`}
                                aria-hidden
                              >
                                ✓
                              </span>
                            </button>
                          );
                        })}
                      </>
                    ) : null}
                    {onOpenGitHistoryPanel ? (
                      <>
                        <div className="git-panel-select-menu-divider" role="separator" />
                        <button
                          type="button"
                          className={`git-panel-select-option${isGitHistoryOpen ? " is-active" : ""}`}
                          role="menuitem"
                          onClick={() => {
                            setIsModeMenuOpen(false);
                            onOpenGitHistoryPanel?.();
                          }}
                        >
                          <span className="git-panel-select-option-text">
                            <span className="git-panel-select-option-icon" aria-hidden>
                              <GitCommitHorizontal size={13} />
                            </span>
                            <span className="git-panel-select-option-copy">
                              <span className="git-panel-select-option-label">
                                {t("git.historyQuickAction")}
                              </span>
                            </span>
                          </span>
                        </button>
                      </>
                    ) : null}
                </div>
              )}
            </div>
            {gitStatusRefreshButton}
            {gitStatusPushButton}
            </>
          </GitModeSelectorMount>
          {showApplyWorktree && (
            <FloatingTooltipButton
              type="button"
              className="diff-row-action diff-row-action--apply"
              onClick={() => {
                void onApplyWorktreeChanges?.();
              }}
              disabled={worktreeApplyLoading || worktreeApplySuccess}
              tooltipLabel={worktreeApplyTitle ?? t("git.applyWorktreeChanges")}
              tooltipSide="bottom"
              tooltipAlign="end"
              tooltipDelay={180}
              aria-label={t("git.applyWorktreeChangesAction")}
            >
              {worktreeApplyIcon}
            </FloatingTooltipButton>
          )}
        </div>
      </div>
      {showActiveRootSummary && (
        <div className="git-root-current">
          <span className="git-root-label">{t("git.path")}</span>
          <span className="git-root-path" title={activeRootPathDisplay}>
            {activeRootPathDisplay}
          </span>
          {rootAlertText ? <span className="git-root-inline-alert">{rootAlertText}</span> : null}
          {onScanGitRoots && (
            <button
              type="button"
              className="ghost git-root-button git-root-button--toggle"
              onClick={() => setIsGitRootPanelOpen((open) => !open)}
              aria-label={t("git.change")}
              title={t("git.change")}
              aria-expanded={isGitRootPanelOpen}
            >
              <ArrowLeftRight className="git-root-button-icon" aria-hidden />
              <span>{t("git.change")}</span>
            </button>
          )}
        </div>
      )}
      {mode === "diff" ? (
        <>
          {!useUnifiedDiffSummary && !rootAlertText ? <div className="diff-status">{diffStatusNode}</div> : null}
          {worktreeApplyError ? <div className="diff-error">{worktreeApplyError}</div> : null}
        </>
      ) : mode === "log" ? (
        <>
          <div className="diff-status">{logCountLabel}</div>
          <div className="git-log-sync">
            <span>{logSyncLabel}</span>
            {logUpstreamLabel && (
              <>
                <span className="git-log-sep">·</span>
                <span>{logUpstreamLabel}</span>
              </>
            )}
          </div>
        </>
      ) : mode === "issues" ? (
        <>
          <div className="diff-status diff-status-issues">
            <span>{t("git.githubIssues")}</span>
            {issuesLoading ? <span className="git-panel-spinner" aria-hidden /> : null}
          </div>
          <div className="git-log-sync">
            <span>{issuesTotal} {t("git.open")}</span>
          </div>
        </>
      ) : (
        <>
          <div className="diff-status diff-status-issues">
            <span>{t("git.githubPullRequests")}</span>
            {pullRequestsLoading && (
              <span className="git-panel-spinner" aria-hidden />
            )}
          </div>
          <div className="git-log-sync">
            <span>{pullRequestsTotal} {t("git.open")}</span>
          </div>
        </>
      )}
      {(mode === "diff" || mode === "log") && !multiRepositoryMode && !useUnifiedDiffSummary && !rootAlertText ? (
        <div className="diff-branch">{branchName || t("git.unknown")}</div>
      ) : null}
      {mode === "diff" ? (
        <div className="diff-list" onClick={handleDiffListClick}>
          {isGitRootPanelOpen && (
            <div className="git-root-panel" id="git-root-panel">
              <div className="git-root-toolbar">
                <div className="git-root-title">{t("git.chooseRepo")}</div>
                <div className="git-root-actions">
                  <button
                    type="button"
                    className="ghost git-root-button git-root-button--scan"
                    onClick={onScanGitRoots}
                    disabled={!onScanGitRoots || gitRootScanLoading}
                  >
                    <Search className="git-root-button-icon" aria-hidden />
                    {t("git.scanWorkspace")}
                  </button>
                  <label className="git-root-depth">
                    <span>{t("git.depth")}</span>
                    <select
                      className="git-root-select"
                      value={gitRootScanDepth}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (!Number.isNaN(value)) {
                          onGitRootScanDepthChange?.(value);
                        }
                      }}
                      disabled={gitRootScanLoading}
                    >
                      {DEPTH_OPTIONS.map((depth) => (
                        <option key={depth} value={depth}>
                          {depth}
                        </option>
                      ))}
                    </select>
                  </label>
                  {hasGitRoot && onClearGitRoot && (
                    <button
                      type="button"
                      className="ghost git-root-button git-root-button--workspace-root"
                      onClick={() => {
                        onClearGitRoot();
                        setIsGitRootPanelOpen(false);
                      }}
                      disabled={gitRootScanLoading}
                    >
                      <HardDrive className="git-root-button-icon" aria-hidden />
                      {t("git.useWorkspaceRoot")}
                    </button>
                  )}
                </div>
              </div>
              {gitRootScanLoading && (
                <div className="diff-empty">{t("git.scanningRepositories")}</div>
              )}
              {gitRootScanError && <div className="diff-error">{gitRootScanError}</div>}
              {!gitRootScanLoading &&
                !gitRootScanError &&
                gitRootScanHasScanned &&
                gitRootCandidates.length === 0 && (
                  <div className="diff-empty">{t("git.noRepositoriesFound")}</div>
                )}
              {gitRootCandidates.length > 0 && (
                <div className="git-root-list">
                  {gitRootCandidates.map((path) => {
                    const normalizedPath = normalizeRootPath(path);
                    const isActive =
                      normalizedGitRoot && normalizedGitRoot === normalizedPath;
                    return (
                    <button
                      key={path}
                      type="button"
                      className={`git-root-item ${isActive ? "active" : ""}`}
                      onClick={() => {
                        onSelectGitRoot?.(path);
                        setIsGitRootPanelOpen(false);
                      }}
                    >
                      <span className="git-root-path">{path}</span>
                      {isActive && <span className="git-root-tag">{t("git.active")}</span>}
                    </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {multiRepositoryMode && workspaceId ? (
            <GitMultiRepositoryChanges
              workspaceId={workspaceId}
              statuses={repositoryStatuses}
              isLoading={repositoryStatusesLoading}
              commitMessage={commitMessage}
              commitLoading={commitLoading}
              commitMessageLoading={commitMessageLoading}
              commitError={commitError}
              commitMessageError={commitMessageError}
              commitSummary={repositoryCommitSummary}
              commitMessageEngine={commitMessageMenuEngine}
              commitComposerPlacement={commitComposerPlacement}
              onCommitMessageChange={onCommitMessageChange}
              onCommitRepositories={onCommitRepositories}
              onGenerateCommitMessage={(language, engine, selections) => {
                void runCommitMessageGeneration(language, engine, selections);
              }}
              onCommitMessageEngineChange={setCommitMessageMenuEngine}
              onStageFile={onStageRepositoryFile}
              onUnstageFile={onUnstageRepositoryFile}
              onUnstageAll={onUnstageRepositoryAll}
              onUnstageFiles={onUnstageRepositoryFiles}
              onDiscardFile={onRevertRepositoryFile ? discardRepositoryFile : undefined}
              onDiscardFiles={
                onRevertRepositoryFiles || onRevertRepositoryFile
                  ? discardRepositoryFiles
                  : undefined
              }
              onStageAll={onStageRepositoryAll}
              onOpenFile={(repositoryRoot, path) => onOpenFile?.(path, repositoryRoot)}
              onOpenFilePreview={handleOpenRepositoryFilePreview}
              onOpenFileContent={(repositoryRoot, path) => onOpenFile?.(path, repositoryRoot)}
              onOpenInlinePreview={onSelectFile ? handleOpenRepositoryInlinePreview : undefined}
              onRevealInFileManager={handleRevealRepositoryInFileManager}
              onOpenInBrowser={handleOpenRepositoryInBrowser}
              onShowFileMenu={showRepositoryFileMenu}
              onRefresh={onRefreshRepositoryStatuses}
            />
          ) : null}
          {commitComposerPlacement === "top" ? singleCommitComposer : null}
          {!multiRepositoryMode ? <div className="diff-commit-workspace-content">
          {!hasAnyChanges && pushError && (
            <div className="commit-message-error">{pushError}</div>
          )}
          {!error && !stagedFiles.length && !unstagedFiles.length && commitsAhead === 0 && (
            <div className="diff-empty">{t("git.noChangesDetected")}</div>
          )}
          {(stagedFiles.length > 0 || unstagedFiles.length > 0) && (
            <>
              {stagedFiles.length > 0 &&
                (gitDiffListView === "tree" ? (
                  <DiffTreeSection
                    title={t("git.staged")}
                    files={stagedFiles}
                    section="staged"
                    includedPaths={includedCommitPaths}
                    excludedPaths={excludedCommitPaths}
                    partialPaths={partialCommitPaths}
                    rootFolderName={repositoryRootName}
                    compactHeader={useCompactTreeSectionHeaders}
                    isCollapsed={collapsedSections.has("staged")}
                    onToggleCollapsed={() => handleToggleSection("staged")}
                    selectedFiles={selectedFiles}
                    selectedPath={selectedPath}
                    onActivateFile={handleFileActivation}
                    onUnstageAllChanges={onUnstageAllChanges}
                    onUnstageFile={onUnstageFile}
                    onUnstageFiles={onUnstageFiles}
                    onDiscardFile={onRevertFile || onRevertFiles ? discardFile : undefined}
                    onDiscardFiles={onRevertFile || onRevertFiles ? discardFiles : undefined}
                    isCommitPathLocked={isCommitPathLocked}
                    onSetCommitSelection={setCommitSelection}
                    onFileClick={handleFileClick}
                    onOpenInlinePreview={onSelectFile ? handleOpenInlinePreview : undefined}
                    onOpenFilePreview={onOpenFile ? handleOpenFileContent : undefined}
                    onRevealInFileManager={handleRevealInFileManager}
                    onOpenInBrowser={handleOpenInBrowser}
                    onShowFileMenu={showFileMenu}
                    collapsedFolders={collapsedFolders}
                    onToggleFolder={handleToggleFolder}
                  />
                ) : (
                  <DiffSection
                    title={t("git.staged")}
                    files={stagedFiles}
                    section="staged"
                    includedPaths={includedCommitPaths}
                    excludedPaths={excludedCommitPaths}
                    partialPaths={partialCommitPaths}
                    rootFolderName={repositoryRootName}
                    compactHeader={primaryTreeSection === "staged"}
                    isCollapsed={collapsedSections.has("staged")}
                    onToggleCollapsed={() => handleToggleSection("staged")}
                    selectedFiles={selectedFiles}
                    selectedPath={selectedPath}
                    onActivateFile={handleFileActivation}
                    onUnstageAllChanges={onUnstageAllChanges}
                    onUnstageFile={onUnstageFile}
                    onUnstageFiles={onUnstageFiles}
                    onDiscardFile={onRevertFile || onRevertFiles ? discardFile : undefined}
                    onDiscardFiles={onRevertFile || onRevertFiles ? discardFiles : undefined}
                    isCommitPathLocked={isCommitPathLocked}
                    onSetCommitSelection={setCommitSelection}
                    onFileClick={handleFileClick}
                    onOpenInlinePreview={onSelectFile ? handleOpenInlinePreview : undefined}
                    onOpenFilePreview={onOpenFile ? handleOpenFileContent : undefined}
                    onRevealInFileManager={handleRevealInFileManager}
                    onOpenInBrowser={handleOpenInBrowser}
                    onShowFileMenu={showFileMenu}
                  />
                ))}
              {unstagedFiles.length > 0 &&
                (gitDiffListView === "tree" ? (
                  <DiffTreeSection
                    title={t("git.unstaged")}
                    files={unstagedFiles}
                    section="unstaged"
                    includedPaths={includedCommitPaths}
                    excludedPaths={excludedCommitPaths}
                    partialPaths={partialCommitPaths}
                    rootFolderName={repositoryRootName}
                    compactHeader={useCompactTreeSectionHeaders}
                    isCollapsed={collapsedSections.has("unstaged")}
                    onToggleCollapsed={() => handleToggleSection("unstaged")}
                    selectedFiles={selectedFiles}
                    selectedPath={selectedPath}
                    onActivateFile={handleFileActivation}
                    onStageAllChanges={onStageAllChanges}
                    onStageFile={onStageFile}
                    onDiscardFile={onRevertFile || onRevertFiles ? discardFile : undefined}
                    onDiscardFiles={onRevertFile || onRevertFiles ? discardFiles : undefined}
                    isCommitPathLocked={isCommitPathLocked}
                    onSetCommitSelection={setCommitSelection}
                    onFileClick={handleFileClick}
                    onOpenInlinePreview={onSelectFile ? handleOpenInlinePreview : undefined}
                    onOpenFilePreview={onOpenFile ? handleOpenFileContent : undefined}
                    onRevealInFileManager={handleRevealInFileManager}
                    onOpenInBrowser={handleOpenInBrowser}
                    onShowFileMenu={showFileMenu}
                    collapsedFolders={collapsedFolders}
                    onToggleFolder={handleToggleFolder}
                  />
                ) : (
                  <DiffSection
                    title={t("git.unstaged")}
                    files={unstagedFiles}
                    section="unstaged"
                    includedPaths={includedCommitPaths}
                    excludedPaths={excludedCommitPaths}
                    partialPaths={partialCommitPaths}
                    rootFolderName={repositoryRootName}
                    compactHeader={primaryTreeSection === "unstaged"}
                    isCollapsed={collapsedSections.has("unstaged")}
                    onToggleCollapsed={() => handleToggleSection("unstaged")}
                    selectedFiles={selectedFiles}
                    selectedPath={selectedPath}
                    onActivateFile={handleFileActivation}
                    onStageAllChanges={onStageAllChanges}
                    onStageFile={onStageFile}
                    onDiscardFile={onRevertFile || onRevertFiles ? discardFile : undefined}
                    onDiscardFiles={onRevertFile || onRevertFiles ? discardFiles : undefined}
                    isCommitPathLocked={isCommitPathLocked}
                    onSetCommitSelection={setCommitSelection}
                    onFileClick={handleFileClick}
                    onOpenInlinePreview={onSelectFile ? handleOpenInlinePreview : undefined}
                    onOpenFilePreview={onOpenFile ? handleOpenFileContent : undefined}
                    onRevealInFileManager={handleRevealInFileManager}
                    onOpenInBrowser={handleOpenInBrowser}
                    onShowFileMenu={showFileMenu}
                  />
                ))}
            </>
          )}
          </div> : null}
          {commitComposerPlacement === "bottom" ? singleCommitComposer : null}
        </div>
      ) : mode === "log" ? (
        <div className="git-log-list">
          {logError && <div className="diff-error">{logError}</div>}
          {!logError && logLoading && (
            <div className="diff-viewer-loading">{t("git.loadingCommits")}</div>
          )}
          {!logError &&
            !logLoading &&
            !logEntries.length &&
            !showAheadSection &&
            !showBehindSection && (
            <div className="diff-empty">{t("git.noCommitsYet")}</div>
          )}
          {showAheadSection && (
            <div className="git-log-section">
              <div className="git-log-section-title">{t("git.toPush")}</div>
              <div className="git-log-section-list">
                {logAheadEntries.map((entry) => {
                  const isSelected = selectedCommitSha === entry.sha;
                  return (
                    <GitLogEntryRow
                      key={entry.sha}
                      entry={entry}
                      isSelected={isSelected}
                      compact
                      onSelect={onSelectCommit}
                      onContextMenu={(event) => showLogMenu(event, entry)}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {showBehindSection && (
            <div className="git-log-section">
              <div className="git-log-section-title">{t("git.toPull")}</div>
              <div className="git-log-section-list">
                {logBehindEntries.map((entry) => {
                  const isSelected = selectedCommitSha === entry.sha;
                  return (
                    <GitLogEntryRow
                      key={entry.sha}
                      entry={entry}
                      isSelected={isSelected}
                      compact
                      onSelect={onSelectCommit}
                      onContextMenu={(event) => showLogMenu(event, entry)}
                    />
                  );
                })}
              </div>
            </div>
          )}
          {(logEntries.length > 0 || logLoading) && (
            <div className="git-log-section">
              <div className="git-log-section-title">{t("git.recentCommits")}</div>
              <div className="git-log-section-list">
                {logEntries.map((entry) => {
                  const isSelected = selectedCommitSha === entry.sha;
                  return (
                    <GitLogEntryRow
                      key={entry.sha}
                      entry={entry}
                      isSelected={isSelected}
                      onSelect={onSelectCommit}
                      onContextMenu={(event) => showLogMenu(event, entry)}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : mode === "issues" ? (
        <div className="git-issues-list">
          {issuesError && <div className="diff-error">{issuesError}</div>}
          {!issuesError && !issuesLoading && !issues.length && (
            <div className="diff-empty">{t("git.noOpenIssues")}</div>
          )}
          {issues.map((issue) => {
            const relativeTime = formatRelativeTime(new Date(issue.updatedAt).getTime());
            return (
              <a
                key={issue.number}
                className="git-issue-entry"
                href={issue.url}
                onClick={(event) => {
                  event.preventDefault();
                  void openUrl(issue.url);
                }}
              >
                <div className="git-issue-summary">
                  <span className="git-issue-title">
                    <span className="git-issue-number">#{issue.number}</span>{" "}
                    {issue.title}{" "}
                    <span className="git-issue-date">· {relativeTime}</span>
                  </span>
                </div>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="git-pr-list">
          {pullRequestsError && (
            <div className="diff-error">{pullRequestsError}</div>
          )}
          {!pullRequestsError &&
            !pullRequestsLoading &&
            !pullRequests.length && (
            <div className="diff-empty">{t("git.noOpenPullRequests")}</div>
          )}
          {pullRequests.map((pullRequest) => {
            const relativeTime = formatRelativeTime(
              new Date(pullRequest.updatedAt).getTime(),
            );
            const author = pullRequest.author?.login ?? t("git.unknown");
            const isSelected = selectedPullRequest === pullRequest.number;
            return (
              <div
                key={pullRequest.number}
                className={`git-pr-entry ${isSelected ? "active" : ""}`}
                onClick={() => onSelectPullRequest?.(pullRequest)}
                onContextMenu={(event) => showPullRequestMenu(event, pullRequest)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelectPullRequest?.(pullRequest);
                  }
                }}
              >
                <div className="git-pr-header">
                  <span className="git-pr-title">
                    <span className="git-pr-number">#{pullRequest.number}</span>
                    <span className="git-pr-title-text">
                      {pullRequest.title}{" "}
                      <span className="git-pr-author-inline">@{author}</span>
                    </span>
                  </span>
                  <span className="git-pr-time">{relativeTime}</span>
                </div>
                <div className="git-pr-meta">
                  {pullRequest.isDraft && (
                    <span className="git-pr-pill git-pr-draft">{t("git.draft")}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {previewFile && typeof document !== "undefined"
        ? createPortal(
            <div
              className="git-history-diff-modal-overlay is-popup"
              role="presentation"
              onClick={closePreviewModal}
            >
              <div
                className={`git-history-diff-modal ${isPreviewModalMaximized ? "is-maximized" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={previewFile.path}
                onClick={(event) => event.stopPropagation()}
              >
                <div className="git-history-diff-modal-header">
                  <div className="git-history-diff-modal-title">
                    <span className={`git-history-file-status git-status-${previewFile.status.toLowerCase()}`}>
                      {previewFile.status}
                    </span>
                    <span className="git-history-tree-icon is-file" aria-hidden>
                      <FileIcon filePath={previewFile.path} />
                    </span>
                    <span className="git-history-diff-modal-path">{previewFile.path}</span>
                    <span className="git-history-diff-modal-stats">
                      <span className="is-add">+{previewStats.additions}</span>
                      <span className="is-sep">/</span>
                      <span className="is-del">-{previewStats.deletions}</span>
                    </span>
                  </div>
                  <div className="git-history-diff-modal-actions" ref={setPreviewHeaderControlsTarget}>
                    <button
                      type="button"
                      className="git-history-diff-modal-close"
                      onClick={() => setIsPreviewModalMaximized((value) => !value)}
                      aria-label={isPreviewModalMaximized ? t("common.restore") : t("menu.maximize")}
                      title={isPreviewModalMaximized ? t("common.restore") : t("menu.maximize")}
                    >
                      <span className="git-history-diff-modal-close-glyph" aria-hidden>
                        {isPreviewModalMaximized ? "❐" : "□"}
                      </span>
                    </button>
                  </div>
                </div>
                <div className="git-history-diff-modal-viewer">
                  {previewDiffEntry
                    && (previewDiffEntry.isImage || previewDiffEntry.diff.trim().length > 0) ? (
                    <WorkspaceEditableDiffReviewSurface
                      workspaceId={workspaceId}
                      workspacePath={workspacePath}
                      files={[
                        {
                          filePath: previewFile.path,
                          workspaceRelativeFilePath: resolveRepositoryWorkspaceFilePath(
                            workspacePath,
                            previewFile.repositoryRoot ?? gitRoot,
                            previewFile.path,
                          ),
                          status: previewFile.status,
                          additions: previewFile.additions,
                          deletions: previewFile.deletions,
                          diff: previewDiffEntry.diff,
                          isImage: previewDiffEntry.isImage,
                          oldImageData: previewDiffEntry.oldImageData,
                          newImageData: previewDiffEntry.newImageData,
                          oldImageMime: previewDiffEntry.oldImageMime,
                          newImageMime: previewDiffEntry.newImageMime,
                        },
                      ]}
                      selectedPath={previewFile.path}
                      stickyHeaderMode="controls-only"
                      embeddedAnchorVariant="modal-pager"
                      toolbarLayout="inline-actions"
                      headerControlsTarget={previewHeaderControlsTarget}
                      onRequestClose={closePreviewModal}
                      fullDiffSourceKey={previewFile.path}
                      fullDiffLoader={previewFullDiffLoader}
                      diffStyle={diffViewStyle}
                      onDiffStyleChange={onDiffViewStyleChange}
                      focusSelectedFileOnly
                      allowEditing
                      onRequestRefreshReview={
                        previewFile.repositoryRoot === null
                          ? onRefreshGitDiffs
                          : onRefreshRepositoryStatuses
                      }
                      onRequestGitStatusRefresh={
                        previewFile.repositoryRoot === null ? onRefreshGitStatus : undefined
                      }
                      onDirtyChange={setIsPreviewModalDirty}
                      onDraftActionsChange={handlePreviewDraftActionsChange}
                      onCreateCodeAnnotation={onCreateCodeAnnotation}
                      onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                      codeAnnotations={codeAnnotations}
                      codeAnnotationSurface="modal-diff-view"
                    />
                  ) : previewFile.isDiffLoading ? (
                    <div className="diff-empty">{t("common.loading")}</div>
                  ) : previewFile.fallbackResolvedEmpty ? (
                    <div className="diff-empty">{t("git.diffNoTextChanges")}</div>
                  ) : (
                    <div className="diff-empty">{t("git.diffUnavailable")}</div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      <UnsavedChangesDialog
        open={isUnsavedCloseDialogOpen}
        isSaving={isPreviewSaveInFlight}
        onContinueEditing={() => setIsUnsavedCloseDialogOpen(false)}
        onDiscard={discardAndClosePreviewModal}
        onSaveAndClose={saveAndClosePreviewModal}
      />
      {discardDialogPaths ? (
        <div
          className="diff-danger-dialog-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDiscardDialog();
            }
          }}
        >
          <div
            className="diff-danger-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t("git.discardConfirmTitle")}
          >
            <div className="diff-danger-dialog-title">{t("git.discardConfirmTitle")}</div>
            <div className="diff-danger-dialog-copy">
              <p>{t("git.discardDialogBeginnerLead")}</p>
              <div className="diff-danger-dialog-list">
                <div className="diff-danger-dialog-list-title">{t("git.discardDialogAffectsLabel")}</div>
                <ul>
                  {discardDialogPaths.map((path) => (
                    <li key={path}>
                      <code className="diff-danger-dialog-file">{path}</code>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="diff-danger-dialog-note">
                <span className="diff-danger-dialog-keyword">{t("git.revertAllKeywordIrreversible")}</span>
                <span>{t("git.discardDialogBeginnerHint")}</span>
              </div>
            </div>
            <div className="diff-danger-dialog-actions">
              <button
                type="button"
                className="ghost"
                onClick={closeDiscardDialog}
                disabled={discardDialogSubmitting}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="diff-danger-dialog-confirm"
                onClick={() => void handleConfirmDiscardFiles()}
                disabled={discardDialogSubmitting}
              >
                {discardDialogSubmitting ? t("common.loading") : t("git.discardDialogConfirmAction")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {gitContextMenu ? (
        <RendererContextMenu
          menu={gitContextMenu}
          onClose={() => setGitContextMenu(null)}
          className="renderer-context-menu git-diff-context-menu"
        />
      ) : null}
    </aside>
  );
}
