// @vitest-environment jsdom
import { registerThreadMessagingTestHooks } from "./useThreadMessagingTestSetup";
import { act } from "@testing-library/react";
import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  makeThreadMessagingHook,
  workspace,
} from "./useThreadMessaging.test-utils";
import {
  workspaceScopedHas,
  workspaceScopedSet,
} from "./workspaceScopedMap";
import {
  compactThreadContext,
  engineInterruptTurn,
  engineInterrupt,
  engineSendMessage,
  interruptTurn,
  sendUserMessage,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { sharedSessionV2InterruptTurn } from "../../shared-session/services/sharedSessions";
import {
  dispatchSharedSendEvent,
  getSharedSendActiveAttemptId,
  getSharedSendState,
  setSharedSendActiveAttempt,
} from "../../shared-session/runtime/sharedSendStateStore";

describe("useThreadMessaging", () => {
  registerThreadMessagingTestHooks();

  it("runs /compact in active claude thread via dedicated compact RPC", async () => {
    vi.mocked(compactThreadContext).mockResolvedValue({
      status: "completed",
      turnId: "compact-turn-1",
    });
    const { result, dispatch, recordThreadActivity, safeMessageActivity } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      threadEngineById: {
        "claude:session-1": "claude",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact now");
    });

    expect(compactThreadContext).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "claude:session-1",
      isCompacting: true,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "claude:session-1",
      isCompacting: false,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendContextCompacted",
      threadId: "claude:session-1",
      turnId: "compact-turn-1",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "claude:session-1",
      expect.any(Number),
    );
    expect(safeMessageActivity).toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
  it("runs manual Codex compaction via dedicated compact RPC and inserts the curtain message immediately", async () => {
    vi.mocked(compactThreadContext).mockResolvedValue({ status: "queued" });
    const {
      result,
      dispatch,
      recordThreadActivity,
      safeMessageActivity,
      codexCompactionInFlightByThreadRef,
    } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "codex",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).toHaveBeenCalledWith("ws-1", "thread-1");
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: true,
      timestamp: expect.any(Number),
      source: "manual",
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionStarted",
    });
    expect(recordThreadActivity).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      expect.any(Number),
    );
    expect(codexCompactionInFlightByThreadRef.current["thread-1"]).toBe(true);
    expect(safeMessageActivity).toHaveBeenCalled();
  });
  it("routes Shared Codex manual compaction through the logical Shared owner", async () => {
    vi.mocked(compactThreadContext).mockResolvedValue({ status: "queued" });
    const threadId = "shared:codex-session-1";
    const {
      result,
      dispatch,
      codexCompactionInFlightByThreadRef,
    } = makeThreadMessagingHook("codex", {
      activeThreadId: threadId,
      ensuredThreadId: threadId,
      threadEngineById: {
        [threadId]: "codex",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).toHaveBeenCalledWith("ws-1", threadId);
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId,
      isCompacting: true,
      timestamp: expect.any(Number),
      source: "manual",
    });
    expect(codexCompactionInFlightByThreadRef.current[threadId]).toBe(true);
  });
  it("routes Shared Claude manual compaction without requiring a claude-prefixed id", async () => {
    vi.mocked(compactThreadContext).mockResolvedValue({
      result: { turnId: "shared-compact-turn-1" },
    });
    const threadId = "shared:claude-session-1";
    const { result, dispatch } = makeThreadMessagingHook("claude", {
      activeThreadId: threadId,
      ensuredThreadId: threadId,
      threadEngineById: {
        [threadId]: "claude",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).toHaveBeenCalledWith("ws-1", threadId);
    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId,
      isCompacting: true,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "appendContextCompacted",
      threadId,
      turnId: "shared-compact-turn-1",
    });
  });
  it("does not send duplicate Codex compact RPCs while one is already in flight", async () => {
    const {
      result,
      dispatch,
      codexCompactionInFlightByThreadRef,
    } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "codex",
      },
    });
    codexCompactionInFlightByThreadRef.current["thread-1"] = true;

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "appendCodexCompactionMessage" }),
    );
  });
  it("rolls back the started Codex compaction curtain message when the compact RPC fails immediately", async () => {
    vi.mocked(compactThreadContext).mockRejectedValue(new Error("rpc failed"));
    const {
      result,
      dispatch,
      codexCompactionInFlightByThreadRef,
      pushThreadErrorMessage,
      safeMessageActivity,
    } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "codex",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "markContextCompacting",
      threadId: "thread-1",
      isCompacting: false,
      timestamp: expect.any(Number),
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: "discardLatestCodexCompactionMessage",
      threadId: "thread-1",
      text: "threads.codexCompactionStarted",
    });
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "thread-1",
      "threads.contextCompactionFailedWithMessage",
    );
    expect(codexCompactionInFlightByThreadRef.current["thread-1"]).toBeUndefined();
    expect(safeMessageActivity).toHaveBeenCalled();
  });
  it("does not create a new thread for /compact when no active claude thread exists", async () => {
    const startThreadForWorkspace = vi.fn(async () => "claude:session-new");
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: null,
      ensuredThreadId: null,
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.claudeManualCompactUnavailable",
      }),
    );
  });
  it("rejects /compact on unsupported active thread without rebinding", async () => {
    const startThreadForWorkspace = vi.fn(async () => "claude:session-new");
    const { result } = makeThreadMessagingHook("gemini", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      threadEngineById: {
        "thread-1": "gemini",
      },
      startThreadForWorkspace,
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.claudeManualCompactUnavailable",
      }),
    );
  });
  it("rejects /compact on pending claude thread to avoid creating a session just for compaction", async () => {
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-123",
      ensuredThreadId: "claude-pending-123",
      threadEngineById: {
        "claude-pending-123": "claude",
      },
    });

    await act(async () => {
      await result.current.startCompact("/compact");
    });

    expect(compactThreadContext).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(pushErrorToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "common.warning",
        message: "threads.claudeManualCompactUnavailable",
      }),
    );
  });
  it("interrupt routes codex thread through daemon rpc even when active engine is opencode", async () => {
    const { result } = makeThreadMessagingHook("opencode", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      activeTurnIdByThread: { "thread-1": "turn-1" },
      threadEngineById: { "thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(interruptTurn).toHaveBeenCalledWith("ws-1", "thread-1", "turn-1", null);
    expect(engineInterrupt).toHaveBeenCalledWith("ws-1");
  });
  it("shows fusion-specific stop copy without blocking same-thread realtime continuation", async () => {
    const { result, dispatch, interruptedThreadsRef, pendingInterruptsRef } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      activeTurnIdByThread: { "thread-1": "turn-1" },
      threadEngineById: { "thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn({ reason: "queue-fusion" });
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "addAssistantMessage",
      threadId: "thread-1",
      text: "正在切换到融合回复，等待新的接续事件…",
    });
    expect(workspaceScopedHas(interruptedThreadsRef.current, workspace.id, "thread-1")).toBe(false);
    expect(workspaceScopedHas(pendingInterruptsRef.current, workspace.id, "thread-1")).toBe(false);
  });
  it("keeps the default stop copy for a normal manual interrupt", async () => {
    const { result, dispatch, interruptedThreadsRef } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-1",
      ensuredThreadId: "thread-1",
      activeTurnIdByThread: { "thread-1": "turn-1" },
      threadEngineById: { "thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(dispatch).toHaveBeenCalledWith({
      type: "addAssistantMessage",
      threadId: "thread-1",
      text: "会话已停止。",
    });
    expect(workspaceScopedHas(interruptedThreadsRef.current, workspace.id, "thread-1")).toBe(true);
  });
  it("keeps plan handoff interrupts silent while still stopping the active turn", async () => {
    const { result, dispatch, markProcessing, setActiveTurnId } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      activeTurnIdByThread: { "claude:session-1": "turn-1" },
      threadEngineById: { "claude:session-1": "claude" },
    });

    await act(async () => {
      await result.current.interruptTurn({ reason: "plan-handoff" });
    });

    expect(markProcessing).toHaveBeenCalledWith("claude:session-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("claude:session-1", null);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "claude:session-1",
      }),
    );
    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-1", "claude");
  });
  it("routes a shared Claude interrupt to the active provider binding", async () => {
    setSharedSendActiveAttempt("ws-1", "shared:thread-1", "attempt-claude");
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-1",
      ensuredThreadId: "shared:thread-1",
      activeTurnIdByThread: { "shared:thread-1": "turn-1" },
      threadEngineById: { "shared:thread-1": "claude" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(sharedSessionV2InterruptTurn).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-1",
      "attempt-claude",
    );
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });
  it("routes a shared Codex interrupt only through its durable attempt owner", async () => {
    setSharedSendActiveAttempt("ws-1", "shared:thread-1", "attempt-codex");
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "shared:thread-1",
      ensuredThreadId: "shared:thread-1",
      activeTurnIdByThread: { "shared:thread-1": "ui-turn-stale" },
      threadEngineById: { "shared:thread-1": "codex" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(sharedSessionV2InterruptTurn).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-1",
      "attempt-codex",
    );
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(engineInterruptTurn).not.toHaveBeenCalled();
  });
  it("interrupts a durable Shared attempt even when the native reducer has no active turn", async () => {
    setSharedSendActiveAttempt("ws-1", "shared:thread-1", "attempt-durable");
    const { result, markProcessing, setActiveTurnId } =
      makeThreadMessagingHook("claude", {
        activeThreadId: "shared:thread-1",
        ensuredThreadId: "shared:thread-1",
        activeTurnIdByThread: {},
        threadStatusById: {},
        threadEngineById: { "shared:thread-1": "claude" },
      });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(sharedSessionV2InterruptTurn).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-1",
      "attempt-durable",
    );
    expect(markProcessing).toHaveBeenCalledWith("shared:thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("shared:thread-1", null);
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });
  it("converges a canonically committed Shared attempt without adding a stop notice", async () => {
    setSharedSendActiveAttempt("ws-1", "shared:thread-1", "attempt-committed");
    vi.mocked(sharedSessionV2InterruptTurn).mockResolvedValueOnce({
      status: "terminal-committed",
      attemptId: "attempt-committed",
      sequence: 12,
    });
    const { result, dispatch, markProcessing, setActiveTurnId } =
      makeThreadMessagingHook("claude", {
        activeThreadId: "shared:thread-1",
        ensuredThreadId: "shared:thread-1",
        activeTurnIdByThread: { "shared:thread-1": "stale-ui-turn" },
        threadEngineById: { "shared:thread-1": "claude" },
      });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(getSharedSendActiveAttemptId("ws-1", "shared:thread-1")).toBeNull();
    expect(getSharedSendState("ws-1", "shared:thread-1").state).toBe("idle");
    expect(markProcessing).toHaveBeenCalledWith("shared:thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("shared:thread-1", null);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "shared:thread-1",
      }),
    );
  });
  it("clears an idle Shared V2 UI residue when the attempt owner is already released", async () => {
    const { result, markProcessing, setActiveTurnId } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-1",
      ensuredThreadId: "shared:thread-1",
      activeTurnIdByThread: { "shared:thread-1": "ui-turn-1" },
      threadStatusById: {
        "shared:thread-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 1,
          lastDurationMs: null,
        },
      },
      threadEngineById: { "shared:thread-1": "claude" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(sharedSessionV2InterruptTurn).not.toHaveBeenCalled();
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(markProcessing).toHaveBeenCalledWith("shared:thread-1", false);
    expect(setActiveTurnId).toHaveBeenCalledWith("shared:thread-1", null);
  });
  it("fails closed when a non-idle Shared V2 interrupt has no attempt owner", async () => {
    dispatchSharedSendEvent("ws-1", "shared:thread-1", { type: "send" });
    dispatchSharedSendEvent("ws-1", "shared:thread-1", {
      type: "packagePrepared",
    });
    dispatchSharedSendEvent("ws-1", "shared:thread-1", {
      type: "runtimeAck",
    });
    const { result, markProcessing, setActiveTurnId } =
      makeThreadMessagingHook("claude", {
        activeThreadId: "shared:thread-1",
        ensuredThreadId: "shared:thread-1",
        activeTurnIdByThread: { "shared:thread-1": "ui-turn-1" },
        threadEngineById: { "shared:thread-1": "claude" },
      });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(getSharedSendState("ws-1", "shared:thread-1").state).toBe("running");
    expect(sharedSessionV2InterruptTurn).not.toHaveBeenCalled();
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(setActiveTurnId).not.toHaveBeenCalled();
  });
  it("interrupt routes opencode thread through engine interrupt only", async () => {
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "opencode:session-1",
      ensuredThreadId: "opencode:session-1",
      activeTurnIdByThread: { "opencode:session-1": "turn-9" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-9", "opencode");
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });
  it("routes a native Qoder CN interrupt to its persisted distribution binding", async () => {
    const { result } = makeThreadMessagingHook("qoder", {
      activeThreadId: "qoder:session-cn",
      ensuredThreadId: "qoder:session-cn",
      activeTurnIdByThread: { "qoder:session-cn": "turn-cn" },
      threadEngineById: { "qoder:session-cn": "qoder" },
      providerProfileByThread: { "qoder:session-cn": "__qoder_cn__" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(engineInterruptTurn).toHaveBeenCalledWith(
      "ws-1",
      "turn-cn",
      "qoder",
      "__qoder_cn__",
    );
    expect(engineInterrupt).not.toHaveBeenCalled();
  });
  it("falls back to workspace interrupt when turn-scoped interrupt rpc is unavailable", async () => {
    vi.mocked(engineInterruptTurn).mockRejectedValue(
      new Error("unknown method: engine_interrupt_turn"),
    );
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "opencode:session-1",
      ensuredThreadId: "opencode:session-1",
      activeTurnIdByThread: { "opencode:session-1": "turn-9" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(engineInterruptTurn).toHaveBeenCalledWith("ws-1", "turn-9", "opencode");
    expect(engineInterrupt).toHaveBeenCalledWith("ws-1");
    expect(interruptTurn).not.toHaveBeenCalled();
  });
  it("does not broaden a Qoder CN interrupt when turn-scoped rpc is unavailable", async () => {
    vi.mocked(engineInterruptTurn).mockRejectedValue(
      new Error("unknown method: engine_interrupt_turn"),
    );
    const threadId = "qoder:__qoder_cn__:session-cn";
    const { result } = makeThreadMessagingHook("qoder", {
      activeThreadId: threadId,
      ensuredThreadId: threadId,
      activeTurnIdByThread: { [threadId]: "turn-cn" },
      threadEngineById: { [threadId]: "qoder" },
      providerProfileByThread: { [threadId]: "__qoder_cn__" },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(engineInterruptTurn).toHaveBeenCalledWith(
      "ws-1",
      "turn-cn",
      "qoder",
      "__qoder_cn__",
    );
    expect(engineInterrupt).not.toHaveBeenCalled();
  });
  it("interrupt on cli-managed engine queues pending interrupt when turn id is not ready", async () => {
    const { result, pendingInterruptsRef } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      activeTurnIdByThread: {},
      threadStatusById: {
        "claude:session-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 1,
          lastDurationMs: null,
        },
      },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, workspace.id, "claude:session-1")).toBe(true);
    expect(engineInterruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
    expect(interruptTurn).not.toHaveBeenCalled();
  });
  it("does not queue a pending interrupt after a stalled codex turn already settled", async () => {
    const { result, pendingInterruptsRef, dispatch } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-stalled",
      ensuredThreadId: "thread-stalled",
      activeTurnIdByThread: { "thread-stalled": null },
      threadEngineById: { "thread-stalled": "codex" },
      threadStatusById: {
        "thread-stalled": {
          isProcessing: false,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: null,
          lastDurationMs: 120_000,
        },
      },
    });

    await act(async () => {
      await result.current.interruptTurn();
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, workspace.id, "thread-stalled")).toBe(false);
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "addAssistantMessage",
        threadId: "thread-stalled",
      }),
    );
    expect(interruptTurn).not.toHaveBeenCalled();
    expect(engineInterrupt).not.toHaveBeenCalled();
  });
  it("clears queued pending interrupt before starting a new claude send", async () => {
    const { result, pendingInterruptsRef } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
      activeTurnIdByThread: {},
    });
    workspaceScopedSet(pendingInterruptsRef.current, workspace.id, "claude:session-1", true);

    await act(async () => {
      await result.current.sendUserMessage("resume execution", [], {
        accessMode: "default",
        collaborationMode: { mode: "code", settings: {} },
        suppressUserMessageRender: true,
      });
    });

    expect(workspaceScopedHas(pendingInterruptsRef.current, workspace.id, "claude:session-1")).toBe(false);
    expect(engineSendMessage).toHaveBeenCalled();
  });
});
