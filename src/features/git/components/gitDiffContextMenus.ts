import type { GitHubPullRequest, GitLogEntry } from "../../../types";
import type {
  Dispatch,
  MouseEvent as ReactMouseEvent,
  SetStateAction,
} from "react";
import { useCallback, useMemo } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { TFunction } from "i18next";
import { copyTextToClipboard } from "../../../utils/clipboard";
import type { DiffFile } from "./GitDiffPanelFileSections";
import { normalizeDiffPath } from "./GitDiffPanelInclusion";
import {
  clampRendererContextMenuPosition,
  estimateRendererContextMenuHeight,
  type RendererContextMenuItem,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";
import { buildGitDiffPanelFileContextMenuItems } from "./GitDiffPanelFileContextMenu";
import { resolveGitDiffFileHistoryTarget } from "./GitDiffPanelFileScope";
import { isFileMutationDisabled, type GitDiffSectionKey } from "./GitDiffPanel";
import type { GitDiffPanelProps } from "./GitDiffPanelTypes";

export type GitPanelContextMenuState = RendererContextMenuState & {
  source?: "git-diff-file";
};

type UseGitDiffContextMenusOptions = {
  t: TFunction;
  gitRemoteUrl: string | null;
  setGitContextMenu: Dispatch<SetStateAction<GitPanelContextMenuState | null>>;
  stagedFiles: DiffFile[];
  unstagedFiles: DiffFile[];
  selectedFiles: Set<string>;
  setSelectedFiles: Dispatch<SetStateAction<Set<string>>>;
  setLastClickedFile: Dispatch<SetStateAction<string | null>>;
  discardFiles: (paths: string[]) => Promise<void>;
  discardRepositoryFile: (
    repositoryRoot: string,
    path: string,
  ) => Promise<void>;
  workspaceId: string | null;
  workspacePath: string | null;
  gitRoot: string | null;
  repositoryStatuses: NonNullable<GitDiffPanelProps["repositoryStatuses"]>;
  onRevertFile: GitDiffPanelProps["onRevertFile"];
  onOpenFileHistory: GitDiffPanelProps["onOpenFileHistory"];
  onStageFile: GitDiffPanelProps["onStageFile"];
  onUnstageFile: GitDiffPanelProps["onUnstageFile"];
  onUnstageFiles: GitDiffPanelProps["onUnstageFiles"];
  onRefreshRepositoryStatuses: GitDiffPanelProps["onRefreshRepositoryStatuses"];
  onRevertRepositoryFile: GitDiffPanelProps["onRevertRepositoryFile"];
  onStageRepositoryFile: GitDiffPanelProps["onStageRepositoryFile"];
  onUnstageRepositoryFile: GitDiffPanelProps["onUnstageRepositoryFile"];
};

export function useGitDiffContextMenus({
  t,
  gitRemoteUrl,
  setGitContextMenu,
  stagedFiles,
  unstagedFiles,
  selectedFiles,
  setSelectedFiles,
  setLastClickedFile,
  discardFiles,
  discardRepositoryFile,
  workspaceId,
  workspacePath,
  gitRoot,
  repositoryStatuses,
  onRevertFile,
  onOpenFileHistory,
  onStageFile,
  onUnstageFile,
  onUnstageFiles,
  onRefreshRepositoryStatuses,
  onRevertRepositoryFile,
  onStageRepositoryFile,
  onUnstageRepositoryFile,
}: UseGitDiffContextMenusOptions) {
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
      const position = clampRendererContextMenuPosition(
        event.clientX,
        event.clientY,
        {
          width: 220,
          height: githubBaseUrl ? 120 : 80,
        },
      );
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
      const position = clampRendererContextMenuPosition(
        event.clientX,
        event.clientY,
        {
          width: 220,
          height: 80,
        },
      );
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
          mutationEnabled &&
          section === "staged" &&
          (onUnstageFiles || onUnstageFile)
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

      const position = clampRendererContextMenuPosition(
        event.clientX,
        event.clientY,
        {
          width: 260,
          height: estimateRendererContextMenuHeight(items),
        },
      );
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
                  await onUnstageRepositoryFile(
                    repositoryRoot,
                    targetFile.path,
                  );
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

      const position = clampRendererContextMenuPosition(
        event.clientX,
        event.clientY,
        {
          width: 260,
          height: estimateRendererContextMenuHeight(items),
        },
      );
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

  return {
    showLogMenu,
    showPullRequestMenu,
    showFileMenu,
    showRepositoryFileMenu,
  };
}
