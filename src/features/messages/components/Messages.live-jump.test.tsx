// @vitest-environment jsdom
import {
  act,
  render,
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
import { getMessagesScroller } from "./MessagesLiveBehaviorTestSetup";

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
  it("scrolls the messages container when receiving a jump-to-message event", () => {
    const items: ConversationItem[] = [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "older",
      },
      {
        id: "u2",
        kind: "message",
        role: "user",
        text: "latest",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-jump"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    const scrollToSpy = vi.spyOn(scroller, "scrollTo");
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 720,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      value: 240,
      writable: true,
    });
    Object.defineProperty(scroller, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 120 }),
    });

    const targetNode = container.querySelector('[data-message-anchor-id="u2"]');
    expect(targetNode).toBeTruthy();
    Object.defineProperty(
      targetNode as HTMLDivElement,
      "getBoundingClientRect",
      {
        configurable: true,
        value: () => ({ top: 480 }),
      },
    );

    act(() => {
      document.dispatchEvent(
        new CustomEvent<string>("ccgui:jump-to-message", {
          detail: "u2",
        }),
      );
    });

    expect(scrollToSpy).toHaveBeenCalledWith({
      top: Math.max(0, 240 + (480 - 120) - 720 * 0.28),
      behavior: "smooth",
    });
  });

  it("ignores the retired mossx jump event name after the ccgui event migration", () => {
    const items: ConversationItem[] = [
      {
        id: "u1",
        kind: "message",
        role: "user",
        text: "older",
      },
      {
        id: "u2",
        kind: "message",
        role: "user",
        text: "latest",
      },
    ];

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-jump-retired-event"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    const scrollToSpy = vi.spyOn(scroller, "scrollTo");

    act(() => {
      document.dispatchEvent(
        new CustomEvent<string>("mossx:jump-to-message", {
          detail: "u2",
        }),
      );
    });

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("expands collapsed history before jumping to an older message", async () => {
    const items: ConversationItem[] = Array.from(
      { length: 35 },
      (_, index) => ({
        id: `u${index + 1}`,
        kind: "message" as const,
        role: "user" as const,
        text: `message ${index + 1}`,
      }),
    );

    const { container } = render(
      <Messages
        items={items}
        threadId="thread-jump-collapsed"
        workspaceId="ws-1"
        isThinking={false}
        activeEngine="claude"
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(container.querySelector('[data-message-anchor-id="u1"]')).toBeNull();
    const showEarlierButton = container.querySelector(
      ".messages-collapsed-indicator",
    );
    expect(showEarlierButton).toBeTruthy();
    expect(showEarlierButton?.getAttribute("data-collapsed-count")).toBe("5");

    const scroller = getMessagesScroller(container);
    const scrollToSpy = vi.spyOn(scroller, "scrollTo");
    Object.defineProperty(scroller, "clientHeight", {
      configurable: true,
      value: 720,
    });
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      value: 180,
      writable: true,
    });
    Object.defineProperty(scroller, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 120 }),
    });

    act(() => {
      document.dispatchEvent(
        new CustomEvent<string>("ccgui:jump-to-message", {
          detail: "u1",
        }),
      );
    });

    await waitFor(() => {
      expect(
        container.querySelector('[data-message-anchor-id="u1"]'),
      ).toBeTruthy();
    });

    await waitFor(() => {
      expect(scrollToSpy).toHaveBeenCalled();
    });
    expect(scrollToSpy.mock.calls.at(-1)?.[0]).toMatchObject({
      behavior: "smooth",
    });
  });
});
