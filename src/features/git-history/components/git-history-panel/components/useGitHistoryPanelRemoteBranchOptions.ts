import {
  useCallback,
  useMemo,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { TFunction } from "i18next";
import type { GitBranchListItem } from "../../../../../types";
import type { GitPullStrategyOption } from "../../../../../services/tauri";
import type { PushTargetBranchGroup } from "./GitHistoryPanelTypes";
import { getBranchScope } from "../utils/gitHistoryPanelSharedUtils";

type RemoteBranchOptionsScope = {
  operationLoading: string | null;
  pullNoCommit: boolean;
  pullNoVerify: boolean;
  pullRemote: string;
  pullStrategy: GitPullStrategyOption | null;
  pullTargetBranch: string;
  pullTargetBranchActiveScopeTab: string | null;
  pullTargetBranchQuery: string;
  pushRemote: string;
  pushTargetBranch: string;
  pushTargetBranchActiveScopeTab: string | null;
  pushTargetBranchQuery: string;
  remoteBranches: GitBranchListItem[];
  setPullNoCommit: Dispatch<SetStateAction<boolean>>;
  setPullNoVerify: Dispatch<SetStateAction<boolean>>;
  setPullStrategy: Dispatch<SetStateAction<GitPullStrategyOption | null>>;
  t: TFunction<"translation", undefined>;
};

export function useGitHistoryPanelRemoteBranchOptions(scope: RemoteBranchOptionsScope) {
  const {
    operationLoading,
    pullNoCommit,
    pullNoVerify,
    pullRemote,
    pullStrategy,
    pullTargetBranch,
    pullTargetBranchActiveScopeTab,
    pullTargetBranchQuery,
    pushRemote,
    pushTargetBranch,
    pushTargetBranchActiveScopeTab,
    pushTargetBranchQuery,
    remoteBranches,
    setPullNoCommit,
    setPullNoVerify,
    setPullStrategy,
    t,
  } = scope;

  const pullSubmitting = operationLoading === "pull";
  const syncSubmitting = operationLoading === "sync";
  const fetchSubmitting = operationLoading === "fetch";
  const refreshSubmitting = operationLoading === "refresh";
  const pushSubmitting = operationLoading === "push";
  const pullRemoteTrimmed = pullRemote.trim();
  const pushRemoteTrimmed = pushRemote.trim();
  const pushTargetBranchTrimmed = pushTargetBranch.trim();
  const pushTargetBranchQueryTrimmed = pushTargetBranchQuery.trim();

  const resolvePushTargetBranchOptions = useCallback(
    (remoteName: string): string[] => {
      const normalizedRemote = remoteName.trim();
      if (!normalizedRemote) {
        return [];
      }
      const branchSet = new Set<string>();
      const remotePrefix = `${normalizedRemote}/`;
      for (const branch of remoteBranches) {
        const fromMeta = branch.remote?.trim();
        if (fromMeta && fromMeta !== normalizedRemote) {
          continue;
        }
        const normalizedName = branch.name.trim();
        if (normalizedName.startsWith(remotePrefix)) {
          const leaf = normalizedName.slice(remotePrefix.length).trim();
          if (leaf) {
            branchSet.add(leaf);
          }
        }
      }
      return Array.from(branchSet).sort((a, b) => a.localeCompare(b));
    },
    [remoteBranches],
  );

  const pushRemoteOptions = useMemo(() => {
    const set = new Set<string>();
    for (const branch of remoteBranches) {
      if (branch.remote?.trim()) {
        set.add(branch.remote.trim());
      }
      const slashIndex = branch.name.indexOf("/");
      if (slashIndex > 0) {
        set.add(branch.name.slice(0, slashIndex));
      }
    }
    if (!set.size) {
      set.add("origin");
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [remoteBranches]);

  const pushTargetBranchOptions = useMemo(
    () => resolvePushTargetBranchOptions(pushRemoteTrimmed || pushRemote),
    [pushRemote, pushRemoteTrimmed, resolvePushTargetBranchOptions],
  );

  const filteredPushTargetBranchOptions = useMemo(() => {
    const keyword = pushTargetBranchQueryTrimmed.toLowerCase();
    if (!keyword) {
      return pushTargetBranchOptions;
    }
    const matched = pushTargetBranchOptions.filter((branchName) =>
      branchName.toLowerCase().includes(keyword),
    );
    return matched.length > 0 ? matched : pushTargetBranchOptions;
  }, [pushTargetBranchOptions, pushTargetBranchQueryTrimmed]);

  const pushTargetBranchGroups = useMemo<PushTargetBranchGroup[]>(() => {
    const grouped = new Map<string, string[]>();
    for (const branchName of filteredPushTargetBranchOptions) {
      const scope = getBranchScope(branchName);
      const bucket = grouped.get(scope) ?? [];
      bucket.push(branchName);
      grouped.set(scope, bucket);
    }
    const sortedScopes = Array.from(grouped.keys()).sort((a, b) => {
      if (a === "__root__") {
        return -1;
      }
      if (b === "__root__") {
        return 1;
      }
      return a.localeCompare(b);
    });
    return sortedScopes.map((scope) => ({
      scope,
      label: scope === "__root__" ? t("git.historyPushDialogGroupRoot") : scope,
      items: (grouped.get(scope) ?? []).sort((a, b) => a.localeCompare(b)),
    }));
  }, [filteredPushTargetBranchOptions, t]);
  const visiblePushTargetBranchGroups = useMemo(() => {
    if (pushTargetBranchGroups.length <= 1) {
      return pushTargetBranchGroups;
    }
    const activeScope =
      pushTargetBranchActiveScopeTab ??
      pushTargetBranchGroups[0]?.scope ??
      null;
    return pushTargetBranchGroups.filter(
      (group) => group.scope === activeScope,
    );
  }, [pushTargetBranchActiveScopeTab, pushTargetBranchGroups]);

  const pullRemoteOptions = pushRemoteOptions;
  const pullRemoteGroups = useMemo<PushTargetBranchGroup[]>(() => {
    const sortedRemotes = [...pullRemoteOptions].sort((left, right) =>
      left.localeCompare(right),
    );
    if (!sortedRemotes.length) {
      return [];
    }
    return [
      {
        scope: "__root__",
        label: t("git.historyPushDialogGroupRoot"),
        items: sortedRemotes,
      },
    ];
  }, [pullRemoteOptions, t]);
  const pullTargetBranchTrimmed = pullTargetBranch.trim();
  const pullTargetBranchQueryTrimmed = pullTargetBranchQuery.trim();
  const pullTargetBranchOptions = useMemo(
    () => resolvePushTargetBranchOptions(pullRemoteTrimmed || "origin"),
    [pullRemoteTrimmed, resolvePushTargetBranchOptions],
  );
  const filteredPullTargetBranchOptions = useMemo(() => {
    const keyword = pullTargetBranchQueryTrimmed.toLowerCase();
    if (!keyword) {
      return pullTargetBranchOptions;
    }
    const matched = pullTargetBranchOptions.filter((branchName) =>
      branchName.toLowerCase().includes(keyword),
    );
    return matched.length > 0 ? matched : pullTargetBranchOptions;
  }, [pullTargetBranchOptions, pullTargetBranchQueryTrimmed]);
  const pullTargetBranchGroups = useMemo<PushTargetBranchGroup[]>(() => {
    const grouped = new Map<string, string[]>();
    for (const branchName of filteredPullTargetBranchOptions) {
      const scope = getBranchScope(branchName);
      const bucket = grouped.get(scope) ?? [];
      bucket.push(branchName);
      grouped.set(scope, bucket);
    }
    const sortedScopes = Array.from(grouped.keys()).sort((a, b) => {
      if (a === "__root__") {
        return -1;
      }
      if (b === "__root__") {
        return 1;
      }
      return a.localeCompare(b);
    });
    return sortedScopes.map((scope) => ({
      scope,
      label: scope === "__root__" ? t("git.historyPushDialogGroupRoot") : scope,
      items: (grouped.get(scope) ?? []).sort((a, b) => a.localeCompare(b)),
    }));
  }, [filteredPullTargetBranchOptions, t]);
  const visiblePullTargetBranchGroups = useMemo(() => {
    if (pullTargetBranchGroups.length <= 1) {
      return pullTargetBranchGroups;
    }
    const activeScope =
      pullTargetBranchActiveScopeTab ??
      pullTargetBranchGroups[0]?.scope ??
      null;
    return pullTargetBranchGroups.filter(
      (group) => group.scope === activeScope,
    );
  }, [pullTargetBranchActiveScopeTab, pullTargetBranchGroups]);
  const pullSelectedOptions = useMemo(() => {
    const options: Array<{ id: string; label: string; onRemove: () => void }> =
      [];
    if (pullStrategy) {
      options.push({
        id: pullStrategy,
        label: pullStrategy,
        onRemove: () => setPullStrategy(null),
      });
    }
    if (pullNoCommit) {
      options.push({
        id: "--no-commit",
        label: "--no-commit",
        onRemove: () => setPullNoCommit(false),
      });
    }
    if (pullNoVerify) {
      options.push({
        id: "--no-verify",
        label: "--no-verify",
        onRemove: () => setPullNoVerify(false),
      });
    }
    return options;
  }, [pullNoCommit, pullNoVerify, pullStrategy]);

  return {
    fetchSubmitting,
    pullRemoteGroups,
    pullRemoteOptions,
    pullRemoteTrimmed,
    pullSelectedOptions,
    pullSubmitting,
    pullTargetBranchGroups,
    pullTargetBranchTrimmed,
    pushRemoteOptions,
    pushRemoteTrimmed,
    pushSubmitting,
    pushTargetBranchGroups,
    pushTargetBranchTrimmed,
    refreshSubmitting,
    resolvePushTargetBranchOptions,
    syncSubmitting,
    visiblePullTargetBranchGroups,
    visiblePushTargetBranchGroups,
  };
}
