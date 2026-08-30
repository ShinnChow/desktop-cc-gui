/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import {
  applyBackgroundTaskUpdate,
  clearBackgroundTasks,
  hydrateBackgroundTasksFromHistory,
  listBackgroundTasks,
  listBackgroundTaskRunningCounts,
  noteBackgroundTaskStarted,
  resetBackgroundTaskStoreForTests,
} from "./backgroundTaskStore";
import { collectPiHistoryBackgroundTasks } from "../../threads/loaders/piHistoryParser";

const WS = "ws-1";
const THREAD = "pi:s1";

const HISTORY_ROWS = [
  { id: "m1", kind: "message", role: "user", text: "go" },
  {
    id: "tool_bg1",
    kind: "backgroundTask",
    role: "assistant",
    toolType: "bg_run",
    toolInput: { name: "spike", command: "sleep 3" },
  },
  {
    id: "tool_bg1-result",
    kind: "backgroundTask",
    role: "tool",
    toolOutput: {
      id: "t-1",
      name: "spike",
      status: "running",
      outputPath: ".pi/tasks/session-1-1/t-1.output",
      pid: 100,
    },
  },
  {
    id: "m5",
    kind: "backgroundTaskNotification",
    toolOutput: { id: "t-1", status: "completed", exitCode: 0 },
  },
];

describe("hydrateBackgroundTasksFromHistory", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
  });

  it("seeds the store from parsed history so the pill reappears on reopen", () => {
    hydrateBackgroundTasksFromHistory(
      WS,
      THREAD,
      collectPiHistoryBackgroundTasks(HISTORY_ROWS),
    );
    const tasks = listBackgroundTasks(WS, THREAD);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.taskId).toBe("t-1");
    expect(tasks[0]?.task.status).toBe("completed");
    expect(tasks[0]?.toolName).toBe("bg_run");
  });

  it("is idempotent and never overwrites live records (只补缺)", () => {
    // live 侧已有 registry 写入的最新终态。
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool_bg1",
      task: { id: "t-1", status: "failed", exitCode: 137 },
      source: "registry",
    });
    hydrateBackgroundTasksFromHistory(
      WS,
      THREAD,
      collectPiHistoryBackgroundTasks(HISTORY_ROWS),
    );
    hydrateBackgroundTasksFromHistory(
      WS,
      THREAD,
      collectPiHistoryBackgroundTasks(HISTORY_ROWS),
    );
    const tasks = listBackgroundTasks(WS, THREAD);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.task.status).toBe("failed"); // live 终态不被 history 覆盖
  });

  it("no-ops for empty merged lists", () => {
    hydrateBackgroundTasksFromHistory(WS, THREAD, []);
    expect(listBackgroundTasks(WS, THREAD)).toHaveLength(0);
  });
});

describe("listBackgroundTaskRunningCounts", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
  });

  it("stops counting cancelled tasks as running（终态口径统一）", () => {
    // cancelled / canceled 同样是终态：running 计数必须立刻归零，
    // 否则 sidebar 紫点 / unread 永不收口（2026-08-29 review 边界）。
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-cancel",
      task: { id: "t-cancel", status: "running" },
      source: "receipt",
    });
    expect(
      listBackgroundTaskRunningCounts().find(
        (entry) => entry.threadId === THREAD,
      )?.runningCount,
    ).toBe(1);

    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-cancel",
      task: { id: "t-cancel", status: "cancelled" },
      source: "notification",
    });
    expect(
      listBackgroundTaskRunningCounts().find(
        (entry) => entry.threadId === THREAD,
      )?.runningCount,
    ).toBe(0);
  });

  it("enumerates per-thread running counts across workspaces", () => {
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-a",
      task: { id: "t-a", status: "running" },
      source: "receipt",
    });
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-b",
      task: { id: "t-b", status: "running" },
      source: "receipt",
    });
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-c",
      task: { id: "t-c", status: "completed" },
      source: "notification",
    });
    applyBackgroundTaskUpdate("ws-2", "pi:s2", {
      toolId: "tool-d",
      task: { id: "t-d", status: "failed" },
      source: "registry",
    });

    const entries = listBackgroundTaskRunningCounts();
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({
      workspaceId: WS,
      threadId: THREAD,
      runningCount: 2,
    });
    expect(entries).toContainEqual({
      workspaceId: "ws-2",
      threadId: "pi:s2",
      runningCount: 0,
    });
  });

  it("excludes receipt 前的 tool: 占位记录", () => {
    noteBackgroundTaskStarted(WS, THREAD, {
      id: "tool-pending",
      type: "backgroundTask",
    });

    const entries = listBackgroundTaskRunningCounts();
    expect(entries).toContainEqual({
      workspaceId: WS,
      threadId: THREAD,
      runningCount: 0,
    });
  });

  it("drops the thread entry after clearBackgroundTasks", () => {
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-a",
      task: { id: "t-a", status: "running" },
      source: "receipt",
    });
    clearBackgroundTasks(WS, THREAD);

    expect(listBackgroundTaskRunningCounts()).toHaveLength(0);
  });
});
