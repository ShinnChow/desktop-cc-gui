// @vitest-environment jsdom
import { registerThreadMessagingTestHooks } from "./useThreadMessagingTestSetup";
import {
  act,
  waitFor,
} from "@testing-library/react";
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
  engineSendMessage,
  projectMemoryCaptureTurnInput,
  sendUserMessage,
} from "../../../services/tauri";
import { sendSharedSessionTurnRouted } from "../../shared-session/runtime/sendSharedSessionTurn";
import { SharedActiveAttemptObserverError } from "../../shared-session/runtime/sendSharedSessionTurnV2";
import { sharedSessionV2AwaitTurnTerminal } from "../../shared-session/services/sharedSessions";
import { reattachSharedSessionAttempt } from "../../shared-session/runtime/reattachSharedSessionAttempt";
import {
  consumeSharedSendAdmission,
  dispatchSharedSendEvent,
  getSharedSendActiveAttemptId,
  getSharedSendState,
  setSharedSendActiveAttempt,
} from "../../shared-session/runtime/sharedSendStateStore";
import { selectNextTarget } from "../../shared-session/target/targetStore";

describe("useThreadMessaging", () => {
  registerThreadMessagingTestHooks();

  it("hides shared native thread id returned from shared send response", async () => {
    const dispatch = vi.fn();
    selectNextTarget("ws-1", "shared:thread-2", {
      engine: "codex",
      providerProfileId: null,
      modelCatalogEntryId: "codex-local:gpt-5.3-codex",
      providerProfileNameSnapshot: "本机配置",
      providerProfileSource: "disk",
      model: "gpt-5.3-codex",
      reasoning: null,
    });
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValue({
      result: { turn: { id: "shared-turn-2" } },
      nativeThreadId: "550e8400-e29b-41d4-a716-446655440000",
    });
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: "shared:thread-2",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-2",
        "hello shared hide native",
      );
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "hideThread",
        workspaceId: "ws-1",
        threadId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    );
  });
  it("captures project-memory input on Shared V2 committed path with runtimeTurnId", async () => {
    const sharedThreadId = "shared:thread-memory-capture";
    const onInputMemoryCaptured = vi.fn();
    selectNextTarget("ws-1", sharedThreadId, {
      engine: "claude",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "settings-main",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
      model: "claude-provider-model",
      reasoning: { effort: "high" },
    });
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce({
      result: { turn: { id: "runtime-turn-memory" } },
      nativeThreadId: "claude:native-session-memory",
      runtimeTurnId: "runtime-turn-memory",
      v2: {
        attemptId: "attempt-memory",
        logicalTurnId: "logical-turn-memory",
        committed: true,
        duplicate: false,
      },
    });
    vi.mocked(projectMemoryCaptureTurnInput).mockResolvedValueOnce({
      id: "memory-shared-1",
    } as never);
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: sharedThreadId,
      threadEngineById: { [sharedThreadId]: "claude" },
      onInputMemoryCaptured,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        sharedThreadId,
        "shared memory input capture",
      );
    });

    await waitFor(() => {
      expect(projectMemoryCaptureTurnInput).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          userInput: "shared memory input capture",
          threadId: sharedThreadId,
          turnId: "runtime-turn-memory",
          engine: "claude",
        }),
      );
    });
    await waitFor(() => {
      expect(onInputMemoryCaptured).toHaveBeenCalledWith(
        expect.objectContaining({
          workspaceId: "ws-1",
          threadId: sharedThreadId,
          turnId: "runtime-turn-memory",
          inputText: "shared memory input capture",
          memoryId: "memory-shared-1",
          engine: "claude",
        }),
      );
    });
  });
  it("does not revive a canonically committed Shared V2 turn from its response", async () => {
    const sharedThreadId = "shared:thread-committed-response";
    const onSharedDurableTurnCommitted = vi.fn();
    selectNextTarget("ws-1", sharedThreadId, {
      engine: "claude",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "settings-main",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
      model: "claude-provider-model",
      reasoning: { effort: "high" },
    });
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce({
      result: { turn: { id: "runtime-turn-already-completed" } },
      nativeThreadId: "claude:native-session-1",
      runtimeTurnId: "runtime-turn-already-completed",
      v2: {
        attemptId: "attempt-committed",
        logicalTurnId: "logical-turn-committed",
        committed: true,
        duplicate: false,
      },
    });
    const { result, markProcessing, setActiveTurnId } =
      makeThreadMessagingHook("claude", {
        activeThreadId: sharedThreadId,
        threadEngineById: { [sharedThreadId]: "claude" },
        onSharedDurableTurnCommitted,
      });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        sharedThreadId,
        "finish without revival",
      );
    });

    expect(onSharedDurableTurnCommitted).toHaveBeenCalledWith(
      sharedThreadId,
      "runtime-turn-already-completed",
    );
    expect(markProcessing).toHaveBeenCalledWith(sharedThreadId, false);
    expect(setActiveTurnId).toHaveBeenCalledWith(sharedThreadId, null);
    expect(
      onSharedDurableTurnCommitted.mock.invocationCallOrder[0],
    ).toBeLessThan(
      markProcessing.mock.invocationCallOrder.find(
        (_order, index) =>
          markProcessing.mock.calls[index]?.[0] === sharedThreadId &&
          markProcessing.mock.calls[index]?.[1] === false,
      ) ?? Number.POSITIVE_INFINITY,
    );
    expect(setActiveTurnId).not.toHaveBeenCalledWith(
      sharedThreadId,
      "runtime-turn-already-completed",
    );
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
  it("keeps Shared processing attached when only the terminal observer detached", async () => {
    const sharedThreadId = "shared:thread-observer-detached";
    const attemptId = "attempt-observer-detached";
    selectNextTarget("ws-1", sharedThreadId, {
      engine: "codex",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "settings-gpt-5",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
      model: "gpt-5",
      reasoning: { effort: "high" },
    });
    setSharedSendActiveAttempt("ws-1", sharedThreadId, attemptId);
    vi.mocked(sendSharedSessionTurnRouted).mockImplementationOnce((input) => {
      expect(
        consumeSharedSendAdmission(
          input.workspaceId,
          input.threadId,
          input.sharedSendAdmissionRevision ?? -1,
        ),
      ).toBe(true);
      return Promise.reject(
        new SharedActiveAttemptObserverError(
          attemptId,
          new Error("frontend observer detached"),
        ),
      );
    });
    const {
      result,
      markProcessing,
      setActiveTurnId,
      pushThreadErrorMessage,
      onDebug,
    } =
      makeThreadMessagingHook("codex", {
        activeThreadId: sharedThreadId,
        threadEngineById: { [sharedThreadId]: "codex" },
      });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        sharedThreadId,
        "keep running",
      );
    });

    expect(markProcessing).toHaveBeenCalledWith(sharedThreadId, true);
    expect(markProcessing).not.toHaveBeenCalledWith(sharedThreadId, false);
    expect(setActiveTurnId).not.toHaveBeenCalledWith(sharedThreadId, null);
    expect(getSharedSendActiveAttemptId("ws-1", sharedThreadId)).toBe(
      attemptId,
    );
    expect(pushThreadErrorMessage).not.toHaveBeenCalled();
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "shared terminal observer detached",
        payload: expect.objectContaining({ attemptId }),
      }),
    );
  });
  it("converges thread processing when a reattached Attempt reaches durable terminal", async () => {
    const sharedThreadId = "shared:thread-reattached-terminal";
    const onSharedDurableTurnCommitted = vi.fn();
    const { markProcessing, setActiveTurnId } = makeThreadMessagingHook(
      "codex",
      {
        activeThreadId: sharedThreadId,
        threadEngineById: { [sharedThreadId]: "codex" },
        onSharedDurableTurnCommitted,
      },
    );
    dispatchSharedSendEvent("ws-1", sharedThreadId, { type: "send" });
    dispatchSharedSendEvent("ws-1", sharedThreadId, {
      type: "packagePrepared",
    });
    dispatchSharedSendEvent("ws-1", sharedThreadId, {
      type: "ackAmbiguous",
    });
    vi.mocked(sharedSessionV2AwaitTurnTerminal).mockResolvedValueOnce({
      status: "committed",
      duplicate: false,
      sequence: 17,
      bindingKey: "codex:provider-a",
      terminal: {
        type: "run.settled",
        outcome: "completed",
        recoveryReason: null,
      },
    });

    await act(async () => {
      await reattachSharedSessionAttempt("ws-1", sharedThreadId, {
        status: "active",
        attemptId: "attempt-reattached-terminal",
        bindingKey: "codex:provider-a",
        nativeThreadId: "native-reattached-terminal",
        runtimeTurnId: "runtime-reattached-terminal",
        executionTargetSnapshot: {
          engine: "codex",
          providerProfileId: "provider-a",
          modelCatalogEntryId: "settings-gpt-5",
          model: "gpt-5",
          reasoning: { effort: "high" },
          providerProfileNameSnapshot: "Provider A",
          providerProfileSource: "managed",
          runtimeCapabilityFingerprint: null,
        },
      });
    });

    expect(onSharedDurableTurnCommitted).toHaveBeenCalledWith(
      sharedThreadId,
      "runtime-reattached-terminal",
    );
    expect(markProcessing).toHaveBeenCalledWith(sharedThreadId, false);
    expect(setActiveTurnId).toHaveBeenCalledWith(sharedThreadId, null);
    expect(getSharedSendState("ws-1", sharedThreadId).state).toBe("idle");
  });
  it("installs a stale observer terminal barrier without clearing a newer Attempt", async () => {
    const sharedThreadId = "shared:thread-stale-reattachment";
    const onSharedDurableTurnCommitted = vi.fn();
    const { markProcessing, setActiveTurnId } = makeThreadMessagingHook(
      "codex",
      {
        activeThreadId: sharedThreadId,
        threadEngineById: { [sharedThreadId]: "codex" },
        onSharedDurableTurnCommitted,
      },
    );
    dispatchSharedSendEvent("ws-1", sharedThreadId, { type: "send" });
    dispatchSharedSendEvent("ws-1", sharedThreadId, {
      type: "packagePrepared",
    });
    dispatchSharedSendEvent("ws-1", sharedThreadId, {
      type: "ackAmbiguous",
    });
    let resolveTerminal!: (
      value: Awaited<ReturnType<typeof sharedSessionV2AwaitTurnTerminal>>,
    ) => void;
    vi.mocked(sharedSessionV2AwaitTurnTerminal).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveTerminal = resolve;
      }),
    );
    const staleObserver = reattachSharedSessionAttempt(
      "ws-1",
      sharedThreadId,
      {
        status: "active",
        attemptId: "attempt-stale",
        bindingKey: "codex:provider-a",
        nativeThreadId: "native-stale",
        runtimeTurnId: "runtime-stale",
        executionTargetSnapshot: {
          engine: "codex",
          providerProfileId: "provider-a",
          modelCatalogEntryId: "settings-gpt-5",
          model: "gpt-5",
          reasoning: { effort: "high" },
          providerProfileNameSnapshot: "Provider A",
          providerProfileSource: "managed",
          runtimeCapabilityFingerprint: null,
        },
      },
    );
    setSharedSendActiveAttempt(
      "ws-1",
      sharedThreadId,
      "attempt-current",
    );

    await act(async () => {
      resolveTerminal({
        status: "committed",
        duplicate: false,
        sequence: 18,
        bindingKey: "codex:provider-a",
        terminal: {
          type: "run.settled",
          outcome: "completed",
          recoveryReason: null,
        },
      });
      await staleObserver;
    });

    expect(onSharedDurableTurnCommitted).toHaveBeenCalledWith(
      sharedThreadId,
      "runtime-stale",
    );
    expect(markProcessing).not.toHaveBeenCalledWith(sharedThreadId, false);
    expect(setActiveTurnId).not.toHaveBeenCalledWith(sharedThreadId, null);
    expect(getSharedSendActiveAttemptId("ws-1", sharedThreadId)).toBe(
      "attempt-current",
    );
  });
  it("records missing Runtime identity instead of fabricating a durable terminal barrier", async () => {
    const sharedThreadId = "shared:thread-missing-runtime-id";
    const onSharedDurableTurnCommitted = vi.fn();
    selectNextTarget("ws-1", sharedThreadId, {
      engine: "claude",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "settings-main",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
      model: "kimi-for-coding",
      reasoning: null,
    });
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce({
      result: { turn: { id: "nested-id-must-not-be-used" } },
      nativeThreadId: "claude:native-session-2",
      v2: {
        attemptId: "attempt-missing-runtime",
        logicalTurnId: "logical-missing-runtime",
        committed: true,
        duplicate: false,
      },
    });
    const { result, onDebug } = makeThreadMessagingHook("claude", {
      activeThreadId: sharedThreadId,
      threadEngineById: { [sharedThreadId]: "claude" },
      onSharedDurableTurnCommitted,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        sharedThreadId,
        "finish with malformed response",
      );
    });

    expect(onSharedDurableTurnCommitted).not.toHaveBeenCalled();
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "shared-session/durable-terminal-runtime-id-missing",
        payload: expect.objectContaining({
          threadId: sharedThreadId,
          attemptId: "attempt-missing-runtime",
          logicalTurnId: "logical-missing-runtime",
        }),
      }),
    );
  });
});
