import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { GitHistoryCommit } from "../../../../../types";
import {
  PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT,
  PUSH_TARGET_MENU_MAX_HEIGHT,
  PUSH_TARGET_MENU_MIN_HEIGHT,
  PUSH_TARGET_MENU_VIEWPORT_PADDING,
  scrollElementToTop,
} from "./GitHistoryPanelImplHelpers";
import type { PushTargetBranchGroup } from "./GitHistoryPanelTypes";
import { getBranchScope } from "../utils/gitHistoryPanelSharedUtils";

type PushPullMenusScope = {
  currentBranch: string | null;
  pullDialogOpen: boolean;
  pullRemoteMenuOpen: boolean;
  pullSubmitting: boolean;
  pullTargetBranchActiveScopeTab: string | null;
  pullTargetBranchGroups: PushTargetBranchGroup[];
  pullTargetBranchMenuOpen: boolean;
  pullTargetBranchMenuRef: MutableRefObject<HTMLDivElement | null>;
  pullTargetBranchPickerRef: MutableRefObject<HTMLDivElement | null>;
  pullTargetBranchTrimmed: string;
  pushDialogOpen: boolean;
  pushPreviewCommits: GitHistoryCommit[];
  pushPreviewError: string | null;
  pushPreviewLoading: boolean;
  pushPreviewSelectedSha: string | null;
  pushPreviewTargetFound: boolean;
  pushRemoteMenuOpen: boolean;
  pushRemoteTrimmed: string;
  pushSubmitting: boolean;
  pushTargetBranchActiveScopeTab: string | null;
  pushTargetBranchGroups: PushTargetBranchGroup[];
  pushTargetBranchMenuOpen: boolean;
  pushTargetBranchMenuRef: MutableRefObject<HTMLDivElement | null>;
  pushTargetBranchPickerRef: MutableRefObject<HTMLDivElement | null>;
  pushTargetBranchTrimmed: string;
  pushToGerrit: boolean;
  setPullOptionsMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullRemoteMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullRemoteMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPullTargetBranchActiveScopeTab: Dispatch<SetStateAction<string | null>>;
  setPullTargetBranchMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPullTargetBranchMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPullTargetBranchQuery: Dispatch<SetStateAction<string>>;
  setPushRemoteMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPushRemoteMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPushTargetBranchActiveScopeTab: Dispatch<SetStateAction<string | null>>;
  setPushTargetBranchMenuOpen: Dispatch<SetStateAction<boolean>>;
  setPushTargetBranchMenuPlacement: Dispatch<SetStateAction<"down" | "up">>;
  setPushTargetBranchQuery: Dispatch<SetStateAction<string>>;
  workspaceId: string | null;
};

