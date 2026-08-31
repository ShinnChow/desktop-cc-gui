import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { TFunction } from "i18next";
import type { GitCommitDetails } from "../../../../../types";
import {
  getGitCommitDiff,
  getGitFileFullDiff,
} from "../../../../../services/tauri";
import { extractCommitBody } from "./GitHistoryPanelImplHelpers";
import type {
  BranchDiffState,
  WorktreePreviewFile,
} from "./GitHistoryPanelTypes";
import {
  buildFileKey,
  buildFileTreeItems,
} from "../utils/gitHistoryPanelSharedUtils";

type PreviewDerivationsScope = {
  branchDiffState: BranchDiffState | null;
  commitFullDiffCacheRef: MutableRefObject<Map<string, Map<string, string>>>;
  comparePreviewFileKey: string | null;
  details: GitCommitDetails | null;
  expandedDirs: Set<string>;
  previewFileKey: string | null;
  pushPreviewDetails: GitCommitDetails | null;
  pushPreviewExpandedDirs: Set<string>;
  pushPreviewModalFileKey: string | null;
  pushPreviewSelectedSha: string | null;
  repositoryRootName: string;
  selectedCommitSha: string | null;
  selectedRepositoryRoot: string | null;
  setComparePreviewFileKey: Dispatch<SetStateAction<string | null>>;
  setIsHistoryDiffModalMaximized: Dispatch<SetStateAction<boolean>>;
  setPreviewFileKey: Dispatch<SetStateAction<string | null>>;
  setPushPreviewModalFileKey: Dispatch<SetStateAction<string | null>>;
  setWorktreePreviewError: Dispatch<SetStateAction<string | null>>;
  setWorktreePreviewFile: Dispatch<SetStateAction<WorktreePreviewFile | null>>;
  setWorktreePreviewLoading: Dispatch<SetStateAction<boolean>>;
  t: TFunction<"translation", undefined>;
  workspaceId: string | null;
  worktreePreviewFile: WorktreePreviewFile | null;
};

