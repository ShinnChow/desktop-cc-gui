import { describe, expect, it } from "vitest";
import { initialState, threadReducer } from "./useThreadsReducer";

const WORKSPACE = "ws-background-task-activity";
const THREAD = "thread-bg-running";
const OTHER = "thread-other";
const NOW = 1_700_000_100_000;

function ensureThread(
  state: ReturnType<typeof threadReducer> | typeof initialState,
  threadId: string,
) {
  return threadReducer(state, {
    type: "ensureThread",
    workspaceId: WORKSPACE,
    threadId,
    engine: "pi",
  });
}

function selectThread(
  state: ReturnType<typeof threadReducer>,
  threadId: string,
) {
  return threadReducer(state, {
    type: "setActiveThreadId",
    workspaceId: WORKSPACE,
    threadId,
  });
}

function markBackgroundTaskActivity(
  state: ReturnType<typeof threadReducer>,
  threadId: string,
  runningCount: number,
) {
  return threadReducer(state, {
    type: "markBackgroundTaskActivity",
    workspaceId: WORKSPACE,
    threadId,
    runningCount,
  });
}

describe("threadReducer markBackgroundTaskActivity", () => {
  it("writes backgroundTaskRunningCount without prior status entry", () => {
    let state = ensureThread(initialState, THREAD);

    state = markBackgroundTaskActivity(state, THREAD, 2);

    expect(state.threadStatusById[THREAD]?.backgroundTaskRunningCount).toBe(2);
    expect(state.threadStatusById[THREAD]?.hasUnread ?? false).toBe(false);
  });

  it("returns the identical state reference when count and hasUnread are unchanged", () => {
    let state = ensureThread(initialState, THREAD);
    state = markBackgroundTaskActivity(state, THREAD, 1);
    state = markBackgroundTaskActivity(state, THREAD, 0);

    const before = state;
    state = markBackgroundTaskActivity(state, THREAD, 0);

    expect(state).toBe(before);
  });

  it("marks hasUnread when the count crosses to zero while the user is elsewhere", () => {
    let state = ensureThread(initialState, THREAD);
    state = ensureThread(state, OTHER);
    state = selectThread(state, OTHER);
    state = markBackgroundTaskActivity(state, THREAD, 1);

    state = markBackgroundTaskActivity(state, THREAD, 0);

    expect(state.threadStatusById[THREAD]?.backgroundTaskRunningCount).toBe(0);
    expect(state.threadStatusById[THREAD]?.hasUnread).toBe(true);
  });

  it("does not mark hasUnread when the count crosses to zero on the active thread", () => {
    let state = ensureThread(initialState, THREAD);
    state = selectThread(state, THREAD);
    state = markBackgroundTaskActivity(state, THREAD, 1);

    state = markBackgroundTaskActivity(state, THREAD, 0);

    expect(state.threadStatusById[THREAD]?.backgroundTaskRunningCount).toBe(0);
    expect(state.threadStatusById[THREAD]?.hasUnread ?? false).toBe(false);
  });

  it("does not mark hasUnread while tasks are still running (partial progress)", () => {
    let state = ensureThread(initialState, THREAD);
    state = ensureThread(state, OTHER);
    state = selectThread(state, OTHER);
    state = markBackgroundTaskActivity(state, THREAD, 3);

    state = markBackgroundTaskActivity(state, THREAD, 2);
    state = markBackgroundTaskActivity(state, THREAD, 1);

    expect(state.threadStatusById[THREAD]?.backgroundTaskRunningCount).toBe(1);
    expect(state.threadStatusById[THREAD]?.hasUnread ?? false).toBe(false);
  });

  it("does not trigger unread twice for repeated zero dispatches", () => {
    let state = ensureThread(initialState, THREAD);
    state = ensureThread(state, OTHER);
    state = selectThread(state, OTHER);
    state = markBackgroundTaskActivity(state, THREAD, 1);
    state = markBackgroundTaskActivity(state, THREAD, 0);
    expect(state.threadStatusById[THREAD]?.hasUnread).toBe(true);

    // Reading the thread clears unread; a duplicate zero dispatch must not re-mark.
    state = selectThread(state, THREAD);
    expect(state.threadStatusById[THREAD]?.hasUnread ?? false).toBe(false);
    state = markBackgroundTaskActivity(state, THREAD, 0);

    expect(state.threadStatusById[THREAD]?.hasUnread ?? false).toBe(false);
  });

  it("scopes the active-thread check to the dispatching workspace", () => {
    const OTHER_WORKSPACE = "ws-background-task-activity-other";
    // OTHER 先建占住 WORKSPACE 的 active 位，THREAD 不在本工作区被选中。
    let state = ensureThread(initialState, OTHER);
    state = ensureThread(state, THREAD);
    // THREAD selected in another workspace — must not count as active here.
    state = threadReducer(state, {
      type: "setActiveThreadId",
      workspaceId: OTHER_WORKSPACE,
      threadId: THREAD,
    });
    state = markBackgroundTaskActivity(state, THREAD, 1);

    state = markBackgroundTaskActivity(state, THREAD, 0);

    expect(state.threadStatusById[THREAD]?.hasUnread).toBe(true);
  });

  it("preserves other status fields when updating the count", () => {
    let state = ensureThread(initialState, THREAD);
    state = threadReducer(state, {
      type: "markProcessing",
      threadId: THREAD,
      isProcessing: true,
      timestamp: NOW,
    });

    state = markBackgroundTaskActivity(state, THREAD, 1);

    const status = state.threadStatusById[THREAD];
    expect(status?.isProcessing).toBe(true);
    expect(status?.processingStartedAt).toBe(NOW);
    expect(status?.backgroundTaskRunningCount).toBe(1);
  });

  it("tolerates a thread without ensureThread (deleted-thread late events)", () => {
    const state = markBackgroundTaskActivity(
      initialState,
      "thread-never-ensured",
      1,
    );

    expect(
      state.threadStatusById["thread-never-ensured"]?.backgroundTaskRunningCount,
    ).toBe(1);
  });

  // 回归：真实事故链——turn settle 的 markProcessing(false) 显式重建 status，
  // 曾把计数抹掉导致紫灯永久熄灭（store 无新事件、sync 不补发）。
  it("preserves backgroundTaskRunningCount across markProcessing transitions", () => {
    let state = ensureThread(initialState, THREAD);
    state = markBackgroundTaskActivity(state, THREAD, 2);

    state = threadReducer(state, {
      type: "markProcessing",
      threadId: THREAD,
      isProcessing: true,
      timestamp: NOW,
    });
    expect(state.threadStatusById[THREAD]?.backgroundTaskRunningCount).toBe(2);

    state = threadReducer(state, {
      type: "markProcessing",
      threadId: THREAD,
      isProcessing: false,
      timestamp: NOW + 1_000,
    });
    expect(state.threadStatusById[THREAD]?.backgroundTaskRunningCount).toBe(2);
  });

  it("preserves backgroundTaskRunningCount across markContextCompacting", () => {
    let state = ensureThread(initialState, THREAD);
    state = markBackgroundTaskActivity(state, THREAD, 1);

    state = threadReducer(state, {
      type: "markContextCompacting",
      threadId: THREAD,
      isCompacting: true,
    });
    expect(state.threadStatusById[THREAD]?.backgroundTaskRunningCount).toBe(1);

    state = threadReducer(state, {
      type: "markContextCompacting",
      threadId: THREAD,
      isCompacting: false,
      completionStatus: "completed",
    });
    expect(state.threadStatusById[THREAD]?.backgroundTaskRunningCount).toBe(1);
  });
});
