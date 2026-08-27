// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppServerEvent } from "../../../types";
import {
  subscribeAppServerEvents,
  subscribeRawAppServerEvents,
} from "../../../services/events";
import {
  clearSharedSessionBindingsForSharedThread,
  registerSharedSessionNativeBinding,
} from "../../shared-session/runtime/sharedSessionBridge";
import { registerAgentAttempt } from "../../multi-agent/store/agentStore";
import { useAppServerEvents } from "./useAppServerEvents";

vi.mock("../../../services/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../services/events")>();
  return {
    ...actual,
    subscribeAppServerEvents: vi.fn(),
    subscribeRawAppServerEvents: vi.fn(),
  };
});

type Handlers = Parameters<typeof useAppServerEvents>[0];
type HookOptions = Parameters<typeof useAppServerEvents>[1];

function TestHarness({
  handlers,
  options,
}: {
  handlers: Handlers;
  options?: HookOptions;
}) {
  useAppServerEvents(handlers, options);
  return null;
}

let listener: ((event: AppServerEvent) => void) | null = null;
const unlisten = vi.fn();

beforeEach(() => {
  listener = null;
  unlisten.mockReset();
  vi.mocked(subscribeAppServerEvents).mockImplementation((cb) => {
    listener = cb;
    return unlisten;
  });
  vi.mocked(subscribeRawAppServerEvents).mockImplementation((cb) => {
    listener = cb;
    return unlisten;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function mount(handlers: Handlers, options?: HookOptions) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<TestHarness handlers={handlers} options={options} />);
  });
  return { root };
}

