import type { GitFileDiff } from "../../../types";
import { getGitDiffs, getGitFileFullDiff } from "../../../services/tauri";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { countDiffStats } from "../utils/gitChangeModel";
import { resolveGitRootWorkspacePrefix } from "../../../utils/workspacePaths";
import type { DiffFile } from "./GitDiffPanelFileSections";
import { normalizeDiffPath } from "./GitDiffPanelInclusion";
import type { EditableDiffDraftActions } from "./WorkspaceEditableDiffCompare";
import type { GitDiffSectionKey } from "./GitDiffPanel";
import type { GitDiffPanelProps } from "./GitDiffPanelTypes";

export type PreviewFileState = DiffFile & {
  section: GitDiffSectionKey;
  repositoryRoot: string | null;
  scopedDiffEntry: GitFileDiff | null;
  isDiffLoading: boolean;
  // 单文件兜底结果：批量 diff 列表缺失/为空时通过 get_git_file_full_diff 取回。
  fallbackDiffEntry: GitFileDiff | null;
  // 兜底取回成功但内容为空：文件没有文本级差异（如 CRLF 幻影修改），而非加载失败。
  fallbackResolvedEmpty: boolean;
};

type UseGitDiffPreviewOptions = {
  diffEntries: GitFileDiff[];
  allFiles: (DiffFile & { section: GitDiffSectionKey })[];
  modalPreviewRequest: GitDiffPanelProps["modalPreviewRequest"];
  workspaceId: string | null;
  workspacePath: string | null;
  gitRoot: string | null;
  multiRepositoryMode: boolean;
};

