// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  liveTokenSnapshot: {
    tokenCount: null as number | null,
    usageUpdatedAt: null as number | null,
  },
}));

vi.mock("../../../layout/hooks/activeCanvasStore", () => ({
  useActiveCanvasSelector: () => mocks.liveTokenSnapshot,
}));

import { WorkingIndicator } from "./WorkingIndicator";

function renderWorking(isThinking = true) {
  return render(
    <WorkingIndicator
      isThinking={isThinking}
      hasItems
      processingStartedAt={Date.now() - 1_000}
    />,
  );
}

describe("WorkingIndicator agent-thinking indicator", () => {
  it("renders an explicit conversation-tail curtain while background tasks await a main-channel continuation", () => {
    const { getByText } = render(
      <WorkingIndicator
        isThinking
        isBackgroundTaskAwaiting
        backgroundTaskRunningCount={2}
        hasItems
        primaryLabel="正在等待 2 个后台任务完成"
      />,
    );

    expect(getByText("正在等待 2 个后台任务完成")).toBeTruthy();
    expect(getByText("任务完成后主对话将自动继续")).toBeTruthy();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the dot-spin grid indicator", () => {
    const { container } = renderWorking();
    const root = container.querySelector(".agent-thinking");
    expect(root).toBeTruthy();
    const dots = container.querySelector(".agent-thinking-dots");
    expect(dots).toBeTruthy();
    expect(dots?.querySelectorAll(".agent-thinking-dot")).toHaveLength(9);
    expect(
      container.querySelector(".working-text")?.textContent ?? "",
    ).toContain("响应中");
  });

  it("anchors the clock to the turn start and advances it in place", () => {
    const { container } = renderWorking();
    const clock = container.querySelector(".working-timer-clock");
    expect(clock).toBeTruthy();
    expect(clock?.textContent).toBe("0:01");

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(clock?.textContent).toBe("0:04");
  });

  it("clears the clock interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const { unmount } = renderWorking();
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("hides the indicator when not thinking", () => {
    const { container } = renderWorking(false);
    expect(container.querySelector(".agent-thinking")).toBeNull();
  });
});

describe("WorkingIndicator live tokens", () => {
  beforeEach(() => {
    mocks.liveTokenSnapshot.tokenCount = null;
    mocks.liveTokenSnapshot.usageUpdatedAt = null;
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the timer-only bar when live usage has not arrived", () => {
    const { container } = renderWorking();
    expect(container.querySelector(".working-timer-tokens")).toBeNull();
    expect(container.querySelector(".working-timer-separator")).toBeNull();
    expect(container.querySelector(".working-text")?.textContent).toContain(
      "响应中",
    );
  });

  it("renders compact live tokens beside the timer", () => {
    mocks.liveTokenSnapshot.tokenCount = 5600;
    mocks.liveTokenSnapshot.usageUpdatedAt = Date.now();
    const { container } = renderWorking();
    expect(
      container.querySelector(".working-timer-separator")?.textContent,
    ).toBe("·");
    expect(container.querySelector(".working-timer-tokens")?.textContent).toBe(
      "5.6K tokens",
    );
  });

  it("hides leftover tokens from the previous turn", () => {
    const processingStartedAt = Date.now() - 1_000;
    mocks.liveTokenSnapshot.tokenCount = 5600;
    mocks.liveTokenSnapshot.usageUpdatedAt = processingStartedAt - 5_000;
    const { container } = render(
      <WorkingIndicator
        isThinking
        hasItems
        processingStartedAt={processingStartedAt}
      />,
    );
    expect(container.querySelector(".working-timer-tokens")).toBeNull();
  });
});
