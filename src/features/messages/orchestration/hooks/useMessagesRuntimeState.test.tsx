// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../../types";
import { useMessagesRuntimeState } from "./useMessagesRuntimeState";

const assistantItem: ConversationItem = {
  id: "shared-assistant",
  kind: "message",
  role: "assistant",
  text: "shared assistant text",
};

const userItem: ConversationItem = {
  id: "shared-user",
  kind: "message",
  role: "user",
  text: "hi",
};

function buildRuntimeInput(
  overrides: Partial<Parameters<typeof useMessagesRuntimeState>[0]> = {},
): Parameters<typeof useMessagesRuntimeState>[0] {
  return {
    activeEngine: "codex",
    activeTurnId: "turn-1",
    codexSilentSuspectedAt: null,
    deferredRenderSourceItems: [assistantItem],
    isContextCompacting: false,
    isMacDesktop: false,
    isAgentTaskNotificationText: () => false,
    isThinking: true,
    isWindowsDesktop: false,
    items: [assistantItem],
    labels: {
      approvalResumingAfterApproval: "resuming",
      codexSilentSuspected: "silent",
      waitingForFirstText: "waiting",
      contextCompacting: "compacting",
    },
    nativeRuntimeRecoveryEnabled: true,
    renderScopeKey: "workspace-a\u0000shared-thread",
    reportVisibleTextRendered: vi.fn(),
    renderSourceItems: [assistantItem],
    streamActivityPhase: "ingress",
    threadId: "shared-thread",
    threadStreamLatencyCategory: null,
    ...overrides,
  };
}

