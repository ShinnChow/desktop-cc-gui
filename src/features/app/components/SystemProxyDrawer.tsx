import Save from "lucide-react/dist/esm/icons/save";
import X from "lucide-react/dist/esm/icons/x";
import { Switch } from "@/components/ui/switch";
import {
  useSystemProxySettings,
  type SystemProxySettingsPatch,
} from "@/features/settings/components/settings-view/hooks/useSystemProxySettings";

type SystemProxyDrawerProps = {
  systemProxyEnabled: boolean;
  systemProxyUrl: string | null;
  onUpdateSystemProxy: (patch: SystemProxySettingsPatch) => Promise<unknown>;
  onClose: () => void;
  t: (key: string) => string;
};

export function SystemProxyDrawer({
  systemProxyEnabled,
  systemProxyUrl,
  onUpdateSystemProxy,
  onClose,
  t,
}: SystemProxyDrawerProps) {
  const {
    handleSaveSystemProxy,
    handleSystemProxyUrlChange,
    handleToggleSystemProxy,
    systemProxyDirty,
    systemProxyEnabledDraft,
    systemProxyError,
    systemProxyNotice,
    systemProxySaving,
    systemProxyUrlDraft,
  } = useSystemProxySettings({
    systemProxyEnabled,
    systemProxyUrl,
    onUpdateSystemProxy,
    t,
  });

  return (
    <aside
      className="sidebar-system-proxy-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={t("settings.behaviorProxyTitle")}
    >
      <header className="sidebar-system-proxy-drawer-header">
        <div>
          <h2>{t("settings.behaviorProxyTitle")}</h2>
          <p>{t("settings.behaviorProxyDesc")}</p>
        </div>
        <button
          type="button"
          className="sidebar-system-proxy-drawer-close"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X size={18} aria-hidden />
        </button>
      </header>

      <div className="sidebar-system-proxy-drawer-content">
        <div className="sidebar-system-proxy-drawer-row">
          <label htmlFor="sidebar-system-proxy-enabled">
            {t("settings.behaviorProxyEnabled")}
          </label>
          <Switch
            id="sidebar-system-proxy-enabled"
            checked={systemProxyEnabledDraft}
            onCheckedChange={handleToggleSystemProxy}
            disabled={systemProxySaving}
            aria-label={t("settings.behaviorProxyEnabled")}
          />
        </div>

        <label
          className="sidebar-system-proxy-drawer-field"
          htmlFor="sidebar-system-proxy-url"
        >
          <span>{t("settings.behaviorProxyAddress")}</span>
          <input
            id="sidebar-system-proxy-url"
            value={systemProxyUrlDraft}
            onChange={(event) => handleSystemProxyUrlChange(event.target.value)}
            placeholder={t("settings.behaviorProxyAddressPlaceholder")}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </label>

        <button
          type="button"
          className="ghost sidebar-system-proxy-drawer-save"
          onClick={() => void handleSaveSystemProxy()}
          disabled={systemProxySaving || !systemProxyDirty}
        >
          <Save size={15} aria-hidden />
          {t("settings.behaviorProxySave")}
        </button>

        <p className="sidebar-system-proxy-drawer-hint">
          {t("settings.behaviorProxyHint")}
        </p>
        {systemProxyNotice ? (
          <p
            className={
              systemProxyNotice.kind === "error"
                ? "settings-inline-error"
                : "settings-inline-success"
            }
            role={systemProxyNotice.kind === "error" ? "alert" : "status"}
          >
            {systemProxyNotice.message}
          </p>
        ) : null}
        {systemProxyError ? (
          <p className="sidebar-system-proxy-drawer-error" role="alert">
            {systemProxyError}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
