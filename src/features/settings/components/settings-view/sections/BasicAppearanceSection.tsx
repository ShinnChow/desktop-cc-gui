import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Activity from "lucide-react/dist/esm/icons/activity";
import AppWindow from "lucide-react/dist/esm/icons/app-window";
import Bot from "lucide-react/dist/esm/icons/bot";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Construction from "lucide-react/dist/esm/icons/construction";
import Eye from "lucide-react/dist/esm/icons/eye";
import FileEdit from "lucide-react/dist/esm/icons/file-edit";
import Focus from "lucide-react/dist/esm/icons/focus";
import Folder from "lucide-react/dist/esm/icons/folder";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import Globe2 from "lucide-react/dist/esm/icons/globe-2";
import Image from "lucide-react/dist/esm/icons/image";
import Info from "lucide-react/dist/esm/icons/info";
import LayoutList from "lucide-react/dist/esm/icons/layout-list";
import ListChecks from "lucide-react/dist/esm/icons/list-checks";
import MessageSquareQuote from "lucide-react/dist/esm/icons/message-square-quote";
import MessageSquareText from "lucide-react/dist/esm/icons/message-square-text";
import Monitor from "lucide-react/dist/esm/icons/monitor";
import Moon from "lucide-react/dist/esm/icons/moon";
import NotebookPen from "lucide-react/dist/esm/icons/notebook-pen";
import Palette from "lucide-react/dist/esm/icons/palette";
import PanelBottom from "lucide-react/dist/esm/icons/panel-bottom";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import PanelTop from "lucide-react/dist/esm/icons/panel-top";
import Pause from "lucide-react/dist/esm/icons/pause";
import Play from "lucide-react/dist/esm/icons/play";
import RotateCcw from "lucide-react/dist/esm/icons/rotate-ccw";
import Search from "lucide-react/dist/esm/icons/search";
import Sun from "lucide-react/dist/esm/icons/sun";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import type { LucideIcon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  MESSAGES_LIVE_CONTROLS_UPDATED_EVENT,
  MESSAGES_MINIMAL_TRANSCRIPT_FLAG_KEY,
  readLocalBooleanFlag,
  writeLocalBooleanFlag,
} from "@/live-canvas/liveCanvasControls";
import {
  DEFAULT_OPEN_APP_ID,
  DEFAULT_OPEN_APP_TARGETS,
} from "@/features/app/constants";
import { useKnownOpenAppIcons } from "@/features/app/hooks/useKnownOpenAppIcons";
import {
  GENERIC_APP_ICON,
  getKnownOpenAppIcon,
} from "@/features/app/utils/openAppIcons";
import { useClientUiVisibility } from "@/features/client-ui-visibility/hooks/useClientUiVisibility";
import {
  CLIENT_UI_PANEL_REGISTRY,
  getClientUiControlDefinition,
  type ClientUiVisibilityIconKey,
} from "@/features/client-ui-visibility/utils/clientUiVisibility";
import type {
  AppSettings,
  ThemePresetId,
  WorkspaceWallpaperLibraryKind,
  WorkspaceWallpaperObjectFit,
  WorkspaceWallpaperSettings,
} from "../../../../../types";
import {
  CODE_FONT_SIZE_DEFAULT,
  DEFAULT_CODE_FONT_FAMILY,
  DEFAULT_UI_FONT_FAMILY,
  listCodeFontSizeSelectOptions,
} from "../../../../../utils/fonts";
import { useDockIconSrc } from "../../../../theme/hooks/useDockIconSrc";
import {
  DOCK_ICON_OPTIONS,
  sanitizeDockIconId,
  type DockIconId,
} from "../../../../theme/utils/dockIcon";
import { WorkspaceWallpaperPicker } from "../../../../theme/components/WorkspaceWallpaperPicker";
import { useManagedWallpaperSrc } from "../../../../theme/utils/useManagedWallpaperSrc";
import { publishWorkspaceWallpaper } from "../../../../theme/utils/workspaceWallpaperStore";
import {
  DEFAULT_WORKSPACE_WALLPAPER_PLAYBACK_RATE,
  MAX_WORKSPACE_WALLPAPER_BLUR,
  MAX_WORKSPACE_WALLPAPER_DARKEN,
  MIN_WORKSPACE_WALLPAPER_BLUR,
  MIN_WORKSPACE_WALLPAPER_DARKEN,
  WORKSPACE_WALLPAPER_OBJECT_FITS,
  WORKSPACE_WALLPAPER_PLAYBACK_RATES,
  WORKSPACE_WALLPAPER_ROTATION_INTERVALS,
  resolveWorkspaceWallpaperLibraryItem,
  resolveWorkspaceWallpaperMedia,
  sanitizeWorkspaceWallpaper,
  sanitizeWorkspaceWallpaperBlur,
  sanitizeWorkspaceWallpaperDarken,
  visibleWallpaperLibraryItems,
} from "../../../../theme/utils/workspaceWallpaper";
import { LanguageSelector } from "../../LanguageSelector";
import { SyntaxAndDiffPreview } from "./SyntaxAndDiffPreview";
import { HomeAppearanceSettings } from "../../../../home/components/HomeAppearanceSettings";