describe("useMessagesRuntimeState", () => {
  it("selects waiting-for-first-text label for pi while the first chunk is pending", () => {
    const { result } = renderHook(() =>
      useMessagesRuntimeState(
        buildRuntimeInput({
          activeEngine: "pi",
          deferredRenderSourceItems: [userItem],
          renderSourceItems: [userItem],
          items: [userItem],
        }),
      ),
    );

    expect(result.current.waitingForFirstChunk).toBe(true);
    expect(result.current.primaryWorkingLabel).toBe("waiting");
  });

  it("falls back to the default working label for pi once the first chunk lands", () => {
    const { result } = renderHook(() =>
      useMessagesRuntimeState(
        buildRuntimeInput({
          activeEngine: "pi",
          deferredRenderSourceItems: [userItem, assistantItem],
          renderSourceItems: [userItem, assistantItem],
          items: [userItem, assistantItem],
        }),
      ),
    );

    expect(result.current.waitingForFirstChunk).toBe(false);
    expect(result.current.primaryWorkingLabel).toBe(null);
  });

  it("stops showing the waiting label for pi as soon as reasoning streams", () => {
    const reasoningItem: ConversationItem = {
      id: "pi-reasoning-1",
      kind: "reasoning",
      summary: "thinking",
      content: "thinking out loud",
    };
    const { result } = renderHook(() =>
      useMessagesRuntimeState(
        buildRuntimeInput({
          activeEngine: "pi",
          deferredRenderSourceItems: [userItem, reasoningItem],
          renderSourceItems: [userItem, reasoningItem],
          items: [userItem, reasoningItem],
        }),
      ),
    );

    expect(result.current.waitingForFirstChunk).toBe(false);
    expect(result.current.primaryWorkingLabel).toBe(null);
  });

  it("stops showing the waiting label for pi once a tool row renders", () => {
    const toolItem: ConversationItem = {
      id: "pi-tool-1",
      kind: "tool",
      toolType: "ctxTree",
      title: "Ctx Tree",
      detail: ".",
      status: "running",
    };
    const { result } = renderHook(() =>
      useMessagesRuntimeState(
        buildRuntimeInput({
          activeEngine: "pi",
          deferredRenderSourceItems: [userItem, toolItem],
          renderSourceItems: [userItem, toolItem],
          items: [userItem, toolItem],
        }),
      ),
    );

    expect(result.current.waitingForFirstChunk).toBe(false);
    expect(result.current.primaryWorkingLabel).toBe(null);
  });

  it("keeps the assistant-message-only chunk semantics for codex reasoning", () => {
    const reasoningItem: ConversationItem = {
      id: "codex-reasoning-1",
      kind: "reasoning",
      summary: "thinking",
      content: "codex thinking",
    };
    const { result } = renderHook(() =>
      useMessagesRuntimeState(
        buildRuntimeInput({
          activeEngine: "codex",
          deferredRenderSourceItems: [userItem, reasoningItem],
          renderSourceItems: [userItem, reasoningItem],
          items: [userItem, reasoningItem],
        }),
      ),
    );

    expect(result.current.waitingForFirstChunk).toBe(true);
    expect(result.current.primaryWorkingLabel).toBe("waiting");
  });

  it("keeps the non-pi default working label for claude silence", () => {
    const { result } = renderHook(() =>
      useMessagesRuntimeState(
        buildRuntimeInput({
          activeEngine: "claude",
          deferredRenderSourceItems: [userItem],
          renderSourceItems: [userItem],
          items: [userItem],
        }),
      ),
    );

    expect(result.current.waitingForFirstChunk).toBe(true);
    expect(result.current.primaryWorkingLabel).toBe(null);
  });

  it("does not re-enter finalizing state when isThinking stays true under thrash", () => {
    let renderCount = 0;
    const { result, rerender } = renderHook(
      (props: { isThinking: boolean; candidateSeed: number }) => {
        renderCount += 1;
        return useMessagesRuntimeState(
          buildRuntimeInput({
            isThinking: props.isThinking,
            // deferred/render source 引用抖动不得叠 finalizing setState 环
            deferredRenderSourceItems: [assistantItem],
            renderSourceItems: [assistantItem],
            items: [assistantItem],
          }),
        );
      },
      {
        initialProps: { isThinking: true, candidateSeed: 0 },
      },
    );

    const baseline = renderCount;
    for (let i = 0; i < 30; i += 1) {
      rerender({ isThinking: true, candidateSeed: i });
    }

    expect(result.current.isAssistantFinalizing).toBe(false);
    // StrictMode 可能双渲染，但 30 次 thrash 不得爆炸成 update-depth
    expect(renderCount).toBeLessThan(baseline + 80);
  });

  it("does not select a Native recovery diagnostic when the thread disables that capability", () => {
    const reconnectDiagnostic: ConversationItem = {
      id: "shared-runtime-diagnostic",
      kind: "message",
      role: "assistant",
      text: "Broken pipe (os error 32)",
    };
    const { result } = renderHook(() =>
      useMessagesRuntimeState(
        buildRuntimeInput({
          items: [reconnectDiagnostic],
          nativeRuntimeRecoveryEnabled: false,
        }),
      ),
    );

    expect(result.current.latestRuntimeReconnectItemId).toBeNull();
  });

  it("does not carry assistant completion state across workspaces with matching thread ids", () => {
    const { result, rerender } = renderHook(
      (props: { renderScopeKey: string; isThinking: boolean }) =>
        useMessagesRuntimeState(
          buildRuntimeInput({
            renderScopeKey: props.renderScopeKey,
            isThinking: props.isThinking,
          }),
        ),
      {
        initialProps: {
          renderScopeKey: "workspace-a\u0000shared-thread",
          isThinking: true,
        },
      },
    );

    expect(result.current.liveAssistantMessageId).toBe(assistantItem.id);

    rerender({
      renderScopeKey: "workspace-b\u0000shared-thread",
      isThinking: false,
    });

    expect(result.current.isAssistantFinalizing).toBe(false);
    expect(result.current.liveAssistantMessageId).toBeNull();
  });

  it("keeps a finalizing live window for Grok after thinking ends", () => {
    // 回归：Grok 无 finalizing 时 isStreaming 瞬间关掉，MessageRow 只读建壳首字。
    const { result, rerender } = renderHook(
      (props: { isThinking: boolean }) =>
        useMessagesRuntimeState(
          buildRuntimeInput({
            activeEngine: "grok",
            isThinking: props.isThinking,
          }),
        ),
      {
        initialProps: { isThinking: true },
      },
    );

    expect(result.current.liveAssistantMessageId).toBe(assistantItem.id);

    act(() => {
      rerender({ isThinking: false });
    });

    expect(result.current.isAssistantFinalizing).toBe(true);
    expect(result.current.liveAssistantMessageId).toBe(assistantItem.id);
  });

  it("reports matching assistant ids again after the workspace scope changes", () => {
    const reportVisibleTextRendered = vi.fn();
    const { result, rerender } = renderHook(
      (props: { renderScopeKey: string }) =>
        useMessagesRuntimeState(
          buildRuntimeInput({
            renderScopeKey: props.renderScopeKey,
            reportVisibleTextRendered,
          }),
        ),
      {
        initialProps: {
          renderScopeKey: "workspace-a\u0000shared-thread",
        },
      },
    );

    act(() => {
      result.current.handleAssistantVisibleTextRender({
        itemId: assistantItem.id,
        visibleText: assistantItem.text,
      });
    });
    expect(reportVisibleTextRendered).toHaveBeenCalledTimes(1);

    rerender({ renderScopeKey: "workspace-b\u0000shared-thread" });
    act(() => {
      result.current.handleAssistantVisibleTextRender({
        itemId: assistantItem.id,
        visibleText: assistantItem.text,
      });
    });

    expect(reportVisibleTextRendered).toHaveBeenCalledTimes(2);
  });
});
