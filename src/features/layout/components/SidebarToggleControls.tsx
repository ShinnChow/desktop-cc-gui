import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isWindowsPlatform } from "../../../utils/platform";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import PanelRightClose from "lucide-react/dist/esm/icons/panel-right-close";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import Search from "lucide-react/dist/esm/icons/search";
import GalleryVerticalEnd from "lucide-react/dist/esm/icons/gallery-vertical-end";
import { TooltipIconButton } from "../../../components/ui/tooltip-icon-button";
import { WindowsMainWindowCloseConfirmDialog } from "./WindowsMainWindowCloseConfirmDialog";
import {
  canOpenWindowsMainWindowCloseConfirm,
  performWindowsMainWindowClose,
} from "../utils/windowsMainWindowCloseConfirm";

export type SidebarToggleProps = {
  isCompact: boolean;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  isLayoutSwapped?: boolean;
  rightPanelAvailable?: boolean;
  showSidebarTitlebarToggle?: boolean;
  /** 悬停提示里展示的快捷键（formatShortcutForPlatform 后的用户实际绑定值；空则不展示） */
  sidebarShortcutLabel?: string | null;
  rightPanelShortcutLabel?: string | null;
  onCollapseSidebar: () => void;
  onExpandSidebar: () => void;
  onCollapseRightPanel: () => void;
  onExpandRightPanel: () => void;
};

export function SidebarCollapseButton({
  isCompact,
  sidebarCollapsed,
  isLayoutSwapped = false,
  sidebarShortcutLabel,
  onExpandSidebar,
  onCollapseSidebar,
}: SidebarToggleProps) {
  const { t } = useTranslation();
  if (isCompact) {
    return null;
  }
  const isCollapsed = sidebarCollapsed;
  const labelKey = isCollapsed ? "sidebar.showThreadsSidebar" : "sidebar.hideThreadsSidebar";
  const label = t(labelKey);
  const tooltip = sidebarShortcutLabel
    ? `${label} (${sidebarShortcutLabel})`
    : label;
  return (
    <TooltipIconButton
      className="ghost main-header-action"
      onClick={isCollapsed ? onExpandSidebar : onCollapseSidebar}
      data-tauri-drag-region="false"
      label={tooltip}
    >
      {isCollapsed ? (
        isLayoutSwapped ? <PanelRightOpen size={14} aria-hidden /> : <PanelLeftOpen size={14} aria-hidden />
      ) : (
        isLayoutSwapped ? <PanelRightClose size={14} aria-hidden /> : <PanelLeftClose size={14} aria-hidden />
      )}
    </TooltipIconButton>
  );
}

export function GlobalSearchTitlebarButton({
  onOpen,
  shortcutLabel,
}: {
  onOpen: () => void;
  shortcutLabel: string;
}) {
  const { t } = useTranslation();
  const label = t("sidebar.quickSearch");
  const tooltip = shortcutLabel ? `${label} (${shortcutLabel})` : label;
  return (
    <TooltipIconButton
      className="ghost main-header-action"
      onClick={onOpen}
      data-tauri-drag-region="false"
      label={tooltip}
    >
      <Search size={14} aria-hidden strokeWidth={1.8} />
    </TooltipIconButton>
  );
}

export function QuickSwitcherTitlebarButton({
  onOpen,
  shortcutLabel,
}: {
  onOpen: () => void;
  shortcutLabel: string;
}) {
  const { t } = useTranslation();
  const label = t("quickSwitcher.open");
  return (
    <TooltipIconButton
      className="ghost main-header-action"
      onClick={onOpen}
      data-tauri-drag-region="false"
      label={`${label} (${shortcutLabel})`}
    >
      <GalleryVerticalEnd size={14} aria-hidden strokeWidth={1.8} />
    </TooltipIconButton>
  );
}



