import { useCallback, useEffect, useMemo, useState } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import ChevronUp from "lucide-react/dist/esm/icons/chevron-up";
import FolderOpen from "lucide-react/dist/esm/icons/folder-open";
import Pencil from "lucide-react/dist/esm/icons/pencil";
import Plus from "lucide-react/dist/esm/icons/plus";
import Star from "lucide-react/dist/esm/icons/star";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AppSettings, OpenAppTarget } from "@/types";
import { getOpenAppPresetsForHost } from "../../../../app/constants/openAppPresets";
import { useOpenAppIcons } from "../../../../app/hooks/useOpenAppIcons";
import { useOpenAppTargetHealth } from "../../../../app/hooks/useOpenAppTargetHealth";
import {
  resolveOpenAppHealth,
  type OpenAppHealth,
} from "../../../../app/utils/openAppHealth";
import {
  basenameFromPath,
  fileManagerTypeI18nKey,
  getOpenAppHostPlatform,
} from "../../../../app/utils/openAppPlatform";
import { useKnownOpenAppIcons } from "../../../../app/hooks/useKnownOpenAppIcons";
import { resolveOpenAppDisplayIcon } from "../../../../app/utils/openAppIcons";
import { pickApplicationPath } from "../../../../../services/tauri/filePickers";
import { DEFAULT_OPEN_APP_ID } from "../../../../app/constants";
import { writeClientStoreValue } from "../../../../../services/clientStorage";
import {
  buildOpenAppDrafts,
  createOpenAppId,
  type OpenAppDraft,
} from "../actions/settingsViewActions";

type OpenAppsSectionProps = {
  active: boolean;
  t: (key: string) => string;
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  openAppIconById: Record<string, string>;
};

function kindLabel(
  t: (key: string) => string,
  kind: OpenAppTarget["kind"],
): string {
  if (kind === "app") return t("settings.typeApp");
  if (kind === "command") return t("settings.typeCommand");
  return t(fileManagerTypeI18nKey());
}

function targetSubtitle(
  t: (key: string) => string,
  target: OpenAppDraft,
): string {
  const kind = kindLabel(t, target.kind);
  if (target.kind === "app") {
    const name = target.appName?.trim();
    return name ? `${kind} · ${name}` : kind;
  }
  if (target.kind === "command") {
    const command = target.command?.trim();
    return command ? `${kind} · ${command}` : kind;
  }
  return kind;
}

function healthLabel(t: (key: string) => string, health: OpenAppHealth): string {
  if (health === "ok") return t("settings.openAppHealthOk");
  if (health === "missing") return t("settings.openAppHealthMissing");
  if (health === "broken") return t("settings.openAppHealthBroken");
  return t("settings.openAppHealthUnknown");
}

function healthActionTitle(
  t: (key: string) => string,
  health: OpenAppHealth,
  refreshing: boolean,
): string {
  if (refreshing) {
    return t("settings.openAppHealthRefreshing");
  }
  if (health === "unknown" || health === "missing") {
    return t("settings.openAppHealthClickToVerify");
  }
  return healthLabel(t, health);
}

