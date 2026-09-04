import {
  GitOperationTokens,
  type GitOperationToken,
} from "../GitOperationTokens";
import { resolveGitPullExplanation } from "../../utils/gitPullExplanation";
import type { GitHistoryPanelViewScope } from "../GitHistoryPanelTypes";

export function renderGitHistoryPullDialog(scope: GitHistoryPanelViewScope) {
  const {
    ChevronDown,
    Cloud,
    Download,
    FolderTree,
    GitBranch,
    X,
    currentBranch,
    getBranchLeafName,
    getBranchScope,
    handleConfirmPull,
    handleSelectPullRemote,
    handleSelectPullTargetBranch,
    openPullTargetBranchMenu,
    pullNoCommit,
    pullNoVerify,
    pullOptionsMenuOpen,
    pullOptionsMenuRef,
    pullRemote,
    pullRemoteGroups,
    pullRemoteMenuOpen,
    pullRemoteMenuPlacement,
    pullRemotePickerRef,
    pullRemoteTrimmed,
    pullSelectedOptions,
    pullStrategy,
    pullSubmitting,
    pullTargetBranch,
    pullTargetBranchActiveScopeTab,
    pullTargetBranchFieldRef,
    pullTargetBranchGroups,
    pullTargetBranchMenuOpen,
    pullTargetBranchMenuPlacement,
    pullTargetBranchMenuRef,
    pullTargetBranchPickerRef,
    pullTargetBranchTrimmed,
    setPullDialogOpen,
    setPullNoCommit,
    setPullNoVerify,
    setPullOptionsMenuOpen,
    setPullRemoteMenuOpen,
    setPullStrategy,
    setPullTargetBranch,
    setPullTargetBranchActiveScopeTab,
    setPullTargetBranchMenuOpen,
    setPullTargetBranchQuery,
    t,
    updatePullRemoteMenuPlacement,
    visiblePullTargetBranchGroups,
  } = scope;
  const pullTargetSummary =
    pullTargetBranch.trim() || (currentBranch ?? "HEAD");
  const pullExampleCommandTokens: GitOperationToken[] = [
    { kind: "command", value: "git pull" },
    { kind: "remote", value: pullRemote.trim() || "origin" },
    { kind: "branch", value: pullTargetSummary },
    ...pullSelectedOptions.map<GitOperationToken>((option) => ({
      kind: "option",
      value: option.label,
    })),
  ];
  const pullExplanation = resolveGitPullExplanation({
    strategy: pullStrategy,
    noCommit: pullNoCommit,
    noVerify: pullNoVerify,
  });
  const pullExplanationParams = {
    remote: pullRemote.trim() || "origin",
    targetBranch: pullTargetSummary,
  };
  return (
    <div
      className="git-history-create-branch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pullSubmitting) {
          setPullDialogOpen(false);
        }
      }}
    >
      <div
        className="git-history-toolbar-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("git.historyPullDialogTitle")}
      >
        <div className="git-history-create-branch-title git-history-push-title">
          <Download size={14} />
          <span>{t("git.historyPullDialogTitle")}</span>
        </div>
        <div className="git-history-toolbar-confirm-hero">
          <div className="git-history-toolbar-confirm-hero-line">
            <span>{pullRemote || "origin"}</span>
            <span aria-hidden>{"->"}</span>
            <span>{pullTargetBranch.trim() || currentBranch || "main"}</span>
          </div>
          <GitOperationTokens
            as="code"
            className="git-history-pull-command"
            tokens={pullExampleCommandTokens}
          />
        </div>
        <div className="git-history-toolbar-confirm-grid">
          <label className="git-history-create-branch-field">
            <span>{t("git.historyPullDialogRemoteLabel")}</span>
            <div
              className={`git-history-push-picker${pullRemoteMenuOpen ? " is-open" : ""}`}
              ref={pullRemotePickerRef}
            >
              <button
                type="button"
                className="git-history-push-picker-trigger"
                aria-label={t("git.historyPullDialogRemoteLabel")}
                aria-haspopup="listbox"
                aria-expanded={pullRemoteMenuOpen}
                disabled={pullSubmitting}
                onClick={() => {
                  if (pullSubmitting) {
                    return;
                  }
                  setPullTargetBranchMenuOpen(false);
                  setPullRemoteMenuOpen((previous) => {
                    const nextOpen = !previous;
                    if (nextOpen) {
                      updatePullRemoteMenuPlacement();
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
                  {pullRemoteTrimmed || "origin"}
                </span>
                <ChevronDown
                  size={13}
                  className="git-history-push-picker-caret"
                />
              </button>
              {pullRemoteMenuOpen ? (
                <div
                  className={`git-history-push-picker-menu popover-surface${
                    pullRemoteMenuPlacement === "up" ? " is-upward" : ""
                  }`}
                  role="listbox"
                  aria-label={t("git.historyPullDialogRemoteLabel")}
                >
                  {pullRemoteGroups.map((group) => (
                    <div
                      key={group.scope}
                      className="git-history-push-picker-group"
                    >
                      <div className="git-history-push-picker-group-label">
                        <FolderTree size={11} />
                        <span>{group.label}</span>
                        <i>{group.items.length}</i>
                      </div>
                      {group.items.map((remoteName) => (
                        <button
                          key={remoteName}
                          type="button"
                          className={`git-history-push-picker-item${remoteName === pullRemoteTrimmed ? " is-active" : ""}`}
                          role="option"
                          aria-selected={remoteName === pullRemoteTrimmed}
                          onClick={() => handleSelectPullRemote(remoteName)}
                        >
                          <Cloud
                            size={12}
                            className="git-history-push-picker-item-icon"
                          />
                          <span className="git-history-push-picker-item-content">
                            <span className="git-history-push-picker-item-title">
                              {remoteName}
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </label>
          <label
            className="git-history-create-branch-field git-history-push-target-field"
            ref={pullTargetBranchFieldRef}
          >
            <span>{t("git.historyPullDialogTargetBranchLabel")}</span>
            <div
              className={`git-history-push-combobox${pullTargetBranchMenuOpen ? " is-open" : ""}`}
              ref={pullTargetBranchPickerRef}
            >
              <input
                value={pullTargetBranch}
                disabled={pullSubmitting}
                onChange={(event) => {
                  setPullTargetBranch(event.target.value);
                  setPullTargetBranchQuery(event.target.value);
                  if (!pullTargetBranchMenuOpen) {
                    openPullTargetBranchMenu(false);
                  }
                }}
                onFocus={() => openPullTargetBranchMenu(false)}
                aria-label={t("git.historyPullDialogTargetBranchLabel")}
                placeholder={currentBranch ?? "main"}
              />
              <button
                type="button"
                className="git-history-push-combobox-toggle"
                aria-label={`${t("git.historyPullDialogTargetBranchLabel")} toggle`}
                aria-haspopup="listbox"
                aria-expanded={pullTargetBranchMenuOpen}
                disabled={pullSubmitting}
                onClick={() => {
                  if (pullSubmitting) {
                    return;
                  }
                  const nextOpen = !pullTargetBranchMenuOpen;
                  if (nextOpen) {
                    openPullTargetBranchMenu(true);
                    return;
                  }
                  setPullTargetBranchMenuOpen(false);
                }}
              >
                <ChevronDown size={13} />
              </button>
            </div>
            {pullTargetBranchMenuOpen ? (
              <div
                className={`git-history-push-picker-menu git-history-push-target-menu popover-surface${
                  pullTargetBranchMenuPlacement === "up" ? " is-upward" : ""
                }`}
                ref={pullTargetBranchMenuRef}
                role="listbox"
                aria-label={t("git.historyPullDialogTargetBranchLabel")}
              >
                {pullTargetBranchGroups.length > 0 ? (
                  <>
                    {pullTargetBranchGroups.length > 1 ? (
                      <div
                        className="git-history-push-picker-tabs"
                        role="tablist"
                      >
                        {pullTargetBranchGroups.map((group) => {
                          const isActive =
                            group.scope === pullTargetBranchActiveScopeTab;
                          return (
                            <button
                              key={`pull-target-tab-${group.scope}`}
                              type="button"
                              role="tab"
                              aria-selected={isActive}
                              className={`git-history-push-picker-tab${isActive ? " is-active" : ""}`}
                              onClick={() =>
                                setPullTargetBranchActiveScopeTab(group.scope)
                              }
                            >
                              <span>{group.label}</span>
                              <i>{group.items.length}</i>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                    {visiblePullTargetBranchGroups.map((group) => (
                      <div
                        key={group.scope}
                        className="git-history-push-picker-group"
                      >
                        {pullTargetBranchGroups.length <= 1 ? (
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
                            className={`git-history-push-picker-item${branchName === pullTargetBranchTrimmed ? " is-active" : ""}`}
                            role="option"
                            aria-selected={
                              branchName === pullTargetBranchTrimmed
                            }
                            title={branchName}
                            onClick={() =>
                              handleSelectPullTargetBranch(branchName)
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
        <div
          className="git-history-toolbar-confirm-options"
          ref={pullOptionsMenuRef}
        >
          <button
            type="button"
            className="git-history-push-toggle"
            disabled={pullSubmitting}
            onClick={() =>
              setPullOptionsMenuOpen((previous) => {
                const nextOpen = !previous;
                if (nextOpen) {
                  setPullRemoteMenuOpen(false);
                  setPullTargetBranchMenuOpen(false);
                }
                return nextOpen;
              })
            }
          >
            <span className="git-history-push-toggle-indicator" aria-hidden>
              {pullSelectedOptions.length > 0 ? pullSelectedOptions.length : ""}
            </span>
            <span>{t("git.historyPullDialogModifyOptions")}</span>
          </button>
          {pullOptionsMenuOpen ? (
            <div className="git-history-toolbar-confirm-options-menu">
              {(["--rebase", "--ff-only", "--no-ff", "--squash"] as const).map(
                (option) => (
                  <button
                    key={option}
                    type="button"
                    className={`git-history-toolbar-confirm-options-item${pullStrategy === option ? " is-active" : ""}`}
                    onClick={() => {
                      setPullStrategy((previous) =>
                        previous === option ? null : option,
                      );
                    }}
                  >
                    {option}
                  </button>
                ),
              )}
              <button
                type="button"
                className={`git-history-toolbar-confirm-options-item${pullNoCommit ? " is-active" : ""}`}
                onClick={() => setPullNoCommit((previous) => !previous)}
              >
                --no-commit
              </button>
              <button
                type="button"
                className={`git-history-toolbar-confirm-options-item${pullNoVerify ? " is-active" : ""}`}
                onClick={() => setPullNoVerify((previous) => !previous)}
              >
                --no-verify
              </button>
            </div>
          ) : null}
          {pullSelectedOptions.length > 0 ? (
            <div className="git-history-toolbar-confirm-chip-list">
              {pullSelectedOptions.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="git-history-toolbar-confirm-chip"
                  disabled={pullSubmitting}
                  onClick={entry.onRemove}
                >
                  <span>{entry.label}</span>
                  <X size={11} />
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <dl className="git-history-toolbar-confirm-facts">
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyIntentTitle")}</dt>
            <dd>{t(pullExplanation.intentKey, pullExplanationParams)}</dd>
          </div>
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyWillHappenTitle")}</dt>
            <dd role="status" aria-live="polite" aria-atomic="true">
              <ul className="git-history-pull-explanation-list">
                {pullExplanation.effectRows.map((effect) => (
                  <li
                    key={`${effect.option}-${effect.descriptionKey}`}
                    className={`is-${effect.tone}`}
                  >
                    {effect.option === "default" ? (
                      <strong>
                        {t("git.historyPullExplanationDefaultLabel")}
                      </strong>
                    ) : (
                      <code>{effect.option}</code>
                    )}
                    <span>{t(effect.descriptionKey)}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyWillNotHappenTitle")}</dt>
            <dd>{t(pullExplanation.willNotHappenKey)}</dd>
          </div>
        </dl>
        <div className="git-history-toolbar-confirm-command">
          <span>{t("git.historyExampleTitle")}</span>
          <GitOperationTokens
            as="code"
            className="git-history-pull-command"
            tokens={pullExampleCommandTokens}
          />
        </div>
        <div className="git-history-create-branch-actions">
          <button
            type="button"
            className="git-history-create-branch-btn is-cancel"
            disabled={pullSubmitting}
            onClick={() => setPullDialogOpen(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="git-history-create-branch-btn"
            disabled={pullSubmitting}
            onClick={() => {
              void handleConfirmPull();
            }}
          >
            {pullSubmitting ? t("common.loading") : t("git.pull")}
          </button>
        </div>
      </div>
    </div>
  );
}
