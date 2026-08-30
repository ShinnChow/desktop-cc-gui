import { describe, expect, it } from "vitest";
import { projectSidebarThreadStatus } from "./useSidebarThreadStatusProjection";

describe("projectSidebarThreadStatus", () => {
  it("projects only the sidebar-relevant boolean flags", () => {
    const projected = projectSidebarThreadStatus(null, {
      "t-1": {
        isProcessing: true,
        hasUnread: false,
        isReviewing: false,
      },
    });
    expect(projected).toEqual({
      "t-1": {
        isProcessing: true,
        hasUnread: false,
        isReviewing: false,
        backgroundTaskRunningCount: 0,
      },
    });
  });

  it("reuses the previous reference when only non-projected fields change", () => {
    const first = projectSidebarThreadStatus(null, {
      "t-1": { isProcessing: true, hasUnread: false, isReviewing: false },
    });
    // 模拟 heartbeatPulse 等字段变化：源对象换引用，但布尔位不变。
    const second = projectSidebarThreadStatus(first, {
      "t-1": { isProcessing: true, hasUnread: false, isReviewing: false },
    });
    expect(second).toBe(first);
  });

  it("returns a new reference when any boolean flag flips", () => {
    const first = projectSidebarThreadStatus(null, {
      "t-1": { isProcessing: true, hasUnread: false, isReviewing: false },
    });
    const second = projectSidebarThreadStatus(first, {
      "t-1": { isProcessing: false, hasUnread: true, isReviewing: false },
    });
    expect(second).not.toBe(first);
    expect(second["t-1"]).toEqual({
      isProcessing: false,
      hasUnread: true,
      isReviewing: false,
      backgroundTaskRunningCount: 0,
    });
  });

  it("returns a new reference when threads are added or removed", () => {
    const first = projectSidebarThreadStatus(null, {
      "t-1": { isProcessing: false, hasUnread: false, isReviewing: false },
    });
    const withAdded = projectSidebarThreadStatus(first, {
      "t-1": { isProcessing: false, hasUnread: false, isReviewing: false },
      "t-2": { isProcessing: true, hasUnread: false, isReviewing: false },
    });
    expect(withAdded).not.toBe(first);
    // 未变化的行保持行级引用稳定，便于行级 memo。
    expect(withAdded["t-1"]).toBe(first["t-1"]);

    const withRemoved = projectSidebarThreadStatus(withAdded, {
      "t-2": { isProcessing: true, hasUnread: false, isReviewing: false },
    });
    expect(withRemoved).not.toBe(withAdded);
    expect(Object.keys(withRemoved)).toEqual(["t-2"]);
  });

  it("treats missing flags as false", () => {
    const projected = projectSidebarThreadStatus(null, { "t-1": {} });
    expect(projected["t-1"]).toEqual({
      isProcessing: false,
      hasUnread: false,
      isReviewing: false,
      backgroundTaskRunningCount: 0,
    });
  });

  it("tracks the background task running count as the fourth projected field", () => {
    const first = projectSidebarThreadStatus(null, {
      "t-1": { isProcessing: false, hasUnread: false, isReviewing: false },
    });
    const withTasks = projectSidebarThreadStatus(first, {
      "t-1": {
        isProcessing: false,
        hasUnread: false,
        isReviewing: false,
        backgroundTaskRunningCount: 2,
      },
    });
    expect(withTasks).not.toBe(first);
    expect(withTasks["t-1"]?.backgroundTaskRunningCount).toBe(2);

    // 计数不变时行级引用稳定（三布尔同、count 同 → 复用）。
    const unchanged = projectSidebarThreadStatus(withTasks, {
      "t-1": {
        isProcessing: false,
        hasUnread: false,
        isReviewing: false,
        backgroundTaskRunningCount: 2,
      },
    });
    expect(unchanged["t-1"]).toBe(withTasks["t-1"]);

    // 计数变化（即使三布尔不变）必须换行级引用，否则行内徽标不更新。
    const drained = projectSidebarThreadStatus(unchanged, {
      "t-1": {
        isProcessing: false,
        hasUnread: false,
        isReviewing: false,
        backgroundTaskRunningCount: 0,
      },
    });
    expect(drained["t-1"]).not.toBe(unchanged["t-1"]);
    expect(drained["t-1"]?.backgroundTaskRunningCount).toBe(0);
  });
});