describe("useAppServerEvents token usage", () => {
  it("keeps token usage updates when normalized realtime adapters handle item/completed", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "thread-1",
            item: { type: "agentMessage", id: "item-1", text: "Done" },
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cached_input_tokens: 2,
              model_context_window: 128000,
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "item-1",
      text: "Done",
    });
    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      {
        total: {
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 2,
          totalTokens: 15,
        },
        last: {
          inputTokens: 10,
          outputTokens: 5,
          cachedInputTokens: 2,
          totalTokens: 15,
        },
        modelContextWindow: 128000,
        contextUsageSource: null,
        contextUsageFreshness: null,
        contextUsedTokens: null,
        contextUsedPercent: null,
        contextRemainingPercent: null,
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("preserves Claude normalized context used tokens from runtime telemetry", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
      onAgentMessageCompleted: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:thread-1",
            item: { type: "agentMessage", id: "item-1", text: "Done" },
            usage: {
              input_tokens: 70_000,
              output_tokens: 7_200,
              cached_input_tokens: 27_000,
              model_context_window: 258_400,
              context_used_tokens: 167_800,
              context_usage_source: "context_window",
              context_usage_freshness: "live",
              context_used_percent: 65,
              context_remaining_percent: 35,
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "claude:thread-1",
      {
        total: {
          inputTokens: 70_000,
          outputTokens: 7_200,
          cachedInputTokens: 27_000,
          totalTokens: 77_200,
        },
        last: {
          inputTokens: 70_000,
          outputTokens: 7_200,
          cachedInputTokens: 27_000,
          totalTokens: 77_200,
        },
        modelContextWindow: 258_400,
        contextUsageSource: "context_window",
        contextUsageFreshness: "live",
        contextUsedTokens: 167_800,
        contextUsedPercent: 65,
        contextRemainingPercent: 35,
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps token_count last usage as zero when only total snapshot exists", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
      getSingleProcessingCodexThreadId: vi.fn(() => "thread-codex-2"),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "token_count",
          params: {
            info: {
              total_token_usage: {
                input_tokens: 120000,
                cached_input_tokens: 10000,
                model_context_window: 200000,
              },
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "thread-codex-2",
      {
        total: {
          inputTokens: 120000,
          outputTokens: 0,
          cachedInputTokens: 10000,
          totalTokens: 120000,
        },
        last: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 0,
        },
        modelContextWindow: 200000,
        contextUsageSource: "token_count",
        contextUsageFreshness: "live",
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("emits item/completed token usage updates when cached tokens are present", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
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
            item: { id: "tool-1", type: "command", status: "completed" },
            usage: {
              input_tokens: 0,
              output_tokens: 0,
              cached_input_tokens: 12,
              model_context_window: 200000,
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      {
        total: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 12,
          totalTokens: 0,
        },
        last: {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 12,
          totalTokens: 0,
        },
        modelContextWindow: 200000,
        contextUsageSource: "item_completed_usage",
        contextUsageFreshness: "estimated",
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not default Claude item/completed usage without a window to 200000", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
      onItemCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "claude:thread-1",
            item: { id: "tool-1", type: "command", status: "completed" },
            usage: {
              input_tokens: 97_000,
              output_tokens: 0,
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "claude:thread-1",
      expect.objectContaining({
        modelContextWindow: null,
        contextUsageSource: "item_completed_usage",
        contextUsageFreshness: "estimated",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not default Codex item/completed usage without a window to 200000", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
      onItemCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "item/completed",
          params: {
            threadId: "codex:thread-1",
            item: { id: "tool-1", type: "command", status: "completed" },
            usage: {
              input_tokens: 97_000,
              output_tokens: 0,
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "codex:thread-1",
      expect.objectContaining({
        modelContextWindow: null,
        contextUsageSource: "item_completed_usage",
        contextUsageFreshness: "estimated",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("prefers token_count last snapshot while keeping total snapshot", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
      getSingleProcessingCodexThreadId: vi.fn(() => "thread-codex-1"),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "token_count",
          params: {
            info: {
              total_token_usage: {
                input_tokens: 180000,
                cached_input_tokens: 0,
                model_context_window: 200000,
              },
              last_token_usage: {
                input_tokens: 20000,
                cached_input_tokens: 0,
                model_context_window: 200000,
              },
            },
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-1",
      "thread-codex-1",
      {
        total: {
          inputTokens: 180000,
          outputTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 180000,
        },
        last: {
          inputTokens: 20000,
          outputTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 20000,
        },
        modelContextWindow: 200000,
        contextUsageSource: "token_count",
        contextUsageFreshness: "live",
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes dsh sessionStats raw frames to token usage updates", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-dsh",
        message: {
          method: "dsh/raw",
          params: {
            kind: "dsh-session-stats",
            threadId: "dsh:session-1",
            sessionStats: {
              ttftMs: 8500,
              ttftSteps: 1,
              decodeMs: 1000,
              decodeTokens: 72,
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-dsh",
      "dsh:session-1",
      {
        sessionStats: {
          ttftMs: 8500,
          ttftSteps: 1,
          decodeMs: 1000,
          decodeTokens: 72,
        },
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("routes dsh todos and context occupancy raw frames", async () => {
    const handlers: Handlers = {
      onThreadTokenUsageUpdated: vi.fn(),
    };
    const { root } = await mount(handlers, {
      useNormalizedRealtimeAdapters: true,
    });

    await act(async () => {
      listener?.({
        workspace_id: "ws-dsh",
        message: {
          method: "dsh/raw",
          params: {
            kind: "dsh-todos",
            threadId: "dsh:session-1",
            todos: [{ content: "step", status: "in_progress" }],
          },
        },
      });
      listener?.({
        workspace_id: "ws-dsh",
        message: {
          method: "dsh/raw",
          params: {
            kind: "dsh-context-usage",
            threadId: "dsh:session-1",
            contextPressure: {
              projectedTokens: 209000,
              contextWindow: 262000,
            },
            contextBreakdown: {
              systemTokens: 1500,
              toolsTokens: 6400,
              messageTokens: 196000,
            },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-dsh",
      "dsh:session-1",
      {
        dshTodos: [{ content: "step", status: "in_progress" }],
      },
    );
    expect(handlers.onThreadTokenUsageUpdated).toHaveBeenCalledWith(
      "ws-dsh",
      "dsh:session-1",
      {
        dshContextPatch: expect.objectContaining({
          contextUsedTokens: 209000,
          modelContextWindow: 262000,
          contextUsageSource: "dsh-context-pressure",
          contextCategoryUsages: [
            { name: "system", tokens: 1500 },
            { name: "tools", tokens: 6400 },
            { name: "messages", tokens: 196000 },
          ],
        }),
      },
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("captures Shared turn completed model as an assistant receipt", async () => {
    const handlers: Handlers = {
      onAssistantRuntimeReceipt: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "turn/completed",
          params: {
            threadId: "shared:session-1",
            result: { model: "gpt-5-codex" },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAssistantRuntimeReceipt).toHaveBeenCalledWith(
      "ws-1",
      "shared:session-1",
      expect.objectContaining({
        model: "gpt-5-codex",
        modelSource: "turn.completed",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("ignores unrelated Shared raw payloads that happen to contain a model field", async () => {
    const handlers: Handlers = {
      onAssistantRuntimeReceipt: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "codex/raw",
          params: {
            threadId: "shared:session-1",
            type: "event",
            model: "gpt-5-codex",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAssistantRuntimeReceipt).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("captures native Claude runtime model sidecar as an assistant receipt", async () => {
    const handlers: Handlers = {
      onAssistantRuntimeReceipt: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "claude/raw",
          params: {
            threadId: "claude:session-1",
            type: "runtime_model",
            subtype: "assistant.message.model",
            model: "deepseek-v4-pro-0813[1m]",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAssistantRuntimeReceipt).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      expect.objectContaining({
        model: "deepseek-v4-pro-0813[1m]",
        modelSource: "assistant.message.model",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("captures Shared Claude runtime model sidecar as an assistant receipt", async () => {
    const handlers: Handlers = {
      onAssistantRuntimeReceipt: vi.fn(),
    };
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "claude/raw",
          params: {
            threadId: "shared:session-1",
            type: "runtime_model",
            subtype: "assistant.message.model",
            model: "deepseek-v4-pro-0813[1m]",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAssistantRuntimeReceipt).toHaveBeenCalledWith(
      "ws-1",
      "shared:session-1",
      expect.objectContaining({
        model: "deepseek-v4-pro-0813[1m]",
        modelSource: "assistant.message.model",
      }),
    );

    await act(async () => {
      root.unmount();
    });
  });

  it("does not write Multi-Agent worker runtime models onto the Shared owner thread", async () => {
    const handlers: Handlers = {
      onAssistantRuntimeReceipt: vi.fn(),
    };
    registerAgentAttempt("attempt-worker-1", {
      workspaceId: "ws-1",
      threadId: "shared:session-owner",
      phase: "running",
      bindingKey: "squad:run-1:worker-1",
    });
    registerSharedSessionNativeBinding({
      workspaceId: "ws-1",
      sharedThreadId: "shared:session-owner",
      nativeThreadId: "claude:worker-1",
      engine: "claude",
      attemptId: "attempt-worker-1",
      bindingKey: "squad:run-1:worker-1",
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-1",
        message: {
          method: "claude/raw",
          params: {
            threadId: "claude:worker-1",
            type: "runtime_model",
            subtype: "assistant.message.model",
            model: "worker-model",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onAssistantRuntimeReceipt).not.toHaveBeenCalled();
    clearSharedSessionBindingsForSharedThread("ws-1", "shared:session-owner");

    await act(async () => {
      root.unmount();
    });
  });
});
