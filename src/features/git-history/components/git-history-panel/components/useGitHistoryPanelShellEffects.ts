import { useEffect } from "react";
import type { TFunction } from "i18next";
import { writeClientStoreValue } from "../../../../../services/clientStorage";
import {
  GIT_REPOSITORY_ACTION_LABEL_KEYS,
  subscribeGitRepositoryActionIntent,
} from "../../../../git/types/gitRepositoryActions";
import type {
  GitHistoryPanelPersistedState,
  GitOperationNoticeState,
} from "./GitHistoryPanelTypes";
import type { GitHistoryDatePreset } from "../utils/gitHistoryCommitFilters";

type ShellEffectsScope = {
  branchesWidth: number;
  commitAuthor: string;
  commitDatePreset: GitHistoryDatePreset;
  commitQuery: string;
  commitsWidth: number;
  detailsSplitRatio: number;
  diffViewMode: "split" | "unified";
  handleOpenFetchDialog: () => void;
  handleOpenPullDialog: () => void;
  handleOpenPushDialog: () => void;
  openResetDialog: (commitSha?: string | null) => void;
  overviewWidth: number;
  persistenceKey: string;
  refreshAll: () => Promise<void>;
  selectedBranch: string;
  selectedCommitSha: string | null;
  showOperationNotice: (notice: GitOperationNoticeState) => void;
  t: TFunction<"translation", undefined>;
};

export function useGitHistoryPanelShellEffects(scope: ShellEffectsScope) {
  const {
    branchesWidth,
    commitAuthor,
    commitDatePreset,
    commitQuery,
    commitsWidth,
    detailsSplitRatio,
    diffViewMode,
    handleOpenFetchDialog,
    handleOpenPullDialog,
    handleOpenPushDialog,
    openResetDialog,
    overviewWidth,
    persistenceKey,
    refreshAll,
    selectedBranch,
    selectedCommitSha,
    showOperationNotice,
    t,
  } = scope;

  useEffect(
    () =>
      subscribeGitRepositoryActionIntent((intent) => {
        if (intent.action === "push") {
          handleOpenPushDialog();
          return;
        }
        if (intent.action === "pull") {
          handleOpenPullDialog();
          return;
        }
        if (intent.action === "fetch") {
          handleOpenFetchDialog();
          return;
        }
        if (intent.action === "reset-head") {
          openResetDialog(selectedCommitSha);
          return;
        }
        if (intent.action === "show-history") {
          void refreshAll();
          return;
        }
        showOperationNotice({
          kind: "success",
          message: t("git.repositoryMenuContinueInHistory", {
            action: t(GIT_REPOSITORY_ACTION_LABEL_KEYS[intent.action]),
          }),
        });
      }),
    [
      handleOpenFetchDialog,
      handleOpenPullDialog,
      handleOpenPushDialog,
      openResetDialog,
      refreshAll,
      selectedCommitSha,
      showOperationNotice,
      t,
    ],
  );

  useEffect(() => {
    writeClientStoreValue("layout", persistenceKey, {
      overviewWidth,
      branchesWidth,
      commitsWidth,
      detailsSplitRatio,
      selectedBranch,
      commitQuery,
      commitAuthor,
      commitDatePreset,
      selectedCommitSha,
      diffStyle: diffViewMode,
    } satisfies GitHistoryPanelPersistedState);
  }, [
    branchesWidth,
    commitAuthor,
    commitDatePreset,
    commitQuery,
    commitsWidth,
    detailsSplitRatio,
    diffViewMode,
    overviewWidth,
    persistenceKey,
    selectedBranch,
    selectedCommitSha,
  ]);
}
