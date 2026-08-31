import { useMemo } from "react";
import type { TFunction } from "i18next";
import type {
  GitBranchListItem,
  GitHistoryCommit,
  GitPrWorkflowDefaults,
  GitPrWorkflowResult,
} from "../../../../../types";
import {
  CREATE_PR_PREVIEW_COMMIT_LIMIT,
  sortOptionsWithPriority,
  splitGitHubRepo,
  uniqueNonEmpty,
} from "./GitHistoryPanelImplHelpers";
import type { CreatePrFormState } from "./GitHistoryPanelTypes";
import type { GitHistoryInlinePickerOption } from "./GitHistoryPanelPickers";
import {
  getBranchLeafName,
  getBranchScope,
} from "../utils/gitHistoryPanelSharedUtils";

type CreatePrDerivedScope = {
  createBranchName: string;
  createBranchSource: string;
  createPrDefaults: GitPrWorkflowDefaults | null;
  createPrDefaultsError: string | null;
  createPrDefaultsLoading: boolean;
  createPrForm: CreatePrFormState;
  createPrPreviewCommits: GitHistoryCommit[];
  createPrPreviewSelectedSha: string | null;
  createPrResult: GitPrWorkflowResult | null;
  currentBranch: string | null;
  localBranches: GitBranchListItem[];
  operationLoading: string | null;
  remoteBranches: GitBranchListItem[];
  renameBranchName: string;
  renameBranchSource: string;
  repositoryUnavailable: boolean;
  selectedBranch: string;
  t: TFunction<"translation", undefined>;
  workspaceId: string | null;
};

