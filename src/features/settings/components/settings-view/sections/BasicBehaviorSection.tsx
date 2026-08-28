import type { TFunction } from "i18next";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import Download from "lucide-react/dist/esm/icons/download";
import Save from "lucide-react/dist/esm/icons/save";
import { Switch } from "@/components/ui/switch";
import type { AppSettings } from "@/types";
import {
  useGitCommitComposerPlacement,
  writeGitCommitComposerPlacement,
  type GitCommitComposerPlacement,
} from "@/features/git/hooks/useGitCommitComposerPlacement";
import { requestFirstRunSetupReopen } from "@/features/onboarding/utils/setupEvents";
import { EditorHabitPreference } from "./EditorHabitPreference";

type DiagnosticsBundleExportState = {
  status: "idle" | "exporting" | "exported" | "failed";
  message: string | null;
};

type NotificationSoundOption = {
  value: string;
  label: string;
};

type BasicBehaviorSectionProps = {
  active: boolean;
  t: TFunction;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  handleComposerSendShortcutChange: (
    shortcut: AppSettings["composerSendShortcut"],
  ) => void;
  handleExportDiagnosticsBundle: () => Promise<void>;
  diagnosticsBundleExportState: DiagnosticsBundleExportState;
  terminalShellPathDraft: string;
  setTerminalShellPathDraft: (value: string) => void;
  terminalShellPathDirty: boolean;
  handleSaveTerminalShellPath: () => Promise<void>;
  handleClearTerminalShellPath: () => Promise<void>;
  selectedNotificationSound: string;
  soundOptions: ReadonlyArray<NotificationSoundOption>;
  handleNotificationSoundOptionChange: (nextSound: string | null) => void;
  onTestNotificationSound: (soundId?: string, customSoundPath?: string) => void;
  notificationSoundPathDraft: string;
  setNotificationSoundPathDraft: (value: string) => void;
  handleBrowseNotificationSoundPath: () => Promise<void>;
  handleSaveNotificationSoundPath: () => void;
  onCloseSettings?: () => void;
};