type BasicAppearanceSectionProps = {
  appSettings: AppSettings;
  onUpdateAppSettings: (next: AppSettings) => Promise<void>;
  windowTransparencyEnabled: boolean;
  onToggleWindowTransparency: (enabled: boolean) => void;
  windowOpacity: number;
  onWindowOpacityChange: (next: number) => void;
  activeThemePresetId: ThemePresetId;
  resolvedAppearanceTheme: "light" | "dark";
  themePresetOptions: ReadonlyArray<{ id: ThemePresetId; label: string }>;
  onThemePresetChange: (presetId: ThemePresetId) => Promise<void>;
  uiScaleDraft: number;
  handleCommitUiScale: (next: number) => void;
  handleResetUiScale: () => void;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  userMsgPresets: ReadonlyArray<{ color: string; label: string }>;
  isUserMsgPresetActive: (presetColor: string) => boolean;
  handleUserMsgPresetClick: (presetColor: string) => void;
  normalizedUserMsgColor: string | null;
  defaultUserMsgColor: string;
  handleUserMsgColorPickerChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  userMsgHexDraft: string;
  handleUserMsgHexInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  handleResetUserMsgColor: () => void;
  uiFontDraft: string;
  handleUiFontSelectChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  uiFontSelectOptions: string[];
  defaultUiPrimaryFont: string;
  setUiFontDraft: (next: string) => void;
  codeFontDraft: string;
  codeFontSelectOptions: string[];
  handleCodeFontSelectChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  defaultCodePrimaryFont: string;
  setCodeFontDraft: (next: string) => void;
  codeFontSizeDraft: number;
  setCodeFontSizeDraft: (next: number) => void;
  handleCommitCodeFontSize: (nextSize: number) => Promise<void>;
};

const CLIENT_UI_VISIBILITY_ICON_COMPONENTS: Record<ClientUiVisibilityIconKey, LucideIcon> = {
  activity: Activity,
  appWindow: AppWindow,
  bot: Bot,
  bookOpen: BookOpen,
  construction: Construction,
  fileEdit: FileEdit,
  focus: Focus,
  folder: Folder,
  gitBranch: GitBranch,
  globe: Globe2,
  info: Info,
  layoutList: LayoutList,
  listChecks: ListChecks,
  messageSquareQuote: MessageSquareQuote,
  messageSquareText: MessageSquareText,
  panelBottom: PanelBottom,
  panelRightOpen: PanelRightOpen,
  panelTop: PanelTop,
  play: Play,
  search: Search,
  terminal: TerminalSquare,
  notebookPen: NotebookPen,
};

function resolveSelectedOpenAppIconSrc(appSettings: AppSettings) {
  const availableTargets =
    appSettings.openAppTargets.length > 0
      ? appSettings.openAppTargets
      : DEFAULT_OPEN_APP_TARGETS;
  const resolvedOpenAppId =
    availableTargets.find((target) => target.id === appSettings.selectedOpenAppId)?.id ??
    availableTargets[0]?.id ??
    DEFAULT_OPEN_APP_ID;
  return getKnownOpenAppIcon(resolvedOpenAppId) ?? GENERIC_APP_ICON;
}

function ClientUiVisibilityIcon({
  iconKey,
  openAppIconSrc,
}: {
  iconKey: ClientUiVisibilityIconKey;
  openAppIconSrc: string;
}) {
  if (iconKey === "appWindow") {
    return (
      <span className="settings-client-ui-visibility-row-icon" aria-hidden>
        <img src={openAppIconSrc} alt="" />
      </span>
    );
  }
  const Icon = CLIENT_UI_VISIBILITY_ICON_COMPONENTS[iconKey];
  return (
    <span className="settings-client-ui-visibility-row-icon" aria-hidden>
      <Icon size={15} strokeWidth={2.15} />
    </span>
  );
}

function WallpaperPreviewThumb({
  path,
  kind,
}: {
  path: string;
  kind: WorkspaceWallpaperLibraryKind;
}) {
  const preview = useManagedWallpaperSrc(path, kind);
  if (preview.failed) {
    return (
      <span className="settings-wallpaper-thumb-fallback" aria-hidden>
        <Image size={16} strokeWidth={2} />
      </span>
    );
  }
  if (kind === "video") {
    return (
      <video
        src={preview.src}
        muted
        playsInline
        preload="metadata"
        aria-hidden
        onError={preview.handleError}
      />
    );
  }
  return <img src={preview.src} alt="" onError={preview.handleError} />;
}

const DOCK_ICON_SCROLL_STEP_PX = 160;
const WALLPAPER_SLIDER_PREVIEW_DEBOUNCE_MS = 1000;

/** Dock PNGs live in lazy chunks; render nothing for the brief load window. */
function DockIconOptionImage({ iconId }: { iconId: DockIconId }) {
  const src = useDockIconSrc(iconId);
  if (!src) {
    return null;
  }
  return <img src={src} alt="" draggable={false} />;
}

type DockIconPickerProps = {
  selectedDockIconId: DockIconId;
  onSelect: (iconId: DockIconId) => void;
  groupLabel: string;
  prevLabel: string;
  nextLabel: string;
};

