import type { GitHistoryPanelViewScope } from "./GitHistoryPanelTypes";

type CreatePrPreviewCardScope = Pick<
  GitHistoryPanelViewScope,
  | "CREATE_PR_PREVIEW_COMMIT_LIMIT"
  | "ChevronDown"
  | "FileText"
  | "FolderTree"
  | "GitCommit"
  | "LoaderCircle"
  | "RefreshCw"
  | "buildFileKey"
  | "createPrDefaultsLoading"
  | "createPrPreviewBaseOnlyCount"
  | "createPrPreviewBaseRef"
  | "createPrPreviewCommits"
  | "createPrPreviewDetails"
  | "createPrPreviewDetailsError"
  | "createPrPreviewDetailsLoading"
  | "createPrPreviewError"
  | "createPrPreviewExpanded"
  | "createPrPreviewHasMore"
  | "createPrPreviewHeadRef"
  | "createPrPreviewLoading"
  | "createPrPreviewSelectedCommit"
  | "createPrPreviewSelectedSha"
  | "createPrSubmitting"
  | "extractCommitBody"
  | "formatRelativeTime"
  | "loadCreatePrCommitPreview"
  | "setCreatePrPreviewExpanded"
  | "setCreatePrPreviewSelectedSha"
  | "t"
>;

