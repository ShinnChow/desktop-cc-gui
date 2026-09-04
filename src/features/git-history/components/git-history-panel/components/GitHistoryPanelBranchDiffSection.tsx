import type { GitHistoryPanelViewScope } from "./GitHistoryPanelTypes";

type BranchDiffSectionScope = Pick<
  GitHistoryPanelViewScope,
  | "FolderTree"
  | "GitCommit"
  | "GitDiffViewer"
  | "X"
  | "branchDiffState"
  | "buildFileKey"
  | "closeBranchDiff"
  | "codeAnnotations"
  | "comparePreviewFileKey"
  | "diffViewMode"
  | "formatRelativeTime"
  | "handleSelectBranchCompareCommit"
  | "handleSelectWorktreeDiffFile"
  | "isHistoryDiffModalMaximized"
  | "onCreateCodeAnnotation"
  | "onRemoveCodeAnnotation"
  | "renderChangedFilesSummary"
  | "setComparePreviewFileKey"
  | "setDiffViewMode"
  | "setIsHistoryDiffModalMaximized"
  | "statusLabel"
  | "t"
  | "workspaceId"
>;

export function renderGitHistoryPanelBranchDiffSection(
  scope: BranchDiffSectionScope,
) {
  const {
    FolderTree,
    GitCommit,
    GitDiffViewer,
    X,
    branchDiffState,
    buildFileKey,
    closeBranchDiff,
    codeAnnotations,
    comparePreviewFileKey,
    diffViewMode,
    formatRelativeTime,
    handleSelectBranchCompareCommit,
    handleSelectWorktreeDiffFile,
    isHistoryDiffModalMaximized,
    onCreateCodeAnnotation,
    onRemoveCodeAnnotation,
    renderChangedFilesSummary,
    setComparePreviewFileKey,
    setDiffViewMode,
    setIsHistoryDiffModalMaximized,
    statusLabel,
    t,
    workspaceId,
  } = scope;

  const isWorktreeDiffMode = branchDiffState?.mode === "worktree";
  const branchDiffModeClassName = isWorktreeDiffMode
    ? "is-worktree-mode"
    : "is-branch-mode";
  const branchDiffTitle = branchDiffState
    ? branchDiffState.mode === "worktree"
      ? t("git.historyBranchWorktreeDiffTitle", {
          branch: branchDiffState.branch,
          currentBranch: branchDiffState.compareBranch || t("git.unknown"),
        })
      : t("git.historyBranchCompareDiffTitle", {
          branch: branchDiffState.branch,
          compareBranch: branchDiffState.compareBranch || t("git.unknown"),
        })
    : "";
  const branchDiffSubtitle = branchDiffState
    ? branchDiffState.mode === "worktree"
      ? t("git.historyBranchWorktreeDiffSubtitle", {
          branch: branchDiffState.branch,
        })
      : t("git.historyBranchCompareDiffSubtitle", {
          branch: branchDiffState.branch,
          compareBranch: branchDiffState.compareBranch || t("git.unknown"),
        })
    : "";
  const branchDiffModeLabel = isWorktreeDiffMode
    ? t("git.historyBranchWorktreeDiffModeBadge")
    : t("git.historyBranchCompareDiffModeBadge");
  const branchDiffStatsLabel = branchDiffState
    ? branchDiffState.mode === "worktree"
      ? t("git.filesChanged", { count: branchDiffState.files.length })
      : t("git.historyBranchCompareCommitCount", {
          count:
            branchDiffState.targetOnlyCommits.length +
            branchDiffState.currentOnlyCommits.length,
        })
    : "";
  return branchDiffState ? (
    <div
      className="git-history-diff-modal-overlay"
      role="presentation"
      onClick={closeBranchDiff}
    >
      <div
        className={`git-history-diff-modal ${
          branchDiffState.mode === "worktree"
            ? `git-history-branch-worktree-diff-modal ${branchDiffModeClassName}`
            : "git-history-branch-compare-modal"
        } ${isHistoryDiffModalMaximized ? "is-maximized" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={branchDiffTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="git-history-diff-modal-header">
          <div className="git-history-diff-modal-title git-history-branch-worktree-diff-title">
            <span className="git-history-branch-worktree-diff-title-main">
              <span
                className={`git-history-branch-worktree-diff-title-icon ${branchDiffModeClassName}`}
                aria-hidden
              >
                {isWorktreeDiffMode ? (
                  <FolderTree size={14} />
                ) : (
                  <GitCommit size={14} />
                )}
              </span>
              <span
                className={`git-history-branch-worktree-diff-mode-badge ${branchDiffModeClassName}`}
              >
                {branchDiffModeLabel}
              </span>
              <span className="git-history-branch-worktree-diff-title-text">
                {branchDiffTitle}
              </span>
            </span>
            <span className="git-history-branch-worktree-diff-subtitle">
              {branchDiffSubtitle}
            </span>
            <span className="git-history-diff-modal-stats git-history-branch-worktree-diff-stats">
              {branchDiffStatsLabel}
            </span>
          </div>
          <div className="git-history-diff-modal-actions">
            <button
              type="button"
              className="git-history-diff-modal-close"
              onClick={() => setIsHistoryDiffModalMaximized((value) => !value)}
              aria-label={
                isHistoryDiffModalMaximized
                  ? t("common.restore")
                  : t("menu.maximize")
              }
              title={
                isHistoryDiffModalMaximized
                  ? t("common.restore")
                  : t("menu.maximize")
              }
            >
              <span className="git-history-diff-modal-close-glyph" aria-hidden>
                {isHistoryDiffModalMaximized ? "❐" : "□"}
              </span>
            </button>
            <button
              type="button"
              className="git-history-diff-modal-close"
              onClick={closeBranchDiff}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {branchDiffState.loading ? (
          <div className="git-history-empty">{t("common.loading")}</div>
        ) : branchDiffState.error ? (
          <div className="git-history-error">{branchDiffState.error}</div>
        ) : branchDiffState.mode === "worktree" ? (
          branchDiffState.files.length === 0 ? (
            <div className="git-history-empty">
              {t("git.historyBranchWorktreeDiffEmpty")}
            </div>
          ) : (
            <div className="git-history-branch-worktree-diff-layout">
              <div className="git-history-branch-worktree-diff-detail">
                {!branchDiffState.selectedPath ? (
                  <div className="git-history-empty">
                    {t("git.historyBranchWorktreeDiffSelectFile")}
                  </div>
                ) : branchDiffState.selectedDiffLoading ? (
                  <div className="git-history-empty">{t("common.loading")}</div>
                ) : branchDiffState.selectedDiffError ? (
                  <div className="git-history-error">
                    {branchDiffState.selectedDiffError}
                  </div>
                ) : branchDiffState.selectedDiff ? (
                  <div className="git-history-diff-modal-viewer">
                    <GitDiffViewer
                      workspaceId={workspaceId}
                      diffs={[branchDiffState.selectedDiff]}
                      selectedPath={branchDiffState.selectedDiff.path}
                      isLoading={false}
                      error={null}
                      listView="flat"
                      stickyHeaderMode="controls-only"
                      embeddedAnchorVariant="modal-pager"
                      showContentModeControls
                      diffStyle={diffViewMode}
                      onDiffStyleChange={setDiffViewMode}
                      onCreateCodeAnnotation={onCreateCodeAnnotation}
                      onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                      codeAnnotations={codeAnnotations}
                      codeAnnotationSurface="modal-diff-view"
                    />
                  </div>
                ) : (
                  <div className="git-history-empty">
                    {t("git.diffUnavailable")}
                  </div>
                )}
              </div>
              <div className="git-history-branch-worktree-diff-files">
                <div className="git-history-branch-worktree-diff-files-title">
                  {t("git.historyBranchWorktreeDiffFilesTitle")}
                </div>
                <div className="git-history-branch-worktree-diff-files-list">
                  {branchDiffState.files.map((entry) => (
                    <button
                      key={entry.path}
                      type="button"
                      className={`git-history-branch-worktree-diff-file${
                        branchDiffState.selectedPath === entry.path
                          ? " is-active"
                          : ""
                      }`}
                      onClick={() => {
                        void handleSelectWorktreeDiffFile(
                          branchDiffState.branch,
                          branchDiffState.compareBranch,
                          entry,
                        );
                      }}
                    >
                      <span
                        className={`git-history-file-status git-status-${entry.status.toLowerCase()}`}
                      >
                        {entry.status}
                      </span>
                      <span className="git-history-branch-worktree-diff-file-path">
                        {entry.path}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )
        ) : (
          <div className="git-history-branch-compare-layout">
            <div className="git-history-branch-compare-lists">
              <section className="git-history-branch-compare-list-card is-target">
                <header className="git-history-branch-compare-list-header is-target">
                  <span className="git-history-branch-compare-list-title-wrap">
                    <span
                      className="git-history-branch-compare-list-dot"
                      aria-hidden
                    />
                    <span className="git-history-branch-compare-list-title">
                      {t("git.historyBranchCompareDirectionTargetOnly", {
                        target: branchDiffState.branch,
                        current: branchDiffState.compareBranch,
                      })}
                    </span>
                  </span>
                  <span className="git-history-branch-compare-list-count">
                    {t("git.historyCommitCount", {
                      count: branchDiffState.targetOnlyCommits.length,
                    })}
                  </span>
                </header>
                {branchDiffState.targetOnlyCommits.length === 0 ? (
                  <div className="git-history-empty">
                    {t("git.historyBranchCompareDirectionEmpty")}
                  </div>
                ) : (
                  <div className="git-history-branch-compare-list">
                    {branchDiffState.targetOnlyCommits.map((entry) => (
                      <button
                        key={`target-${entry.sha}`}
                        type="button"
                        className={`git-history-branch-compare-commit${
                          branchDiffState.selectedDirection === "targetOnly" &&
                          branchDiffState.selectedCommitSha === entry.sha
                            ? " is-active"
                            : ""
                        }`}
                        onClick={() => {
                          void handleSelectBranchCompareCommit(
                            branchDiffState.branch,
                            branchDiffState.compareBranch,
                            "targetOnly",
                            entry,
                          );
                        }}
                      >
                        <span className="git-history-branch-compare-commit-summary">
                          {entry.summary || t("git.historyNoMessage")}
                        </span>
                        <span className="git-history-branch-compare-commit-meta">
                          <code>{entry.shortSha}</code>
                          <span>{entry.author}</span>
                          <time>{formatRelativeTime(entry.timestamp, t)}</time>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>

              <section className="git-history-branch-compare-list-card is-current">
                <header className="git-history-branch-compare-list-header is-current">
                  <span className="git-history-branch-compare-list-title-wrap">
                    <span
                      className="git-history-branch-compare-list-dot"
                      aria-hidden
                    />
                    <span className="git-history-branch-compare-list-title">
                      {t("git.historyBranchCompareDirectionCurrentOnly", {
                        target: branchDiffState.branch,
                        current: branchDiffState.compareBranch,
                      })}
                    </span>
                  </span>
                  <span className="git-history-branch-compare-list-count">
                    {t("git.historyCommitCount", {
                      count: branchDiffState.currentOnlyCommits.length,
                    })}
                  </span>
                </header>
                {branchDiffState.currentOnlyCommits.length === 0 ? (
                  <div className="git-history-empty">
                    {t("git.historyBranchCompareDirectionEmpty")}
                  </div>
                ) : (
                  <div className="git-history-branch-compare-list">
                    {branchDiffState.currentOnlyCommits.map((entry) => (
                      <button
                        key={`current-${entry.sha}`}
                        type="button"
                        className={`git-history-branch-compare-commit${
                          branchDiffState.selectedDirection === "currentOnly" &&
                          branchDiffState.selectedCommitSha === entry.sha
                            ? " is-active"
                            : ""
                        }`}
                        onClick={() => {
                          void handleSelectBranchCompareCommit(
                            branchDiffState.branch,
                            branchDiffState.compareBranch,
                            "currentOnly",
                            entry,
                          );
                        }}
                      >
                        <span className="git-history-branch-compare-commit-summary">
                          {entry.summary || t("git.historyNoMessage")}
                        </span>
                        <span className="git-history-branch-compare-commit-meta">
                          <code>{entry.shortSha}</code>
                          <span>{entry.author}</span>
                          <time>{formatRelativeTime(entry.timestamp, t)}</time>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="git-history-branch-compare-detail">
              {!branchDiffState.selectedCommitSha ? (
                <div className="git-history-empty">
                  {t("git.historyBranchCompareSelectCommit")}
                </div>
              ) : branchDiffState.selectedCommitLoading ? (
                <div className="git-history-empty">{t("common.loading")}</div>
              ) : branchDiffState.selectedCommitError ? (
                <div className="git-history-error">
                  {branchDiffState.selectedCommitError}
                </div>
              ) : branchDiffState.selectedCommitDetails ? (
                <div className="git-history-branch-compare-detail-body">
                  <div className="git-history-branch-compare-detail-summary">
                    {branchDiffState.selectedCommitDetails.summary ||
                      t("git.historyNoMessage")}
                  </div>
                  <div className="git-history-branch-compare-detail-meta">
                    <code>
                      {branchDiffState.selectedCommitDetails.sha.slice(0, 7)}
                    </code>
                    <span>{branchDiffState.selectedCommitDetails.author}</span>
                    <time>
                      {new Date(
                        branchDiffState.selectedCommitDetails.commitTime * 1000,
                      ).toLocaleString()}
                    </time>
                  </div>
                  {branchDiffState.selectedCommitDetails.message.trim().length >
                  0 ? (
                    <pre className="git-history-branch-compare-detail-message">
                      {branchDiffState.selectedCommitDetails.message.trim()}
                    </pre>
                  ) : null}
                  <div className="git-history-branch-compare-files-title">
                    {renderChangedFilesSummary(
                      t,
                      branchDiffState.selectedCommitDetails.files.length,
                      branchDiffState.selectedCommitDetails.totalAdditions,
                      branchDiffState.selectedCommitDetails.totalDeletions,
                    )}
                  </div>
                  {branchDiffState.selectedCommitDetails.files.length === 0 ? (
                    <div className="git-history-empty">
                      {t("git.historyNoFileChangesInCommit")}
                    </div>
                  ) : (
                    <div className="git-history-branch-compare-files-list">
                      {branchDiffState.selectedCommitDetails.files.map(
                        (file) => {
                          const fileKey = buildFileKey(file);
                          return (
                            <button
                              key={fileKey}
                              type="button"
                              className={`git-history-branch-compare-file${
                                comparePreviewFileKey === fileKey
                                  ? " is-active"
                                  : ""
                              }`}
                              onClick={() => setComparePreviewFileKey(fileKey)}
                              title={statusLabel(file)}
                            >
                              <span
                                className={`git-history-file-status git-status-${file.status.toLowerCase()}`}
                              >
                                {file.status}
                              </span>
                              <span className="git-history-branch-compare-file-path">
                                {statusLabel(file)}
                              </span>
                              <span className="git-history-branch-compare-file-stats">
                                +{file.additions} / -{file.deletions}
                              </span>
                            </button>
                          );
                        },
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="git-history-empty">
                  {t("git.diffUnavailable")}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  ) : null;
}
