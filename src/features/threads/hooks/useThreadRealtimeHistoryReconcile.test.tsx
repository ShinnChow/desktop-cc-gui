// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { useThreadRealtimeHistoryReconcile } from "./useThreadRealtimeHistoryReconcile";
import type { ThreadState } from "./useThreadsReducer";

describe("useThreadRealtimeHistoryReconcile", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function createHarness(options?: {
    itemsByThread?: Record<string, ConversationItem[]>;
    isProcessing?: boolean;
    refreshImpl?: (workspaceId: string, threadId: string) => Promise<unknown>;
    threadsByWorkspace?: ThreadState["threadsByWorkspace"][string];
  }) {
    const itemsByThreadRef = {
      current: options?.itemsByThread ?? ({} as Record<string, ConversationItem[]>),
    };
    const threadStatusByIdRef = {
      current: {
        "claude:session-1": {
          isProcessing: options?.isProcessing ?? false,
          hasUnread: false,
          isReviewing: false,
          isContextCompacting: false,
          processingStartedAt: null,
          lastDurationMs: null,
          heartbeatPulse: 0,
          continuationPulse: 0,
          terminalPulse: 0,
          codexCompactionSource: null,
          codexCompactionLifecycleState: "idle" as const,
          codexCompactionCompletedAt: null,
          lastTokenUsageUpdatedAt: null,
        },
      } as ThreadState["threadStatusById"],
    };
    const refreshThread =
      options?.refreshImpl ??
      vi.fn(async (_workspaceId: string, threadId: string) => {
        itemsByThreadRef.current[threadId] = [
          {
            id: "user-1",
            kind: "message",
            role: "user",
            text: "recovered from disk",
          },
        ];
        return threadId;
      });
    const onDebug = vi.fn();

    const { result } = renderHook(() =>
      useThreadRealtimeHistoryReconcile({
        itemsByThreadRef,
        onDebug,
        refreshThread,
        resolveCanonicalThreadId: (threadId) => threadId,
        threadStatusByIdRef,
        threadsByWorkspace: {
          "ws-1":
            options?.threadsByWorkspace ?? [
              {
                id: "claude:session-1",
                name: "session",
                updatedAt: Date.now(),
                engineSource: "claude",
                threadKind: "native",
              },
            ],
        },
      }),
    );

    return { result, refreshThread, onDebug, itemsByThreadRef };
  }

  it("rehydrates Claude history after turn completed when the curtain is empty", async () => {
    const { result, refreshThread, itemsByThreadRef } = createHarness({
      itemsByThread: { "claude:session-1": [] },
    });

    act(() => {
      result.current.handleTurnCompletedForHistoryReconcile({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        turnId: "turn-1",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_300);
    });

    expect(refreshThread).toHaveBeenCalledWith("ws-1", "claude:session-1");
    expect(itemsByThreadRef.current["claude:session-1"]?.length).toBeGreaterThan(
      0,
    );
  });

  it("schedules blank-curtain recovery in place without waiting for reselect", async () => {
    const { result, refreshThread } = createHarness({
      itemsByThread: { "claude:session-1": [] },
      isProcessing: true,
    });

    act(() => {
      result.current.scheduleClaudeBlankCurtainRecovery(
        "ws-1",
        "claude:session-1",
        "active-processing-empty-surface",
      );
    });

    expect(refreshThread).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(refreshThread).toHaveBeenCalledWith("ws-1", "claude:session-1");
  });

  it("retries blank-curtain recovery when the first rehydrate is still empty", async () => {
    let calls = 0;
    const { result, refreshThread, itemsByThreadRef } = createHarness({
      itemsByThread: { "claude:session-1": [] },
      refreshImpl: vi.fn(async (_workspaceId: string, threadId: string) => {
        calls += 1;
        if (calls >= 2) {
          itemsByThreadRef.current[threadId] = [
            {
              id: "user-2",
              kind: "message",
              role: "user",
              text: "second probe recovered",
            },
          ];
        }
        return threadId;
      }),
    });

    act(() => {
      result.current.scheduleClaudeBlankCurtainRecovery(
        "ws-1",
        "claude:session-1",
        "turn-completed-empty-surface",
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(refreshThread).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_700);
    });
    expect(refreshThread).toHaveBeenCalledTimes(2);
    expect(itemsByThreadRef.current["claude:session-1"]?.[0]).toMatchObject({
      text: "second probe recovered",
    });
  });

  it("does not schedule blank-curtain recovery for non-Claude threads", async () => {
    const { result, refreshThread } = createHarness();

    act(() => {
      result.current.scheduleClaudeBlankCurtainRecovery(
        "ws-1",
        "codex-thread-1",
        "should-ignore",
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(refreshThread).not.toHaveBeenCalled();
  });

  it("defers Claude reconcile while an optimistic user bubble is pending", async () => {
    const { result, refreshThread, itemsByThreadRef } = createHarness({
      itemsByThread: {
        "claude:session-1": [
          {
            id: "optimistic-user-1",
            kind: "message",
            role: "user",
            text: "bubble not on disk yet",
          },
        ],
      },
    });

    act(() => {
      result.current.handleTurnCompletedForHistoryReconcile({
        workspaceId: "ws-1",
        threadId: "claude:session-1",
        turnId: "turn-1",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_300);
    });
    expect(refreshThread).not.toHaveBeenCalled();

    // Retry delay fires the reconcile even if the bubble is still pending
    // (mirror codex path: defer once, then proceed).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_900);
    });
    expect(refreshThread).toHaveBeenCalledWith("ws-1", "claude:session-1");
    expect(itemsByThreadRef.current["claude:session-1"]).toBeDefined();
  });

  // harden-pi-session-curtain-fidelity：pi 线程永不进入 codex post-turn
  // reconcile。pi 无 window 加载、无 cursor 语义，refresh 分支对其是错误
  // 分支；merge 锚点 miss 回退整体替换时会裁掉磁盘 flush 前的 live 尾部。
  it("does not reconcile a pi thread that is missing from the sidebar list", async () => {
    const { result, refreshThread } = createHarness({
      threadsByWorkspace: [],
    });

    act(() => {
      result.current.handleTurnCompletedForHistoryReconcile({
        workspaceId: "ws-1",
        threadId: "pi:session-pi-1",
        turnId: "turn-1",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(refreshThread).not.toHaveBeenCalled();
  });

  it("does not reconcile a pi-pending thread before its rename lands", async () => {
    const { result, refreshThread } = createHarness({
      threadsByWorkspace: [],
    });

    act(() => {
      result.current.handleTurnCompletedForHistoryReconcile({
        workspaceId: "ws-1",
        threadId: "pi-pending-1728000000000-ab12",
        turnId: "turn-1",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(refreshThread).not.toHaveBeenCalled();
  });

  it("does not reconcile a healthy pi thread with engineSource pi", async () => {
    const { result, refreshThread } = createHarness({
      threadsByWorkspace: [
        {
          id: "pi:session-pi-2",
          name: "pi session",
          updatedAt: Date.now(),
          engineSource: "pi",
          threadKind: "native",
        },
      ],
    });

    act(() => {
      result.current.handleTurnCompletedForHistoryReconcile({
        workspaceId: "ws-1",
        threadId: "pi:session-pi-2",
        turnId: "turn-1",
      });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(refreshThread).not.toHaveBeenCalled();
  });
});
