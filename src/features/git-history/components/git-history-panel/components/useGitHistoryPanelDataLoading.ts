import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  GitBranchListItem,
  GitCommitDetails,
  GitHistoryCommit,
} from "../../../../../types";
import {
  getGitCommitDetails,
  getGitCommitHistory,
  getGitStatus,
  listGitBranches,
} from "../../../../../services/tauri";
import type { GitHistoryRequestFilters } from "../hooks/useGitHistoryCommitFilters";
import { GIT_HISTORY_PAGE_SIZE } from "./GitHistoryPanelImplHelpers";
import type { GitHistoryPanelPersistedState } from "./GitHistoryPanelTypes";
import {
  collectDirPaths,
  isRepositoryUnavailableError,
  pickSelectedFileKey,
} from "../utils/gitHistoryPanelSharedUtils";

type DataLoadingScope = {
  applyHistorySnapshotId: (snapshotId: string | null) => void;
  clearCommitAndDetailColumns: () => void;
  clearHistoryColumns: () => void;
  commitFullDiffCacheRef: MutableRefObject<Map<string, Map<string, string>>>;
  createHistoryRequestFilters: () => GitHistoryRequestFilters;
  historyAppendLoadingRef: MutableRefObject<boolean>;
  historyFirstPageLoadingRef: MutableRefObject<boolean>;
  historyRequestFiltersRef: MutableRefObject<GitHistoryRequestFilters | null>;
  historyRequestGenerationRef: MutableRefObject<number>;
  historySnapshotIdRef: MutableRefObject<string | null>;
  persistedPanelState: GitHistoryPanelPersistedState;
  selectedCommitSha: string | null;
  selectedRepositoryRoot: string | null;
  setCommits: Dispatch<SetStateAction<GitHistoryCommit[]>>;
  setCreateBranchDialogOpen: Dispatch<SetStateAction<boolean>>;
  setCreateBranchName: Dispatch<SetStateAction<string>>;
  setCreateBranchSource: Dispatch<SetStateAction<string>>;
  setCurrentBranch: Dispatch<SetStateAction<string | null>>;
  setDetails: Dispatch<SetStateAction<GitCommitDetails | null>>;
  setDetailsError: Dispatch<SetStateAction<string | null>>;
  setDetailsLoading: Dispatch<SetStateAction<boolean>>;
  setExpandedDirs: Dispatch<SetStateAction<Set<string>>>;
  setHistoryError: Dispatch<SetStateAction<string | null>>;
  setHistoryHasMore: Dispatch<SetStateAction<boolean>>;
  setHistoryLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoadingMore: Dispatch<SetStateAction<boolean>>;
  setHistoryTotal: Dispatch<SetStateAction<number>>;
  setLocalBranches: Dispatch<SetStateAction<GitBranchListItem[]>>;
  setPreviewFileKey: Dispatch<SetStateAction<string | null>>;
  setRemoteBranches: Dispatch<SetStateAction<GitBranchListItem[]>>;
  setRepositoryBranchCatalogRefreshKey: Dispatch<SetStateAction<number>>;
  setRepositoryUnavailable: Dispatch<SetStateAction<boolean>>;
  setSelectedBranch: Dispatch<SetStateAction<string>>;
  setSelectedCommitSha: Dispatch<SetStateAction<string | null>>;
  setSelectedFileKey: Dispatch<SetStateAction<string | null>>;
  setWorkingTreeChangedFiles: Dispatch<SetStateAction<number>>;
  setWorkingTreeStatusError: Dispatch<SetStateAction<string | null>>;
  setWorkingTreeTotalAdditions: Dispatch<SetStateAction<number>>;
  setWorkingTreeTotalDeletions: Dispatch<SetStateAction<number>>;
  workspaceId: string | null;
};

