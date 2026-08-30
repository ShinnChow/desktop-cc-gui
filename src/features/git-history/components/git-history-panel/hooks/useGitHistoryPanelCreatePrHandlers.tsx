import { useCallback, useEffect } from "react";
import type { GitPrWorkflowDefaults } from "../../../../../types";
import { copyTextToClipboard } from "../../../../../utils/clipboard";
import type { GitHistoryPanelInteractionScope } from "../components/GitHistoryPanelImpl";

type CreatePrHandlersScope = Pick<
  GitHistoryPanelInteractionScope,
  | "CREATE_PR_PREVIEW_COMMIT_LIMIT"
  | "ask"
  | "buildCreatePrInitialStages"
  | "clearOperationNotice"
  | "createGitPrWorkflow"
  | "createPrCanConfirm"
  | "createPrCanOpen"
  | "createPrDefaultsLoadTokenRef"
  | "createPrDialogOpen"
  | "createPrForm"
  | "createPrPreviewBaseRef"
  | "createPrPreviewBaseRemoteName"
  | "createPrPreviewDetailsCacheRef"
  | "createPrPreviewDetailsLoadTokenRef"
  | "createPrPreviewHeadRef"
  | "createPrPreviewLoadTokenRef"
  | "createPrPreviewSelectedSha"
  | "createPrProgressTimerRef"
  | "createPrResult"
  | "createPrSubmitting"
  | "getGitBranchCompareCommits"
  | "getGitCommitDetails"
  | "getGitPrWorkflowDefaults"
  | "localizeKnownGitError"
  | "mapCreatePrStagesFromResult"
  | "setCreatePrCopiedPrUrl"
  | "setCreatePrCopiedRetryCommand"
  | "setCreatePrDefaults"
  | "setCreatePrDefaultsError"
  | "setCreatePrDefaultsLoading"
  | "setCreatePrDialogOpen"
  | "setCreatePrForm"
  | "setCreatePrPreviewBaseOnlyCount"
  | "setCreatePrPreviewCommits"
  | "setCreatePrPreviewDetails"
  | "setCreatePrPreviewDetailsError"
  | "setCreatePrPreviewDetailsLoading"
  | "setCreatePrPreviewError"
  | "setCreatePrPreviewExpanded"
  | "setCreatePrPreviewLoading"
  | "setCreatePrPreviewSelectedSha"
  | "setCreatePrResult"
  | "setCreatePrStages"
  | "setIsCreatePrDialogMaximized"
  | "setOperationLoading"
  | "showOperationNotice"
  | "splitGitHubRepo"
  | "t"
  | "workspaceId"
>;

