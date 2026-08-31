import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import Search from "lucide-react/dist/esm/icons/search";
import type { AppSettings } from "@/types";
import {
  buildShortcutValue,
  formatShortcutForPlatform,
  getDefaultInterruptShortcut,
  splitShortcutForPlatform,
} from "@/utils/shortcuts";
import type {
  ShortcutActionMetadata,
  ShortcutDrafts,
  ShortcutSettingKey,
} from "../settingsViewShortcuts";
import {
  buildShortcutDrafts,
  shortcutActions,
  shortcutCategoryDefinitions,
  shortcutDraftKeyBySetting,
} from "../settingsViewShortcuts";

function resolveDefaultShortcut(action: ShortcutActionMetadata): string | null {
  if (action.setting === "interruptShortcut") {
    return getDefaultInterruptShortcut();
  }
  return action.defaultShortcut;
}

function resolveActionLabel(
  action: ShortcutActionMetadata,
  groupId: string,
  t: (key: string) => string,
): string {
  return t(
    groupId === "common"
      ? (action.featuredLabelKey ?? action.labelKey)
      : action.labelKey,
  );
}

function ShortcutKeys({
  value,
  notSetLabel,
  large,
}: {
  value: string | null;
  notSetLabel: string;
  large?: boolean;
}) {
  if (!value) {
    return (
      <span
        className={`settings-shortcuts-kbd-empty${large ? " settings-shortcuts-kbd-empty--large" : ""}`}
      >
        {notSetLabel}
      </span>
    );
  }
  const keys = splitShortcutForPlatform(value);
  if (!keys) {
    return (
      <span className="settings-shortcuts-kbd-raw">
        {formatShortcutForPlatform(value)}
      </span>
    );
  }
  return (
    <span
      className={`settings-shortcuts-kbd-group${large ? " settings-shortcuts-kbd-group--large" : ""}`}
    >
      {keys.map((key, index) => (
        <kbd className="settings-shortcuts-kbd" key={`${key}-${index}`}>
          {key}
        </kbd>
      ))}
    </span>
  );
}

type ShortcutsSectionProps = {
  active: boolean;
  t: (key: string) => string;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
};