export function renderGitHistoryPanelCreatePrPreviewCard(
  scope: CreatePrPreviewCardScope,
) {
  const {
    CREATE_PR_PREVIEW_COMMIT_LIMIT,
    ChevronDown,
    FileText,
    FolderTree,
    GitCommit,
    LoaderCircle,
    RefreshCw,
    buildFileKey,
    createPrDefaultsLoading,
    createPrPreviewBaseOnlyCount,
    createPrPreviewBaseRef,
    createPrPreviewCommits,
    createPrPreviewDetails,
    createPrPreviewDetailsError,
    createPrPreviewDetailsLoading,
    createPrPreviewError,
    createPrPreviewExpanded,
    createPrPreviewHasMore,
    createPrPreviewHeadRef,
    createPrPreviewLoading,
    createPrPreviewSelectedCommit,
    createPrPreviewSelectedSha,
    createPrSubmitting,
    extractCommitBody,
    formatRelativeTime,
    loadCreatePrCommitPreview,
    setCreatePrPreviewExpanded,
    setCreatePrPreviewSelectedSha,
    t,
  } = scope;

  return (
    <section
      className={`git-history-create-pr-preview-card${createPrPreviewExpanded ? " is-expanded" : ""}`}
    >
      <div className="git-history-create-pr-preview-head">
        <div className="git-history-create-pr-preview-title-wrap">
          <span className="git-history-create-pr-preview-title">
            {t("git.historyCreatePrPreviewTitle")}
          </span>
          <span className="git-history-create-pr-preview-range">
            {t("git.historyCreatePrPreviewRange", {
              base: createPrPreviewBaseRef || "upstream/HEAD",
              head: createPrPreviewHeadRef || "HEAD",
            })}
          </span>
        </div>
        <div className="git-history-create-pr-preview-actions">
          <button
            type="button"
            className="git-history-create-pr-preview-caret"
            onClick={() =>
              setCreatePrPreviewExpanded((previous) => !previous)
            }
            aria-label={
              createPrPreviewExpanded
                ? t("git.historyCreatePrPreviewCollapse")
                : t("git.historyCreatePrPreviewExpand")
            }
            title={
              createPrPreviewExpanded
                ? t("git.historyCreatePrPreviewCollapse")
                : t("git.historyCreatePrPreviewExpand")
            }
          >
            <ChevronDown size={13} />
          </button>
          <button
            type="button"
            className="git-history-create-pr-mini-btn"
            onClick={() => void loadCreatePrCommitPreview()}
            disabled={
              createPrSubmitting ||
              createPrDefaultsLoading ||
              createPrPreviewLoading ||
              !createPrPreviewHeadRef ||
              !createPrPreviewBaseRef
            }
          >
            {createPrPreviewLoading ? (
              <LoaderCircle size={13} />
            ) : (
              <RefreshCw size={13} />
            )}
            <span>{t("git.historyCreatePrPreviewRefresh")}</span>
          </button>
        </div>
      </div>
      <div className="git-history-create-pr-preview-collapsible">
        <div className="git-history-create-pr-preview-summary">
          <span>
            {t("git.historyCreatePrPreviewOutgoingCount", {
              count: createPrPreviewCommits.length,
            })}
          </span>
          <span>
            {t("git.historyCreatePrPreviewBaseOnlyCount", {
              count: createPrPreviewBaseOnlyCount,
            })}
          </span>
        </div>
        <div className="git-history-push-preview">
          <div className="git-history-push-preview-pane is-commits">
            <div className="git-history-push-preview-head">
              <span className="git-history-push-preview-title">
                <GitCommit size={12} />
                {t("git.historyPushDialogPreviewCommits")}
              </span>
              <strong>{createPrPreviewCommits.length}</strong>
            </div>
            {createPrPreviewError ? (
              <div className="git-history-push-preview-error">
                {createPrPreviewError}
              </div>
            ) : createPrPreviewLoading ? (
              <div className="git-history-push-preview-empty">
                {t("common.loading")}
              </div>
            ) : createPrPreviewCommits.length === 0 ? (
              <div className="git-history-push-preview-empty">
                {t("git.historyCreatePrPreviewEmpty")}
              </div>
            ) : (
              <div className="git-history-push-preview-commit-list">
                {createPrPreviewCommits.map((entry) => {
                  const active =
                    entry.sha === createPrPreviewSelectedSha;
                  return (
                    <button
                      key={`create-pr-preview-${entry.sha}`}
                      type="button"
                      className={`git-history-push-preview-commit${active ? " is-active" : ""}`}
                      onClick={() =>
                        setCreatePrPreviewSelectedSha(entry.sha)
                      }
                    >
                      <span className="git-history-push-preview-commit-summary">
                        {entry.summary ||
                          t("git.historyNoMessage")}
                      </span>
                      <span className="git-history-push-preview-commit-meta">
                        <code>{entry.shortSha}</code>
                        <em>
                          {entry.author || t("git.unknown")}
                        </em>
                        <time>
                          {formatRelativeTime(entry.timestamp, t)}
                        </time>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="git-history-push-preview-pane is-details">
            <div className="git-history-push-preview-head">
              <span className="git-history-push-preview-title">
                <FileText size={12} />
                {t("git.historyPushDialogPreviewDetails")}
              </span>
            </div>
            {!createPrPreviewError &&
            createPrPreviewDetailsLoading ? (
              <div className="git-history-push-preview-empty">
                {t("git.historyPushDialogPreviewLoadingDetails")}
              </div>
            ) : null}
            {createPrPreviewDetailsError ? (
              <div className="git-history-push-preview-error">
                {createPrPreviewDetailsError}
              </div>
            ) : null}
            {!createPrPreviewDetailsLoading &&
            !createPrPreviewDetailsError &&
            !createPrPreviewSelectedCommit ? (
              <div className="git-history-push-preview-empty">
                {t("git.historyPushDialogPreviewSelectCommit")}
              </div>
            ) : null}
            {createPrPreviewDetails &&
            !createPrPreviewDetailsLoading &&
            !createPrPreviewDetailsError ? (
              <div className="git-history-push-preview-details">
                <div className="git-history-push-preview-metadata">
                  <strong>
                    {createPrPreviewDetails.summary ||
                      t("git.historyNoMessage")}
                  </strong>
                  <span className="git-history-push-preview-metadata-row">
                    <code>{createPrPreviewDetails.sha}</code>
                    <em>
                      {createPrPreviewDetails.author ||
                        t("git.unknown")}
                    </em>
                    <time>
                      {new Date(
                        createPrPreviewDetails.commitTime * 1000,
                      ).toLocaleString()}
                    </time>
                  </span>
                </div>
                {extractCommitBody(
                  createPrPreviewDetails.summary,
                  createPrPreviewDetails.message,
                ) ? (
                  <pre className="git-history-create-pr-preview-message">
                    {extractCommitBody(
                      createPrPreviewDetails.summary,
                      createPrPreviewDetails.message,
                    )}
                  </pre>
                ) : null}
                <div className="git-history-push-preview-file-head git-filetree-section-header">
                  <FolderTree size={12} />
                  <span>
                    {t("git.historyPushDialogPreviewFiles")}
                  </span>
                  <i>{createPrPreviewDetails.files.length}</i>
                </div>
                <div className="git-history-create-pr-preview-file-list">
                  {createPrPreviewDetails.files.length > 0 ? (
                    createPrPreviewDetails.files.map((file) => {
                      const fileKey = buildFileKey(file);
                      return (
                        <div
                          key={`create-pr-preview-file-${fileKey}`}
                          className="git-history-create-pr-preview-file-item"
                          title={file.path}
                        >
                          {file.path}
                        </div>
                      );
                    })
                  ) : (
                    <div className="git-history-push-preview-empty">
                      {t("git.historyNoFileChangesInCommit")}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        {!createPrPreviewError &&
        !createPrPreviewLoading &&
        createPrPreviewHasMore ? (
          <div className="git-history-create-pr-preview-hint">
            {t("git.historyCreatePrPreviewTruncated", {
              count: CREATE_PR_PREVIEW_COMMIT_LIMIT,
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
