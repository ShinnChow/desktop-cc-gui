import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { TFunction } from "i18next";
import { copyTextToClipboard } from "../../../../../utils/clipboard";
import {
  isWorkingTreeDirtyBlockingError,
  localizeGitErrorMessage,
} from "../../../gitErrorI18n";
import type {
  ForceDeleteDialogMode,
  ForceDeleteDialogState,
  GitOperationErrorState,
  GitOperationNoticeState,
} from "./GitHistoryPanelTypes";

type OperationFeedbackScope = {
  createPrProgressTimerRef: MutableRefObject<number | null>;
  forceDeleteDialogResolverRef: MutableRefObject<((confirmed: boolean) => void) | null>;
  forceDeleteDialogState: ForceDeleteDialogState | null;
  operationLoading: string | null;
  operationNoticeTimerRef: MutableRefObject<number | null>;
  refreshAll: () => Promise<void>;
  setForceDeleteCopiedPath: Dispatch<SetStateAction<boolean>>;
  setForceDeleteCountdown: Dispatch<SetStateAction<number>>;
  setForceDeleteDialogState: Dispatch<SetStateAction<ForceDeleteDialogState | null>>;
  setOperationLoading: Dispatch<SetStateAction<string | null>>;
  setOperationNotice: Dispatch<SetStateAction<GitOperationNoticeState | null>>;
  t: TFunction<"translation", undefined>;
};

