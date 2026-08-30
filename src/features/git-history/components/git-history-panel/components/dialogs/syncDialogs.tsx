import {
  GitOperationTokens,
  type GitOperationToken,
} from "../GitOperationTokens";
import type { GitHistoryPanelViewScope } from "../GitHistoryPanelImpl";

const SYNC_COMMAND_TOKENS: GitOperationToken[] = [
  { kind: "command", value: "git pull" },
  { kind: "operator", value: "&&" },
  { kind: "command", value: "git push" },
];

const FETCH_COMMAND_TOKENS: GitOperationToken[] = [
  { kind: "command", value: "git fetch" },
  { kind: "option", value: "--all" },
];

export function renderGitHistorySyncDialog(scope: GitHistoryPanelViewScope) {
  const {
    Repeat,
    currentBranch,
    currentLocalBranchEntry,
    handleConfirmSync,
    setSyncDialogOpen,
    syncPreviewCommits,
    syncPreviewError,
    syncPreviewLoading,
    syncPreviewTargetBranch,
    syncPreviewTargetFound,
    syncPreviewTargetRemote,
    syncSubmitting,
    t,
  } = scope;
  const syncAheadCount = currentLocalBranchEntry?.ahead ?? 0;
  const syncBehindCount = currentLocalBranchEntry?.behind ?? 0;
  const syncSourceBranch = currentBranch || t("git.historyHeadRef");
  const syncTargetRemote = syncPreviewTargetRemote || "origin";
  const syncTargetBranch = syncPreviewTargetBranch || (currentBranch ?? "main");
  const syncTargetTokens: GitOperationToken[] = [
    { kind: "branch", value: syncSourceBranch },
    { kind: "operator", value: "->" },
    { kind: "remote", value: syncTargetRemote },
    { kind: "operator", value: ":", separatorBefore: "" },
    { kind: "branch", value: syncTargetBranch, separatorBefore: "" },
  ];
  const syncAheadBehindText = t("git.historySyncDialogAheadBehind", {
    ahead: syncAheadCount,
    behind: syncBehindCount,
  });
  return (
    <div
      className="git-history-create-branch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !syncSubmitting) {
          setSyncDialogOpen(false);
        }
      }}
    >
      <div
        className="git-history-toolbar-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("git.historySyncDialogTitle")}
      >
        <div className="git-history-create-branch-title git-history-push-title">
          <Repeat size={14} />
          <span>{t("git.historySyncDialogTitle")}</span>
        </div>
        <div className="git-history-toolbar-confirm-hero">
          <GitOperationTokens
            as="div"
            className="git-history-toolbar-confirm-hero-line"
            tokens={syncTargetTokens}
          />
          <GitOperationTokens as="code" tokens={SYNC_COMMAND_TOKENS} />
        </div>
        <div className="git-history-toolbar-confirm-preflight">
          <GitOperationTokens as="div" tokens={syncTargetTokens} />
          <div className="git-history-operation-summary">
            {syncAheadBehindText}
          </div>
          {syncPreviewLoading ? <div>{t("common.loading")}</div> : null}
          {syncPreviewError ? (
            <div className="git-history-error">{syncPreviewError}</div>
          ) : null}
          {!syncPreviewLoading && !syncPreviewError ? (
            <div className="git-history-toolbar-confirm-commit-list">
              {syncPreviewCommits.slice(0, 5).map((entry) => (
                <div
                  key={entry.sha}
                  className="git-history-toolbar-confirm-commit-item"
                >
                  <code>{entry.shortSha}</code>
                  <span>{entry.summary || t("git.historyNoMessage")}</span>
                </div>
              ))}
              {!syncPreviewTargetFound ? (
                <div className="git-history-toolbar-confirm-note">
                  {t("git.historySyncDialogNoRemoteTarget")}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <dl className="git-history-toolbar-confirm-facts">
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyIntentTitle")}</dt>
            <dd>{t("git.historySyncDialogIntent")}</dd>
          </div>
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyWillHappenTitle")}</dt>
            <dd>{t("git.historySyncDialogWillHappen")}</dd>
          </div>
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyWillNotHappenTitle")}</dt>
            <dd>{t("git.historySyncDialogWillNotHappen")}</dd>
          </div>
        </dl>
        <div className="git-history-toolbar-confirm-command">
          <span>{t("git.historyExampleTitle")}</span>
          <GitOperationTokens as="code" tokens={SYNC_COMMAND_TOKENS} />
        </div>
        <div className="git-history-create-branch-actions">
          <button
            type="button"
            className="git-history-create-branch-btn is-cancel"
            disabled={syncSubmitting}
            onClick={() => setSyncDialogOpen(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="git-history-create-branch-btn"
            disabled={syncSubmitting}
            onClick={() => {
              void handleConfirmSync();
            }}
          >
            {syncSubmitting ? t("common.loading") : t("git.sync")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function renderGitHistoryFetchDialog(scope: GitHistoryPanelViewScope) {
  const {
    CloudDownload,
    fetchSubmitting,
    handleConfirmFetch,
    setFetchDialogOpen,
    t,
  } = scope;
  return (
    <div
      className="git-history-create-branch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !fetchSubmitting) {
          setFetchDialogOpen(false);
        }
      }}
    >
      <div
        className="git-history-toolbar-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("git.historyFetchDialogTitle")}
      >
        <div className="git-history-create-branch-title git-history-push-title">
          <CloudDownload size={14} />
          <span>{t("git.historyFetchDialogTitle")}</span>
        </div>
        <div className="git-history-toolbar-confirm-hero">
          <div className="git-history-toolbar-confirm-hero-line">
            <span>{t("git.historyFetchDialogHeroSource")}</span>
            <span aria-hidden>{"->"}</span>
            <span>{t("git.historyFetchDialogHeroTarget")}</span>
          </div>
          <code>{t("git.historyFetchDialogHeroHint")}</code>
        </div>
        <dl className="git-history-toolbar-confirm-facts">
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyIntentTitle")}</dt>
            <dd>{t("git.historyFetchDialogIntent")}</dd>
          </div>
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyWillHappenTitle")}</dt>
            <dd>{t("git.historyFetchDialogWillHappen")}</dd>
          </div>
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyWillNotHappenTitle")}</dt>
            <dd>{t("git.historyFetchDialogWillNotHappen")}</dd>
          </div>
        </dl>
        <div className="git-history-toolbar-confirm-command">
          <span>{t("git.historyExampleTitle")}</span>
          <GitOperationTokens as="code" tokens={FETCH_COMMAND_TOKENS} />
        </div>
        <div className="git-history-create-branch-actions">
          <button
            type="button"
            className="git-history-create-branch-btn is-cancel"
            disabled={fetchSubmitting}
            onClick={() => setFetchDialogOpen(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="git-history-create-branch-btn"
            disabled={fetchSubmitting}
            onClick={() => {
              void handleConfirmFetch();
            }}
          >
            {fetchSubmitting ? t("common.loading") : t("git.fetch")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function renderGitHistoryRefreshDialog(scope: GitHistoryPanelViewScope) {
  const {
    RefreshCw,
    handleConfirmRefresh,
    refreshSubmitting,
    setRefreshDialogOpen,
    t,
  } = scope;
  return (
    <div
      className="git-history-create-branch-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !refreshSubmitting) {
          setRefreshDialogOpen(false);
        }
      }}
    >
      <div
        className="git-history-toolbar-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("git.historyRefreshDialogTitle")}
      >
        <div className="git-history-create-branch-title git-history-push-title">
          <RefreshCw size={14} />
          <span>{t("git.historyRefreshDialogTitle")}</span>
        </div>
        <div className="git-history-toolbar-confirm-hero">
          <div className="git-history-toolbar-confirm-hero-line">
            <span>{t("git.historyRefreshDialogHeroSource")}</span>
            <span aria-hidden>{"->"}</span>
            <span>{t("git.historyRefreshDialogHeroTarget")}</span>
          </div>
          <code>refreshAll()</code>
        </div>
        <dl className="git-history-toolbar-confirm-facts">
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyIntentTitle")}</dt>
            <dd>{t("git.historyRefreshDialogIntent")}</dd>
          </div>
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyWillHappenTitle")}</dt>
            <dd>{t("git.historyRefreshDialogWillHappen")}</dd>
          </div>
          <div className="git-history-toolbar-confirm-fact">
            <dt>{t("git.historyWillNotHappenTitle")}</dt>
            <dd>{t("git.historyRefreshDialogWillNotHappen")}</dd>
          </div>
        </dl>
        <div className="git-history-toolbar-confirm-command">
          <span>{t("git.historyExampleTitle")}</span>
          <code>refreshAll()</code>
        </div>
        <div className="git-history-create-branch-actions">
          <button
            type="button"
            className="git-history-create-branch-btn is-cancel"
            disabled={refreshSubmitting}
            onClick={() => setRefreshDialogOpen(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="git-history-create-branch-btn"
            disabled={refreshSubmitting}
            onClick={() => {
              void handleConfirmRefresh();
            }}
          >
            {refreshSubmitting ? t("common.loading") : t("git.refresh")}
          </button>
        </div>
      </div>
    </div>
  );
}
