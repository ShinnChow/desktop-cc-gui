import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { TFunction } from "i18next";
import { confirm } from "@tauri-apps/plugin-dialog";
import {
  createWorkspaceDirectory,
  duplicateWorkspaceItem,
  pasteWorkspaceItem,
  readWorkspaceFile,
  renameWorkspaceItem,
  trashWorkspaceItem,
  writeWorkspaceFile,
} from "../../../services/tauri";
import { copyTextToClipboard } from "../../../utils/clipboard";
import { pushErrorToast } from "../../../services/toasts";
import {
  formatOpenHtmlInBrowserError,
  openHtmlInBrowser,
} from "../utils/openHtmlInBrowser";
import {
  filterDeletedFileTreePathFromMap,
  filterDeletedFileTreePathFromSet,
  isSameOrDescendantFileTreePath,
} from "../components/fileTreePanelInternals";
import type {
  FileTreeOperationNotice,
  useFileTreeViewState,
} from "../components/useFileTreeViewState";

type FileTreeViewState = ReturnType<typeof useFileTreeViewState>;

function normalizeFileTreePath(path: string) {
  return path.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
}

export function useFileTreeItemOperations({
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
}: {
  viewState: FileTreeViewState;
  workspaceId: string;
  files: string[];
  directoryEntries: string[];
  workspaceRootLabel: string;
  visibleTreePathOrder: string[];
  visibleTreePathTypeMap: Map<string, "file" | "folder" | "root">;
  resolvePath: (relativePath: string) => string;
  setManuallyCollapsedAutoExpandedFolders: Dispatch<SetStateAction<Set<string>>>;
  onRefreshFiles?: () => void;
  t: TFunction;
}) {
  const {
    closePreview,
    fileTreeClipboardItem,
    lazyDirectories,
    lazyFiles,
    loadedLazyDirectoriesRef,
    loadingLazyDirectoriesRef,
    newFileInputRef,
    newFileName,
    newFileParent,
    newFolderInputRef,
    newFolderName,
    newFolderParent,
    panelRef,
    previewPath,
    refreshFileTree,
    renameDraftName,
    renameInputRef,
    renamePrompt,
    selectedNodePath,
    selectedNodeType,
    selectionAnchorPathRef,
    setExpandedFolders,
    setFileTreeClipboardItem,
    setLazyDirectories,
    setLazyDirectoryLoadErrors,
    setLazyDirectoryMetadata,
    setLazyFiles,
    setLazyGitignoredDirectories,
    setLazyGitignoredFiles,
    setLazyLoadableDirectories,
    setLoadedLazyDirectories,
    setLoadingLazyDirectories,
    setNewFileName,
    setNewFileParent,
    setNewFolderName,
    setNewFolderParent,
    setOperationNotice,
    setRenameDraftName,
    setRenamePrompt,
    setSelectedNodePath,
    setSelectedNodePaths,
    setSelectedNodeType,
    setSuppressedDeletedPaths,
  } = viewState;

  const resolveFileTreeParentPath = useCallback((relativePath: string) => {
    const normalized = normalizeFileTreePath(relativePath);
    const separatorIndex = normalized.lastIndexOf("/");
    return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : "";
  }, []);

  const revealOptimisticFileTreePath = useCallback(
    (relativePath: string, kind: "file" | "folder") => {
      const normalized = normalizeFileTreePath(relativePath);
      if (!normalized) {
        return;
      }
      const parentPath = resolveFileTreeParentPath(normalized);
      if (parentPath) {
        setManuallyCollapsedAutoExpandedFolders((prev) => {
          if (!prev.has(parentPath)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(parentPath);
          return next;
        });
        setExpandedFolders((prev) => {
          if (prev.has(parentPath)) {
            return prev;
          }
          return new Set(prev).add(parentPath);
        });
      }
      setSuppressedDeletedPaths((prev) => {
        if (!prev.has(normalized)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(normalized);
        return next;
      });
      if (kind === "folder") {
        setLazyDirectories((prev) => {
          if (prev.has(normalized)) {
            return prev;
          }
          return new Set(prev).add(normalized);
        });
        setLazyDirectoryMetadata((prev) => {
          const next = new Map(prev);
          next.set(normalized, { path: normalized, child_state: "empty" });
          return next;
        });
      } else {
        setLazyFiles((prev) => {
          if (prev.has(normalized)) {
            return prev;
          }
          return new Set(prev).add(normalized);
        });
      }
      if (parentPath) {
        setLazyDirectoryMetadata((prev) => {
          const next = new Map(prev);
          next.set(parentPath, { path: parentPath, child_state: "loaded" });
          return next;
        });
      }
      setSelectedNodePath(normalized);
      setSelectedNodeType(kind);
      setSelectedNodePaths(new Set([normalized]));
      selectionAnchorPathRef.current = normalized;
    },
    [
      resolveFileTreeParentPath,
      selectionAnchorPathRef,
      setExpandedFolders,
      setManuallyCollapsedAutoExpandedFolders,
      setLazyDirectories,
      setLazyDirectoryMetadata,
      setLazyFiles,
      setSelectedNodePath,
      setSelectedNodePaths,
      setSelectedNodeType,
      setSuppressedDeletedPaths,
    ],
  );

  const copyPath = useCallback(
    async (relativePath: string) => {
      await copyTextToClipboard(resolvePath(relativePath));
    },
    [resolvePath],
  );

  const normalizeOperationError = useCallback((error: unknown) => {
    return error instanceof Error ? error.message : String(error);
  }, []);

  const showOperationNotice = useCallback((tone: FileTreeOperationNotice["tone"], message: string) => {
    setOperationNotice({
      id: `${Date.now()}-${tone}`,
      tone,
      message,
    });
  }, [setOperationNotice]);

  const openHtmlFileInBuiltInBrowser = useCallback(
    (relativePath: string) => {
      if (!workspaceId?.trim()) {
        pushErrorToast({
          title: t("files.openInBrowser"),
          message: t("files.openInBrowserNoWorkspace"),
        });
        return;
      }
      void openHtmlInBrowser(resolvePath(relativePath), {
        workspaceId,
        ownerSurface: "file-tree",
      }).catch((error) => {
        console.warn("[file-tree] openHtmlInBrowser failed", error);
        pushErrorToast({
          title: t("files.openInBrowser"),
          message: formatOpenHtmlInBrowserError(error, t),
        });
      });
    },
    [resolvePath, t, workspaceId],
  );

  useEffect(() => {
    setSuppressedDeletedPaths((prev) => {
      if (prev.size === 0) {
        return prev;
      }
      let changed = false;
      const next = new Set(prev);
      prev.forEach((deletedPath) => {
        const stillPresent =
          files.some((path) => isSameOrDescendantFileTreePath(path, deletedPath)) ||
          directoryEntries.some((path) => isSameOrDescendantFileTreePath(path, deletedPath)) ||
          Array.from(lazyFiles).some((path) => isSameOrDescendantFileTreePath(path, deletedPath)) ||
          Array.from(lazyDirectories).some((path) =>
            isSameOrDescendantFileTreePath(path, deletedPath),
          );
        if (!stillPresent) {
          next.delete(deletedPath);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [
    directoryEntries,
    files,
    lazyDirectories,
    lazyFiles,
    setSuppressedDeletedPaths,
  ]);

  const purgeDeletedFileTreePath = useCallback(
    (deletedPath: string) => {
      setSuppressedDeletedPaths((prev) => {
        if (prev.has(deletedPath)) {
          return prev;
        }
        return new Set(prev).add(deletedPath);
      });
      setExpandedFolders((prev) => filterDeletedFileTreePathFromSet(prev, deletedPath));
      setLazyFiles((prev) => filterDeletedFileTreePathFromSet(prev, deletedPath));
      setLazyDirectories((prev) => filterDeletedFileTreePathFromSet(prev, deletedPath));
      setLazyGitignoredFiles((prev) => filterDeletedFileTreePathFromSet(prev, deletedPath));
      setLazyGitignoredDirectories((prev) => filterDeletedFileTreePathFromSet(prev, deletedPath));
      setLazyLoadableDirectories((prev) => filterDeletedFileTreePathFromSet(prev, deletedPath));
      setLazyDirectoryMetadata((prev) => filterDeletedFileTreePathFromMap(prev, deletedPath));
      setLoadedLazyDirectories((prev) => filterDeletedFileTreePathFromSet(prev, deletedPath));
      setLoadingLazyDirectories((prev) => filterDeletedFileTreePathFromSet(prev, deletedPath));
      setLazyDirectoryLoadErrors((prev) => filterDeletedFileTreePathFromMap(prev, deletedPath));
      loadedLazyDirectoriesRef.current = filterDeletedFileTreePathFromSet(
        loadedLazyDirectoriesRef.current,
        deletedPath,
      );
      loadingLazyDirectoriesRef.current = filterDeletedFileTreePathFromSet(
        loadingLazyDirectoriesRef.current,
        deletedPath,
      );
      setSelectedNodePaths((prev) => {
        const next = filterDeletedFileTreePathFromSet(prev, deletedPath);
        if (next === prev) {
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
        if (
          selectionAnchorPathRef.current &&
          isSameOrDescendantFileTreePath(selectionAnchorPathRef.current, deletedPath)
        ) {
          selectionAnchorPathRef.current = nextPrimaryPath;
        }
        return next;
      });
      setFileTreeClipboardItem((prev) =>
        prev && isSameOrDescendantFileTreePath(prev.path, deletedPath) ? null : prev,
      );
      setRenamePrompt((prev) =>
        prev && isSameOrDescendantFileTreePath(prev.path, deletedPath) ? null : prev,
      );
      setNewFileParent((prev) =>
        prev && isSameOrDescendantFileTreePath(prev, deletedPath) ? null : prev,
      );
      setNewFolderParent((prev) =>
        prev && isSameOrDescendantFileTreePath(prev, deletedPath) ? null : prev,
      );
      if (previewPath && isSameOrDescendantFileTreePath(previewPath, deletedPath)) {
        closePreview();
      }
    },
    [
      closePreview,
      loadedLazyDirectoriesRef,
      loadingLazyDirectoriesRef,
      previewPath,
      selectedNodePath,
      selectionAnchorPathRef,
      setExpandedFolders,
      setFileTreeClipboardItem,
      setLazyDirectories,
      setLazyDirectoryLoadErrors,
      setLazyDirectoryMetadata,
      setLazyFiles,
      setLazyGitignoredDirectories,
      setLazyGitignoredFiles,
      setLazyLoadableDirectories,
      setLoadedLazyDirectories,
      setLoadingLazyDirectories,
      setNewFileParent,
      setNewFolderParent,
      setRenamePrompt,
      setSelectedNodePath,
      setSelectedNodePaths,
      setSelectedNodeType,
      setSuppressedDeletedPaths,
      visibleTreePathOrder,
      visibleTreePathTypeMap,
    ],
  );

  const trashItem = useCallback(
    async (relativePath: string, isFolder: boolean) => {
      const name = relativePath.split("/").pop() ?? relativePath;
      const confirmMessage = isFolder
        ? t("files.deleteFolderConfirm", { name })
        : t("files.deleteFileConfirm", { name });

      const confirmed = await confirm(confirmMessage, {
        title: t("files.deleteItem"),
        kind: "warning",
        okLabel: t("files.deleteItem"),
        cancelLabel: t("files.cancel"),
      });

      if (!confirmed) {
        return;
      }

      try {
        await trashWorkspaceItem(workspaceId, relativePath);
        purgeDeletedFileTreePath(relativePath);
        showOperationNotice("success", t("files.trashComplete"));
        refreshFileTree();
      } catch (error) {
        showOperationNotice("error", t("files.trashFailed", { message: normalizeOperationError(error) }));
      }
    },
    [
      normalizeOperationError,
      purgeDeletedFileTreePath,
      refreshFileTree,
      showOperationNotice,
      t,
      workspaceId,
    ],
  );

  const getFileTreeItemName = useCallback((relativePath: string) => {
    if (!relativePath) {
      return workspaceRootLabel;
    }
    return relativePath.split("/").filter(Boolean).pop() ?? relativePath;
  }, [workspaceRootLabel]);

  const copyFileTreeItem = useCallback(
    (relativePath: string, kind: "file" | "folder") => {
      setFileTreeClipboardItem({
        workspaceId,
        path: relativePath,
        kind,
        name: getFileTreeItemName(relativePath),
      });
      showOperationNotice("info", t("files.copyReady"));
    },
    [
      getFileTreeItemName,
      setFileTreeClipboardItem,
      showOperationNotice,
      t,
      workspaceId,
    ],
  );

  const pasteFileTreeItem = useCallback(
    async (targetDirectory: string) => {
      if (!fileTreeClipboardItem) {
        showOperationNotice("error", t("files.pasteUnavailable"));
        return;
      }
      if (fileTreeClipboardItem.workspaceId !== workspaceId) {
        showOperationNotice("error", t("files.pasteWorkspaceMismatch"));
        return;
      }
      try {
        const result = await pasteWorkspaceItem(
          workspaceId,
          fileTreeClipboardItem.path,
          targetDirectory,
        );
        revealOptimisticFileTreePath(result.path, result.kind);
        showOperationNotice("success", t("files.pasteComplete"));
        onRefreshFiles?.();
      } catch (error) {
        showOperationNotice("error", t("files.pasteFailed", { message: normalizeOperationError(error) }));
      }
    },
    [
      fileTreeClipboardItem,
      normalizeOperationError,
      onRefreshFiles,
      revealOptimisticFileTreePath,
      showOperationNotice,
      t,
      workspaceId,
    ],
  );

  const duplicateItem = useCallback(
    async (relativePath: string) => {
      try {
        const result = await duplicateWorkspaceItem(workspaceId, relativePath);
        revealOptimisticFileTreePath(result.path, result.kind);
        showOperationNotice("success", t("files.duplicateComplete"));
        onRefreshFiles?.();
      } catch (error) {
        showOperationNotice("error", t("files.duplicateFailed", { message: normalizeOperationError(error) }));
      }
    },
    [
      normalizeOperationError,
      revealOptimisticFileTreePath,
      onRefreshFiles,
      showOperationNotice,
      t,
      workspaceId,
    ],
  );

  const openRenamePrompt = useCallback(
    (relativePath: string, kind: "file" | "folder") => {
      const currentName = getFileTreeItemName(relativePath);
      setRenamePrompt({
        path: relativePath,
        kind,
        currentName,
      });
      setRenameDraftName(currentName);
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    },
    [
      getFileTreeItemName,
      renameInputRef,
      setRenameDraftName,
      setRenamePrompt,
    ],
  );

  const cancelRename = useCallback(() => {
    setRenamePrompt(null);
    setRenameDraftName("");
  }, [setRenameDraftName, setRenamePrompt]);

  const confirmRename = useCallback(async () => {
    const prompt = renamePrompt;
    const name = renameDraftName.trim();
    if (!prompt || !name) {
      showOperationNotice("error", t("files.renameInvalidName"));
      return;
    }
    try {
      const result = await renameWorkspaceItem(workspaceId, prompt.path, name);
      purgeDeletedFileTreePath(prompt.path);
      revealOptimisticFileTreePath(result.path, result.kind);
      setRenamePrompt(null);
      setRenameDraftName("");
      showOperationNotice("success", t("files.renameComplete"));
      onRefreshFiles?.();
    } catch (error) {
      showOperationNotice("error", t("files.renameFailed", { message: normalizeOperationError(error) }));
    }
  }, [
    normalizeOperationError,
    onRefreshFiles,
    purgeDeletedFileTreePath,
    revealOptimisticFileTreePath,
    renameDraftName,
    renamePrompt,
    setRenameDraftName,
    setRenamePrompt,
    showOperationNotice,
    t,
    workspaceId,
  ]);

  const openNewFilePrompt = useCallback(
    (parentFolder: string) => {
      setNewFileParent(parentFolder);
      setNewFileName("");
      requestAnimationFrame(() => {
        newFileInputRef.current?.focus();
      });
    },
    [newFileInputRef, setNewFileName, setNewFileParent],
  );

  const confirmNewFile = useCallback(async () => {
    const name = newFileName.trim();
    if (!name || newFileParent === null) {
      setNewFileParent(null);
      setNewFileName("");
      return;
    }
    const relativePath = newFileParent ? `${newFileParent}/${name}` : name;
    try {
      await writeWorkspaceFile(workspaceId, relativePath, "");
      revealOptimisticFileTreePath(relativePath, "file");
      showOperationNotice("success", t("files.createFileComplete"));
      onRefreshFiles?.();
    } catch (error) {
      showOperationNotice("error", t("files.createFileFailed", { message: normalizeOperationError(error) }));
    }
    setNewFileParent(null);
    setNewFileName("");
  }, [
    newFileName,
    newFileParent,
    workspaceId,
    revealOptimisticFileTreePath,
    onRefreshFiles,
    showOperationNotice,
    setNewFileName,
    setNewFileParent,
    t,
    normalizeOperationError,
  ]);

  const cancelNewFile = useCallback(() => {
    setNewFileParent(null);
    setNewFileName("");
  }, [setNewFileName, setNewFileParent]);

  const openNewFolderPrompt = useCallback(
    (parentFolder: string) => {
      setNewFolderParent(parentFolder);
      setNewFolderName("");
      requestAnimationFrame(() => {
        newFolderInputRef.current?.focus();
      });
    },
    [newFolderInputRef, setNewFolderName, setNewFolderParent],
  );

  const confirmNewFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || newFolderParent === null) {
      setNewFolderParent(null);
      setNewFolderName("");
      return;
    }
    const relativePath = newFolderParent ? `${newFolderParent}/${name}` : name;
    try {
      await createWorkspaceDirectory(workspaceId, relativePath);
      revealOptimisticFileTreePath(relativePath, "folder");
      showOperationNotice("success", t("files.createFolderComplete"));
      onRefreshFiles?.();
    } catch (error) {
      showOperationNotice("error", t("files.createFolderFailed", { message: normalizeOperationError(error) }));
    }
    setNewFolderParent(null);
    setNewFolderName("");
  }, [
    newFolderName,
    newFolderParent,
    workspaceId,
    revealOptimisticFileTreePath,
    onRefreshFiles,
    showOperationNotice,
    setNewFolderName,
    setNewFolderParent,
    t,
    normalizeOperationError,
  ]);

  const cancelNewFolder = useCallback(() => {
    setNewFolderParent(null);
    setNewFolderName("");
  }, [setNewFolderName, setNewFolderParent]);

  const resolveParentFolderForNode = useCallback(
    (relativePath: string | null, nodeType: "file" | "folder" | null) => {
      if (!relativePath) {
        return "";
      }
      if (nodeType === "folder") {
        return relativePath;
      }
      const separatorIndex = relativePath.lastIndexOf("/");
      return separatorIndex >= 0 ? relativePath.slice(0, separatorIndex) : "";
    },
    [],
  );

  const addRepositoryToGitignore = useCallback(
    async (repositoryRoot: string) => {
      if (!repositoryRoot) return;
      const ignorePath = ".gitignore";
      try {
        const existingContent = files.includes(ignorePath)
          ? (await readWorkspaceFile(workspaceId, ignorePath)).content
          : "";
        const normalizedRoot = repositoryRoot.replaceAll("\\", "/").replace(/\/+$/, "");
        const ignoreEntry = `${normalizedRoot}/`;
        const existingEntries = new Set(
          existingContent.split(/\r?\n/).map((line) => line.trim()),
        );
        if (existingEntries.has(normalizedRoot) || existingEntries.has(ignoreEntry)) {
          showOperationNotice(
            "info",
            t("git.repositoryMenuGitignoreExists", { path: ignoreEntry }),
          );
          return;
        }
        const separator = existingContent.length > 0 && !existingContent.endsWith("\n") ? "\n" : "";
        await writeWorkspaceFile(
          workspaceId,
          ignorePath,
          `${existingContent}${separator}${ignoreEntry}\n`,
        );
        refreshFileTree();
        showOperationNotice(
          "success",
          t("git.repositoryMenuGitignoreAdded", { path: ignoreEntry }),
        );
      } catch (caughtError) {
        showOperationNotice(
          "error",
          t("git.repositoryMenuGitignoreFailed", {
            error: normalizeOperationError(caughtError),
          }),
        );
      }
    },
    [
      files,
      normalizeOperationError,
      refreshFileTree,
      showOperationNotice,
      t,
      workspaceId,
    ],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!selectedNodePath || !selectedNodeType) {
        return;
      }
      const target = event.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
        return;
      }
      // Ensure the event originates within the file tree panel
      if (panelRef.current && !panelRef.current.contains(target)) {
        return;
      }

      const isMac = navigator.platform.includes("Mac");
      const primaryModifier = isMac ? event.metaKey : event.ctrlKey;

      // Cmd+Delete / Ctrl+Delete → trash
      if (primaryModifier && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        void trashItem(selectedNodePath, selectedNodeType === "folder");
        return;
      }

      // Cmd+C / Ctrl+C → copy path
      if (primaryModifier && !event.shiftKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void copyPath(selectedNodePath);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [copyPath, panelRef, selectedNodePath, selectedNodeType, trashItem]);

  return {
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
  };
}