export function useGitHistoryPanelDataLoading(scope: DataLoadingScope) {
  const {
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
  } = scope;

  const refreshBranches = useCallback(async () => {
    if (!workspaceId) {
      setLocalBranches([]);
      setRemoteBranches([]);
      setCurrentBranch(null);
      return;
    }
    try {
      const response =
        selectedRepositoryRoot === null
          ? await listGitBranches(workspaceId)
          : await listGitBranches(workspaceId, selectedRepositoryRoot);
      const local = response.localBranches ?? [];
      const remote = response.remoteBranches ?? [];
      setLocalBranches(local);
      setRemoteBranches(remote);
      setCurrentBranch(response.currentBranch ?? null);
      setSelectedBranch((prev) => {
        if (prev === "all") {
          return prev;
        }
        const existsLocal = local.some((entry) => entry.name === prev);
        const existsRemote = remote.some((entry) => entry.name === prev);
        if (existsLocal || existsRemote) {
          return prev;
        }
        return response.currentBranch ?? "all";
      });
      setRepositoryUnavailable(false);
    } catch (error) {
      if (isRepositoryUnavailableError(error)) {
        setRepositoryUnavailable(true);
        clearHistoryColumns();
      }
    }
  }, [
    workspaceId,
    selectedRepositoryRoot,
    clearHistoryColumns,
    setSelectedBranch,
  ]);

  const refreshWorkingTreeStatus = useCallback(async () => {
    if (!workspaceId) {
      setWorkingTreeChangedFiles(0);
      setWorkingTreeTotalAdditions(0);
      setWorkingTreeTotalDeletions(0);
      setWorkingTreeStatusError(null);
      return;
    }
    try {
      const status =
        selectedRepositoryRoot === null
          ? await getGitStatus(workspaceId)
          : await getGitStatus(workspaceId, selectedRepositoryRoot);
      setWorkingTreeChangedFiles(status.files.length);
      setWorkingTreeTotalAdditions(status.totalAdditions);
      setWorkingTreeTotalDeletions(status.totalDeletions);
      setWorkingTreeStatusError(null);
      setRepositoryUnavailable(false);
    } catch (error) {
      setWorkingTreeChangedFiles(0);
      setWorkingTreeTotalAdditions(0);
      setWorkingTreeTotalDeletions(0);
      if (isRepositoryUnavailableError(error)) {
        setRepositoryUnavailable(true);
      }
      setWorkingTreeStatusError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }, [workspaceId, selectedRepositoryRoot]);

  const loadHistory = useCallback(
    async (append: boolean, startOffset?: number) => {
      if (!workspaceId) {
        historyRequestGenerationRef.current += 1;
        historyRequestFiltersRef.current = null;
        historyFirstPageLoadingRef.current = false;
        historyAppendLoadingRef.current = false;
        setCommits([]);
        setHistoryTotal(0);
        setHistoryHasMore(false);
        applyHistorySnapshotId(null);
        setHistoryError(null);
        return;
      }
      if (
        append &&
        (historyFirstPageLoadingRef.current || historyAppendLoadingRef.current)
      ) {
        return;
      }

      const requestGeneration = append
        ? historyRequestGenerationRef.current
        : historyRequestGenerationRef.current + 1;
      const requestFilters = append
        ? (historyRequestFiltersRef.current ?? createHistoryRequestFilters())
        : createHistoryRequestFilters();
      if (!append) {
        historyRequestGenerationRef.current = requestGeneration;
        historyRequestFiltersRef.current = requestFilters;
        historyFirstPageLoadingRef.current = true;
        historyAppendLoadingRef.current = false;
        applyHistorySnapshotId(null);
        setHistoryLoadingMore(false);
      } else {
        historyAppendLoadingRef.current = true;
      }
      const isCurrentRequest = () =>
        historyRequestGenerationRef.current === requestGeneration;

      if (append) {
        setHistoryLoadingMore(true);
      } else {
        setHistoryLoading(true);
      }
      setHistoryError(null);

      try {
        const offset = append ? (startOffset ?? 0) : 0;
        const response = await getGitCommitHistory(workspaceId, {
          ...requestFilters,
          snapshotId: append ? historySnapshotIdRef.current : null,
          offset,
          limit: GIT_HISTORY_PAGE_SIZE,
        });
        if (!isCurrentRequest()) {
          return;
        }

        setHistoryTotal(response.total);
        setHistoryHasMore(response.hasMore);
        applyHistorySnapshotId(response.snapshotId);
        setCommits((prev) => {
          if (!append) {
            return response.commits;
          }
          const seen = new Set(prev.map((item) => item.sha));
          const merged = [...prev];
          for (const commit of response.commits) {
            if (!seen.has(commit.sha)) {
              merged.push(commit);
              seen.add(commit.sha);
            }
          }
          return merged;
        });
        setRepositoryUnavailable(false);
      } catch (error) {
        if (!isCurrentRequest()) {
          return;
        }
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        const isSnapshotExpired = rawMessage
          .toLowerCase()
          .includes("snapshot expired");
        if (append && isSnapshotExpired) {
          try {
            const refreshed = await getGitCommitHistory(workspaceId, {
              ...requestFilters,
              snapshotId: null,
              offset: 0,
              limit: GIT_HISTORY_PAGE_SIZE,
            });
            if (!isCurrentRequest()) {
              return;
            }
            setHistoryTotal(refreshed.total);
            setHistoryHasMore(refreshed.hasMore);
            applyHistorySnapshotId(refreshed.snapshotId);
            setCommits(refreshed.commits);
            setHistoryError(null);
            return;
          } catch (refreshError) {
            if (!isCurrentRequest()) {
              return;
            }
            setHistoryError(
              refreshError instanceof Error
                ? refreshError.message
                : String(refreshError),
            );
            return;
          }
        }
        if (isRepositoryUnavailableError(error)) {
          setRepositoryUnavailable(true);
        }
        if (!append) {
          clearCommitAndDetailColumns();
        }
        setHistoryError(rawMessage);
      } finally {
        if (isCurrentRequest()) {
          if (append) {
            historyAppendLoadingRef.current = false;
          } else {
            historyFirstPageLoadingRef.current = false;
          }
          setHistoryLoading(false);
          setHistoryLoadingMore(false);
        }
      }
    },
    [
      applyHistorySnapshotId,
      clearCommitAndDetailColumns,
      createHistoryRequestFilters,
      workspaceId,
    ],
  );

  const refreshAll = useCallback(async () => {
    await refreshBranches();
    setRepositoryBranchCatalogRefreshKey((previous) => previous + 1);
    await refreshWorkingTreeStatus();
    await loadHistory(false, 0);

    if (selectedCommitSha && workspaceId) {
      try {
        const commitDetails =
          selectedRepositoryRoot === null
            ? await getGitCommitDetails(workspaceId, selectedCommitSha)
            : await getGitCommitDetails(
                workspaceId,
                selectedCommitSha,
                10_000,
                selectedRepositoryRoot,
              );
        setDetails(commitDetails);
        setExpandedDirs(collectDirPaths(commitDetails.files));
        setDetailsError(null);
        setSelectedFileKey((previous) =>
          pickSelectedFileKey(previous, commitDetails.files),
        );
        setPreviewFileKey(null);
      } catch (error) {
        if (isRepositoryUnavailableError(error)) {
          setRepositoryUnavailable(true);
          clearHistoryColumns();
        }
        setDetails(null);
        setSelectedFileKey(null);
        setPreviewFileKey(null);
        setDetailsError(error instanceof Error ? error.message : String(error));
      }
    }
  }, [
    clearHistoryColumns,
    loadHistory,
    refreshBranches,
    refreshWorkingTreeStatus,
    selectedCommitSha,
    selectedRepositoryRoot,
    workspaceId,
  ]);

  useEffect(() => {
    historyRequestGenerationRef.current += 1;
    historyRequestFiltersRef.current = null;
    setRepositoryUnavailable(false);
    setSelectedCommitSha(persistedPanelState.selectedCommitSha ?? null);
    setDetails(null);
    setSelectedFileKey(null);
    setPreviewFileKey(null);
    setExpandedDirs(new Set());
    applyHistorySnapshotId(null);
    setCreateBranchDialogOpen(false);
    setCreateBranchSource("");
    setCreateBranchName("");
    if (!workspaceId) {
      setCommits([]);
      setHistoryTotal(0);
      setHistoryHasMore(false);
      setHistoryError(null);
      setWorkingTreeChangedFiles(0);
      setWorkingTreeTotalAdditions(0);
      setWorkingTreeTotalDeletions(0);
      setWorkingTreeStatusError(null);
      return;
    }
    void (async () => {
      await refreshBranches();
      await refreshWorkingTreeStatus();
    })();
  }, [
    workspaceId,
    refreshBranches,
    refreshWorkingTreeStatus,
    applyHistorySnapshotId,
    persistedPanelState.selectedCommitSha,
  ]);

  useEffect(() => {
    commitFullDiffCacheRef.current.clear();
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }
    void loadHistory(false, 0);
  }, [workspaceId, loadHistory]);

  useEffect(() => {
    if (!workspaceId || !selectedCommitSha) {
      setDetails(null);
      setSelectedFileKey(null);
      setPreviewFileKey(null);
      setExpandedDirs(new Set());
      setDetailsError(null);
      return;
    }

    let cancelled = false;
    setDetailsLoading(true);
    setDetailsError(null);

    void (
      selectedRepositoryRoot === null
        ? getGitCommitDetails(workspaceId, selectedCommitSha)
        : getGitCommitDetails(
            workspaceId,
            selectedCommitSha,
            10_000,
            selectedRepositoryRoot,
          )
    )
      .then((response) => {
        if (cancelled) {
          return;
        }
        setDetails(response);
        setExpandedDirs(collectDirPaths(response.files));
        setSelectedFileKey((previous) =>
          pickSelectedFileKey(previous, response.files),
        );
        setPreviewFileKey(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (isRepositoryUnavailableError(error)) {
          setRepositoryUnavailable(true);
          clearHistoryColumns();
        }
        setDetails(null);
        setExpandedDirs(new Set());
        setSelectedFileKey(null);
        setPreviewFileKey(null);
        setDetailsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) {
          setDetailsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    selectedCommitSha,
    workspaceId,
    selectedRepositoryRoot,
    clearHistoryColumns,
  ]);

  return {
    loadHistory,
    refreshAll,
  };
}