export function useGitHistoryPanelCreatePrDerived(scope: CreatePrDerivedScope) {
  const {
    createBranchName,
    createBranchSource,
    createPrDefaults,
    createPrDefaultsError,
    createPrDefaultsLoading,
    createPrForm,
    createPrPreviewCommits,
    createPrPreviewSelectedSha,
    createPrResult,
    currentBranch,
    localBranches,
    operationLoading,
    remoteBranches,
    renameBranchName,
    renameBranchSource,
    repositoryUnavailable,
    selectedBranch,
    t,
    workspaceId,
  } = scope;

  const createBranchNameTrimmed = createBranchName.trim();
  const createBranchSubmitting = operationLoading === "createBranch";
  const createBranchCanConfirm = Boolean(
    workspaceId &&
    !createBranchSubmitting &&
    createBranchSource.trim() &&
    createBranchNameTrimmed,
  );
  const renameBranchNameTrimmed = renameBranchName.trim();
  const renameBranchSubmitting = operationLoading === "renameBranch";
  const renameBranchCanConfirm = Boolean(
    workspaceId &&
    !renameBranchSubmitting &&
    renameBranchSource.trim() &&
    renameBranchNameTrimmed &&
    renameBranchNameTrimmed !== renameBranchSource,
  );
  const createPrSubmitting = operationLoading === "createPr";
  const createPrToolbarDisabledReason = !currentBranch
    ? t("git.historyCreatePrUnavailableNoBranch")
    : null;
  const createPrCanOpen = Boolean(
    workspaceId && !operationLoading && currentBranch && !repositoryUnavailable,
  );
  const createPrUpstreamParts = useMemo(
    () => splitGitHubRepo(createPrForm.upstreamRepo),
    [createPrForm.upstreamRepo],
  );
  const createPrHeadRepositoryValue = useMemo(() => {
    const owner = createPrForm.headOwner.trim();
    if (!owner) {
      return "";
    }
    if (!createPrUpstreamParts.repo) {
      return owner;
    }
    return `${owner}/${createPrUpstreamParts.repo}`;
  }, [createPrForm.headOwner, createPrUpstreamParts.repo]);
  const createPrBaseRepoOptions = useMemo<GitHistoryInlinePickerOption[]>(
    () =>
      uniqueNonEmpty([
        createPrForm.upstreamRepo,
        createPrDefaults?.upstreamRepo ?? "",
      ]).map((repo) => ({
        value: repo,
        label: repo,
        description: t("git.historyCreatePrFieldUpstreamRepo"),
        group: t("git.historyCreatePrGroupSuggested"),
      })),
    [createPrDefaults?.upstreamRepo, createPrForm.upstreamRepo, t],
  );
  const createPrHeadRepoOptions = useMemo(() => {
    const upstreamOwner = createPrUpstreamParts.owner;
    const repoName = createPrUpstreamParts.repo;
    const ownerCandidates = uniqueNonEmpty([
      createPrForm.headOwner,
      createPrDefaults?.headOwner ?? "",
      upstreamOwner,
    ]);
    return ownerCandidates.map((owner) => {
      const repo = repoName ? `${owner}/${repoName}` : owner;
      return {
        value: repo,
        label: repo,
        description: t("git.historyCreatePrFieldHeadOwner"),
        group: t("git.historyCreatePrGroupSuggested"),
      } satisfies GitHistoryInlinePickerOption;
    });
  }, [
    createPrDefaults?.headOwner,
    createPrForm.headOwner,
    createPrUpstreamParts.owner,
    createPrUpstreamParts.repo,
    t,
  ]);
  const createPrUpstreamRemoteName = useMemo(() => {
    const remoteNames = uniqueNonEmpty(
      remoteBranches
        .map((entry) => entry.remote?.trim() ?? "")
        .filter((name) => name.length > 0),
    );
    const explicitUpstream = remoteNames.find(
      (name) => name.toLowerCase() === "upstream",
    );
    return explicitUpstream ?? null;
  }, [remoteBranches]);
  const createPrPreviewBaseRemoteName =
    createPrUpstreamRemoteName ?? "upstream";
  const createPrPreviewHeadRef = createPrForm.headBranch.trim();
  const createPrPreviewBaseRef = createPrForm.baseBranch.trim()
    ? `${createPrPreviewBaseRemoteName}/${createPrForm.baseBranch.trim()}`
    : "";
  const createPrBaseBranchOptions = useMemo<
    GitHistoryInlinePickerOption[]
  >(() => {
    const remoteBranchLeaves = remoteBranches
      .filter((entry) => {
        if (!createPrUpstreamRemoteName) {
          return true;
        }
        return (entry.remote?.trim() ?? "") === createPrUpstreamRemoteName;
      })
      .map((entry) => {
        const remoteName = entry.remote?.trim();
        if (remoteName && entry.name.startsWith(`${remoteName}/`)) {
          return entry.name.slice(remoteName.length + 1);
        }
        const slashIndex = entry.name.indexOf("/");
        return slashIndex >= 0 ? entry.name.slice(slashIndex + 1) : entry.name;
      });
    const prioritized = sortOptionsWithPriority(
      uniqueNonEmpty([
        ...remoteBranchLeaves,
        createPrForm.baseBranch,
        createPrDefaults?.baseBranch ?? "",
      ]),
      [
        createPrForm.baseBranch,
        createPrDefaults?.baseBranch ?? "",
        "main",
        "master",
        "develop",
      ],
    );
    const suggested = new Set(
      uniqueNonEmpty([
        createPrForm.baseBranch,
        createPrDefaults?.baseBranch ?? "",
        "main",
        "master",
        "develop",
      ]),
    );
    return prioritized.map((branch) => ({
      value: branch,
      label: branch,
      description: t("git.historyCreatePrFieldBaseBranch"),
      group: suggested.has(branch)
        ? t("git.historyCreatePrGroupSuggested")
        : t("git.historyCreatePrGroupRemote"),
    }));
  }, [
    createPrDefaults?.baseBranch,
    createPrForm.baseBranch,
    createPrUpstreamRemoteName,
    remoteBranches,
    t,
  ]);
  const createPrCompareBranchOptions = useMemo<GitHistoryInlinePickerOption[]>(
    () =>
      sortOptionsWithPriority(
        uniqueNonEmpty([
          ...localBranches.map((entry) => entry.name),
          createPrForm.headBranch,
          currentBranch ?? "",
        ]),
        [createPrForm.headBranch, currentBranch ?? ""],
      ).map((branch) => {
        const scope = getBranchScope(branch);
        return {
          value: branch,
          label: getBranchLeafName(branch),
          description: t("git.historyCreatePrFieldHeadBranch"),
          group:
            scope === "__root__" ? t("git.historyPushDialogGroupRoot") : scope,
        };
      }),
    [createPrForm.headBranch, currentBranch, localBranches, t],
  );
  const createPrCanConfirm = Boolean(
    workspaceId &&
    !createPrSubmitting &&
    !createPrDefaultsLoading &&
    !createPrDefaultsError &&
    (createPrDefaults?.canCreate ?? true) &&
    createPrForm.upstreamRepo.trim() &&
    createPrForm.baseBranch.trim() &&
    createPrForm.headOwner.trim() &&
    createPrForm.headBranch.trim() &&
    createPrForm.title.trim(),
  );
  const createPrResultHeadline = useMemo(() => {
    if (!createPrResult) {
      return "";
    }
    if (createPrResult.status === "existing") {
      return t("git.historyCreatePrResultExisting");
    }
    if (createPrResult.ok) {
      return t("git.historyCreatePrResultSuccess");
    }
    return t("git.historyCreatePrResultFailed");
  }, [createPrResult, t]);
  const createPrPreviewHasMore =
    createPrPreviewCommits.length >= CREATE_PR_PREVIEW_COMMIT_LIMIT;
  const createPrPreviewSelectedCommit = useMemo(
    () =>
      createPrPreviewCommits.find(
        (entry) => entry.sha === createPrPreviewSelectedSha,
      ) ?? null,
    [createPrPreviewCommits, createPrPreviewSelectedSha],
  );
  const selectedLocalBranchForRename = useMemo(() => {
    const candidate = selectedBranch === "all" ? currentBranch : selectedBranch;
    if (!candidate) {
      return null;
    }
    return localBranches.some((entry) => entry.name === candidate)
      ? candidate
      : null;
  }, [currentBranch, localBranches, selectedBranch]);
  const renameBranchToolbarDisabledReason = useMemo(() => {
    if (operationLoading) {
      return t("git.historyBranchMenuUnavailableBusy");
    }
    if (
      selectedBranch !== "all" &&
      selectedBranch &&
      !localBranches.some((entry) => entry.name === selectedBranch)
    ) {
      return t("git.historyBranchMenuUnavailableRemote");
    }
    if (!selectedLocalBranchForRename) {
      return t("git.historyBranchMenuUnavailableNoCurrent");
    }
    return null;
  }, [
    localBranches,
    operationLoading,
    selectedBranch,
    selectedLocalBranchForRename,
    t,
  ]);

  return {
    createBranchCanConfirm,
    createBranchSubmitting,
    createPrBaseBranchOptions,
    createPrBaseRepoOptions,
    createPrCanConfirm,
    createPrCanOpen,
    createPrCompareBranchOptions,
    createPrHeadRepoOptions,
    createPrHeadRepositoryValue,
    createPrPreviewBaseRef,
    createPrPreviewBaseRemoteName,
    createPrPreviewHasMore,
    createPrPreviewHeadRef,
    createPrPreviewSelectedCommit,
    createPrResultHeadline,
    createPrSubmitting,
    createPrToolbarDisabledReason,
    renameBranchCanConfirm,
    renameBranchNameTrimmed,
    renameBranchSubmitting,
    renameBranchToolbarDisabledReason,
    selectedLocalBranchForRename,
  };
}