function WindowControls() {
  const { t } = useTranslation();
  const [isMaximized, setIsMaximized] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const syncMaximizedState = useCallback(async () => {
    try {
      const maximized = await getCurrentWindow().isMaximized();
      setIsMaximized(maximized);
    } catch {
      // Window API may be unavailable in test environments.
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlistenResize: (() => void) | null = null;

    void syncMaximizedState();

    try {
      const win = getCurrentWindow();
      void win
        .onResized(() => {
          void syncMaximizedState();
        })
        .then((unlisten) => {
          if (disposed) {
            unlisten();
            return;
          }
          unlistenResize = unlisten;
        })
        .catch(() => {
          // Resize listener binding can fail in restricted contexts.
        });
    } catch {
      // Window access can fail in non-Tauri environments.
    }

    return () => {
      disposed = true;
      unlistenResize?.();
    };
  }, [syncMaximizedState]);

  const handleMinimize = useCallback(() => {
    try {
      void getCurrentWindow().minimize();
    } catch {
      // Ignore in non-Tauri environments.
    }
  }, []);

  const handleToggleMaximize = useCallback(async () => {
    try {
      const win = getCurrentWindow();
      await win.toggleMaximize();
      const maximized = await win.isMaximized();
      setIsMaximized(maximized);
    } catch {
      // Ignore in non-Tauri environments.
    }
  }, []);

  // Windows-only path (this component mounts only under windows-desktop chrome).
  // Custom dialog + isolated helpers; macOS hide-on-close / menus untouched.
  const handleCloseClick = useCallback(() => {
    if (
      !canOpenWindowsMainWindowCloseConfirm({
        isDialogOpen: closeConfirmOpen,
        isClosing,
      })
    ) {
      return;
    }
    setCloseConfirmOpen(true);
  }, [closeConfirmOpen, isClosing]);

  const handleCloseConfirmCancel = useCallback(() => {
    if (isClosing) {
      return;
    }
    setCloseConfirmOpen(false);
  }, [isClosing]);

  const handleCloseConfirmAccept = useCallback(async () => {
    if (isClosing) {
      return;
    }
    setIsClosing(true);
    try {
      await performWindowsMainWindowClose(() => getCurrentWindow().close());
    } finally {
      // If close succeeded the host unloads; if not, re-enable UI.
      setIsClosing(false);
      setCloseConfirmOpen(false);
    }
  }, [isClosing]);

  const maximizeLabel = isMaximized ? t("common.restore") : t("menu.maximize");

  return (
    <>
      <div className="titlebar-toggle titlebar-toggle-right titlebar-window-controls">
        <button
          type="button"
          className="titlebar-window-button"
          onClick={handleMinimize}
          data-tauri-drag-region="false"
          aria-label={t("menu.minimize")}
          title={t("menu.minimize")}
        >
          <span
            className="codicon codicon-chrome-minimize titlebar-window-glyph"
            aria-hidden
          />
        </button>
        <button
          type="button"
          className="titlebar-window-button"
          onClick={() => {
            void handleToggleMaximize();
          }}
          data-tauri-drag-region="false"
          aria-label={maximizeLabel}
          title={maximizeLabel}
        >
          <span
            className={`codicon ${
              isMaximized ? "codicon-chrome-restore" : "codicon-chrome-maximize"
            } titlebar-window-glyph`}
            aria-hidden
          />
        </button>
        <button
          type="button"
          className="titlebar-window-button titlebar-window-button-close"
          onClick={handleCloseClick}
          data-tauri-drag-region="false"
          aria-label={t("menu.closeWindow")}
          title={t("menu.closeWindow")}
          aria-haspopup="dialog"
          aria-expanded={closeConfirmOpen}
          disabled={isClosing}
        >
          <span
            className="codicon codicon-chrome-close titlebar-window-glyph"
            aria-hidden
          />
        </button>
      </div>
      <WindowsMainWindowCloseConfirmDialog
        open={closeConfirmOpen}
        isClosing={isClosing}
        onCancel={handleCloseConfirmCancel}
        onConfirm={handleCloseConfirmAccept}
      />
    </>
  );
}

export function TitlebarExpandControls({
  showSidebarTitlebarToggle = false,
  ...sidebarToggleProps
}: SidebarToggleProps) {
  const isWindowsDesktop = useMemo(() => isWindowsPlatform(), []);

  if (!isWindowsDesktop && !showSidebarTitlebarToggle) {
    return null;
  }

  return (
    <div className="titlebar-controls">
      {showSidebarTitlebarToggle ? (
        <div
          className={`titlebar-toggle ${
            sidebarToggleProps.isLayoutSwapped
              ? "titlebar-toggle-right"
              : "titlebar-toggle-left"
          } titlebar-sidebar-toggle`}
        >
          <SidebarCollapseButton {...sidebarToggleProps} />
        </div>
      ) : null}
      {isWindowsDesktop ? <WindowControls /> : null}
    </div>
  );
}
