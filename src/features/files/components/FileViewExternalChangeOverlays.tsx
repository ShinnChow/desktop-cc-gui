import type { TFunction } from "i18next";
import type { useFileExternalSync } from "../hooks/useFileExternalSync";

type FileExternalSync = ReturnType<typeof useFileExternalSync>;

export interface FileViewExternalChangeOverlaysProps {
  editorDraftContentRef: { current: string };
  externalChangeConflict: FileExternalSync["externalChangeConflict"];
  externalChangeSyncState: FileExternalSync["externalChangeSyncState"];
  externalCompareOpen: FileExternalSync["externalCompareOpen"];
  externalPendingRefresh: FileExternalSync["externalPendingRefresh"];
  handleExternalApplyPendingRefresh: FileExternalSync["handleExternalApplyPendingRefresh"];
  handleExternalKeepLocal: FileExternalSync["handleExternalKeepLocal"];
  handleExternalReloadFromDisk: FileExternalSync["handleExternalReloadFromDisk"];
  handleExternalToggleCompare: FileExternalSync["handleExternalToggleCompare"];
  t: TFunction;
}

export function FileViewExternalChangeOverlays({
  editorDraftContentRef,
  externalChangeConflict,
  externalChangeSyncState,
  externalCompareOpen,
  externalPendingRefresh,
  handleExternalApplyPendingRefresh,
  handleExternalKeepLocal,
  handleExternalReloadFromDisk,
  handleExternalToggleCompare,
  t,
}: FileViewExternalChangeOverlaysProps) {
  const renderExternalChangeNotice = () => {
    if (externalChangeSyncState === "in-sync") {
      return null;
    }
    if (externalPendingRefresh) {
      return (
        <div
          className="fvp-external-change-banner is-pending"
          role="status"
          aria-live="polite"
        >
          <div className="fvp-external-change-banner-copy">
            <strong>{t("files.externalChangePendingTitle")}</strong>
            <span>
              {t("files.externalChangePendingBody", {
                count: externalPendingRefresh.updateCount,
              })}
            </span>
          </div>
          <div className="fvp-external-change-banner-actions">
            <button
              type="button"
              className="ghost fvp-action-btn"
              onClick={handleExternalToggleCompare}
            >
              {externalCompareOpen
                ? t("files.externalChangeHideCompare")
                : t("files.externalChangeCompare")}
            </button>
            <button
              type="button"
              className="ghost fvp-action-btn"
              onClick={handleExternalKeepLocal}
            >
              {t("files.externalChangeKeepCurrent")}
            </button>
            <button
              type="button"
              className="primary fvp-action-btn"
              onClick={handleExternalApplyPendingRefresh}
            >
              {t("files.externalChangeRefreshPreview")}
            </button>
          </div>
        </div>
      );
    }
    if (
      externalChangeSyncState !== "external-changed-dirty" ||
      !externalChangeConflict
    ) {
      return (
        <div
          className="fvp-external-change-banner is-auto-sync"
          role="status"
          aria-live="polite"
        >
          {t("files.externalChangeAutoSynced")}
        </div>
      );
    }
    return (
      <div
        className="fvp-external-change-banner is-conflict"
        role="status"
        aria-live="polite"
      >
        <div className="fvp-external-change-banner-copy">
          <strong>{t("files.externalChangeConflictTitle")}</strong>
          <span>
            {t("files.externalChangeConflictBody", {
              count: externalChangeConflict.updateCount,
            })}
          </span>
        </div>
        <div className="fvp-external-change-banner-actions">
          <button
            type="button"
            className="ghost fvp-action-btn"
            onClick={handleExternalToggleCompare}
          >
            {externalCompareOpen
              ? t("files.externalChangeHideCompare")
              : t("files.externalChangeCompare")}
          </button>
          <button
            type="button"
            className="ghost fvp-action-btn"
            onClick={handleExternalKeepLocal}
          >
            {t("files.externalChangeKeepLocal")}
          </button>
          <button
            type="button"
            className="primary fvp-action-btn"
            onClick={handleExternalReloadFromDisk}
          >
            {t("files.externalChangeReload")}
          </button>
        </div>
      </div>
    );
  };

  const renderExternalComparePanel = () => {
    const diskSnapshot = externalChangeConflict ?? externalPendingRefresh;
    if (!externalCompareOpen || !diskSnapshot) {
      return null;
    }
    const latestLocalContent = editorDraftContentRef.current;
    const localPreview =
      latestLocalContent.length > 6_000
        ? `${latestLocalContent.slice(0, 6_000)}\n\n...`
        : latestLocalContent;
    const diskPreview =
      diskSnapshot.diskContent.length > 6_000
        ? `${diskSnapshot.diskContent.slice(0, 6_000)}\n\n...`
        : diskSnapshot.diskContent;
    return (
      <div className="fvp-external-compare">
        <div className="fvp-external-compare-column">
          <header>{t("files.externalChangeCompareLocal")}</header>
          <pre>{localPreview}</pre>
        </div>
        <div className="fvp-external-compare-column">
          <header>{t("files.externalChangeCompareDisk")}</header>
          <pre>{diskPreview}</pre>
        </div>
      </div>
    );
  };

  return (
    <>
      {renderExternalChangeNotice()}
      {renderExternalComparePanel()}
    </>
  );
}
