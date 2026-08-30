import { useMemo, useSyncExternalStore } from "react";
import type { ConversationItem } from "../../../types";
import {
  getBackgroundTaskStoreVersion,
  listBackgroundTasks,
  subscribeBackgroundTaskStore,
} from "./backgroundTaskStore";

const RUNNING_BACKGROUND_TASK_STATUSES = new Set([
  "running",
  "pending",
  "queued",
  "starting",
]);
const EMPTY_SUBSCRIBE = () => () => {};
const ZERO_SNAPSHOT = () => 0;

export type BackgroundTaskRunningSnapshot = {
  runningCount: number;
  earliestRunningStartTime: number | null;
};

const EMPTY_RUNNING_SNAPSHOT: BackgroundTaskRunningSnapshot = {
  runningCount: 0,
  earliestRunningStartTime: null,
};

function isRunningStatus(status: unknown): boolean {
  return RUNNING_BACKGROUND_TASK_STATUSES.has(
    typeof status === "string" ? status.trim().toLowerCase() : "",
  );
}

function asStartTime(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function getItemTaskStartTime(item: ConversationItem): number | null {
  if (item.kind !== "tool" || item.toolType !== "backgroundTask") {
    return null;
  }
  try {
    const task = JSON.parse(item.output ?? "") as Record<string, unknown>;
    return asStartTime(task.startTime);
  } catch {
    return null;
  }
}

/**
 * PI-only, event-driven background-task facts for one conversation. A visible
 * running task card is retained as a fallback when a live store record has not
 * yet been scoped to this Messages instance.
 */
export function useBackgroundTaskRunningSnapshot({
  enabled,
  workspaceId,
  threadId,
  items,
}: {
  enabled: boolean;
  workspaceId: string | null;
  threadId: string | null;
  items: readonly ConversationItem[];
}): BackgroundTaskRunningSnapshot {
  const version = useSyncExternalStore(
    enabled ? subscribeBackgroundTaskStore : EMPTY_SUBSCRIBE,
    enabled ? getBackgroundTaskStoreVersion : ZERO_SNAPSHOT,
  );

  return useMemo(() => {
    if (!enabled) return EMPTY_RUNNING_SNAPSHOT;
    void version;

    const records =
      workspaceId && threadId
        ? listBackgroundTasks(workspaceId, threadId).filter((record) =>
            isRunningStatus(record.task.status),
          )
        : [];
    const runningItems = items.filter(
      (item) =>
        item.kind === "tool" &&
        item.toolType === "backgroundTask" &&
        isRunningStatus(item.status),
    );
    const startTimes = [
      ...records.map((record) => asStartTime(record.task.startTime)),
      ...runningItems.map(getItemTaskStartTime),
    ].filter((value): value is number => value !== null);

    return {
      runningCount: Math.max(records.length, runningItems.length),
      earliestRunningStartTime:
        startTimes.length > 0 ? Math.min(...startTimes) : null,
    };
  }, [enabled, items, threadId, version, workspaceId]);
}

/** @deprecated Use useBackgroundTaskRunningSnapshot for timer facts. */
export function useBackgroundTaskRunningCount(
  workspaceId: string | null,
  threadId: string | null,
  items: readonly ConversationItem[] = [],
): number {
  return useBackgroundTaskRunningSnapshot({
    enabled: true,
    workspaceId,
    threadId,
    items,
  }).runningCount;
}
