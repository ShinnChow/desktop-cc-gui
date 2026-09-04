import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { emitTo } from "@tauri-apps/api/event";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import type { PanelTabId } from "../../layout/components/PanelTabs";
import type { WorkspaceDirectoryEntry } from "../../../services/tauri";
import { joinWorkspaceAbsolutePath } from "../../../utils/workspacePaths";
import { getRevealInOsFileManagerLabelKey } from "../../../utils/rendererPlatform";
import type {
  GitFileStatus,
  GitRepositorySummary,
  OpenAppTarget,
} from "../../../types";
import type { GitRepositoryActionRequest } from "../../git/types/gitRepositoryActions";
import { projectGitRepositoryFileStatuses } from "../../git/utils/gitRepositorySummary";
import {
  resolveGitRootWorkspacePrefix,
  resolveGitStatusPathCandidates,
} from "../../../utils/workspacePaths";
import type { FileHistoryTarget } from "../../git-history/types";
import {
  writeDetachedFileTreeDragSnapshot,
  DETACHED_FILE_TREE_DRAG_BRIDGE_EVENT,
  type DetachedFileTreeDragBridgePayload,
} from "../detachedFileTreeDragBridge";
import { loadFileTreeStyles } from "../../../styles/featureStyleLoaders";
import { useFeatureStylesReady } from "../../../styles/useFeatureStylesReady";
import {
  CROSS_WINDOW_TREE_DRAG_REBROADCAST_THROTTLE_MS,
} from "../utils/fileTreeDragBridge";
import { FilePreviewPopover } from "./FilePreviewPopover";
import {
  FileTreeNewFilePrompt,
  FileTreeNewFolderPrompt,
  FileTreeRenamePrompt,
} from "./FileTreePrompts";
import {
  FileTreeNodeBranch,
  FileTreeVirtualRow,
  type FileTreeRowHandlers,
  type FileTreeRowRefs,
  type FileTreeRowState,
} from "./FileTreeRows";
import { FileTreeRootActions } from "./FileTreeRootActions";
import { useFileTreeViewState } from "./useFileTreeViewState";
import { FileTreeRefreshControls } from "./FileTreeRefreshControls";
import { RendererContextMenu } from "../../../components/ui/RendererContextMenu";
import { showFileTreeContextMenu } from "./fileTreeContextMenu";
import { useFileTreeItemOperations } from "../hooks/useFileTreeItemOperations";
import { useFileTreeLazyChildren } from "../hooks/useFileTreeLazyChildren";
import { useFileTreePreviewPopover } from "../hooks/useFileTreePreviewPopover";
import {
  EMPTY_DIRECTORIES,
  EMPTY_DIRECTORY_METADATA,
  EMPTY_SET,
  FILE_TREE_VIRTUALIZATION_THRESHOLD,
  buildTree,
  filterSuppressedFileTreePaths,
  getGitignoredFolderAncestorPaths,
  isGitignoredFileTreeNode,
  isSpecialDirectoryPath,
  isSuppressedFileTreePath,
  resolveWorkspaceRootLabel,
  type FileTreeNode,
  type VisibleFileTreeRow,
  type VisibleTreeNodeEntry,
} from "./fileTreePanelInternals";

const EMPTY_GIT_REPOSITORIES: GitRepositorySummary[] = [];
const GIT_STATUS_PRIORITY: Record<string, number> = { U: 5, D: 4, A: 3, M: 2, R: 1, T: 0 };

