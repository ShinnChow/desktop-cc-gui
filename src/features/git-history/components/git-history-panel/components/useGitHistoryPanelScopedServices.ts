import { useCallback } from "react";
import {
  checkoutGitBranch,
  fetchGit,
  getGitCommitDetails,
  getGitDiffs,
  getGitPushPreview,
  getGitStatus,
  pullGit,
  pushGit,
  syncGit,
  updateGitBranch,
} from "../../../../../services/tauri";

type ScopedServicesScope = {
  selectedRepositoryRoot: string | null;
};

export function useGitHistoryPanelScopedServices(scope: ScopedServicesScope) {
  const { selectedRepositoryRoot } = scope;

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

  return {
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
  };
}
