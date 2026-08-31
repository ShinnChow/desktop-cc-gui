// Shared setup for the Messages live behavior test slices. Each
// Messages.live-*.test.tsx file imports this module, which registers the
// common hooks and exposes the scroller/observer helpers the tests drive.
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, vi } from "vitest";

// jsdom never lays anything out, so its ResizeObserver mock never fires. Messages
// drives bottom-follow off content-height changes, so tests need to fire it by hand.
export const resizeObserverCallbacks: Array<() => void> = [];
export const notifyContentResized = () => {
  act(() => {
    for (const callback of [...resizeObserverCallbacks]) {
      callback();
    }
  });
};

// 新跟随模型的 RO/followSignal 追底统一由 pinIfFollowing 合并到下一 rAF 落位，
// 断言 scrollTop 前需要先推进一帧（fake timers 用例内请改用 advanceTimersByTime）。
export const flushFollowFrame = async () => {
  await act(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });
};

afterEach(() => {
  cleanup();
  resizeObserverCallbacks.length = 0;
});

beforeEach(() => {
  window.localStorage.setItem("ccgui.claude.hideReasoningModule", "0");
  window.localStorage.removeItem("ccgui.messages.live.autoFollow");
  window.localStorage.setItem("ccgui.messages.live.collapseMiddleSteps", "0");
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeObserverCallbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  }
  if (!HTMLElement.prototype.scrollTo) {
    HTMLElement.prototype.scrollTo = vi.fn();
  }
});

export const getMessagesScroller = (container: HTMLElement) => {
  const scroller = container.querySelector(".messages");
  expect(scroller).toBeTruthy();
  return scroller as HTMLDivElement;
};

export const setScrollerMetrics = (
  scroller: HTMLDivElement,
  scrollTop: number,
  scrollHeight: number | (() => number) = 2400,
) => {
  let currentScrollTop = scrollTop;
  let scrollTopWriteCount = 0;
  const readScrollHeight = () =>
    typeof scrollHeight === "function" ? scrollHeight() : scrollHeight;
  Object.defineProperty(scroller, "scrollTop", {
    configurable: true,
    get: () => currentScrollTop,
    set: (value: number) => {
      // jsdom 不做布局钳位；按浏览器语义把写入钳到 [0, maxScrollTop]
      // （scrollToBottom 写的是 scrollHeight，真实浏览器会钳回底）。
      const maxScrollTop = readScrollHeight() - scroller.clientHeight;
      currentScrollTop = Number.isFinite(maxScrollTop)
        ? Math.max(0, Math.min(value, Math.max(0, maxScrollTop)))
        : value;
      scrollTopWriteCount += 1;
    },
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: 720,
  });
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    get: () =>
      typeof scrollHeight === "function" ? scrollHeight() : scrollHeight,
  });
  return {
    getScrollTopWriteCount: () => scrollTopWriteCount,
  };
};

export const setMessageOffsetTop = (
  container: HTMLElement,
  messageId: string,
  offsetTop: number,
) => {
  const message = container.querySelector(
    `[data-message-anchor-id="${messageId}"]`,
  );
  expect(message).toBeTruthy();
  Object.defineProperty(message, "offsetTop", {
    configurable: true,
    value: offsetTop,
  });
  Object.defineProperty(message, "getBoundingClientRect", {
    configurable: true,
    value: () => {
      const scroller = (message as HTMLElement).closest(
        ".messages.scrollable",
      ) as HTMLElement | null;
      const scrollerTop = scroller?.getBoundingClientRect().top ?? 0;
      const scrollTop = scroller?.scrollTop ?? 0;
      return { top: scrollerTop + offsetTop - scrollTop };
    },
  });
};

export const getActiveAnchorDashIndex = (container: HTMLElement) =>
  [...container.querySelectorAll(".messages-anchor-dash")].findIndex((dash) =>
    dash.classList.contains("is-active"),
  );
