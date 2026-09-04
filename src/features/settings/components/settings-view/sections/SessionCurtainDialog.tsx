import type { TFunction } from "i18next";
import RotateCw from "lucide-react/dist/esm/icons/rotate-cw";
import X from "lucide-react/dist/esm/icons/x";
import { EngineIcon } from "../../../../engine/components/EngineIcon";
import {
  isSharedCatalogEntry,
  resolveCatalogEntryEngineIcon,
  resolveWorkspaceSessionDisplayTitle,
} from "./sessionManagementSectionUtils";
import {
  getConversationItemLabel,
  getConversationItemText,
  type SessionCurtainState,
} from "./useSessionCurtain";

type SessionCurtainDialogProps = {
  sessionCurtain: SessionCurtainState;
  workspaceLabelById: Map<string, string>;
  onClose: () => void;
  onReload: () => Promise<void>;
  t: TFunction;
};

export function SessionCurtainDialog({
  sessionCurtain,
  workspaceLabelById,
  onClose,
  onReload,
  t,
}: SessionCurtainDialogProps) {
  return (
    <div
      className="settings-session-curtain-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <section
        className="settings-session-curtain-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.sessionManagementCurtainTitle")}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-session-curtain-header">
          <div className="settings-session-curtain-title-wrap">
            <span className="settings-session-curtain-engine" aria-hidden>
              <EngineIcon
                engine={resolveCatalogEntryEngineIcon(sessionCurtain.entry)}
                size={16}
              />
            </span>
            <div>
              <div className="settings-session-curtain-title">
                {resolveWorkspaceSessionDisplayTitle(
                  sessionCurtain.entry,
                  t("settings.projectSessionItemUntitled"),
                )}
                {isSharedCatalogEntry(sessionCurtain.entry) ? (
                  <span className="settings-session-curtain-shared-tag">
                    {t("settings.sessionManagementBadgeShared")}
                    {sessionCurtain.entry.sourceLabel
                      ? ` · ${sessionCurtain.entry.sourceLabel}`
                      : ""}
                  </span>
                ) : null}
              </div>
              <div className="settings-session-curtain-subtitle">
                {sessionCurtain.entry.workspaceLabel ??
                  workspaceLabelById.get(
                    sessionCurtain.entry.workspaceId,
                  ) ??
                  sessionCurtain.entry.workspaceId}
              </div>
            </div>
          </div>
          <div className="settings-session-curtain-actions">
            <button
              type="button"
              className="settings-session-curtain-icon-btn"
              aria-label={t("settings.sessionManagementCurtainReload")}
              title={t("settings.sessionManagementCurtainReload")}
              disabled={
                sessionCurtain.isLoading || sessionCurtain.isSending
              }
              onClick={() => void onReload()}
            >
              <RotateCw size={22} strokeWidth={2.1} aria-hidden />
            </button>
            <button
              type="button"
              className="settings-session-curtain-icon-btn"
              aria-label={t("common.close")}
              title={t("common.close")}
              onClick={onClose}
            >
              <X size={22} strokeWidth={2.1} aria-hidden />
            </button>
          </div>
        </header>
        <div className="settings-session-curtain-messages scrollable">
          {sessionCurtain.isLoading ? (
            <div className="settings-session-curtain-empty">
              {t("settings.sessionManagementCurtainLoading")}
            </div>
          ) : sessionCurtain.items.length === 0 ? (
            <div className="settings-session-curtain-empty">
              {t("settings.sessionManagementCurtainEmpty")}
            </div>
          ) : (
            sessionCurtain.items.map((item) => {
              const itemText = getConversationItemText(item);
              if (!itemText.trim()) {
                return null;
              }
              return (
                <article
                  key={item.id}
                  className={`settings-session-curtain-message is-${item.kind}${
                    item.kind === "message" ? ` is-${item.role}` : ""
                  }`}
                >
                  <div className="settings-session-curtain-message-label">
                    {getConversationItemLabel(item, t)}
                  </div>
                  <div className="settings-session-curtain-message-text">
                    {itemText}
                  </div>
                </article>
              );
            })
          )}
        </div>
        {sessionCurtain.error ? (
          <div className="settings-session-curtain-status is-error">
            {sessionCurtain.error}
          </div>
        ) : sessionCurtain.notice ? (
          <div className="settings-session-curtain-status">
            {sessionCurtain.notice}
          </div>
        ) : null}
      </section>
    </div>
  );
}
