import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import SquareMenu from "lucide-react/dist/esm/icons/square-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { TooltipIconButton } from "./tooltip-icon-button";

export type ResponsiveIconToolbarItem = {
  id: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  buttonClassName?: string;
  iconClassName?: string;
  menuItemClassName?: string;
  priority?: number;
  keepVisible?: boolean;
  pinToEnd?: boolean;
  /** true 时选中后不外显到工具栏（一次性动作项，如打开新窗口） */
  noPromote?: boolean;
  /** pin 模式下：false 时该行不显示外显勾选框（一次性动作项） */
  pinnable?: boolean;
  ariaCurrent?: "page" | "step" | "location" | "date" | "time" | true;
};

type ResponsiveIconToolbarProps = {
  items: ResponsiveIconToolbarItem[];
  className: string;
  overflowLabel: string;
  ariaLabel?: string;
  role?: string;
  itemWidth?: number;
  overflowButtonWidth?: number;
  minVisibleItems?: number;
  maxVisibleItems?: number;
  collapseInactiveItems?: boolean;
  /** 溢出触发器图标，缺省用 SquareMenu */
  overflowIcon?: ReactNode;
  /** 提供 onTogglePin 即进入 pin 模式：溢出菜单展示全部条目并带外显勾选框 */
  pinnedIds?: readonly string[];
  onTogglePin?: (id: string) => void;
  pinToggleLabel?: string;
};

const EMPTY_PINNED_IDS: readonly string[] = [];

function sortByVisibilityPriority(
  items: ResponsiveIconToolbarItem[],
  originalIndexById: Map<string, number>,
  promotedItemId: string | null,
) {
  return [...items].sort((left, right) => {
    if (left.id === promotedItemId || right.id === promotedItemId) {
      return left.id === promotedItemId ? -1 : 1;
    }
    if (left.keepVisible !== right.keepVisible) {
      return left.keepVisible ? -1 : 1;
    }
    const priorityDiff = (left.priority ?? 50) - (right.priority ?? 50);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    return (originalIndexById.get(left.id) ?? 0) - (originalIndexById.get(right.id) ?? 0);
  });
}

export function splitToolbarItems(
  items: ResponsiveIconToolbarItem[],
  visibleLimit: number,
  promotedItemId: string | null,
  collapseInactiveItems: boolean,
) {
  if (collapseInactiveItems) {
    // 想外显的项：激活/临时置顶 + 用户勾选常驻
    const preferredVisible = items.filter(
      (item) => item.keepVisible || item.id === promotedItemId,
    );
    // 宽度放得下就全部外显（维持宽面板下的既有行为）；放不下时按优先级裁剪，
    // 激活项永远保留，其余超出容器的项挪进「更多」菜单，避免顶栏图标挤压重叠。
    const keptIds =
      preferredVisible.length > visibleLimit
        ? new Set(
            [...preferredVisible]
              .sort((left, right) => {
                const leftTop =
                  left.id === promotedItemId || left.ariaCurrent != null;
                const rightTop =
                  right.id === promotedItemId || right.ariaCurrent != null;
                if (leftTop !== rightTop) {
                  return leftTop ? -1 : 1;
                }
                return (left.priority ?? 50) - (right.priority ?? 50);
              })
              .slice(0, Math.max(0, visibleLimit))
              .map((item) => item.id),
          )
        : new Set(preferredVisible.map((item) => item.id));

    return {
      visibleItems: items.filter((item) => keptIds.has(item.id)),
      overflowItems: items.filter((item) => !keptIds.has(item.id)),
    };
  }

  if (visibleLimit >= items.length) {
    return {
      visibleItems: items,
      overflowItems: [],
    };
  }

  const originalIndexById = new Map(items.map((item, index) => [item.id, index]));
  const selectedIds = new Set(
    sortByVisibilityPriority(items, originalIndexById, promotedItemId)
      .slice(0, Math.max(0, visibleLimit))
      .map((item) => item.id),
  );

  return {
    visibleItems: items.filter((item) => selectedIds.has(item.id)),
    overflowItems: items.filter((item) => !selectedIds.has(item.id)),
  };
}

