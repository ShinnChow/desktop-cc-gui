// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { listener, mount, type Handlers } from "./useAppServerEventsTestSetup";
import {
  clearSharedSessionBindingsForSharedThread,
  registerSharedSessionNativeBinding,
} from "../../shared-session/runtime/sharedSessionBridge";

describe("useAppServerEvents", () => {
  it("quarantines provider continuation bootstrap events from conversation handlers", async () => {
    const handlers: Handlers = {
      onAppServerEvent: vi.fn(),
      onTurnStarted: vi.fn(),
      onAgentMessageDelta: vi.fn(),
      onReasoningTextDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/started",
          params: {
            threadId: "claude:target-1",
            turnId: "provider-continuation-operation-1",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAppServerEvent).not.toHaveBeenCalled();
    expect(handlers.onTurnStarted).not.toHaveBeenCalled();
    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();
    expect(handlers.onReasoningTextDelta).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("falls back to the unique processing Codex thread for reasoning events without threadId", async () => {
    const handlers: Handlers = {
      onAppServerEvent: vi.fn(),
      onReasoningSummaryDelta: vi.fn(),
      onReasoningTextDelta: vi.fn(),
      onReasoningSummaryBoundary: vi.fn(),
      getSingleProcessingCodexThreadId: vi.fn(() => "codex:processing-thread"),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_summary_text.delta",
          params: {
            item: { id: "reasoning-1" },
            delta: "checking sibling specs",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(handlers.onReasoningSummaryDelta).toHaveBeenCalledWith(
      "ws-1",
      "codex:processing-thread",
      "reasoning-1",
      "checking sibling specs",
    );

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_summary_part.added",
          params: {
            part: { item_id: "reasoning-2" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(handlers.onReasoningSummaryBoundary).toHaveBeenCalledWith(
      "ws-1",
      "codex:processing-thread",
      "reasoning-2",
    );

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_text.delta",
          params: {
            item_id: "reasoning-3",
            text: "I am verifying sibling spec directories.",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(handlers.onReasoningTextDelta).toHaveBeenCalledWith(
      "ws-1",
      "codex:processing-thread",
      "reasoning-3",
      "I am verifying sibling spec directories.",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not route ownerless reasoning progress to the active Codex thread", async () => {
    const handlers: Handlers = {
      onReasoningTextDelta: vi.fn(),
      getActiveCodexThreadId: vi.fn(() => "codex:active-thread"),
      getSingleProcessingCodexThreadId: vi.fn(() => null),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_text.delta",
          params: {
            item_id: "reasoning-ambiguous",
            text: "late ownerless progress",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.getSingleProcessingCodexThreadId).toHaveBeenCalledWith(
      "ws-1",
    );
    expect(handlers.getActiveCodexThreadId).not.toHaveBeenCalled();
    expect(handlers.onReasoningTextDelta).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("routes ownerless progress to the unique processing Codex thread instead of a completed active thread", async () => {
    const handlers: Handlers = {
      onReasoningTextDelta: vi.fn(),
      getActiveCodexThreadId: vi.fn(() => "codex:completed-active"),
      getSingleProcessingCodexThreadId: vi.fn(() => "codex:still-processing"),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "response.reasoning_text.delta",
          params: {
            item_id: "reasoning-late",
            text: "ownerless progress belongs to the only live candidate",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.getActiveCodexThreadId).not.toHaveBeenCalled();
    expect(handlers.onReasoningTextDelta).toHaveBeenCalledWith(
      "ws-1",
      "codex:still-processing",
      "reasoning-late",
      "ownerless progress belongs to the only live candidate",
    );
    expect(handlers.onReasoningTextDelta).not.toHaveBeenCalledWith(
      "ws-1",
      "codex:completed-active",
      expect.any(String),
      expect.any(String),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not start a turn from ownerless turn/started events", async () => {
    const handlers: Handlers = {
      onTurnStarted: vi.fn(),
      getActiveCodexThreadId: vi.fn(() => "codex:active-thread"),
      getSingleProcessingCodexThreadId: vi.fn(() => "codex:processing-thread"),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/started",
          params: {
            turnId: "ownerless-turn",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.getActiveCodexThreadId).not.toHaveBeenCalled();
    expect(handlers.getSingleProcessingCodexThreadId).not.toHaveBeenCalled();
    expect(handlers.onTurnStarted).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("routes agent delta when threadId is nested in turn and payload uses text field", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: {
            turn: { threadId: "claude:session-1", id: "turn-1" },
            itemId: "item-1",
            text: "chunk-from-text-field",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "claude:session-1",
      itemId: "item-1",
      delta: "chunk-from-text-field",
      turnId: "turn-1",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes background task updates to onBackgroundTaskUpdated", async () => {
    const onBackgroundTaskUpdated = vi.fn();
    const handlers: Handlers = { onBackgroundTaskUpdated };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/backgroundTask/updated",
          params: {
            threadId: "pi:session-1",
            toolId: null,
            task: { id: "b2e2f48ad", status: "completed", exitCode: 0 },
            source: "notification",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/backgroundTask/updated",
          params: {
            threadId: "pi:session-1",
            toolId: "tool-bg-1",
            task: { id: "b2e2f48ad", status: "running" },
            source: "receipt",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onBackgroundTaskUpdated).toHaveBeenCalledTimes(2);
    expect(onBackgroundTaskUpdated).toHaveBeenNthCalledWith(
      1,
      "ws-1",
      "pi:session-1",
      {
        toolId: null,
        task: { id: "b2e2f48ad", status: "completed", exitCode: 0 },
        source: "notification",
      },
    );
    expect(onBackgroundTaskUpdated).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      "pi:session-1",
      {
        toolId: "tool-bg-1",
        task: { id: "b2e2f48ad", status: "running" },
        source: "receipt",
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes item and tool-delta events when threadId is nested in turn", async () => {
    const handlers: Handlers = {
      onItemStarted: vi.fn(),
      onCommandOutputDelta: vi.fn(),
      onTerminalInteraction: vi.fn(),
      onFileChangeOutputDelta: vi.fn(),
      onReasoningSummaryDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/started",
          params: {
            turn: { threadId: "claude:session-1" },
            item: { id: "tool-1", type: "commandExecution", status: "started" },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/commandExecution/outputDelta",
          params: {
            turn: { threadId: "claude:session-1", id: "turn-1", itemId: "tool-1" },
            delta: "partial output",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/commandExecution/terminalInteraction",
          params: {
            turn: { threadId: "claude:session-1", id: "turn-1", itemId: "tool-1" },
            stdin: "y\n",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/fileChange/outputDelta",
          params: {
            turn: { threadId: "claude:session-1", id: "turn-1", itemId: "file-1" },
            delta: "File changes",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/reasoning/summaryTextDelta",
          params: {
            turn: { threadId: "claude:session-1", id: "turn-1", itemId: "reasoning-1" },
            delta: "thinking...",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemStarted).toHaveBeenCalledWith("ws-1", "claude:session-1", {
      id: "tool-1",
      type: "commandExecution",
      status: "started",
    });
    expect(handlers.onCommandOutputDelta).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      "tool-1",
      "partial output",
      "turn-1",
    );
    expect(handlers.onTerminalInteraction).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      "tool-1",
      "y\n",
      "turn-1",
    );
    expect(handlers.onFileChangeOutputDelta).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      "file-1",
      "File changes",
      "turn-1",
    );
    expect(handlers.onReasoningSummaryDelta).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      "reasoning-1",
      "thinking...",
      null,
      "turn-1",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("passes turnId through legacy agent message delta events", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-codex-legacy-delta",
            turnId: "turn-codex-legacy-delta",
            itemId: "assistant-delta-1",
            delta: "legacy delta",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-codex",
      threadId: "thread-codex-legacy-delta",
      itemId: "assistant-delta-1",
      delta: "legacy delta",
      turnId: "turn-codex-legacy-delta",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("passes turnId through normalized fallback realtime events", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onFileChangeOutputDelta: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude-normalized",
        message: {
          method: "item/agentMessage/delta",
          params: {
            turn: { threadId: "claude:session-normalized", id: "turn-normalized" },
            itemId: "assistant-normalized-1",
            delta: "normalized delta",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude-normalized",
        message: {
          method: "item/fileChange/outputDelta",
          params: {
            turn: {
              threadId: "claude:session-normalized",
              id: "turn-normalized",
              itemId: "file-normalized-1",
            },
            delta: "File changes",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude-normalized",
      threadId: "claude:session-normalized",
      itemId: "assistant-normalized-1",
      delta: "normalized delta",
      turnId: "turn-normalized",
    });
    expect(handlers.onFileChangeOutputDelta).toHaveBeenCalledWith(
      "ws-claude-normalized",
      "claude:session-normalized",
      "file-normalized-1",
      "File changes",
      "turn-normalized",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("hydrates turnId into legacy raw item events", async () => {
    const handlers: Handlers = {
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/updated",
          params: {
            threadId: "thread-codex-legacy-item",
            turnId: "turn-codex-legacy-item",
            item: {
              id: "cmd-legacy-item",
              type: "commandExecution",
              status: "running",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-codex",
      "thread-codex-legacy-item",
      expect.objectContaining({
        id: "cmd-legacy-item",
        type: "commandExecution",
        turnId: "turn-codex-legacy-item",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("preserves shared-session engine source on legacy raw item events", async () => {
    const handlers: Handlers = {
      onItemUpdated: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-claude-legacy-item",
      sharedThreadId: "shared:thread-claude-legacy-item",
      nativeThreadId: "claude:legacy-native-item",
      engine: "claude",
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-claude-legacy-item",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:legacy-native-item",
            turnId: "turn-shared-claude-legacy-item",
            item: {
              id: "tool-shared-claude",
              type: "commandExecution",
              status: "running",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-shared-claude-legacy-item",
      "shared:thread-claude-legacy-item",
      expect.objectContaining({
        id: "tool-shared-claude",
        type: "commandExecution",
        turnId: "turn-shared-claude-legacy-item",
        engineSource: "claude",
      }),
    );

    clearSharedSessionBindingsForSharedThread(
      "ws-shared-claude-legacy-item",
      "shared:thread-claude-legacy-item",
    );
    await act(async () => {
      root.unmount();
    });
  });

  it("routes item/agentMessage/textDelta alias in legacy event path", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/textDelta",
          params: {
            threadId: "claude:session-2",
            itemId: "item-2",
            delta: "alias-delta",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "claude:session-2",
      itemId: "item-2",
      delta: "alias-delta",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("ignores delta events missing required fields", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "", itemId: "item-1", delta: "Hello" },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "", delta: "Hello" },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/agentMessage/delta",
          params: { threadId: "thread-1", itemId: "item-1", delta: "" },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("passes engine hint when thread session id is updated", async () => {
    const handlers: Handlers = {
      onThreadSessionIdUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-opencode",
        message: {
          method: "thread/started",
          params: {
            threadId: "opencode-pending-1",
            sessionId: "ses_1",
            turnId: "turn-1",
            engine: "opencode",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadSessionIdUpdated).toHaveBeenCalledWith(
      "ws-opencode",
      "opencode-pending-1",
      "ses_1",
      "opencode",
      "turn-1",
    );

    await act(async () => {
      root.unmount();
    });
  });

});
