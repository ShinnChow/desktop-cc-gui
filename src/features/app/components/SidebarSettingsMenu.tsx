import Brain from "lucide-react/dist/esm/icons/brain";
import CircleAlert from "lucide-react/dist/esm/icons/circle-alert";
import CircleCheck from "lucide-react/dist/esm/icons/circle-check";
import GitCommitHorizontal from "lucide-react/dist/esm/icons/git-commit-horizontal";
import LayoutDashboard from "lucide-react/dist/esm/icons/layout-dashboard";
import Lock from "lucide-react/dist/esm/icons/lock";
import PanelLeftClose from "lucide-react/dist/esm/icons/panel-left-close";
import Settings from "lucide-react/dist/esm/icons/settings";
import type { ReactNode, RefObject } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AppMode } from "../../../types";
import {
  SIDEBAR_SETTINGS_PINNED_MAX,
  useSidebarSettingsPinnedActions,
  type SidebarSettingsPinnedActionId,
} from "../hooks/useSidebarSettingsPinnedActions";

type SidebarSettingsMenuProps = {
  isOpen: boolean;
  appMode: AppMode;
  menuRef: RefObject<HTMLDivElement | null>;
  buttonRef: RefObject<HTMLButtonElement | null>;
  t: (key: string) => string;
  onToggleOpen: () => void;
  onClose: () => void;
  onLockPanel?: () => void;
  onOpenSpecHub: () => void;
  onOpenProjectMemory: () => void;
  onOpenSettings: () => void;
  onAppModeChange: (mode: AppMode) => void;
  /** 打开侧栏运行时提示面板（入口已收入设置二级菜单，不再外显） */
  onOpenRuntimeNotice?: () => void;
  /** 是否展示运行时提示菜单项（受 clientUiVisibility 控制） */
  showRuntimeNotice?: boolean;
  /**
   * 运行时提示是否有失败项。入口迁到设置菜单/固定旁栏后仍需切换对号↔叹号，
   * 与 GlobalRuntimeNoticeDock 最小化气泡的 has-error 语义一致。
   */
  runtimeNoticeHasError?: boolean;
  /** non-macOS：设置菜单「隐藏对话侧边栏」；mac 用 titlebar */
  showHideThreadsSidebar?: boolean;
  onCollapseSidebar?: () => void;
  /** 设置齿轮悬停提示里展示的快捷键（formatShortcutForPlatform 后的展示值；空则不展示） */
  openSettingsShortcutLabel?: string | null;
};

type SettingsMenuAction = {
  id: SidebarSettingsPinnedActionId;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  active?: boolean;
  visible: boolean;
};

