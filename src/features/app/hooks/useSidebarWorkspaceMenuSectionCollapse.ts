import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";

// 「新建会话」抽屉三栏（Shared CLI / Native CLI / 工作区操作）的折叠状态。
// 存「已折叠分组 id」集合：缺省空集合 = 全部展开；本地持久化，跨会话记忆。
export const SIDEBAR_WORKSPACE_MENU_COLLAPSED_SECTIONS_KEY =
  "sidebarWorkspaceMenuCollapsedSections";

export function readSidebarWorkspaceMenuCollapsedSectionIds(): string[] {
  const stored = getClientStoreSync<unknown>(
    "app",
    SIDEBAR_WORKSPACE_MENU_COLLAPSED_SECTIONS_KEY,
  );
  return Array.isArray(stored)
    ? stored.filter((id): id is string => typeof id === "string")
    : [];
}

export function toggleSidebarWorkspaceMenuCollapsedSectionId(
  id: string,
): string[] {
  const current = readSidebarWorkspaceMenuCollapsedSectionIds();
  const next = current.includes(id)
    ? current.filter((collapsedId) => collapsedId !== id)
    : [...current, id];
  writeClientStoreValue("app", SIDEBAR_WORKSPACE_MENU_COLLAPSED_SECTIONS_KEY, next);
  return next;
}
