/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyBackgroundTaskUpdate,
  resetBackgroundTaskStoreForTests,
} from "./backgroundTaskStore";
import { useBackgroundTaskLiveSnapshot } from "./useBackgroundTaskLiveSnapshot";

const WS = "ws-1";
const THREAD = "pi:s1";
const TOOL_ID = "call_a8ca821af3d84629a7dd094c";

describe("useBackgroundTaskLiveSnapshot", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
  });

  it("returns null before any record exists", () => {
    const { result } = renderHook(() =>
      useBackgroundTaskLiveSnapshot(WS, THREAD, TOOL_ID),
    );
    expect(result.current).toBeNull();
  });

  it("tracks the live record through running → killed without timeline updates", () => {
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: TOOL_ID,
      task: {
        id: "b522a07e6",
        name: "task1-sleep60",
        status: "running",
        outputPath: ".pi/tasks/session-x/b522a07e6.output",
        pid: 48169,
      },
      source: "receipt",
    });

    const { result } = renderHook(() =>
      useBackgroundTaskLiveSnapshot(WS, THREAD, TOOL_ID),
    );
    expect(result.current?.task.status).toBe("running");

    // 终态只进 store（时间线 upsert 丢失的运行时场景）——hook 仍必须看到。
    act(() => {
      applyBackgroundTaskUpdate(WS, THREAD, {
        toolId: null,
        task: {
          id: "b522a07e6",
          name: "task1-sleep60",
          status: "killed",
          endTime: 1787882426631,
        },
        source: "registry",
      });
    });
    expect(result.current?.task.status).toBe("killed");
    expect(result.current?.taskId).toBe("b522a07e6");
  });

  it("returns null for another thread's record (scope 隔离)", () => {
    applyBackgroundTaskUpdate(WS, THREAD, {
      toolId: TOOL_ID,
      task: { id: "t-1", status: "running" },
      source: "receipt",
    });
    const { result } = renderHook(() =>
      useBackgroundTaskLiveSnapshot(WS, "pi:other", TOOL_ID),
    );
    expect(result.current).toBeNull();
  });
});
