// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { listener, mount, type Handlers } from "./useAppServerEventsTestSetup";

describe("useAppServerEvents", () => {
  it("routes opencode text:delta through normalized realtime adapters when enabled", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-opencode",
        message: {
          method: "text:delta",
          params: {
            threadId: "opencode:ses_99",
            itemId: "assistant-1",
            delta: "streaming text",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-opencode",
      threadId: "opencode:ses_99",
      itemId: "assistant-1",
      delta: "streaming text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes claude item/updated agentMessage snapshot in normalized realtime routing", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-100",
            item: {
              id: "assistant-100",
              type: "agentMessage",
              text: "snapshot text",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-100",
      itemId: "assistant-100",
      delta: "snapshot text",
    });
    expect(handlers.onItemUpdated).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("routes codex/raw native image generation events when thread id is present", async () => {
    const handlers: Handlers = {
      onItemStarted: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "codex/raw",
          params: {
            threadId: "thread-codex-image",
            type: "event_msg",
            payload: {
              type: "image_generation_end",
              call_id: "ig-raw-fallback-1",
              status: "generating",
              revised_prompt: "搬砖工人的卡通图",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemStarted).toHaveBeenCalledWith(
      "ws-codex",
      "thread-codex-image",
      expect.objectContaining({
        id: "ig-raw-fallback-1",
        type: "image_generation_end",
        call_id: "ig-raw-fallback-1",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes codex/raw imagegen function calls without broad text guessing", async () => {
    const handlers: Handlers = {
      onItemStarted: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "codex/raw",
          params: {
            threadId: "thread-codex-image-function",
            type: "response_item",
            payload: {
              type: "function_call",
              call_id: "ig-function-route-1",
              name: "imagegen",
              arguments: JSON.stringify({
                prompt: "一张山谷风景图",
              }),
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemStarted).toHaveBeenCalledWith(
      "ws-codex",
      "thread-codex-image-function",
      expect.objectContaining({
        id: "ig-function-route-1",
        type: "mcpToolCall",
        tool: "imagegen",
        status: "in_progress",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes codex/raw image generation events to the unique processing Codex thread when thread identity is missing", async () => {
    const handlers: Handlers = {
      onItemStarted: vi.fn(),
      getSingleProcessingCodexThreadId: vi.fn(
        () => "thread-codex-image-processing",
      ),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "codex/raw",
          params: {
            type: "event_msg",
            payload: {
              type: "image_generation_call",
              call_id: "ig-raw-active-1",
              status: "generating",
              revised_prompt: "一张狮虎搏杀的电影级海报",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.getSingleProcessingCodexThreadId).toHaveBeenCalledWith(
      "ws-codex",
    );
    expect(handlers.onItemStarted).toHaveBeenCalledWith(
      "ws-codex",
      "thread-codex-image-processing",
      expect.objectContaining({
        id: "ig-raw-active-1",
        type: "image_generation_call",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("ignores codex/raw image generation events without any thread identity fallback", async () => {
    const handlers: Handlers = {
      onItemStarted: vi.fn(),
      getSingleProcessingCodexThreadId: vi.fn(() => null),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "codex/raw",
          params: {
            type: "event_msg",
            payload: {
              type: "image_generation_call",
              call_id: "ig-raw-no-thread-1",
              status: "generating",
              revised_prompt: "一张狮虎搏杀的电影级海报",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.getSingleProcessingCodexThreadId).toHaveBeenCalledWith(
      "ws-codex",
    );
    expect(handlers.onItemStarted).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("routes claude growing assistant snapshots in normalized mode when delta and snapshot coexist", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
      onItemStarted: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "turn/started",
          params: {
            threadId: "claude:session-seq-1",
            turnId: "turn-1",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "claude:session-seq-1",
            itemId: "assistant-seq-1",
            delta: "第一段",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/started",
          params: {
            threadId: "claude:session-seq-1",
            item: {
              id: "assistant-seq-1",
              type: "agentMessage",
              text: "第一段",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-seq-1",
            item: {
              id: "assistant-seq-1",
              type: "agentMessage",
              text: "第一段第二段",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "claude:session-seq-1",
            itemId: "assistant-seq-1",
            delta: "第二段",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:session-seq-1",
            item: {
              id: "assistant-seq-1",
              type: "agentMessage",
              text: "第一段第二段",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "turn/completed",
          params: {
            threadId: "claude:session-seq-1",
            turnId: "turn-1",
            result: {
              text: "第一段第二段",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(3);
    expect(handlers.onAgentMessageDelta).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-1",
      itemId: "assistant-seq-1",
      delta: "第一段",
    });
    expect(handlers.onAgentMessageDelta).toHaveBeenNthCalledWith(2, {
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-1",
      itemId: "assistant-seq-1",
      delta: "第一段第二段",
    });
    expect(handlers.onAgentMessageDelta).toHaveBeenNthCalledWith(3, {
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-1",
      itemId: "assistant-seq-1",
      delta: "第二段",
    });
    expect(handlers.onItemStarted).not.toHaveBeenCalled();
    expect(handlers.onItemUpdated).not.toHaveBeenCalled();
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-1",
      itemId: "assistant-seq-1",
      text: "第一段第二段",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps claude agent completion when only snapshot and completed arrive in normalized mode", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-snapshot-only-1",
            item: {
              id: "assistant-snapshot-only-1",
              type: "agentMessage",
              text: "snapshot-only-text",
            },
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:session-snapshot-only-1",
            item: {
              id: "assistant-snapshot-only-1",
              type: "agentMessage",
              text: "snapshot-only-text",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-snapshot-only-1",
      itemId: "assistant-snapshot-only-1",
      delta: "snapshot-only-text",
    });
    expect(handlers.onItemUpdated).not.toHaveBeenCalled();
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-snapshot-only-1",
      itemId: "assistant-snapshot-only-1",
      text: "snapshot-only-text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes claude text:delta through normalized adapters with thread-scoped fallback id when itemId is missing", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "text:delta",
          params: {
            threadId: "claude:session-77",
            turnId: "turn-77",
            delta: "streaming text",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-77",
      itemId: "claude:session-77:text-delta",
      delta: "streaming text",
      turnId: "turn-77",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes gemini text:delta through legacy fallback when normalized adapters are disabled", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-gemini",
        message: {
          method: "text:delta",
          params: {
            threadId: "gemini:session-88",
            itemId: "assistant-88",
            delta: "短正文片段",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-gemini",
      threadId: "gemini:session-88",
      itemId: "assistant-88",
      delta: "短正文片段",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("does not route opencode text:delta when normalized realtime adapters are disabled", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-opencode",
        message: {
          method: "text:delta",
          params: {
            threadId: "opencode:ses_99",
            itemId: "assistant-1",
            delta: "streaming text",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

});