export function useGitDiffPreview({
  diffEntries,
  allFiles,
  modalPreviewRequest,
  workspaceId,
  workspacePath,
  gitRoot,
  multiRepositoryMode,
}: UseGitDiffPreviewOptions) {
  const [previewFile, setPreviewFile] = useState<PreviewFileState | null>(null);
  const [isPreviewModalMaximized, setIsPreviewModalMaximized] = useState(false);
  const [isPreviewModalDirty, setIsPreviewModalDirty] = useState(false);
  const [isPreviewSaveInFlight, setIsPreviewSaveInFlight] = useState(false);
  const [isUnsavedCloseDialogOpen, setIsUnsavedCloseDialogOpen] =
    useState(false);
  const [previewHeaderControlsTarget, setPreviewHeaderControlsTarget] =
    useState<HTMLDivElement | null>(null);
  const previewDraftActionsRef = useRef<EditableDiffDraftActions | null>(null);
  const handledModalPreviewRequestIdRef = useRef<number | null>(null);
  const scopedPreviewRequestIdRef = useRef(0);
  const previewContextKeyRef = useRef<string | null>(null);

  const previewDiffEntry = useMemo(() => {
    if (!previewFile) {
      return null;
    }
    if (previewFile.fallbackDiffEntry) {
      return previewFile.fallbackDiffEntry;
    }
    if (previewFile.repositoryRoot !== null) {
      return previewFile.scopedDiffEntry;
    }
    return (
      diffEntries.find(
        (entry) =>
          normalizeDiffPath(entry.path) === normalizeDiffPath(previewFile.path),
      ) ?? null
    );
  }, [diffEntries, previewFile]);
  const previewStats = useMemo(() => {
    if (
      previewFile &&
      (previewFile.additions !== 0 || previewFile.deletions !== 0)
    ) {
      return {
        additions: previewFile.additions,
        deletions: previewFile.deletions,
      };
    }
    if (previewDiffEntry && !previewDiffEntry.isImage) {
      return countDiffStats(previewDiffEntry.diff ?? "");
    }
    return {
      additions: previewFile?.additions ?? 0,
      deletions: previewFile?.deletions ?? 0,
    };
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
  const handlePreviewDraftActionsChange = useCallback(
    (actions: EditableDiffDraftActions | null) => {
      previewDraftActionsRef.current = actions;
      setIsPreviewSaveInFlight(actions?.isSaving ?? false);
    },
    [],
  );
  const saveAndClosePreviewModal = useCallback(async () => {
    const saved = await previewDraftActionsRef.current?.save();
    if (!saved) {
      return false;
    }
    closePreviewModalNow();
    return true;
  }, [closePreviewModalNow]);

  const resolvePreviewRepositoryRoot = useCallback(
    (repositoryRoot: string | null) => {
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
    },
    [gitRoot, workspacePath],
  );
  // 批量 diff 列表缺失/为空时的单文件兜底：内容非空则回填弹窗，空则标记
  // 「无文本差异」，失败则回落「差异不可用」。请求过期（关闭/换文件）直接丢弃。
  const loadPreviewFallbackDiff = useCallback(
    async (target: PreviewFileState) => {
      if (!workspaceId) {
        return;
      }
      const requestId = scopedPreviewRequestIdRef.current;
      const repositoryRoot = resolvePreviewRepositoryRoot(
        target.repositoryRoot,
      );
      try {
        const fullDiff = await getGitFileFullDiff(
          workspaceId,
          target.path,
          repositoryRoot,
        );
        if (scopedPreviewRequestIdRef.current !== requestId) {
          return;
        }
        setPreviewFile((current) => {
          if (
            !current ||
            current.path !== target.path ||
            current.section !== target.section ||
            current.repositoryRoot !== target.repositoryRoot
          ) {
            return current;
          }
          if (fullDiff.trim().length === 0) {
            return {
              ...current,
              isDiffLoading: false,
              fallbackResolvedEmpty: true,
            };
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
            !current ||
            current.path !== target.path ||
            current.section !== target.section ||
            current.repositoryRoot !== target.repositoryRoot
          ) {
            return current;
          }
          return { ...current, isDiffLoading: false };
        });
      }
    },
    [resolvePreviewRepositoryRoot, workspaceId],
  );

  const handleOpenFilePreview = useCallback(
    (file: DiffFile, section: "staged" | "unstaged", maximized = false) => {
      scopedPreviewRequestIdRef.current += 1;
      setIsPreviewModalDirty(false);
      setIsPreviewModalMaximized(maximized);
      const normalizedPath = normalizeDiffPath(file.path);
      const existingEntry =
        diffEntries.find(
          (entry) => normalizeDiffPath(entry.path) === normalizedPath,
        ) ?? null;
      const existingEntryHasContent = Boolean(
        existingEntry &&
        (existingEntry.isImage || existingEntry.diff.trim().length > 0),
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
    },
    [diffEntries, loadPreviewFallbackDiff],
  );
  const handleOpenRepositoryFilePreview = useCallback(
    async (
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
        const scopedDiffEntry =
          scopedDiffs.find(
            (entry) => normalizeDiffPath(entry.path) === normalizedPath,
          ) ?? null;
        const scopedDiffEntryHasContent = Boolean(
          scopedDiffEntry &&
          (scopedDiffEntry.isImage || scopedDiffEntry.diff.trim().length > 0),
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
    },
    [loadPreviewFallbackDiff, workspaceId],
  );
  const previewFullDiffLoader = useMemo(() => {
    if (!workspaceId || !previewFile) {
      return null;
    }
    const repositoryRoot =
      previewFile.repositoryRoot !== null
        ? previewFile.repositoryRoot
        : gitRoot === ""
          ? ""
          : workspacePath && gitRoot
            ? resolveGitRootWorkspacePrefix(workspacePath, gitRoot)
            : null;
    if (repositoryRoot === null) {
      return null;
    }
    return (path: string) =>
      getGitFileFullDiff(workspaceId, path, repositoryRoot);
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
      (file) =>
        normalizeDiffPath(file.path) ===
        normalizeDiffPath(modalPreviewRequest.path),
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

  return {
    previewFile,
    isPreviewModalMaximized,
    setIsPreviewModalMaximized,
    isPreviewModalDirty,
    setIsPreviewModalDirty,
    isPreviewSaveInFlight,
    isUnsavedCloseDialogOpen,
    setIsUnsavedCloseDialogOpen,
    previewHeaderControlsTarget,
    setPreviewHeaderControlsTarget,
    previewDiffEntry,
    previewStats,
    closePreviewModalNow,
    discardAndClosePreviewModal,
    closePreviewModal,
    handlePreviewDraftActionsChange,
    saveAndClosePreviewModal,
    handleOpenFilePreview,
    handleOpenRepositoryFilePreview,
    previewFullDiffLoader,
  };
}
