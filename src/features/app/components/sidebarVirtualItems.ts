/**
 * Sidebar virtual item model.
 *
 * The Sidebar surface is a mix of heterogeneous nodes (workspace headers,
 * thread rows, pinned rows, folder rows, worktree rows, separators,
 * load-more controls, and empty states). To virtualize any scrollable
 * subsection we MUST flatten only the scrollable, repeated content into
 * explicit virtual item kinds before applying `@tanstack/react-virtual`.
 *
 * Every virtual item carries a stable domain-derived key. Index keys are
 * forbidden because reordering or insertion must not remount row state.
 */

import type { ThreadSummary } from "../../../types";

export const SIDEBAR_LIST_VIRTUALIZATION_MIN_ROWS = 100;

/**
 * Virtualized thread-row pitch in CSS pixels.
 *
 * Must stay in sync with non-virtualized layout:
 *   `.thread-row` min-height `--sidebar-row-height-thread` (30px)
 *   + `.thread-list` flex `gap` (2px)
 * and with `.thread-list-virtual-row` min-height in sidebar.css.
 *
 * Using a larger value (historically 36) makes expanded "更多" lists look
 * airier than the collapsed preview, because expand can cross the
 * virtualization threshold while collapse stays in plain flex layout.
 */
export const SIDEBAR_THREAD_ROW_ESTIMATED_HEIGHT_PX = 32;



export type SidebarVirtualItem =
  | {
      kind: "thread";
      key: string;
      workspaceId: string;
      threadId: string;
    }
  | {
      kind: "pinned";
      key: string;
      workspaceId: string;
      threadId: string;
    }
  | {
      kind: "folder";
      key: string;
      workspaceId: string;
      folderId: string;
    }
  | {
      kind: "worktree";
      key: string;
      parentWorkspaceId: string;
      worktreeWorkspaceId: string;
    }
  | {
      kind: "separator";
      key: string;
    }
  | {
      kind: "load-more";
      key: string;
      workspaceId: string;
    }
  | {
      kind: "empty";
      key: string;
      workspaceId: string;
    };

export type FlattenSidebarInput = {
  pinnedRows: ReadonlyArray<{
    thread: ThreadSummary;
    workspaceId: string;
  }>;
  unpinnedRows: ReadonlyArray<{
    thread: ThreadSummary;
    workspaceId: string;
  }>;
  folders: ReadonlyArray<{
    workspaceId: string;
    folderId: string;
  }>;
  worktrees: ReadonlyArray<{
    parentWorkspaceId: string;
    worktreeWorkspaceId: string;
  }>;
  hasMoreThreads: boolean;
  isEmpty: boolean;
};

export function flattenSidebarWorkspaceItems(
  input: FlattenSidebarInput,
): SidebarVirtualItem[] {
  const items: SidebarVirtualItem[] = [];

  for (const row of input.pinnedRows) {
    items.push({
      kind: "pinned",
      key: pinnedItemKey(row.workspaceId, row.thread.id),
      workspaceId: row.workspaceId,
      threadId: row.thread.id,
    });
  }
  if (input.pinnedRows.length > 0 && input.unpinnedRows.length > 0) {
    items.push(separatorItem("pinned-vs-unpinned"));
  }
  for (const row of input.unpinnedRows) {
    items.push({
      kind: "thread",
      key: threadItemKey(row.workspaceId, row.thread.id),
      workspaceId: row.workspaceId,
      threadId: row.thread.id,
    });
  }
  for (const folder of input.folders) {
    items.push({
      kind: "folder",
      key: folderItemKey(folder.workspaceId, folder.folderId),
      workspaceId: folder.workspaceId,
      folderId: folder.folderId,
    });
  }
  for (const wt of input.worktrees) {
    items.push({
      kind: "worktree",
      key: worktreeItemKey(wt.parentWorkspaceId, wt.worktreeWorkspaceId),
      parentWorkspaceId: wt.parentWorkspaceId,
      worktreeWorkspaceId: wt.worktreeWorkspaceId,
    });
  }
  if (input.hasMoreThreads && input.unpinnedRows.length > 0) {
    const firstWorkspaceId = input.unpinnedRows[0]?.workspaceId ?? "";
    items.push(loadMoreItem(firstWorkspaceId));
  }
  if (input.isEmpty) {
    const firstWorkspaceId =
      input.pinnedRows[0]?.workspaceId ??
      input.unpinnedRows[0]?.workspaceId ??
      "";
    items.push(emptyItem(firstWorkspaceId));
  }
  return items;
}

export function shouldVirtualizeSidebarList(rowCount: number): boolean {
  return rowCount >= SIDEBAR_LIST_VIRTUALIZATION_MIN_ROWS;
}

export function threadItemKey(workspaceId: string, threadId: string): string {
  return `thread:${workspaceId}:${threadId}`;
}

export function pinnedItemKey(workspaceId: string, threadId: string): string {
  return `pinned:${workspaceId}:${threadId}`;
}

export function folderItemKey(workspaceId: string, folderId: string): string {
  return `folder:${workspaceId}:${folderId}`;
}

export function worktreeItemKey(
  parentWorkspaceId: string,
  worktreeWorkspaceId: string,
): string {
  return `worktree:${parentWorkspaceId}:${worktreeWorkspaceId}`;
}

export function separatorItem(label: string): SidebarVirtualItem {
  return { kind: "separator", key: `separator:${label}` };
}

export function loadMoreItem(workspaceId: string): SidebarVirtualItem {
  return { kind: "load-more", key: `load-more:${workspaceId}`, workspaceId };
}

export function emptyItem(workspaceId: string): SidebarVirtualItem {
  return { kind: "empty", key: `empty:${workspaceId}`, workspaceId };
}

export function resolveSidebarItemKey(
  items: ReadonlyArray<SidebarVirtualItem>,
  index: number,
): string {
  const item = items[index];
  if (item) {
    return item.key;
  }
  return `sidebar-fallback-${index}`;
}
