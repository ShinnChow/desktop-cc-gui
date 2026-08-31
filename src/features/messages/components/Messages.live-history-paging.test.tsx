// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ConversationItem } from "../../../types";
import { Messages } from "./Messages";
import {
  getMessagesScroller,
  setScrollerMetrics,
} from "./MessagesLiveBehaviorTestSetup";

vi.mock("./Markdown", () => ({
  Markdown: ({ value, className }: { value: string; className?: string }) => (
    <div className={className}>{value}</div>
  ),
}));

// History collapsing ships effectively disabled in production (window = 10000).
// These behavior tests exercise the collapse/expand logic at its original
// threshold; only the three >30-item cases below are affected.
vi.mock("../utils/messagesRenderUtils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../utils/messagesRenderUtils")>();
  return {
    ...actual,
    VISIBLE_MESSAGE_WINDOW: 30,
  };
});

describe("Messages live behavior", () => {
  it("reveals the full collapsed segment in one page when the remainder fits a page", async () => {
    const items: ConversationItem[] = Array.from(
      { length: 32 },
      (_, index) => ({
        id: `history-reveal-${index + 1}`,
        kind: "message",
        role: index % 2 === 0 ? "user" : "assistant",
        text: `history reveal message ${index + 1}`,
      }),
    );

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-history-reveal"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    setScrollerMetrics(scroller, 420, () =>
      container.querySelector(".messages-collapsed-indicator") ? 2400 : 2560,
    );

    const indicator = container.querySelector(".messages-collapsed-indicator");
    expect(indicator).toBeTruthy();
    if (!indicator) {
      return;
    }

    fireEvent.click(indicator);

    await waitFor(() => {
      expect(
        container.querySelector(".messages-collapsed-indicator"),
      ).toBeNull();
      expect(screen.getByText("history reveal message 1")).toBeTruthy();
      // 分页展开不跳屏：scrollTop = 原值 + 插入高度（2560-2400），不再回顶。
      expect(scroller.scrollTop).toBe(420 + (2560 - 2400));
    });
  });

  it("pages collapsed history upward in bounded steps without moving the viewport", async () => {
    const items: ConversationItem[] = Array.from(
      { length: 130 },
      (_, index) => ({
        id: `paged-history-${index + 1}`,
        kind: "message",
        role: index % 2 === 0 ? "user" : "assistant",
        text: `paged history message ${index + 1}`,
      }),
    );

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-paged-history"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const collapsedCount = () => {
      const chip = container.querySelector(".messages-collapsed-indicator");
      return chip ? Number(chip.getAttribute("data-collapsed-count")) : 0;
    };
    const scroller = getMessagesScroller(container);
    // 每条消息 8px：scrollHeight 随已展开条数增长。
    setScrollerMetrics(
      scroller,
      420,
      () => 2400 + (100 - collapsedCount()) * 8,
    );

    // 130 条、窗口 30：初始收起 100 条，可见头部是第 101 条。
    expect(collapsedCount()).toBe(100);
    const headRowBefore = container.querySelector(
      '[data-message-anchor-id="paged-history-101"]',
    );
    expect(headRowBefore).toBeTruthy();

    const expectedCounts = [70, 40, 10, 0];
    let expectedScrollTop = 420;
    let previousScrollHeight = 2400;
    for (const expectedCount of expectedCounts) {
      const indicator = container.querySelector(
        ".messages-collapsed-indicator",
      );
      expect(indicator).toBeTruthy();
      if (!indicator) {
        return;
      }
      fireEvent.click(indicator);
      await waitFor(() => {
        expect(collapsedCount()).toBe(expectedCount);
      });
      const nextScrollHeight = 2400 + (100 - expectedCount) * 8;
      expectedScrollTop += nextScrollHeight - previousScrollHeight;
      previousScrollHeight = nextScrollHeight;
      // 视口锚定：每次翻页 scrollTop 正好补偿插入高度，屏幕内容不动。
      expect(scroller.scrollTop).toBe(expectedScrollTop);
    }

    expect(container.querySelector(".messages-collapsed-indicator")).toBeNull();
    expect(screen.getByText("paged history message 1")).toBeTruthy();
    // 投影 key 稳定：跨越 4 次翻页始终保留的行不 remount。
    expect(
      container.querySelector('[data-message-anchor-id="paged-history-101"]'),
    ).toBe(headRowBefore);
  });

  it("reveals one history page per click during streaming", async () => {
    const items: ConversationItem[] = Array.from(
      { length: 130 },
      (_, index) => ({
        id: `live-history-reveal-${index + 1}`,
        kind: "message",
        role: index % 2 === 0 ? "user" : "assistant",
        text: `live history reveal message ${index + 1}`,
      }),
    );

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-live-history-reveal"
        workspaceId="ws-1"
        isThinking
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const indicator = container.querySelector(".messages-collapsed-indicator");
    expect(indicator).toBeTruthy();
    expect(screen.queryByText("live history reveal message 1")).toBeNull();
    if (!indicator) {
      return;
    }

    fireEvent.click(indicator);

    await waitFor(() => {
      // 流式中也是按页展开：收起数 100 → 70，chip 仍在；新可见头部是第 71 条。
      const chip = container.querySelector(".messages-collapsed-indicator");
      expect(chip?.getAttribute("data-collapsed-count")).toBe("70");
      expect(screen.getByText("live history reveal message 71")).toBeTruthy();
      expect(screen.queryByText("live history reveal message 70")).toBeNull();
    });
  });

  it("keeps paged history expansion stable even when scroller metrics are non-finite", async () => {
    const items: ConversationItem[] = Array.from(
      { length: 32 },
      (_, index) => ({
        id: `history-reveal-invalid-${index + 1}`,
        kind: "message",
        role: index % 2 === 0 ? "user" : "assistant",
        text: `history reveal invalid message ${index + 1}`,
      }),
    );

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-history-reveal-invalid"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    setScrollerMetrics(scroller, 420, Number.NaN);

    const indicator = container.querySelector(".messages-collapsed-indicator");
    expect(indicator).toBeTruthy();
    if (!indicator) {
      return;
    }

    fireEvent.click(indicator);

    await waitFor(() => {
      expect(
        container.querySelector(".messages-collapsed-indicator"),
      ).toBeNull();
      expect(screen.getByText("history reveal invalid message 1")).toBeTruthy();
      // 非有限 metrics：跳过锚点恢复，scrollTop 保持原样，不写 NaN。
      expect(scroller.scrollTop).toBe(420);
    });
  });

  it("freezes the history window while the user reads scrolled-up history", async () => {
    const buildItems = (count: number): ConversationItem[] =>
      Array.from({ length: count }, (_, index) => ({
        id: `frozen-history-${index + 1}`,
        kind: "message" as const,
        role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
        text: `frozen history message ${index + 1}`,
      }));
    // 追加段全部是 assistant 流式条目：新增 user message 会触发 send 强制回底
    // （既有产品行为，等同用户回到底部），不在冻结保护范围内。
    const streamingTail: ConversationItem[] = Array.from(
      { length: 20 },
      (_, index) => ({
        id: `frozen-history-tail-${index + 1}`,
        kind: "message" as const,
        role: "assistant" as const,
        text: `frozen history tail ${index + 1}`,
      }),
    );

    const { container, rerender } = render(
      <Messages
        items={buildItems(130)}
        threadId="thread-frozen-history"
        workspaceId="ws-1"
        isThinking
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const collapsedCount = () => {
      const chip = container.querySelector(".messages-collapsed-indicator");
      return chip ? Number(chip.getAttribute("data-collapsed-count")) : 0;
    };
    expect(collapsedCount()).toBe(100);

    const scroller = getMessagesScroller(container);
    setScrollerMetrics(scroller, 400, 2400);
    // 用户上翻阅读旧历史 → 离底。
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);

    const headRowBefore = container.querySelector(
      '[data-message-anchor-id="frozen-history-101"]',
    );
    expect(headRowBefore).toBeTruthy();

    // 流式继续追加 20 条：窗口必须冻结，不得裁掉用户正在读的区段。
    rerender(
      <Messages
        items={[...buildItems(130), ...streamingTail]}
        threadId="thread-frozen-history"
        workspaceId="ws-1"
        isThinking
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(collapsedCount()).toBe(100);
    expect(
      container.querySelector('[data-message-anchor-id="frozen-history-101"]'),
    ).toBe(headRowBefore);
  });
});
