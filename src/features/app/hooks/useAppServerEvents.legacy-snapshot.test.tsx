// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { listener, mount, type Handlers } from "./useAppServerEventsTestSetup";

describe("useAppServerEvents", () => {
  it("routes claude item/updated agentMessage snapshot in legacy routing", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-101",
            item: {
              id: "assistant-101",
              type: "agentMessage",
              text: "snapshot text",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();
    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-claude",
      "claude:session-101",
      expect.objectContaining({
        id: "assistant-101",
        type: "agentMessage",
        text: "snapshot text",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("ignores codex item/updated agentMessage snapshot after streaming delta in legacy routing", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-codex-legacy-1",
            itemId: "assistant-codex-legacy-1",
            delta: "codex stream",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/updated",
          params: {
            threadId: "thread-codex-legacy-1",
            item: {
              id: "assistant-codex-legacy-1",
              type: "agentMessage",
              text: "codex snapshot",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-codex",
      threadId: "thread-codex-legacy-1",
      itemId: "assistant-codex-legacy-1",
      delta: "codex stream",
    });
    expect(handlers.onItemUpdated).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps claude snapshot updates flowing through legacy mode when delta and snapshot coexist", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
      onItemStarted: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "turn/started",
          params: {
            threadId: "claude:session-seq-2",
            turnId: "turn-2",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "claude:session-seq-2",
            itemId: "assistant-seq-2",
            delta: "第一段",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/started",
          params: {
            threadId: "claude:session-seq-2",
            item: {
              id: "assistant-seq-2",
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
            threadId: "claude:session-seq-2",
            item: {
              id: "assistant-seq-2",
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
            threadId: "claude:session-seq-2",
            itemId: "assistant-seq-2",
            delta: "第二段",
          },
        },
      });
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:session-seq-2",
            item: {
              id: "assistant-seq-2",
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
            threadId: "claude:session-seq-2",
            turnId: "turn-2",
            result: {
              text: "第一段第二段",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledTimes(2);
    expect(handlers.onAgentMessageDelta).toHaveBeenNthCalledWith(1, {
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-2",
      itemId: "assistant-seq-2",
      delta: "第一段",
    });
    expect(handlers.onAgentMessageDelta).toHaveBeenNthCalledWith(2, {
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-2",
      itemId: "assistant-seq-2",
      delta: "第二段",
    });
    expect(handlers.onItemStarted).not.toHaveBeenCalled();
    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-claude",
      "claude:session-seq-2",
      expect.objectContaining({
        id: "assistant-seq-2",
        type: "agentMessage",
        text: "第一段第二段",
      }),
    );
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-seq-2",
      itemId: "assistant-seq-2",
      text: "第一段第二段",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps claude agent completion when only snapshot and completed arrive in legacy mode", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/updated",
          params: {
            threadId: "claude:session-snapshot-only-2",
            item: {
              id: "assistant-snapshot-only-2",
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
            threadId: "claude:session-snapshot-only-2",
            item: {
              id: "assistant-snapshot-only-2",
              type: "agentMessage",
              text: "snapshot-only-text",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();
    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-claude",
      "claude:session-snapshot-only-2",
      expect.objectContaining({
        id: "assistant-snapshot-only-2",
        type: "agentMessage",
        text: "snapshot-only-text",
      }),
    );
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledTimes(1);
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-snapshot-only-2",
      itemId: "assistant-snapshot-only-2",
      text: "snapshot-only-text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("routes codex agentMessage snapshots through itemUpdated when no normalized handler is provided", async () => {
    const handlers: Handlers = {
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/updated",
          params: {
            threadId: "thread-codex-1",
            item: {
              id: "assistant-codex-1",
              type: "agentMessage",
              text: "codex snapshot",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-codex",
      "thread-codex-1",
      expect.objectContaining({
        id: "assistant-codex-1",
        type: "agentMessage",
        text: "codex snapshot",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes codex normalized realtime events directly when a normalized handler is provided", async () => {
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex-direct",
        message: {
          method: "item/updated",
          params: {
            threadId: "thread-codex-direct-1",
            item: {
              id: "assistant-codex-direct-1",
              type: "agentMessage",
              text: "codex snapshot direct",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        workspaceId: "ws-codex-direct",
        threadId: "thread-codex-direct-1",
        operation: "itemUpdated",
        sourceMethod: "item/updated",
        item: expect.objectContaining({
          id: "assistant-codex-direct-1",
          kind: "message",
          role: "assistant",
          text: "codex snapshot direct",
        }),
      }),
    );
    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

});