export function BasicBehaviorSection({
  active,
  t,
  appSettings,
  onUpdateAppSettings,
  handleComposerSendShortcutChange,
  handleExportDiagnosticsBundle,
  diagnosticsBundleExportState,
  terminalShellPathDraft,
  setTerminalShellPathDraft,
  terminalShellPathDirty,
  handleSaveTerminalShellPath,
  handleClearTerminalShellPath,
  selectedNotificationSound,
  soundOptions,
  handleNotificationSoundOptionChange,
  onTestNotificationSound,
  notificationSoundPathDraft,
  setNotificationSoundPathDraft,
  handleBrowseNotificationSoundPath,
  handleSaveNotificationSoundPath,
  onCloseSettings,
}: BasicBehaviorSectionProps) {
  const gitCommitComposerPlacement = useGitCommitComposerPlacement();

  if (!active) {
    return null;
  }

  return (
    <div className="settings-basic-behavior settings-basic-surface">
      {/* 对话与布局 */}
      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card">
        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.rerunOnboardingTitle")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.rerunOnboardingDesc")}
            </div>
          </div>
          <div className="settings-pref-control">
            <button
              type="button"
              className="ghost settings-button-compact settings-pref-action-btn"
              onClick={() => {
                onCloseSettings?.();
                requestFirstRunSetupReopen();
              }}
            >
              {t("settings.rerunOnboardingAction")}
            </button>
          </div>
        </div>

        <EditorHabitPreference />

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.sendShortcutSubtitle")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.sendShortcutSubDescription")}
            </div>
          </div>
          <div
            className="settings-pref-control settings-pref-segmented settings-pref-segmented--pair settings-pref-segmented--wide"
            role="radiogroup"
            aria-label={t("settings.sendShortcutSubtitle")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.composerSendShortcut === "enter"}
              className={`settings-pref-segment ${
                appSettings.composerSendShortcut === "enter" ? "is-active" : ""
              }`}
              onClick={() => handleComposerSendShortcutChange("enter")}
            >
              <span>{t("settings.sendShortcutEnterTitle")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.composerSendShortcut === "cmdEnter"}
              className={`settings-pref-segment ${
                appSettings.composerSendShortcut === "cmdEnter"
                  ? "is-active"
                  : ""
              }`}
              onClick={() => handleComposerSendShortcutChange("cmdEnter")}
            >
              <span>{t("settings.sendShortcutCmdEnterTitle")}</span>
            </button>
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.behaviorStreaming")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.behaviorStreamingDesc")}
            </div>
          </div>
          <div className="settings-pref-control">
            <Switch
              checked={appSettings.streamingEnabled ?? true}
              onCheckedChange={(checked) =>
                void onUpdateAppSettings({
                  ...appSettings,
                  streamingEnabled: checked,
                })
              }
              aria-label={t("settings.behaviorStreaming")}
            />
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.gitCommitComposerPlacementTitle")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.gitCommitComposerPlacementDesc")}
            </div>
          </div>
          <div
            className="settings-pref-control settings-pref-segmented settings-pref-segmented--pair"
            role="radiogroup"
            aria-label={t("settings.gitCommitComposerPlacementTitle")}
          >
            {(["bottom", "top"] satisfies GitCommitComposerPlacement[]).map(
              (placement) => (
                <button
                  key={placement}
                  type="button"
                  role="radio"
                  aria-checked={gitCommitComposerPlacement === placement}
                  aria-label={t(
                    `settings.gitCommitComposerPlacement.${placement}`,
                  )}
                  className={`settings-pref-segment ${
                    gitCommitComposerPlacement === placement ? "is-active" : ""
                  }`}
                  onClick={() => writeGitCommitComposerPlacement(placement)}
                >
                  <span>
                    {t(`settings.gitCommitComposerPlacement.${placement}`)}
                  </span>
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      {/* Browser Agent */}
      <div
        className={`settings-basic-group-card settings-basic-group-card--list settings-pref-card${
          appSettings.browserAgentEnabled ? " is-enabled" : ""
        }`}
      >
        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.browserAgentTitle")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.browserAgentDesc")}
            </div>
          </div>
          <div className="settings-pref-control">
            <Switch
              checked={appSettings.browserAgentEnabled}
              onCheckedChange={(checked) =>
                void onUpdateAppSettings({
                  ...appSettings,
                  browserAgentEnabled: checked,
                })
              }
              aria-label={t("settings.browserAgentEnabled")}
            />
          </div>
        </div>
        <div className="settings-pref-row settings-pref-row--hint">
          <div className="settings-pref-hint">
            <span className="settings-pref-hint-badge">
              {appSettings.browserAgentEnabled
                ? t("settings.browserAgentStatusEnabled")
                : t("settings.browserAgentStatusDisabled")}
            </span>
            <span className="settings-pref-hint-copy">
              {t("settings.browserAgentHint")}
            </span>
          </div>
        </div>
        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.browserAgentPreferBuiltIn")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.browserAgentPreferBuiltInDesc")}
            </div>
          </div>
          <div className="settings-pref-control">
            <Switch
              checked={appSettings.browserAgentPreferBuiltIn}
              onCheckedChange={(checked) =>
                void onUpdateAppSettings({
                  ...appSettings,
                  browserAgentPreferBuiltIn: checked,
                })
              }
              disabled={!appSettings.browserAgentEnabled}
              aria-label={t("settings.browserAgentPreferBuiltIn")}
            />
          </div>
        </div>
        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.browserAgentFallback")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.browserAgentFallbackDesc")}
            </div>
          </div>
          <div className="settings-pref-control">
            <Switch
              checked={appSettings.browserAgentAllowExternalProviderFallback}
              onCheckedChange={(checked) =>
                void onUpdateAppSettings({
                  ...appSettings,
                  browserAgentAllowExternalProviderFallback: checked,
                })
              }
              aria-label={t("settings.browserAgentFallback")}
            />
          </div>
        </div>
      </div>

      {/* 性能 / 诊断 */}
      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card">
        <div
          className={`settings-pref-row settings-pref-row--stack${
            appSettings.performanceCompatibilityModeEnabled
              ? " is-expanded"
              : ""
          }`}
        >
          <div className="settings-pref-row-main">
            <div className="settings-pref-meta">
              <div className="settings-pref-title">
                {t("settings.performanceCompatibilityTitle")}
              </div>
              <div className="settings-pref-desc">
                {t("settings.performanceCompatibilityDesc")}
              </div>
            </div>
            <div className="settings-pref-control">
              <Switch
                checked={appSettings.performanceCompatibilityModeEnabled}
                onCheckedChange={(checked) =>
                  void onUpdateAppSettings({
                    ...appSettings,
                    performanceCompatibilityModeEnabled: checked,
                  })
                }
                aria-label={t("settings.performanceCompatibilityEnabled")}
              />
            </div>
          </div>
          <div className="settings-pref-hint">
            <span className="settings-pref-hint-badge">
              {appSettings.performanceCompatibilityModeEnabled
                ? t("settings.performanceCompatibilityStatusEnabled")
                : t("settings.performanceCompatibilityStatusDisabled")}
            </span>
            <span className="settings-pref-hint-copy">
              {t("settings.performanceCompatibilityHint")}
            </span>
          </div>
        </div>

        <div className="settings-pref-row settings-pref-row--stack">
          <div className="settings-pref-row-main">
            <div className="settings-pref-meta">
              <div className="settings-pref-title">
                {t("settings.diagnosticsBundleTitle")}
              </div>
              <div className="settings-pref-desc">
                {t("settings.diagnosticsBundleDesc")}
              </div>
            </div>
            <div className="settings-pref-control">
              <button
                type="button"
                className="ghost settings-button-compact settings-pref-action-btn"
                onClick={() => void handleExportDiagnosticsBundle()}
                disabled={diagnosticsBundleExportState.status === "exporting"}
                aria-label={t("settings.diagnosticsBundleExport")}
              >
                <Download size={14} aria-hidden />
                {diagnosticsBundleExportState.status === "exporting"
                  ? t("settings.diagnosticsBundleExporting")
                  : t("settings.diagnosticsBundleExport")}
              </button>
            </div>
          </div>
          <div className="settings-pref-hint">
            <span className="settings-pref-hint-copy">
              {t("settings.diagnosticsBundleHint")}
            </span>
          </div>
          {diagnosticsBundleExportState.message ? (
            <div
              className={
                diagnosticsBundleExportState.status === "failed"
                  ? "settings-inline-error"
                  : "settings-inline-success"
              }
              role={
                diagnosticsBundleExportState.status === "failed"
                  ? "alert"
                  : "status"
              }
            >
              {diagnosticsBundleExportState.message}
            </div>
          ) : null}
        </div>
      </div>

      {/* 终端 */}
      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card settings-basic-terminal-card">
        <div className="settings-pref-row settings-pref-row--stack">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.terminalShellPathTitle")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.terminalShellPathDesc")}
            </div>
          </div>
          <div className="settings-pref-field-row">
            <input
              id="terminal-shell-path"
              className="settings-pref-text-input"
              value={terminalShellPathDraft}
              onChange={(event) =>
                setTerminalShellPathDraft(event.target.value)
              }
              placeholder={t("settings.terminalShellPathPlaceholder")}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label={t("settings.terminalShellPathLabel")}
            />
            <button
              type="button"
              className="ghost settings-button-compact settings-pref-action-btn"
              onClick={() => void handleSaveTerminalShellPath()}
              disabled={!terminalShellPathDirty}
              aria-label={t("settings.terminalShellPathSave")}
            >
              <Save size={14} aria-hidden />
              {t("settings.terminalShellPathSave")}
            </button>
            <button
              type="button"
              className="settings-pref-reset"
              onClick={() => void handleClearTerminalShellPath()}
              disabled={
                !terminalShellPathDraft && appSettings.terminalShellPath == null
              }
              aria-label={t("settings.terminalShellPathClear")}
            >
              {t("settings.clear")}
            </button>
          </div>
          <div className="settings-pref-hint">
            <span className="settings-pref-hint-copy">
              {t("settings.terminalShellPathHint")}
            </span>
          </div>
        </div>
      </div>

      {/* 通知音 */}
      <div
        className={`settings-basic-group-card settings-basic-group-card--list settings-pref-card settings-basic-sounds-card${
          appSettings.notificationSoundsEnabled ? " is-enabled" : ""
        }`}
      >
        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.notificationSounds")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.notificationSoundsDesc")}
            </div>
          </div>
          <div className="settings-pref-control">
            <Switch
              checked={appSettings.notificationSoundsEnabled}
              onCheckedChange={(checked) =>
                void onUpdateAppSettings({
                  ...appSettings,
                  notificationSoundsEnabled: checked,
                })
              }
              aria-label={t("settings.notificationSounds")}
            />
          </div>
        </div>
        <div className="settings-pref-row settings-pref-row--hint">
          <div className="settings-pref-hint">
            <span className="settings-pref-hint-badge">
              {appSettings.notificationSoundsEnabled
                ? t("settings.notificationSoundsEnabled")
                : t("settings.notificationSoundsDisabled")}
            </span>
            <span className="settings-pref-hint-copy">
              {t("settings.notificationSoundsHint")}
            </span>
          </div>
        </div>
        {appSettings.notificationSoundsEnabled ? (
          <>
            <div className="settings-pref-row">
              <div className="settings-pref-meta">
                <label
                  className="settings-pref-title"
                  htmlFor="notification-sound-select-native"
                >
                  {t("settings.soundSelectLabel")}
                </label>
              </div>
              <div className="settings-pref-control settings-pref-font-control">
                <div className="settings-pref-select-wrap settings-pref-select-wrap--grow">
                  <select
                    id="notification-sound-select-native"
                    className="settings-pref-select"
                    value={selectedNotificationSound}
                    onChange={(event) =>
                      handleNotificationSoundOptionChange(event.target.value)
                    }
                    aria-label={t("settings.soundSelectLabel")}
                  >
                    {soundOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="ghost settings-button-compact settings-pref-action-btn"
                  onClick={() =>
                    onTestNotificationSound(
                      selectedNotificationSound,
                      notificationSoundPathDraft,
                    )
                  }
                >
                  {t("settings.test")}
                </button>
              </div>
            </div>
            {selectedNotificationSound === "custom" ? (
              <div className="settings-pref-row settings-pref-row--stack">
                <div className="settings-pref-meta">
                  <label
                    className="settings-pref-title"
                    htmlFor="notification-sound-custom-path"
                  >
                    {t("settings.soundCustomFileLabel")}
                  </label>
                </div>
                <div className="settings-pref-field-row">
                  <input
                    id="notification-sound-custom-path"
                    type="text"
                    className="settings-pref-text-input"
                    value={notificationSoundPathDraft}
                    placeholder={t("settings.soundCustomPlaceholder")}
                    onChange={(event) =>
                      setNotificationSoundPathDraft(event.target.value)
                    }
                  />
                  <button
                    type="button"
                    className="ghost settings-button-compact settings-pref-action-btn"
                    onClick={() => {
                      void handleBrowseNotificationSoundPath();
                    }}
                    aria-label={t("settings.browse")}
                  >
                    <FolderOpen size={14} aria-hidden />
                    {t("settings.browse")}
                  </button>
                  <button
                    type="button"
                    className="ghost settings-button-compact settings-pref-action-btn"
                    onClick={handleSaveNotificationSoundPath}
                  >
                    {t("common.save")}
                  </button>
                </div>
                <div className="settings-pref-hint">
                  <span className="settings-pref-hint-copy">
                    {t("settings.soundCustomHint")}
                  </span>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