export function ResponsiveIconToolbar({
  items,
  className,
  overflowLabel,
  ariaLabel,
  role,
  itemWidth = 31,
  overflowButtonWidth = 32,
  minVisibleItems = 1,
  maxVisibleItems,
  collapseInactiveItems = false,
  overflowIcon,
  pinnedIds = EMPTY_PINNED_IDS,
  onTogglePin,
  pinToggleLabel,
}: ResponsiveIconToolbarProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [promotedItemId, setPromotedItemId] = useState<string | null>(null);
  const pinMode = typeof onTogglePin === "function";

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }

    setContainerWidth(Math.floor(root.clientWidth));

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? root.clientWidth;
      setContainerWidth(Math.floor(width));
    });
    observer.observe(root);

    return () => observer.disconnect();
  }, []);

  const visibleLimit = useMemo(() => {
    if (containerWidth <= 0 || items.length <= minVisibleItems) {
      return items.length;
    }

    const reservedWidth = containerWidth < items.length * itemWidth ? overflowButtonWidth : 0;
    const nextLimit = Math.floor((containerWidth - reservedWidth) / itemWidth);
    const widthLimited = Math.max(minVisibleItems, Math.min(items.length, nextLimit));
    return typeof maxVisibleItems === "number"
      ? Math.min(widthLimited, Math.max(minVisibleItems, maxVisibleItems))
      : widthLimited;
  }, [containerWidth, itemWidth, items.length, maxVisibleItems, minVisibleItems, overflowButtonWidth]);

  const { visibleItems, overflowItems } = useMemo(
    () => splitToolbarItems(items, visibleLimit, promotedItemId, collapseInactiveItems),
    [collapseInactiveItems, items, promotedItemId, visibleLimit],
  );
  const leadingVisibleItems = visibleItems.filter((item) => !item.pinToEnd);
  const pinnedVisibleItems = visibleItems.filter((item) => item.pinToEnd);
  // pin 模式下溢出菜单展示全部条目（含已外显项，便于取消勾选）；否则只展示被折叠项
  const overflowMenuItems = pinMode ? items : overflowItems;
  const showOverflowTrigger = pinMode
    ? items.length > 0
    : overflowItems.length > 0;

  const selectItem = (item: ResponsiveIconToolbarItem) => {
    // pin 模式改为显式勾选外显，不再点击后临时置顶
    if (!pinMode && !item.noPromote) {
      setPromotedItemId(item.id);
    }
    item.onSelect();
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className={className}
      role={role}
      aria-label={ariaLabel}
      data-tauri-drag-region
    >
      {leadingVisibleItems.map((item) => (
        <TooltipIconButton
          key={item.id}
          className={item.buttonClassName}
          onClick={() => selectItem(item)}
          aria-current={item.ariaCurrent}
          data-tauri-drag-region="false"
          label={item.label}
        >
          <span className={item.iconClassName} aria-hidden>
            {item.icon}
          </span>
        </TooltipIconButton>
      ))}
      {showOverflowTrigger ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="responsive-icon-toolbar-more"
              aria-label={overflowLabel}
              title={overflowLabel}
              data-tauri-drag-region="false"
            >
              {overflowIcon ?? <SquareMenu size={14} aria-hidden />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="responsive-icon-toolbar-menu" align="end">
            {overflowMenuItems.map((item) => {
              const showPin = pinMode && item.pinnable !== false;
              return (
                <DropdownMenuItem
                  key={item.id}
                  className={item.menuItemClassName}
                  onSelect={() => selectItem(item)}
                  aria-label={item.label}
                  data-tauri-drag-region="false"
                >
                  <span className={item.iconClassName} aria-hidden>
                    {item.icon}
                  </span>
                  <span className="responsive-icon-toolbar-menu-label">
                    {item.label}
                  </span>
                  {showPin ? (
                    <input
                      type="checkbox"
                      className="responsive-icon-toolbar-pin"
                      checked={pinnedIds.includes(item.id)}
                      // 在 onClick 里 toggle：stopPropagation 会挡掉 React 委托的
                      // onChange，所以直接在这里切换，并阻止冒泡触发菜单项 select
                      onChange={() => {}}
                      onClick={(event) => {
                        event.stopPropagation();
                        onTogglePin?.(item.id);
                      }}
                      onKeyDown={(event) => {
                        // 仅拦截 Space/Enter 用于切换外显；方向键/Esc 放行给 Radix 导航
                        if (event.key === " " || event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          onTogglePin?.(item.id);
                        }
                      }}
                      aria-label={pinToggleLabel}
                      title={pinToggleLabel}
                      data-tauri-drag-region="false"
                    />
                  ) : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {pinnedVisibleItems.map((item) => (
        <TooltipIconButton
          key={item.id}
          className={item.buttonClassName}
          onClick={() => selectItem(item)}
          aria-current={item.ariaCurrent}
          data-tauri-drag-region="false"
          label={item.label}
        >
          <span className={item.iconClassName} aria-hidden>
            {item.icon}
          </span>
        </TooltipIconButton>
      ))}
    </div>
  );
}
