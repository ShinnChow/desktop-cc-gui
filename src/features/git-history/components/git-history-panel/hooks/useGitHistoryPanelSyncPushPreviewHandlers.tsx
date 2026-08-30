import { useCallback, useEffect } from "react";
import type { GitHistoryPanelInteractionScope } from "../components/GitHistoryPanelImpl";

type SyncPushPreviewHandlersScope = Pick<
  GitHistoryPanelInteractionScope,
  | "getGitCommitDetails"
  | "getGitPushPreview"
  | "pushDialogOpen"
  | "pushPreviewDetailsLoadTokenRef"
  | "pushPreviewLoadTokenRef"
  | "pushPreviewSelectedSha"
  | "pushRemoteTrimmed"
  | "pushTargetBranchTrimmed"
  | "setPushPreviewCommits"
  | "setPushPreviewDetails"
  | "setPushPreviewDetailsError"
  | "setPushPreviewDetailsLoading"
  | "setPushPreviewError"
  | "setPushPreviewHasMore"
  | "setPushPreviewLoading"
  | "setPushPreviewSelectedSha"
  | "setPushPreviewTargetFound"
  | "setSyncPreviewCommits"
  | "setSyncPreviewError"
  | "setSyncPreviewLoading"
  | "setSyncPreviewTargetFound"
  | "syncDialogOpen"
  | "syncPreviewTargetBranch"
  | "syncPreviewTargetRemote"
  | "workspaceId"
>;

