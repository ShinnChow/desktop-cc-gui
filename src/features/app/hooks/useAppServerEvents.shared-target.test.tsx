// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { listener, mount, type Handlers } from "./useAppServerEventsTestSetup";
import {
  clearSharedSessionBindingsForSharedThread,
  registerSharedSessionNativeBinding,
} from "../../shared-session/runtime/sharedSessionBridge";
import { beginTurn } from "../../shared-session/target/targetStore";
import { freezeTurnSnapshot } from "../../shared-session/target/types";

describe("useAppServerEvents", () => {
  it("attaches the frozen target to shared normalized assistant items", async () => {
    const workspaceId = "ws-shared-target";
    const sharedThreadId = "shared:thread-target";
    const nativeThreadId = "codex-native-thread-target";
    registerSharedSessionNativeBinding({
      workspaceId,
      sharedThreadId,
      nativeThreadId,
      engine: "codex",
      attemptId: "attempt-shared-target",
    });
    beginTurn(
      workspaceId,
      sharedThreadId,
      freezeTurnSnapshot({
        engine: "codex",
        providerProfileId: "provider-b",
        providerProfileNameSnapshot: "Provider B",
        providerProfileSource: "managed",
        model: "gpt-provider-b",
        reasoning: { effort: "medium" },
      }),
      "attempt-shared-target",
    );
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: workspaceId,
        message: {
          method: "item/updated",
          params: {
            threadId: nativeThreadId,
            item: {
              id: "assistant-shared-target",
              type: "agentMessage",
              text: "shared snapshot",
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: sharedThreadId,
        item: expect.objectContaining({
          id: "assistant-shared-target",
          executionTargetSnapshot: expect.objectContaining({
            engine: "codex",
            providerProfileNameSnapshot: "Provider B",
            model: "gpt-provider-b",
            reasoning: { effort: "medium" },
          }),
        }),
      }),
    );

    clearSharedSessionBindingsForSharedThread(workspaceId, sharedThreadId);
    await act(async () => {
      root.unmount();
    });
  });

  it("carries the exact Shared Runtime owner into approval and user-input control requests", async () => {
    const handlers: Handlers = {
      onApprovalRequest: vi.fn(),
      onRequestUserInput: vi.fn(),
    };
    const { root } = await mount(handlers);
    const sharedOwner = {
      sharedSessionId: "control-owner",
      sharedThreadId: "shared:control-owner",
      nativeThreadId: "codex-native-control",
      runtimeTurnId: "runtime-turn-control",
      attemptId: "attempt-control",
      providerRuntimeKey: "codex::ws-control::provider-a",
      bindingKey: "codex:provider-a",
      engine: "codex",
      executionTargetSnapshot: {
        engine: "codex",
        providerProfileId: "provider-a",
        modelCatalogEntryId: "catalog-a",
        model: "runtime-a",
        reasoning: { effort: "high" },
        providerProfileNameSnapshot: "Provider A",
        providerProfileSource: "managed",
      },
    };
    const expectedOwner = {
      attemptId: "attempt-control",
      providerRuntimeKey: "codex::ws-control::provider-a",
      sharedThreadId: "shared:control-owner",
      nativeThreadId: "codex-native-control",
      runtimeTurnId: "runtime-turn-control",
      engine: "codex",
      providerProfileId: "provider-a",
    };

    await act(async () => {
      listener?.({
        workspace_id: "ws-control",
        message: {
          id: 41,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: "shared:control-owner",
            nativeThreadId: "codex-native-control",
            turnId: "runtime-turn-control",
            sharedOwner,
          },
        },
      });
      listener?.({
        workspace_id: "ws-control",
        message: {
          id: 42,
          method: "item/tool/requestUserInput",
          params: {
            threadId: "shared:control-owner",
            nativeThreadId: "codex-native-control",
            turnId: "runtime-turn-control",
            itemId: "ask-control",
            sharedOwner,
            questions: [
              {
                id: "confirm",
                header: "Confirm",
                question: "Continue?",
              },
            ],
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onApprovalRequest).toHaveBeenCalledWith({
      workspace_id: "ws-control",
      request_id: 41,
      method: "item/commandExecution/requestApproval",
      params: expect.any(Object),
      shared_runtime_owner: expectedOwner,
    });
    expect(handlers.onRequestUserInput).toHaveBeenCalledWith({
      workspace_id: "ws-control",
      request_id: 42,
      shared_runtime_owner: expectedOwner,
      params: expect.objectContaining({
        thread_id: "shared:control-owner",
        turn_id: "runtime-turn-control",
        item_id: "ask-control",
      }),
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("fails closed instead of inferring a Shared control owner from thread identity", async () => {
    const handlers: Handlers = {
      onApprovalRequest: vi.fn(),
      onRequestUserInput: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-control",
        message: {
          id: 51,
          method: "approval/request",
          params: {
            threadId: "shared:missing-owner",
            turnId: "runtime-turn-missing",
          },
        },
      });
      listener?.({
        workspace_id: "ws-control",
        message: {
          id: 52,
          method: "item/tool/requestUserInput",
          params: {
            threadId: "shared:missing-owner",
            turnId: "runtime-turn-missing",
            itemId: "ask-missing",
            questions: [],
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onApprovalRequest).not.toHaveBeenCalled();
    expect(handlers.onRequestUserInput).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("attaches the frozen target when Rust already projected the raw owner to Shared", async () => {
    const workspaceId = "ws-shared-rust-owner";
    const sharedThreadId = "shared:thread-rust-owner";
    beginTurn(
      workspaceId,
      sharedThreadId,
      freezeTurnSnapshot({
        engine: "codex",
        providerProfileId: "poisoned-current-picker",
        providerProfileNameSnapshot: "Poisoned Current Picker",
        providerProfileSource: "managed",
        model: "poisoned-runtime-model",
      }),
      "attempt-kimi",
    );
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: workspaceId,
        message: {
          method: "item/updated",
          params: {
            threadId: sharedThreadId,
            nativeThreadId: "codex-native-kimi",
            sharedOwner: {
              sharedSessionId: "thread-rust-owner",
              sharedThreadId,
              nativeThreadId: "codex-native-kimi",
              runtimeTurnId: "run-kimi",
              attemptId: "attempt-kimi",
              bindingKey: "codex:provider-kimi",
              engine: "codex",
              executionTargetSnapshot: {
                engine: "codex",
                providerProfileId: "provider-kimi",
                modelCatalogEntryId: "catalog-kimi",
                model: "kimi-for-coding",
                reasoning: { effort: "high" },
                providerProfileNameSnapshot: "Kimi Coding",
                providerProfileSource: "managed",
                runtimeCapabilityFingerprint: "capability-kimi",
              },
            },
            item: {
              id: "assistant-shared-rust-owner",
              type: "agentMessage",
              text: "owned before dispatch RPC returned",
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: sharedThreadId,
        item: expect.objectContaining({
          executionTargetSnapshot: expect.objectContaining({
            engine: "codex",
            providerProfileId: "provider-kimi",
            providerProfileNameSnapshot: "Kimi Coding",
            modelCatalogEntryId: "catalog-kimi",
            model: "kimi-for-coding",
            reasoning: { effort: "high" },
            runtimeCapabilityFingerprint: "capability-kimi",
          }),
        }),
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("labels the first Shared delta from the embedded durable target without reading the picker", async () => {
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-first-owned-delta",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "shared:first-owned-delta",
            nativeThreadId: "claude-native-first-owned-delta",
            turnId: "run-first-owned-delta",
            itemId: "assistant-first-owned-delta",
            delta: "first",
            sharedOwner: {
              sharedSessionId: "first-owned-delta",
              sharedThreadId: "shared:first-owned-delta",
              nativeThreadId: "claude-native-first-owned-delta",
              runtimeTurnId: "run-first-owned-delta",
              logicalTurnId: "logical-first-owned-delta",
              attemptId: "attempt-first-owned-delta",
              bindingKey: "claude:provider-first",
              engine: "claude",
              executionTargetSnapshot: {
                engine: "claude",
                providerProfileId: "provider-first",
                modelCatalogEntryId: "catalog-first",
                model: "runtime-first",
                reasoning: { effort: "medium" },
                providerProfileNameSnapshot: "First Provider",
                providerProfileSource: "managed",
                runtimeCapabilityFingerprint: "capability-first",
              },
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "shared:first-owned-delta",
        delta: "first",
        item: expect.objectContaining({
          role: "assistant",
          text: "first",
          executionTargetSnapshot: {
            engine: "claude",
            providerProfileId: "provider-first",
            modelCatalogEntryId: "catalog-first",
            model: "runtime-first",
            reasoning: { effort: "medium" },
            providerProfileNameSnapshot: "First Provider",
            providerProfileSource: "managed",
            runtimeCapabilityFingerprint: "capability-first",
          },
        }),
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not attach an active snapshot to a different runtime attempt", async () => {
    const workspaceId = "ws-attempt-isolation";
    const sharedThreadId = "shared:attempt-isolation";
    beginTurn(
      workspaceId,
      sharedThreadId,
      freezeTurnSnapshot({
        engine: "codex",
        providerProfileId: "provider-attempt-a",
        model: "model-attempt-a",
      }),
      "attempt-a",
    );
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: workspaceId,
        message: {
          method: "item/updated",
          params: {
            threadId: sharedThreadId,
            nativeThreadId: "codex-native-attempt-b",
            sharedOwner: {
              sharedSessionId: "attempt-isolation",
              sharedThreadId,
              nativeThreadId: "codex-native-attempt-b",
              attemptId: "attempt-b",
              bindingKey: "codex:provider-attempt-b",
              engine: "codex",
            },
            item: {
              id: "assistant-attempt-b",
              type: "agentMessage",
              text: "attempt b",
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        item: expect.not.objectContaining({
          executionTargetSnapshot: expect.anything(),
        }),
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not route codex completed agentMessage snapshots through legacy itemCompleted when normalized handler is provided", async () => {
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
      onItemCompleted: vi.fn(),
      onThreadTokenUsageUpdated: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex-direct",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-codex-direct-2",
            item: {
              id: "assistant-codex-direct-2",
              type: "agentMessage",
              text: "final direct text",
            },
            usage: {
              input_tokens: 8,
              output_tokens: 13,
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
        threadId: "thread-codex-direct-2",
        operation: "completeAgentMessage",
        item: expect.objectContaining({
          id: "assistant-codex-direct-2",
          kind: "message",
          role: "assistant",
          text: "final direct text",
        }),
      }),
    );
    expect(handlers.onItemCompleted).not.toHaveBeenCalled();
    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-codex-direct",
      "thread-codex-direct-2",
      expect.objectContaining({
        total: expect.objectContaining({
          inputTokens: 8,
          outputTokens: 13,
        }),
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps codex item/updated snapshots flowing after streaming delta in normalized mode", async () => {
    const handlers: Handlers = {
      onAgentMessageDelta: vi.fn(),
      onItemUpdated: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-codex-2",
            itemId: "assistant-codex-2",
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
            threadId: "thread-codex-2",
            item: {
              id: "assistant-codex-2",
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
      threadId: "thread-codex-2",
      itemId: "assistant-codex-2",
      delta: "codex stream",
    });
    expect(handlers.onItemUpdated).toHaveBeenCalledTimes(1);
    expect(handlers.onItemUpdated).toHaveBeenCalledWith(
      "ws-codex",
      "thread-codex-2",
      expect.objectContaining({
        id: "assistant-codex-2",
        type: "agentMessage",
        text: "codex snapshot",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("prefers codex item/updated snapshot over later delta for the same assistant item", async () => {
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
      onAgentMessageDelta: vi.fn(),
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
            threadId: "thread-codex-3",
            item: {
              id: "assistant-codex-3",
              type: "agentMessage",
              text: "snapshot authority",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-codex-3",
            itemId: "assistant-codex-3",
            delta: "late delta after snapshot",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledTimes(1);
    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        workspaceId: "ws-codex",
        threadId: "thread-codex-3",
        operation: "itemUpdated",
        item: expect.objectContaining({
          id: "assistant-codex-3",
          kind: "message",
          role: "assistant",
          text: "snapshot authority",
        }),
      }),
    );
    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("prefers codex item/started snapshot over later delta for the same assistant item", async () => {
    const handlers: Handlers = {
      onNormalizedRealtimeEvent: vi.fn(),
      onAgentMessageDelta: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/started",
          params: {
            threadId: "thread-codex-started-1",
            item: {
              id: "assistant-codex-started-1",
              type: "agentMessage",
              text: "started snapshot authority",
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-codex",
        message: {
          method: "item/agentMessage/delta",
          params: {
            threadId: "thread-codex-started-1",
            itemId: "assistant-codex-started-1",
            delta: "late delta after started snapshot",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledTimes(1);
    expect(handlers.onNormalizedRealtimeEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        workspaceId: "ws-codex",
        threadId: "thread-codex-started-1",
        operation: "itemStarted",
        item: expect.objectContaining({
          id: "assistant-codex-started-1",
          kind: "message",
          role: "assistant",
          text: "started snapshot authority",
        }),
      }),
    );
    expect(handlers.onAgentMessageDelta).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

});
