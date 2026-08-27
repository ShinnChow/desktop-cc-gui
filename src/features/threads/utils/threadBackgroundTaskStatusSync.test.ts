/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import {
  applyBackgroundTaskUpdate,
  resetBackgroundTaskStoreForTests,
} from "../../messages/utils/backgroundTaskStore";
import {
  createBackgroundTaskStatusSync,
  diffBackgroundTaskRunningCounts,
  useThreadBackgroundTaskStatusSync,
} from "./threadBackgroundTaskStatusSync";
import type { ThreadAction } from "../hooks/threadReducerTypes";

const WS = "ws-sync";
const THREAD = "pi:s1";

function noteRunning(taskId: string, status: string) {
  applyBackgroundTaskUpdate(WS, THREAD, {
    toolId: `tool-${taskId}`,
    task: { id: taskId, status },
    source: status === "running" ? "receipt" : "notification",
  });
}

function dispatchesFor(dispatch: ReturnType<typeof vi.fn>) {
  return dispatch.mock.calls.map(
    (call) => call[0] as Extract<ThreadAction, { type: "markBackgroundTaskActivity" }>,
  );
}

describe("diffBackgroundTaskRunningCounts", () => {
  it("emits new entries with a positive count but skips new zero-count threads", () => {
    const changes = diffBackgroundTaskRunningCounts(
      [],
      [
        { workspaceId: WS, threadId: THREAD, runningCount: 2 },
        { workspaceId: WS, threadId: "pi:done", runningCount: 0 },
      ],
    );

    expect(changes).toEqual([
      { workspaceId: WS, threadId: THREAD, runningCount: 2 },
    ]);
  });

  it("emits only changed counts and zero-fills cleared threads", () => {
    const lastKnown = [
      { workspaceId: WS, threadId: THREAD, runningCount: 2 },
      { workspaceId: WS, threadId: "pi:cleared", runningCount: 1 },
      { workspaceId: WS, threadId: "pi:already-zero", runningCount: 0 },
    ];
    const changes = diffBackgroundTaskRunningCounts(lastKnown, [
      { workspaceId: WS, threadId: THREAD, runningCount: 1 },
      // pi:cleared 的表被 clearBackgroundTasks 删除：不在 next 里 → 补 0。
      { workspaceId: WS, threadId: "pi:already-zero", runningCount: 0 },
    ]);

    expect(changes).toEqual([
      { workspaceId: WS, threadId: THREAD, runningCount: 1 },
      { workspaceId: WS, threadId: "pi:cleared", runningCount: 0 },
    ]);
  });
});

describe("createBackgroundTaskStatusSync", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
  });

  it("dispatches only changed threads on store writes", () => {
    const dispatch = vi.fn();
    const sync = createBackgroundTaskStatusSync(dispatch);

    noteRunning("t-1", "running");
    noteRunning("t-2", "running");
    // 无计数变化的状态合并（例如 tail 更新）不 dispatch。
    noteRunning("t-1", "running");

    expect(dispatchesFor(dispatch)).toEqual([
      { type: "markBackgroundTaskActivity", workspaceId: WS, threadId: THREAD, runningCount: 1 },
      { type: "markBackgroundTaskActivity", workspaceId: WS, threadId: THREAD, runningCount: 2 },
    ]);

    sync.dispose();
  });

  it("dispatches zero when the last running task turns terminal", () => {
    const dispatch = vi.fn();
    const sync = createBackgroundTaskStatusSync(dispatch);

    noteRunning("t-1", "running");
    noteRunning("t-1", "completed");

    expect(dispatchesFor(dispatch)).toEqual([
      { type: "markBackgroundTaskActivity", workspaceId: WS, threadId: THREAD, runningCount: 1 },
      { type: "markBackgroundTaskActivity", workspaceId: WS, threadId: THREAD, runningCount: 0 },
    ]);

    sync.dispose();
  });

  it("stops dispatching after dispose", () => {
    const dispatch = vi.fn();
    const sync = createBackgroundTaskStatusSync(dispatch);
    sync.dispose();

    noteRunning("t-1", "running");

    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("useThreadBackgroundTaskStatusSync", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
  });

  it("forwards changed running counts to dispatch while mounted", () => {
    const dispatch = vi.fn();
    const { unmount } = renderHook(() =>
      useThreadBackgroundTaskStatusSync(dispatch),
    );

    act(() => {
      noteRunning("t-1", "running");
    });
    expect(dispatchesFor(dispatch)).toEqual([
      { type: "markBackgroundTaskActivity", workspaceId: WS, threadId: THREAD, runningCount: 1 },
    ]);

    unmount();
    act(() => {
      noteRunning("t-1", "completed");
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
