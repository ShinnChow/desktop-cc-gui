// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isWindowsPlatform: vi.fn(),
  liveTokenSnapshot: {
    tokenCount: null as number | null,
    usageUpdatedAt: null as number | null,
  },
}));

vi.mock("../../../../utils/platform", () => ({
  isWindowsPlatform: mocks.isWindowsPlatform,
}));

vi.mock("../../../layout/hooks/activeCanvasStore", () => ({
  useActiveCanvasSelector: () => mocks.liveTokenSnapshot,
}));

import {
  WorkingIndicator,
  WORKING_GLYPH_FRAME_MS,
  WORKING_GLYPH_FRAMES,
} from "./WorkingIndicator";

function renderWorking(isThinking = true) {
  return render(
    <WorkingIndicator
      isThinking={isThinking}
      hasItems
      processingStartedAt={Date.now() - 1_000}
    />,
  );
}

describe("WorkingIndicator spinner platform split", () => {
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
    mocks.isWindowsPlatform.mockReset();
    mocks.isWindowsPlatform.mockReturnValue(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("uses SVG dash on Mac and other non-Windows platforms", () => {
    mocks.isWindowsPlatform.mockReturnValue(false);
    const { container } = renderWorking();
    const spinner = container.querySelector(".working-spinner");
    expect(spinner).toBeTruthy();
    expect(spinner?.tagName.toLowerCase()).toBe("svg");
    expect(spinner?.classList.contains("working-spinner-dash")).toBe(true);
    expect(spinner?.classList.contains("working-spinner-glyph")).toBe(false);
    expect(spinner?.querySelector("circle")).toBeTruthy();
  });

  it("uses glyph frames on Windows and advances textContent without ticking the timer", () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    const { container } = renderWorking();
    const spinner = container.querySelector(".working-spinner-glyph");
    const clock = container.querySelector(".working-timer-clock");
    expect(spinner).toBeTruthy();
    expect(spinner?.classList.contains("working-spinner")).toBe(true);
    expect(spinner?.classList.contains("working-spinner-dash")).toBe(false);
    expect(spinner?.textContent).toBe(WORKING_GLYPH_FRAMES[0]);
    const clockBefore = clock?.textContent;

    act(() => {
      vi.advanceTimersByTime(WORKING_GLYPH_FRAME_MS);
    });

    expect(spinner?.textContent).toBe(WORKING_GLYPH_FRAMES[1]);
    expect(clock?.textContent).toBe(clockBefore);
  });

  it("clears the glyph interval on unmount", () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const { unmount } = renderWorking();
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("hides the spinner when not thinking", () => {
    mocks.isWindowsPlatform.mockReturnValue(true);
    const { container } = renderWorking(false);
    expect(container.querySelector(".working-spinner")).toBeNull();
  });
});

describe("WorkingIndicator live tokens", () => {
  beforeEach(() => {
    mocks.isWindowsPlatform.mockReturnValue(false);
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
