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
  engineSendMessage,
  sendUserMessage,
} from "../../../services/tauri";

describe("useThreadMessaging", () => {
  registerThreadMessagingTestHooks();

  it("creates new opencode pending thread when active thread id is not opencode-prefixed", async () => {
    const startThreadForWorkspace = vi.fn(async () => "opencode-pending-new");
    const { result } = makeThreadMessagingHook("opencode", {
      activeThreadId: "thread-legacy",
      ensuredThreadId: "thread-legacy",
      threadEngineById: { "thread-legacy": "opencode" },
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello");
    });

    expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      activate: true,
      engine: "opencode",
    });
    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "opencode",
        threadId: "opencode-pending-new",
      }),
    );
  });
  it("keeps sending follow-up messages on the current compatible codex thread", async () => {
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: { "thread-1": "codex" },
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up");
    });

    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "follow up",
      expect.any(Object),
    );
  });
  it("shows create-session loading when first send needs to create a thread", async () => {
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const runWithCreateSessionLoading = vi.fn(async (_params, action) => action());
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: null,
      ensuredThreadId: "thread-new-1",
      startThreadForWorkspace,
      runWithCreateSessionLoading,
    });

    await act(async () => {
      await result.current.sendUserMessage("first message");
    });

    expect(runWithCreateSessionLoading).toHaveBeenCalledWith(
      {
        workspace,
        engine: "codex",
      },
      expect.any(Function),
    );
    expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      activate: true,
      engine: "codex",
    });
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-new-1",
      "first message",
      expect.any(Object),
    );
  });
  it("passes selected Codex provider profile when first send creates a managed-provider thread", async () => {
    const startThreadForWorkspace = vi.fn(async () => "thread-provider-1");
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: null,
      ensuredThreadId: "thread-provider-1",
      startThreadForWorkspace,
      resolveComposerSelection: () => ({
        id: "minimax-m3",
        model: "minimax-m3",
        source: "custom",
        providerProfileId: "provider-minimax",
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessage("first provider message");
    });

    expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
      activate: true,
      engine: "codex",
      providerProfileId: "provider-minimax",
    });
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-provider-1",
      "first provider message",
      expect.any(Object),
    );
  });
  it("does not show create-session loading for follow-up sends on existing threads", async () => {
    const runWithCreateSessionLoading = vi.fn(async (_params, action) => action());
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: { "thread-1": "codex" },
      runWithCreateSessionLoading,
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up");
    });

    expect(runWithCreateSessionLoading).not.toHaveBeenCalled();
  });
  it("sends follow-up messages on the rewound codex child thread", async () => {
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-codex-rewind-1",
      ensuredThreadId: "thread-codex-rewind-1",
      threadEngineById: { "thread-codex-rewind-1": "codex" },
      refreshThread,
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up after rewind");
    });

    expect(refreshThread).not.toHaveBeenCalled();
    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-codex-rewind-1",
      "follow up after rewind",
      expect.any(Object),
    );
  });
  it("passes selected collaboration mode payload through codex send", async () => {
    const { result } = makeThreadMessagingHook("codex");
    const collaborationMode = {
      mode: "plan",
      settings: {
        model: "openai/gpt-5.3-codex",
        reasoning_effort: "medium",
      },
    };

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
        [],
        { collaborationMode },
      );
    });

    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "hello codex",
      expect.objectContaining({
        collaborationMode: expect.objectContaining({
          mode: "plan",
        }),
      }),
    );
  });
  it("retries codex send on refreshed thread when backend rejects legacy thread id", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message:
            "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `r` at 1",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-rebound-1" } },
      } as never);
    const refreshThread = vi.fn(async () => "thread-rebound-1");
    const startThreadForWorkspace = vi.fn(async () => "thread-rebound-1");
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
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        1,
        "ws-1",
        "legacy-thread-id",
        "hello codex",
        expect.any(Object),
      );
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-rebound-1",
        "hello codex",
        expect.any(Object),
      );
      expect(dispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setThreadItems",
          threadId: "legacy-thread-id",
        }),
      );
    });
  });
  it("creates a fresh codex thread when invalid legacy id cannot be refreshed", async () => {
    vi.mocked(sendUserMessage)
      .mockResolvedValueOnce({
        error: {
          message:
            "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `n` at 1",
        },
      } as never)
      .mockResolvedValueOnce({
        result: { turn: { id: "turn-new-legacy" } },
      } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-new-1");
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).toHaveBeenCalledWith("ws-1", {
        activate: true,
        engine: "codex",
      });
      expect(sendUserMessage).toHaveBeenCalledTimes(2);
      expect(sendUserMessage).toHaveBeenNthCalledWith(
        2,
        "ws-1",
        "thread-new-1",
        "hello codex",
        expect.any(Object),
      );
      expect(pushThreadErrorMessage).not.toHaveBeenCalled();
    });
  });
  it("does not fresh-replace a durable codex thread when invalid thread id cannot be refreshed", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message:
          "invalid thread id: invalid character: expected an optional prefix of `urn:uuid:` followed by [0-9a-fA-F-], found `d` at 1",
      },
    } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-should-not-start");
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "durable-thread-id",
      ensuredThreadId: "durable-thread-id",
      startThreadForWorkspace,
      refreshThread,
      itemsByThread: {
        "durable-thread-id": [
          {
            id: "user-durable-before-invalid-id",
            kind: "message",
            role: "user",
            text: "accepted earlier",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("follow up after invalid id");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "durable-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "durable-thread-id",
        expect.any(String),
      );
    });
  });
  it("does not silently replace a stale codex thread when durable local activity exists", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-new-unknown");
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
      itemsByThread: {
        "legacy-thread-id": [
          {
            id: "user-accepted-earlier",
            kind: "message",
            role: "user",
            text: "accepted earlier",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.sendUserMessage("hello codex");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "legacy-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "legacy-thread-id",
        expect.any(String),
      );
    });
  });
  it("does not fresh-replace an empty local codex draft when the native thread is missing", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => null);
    const startThreadForWorkspace = vi.fn(async () => "thread-fresh-local-draft");
    const dispatch = vi.fn();
    const { result, recordThreadActivity, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
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
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setActiveThreadId",
          threadId: "thread-fresh-local-draft",
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
  it("does not fresh-replace a native Codex thread when refresh throws before rebind", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => {
      throw new Error("thread not found: legacy-thread-id");
    });
    const startThreadForWorkspace = vi.fn(async () => "thread-fresh-refresh-throw");
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage, onDebug } = makeThreadMessagingHook("codex", {
      activeThreadId: "legacy-thread-id",
      ensuredThreadId: "legacy-thread-id",
      startThreadForWorkspace,
      refreshThread,
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
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setActiveThreadId",
          threadId: "thread-fresh-refresh-throw",
        }),
      );
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "legacy-thread-id",
        expect.any(String),
      );
      expect(onDebug).not.toHaveBeenCalledWith(
        expect.objectContaining({ label: "turn/start draft fresh fallback" }),
      );
    });
  });
  it("does not fresh-replace a durable stale codex thread when refresh throws", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: durable-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => {
      throw new Error("thread not found: durable-thread-id");
    });
    const startThreadForWorkspace = vi.fn(async () => "thread-should-not-start");
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "durable-thread-id",
      ensuredThreadId: "durable-thread-id",
      startThreadForWorkspace,
      refreshThread,
      itemsByThread: {
        "durable-thread-id": [
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
      await result.current.sendUserMessage("follow up");
    });

    await waitFor(() => {
      expect(refreshThread).toHaveBeenCalledWith("ws-1", "durable-thread-id");
      expect(startThreadForWorkspace).not.toHaveBeenCalled();
      expect(sendUserMessage).toHaveBeenCalledTimes(1);
      expect(pushThreadErrorMessage).toHaveBeenCalledWith(
        workspace.id,
        "durable-thread-id",
        expect.any(String),
      );
    });
  });
  it("does not fresh-replace a thread-start Codex draft that cannot be rebound", async () => {
    vi.mocked(sendUserMessage).mockResolvedValueOnce({
      error: {
        message: "thread not found: legacy-thread-id",
      },
    } as never);
    const refreshThread = vi.fn(async () => null);
    const forkThreadForWorkspace = vi.fn(async () => "thread-fork-should-not-use");
    const startThreadForWorkspace = vi.fn(async () => "thread-fresh-draft");
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
      expect(dispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: "setActiveThreadId",
          threadId: "thread-fresh-draft",
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
});