export function SidebarSettingsMenu({
  isOpen,
  appMode,
  menuRef,
  buttonRef,
  t,
  onToggleOpen,
  onClose,
  onLockPanel,
  onOpenSpecHub,
  onOpenProjectMemory,
  onOpenSettings,
  onAppModeChange,
  onOpenRuntimeNotice,
  showRuntimeNotice = false,
  runtimeNoticeHasError = false,
  showHideThreadsSidebar = false,
  onCollapseSidebar,
  openSettingsShortcutLabel,
}: SidebarSettingsMenuProps) {
  const { pinnedIds, togglePinned } = useSidebarSettingsPinnedActions();
  const atPinLimit = pinnedIds.length >= SIDEBAR_SETTINGS_PINNED_MAX;
  const runtimeNoticeIcon = runtimeNoticeHasError ? (
    <CircleAlert
      size={14}
      aria-hidden
      className="sidebar-settings-runtime-notice-icon is-has-error"
    />
  ) : (
    <CircleCheck
      size={14}
      aria-hidden
      className="sidebar-settings-runtime-notice-icon is-idle"
    />
  );
  const showHideThreads = Boolean(showHideThreadsSidebar && onCollapseSidebar);

  const actions: SettingsMenuAction[] = [
    {
      id: "lock",
      label: t("lockScreen.lock"),
      icon: <Lock size={14} aria-hidden />,
      onSelect: () => {
        onClose();
        onLockPanel?.();
      },
      visible: true,
    },
    {
      id: "spec-hub",
      label: t("sidebar.specHub"),
      icon: <LayoutDashboard size={14} aria-hidden />,
      onSelect: () => {
        onClose();
        onOpenSpecHub();
      },
      visible: true,
    },
    {
      id: "project-memory",
      label: t("panels.memory"),
      icon: <Brain size={14} aria-hidden />,
      onSelect: () => {
        onClose();
        onOpenProjectMemory();
      },
      visible: true,
    },
    {
      id: "git-history",
      label: t("git.historyQuickAction"),
      icon: <GitCommitHorizontal size={14} aria-hidden />,
      onSelect: () => {
        onClose();
        onAppModeChange(appMode === "gitHistory" ? "chat" : "gitHistory");
      },
      active: appMode === "gitHistory",
      visible: true,
    },
    {
      id: "runtime-notice",
      label: t("runtimeNotice.title"),
      icon: runtimeNoticeIcon,
      onSelect: () => {
        onClose();
        onOpenRuntimeNotice?.();
      },
      visible: Boolean(showRuntimeNotice && onOpenRuntimeNotice),
    },
  ];

  const visibleActions = actions.filter((action) => action.visible);
  const pinnedActions = pinnedIds
    .map((id) => visibleActions.find((action) => action.id === id))
    .filter((action): action is SettingsMenuAction => Boolean(action));

  const pinLabel = t("common.showBesideSettings");
  const pinLimitLabel = t("common.showBesideSettingsLimit");

  return (
    <div className="sidebar-settings-cluster">
      <div className="sidebar-settings-dropdown-wrapper">
        {isOpen && (
          <div
            className="sidebar-settings-dropdown"
            ref={menuRef}
            role="menu"
          >
            {showHideThreads ? (
              <button
                type="button"
                role="menuitem"
                className="sidebar-settings-dropdown-item"
                onClick={() => {
                  onClose();
                  onCollapseSidebar?.();
                }}
              >
                <PanelLeftClose size={14} aria-hidden />
                <span>{t("sidebar.hideThreadsSidebar")}</span>
              </button>
            ) : null}
            {visibleActions.map((action) => {
              const pinned = pinnedIds.includes(action.id);
              const pinDisabled = !pinned && atPinLimit;
              const pinCheckbox = (
                <input
                  type="checkbox"
                  className="sidebar-settings-dropdown-pin"
                  checked={pinned}
                  disabled={pinDisabled}
                  onChange={() => {
                    if (pinDisabled) {
                      return;
                    }
                    togglePinned(action.id);
                  }}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                  }}
                  aria-label={pinDisabled ? pinLimitLabel : pinLabel}
                  // disabled 的 input 多数浏览器不触发 title；可达时仍用原生 tip
                  title={pinDisabled ? undefined : pinLabel}
                  data-tauri-drag-region="false"
                />
              );
              return (
                <div
                  key={action.id}
                  className={`sidebar-settings-dropdown-option${
                    action.active ? " is-active" : ""
                  }`}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className={`sidebar-settings-dropdown-item${
                      action.active ? " is-active" : ""
                    }`}
                    onClick={action.onSelect}
                  >
                    {action.icon}
                    <span>{action.label}</span>
                  </button>
                  {pinDisabled ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="sidebar-settings-dropdown-pin-wrap is-disabled"
                          // 包一层可接收 hover/focus：disabled checkbox 本身不会弹出 tip
                          tabIndex={0}
                          title={pinLimitLabel}
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          onMouseDown={(event) => {
                            event.stopPropagation();
                          }}
                        >
                          {pinCheckbox}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right" sideOffset={8}>
                        {pinLimitLabel}
                      </TooltipContent>
                    </Tooltip>
                  ) : (
                    pinCheckbox
                  )}
                </div>
              );
            })}
            <button
              type="button"
              role="menuitem"
              className="sidebar-settings-dropdown-item"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
            >
              <Settings size={14} aria-hidden />
              <span>{t("settings.title")}</span>
            </button>
          </div>
        )}
        <button
          ref={buttonRef}
          type="button"
          className={`sidebar-primary-nav-item sidebar-primary-nav-item-bottom${isOpen ? " is-active" : ""}`}
          onClick={onToggleOpen}
          title={
            openSettingsShortcutLabel
              ? `${t("settings.title")} (${openSettingsShortcutLabel})`
              : t("settings.title")
          }
          aria-label={t("settings.title")}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          data-tauri-drag-region="false"
        >
          <Settings className="sidebar-primary-nav-icon" aria-hidden />
        </button>
      </div>
      {pinnedActions.length > 0 ? (
        <div className="sidebar-settings-pinned" role="toolbar" aria-label={pinLabel}>
          {pinnedActions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`sidebar-primary-nav-item sidebar-primary-nav-item-bottom sidebar-settings-pinned-item${
                action.active ? " is-active" : ""
              }${
                action.id === "runtime-notice" && runtimeNoticeHasError
                  ? " is-runtime-notice-error"
                  : ""
              }`}
              onClick={action.onSelect}
              title={action.label}
              aria-label={action.label}
              aria-pressed={action.active}
              data-tauri-drag-region="false"
              data-runtime-notice-status={
                action.id === "runtime-notice"
                  ? runtimeNoticeHasError
                    ? "has-error"
                    : "idle"
                  : undefined
              }
            >
              <span className="sidebar-primary-nav-icon" aria-hidden>
                {action.icon}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
