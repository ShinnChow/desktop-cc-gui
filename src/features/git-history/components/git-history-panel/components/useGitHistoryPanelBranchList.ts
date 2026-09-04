import {
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { TFunction } from "i18next";
import type {
  GitBranchListItem,
  GitCommitDetails,
  GitCommitDiff,
} from "../../../../../types";
import type {
  BranchContextMenuState,
  BranchDiffState,
  BranchGroup,
} from "./GitHistoryPanelTypes";
import { getBranchScope } from "../utils/gitHistoryPanelSharedUtils";

type BranchListScope = {
  branchCompareDetailsCacheRef: MutableRefObject<Map<string, GitCommitDetails>>;
  branchContextMenu: BranchContextMenuState | null;
  branchContextMenuRef: MutableRefObject<HTMLDivElement | null>;
  branchDiffCacheRef: MutableRefObject<Map<string, GitCommitDiff>>;
  branchQuery: string;
  closeBranchContextMenu: () => void;
  createBranchDialogOpen: boolean;
  createBranchNameInputRef: MutableRefObject<HTMLInputElement | null>;
  currentBranch: string | null;
  localBranches: GitBranchListItem[];
  remoteBranches: GitBranchListItem[];
  renameBranchDialogOpen: boolean;
  renameBranchNameInputRef: MutableRefObject<HTMLInputElement | null>;
  setBranchDiffState: Dispatch<SetStateAction<BranchDiffState | null>>;
  setComparePreviewFileKey: Dispatch<SetStateAction<string | null>>;
  setExpandedLocalScopes: Dispatch<SetStateAction<Set<string>>>;
  setExpandedRemoteScopes: Dispatch<SetStateAction<Set<string>>>;
  setLocalSectionExpanded: Dispatch<SetStateAction<boolean>>;
  setRemoteSectionExpanded: Dispatch<SetStateAction<boolean>>;
  t: TFunction<"translation", undefined>;
  workspaceId: string | null;
};

export function useGitHistoryPanelBranchList(scope: BranchListScope) {
  const {
    branchCompareDetailsCacheRef,
    branchContextMenu,
    branchContextMenuRef,
    branchDiffCacheRef,
    branchQuery,
    closeBranchContextMenu,
    createBranchDialogOpen,
    createBranchNameInputRef,
    currentBranch,
    localBranches,
    remoteBranches,
    renameBranchDialogOpen,
    renameBranchNameInputRef,
    setBranchDiffState,
    setComparePreviewFileKey,
    setExpandedLocalScopes,
    setExpandedRemoteScopes,
    setLocalSectionExpanded,
    setRemoteSectionExpanded,
    t,
    workspaceId,
  } = scope;

  const filteredLocalBranches = useMemo(() => {
    const needle = branchQuery.trim().toLowerCase();
    if (!needle) {
      return localBranches;
    }
    return localBranches.filter((entry) =>
      entry.name.toLowerCase().includes(needle),
    );
  }, [branchQuery, localBranches]);

  const filteredRemoteBranches = useMemo(() => {
    const needle = branchQuery.trim().toLowerCase();
    if (!needle) {
      return remoteBranches;
    }
    return remoteBranches.filter((entry) =>
      entry.name.toLowerCase().includes(needle),
    );
  }, [branchQuery, remoteBranches]);

  const groupedRemoteBranches = useMemo(() => {
    const groups = new Map<string, GitBranchListItem[]>();
    for (const entry of filteredRemoteBranches) {
      const group = entry.remote ?? entry.name.split("/")[0] ?? "remote";
      const existing = groups.get(group) ?? [];
      existing.push(entry);
      groups.set(group, existing);
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([remote, items]) => ({
        remote,
        items: items
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name)),
      }));
  }, [filteredRemoteBranches]);

  const groupedLocalBranches = useMemo<BranchGroup[]>(() => {
    const groups = new Map<string, GitBranchListItem[]>();
    for (const entry of filteredLocalBranches) {
      const scope = getBranchScope(entry.name);
      const items = groups.get(scope) ?? [];
      items.push(entry);
      groups.set(scope, items);
    }
    return Array.from(groups.entries())
      .sort(([left], [right]) => {
        if (left === "__root__") {
          return -1;
        }
        if (right === "__root__") {
          return 1;
        }
        return left.localeCompare(right);
      })
      .map(([key, items]) => ({
        key,
        label:
          key === "__root__" ? t("git.historyRootGroup") : key.toUpperCase(),
        items: items
          .slice()
          .sort((left, right) => left.name.localeCompare(right.name)),
      }));
  }, [filteredLocalBranches, t]);

  const createBranchSourceOptions = useMemo(() => {
    const names = new Set(localBranches.map((entry) => entry.name));
    if (currentBranch) {
      names.add(currentBranch);
    }
    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [currentBranch, localBranches]);

  useEffect(() => {
    if (branchQuery.trim()) {
      setLocalSectionExpanded(true);
      setRemoteSectionExpanded(true);
    }
  }, [branchQuery]);

  useEffect(() => {
    setExpandedLocalScopes((prev) => {
      const next = new Set<string>();
      const activeScope = currentBranch ? getBranchScope(currentBranch) : null;
      const searching = branchQuery.trim().length > 0;
      for (const group of groupedLocalBranches) {
        if (
          searching ||
          prev.has(group.key) ||
          group.key === "__root__" ||
          group.key === activeScope
        ) {
          next.add(group.key);
        }
      }
      return next;
    });
  }, [branchQuery, currentBranch, groupedLocalBranches]);

  useEffect(() => {
    setExpandedRemoteScopes((prev) => {
      const next = new Set<string>();
      const searching = branchQuery.trim().length > 0;
      for (const group of groupedRemoteBranches) {
        if (searching || prev.has(group.remote)) {
          next.add(group.remote);
        }
      }
      return next;
    });
  }, [branchQuery, groupedRemoteBranches]);

  useEffect(() => {
    if (!createBranchDialogOpen) {
      return;
    }
    createBranchNameInputRef.current?.focus();
  }, [createBranchDialogOpen]);

  useEffect(() => {
    if (!renameBranchDialogOpen) {
      return;
    }
    renameBranchNameInputRef.current?.focus();
    renameBranchNameInputRef.current?.select();
  }, [renameBranchDialogOpen]);

  useEffect(() => {
    setBranchDiffState(null);
    branchDiffCacheRef.current.clear();
    branchCompareDetailsCacheRef.current.clear();
    setComparePreviewFileKey(null);
  }, [workspaceId]);

  useEffect(() => {
    if (createBranchDialogOpen && branchContextMenu) {
      closeBranchContextMenu();
    }
  }, [branchContextMenu, closeBranchContextMenu, createBranchDialogOpen]);

  useEffect(() => {
    if (renameBranchDialogOpen && branchContextMenu) {
      closeBranchContextMenu();
    }
  }, [branchContextMenu, closeBranchContextMenu, renameBranchDialogOpen]);

  useEffect(() => {
    if (!branchContextMenu) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      if (!branchContextMenuRef.current?.contains(target)) {
        closeBranchContextMenu();
      }
    };
    const handleWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeBranchContextMenu();
      }
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
    };
  }, [branchContextMenu, closeBranchContextMenu]);

  return {
    createBranchSourceOptions,
    groupedLocalBranches,
    groupedRemoteBranches,
  };
}
