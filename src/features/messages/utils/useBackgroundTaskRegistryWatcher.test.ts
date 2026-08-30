/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyBackgroundTaskUpdate,
  listBackgroundTasks,
  resetBackgroundTaskStoreForTests,
  setBackgroundTaskUpdateSink,
} from "./backgroundTaskStore";
import {
  registryMetadataPathForOutput,
  useBackgroundTaskRegistryWatcher,
  useBackgroundTaskRegistryWatcherForRunningThreads,
} from "./useBackgroundTaskRegistryWatcher";

const WS = "ws-1";
const THREAD = "pi:s1";

describe("registryMetadataPathForOutput", () => {
  it("derives the sibling .json metadata path from the .output log path", () => {
    expect(
      registryMetadataPathForOutput(
        ".pi/tasks/session-123-123/b2e2f48ad.output",
      ),
    ).toBe(".pi/tasks/session-123-123/b2e2f48ad.json");
    expect(
      registryMetadataPathForOutput(".pi/tasks/session-9-9/task-1.OUTPUT"),
    ).toBe(".pi/tasks/session-9-9/task-1.json");
    expect(registryMetadataPathForOutput("logs/raw.bin")).toBe(
      "logs/raw.bin.json",
    );
  });
});

describe("useBackgroundTaskRegistryWatcher", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("promotes terminal registry metadata into the store (post-settle 兜底)", async () => {
    const readFile = vi.fn(async () => ({
      content: JSON.stringify({
        id: "t-1",
        name: "spike",
        status: "completed",
        exitCode: 0,
        endTime: 100,
      }),
      truncated: false,
    }));
    const onApply = vi.fn();
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-1",
      task: {
        id: "t-1",
        name: "spike",
        status: "running",
        outputPath: ".pi/tasks/session-5-5/t-1.output",
        pid: 42,
      },
      source: "receipt",
    });

    renderHook(() =>
      useBackgroundTaskRegistryWatcher(
        { workspaceId: WS, threadId: THREAD },
        { pollMs: 1000, staleAfterMs: 30000, readFile, onApply },
      ),
    );

    // 挂载时的首次 probe 是纯异步（readFile mock 立即 resolve）；flush microtask。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onApply).toHaveBeenCalledWith({
      toolId: null,
      task: expect.objectContaining({
        id: "t-1",
        status: "completed",
        exitCode: 0,
      }),
      source: "registry",
    });
    const records = listBackgroundTasks(WS, THREAD);
    expect(records[0]?.task.status).toBe("completed");
  });

  it("marks a task failed after the process is sustainedly dead and no terminal metadata", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("no file");
    });
    const isProcessAlive = vi.fn(async () => false);
    const onApply = vi.fn();
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-1",
      task: {
        id: "t-1",
        name: "spike",
        status: "running",
        outputPath: ".pi/tasks/session-5-5/t-1.output",
        pid: 42,
      },
      source: "receipt",
    });

    renderHook(() =>
      useBackgroundTaskRegistryWatcher(
        { workspaceId: WS, threadId: THREAD },
        { pollMs: 1000, staleAfterMs: 3000, readFile, isProcessAlive, onApply },
      ),
    );

    // 首次探测记录死亡起点，未到阈值不标记。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onApply).not.toHaveBeenCalled();

    // 持续死亡 > staleAfterMs → 标异常终止。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "registry",
        task: expect.objectContaining({ id: "t-1", status: "failed" }),
      }),
    );
    const records = listBackgroundTasks(WS, THREAD);
    expect(records[0]?.task.status).toBe("failed");
  });

  it("does not flag a running task when the process is still alive", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("no file");
    });
    const isProcessAlive = vi.fn(async () => true);
    const onApply = vi.fn();
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-1",
      task: {
        id: "t-1",
        status: "running",
        outputPath: ".pi/tasks/session-5-5/t-1.output",
        pid: 42,
      },
      source: "receipt",
    });

    renderHook(() =>
      useBackgroundTaskRegistryWatcher(
        { workspaceId: WS, threadId: THREAD },
        { pollMs: 1000, staleAfterMs: 3000, readFile, isProcessAlive, onApply },
      ),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(listBackgroundTasks(WS, THREAD)[0]?.task.status).toBe("running");
  });

  it("does nothing for a null scope", () => {
    const onApply = vi.fn();
    renderHook(() =>
      useBackgroundTaskRegistryWatcher(
        { workspaceId: null, threadId: null },
        { readFile: vi.fn(), isProcessAlive: vi.fn(), onApply },
      ),
    );
    expect(onApply).not.toHaveBeenCalled();
  });

  it("routes through the registered sink when mounted (timeline 与 pill 同步)", async () => {
    const readFile = vi.fn(async () => ({
      content: JSON.stringify({
        id: "t-1",
        name: "spike",
        status: "completed",
        exitCode: 0,
      }),
      truncated: false,
    }));
    const sink = vi.fn();
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: "tool-1",
      task: {
        id: "t-1",
        status: "running",
        outputPath: ".pi/tasks/session-5-5/t-1.output",
        pid: 42,
      },
      source: "receipt",
    });

    act(() => {
      setBackgroundTaskUpdateSink(sink);
    });
    try {
      renderHook(() =>
        useBackgroundTaskRegistryWatcher(
          { workspaceId: WS, threadId: THREAD },
          { pollMs: 1000, staleAfterMs: 30000, readFile },
        ),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(sink).toHaveBeenCalledWith(
        WS,
        THREAD,
        expect.objectContaining({
          source: "registry",
          task: expect.objectContaining({ status: "completed" }),
        }),
      );
    } finally {
      act(() => {
        setBackgroundTaskUpdateSink(null);
      });
    }
  });
});

