import Check from "lucide-react/dist/esm/icons/check";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import RefreshCw from "lucide-react/dist/esm/icons/refresh-cw";
import X from "lucide-react/dist/esm/icons/x";
import { useCallback, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { WorkspaceInfo } from "../../../types";
import type {
  WorkspaceMenuAction,
  WorkspaceMenuGroup,
} from "../hooks/useSidebarMenus";
import {
  readSidebarWorkspaceMenuCollapsedSectionIds,
  toggleSidebarWorkspaceMenuCollapsedSectionId,
} from "../hooks/useSidebarWorkspaceMenuSectionCollapse";

/** 侧栏可被 layout-swapped 挪到右侧；抽屉跟随侧栏所在侧滑出。 */
function isSwappedSidebarLayout(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return Boolean(document.querySelector(".app.layout-swapped"));
}

/** Windows 宿主：右上角是最小化/关闭的 web 内窗口控件，swapped 抽屉需避让。 */
function isWindowsDesktopHost(): boolean {
  if (typeof document === "undefined") {
    return false;
  }
  return Boolean(document.querySelector(".app.windows-desktop"));
}

/**
 * 抽屉宽度跟随侧栏实际宽度（--sidebar-width 设在 .app 上，portal 到 body
 * 的抽屉读不到 CSS 变量，打开时量一次实测值注入）。量不到时回退 CSS 默认。
 */
function measureSidebarFitWidth(): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const rect = document.querySelector("aside.sidebar")?.getBoundingClientRect();
  return rect && rect.width > 0 ? `${Math.round(rect.width)}px` : null;
}

type SidebarWorkspaceMenuOverlayProps = {
  menu: {
    x: number;
    y: number;
    groups: WorkspaceMenuGroup[];
    workspace?: WorkspaceInfo;
  };
  t: (key: string) => string;
  onClose: () => void;
  onAction: (action: WorkspaceMenuAction) => void;
  renderIcon: (iconKind: string) => ReactNode;
};

type SidebarWorkspaceSubmenuPosition = {
  x: number;
  y: number;
};

const SUBMENU_WIDTH = 260;
const SUBMENU_MAX_HEIGHT = 640;
const SUBMENU_GAP = 0;
const SUBMENU_PADDING_Y = 12;
const SUBMENU_ITEM_HEIGHT = 34;
const SUBMENU_TITLE_HEIGHT = 26;
const VIEWPORT_PADDING = 12;

function estimateWorkspaceSubmenuHeight(action: WorkspaceMenuAction) {
  const itemCount = action.children?.length ?? 0;
  const titleHeight = action.submenuTitle ? SUBMENU_TITLE_HEIGHT : 0;
  return Math.min(
    SUBMENU_MAX_HEIGHT,
    SUBMENU_PADDING_Y + titleHeight + itemCount * SUBMENU_ITEM_HEIGHT,
  );
}

function resolveWorkspaceSubmenuPosition(
  triggerRect: DOMRect,
  menuRect: DOMRect,
  submenuHeight: number,
): SidebarWorkspaceSubmenuPosition {
  if (typeof window === "undefined") {
    return {
      x: menuRect.right + SUBMENU_GAP,
      y: triggerRect.top,
    };
  }

  const maxRightX = window.innerWidth - SUBMENU_WIDTH - VIEWPORT_PADDING;
  const rightX = menuRect.right + SUBMENU_GAP;
  const leftX = menuRect.left - SUBMENU_WIDTH - SUBMENU_GAP;
  const shouldOpenRight = rightX <= maxRightX || leftX < VIEWPORT_PADDING;
  const x = shouldOpenRight
    ? Math.min(Math.max(rightX, VIEWPORT_PADDING), Math.max(VIEWPORT_PADDING, maxRightX))
    : Math.max(leftX, VIEWPORT_PADDING);
  const maxY = window.innerHeight - submenuHeight - VIEWPORT_PADDING;
  const y = Math.min(
    Math.max(triggerRect.top, VIEWPORT_PADDING),
    Math.max(VIEWPORT_PADDING, maxY),
  );

  return { x, y };
}

