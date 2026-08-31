import type { GitHistoryPanelViewScope } from "../GitHistoryPanelTypes";

export function renderGitHistoryResetDialog(scope: GitHistoryPanelViewScope) {
  const {
    currentBranch,
    handleConfirmResetCommit,
    operationLoading,
    resetMode,
    resetTargetCommit,
    resetTargetSha,
    setResetDialogOpen,
    setResetMode,
    t,
    workspace,
  } = scope;
  if (!resetTargetCommit) {
    return null;
  }
  return (
    <div
      className="git-history-create-branch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !operationLoading) {
          setResetDialogOpen(false);
        }
      }}
    >
      <div
        className="git-history-reset-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("git.historyResetDialogTitle")}
      >
        <div className="git-history-create-branch-title">
          {t("git.historyResetDialogTitle")}
        </div>
        <div className="git-history-reset-target">
          {t("git.historyResetDialogTarget", {
            branch: currentBranch ?? "HEAD",
            workspace: workspace?.name ?? "",
            sha: resetTargetCommit.sha.slice(0, 10),
            summary: resetTargetCommit.summary,
            author: resetTargetCommit.author,
          })}
        </div>
        <div className="git-history-reset-description">
          {t("git.historyResetDialogDescription")}
        </div>
        <div className="git-history-reset-mode-list" role="radiogroup">
          {(
            [
              ["soft", "historyResetModeSoft", "historyResetModeSoftDesc"],
              ["mixed", "historyResetModeMixed", "historyResetModeMixedDesc"],
              ["hard", "historyResetModeHard", "historyResetModeHardDesc"],
              ["keep", "historyResetModeKeep", "historyResetModeKeepDesc"],
            ] as const
          ).map(([mode, labelKey, descKey]) => (
            <label key={mode} className="git-history-reset-mode-item">
              <input
                type="radio"
                name="git-history-reset-mode"
                checked={resetMode === mode}
                onChange={() => setResetMode(mode)}
              />
              <div className="git-history-reset-mode-copy">
                <div className="git-history-reset-mode-label">
                  {t(`git.${labelKey}`)}
                </div>
                <div className="git-history-reset-mode-desc">
                  {t(`git.${descKey}`)}
                </div>
              </div>
            </label>
          ))}
        </div>
        {resetMode === "hard" ? (
          <div className="git-history-warning">
            {t("git.historyResetHardWarning")}
          </div>
        ) : null}
        <div className="git-history-create-branch-actions">
          <button
            type="button"
            className="git-history-create-branch-btn is-cancel"
            onClick={() => setResetDialogOpen(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="git-history-create-branch-btn is-confirm"
            disabled={!resetTargetSha || Boolean(operationLoading)}
            onClick={() => void handleConfirmResetCommit()}
          >
            {operationLoading === "reset"
              ? t("common.loading")
              : t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function renderGitHistoryForceDeleteDialog(
  scope: GitHistoryPanelViewScope,
) {
  const {
    ShieldAlert,
    closeForceDeleteDialog,
    forceDeleteCopiedPath,
    forceDeleteCountdown,
    forceDeleteDialogState,
    handleCopyForceDeleteWorktreePath,
    t,
  } = scope;
  if (!forceDeleteDialogState) {
    return null;
  }
  return (
    <div
      className="git-history-create-branch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeForceDeleteDialog(false);
        }
      }}
    >
      <section
        className="git-history-force-delete-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("git.historyTitleForceDeleteBranch")}
      >
        <div className="git-history-force-delete-header">
          <span className="git-history-force-delete-title">
            <ShieldAlert size={16} />
            {t("git.historyTitleForceDeleteBranch")}
          </span>
          <button
            type="button"
            className="git-history-force-delete-close"
            onClick={() => closeForceDeleteDialog(false)}
            aria-label={t("common.close")}
            title={t("common.close")}
          >
            <span className="git-history-force-delete-close-glyph" aria-hidden>
              ×
            </span>
          </button>
        </div>

        <div className="git-history-force-delete-summary">
          {forceDeleteDialogState.mode === "worktreeOccupied"
            ? t("git.historyForceDeleteDialogSubtitleWithWorktree", {
                branch: forceDeleteDialogState.branch,
              })
            : t("git.historyForceDeleteDialogSubtitleNotMerged", {
                branch: forceDeleteDialogState.branch,
              })}
        </div>

        <div className="git-history-force-delete-risk">
          <strong>{t("git.historyForceDeleteDialogRiskTitle")}</strong>
          <p>
            {forceDeleteDialogState.mode === "worktreeOccupied"
              ? t("git.historyForceDeleteDialogRiskWithWorktree")
              : t("git.historyForceDeleteDialogRiskNotMerged")}
          </p>
        </div>

        <dl className="git-history-force-delete-facts">
          <div>
            <dt>{t("git.historyForceDeleteDialogBranchLabel")}</dt>
            <dd>
              <code>{forceDeleteDialogState.branch}</code>
            </dd>
          </div>
          {forceDeleteDialogState.worktreePath ? (
            <div>
              <dt>{t("git.historyForceDeleteDialogWorktreeLabel")}</dt>
              <dd>
                <span className="git-history-force-delete-worktree-row">
                  <code>{forceDeleteDialogState.worktreePath}</code>
                  <button
                    type="button"
                    className="git-history-force-delete-copy"
                    onClick={() => void handleCopyForceDeleteWorktreePath()}
                  >
                    {forceDeleteCopiedPath
                      ? t("git.historyForceDeleteDialogCopied")
                      : t("git.historyForceDeleteDialogCopyPath")}
                  </button>
                </span>
              </dd>
            </div>
          ) : null}
        </dl>

        <p className="git-history-force-delete-tip">
          {t("git.historyForceDeleteDialogTip")}
        </p>

        <div className="git-history-create-branch-actions">
          <button
            type="button"
            className="git-history-create-branch-btn is-cancel"
            onClick={() => closeForceDeleteDialog(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="git-history-create-branch-btn is-danger"
            disabled={forceDeleteCountdown > 0}
            onClick={() => closeForceDeleteDialog(true)}
          >
            {(forceDeleteDialogState.mode === "worktreeOccupied"
              ? t("git.historyForceDeleteDialogConfirmWithWorktree")
              : t("git.historyForceDeleteDialogConfirm")) +
              (forceDeleteCountdown > 0
                ? ` (${t("git.historyForceDeleteDialogUnlockCountdown", {
                    count: forceDeleteCountdown,
                  })})`
                : "")}
          </button>
        </div>
      </section>
    </div>
  );
}

export function renderGitHistoryCreateBranchDialog(
  scope: GitHistoryPanelViewScope,
) {
  const {
    createBranchCanConfirm,
    createBranchName,
    createBranchNameInputRef,
    createBranchSource,
    createBranchSourceOptions,
    createBranchSubmitting,
    handleCreateBranchConfirm,
    setCreateBranchDialogOpen,
    setCreateBranchName,
    setCreateBranchSource,
    t,
  } = scope;
  return (
    <div
      className="git-history-create-branch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !createBranchSubmitting) {
          setCreateBranchDialogOpen(false);
        }
      }}
    >
      <div
        className="git-history-create-branch-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("git.historyCreateBranchDialogTitle")}
      >
        <div className="git-history-create-branch-title">
          {t("git.historyCreateBranchDialogTitle")}
        </div>
        <label className="git-history-create-branch-field">
          <span>{t("git.historyCreateBranchDialogSourceLabel")}</span>
          <select
            value={createBranchSource}
            disabled={createBranchSubmitting}
            onChange={(event) => setCreateBranchSource(event.target.value)}
          >
            {createBranchSourceOptions.map((branchName) => (
              <option key={branchName} value={branchName}>
                {branchName}
              </option>
            ))}
          </select>
        </label>
        <label className="git-history-create-branch-field">
          <span>{t("git.historyCreateBranchDialogNameLabel")}</span>
          <input
            ref={createBranchNameInputRef}
            value={createBranchName}
            disabled={createBranchSubmitting}
            placeholder={t("git.historyPromptNewBranchName")}
            onChange={(event) => setCreateBranchName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && createBranchCanConfirm) {
                event.preventDefault();
                void handleCreateBranchConfirm();
              }
            }}
          />
        </label>
        {createBranchSubmitting ? (
          <div className="git-history-create-branch-hint">
            {t("git.historyCreateBranchDialogBusy")}
          </div>
        ) : null}
        <div className="git-history-create-branch-actions">
          <button
            type="button"
            className="git-history-create-branch-btn is-cancel"
            disabled={createBranchSubmitting}
            onClick={() => setCreateBranchDialogOpen(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="git-history-create-branch-btn is-confirm"
            disabled={!createBranchCanConfirm}
            onClick={() => void handleCreateBranchConfirm()}
          >
            {createBranchSubmitting ? t("common.loading") : t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function renderGitHistoryRenameBranchDialog(
  scope: GitHistoryPanelViewScope,
) {
  const {
    closeRenameBranchDialog,
    handleRenameBranchConfirm,
    renameBranchCanConfirm,
    renameBranchName,
    renameBranchNameInputRef,
    renameBranchSource,
    renameBranchSubmitting,
    setRenameBranchName,
    t,
  } = scope;
  return (
    <div
      className="git-history-create-branch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !renameBranchSubmitting) {
          closeRenameBranchDialog();
        }
      }}
    >
      <div
        className="git-history-create-branch-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("git.historyRenameBranchDialogTitle")}
      >
        <div className="git-history-create-branch-title">
          {t("git.historyRenameBranchDialogTitle")}
        </div>
        <label className="git-history-create-branch-field">
          <span>{t("git.historyRenameBranchDialogSourceLabel")}</span>
          <input value={renameBranchSource} disabled />
        </label>
        <label className="git-history-create-branch-field">
          <span>{t("git.historyRenameBranchDialogNameLabel")}</span>
          <input
            ref={renameBranchNameInputRef}
            value={renameBranchName}
            disabled={renameBranchSubmitting}
            placeholder={t("git.historyPromptRenameBranch")}
            onChange={(event) => setRenameBranchName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && renameBranchCanConfirm) {
                event.preventDefault();
                void handleRenameBranchConfirm();
              }
            }}
          />
        </label>
        {renameBranchSubmitting ? (
          <div className="git-history-create-branch-hint">
            {t("git.historyRenameBranchDialogBusy")}
          </div>
        ) : null}
        <div className="git-history-create-branch-actions">
          <button
            type="button"
            className="git-history-create-branch-btn is-cancel"
            disabled={renameBranchSubmitting}
            onClick={closeRenameBranchDialog}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="git-history-create-branch-btn is-confirm"
            disabled={!renameBranchCanConfirm}
            onClick={() => void handleRenameBranchConfirm()}
          >
            {renameBranchSubmitting ? t("common.loading") : t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
