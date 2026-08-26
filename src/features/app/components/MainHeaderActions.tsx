import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import Construction from "lucide-react/dist/esm/icons/construction";
import Focus from "lucide-react/dist/esm/icons/focus";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard";
import BookOpen from "lucide-react/dist/esm/icons/book-open";
import Columns3 from "lucide-react/dist/esm/icons/columns-3";
import Globe from "lucide-react/dist/esm/icons/globe";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import PanelLeftOpen from "lucide-react/dist/esm/icons/panel-left-open";
import PanelRightClose from "lucide-react/dist/esm/icons/panel-right-close";
import PanelRightOpen from "lucide-react/dist/esm/icons/panel-right-open";
import TerminalSquare from "lucide-react/dist/esm/icons/terminal-square";
import type { OpenAppMenuExtraAction } from "./OpenAppMenu";
import type { SidebarToggleProps } from "../../layout/components/SidebarToggleControls";

type MainHeaderActionsOptions = {
  isCompact: boolean;
  rightPanelCollapsed: boolean;
  sidebarToggleProps: SidebarToggleProps;
  /** 各 action 悬停提示里展示的快捷键（formatShortcutForPlatform 后的展示值；空则不展示） */
  shortcutLabels?: {
    rightPanel?: string | null;
    terminal?: string | null;
    runtimeConsole?: string | null;
    browserDock?: string | null;
    fileCompare?: string | null;
  };
  showRuntimeConsoleButton?: boolean;
  isRuntimeConsoleVisible?: boolean;
  onToggleRuntimeConsole?: () => void;
  showTerminalButton?: boolean;
  isTerminalOpen?: boolean;
  onToggleTerminal?: () => void;
  showSoloButton?: boolean;
  isSoloMode?: boolean;
  onToggleSoloMode?: () => void;
  showSpecHubButton?: boolean;
  isSpecHubActive?: boolean;
  onOpenSpecHub?: () => void;
  isBrowserDockOpen?: boolean;
  onToggleBrowserDock?: () => void;
  showClientDocumentationButton?: boolean;
  onOpenClientDocumentation?: () => void;
  showFileCompareButton?: boolean;
  isFileCompareActive?: boolean;
  onOpenFileCompare?: () => void;
};

