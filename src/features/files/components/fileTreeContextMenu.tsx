import type {
  Dispatch,
  MouseEvent,
  SetStateAction,
} from "react";
import type { TFunction } from "i18next";
import FilePlus from "lucide-react/dist/esm/icons/file-plus";
import FolderPlus from "lucide-react/dist/esm/icons/folder-plus";
import Copy from "lucide-react/dist/esm/icons/copy";
import ClipboardPaste from "lucide-react/dist/esm/icons/clipboard-paste";
import CopyPlus from "lucide-react/dist/esm/icons/copy-plus";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Link2 from "lucide-react/dist/esm/icons/link-2";
import MessageSquarePlus from "lucide-react/dist/esm/icons/message-square-plus";
import Columns2 from "lucide-react/dist/esm/icons/columns-2";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import History from "lucide-react/dist/esm/icons/history";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import Upload from "lucide-react/dist/esm/icons/upload";
import Download from "lucide-react/dist/esm/icons/download";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import FileMinus from "lucide-react/dist/esm/icons/file-minus";
import Layers from "lucide-react/dist/esm/icons/layers";
import Code from "lucide-react/dist/esm/icons/code";
import ListTree from "lucide-react/dist/esm/icons/list-tree";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Repeat from "lucide-react/dist/esm/icons/repeat";
import Globe from "lucide-react/dist/esm/icons/globe";
import { revealInFileManager } from "../../../services/tauri";
import type { GitRepositorySummary } from "../../../types";
import type {
  GitRepositoryActionId,
  GitRepositoryActionRequest,
} from "../../git/types/gitRepositoryActions";
import { resolveFileGitScope } from "../utils/fileGitScope";
import type { FileHistoryTarget } from "../../git-history/types";
import { FILE_COMPARE_MAX_WORKSPACE_FILES } from "../types/fileCompare";
import { isHtmlFilePath } from "../utils/openHtmlInBrowser";
import {
  type RendererContextMenuItem,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";
import type { FileTreeOperationNotice } from "./useFileTreeViewState";

export type FileTreeContextMenuDeps = {
  addRepositoryToGitignore: (repositoryRoot: string) => Promise<void>;
  copyFileTreeItem: (relativePath: string, kind: "file" | "folder") => void;
  copyPath: (relativePath: string) => Promise<void>;
  duplicateItem: (relativePath: string) => Promise<void>;
  event: MouseEvent<HTMLElement>;
  gitRepositories: GitRepositorySummary[];
  isFolder: boolean;
  normalizeOperationError: (error: unknown) => string;
  onCompareFiles?: (paths: string[]) => boolean;
  onGitRepositoryAction?: (
    request: GitRepositoryActionRequest,
  ) => void | Promise<void>;
  onInsertText?: (text: string) => void;
  onOpenFileHistory?: (target: FileHistoryTarget) => void;
  openHtmlFileInBuiltInBrowser: (relativePath: string) => void;
  openNewFilePrompt: (parentFolder: string) => void;
  openNewFolderPrompt: (parentFolder: string) => void;
  openRenamePrompt: (relativePath: string, kind: "file" | "folder") => void;
  orderedSelectedNodePaths: string[];
  pasteFileTreeItem: (targetDirectory: string) => Promise<void>;
  relativePath: string;
  repositorySummaryMap: Map<string, GitRepositorySummary>;
  resolveParentFolderForNode: (
    relativePath: string | null,
    nodeType: "file" | "folder" | null,
  ) => string;
  resolvePath: (relativePath: string) => string;
  revealInOsLabel: string;
  rootRepositorySummary: GitRepositorySummary | null;
  selectedNodePaths: Set<string>;
  setFileTreeContextMenu: Dispatch<SetStateAction<RendererContextMenuState | null>>;
  showOperationNotice: (tone: FileTreeOperationNotice["tone"], message: string) => void;
  t: TFunction;
  trashItem: (relativePath: string, isFolder: boolean) => Promise<void>;
  visibleTreePathTypeMap: Map<string, "file" | "folder" | "root">;
  workspaceId: string;
  workspacePath: string;
};

export function showFileTreeContextMenu({
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
}: FileTreeContextMenuDeps) {
  event.preventDefault();
  event.stopPropagation();

  const parentFolder = resolveParentFolderForNode(relativePath, isFolder ? "folder" : "file");
  const isRootActionTarget = relativePath.length === 0;
  const itemKind = isFolder ? "folder" : "file";
  const repositorySummary = isFolder
    ? relativePath.length === 0
      ? rootRepositorySummary
      : repositorySummaryMap.get(relativePath) ?? null
    : null;
  const fileHistoryScope = !isFolder && onOpenFileHistory
    ? resolveFileGitScope(relativePath, gitRepositories)
    : null;
  const fileHistoryRepository = fileHistoryScope
    ? gitRepositories.find(
        (repository) => repository.repositoryRoot.replace(/\\/g, "/") === fileHistoryScope.repositoryRoot,
      ) ?? null
    : null;
  const effectiveSelectedPaths = selectedNodePaths.has(relativePath)
    ? orderedSelectedNodePaths
    : isRootActionTarget
      ? []
      : [relativePath];
  const selectedFilePaths = effectiveSelectedPaths.filter(
    (path) => visibleTreePathTypeMap.get(path) === "file",
  );
  const shouldShowCompareAction =
    Boolean(onCompareFiles) &&
    selectedFilePaths.length >= 2 &&
    selectedFilePaths.length <= FILE_COMPARE_MAX_WORKSPACE_FILES;
  if (onCompareFiles && selectedFilePaths.length > FILE_COMPARE_MAX_WORKSPACE_FILES) {
    showOperationNotice(
      "error",
      t("files.fileCompare.tooManyFiles", {
        count: selectedFilePaths.length,
        limit: FILE_COMPARE_MAX_WORKSPACE_FILES,
      }),
    );
  }

  const runRepositoryAction = async (
    action: Exclude<GitRepositoryActionId, "update">,
  ) => {
    if (!repositorySummary) return;
    if (action === "add-to-gitignore") {
      await addRepositoryToGitignore(repositorySummary.repositoryRoot);
      return;
    }
    await onGitRepositoryAction?.({
      action,
      repositoryRoot: repositorySummary.repositoryRoot,
    });
  };
  const canUpdateRepository =
    repositorySummary?.headState === "branch" &&
    Boolean(repositorySummary.currentBranch) &&
    !repositorySummary.error;
  const runRepositoryUpdate = async () => {
    if (!repositorySummary || !canUpdateRepository || !repositorySummary.currentBranch) {
      return;
    }
    await onGitRepositoryAction?.({
      action: "update",
      repositoryRoot: repositorySummary.repositoryRoot,
      branchName: repositorySummary.currentBranch,
    });
  };
  const menuIcon = (Icon: typeof FilePlus) => <Icon size={15} aria-hidden />;
  const repositoryGitItems = repositorySummary
    ? [
        { type: "label" as const, id: "git-target", label: repositorySummary.displayName },
        {
          type: "item" as const,
          id: "git-commit",
          label: t("git.repositoryMenuCommit"),
          icon: menuIcon(GitCommitHorizontal),
          onSelect: () => runRepositoryAction("commit"),
        },
        {
          type: "item" as const,
          id: "git-stage-all",
          label: t("git.repositoryMenuStageAll"),
          icon: menuIcon(Layers),
          onSelect: () => runRepositoryAction("stage-all"),
        },
        {
          type: "item" as const,
          id: "git-ignore",
          label: t("git.repositoryMenuAddToGitignore"),
          icon: menuIcon(FileMinus),
          disabled: repositorySummary.repositoryRoot.length === 0,
          onSelect: () => runRepositoryAction("add-to-gitignore"),
        },
        { type: "separator" as const, id: "git-separator-diff" },
        {
          type: "item" as const,
          id: "git-update",
          label: t("git.historyBranchMenuUpdate"),
          icon: menuIcon(Repeat),
          disabled: !canUpdateRepository,
          onSelect: runRepositoryUpdate,
        },
        {
          type: "item" as const,
          id: "git-history",
          label: t("git.repositoryMenuHistory"),
          icon: menuIcon(History),
          onSelect: () => runRepositoryAction("show-history"),
        },
        { type: "separator" as const, id: "git-separator-remote" },
        {
          type: "item" as const,
          id: "git-push",
          label: t("git.repositoryMenuPush"),
          icon: menuIcon(Upload),
          onSelect: () => runRepositoryAction("push"),
        },
        {
          type: "item" as const,
          id: "git-pull",
          label: t("git.repositoryMenuPull"),
          icon: menuIcon(Download),
          onSelect: () => runRepositoryAction("pull"),
        },
        {
          type: "item" as const,
          id: "git-fetch",
          label: t("git.repositoryMenuFetch"),
          icon: menuIcon(RefreshCw),
          onSelect: () => runRepositoryAction("fetch"),
        },
      ]
    : [];
  const fileHistoryGitItems = fileHistoryScope
    ? [
        ...(fileHistoryRepository
          ? [{ type: "label" as const, id: "git-file-target", label: fileHistoryRepository.displayName }]
          : []),
        {
          type: "item" as const,
          id: "git-file-history",
          label: t("git.repositoryMenuFileHistory"),
          icon: menuIcon(History),
          onSelect: () => onOpenFileHistory?.({
            workspaceId,
            workspacePath,
            repositoryRoot: fileHistoryScope.repositoryRoot,
            path: fileHistoryScope.path,
            displayPath: relativePath,
          }),
        },
      ]
    : [];
  const gitItems = repositoryGitItems.length > 0
    ? repositoryGitItems
    : fileHistoryGitItems;

  const menuItems: RendererContextMenuItem[] = [
    {
      type: "item",
      id: "new-file",
      label: t("files.newFile"),
      icon: menuIcon(FilePlus),
      onSelect: () => {
        setFileTreeContextMenu(null);
        openNewFilePrompt(parentFolder);
      },
    },
    {
      type: "item",
      id: "new-folder",
      label: t("files.newFolder"),
      icon: menuIcon(FolderPlus),
      onSelect: () => {
        setFileTreeContextMenu(null);
        openNewFolderPrompt(parentFolder);
      },
    },
    ...(isRootActionTarget
      ? []
      : [
          {
            type: "item" as const,
            id: "copy-item",
            label: t("files.copyItem"),
            icon: menuIcon(Copy),
            onSelect: () => {
              setFileTreeContextMenu(null);
              copyFileTreeItem(relativePath, itemKind);
            },
          },
        ]),
    {
      type: "item",
      id: "paste-item",
      label: t("files.pasteItem"),
      icon: menuIcon(ClipboardPaste),
      onSelect: async () => {
        setFileTreeContextMenu(null);
        await pasteFileTreeItem(parentFolder);
      },
    },
    ...(isRootActionTarget
      ? []
      : [
          {
            type: "item" as const,
            id: "duplicate",
            label: t("files.duplicateItem"),
            icon: menuIcon(CopyPlus),
            onSelect: async () => {
              await duplicateItem(relativePath);
            },
          },
          {
            type: "item" as const,
            id: "rename",
            label: t("files.renameItem"),
            icon: menuIcon(Pencil),
            onSelect: () => {
              setFileTreeContextMenu(null);
              openRenamePrompt(relativePath, itemKind);
            },
          },
        ]),
    {
      type: "item",
      id: "copy-path",
      label: t("files.copyPath"),
      icon: menuIcon(Link2),
      onSelect: async () => {
        await copyPath(relativePath);
      },
    },
    ...(isRootActionTarget
      ? []
      : [
          {
            type: "item" as const,
            id: "send-path-to-composer",
            label: t("files.sendPathToComposer"),
            icon: menuIcon(MessageSquarePlus),
            onSelect: () => {
              setFileTreeContextMenu(null);
              const absolutePath = resolvePath(relativePath);
              if (typeof window !== "undefined" && window.handleFilePathFromJava) {
                window.handleFilePathFromJava(absolutePath);
                return;
              }
              onInsertText?.(`@${absolutePath}${isFolder ? "" : " "}`);
            },
          },
        ]),
    ...(shouldShowCompareAction
      ? [
          {
            type: "item" as const,
            id: "compare-files",
            label: t("files.fileCompare.compareSelected"),
            icon: menuIcon(Columns2),
            onSelect: () => {
              setFileTreeContextMenu(null);
              onCompareFiles?.(selectedFilePaths);
            },
          },
        ]
      : []),
    {
      type: "item",
      id: "reveal",
      label: revealInOsLabel,
      icon: menuIcon(FolderOpen),
      onSelect: async () => {
        const absolutePath = resolvePath(relativePath);
        try {
          await revealInFileManager(absolutePath);
        } catch (error) {
          showOperationNotice(
            "error",
            t("files.revealFailed", {
              message: normalizeOperationError(error),
            }),
          );
        }
      },
    },
    ...(!isFolder && isHtmlFilePath(relativePath)
      ? [
          {
            type: "item" as const,
            id: "open-in-browser",
            label: t("files.openInBrowser"),
            icon: menuIcon(Globe),
            onSelect: () => {
              setFileTreeContextMenu(null);
              openHtmlFileInBuiltInBrowser(relativePath);
            },
          },
        ]
      : []),
    ...(gitItems.length > 0
      ? [
          { type: "separator" as const, id: "git-repository-separator" },
          {
            type: "submenu" as const,
            id: "git-repository",
            label: t("git.repositoryMenuTitle"),
            icon: menuIcon(GitBranch),
            items: gitItems,
          },
        ]
      : []),
    ...(onInsertText && !isFolder
      ? [
          {
            type: "item" as const,
            id: "insert-lsp-diagnostics",
            label: t("files.insertLspDiagnostics"),
            icon: menuIcon(Code),
            onSelect: () => {
              onInsertText(`/lsp diagnostics "${relativePath}"`);
            },
          },
          {
            type: "item" as const,
            id: "insert-lsp-document-symbols",
            label: t("files.insertLspDocumentSymbols"),
            icon: menuIcon(ListTree),
            onSelect: () => {
              onInsertText(`/lsp document-symbols "${relativePath}"`);
            },
          },
        ]
      : []),
    ...(isRootActionTarget
      ? []
      : [
          { type: "separator" as const, id: "delete-separator" },
          {
            type: "item" as const,
            id: "delete",
            label: t("files.deleteItem"),
            icon: menuIcon(Trash2),
            tone: "danger" as const,
            onSelect: async () => {
              setFileTreeContextMenu(null);
              await trashItem(relativePath, isFolder);
            },
          },
        ]),
  ];

  // Anchor to the click position. RendererContextMenu re-clamps with measured size
  // after layout so the menu stays near the cursor without jumping far above.
  setFileTreeContextMenu({
    x: event.clientX,
    y: event.clientY,
    label: t("files.fileActions"),
    items: menuItems,
  });
}