export function SidebarWorkspaceMenuOverlay({
  menu,
  t,
  onClose,
  onAction,
  renderIcon,
}: SidebarWorkspaceMenuOverlayProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [openSubmenuId, setOpenSubmenuId] = useState<string | null>(null);
  const [submenuPosition, setSubmenuPosition] =
    useState<SidebarWorkspaceSubmenuPosition | null>(null);
  const [showSelectionHint, setShowSelectionHint] = useState(false);
  // 「?」长说明走 portal 浮层：fixed 定位靠 ? 右侧弹出，不被抽屉/弹窗 overflow 裁剪。
  const [floatingHelpTip, setFloatingHelpTip] = useState<{
    text: string;
    x: number;
    y: number;
  } | null>(null);

  const openFloatingHelpTip = useCallback(
    (text: string, anchor: HTMLElement) => {
      const rect = anchor.getBoundingClientRect();
      const tipWidth = 264;
      const margin = 8;
      let x = rect.right + margin;
      if (
        typeof window !== "undefined" &&
        x + tipWidth > window.innerWidth - 8
      ) {
        x = Math.max(8, rect.left - margin - tipWidth);
      }
      const y =
        typeof window !== "undefined"
          ? Math.min(Math.max(rect.top - 6, 8), window.innerHeight - 140)
          : rect.top;
      setFloatingHelpTip({ text, x, y });
    },
    [],
  );
  // 折叠态本地持久化：初始 = 用户上次折起 ∩ 本菜单可折叠分组（默认全部展开）。
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => {
      const collapsedIds = new Set(readSidebarWorkspaceMenuCollapsedSectionIds());
      return new Set(
        menu.groups
          .filter(
            (group) =>
              group.collapsible &&
              (group.defaultCollapsed || collapsedIds.has(group.id)),
          )
          .map((group) => group.id),
      );
    },
  );

  const openSubmenuAction = useMemo(
    () =>
      menu.groups
        .flatMap((group) => group.actions)
        .find(
          (action) =>
            action.id === openSubmenuId && Boolean(action.children?.length),
        ) ?? null,
    [menu.groups, openSubmenuId],
  );

  const closeSubmenu = useCallback(() => {
    setOpenSubmenuId(null);
    setSubmenuPosition(null);
    setShowSelectionHint(false);
  }, []);

  const openSubmenu = useCallback((action: WorkspaceMenuAction, trigger: HTMLElement) => {
    if (!action.children?.length) {
      closeSubmenu();
      return;
    }

    setShowSelectionHint((prev) => (openSubmenuId === action.id ? prev : false));
    setSubmenuPosition(
      resolveWorkspaceSubmenuPosition(
        trigger.getBoundingClientRect(),
        menuRef.current?.getBoundingClientRect() ?? trigger.getBoundingClientRect(),
        estimateWorkspaceSubmenuHeight(action),
      ),
    );
    setOpenSubmenuId(action.id);
  }, [closeSubmenu, openSubmenuId]);

  const handleAction = useCallback(
    (action: WorkspaceMenuAction, trigger: HTMLElement) => {
      if (action.children?.length) {
        openSubmenu(action, trigger);
        if (action.unavailable || action.submenuOnly) {
          return;
        }
      } else if (action.unavailable) {
        return;
      }
      closeSubmenu();
      onAction(action);
    },
    [closeSubmenu, onAction, openSubmenu],
  );

  const toggleGroup = useCallback(
    (groupId: string) => {
      closeSubmenu();
      // 持久化先于 setState 且在 updater 外执行：updater 必须保持纯函数，
      // 否则 StrictMode/concurrent 重放 updater 会把存储来回翻转两次。
      const nextCollapsedIds = toggleSidebarWorkspaceMenuCollapsedSectionId(
        groupId,
      );
      setCollapsedGroupIds(new Set(nextCollapsedIds));
    },
    [closeSubmenu],
  );

  const hasSessionActions = useMemo(
    () =>
      menu.groups.some(
        (group) =>
          group.id === "new-session" || group.id === "new-session-shared",
      ),
    [menu.groups],
  );
  const baseTitle = hasSessionActions
    ? t("sidebar.sessionActionsGroup")
    : t("sidebar.workspaceActionsGroup");
  // 标题点明所属工作区，避免多项目时不知道这次新建落在哪里。
  const workspaceName = menu.workspace?.name?.trim() || null;
  const drawerTitle = workspaceName
    ? `${baseTitle} · ${workspaceName}`
    : baseTitle;
  // 每次渲染重测成本极低（一次 querySelector+gBCR），菜单生命周期内渲染稀疏。
  const sidebarFitWidth = measureSidebarFitWidth();

  const overlay = (
    <div
      className="sidebar-workspace-menu-backdrop sidebar-workspace-drawer-backdrop"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        ref={menuRef}
        className={`sidebar-workspace-drawer${
          isSwappedSidebarLayout() ? " is-swapped" : ""
        }${isWindowsDesktopHost() ? " is-windows" : ""}`}
        role="menu"
        aria-label={drawerTitle}
        style={
          sidebarFitWidth
            ? ({ "--sidebar-drawer-fit-width": sidebarFitWidth } as CSSProperties)
            : undefined
        }
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <header className="sidebar-workspace-drawer-header">
          <span className="sidebar-workspace-drawer-title">{drawerTitle}</span>
          <button
            type="button"
            className="sidebar-workspace-drawer-close"
            onClick={onClose}
            aria-label={t("common.close")}
            title={t("common.close")}
            data-tauri-drag-region="false"
          >
            <X size={16} aria-hidden />
          </button>
        </header>
        <div className="sidebar-workspace-drawer-body">
        {menu.groups.map((group, groupIndex) => {
          const isCollapsed =
            Boolean(group.collapsible) && collapsedGroupIds.has(group.id);
          const groupContentId = `sidebar-workspace-menu-group-${group.id}`;

          return (
            <div className="sidebar-workspace-menu-group" key={group.id}>
              {group.collapsible ? (
                <button
                  type="button"
                  className="sidebar-workspace-menu-group-title sidebar-workspace-menu-group-toggle"
                  aria-expanded={!isCollapsed}
                  aria-controls={groupContentId}
                  onClick={() => toggleGroup(group.id)}
                >
                  <span>
                    {group.label}
                    {group.hint ? (
                      <span className="sidebar-workspace-menu-group-hint">
                        {group.hint}
                      </span>
                    ) : null}
                    {group.helpTip ? (
                      <span
                        className="sidebar-workspace-menu-group-help"
                        role="img"
                        aria-label={group.helpTip}
                        onMouseEnter={(event) =>
                          openFloatingHelpTip(
                            group.helpTip!,
                            event.currentTarget,
                          )
                        }
                        onMouseLeave={() => setFloatingHelpTip(null)}
                        onClick={(event) => event.stopPropagation()}
                      >
                        ?
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight
                    className={`sidebar-workspace-menu-group-chevron${
                      isCollapsed ? "" : " is-expanded"
                    }`}
                    size={13}
                    aria-hidden
                  />
                </button>
              ) : (
                <div className="sidebar-workspace-menu-group-title">
                  {group.label}
                  {group.hint ? (
                    <span className="sidebar-workspace-menu-group-hint">
                      {group.hint}
                    </span>
                  ) : null}
                  {group.helpTip ? (
                    <span
                      className="sidebar-workspace-menu-group-help"
                      role="img"
                      aria-label={group.helpTip}
                      onMouseEnter={(event) =>
                        openFloatingHelpTip(group.helpTip!, event.currentTarget)
                      }
                      onMouseLeave={() => setFloatingHelpTip(null)}
                    >
                      ?
                    </span>
                  ) : null}
                </div>
              )}
              <div id={groupContentId} hidden={isCollapsed}>
                {!isCollapsed
                  ? group.actions.map((action) => (
                    <div
                      className="sidebar-workspace-menu-item-row"
                      key={action.id}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className={`sidebar-workspace-menu-item${
                          action.tone === "danger" ? " is-danger" : ""
                        }${action.deprecated ? " is-deprecated" : ""}${
                          action.unavailable ? " is-unavailable" : ""
                        }`}
                        disabled={
                          action.unavailable && !action.children?.length
                        }
                        aria-haspopup={
                          action.children?.length ? "menu" : undefined
                        }
                        aria-expanded={
                          action.children?.length
                            ? openSubmenuId === action.id
                            : undefined
                        }
                        onMouseEnter={(event) => {
                          if (action.children?.length) {
                            openSubmenu(action, event.currentTarget);
                            return;
                          }
                          closeSubmenu();
                        }}
                        onKeyDown={(event) => {
                          // Keyboard path to the submenu the aria-haspopup promises;
                          // hover remains the pointer path.
                          if (
                            event.key === "ArrowRight" &&
                            action.children?.length
                          ) {
                            event.preventDefault();
                            openSubmenu(action, event.currentTarget);
                          }
                        }}
                        onClick={(event) =>
                          handleAction(action, event.currentTarget)
                        }
                      >
                        <span
                          className={`sidebar-workspace-menu-item-icon sidebar-workspace-menu-item-icon-${action.iconKind}${
                            action.unavailable ? " is-unavailable" : ""
                          }`}
                          aria-hidden
                        >
                          {renderIcon(action.iconKind)}
                        </span>
                        <span className="sidebar-workspace-menu-item-label">
                          {action.label}
                        </span>
                        {action.deprecated ? (
                          <span className="sidebar-workspace-menu-item-deprecated">
                            ({t("sidebar.deprecatedTag")})
                          </span>
                        ) : null}
                        {action.unavailable ? (
                          <span className="sidebar-workspace-menu-item-unavailable">
                            ({action.statusLabel ?? t("sidebar.unavailableTag")})
                          </span>
                        ) : null}
                        {action.selectedChildLabel ? (
                          <span
                            className="sidebar-workspace-menu-item-provider"
                            aria-hidden
                          >
                            {action.selectedChildLabel}
                          </span>
                        ) : null}
                        {action.children?.length ? (
                          <ChevronRight
                            className="sidebar-workspace-menu-item-submenu-icon"
                            size={13}
                            aria-hidden
                          />
                        ) : null}
                      </button>
                      {action.refreshable ? (
                        <button
                          type="button"
                          className={`sidebar-workspace-menu-item-refresh${
                            action.refreshing ? " is-refreshing" : ""
                          }`}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onPointerDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void action.onRefresh?.();
                          }}
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          aria-label={t("common.refresh")}
                          title={t("common.refresh")}
                          data-tauri-drag-region="false"
                          disabled={action.refreshing}
                        >
                          <RefreshCw size={13} aria-hidden />
                        </button>
                      ) : null}
                      {action.pinnable && action.onTogglePinned ? (
                        <input
                          type="checkbox"
                          className="sidebar-workspace-menu-item-pin"
                          checked={action.pinned ?? false}
                          onMouseDown={(event) => {
                            event.stopPropagation();
                          }}
                          onPointerDown={(event) => {
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                          }}
                          onChange={() => {
                            action.onTogglePinned?.();
                          }}
                          aria-label={t("common.showOnWorkspaceRow")}
                          title={t("common.showOnWorkspaceRow")}
                          data-tauri-drag-region="false"
                        />
                      ) : null}
                    </div>
                  ))
                  : null}
              </div>
              {groupIndex < menu.groups.length - 1 ? (
                <div className="sidebar-workspace-menu-divider" aria-hidden />
              ) : null}
            </div>
          );
        })}
        </div>
      </div>
      {floatingHelpTip ? (
        <div
          className="sidebar-floating-help-tip"
          role="tooltip"
          style={{
            left: floatingHelpTip.x,
            top: floatingHelpTip.y,
          }}
        >
          {floatingHelpTip.text}
        </div>
      ) : null}
      {openSubmenuAction?.children?.length && submenuPosition ? (
        <div
          className="sidebar-workspace-submenu"
          role="menu"
          aria-label={openSubmenuAction.label}
          style={{
            "--sidebar-workspace-submenu-x": `${submenuPosition.x}px`,
            "--sidebar-workspace-submenu-y": `${submenuPosition.y}px`,
          } as CSSProperties}
          onMouseDown={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          {openSubmenuAction.submenuTitle ? (
            <div className="sidebar-workspace-submenu-title">
              {openSubmenuAction.submenuTitle}
              {openSubmenuAction.submenuHelpTip ? (
                <span
                  className="sidebar-workspace-menu-group-help"
                  role="img"
                  aria-label={openSubmenuAction.submenuHelpTip}
                  onMouseEnter={(event) =>
                    openFloatingHelpTip(
                      openSubmenuAction.submenuHelpTip!,
                      event.currentTarget,
                    )
                  }
                  onMouseLeave={() => setFloatingHelpTip(null)}
                >
                  ?
                </span>
              ) : null}
            </div>
          ) : null}
          {openSubmenuAction.children.map((child) => (
            <button
              key={child.id}
              type="button"
              role="menuitemradio"
              aria-checked={child.selected ?? false}
              className={`sidebar-workspace-menu-item${
                child.unavailable ? " is-unavailable" : ""
              }`}
              disabled={child.unavailable}
              onClick={() => {
                onAction(child);
                setShowSelectionHint(Boolean(child.keepMenuOpen));
              }}
            >
              <span
                className={`sidebar-workspace-menu-item-icon sidebar-workspace-menu-item-icon-${child.iconKind}${
                  child.unavailable ? " is-unavailable" : ""
                }`}
                aria-hidden
              >
                {renderIcon(child.iconKind)}
              </span>
              <span className="sidebar-workspace-menu-item-label">
                {child.label}
              </span>
              {child.badgeLabel ? (
                <span className="sidebar-workspace-menu-item-badge">
                  {child.badgeLabel}
                </span>
              ) : null}
              {child.selected ? (
                <Check
                  className="sidebar-workspace-menu-item-check"
                  size={13}
                  aria-hidden
                />
              ) : null}
              {child.unavailable ? (
                <span className="sidebar-workspace-menu-item-unavailable">
                  ({child.statusLabel ?? t("sidebar.unavailableTag")})
                </span>
              ) : null}
            </button>
          ))}
          {showSelectionHint && openSubmenuAction.selectionHint ? (
            <div className="sidebar-workspace-submenu-hint" role="status">
              {openSubmenuAction.selectionHint}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  if (typeof document === "undefined") {
    return overlay;
  }

  return createPortal(overlay, document.body);
}