describe("useBackgroundTaskRegistryWatcherForRunningThreads", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("probes every thread with running tasks (app 级，与当前活跃会话无关)", async () => {
    const readFile = vi.fn(async (_workspaceId: string, path: string) => ({
      content: JSON.stringify({
        id: path.includes("t-a") ? "t-a" : "t-b",
        status: "completed",
        exitCode: 0,
      }),
      truncated: false,
    }));
    const sink = vi.fn();
    applyBackgroundTaskUpdate("ws-1", "pi:s1", {
      toolId: "tool-a",
      task: {
        id: "t-a",
        status: "running",
        outputPath: ".pi/tasks/session-5-5/t-a.output",
      },
      source: "receipt",
    });
    applyBackgroundTaskUpdate("ws-2", "pi:s2", {
      toolId: "tool-b",
      task: {
        id: "t-b",
        status: "running",
        outputPath: ".pi/tasks/session-7-7/t-b.output",
      },
      source: "receipt",
    });

    act(() => {
      setBackgroundTaskUpdateSink(sink);
    });
    try {
      renderHook(() =>
        useBackgroundTaskRegistryWatcherForRunningThreads({
          pollMs: 1000,
          staleAfterMs: 30000,
          readFile,
        }),
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      const probedWorkspaces = readFile.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(probedWorkspaces).toContain("ws-1");
      expect(probedWorkspaces).toContain("ws-2");
      expect(sink).toHaveBeenCalledWith(
        "ws-1",
        "pi:s1",
        expect.objectContaining({
          source: "registry",
          task: expect.objectContaining({ id: "t-a", status: "completed" }),
        }),
      );
      expect(sink).toHaveBeenCalledWith(
        "ws-2",
        "pi:s2",
        expect.objectContaining({
          source: "registry",
          task: expect.objectContaining({ id: "t-b", status: "completed" }),
        }),
      );
    } finally {
      act(() => {
        setBackgroundTaskUpdateSink(null);
      });
    }
  });

  it("stops probing once every task is terminal (running=0 的会话不入队)", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("no file");
    });
    applyBackgroundTaskUpdate("ws-1", "pi:s1", {
      toolId: "tool-a",
      task: {
        id: "t-a",
        status: "completed",
        outputPath: ".pi/tasks/session-5-5/t-a.output",
      },
      source: "notification",
    });

    renderHook(() =>
      useBackgroundTaskRegistryWatcherForRunningThreads({
        pollMs: 1000,
        staleAfterMs: 30000,
        readFile,
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(readFile).not.toHaveBeenCalled();
  });
});