export function useGitHistoryPanelPreviewDerivations(scope: PreviewDerivationsScope) {
  const {
    branchDiffState,
    commitFullDiffCacheRef,
    comparePreviewFileKey,
    details,
    expandedDirs,
    previewFileKey,
    pushPreviewDetails,
    pushPreviewExpandedDirs,
    pushPreviewModalFileKey,
    pushPreviewSelectedSha,
    repositoryRootName,
    selectedCommitSha,
    selectedRepositoryRoot,
    setComparePreviewFileKey,
    setIsHistoryDiffModalMaximized,
    setPreviewFileKey,
    setPushPreviewModalFileKey,
    setWorktreePreviewError,
    setWorktreePreviewFile,
    setWorktreePreviewLoading,
    t,
    workspaceId,
    worktreePreviewFile,
  } = scope;

  const fileTreeItems = useMemo(() => {
    if (!details) {
      return [];
    }
    return buildFileTreeItems(details.files, expandedDirs, repositoryRootName);
  }, [details, expandedDirs, repositoryRootName]);

  const detailsMessageContent = useMemo(() => {
    if (!details) {
      return "";
    }
    const commitBody = extractCommitBody(details.summary, details.message);
    return commitBody || t("git.historyCommitMetaNoContent");
  }, [details, t]);

  const previewDetailFile = useMemo(() => {
    if (!details || !previewFileKey) {
      return null;
    }
    return (
      details.files.find((entry) => buildFileKey(entry) === previewFileKey) ??
      null
    );
  }, [details, previewFileKey]);

  const previewDetailFileDiff = useMemo(() => {
    if (!previewDetailFile) {
      return null;
    }
    if (previewDetailFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (previewDetailFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [previewDetailFile, t]);

  const previewDiffEntries = useMemo(() => {
    if (!previewDetailFile) {
      return [];
    }
    return [
      {
        path: previewDetailFile.path,
        status: previewDetailFile.status,
        diff: previewDetailFile.diff ?? "",
      },
    ];
  }, [previewDetailFile]);

  const comparePreviewDetailFile = useMemo(() => {
    if (
      !comparePreviewFileKey ||
      !branchDiffState ||
      branchDiffState.mode !== "branch"
    ) {
      return null;
    }
    const selectedCommitDetails = branchDiffState.selectedCommitDetails;
    if (!selectedCommitDetails) {
      return null;
    }
    return (
      selectedCommitDetails.files.find(
        (entry) => buildFileKey(entry) === comparePreviewFileKey,
      ) ?? null
    );
  }, [branchDiffState, comparePreviewFileKey]);

  const comparePreviewDetailFileDiff = useMemo(() => {
    if (!comparePreviewDetailFile) {
      return null;
    }
    if (comparePreviewDetailFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (comparePreviewDetailFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [comparePreviewDetailFile, t]);

  const comparePreviewDiffEntries = useMemo(() => {
    if (!comparePreviewDetailFile) {
      return [];
    }
    return [
      {
        path: comparePreviewDetailFile.path,
        status: comparePreviewDetailFile.status,
        diff: comparePreviewDetailFile.diff ?? "",
      },
    ];
  }, [comparePreviewDetailFile]);

  const worktreePreviewDiffText = useMemo(() => {
    if (!worktreePreviewFile) {
      return null;
    }
    if (worktreePreviewFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (worktreePreviewFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [worktreePreviewFile, t]);

  const worktreePreviewDiffEntries = useMemo(() => {
    if (!worktreePreviewFile) {
      return [];
    }
    return [
      {
        path: worktreePreviewFile.path,
        status: worktreePreviewFile.status,
        diff: worktreePreviewFile.diff ?? "",
        isImage: worktreePreviewFile.isImage,
        oldImageData: worktreePreviewFile.oldImageData,
        newImageData: worktreePreviewFile.newImageData,
        oldImageMime: worktreePreviewFile.oldImageMime,
        newImageMime: worktreePreviewFile.newImageMime,
      },
    ];
  }, [worktreePreviewFile]);

  const pushPreviewFileTreeItems = useMemo(() => {
    if (!pushPreviewDetails) {
      return [];
    }
    return buildFileTreeItems(
      pushPreviewDetails.files,
      pushPreviewExpandedDirs,
      repositoryRootName,
    );
  }, [pushPreviewDetails, pushPreviewExpandedDirs, repositoryRootName]);

  const pushPreviewModalFile = useMemo(() => {
    if (!pushPreviewDetails || !pushPreviewModalFileKey) {
      return null;
    }
    return (
      pushPreviewDetails.files.find(
        (entry) => buildFileKey(entry) === pushPreviewModalFileKey,
      ) ?? null
    );
  }, [pushPreviewDetails, pushPreviewModalFileKey]);

  const pushPreviewModalFileDiff = useMemo(() => {
    if (!pushPreviewModalFile) {
      return null;
    }
    if (pushPreviewModalFile.isBinary) {
      return t("git.historyBinaryDiffUnavailable");
    }
    const diffText = (pushPreviewModalFile.diff ?? "").trimEnd();
    if (!diffText.trim()) {
      return t("git.historyEmptyDiff");
    }
    return diffText;
  }, [pushPreviewModalFile, t]);

  const pushPreviewModalDiffEntries = useMemo(() => {
    if (!pushPreviewModalFile) {
      return [];
    }
    return [
      {
        path: pushPreviewModalFile.path,
        status: pushPreviewModalFile.status,
        diff: pushPreviewModalFile.diff ?? "",
      },
    ];
  }, [pushPreviewModalFile]);

  const activeHistoryDiffModalKey = useMemo(() => {
    if (previewDetailFile) {
      return `commit:${previewDetailFile.path}`;
    }
    if (worktreePreviewFile) {
      return `worktree:${worktreePreviewFile.path}`;
    }
    if (branchDiffState) {
      return `branch:${branchDiffState.mode}:${branchDiffState.branch}:${branchDiffState.compareBranch ?? ""}`;
    }
    if (comparePreviewDetailFile) {
      return `compare:${comparePreviewDetailFile.path}`;
    }
    if (pushPreviewModalFile) {
      return `push:${pushPreviewModalFile.path}`;
    }
    return null;
  }, [
    branchDiffState,
    comparePreviewDetailFile,
    previewDetailFile,
    pushPreviewModalFile,
    worktreePreviewFile,
  ]);

  useEffect(() => {
    setIsHistoryDiffModalMaximized(false);
  }, [activeHistoryDiffModalKey]);

  const loadCommitFileFullDiff = useCallback(
    async (commitSha: string, path: string): Promise<string> => {
      if (!workspaceId) {
        return "";
      }
      const normalizedPath = path.replace(/^(?:a|b)\//, "");
      const cachePathKey = `full_ctx200k:${normalizedPath}`;
      const cachedByPath = commitFullDiffCacheRef.current.get(commitSha);
      if (cachedByPath && cachedByPath.has(cachePathKey)) {
        return cachedByPath.get(cachePathKey) ?? "";
      }

      const commitDiffs = await getGitCommitDiff(workspaceId, commitSha, {
        path: normalizedPath,
        contextLines: 200_000,
        ...(selectedRepositoryRoot === null
          ? {}
          : { repositoryRoot: selectedRepositoryRoot }),
      });
      const fullDiff =
        commitDiffs.find((entry) => entry.path === normalizedPath)?.diff ??
        commitDiffs[0]?.diff ??
        "";

      const nextCache = cachedByPath
        ? new Map(cachedByPath)
        : new Map<string, string>();
      nextCache.set(cachePathKey, fullDiff);
      commitFullDiffCacheRef.current.set(commitSha, nextCache);
      return fullDiff;
    },
    [workspaceId, selectedRepositoryRoot],
  );

  const previewModalFullDiffLoader = useCallback(
    (path: string) => {
      if (!selectedCommitSha) {
        return Promise.resolve("");
      }
      return loadCommitFileFullDiff(selectedCommitSha, path);
    },
    [loadCommitFileFullDiff, selectedCommitSha],
  );

  const pushPreviewModalFullDiffLoader = useCallback(
    (path: string) => {
      if (!pushPreviewSelectedSha) {
        return Promise.resolve("");
      }
      return loadCommitFileFullDiff(pushPreviewSelectedSha, path);
    },
    [loadCommitFileFullDiff, pushPreviewSelectedSha],
  );

  const worktreePreviewFullDiffLoader = useCallback(
    (path: string) => {
      if (!workspaceId) {
        return Promise.resolve("");
      }
      const normalizedPath = path.replace(/^(?:a|b)\//, "");
      return selectedRepositoryRoot === null
        ? getGitFileFullDiff(workspaceId, normalizedPath)
        : getGitFileFullDiff(
            workspaceId,
            normalizedPath,
            selectedRepositoryRoot,
          );
    },
    [workspaceId, selectedRepositoryRoot],
  );

  useEffect(() => {
    if (!previewFileKey) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewFileKey(null);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [previewFileKey]);

  useEffect(() => {
    if (!comparePreviewFileKey) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setComparePreviewFileKey(null);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [comparePreviewFileKey]);

  useEffect(() => {
    if (!pushPreviewModalFileKey) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setPushPreviewModalFileKey(null);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [pushPreviewModalFileKey]);

  useEffect(() => {
    if (!worktreePreviewFile) {
      return;
    }
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setWorktreePreviewFile(null);
        setWorktreePreviewError(null);
        setWorktreePreviewLoading(false);
      }
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [worktreePreviewFile]);

  useEffect(() => {
    if (comparePreviewFileKey && !comparePreviewDetailFile) {
      setComparePreviewFileKey(null);
    }
  }, [comparePreviewDetailFile, comparePreviewFileKey]);

  return {
    comparePreviewDetailFile,
    comparePreviewDetailFileDiff,
    comparePreviewDiffEntries,
    detailsMessageContent,
    fileTreeItems,
    previewDetailFile,
    previewDetailFileDiff,
    previewDiffEntries,
    previewModalFullDiffLoader,
    pushPreviewFileTreeItems,
    pushPreviewModalDiffEntries,
    pushPreviewModalFile,
    pushPreviewModalFileDiff,
    pushPreviewModalFullDiffLoader,
    worktreePreviewDiffEntries,
    worktreePreviewDiffText,
    worktreePreviewFullDiffLoader,
  };
}
