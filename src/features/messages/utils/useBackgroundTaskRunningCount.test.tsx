/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  applyBackgroundTaskUpdate,
  resetBackgroundTaskStoreForTests,
} from "./backgroundTaskStore";
import { useBackgroundTaskRunningCount } from "./useBackgroundTaskRunningCount";

const WORKSPACE_ID = "workspace-1";
const THREAD_ID = "thread-1";
const TASK_ID = "task-1";

describe("useBackgroundTaskRunningCount", () => {
  beforeEach(() => {
    resetBackgroundTaskStoreForTests();
  });

  it("keeps an already-rendered running task card as an awaiting source", () => {
    const item = (status: string): ConversationItem => ({
      id: "background-task-item-1",
      kind: "tool",
      toolType: "backgroundTask",
      title: "bg_run",
      detail: "",
      status,
      output: "",
    });
    const { result, rerender } = renderHook(
      ({ items }) => useBackgroundTaskRunningCount(null, null, items),
      { initialProps: { items: [item("running")] } },
    );

    expect(result.current).toBe(1);
    rerender({ items: [item("completed")] });
    expect(result.current).toBe(0);
  });

  it("updates from the live task store as a task starts and reaches a terminal state", () => {
    const { result } = renderHook(() =>
      useBackgroundTaskRunningCount(WORKSPACE_ID, THREAD_ID),
    );

    expect(result.current).toBe(0);

    act(() => {
      applyBackgroundTaskUpdate(WORKSPACE_ID, THREAD_ID, {
        toolId: "tool-1",
        source: "notification",
        task: { id: TASK_ID, status: "running" },
      });
    });
    expect(result.current).toBe(1);

    act(() => {
      applyBackgroundTaskUpdate(WORKSPACE_ID, THREAD_ID, {
        toolId: "tool-1",
        source: "notification",
        task: { id: TASK_ID, status: "completed", exitCode: 0 },
      });
    });
    expect(result.current).toBe(0);
  });
});
