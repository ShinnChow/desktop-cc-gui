// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { listener, mount, type Handlers } from "./useAppServerEventsTestSetup";

describe("useAppServerEvents", () => {
  it("routes claude text:delta through legacy fallback when normalized adapters are disabled", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "text:delta",
          params: {
            threadId: "claude:session-99",
            delta: "streaming text",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-99",
      itemId: "claude:session-99:text-delta",
      delta: "streaming text",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("ignores turnId as assistant item id for legacy claude text:delta fallback", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "text:delta",
          params: {
            threadId: "claude:session-98",
            turnId: "turn-98",
            delta: "streaming text",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageDelta).toHaveBeenCalledWith({
      workspaceId: "ws-claude",
      threadId: "claude:session-98",
      itemId: "claude:session-98:text-delta",
      delta: "streaming text",
      turnId: "turn-98",
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("hydrates tool output from params in legacy item/completed routing", async () => {
    const handlers: Handlers = {
      onItemCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-claude",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:session-42",
            output: "stdout-line-1\nstdout-line-2",
            item: {
              id: "cmd-1",
              type: "commandExecution",
              command: "ls -la",
              status: "completed",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onItemCompleted).toHaveBeenCalledWith(
      "ws-claude",
      "claude:session-42",
      expect.objectContaining({
        id: "cmd-1",
        type: "commandExecution",
        aggregatedOutput: "stdout-line-1\nstdout-line-2",
        output: "stdout-line-1\nstdout-line-2",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes a Shared turn error with the durable attempt target", async () => {
    const handlers: Handlers = {
      onTurnError: vi.fn(),
    };
    const { root } = await mount(handlers);
    const executionTargetSnapshot = {
      engine: "codex",
      providerProfileId: "provider-error",
      modelCatalogEntryId: "catalog-error",
      model: "runtime-error",
      reasoning: { effort: "high" },
      providerProfileNameSnapshot: "Provider Error",
      providerProfileSource: "managed",
      runtimeCapabilityFingerprint: "capability-error",
    };

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-error",
        message: {
          method: "turn/error",
          params: {
            threadId: "shared:thread-error",
            nativeThreadId: "codex-native-error",
            turnId: "runtime-turn-error",
            error: { message: "provider rejected" },
            sharedOwner: {
              sharedSessionId: "thread-error",
              sharedThreadId: "shared:thread-error",
              nativeThreadId: "codex-native-error",
              runtimeTurnId: "runtime-turn-error",
              attemptId: "attempt-error",
              bindingKey: "codex:provider-error",
              engine: "codex",
              executionTargetSnapshot,
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onTurnError).toHaveBeenCalledWith(
      "ws-shared-error",
      "shared:thread-error",
      "runtime-turn-error",
      {
        message: "provider rejected",
        willRetry: false,
        engine: "codex",
        executionTargetSnapshot,
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("settles a stale Shared Binding without projecting its raw provider error row", async () => {
    const handlers: Handlers = {
      onTurnError: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-stale",
        message: {
          method: "turn/error",
          params: {
            threadId: "shared:thread-stale",
            nativeThreadId: "claude:session-stale",
            turnId: "runtime-turn-stale",
            sharedRecoveryReason: "native-session-not-found",
            error: {
              message: "No conversation found with session ID: session-stale",
            },
            sharedOwner: {
              sharedSessionId: "thread-stale",
              sharedThreadId: "shared:thread-stale",
              nativeThreadId: "claude:session-stale",
              runtimeTurnId: "runtime-turn-stale",
              attemptId: "attempt-stale",
              bindingKey: "claude:provider-stale",
              engine: "claude",
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onTurnError).toHaveBeenCalledWith(
      "ws-shared-stale",
      "shared:thread-stale",
      "runtime-turn-stale",
      expect.objectContaining({
        suppressMessage: true,
        engine: "claude",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("projects a terminal-only Shared assistant with its durable target", async () => {
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);
    const executionTargetSnapshot = {
      engine: "codex",
      providerProfileId: "provider-terminal",
      modelCatalogEntryId: "catalog-terminal",
      model: "runtime-terminal",
      reasoning: { effort: "medium" },
      providerProfileNameSnapshot: "Provider Terminal",
      providerProfileSource: "managed",
      runtimeCapabilityFingerprint: null,
    };

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-terminal",
        message: {
          method: "turn/completed",
          params: {
            threadId: "shared:thread-terminal",
            nativeThreadId: "native-terminal",
            turnId: "runtime-terminal",
            result: { text: "terminal response" },
            sharedOwner: {
              sharedSessionId: "thread-terminal",
              sharedThreadId: "shared:thread-terminal",
              nativeThreadId: "native-terminal",
              runtimeTurnId: "runtime-terminal",
              attemptId: "attempt-terminal",
              bindingKey: "codex:provider-terminal",
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
        operation: "completeAgentMessage",
        threadId: "shared:thread-terminal",
        turnId: "runtime-terminal",
        item: expect.objectContaining({
          text: "terminal response",
          executionTargetSnapshot,
        }),
      }),
    );
    // Project-memory fusion requires onAgentMessageCompleted even when canvas
    // projection already succeeded via onNormalizedRealtimeEvent.
    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-shared-terminal",
      threadId: "shared:thread-terminal",
      itemId: "runtime-terminal",
      text: "terminal response",
      turnId: "runtime-terminal",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-terminal",
      "shared:thread-terminal",
      "runtime-terminal",
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("projects an empty provenance anchor for a reasoning-only Shared turn", async () => {
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);
    const executionTargetSnapshot = {
      engine: "claude",
      providerProfileId: null,
      modelCatalogEntryId: "claude-local",
      model: "claude-sonnet",
      reasoning: null,
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "local",
      runtimeCapabilityFingerprint: null,
    };

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-reasoning-only",
        message: {
          method: "turn/completed",
          params: {
            threadId: "shared:thread-reasoning-only",
            nativeThreadId: "claude:native-reasoning-only",
            turnId: "runtime-reasoning-only",
            sharedOwner: {
              sharedSessionId: "thread-reasoning-only",
              sharedThreadId: "shared:thread-reasoning-only",
              nativeThreadId: "claude:native-reasoning-only",
              runtimeTurnId: "runtime-reasoning-only",
              attemptId: "attempt-reasoning-only",
              bindingKey: "claude:default",
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
        operation: "completeAgentMessage",
        threadId: "shared:thread-reasoning-only",
        item: expect.objectContaining({
          text: "",
          executionTargetSnapshot,
        }),
      }),
    );
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-reasoning-only",
      "shared:thread-reasoning-only",
      "runtime-reasoning-only",
    );

    await act(async () => {
      root.unmount();
    });
  });

});
