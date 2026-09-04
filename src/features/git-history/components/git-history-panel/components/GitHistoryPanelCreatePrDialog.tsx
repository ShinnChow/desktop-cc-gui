import type { GitHistoryPanelViewScope } from "./GitHistoryPanelTypes";
import { CommitMessageEngineIcon } from "../../../../git/components/CommitMessageEngineIcon";
import { renderGitHistoryPanelCreatePrPreviewCard } from "./GitHistoryPanelCreatePrPreviewCard";

type CreatePrDialogScope = Pick<
  GitHistoryPanelViewScope,
  | "CREATE_PR_PREVIEW_COMMIT_LIMIT"
  | "ChevronDown"
  | "ChevronLeft"
  | "CircleAlert"
  | "CircleCheck"
  | "Copy"
  | "FileText"
  | "FolderTree"
  | "GitBranch"
  | "GitCommit"
  | "GitHistoryInlinePicker"
  | "GitPullRequestCreate"
  | "HardDrive"
  | "LoaderCircle"
  | "MessageSquareText"
  | "RefreshCw"
  | "buildFileKey"
  | "closeCreatePrDialog"
  | "createPortal"
  | "createPrBaseBranchOptions"
  | "createPrBaseRepoOptions"
  | "createPrCanConfirm"
  | "createPrCompareBranchOptions"
  | "createPrContentElapsedSec"
  | "createPrContentEngine"
  | "createPrContentError"
  | "createPrContentGenerating"
  | "createPrContentSlow"
  | "createPrContentSuccessAt"
  | "createPrCopiedPrUrl"
  | "createPrCopiedRetryCommand"
  | "createPrDefaultsError"
  | "createPrDefaultsLoading"
  | "createPrDialogOpen"
  | "createPrForm"
  | "createPrFormFlashAt"
  | "createPrHeadRepoOptions"
  | "createPrHeadRepositoryValue"
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
  | "createPrResult"
  | "createPrResultHeadline"
  | "createPrStages"
  | "createPrSubmitting"
  | "documentContentNode"
  | "extractCommitBody"
  | "formatRelativeTime"
  | "handleConfirmCreatePr"
  | "handleCopyCreatePrRetryCommand"
  | "handleCopyCreatePrUrl"
  | "handleCreatePrHeadRepositoryChange"
  | "isCreatePrDialogMaximized"
  | "loadCreatePrCommitPreview"
  | "localizeKnownGitError"
  | "openPrContentGenerationMenu"
  | "setCreatePrForm"
  | "setCreatePrPreviewExpanded"
  | "setCreatePrPreviewSelectedSha"
  | "setIsCreatePrDialogMaximized"
  | "t"
> & {
  createPrContentPrerequisitesMissing: boolean;
};

