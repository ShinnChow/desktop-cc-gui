import { useCallback } from "react";
import {
  revertGitFile,
  revertGitPaths,
  stageGitAll,
  stageGitFile,
  unstageGitAll,
  unstageGitFile,
  unstageGitPaths,
} from "../../services/tauri/git";
import type { WorkspaceInfo } from "../../types";

export type GitSurfaceRepositoryActionsHostOptions = {
  activeWorkspace: Pick<WorkspaceInfo, "id"> | null | undefined;
};

/**
 * S4 PR-B：gitSurface 多仓库 stage / unstage / revert 纯数据 host（无 UI）。
 *
 * 职责：把 multi-repo 面板的 7 个仓库级 git 动作从根 composition 收编到
 * 可单测的 host；handler 只读 `activeWorkspace.id`，因此以 workspaceId 为
 * 依赖保持引用稳定（同 id 换对象身份不再引起 handler 换引用）。
 *
 * 不负责：单仓库 diff/status 轮询、commit/push 流程（useGitCommitController）。
 */
export function useGitSurfaceRepositoryActionsHost({
  activeWorkspace,
}: GitSurfaceRepositoryActionsHostOptions) {
  const workspaceId = activeWorkspace?.id ?? null;

  const handleStageRepositoryFile = useCallback(
    async (repositoryRoot: string, path: string) => {
      if (!workspaceId) return;
      await stageGitFile(workspaceId, path, repositoryRoot);
    },
    [workspaceId],
  );
  const handleUnstageRepositoryFile = useCallback(
    async (repositoryRoot: string, path: string) => {
      if (!workspaceId) return;
      await unstageGitFile(workspaceId, path, repositoryRoot);
    },
    [workspaceId],
  );
  const handleUnstageRepositoryAll = useCallback(
    async (repositoryRoot: string) => {
      if (!workspaceId) return;
      await unstageGitAll(workspaceId, repositoryRoot);
    },
    [workspaceId],
  );
  const handleUnstageRepositoryFiles = useCallback(
    async (repositoryRoot: string, paths: string[]) => {
      if (!workspaceId || paths.length === 0) return;
      if (paths.length === 1) {
        await unstageGitFile(workspaceId, paths[0]!, repositoryRoot);
        return;
      }
      await unstageGitPaths(workspaceId, paths, repositoryRoot);
    },
    [workspaceId],
  );
  const handleRevertRepositoryFile = useCallback(
    async (repositoryRoot: string, path: string) => {
      if (!workspaceId) return;
      await revertGitFile(workspaceId, path, repositoryRoot);
    },
    [workspaceId],
  );
  const handleRevertRepositoryFiles = useCallback(
    async (repositoryRoot: string, paths: string[]) => {
      if (!workspaceId || paths.length === 0) return;
      if (paths.length === 1) {
        await revertGitFile(workspaceId, paths[0]!, repositoryRoot);
        return;
      }
      await revertGitPaths(workspaceId, paths, repositoryRoot);
    },
    [workspaceId],
  );
  const handleStageRepositoryAll = useCallback(
    async (repositoryRoot: string) => {
      if (!workspaceId) return;
      await stageGitAll(workspaceId, repositoryRoot);
    },
    [workspaceId],
  );

  return {
    handleStageRepositoryFile,
    handleUnstageRepositoryFile,
    handleUnstageRepositoryAll,
    handleUnstageRepositoryFiles,
    handleRevertRepositoryFile,
    handleRevertRepositoryFiles,
    handleStageRepositoryAll,
  };
}


