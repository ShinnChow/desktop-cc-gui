// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { listener, mount, type Handlers } from "./useAppServerEventsTestSetup";
import {
  clearSharedSessionBindingsForSharedThread,
  registerSharedSessionNativeBinding,
} from "../../shared-session/runtime/sharedSessionBridge";

describe("useAppServerEvents", () => {
  it("passes turnId through legacy agent message completion snapshots", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            item: {
              type: "agentMessage",
              id: "assistant-1",
              text: "final response from snapshot",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "assistant-1",
      text: "final response from snapshot",
      turnId: "turn-1",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("does not emit fallback assistant completion when delta already arrived", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "item-1", delta: "streaming..." },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            result: { text: "final response from result" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageCompleted).not.toHaveBeenCalled();
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith("ws-1", "thread-1", "turn-1");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not synthesize a Kimi completion after a pending delta is promoted to its canonical session", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onThreadSessionIdUpdated: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-kimi",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "kimi-pending-1",
            itemId: "kimi-item-1",
            delta: "你好！有什么可以帮你的吗？",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-kimi",
        message: {
          method: "thread/started",
          params: {
            threadId: "kimi-pending-1",
            sessionId: "session-real-1",
            turnId: "kimi-turn-1",
            engine: "kimi",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-kimi",
        message: {
          method: "turn/completed",
          params: {
            threadId: "kimi:session-real-1",
            turnId: "kimi-turn-1",
            result: { text: "你好！有什么可以帮你的吗？" },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadSessionIdUpdated).toHaveBeenCalledWith(
      "ws-kimi",
      "kimi-pending-1",
      "session-real-1",
      "kimi",
      "kimi-turn-1",
    );
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-kimi",
      threadId: "kimi-pending-1",
      itemId: "kimi-item-1",
      delta: "你好！有什么可以帮你的吗？",
    });
    expect(handlers.onAgentMessageCompleted).not.toHaveBeenCalled();
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-kimi",
      "kimi:session-real-1",
      "kimi-turn-1",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not synthesize a Grok completion after a pending delta is promoted to its canonical session", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onThreadSessionIdUpdated: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-grok",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "grok-pending-1",
            itemId: "grok-item-1",
            delta: "你好！有什么可以帮你的吗？",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-grok",
        message: {
          method: "thread/started",
          params: {
            threadId: "grok-pending-1",
            sessionId: "session-real-1",
            turnId: "grok-turn-1",
            engine: "grok",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-grok",
        message: {
          method: "turn/completed",
          params: {
            threadId: "grok:session-real-1",
            turnId: "grok-turn-1",
            result: { text: "你好！有什么可以帮你的吗？" },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadSessionIdUpdated).toHaveBeenCalledWith(
      "ws-grok",
      "grok-pending-1",
      "session-real-1",
      "grok",
      "grok-turn-1",
    );
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-grok",
      threadId: "grok-pending-1",
      itemId: "grok-item-1",
      delta: "你好！有什么可以帮你的吗？",
    });
    expect(handlers.onAgentMessageCompleted).not.toHaveBeenCalled();
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-grok",
      "grok:session-real-1",
      "grok-turn-1",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not emit duplicated completion when item/completed already delivered agent text", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
      onItemCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-1", text: "final response" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
            result: { text: "final response" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith("ws-1", "thread-1", "turn-1");

    await act(async () => {
      root.unmount();
    });
  });

  it("does not emit fallback completion when agentMessage snapshot already arrived via item/updated", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/updated",
          params: {
            threadId: "codex:thread-1",
            item: { type: "agentMessage", id: "item-1", text: "final response" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/completed",
          params: {
            threadId: "codex:thread-1",
            turnId: "turn-1",
            result: { text: "final response" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).not.toHaveBeenCalled();
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-1",
      "codex:thread-1",
      "turn-1",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps turn/completed fallback when agentMessage snapshot text is empty", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/updated",
          params: {
            threadId: "codex:thread-1",
            item: { type: "agentMessage", id: "item-empty", text: "" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/completed",
          params: {
            threadId: "codex:thread-1",
            turnId: "turn-2",
            result: { text: "final response from result" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "codex:thread-1",
      itemId: "turn-2",
      text: "final response from result",
      turnId: "turn-2",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-1",
      "codex:thread-1",
      "turn-2",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("still fuses project memory when shared terminal projection succeeds after delta", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onNormalizedRealtimeEvent: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    const executionTargetSnapshot = {
      engine: "claude" as const,
      providerProfileId: "provider-shared-memory",
      modelCatalogEntryId: "catalog-shared-memory",
      model: "claude-model",
      reasoning: null,
      providerProfileNameSnapshot: "Provider Shared Memory",
      providerProfileSource: "managed" as const,
      runtimeCapabilityFingerprint: null,
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-memory-fusion",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "shared:thread-memory",
            nativeThreadId: "native-memory",
            turnId: "runtime-memory-turn",
            itemId: "assistant-memory",
            delta: "shared assistant reply",
            sharedOwner: {
              sharedSessionId: "thread-memory",
              sharedThreadId: "shared:thread-memory",
              nativeThreadId: "native-memory",
              runtimeTurnId: "runtime-memory-turn",
              attemptId: "attempt-memory",
              bindingKey: "claude:provider-shared-memory",
              engine: "claude",
              executionTargetSnapshot,
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-memory-fusion",
        message: {
          method: "turn/completed",
          params: {
            threadId: "shared:thread-memory",
            turnId: "runtime-memory-turn",
            result: { text: "shared assistant reply" },
            sharedOwner: {
              sharedSessionId: "thread-memory",
              sharedThreadId: "shared:thread-memory",
              nativeThreadId: "native-memory",
              runtimeTurnId: "runtime-memory-turn",
              attemptId: "attempt-memory",
              bindingKey: "claude:provider-shared-memory",
              engine: "claude",
              executionTargetSnapshot,
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "shared:thread-memory",
        operation: "completeAgentMessage",
      }),
    );
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-shared-memory-fusion",
      threadId: "shared:thread-memory",
      itemId: expect.any(String),
      text: "shared assistant reply",
      turnId: "runtime-memory-turn",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-memory-fusion",
      "shared:thread-memory",
      "runtime-memory-turn",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("settles shared terminal final onto the existing Codex assistant item", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-codex-turn",
      sharedThreadId: "shared:thread-codex-turn",
      nativeThreadId: "codex-native-thread-turn",
      engine: "codex",
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-codex-turn",
        message: {
          method: "item/updated",
          params: {
            threadId: "codex-native-thread-turn",
            item: { type: "agentMessage", id: "item-1", text: "shared final response" },
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-codex-turn",
        message: {
          method: "turn/completed",
          params: {
            threadId: "codex-native-thread-turn",
            turnId: "turn-shared-1",
            result: { text: "shared final response" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-shared-codex-turn",
      "shared:thread-codex-turn",
      expect.objectContaining({
        type: "agentMessage",
        id: "item-1",
        text: "shared final response",
      }),
    );
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-shared-codex-turn",
      threadId: "shared:thread-codex-turn",
      itemId: "item-1",
      text: "shared final response",
      turnId: "turn-shared-1",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-codex-turn",
      "shared:thread-codex-turn",
      "turn-shared-1",
    );

    clearSharedSessionBindingsForSharedThread(
      "ws-shared-codex-turn",
      "shared:thread-codex-turn",
    );
    await act(async () => {
      root.unmount();
    });
  });

});
