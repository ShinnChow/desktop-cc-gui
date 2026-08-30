import { useCallback, useMemo, useRef } from "react";

import type {
  ConversationItem,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import type { ThreadPinScope } from "../../threads/utils/threadStorage";
import type { GetThreadRows } from "../hooks/useThreadRows";
import { resolveVisibleThreadRootLimit } from "../constants";
import { getExitedSessionRowVisibility } from "../utils/exitedSessionRows";
import { debugPiSidebarDrop } from "../../pi-session/store/piSidebarDropDiagnostics";
import { shouldHidePlaceholderNativeDraftFromSidebar } from "../../threads/hooks/sessionIndexThreadSummaries";
import {
  buildClaudeLiveSubagentRows,
  filterClaudeLiveSubagentSourceItems,
  type WorkspaceGroupSection,
  type WorkspaceThreadRows,
} from "./sidebarInternals";

type SidebarThreadProjectionsParams = {
  activeItems: ConversationItem[];
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  workspaces: WorkspaceInfo[];
  pinnedThreadsVersion: number;
  isThreadPinned: (
    workspaceId: string,
    threadId: string,
    scope?: ThreadPinScope,
  ) => boolean;
  getPinTimestamp: (
    workspaceId: string,
    threadId: string,
    scope?: ThreadPinScope,
  ) => number | null;
  getThreadRows: GetThreadRows;
  isWorkspaceMatch: (workspace: WorkspaceInfo) => boolean;
  filteredGroupedWorkspaces: WorkspaceGroupSection[];
  collapsedGroups: Set<string>;
  threadListPageByWorkspace: Record<string, number>;
  resolvedDefaultVisibleThreadRootCount: number;
  isExitedSessionsHidden: (workspacePath: string) => boolean;
  threadStatusById: Record<
    string,
    { isProcessing: boolean; hasUnread: boolean; isReviewing: boolean }
  >;
};

export function useSidebarThreadProjections({
  activeItems,
  threadsByWorkspace,
  activeWorkspaceId,
  activeThreadId,
  workspaces,
  pinnedThreadsVersion,
  isThreadPinned,
  getPinTimestamp,
  getThreadRows,
  isWorkspaceMatch,
  filteredGroupedWorkspaces,
  collapsedGroups,
  threadListPageByWorkspace,
  resolvedDefaultVisibleThreadRootCount,
  isExitedSessionsHidden,
  threadStatusById,
}: SidebarThreadProjectionsParams) {
  // activeItems 在流式期间每个 token 都换引用，但 subagent 投影只关心 agent
  // tool 条目；文本 delta 不改这些条目的引用，这里做「过滤 + 引用稳定化」，
  // 让 getProjectedThreads（及下游 threadRowsByWorkspace / pinnedThreadRows
  // 两个全 workspace 排序的 useMemo）不再随每个 token 重算。
  const claudeAgentToolItemsRef = useRef<ConversationItem[]>([]);
  const claudeAgentToolItems = useMemo(() => {
    const next = filterClaudeLiveSubagentSourceItems(activeItems);
    const previous = claudeAgentToolItemsRef.current;
    if (
      previous.length === next.length &&
      next.every((item, index) => previous[index] === item)
    ) {
      return previous;
    }
    claudeAgentToolItemsRef.current = next;
    return next;
  }, [activeItems]);
  const getProjectedThreads = useCallback(
    (workspaceId: string) =>
      buildClaudeLiveSubagentRows(
        (threadsByWorkspace[workspaceId] ?? []).filter((thread) => {
          const hidePlaceholder = shouldHidePlaceholderNativeDraftFromSidebar({
            engine: thread.engineSource,
            threadId: thread.id,
            displayName: thread.name,
            isActive:
              workspaceId === activeWorkspaceId && thread.id === activeThreadId,
            isChildSession: Boolean(thread.parentThreadId?.trim()),
          });
          // 诊断：placeholder 闸藏掉的 pi 行（多轮「main 丢失」取证沉淀）。
          if (
            hidePlaceholder &&
            (thread.engineSource === "pi" || thread.id.startsWith("pi:"))
          ) {
            debugPiSidebarDrop(
              "placeholder-filter",
              thread.id,
              `name:${String(thread.name ?? "").slice(0, 30)}`,
            );
          }
          return !hidePlaceholder;
        }),
        workspaceId,
        activeWorkspaceId,
        activeThreadId,
        claudeAgentToolItems,
      ),
    [
      claudeAgentToolItems,
      activeThreadId,
      activeWorkspaceId,
      threadsByWorkspace,
    ],
  );
  const shouldShowExitedSessionsToggle = useCallback(
    (workspace: WorkspaceInfo) => {
      const threads = getProjectedThreads(workspace.id);
      const visibleThreadRootCount = resolveVisibleThreadRootLimit(
        workspace.settings.visibleThreadRootCount,
        threadListPageByWorkspace[workspace.id],
        resolvedDefaultVisibleThreadRootCount,
      );
      const { unpinnedRows } = getThreadRows(
        threads,
        false,
        workspace.id,
        getPinTimestamp,
        visibleThreadRootCount,
      );
      const hideExitedSessions = isExitedSessionsHidden(workspace.path);
      const visibility = getExitedSessionRowVisibility(unpinnedRows, {
        hideExitedSessions,
        isExitedThread: (thread) => {
          const status = threadStatusById[thread.id];
          return !status?.isProcessing && !status?.isReviewing;
        },
      });
      return visibility.hasExitedSessions || visibility.hiddenExitedCount > 0;
    },
    [
      threadListPageByWorkspace,
      getPinTimestamp,
      getProjectedThreads,
      getThreadRows,
      isExitedSessionsHidden,
      resolvedDefaultVisibleThreadRootCount,
      threadStatusById,
    ],
  );

  const pinnedThreadRows = useMemo(() => {
    type ThreadRow = {
      thread: ThreadSummary;
      depth: number;
      hasChildren?: boolean;
    };
    const groups: Array<{
      pinTime: number;
      workspaceId: string;
      workspacePath: string;
      rows: ThreadRow[];
    }> = [];
    if (pinnedThreadsVersion < 0) {
      return [];
    }

    workspaces.forEach((workspace) => {
      if (!isWorkspaceMatch(workspace)) {
        return;
      }
      // Cheap early-out BEFORE the expensive getProjectedThreads (which pulls in
      // activeItems and so recomputes on every message-stream tick): if this
      // workspace has no pinned thread at all, there's nothing to build. Checks
      // the base thread list, which is stable across streaming. Without this the
      // whole memo re-ran O(all threads) on every stream tick even with 0 pins.
      const baseThreads = threadsByWorkspace[workspace.id] ?? [];
      const hasPinnedThread = baseThreads.some((thread) =>
        isThreadPinned(workspace.id, thread.id),
      );
      if (!hasPinnedThread) {
        return;
      }
      const threads = getProjectedThreads(workspace.id);
      if (!threads.length) {
        return;
      }
      const { pinnedRows } = getThreadRows(
        threads,
        true,
        workspace.id,
        getPinTimestamp,
      );
      if (!pinnedRows.length) {
        return;
      }
      let currentRows: ThreadRow[] = [];
      let currentPinTime: number | null = null;

      pinnedRows.forEach((row) => {
        if (row.depth === 0) {
          if (currentRows.length && currentPinTime !== null) {
            groups.push({
              pinTime: currentPinTime,
              workspaceId: workspace.id,
              workspacePath: workspace.path,
              rows: currentRows,
            });
          }
          currentRows = [row];
          currentPinTime = getPinTimestamp(workspace.id, row.thread.id);
        } else {
          currentRows.push(row);
        }
      });

      if (currentRows.length && currentPinTime !== null) {
        groups.push({
          pinTime: currentPinTime,
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          rows: currentRows,
        });
      }
    });

    return groups
      .sort((a, b) => a.pinTime - b.pinTime)
      .flatMap((group) =>
        group.rows.map((row) => ({
          ...row,
          workspaceId: group.workspaceId,
          workspacePath: group.workspacePath,
        })),
      );
  }, [
    workspaces,
    threadsByWorkspace,
    isThreadPinned,
    getProjectedThreads,
    getThreadRows,
    getPinTimestamp,
    isWorkspaceMatch,
    pinnedThreadsVersion,
  ]);

  const threadRowsByWorkspace = useMemo(() => {
    const rowsByWorkspace = new Map<string, WorkspaceThreadRows>();
    filteredGroupedWorkspaces.forEach((group) => {
      const toggleId = group.id;
      const isGroupCollapsed = Boolean(
        toggleId && collapsedGroups.has(toggleId),
      );
      if (isGroupCollapsed) {
        return;
      }
      group.workspaces.forEach((workspace) => {
        if (workspace.settings.sidebarCollapsed) {
          rowsByWorkspace.set(workspace.id, {
            unpinnedRows: [],
            workspacePinnedRows: [],
            totalRoots: 0,
          });
          return;
        }
        const threads = getProjectedThreads(workspace.id);
        const visibleThreadRootCount = resolveVisibleThreadRootLimit(
          workspace.settings.visibleThreadRootCount,
          threadListPageByWorkspace[workspace.id],
          resolvedDefaultVisibleThreadRootCount,
        );
        const { unpinnedRows, workspacePinnedRows, totalRoots } = getThreadRows(
          threads,
          false,
          workspace.id,
          getPinTimestamp,
          visibleThreadRootCount,
        );
        rowsByWorkspace.set(workspace.id, {
          unpinnedRows,
          workspacePinnedRows,
          totalRoots,
        });
      });
    });
    return rowsByWorkspace;
  }, [
    collapsedGroups,
    threadListPageByWorkspace,
    filteredGroupedWorkspaces,
    getPinTimestamp,
    getThreadRows,
    getProjectedThreads,
    resolvedDefaultVisibleThreadRootCount,
  ]);

  return {
    getProjectedThreads,
    shouldShowExitedSessionsToggle,
    pinnedThreadRows,
    threadRowsByWorkspace,
  };
}
