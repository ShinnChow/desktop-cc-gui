// @vitest-environment jsdom
import { registerThreadMessagingTestHooks } from "./useThreadMessagingTestSetup";
import {
  act,
  waitFor,
} from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  makeThreadMessagingHook,
  workspace,
} from "./useThreadMessaging.test-utils";
import {
  resolveEnabledBuiltInAgent,
  sendUserMessage,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { getGlobalRuntimeNoticesSnapshot } from "../../../services/globalRuntimeNotices";

describe("useThreadMessaging", () => {
  registerThreadMessagingTestHooks();

  it("does not create a second Codex thread when newly started draft refreshes to the same missing thread", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => "legacy-thread-id");
    const forkThreadForWorkspace = vi.fn(async () => "thread-fork-should-not-use");
    const startThreadForWorkspace = vi.fn().mockResolvedValueOnce("legacy-thread-id");
    const dispatch = vi.fn();
    const { result, recordThreadActivity, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      forkThreadForWorkspace,
      dispatch,
      codexAcceptedTurnByThread: {
        "legacy-thread-id": {
          fact: "empty-draft",
          source: "thread-start",
          updatedAt: 1,
        },
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(forkThreadForWorkspace).not.toHaveBeenCalled();
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        1,
        "ws-1",
        "legacy-thread-id",
        "hello codex",
        expect.any(Object),
      );
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setActiveThreadId",
          threadId: "thread-fresh-after-same-id",
        }),
      );
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "legacy-thread-id",
        expect.any(String),
      );
      expect(recordThreadActivity).not.toHaveBeenCalledWith(
        "ws-1",
        "legacy-thread-id",
        expect.any(Number),
      );
    });
  });
  it("mirrors codex turn-start rpc failures into runtime notices", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        type: "invalid_request_error",
        message:
          "The 'demo' model is not supported when using Codex with a ChatGPT account.",
      },
    } as never);
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "thread-1",
        "会话启动失败：The 'demo' model is not supported when using Codex with a ChatGPT account.",
      );
      expect(getGlobalRuntimeNoticesSnapshot()).toEqual([
        expect.objectContaining({
          severity: "error",
          category: "user-action-error",
          messageKey: "runtimeNotice.error.threadTurnFailed",
          messageParams: {
            engine: "Codex",
            message:
              "The 'demo' model is not supported when using Codex with a ChatGPT account.",
          },
        }),
      ]);
    });
  });
  it("mirrors classified runtime-ended failures with reconnect action context", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled.",
      },
    } as never);
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(getGlobalRuntimeNoticesSnapshot()).toEqual([
        expect.objectContaining({
          severity: "error",
          category: "user-action-error",
          messageKey: "runtimeNotice.error.codexSessionRecoverableFailure",
          messageParams: {
            engine: "Codex",
            rawMessage:
              "[RUNTIME_ENDED] Managed runtime ended before this conversation turn settled.",
            reasonCode: "runtime-ended",
            userAction: "reconnect",
            actionHint: "Reconnect the runtime and retry.",
          },
        }),
      ]);
    });
  });
  it("marks codex thread as accepted after turn start response", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      result: { turn: { id: "turn-accepted" } },
    } as never);
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("codex", { dispatch });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "markCodexAcceptedTurn",
          threadId: "thread-1",
          fact: "accepted",
          source: "turn-start-response",
          timestamp: expect.any(Number),
        }),
      );
    });
  });
  it("retries codex send once when stale thread reports thread not found", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message: "thread not found: legacy-thread-id",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-thread-not-found" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-2");
    const dispatch = vi.fn();
    const { result, onDebug } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-2",
        "hello codex",
        expect.any(Object),
      );
      const reboundUserBubbleActions = dispatch.mock.calls.filter(
        ([action]) =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          (action as { type?: string }).type === "upsertItem" &&
          "threadId" in action &&
          (action as { threadId?: string }).threadId === "thread-rebound-2" &&
          "item" in action &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.kind ===
            "message" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.role ===
            "user" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.text ===
            "hello codex",
      );
      expect(reboundUserBubbleActions).toHaveLength(1);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setThreadItems",
          threadId: "legacy-thread-id",
        }),
      );
      expect(onDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "turn/start thread rebind retry",
          payload: expect.objectContaining({
            reasonCode: "stale-thread-binding",
            staleReason: "thread-not-found",
            retryable: true,
            userAction: "recover-thread",
            outcome: "rebound",
          }),
        }),
      );
    });
  });
  it("retries codex send once when stale thread reports conversation not found", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message: "conversation not found: legacy-thread-id",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-conversation-not-found" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-conversation");
    const dispatch = vi.fn();
    const { result, onDebug } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-conversation",
        "hello codex",
        expect.any(Object),
      );
      expect(onDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "turn/start thread rebind retry",
          payload: expect.objectContaining({
            reasonCode: "stale-thread-binding",
            staleReason: "thread-not-found",
            retryable: true,
            userAction: "recover-thread",
            outcome: "rebound",
          }),
        }),
      );
    });
  });
  it("forks a stale codex thread before falling back to a fresh continuation", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message: "thread not found: legacy-thread-id",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-forked-thread-not-found" } },
      } as never);
    const refreshThread = vi.fn(async () => null);
    const forkThreadForWorkspace = vi.fn(async () => "thread-forked-1");
    const startThreadForWorkspace = vi.fn(async () => "thread-fresh-should-not-start");
    const dispatch = vi.fn();
    const { result, onDebug } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      refreshThread,
      forkThreadForWorkspace,
      startThreadForWorkspace,
      dispatch,
      itemsByThread: {
        "legacy-thread-id": [
          {
            id: "assistant-durable-earlier",
            kind: "message",
            role: "assistant",
            text: "durable answer",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(forkThreadForWorkspace).toHaveBeenCalledWith("ws-1", "legacy-thread-id", {
        activate: true,
      });
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-forked-1",
        "hello codex",
        expect.any(Object),
      );
      expect(dispatch).toHaveBeenCalledWith({
        type: "setActiveThreadId",
        workspaceId: "ws-1",
        threadId: "thread-forked-1",
      });
      expect(onDebug).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "turn/start stale fork continuation",
          payload: expect.objectContaining({
            forkedThreadId: "thread-forked-1",
            reasonCode: "stale-thread-binding",
            staleReason: "thread-not-found",
            userAction: "start-fresh-thread",
          }),
        }),
      );
    });
  });
  it("retries codex send once when stale thread throws session not found", async () => {
    vi.mocked(sendUserMessage)
      .mockRejectedValueOnce(new Error("[SESSION_NOT_FOUND] session file not found"))
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-session-not-found" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-3");
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-3",
        "hello codex",
        expect.any(Object),
      );
      expect(pushThreadErrorMessage).not.toHaveBeenCalled();
      const reboundUserBubbleActions = dispatch.mock.calls.filter(
        ([action]) =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          (action as { type?: string }).type === "upsertItem" &&
          "threadId" in action &&
          (action as { threadId?: string }).threadId === "thread-rebound-3" &&
          "item" in action &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.kind ===
            "message" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.role ===
            "user" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.text ===
            "hello codex",
      );
      expect(reboundUserBubbleActions).toHaveLength(1);
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setThreadItems",
          threadId: "legacy-thread-id",
        }),
      );
    });
  });
  it("retries codex send once when refresh returns the same thread id", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message:
            "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `r` at 1",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-retry-same-id" } },
      } as never);
    const refreshThread = vi.fn(async () => "legacy-thread-id");
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "legacy-thread-id",
        "hello codex",
        expect.any(Object),
      );
      const optimisticUserBubbleActions = dispatch.mock.calls.filter(
        ([action]) =>
          action &&
          typeof action === "object" &&
          "type" in action &&
          (action as { type?: string }).type === "upsertItem" &&
          "item" in action &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.kind ===
            "message" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.role ===
            "user" &&
          (action as { item?: { kind?: string; role?: string; text?: string } }).item?.text ===
            "hello codex",
      );
      expect(optimisticUserBubbleActions).toHaveLength(1);
    });
  });
  it("does not attach selectedAgentIcon when sending without selected agent", async () => {
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("codex", { dispatch });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    const optimisticCall = dispatch.mock.calls.find(
      ([action]) =>
        action &&
        typeof action === "object" &&
        "type" in action &&
        (action as { type?: string }).type === "upsertItem" &&
        "item" in action &&
        (action as { item?: { kind?: string; role?: string } }).item?.kind === "message" &&
        (action as { item?: { kind?: string; role?: string } }).item?.role === "user",
    );
    expect(optimisticCall).toBeDefined();
    const optimisticAction = optimisticCall?.[0] as {
      item?: { selectedAgentName?: string | null; selectedAgentIcon?: string | null };
    };
    expect(optimisticAction.item?.selectedAgentName ?? null).toBeNull();
    expect(optimisticAction.item?.selectedAgentIcon ?? null).toBeNull();
  });
  it("injects selected agent name marker into codex prompt block", async () => {
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "请继续",
        [],
        {
          selectedAgent: {
            id: "agent-backend-1",
            name: "后端架构师",
            prompt: "你是一位资深后端架构师，擅长服务治理和高并发设计。",
            icon: "agent-robot-03",
          },
        },
      );
    });

    const calls = vi.mocked(sendUserMessage).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const latestCall = calls[calls.length - 1];
    const sentText = String(latestCall?.[2] ?? "");
    expect(sentText).toContain("## Agent Role and Instructions");
    expect(sentText).toContain("Agent Name: 后端架构师");
    expect(sentText).toContain("Agent Icon: agent-robot-03");
    expect(sentText).toContain("你是一位资深后端架构师，擅长服务治理和高并发设计。");
  });
  it("resolves and injects a built-in agent prompt only at send time", async () => {
    vi.mocked(resolveEnabledBuiltInAgent).mockResolvedValueOnce({
      id: "agency-agents:engineering/engineering-ai-engineer",
      providerId: "agency-agents",
      sourceRevision: "revision-2",
      promptHash: "hash-2",
      prompt: "只在发送时解析的内置提示词。",
    });
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "请继续",
        [],
        {
          selectedAgent: {
            id: "agency-agents:engineering/engineering-ai-engineer",
            name: "AI 工程师",
            source: "builtIn",
            prompt: null,
          },
        },
      );
    });

    expect(resolveEnabledBuiltInAgent).toHaveBeenCalledWith(
      "agency-agents:engineering/engineering-ai-engineer",
    );
    const sentText = String(vi.mocked(sendUserMessage).mock.calls.at(-1)?.[2] ?? "");
    expect(sentText).toContain("## Agent Role and Instructions");
    expect(sentText).toContain("只在发送时解析的内置提示词。");
  });
  it("sends without stale prompt when a selected built-in agent is disabled", async () => {
    vi.mocked(resolveEnabledBuiltInAgent).mockRejectedValueOnce(
      new Error("built-in agent is disabled"),
    );
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "只发送这句话",
        [],
        {
          selectedAgent: {
            id: "agency-agents:design/design-ui-designer",
            name: "UI 设计师",
            source: "builtIn",
            prompt: "不应注入的旧提示词",
          },
        },
      );
    });

    const sentText = String(vi.mocked(sendUserMessage).mock.calls.at(-1)?.[2] ?? "");
    expect(sentText).not.toContain("## Agent Role and Instructions");
    expect(sentText).not.toContain("不应注入的旧提示词");
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.any(String),
        message: expect.any(String),
      }),
    );
  });
  it("releases codex processing state when first packet timeout is recoverable", async () => {
    vi.mocked(sendUserMessage).mockRejectedValueOnce(
      new Error(
        "FIRST_PACKET_TIMEOUT:35:Timed out waiting for initial response. Network, proxy, or upstream service load may be causing delay. Please retry.",
      ),
    );
    const { result, markProcessing, setActiveTurnId, pushThreadErrorMessage } =
      makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
      );
    });

    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "thread-1",
      "threads.firstPacketTimeout",
    );
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.firstPacketTimeout",
      }),
    );
  });
  it("releases codex processing state when first packet timeout comes back as rpc error", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message:
          "FIRST_PACKET_TIMEOUT:20:Timed out waiting for initial response. Network, proxy, or upstream service load may be causing delay. Please retry.",
      },
    });
    const { result, markProcessing, setActiveTurnId, pushThreadErrorMessage } =
      makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
      );
    });

    expect(markProcessing).toHaveBeenCalledWith("thread-1", true);
    expect(markProcessing).toHaveBeenCalledWith("thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("thread-1", null);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "thread-1",
      "threads.firstPacketTimeout",
    );
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.firstPacketTimeout",
      }),
    );
  });
});
