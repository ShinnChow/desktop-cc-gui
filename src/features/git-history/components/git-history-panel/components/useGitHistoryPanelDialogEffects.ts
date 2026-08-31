import {
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type {
  GitCommitDetails,
  GitCommitFileChange,
  GitHistoryCommit,
} from "../../../../../types";
import type { CommitContextMenuState } from "./GitHistoryPanelTypes";
import {
  collectDirPaths,
  pickSelectedFileKey,
} from "../utils/gitHistoryPanelSharedUtils";

type DialogEffectsScope = {
  commitContextMenu: CommitContextMenuState | null;
  previewDetailFile: GitCommitFileChange | null;
  previewFileKey: string | null;
  pullDialogOpen: boolean;
  pullOptionsMenuOpen: boolean;
  pullOptionsMenuRef: MutableRefObject<HTMLDivElement | null>;
  pullRemoteMenuOpen: boolean;
  pullRemotePickerRef: MutableRefObject<HTMLDivElement | null>;
  pullTargetBranchFieldRef: MutableRefObject<HTMLLabelElement | null>;
  pullTargetBranchMenuOpen: boolean;
  pushDialogOpen: boolean;
  pushPreviewDetails: GitCommitDetails | null;
  pushPreviewDetailsLoadTokenRef: MutableRefObject<number>;
  pushPreviewLoadTokenRef: MutableRefObject<number>;
  pushPreviewModalFile: GitCommitFileChange | null;
  pushPreviewModalFileKey: string | null;
  pushRemoteMenuOpen: boolean;
  pushRemotePickerRef: MutableRefObject<HTMLDivElement | null>;
  pushTargetBranchFieldRef: MutableRefObject<HTMLLabelElement | null>;
  pushTargetBranchMenuOpen: boolean;
  setCommitContextMenu: Dispatch<SetStateAction<CommitContextMenuState | null>>;
  setCommitContextMoreOpen: Dispatch<SetStateAction<boolean>>;
  setPreviewFileKey: Dispatch<SetStateAction<string | null>>;
  setPullOptionsMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullRemoteMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullRemoteMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPullTargetBranchMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullTargetBranchMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPullTargetBranchQuery: Dispatch<SetStateAction<string>>;
  setPushPreviewCommits: Dispatch<SetStateAction<GitHistoryCommit[]>>;
  setPushPreviewDetails: Dispatch<SetStateAction<GitCommitDetails | null>>;
  setPushPreviewDetailsError: Dispatch<SetStateAction<string | null>>;
  setPushPreviewDetailsLoading: Dispatch<SetStateAction<boolean>>;
  setPushPreviewError: Dispatch<SetStateAction<string | null>>;
  setPushPreviewExpandedDirs: Dispatch<SetStateAction<Set<string>>>;
  setPushPreviewHasMore: Dispatch<SetStateAction<boolean>>;
  setPushPreviewLoading: Dispatch<SetStateAction<boolean>>;
  setPushPreviewModalFileKey: Dispatch<SetStateAction<string | null>>;
  setPushPreviewSelectedFileKey: Dispatch<SetStateAction<string | null>>;
  setPushPreviewSelectedSha: Dispatch<SetStateAction<string | null>>;
  setPushPreviewTargetFound: Dispatch<SetStateAction<boolean>>;
  setPushRemoteMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPushRemoteMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPushTargetBranchMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPushTargetBranchMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPushTargetBranchQuery: Dispatch<SetStateAction<string>>;
  setSyncPreviewCommits: Dispatch<SetStateAction<GitHistoryCommit[]>>;
  setSyncPreviewError: Dispatch<SetStateAction<string | null>>;
  setSyncPreviewLoading: Dispatch<SetStateAction<boolean>>;
  setSyncPreviewTargetFound: Dispatch<SetStateAction<boolean>>;
  syncDialogOpen: boolean;
};

export function useGitHistoryPanelDialogEffects(scope: DialogEffectsScope) {
  const {
    commitContextMenu,
    previewDetailFile,
    previewFileKey,
    pullDialogOpen,
    pullOptionsMenuOpen,
    pullOptionsMenuRef,
    pullRemoteMenuOpen,
    pullRemotePickerRef,
    pullTargetBranchFieldRef,
    pullTargetBranchMenuOpen,
    pushDialogOpen,
    pushPreviewDetails,
    pushPreviewDetailsLoadTokenRef,
    pushPreviewLoadTokenRef,
    pushPreviewModalFile,
    pushPreviewModalFileKey,
    pushRemoteMenuOpen,
    pushRemotePickerRef,
    pushTargetBranchFieldRef,
    pushTargetBranchMenuOpen,
    setCommitContextMenu,
    setCommitContextMoreOpen,
    setPreviewFileKey,
    setPullOptionsMenuOpen,
    setPullRemoteMenuOpen,
    setPullRemoteMenuPlacement,
    setPullTargetBranchMenuOpen,
    setPullTargetBranchMenuPlacement,
    setPullTargetBranchQuery,
    setPushPreviewCommits,
    setPushPreviewDetails,
    setPushPreviewDetailsError,
    setPushPreviewDetailsLoading,
    setPushPreviewError,
    setPushPreviewExpandedDirs,
    setPushPreviewHasMore,
    setPushPreviewLoading,
    setPushPreviewModalFileKey,
    setPushPreviewSelectedFileKey,
    setPushPreviewSelectedSha,
    setPushPreviewTargetFound,
    setPushRemoteMenuOpen,
    setPushRemoteMenuPlacement,
    setPushTargetBranchMenuOpen,
    setPushTargetBranchMenuPlacement,
    setPushTargetBranchQuery,
    setSyncPreviewCommits,
    setSyncPreviewError,
    setSyncPreviewLoading,
    setSyncPreviewTargetFound,
    syncDialogOpen,
  } = scope;

  useEffect(() => {
    if (!commitContextMenu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".git-history-commit-context-menu")
      ) {
        return;
      }
      setCommitContextMenu(null);
    };
    const handleScroll = () => setCommitContextMenu(null);
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setCommitContextMenu(null);
      }
    };
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("scroll", handleScroll, scrollOptions);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("scroll", handleScroll, scrollOptions);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [commitContextMenu]);

  useEffect(() => {
    if (!commitContextMenu) {
      setCommitContextMoreOpen(false);
    }
  }, [commitContextMenu]);

  useEffect(() => {
    if (!pullDialogOpen) {
      setPullRemoteMenuOpen(false);
      setPullRemoteMenuPlacement("up");
      setPullOptionsMenuOpen(false);
      setPullTargetBranchQuery("");
      setPullTargetBranchMenuOpen(false);
      setPullTargetBranchMenuPlacement("down");
    }
  }, [pullDialogOpen]);

  useEffect(() => {
    if (!syncDialogOpen) {
      setSyncPreviewLoading(false);
      setSyncPreviewError(null);
      setSyncPreviewCommits([]);
      setSyncPreviewTargetFound(true);
    }
  }, [syncDialogOpen]);

  useEffect(() => {
    if (!pullDialogOpen || !pullOptionsMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!pullOptionsMenuRef.current?.contains(target)) {
        setPullOptionsMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pullDialogOpen, pullOptionsMenuOpen]);

  useEffect(() => {
    if (!pullDialogOpen || (!pullRemoteMenuOpen && !pullTargetBranchMenuOpen)) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (pullRemotePickerRef.current?.contains(target)) {
        return;
      }
      if (pullTargetBranchFieldRef.current?.contains(target)) {
        return;
      }
      setPullRemoteMenuOpen(false);
      setPullTargetBranchMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pullDialogOpen, pullRemoteMenuOpen, pullTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pushDialogOpen) {
      setPushRemoteMenuOpen(false);
      setPushRemoteMenuPlacement("up");
      setPushTargetBranchMenuOpen(false);
      setPushTargetBranchMenuPlacement("down");
      setPushTargetBranchQuery("");
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
      setPushPreviewExpandedDirs(new Set());
      setPushPreviewSelectedFileKey(null);
      setPushPreviewModalFileKey(null);
    }
  }, [pushDialogOpen]);

  useEffect(() => {
    if (!pushDialogOpen || (!pushRemoteMenuOpen && !pushTargetBranchMenuOpen)) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (pushRemotePickerRef.current?.contains(target)) {
        return;
      }
      if (pushTargetBranchFieldRef.current?.contains(target)) {
        return;
      }
      setPushRemoteMenuOpen(false);
      setPushTargetBranchMenuOpen(false);
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pushDialogOpen, pushRemoteMenuOpen, pushTargetBranchMenuOpen]);

  useEffect(() => {
    if (previewFileKey && !previewDetailFile) {
      setPreviewFileKey(null);
    }
  }, [previewDetailFile, previewFileKey]);

  useEffect(() => {
    if (!pushPreviewDetails) {
      setPushPreviewExpandedDirs(new Set());
      setPushPreviewSelectedFileKey(null);
      setPushPreviewModalFileKey(null);
      return;
    }
    setPushPreviewExpandedDirs(collectDirPaths(pushPreviewDetails.files));
    setPushPreviewSelectedFileKey((previousKey) =>
      pickSelectedFileKey(previousKey, pushPreviewDetails.files),
    );
    // Diff modal should only open when user explicitly clicks a file item.
    setPushPreviewModalFileKey(null);
  }, [pushPreviewDetails]);

  useEffect(() => {
    if (pushPreviewModalFileKey && !pushPreviewModalFile) {
      setPushPreviewModalFileKey(null);
    }
  }, [pushPreviewModalFile, pushPreviewModalFileKey]);
}