export function useGitHistoryPanelSyncPushPreviewHandlers(
  scope: SyncPushPreviewHandlersScope,
) {
  const {
    getGitCommitDetails,
    getGitPushPreview,
    pushDialogOpen,
    pushPreviewDetailsLoadTokenRef,
    pushPreviewLoadTokenRef,
    pushPreviewSelectedSha,
    pushRemoteTrimmed,
    pushTargetBranchTrimmed,
    setPushPreviewCommits,
    setPushPreviewDetails,
    setPushPreviewDetailsError,
    setPushPreviewDetailsLoading,
    setPushPreviewError,
    setPushPreviewHasMore,
    setPushPreviewLoading,
    setPushPreviewSelectedSha,
    setPushPreviewTargetFound,
    setSyncPreviewCommits,
    setSyncPreviewError,
    setSyncPreviewLoading,
    setSyncPreviewTargetFound,
    syncDialogOpen,
    syncPreviewTargetBranch,
    syncPreviewTargetRemote,
    workspaceId,
  } = scope;

  const loadPushPreview = useCallback(
    async (remoteName: string, targetBranchName: string) => {
      if (!workspaceId) {
        return;
      }
      const requestToken = pushPreviewLoadTokenRef.current + 1;
      pushPreviewLoadTokenRef.current = requestToken;
      setPushPreviewLoading(true);
      setPushPreviewError(null);
      try {
        const response = await getGitPushPreview(workspaceId, {
          remote: remoteName,
          branch: targetBranchName,
          limit: 120,
        });
        if (requestToken !== pushPreviewLoadTokenRef.current) {
          return;
        }
        setPushPreviewTargetFound(response.targetFound);
        setPushPreviewHasMore(response.hasMore);
        setPushPreviewCommits(response.commits);
        setPushPreviewSelectedSha((previousSha) => {
          if (!response.targetFound) {
            return null;
          }
          if (
            previousSha &&
            response.commits.some((entry) => entry.sha === previousSha)
          ) {
            return previousSha;
          }
          return response.commits[0]?.sha ?? null;
        });
        if (!response.targetFound || !response.commits.length) {
          pushPreviewDetailsLoadTokenRef.current += 1;
          setPushPreviewDetails(null);
          setPushPreviewDetailsError(null);
          setPushPreviewDetailsLoading(false);
        }
      } catch (error) {
        if (requestToken !== pushPreviewLoadTokenRef.current) {
          return;
        }
        pushPreviewDetailsLoadTokenRef.current += 1;
        setPushPreviewTargetFound(true);
        setPushPreviewHasMore(false);
        setPushPreviewCommits([]);
        setPushPreviewSelectedSha(null);
        setPushPreviewDetails(null);
        setPushPreviewDetailsLoading(false);
        setPushPreviewDetailsError(null);
        setPushPreviewError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        if (requestToken === pushPreviewLoadTokenRef.current) {
          setPushPreviewLoading(false);
        }
      }
    },
    [
      getGitPushPreview,
      pushPreviewDetailsLoadTokenRef,
      pushPreviewLoadTokenRef,
      setPushPreviewCommits,
      setPushPreviewDetails,
      setPushPreviewDetailsError,
      setPushPreviewDetailsLoading,
      setPushPreviewError,
      setPushPreviewHasMore,
      setPushPreviewLoading,
      setPushPreviewSelectedSha,
      setPushPreviewTargetFound,
      workspaceId,
    ],
  );

  useEffect(() => {
    if (!pushDialogOpen) {
      return;
    }
    if (!workspaceId || !pushRemoteTrimmed || !pushTargetBranchTrimmed) {
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
      return;
    }
    const timer = window.setTimeout(() => {
      void loadPushPreview(pushRemoteTrimmed, pushTargetBranchTrimmed);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    loadPushPreview,
    pushDialogOpen,
    pushPreviewDetailsLoadTokenRef,
    pushPreviewLoadTokenRef,
    pushRemoteTrimmed,
    setPushPreviewCommits,
    setPushPreviewDetails,
    setPushPreviewDetailsError,
    setPushPreviewDetailsLoading,
    setPushPreviewError,
    setPushPreviewHasMore,
    setPushPreviewLoading,
    setPushPreviewSelectedSha,
    setPushPreviewTargetFound,
    pushTargetBranchTrimmed,
    workspaceId,
  ]);

  useEffect(() => {
    if (!pushDialogOpen || !workspaceId || !pushPreviewSelectedSha) {
      pushPreviewDetailsLoadTokenRef.current += 1;
      setPushPreviewDetails(null);
      setPushPreviewDetailsLoading(false);
      setPushPreviewDetailsError(null);
      return;
    }
    const requestToken = pushPreviewDetailsLoadTokenRef.current + 1;
    pushPreviewDetailsLoadTokenRef.current = requestToken;
    setPushPreviewDetailsLoading(true);
    setPushPreviewDetailsError(null);
    void getGitCommitDetails(workspaceId, pushPreviewSelectedSha)
      .then((response) => {
        if (requestToken !== pushPreviewDetailsLoadTokenRef.current) {
          return;
        }
        setPushPreviewDetails(response);
      })
      .catch((error) => {
        if (requestToken !== pushPreviewDetailsLoadTokenRef.current) {
          return;
        }
        setPushPreviewDetails(null);
        setPushPreviewDetailsError(
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (requestToken === pushPreviewDetailsLoadTokenRef.current) {
          setPushPreviewDetailsLoading(false);
        }
      });
  }, [
    getGitCommitDetails,
    pushDialogOpen,
    pushPreviewDetailsLoadTokenRef,
    pushPreviewSelectedSha,
    setPushPreviewDetails,
    setPushPreviewDetailsError,
    setPushPreviewDetailsLoading,
    workspaceId,
  ]);

  useEffect(() => {
    if (!syncDialogOpen || !workspaceId) {
      return;
    }
    if (!syncPreviewTargetRemote || !syncPreviewTargetBranch) {
      setSyncPreviewError(null);
      setSyncPreviewCommits([]);
      setSyncPreviewTargetFound(true);
      return;
    }
    let isCancelled = false;
    setSyncPreviewLoading(true);
    setSyncPreviewError(null);
    void getGitPushPreview(workspaceId, {
      remote: syncPreviewTargetRemote,
      branch: syncPreviewTargetBranch,
      limit: 5,
    })
      .then((response) => {
        if (isCancelled) {
          return;
        }
        setSyncPreviewTargetFound(response.targetFound);
        setSyncPreviewCommits(response.commits);
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        setSyncPreviewTargetFound(true);
        setSyncPreviewCommits([]);
        setSyncPreviewError(
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (!isCancelled) {
          setSyncPreviewLoading(false);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [
    getGitPushPreview,
    setSyncPreviewCommits,
    setSyncPreviewError,
    setSyncPreviewLoading,
    setSyncPreviewTargetFound,
    syncDialogOpen,
    syncPreviewTargetBranch,
    syncPreviewTargetRemote,
    workspaceId,
  ]);

  return {
    loadPushPreview,
  };
}