/** Single-row icon rail: no visible scrollbar, chevrons for overflow. */
function DockIconPicker({
  selectedDockIconId,
  onSelect,
  groupLabel,
  prevLabel,
  nextLabel,
}: DockIconPickerProps) {
  const { t } = useTranslation();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  const syncScrollEdges = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) {
      setCanScrollPrev(false);
      setCanScrollNext(false);
      return;
    }
    const maxScroll = Math.max(0, node.scrollWidth - node.clientWidth);
    const left = node.scrollLeft;
    // 1px tolerance for sub-pixel scroll widths
    setCanScrollPrev(left > 1);
    setCanScrollNext(left < maxScroll - 1);
  }, []);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) {
      return;
    }
    syncScrollEdges();
    // Images load async; re-measure once layout settles so chevrons enable correctly.
    const rafId = window.requestAnimationFrame(() => syncScrollEdges());
    const onScroll = () => syncScrollEdges();
    node.addEventListener("scroll", onScroll, { passive: true });
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncScrollEdges())
        : null;
    resizeObserver?.observe(node);
    window.addEventListener("resize", syncScrollEdges);
    return () => {
      window.cancelAnimationFrame(rafId);
      node.removeEventListener("scroll", onScroll);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncScrollEdges);
    };
  }, [syncScrollEdges]);

  const scrollByStep = (direction: -1 | 1) => {
    const node = scrollerRef.current;
    if (!node) {
      return;
    }
    node.scrollBy({
      left: direction * DOCK_ICON_SCROLL_STEP_PX,
      behavior: "smooth",
    });
  };

  return (
    <div className="settings-dock-icon-picker-wrap">
      <button
        type="button"
        className="settings-dock-icon-nav"
        aria-label={prevLabel}
        disabled={!canScrollPrev}
        onClick={() => scrollByStep(-1)}
      >
        <ChevronLeft size={16} strokeWidth={2.25} aria-hidden />
      </button>
      <div
        ref={scrollerRef}
        className="settings-dock-icon-picker"
        role="radiogroup"
        aria-label={groupLabel}
      >
        {DOCK_ICON_OPTIONS.map((option) => {
          const isActive = option.id === selectedDockIconId;
          const optionLabel = t(option.labelKey);
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={optionLabel}
              title={optionLabel}
              className={`settings-dock-icon-option${isActive ? " is-active" : ""}`}
              onClick={() => onSelect(option.id)}
            >
              <DockIconOptionImage iconId={option.id} />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="settings-dock-icon-nav"
        aria-label={nextLabel}
        disabled={!canScrollNext}
        onClick={() => scrollByStep(1)}
      >
        <ChevronRight size={16} strokeWidth={2.25} aria-hidden />
      </button>
    </div>
  );
}

export function BasicAppearanceSection({
  appSettings,
  onUpdateAppSettings,
  windowTransparencyEnabled,
  onToggleWindowTransparency,
  windowOpacity,
  onWindowOpacityChange,
  activeThemePresetId,
  resolvedAppearanceTheme,
  themePresetOptions,
  onThemePresetChange,
  // Scale props retained for call-site stability; feature locked to 100%.
  uiScaleDraft: _uiScaleDraft,
  handleCommitUiScale: _handleCommitUiScale,
  handleResetUiScale: _handleResetUiScale,
  scaleShortcutTitle: _scaleShortcutTitle,
  scaleShortcutText: _scaleShortcutText,
  userMsgPresets,
  isUserMsgPresetActive,
  handleUserMsgPresetClick,
  normalizedUserMsgColor,
  defaultUserMsgColor,
  handleUserMsgColorPickerChange,
  userMsgHexDraft,
  handleUserMsgHexInputChange,
  handleResetUserMsgColor,
  uiFontDraft,
  handleUiFontSelectChange,
  uiFontSelectOptions,
  defaultUiPrimaryFont,
  setUiFontDraft,
  codeFontDraft,
  codeFontSelectOptions,
  handleCodeFontSelectChange,
  defaultCodePrimaryFont,
  setCodeFontDraft,
  codeFontSizeDraft,
  setCodeFontSizeDraft,
  handleCommitCodeFontSize,
}: BasicAppearanceSectionProps) {
  const { t } = useTranslation();
  const clientUiVisibility = useClientUiVisibility();
  const [minimalTranscriptEnabled, setMinimalTranscriptEnabled] = useState(() =>
    readLocalBooleanFlag(MESSAGES_MINIMAL_TRANSCRIPT_FLAG_KEY, true),
  );
  const handleToggleMinimalTranscript = useCallback((checked: boolean) => {
    writeLocalBooleanFlag(MESSAGES_MINIMAL_TRANSCRIPT_FLAG_KEY, checked);
    setMinimalTranscriptEnabled(checked);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(MESSAGES_LIVE_CONTROLS_UPDATED_EVENT, {
          detail: { minimalTranscriptEnabled: checked },
        }),
      );
    }
  }, []);
  // Built-in open-app PNGs load lazily; show the generic glyph until cached.
  const knownOpenAppIconsLoaded = useKnownOpenAppIcons();
  const selectedOpenAppIconSrc = knownOpenAppIconsLoaded
    ? resolveSelectedOpenAppIconSrc(appSettings)
    : GENERIC_APP_ICON;
  const selectedDockIconId = sanitizeDockIconId(appSettings.dockIconId);
  const wallpaper = sanitizeWorkspaceWallpaper(appSettings.workspaceWallpaper);
  const selectedLibraryItem = resolveWorkspaceWallpaperLibraryItem(wallpaper);
  const currentWallpaperMedia = resolveWorkspaceWallpaperMedia(wallpaper);
  const visibleLibraryCount = visibleWallpaperLibraryItems(
    wallpaper.library ?? [],
  ).length;

  // Local drafts for sliders: preview CSS vars immediately, persist after 1s
  // idle / release so dragging does not write the whole settings file per tick.
  const [blurDraft, setBlurDraft] = useState(wallpaper.wallpaperBlur ?? 0);
  const [darkenDraft, setDarkenDraft] = useState(wallpaper.wallpaperDarken ?? 0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const blurPersistTimerRef = useRef<number | null>(null);
  const darkenPersistTimerRef = useRef<number | null>(null);
  useEffect(() => {
    setBlurDraft(wallpaper.wallpaperBlur ?? 0);
  }, [wallpaper.wallpaperBlur]);
  useEffect(() => {
    setDarkenDraft(wallpaper.wallpaperDarken ?? 0);
  }, [wallpaper.wallpaperDarken]);
  useEffect(() => {
    return () => {
      if (blurPersistTimerRef.current != null) {
        window.clearTimeout(blurPersistTimerRef.current);
      }
      if (darkenPersistTimerRef.current != null) {
        window.clearTimeout(darkenPersistTimerRef.current);
      }
    };
  }, []);

  const persistWallpaper = (next: Partial<WorkspaceWallpaperSettings>) => {
    void onUpdateAppSettings({
      ...appSettings,
      workspaceWallpaper: sanitizeWorkspaceWallpaper({
        ...wallpaper,
        ...next,
      }),
    });
  };

  const previewWallpaper = (next: Partial<WorkspaceWallpaperSettings>) => {
    publishWorkspaceWallpaper({
      ...wallpaper,
      ...next,
    });
  };

  const scheduleWallpaperPersist = (
    timerRef: React.MutableRefObject<number | null>,
    next: Partial<WorkspaceWallpaperSettings>,
  ) => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      persistWallpaper(next);
    }, WALLPAPER_SLIDER_PREVIEW_DEBOUNCE_MS);
  };

  const flushWallpaperPersist = (
    timerRef: React.MutableRefObject<number | null>,
    next: Partial<WorkspaceWallpaperSettings>,
  ) => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    persistWallpaper(next);
  };

  const handleBlurDraftChange = (raw: number) => {
    const next = sanitizeWorkspaceWallpaperBlur(raw);
    setBlurDraft(next);
    previewWallpaper({ wallpaperBlur: next });
    scheduleWallpaperPersist(blurPersistTimerRef, { wallpaperBlur: next });
  };

  const commitBlurDraft = () => {
    const next = sanitizeWorkspaceWallpaperBlur(blurDraft);
    if (next === (wallpaper.wallpaperBlur ?? 0) && blurPersistTimerRef.current == null) {
      return;
    }
    flushWallpaperPersist(blurPersistTimerRef, { wallpaperBlur: next });
  };

  const handleDarkenDraftChange = (raw: number) => {
    const next = sanitizeWorkspaceWallpaperDarken(raw);
    setDarkenDraft(next);
    previewWallpaper({ wallpaperDarken: next });
    scheduleWallpaperPersist(darkenPersistTimerRef, { wallpaperDarken: next });
  };

  const commitDarkenDraft = () => {
    const next = sanitizeWorkspaceWallpaperDarken(darkenDraft);
    if (next === (wallpaper.wallpaperDarken ?? 0) && darkenPersistTimerRef.current == null) {
      return;
    }
    flushWallpaperPersist(darkenPersistTimerRef, { wallpaperDarken: next });
  };
  const resolvedAppearanceLabel = t(
    resolvedAppearanceTheme === "light" ? "settings.themeLight" : "settings.themeDark",
  );
  const themeModeHint =
    appSettings.theme === "custom"
      ? t("settings.themeModeHintCustom", { appearance: resolvedAppearanceLabel })
      : appSettings.theme === "system"
        ? t("settings.themeModeHintSystem", { appearance: resolvedAppearanceLabel })
        : t("settings.themeModeHintFixed", { appearance: resolvedAppearanceLabel });

  const handleDockIconSelect = (iconId: DockIconId) => {
    if (iconId === selectedDockIconId) {
      return;
    }
    void onUpdateAppSettings({
      ...appSettings,
      dockIconId: iconId,
    });
  };

  return (
    <div className="settings-basic-appearance settings-basic-surface">
      <HomeAppearanceSettings />
      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card">
        <div className="settings-pref-row settings-pref-row--theme">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.theme")}</div>
            <div className="settings-pref-desc">{themeModeHint}</div>
          </div>
          <div
            className="settings-pref-control settings-pref-segmented"
            role="radiogroup"
            aria-label={t("settings.theme")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "system"}
              className={`settings-pref-segment ${
                appSettings.theme === "system" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "system",
                })
              }
            >
              <Monitor size={14} aria-hidden />
              <span>{t("settings.themeSystem")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "light"}
              className={`settings-pref-segment ${
                appSettings.theme === "light" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "light",
                })
              }
            >
              <Sun size={14} aria-hidden />
              <span>{t("settings.themeLight")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "dark"}
              className={`settings-pref-segment ${
                appSettings.theme === "dark" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "dark",
                })
              }
            >
              <Moon size={14} aria-hidden />
              <span>{t("settings.themeDark")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.theme === "custom"}
              className={`settings-pref-segment ${
                appSettings.theme === "custom" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  theme: "custom",
                  customThemePresetId: activeThemePresetId,
                })
              }
            >
              <Palette size={14} aria-hidden />
              <span>{t("settings.themeCustom")}</span>
            </button>
          </div>
        </div>

        <div
          className={`settings-pref-row settings-pref-row--stack${
            wallpaper.mode === "custom" ? " is-expanded" : ""
          }`}
          data-testid="settings-workspace-wallpaper"
        >
            <div className="settings-pref-row-main">
              <div className="settings-pref-meta">
                <div className="settings-pref-title">
                  {t("settings.workspaceWallpaper")}
                </div>
                <div className="settings-pref-desc">
                  {t("settings.workspaceWallpaperDesc")}
                </div>
              </div>
              <div
                className="settings-pref-control settings-pref-segmented settings-pref-segmented--pair"
                role="radiogroup"
                aria-label={t("settings.workspaceWallpaper")}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={wallpaper.mode !== "custom"}
                  className={`settings-pref-segment ${
                    wallpaper.mode !== "custom" ? "is-active" : ""
                  }`}
                  onClick={() => persistWallpaper({ mode: "none" })}
                >
                  <span>{t("settings.workspaceWallpaperNone")}</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={wallpaper.mode === "custom"}
                  className={`settings-pref-segment ${
                    wallpaper.mode === "custom" ? "is-active" : ""
                  }`}
                  onClick={() => persistWallpaper({ mode: "custom" })}
                >
                  <span>{t("settings.workspaceWallpaperCustom")}</span>
                </button>
              </div>
            </div>
            {wallpaper.mode === "custom" ? (
              <div className="settings-wallpaper-custom">
                <div className="settings-wallpaper-subrow">
                  <div className="settings-pref-meta">
                    <div className="settings-pref-title">
                      {t("settings.workspaceWallpaperCurrent")}
                    </div>
                    {currentWallpaperMedia ? null : (
                      <div className="settings-pref-desc">
                        {t("settings.workspaceWallpaperMissing")}
                      </div>
                    )}
                  </div>
                  <div className="settings-pref-control settings-wallpaper-current-control">
                    {selectedLibraryItem?.kind === "video" ? (
                      <button
                        type="button"
                        className="settings-web-btn"
                        onClick={() =>
                          persistWallpaper({ paused: wallpaper.paused !== true })
                        }
                      >
                        {wallpaper.paused ? (
                          <Play size={13} strokeWidth={2.2} aria-hidden />
                        ) : (
                          <Pause size={13} strokeWidth={2.2} aria-hidden />
                        )}
                        <span>
                          {wallpaper.paused
                            ? t("settings.workspaceWallpaperPlay")
                            : t("settings.workspaceWallpaperPause")}
                        </span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="settings-wallpaper-chooser"
                      onClick={() => setPickerOpen(true)}
                      aria-label={t("settings.workspaceWallpaperChoose")}
                    >
                      <span className="settings-wallpaper-thumb">
                        {currentWallpaperMedia ? (
                          <WallpaperPreviewThumb
                            path={currentWallpaperMedia.path}
                            kind={currentWallpaperMedia.kind}
                          />
                        ) : (
                          <span className="settings-wallpaper-thumb-fallback" aria-hidden>
                            <Image size={16} strokeWidth={2} />
                          </span>
                        )}
                      </span>
                      <span className="settings-web-btn">
                        {t("settings.workspaceWallpaperChoose")}
                      </span>
                    </button>
                  </div>
                </div>
                <div className="settings-wallpaper-subrow">
                  <div className="settings-pref-meta">
                    <div className="settings-pref-title">
                      {t("settings.workspaceWallpaperFit")}
                    </div>
                  </div>
                  <div
                    className="settings-pref-control settings-pref-segmented settings-wallpaper-fits"
                    role="radiogroup"
                    aria-label={t("settings.workspaceWallpaperFit")}
                  >
                    {WORKSPACE_WALLPAPER_OBJECT_FITS.map((fit) => {
                      const active =
                        (wallpaper.objectFit ?? "cover") === fit;
                      return (
                        <button
                          key={fit}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`settings-pref-segment${active ? " is-active" : ""}`}
                          onClick={() =>
                            persistWallpaper({
                              objectFit: fit as WorkspaceWallpaperObjectFit,
                            })
                          }
                        >
                          <span>{t(`settings.workspaceWallpaperFit_${fit}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {selectedLibraryItem?.kind === "video" ? (
                  <div className="settings-wallpaper-subrow">
                    <div className="settings-pref-meta">
                      <div className="settings-pref-title">
                        {t("settings.workspaceWallpaperSpeed")}
                      </div>
                    </div>
                    <div
                      className="settings-pref-control settings-pref-segmented settings-wallpaper-rates"
                      role="radiogroup"
                      aria-label={t("settings.workspaceWallpaperSpeed")}
                    >
                      {WORKSPACE_WALLPAPER_PLAYBACK_RATES.map((rate) => {
                        const active =
                          (wallpaper.playbackRate ??
                            DEFAULT_WORKSPACE_WALLPAPER_PLAYBACK_RATE) === rate;
                        return (
                          <button
                            key={rate}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={`settings-pref-segment${active ? " is-active" : ""}`}
                            onClick={() => persistWallpaper({ playbackRate: rate })}
                          >
                            <span>
                              {t("settings.workspaceWallpaperSpeedValue", {
                                value: rate,
                              })}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="settings-wallpaper-subrow">
                  <div className="settings-pref-meta">
                    <div className="settings-pref-title">
                      {t("settings.workspaceWallpaperFlip")}
                    </div>
                  </div>
                  <div className="settings-pref-control">
                    <Switch
                      checked={wallpaper.flip === true}
                      aria-label={t("settings.workspaceWallpaperFlip")}
                      onCheckedChange={(checked) =>
                        persistWallpaper({ flip: checked })
                      }
                    />
                  </div>
                </div>
                <div className="settings-wallpaper-subrow">
                  <div className="settings-pref-meta">
                    <div className="settings-pref-title">
                      {t("settings.workspaceWallpaperBlur")}
                    </div>
                  </div>
                  <div className="settings-pref-control settings-pref-inline-control">
                    <input
                      type="range"
                      min={MIN_WORKSPACE_WALLPAPER_BLUR}
                      max={MAX_WORKSPACE_WALLPAPER_BLUR}
                      step={1}
                      className="settings-input settings-input--range"
                      aria-label={t("settings.workspaceWallpaperBlur")}
                      value={blurDraft}
                      onChange={(event) =>
                        handleBlurDraftChange(Number(event.target.value))
                      }
                      onPointerUp={commitBlurDraft}
                      onKeyUp={commitBlurDraft}
                      onBlur={commitBlurDraft}
                    />
                    <span className="settings-pref-value">
                      {t("settings.workspaceWallpaperBlurValue", {
                        value: blurDraft,
                      })}
                    </span>
                  </div>
                </div>
                <div className="settings-wallpaper-subrow">
                  <div className="settings-pref-meta">
                    <div className="settings-pref-title">
                      {t("settings.workspaceWallpaperDarken")}
                    </div>
                  </div>
                  <div className="settings-pref-control settings-pref-inline-control">
                    <input
                      type="range"
                      min={MIN_WORKSPACE_WALLPAPER_DARKEN}
                      max={MAX_WORKSPACE_WALLPAPER_DARKEN}
                      step={1}
                      className="settings-input settings-input--range"
                      aria-label={t("settings.workspaceWallpaperDarken")}
                      value={darkenDraft}
                      onChange={(event) =>
                        handleDarkenDraftChange(Number(event.target.value))
                      }
                      onPointerUp={commitDarkenDraft}
                      onKeyUp={commitDarkenDraft}
                      onBlur={commitDarkenDraft}
                    />
                    <span className="settings-pref-value">
                      {t("settings.workspaceWallpaperDarkenValue", {
                        value: darkenDraft,
                      })}
                    </span>
                  </div>
                </div>
                <div className="settings-wallpaper-subrow">
                  <div className="settings-pref-meta">
                    <div className="settings-pref-title">
                      {t("settings.workspaceWallpaperRotation")}
                    </div>
                    {visibleLibraryCount < 2 ? (
                      <div className="settings-pref-desc">
                        {t("settings.workspaceWallpaperRotationHint")}
                      </div>
                    ) : null}
                  </div>
                  <div className="settings-pref-control">
                    <Switch
                      checked={wallpaper.rotationEnabled === true}
                      disabled={visibleLibraryCount < 2}
                      aria-label={t("settings.workspaceWallpaperRotation")}
                      onCheckedChange={(checked) =>
                        persistWallpaper({ rotationEnabled: checked })
                      }
                    />
                  </div>
                </div>
                {wallpaper.rotationEnabled ? (
                  <div className="settings-wallpaper-subrow">
                    <div className="settings-pref-meta">
                      <div className="settings-pref-title">
                        {t("settings.workspaceWallpaperRotationInterval")}
                      </div>
                    </div>
                    <div
                      className="settings-pref-control settings-pref-segmented settings-wallpaper-rates"
                      role="radiogroup"
                      aria-label={t("settings.workspaceWallpaperRotationInterval")}
                    >
                      {WORKSPACE_WALLPAPER_ROTATION_INTERVALS.map((minutes) => {
                        const active =
                          (wallpaper.rotationIntervalMinutes ?? 30) === minutes;
                        return (
                          <button
                            key={minutes}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={`settings-pref-segment${active ? " is-active" : ""}`}
                            onClick={() =>
                              persistWallpaper({
                                rotationIntervalMinutes: minutes,
                              })
                            }
                          >
                            <span>
                              {t("settings.workspaceWallpaperRotationValue", {
                                value: minutes,
                              })}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <WorkspaceWallpaperPicker
                  open={pickerOpen}
                  wallpaper={wallpaper}
                  onClose={() => setPickerOpen(false)}
                  onChange={persistWallpaper}
                />
              </div>
            ) : null}
          </div>

        {appSettings.theme === "custom" ? (
          <div className="settings-pref-row">
            <div className="settings-pref-meta">
              <div className="settings-pref-title">{t("settings.themePreset")}</div>
              <div className="settings-pref-desc">
                {t("settings.themePresetDescription", {
                  appearance: resolvedAppearanceLabel,
                })}
              </div>
            </div>
            <div className="settings-pref-control">
              <div className="settings-pref-select-wrap">
                <select
                  className="settings-pref-select"
                  aria-label={t("settings.themePreset")}
                  value={activeThemePresetId}
                  onChange={(event) =>
                    void onThemePresetChange(event.target.value as ThemePresetId)
                  }
                >
                  {themePresetOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ) : null}

        {/* 应用图标选择入口已隐藏，仅隐藏 UI，底层换肤逻辑保留 */}
        {false && (
        <div className="settings-pref-row settings-pref-row--dock-icon">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.dockIcon")}</div>
            <div className="settings-pref-desc">{t("settings.dockIconDesc")}</div>
          </div>
          <DockIconPicker
            selectedDockIconId={selectedDockIconId}
            onSelect={handleDockIconSelect}
            groupLabel={t("settings.dockIcon")}
            prevLabel={t("settings.dockIconScrollPrev", {
              defaultValue: "Previous icons",
            })}
            nextLabel={t("settings.dockIconScrollNext", {
              defaultValue: "Next icons",
            })}
          />
        </div>
        )}

        <SyntaxAndDiffPreview appearance={resolvedAppearanceTheme} />

        <div
          className={`settings-pref-row settings-pref-row--stack${
            windowTransparencyEnabled ? " is-expanded" : ""
          }`}
        >
          <div className="settings-pref-row-main">
            <div className="settings-pref-meta">
              <div className="settings-pref-title">
                {t("settings.windowTransparency")}
              </div>
              <div className="settings-pref-desc">
                {t("settings.windowTransparencyDesc")}
              </div>
            </div>
            <div className="settings-pref-control">
              <Switch
                checked={windowTransparencyEnabled}
                aria-label={t("settings.windowTransparency")}
                onCheckedChange={(checked) => onToggleWindowTransparency(checked)}
              />
            </div>
          </div>
          {windowTransparencyEnabled ? (
            <div className="settings-pref-inline-control">
              <input
                type="range"
                min={55}
                max={100}
                step={1}
                className="settings-input settings-input--range"
                aria-label={t("settings.windowOpacity")}
                value={windowOpacity}
                onChange={(event) =>
                  onWindowOpacityChange(Number(event.target.value))
                }
              />
              <span className="settings-pref-value">
                {t("settings.windowOpacityValue", {
                  value: windowOpacity,
                })}
              </span>
            </div>
          ) : null}
        </div>

        <LanguageSelector />

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.canvasWidth")}</div>
            <div className="settings-pref-desc">{t("settings.canvasWidthDesc")}</div>
          </div>
          <div
            className="settings-pref-control settings-pref-segmented settings-pref-segmented--pair"
            role="radiogroup"
            aria-label={t("settings.canvasWidth")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.canvasWidthMode !== "wide"}
              className={`settings-pref-segment ${
                appSettings.canvasWidthMode !== "wide" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  canvasWidthMode: "narrow",
                })
              }
            >
              <span>{t("settings.canvasWidthNarrow")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.canvasWidthMode === "wide"}
              className={`settings-pref-segment ${
                appSettings.canvasWidthMode === "wide" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  canvasWidthMode: "wide",
                })
              }
            >
              <span>{t("settings.canvasWidthWide")}</span>
            </button>
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.layoutMode")}</div>
            <div className="settings-pref-desc">{t("settings.layoutModeDesc")}</div>
          </div>
          <div
            className="settings-pref-control settings-pref-segmented settings-pref-segmented--pair"
            role="radiogroup"
            aria-label={t("settings.layoutMode")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.layoutMode !== "swapped"}
              className={`settings-pref-segment ${
                appSettings.layoutMode !== "swapped" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  layoutMode: "default",
                })
              }
            >
              <span>{t("settings.layoutModeDefault")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={appSettings.layoutMode === "swapped"}
              className={`settings-pref-segment ${
                appSettings.layoutMode === "swapped" ? "is-active" : ""
              }`}
              onClick={() =>
                void onUpdateAppSettings({
                  ...appSettings,
                  layoutMode: "swapped",
                })
              }
            >
              <span>{t("settings.layoutModeSwapped")}</span>
            </button>
          </div>
        </div>

        {/* 幕布展示模式：常规 / 极简 */}
        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.minimalTranscript")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.minimalTranscriptDesc")}
            </div>
          </div>
          <div
            className="settings-pref-control settings-pref-segmented settings-pref-segmented--pair"
            role="radiogroup"
            aria-label={t("settings.minimalTranscript")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={!minimalTranscriptEnabled}
              className={`settings-pref-segment ${
                !minimalTranscriptEnabled ? "is-active" : ""
              }`}
              onClick={() => handleToggleMinimalTranscript(false)}
            >
              <span>{t("settings.minimalTranscriptNormal")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={minimalTranscriptEnabled}
              className={`settings-pref-segment ${
                minimalTranscriptEnabled ? "is-active" : ""
              }`}
              onClick={() => handleToggleMinimalTranscript(true)}
            >
              <span>{t("settings.minimalTranscriptMinimal")}</span>
            </button>
          </div>
        </div>

        <div
          className="settings-pref-row"
          data-testid="settings-top-session-tabs"
        >
          <div className="settings-pref-meta">
            <div className="settings-pref-title">
              {t("settings.clientUiVisibility.panels.topSessionTabs")}
            </div>
            <div className="settings-pref-desc">
              {t("settings.clientUiVisibility.panelDescriptions.topSessionTabs")}
            </div>
          </div>
          <div
            className="settings-pref-control settings-pref-segmented settings-pref-segmented--pair"
            role="radiogroup"
            aria-label={t("settings.clientUiVisibility.panels.topSessionTabs")}
          >
            <button
              type="button"
              role="radio"
              aria-checked={!clientUiVisibility.isPanelVisible("topSessionTabs")}
              className={`settings-pref-segment ${
                !clientUiVisibility.isPanelVisible("topSessionTabs")
                  ? "is-active"
                  : ""
              }`}
              onClick={() =>
                clientUiVisibility.setPanelVisible("topSessionTabs", false)
              }
            >
              <span>{t("settings.topSessionTabsHide")}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={clientUiVisibility.isPanelVisible("topSessionTabs")}
              className={`settings-pref-segment ${
                clientUiVisibility.isPanelVisible("topSessionTabs")
                  ? "is-active"
                  : ""
              }`}
              onClick={() =>
                clientUiVisibility.setPanelVisible("topSessionTabs", true)
              }
            >
              <span>{t("settings.topSessionTabsShow")}</span>
            </button>
          </div>
        </div>

        {/* UI scale permanently locked to 100% — control removed (2026-08 freeze). */}
      </div>

      {/* 界面显示面板已隐藏，仅隐藏 UI，底层可见性逻辑保留 */}
      {false && (
      <div className="settings-basic-group-card settings-basic-group-card--list settings-client-ui-visibility-card">
        <div className="settings-client-ui-visibility-head">
          <div>
            <div className="settings-subsection-title settings-client-ui-visibility-title">
              <Eye className="settings-basic-field-icon" aria-hidden />
              <span>{t("settings.clientUiVisibility.title")}</span>
            </div>
            <div className="settings-subsection-subtitle">
              {t("settings.clientUiVisibility.description")}
            </div>
          </div>
          <button
            type="button"
            className="ghost settings-button-compact settings-client-ui-visibility-reset"
            onClick={clientUiVisibility.resetVisibility}
          >
            <RotateCcw size={14} aria-hidden />
            {t("settings.clientUiVisibility.reset")}
          </button>
        </div>
        {CLIENT_UI_PANEL_REGISTRY.map((panel) => {
          const panelVisible = clientUiVisibility.isPanelVisible(panel.id);
          return (
            <div className="settings-client-ui-visibility-panel" key={panel.id}>
              <div className="settings-toggle-row settings-client-ui-visibility-panel-row">
                <div className="settings-client-ui-visibility-row-copy">
                  <ClientUiVisibilityIcon
                    iconKey={panel.iconKey}
                    openAppIconSrc={selectedOpenAppIconSrc}
                  />
                  <div className="settings-client-ui-visibility-row-text">
                    <div className="settings-toggle-title">{t(panel.labelKey)}</div>
                    <div className="settings-toggle-subtitle">
                      {t(panel.descriptionKey)}
                    </div>
                  </div>
                </div>
                <Switch
                  checked={panelVisible}
                  aria-label={t(panel.labelKey)}
                  onCheckedChange={(checked) =>
                    clientUiVisibility.setPanelVisible(panel.id, checked)
                  }
                />
              </div>
              {panel.controls.length > 0 ? (
                <div className="settings-client-ui-visibility-controls">
                  {panel.controls.map((controlId) => {
                    const control = getClientUiControlDefinition(controlId);
                    return (
                      <div
                        className={`settings-toggle-row settings-client-ui-visibility-control-row${
                          panelVisible ? "" : " is-parent-hidden"
                        }`}
                        key={control.id}
                      >
                        <div className="settings-client-ui-visibility-row-copy">
                          <ClientUiVisibilityIcon
                            iconKey={control.iconKey}
                            openAppIconSrc={selectedOpenAppIconSrc}
                          />
                          <div className="settings-client-ui-visibility-row-text">
                            <div className="settings-toggle-title">
                              {t(control.labelKey)}
                            </div>
                            <div className="settings-toggle-subtitle">
                              {t(control.descriptionKey)}
                              {!panelVisible ? (
                                <span className="settings-client-ui-visibility-parent-hint">
                                  {" "}
                                  {t("settings.clientUiVisibility.parentHiddenHint")}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <Switch
                          checked={clientUiVisibility.isControlPreferenceVisible(control.id)}
                          aria-label={t(control.labelKey)}
                          onCheckedChange={(checked) =>
                            clientUiVisibility.setControlVisible(control.id, checked)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      )}

      <div className="settings-basic-group-card settings-basic-group-card--list settings-pref-card settings-pref-card--typography">
        <div className="settings-pref-row settings-pref-row--color">
          <div className="settings-pref-meta">
            <div className="settings-pref-title">{t("settings.userMsgColorLabel")}</div>
            <div className="settings-pref-desc">{t("settings.userMsgColorHint")}</div>
          </div>
          <div className="settings-pref-control settings-pref-color">
            <div className="settings-color-swatch-list" role="list">
              {userMsgPresets.map((preset) => (
                <button
                  key={preset.color}
                  type="button"
                  role="listitem"
                  className={`settings-color-dot${isUserMsgPresetActive(preset.color) ? " is-active" : ""}`}
                  onClick={() => handleUserMsgPresetClick(preset.color)}
                  title={preset.label}
                  aria-label={`${t("settings.userMsgColorLabel")} ${preset.color}`}
                  data-testid={`settings-user-msg-color-preset-${preset.color.slice(1)}`}
                >
                  <span style={{ backgroundColor: preset.color }} />
                </button>
              ))}
              <label
                className={`settings-color-dot settings-color-dot--custom${
                  normalizedUserMsgColor &&
                  !userMsgPresets.some((preset) =>
                    isUserMsgPresetActive(preset.color),
                  )
                    ? " is-active"
                    : ""
                }`}
                title={t("settings.userMsgColorCustom")}
              >
                <span
                  style={{
                    backgroundColor: normalizedUserMsgColor || defaultUserMsgColor,
                  }}
                />
                <input
                  type="color"
                  className="settings-color-picker-input"
                  value={normalizedUserMsgColor || defaultUserMsgColor}
                  onChange={handleUserMsgColorPickerChange}
                  aria-label={t("settings.userMsgColorCustom")}
                />
              </label>
            </div>
            <input
              type="text"
              className="settings-pref-hex-input"
              value={userMsgHexDraft}
              onChange={handleUserMsgHexInputChange}
              placeholder="#6e40c9"
              maxLength={7}
              spellCheck={false}
              aria-label={t("settings.userMsgColorLabel")}
              data-testid="settings-user-msg-color-hex-input"
            />
            {normalizedUserMsgColor ? (
              <button
                type="button"
                className="settings-pref-reset"
                onClick={handleResetUserMsgColor}
                data-testid="settings-user-msg-color-reset"
              >
                {t("settings.reset")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <label className="settings-pref-title" htmlFor="ui-font-family">
              {t("settings.uiFontFamily")}
            </label>
            <div className="settings-pref-desc">{t("settings.uiFontFamilyDesc")}</div>
          </div>
          <div className="settings-pref-control settings-pref-font-control">
            <div className="settings-pref-select-wrap settings-pref-select-wrap--grow">
              <select
                id="ui-font-family"
                className="settings-pref-select"
                value={uiFontDraft}
                onChange={handleUiFontSelectChange}
                data-testid="settings-ui-font-select"
              >
                {uiFontSelectOptions.map((fontName) => (
                  <option key={fontName} value={fontName}>
                    {fontName}
                  </option>
                ))}
              </select>
            </div>
            {uiFontDraft !== defaultUiPrimaryFont ? (
              <button
                type="button"
                className="settings-pref-reset"
                onClick={() => {
                  setUiFontDraft(defaultUiPrimaryFont);
                  void onUpdateAppSettings({
                    ...appSettings,
                    uiFontFamily: DEFAULT_UI_FONT_FAMILY,
                  });
                }}
              >
                {t("settings.reset")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <label className="settings-pref-title" htmlFor="code-font-family">
              {t("settings.codeFontFamily")}
            </label>
            <div className="settings-pref-desc">{t("settings.codeFontFamilyDesc")}</div>
          </div>
          <div className="settings-pref-control settings-pref-font-control">
            <div className="settings-pref-select-wrap settings-pref-select-wrap--grow">
              <select
                id="code-font-family"
                className="settings-pref-select"
                value={codeFontDraft}
                onChange={handleCodeFontSelectChange}
                data-testid="settings-code-font-select"
              >
                {codeFontSelectOptions.map((fontName) => (
                  <option key={fontName} value={fontName}>
                    {fontName}
                  </option>
                ))}
              </select>
            </div>
            {codeFontDraft !== defaultCodePrimaryFont ? (
              <button
                type="button"
                className="settings-pref-reset"
                onClick={() => {
                  setCodeFontDraft(defaultCodePrimaryFont);
                  void onUpdateAppSettings({
                    ...appSettings,
                    codeFontFamily: DEFAULT_CODE_FONT_FAMILY,
                  });
                }}
              >
                {t("settings.reset")}
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-pref-row">
          <div className="settings-pref-meta">
            <label className="settings-pref-title" htmlFor="code-font-size">
              {t("settings.codeFontSize")}
            </label>
            <div className="settings-pref-desc">{t("settings.codeFontSizeDesc")}</div>
          </div>
          <div className="settings-pref-control settings-pref-font-control">
            <div className="settings-pref-select-wrap">
              <select
                id="code-font-size"
                className="settings-pref-select"
                data-testid="settings-code-font-size-select"
                aria-label={t("settings.codeFontSize")}
                value={String(codeFontSizeDraft)}
                onChange={(event) => {
                  const nextValue = Number(event.target.value);
                  if (!Number.isFinite(nextValue)) {
                    return;
                  }
                  setCodeFontSizeDraft(nextValue);
                  void handleCommitCodeFontSize(nextValue);
                }}
              >
                {listCodeFontSizeSelectOptions(codeFontSizeDraft).map((size) => (
                  <option key={size} value={String(size)}>
                    {size}px
                  </option>
                ))}
              </select>
            </div>
            {codeFontSizeDraft !== CODE_FONT_SIZE_DEFAULT ? (
              <button
                type="button"
                className="settings-pref-reset"
                onClick={() => {
                  setCodeFontSizeDraft(CODE_FONT_SIZE_DEFAULT);
                  void handleCommitCodeFontSize(CODE_FONT_SIZE_DEFAULT);
                }}
              >
                {t("settings.reset")}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