export function renderGitHistoryPanelCreatePrDialog(
  scope: CreatePrDialogScope,
) {
  const {
    CREATE_PR_PREVIEW_COMMIT_LIMIT,
    ChevronDown,
    ChevronLeft,
    CircleAlert,
    CircleCheck,
    Copy,
    FileText,
    FolderTree,
    GitBranch,
    GitCommit,
    GitHistoryInlinePicker,
    GitPullRequestCreate,
    HardDrive,
    LoaderCircle,
    MessageSquareText,
    RefreshCw,
    buildFileKey,
    closeCreatePrDialog,
    createPortal,
    createPrBaseBranchOptions,
    createPrBaseRepoOptions,
    createPrCanConfirm,
    createPrCompareBranchOptions,
    createPrContentElapsedSec,
    createPrContentEngine,
    createPrContentError,
    createPrContentGenerating,
    createPrContentPrerequisitesMissing,
    createPrContentSlow,
    createPrContentSuccessAt,
    createPrCopiedPrUrl,
    createPrCopiedRetryCommand,
    createPrDefaultsError,
    createPrDefaultsLoading,
    createPrDialogOpen,
    createPrForm,
    createPrFormFlashAt,
    createPrHeadRepoOptions,
    createPrHeadRepositoryValue,
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
    createPrResult,
    createPrResultHeadline,
    createPrStages,
    createPrSubmitting,
    documentContentNode,
    extractCommitBody,
    formatRelativeTime,
    handleConfirmCreatePr,
    handleCopyCreatePrRetryCommand,
    handleCopyCreatePrUrl,
    handleCreatePrHeadRepositoryChange,
    isCreatePrDialogMaximized,
    loadCreatePrCommitPreview,
    localizeKnownGitError,
    openPrContentGenerationMenu,
    setCreatePrForm,
    setCreatePrPreviewExpanded,
    setCreatePrPreviewSelectedSha,
    setIsCreatePrDialogMaximized,
    t,
  } = scope;

  return !documentContentNode &&
    createPrDialogOpen &&
    typeof document !== "undefined"
      ? createPortal(
          <div
            className="git-history-create-branch-backdrop git-history-create-pr-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeCreatePrDialog();
              }
            }}
          >
            <section
              className={`git-history-create-pr-dialog ${isCreatePrDialogMaximized ? "is-maximized" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-label={t("git.historyCreatePrDialogTitle")}
            >
              <div className="git-history-create-pr-header">
                <div className="git-history-create-pr-title-wrap">
                  <span className="git-history-create-pr-title-icon">
                    <GitPullRequestCreate size={16} />
                  </span>
                  <div className="git-history-create-pr-title-copy">
                    <strong>{t("git.historyCreatePrDialogTitle")}</strong>
                    <p>{t("git.historyCreatePrDialogSubtitle")}</p>
                  </div>
                </div>
                <div className="git-history-create-pr-header-actions">
                  <button
                    type="button"
                    className="git-history-force-delete-close"
                    onClick={() =>
                      setIsCreatePrDialogMaximized((value) => !value)
                    }
                    aria-label={
                      isCreatePrDialogMaximized
                        ? t("common.restore")
                        : t("menu.maximize")
                    }
                    title={
                      isCreatePrDialogMaximized
                        ? t("common.restore")
                        : t("menu.maximize")
                    }
                  >
                    <span
                      className="git-history-force-delete-close-glyph"
                      aria-hidden
                    >
                      {isCreatePrDialogMaximized ? "❐" : "□"}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="git-history-force-delete-close"
                    onClick={closeCreatePrDialog}
                    aria-label={t("common.close")}
                    title={t("common.close")}
                    disabled={createPrSubmitting}
                  >
                    <span
                      className="git-history-force-delete-close-glyph"
                      aria-hidden
                    >
                      ×
                    </span>
                  </button>
                </div>
              </div>

              {createPrDefaultsLoading ? (
                <div className="git-history-create-pr-inline-hint">
                  {t("git.historyCreatePrLoadingDefaults")}
                </div>
              ) : null}
              {createPrDefaultsError ? (
                <div className="git-history-create-pr-warning">
                  <CircleAlert size={14} />
                  <span>
                    {t("git.historyCreatePrLoadDefaultsFailed")}{" "}
                    {localizeKnownGitError(createPrDefaultsError) ??
                      createPrDefaultsError}
                  </span>
                </div>
              ) : null}

              <section className="git-history-create-pr-compare-card">
                <div className="git-history-create-pr-compare-bar">
                  <span
                    className="git-history-create-pr-compare-icon"
                    aria-hidden
                  >
                    <GitPullRequestCreate size={14} />
                  </span>
                  <label className="git-history-create-pr-compare-field">
                    <span>
                      <HardDrive
                        size={11}
                        className="git-history-create-pr-field-chip-icon"
                      />
                      <span className="git-history-create-pr-field-chip-text">
                        {t("git.historyCreatePrCompareBaseRepo")}
                      </span>
                    </span>
                    <GitHistoryInlinePicker
                      label={t("git.historyCreatePrCompareBaseRepo")}
                      value={createPrForm.upstreamRepo}
                      options={createPrBaseRepoOptions}
                      triggerIcon={<HardDrive size={13} />}
                      optionIcon={<HardDrive size={13} />}
                      disabled={
                        createPrSubmitting || createPrDefaultsLoading
                      }
                      searchPlaceholder={t("workspace.searchProjects")}
                      emptyText={t("workspace.noProjectsFound")}
                      onSelect={(nextValue) =>
                        setCreatePrForm((previous) => ({
                          ...previous,
                          upstreamRepo: nextValue,
                        }))
                      }
                    />
                  </label>
                  <label className="git-history-create-pr-compare-field">
                    <span>
                      <GitBranch
                        size={11}
                        className="git-history-create-pr-field-chip-icon"
                      />
                      <span className="git-history-create-pr-field-chip-text">
                        {t("git.historyCreatePrCompareBase")}
                      </span>
                    </span>
                    <GitHistoryInlinePicker
                      label={t("git.historyCreatePrCompareBase")}
                      value={createPrForm.baseBranch}
                      options={createPrBaseBranchOptions}
                      triggerIcon={<GitBranch size={13} />}
                      optionIcon={<GitBranch size={13} />}
                      disabled={
                        createPrSubmitting || createPrDefaultsLoading
                      }
                      searchPlaceholder={t("git.historySearchBranches")}
                      emptyText={t("git.historyNoBranchesFound")}
                      onSelect={(nextValue) =>
                        setCreatePrForm((previous) => ({
                          ...previous,
                          baseBranch: nextValue,
                        }))
                      }
                    />
                  </label>
                  <span
                    className="git-history-create-pr-compare-separator"
                    aria-hidden
                  >
                    <ChevronLeft size={14} />
                  </span>
                  <label className="git-history-create-pr-compare-field">
                    <span>
                      <HardDrive
                        size={11}
                        className="git-history-create-pr-field-chip-icon"
                      />
                      <span className="git-history-create-pr-field-chip-text">
                        {t("git.historyCreatePrCompareHeadRepo")}
                      </span>
                    </span>
                    <GitHistoryInlinePicker
                      label={t("git.historyCreatePrCompareHeadRepo")}
                      value={createPrHeadRepositoryValue}
                      options={createPrHeadRepoOptions}
                      triggerIcon={<HardDrive size={13} />}
                      optionIcon={<HardDrive size={13} />}
                      disabled={
                        createPrSubmitting || createPrDefaultsLoading
                      }
                      searchPlaceholder={t("workspace.searchProjects")}
                      emptyText={t("workspace.noProjectsFound")}
                      onSelect={handleCreatePrHeadRepositoryChange}
                    />
                  </label>
                  <label className="git-history-create-pr-compare-field">
                    <span>
                      <GitPullRequestCreate
                        size={11}
                        className="git-history-create-pr-field-chip-icon"
                      />
                      <span className="git-history-create-pr-field-chip-text">
                        {t("git.historyCreatePrCompare")}
                      </span>
                    </span>
                    <GitHistoryInlinePicker
                      label={t("git.historyCreatePrCompare")}
                      value={createPrForm.headBranch}
                      options={createPrCompareBranchOptions}
                      triggerIcon={<GitPullRequestCreate size={13} />}
                      optionIcon={<GitPullRequestCreate size={13} />}
                      disabled={
                        createPrSubmitting || createPrDefaultsLoading
                      }
                      searchPlaceholder={t("git.historySearchBranches")}
                      emptyText={t("git.historyNoBranchesFound")}
                      onSelect={(nextValue) =>
                        setCreatePrForm((previous) => ({
                          ...previous,
                          headBranch: nextValue,
                        }))
                      }
                    />
                  </label>
                </div>
              </section>

              {renderGitHistoryPanelCreatePrPreviewCard({
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
              })}

              <div className="git-history-create-branch-field">
                <div className="is-pr-content-row">
                  <span>{t("git.historyCreatePrFieldTitle")}</span>
                  <button
                    type="button"
                    className={`git-history-create-pr-generate-button${createPrContentGenerating ? " is-loading" : ""}`}
                    onClick={openPrContentGenerationMenu}
                    disabled={
                      createPrContentGenerating ||
                      createPrSubmitting ||
                      createPrDefaultsLoading ||
                      createPrContentPrerequisitesMissing
                    }
                    aria-haspopup="menu"
                    title={t(
                      createPrContentPrerequisitesMissing
                        ? "git.historyGeneratePrMissingBaseOrHead"
                        : "git.historyGeneratePrTitleBody",
                    )}
                    aria-label={t("git.historyGeneratePrTitleBody")}
                  >
                    <CommitMessageEngineIcon
                      engine={createPrContentEngine}
                      size={14}
                      className={
                        createPrContentGenerating
                          ? "commit-message-engine-icon commit-message-engine-icon--spinning"
                          : "commit-message-engine-icon"
                      }
                    />
                  </button>
                </div>
                <input
                  value={createPrForm.title}
                  aria-label={t("git.historyCreatePrFieldTitle")}
                  disabled={
                    createPrSubmitting ||
                    createPrDefaultsLoading ||
                    createPrContentGenerating
                  }
                  onChange={(event) =>
                    setCreatePrForm((previous) => ({
                      ...previous,
                      title: event.target.value,
                    }))
                  }
                  placeholder={t("git.historyCreatePrTitlePlaceholder")}
                  data-ai-flash-at={createPrFormFlashAt ?? undefined}
                />
              </div>
              {createPrContentGenerating ? (
                <div
                  className={`git-history-create-pr-generation-progress${
                    createPrContentSlow ? " is-slow" : ""
                  }`}
                  role="status"
                  aria-live="polite"
                >
                  {createPrContentSlow
                    ? t("git.historyGeneratePrLoadingSlow", {
                        defaultValue: "AI 仍在生成中… ({{elapsed}}s)",
                        elapsed: createPrContentElapsedSec,
                      })
                    : t("git.historyGeneratePrLoading", {
                        elapsed: createPrContentElapsedSec,
                      })}
                </div>
              ) : null}
              {createPrContentError ? (
                <div
                  className="git-history-create-pr-generation-error"
                  role="alert"
                >
                  {createPrContentError}
                </div>
              ) : null}
              {!createPrContentError &&
              !createPrContentGenerating &&
              createPrContentSuccessAt !== null ? (
                <div
                  className="git-history-create-pr-generation-success"
                  role="status"
                >
                  {t("git.historyGeneratePrSuccessWithEngine", {
                    engine:
                      createPrContentEngine === "claude"
                        ? "Claude"
                        : createPrContentEngine === "codex"
                          ? "Codex"
                          : createPrContentEngine === "grok"
                          ? "Grok"
                          : createPrContentEngine === "kimi"
                            ? "Kimi"
                            : createPrContentEngine === "opencode"
                              ? "OpenCode"
                              : createPrContentEngine === "gemini"
                                ? "Gemini"
                                : createPrContentEngine,
                  })}
                </div>
              ) : null}
              <div className="git-history-create-branch-field">
                <span>{t("git.historyCreatePrFieldBody")}</span>
                <textarea
                  className="git-history-create-pr-textarea"
                  value={createPrForm.body}
                  aria-label={t("git.historyCreatePrFieldBody")}
                  disabled={
                    createPrSubmitting ||
                    createPrDefaultsLoading ||
                    createPrContentGenerating
                  }
                  onChange={(event) =>
                    setCreatePrForm((previous) => ({
                      ...previous,
                      body: event.target.value,
                    }))
                  }
                  data-ai-flash-at={createPrFormFlashAt ?? undefined}
                />
              </div>
              <button
                type="button"
                className={`git-history-push-toggle${createPrForm.commentAfterCreate ? " is-active" : ""}`}
                aria-pressed={createPrForm.commentAfterCreate}
                disabled={createPrSubmitting || createPrDefaultsLoading}
                onClick={() =>
                  setCreatePrForm((previous) => ({
                    ...previous,
                    commentAfterCreate: !previous.commentAfterCreate,
                  }))
                }
              >
                <span
                  className="git-history-push-toggle-indicator"
                  aria-hidden
                >
                  {createPrForm.commentAfterCreate ? "✓" : ""}
                </span>
                <MessageSquareText
                  size={12}
                  className="git-history-push-toggle-icon"
                />
                <span>{t("git.historyCreatePrCommentAfterCreate")}</span>
              </button>
              {createPrForm.commentAfterCreate ? (
                <label className="git-history-create-branch-field">
                  <span>{t("git.historyCreatePrCommentBody")}</span>
                  <textarea
                    className="git-history-create-pr-textarea is-compact"
                    value={createPrForm.commentBody}
                    disabled={createPrSubmitting || createPrDefaultsLoading}
                    onChange={(event) =>
                      setCreatePrForm((previous) => ({
                        ...previous,
                        commentBody: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}

              <div className="git-history-create-pr-stage-card">
                <div className="git-history-create-pr-stage-title">
                  {t("git.historyCreatePrStageProgress")}
                </div>
                <div className="git-history-create-pr-stage-list">
                  {createPrStages.map((stage) => {
                    const statusLabel =
                      stage.status === "running"
                        ? t("git.historyCreatePrStageRunning")
                        : stage.status === "success"
                          ? t("git.historyCreatePrStageSuccess")
                          : stage.status === "failed"
                            ? t("git.historyCreatePrStageFailed")
                            : stage.status === "skipped"
                              ? t("git.historyCreatePrStageSkipped")
                              : t("git.historyCreatePrStagePending");
                    return (
                      <div
                        key={stage.key}
                        className={`git-history-create-pr-stage-item is-${stage.status}`}
                      >
                        <span
                          className="git-history-create-pr-stage-icon"
                          aria-hidden
                        >
                          {stage.status === "success" ? (
                            <CircleCheck size={14} />
                          ) : stage.status === "failed" ? (
                            <CircleAlert size={14} />
                          ) : stage.status === "running" ? (
                            <LoaderCircle size={14} />
                          ) : (
                            <span className="git-history-create-pr-stage-dot" />
                          )}
                        </span>
                        <span className="git-history-create-pr-stage-main">
                          <span className="git-history-create-pr-stage-label">
                            {stage.label}
                          </span>
                          <span className="git-history-create-pr-stage-detail">
                            {stage.detail}
                          </span>
                        </span>
                        <span className="git-history-create-pr-stage-status">
                          {statusLabel}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {createPrResult ? (
                <div
                  className={`git-history-create-pr-result ${
                    createPrResult.ok ? "is-success" : "is-failed"
                  }`}
                >
                  <div className="git-history-create-pr-result-head">
                    <span className="git-history-create-pr-result-title">
                      {createPrResultHeadline}
                    </span>
                    {createPrResult.prNumber ? (
                      <code>#{createPrResult.prNumber}</code>
                    ) : null}
                  </div>
                  <div className="git-history-create-pr-result-message">
                    {createPrResult.message}
                  </div>
                  {createPrResult.nextActionHint ? (
                    <div className="git-history-create-pr-result-hint">
                      {createPrResult.nextActionHint}
                    </div>
                  ) : null}
                  {createPrResult.prUrl ? (
                    <div className="git-history-create-pr-result-actions">
                      <button
                        type="button"
                        className="git-history-create-pr-mini-btn"
                        onClick={() => void handleCopyCreatePrUrl()}
                      >
                        <Copy size={13} />
                        <span>
                          {createPrCopiedPrUrl
                            ? t("git.historyCreatePrCopied")
                            : t("git.historyCreatePrCopyLink")}
                        </span>
                      </button>
                    </div>
                  ) : null}
                  {createPrResult.retryCommand ? (
                    <div className="git-history-create-pr-retry-command">
                      <span>{t("git.historyCreatePrRetryCommand")}</span>
                      <code>{createPrResult.retryCommand}</code>
                      <button
                        type="button"
                        className="git-history-create-pr-mini-btn"
                        onClick={() =>
                          void handleCopyCreatePrRetryCommand()
                        }
                      >
                        <Copy size={13} />
                        <span>
                          {createPrCopiedRetryCommand
                            ? t("git.historyCreatePrCopied")
                            : t("git.historyCreatePrCopyCommand")}
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="git-history-create-branch-actions">
                <button
                  type="button"
                  className="git-history-create-branch-btn is-cancel"
                  disabled={createPrSubmitting || createPrDefaultsLoading}
                  onClick={closeCreatePrDialog}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="git-history-create-branch-btn is-confirm"
                  disabled={!createPrCanConfirm}
                  onClick={() => void handleConfirmCreatePr()}
                  title={
                    !createPrCanConfirm
                      ? t("git.historyCreatePrFormIncomplete")
                      : undefined
                  }
                >
                  {createPrSubmitting
                    ? t("common.loading")
                    : createPrResult && !createPrResult.ok
                      ? t("common.retry")
                      : t("git.historyCreatePrAction")}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )
      : null;
}
