import { useCallback, useEffect, useState } from "react";

import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";

// 侧栏设置菜单勾选后，在设置齿轮旁外显的动作 id 列表。
export const SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY = "sidebarSettingsPinnedActions";
export const SIDEBAR_SETTINGS_PINNED_ACTIONS_CHANGED_EVENT =
  "sidebarSettingsPinnedActionsChanged";

/** 底部空间有限，最多外显 4 个快捷入口。 */
export const SIDEBAR_SETTINGS_PINNED_MAX = 4;

export const PINNABLE_SETTINGS_ACTION_IDS = [
  "lock",
  "spec-hub",
  "project-memory",
  "git-history",
  "system-proxy",
  "runtime-notice",
] as const;

export type SidebarSettingsPinnedActionId =
  (typeof PINNABLE_SETTINGS_ACTION_IDS)[number];

export function isSidebarSettingsPinnedActionId(
  id: string,
): id is SidebarSettingsPinnedActionId {
  return (PINNABLE_SETTINGS_ACTION_IDS as readonly string[]).includes(id);
}

export function readSidebarSettingsPinnedActionIds(): string[] {
  const stored = getClientStoreSync<unknown>(
    "app",
    SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY,
  );
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.filter(
    (id): id is string =>
      typeof id === "string" && isSidebarSettingsPinnedActionId(id),
  );
}

/**
 * 切换 pin 状态。已 pin 则取消；未 pin 且未达上限则追加。
 * 已达上限再勾选新项时保持不变（返回当前列表）。
 */
export function toggleSidebarSettingsPinnedActionId(id: string): string[] {
  if (!isSidebarSettingsPinnedActionId(id)) {
    return readSidebarSettingsPinnedActionIds();
  }
  const current = readSidebarSettingsPinnedActionIds();
  const next = current.includes(id)
    ? current.filter((pinnedId) => pinnedId !== id)
    : current.length >= SIDEBAR_SETTINGS_PINNED_MAX
      ? current
      : [...current, id];
  if (
    next.length === current.length &&
    next.every((value, index) => value === current[index])
  ) {
    return current;
  }
  writeClientStoreValue("app", SIDEBAR_SETTINGS_PINNED_ACTIONS_KEY, next);
  window.dispatchEvent(
    new CustomEvent<string[]>(SIDEBAR_SETTINGS_PINNED_ACTIONS_CHANGED_EVENT, {
      detail: next,
    }),
  );
  return next;
}

/**
 * 侧栏设置菜单「外显快捷入口」的共享状态。
 * 菜单勾选框与齿轮旁按钮共用同一 clientStorage key。
 */
export function useSidebarSettingsPinnedActions() {
  const [pinnedIds, setPinnedIds] = useState<string[]>(() =>
    readSidebarSettingsPinnedActionIds(),
  );
  const togglePinned = useCallback((id: string) => {
    setPinnedIds(toggleSidebarSettingsPinnedActionId(id));
  }, []);
  useEffect(() => {
    const handleChanged = (event: Event) => {
      const next = (event as CustomEvent<unknown>).detail;
      if (Array.isArray(next)) {
        setPinnedIds(
          next.filter(
            (id): id is string =>
              typeof id === "string" && isSidebarSettingsPinnedActionId(id),
          ),
        );
      }
    };
    window.addEventListener(
      SIDEBAR_SETTINGS_PINNED_ACTIONS_CHANGED_EVENT,
      handleChanged,
    );
    return () => {
      window.removeEventListener(
        SIDEBAR_SETTINGS_PINNED_ACTIONS_CHANGED_EVENT,
        handleChanged,
      );
    };
  }, []);
  return {
    pinnedIds,
    togglePinned,
    maxPinned: SIDEBAR_SETTINGS_PINNED_MAX,
  };
}
