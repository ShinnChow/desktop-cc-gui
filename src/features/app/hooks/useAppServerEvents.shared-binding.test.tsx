// @vitest-environment jsdom
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { listener, mount, type Handlers } from "./useAppServerEventsTestSetup";
import {
  clearSharedSessionBindingsForSharedThread,
  registerSharedSessionNativeBinding,
  resolveSharedSessionBindingByNativeThread,
} from "../../shared-session/runtime/sharedSessionBridge";
import {
  QODER_CN_PROVIDER_PROFILE_ID,
  QODER_GLOBAL_PROVIDER_PROFILE_ID,
} from "../../threads/constants/codexProviderProfiles";
import { setSharedV2SendOverride } from "../../shared-session/runtime/sharedV2SendFlag";
import { updateSharedSessionNativeBinding as updateSharedSessionNativeBindingService } from "../../shared-session/services/sharedSessions";

describe("useAppServerEvents", () => {
  it("keeps codex shared-session native binding unchanged on thread/started", async () => {
    const handlers: Handlers = {
      onTurnCompleted: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-codex",
      sharedThreadId: "shared:thread-codex",
      nativeThreadId: "codex-native-thread-1",
      engine: "codex",
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-codex",
        message: {
          method: "thread/started",
          params: {
            threadId: "codex-native-thread-1",
            sessionId: "codex-native-thread-1",
            engine: "codex",
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-codex",
        message: {
          method: "turn/completed",
          params: {
            threadId: "codex-native-thread-1",
            turnId: "turn-codex-1",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(updateSharedSessionNativeBindingService).not.toHaveBeenCalled();
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-codex",
      "shared:thread-codex",
      "turn-codex-1",
    );

    clearSharedSessionBindingsForSharedThread("ws-shared-codex", "shared:thread-codex");
    await act(async () => {
      root.unmount();
    });
  });

  it("passes shared-session engine hint on stalled turns", async () => {
    const handlers: Handlers = {
      onTurnStalled: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-claude-stalled",
      sharedThreadId: "shared:thread-claude-stalled",
      nativeThreadId: "claude:stalled-native-1",
      engine: "claude",
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-claude-stalled",
        message: {
          method: "turn/stalled",
          params: {
            threadId: "claude:stalled-native-1",
            turnId: "turn-shared-claude-stalled",
            message: "resume stalled",
            reasonCode: "resume_pending_timeout",
            stage: "stalled",
            source: "turn/stalled",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onTurnStalled).toHaveBeenCalledWith(
      "ws-shared-claude-stalled",
      "shared:thread-claude-stalled",
      "turn-shared-claude-stalled",
      expect.objectContaining({
        message: "resume stalled",
        reasonCode: "resume_pending_timeout",
        engine: "claude",
      }),
    );

    clearSharedSessionBindingsForSharedThread(
      "ws-shared-claude-stalled",
      "shared:thread-claude-stalled",
    );
    await act(async () => {
      root.unmount();
    });
  });

  it("rebinds the V2 frontend bridge without writing legacy binding meta", async () => {
    const handlers: Handlers = {
      onThreadStarted: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-codex-pending",
      sharedThreadId: "shared:thread-codex-pending",
      nativeThreadId: "codex-pending-shared-1",
      engine: "codex",
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-codex-pending",
        message: {
          method: "thread/started",
          params: {
            threadId: "550e8400-e29b-41d4-a716-446655440000",
            sessionId: "550e8400-e29b-41d4-a716-446655440000",
            engine: "codex",
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-codex-pending",
        message: {
          method: "turn/completed",
          params: {
            threadId: "550e8400-e29b-41d4-a716-446655440000",
            turnId: "turn-codex-pending-1",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadStarted).not.toHaveBeenCalled();
    expect(updateSharedSessionNativeBindingService).not.toHaveBeenCalled();
    expect(
      resolveSharedSessionBindingByNativeThread(
        "ws-shared-codex-pending",
        "550e8400-e29b-41d4-a716-446655440000",
      ),
    ).toMatchObject({
      sharedThreadId: "shared:thread-codex-pending",
      engine: "codex",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-codex-pending",
      "shared:thread-codex-pending",
      "turn-codex-pending-1",
    );

    clearSharedSessionBindingsForSharedThread(
      "ws-shared-codex-pending",
      "shared:thread-codex-pending",
    );
    await act(async () => {
      root.unmount();
    });
  });

  it("keeps V0 legacy binding persistence behind the explicit rollback flag", async () => {
    setSharedV2SendOverride(false);
    const handlers: Handlers = {
      onTurnCompleted: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-shared-claude",
      sharedThreadId: "shared:thread-claude",
      nativeThreadId: "claude-pending-shared-1",
      engine: "claude",
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-shared-claude",
        message: {
          method: "thread/started",
          params: {
            threadId: "claude-pending-shared-1",
            sessionId: "ses_123",
            engine: "claude",
          },
        },
      });
      listener?.({
        workspace_id: "ws-shared-claude",
        message: {
          method: "turn/completed",
          params: {
            threadId: "claude:ses_123",
            turnId: "turn-claude-1",
          },
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(updateSharedSessionNativeBindingService).toHaveBeenCalledWith(
      "ws-shared-claude",
      "shared:thread-claude",
      "claude",
      "claude-pending-shared-1",
      "claude:ses_123",
      null,
    );
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith(
      "ws-shared-claude",
      "shared:thread-claude",
      "turn-claude-1",
    );

    clearSharedSessionBindingsForSharedThread("ws-shared-claude", "shared:thread-claude");
    await act(async () => {
      root.unmount();
    });
  });

  it("does not open a native Grok row when two Shared Grok bindings are pending", async () => {
    const handlers: Handlers = {
      onThreadStarted: vi.fn(),
      onThreadSessionIdUpdated: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-dual-grok",
      sharedThreadId: "shared:thread-grok-a",
      nativeThreadId: "grok-pending-shared-a",
      engine: "grok",
    });
    registerSharedSessionNativeBinding({
      workspaceId: "ws-dual-grok",
      sharedThreadId: "shared:thread-grok-b",
      nativeThreadId: "grok-pending-shared-b",
      engine: "grok",
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-dual-grok",
        message: {
          method: "thread/started",
          params: {
            threadId: "grok:live-raw",
            sessionId: "live-raw",
            engine: "grok",
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadStarted).not.toHaveBeenCalled();
    expect(handlers.onThreadSessionIdUpdated).not.toHaveBeenCalled();

    clearSharedSessionBindingsForSharedThread("ws-dual-grok", "shared:thread-grok-a");
    clearSharedSessionBindingsForSharedThread("ws-dual-grok", "shared:thread-grok-b");
    await act(async () => {
      root.unmount();
    });
  });

  it("finalizes Qoder Global and CN pending bindings without native sidebar rows", async () => {
    const handlers: Handlers = {
      onThreadStarted: vi.fn(),
      onThreadSessionIdUpdated: vi.fn(),
    };
    registerSharedSessionNativeBinding({
      workspaceId: "ws-dual-qoder",
      sharedThreadId: "shared:thread-qoder-global",
      nativeThreadId: "qoder-pending-shared-global",
      engine: "qoder",
      providerProfileId: QODER_GLOBAL_PROVIDER_PROFILE_ID,
    });
    registerSharedSessionNativeBinding({
      workspaceId: "ws-dual-qoder",
      sharedThreadId: "shared:thread-qoder-cn",
      nativeThreadId: "qoder-pending-shared-cn",
      engine: "qoder",
      providerProfileId: QODER_CN_PROVIDER_PROFILE_ID,
    });
    const { root } = await mount(handlers);

    await act(async () => {
      listener?.({
        workspace_id: "ws-dual-qoder",
        message: {
          method: "thread/started",
          params: {
            threadId: "qoder-pending-shared-global",
            sessionId: "same-raw",
            engine: "qoder",
            providerProfileId: QODER_GLOBAL_PROVIDER_PROFILE_ID,
          },
        },
      });
      listener?.({
        workspace_id: "ws-dual-qoder",
        message: {
          method: "thread/started",
          params: {
            threadId: "qoder-pending-shared-cn",
            sessionId: "same-raw",
            engine: "qoder",
            providerProfileId: QODER_CN_PROVIDER_PROFILE_ID,
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(handlers.onThreadStarted).not.toHaveBeenCalled();
    expect(
      resolveSharedSessionBindingByNativeThread(
        "ws-dual-qoder",
        `qoder:${QODER_GLOBAL_PROVIDER_PROFILE_ID}:same-raw`,
      ),
    ).toMatchObject({
      sharedThreadId: "shared:thread-qoder-global",
      providerProfileId: QODER_GLOBAL_PROVIDER_PROFILE_ID,
    });
    expect(
      resolveSharedSessionBindingByNativeThread(
        "ws-dual-qoder",
        `qoder:${QODER_CN_PROVIDER_PROFILE_ID}:same-raw`,
      ),
    ).toMatchObject({
      sharedThreadId: "shared:thread-qoder-cn",
      providerProfileId: QODER_CN_PROVIDER_PROFILE_ID,
    });

    clearSharedSessionBindingsForSharedThread(
      "ws-dual-qoder",
      "shared:thread-qoder-global",
    );
    clearSharedSessionBindingsForSharedThread(
      "ws-dual-qoder",
      "shared:thread-qoder-cn",
    );
    await act(async () => {
      root.unmount();
    });
  });

  it("emits fallback assistant completion from turn/completed result text when no delta arrived", async () => {
    const handlers: Handlers = {
      onAgentMessageCompleted: vi.fn(),
      onTurnCompleted: vi.fn(),
    };
    const { root } = await mount(handlers);

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

    expect(handlers.onAgentMessageCompleted).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      threadId: "thread-1",
      itemId: "turn-1",
      text: "final response from result",
      turnId: "turn-1",
    });
    expect(handlers.onTurnCompleted).toHaveBeenCalledWith("ws-1", "thread-1", "turn-1");

    await act(async () => {
      root.unmount();
    });
  });

});