export function OpenAppsSection({
  active,
  t,
  appSettings,
  onUpdateAppSettings,
  openAppIconById,
}: OpenAppsSectionProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [openAppDrafts, setOpenAppDrafts] = useState<OpenAppDraft[]>(() =>
    buildOpenAppDrafts(appSettings.openAppTargets),
  );
  const [openAppSelectedId, setOpenAppSelectedId] = useState(
    appSettings.selectedOpenAppId,
  );
  // Built-in open-app PNGs load lazily; this re-renders once they are cached
  // so resolveOpenAppDisplayIcon calls below pick up the real logos.
  useKnownOpenAppIcons();
  const hostPlatform = getOpenAppHostPlatform();

  const presets = useMemo(
    () => getOpenAppPresetsForHost(hostPlatform),
    [hostPlatform],
  );

  const presetIconTargets = useMemo<OpenAppTarget[]>(
    () =>
      presets.map((preset) => ({
        id: preset.id,
        label: preset.label,
        kind: preset.kind,
        appName: preset.appName ?? (preset.kind === "app" ? preset.label : null),
        command: preset.command ?? null,
        args: [],
      })),
    [presets],
  );

  const lazyIconById = useOpenAppIcons(openAppDrafts, { enabled: active });
  const presetLazyIconById = useOpenAppIcons(presetIconTargets, {
    enabled: active && addPickerOpen,
  });
  const { probeById, targetHealthById, refreshingIds, refreshTarget } =
    useOpenAppTargetHealth({
      enabled: active,
      targets: openAppDrafts,
    });

  const editingIndex = useMemo(
    () => openAppDrafts.findIndex((item) => item.id === editingId),
    [editingId, openAppDrafts],
  );
  const editingTarget =
    editingIndex >= 0 ? openAppDrafts[editingIndex] : null;

  const editingIconSrc = editingTarget
    ? resolveOpenAppDisplayIcon(editingTarget, {
        ...openAppIconById,
        ...lazyIconById,
      })
    : resolveOpenAppDisplayIcon({
        id: "generic",
        kind: "app",
        label: "",
        appName: "",
        command: null,
      });

  useEffect(() => {
    setOpenAppDrafts(buildOpenAppDrafts(appSettings.openAppTargets));
    setOpenAppSelectedId(appSettings.selectedOpenAppId);
  }, [appSettings.openAppTargets, appSettings.selectedOpenAppId]);

  const normalizeOpenAppTargets = useCallback(
    (drafts: OpenAppDraft[]): OpenAppTarget[] =>
      drafts.map(({ argsText, ...target }) => ({
        ...target,
        label: target.label.trim(),
        appName: (target.appName?.trim() ?? "") || null,
        command: (target.command?.trim() ?? "") || null,
        args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
      })),
    [],
  );

  const handleCommitOpenApps = useCallback(
    async (drafts: OpenAppDraft[], selectedId = openAppSelectedId) => {
      const nextTargets = normalizeOpenAppTargets(drafts);
      const nextSelectedId =
        nextTargets.find((target) => target.id === selectedId)?.id ??
        nextTargets[0]?.id ??
        DEFAULT_OPEN_APP_ID;
      setOpenAppDrafts(buildOpenAppDrafts(nextTargets));
      setOpenAppSelectedId(nextSelectedId);
      await onUpdateAppSettings({
        ...appSettings,
        openAppTargets: nextTargets,
        selectedOpenAppId: nextSelectedId,
      });
    },
    [
      appSettings,
      normalizeOpenAppTargets,
      onUpdateAppSettings,
      openAppSelectedId,
    ],
  );

  const handleOpenAppDraftChange = (
    index: number,
    updates: Partial<OpenAppDraft>,
  ) => {
    setOpenAppDrafts((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) {
        return prev;
      }
      next[index] = { ...current, ...updates };
      return next;
    });
  };

  const handleOpenAppKindChange = (
    index: number,
    kind: OpenAppTarget["kind"],
  ) => {
    setOpenAppDrafts((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) {
        return prev;
      }
      next[index] = {
        ...current,
        kind,
        appName: kind === "app" ? (current.appName ?? "") : null,
        command: kind === "command" ? (current.command ?? "") : null,
        argsText: kind === "finder" ? "" : current.argsText,
      };
      void handleCommitOpenApps(next);
      return next;
    });
  };

  const handleMoveOpenApp = (index: number, direction: "up" | "down") => {
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= openAppDrafts.length) {
      return;
    }
    const next = [...openAppDrafts];
    const [moved] = next.splice(index, 1);
    next.splice(nextIndex, 0, moved);
    setOpenAppDrafts(next);
    void handleCommitOpenApps(next);
  };

  const handleDeleteOpenApp = (index: number) => {
    if (openAppDrafts.length <= 1) {
      return;
    }
    const removed = openAppDrafts[index];
    const next = openAppDrafts.filter((_, draftIndex) => draftIndex !== index);
    const nextSelected =
      removed?.id === openAppSelectedId
        ? (next[0]?.id ?? DEFAULT_OPEN_APP_ID)
        : openAppSelectedId;
    setOpenAppDrafts(next);
    void handleCommitOpenApps(next, nextSelected);
  };

  const handleAddOpenApp = (initial?: Partial<OpenAppDraft>): string => {
    const kind = initial?.kind ?? "app";
    const preferredId = initial?.id?.trim();
    const id =
      preferredId && !openAppDrafts.some((item) => item.id === preferredId)
        ? preferredId
        : createOpenAppId();
    const newTarget: OpenAppDraft = {
      id,
      label: initial?.label?.trim() || t("settings.newApp"),
      kind,
      appName:
        kind === "app"
          ? (initial?.appName ?? "")
          : kind === "finder"
            ? null
            : (initial?.appName ?? null),
      command:
        kind === "command"
          ? (initial?.command ?? "")
          : (initial?.command ?? null),
      args: initial?.args ?? [],
      argsText: initial?.argsText ?? "",
    };
    const next = [...openAppDrafts, newTarget];
    setOpenAppDrafts(next);
    void handleCommitOpenApps(next, newTarget.id);
    return newTarget.id;
  };

  const handleSelectOpenAppDefault = (id: string) => {
    setOpenAppSelectedId(id);
    writeClientStoreValue("app", "openWorkspaceApp", id);
    void handleCommitOpenApps(openAppDrafts, id);
  };

  const closeEditor = () => {
    setEditingId(null);
    void handleCommitOpenApps(openAppDrafts);
  };

  const openAddPicker = () => {
    setAddPickerOpen(true);
  };

  const resolvePresetIcon = (
    preset: (typeof presets)[number],
  ): string => {
    return resolveOpenAppDisplayIcon(
      {
        id: preset.id,
        kind: preset.kind,
        label: preset.label,
        appName: preset.appName ?? (preset.kind === "app" ? preset.label : null),
        command: preset.command ?? null,
      },
      presetLazyIconById,
    );
  };

  const addFromBrowse = async () => {
    try {
      const path = await pickApplicationPath();
      if (!path) {
        return;
      }
      const label = basenameFromPath(path);
      const id = handleAddOpenApp({
        label,
        kind: "app",
        appName: path,
        command: null,
        argsText: "",
      });
      setAddPickerOpen(false);
      if (typeof id === "string") {
        setEditingId(id);
      }
    } catch {
      // dialog cancelled / unavailable
    }
  };

  const addFromPreset = async (presetId: string) => {
    const preset = presets.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    if (preset.kind === "finder") {
      const already = openAppDrafts.some((item) => item.kind === "finder");
      if (already) {
        setAddPickerOpen(false);
        return;
      }
      handleAddOpenApp({
        label: t(fileManagerTypeI18nKey()),
        kind: "finder",
        appName: null,
        command: null,
        argsText: "",
      });
      setAddPickerOpen(false);
      return;
    }

    const probe = probeById[preset.id];
    if (probe && !probe.installed) {
      // Missing → browse to locate
      await addFromBrowse();
      return;
    }

    if (preset.kind === "command") {
      const id = handleAddOpenApp({
        label: preset.label,
        kind: "command",
        appName: null,
        command: probe?.resolvedPath || preset.command || "",
        argsText: "",
      });
      setAddPickerOpen(false);
      if (typeof id === "string") {
        setEditingId(id);
      }
      return;
    }

    handleAddOpenApp({
      label: preset.label,
      kind: "app",
      appName: probe?.resolvedPath || preset.appName || preset.label,
      command: null,
      argsText: "",
      // stable id when known preset so icons/health match
      id: openAppDrafts.some((d) => d.id === preset.id)
        ? undefined
        : preset.id,
    });
    setAddPickerOpen(false);
  };

  const addCustomCommand = () => {
    const id = handleAddOpenApp({
      label: t("settings.typeCommand"),
      kind: "command",
      appName: null,
      command: "",
      argsText: "",
    });
    setAddPickerOpen(false);
    if (typeof id === "string") {
      setEditingId(id);
    }
  };

  const browseForEditingApp = async () => {
    if (editingIndex < 0) {
      return;
    }
    try {
      const path = await pickApplicationPath();
      if (!path) {
        return;
      }
      const label =
        openAppDrafts[editingIndex]?.label?.trim() || basenameFromPath(path);
      handleOpenAppDraftChange(editingIndex, {
        appName: path,
        label:
          openAppDrafts[editingIndex]?.label?.trim() &&
          openAppDrafts[editingIndex]?.label !== t("settings.newApp")
            ? openAppDrafts[editingIndex]!.label
            : label,
      });
    } catch {
      // ignore
    }
  };

  // Keep health/icons warm only while active (hooks already gated).
  useEffect(() => {
    if (!active) {
      setAddPickerOpen(false);
    }
  }, [active]);

  if (!active) {
    return null;
  }

  return (
    <div className="settings-basic-open-apps settings-basic-surface">
      <div className="settings-basic-group-card settings-pref-card settings-open-apps-card">
        <div className="settings-pref-card-head">
          <div className="settings-pref-title">{t("settings.openInTitle")}</div>
          <div className="settings-pref-desc">
            {t("settings.openInDescription")}
          </div>
        </div>

        <div className="settings-open-apps-list" role="list">
          {openAppDrafts.map((target, index) => {
            const iconSrc = resolveOpenAppDisplayIcon(target, {
              ...openAppIconById,
              ...lazyIconById,
            });
            const isDefault = target.id === openAppSelectedId;
            const displayName =
              target.kind === "finder"
                ? t(fileManagerTypeI18nKey())
                : target.label.trim() || t("settings.label") || "App";
            const health = resolveOpenAppHealth(
              target,
              probeById,
              targetHealthById,
            );
            const isRefreshing = Boolean(refreshingIds[target.id]);
            const canRefresh =
              health === "unknown" || health === "missing" || isRefreshing;

            return (
              <div
                key={target.id}
                className={`settings-open-app-item${isDefault ? " is-default" : ""}`}
                role="listitem"
              >
                <div className="settings-open-app-summary">
                  <button
                    type="button"
                    className="settings-open-app-summary-main"
                    onClick={() => setEditingId(target.id)}
                    aria-haspopup="dialog"
                    aria-label={displayName}
                  >
                    <span className="settings-open-app-icon-wrap" aria-hidden>
                      <img
                        className="settings-open-app-icon"
                        src={iconSrc}
                        alt=""
                        width={20}
                        height={20}
                      />
                    </span>
                    <span className="settings-open-app-summary-text">
                      <span className="settings-open-app-summary-title">
                        {displayName}
                      </span>
                      <span className="settings-open-app-summary-sub">
                        {targetSubtitle(t, target)}
                      </span>
                    </span>
                    <span className="settings-open-app-edit-hint" aria-hidden>
                      <Pencil size={13} />
                    </span>
                  </button>

                  <div className="settings-open-app-summary-actions">
                    {canRefresh ? (
                      <button
                        type="button"
                        className={`settings-open-app-health settings-open-app-health--${health}${
                          isRefreshing ? " is-refreshing" : " is-actionable"
                        }`}
                        title={healthActionTitle(t, health, isRefreshing)}
                        aria-label={healthActionTitle(t, health, isRefreshing)}
                        disabled={isRefreshing}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void refreshTarget(target);
                        }}
                      >
                        {isRefreshing
                          ? t("settings.openAppHealthRefreshing")
                          : healthLabel(t, health)}
                      </button>
                    ) : (
                      <span
                        className={`settings-open-app-health settings-open-app-health--${health}`}
                        title={healthLabel(t, health)}
                      >
                        {healthLabel(t, health)}
                      </span>
                    )}
                    {isDefault ? (
                      <span className="settings-open-app-default-badge">
                        <Star size={12} aria-hidden />
                        {t("settings.defaultRadio")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="settings-open-app-default-btn"
                        onClick={() => handleSelectOpenAppDefault(target.id)}
                      >
                        {t("settings.defaultRadio")}
                      </button>
                    )}
                    <div className="settings-open-app-icon-actions">
                      <button
                        type="button"
                        className="settings-open-app-icon-btn"
                        onClick={() => handleMoveOpenApp(index, "up")}
                        disabled={index === 0}
                        aria-label={t("settings.moveUp")}
                      >
                        <ChevronUp size={15} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="settings-open-app-icon-btn"
                        onClick={() => handleMoveOpenApp(index, "down")}
                        disabled={index === openAppDrafts.length - 1}
                        aria-label={t("settings.moveDown")}
                      >
                        <ChevronDown size={15} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="settings-open-app-icon-btn settings-open-app-icon-btn--danger"
                        onClick={() => {
                          if (editingId === target.id) {
                            setEditingId(null);
                          }
                          handleDeleteOpenApp(index);
                        }}
                        disabled={openAppDrafts.length <= 1}
                        aria-label={t("settings.removeAppAriaLabel")}
                        title={t("settings.removeApp")}
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="settings-open-app-footer">
          <button
            type="button"
            className="settings-open-app-add-btn"
            onClick={openAddPicker}
          >
            <Plus size={15} aria-hidden />
            {t("settings.addApp")}
          </button>
          <div className="settings-pref-desc settings-open-app-help">
            {t("settings.openInHelp")}
          </div>
        </div>
      </div>

      {/* Add picker — presets + browse */}
      <Dialog
        open={addPickerOpen}
        onOpenChange={(open) => {
          if (!open) {
            setAddPickerOpen(false);
          }
        }}
      >
        <DialogContent className="settings-open-app-dialog settings-open-app-dialog--wide" showCloseButton>
          <DialogHeader className="settings-open-app-dialog-header">
            <div className="settings-open-app-dialog-titles">
              <DialogTitle>{t("settings.addOpenAppTitle")}</DialogTitle>
              <DialogDescription>
                {t("settings.addOpenAppDesc")}
              </DialogDescription>
            </div>
          </DialogHeader>
          <div className="settings-open-app-dialog-body">
            <div className="settings-open-app-preset-list" role="list">
              {presets.map((preset) => {
                const probe = probeById[preset.id];
                const installed =
                  preset.kind === "finder" ? true : (probe?.installed ?? false);
                const missing =
                  preset.kind !== "finder" && probe && !probe.installed;
                const iconSrc = resolvePresetIcon(preset);
                const title =
                  preset.kind === "finder"
                    ? t(fileManagerTypeI18nKey())
                    : preset.label;
                const subtitle =
                  preset.kind === "finder"
                    ? t("settings.openAppPresetFileManagerHint")
                    : preset.kind === "command"
                      ? t("settings.typeCommand")
                      : t("settings.typeApp");
                const healthKey = missing
                  ? "missing"
                  : installed
                    ? "ok"
                    : "unknown";
                const healthText =
                  healthKey === "missing"
                    ? t("settings.openAppHealthMissing")
                    : healthKey === "ok"
                      ? t("settings.openAppHealthOk")
                      : t("settings.openAppHealthUnknown");
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`settings-open-app-preset-row${missing ? " is-missing" : ""}`}
                    onClick={() => void addFromPreset(preset.id)}
                    role="listitem"
                  >
                    <span className="settings-open-app-preset-icon" aria-hidden>
                      <img src={iconSrc} alt="" width={22} height={22} />
                    </span>
                    <span className="settings-open-app-preset-text">
                      <span className="settings-open-app-preset-name">
                        {title}
                      </span>
                      <span className="settings-open-app-preset-sub">
                        {subtitle}
                      </span>
                    </span>
                    <span
                      className={`settings-open-app-health settings-open-app-health--${healthKey}`}
                    >
                      {healthText}
                    </span>
                    <ChevronRight
                      className="settings-open-app-preset-chevron"
                      size={16}
                      aria-hidden
                    />
                  </button>
                );
              })}
            </div>
            <div className="settings-open-app-picker-actions">
              <button
                type="button"
                className="settings-open-app-dialog-action"
                onClick={() => void addFromBrowse()}
              >
                <FolderOpen size={14} aria-hidden />
                {t("settings.browseApplication")}
              </button>
              <button
                type="button"
                className="settings-open-app-dialog-action"
                onClick={addCustomCommand}
              >
                <Terminal size={14} aria-hidden />
                {t("settings.addCustomCommand")}
              </button>
            </div>
          </div>
          <DialogFooter className="settings-open-app-dialog-footer">
            <button
              type="button"
              className="settings-open-app-dialog-done"
              onClick={() => setAddPickerOpen(false)}
            >
              {t("settings.openAppDone")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editingTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            closeEditor();
          }
        }}
      >
        {editingTarget && editingIndex >= 0 ? (
          <DialogContent
            className="settings-open-app-dialog"
            showCloseButton
          >
            <DialogHeader className="settings-open-app-dialog-header">
              <div className="settings-open-app-dialog-brand">
                <span className="settings-open-app-icon-wrap" aria-hidden>
                  <img
                    className="settings-open-app-icon"
                    src={editingIconSrc}
                    alt=""
                    width={20}
                    height={20}
                  />
                </span>
                <div className="settings-open-app-dialog-titles">
                  <DialogTitle>
                    {editingTarget.kind === "finder"
                      ? t(fileManagerTypeI18nKey())
                      : editingTarget.label.trim() ||
                        t("settings.editOpenAppTitle")}
                  </DialogTitle>
                  <DialogDescription>
                    {t("settings.editOpenAppDesc")}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="settings-open-app-dialog-body">
              <label className="settings-open-app-dialog-field">
                <span className="settings-open-app-dialog-label">
                  {t("settings.label")}
                </span>
                <input
                  className="settings-open-app-dialog-input"
                  value={
                    editingTarget.kind === "finder"
                      ? t(fileManagerTypeI18nKey())
                      : editingTarget.label
                  }
                  placeholder={t("settings.label")}
                  disabled={editingTarget.kind === "finder"}
                  onChange={(event) =>
                    handleOpenAppDraftChange(editingIndex, {
                      label: event.target.value,
                    })
                  }
                  aria-label={`Open app label ${editingIndex + 1}`}
                  autoFocus={editingTarget.kind !== "finder"}
                />
              </label>

              <div className="settings-open-app-dialog-field">
                <span className="settings-open-app-dialog-label">
                  {t("settings.type")}
                </span>
                <div
                  className="settings-open-app-dialog-kind"
                  role="radiogroup"
                  aria-label={`Open app type ${editingIndex + 1}`}
                >
                  {(
                    [
                      ["app", t("settings.typeApp")],
                      ["command", t("settings.typeCommand")],
                      ["finder", t(fileManagerTypeI18nKey())],
                    ] as const
                  ).map(([kind, label]) => (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={editingTarget.kind === kind}
                      className={`settings-open-app-dialog-kind-option${
                        editingTarget.kind === kind ? " is-active" : ""
                      }`}
                      onClick={() =>
                        handleOpenAppKindChange(editingIndex, kind)
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {editingTarget.kind === "app" ? (
                <div className="settings-open-app-dialog-field">
                  <span className="settings-open-app-dialog-label">
                    {t("settings.appName")}
                  </span>
                  <div className="settings-open-app-dialog-input-row">
                    <input
                      className="settings-open-app-dialog-input"
                      value={editingTarget.appName ?? ""}
                      placeholder={t("settings.appNamePlaceholder")}
                      onChange={(event) =>
                        handleOpenAppDraftChange(editingIndex, {
                          appName: event.target.value,
                        })
                      }
                      aria-label={`Open app name ${editingIndex + 1}`}
                    />
                    <button
                      type="button"
                      className="settings-open-app-dialog-secondary"
                      onClick={() => void browseForEditingApp()}
                    >
                      <FolderOpen size={14} aria-hidden />
                      {t("settings.browseApplication")}
                    </button>
                  </div>
                  <span className="settings-open-app-dialog-hint">
                    {t("settings.appNameHelp")}
                  </span>
                </div>
              ) : null}

              {editingTarget.kind === "command" ? (
                <label className="settings-open-app-dialog-field">
                  <span className="settings-open-app-dialog-label">
                    {t("settings.command")}
                  </span>
                  <input
                    className="settings-open-app-dialog-input"
                    value={editingTarget.command ?? ""}
                    placeholder={t("settings.command")}
                    onChange={(event) =>
                      handleOpenAppDraftChange(editingIndex, {
                        command: event.target.value,
                      })
                    }
                    aria-label={`Open app command ${editingIndex + 1}`}
                  />
                </label>
              ) : null}

              {editingTarget.kind !== "finder" ? (
                <label className="settings-open-app-dialog-field">
                  <span className="settings-open-app-dialog-label">
                    {t("settings.args")}
                  </span>
                  <input
                    className="settings-open-app-dialog-input"
                    value={editingTarget.argsText}
                    placeholder={t("settings.args")}
                    onChange={(event) =>
                      handleOpenAppDraftChange(editingIndex, {
                        argsText: event.target.value,
                      })
                    }
                    aria-label={`Open app args ${editingIndex + 1}`}
                  />
                  <span className="settings-open-app-dialog-hint">
                    {t("settings.openInHelp")}
                  </span>
                </label>
              ) : null}
            </div>

            <DialogFooter className="settings-open-app-dialog-footer">
              {editingTarget.id !== openAppSelectedId ? (
                <button
                  type="button"
                  className="settings-open-app-dialog-secondary"
                  onClick={() => handleSelectOpenAppDefault(editingTarget.id)}
                >
                  <Star size={14} aria-hidden />
                  {t("settings.defaultRadio")}
                </button>
              ) : (
                <span className="settings-open-app-dialog-default-note">
                  <Star size={13} aria-hidden />
                  {t("settings.defaultRadio")}
                </span>
              )}
              <button
                type="button"
                className="settings-open-app-dialog-primary"
                onClick={closeEditor}
              >
                {t("settings.openAppDone")}
              </button>
            </DialogFooter>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