export function ShortcutsSection({
  active,
  t,
  appSettings,
  onUpdateAppSettings,
}: ShortcutsSectionProps) {
  const [shortcutDrafts, setShortcutDrafts] = useState<ShortcutDrafts>(() =>
    buildShortcutDrafts(appSettings),
  );
  const [query, setQuery] = useState("");
  const [selectedSetting, setSelectedSetting] =
    useState<ShortcutSettingKey | null>(null);
  /** Narrow layout: list-only vs detail-only master–detail (ignored above 900px). */
  const [mobilePane, setMobilePane] = useState<"list" | "detail">("list");
  const [recording, setRecording] = useState(false);
  const [resettingAll, setResettingAll] = useState(false);

  // Switching the selected action always exits recording mode.
  useEffect(() => {
    setRecording(false);
  }, [selectedSetting]);

  const shortcutGroups = useMemo(
    () =>
      shortcutCategoryDefinitions
        .map((category) => ({
          id: category.id,
          title: t(category.titleKey),
          items: shortcutActions
            .filter((action) =>
              category.id === "common"
                ? action.featured
                : action.category === category.id,
            )
            .sort((left, right) =>
              category.id === "common"
                ? (left.featuredOrder ?? 0) - (right.featuredOrder ?? 0)
                : 0,
            ),
        }))
        .filter((group) => group.items.length > 0),
    [t],
  );

  useEffect(() => {
    setShortcutDrafts(buildShortcutDrafts(appSettings));
  }, [appSettings]);

  const updateShortcut = async (
    key: ShortcutSettingKey,
    value: string | null,
  ) => {
    const draftKey = shortcutDraftKeyBySetting[key];
    setShortcutDrafts((prev) => ({
      ...prev,
      [draftKey]: value ?? "",
    }));
    await onUpdateAppSettings({
      ...appSettings,
      [key]: value,
    });
  };

  const handleShortcutKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    key: ShortcutSettingKey,
  ) => {
    if (event.key === "Tab" && key !== "composerCollaborationShortcut") {
      return;
    }
    if (event.key === "Tab" && !event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (event.key === "Backspace" || event.key === "Delete") {
      void updateShortcut(key, null);
      return;
    }
    const value = buildShortcutValue(event.nativeEvent);
    if (!value) {
      return;
    }
    // Blur after a successful capture so the recorder exits recording mode
    // and the recorded value shows immediately.
    const target = event.currentTarget;
    void updateShortcut(key, value);
    target.blur();
  };

  if (!active) {
    return null;
  }

  const normalizedQuery = query.trim().toLowerCase();
  const visibleGroups = shortcutGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((action) => {
        if (!normalizedQuery) {
          return true;
        }
        return (
          resolveActionLabel(action, group.id, t)
            .toLowerCase()
            .includes(normalizedQuery) ||
          t(action.labelKey).toLowerCase().includes(normalizedQuery)
        );
      }),
    }))
    .filter((group) => group.items.length > 0);

  const visibleActions = visibleGroups.flatMap((group) => group.items);
  const selectedAction =
    visibleActions.find((action) => action.setting === selectedSetting) ??
    visibleActions[0] ??
    null;

  const handleResetAll = async () => {
    if (resettingAll) {
      return;
    }
    setResettingAll(true);
    try {
      for (const action of shortcutActions) {
        const defaultShortcut = resolveDefaultShortcut(action) ?? "";
        const currentValue = shortcutDrafts[action.draftKey] ?? "";
        if (currentValue !== defaultShortcut) {
          await updateShortcut(action.setting, defaultShortcut || null);
        }
      }
    } finally {
      setResettingAll(false);
    }
  };

  const renderDetail = () => {
    if (!selectedAction) {
      return (
        <div className="settings-shortcuts-detail-empty">
          {t("settings.noShortcutsFound")}
        </div>
      );
    }
    const defaultShortcut = resolveDefaultShortcut(selectedAction);
    const currentValue = shortcutDrafts[selectedAction.draftKey] ?? "";
    const isDefault = currentValue === (defaultShortcut ?? "");
    const label = t(selectedAction.labelKey);
    return (
      <div className="settings-shortcuts-detail-body">
        <div className="settings-shortcuts-detail-title">{label}</div>
        <div
          key={selectedAction.setting}
          className={`settings-shortcuts-recorder${recording ? " settings-shortcuts-recorder--recording" : ""}`}
          role="button"
          tabIndex={0}
          aria-label={`${label} ${t("settings.typeShortcut")}`}
          onFocus={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              // Cancel recording without closing the whole settings view
              // (the window-level close handler skips defaultPrevented events).
              event.preventDefault();
              event.currentTarget.blur();
              return;
            }
            handleShortcutKeyDown(event, selectedAction.setting);
          }}
        >
          {recording ? (
            <span className="settings-shortcuts-recorder-prompt">
              {t("settings.pressShortcutPrompt")}
            </span>
          ) : (
            <ShortcutKeys
              value={currentValue || null}
              notSetLabel={t("settings.notSet")}
              large
            />
          )}
        </div>
        {recording || !isDefault ? (
          <button
            type="button"
            className="settings-shortcuts-detail-reset"
            disabled={isDefault}
            onClick={() =>
              void updateShortcut(selectedAction.setting, defaultShortcut)
            }
          >
            <RotateCcw size={13} strokeWidth={2.2} aria-hidden="true" />
            <span>{t("settings.resetToShortcut")}</span>
            <ShortcutKeys
              value={defaultShortcut}
              notSetLabel={t("settings.notSet")}
            />
          </button>
        ) : (
          <div className="settings-shortcuts-detail-hint">
            {t("settings.clickToRecordShortcut")}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="settings-section settings-section-tabbed settings-shortcuts-section">
      <div
        className="settings-shortcuts-layout"
        data-mobile-pane={mobilePane}
      >
        <div className="settings-shortcuts-list">
          <div className="settings-shortcuts-search">
            <Search size={14} strokeWidth={2.1} aria-hidden="true" />
            <input
              className="settings-input settings-shortcuts-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings.searchShortcuts")}
              aria-label={t("settings.searchShortcuts")}
            />
          </div>
          <div className="settings-shortcuts-groups">
            {visibleGroups.map((group) => (
              <div className="settings-shortcuts-group" key={group.id}>
                <div className="settings-shortcuts-group-title">
                  {group.title}
                </div>
                {group.items.map((item) => {
                  const isSelected = selectedAction?.setting === item.setting;
                  return (
                    <button
                      type="button"
                      className={`settings-shortcuts-row${isSelected ? " settings-shortcuts-row--selected" : ""}`}
                      key={`${group.id}-${item.setting}`}
                      onClick={() => {
                        setSelectedSetting(item.setting);
                        setMobilePane("detail");
                      }}
                    >
                      <span className="settings-shortcuts-row-label">
                        {resolveActionLabel(item, group.id, t)}
                      </span>
                      <ShortcutKeys
                        value={shortcutDrafts[item.draftKey] || null}
                        notSetLabel={t("settings.notSet")}
                      />
                    </button>
                  );
                })}
              </div>
            ))}
            {visibleGroups.length === 0 && (
              <div className="settings-shortcuts-empty">
                {t("settings.noShortcutsFound")}
              </div>
            )}
          </div>
          <button
            type="button"
            className="settings-shortcuts-reset-all"
            disabled={resettingAll}
            onClick={() => void handleResetAll()}
          >
            <RotateCcw size={12} strokeWidth={2.2} aria-hidden="true" />
            <span>{t("settings.resetAllShortcuts")}</span>
          </button>
        </div>
        <div className="settings-shortcuts-detail">
          <button
            type="button"
            className="settings-shortcuts-mobile-back"
            onClick={() => setMobilePane("list")}
          >
            <ArrowLeft size={14} strokeWidth={2.2} aria-hidden="true" />
            <span>
              {t("settings.backToShortcutList")}
            </span>
          </button>
          {renderDetail()}
        </div>
      </div>
    </section>
  );
}