export function useGitHistoryPanelOperationFeedback(scope: OperationFeedbackScope) {
  const {
    createPrProgressTimerRef,
    forceDeleteDialogResolverRef,
    forceDeleteDialogState,
    operationLoading,
    operationNoticeTimerRef,
    refreshAll,
    setForceDeleteCopiedPath,
    setForceDeleteCountdown,
    setForceDeleteDialogState,
    setOperationLoading,
    setOperationNotice,
    t,
  } = scope;

  const getOperationDisplayName = useCallback(
    (operationName: string) => {
      const nameMap: Record<string, string> = {
        pull: t("git.pull"),
        push: t("git.push"),
        createPr: t("git.historyOperationCreatePr"),
        sync: t("git.sync"),
        fetch: t("git.fetch"),
        refresh: t("git.refresh"),
        checkout: t("git.historyOperationCheckout"),
        createBranch: t("git.historyOperationCreateBranch"),
        createFromCommit: t("git.historyOperationCreateFromCommit"),
        deleteBranch: t("git.historyOperationDeleteBranch"),
        renameBranch: t("git.historyOperationRenameBranch"),
        mergeBranch: t("git.historyOperationMergeBranch"),
        checkoutRebase: t("git.historyOperationCheckoutAndRebase"),
        rebaseBranch: t("git.historyOperationRebaseCurrentBranch"),
        reset: t("git.historyOperationReset"),
        revert: t("git.historyOperationRevertCommit"),
        "cherry-pick": t("git.historyOperationCherryPick"),
        updateBranch: t("git.historyOperationUpdateBranch"),
      };
      return nameMap[operationName] ?? operationName;
    },
    [t],
  );

  const clearOperationNotice = useCallback(() => {
    if (operationNoticeTimerRef.current !== null) {
      window.clearTimeout(operationNoticeTimerRef.current);
      operationNoticeTimerRef.current = null;
    }
    setOperationNotice(null);
  }, []);

  const showOperationNotice = useCallback((notice: GitOperationNoticeState) => {
    if (operationNoticeTimerRef.current !== null) {
      window.clearTimeout(operationNoticeTimerRef.current);
      operationNoticeTimerRef.current = null;
    }
    setOperationNotice(notice);
    if (notice.kind === "success") {
      operationNoticeTimerRef.current = window.setTimeout(() => {
        setOperationNotice(null);
        operationNoticeTimerRef.current = null;
      }, 5000);
    }
  }, []);

  const clearCreatePrProgressTimer = useCallback(() => {
    if (createPrProgressTimerRef.current !== null) {
      window.clearInterval(createPrProgressTimerRef.current);
      createPrProgressTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (operationNoticeTimerRef.current !== null) {
        window.clearTimeout(operationNoticeTimerRef.current);
      }
      clearCreatePrProgressTimer();
      if (forceDeleteDialogResolverRef.current) {
        forceDeleteDialogResolverRef.current(false);
        forceDeleteDialogResolverRef.current = null;
      }
    };
  }, [clearCreatePrProgressTimer]);

  const localizedOperationName = useMemo(() => {
    if (!operationLoading) {
      return null;
    }
    return getOperationDisplayName(operationLoading);
  }, [getOperationDisplayName, operationLoading]);

  const localizeKnownGitError = useCallback(
    (message: string | null): string | null => {
      return localizeGitErrorMessage(message, t);
    },
    [t],
  );

  const createOperationErrorState = useCallback(
    (rawMessage: string): GitOperationErrorState => {
      const normalized = rawMessage.toLowerCase();
      if (isWorkingTreeDirtyBlockingError(rawMessage)) {
        return {
          userMessage: t("git.historyErrorWorkingTreeDirty"),
          debugMessage: rawMessage,
          retryable: true,
        };
      }
      if (normalized.includes("snapshot expired")) {
        return {
          userMessage: t("git.historySnapshotExpired"),
          debugMessage: rawMessage,
          retryable: true,
        };
      }
      return {
        userMessage: localizeKnownGitError(rawMessage) ?? rawMessage,
        debugMessage: rawMessage,
        retryable: true,
      };
    },
    [localizeKnownGitError, t],
  );

  const isBranchDeleteNotFullyMergedError = useCallback(
    (rawMessage: string): boolean => {
      const normalized = rawMessage.toLowerCase();
      return normalized.includes("is not fully merged");
    },
    [],
  );

  const isBranchDeleteUsedByWorktreeError = useCallback(
    (rawMessage: string): boolean => {
      const normalized = rawMessage.toLowerCase();
      return (
        normalized.includes("cannot delete branch") &&
        normalized.includes("used by worktree")
      );
    },
    [],
  );

  const extractWorktreePathFromDeleteError = useCallback(
    (rawMessage: string): string | null => {
      const matched = rawMessage.match(
        /used by worktree at ['"]?([^'"\n]+)['"]?/i,
      );
      const path = matched?.[1]?.trim();
      return path ? path : null;
    },
    [],
  );

  const promptForceDeleteDialog = useCallback(
    (
      mode: ForceDeleteDialogMode,
      branch: string,
      worktreePath: string | null,
    ) =>
      new Promise<boolean>((resolve) => {
        forceDeleteDialogResolverRef.current = resolve;
        setForceDeleteDialogState({ mode, branch, worktreePath });
      }),
    [],
  );

  const closeForceDeleteDialog = useCallback((confirmed: boolean) => {
    setForceDeleteDialogState(null);
    const resolver = forceDeleteDialogResolverRef.current;
    forceDeleteDialogResolverRef.current = null;
    resolver?.(confirmed);
  }, []);

  useEffect(() => {
    if (!forceDeleteDialogState) {
      setForceDeleteCountdown(0);
      setForceDeleteCopiedPath(false);
      return;
    }
    setForceDeleteCountdown(2);
    setForceDeleteCopiedPath(false);
    const timer = window.setInterval(() => {
      setForceDeleteCountdown((previous) => (previous > 0 ? previous - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [forceDeleteDialogState]);

  const handleCopyForceDeleteWorktreePath = useCallback(async () => {
    const path = forceDeleteDialogState?.worktreePath;
    if (!path) {
      return;
    }
    if (await copyTextToClipboard(path)) {
      setForceDeleteCopiedPath(true);
      window.setTimeout(() => setForceDeleteCopiedPath(false), 1200);
    } else {
      setForceDeleteCopiedPath(false);
    }
  }, [forceDeleteDialogState?.worktreePath]);

  const runOperation = useCallback(
    async (name: string, action: () => Promise<void>) => {
      clearOperationNotice();
      setOperationLoading(name);
      try {
        await action();
        await refreshAll();
        showOperationNotice({
          kind: "success",
          message: t("git.historyOperationSucceeded", {
            operation: getOperationDisplayName(name),
          }),
        });
      } catch (error) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        const operationState = createOperationErrorState(rawMessage);
        showOperationNotice({
          kind: "error",
          message: `${t("git.historyOperationFailed", {
            operation: getOperationDisplayName(name),
          })} ${operationState.userMessage}${
            operationState.retryable
              ? ` ${t("git.historyOperationRetryHint")}`
              : ""
          }`,
          debugMessage: operationState.debugMessage,
        });
      } finally {
        setOperationLoading(null);
      }
    },
    [
      clearOperationNotice,
      createOperationErrorState,
      getOperationDisplayName,
      refreshAll,
      showOperationNotice,
      t,
    ],
  );

  return {
    closeForceDeleteDialog,
    clearOperationNotice,
    createOperationErrorState,
    extractWorktreePathFromDeleteError,
    getOperationDisplayName,
    handleCopyForceDeleteWorktreePath,
    isBranchDeleteNotFullyMergedError,
    isBranchDeleteUsedByWorktreeError,
    localizeKnownGitError,
    localizedOperationName,
    promptForceDeleteDialog,
    runOperation,
    showOperationNotice,
  };
}
