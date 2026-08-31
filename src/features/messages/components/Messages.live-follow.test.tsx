// @vitest-environment jsdom
import {
  act,
  fireEvent,
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
import { MESSAGES_LIVE_CONTROLS_UPDATED_EVENT } from "../../../live-canvas/liveCanvasControls";
import { Messages } from "./Messages";
import {
  flushFollowFrame,
  getActiveAnchorDashIndex,
  getMessagesScroller,
  notifyContentResized,
  resizeObserverCallbacks,
  setMessageOffsetTop,
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
  it("disables auto-follow scrolling when live auto-follow toggle is off", () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "0");
    const { container, rerender } = render(
      <Messages
        items={[
          {
            id: "assistant-live-scroll-1",
            kind: "message",
            role: "assistant",
            text: "first chunk",
          },
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    const scroller = getMessagesScroller(container);
    const metrics = setScrollerMetrics(scroller, 400, 2_000);
    const baselineWrites = metrics.getScrollTopWriteCount();

    rerender(
      <Messages
        items={[
          {
            id: "assistant-live-scroll-1",
            kind: "message",
            role: "assistant",
            text: "first chunk",
          },
          {
            id: "assistant-live-scroll-2",
            kind: "message",
            role: "assistant",
            text: "second chunk",
          },
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(metrics.getScrollTopWriteCount()).toBe(baselineWrites);
  });

  it("forces send but not settle to the bottom after user scroll-away with live auto-follow off", () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "0");
    const renderWith = (thinking: boolean) => (
      <Messages
        items={[
          {
            id: "boundary-force-assistant",
            kind: "message",
            role: "assistant",
            text: thinking ? "streaming" : "settled",
          },
        ]}
        threadId="thread-boundary-force"
        workspaceId="ws-1"
        isThinking={thinking}
        processingStartedAt={thinking ? Date.now() - 1_000 : null}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(renderWith(false));
    const scroller = getMessagesScroller(container);
    let scrollHeight = 2_400;
    setScrollerMetrics(scroller, 400, () => scrollHeight);
    fireEvent.wheel(scroller, { deltaY: -120 });
    fireEvent.scroll(scroller);

    // 边沿前的 user intent 与 preference 不得阻止 send placement。
    rerender(renderWith(true));
    expect(scroller.scrollTop).toBe(scrollHeight - 720);

    // Streaming 期间仍允许用户解除 continuous follow。
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    notifyContentResized();
    expect(scroller.scrollTop).toBe(400);

    // settle：用户 wheel 暂停读历史时不拽回；未 pause 则强制回底。
    rerender(renderWith(false));
    expect(scroller.scrollTop).toBe(400);

    // boundary 之后的新输入拥有控制权，必须能取消迟到 recheck。
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    scrollHeight = 3_200;
    notifyContentResized();
    expect(scroller.scrollTop).toBe(400);
  });

  it("forces a queued user message to the bottom while the current turn stays working", () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "0");
    const renderWith = (includeQueuedUser: boolean) => (
      <Messages
        items={[
          {
            id: "queued-send-user-1",
            kind: "message",
            role: "user",
            text: "first",
          },
          {
            id: "queued-send-assistant-1",
            kind: "message",
            role: "assistant",
            text: "streaming",
          },
          ...(includeQueuedUser
            ? [
                {
                  id: "queued-handoff-message-2",
                  kind: "message" as const,
                  role: "user" as const,
                  text: "second",
                },
              ]
            : []),
        ]}
        threadId="thread-queued-send-boundary"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(renderWith(false));
    const scroller = getMessagesScroller(container);
    setScrollerMetrics(scroller, 400, 2400);
    fireEvent.wheel(scroller, { deltaY: -120 });
    fireEvent.scroll(scroller);

    rerender(renderWith(true));

    expect(scroller.scrollTop).toBe(2400 - 720);
  });

  it("does not repeat send placement when working starts after the optimistic user bubble", () => {
    const renderWith = (includeOptimisticUser: boolean, thinking: boolean) => (
      <Messages
        items={[
          {
            id: "delayed-working-user-1",
            kind: "message",
            role: "user",
            text: "first",
          },
          {
            id: "delayed-working-assistant-1",
            kind: "message",
            role: "assistant",
            text: "settled",
            isFinal: true,
          },
          ...(includeOptimisticUser
            ? [
                {
                  id: "optimistic-user-delayed-working",
                  kind: "message" as const,
                  role: "user" as const,
                  text: "second",
                },
              ]
            : []),
        ]}
        threadId="thread-delayed-working-boundary"
        workspaceId="ws-1"
        isThinking={thinking}
        processingStartedAt={thinking ? Date.now() - 1_000 : null}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(renderWith(false, false));
    const scroller = getMessagesScroller(container);
    setScrollerMetrics(scroller, 400, 2400);

    rerender(renderWith(true, false));
    expect(scroller.scrollTop).toBe(2400 - 720);

    // optimistic bubble 后的新用户滚动，不能被随后到达的 working 状态重复覆盖。
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    rerender(renderWith(true, true));
    expect(scroller.scrollTop).toBe(400);
  });

  it("stops auto-follow after the user scrolls up, then resumes at the bottom", async () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const renderWith = (extraChunk: boolean) => (
      <Messages
        items={[
          {
            id: "assistant-live-follow-1",
            kind: "message",
            role: "assistant",
            text: "first chunk",
          },
          ...(extraChunk
            ? [
                {
                  id: "assistant-live-follow-2",
                  kind: "message" as const,
                  role: "assistant" as const,
                  text: "second chunk",
                },
              ]
            : []),
        ]}
        threadId="thread-1"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(renderWith(false));

    const scroller = getMessagesScroller(container);
    // User scrolls up (wheel 租约 + 离底位置) — auto-follow must release.
    // 仅改 scrollTop 不发 wheel 会被当成内容长高假离底，不得解绑。
    setScrollerMetrics(scroller, 400, 2000);
    fireEvent.wheel(scroller, { deltaY: -120 });
    fireEvent.scroll(scroller);

    rerender(renderWith(true));
    await Promise.resolve();
    expect(scroller.scrollTop).toBe(400);

    // User scrolls back to the bottom — auto-follow re-arms.
    // 新契约：userPaused 锁只能被 wheel 下滚回阈值内解除（设 scrollTop + scroll 无权覆盖）。
    rerender(renderWith(false));
    let scrollHeight = 2000;
    setScrollerMetrics(scroller, 1280, () => scrollHeight); // true bottom
    fireEvent.wheel(scroller, { deltaY: 120 });
    await flushFollowFrame();

    rerender(renderWith(true));
    scrollHeight = 2500;
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(2500 - 720);
  });

  it("keeps the latest anchor stable at the bottom and tracks the viewport after scroll-away", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const { container } = render(
        <Messages
          items={[
            {
              id: "anchor-user-old",
              kind: "message",
              role: "user",
              text: "older",
            },
            {
              id: "anchor-assistant-old",
              kind: "message",
              role: "assistant",
              text: "reply",
            },
            {
              id: "anchor-user-latest",
              kind: "message",
              role: "user",
              text: "latest",
            },
          ]}
          threadId="thread-bottom-anchor-stability"
          workspaceId="ws-1"
          isThinking
          activeEngine="codex"
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );
      const scroller = getMessagesScroller(container);
      setMessageOffsetTop(container, "anchor-user-old", 1_760);
      setMessageOffsetTop(container, "anchor-user-latest", 320);

      // At the true bottom, transient virtual-row geometry must not pull the
      // active state back to an older anchor.
      setScrollerMetrics(scroller, 1_680, 2_400);
      for (let index = 0; index < 12; index += 1) {
        fireEvent.scroll(scroller);
      }
      await waitFor(() => expect(getActiveAnchorDashIndex(container)).toBe(1));

      // Once the user leaves the bottom, preserve the existing viewport probe.
      scroller.scrollTop = 400;
      setMessageOffsetTop(container, "anchor-user-old", 480);
      setMessageOffsetTop(container, "anchor-user-latest", 1_760);
      fireEvent.scroll(scroller);
      await waitFor(() => expect(getActiveAnchorDashIndex(container)).toBe(0));

      const updateDepthErrors = consoleErrorSpy.mock.calls.filter((call) =>
        call.some((entry) =>
          String(entry).includes("Maximum update depth exceeded"),
        ),
      );
      expect(updateDepthErrors).toHaveLength(0);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("re-arms auto-follow and returns to the bottom when focus follow is re-enabled", async () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "0");
    const renderWith = (extraChunk: boolean) => (
      <Messages
        items={[
          {
            id: "assistant-live-rearm-1",
            kind: "message",
            role: "assistant",
            text: "first chunk",
          },
          ...(extraChunk
            ? [
                {
                  id: "assistant-live-rearm-2",
                  kind: "message" as const,
                  role: "assistant" as const,
                  text: "second chunk",
                },
              ]
            : []),
        ]}
        threadId="thread-live-follow-rearm"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(renderWith(false));

    const scroller = getMessagesScroller(container);
    let scrollHeight = 2000;
    setScrollerMetrics(scroller, 400, () => scrollHeight);
    fireEvent.scroll(scroller);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(MESSAGES_LIVE_CONTROLS_UPDATED_EVENT, {
          detail: { liveAutoFollowEnabled: true },
        }),
      );
    });

    // Re-arming snaps the viewport back to the true bottom.
    expect(scroller.scrollTop).toBe(2000 - 720);

    rerender(renderWith(true));
    scrollHeight = 2500;
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(2500 - 720);
  });

  it("cancels pending live rechecks when focus follow is disabled", () => {
    vi.useFakeTimers();
    try {
      window.localStorage.setItem("ccgui.messages.live.autoFollow", "0");
      const { container } = render(
        <Messages
          items={[
            {
              id: "assistant-live-cancel-recheck",
              kind: "message",
              role: "assistant",
              text: "streaming",
            },
          ]}
          threadId="thread-live-cancel-recheck"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );
      const scroller = getMessagesScroller(container);
      let scrollHeight = 2_000;
      setScrollerMetrics(scroller, 400, () => scrollHeight);
      fireEvent.scroll(scroller);

      act(() => {
        window.dispatchEvent(
          new CustomEvent(MESSAGES_LIVE_CONTROLS_UPDATED_EVENT, {
            detail: { liveAutoFollowEnabled: true },
          }),
        );
      });
      expect(scroller.scrollTop).toBe(2_000 - 720);

      act(() => {
        window.dispatchEvent(
          new CustomEvent(MESSAGES_LIVE_CONTROLS_UPDATED_EVENT, {
            detail: { liveAutoFollowEnabled: false },
          }),
        );
      });
      scrollHeight = 3_000;
      act(() => {
        vi.advanceTimersByTime(2_100);
      });

      expect(scroller.scrollTop).toBe(2_000 - 720);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not thrash scrollTop when focus follow chases a fast-growing stream", async () => {
    // 快流：scrollKey + 连续 Resize 不得 cancel/restart 整条收敛；应复用 active run + 有限次写底。
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const { container } = render(
      <Messages
        items={[
          {
            id: "fast-stream-assistant",
            kind: "message",
            role: "assistant",
            text: "streaming fast",
          },
        ]}
        threadId="thread-fast-stream-stick"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    const scroller = getMessagesScroller(container);
    let scrollHeight = 2_000;
    const metrics = setScrollerMetrics(
      scroller,
      2_000 - 720,
      () => scrollHeight,
    );
    fireEvent.scroll(scroller);
    notifyContentResized();
    const writesAfterArm = metrics.getScrollTopWriteCount();

    for (let step = 0; step < 12; step += 1) {
      scrollHeight += 80;
      notifyContentResized();
    }
    // 再冲一帧，让可能存在的 live-follow coalesce rAF 落地。
    await act(async () => {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    });

    expect(scroller.scrollTop).toBe(scrollHeight - 720);
    // 12 次增高：理想是每次约 1 次 write。若每次 cancel/restart 整段 pulse，
    // 会远超 12（首帧 + settle 帧 + recheck 重建）。允许 rAF 与 nudge 偶发双写的余量。
    const writesDuringChase = metrics.getScrollTopWriteCount() - writesAfterArm;
    expect(writesDuringChase).toBeGreaterThan(0);
    expect(writesDuringChase).toBeLessThanOrEqual(28);
  });

  it("keeps stick-to-bottom after settle when focus follow is on and content grows late", () => {
    // 回合结束后思考折叠 / full markdown / 虚拟化 remeasure 会继续改 scrollHeight。
    // 焦点跟随 + 仍停在底部时，必须越过 isWorking 门槛继续追真实底部。
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    vi.useFakeTimers();
    try {
      const renderWith = (thinking: boolean) => (
        <Messages
          items={[
            {
              id: "post-settle-stick-user",
              kind: "message",
              role: "user",
              text: "go",
            },
            {
              id: "post-settle-stick-assistant",
              kind: "message",
              role: "assistant",
              text: thinking ? "streaming" : "final answer with taller layout",
            },
          ]}
          threadId="thread-post-settle-stick"
          workspaceId="ws-1"
          isThinking={thinking}
          processingStartedAt={thinking ? Date.now() - 1_000 : null}
          openTargets={[]}
          selectedOpenAppId=""
        />
      );
      const { container, rerender } = render(renderWith(true));
      const scroller = getMessagesScroller(container);
      let scrollHeight = 2_400;
      setScrollerMetrics(scroller, 2_400 - 720, () => scrollHeight);
      fireEvent.scroll(scroller);
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(2_400 - 720);

      // 回合结束：settle 钉底（pinIfFollowing 合并到下一 rAF，fake timers 推进一帧）。
      rerender(renderWith(false));
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(scrollHeight - 720);

      // 迟到测高（思考折叠/全文回刷/虚拟化 remeasure）把 scrollHeight 撑大：
      // 焦点跟随 + 仍停在底部时，必须越过 isWorking 门槛继续追真实底部。
      scrollHeight = 3_600;
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(3_600 - 720);
    } finally {
      vi.useRealTimers();
    }
  });

  it("chases height growth via ResizeObserver while still armed at bottom", () => {
    // jetbrains P0：在底就 RO 一直跟。高度阶跃后不要先 fire 假 scroll 解绑；
    // 只靠 RO 把视口追到新真底。
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    vi.useFakeTimers();
    try {
      const renderWith = (thinking: boolean) => (
        <Messages
          items={[
            {
              id: "fake-leave-user",
              kind: "message",
              role: "user",
              text: "go",
            },
            {
              id: "fake-leave-assistant",
              kind: "message",
              role: "assistant",
              text: thinking
                ? "streaming tail"
                : "final tall answer after full history restore",
            },
          ]}
          threadId="thread-settle-fake-leave"
          workspaceId="ws-1"
          isThinking={thinking}
          processingStartedAt={thinking ? Date.now() - 1_000 : null}
          openTargets={[]}
          selectedOpenAppId=""
        />
      );
      const { container, rerender } = render(renderWith(true));
      const scroller = getMessagesScroller(container);
      let scrollHeight = 2_400;
      setScrollerMetrics(scroller, 2_400 - 720, () => scrollHeight);
      fireEvent.scroll(scroller);
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(2_400 - 720);

      rerender(renderWith(false));
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(scrollHeight - 720);

      scrollHeight = 5_280;
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(5_280 - 720);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-pins when the composer status strip shrinks the container after settle", () => {
    vi.useFakeTimers();
    try {
      const renderWith = (thinking: boolean) => (
        <Messages
          items={[
            {
              id: "settle-shrink-user",
              kind: "message",
              role: "user",
              text: "run",
            },
            {
              id: "settle-shrink-assistant",
              kind: "message",
              role: "assistant",
              text: thinking ? "streaming tail" : "final answer",
            },
          ]}
          threadId="thread-settle-shrink"
          workspaceId="ws-1"
          isThinking={thinking}
          processingStartedAt={thinking ? Date.now() - 1_000 : null}
          openTargets={[]}
          selectedOpenAppId=""
        />
      );
      const { container, rerender } = render(renderWith(true));
      const scroller = getMessagesScroller(container);
      const scrollHeight = 2_400;
      let clientHeight = 720;
      setScrollerMetrics(scroller, scrollHeight - 720, scrollHeight);
      Object.defineProperty(scroller, "clientHeight", {
        configurable: true,
        get: () => clientHeight,
      });
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });

      // settle：先钉到当时的底（rAF 落位）
      rerender(renderWith(false));
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(scrollHeight - 720);

      // Composer 运行态条（「已编辑 N 个文件」）迟到挂载：容器 clientHeight 被压小，
      // scrollTop / scrollHeight 均不变、不派发 scroll 事件。跟随仍武装，
      // RO 信号必须把视口追回新底。
      clientHeight = 620;
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(scrollHeight - 620);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not chase late idle growth when the user has scrolled away from the bottom", () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    vi.useFakeTimers();
    try {
      const { container } = render(
        <Messages
          items={[
            {
              id: "idle-away-assistant",
              kind: "message",
              role: "assistant",
              text: "done",
            },
          ]}
          threadId="thread-idle-away-stick"
          workspaceId="ws-1"
          isThinking={false}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );
      const scroller = getMessagesScroller(container);
      let scrollHeight = 2_400;
      setScrollerMetrics(scroller, 2_400 - 720, () => scrollHeight);
      notifyContentResized();

      fireEvent.wheel(scroller, { deltaY: -120 });
      scroller.scrollTop = 400;
      fireEvent.scroll(scroller);

      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      scrollHeight = 3_600;
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(400);

      // 再滚回底部应恢复 stick。新契约：userPaused 锁只能被 wheel 下滚回阈值内解除
      // （设 scrollTop + scroll 事件在 paused 期间被跳过，无权 re-arm）。
      scroller.scrollTop = 3_600 - 720;
      fireEvent.wheel(scroller, { deltaY: 120 });
      act(() => {
        vi.advanceTimersByTime(20);
      });
      scrollHeight = 4_200;
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(4_200 - 720);
    } finally {
      vi.useRealTimers();
    }
  });

  it("chases late row measurements so opening a thread lands at the true bottom", async () => {
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const { container } = render(
      <Messages
        items={[
          { id: "open-pin-1", kind: "message", role: "user", text: "hello" },
          {
            id: "open-pin-2",
            kind: "message",
            role: "assistant",
            text: "long answer",
          },
        ]}
        threadId="thread-open-pin"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    const scroller = getMessagesScroller(container);

    // Rows land on estimated heights first; the real measurements (virtualizer
    // ResizeObserver / 迟到布局) grow scrollHeight afterwards. A one-shot pin would
    // be stranded — 跟随中的 RO pinIfFollowing 必须把迟到测高追到底（rAF 落位）。
    let scrollHeight = 2400;
    setScrollerMetrics(scroller, 0, () => scrollHeight);
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(2400 - 720);

    scrollHeight = 3600;
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(3600 - 720);
    scrollSpy.mockRestore();
  });

  it("finishes history placement on late geometry via ResizeObserver while follow stays armed", async () => {
    // 迟到测高只靠 RO 通道（无定时 recheck）；RO 的 pinIfFollowing 要求跟随武装
    // （liveAutoFollow 开 && 在底部 && 未暂停），因此本场景保持 follow 开启。
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const renderWith = (items: ConversationItem[], loading: boolean) => (
      <Messages
        items={items}
        threadId="thread-history-focus-off"
        workspaceId="ws-1"
        isThinking={false}
        isHistoryLoading={loading}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const historyItems: ConversationItem[] = [
      {
        id: "history-focus-off-1",
        kind: "message",
        role: "user",
        text: "hello",
      },
      {
        id: "history-focus-off-2",
        kind: "message",
        role: "assistant",
        text: "late measured answer",
      },
    ];
    const { container, rerender } = render(renderWith([], true));
    const scroller = getMessagesScroller(container);
    let scrollHeight = 2_400;
    setScrollerMetrics(scroller, 0, () => scrollHeight);

    rerender(renderWith(historyItems, false));
    expect(scroller.scrollTop).toBe(2_400 - 720);

    scrollHeight = 4_000;
    notifyContentResized();
    await flushFollowFrame();

    expect(scroller.scrollTop).toBe(4_000 - 720);
  });

  it("keeps the reading position on settle after an active-first history load", () => {
    vi.useFakeTimers();
    try {
      const items: ConversationItem[] = [
        { id: "active-first-user", kind: "message", role: "user", text: "run" },
        {
          id: "active-first-assistant",
          kind: "message",
          role: "assistant",
          text: "working",
        },
      ];
      const renderWith = (thinking: boolean, loading: boolean) => (
        <Messages
          items={items}
          threadId="thread-active-first-history"
          workspaceId="ws-1"
          isThinking={thinking}
          isHistoryLoading={loading}
          processingStartedAt={Date.now() - 1_000}
          openTargets={[]}
          selectedOpenAppId=""
        />
      );
      const { container, rerender } = render(renderWith(true, true));
      const scroller = getMessagesScroller(container);
      let scrollHeight = 2_400;
      setScrollerMetrics(scroller, 0, () => scrollHeight);

      rerender(renderWith(true, false));
      expect(scroller.scrollTop).toBe(2_400 - 720);

      fireEvent.wheel(scroller, { deltaY: -120 });
      scroller.scrollTop = 400;
      fireEvent.scroll(scroller);
      rerender(renderWith(false, false));
      scrollHeight = 4_000;
      act(() => {
        vi.advanceTimersByTime(2_100);
      });

      // 用户已上滚离底：turn-settle 不再拽回底部，视口保持读历史位置。
      expect(scroller.scrollTop).toBe(400);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restarts history placement when the same cached thread is closed and reopened", () => {
    vi.useFakeTimers();
    try {
      const historyItems: ConversationItem[] = [
        { id: "reopen-user", kind: "message", role: "user", text: "question" },
        {
          id: "reopen-assistant",
          kind: "message",
          role: "assistant",
          text: "answer",
        },
      ];
      const renderWith = (
        threadId: string | null,
        items: ConversationItem[],
      ) => (
        <Messages
          items={items}
          threadId={threadId}
          workspaceId="ws-reopen"
          isThinking={false}
          isHistoryLoading={false}
          openTargets={[]}
          selectedOpenAppId=""
        />
      );
      const { container, rerender } = render(renderWith(null, []));
      const scroller = getMessagesScroller(container);
      let scrollHeight = 2_400;
      setScrollerMetrics(scroller, 0, () => scrollHeight);

      rerender(renderWith("thread-reopen", historyItems));
      expect(scroller.scrollTop).toBe(2_400 - 720);

      rerender(renderWith(null, []));
      scroller.scrollTop = 0;
      // 重开同一 scope：history-open 去重不重复同步钉底。真实浏览器里 listener 重建时
      // ResizeObserver.observe() 会立刻派发一次初始回调触发 pinIfFollowing；jsdom 的
      // RO mock 不在 observe 时派发，这里用 notifyContentResized 模拟该初始帧。
      rerender(renderWith("thread-reopen", historyItems));
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(2_400 - 720);

      // 迟到测高只靠 RO 信号追底（无定时 recheck）。
      scrollHeight = 4_000;
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(4_000 - 720);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not emit redundant scroll writes for duplicate history resize signals", async () => {
    const { container } = render(
      <Messages
        items={[
          {
            id: "history-stable-1",
            kind: "message",
            role: "user",
            text: "hello",
          },
          {
            id: "history-stable-2",
            kind: "message",
            role: "assistant",
            text: "done",
          },
        ]}
        threadId="thread-history-stable-resize"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    const scroller = getMessagesScroller(container);
    const metrics = setScrollerMetrics(scroller, 1_680, 2_400);

    // 3 个同帧 resize 信号：rAF 合并 continuous pin；强制短窗内可能多写，
    // 但必须有限（不为每信号各写一次 thrash）。
    notifyContentResized();
    notifyContentResized();
    notifyContentResized();
    await flushFollowFrame();
    await flushFollowFrame();

    const writes = metrics.getScrollTopWriteCount();
    expect(writes).toBeGreaterThanOrEqual(1);
    expect(writes).toBeLessThanOrEqual(4);
  });

  it("attaches the content observer on the first frame, before history lands", async () => {
    // Threads mount with isHistoryLoading=true and an empty timeline. The observer
    // binds to .messages-timeline-root on mount and only rebinds per threadId, so
    // that node must already exist on the loading frame — otherwise follow is dead
    // for the whole session.
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const renderWith = (items: ConversationItem[], loading: boolean) => (
      <Messages
        items={items}
        threadId="thread-loading-then-lands"
        workspaceId="ws-1"
        isThinking={false}
        isHistoryLoading={loading}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(renderWith([], true));

    expect(container.querySelector(".messages-timeline-root")).toBeTruthy();
    expect(resizeObserverCallbacks.length).toBeGreaterThan(0);

    const scroller = getMessagesScroller(container);
    let scrollHeight = 2400;
    setScrollerMetrics(scroller, 0, () => scrollHeight);

    // History lands: the initial pin fires and opens the follow window.
    rerender(
      renderWith(
        [
          {
            id: "landed-1",
            kind: "message",
            role: "assistant",
            text: "history",
          },
        ],
        false,
      ),
    );
    expect(scroller.scrollTop).toBe(2400 - 720);

    // Late row measurements grow the content inside the follow window.
    scrollHeight = 4000;
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(4000 - 720);
    scrollSpy.mockRestore();
  });

  it("follows the bottom while streaming text grows without changing items", async () => {
    // The regression this guards: live assistant text is externalized through
    // liveAssistantTextChannel, so `items` (and therefore scrollKey) never change
    // during a turn. Only the content height changes — follow must key off that.
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const items: ConversationItem[] = [
      { id: "stream-follow-user", kind: "message", role: "user", text: "go" },
      {
        id: "stream-follow-assistant",
        kind: "message",
        role: "assistant",
        text: "partial",
      },
    ];
    const { container } = render(
      <Messages
        items={items}
        threadId="thread-stream-follow"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    const scroller = getMessagesScroller(container);

    let scrollHeight = 2400;
    setScrollerMetrics(scroller, 0, () => scrollHeight);

    // Same `items` identity across every step — only the rendered text grew.
    scrollHeight = 3000;
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(3000 - 720);

    scrollHeight = 5000;
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(5000 - 720);
    scrollSpy.mockRestore();
  });

  it("releases follow on wheel-up even before a scroll event lands", async () => {
    // The observer writes scrollTop every frame while streaming. If follow only
    // released on `scroll` (async), a height change racing ahead of it would yank
    // the user straight back to the bottom — i.e. they could never scroll away.
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const { container } = render(
      <Messages
        items={[
          {
            id: "wheel-release-user",
            kind: "message",
            role: "user",
            text: "go",
          },
          {
            id: "wheel-release-assistant",
            kind: "message",
            role: "assistant",
            text: "partial",
          },
        ]}
        threadId="thread-wheel-release"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    const scroller = getMessagesScroller(container);
    let scrollHeight = 2400;
    setScrollerMetrics(scroller, 0, () => scrollHeight);

    // Wheel up only — deliberately no `scroll` event behind it.
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 900;

    scrollHeight = 5000;
    notifyContentResized();
    expect(scroller.scrollTop).toBe(900);

    // Scrolling back to the bottom re-arms follow — the guard must not latch.
    // 新契约：paused 锁只能被 wheel 下滚回阈值内解除（paused 期间 scroll 事件被跳过）。
    scroller.scrollTop = 5000 - 720;
    fireEvent.wheel(scroller, { deltaY: 120 });
    await flushFollowFrame();
    scrollHeight = 6000;
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(6000 - 720);

    scrollSpy.mockRestore();
  });

  it("stops following streaming growth once the user scrolls up", () => {
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const { container } = render(
      <Messages
        items={[
          {
            id: "stream-release-user",
            kind: "message",
            role: "user",
            text: "go",
          },
          {
            id: "stream-release-assistant",
            kind: "message",
            role: "assistant",
            text: "partial",
          },
        ]}
        threadId="thread-stream-release"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    const scroller = getMessagesScroller(container);

    let scrollHeight = 2400;
    setScrollerMetrics(scroller, 0, () => scrollHeight);

    // User scrolls up mid-stream to read history: wheel 租约解除跟随。
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);

    scrollHeight = 5000;
    notifyContentResized();
    expect(scroller.scrollTop).toBe(400);
    scrollSpy.mockRestore();
  });

  it("keeps follow paused after wheel-up even while parked at the old bottom coordinate", () => {
    // 新契约：wheel 上滚立即置 userPaused 锁；paused 期间 scroll 事件被跳过，
    // 不会因「位置仍在阈值内」误判回底部而 re-arm（旧 grace/fingerprint 机制已删）。
    vi.useFakeTimers();
    try {
      const scrollSpy = vi
        .spyOn(HTMLElement.prototype, "scrollIntoView")
        .mockImplementation(() => {});
      const { container } = render(
        <Messages
          items={[
            { id: "noop-user", kind: "message", role: "user", text: "go" },
            {
              id: "noop-assistant",
              kind: "message",
              role: "assistant",
              text: "partial",
            },
          ]}
          threadId="thread-noop-echo"
          workspaceId="ws-1"
          isThinking
          processingStartedAt={Date.now() - 1_000}
          openTargets={[]}
          selectedOpenAppId=""
        />,
      );
      const scroller = getMessagesScroller(container);
      let scrollHeight = 2400;
      const metrics = setScrollerMetrics(scroller, 1680, () => scrollHeight);

      // 跟随中的 RO 追底：rAF 合并，写入次数有限。
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(metrics.getScrollTopWriteCount()).toBeGreaterThanOrEqual(1);
      expect(metrics.getScrollTopWriteCount()).toBeLessThanOrEqual(4);

      // 用户 wheel 上滚（可仍停在旧底坐标）；paused 锁期间 scroll 事件被跳过，
      // 不得立刻 re-arm，随后长高也不得吸回。
      fireEvent.wheel(scroller, { deltaY: -120 });
      scroller.scrollTop = 1680;
      fireEvent.scroll(scroller);
      const writesAfterLeave = metrics.getScrollTopWriteCount();
      scrollHeight = 6000;
      notifyContentResized();
      act(() => {
        vi.advanceTimersByTime(20);
      });
      expect(scroller.scrollTop).toBe(1680);
      expect(metrics.getScrollTopWriteCount()).toBe(writesAfterLeave);
      scrollSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases follow by viewport position after a thread switch re-pins to the bottom", async () => {
    // scope 切换重置跟随状态并由 history-open 重新武装钉底；随后用户上滚
    // （wheel 或 scrollTop 上移）释放跟随。高度阶跃假离底不得解绑，故此处用
    // 明确的上滚意图。
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const renderWith = (threadId: string) => (
      <Messages
        items={[
          {
            id: `clear-${threadId}-user`,
            kind: "message",
            role: "user",
            text: "go",
          },
          {
            id: `clear-${threadId}-assistant`,
            kind: "message",
            role: "assistant",
            text: "partial",
          },
        ]}
        threadId={threadId}
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(renderWith("thread-clear-A"));
    const scroller = getMessagesScroller(container);

    // 会话 A：跟随追底到 1680（rAF 落位）。
    setScrollerMetrics(scroller, 1200, 2400);
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(1680);

    // 切到会话 B：几何不同（底部 7280），history-open 同步钉底。
    setScrollerMetrics(scroller, 7000, 8000);
    rerender(renderWith("thread-clear-B"));
    expect(scroller.scrollTop).toBe(7280);

    // 用户上滚到旧坐标：wheel 暂停 + scrollTop 上移。
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 1680;
    fireEvent.scroll(scroller);
    await flushFollowFrame();

    // 跟随已解除：后续内容高度信号不得把视口拽回底部。
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(1680);
    scrollSpy.mockRestore();
  });

  it("does not synthesize a settle boundary when switching from a working thread", () => {
    const renderWith = (
      threadId: string,
      thinking: boolean,
      messageId: string,
    ) => (
      <Messages
        items={[
          { id: messageId, kind: "message", role: "user", text: threadId },
        ]}
        threadId={threadId}
        workspaceId="ws-1"
        isThinking={thinking}
        processingStartedAt={thinking ? Date.now() - 1_000 : null}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(
      renderWith("thread-scope-working", true, "scope-working-user"),
    );
    const scroller = getMessagesScroller(container);
    setScrollerMetrics(scroller, 400, 2400);

    // 预置新会话的 message jump，使 history-open 明确让位给 pending anchor。
    act(() => {
      document.dispatchEvent(
        new CustomEvent<string>("ccgui:jump-to-message", {
          detail: "scope-idle-user",
        }),
      );
    });
    rerender(renderWith("thread-scope-idle", false, "scope-idle-user"));

    // working true→false 来自 scope switch，不是同一 turn 的 settle，不能写到底部。
    expect(scroller.scrollTop).toBe(400);
  });

  it("re-pins to the bottom after the conversation settles and the timeline back-fills", async () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const renderWith = (thinking: boolean, extra: boolean) => (
      <Messages
        items={[
          {
            id: "settle-repin-1",
            kind: "message",
            role: "assistant",
            text: "first chunk",
          },
          ...(extra
            ? [
                {
                  id: "settle-repin-2",
                  kind: "message" as const,
                  role: "assistant" as const,
                  text: "second chunk",
                },
              ]
            : []),
        ]}
        threadId="thread-settle-repin"
        workspaceId="ws-1"
        isThinking={thinking}
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    // Thread is already open and idle (initial bottom-pin has run, so it will
    // not re-fire on settle), then the user sends a new turn.
    const { container, rerender } = render(renderWith(false, false));
    const scroller = getMessagesScroller(container);
    rerender(renderWith(true, false));
    // User is parked at the bottom while streaming — auto-follow stays armed.
    setScrollerMetrics(scroller, 1680, 2400); // 2400 - 1680 - 720 = 0, at bottom
    fireEvent.scroll(scroller);
    await flushFollowFrame();

    // Conversation settles (isThinking true -> false)：跟随中 settle 钉底，下一 rAF 落位。
    rerender(renderWith(false, false));
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(2400 - 720);

    // The curtain back-fills and the rows measure taller than estimated, so
    // scrollHeight grows after the pin: the re-pin must chase it to the bottom.
    setScrollerMetrics(scroller, 0, 3200);
    rerender(renderWith(false, true));
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(3200 - 720);
    scrollSpy.mockRestore();
  });

  it("does not re-pin on settle back-fill when the user scrolled up during streaming", async () => {
    // settleFollow：仅 userPaused（wheel 上滚）时不强制回底；back-fill 也不追。
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const renderWith = (thinking: boolean, extra: boolean) => (
      <Messages
        items={[
          {
            id: "settle-norepin-1",
            kind: "message",
            role: "assistant",
            text: "first chunk",
          },
          ...(extra
            ? [
                {
                  id: "settle-norepin-2",
                  kind: "message" as const,
                  role: "assistant" as const,
                  text: "second chunk",
                },
              ]
            : []),
        ]}
        threadId="thread-settle-norepin"
        workspaceId="ws-1"
        isThinking={thinking}
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    // Thread is already open and idle (initial bottom-pin has run), then the
    // user sends a new turn and scrolls up mid-stream to read history.
    const { container, rerender } = render(renderWith(false, false));
    const scroller = getMessagesScroller(container);
    let scrollHeight = 2400;
    setScrollerMetrics(scroller, 0, () => scrollHeight);
    // 回合开始：send placement 同步钉底（在帧内的 turn-start pin 落位后再滚动）。
    rerender(renderWith(true, false));
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(2400 - 720);
    // User scrolls up to read history during streaming — wheel 立即暂停跟随。
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    await flushFollowFrame();

    // settle：跟随已释放，钉底不发生，视口保持读历史位置。
    rerender(renderWith(false, false));
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(400);

    // Deferred curtain back-fill：跟随仍释放，不再追到新底部。
    scrollHeight = 3200;
    rerender(renderWith(false, true));
    notifyContentResized();
    await flushFollowFrame();
    expect(scroller.scrollTop).toBe(400);
    scrollSpy.mockRestore();
  });

  it("re-pins after every settlement across multiple turns", async () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const renderWith = (thinking: boolean, turnCount: number) => (
      <Messages
        items={Array.from({ length: turnCount + 1 }, (_, index) => ({
          id: `multi-turn-assistant-${index}`,
          kind: "message" as const,
          role: "assistant" as const,
          text:
            index === turnCount && thinking ? "streaming" : `settled ${index}`,
        }))}
        threadId="thread-multi-turn-settle"
        workspaceId="ws-1"
        isThinking={thinking}
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(renderWith(false, 0));
    const scroller = getMessagesScroller(container);
    let scrollHeight = 2_400;
    setScrollerMetrics(scroller, scrollHeight - 720, () => scrollHeight);
    fireEvent.scroll(scroller);

    for (let turn = 1; turn <= 3; turn += 1) {
      scrollHeight += 400;
      rerender(renderWith(true, turn));
      expect(scroller.scrollTop).toBe(scrollHeight - 720);

      // settle 钉底走 pinIfFollowing，下一 rAF 落位。
      scrollHeight += 600;
      rerender(renderWith(false, turn));
      await flushFollowFrame();
      expect(scroller.scrollTop).toBe(scrollHeight - 720);
    }
  });

  it("ignores duplicate live auto-follow enabled events", async () => {
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const { container } = render(
      <Messages
        items={[
          {
            id: "assistant-live-duplicate-follow",
            kind: "message",
            role: "assistant",
            text: "streaming chunk",
          },
        ]}
        threadId="thread-live-follow-duplicate-event"
        workspaceId="ws-1"
        isThinking
        processingStartedAt={Date.now() - 1_000}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    const scroller = getMessagesScroller(container);
    setScrollerMetrics(scroller, 400, 2000);
    fireEvent.scroll(scroller);
    scrollSpy.mockClear();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(MESSAGES_LIVE_CONTROLS_UPDATED_EVENT, {
          detail: { liveAutoFollowEnabled: true },
        }),
      );
    });

    expect(scrollSpy).not.toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it("does not auto-follow static history item changes when the user has scrolled away", async () => {
    // 对齐 jetbrains：在底部时 messages 变化会追底；用户已离底则不得追。
    // （旧断言「静态历史增量完全不 scrollIntoView」与 jetbrains 模型冲突。）
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const { container, rerender } = render(
      <Messages
        items={[
          {
            id: "history-static-1",
            kind: "message",
            role: "user",
            text: "历史消息 1",
          },
        ]}
        threadId="thread-history-static"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );
    const scroller = getMessagesScroller(container);
    setScrollerMetrics(scroller, 0, 2400);
    // 用户上滚读历史：暂停跟随。
    fireEvent.wheel(scroller, { deltaY: -120 });
    scroller.scrollTop = 400;
    fireEvent.scroll(scroller);
    await flushFollowFrame();
    scrollSpy.mockClear();

    rerender(
      <Messages
        items={[
          {
            id: "history-static-1",
            kind: "message",
            role: "user",
            text: "历史消息 1",
          },
          {
            id: "history-static-2",
            kind: "message",
            role: "assistant",
            text: "历史消息 2",
          },
        ]}
        threadId="thread-history-static"
        workspaceId="ws-1"
        isThinking={false}
        openTargets={[]}
        selectedOpenAppId=""
      />,
    );

    expect(scrollSpy).not.toHaveBeenCalled();
    expect(scroller.scrollTop).toBe(400);
    scrollSpy.mockRestore();
  });

  it("pins to the bottom after a long streaming tail restores full history", async () => {
    // 新契约：settle 钉底走 pinIfFollowing，要求跟随武装（liveAutoFollow 开）。
    window.localStorage.setItem("ccgui.messages.live.autoFollow", "1");
    const scrollSpy = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const longStreamingItems: ConversationItem[] = [
      {
        id: "streaming-tail-user-latest",
        kind: "message",
        role: "user",
        text: "请继续分析这个长会话",
      },
      ...Array.from({ length: 150 }, (_, index) => ({
        id: `streaming-tail-assistant-${index}`,
        kind: "message" as const,
        role: "assistant" as const,
        text: `长回复片段 ${index}`,
        isFinal: index === 149 ? true : undefined,
      })),
    ];
    const renderMessages = (isThinking: boolean) => (
      <Messages
        items={longStreamingItems}
        threadId="thread-long-streaming-tail-bottom-pin"
        workspaceId="ws-1"
        isThinking={isThinking}
        processingStartedAt={Date.now() - 1_000}
        activeEngine="codex"
        openTargets={[]}
        selectedOpenAppId=""
      />
    );
    const { container, rerender } = render(renderMessages(true));
    const scroller = getMessagesScroller(container);
    setScrollerMetrics(scroller, 0, 2400);

    // Still streaming: 同步断言落在任何 rAF 追底之前，视口尚未移动。
    expect(scroller.scrollTop).toBe(0);

    rerender(renderMessages(false));

    await waitFor(() => {
      expect(scroller.scrollTop).toBe(2400 - 720);
    });
    scrollSpy.mockRestore();
  });
});
