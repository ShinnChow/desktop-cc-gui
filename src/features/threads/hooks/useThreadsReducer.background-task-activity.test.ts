import { beforeEach, describe, expect, it } from "vitest";
import { initialState, threadReducer } from "./useThreadsReducer";
import {
  applyBackgroundTaskUpdate as applyBackgroundTaskUpdateForTest,
  listBackgroundTasks as listBackgroundTasksForTest,
  renameBackgroundTasksForThread as renameBackgroundTasksForTest,
  resetBackgroundTaskStoreForTests,
} from "../../messages/utils/backgroundTaskStore";

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

beforeEach(() => {
  resetBackgroundTaskStoreForTests();
});

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
  // P1 review 修复：pending→final rename 会走 renameThreadStateIdentity 的
  // status 合并（显式枚举），曾把计数丢掉；且 backgroundTaskStore 的记录
  // key 是 threadId，rename 后必须随迁，否则 watcher/回写全挂旧 id。
  it("merges backgroundTaskRunningCount (max) when rename target already has status", () => {
    let state = ensureThread(initialState, THREAD);
    state = markBackgroundTaskActivity(state, THREAD, 2);
    // newThreadId 已有自己的 status 条目 → 走合并分支而非整体迁移。
    state = ensureThread(state, OTHER);
    state = threadReducer(state, {
      type: "markUnread",
      threadId: OTHER,
      hasUnread: true,
    });

    state = threadReducer(state, {
      type: "renameThreadId",
      workspaceId: WORKSPACE,
      oldThreadId: THREAD,
      newThreadId: OTHER,
    });

    expect(state.threadStatusById[OTHER]?.backgroundTaskRunningCount).toBe(2);
    expect(state.threadStatusById[OTHER]?.hasUnread).toBe(true);
    expect(state.threadStatusById[THREAD]).toBeUndefined();
  });

  it("migrates backgroundTaskStore records to the renamed thread id", () => {
    let state = ensureThread(initialState, THREAD);
    state = markBackgroundTaskActivity(state, THREAD, 1);
    // 造一条 store 记录（模拟 receipt 写入）。
    applyBackgroundTaskUpdateForTest(WORKSPACE, THREAD, {
      toolId: "tool-bg-1",
      task: { id: "t-1", status: "running", outputPath: ".pi/tasks/x/t-1.output" },
      source: "receipt",
    });

    state = threadReducer(state, {
      type: "renameThreadId",
      workspaceId: WORKSPACE,
      oldThreadId: THREAD,
      newThreadId: OTHER,
    });

    expect(listBackgroundTasksForTest(WORKSPACE, THREAD)).toHaveLength(0);
    expect(listBackgroundTasksForTest(WORKSPACE, OTHER).length).toBeGreaterThan(0);
  });

  it("renameBackgroundTasksForThread is idempotent and no-ops without an old table", () => {
    applyBackgroundTaskUpdateForTest(WORKSPACE, THREAD, {
      toolId: "tool-bg-1",
      task: { id: "t-1", status: "running", outputPath: ".pi/tasks/x/t-1.output" },
      source: "receipt",
    });
    // pending→final 的 inline rename 分支与 renameThreadId case 调同一迁移。
    renameBackgroundTasksForTest(WORKSPACE, THREAD, OTHER);
    renameBackgroundTasksForTest(WORKSPACE, THREAD, OTHER); // 幂等：旧表已删

    expect(listBackgroundTasksForTest(WORKSPACE, THREAD)).toHaveLength(0);
    expect(listBackgroundTasksForTest(WORKSPACE, OTHER)).toHaveLength(1);
    // 无旧表（如从未有任务的会话）no-op 不抛错。
    renameBackgroundTasksForTest(WORKSPACE, "thread-never-existed", OTHER);
    expect(listBackgroundTasksForTest(WORKSPACE, OTHER)).toHaveLength(1);
  });

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