export function useMainHeaderActionItems({
  isCompact,
  rightPanelCollapsed,
  sidebarToggleProps,
  shortcutLabels,
  showRuntimeConsoleButton = false,
  isRuntimeConsoleVisible = false,
  onToggleRuntimeConsole,
  showTerminalButton = false,
  isTerminalOpen = false,
  onToggleTerminal,
  showSoloButton = false,
  isSoloMode = false,
  onToggleSoloMode,
  showSpecHubButton = false,
  isSpecHubActive = false,
  onOpenSpecHub,
  isBrowserDockOpen = false,
  onToggleBrowserDock,
  showClientDocumentationButton = false,
  onOpenClientDocumentation,
  showFileCompareButton = false,
  isFileCompareActive = false,
  onOpenFileCompare,
}: MainHeaderActionsOptions): OpenAppMenuExtraAction[] {
  const { t } = useTranslation();
  const {
    rightPanelAvailable = true,
    isLayoutSwapped = false,
    onCollapseRightPanel,
    onExpandRightPanel,
  } = sidebarToggleProps;

  return useMemo(() => {
    const withShortcut = (label: string, shortcut?: string | null) =>
      shortcut ? `${label} (${shortcut})` : label;
    const canToggleRuntimeConsole =
      showRuntimeConsoleButton && Boolean(onToggleRuntimeConsole);
    const canToggleTerminal = showTerminalButton && Boolean(onToggleTerminal);
    const canToggleSoloMode = showSoloButton && Boolean(onToggleSoloMode);
    const canToggleSpecHub = showSpecHubButton && Boolean(onOpenSpecHub);
    const canOpenClientDocumentation =
      showClientDocumentationButton && Boolean(onOpenClientDocumentation);
    const canOpenFileCompare = showFileCompareButton && Boolean(onOpenFileCompare);
    const canToggleBrowserDock = !isCompact && Boolean(onToggleBrowserDock);

    if (
      isCompact ||
      (!rightPanelAvailable &&
        !canToggleRuntimeConsole &&
        !canToggleTerminal &&
        !canToggleSoloMode &&
        !canToggleBrowserDock &&
        !canOpenFileCompare &&
        !canOpenClientDocumentation)
    ) {
      return [];
    }

    const isCollapsed = rightPanelCollapsed;
    const labelKey = isCollapsed ? "sidebar.showGitSidebar" : "sidebar.hideGitSidebar";
    const actionItems: OpenAppMenuExtraAction[] = [];

    if (canToggleRuntimeConsole) {
      actionItems.push({
        id: "runtime-console",
        label: withShortcut(
          t("files.openRunConsole"),
          shortcutLabels?.runtimeConsole,
        ),
        icon: <Construction size={18} aria-hidden />,
        onSelect: () => onToggleRuntimeConsole?.(),
        active: isRuntimeConsoleVisible,
      });
    }

    if (canToggleTerminal) {
      actionItems.push({
        id: "terminal",
        label: withShortcut(
          t("common.toggleTerminalPanel"),
          shortcutLabels?.terminal,
        ),
        icon: <TerminalSquare size={18} aria-hidden />,
        onSelect: () => onToggleTerminal?.(),
        active: isTerminalOpen,
      });
    }

    if (canToggleSoloMode) {
      actionItems.push({
        id: "solo-mode",
        label: t(isSoloMode ? "sidebar.exitSoloMode" : "sidebar.enterSoloMode"),
        icon: <Focus size={18} aria-hidden />,
        onSelect: () => onToggleSoloMode?.(),
        active: isSoloMode,
      });
    }

    if (canToggleBrowserDock) {
      actionItems.push({
        id: "browser-dock",
        label: withShortcut(
          t("browserAgent.dock.openDock"),
          shortcutLabels?.browserDock,
        ),
        icon: <Globe size={18} aria-hidden />,
        onSelect: () => onToggleBrowserDock?.(),
        active: isBrowserDockOpen,
      });
    }

    if (canToggleSpecHub) {
      actionItems.push({
        id: "spec-hub",
        label: t("sidebar.specHub"),
        icon: <LayoutDashboard size={18} aria-hidden />,
        onSelect: () => onOpenSpecHub?.(),
        active: isSpecHubActive,
      });
    }

    if (canOpenClientDocumentation) {
      actionItems.push({
        id: "client-documentation",
        label: t("clientDocumentation.open"),
        icon: <BookOpen size={18} aria-hidden />,
        onSelect: () => onOpenClientDocumentation?.(),
      });
    }

    if (canOpenFileCompare) {
      actionItems.push({
        id: "file-compare",
        label: withShortcut(
          t("files.fileCompare.title"),
          shortcutLabels?.fileCompare,
        ),
        icon: <Columns3 size={18} aria-hidden />,
        onSelect: () => onOpenFileCompare?.(),
        active: isFileCompareActive,
      });
    }

    if (rightPanelAvailable && !isSoloMode) {
      actionItems.push({
        id: "right-panel",
        label: withShortcut(t(labelKey), shortcutLabels?.rightPanel),
        icon: isCollapsed ? (
          isLayoutSwapped ? (
            <PanelLeftOpen size={18} aria-hidden />
          ) : (
            <PanelRightOpen size={18} aria-hidden />
          )
        ) : isLayoutSwapped ? (
          <PanelLeftClose size={18} aria-hidden />
        ) : (
          <PanelRightClose size={18} aria-hidden />
        ),
        onSelect: isCollapsed ? onExpandRightPanel : onCollapseRightPanel,
      });
    }

    return actionItems;
  }, [
    isBrowserDockOpen,
    isCompact,
    isLayoutSwapped,
    isFileCompareActive,
    isRuntimeConsoleVisible,
    isSoloMode,
    isSpecHubActive,
    isTerminalOpen,
    onCollapseRightPanel,
    onExpandRightPanel,
    onOpenClientDocumentation,
    onOpenFileCompare,
    onOpenSpecHub,
    onToggleBrowserDock,
    onToggleRuntimeConsole,
    onToggleSoloMode,
    onToggleTerminal,
    rightPanelAvailable,
    rightPanelCollapsed,
    shortcutLabels,
    showClientDocumentationButton,
    showFileCompareButton,
    showRuntimeConsoleButton,
    showSoloButton,
    showSpecHubButton,
    showTerminalButton,
    t,
  ]);
}