export function useGitHistoryPanelPushPullMenus(scope: PushPullMenusScope) {
  const {
    currentBranch,
    pullDialogOpen,
    pullRemoteMenuOpen,
    pullSubmitting,
    pullTargetBranchActiveScopeTab,
    pullTargetBranchGroups,
    pullTargetBranchMenuOpen,
    pullTargetBranchMenuRef,
    pullTargetBranchPickerRef,
    pullTargetBranchTrimmed,
    pushDialogOpen,
    pushPreviewCommits,
    pushPreviewError,
    pushPreviewLoading,
    pushPreviewSelectedSha,
    pushPreviewTargetFound,
    pushRemoteMenuOpen,
    pushRemoteTrimmed,
    pushSubmitting,
    pushTargetBranchActiveScopeTab,
    pushTargetBranchGroups,
    pushTargetBranchMenuOpen,
    pushTargetBranchMenuRef,
    pushTargetBranchPickerRef,
    pushTargetBranchTrimmed,
    pushToGerrit,
    setPullOptionsMenuOpen,
    setPullRemoteMenuOpen,
    setPullRemoteMenuPlacement,
    setPullTargetBranchActiveScopeTab,
    setPullTargetBranchMenuOpen,
    setPullTargetBranchMenuPlacement,
    setPullTargetBranchQuery,
    setPushRemoteMenuOpen,
    setPushRemoteMenuPlacement,
    setPushTargetBranchActiveScopeTab,
    setPushTargetBranchMenuOpen,
    setPushTargetBranchMenuPlacement,
    setPushTargetBranchQuery,
    workspaceId,
  } = scope;

  useEffect(() => {
    if (!pullTargetBranchMenuOpen) {
      return;
    }
    const availableScopes = pullTargetBranchGroups.map((group) => group.scope);
    const currentBranchScope = currentBranch
      ? getBranchScope(currentBranch)
      : null;
    const selectedScope = pullTargetBranchTrimmed
      ? getBranchScope(pullTargetBranchTrimmed)
      : null;
    setPullTargetBranchActiveScopeTab((previous) => {
      if (currentBranchScope && availableScopes.includes(currentBranchScope)) {
        return currentBranchScope;
      }
      if (selectedScope && availableScopes.includes(selectedScope)) {
        return selectedScope;
      }
      if (previous && availableScopes.includes(previous)) {
        return previous;
      }
      return availableScopes[0] ?? null;
    });
  }, [
    currentBranch,
    pullTargetBranchGroups,
    pullTargetBranchMenuOpen,
    pullTargetBranchTrimmed,
  ]);

  useEffect(() => {
    if (!pushTargetBranchMenuOpen) {
      return;
    }
    const availableScopes = pushTargetBranchGroups.map((group) => group.scope);
    const currentBranchScope = currentBranch
      ? getBranchScope(currentBranch)
      : null;
    const selectedScope = pushTargetBranchTrimmed
      ? getBranchScope(pushTargetBranchTrimmed)
      : null;
    setPushTargetBranchActiveScopeTab((previous) => {
      if (currentBranchScope && availableScopes.includes(currentBranchScope)) {
        return currentBranchScope;
      }
      if (selectedScope && availableScopes.includes(selectedScope)) {
        return selectedScope;
      }
      if (previous && availableScopes.includes(previous)) {
        return previous;
      }
      return availableScopes[0] ?? null;
    });
  }, [
    currentBranch,
    pushTargetBranchGroups,
    pushTargetBranchMenuOpen,
    pushTargetBranchTrimmed,
  ]);

  const updatePullTargetBranchMenuPlacement = useCallback(() => {
    if (typeof window === "undefined") {
      setPullTargetBranchMenuPlacement("down");
      return;
    }
    const anchorElement = pullTargetBranchPickerRef.current;
    if (!anchorElement) {
      setPullTargetBranchMenuPlacement("down");
      return;
    }
    const anchorRect = anchorElement.getBoundingClientRect();
    const spaceAbove = anchorRect.top - PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const spaceBelow =
      window.innerHeight -
      anchorRect.bottom -
      PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const estimatedRowCount = pullTargetBranchGroups.reduce(
      (total, group) => total + group.items.length + 1,
      0,
    );
    const estimatedMenuHeight = Math.max(
      PUSH_TARGET_MENU_MIN_HEIGHT,
      Math.min(
        PUSH_TARGET_MENU_MAX_HEIGHT,
        estimatedRowCount * PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT + 28,
      ),
    );
    const shouldOpenUpward =
      spaceBelow < estimatedMenuHeight &&
      spaceAbove > spaceBelow &&
      spaceAbove > PUSH_TARGET_MENU_MIN_HEIGHT;
    setPullTargetBranchMenuPlacement(shouldOpenUpward ? "up" : "down");
  }, [pullTargetBranchGroups]);

  const updatePullRemoteMenuPlacement = useCallback(() => {
    setPullRemoteMenuPlacement("up");
  }, []);

  const openPullTargetBranchMenu = useCallback(
    (resetQuery: boolean) => {
      if (pullSubmitting) {
        return;
      }
      setPullRemoteMenuOpen(false);
      setPullOptionsMenuOpen(false);
      if (resetQuery) {
        setPullTargetBranchQuery("");
      }
      updatePullTargetBranchMenuPlacement();
      setPullTargetBranchMenuOpen(true);
    },
    [pullSubmitting, updatePullTargetBranchMenuPlacement],
  );

  useEffect(() => {
    if (!pullDialogOpen || !pullTargetBranchMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePullTargetBranchMenuPlacement();
    handleLayoutChange();
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, scrollOptions);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, scrollOptions);
    };
  }, [
    pullDialogOpen,
    pullTargetBranchMenuOpen,
    updatePullTargetBranchMenuPlacement,
  ]);

  useEffect(() => {
    if (!pullTargetBranchMenuOpen) {
      return;
    }
    scrollElementToTop(pullTargetBranchMenuRef.current);
  }, [pullTargetBranchActiveScopeTab, pullTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pullDialogOpen || !pullRemoteMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePullRemoteMenuPlacement();
    handleLayoutChange();
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, scrollOptions);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, scrollOptions);
    };
  }, [pullDialogOpen, pullRemoteMenuOpen, updatePullRemoteMenuPlacement]);

  const updatePushTargetBranchMenuPlacement = useCallback(() => {
    if (typeof window === "undefined") {
      setPushTargetBranchMenuPlacement("down");
      return;
    }
    const anchorElement = pushTargetBranchPickerRef.current;
    if (!anchorElement) {
      setPushTargetBranchMenuPlacement("down");
      return;
    }
    const anchorRect = anchorElement.getBoundingClientRect();
    const spaceAbove = anchorRect.top - PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const spaceBelow =
      window.innerHeight -
      anchorRect.bottom -
      PUSH_TARGET_MENU_VIEWPORT_PADDING;
    const estimatedRowCount = pushTargetBranchGroups.reduce(
      (total, group) => total + group.items.length + 1,
      0,
    );
    const estimatedMenuHeight = Math.max(
      PUSH_TARGET_MENU_MIN_HEIGHT,
      Math.min(
        PUSH_TARGET_MENU_MAX_HEIGHT,
        estimatedRowCount * PUSH_TARGET_MENU_ESTIMATED_ROW_HEIGHT + 28,
      ),
    );
    const shouldOpenUpward =
      spaceBelow < estimatedMenuHeight &&
      spaceAbove > spaceBelow &&
      spaceAbove > PUSH_TARGET_MENU_MIN_HEIGHT;
    setPushTargetBranchMenuPlacement(shouldOpenUpward ? "up" : "down");
  }, [pushTargetBranchGroups]);

  const updatePushRemoteMenuPlacement = useCallback(() => {
    setPushRemoteMenuPlacement("up");
  }, []);

  const openPushTargetBranchMenu = useCallback(
    (resetQuery: boolean) => {
      if (pushSubmitting) {
        return;
      }
      setPushRemoteMenuOpen(false);
      if (resetQuery) {
        setPushTargetBranchQuery("");
      }
      updatePushTargetBranchMenuPlacement();
      setPushTargetBranchMenuOpen(true);
    },
    [pushSubmitting, updatePushTargetBranchMenuPlacement],
  );

  useEffect(() => {
    if (!pushDialogOpen || !pushTargetBranchMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePushTargetBranchMenuPlacement();
    handleLayoutChange();
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, scrollOptions);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, scrollOptions);
    };
  }, [
    pushDialogOpen,
    pushTargetBranchMenuOpen,
    updatePushTargetBranchMenuPlacement,
  ]);

  useEffect(() => {
    if (!pushTargetBranchMenuOpen) {
      return;
    }
    scrollElementToTop(pushTargetBranchMenuRef.current);
  }, [pushTargetBranchActiveScopeTab, pushTargetBranchMenuOpen]);

  useEffect(() => {
    if (!pushDialogOpen || !pushRemoteMenuOpen) {
      return;
    }
    const handleLayoutChange = () => updatePushRemoteMenuPlacement();
    handleLayoutChange();
    const scrollOptions = { capture: true, passive: true } as const;
    window.addEventListener("resize", handleLayoutChange);
    window.addEventListener("scroll", handleLayoutChange, scrollOptions);
    return () => {
      window.removeEventListener("resize", handleLayoutChange);
      window.removeEventListener("scroll", handleLayoutChange, scrollOptions);
    };
  }, [pushDialogOpen, pushRemoteMenuOpen, updatePushRemoteMenuPlacement]);

  const pushHasOutgoingCommits = pushPreviewCommits.length > 0;
  const pushIsNewBranchTarget = Boolean(
    pushDialogOpen &&
    !pushPreviewLoading &&
    !pushPreviewError &&
    !pushPreviewTargetFound,
  );
  const pushTargetSummaryBranch = useMemo(() => {
    const targetBranch = pushTargetBranchTrimmed || currentBranch || "main";
    if (pushToGerrit) {
      return `refs/for/${targetBranch}`;
    }
    return targetBranch;
  }, [currentBranch, pushTargetBranchTrimmed, pushToGerrit]);
  const pushPreviewSelectedCommit = useMemo(
    () =>
      pushPreviewCommits.find(
        (entry) => entry.sha === pushPreviewSelectedSha,
      ) ?? null,
    [pushPreviewCommits, pushPreviewSelectedSha],
  );

  const pushCanConfirm = Boolean(
    workspaceId &&
    !pushSubmitting &&
    pushRemoteTrimmed &&
    pushTargetBranchTrimmed &&
    !pushPreviewLoading &&
    !pushPreviewError &&
    pushHasOutgoingCommits,
  );

  return {
    openPullTargetBranchMenu,
    openPushTargetBranchMenu,
    pushCanConfirm,
    pushHasOutgoingCommits,
    pushIsNewBranchTarget,
    pushPreviewSelectedCommit,
    pushTargetSummaryBranch,
    updatePullRemoteMenuPlacement,
    updatePushRemoteMenuPlacement,
  };
}
