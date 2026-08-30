import type { GitHistoryPanelViewScope } from "./GitHistoryPanelImpl";
import {
  renderGitHistoryCreateBranchDialog,
  renderGitHistoryForceDeleteDialog,
  renderGitHistoryRenameBranchDialog,
  renderGitHistoryResetDialog,
} from "./dialogs/branchDialogs";
import { renderGitHistoryPullDialog } from "./dialogs/pullDialogs";
import { renderGitHistoryPushDialog } from "./dialogs/pushDialogs";
import {
  renderGitHistoryFetchDialog,
  renderGitHistoryRefreshDialog,
  renderGitHistorySyncDialog,
} from "./dialogs/syncDialogs";

export function renderGitHistoryPanelDialogs(scope: GitHistoryPanelViewScope) {
  const {
    createBranchDialogOpen,
    fetchDialogOpen,
    forceDeleteDialogState,
    pullDialogOpen,
    pushDialogOpen,
    refreshDialogOpen,
    renameBranchDialogOpen,
    resetDialogOpen,
    resetTargetCommit,
    syncDialogOpen,
  } = scope;
  return (
    <>
      {pullDialogOpen ? renderGitHistoryPullDialog(scope) : null}
      {syncDialogOpen ? renderGitHistorySyncDialog(scope) : null}
      {fetchDialogOpen ? renderGitHistoryFetchDialog(scope) : null}
      {refreshDialogOpen ? renderGitHistoryRefreshDialog(scope) : null}
      {pushDialogOpen ? renderGitHistoryPushDialog(scope) : null}
      {resetDialogOpen && resetTargetCommit
        ? renderGitHistoryResetDialog(scope)
        : null}
      {forceDeleteDialogState ? renderGitHistoryForceDeleteDialog(scope) : null}
      {createBranchDialogOpen
        ? renderGitHistoryCreateBranchDialog(scope)
        : null}
      {renameBranchDialogOpen
        ? renderGitHistoryRenameBranchDialog(scope)
        : null}
    </>
  );
}
