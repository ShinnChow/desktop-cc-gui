import {
  GitOperationTokens,
  type GitOperationToken,
} from "../GitOperationTokens";
import type { GitHistoryPanelViewScope } from "../GitHistoryPanelImpl";
import { isPushTargetHistoryMatch } from "../../utils/pushTargetHistory";

export function renderGitHistoryPushDialog(scope: GitHistoryPanelViewScope) {
  const {
    ActionSurface,
    ChevronDown,
    ChevronRight,
    Cloud,
    FileIcon,
    FileText,
    FolderTree,
    GitBranch,
    GitCommit,
    GitDiffViewer,
    RefreshCw,
    Repeat,
    Upload,
    X,
    buildFileKey,
    codeAnnotations,
    createPortal,
    currentBranch,
    diffViewMode,
    formatRelativeTime,
    getBranchLeafName,
    getBranchScope,
    getTreeLineOpacity,
    handleConfirmPush,
    handlePushPreviewDirToggle,
    handleSelectPushRemote,
    handleSelectPushTargetBranch,
    handleSelectPushHistory,
    History,
    isHistoryDiffModalMaximized,
    localizeKnownGitError,
    onCreateCodeAnnotation,
    onRemoveCodeAnnotation,
    openPushTargetBranchMenu,
    pushCanConfirm,
    pushCc,
    pushForceWithLease,
    pushHasOutgoingCommits,
    pushIsNewBranchTarget,
    pushPreviewCommits,
    pushPreviewDetails,
    pushPreviewDetailsError,
    pushPreviewDetailsLoading,
    pushPreviewError,
    pushPreviewFileTreeItems,
    pushPreviewHasMore,
    pushPreviewLoading,
    pushPreviewModalDiffEntries,
    pushPreviewModalFile,
    pushPreviewModalFileDiff,
    pushPreviewModalFullDiffLoader,
    pushPreviewSelectedCommit,
    pushPreviewSelectedFileKey,
    pushPreviewSelectedSha,
    pushRemoteMenuOpen,
    pushRemoteMenuPlacement,
    pushRemoteOptions,
    pushRemotePickerRef,
    pushRemoteTrimmed,
    pushReviewers,
    pushRunHooks,
    pushSubmitting,
    pushTags,
    pushTargetBranch,
    pushTargetBranchActiveScopeTab,
    pushTargetBranchFieldRef,
    pushTargetBranchGroups,
    pushTargetBranchMenuOpen,
    pushTargetBranchMenuPlacement,
    pushTargetBranchMenuRef,
    pushTargetBranchPickerRef,
    pushTargetBranchTrimmed,
    pushTargetHistory,
    pushTargetSummaryBranch,
    pushToGerrit,
    pushTopic,
    setDiffViewMode,
    setIsHistoryDiffModalMaximized,
    setPushCc,
    setPushDialogOpen,
    setPushForceWithLease,
    setPushPreviewModalFileKey,
    setPushPreviewSelectedFileKey,
    setPushPreviewSelectedSha,
    setPushRemoteMenuOpen,
    setPushReviewers,
    setPushRunHooks,
    setPushTags,
    setPushTargetBranch,
    setPushTargetBranchActiveScopeTab,
    setPushTargetBranchMenuOpen,
    setPushTargetBranchQuery,
    setPushToGerrit,
    setPushTopic,
    statusLabel,
    t,
    updatePushRemoteMenuPlacement,
    visiblePushTargetBranchGroups,
    workspaceId,
  } = scope;
  const pushSourceBranch = currentBranch || "HEAD";
  const pushTargetRemote = pushRemoteTrimmed || "origin";
  const pushTargetTokens: GitOperationToken[] = [
    { kind: "branch", value: pushSourceBranch },
    { kind: "operator", value: "->" },
    { kind: "remote", value: pushTargetRemote },
    { kind: "operator", value: ":", separatorBefore: "" },
    { kind: "branch", value: pushTargetSummaryBranch, separatorBefore: "" },
  ];
  return (
    <div
      className="git-history-create-branch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pushSubmitting) {
          setPushDialogOpen(false);
        }
      }}
    >
      <div
        className="git-history-push-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("git.historyPushDialogTitle")}
      >
        <div className="git-history-push-hero">
          <div className="git-history-create-branch-title git-history-push-title">
            <Upload size={14} />
            <span>{t("git.historyPushDialogTitle")}</span>
          </div>
          <div className="git-history-push-summary-row">
            <div className="git-history-push-target-wrap">
              <GitOperationTokens
                as="div"
                className="git-history-push-target"
                tokens={pushTargetTokens}
              />
              {pushIsNewBranchTarget ? (
                <span className="git-history-push-target-badge">
                  ({t("git.historyPushDialogTargetNewTag")})
                </span>
              ) : null}
            </div>
            <code className="git-history-push-readonly">
              {currentBranch || "HEAD"}
            </code>
          </div>
        </div>
        {!pushIsNewBranchTarget ? (
          <div className="git-history-push-section git-history-push-section-preview">
            <div className="git-history-push-preview">
              <div className="git-history-push-preview-pane is-commits">
                <div className="git-history-push-preview-head">
                  <span className="git-history-push-preview-title">
                    <GitCommit size={12} />
                    {t("git.historyPushDialogPreviewCommits")}
                  </span>
                  <strong>{pushPreviewCommits.length}</strong>
                </div>
                {!pushPreviewError && pushPreviewLoading ? (
                  <div className="git-history-push-preview-empty">
                    {t("git.historyPushDialogPreviewLoading")}
                  </div>
                ) : null}
                {pushPreviewError ? (
                  <div className="git-history-push-preview-error">
                    {localizeKnownGitError(pushPreviewError) ??
                      pushPreviewError}
                  </div>
                ) : null}
                {!pushPreviewError &&
                !pushPreviewLoading &&
                !pushHasOutgoingCommits ? (
                  <div className="git-history-push-preview-empty">
                    {t("git.historyPushDialogPreviewNoOutgoing")}
                  </div>
                ) : null}
                {!pushPreviewError &&
                !pushPreviewLoading &&
                pushHasOutgoingCommits ? (
                  <div className="git-history-push-preview-commit-list">
                    {pushPreviewCommits.map((entry) => {
                      const active = entry.sha === pushPreviewSelectedSha;
                      return (
                        <button
                          key={entry.sha}
                          type="button"
                          className={`git-history-push-preview-commit${active ? " is-active" : ""}`}
                          onClick={() => setPushPreviewSelectedSha(entry.sha)}
                        >
                          <span className="git-history-push-preview-commit-summary">
                            {entry.summary || t("git.historyNoMessage")}
                          </span>
                          <span className="git-history-push-preview-commit-meta">
                            <code>{entry.shortSha}</code>
                            <em>{entry.author || t("git.unknown")}</em>
                            <time>
                              {formatRelativeTime(entry.timestamp, t)}
                            </time>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {!pushPreviewError && pushPreviewHasMore ? (
                  <div className="git-history-push-preview-hint">
                    {t("git.historyPushDialogPreviewHasMore", {
                      count: pushPreviewCommits.length,
                    })}
                  </div>
                ) : null}
              </div>
              <div className="git-history-push-preview-pane is-details">
                <div className="git-history-push-preview-head">
                  <span className="git-history-push-preview-title">
                    <FileText size={12} />
                    {t("git.historyPushDialogPreviewDetails")}
                  </span>
                </div>
                {!pushPreviewError && pushPreviewDetailsLoading ? (
                  <div className="git-history-push-preview-empty">
                    {t("git.historyPushDialogPreviewLoadingDetails")}
                  </div>
                ) : null}
                {pushPreviewDetailsError ? (
                  <div className="git-history-push-preview-error">
                    {localizeKnownGitError(pushPreviewDetailsError) ??
                      pushPreviewDetailsError}
                  </div>
                ) : null}
                {!pushPreviewDetailsLoading &&
                !pushPreviewDetailsError &&
                !pushPreviewSelectedCommit ? (
                  <div className="git-history-push-preview-empty">
                    {t("git.historyPushDialogPreviewSelectCommit")}
                  </div>
                ) : null}
                {pushPreviewDetails &&
                !pushPreviewDetailsLoading &&
                !pushPreviewDetailsError ? (
                  <div className="git-history-push-preview-details">
                    <div className="git-history-push-preview-metadata">
                      <strong>
                        {pushPreviewDetails.summary ||
                          t("git.historyNoMessage")}
                      </strong>
                      <span className="git-history-push-preview-metadata-row">
                        <code>{pushPreviewDetails.sha}</code>
                        <em>{pushPreviewDetails.author || t("git.unknown")}</em>
                        <time>
                          {new Date(
                            pushPreviewDetails.commitTime * 1000,
                          ).toLocaleString()}
                        </time>
                      </span>
                    </div>
                    <div className="git-history-push-preview-file-head git-filetree-section-header">
                      <FolderTree size={12} />
                      <span>{t("git.historyPushDialogPreviewFiles")}</span>
                      <i>{pushPreviewDetails.files.length}</i>
                    </div>
                    <div className="git-history-push-preview-file-tree git-filetree-list git-filetree-list--tree">
                      {pushPreviewFileTreeItems.length > 0 ? (
                        pushPreviewFileTreeItems.map((item) => {
                          const treeIndentPx = item.depth * 14;
                          const treeGuideDepth = item.depth > 0 ? 1 : 0;
                          const treeRowStyle = {
                            paddingLeft: `${treeIndentPx}px`,
                            ["--git-tree-indent-x" as string]: `${Math.max(treeGuideDepth * 14 - 7, 0)}px`,
                            ["--git-tree-line-opacity" as string]:
                              getTreeLineOpacity(treeGuideDepth),
                          };
                          if (item.type === "dir") {
                            return (
                              <ActionSurface
                                key={`push-preview-${item.id}`}
                                className="git-history-tree-item git-history-tree-dir git-filetree-folder-row"
                                onActivate={() =>
                                  handlePushPreviewDirToggle(item.path)
                                }
                                style={treeRowStyle}
                              >
                                <span
                                  className="git-history-tree-caret"
                                  aria-hidden
                                >
                                  {item.expanded ? (
                                    <ChevronDown size={12} />
                                  ) : (
                                    <ChevronRight size={12} />
                                  )}
                                </span>
                                <span
                                  className="git-history-tree-icon"
                                  aria-hidden
                                >
                                  <FileIcon
                                    filePath={item.path}
                                    isFolder
                                    isOpen={item.expanded}
                                  />
                                </span>
                                <span className="git-history-tree-label">
                                  {item.label}
                                </span>
                              </ActionSurface>
                            );
                          }
                          const file = item.change;
                          const fileKey = buildFileKey(file);
                          const active = pushPreviewSelectedFileKey === fileKey;
                          return (
                            <ActionSurface
                              key={`push-preview-${item.id}`}
                              className="git-history-tree-item git-history-file-item git-filetree-row"
                              active={active}
                              onActivate={() => {
                                setPushPreviewSelectedFileKey(fileKey);
                                setPushPreviewModalFileKey(fileKey);
                              }}
                              style={treeRowStyle}
                              title={statusLabel(file)}
                            >
                              <span
                                className={`git-history-file-status git-status-${file.status.toLowerCase()}`}
                              >
                                {file.status}
                              </span>
                              <span
                                className="git-history-tree-icon is-file"
                                aria-hidden
                              >
                                <FileIcon filePath={file.path} />
                              </span>
                              <span className="git-history-file-path">
                                {item.label}
                              </span>
                              <span className="git-history-file-stats git-filetree-badge">
                                <span className="is-add">
                                  +{file.additions}
                                </span>
                                <span className="is-sep">/</span>
                                <span className="is-del">
                                  -{file.deletions}
                                </span>
                              </span>
                            </ActionSurface>
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
          </div>
        ) : (
          <div className="git-history-push-section git-history-push-section-preview">
            <div className="git-history-push-preview">
              <div className="git-history-push-preview-pane is-commits">
                <div className="git-history-push-preview-head">
                  <span className="git-history-push-preview-title">
                    <GitCommit size={12} />
                    {t("git.historyPushDialogPreviewCommits")}
                  </span>
                  <strong>{t("git.historyPushDialogTargetNewTag")}</strong>
                </div>
                <div className="git-history-push-preview-empty">
                  {t("git.historyPushDialogNewBranchPreviewTitle")}
                </div>
                <div className="git-history-push-preview-hint">
                  {t("git.historyPushDialogPreviewTargetMissing", {
                    remote: pushRemoteTrimmed || "origin",
                    branch: pushTargetBranchTrimmed || "main",
                  })}
                </div>
              </div>
              <div className="git-history-push-preview-pane is-details">
                <div className="git-history-push-preview-head">
                  <span className="git-history-push-preview-title">
                    <FileText size={12} />
                    {t("git.historyPushDialogPreviewDetails")}
                  </span>
                </div>
                <div className="git-history-push-preview-empty">
                  {t("git.historyPushDialogNewBranchPreviewHint")}
                </div>
              </div>
            </div>
          </div>
        )}
        {pushPreviewModalFile && typeof document !== "undefined"
          ? createPortal(
              <div
                className="git-history-diff-modal-overlay is-popup"
                role="presentation"
                onClick={() => setPushPreviewModalFileKey(null)}
              >
                <div
                  className={`git-history-diff-modal ${isHistoryDiffModalMaximized ? "is-maximized" : ""}`}
                  role="dialog"
                  aria-modal="true"
                  aria-label={pushPreviewModalFile.path}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="git-history-diff-modal-header">
                    <div className="git-history-diff-modal-title">
                      <span
                        className={`git-history-file-status git-status-${pushPreviewModalFile.status.toLowerCase()}`}
                      >
                        {pushPreviewModalFile.status}
                      </span>
                      <span
                        className="git-history-tree-icon is-file"
                        aria-hidden
                      >
                        <FileIcon filePath={pushPreviewModalFile.path} />
                      </span>
                      <span className="git-history-diff-modal-path">
                        {pushPreviewModalFile.path}
                      </span>
                      <span className="git-history-diff-modal-stats">
                        <span className="is-add">
                          +{pushPreviewModalFile.additions}
                        </span>
                        <span className="is-sep">/</span>
                        <span className="is-del">
                          -{pushPreviewModalFile.deletions}
                        </span>
                      </span>
                    </div>
                    <div className="git-history-diff-modal-actions">
                      <button
                        type="button"
                        className="git-history-diff-modal-close"
                        onClick={() =>
                          setIsHistoryDiffModalMaximized((value) => !value)
                        }
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
                        <span
                          className="git-history-diff-modal-close-glyph"
                          aria-hidden
                        >
                          {isHistoryDiffModalMaximized ? "❐" : "□"}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="git-history-diff-modal-close"
                        onClick={() => setPushPreviewModalFileKey(null)}
                        aria-label={t("common.close")}
                        title={t("common.close")}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {pushPreviewModalFile.truncated &&
                  !pushPreviewModalFile.isBinary ? (
                    <div className="git-history-warning">
                      {t("git.historyDiffTooLargeTruncated", {
                        lineCount: pushPreviewModalFile.lineCount,
                      })}
                    </div>
                  ) : null}
                  {pushPreviewModalFile.isBinary ? (
                    <pre className="git-history-diff-modal-code">
                      {pushPreviewModalFileDiff}
                    </pre>
                  ) : (
                    <div className="git-history-diff-modal-viewer">
                      <GitDiffViewer
                        workspaceId={workspaceId}
                        diffs={pushPreviewModalDiffEntries}
                        selectedPath={pushPreviewModalFile.path}
                        isLoading={false}
                        error={null}
                        listView="flat"
                        stickyHeaderMode="controls-only"
                        embeddedAnchorVariant="modal-pager"
                        showContentModeControls
                        fullDiffLoader={pushPreviewModalFullDiffLoader}
                        fullDiffSourceKey={pushPreviewSelectedSha}
                        diffStyle={diffViewMode}
                        onDiffStyleChange={setDiffViewMode}
                        onCreateCodeAnnotation={onCreateCodeAnnotation}
                        onRemoveCodeAnnotation={onRemoveCodeAnnotation}
                        codeAnnotations={codeAnnotations}
                        codeAnnotationSurface="modal-diff-view"
                      />
                    </div>
                  )}
                </div>
              </div>,
              document.body,
            )
          : null}
        <div className="git-history-push-section git-history-push-section-controls">
          {pushTargetHistory.length > 0 ? (
            <div className="git-history-push-recent">
              <span className="git-history-push-field-label">
                <History size={12} />
                {t("git.historyPushDialogRecentLabel")}
              </span>
              <div
                className="git-history-push-recent-list"
                role="group"
                aria-label={t("git.historyPushDialogRecentLabel")}
              >
                {pushTargetHistory.map((entry) => {
                  const isActive = isPushTargetHistoryMatch(entry, {
                    remote: pushRemoteTrimmed,
                    branch: pushTargetBranchTrimmed,
                    pushToGerrit,
                  });
                  return (
                    <button
                      key={`${entry.remote}:${entry.branch}:${entry.pushToGerrit ? "gerrit" : "plain"}`}
                      type="button"
                      className={`git-history-push-recent-item${isActive ? " is-active" : ""}`}
                      aria-label={`${entry.remote} → ${entry.branch}`}
                      aria-pressed={isActive}
                      disabled={pushSubmitting}
                      title={`${entry.remote} → ${entry.branch}`}
                      onClick={() => handleSelectPushHistory(entry)}
                    >
                      <span className="git-history-push-recent-item-remote">
                        {entry.remote}
                      </span>
                      <span className="git-history-push-recent-item-separator">
                        →
                      </span>
                      <span className="git-history-push-recent-item-branch">
                        {entry.branch}
                      </span>
                      {entry.pushToGerrit ? (
                        <span className="git-history-push-recent-item-badge">
                          {t("git.historyPushDialogRecentGerrit")}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="git-history-push-grid">
            <div className="git-history-create-branch-field">
              <span className="git-history-push-field-label">
                <Cloud size={12} />
                {t("git.historyPushDialogRemoteLabel")}
              </span>
              <div
                className={`git-history-push-picker${pushRemoteMenuOpen ? " is-open" : ""}`}
                ref={pushRemotePickerRef}
              >
                <button
                  type="button"
                  className="git-history-push-picker-trigger"
                  aria-label={t("git.historyPushDialogRemoteLabel")}
                  aria-haspopup="listbox"
                  aria-expanded={pushRemoteMenuOpen}
                  disabled={pushSubmitting}
                  onClick={() => {
                    if (pushSubmitting) {
                      return;
                    }
                    setPushTargetBranchMenuOpen(false);
                    setPushRemoteMenuOpen((previous) => {
                      const nextOpen = !previous;
                      if (nextOpen) {
                        updatePushRemoteMenuPlacement();
                      }
                      return nextOpen;
                    });
                  }}
                >
                  <Cloud
                    size={12}
                    className="git-history-push-picker-leading-icon"
                  />
                  <span className="git-history-push-picker-value">
                    {pushRemoteTrimmed || "origin"}
                  </span>
                  <ChevronDown
                    size={13}
                    className="git-history-push-picker-caret"
                  />
                </button>
                {pushRemoteMenuOpen ? (
                  <div
                    className={`git-history-push-picker-menu popover-surface${
                      pushRemoteMenuPlacement === "up" ? " is-upward" : ""
                    }`}
                    role="listbox"
                    aria-label={t("git.historyPushDialogRemoteLabel")}
                  >
                    {pushRemoteOptions.map((remoteName) => (
                      <button
                        key={remoteName}
                        type="button"
                        className={`git-history-push-picker-item${remoteName === pushRemoteTrimmed ? " is-active" : ""}`}
                        role="option"
                        aria-selected={remoteName === pushRemoteTrimmed}
                        onClick={() => handleSelectPushRemote(remoteName)}
                      >
                        <Cloud
                          size={12}
                          className="git-history-push-picker-item-icon"
                        />
                        <span className="git-history-push-picker-item-content">
                          {remoteName}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <label
              className="git-history-create-branch-field git-history-push-target-field"
              ref={pushTargetBranchFieldRef}
            >
              <span className="git-history-push-field-label">
                <GitBranch size={12} />
                {t("git.historyPushDialogTargetBranchLabel")}
              </span>
              <div
                className={`git-history-push-combobox${pushTargetBranchMenuOpen ? " is-open" : ""}`}
                ref={pushTargetBranchPickerRef}
              >
                <input
                  className="git-history-operation-branch-input"
                  value={pushTargetBranch}
                  disabled={pushSubmitting}
                  onChange={(event) => {
                    setPushTargetBranch(event.target.value);
                    setPushTargetBranchQuery(event.target.value);
                    if (!pushTargetBranchMenuOpen) {
                      openPushTargetBranchMenu(false);
                    }
                  }}
                  onFocus={() => openPushTargetBranchMenu(false)}
                  aria-label={t("git.historyPushDialogTargetBranchLabel")}
                  placeholder={currentBranch ?? "main"}
                />
                <button
                  type="button"
                  className="git-history-push-combobox-toggle"
                  aria-label={`${t("git.historyPushDialogTargetBranchLabel")} toggle`}
                  aria-haspopup="listbox"
                  aria-expanded={pushTargetBranchMenuOpen}
                  disabled={pushSubmitting}
                  onClick={() => {
                    if (pushSubmitting) {
                      return;
                    }
                    const nextOpen = !pushTargetBranchMenuOpen;
                    if (nextOpen) {
                      openPushTargetBranchMenu(true);
                      return;
                    }
                    setPushTargetBranchMenuOpen(false);
                  }}
                >
                  <ChevronDown size={13} />
                </button>
              </div>
              {pushTargetBranchMenuOpen ? (
                <div
                  className={`git-history-push-picker-menu git-history-push-target-menu popover-surface${
                    pushTargetBranchMenuPlacement === "up" ? " is-upward" : ""
                  }`}
                  ref={pushTargetBranchMenuRef}
                  role="listbox"
                  aria-label={t("git.historyPushDialogTargetBranchLabel")}
                >
                  {pushTargetBranchGroups.length > 0 ? (
                    <>
                      {pushTargetBranchGroups.length > 1 ? (
                        <div
                          className="git-history-push-picker-tabs"
                          role="tablist"
                        >
                          {pushTargetBranchGroups.map((group) => {
                            const isActive =
                              group.scope === pushTargetBranchActiveScopeTab;
                            return (
                              <button
                                key={`push-target-tab-${group.scope}`}
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                className={`git-history-push-picker-tab${isActive ? " is-active" : ""}`}
                                onClick={() =>
                                  setPushTargetBranchActiveScopeTab(group.scope)
                                }
                              >
                                <span>{group.label}</span>
                                <i>{group.items.length}</i>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                      {visiblePushTargetBranchGroups.map((group) => (
                        <div
                          key={group.scope}
                          className="git-history-push-picker-group"
                        >
                          {pushTargetBranchGroups.length <= 1 ? (
                            <div className="git-history-push-picker-group-label">
                              <FolderTree size={11} />
                              <span>{group.label}</span>
                              <i>{group.items.length}</i>
                            </div>
                          ) : null}
                          {group.items.map((branchName) => (
                            <button
                              key={branchName}
                              type="button"
                              className={`git-history-push-picker-item${branchName === pushTargetBranchTrimmed ? " is-active" : ""}`}
                              role="option"
                              aria-selected={
                                branchName === pushTargetBranchTrimmed
                              }
                              title={branchName}
                              onClick={() =>
                                handleSelectPushTargetBranch(branchName)
                              }
                            >
                              <GitBranch
                                size={12}
                                className="git-history-push-picker-item-icon"
                              />
                              <span className="git-history-push-picker-item-content">
                                <span className="git-history-push-picker-item-title">
                                  {getBranchLeafName(branchName)}
                                </span>
                                {getBranchScope(branchName) !== "__root__" ? (
                                  <>
                                    <span className="git-history-push-picker-item-separator">
                                      {" "}
                                      ·{" "}
                                    </span>
                                    <span className="git-history-push-picker-item-subtitle">
                                      {branchName}
                                    </span>
                                  </>
                                ) : null}
                              </span>
                            </button>
                          ))}
                        </div>
                      ))}
                    </>
                  ) : (
                    <div className="git-history-push-picker-empty">
                      {t("git.historyPushDialogNoRemoteBranches")}
                    </div>
                  )}
                </div>
              ) : null}
            </label>
          </div>
          <button
            type="button"
            className={`git-history-push-toggle${pushToGerrit ? " is-active" : ""}`}
            aria-pressed={pushToGerrit}
            disabled={pushSubmitting}
            onClick={() => setPushToGerrit((previous) => !previous)}
          >
            <span className="git-history-push-toggle-indicator" aria-hidden>
              {pushToGerrit ? "✓" : ""}
            </span>
            <Upload size={12} className="git-history-push-toggle-icon" />
            <span>{t("git.historyPushDialogPushToGerrit")}</span>
          </button>
          {pushToGerrit ? (
            <>
              <div className="git-history-push-hint">
                {t("git.historyPushDialogGerritHint", {
                  branch: pushTargetBranchTrimmed || currentBranch || "main",
                })}
              </div>
              <div className="git-history-push-grid">
                <label className="git-history-create-branch-field">
                  <span>{t("git.historyPushDialogTopicLabel")}</span>
                  <input
                    value={pushTopic}
                    disabled={pushSubmitting}
                    onChange={(event) => setPushTopic(event.target.value)}
                  />
                </label>
                <label className="git-history-create-branch-field">
                  <span>{t("git.historyPushDialogReviewersLabel")}</span>
                  <input
                    value={pushReviewers}
                    disabled={pushSubmitting}
                    onChange={(event) => setPushReviewers(event.target.value)}
                    placeholder={t("git.historyPushDialogCommaSeparatedHint")}
                  />
                </label>
                <label className="git-history-create-branch-field">
                  <span>{t("git.historyPushDialogCcLabel")}</span>
                  <input
                    value={pushCc}
                    disabled={pushSubmitting}
                    onChange={(event) => setPushCc(event.target.value)}
                    placeholder={t("git.historyPushDialogCommaSeparatedHint")}
                  />
                </label>
              </div>
            </>
          ) : null}
        </div>
        <div className="git-history-push-footer">
          <div className="git-history-push-options">
            <button
              type="button"
              className={`git-history-push-toggle${pushTags ? " is-active" : ""}`}
              aria-pressed={pushTags}
              disabled={pushSubmitting}
              onClick={() => setPushTags((previous) => !previous)}
            >
              <span className="git-history-push-toggle-indicator" aria-hidden>
                {pushTags ? "✓" : ""}
              </span>
              <GitBranch size={12} className="git-history-push-toggle-icon" />
              <span>{t("git.historyPushDialogPushTags")}</span>
            </button>
            <button
              type="button"
              className={`git-history-push-toggle${pushRunHooks ? " is-active" : ""}`}
              aria-pressed={pushRunHooks}
              disabled={pushSubmitting}
              onClick={() => setPushRunHooks((previous) => !previous)}
            >
              <span className="git-history-push-toggle-indicator" aria-hidden>
                {pushRunHooks ? "✓" : ""}
              </span>
              <RefreshCw size={12} className="git-history-push-toggle-icon" />
              <span>{t("git.historyPushDialogRunHooks")}</span>
            </button>
            <button
              type="button"
              className={`git-history-push-toggle${pushForceWithLease ? " is-active" : ""}`}
              aria-pressed={pushForceWithLease}
              disabled={pushSubmitting}
              onClick={() => setPushForceWithLease((previous) => !previous)}
            >
              <span className="git-history-push-toggle-indicator" aria-hidden>
                {pushForceWithLease ? "✓" : ""}
              </span>
              <Repeat size={12} className="git-history-push-toggle-icon" />
              <span>{t("git.historyPushDialogForceWithLease")}</span>
            </button>
          </div>
          <div className="git-history-create-branch-actions">
            <button
              type="button"
              className="git-history-create-branch-btn is-cancel"
              disabled={pushSubmitting}
              onClick={() => setPushDialogOpen(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="git-history-create-branch-btn is-confirm"
              disabled={!pushCanConfirm}
              title={
                !pushCanConfirm &&
                !pushPreviewLoading &&
                !pushHasOutgoingCommits
                  ? t("git.historyPushDialogPreviewNoOutgoingDisableHint")
                  : undefined
              }
              onClick={() => void handleConfirmPush()}
            >
              {pushSubmitting ? t("common.loading") : t("git.push")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