function normalizeFileTreePath(path: string) {
  return path.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

function assignGitStatusIfHigherPriority(
  target: Map<string, string>,
  path: string,
  status: string,
) {
  const nextStatus = status.trim().toUpperCase();
  const nextPriority = GIT_STATUS_PRIORITY[nextStatus];
  if (nextPriority === undefined) return;
  const currentStatus = target.get(path);
  const currentPriority = currentStatus ? (GIT_STATUS_PRIORITY[currentStatus] ?? -1) : -1;
  if (nextPriority > currentPriority) target.set(path, nextStatus);
}

type FileTreePanelProps = {
  workspaceId: string;
  workspaceName?: string;
  workspacePath: string;
  gitRoot?: string | null;
  files: string[];
  directories?: string[];
  directoryMetadata?: WorkspaceDirectoryEntry[];
  sourceVersion?: string | null;
  isLoading: boolean;
  loadError?: string | null;
  filePanelMode: PanelTabId;
  onFilePanelModeChange: (mode: PanelTabId) => void;
  onInsertText?: (text: string) => void;
  onOpenFile?: (path: string, location?: FileOpenLocation) => void;
  onCompareFiles?: (paths: string[]) => boolean;
  openTargets: OpenAppTarget[];
  openAppIconById: Record<string, string>;
  selectedOpenAppId: string;
  onSelectOpenAppId: (id: string) => void;
  onToggleRuntimeConsole?: () => void;
  isRuntimeConsoleVisible?: boolean;
  onOpenSpecHub?: () => void;
  isSpecHubActive?: boolean;
  onOpenDetachedExplorer?: (initialFilePath?: string | null) => void;
  showSpecHubAction?: boolean;
  showDetachedExplorerAction?: boolean;
  crossWindowDragTargetLabel?: string | null;
  gitStatusFiles?: GitFileStatus[];
  gitRepositories?: GitRepositorySummary[];
  gitignoredFiles?: Set<string>;
  gitignoredDirectories?: Set<string>;
  onRefreshFiles?: () => void;
  onGitRepositoryAction?: (
    request: GitRepositoryActionRequest,
  ) => void | Promise<void>;
  onOpenFileHistory?: (target: FileHistoryTarget) => void;
  revealRequest?: FileTreeRevealRequest | null;
};

export type FileTreeRevealRequest = {
  workspaceId: string;
  path: string;
  requestId: number;
};

type FileOpenLocation = {
  line: number;
  column: number;
};

export function FileTreePanel(props: FileTreePanelProps) {
  const stylesReady = useFeatureStylesReady(loadFileTreeStyles);
  if (!stylesReady) {
    return null;
  }

  return <FileTreePanelImpl {...props} />;
}

function FileTreePanelImpl({
  workspaceId,
  workspaceName,
  workspacePath,
  gitRoot = null,
  files,
  directories,
  directoryMetadata = EMPTY_DIRECTORY_METADATA,
  sourceVersion = null,
  isLoading,
  loadError = null,
  filePanelMode: _filePanelMode,
  onFilePanelModeChange: _onFilePanelModeChange,
  onInsertText,
  onOpenFile,
  onCompareFiles,
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  onToggleRuntimeConsole: _onToggleRuntimeConsole,
  isRuntimeConsoleVisible: _isRuntimeConsoleVisible = false,
  onOpenSpecHub,
  isSpecHubActive = false,
  onOpenDetachedExplorer,
  showSpecHubAction = true,
  showDetachedExplorerAction = true,
  crossWindowDragTargetLabel = null,
  gitStatusFiles,
  gitRepositories = EMPTY_GIT_REPOSITORIES,
  gitignoredFiles,
  gitignoredDirectories,
  onRefreshFiles,
  onGitRepositoryAction,
  onOpenFileHistory,
  revealRequest = null,
}: FileTreePanelProps) {
  const directoryEntries = directories ?? EMPTY_DIRECTORIES;
  const ignoredFileEntries = gitignoredFiles ?? EMPTY_SET;
  const ignoredDirectoryEntries = gitignoredDirectories ?? EMPTY_SET;
  const { t } = useTranslation();
  const viewState = useFileTreeViewState({
    workspaceId,
    sourceVersion,
    onRefreshFiles,
  });
  const {
    activeCrossWindowDragPathsRef,
    closePreview,
    dragImageCleanupRef,
    expandedFolders,
    fileTreeContextMenu,
    fileTreeListRef,
    lastCrossWindowDragBroadcastRef,
    lazyDirectories,
    lazyDirectoryLoadErrors,
    lazyDirectoryMetadata,
    lazyFiles,
    lazyGitignoredDirectories,
    lazyGitignoredFiles,
    lazyLoadableDirectories,
    loadingLazyDirectories,
    newFileInputRef,
    newFileName,
    newFileParent,
    newFolderInputRef,
    newFolderName,
    newFolderParent,
    operationNotice,
    panelRef,
    previewAnchor,
    previewContent,
    previewError,
    previewLoading,
    previewPath,
    previewSelection,
    previewTruncated,
    refreshFileTree,
    renameDraftName,
    renameInputRef,
    renamePrompt,
    selectedNodePath,
    selectedNodePaths,
    selectedNodeType,
    selectionAnchorPathRef,
    setExpandedFolders,
    setFileTreeContextMenu,
    setNewFileName,
    setNewFolderName,
    setPreviewSelection,
    setRenameDraftName,
    setSelectedNodePath,
    setSelectedNodePaths,
    setSelectedNodeType,
    suppressedDeletedPaths,
  } = viewState;

  const workspaceRootLabel = useMemo(
    () => resolveWorkspaceRootLabel(workspacePath, workspaceName),
    [workspaceName, workspacePath],
  );
  const repositorySummaryMap = useMemo(
    () => new Map(
      gitRepositories
        .filter((repository) => repository.repositoryRoot !== "")
        .map((repository) => [repository.repositoryRoot, repository]),
    ),
    [gitRepositories],
  );
  const rootRepositorySummary = useMemo(
    () => gitRepositories.find((repository) => repository.repositoryRoot === "") ?? null,
    [gitRepositories],
  );
  const repositoryFolderPaths = useMemo(
    () => new Set(repositorySummaryMap.keys()),
    [repositorySummaryMap],
  );
  const gitRootWorkspacePrefix = useMemo(
    () => resolveGitRootWorkspacePrefix(workspacePath, gitRoot),
    [gitRoot, workspacePath],
  );
  const mergedFiles = useMemo(() => {
    const next = new Set<string>(files);
    lazyFiles.forEach((path) => next.add(path));
    return Array.from(next).filter((path) => !isSuppressedFileTreePath(path, suppressedDeletedPaths));
  }, [files, lazyFiles, suppressedDeletedPaths]);
  const mergedDirectories = useMemo(() => {
    const next = new Set<string>(directoryEntries);
    lazyDirectories.forEach((path) => next.add(path));
    return Array.from(next).filter((path) => !isSuppressedFileTreePath(path, suppressedDeletedPaths));
  }, [directoryEntries, lazyDirectories, suppressedDeletedPaths]);
  const mergedGitignoredFiles = useMemo(() => {
    const next = new Set<string>(ignoredFileEntries);
    lazyGitignoredFiles.forEach((path) => next.add(path));
    return filterSuppressedFileTreePaths(next, suppressedDeletedPaths);
  }, [ignoredFileEntries, lazyGitignoredFiles, suppressedDeletedPaths]);
  const mergedGitignoredDirectories = useMemo(() => {
    const next = new Set<string>(ignoredDirectoryEntries);
    lazyGitignoredDirectories.forEach((path) => next.add(path));
    return filterSuppressedFileTreePaths(next, suppressedDeletedPaths);
  }, [ignoredDirectoryEntries, lazyGitignoredDirectories, suppressedDeletedPaths]);
  const directoryMetadataByPath = useMemo(() => {
    const next = new Map<string, WorkspaceDirectoryEntry>();
    directoryMetadata.forEach((entry) => {
      if (entry.path && !isSuppressedFileTreePath(entry.path, suppressedDeletedPaths)) {
        next.set(entry.path, entry);
      }
    });
    lazyDirectoryMetadata.forEach((entry, path) => {
      if (!isSuppressedFileTreePath(path, suppressedDeletedPaths)) {
        next.set(path, entry);
      }
    });
    return next;
  }, [directoryMetadata, lazyDirectoryMetadata, suppressedDeletedPaths]);
  const seededLazyLoadableDirectories = useMemo(() => {
    const result = new Set<string>();
    mergedDirectories.forEach((path) => {
      if (isSpecialDirectoryPath(path)) {
        result.add(path);
      }
      const childState = directoryMetadataByPath.get(path)?.child_state;
      if (childState === "unknown" || childState === "partial") {
        result.add(path);
      }
    });
    return result;
  }, [directoryMetadataByPath, mergedDirectories]);
  const effectiveLazyLoadableDirectories = useMemo(() => {
    const result = new Set(seededLazyLoadableDirectories);
    lazyLoadableDirectories.forEach((path) => result.add(path));
    return result;
  }, [seededLazyLoadableDirectories, lazyLoadableDirectories]);
  const hasTreeEntries = mergedFiles.length > 0 || mergedDirectories.length > 0;
  const showLoading = isLoading && !hasTreeEntries;
  const normalizedLoadError =
    typeof loadError === "string" && loadError.trim().length > 0 ? loadError.trim() : null;

  const aggregateGitStatusFiles = useMemo(
    () => projectGitRepositoryFileStatuses(gitRepositories),
    [gitRepositories],
  );
  const workspaceGitStatusEntries = useMemo(() => {
    const entries: Array<{ path: string; status: string }> = [...aggregateGitStatusFiles];
    for (const entry of gitStatusFiles ?? []) {
      const entryPath = entry.path?.trim();
      const entryStatus = entry.status?.trim();
      if (!entryPath || !entryStatus) continue;
      resolveGitStatusPathCandidates(
        workspacePath,
        gitRootWorkspacePrefix,
        entryPath,
      ).forEach((path) => entries.push({ path, status: entryStatus }));
    }
    return entries;
  }, [aggregateGitStatusFiles, gitRootWorkspacePrefix, gitStatusFiles, workspacePath]);

  const gitStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of workspaceGitStatusEntries) {
      assignGitStatusIfHigherPriority(map, entry.path, entry.status);
    }
    return map;
  }, [workspaceGitStatusEntries]);

  const { nodes, folderPaths } = useMemo(
    () => buildTree(
      mergedFiles,
      mergedDirectories,
      effectiveLazyLoadableDirectories,
      directoryMetadataByPath,
      repositoryFolderPaths,
    ),
    [
      effectiveLazyLoadableDirectories,
      directoryMetadataByPath,
      mergedDirectories,
      mergedFiles,
      repositoryFolderPaths,
    ],
  );
  const gitignoredTreeNodeMap = useMemo(() => {
    const memo = new Map<string, boolean>();
    nodes.forEach((node) => {
      isGitignoredFileTreeNode(
        node,
        mergedGitignoredFiles,
        mergedGitignoredDirectories,
        memo,
      );
    });
    return memo;
  }, [mergedGitignoredDirectories, mergedGitignoredFiles, nodes]);
  const gitignoredFolderAncestorPaths = useMemo(
    () => getGitignoredFolderAncestorPaths(folderPaths, mergedGitignoredDirectories),
    [folderPaths, mergedGitignoredDirectories],
  );
  const [manuallyCollapsedAutoExpandedFolders, setManuallyCollapsedAutoExpandedFolders] =
    useState<Set<string>>(EMPTY_SET);
  const effectiveExpandedFolders = useMemo(() => {
    if (gitignoredFolderAncestorPaths.size === 0) {
      return expandedFolders;
    }
    const next = new Set(expandedFolders);
    gitignoredFolderAncestorPaths.forEach((path) => {
      if (folderPaths.has(path) && !manuallyCollapsedAutoExpandedFolders.has(path)) {
        next.add(path);
      }
    });
    return next;
  }, [
    expandedFolders,
    folderPaths,
    gitignoredFolderAncestorPaths,
    manuallyCollapsedAutoExpandedFolders,
  ]);
  const folderGitStatusMap = useMemo(() => {
    if (workspaceGitStatusEntries.length === 0) {
      return new Map<string, string>();
    }
    const map = new Map<string, string>();
    const assignIfHigherPriority = (folderPath: string, status: string) => {
      assignGitStatusIfHigherPriority(map, folderPath, status);
    };

    for (const entry of workspaceGitStatusEntries) {
      const entryPath = entry.path?.trim();
      const entryStatus = entry.status?.trim();
      if (!entryPath || !entryStatus) {
        continue;
      }
      const segments = entryPath.split("/").filter(Boolean);
      if (segments.length <= 1) continue;
      let folderPath = "";
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index] ?? "";
        folderPath = folderPath ? `${folderPath}/${segment}` : segment;
        assignIfHigherPriority(folderPath, entryStatus);
      }
    }

    return map;
  }, [workspaceGitStatusEntries]);

  const visibleTreeNodeEntries = useMemo(() => {
    const entries: VisibleTreeNodeEntry[] = [];
    const visit = (node: FileTreeNode, depth: number) => {
      entries.push({ path: node.path, type: node.type, depth, node });
      if (node.type === "folder" && effectiveExpandedFolders.has(node.path)) {
        node.children.forEach((child) => visit(child, depth + 1));
      }
    };
    nodes.forEach((node) => visit(node, 0));
    return entries;
  }, [effectiveExpandedFolders, nodes]);
  const visibleFileTreeRows = useMemo(() => {
    const rows: VisibleFileTreeRow[] = [];
    for (const entry of visibleTreeNodeEntries) {
      if (!entry.node) {
        continue;
      }
      rows.push({ kind: "node", entry: entry as VisibleTreeNodeEntry & { node: FileTreeNode } });
      const node = entry.node;
      const isLazyFolder = node.type === "folder" && (node.isLazyLoadable ?? false);
      const isExpanded = effectiveExpandedFolders.has(node.path);
      if (!isLazyFolder || !isExpanded || node.children.length > 0) {
        continue;
      }
      const lazyLoadError = lazyDirectoryLoadErrors.get(node.path) ?? null;
      rows.push({
        kind: "lazy-state",
        path: node.path,
        depth: entry.depth + 1,
        state: loadingLazyDirectories.has(node.path)
          ? "loading"
          : lazyLoadError
            ? "error"
            : "empty",
        error: lazyLoadError,
      });
    }
    return rows;
  }, [
    effectiveExpandedFolders,
    lazyDirectoryLoadErrors,
    loadingLazyDirectories,
    visibleTreeNodeEntries,
  ]);
  const shouldVirtualizeFileTree =
    visibleFileTreeRows.length > FILE_TREE_VIRTUALIZATION_THRESHOLD;
  const fileTreeRowVirtualizer = useVirtualizer({
    count: shouldVirtualizeFileTree ? visibleFileTreeRows.length : 0,
    getScrollElement: () => fileTreeListRef.current,
    estimateSize: () => 28,
    overscan: 16,
    getItemKey: (index) => {
      const row = visibleFileTreeRows[index];
      if (!row) {
        return index;
      }
      return row.kind === "node"
        ? row.entry.path
        : `${row.path}:lazy-${row.state}`;
    },
  });
  const lastScrolledRevealRequestIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (
      !revealRequest ||
      revealRequest.workspaceId !== workspaceId ||
      lastScrolledRevealRequestIdRef.current === revealRequest.requestId
    ) {
      return;
    }
    const normalizedPath = normalizeFileTreePath(revealRequest.path);
    if (!normalizedPath) {
      return;
    }
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    const ancestorPaths = pathSegments
      .slice(0, -1)
      .map((_, index) => pathSegments.slice(0, index + 1).join("/"));
    const availableAncestorPaths = ancestorPaths.filter((path) => folderPaths.has(path));
    setExpandedFolders((current) => {
      const missingAncestors = availableAncestorPaths.filter((path) => !current.has(path));
      if (missingAncestors.length === 0) {
        return current;
      }
      const next = new Set(current);
      missingAncestors.forEach((path) => next.add(path));
      return next;
    });
    setManuallyCollapsedAutoExpandedFolders((current) => {
      if (current.size === 0) {
        return current;
      }
      let changed = false;
      const next = new Set(current);
      availableAncestorPaths.forEach((path) => {
        if (next.delete(path)) {
          changed = true;
        }
      });
      return changed ? next : current;
    });
    if (!mergedFiles.includes(normalizedPath)) {
      return;
    }
    setSelectedNodePath(normalizedPath);
    setSelectedNodeType("file");
    setSelectedNodePaths(new Set([normalizedPath]));
    selectionAnchorPathRef.current = normalizedPath;
  }, [
    folderPaths,
    mergedFiles,
    revealRequest,
    selectionAnchorPathRef,
    setExpandedFolders,
    setSelectedNodePath,
    setSelectedNodePaths,
    setSelectedNodeType,
    setManuallyCollapsedAutoExpandedFolders,
    workspaceId,
  ]);
  useEffect(() => {
    if (
      !revealRequest ||
      revealRequest.workspaceId !== workspaceId ||
      lastScrolledRevealRequestIdRef.current === revealRequest.requestId
    ) {
      return;
    }
    const normalizedPath = normalizeFileTreePath(revealRequest.path);
    const targetIndex = visibleFileTreeRows.findIndex(
      (row) => row.kind === "node" && row.entry.path === normalizedPath,
    );
    if (targetIndex < 0) {
      return;
    }
    if (shouldVirtualizeFileTree) {
      fileTreeRowVirtualizer.scrollToIndex(targetIndex, { align: "auto" });
    }
    const animationFrame = requestAnimationFrame(() => {
      const targetRow = Array.from(
        fileTreeListRef.current?.querySelectorAll<HTMLElement>("[data-file-tree-path]") ?? [],
      ).find((row) => row.dataset.fileTreePath === normalizedPath);
      if (!targetRow) {
        return;
      }
      targetRow.scrollIntoView({ block: "nearest" });
      lastScrolledRevealRequestIdRef.current = revealRequest.requestId;
    });
    return () => cancelAnimationFrame(animationFrame);
  }, [
    fileTreeListRef,
    fileTreeRowVirtualizer,
    revealRequest,
    shouldVirtualizeFileTree,
    visibleFileTreeRows,
    workspaceId,
  ]);
  const visibleTreePathOrder = useMemo(
    () => visibleTreeNodeEntries.map((entry) => entry.path),
    [visibleTreeNodeEntries],
  );
  const visibleTreePathTypeMap = useMemo(
    () =>
      new Map<string, "file" | "folder" | "root">(
        visibleTreeNodeEntries.map((entry) => [entry.path, entry.type]),
      ),
    [visibleTreeNodeEntries],
  );
  const allTreeNodePaths = useMemo(() => {
    const result = new Set<string>([""]);
    const visit = (node: FileTreeNode) => {
      result.add(node.path);
      if (node.type === "folder") {
        node.children.forEach(visit);
      }
    };
    nodes.forEach(visit);
    return result;
  }, [nodes]);

  const setSingleSelection = useCallback((path: string, type: "file" | "folder" | "root") => {
    setSelectedNodePaths(new Set([path]));
    setSelectedNodePath(path);
    setSelectedNodeType(type === "root" ? "folder" : type);
    selectionAnchorPathRef.current = path;
  }, [
    selectionAnchorPathRef,
    setSelectedNodePath,
    setSelectedNodePaths,
    setSelectedNodeType,
  ]);

  const setRangeSelection = useCallback(
    (targetPath: string, targetType: "file" | "folder" | "root") => {
      const anchorPath = selectionAnchorPathRef.current ?? selectedNodePath ?? targetPath;
      const anchorIndex = visibleTreePathOrder.indexOf(anchorPath);
      const targetIndex = visibleTreePathOrder.indexOf(targetPath);
      if (anchorIndex < 0 || targetIndex < 0) {
        setSingleSelection(targetPath, targetType);
        return;
      }
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const rangePaths = visibleTreePathOrder.slice(start, end + 1);
      setSelectedNodePaths(new Set(rangePaths));
      setSelectedNodePath(targetPath);
      setSelectedNodeType(targetType === "root" ? "folder" : targetType);
    },
    [
      selectedNodePath,
      selectionAnchorPathRef,
      setSelectedNodePath,
      setSelectedNodePaths,
      setSelectedNodeType,
      setSingleSelection,
      visibleTreePathOrder,
    ],
  );

  const togglePathSelection = useCallback((path: string, type: "file" | "folder" | "root") => {
    setSelectedNodePaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      const fallbackPath = next.has(path)
        ? path
        : visibleTreePathOrder.find((entryPath) => next.has(entryPath)) ?? null;
      setSelectedNodePath(fallbackPath);
      setSelectedNodeType(
        fallbackPath ? ((visibleTreePathTypeMap.get(fallbackPath) ?? type) === "root" ? "folder" : (visibleTreePathTypeMap.get(fallbackPath) ?? type) as "file" | "folder") : null,
      );
      selectionAnchorPathRef.current = path;
      return next;
    });
  }, [
    selectionAnchorPathRef,
    setSelectedNodePath,
    setSelectedNodePaths,
    setSelectedNodeType,
    visibleTreePathOrder,
    visibleTreePathTypeMap,
  ]);

  useEffect(() => {
    setManuallyCollapsedAutoExpandedFolders((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      let changed = false;
      const next = new Set<string>();
      prev.forEach((path) => {
        if (folderPaths.has(path)) {
          next.add(path);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setExpandedFolders((prev) => {
      // Keep only folders that still exist; default is all collapsed.
      const next = new Set<string>();
      prev.forEach((path) => {
        if (folderPaths.has(path)) {
          next.add(path);
        }
      });
      if (next.size === prev.size && [...next].every((path) => prev.has(path))) {
        return prev;
      }
      return next;
    });
  }, [folderPaths, setExpandedFolders]);

  useEffect(() => {
    if (gitignoredFolderAncestorPaths.size === 0) {
      return;
    }
    setExpandedFolders((prev) => {
      let changed = false;
      const next = new Set(prev);
      gitignoredFolderAncestorPaths.forEach((path) => {
        if (
          !folderPaths.has(path) ||
          manuallyCollapsedAutoExpandedFolders.has(path) ||
          next.has(path)
        ) {
          return;
        }
        next.add(path);
        changed = true;
      });
      return changed ? next : prev;
    });
  }, [
    folderPaths,
    gitignoredFolderAncestorPaths,
    manuallyCollapsedAutoExpandedFolders,
    setExpandedFolders,
  ]);

  useEffect(() => {
    setSelectedNodePaths((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      let changed = false;
      const next = new Set<string>();
      prev.forEach((path) => {
        if (allTreeNodePaths.has(path)) {
          next.add(path);
        } else {
          changed = true;
        }
      });
      if (!changed) {
        return prev;
      }
      const nextPrimaryPath =
        selectedNodePath && next.has(selectedNodePath)
          ? selectedNodePath
          : visibleTreePathOrder.find((path) => next.has(path)) ?? null;
      setSelectedNodePath(nextPrimaryPath);
      setSelectedNodeType(
        nextPrimaryPath
          ? (visibleTreePathTypeMap.get(nextPrimaryPath) === "file" ? "file" : "folder")
          : null,
      );
      if (selectionAnchorPathRef.current && !next.has(selectionAnchorPathRef.current)) {
        selectionAnchorPathRef.current = nextPrimaryPath;
      }
      return next;
    });
  }, [
    allTreeNodePaths,
    selectedNodePath,
    selectionAnchorPathRef,
    setSelectedNodePath,
    setSelectedNodePaths,
    setSelectedNodeType,
    visibleTreePathOrder,
    visibleTreePathTypeMap,
  ]);

  const resolvePath = useCallback(
    (relativePath: string) => joinWorkspaceAbsolutePath(workspacePath, relativePath),
    [workspacePath],
  );

  const revealInOsLabel = useMemo(
    () => t(getRevealInOsFileManagerLabelKey()),
    [t],
  );

  const { loadLazyDirectoryChildren, toggleFolderExpandedState } =
    useFileTreeLazyChildren({
      viewState,
      workspaceId,
      effectiveExpandedFolders,
      effectiveLazyLoadableDirectories,
      setManuallyCollapsedAutoExpandedFolders,
    });
  const {
    previewKind,
    previewImageSrc,
    openPreview,
    handleSelectLine,
    handleLineMouseDown,
    handleLineMouseEnter,
    handleLineMouseUp,
    selectionHints,
    handleAddSelection,
  } = useFileTreePreviewPopover({
    viewState,
    workspaceId,
    resolvePath,
    onInsertText,
    t,
  });
  const {
    copyPath,
    normalizeOperationError,
    showOperationNotice,
    openHtmlFileInBuiltInBrowser,
    trashItem,
    copyFileTreeItem,
    pasteFileTreeItem,
    duplicateItem,
    openRenamePrompt,
    cancelRename,
    confirmRename,
    openNewFilePrompt,
    confirmNewFile,
    cancelNewFile,
    openNewFolderPrompt,
    confirmNewFolder,
    cancelNewFolder,
    resolveParentFolderForNode,
    addRepositoryToGitignore,
  } = useFileTreeItemOperations({
    viewState,
    workspaceId,
    files,
    directoryEntries,
    workspaceRootLabel,
    visibleTreePathOrder,
    visibleTreePathTypeMap,
    resolvePath,
    setManuallyCollapsedAutoExpandedFolders,
    onRefreshFiles,
    t,
  });

  const detachedInitialFilePath = selectedNodeType === "file" ? selectedNodePath : null;
  const orderedSelectedNodePaths = useMemo(
    () =>
      visibleTreePathOrder.filter((path) => path.length > 0 && selectedNodePaths.has(path)),
    [selectedNodePaths, visibleTreePathOrder],
  );
  const broadcastCrossWindowTreeDrag = useCallback(
    (payload: DetachedFileTreeDragBridgePayload) => {
      if (!crossWindowDragTargetLabel) {
        return;
      }
      if (payload.type === "start") {
        writeDetachedFileTreeDragSnapshot(payload.paths);
      }
      void emitTo(
        crossWindowDragTargetLabel,
        DETACHED_FILE_TREE_DRAG_BRIDGE_EVENT,
        payload,
      ).catch(() => {});
    },
    [crossWindowDragTargetLabel],
  );
  const rebroadcastCrossWindowTreeDrag = useCallback(() => {
    if (!crossWindowDragTargetLabel) {
      return;
    }
    const paths = activeCrossWindowDragPathsRef.current;
    if (paths.length === 0) {
      return;
    }
    const now = Date.now();
    if (
      now - lastCrossWindowDragBroadcastRef.current <
      CROSS_WINDOW_TREE_DRAG_REBROADCAST_THROTTLE_MS
    ) {
      return;
    }
    lastCrossWindowDragBroadcastRef.current = now;
    broadcastCrossWindowTreeDrag({
      type: "start",
      paths,
    });
  }, [
    activeCrossWindowDragPathsRef,
    broadcastCrossWindowTreeDrag,
    crossWindowDragTargetLabel,
    lastCrossWindowDragBroadcastRef,
  ]);

  const showContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>, relativePath: string, isFolder: boolean) => {
      showFileTreeContextMenu({
        event,
        relativePath,
        isFolder,
        resolvePath,
        copyPath,
        trashItem,
        copyFileTreeItem,
        duplicateItem,
        pasteFileTreeItem,
        setFileTreeContextMenu,
        onInsertText,
        openRenamePrompt,
        openNewFilePrompt,
        openNewFolderPrompt,
        openHtmlFileInBuiltInBrowser,
        onCompareFiles,
        orderedSelectedNodePaths,
        addRepositoryToGitignore,
        onGitRepositoryAction,
        onOpenFileHistory,
        gitRepositories,
        repositorySummaryMap,
        rootRepositorySummary,
        resolveParentFolderForNode,
        selectedNodePaths,
        showOperationNotice,
        normalizeOperationError,
        revealInOsLabel,
        t,
        visibleTreePathTypeMap,
        workspaceId,
        workspacePath,
      });
    },
    [
      resolvePath,
      copyPath,
      trashItem,
      copyFileTreeItem,
      duplicateItem,
      pasteFileTreeItem,
      setFileTreeContextMenu,
      onInsertText,
      openRenamePrompt,
      openNewFilePrompt,
      openNewFolderPrompt,
      openHtmlFileInBuiltInBrowser,
      onCompareFiles,
      orderedSelectedNodePaths,
      addRepositoryToGitignore,
      onGitRepositoryAction,
      onOpenFileHistory,
      gitRepositories,
      repositorySummaryMap,
      rootRepositorySummary,
      resolveParentFolderForNode,
      selectedNodePaths,
      showOperationNotice,
      normalizeOperationError,
      revealInOsLabel,
      t,
      visibleTreePathTypeMap,
      workspaceId,
      workspacePath,
    ],
  );


  const fileTreeRowState: FileTreeRowState = {
    expandedFolders: effectiveExpandedFolders,
    loadingLazyDirectories,
    lazyDirectoryLoadErrors,
    folderGitStatusMap,
    gitStatusMap,
    mergedGitignoredDirectories,
    mergedGitignoredFiles,
    gitignoredTreeNodeMap,
    selectedNodePaths,
    selectedNodePath,
    orderedSelectedNodePaths,
    repositorySummaryMap,
  };
  const fileTreeRowHandlers: FileTreeRowHandlers = {
    setRangeSelection,
    togglePathSelection,
    setSingleSelection,
    setSelectedNodePath,
    setSelectedNodeType,
    toggleFolderExpandedState,
    loadLazyDirectoryChildren,
    openPreview,
    showContextMenu,
    resolvePath,
    broadcastCrossWindowTreeDrag,
    rebroadcastCrossWindowTreeDrag,
    onOpenFile,
    onInsertText,
    onOpenInBrowser: openHtmlFileInBuiltInBrowser,
  };
  const fileTreeRowRefs: FileTreeRowRefs = {
    activeCrossWindowDragPathsRef,
    lastCrossWindowDragBroadcastRef,
    dragImageCleanupRef,
  };

  return (
    <aside className="diff-panel file-tree-panel" ref={panelRef}>
      <div className="file-tree-top-zone">
        <div className="file-tree-root-row">
          <FileTreeRootActions
            rootLabel={workspaceRootLabel}
            repositorySummary={rootRepositorySummary}
            onCreateFile={() => openNewFilePrompt("")}
            onCreateFolder={() => openNewFolderPrompt("")}
            onRefreshFiles={refreshFileTree}
            isSpecHubActive={isSpecHubActive}
            onOpenDetachedExplorer={onOpenDetachedExplorer}
            detachedInitialFilePath={detachedInitialFilePath}
            onOpenSpecHub={onOpenSpecHub}
            showSpecHubAction={showSpecHubAction}
            showDetachedExplorerAction={showDetachedExplorerAction}
            onRootContextMenu={rootRepositorySummary
              ? (event) => showContextMenu(event, "", true)
              : undefined}
          />
        </div>
      </div>
      <div
        ref={fileTreeListRef}
        className={`file-tree-list scrollable${shouldVirtualizeFileTree ? " is-virtualized" : ""}`}
        data-file-tree-row-count={visibleFileTreeRows.length}
      >
        {showLoading ? (
          <div className="file-tree-loading-row" role="status" aria-live="polite">
            <LoaderCircle className="file-tree-loading-spinner" size={13} aria-hidden />
            <span>{t("files.loadingFiles")}</span>
          </div>
        ) : normalizedLoadError && !hasTreeEntries ? (
          <FileTreeRefreshControls
            loadError={normalizedLoadError}
            canRefresh={Boolean(onRefreshFiles)}
            loadFailedLabel={t("files.loadFilesFailed")}
            retryLabel={t("files.retryLoadFiles")}
            onRefresh={refreshFileTree}
          />
        ) : !hasTreeEntries ? (
          <div className="file-tree-empty">
            {t("files.noFilesAvailable")}
          </div>
        ) : shouldVirtualizeFileTree ? (
          <div
            className="file-tree-virtual-spacer"
            style={{ height: `${fileTreeRowVirtualizer.getTotalSize()}px` }}
          >
            {fileTreeRowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = visibleFileTreeRows[virtualRow.index];
              if (!row) {
                return null;
              }
              return (
                <div
                  key={virtualRow.key}
                  ref={fileTreeRowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className="file-tree-virtual-row"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <FileTreeVirtualRow
                    row={row}
                    state={fileTreeRowState}
                    handlers={fileTreeRowHandlers}
                    refs={fileTreeRowRefs}
                    t={t}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          nodes.map((node) => (
            <FileTreeNodeBranch
              key={node.path}
              node={node}
              depth={1}
              state={fileTreeRowState}
              handlers={fileTreeRowHandlers}
              refs={fileTreeRowRefs}
              t={t}
            />
          ))
        )}
      </div>
      {previewPath && previewAnchor
        ? createPortal(
            <FilePreviewPopover
              path={previewPath}
              absolutePath={resolvePath(previewPath)}
              content={previewContent}
              truncated={previewTruncated}
              previewKind={previewKind}
              imageSrc={previewImageSrc}
              openTargets={openTargets}
              openAppIconById={openAppIconById}
              selectedOpenAppId={selectedOpenAppId}
              onSelectOpenAppId={onSelectOpenAppId}
              selection={previewSelection}
              onSelectLine={handleSelectLine}
              onLineMouseDown={handleLineMouseDown}
              onLineMouseEnter={handleLineMouseEnter}
              onLineMouseUp={handleLineMouseUp}
              onClearSelection={() => setPreviewSelection(null)}
              onAddSelection={handleAddSelection}
              onClose={closePreview}
              selectionHints={selectionHints}
              style={{
                position: "fixed",
                top: previewAnchor.top,
                left: previewAnchor.left,
                width: 640,
                maxHeight: previewAnchor.height,
                ["--file-preview-arrow-top" as string]: `${previewAnchor.arrowTop}px`,
              }}
              isLoading={previewLoading}
              error={previewError}
            />,
            document.body,
          )
        : null}
      {fileTreeContextMenu ? (
        <RendererContextMenu
          menu={fileTreeContextMenu}
          onClose={() => setFileTreeContextMenu(null)}
          className="renderer-context-menu file-tree-context-menu"
        />
      ) : null}
      {operationNotice ? (
        <div
          className={`file-tree-operation-notice is-${operationNotice.tone}`}
          role={operationNotice.tone === "error" ? "alert" : "status"}
        >
          {operationNotice.message}
        </div>
      ) : null}
      {renamePrompt !== null && (
        <FileTreeRenamePrompt
          prompt={renamePrompt}
          draftName={renameDraftName}
          inputRef={renameInputRef}
          t={t}
          onDraftNameChange={setRenameDraftName}
          onCancel={cancelRename}
          onConfirm={() => void confirmRename()}
        />
      )}
      {newFileParent !== null && (
        <FileTreeNewFilePrompt
          parent={newFileParent}
          name={newFileName}
          inputRef={newFileInputRef}
          t={t}
          onNameChange={setNewFileName}
          onCancel={cancelNewFile}
          onConfirm={() => void confirmNewFile()}
        />
      )}
      {newFolderParent !== null && (
        <FileTreeNewFolderPrompt
          parent={newFolderParent}
          name={newFolderName}
          inputRef={newFolderInputRef}
          t={t}
          onNameChange={setNewFolderName}
          onCancel={cancelNewFolder}
          onConfirm={() => void confirmNewFolder()}
        />
      )}
    </aside>
  );
}
