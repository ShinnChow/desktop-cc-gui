// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { listener, mount, type Handlers } from "./useAppServerEventsTestSetup";
import {
  clearSharedSessionBindingsForSharedThread,
  registerSharedSessionNativeBinding,
} from "../../shared-session/runtime/sharedSessionBridge";

describe("useAppServerEvents", () => {
  it("routes first delta, reasoning, and terminal from Rust sharedOwner without a frontend binding", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onReasoningTextDelta: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });
    const sharedOwner = {
      sharedSessionId: "owner-session",
      sharedThreadId: "shared:owner-session",
      nativeThreadId: "claude:native-owner",
      runtimeTurnId: "run-owner",
      attemptId: "attempt-owner",
      engine: "claude",
    };

    await act(async () => {
      listener?.({
        workspace_id: "ws-runtime-owner",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "shared:owner-session",
            nativeThreadId: "claude:native-owner",
            turnId: "run-owner",
            itemId: "assistant-owner",
            delta: "first",
            sharedOwner,
          },
        },
      });
      listener?.({
        workspace_id: "ws-runtime-owner",
        message: {
          method: "item/reasoning/textDelta",
          params: {
            threadId: "shared:owner-session",
            nativeThreadId: "claude:native-owner",
            turnId: "run-owner",
            itemId: "reasoning-owner",
            delta: "thinking",
            sharedOwner,
          },
        },
      });
      listener?.({
        workspace_id: "ws-runtime-owner",
        message: {
          method: "turn/completed",
          params: {
            threadId: "shared:owner-session",
            nativeThreadId: "claude:native-owner",
            turnId: "run-owner",
            result: { text: "first" },
            sharedOwner,
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-runtime-owner",
        threadId: "shared:owner-session",
        delta: "first",
      }),
    );
    expect(handlers.onReasoningTextDelta).toHaveBeenCalledWith(
      "ws-runtime-owner",
      "shared:owner-session",
      "reasoning-owner",
      "thinking",
      null,
      "run-owner",
    );
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-runtime-owner",
      "shared:owner-session",
      "run-owner",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("projects a hidden native delta through sharedOwner after conversation navigation", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-native-owner-navigation",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "claude:hidden-native-navigation",
            nativeThreadId: "claude:hidden-native-navigation",
            turnId: "run-native-navigation",
            itemId: "assistant-native-navigation",
            delta: "still routed to Shared",
            sharedOwner: {
              sharedSessionId: "native-owner-navigation",
              sharedThreadId: "shared:native-owner-navigation",
              nativeThreadId: "claude:hidden-native-navigation",
              runtimeTurnId: "run-native-navigation",
              attemptId: "attempt-native-navigation",
              engine: "claude",
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-native-owner-navigation",
        threadId: "shared:native-owner-navigation",
        itemId: "assistant-native-navigation",
        delta: "still routed to Shared",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not restart generic Native lifecycle for a Shared V2 projected turn", async () => {
    const handlers: Handlers = {
      onTurnStarted: vi.fn(),
      onSharedRuntimeTurnStarted: vi.fn(),
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);
    const sharedOwner = {
      sharedSessionId: "owner-session-start",
      sharedThreadId: "shared:owner-session-start",
      nativeThreadId: "claude:native-owner-start",
      runtimeTurnId: "run-owner-start",
      attemptId: "attempt-owner-start",
      engine: "claude",
      executionTargetSnapshot: {
        engine: "claude",
        providerProfileId: "provider-owner-start",
        modelCatalogEntryId: "catalog-owner-start",
        model: "claude-owner-start",
        reasoning: null,
        providerProfileNameSnapshot: "Provider Owner Start",
        providerProfileSource: "managed",
        runtimeCapabilityFingerprint: null,
      },
    };

    await act(async () => {
      listener?.({
        workspace_id: "ws-runtime-owner-start",
        message: {
          method: "turn/started",
          params: {
            threadId: "shared:owner-session-start",
            nativeThreadId: "claude:native-owner-start",
            turnId: "run-owner-start",
            sharedOwner,
          },
        },
      });
      listener?.({
        workspace_id: "ws-runtime-owner-start",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "shared:owner-session-start",
            nativeThreadId: "claude:native-owner-start",
            turnId: "run-owner-start",
            itemId: "assistant-owner-start",
            delta: "content remains projected",
            sharedOwner,
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onTurnStarted).not.toHaveBeenCalled();
    expect(handlers.onSharedRuntimeTurnStarted).toHaveBeenCalledWith(
      "shared:owner-session-start",
      "run-owner-start",
    );
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-runtime-owner-start",
        threadId: "shared:owner-session-start",
        delta: "content remains projected",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("forces a durable Shared owner through normalized routing when the global flag is off", async () => {
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);
    const executionTargetSnapshot = {
      engine: "codex",
      providerProfileId: "provider-live",
      modelCatalogEntryId: "catalog-live",
      model: "runtime-live",
      reasoning: { effort: "high" },
      providerProfileNameSnapshot: "Provider Live",
      providerProfileSource: "managed",
      runtimeCapabilityFingerprint: null,
    };

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-live",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "shared:thread-live",
            nativeThreadId: "native-live",
            turnId: "runtime-live",
            itemId: "assistant-live",
            delta: "live",
            sharedOwner: {
              sharedSessionId: "thread-live",
              sharedThreadId: "shared:thread-live",
              nativeThreadId: "native-live",
              runtimeTurnId: "runtime-live",
              attemptId: "attempt-live",
              bindingKey: "codex:provider-live",
              engine: "codex",
              executionTargetSnapshot,
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "shared:thread-live",
        operation: "appendAgentMessageDelta",
        item: expect.objectContaining({
          text: "live",
          executionTargetSnapshot,
        }),
      }),
    );
    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("settles a complete Claude final over a streamed prefix in Shared Session", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-claude-prefix",
      sharedThreadId: "shared:thread-claude-prefix",
      nativeThreadId: "claude-native-thread-prefix",
      engine: "claude",
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-claude-prefix",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude-native-thread-prefix",
            item: { type: "agentMessage", id: "claude-item-1", text: "Cl" },
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-claude-prefix",
        message: {
          method: "turn/completed",
          params: {
            threadId: "claude-native-thread-prefix",
            turnId: "turn-shared-claude-1",
            result: {
              text: "Claude，Anthropic 出品。当前会话使用完整 terminal final。",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-shared-claude-prefix",
      "shared:thread-claude-prefix",
      expect.objectContaining({
        id: "claude-item-1",
        text: "Cl",
      }),
    );
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-shared-claude-prefix",
      threadId: "shared:thread-claude-prefix",
      itemId: "claude-item-1",
      text: "Claude，Anthropic 出品。当前会话使用完整 terminal final。",
      turnId: "turn-shared-claude-1",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-claude-prefix",
      "shared:thread-claude-prefix",
      "turn-shared-claude-1",
    );

    clearSharedSessionBindingsForSharedThread(
      "ws-shared-claude-prefix",
      "shared:thread-claude-prefix",
    );
    await act(async () => {
      root.unmount();
    });
  });

  it("keeps shared-session turn/completed fallback when snapshot text is empty", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-codex-empty",
      sharedThreadId: "shared:thread-codex-empty",
      nativeThreadId: "codex-native-thread-empty",
      engine: "codex",
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-codex-empty",
        message: {
          method: "item/updated",
          params: {
            threadId: "codex-native-thread-empty",
            item: { type: "agentMessage", id: "item-empty", text: "" },
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-codex-empty",
        message: {
          method: "turn/completed",
          params: {
            threadId: "codex-native-thread-empty",
            turnId: "turn-shared-empty-1",
            result: { text: "shared fallback response" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-shared-codex-empty",
      "shared:thread-codex-empty",
      expect.objectContaining({
        type: "agentMessage",
        id: "item-empty",
      }),
    );
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-shared-codex-empty",
      threadId: "shared:thread-codex-empty",
      itemId: "turn-shared-empty-1",
      text: "shared fallback response",
      turnId: "turn-shared-empty-1",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-codex-empty",
      "shared:thread-codex-empty",
      "turn-shared-empty-1",
    );

    clearSharedSessionBindingsForSharedThread(
      "ws-shared-codex-empty",
      "shared:thread-codex-empty",
    );
    await act(async () => {
      root.unmount();
    });
  });

  it("keeps multiple agent completions in the same thread when item ids differ", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
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
            item: { type: "agentMessage", id: "item-1", text: "first short paragraph" },
          },
        },
      });
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-2", text: "second short paragraph" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(2);
    expect(handlers.onAgentMessageCompleted).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-1",
      text: "first short paragraph",
    });
    expect(handlers.onAgentMessageCompleted).toHaveBeenNthCalledWith(2, {
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-2",
      text: "second short paragraph",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("dedupes repeated item/completed snapshots for the same agent item id", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
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
            item: { type: "agentMessage", id: "item-dup-1", text: "same completion text" },
          },
        },
      });
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-dup-1", text: "same completion text" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-dup-1",
      text: "same completion text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes processing heartbeat events", async () => {
    const handlers: Handlers = {
      onProcessingHeartbeat: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "processing/heartbeat",
          params: { threadId: "thread-1", pulse: 3 },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onProcessingHeartbeat).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      3,
    );

    await act(async () => {
      root.unmount();
    });
  });

});