export function useGitHistoryPanelCreatePrHandlers(
  scope: CreatePrHandlersScope,
) {
  const {
    CREATE_PR_PREVIEW_COMMIT_LIMIT,
    ask,
    buildCreatePrInitialStages,
    clearOperationNotice,
    createGitPrWorkflow,
    createPrCanConfirm,
    createPrCanOpen,
    createPrDefaultsLoadTokenRef,
    createPrDialogOpen,
    createPrForm,
    createPrPreviewBaseRef,
    createPrPreviewBaseRemoteName,
    createPrPreviewDetailsCacheRef,
    createPrPreviewDetailsLoadTokenRef,
    createPrPreviewHeadRef,
    createPrPreviewLoadTokenRef,
    createPrPreviewSelectedSha,
    createPrProgressTimerRef,
    createPrResult,
    createPrSubmitting,
    getGitBranchCompareCommits,
    getGitCommitDetails,
    getGitPrWorkflowDefaults,
    localizeKnownGitError,
    mapCreatePrStagesFromResult,
    setCreatePrCopiedPrUrl,
    setCreatePrCopiedRetryCommand,
    setCreatePrDefaults,
    setCreatePrDefaultsError,
    setCreatePrDefaultsLoading,
    setCreatePrDialogOpen,
    setCreatePrForm,
    setCreatePrPreviewBaseOnlyCount,
    setCreatePrPreviewCommits,
    setCreatePrPreviewDetails,
    setCreatePrPreviewDetailsError,
    setCreatePrPreviewDetailsLoading,
    setCreatePrPreviewError,
    setCreatePrPreviewExpanded,
    setCreatePrPreviewLoading,
    setCreatePrPreviewSelectedSha,
    setCreatePrResult,
    setCreatePrStages,
    setIsCreatePrDialogMaximized,
    setOperationLoading,
    showOperationNotice,
    splitGitHubRepo,
    t,
    workspaceId,
  } = scope;

  const applyCreatePrDefaults = useCallback(
    (defaults: GitPrWorkflowDefaults) => {
      setCreatePrDefaults(defaults);
      setCreatePrForm({
        upstreamRepo: defaults.upstreamRepo,
        baseBranch: defaults.baseBranch,
        headOwner: defaults.headOwner,
        headBranch: defaults.headBranch,
        title: defaults.title,
        body: defaults.body,
        commentAfterCreate: true,
        commentBody: defaults.commentBody,
      });
    },
    [setCreatePrDefaults, setCreatePrForm],
  );

  const closeCreatePrDialog = useCallback(() => {
    if (createPrSubmitting) {
      return;
    }
    if (createPrProgressTimerRef.current !== null) {
      window.clearInterval(createPrProgressTimerRef.current);
      createPrProgressTimerRef.current = null;
    }
    createPrDefaultsLoadTokenRef.current += 1;
    createPrPreviewLoadTokenRef.current += 1;
    createPrPreviewDetailsLoadTokenRef.current += 1;
    setCreatePrDefaultsLoading(false);
    setCreatePrPreviewLoading(false);
    setCreatePrPreviewDetailsLoading(false);
    setCreatePrPreviewExpanded(false);
    setIsCreatePrDialogMaximized(false);
    setCreatePrDialogOpen(false);
  }, [
    createPrDefaultsLoadTokenRef,
    createPrPreviewDetailsLoadTokenRef,
    createPrPreviewLoadTokenRef,
    createPrProgressTimerRef,
    createPrSubmitting,
    setCreatePrDefaultsLoading,
    setCreatePrDialogOpen,
    setCreatePrPreviewDetailsLoading,
    setCreatePrPreviewExpanded,
    setCreatePrPreviewLoading,
    setIsCreatePrDialogMaximized,
  ]);

  const handleCreatePrHeadRepositoryChange = useCallback(
    (nextRepository: string) => {
      const { owner } = splitGitHubRepo(nextRepository);
      setCreatePrForm((previous) => ({
        ...previous,
        headOwner: owner || nextRepository.trim(),
      }));
    },
    [setCreatePrForm, splitGitHubRepo],
  );

  const loadCreatePrCommitPreview = useCallback(async () => {
    if (!workspaceId || !createPrDialogOpen) {
      return;
    }
    if (!createPrPreviewHeadRef || !createPrPreviewBaseRef) {
      createPrPreviewLoadTokenRef.current += 1;
      createPrPreviewDetailsLoadTokenRef.current += 1;
      setCreatePrPreviewLoading(false);
      setCreatePrPreviewError(null);
      setCreatePrPreviewCommits([]);
      setCreatePrPreviewBaseOnlyCount(0);
      setCreatePrPreviewSelectedSha(null);
      setCreatePrPreviewDetails(null);
      setCreatePrPreviewDetailsLoading(false);
      setCreatePrPreviewDetailsError(null);
      return;
    }
    const loadToken = createPrPreviewLoadTokenRef.current + 1;
    createPrPreviewLoadTokenRef.current = loadToken;
    setCreatePrPreviewLoading(true);
    setCreatePrPreviewError(null);
    try {
      const commitSets = await getGitBranchCompareCommits(
        workspaceId,
        createPrPreviewHeadRef,
        createPrPreviewBaseRef,
        CREATE_PR_PREVIEW_COMMIT_LIMIT,
      );
      if (loadToken !== createPrPreviewLoadTokenRef.current) {
        return;
      }
      setCreatePrPreviewCommits(commitSets.targetOnlyCommits);
      setCreatePrPreviewBaseOnlyCount(commitSets.currentOnlyCommits.length);
      setCreatePrPreviewSelectedSha((previous) => {
        if (
          previous &&
          commitSets.targetOnlyCommits.some((entry) => entry.sha === previous)
        ) {
          return previous;
        }
        return commitSets.targetOnlyCommits[0]?.sha ?? null;
      });
    } catch (error) {
      if (loadToken !== createPrPreviewLoadTokenRef.current) {
        return;
      }
      const raw = error instanceof Error ? error.message : String(error);
      setCreatePrPreviewError(localizeKnownGitError(raw) ?? raw);
      setCreatePrPreviewCommits([]);
      setCreatePrPreviewBaseOnlyCount(0);
      setCreatePrPreviewSelectedSha(null);
      setCreatePrPreviewDetails(null);
      setCreatePrPreviewDetailsLoading(false);
      setCreatePrPreviewDetailsError(null);
    } finally {
      if (loadToken === createPrPreviewLoadTokenRef.current) {
        setCreatePrPreviewLoading(false);
      }
    }
  }, [
    CREATE_PR_PREVIEW_COMMIT_LIMIT,
    createPrDialogOpen,
    createPrPreviewBaseRef,
    createPrPreviewDetailsLoadTokenRef,
    createPrPreviewHeadRef,
    createPrPreviewLoadTokenRef,
    getGitBranchCompareCommits,
    localizeKnownGitError,
    setCreatePrPreviewBaseOnlyCount,
    setCreatePrPreviewCommits,
    setCreatePrPreviewDetails,
    setCreatePrPreviewDetailsError,
    setCreatePrPreviewDetailsLoading,
    setCreatePrPreviewError,
    setCreatePrPreviewLoading,
    setCreatePrPreviewSelectedSha,
    workspaceId,
  ]);

  useEffect(() => {
    if (!createPrDialogOpen || !workspaceId) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadCreatePrCommitPreview();
    }, 300);
    return () => {
      window.clearTimeout(timer);
    };
  }, [
    createPrDialogOpen,
    createPrForm.baseBranch,
    createPrForm.headBranch,
    createPrPreviewBaseRemoteName,
    loadCreatePrCommitPreview,
    workspaceId,
  ]);

  useEffect(() => {
    if (!createPrDialogOpen || !workspaceId || !createPrPreviewSelectedSha) {
      createPrPreviewDetailsLoadTokenRef.current += 1;
      setCreatePrPreviewDetails(null);
      setCreatePrPreviewDetailsLoading(false);
      setCreatePrPreviewDetailsError(null);
      return;
    }
    const cached = createPrPreviewDetailsCacheRef.current.get(
      createPrPreviewSelectedSha,
    );
    if (cached) {
      setCreatePrPreviewDetails(cached);
      setCreatePrPreviewDetailsLoading(false);
      setCreatePrPreviewDetailsError(null);
      return;
    }
    const loadToken = createPrPreviewDetailsLoadTokenRef.current + 1;
    createPrPreviewDetailsLoadTokenRef.current = loadToken;
    setCreatePrPreviewDetailsLoading(true);
    setCreatePrPreviewDetailsError(null);
    void getGitCommitDetails(workspaceId, createPrPreviewSelectedSha)
      .then((response) => {
        if (loadToken !== createPrPreviewDetailsLoadTokenRef.current) {
          return;
        }
        createPrPreviewDetailsCacheRef.current.set(
          createPrPreviewSelectedSha,
          response,
        );
        setCreatePrPreviewDetails(response);
      })
      .catch((error) => {
        if (loadToken !== createPrPreviewDetailsLoadTokenRef.current) {
          return;
        }
        const raw = error instanceof Error ? error.message : String(error);
        setCreatePrPreviewDetails(null);
        setCreatePrPreviewDetailsError(localizeKnownGitError(raw) ?? raw);
      })
      .finally(() => {
        if (loadToken === createPrPreviewDetailsLoadTokenRef.current) {
          setCreatePrPreviewDetailsLoading(false);
        }
      });
  }, [
    createPrDialogOpen,
    createPrPreviewDetailsCacheRef,
    createPrPreviewDetailsLoadTokenRef,
    createPrPreviewSelectedSha,
    getGitCommitDetails,
    localizeKnownGitError,
    setCreatePrPreviewDetails,
    setCreatePrPreviewDetailsError,
    setCreatePrPreviewDetailsLoading,
    workspaceId,
  ]);

  const handleOpenCreatePrDialog = useCallback(() => {
    if (!workspaceId || !createPrCanOpen) {
      return;
    }
    createPrPreviewLoadTokenRef.current += 1;
    createPrPreviewDetailsLoadTokenRef.current += 1;
    createPrPreviewDetailsCacheRef.current.clear();
    setCreatePrDialogOpen(true);
    setIsCreatePrDialogMaximized(false);
    setCreatePrDefaultsLoading(true);
    setCreatePrDefaultsError(null);
    setCreatePrDefaults(null);
    setCreatePrResult(null);
    setCreatePrCopiedPrUrl(false);
    setCreatePrCopiedRetryCommand(false);
    setCreatePrPreviewLoading(false);
    setCreatePrPreviewError(null);
    setCreatePrPreviewCommits([]);
    setCreatePrPreviewBaseOnlyCount(0);
    setCreatePrPreviewSelectedSha(null);
    setCreatePrPreviewExpanded(false);
    setCreatePrPreviewDetails(null);
    setCreatePrPreviewDetailsLoading(false);
    setCreatePrPreviewDetailsError(null);
    setCreatePrStages(buildCreatePrInitialStages(t));
    const defaultsRequestToken = createPrDefaultsLoadTokenRef.current + 1;
    createPrDefaultsLoadTokenRef.current = defaultsRequestToken;
    void getGitPrWorkflowDefaults(workspaceId)
      .then((defaults) => {
        if (defaultsRequestToken !== createPrDefaultsLoadTokenRef.current) {
          return;
        }
        applyCreatePrDefaults(defaults);
        if (!defaults.canCreate && defaults.disabledReason) {
          setCreatePrDefaultsError(defaults.disabledReason);
        }
      })
      .catch((error) => {
        if (defaultsRequestToken !== createPrDefaultsLoadTokenRef.current) {
          return;
        }
        setCreatePrDefaultsError(
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        if (defaultsRequestToken === createPrDefaultsLoadTokenRef.current) {
          setCreatePrDefaultsLoading(false);
        }
      });
  }, [
    applyCreatePrDefaults,
    buildCreatePrInitialStages,
    createPrCanOpen,
    createPrDefaultsLoadTokenRef,
    createPrPreviewDetailsCacheRef,
    createPrPreviewDetailsLoadTokenRef,
    createPrPreviewLoadTokenRef,
    getGitPrWorkflowDefaults,
    setCreatePrCopiedPrUrl,
    setCreatePrCopiedRetryCommand,
    setCreatePrDefaults,
    setCreatePrDefaultsError,
    setCreatePrDefaultsLoading,
    setCreatePrDialogOpen,
    setCreatePrPreviewBaseOnlyCount,
    setCreatePrPreviewCommits,
    setCreatePrPreviewDetails,
    setCreatePrPreviewDetailsError,
    setCreatePrPreviewDetailsLoading,
    setCreatePrPreviewError,
    setCreatePrPreviewExpanded,
    setCreatePrPreviewLoading,
    setCreatePrPreviewSelectedSha,
    setCreatePrResult,
    setCreatePrStages,
    setIsCreatePrDialogMaximized,
    t,
    workspaceId,
  ]);

  const handleCopyCreatePrUrl = useCallback(async () => {
    const url = createPrResult?.prUrl?.trim();
    if (!url) {
      return;
    }
    if (await copyTextToClipboard(url)) {
      setCreatePrCopiedPrUrl(true);
      window.setTimeout(() => setCreatePrCopiedPrUrl(false), 1200);
    } else {
      setCreatePrCopiedPrUrl(false);
    }
  }, [createPrResult?.prUrl, setCreatePrCopiedPrUrl]);

  const handleCopyCreatePrRetryCommand = useCallback(async () => {
    const retryCommand = createPrResult?.retryCommand?.trim();
    if (!retryCommand) {
      return;
    }
    if (await copyTextToClipboard(retryCommand)) {
      setCreatePrCopiedRetryCommand(true);
      window.setTimeout(() => setCreatePrCopiedRetryCommand(false), 1200);
    } else {
      setCreatePrCopiedRetryCommand(false);
    }
  }, [createPrResult?.retryCommand, setCreatePrCopiedRetryCommand]);

  const handleConfirmCreatePr = useCallback(async () => {
    if (!workspaceId || !createPrCanConfirm || createPrSubmitting) {
      return;
    }
    const initialStages = buildCreatePrInitialStages(t);
    setCreatePrResult(null);
    setCreatePrCopiedPrUrl(false);
    setCreatePrCopiedRetryCommand(false);
    setCreatePrStages(
      initialStages.map((stage, index) =>
        index === 0
          ? {
              ...stage,
              status: "running",
              detail: t("git.historyCreatePrStageRunning"),
            }
          : stage,
      ),
    );
    if (createPrProgressTimerRef.current !== null) {
      window.clearInterval(createPrProgressTimerRef.current);
    }
    createPrProgressTimerRef.current = window.setInterval(() => {
      setCreatePrStages((previous) => {
        const runningIndex = previous.findIndex(
          (stage) => stage.status === "running",
        );
        if (runningIndex < 0 || runningIndex >= previous.length - 1) {
          return previous;
        }
        const next = [...previous];
        const current = next[runningIndex];
        const following = next[runningIndex + 1];
        if (following.status !== "pending") {
          return previous;
        }
        next[runningIndex] = {
          ...current,
          status: "success",
          detail: t("git.historyCreatePrStagePending"),
        };
        next[runningIndex + 1] = {
          ...following,
          status: "running",
          detail: t("git.historyCreatePrStageRunning"),
        };
        return next;
      });
    }, 800);

    clearOperationNotice();
    setOperationLoading("createPr");
    try {
      const workflowOptions = {
        upstreamRepo: createPrForm.upstreamRepo.trim(),
        baseBranch: createPrForm.baseBranch.trim(),
        headOwner: createPrForm.headOwner.trim(),
        headBranch: createPrForm.headBranch.trim(),
        title: createPrForm.title.trim(),
        body: createPrForm.body.trim(),
        commentAfterCreate: createPrForm.commentAfterCreate,
        commentBody: createPrForm.commentBody.trim(),
      };
      let workflowResult = await createGitPrWorkflow(
        workspaceId,
        workflowOptions,
      );
      while (
        workflowResult.errorCategory === "range-confirmation-required" &&
        workflowResult.rangeGate?.requiresConfirmation &&
        workflowResult.rangeGate.rangeFingerprint.trim().length > 0
      ) {
        const rangeGate = workflowResult.rangeGate;
        if (createPrProgressTimerRef.current !== null) {
          window.clearInterval(createPrProgressTimerRef.current);
          createPrProgressTimerRef.current = null;
        }
        const confirmationMessageKey =
          rangeGate.severity === "diff-incomplete"
            ? "git.historyCreatePrRangeDiffIncompleteConfirm"
            : "git.historyCreatePrRangeLargeConfirm";
        const confirmed = await ask(
          t(confirmationMessageKey, {
            base: `upstream/${workflowOptions.baseBranch}`,
            head: "HEAD",
            target: `${workflowOptions.headOwner}:${workflowOptions.headBranch}`,
            count: rangeGate.changedFiles,
            threshold: rangeGate.threshold,
          }),
          {
            title: t("git.historyCreatePrRangeConfirmTitle"),
            kind: "warning",
          },
        );
        if (!confirmed) {
          setCreatePrResult(null);
          setCreatePrStages(initialStages);
          return;
        }
        setCreatePrStages(
          initialStages.map((stage, index) =>
            index === 0
              ? {
                  ...stage,
                  status: "running",
                  detail: t("git.historyCreatePrStageRunning"),
                }
              : stage,
          ),
        );
        workflowResult = await createGitPrWorkflow(workspaceId, {
          ...workflowOptions,
          allowLargeRange: true,
          confirmedRangeFingerprint: rangeGate.rangeFingerprint,
        });
      }
      setCreatePrResult(workflowResult);
      setCreatePrStages(mapCreatePrStagesFromResult(t, workflowResult.stages));
      if (workflowResult.ok) {
        showOperationNotice({
          kind: "success",
          message: t("git.historyOperationSucceeded", {
            operation: t("git.historyOperationCreatePr"),
          }),
        });
      } else {
        showOperationNotice({
          kind: "error",
          message: `${t("git.historyOperationFailed", {
            operation: t("git.historyOperationCreatePr"),
          })} ${workflowResult.message} ${t("git.historyOperationRetryHint")}`,
          debugMessage: workflowResult.message,
        });
      }
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      setCreatePrResult({
        ok: false,
        status: "failed",
        message: rawMessage,
        stages: [],
      });
      setCreatePrStages((previous) =>
        previous.map((stage, index) =>
          index === 0
            ? { ...stage, status: "failed", detail: rawMessage }
            : stage.status === "running"
              ? { ...stage, status: "failed", detail: rawMessage }
              : stage,
        ),
      );
      showOperationNotice({
        kind: "error",
        message: `${t("git.historyOperationFailed", {
          operation: t("git.historyOperationCreatePr"),
        })} ${rawMessage} ${t("git.historyOperationRetryHint")}`,
        debugMessage: rawMessage,
      });
    } finally {
      if (createPrProgressTimerRef.current !== null) {
        window.clearInterval(createPrProgressTimerRef.current);
        createPrProgressTimerRef.current = null;
      }
      setOperationLoading(null);
    }
  }, [
    ask,
    buildCreatePrInitialStages,
    clearOperationNotice,
    createGitPrWorkflow,
    createPrCanConfirm,
    createPrForm.baseBranch,
    createPrForm.body,
    createPrForm.commentAfterCreate,
    createPrForm.commentBody,
    createPrForm.headBranch,
    createPrForm.headOwner,
    createPrForm.title,
    createPrForm.upstreamRepo,
    createPrProgressTimerRef,
    createPrSubmitting,
    mapCreatePrStagesFromResult,
    setCreatePrCopiedPrUrl,
    setCreatePrCopiedRetryCommand,
    setCreatePrResult,
    setCreatePrStages,
    setOperationLoading,
    showOperationNotice,
    t,
    workspaceId,
  ]);

  return {
    applyCreatePrDefaults,
    closeCreatePrDialog,
    handleConfirmCreatePr,
    handleCopyCreatePrRetryCommand,
    handleCopyCreatePrUrl,
    handleCreatePrHeadRepositoryChange,
    handleOpenCreatePrDialog,
    loadCreatePrCommitPreview,
  };
}
