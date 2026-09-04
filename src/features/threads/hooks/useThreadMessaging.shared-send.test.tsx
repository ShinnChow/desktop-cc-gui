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
  sendUserMessage,
} from "../../../services/tauri";
import { sendSharedSessionTurnRouted } from "../../shared-session/runtime/sendSharedSessionTurn";
import {
  consumeSharedSendAdmission,
  dispatchSharedSendEvent,
} from "../../shared-session/runtime/sharedSendStateStore";
import { selectNextTarget } from "../../shared-session/target/targetStore";

describe("useThreadMessaging", () => {
  registerThreadMessagingTestHooks();

  it("blocks a non-idle Shared V2 submit before optimistic or processing mutations", async () => {
    dispatchSharedSendEvent("ws-1", "shared:thread-busy", { type: "send" });
    const dispatch = vi.fn();
    const {
      result,
      markProcessing,
      recordThreadActivity,
      safeMessageActivity,
    } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-busy",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-busy",
        "must stay draft only",
      );
    });

    expect(sendSharedSessionTurnRouted).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(recordThreadActivity).not.toHaveBeenCalled();
    expect(safeMessageActivity).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "upsertItem" }),
    );
  });
  it("atomically admits only one of two racing Shared V2 submits before optimistic UI", async () => {
    selectNextTarget("ws-1", "shared:thread-race", {
      engine: "codex",
      providerProfileId: "provider-a",
      modelCatalogEntryId: "provider-a:gpt-a",
      providerProfileNameSnapshot: "Provider A",
      providerProfileSource: "managed",
      model: "gpt-a",
      reasoning: { effort: "medium" },
    });
    let resolveFirstRoute:
      | ((value: Record<string, unknown>) => void)
      | undefined;
    const firstRoute = new Promise<Record<string, unknown>>((resolve) => {
      resolveFirstRoute = resolve;
    });
    vi.mocked(sendSharedSessionTurnRouted).mockImplementation((input) => {
      const revision = input.sharedSendAdmissionRevision;
      expect(typeof revision).toBe("number");
      expect(
        consumeSharedSendAdmission(
          input.workspaceId,
          input.threadId,
          revision as number,
        ),
      ).toBe(true);
      return firstRoute;
    });
    const dispatch = vi.fn();
    const { result, markProcessing } = makeThreadMessagingHook("codex", {
        activeThreadId: "shared:thread-race",
        dispatch,
      });

    const firstSend = result.current.sendUserMessageToThread(
      workspace,
      "shared:thread-race",
      "first",
    );
    await waitFor(() => {
      expect(sendSharedSessionTurnRouted).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-race",
        "second",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledTimes(1);
    expect(
      dispatch.mock.calls.filter(
        ([action]) =>
          action?.type === "upsertItem" &&
          action.item?.kind === "message" &&
          action.item?.role === "user",
      ),
    ).toHaveLength(1);
    expect(
      markProcessing.mock.calls.filter(
        ([threadId, processing]) =>
          threadId === "shared:thread-race" && processing === true,
      ),
    ).toHaveLength(1);

    resolveFirstRoute?.({ result: { turn: { id: "shared-turn-race" } } });
    await act(async () => {
      await firstSend;
    });
  });
  it("normalizes unsupported shared-session sends back to claude", async () => {
    window.localStorage.setItem("mossx.sharedV2Send", "0");
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("gemini", {
      activeThreadId: "shared:thread-1",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-1",
        "hello shared",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "shared:thread-1",
        engine: "claude",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadEngine",
        threadId: "shared:thread-1",
        engine: "claude",
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
  it("uses active shared engine selection instead of stale thread engine when sending", async () => {
    window.localStorage.setItem("mossx.sharedV2Send", "0");
    const dispatch = vi.fn();
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-sticky-engine",
      dispatch,
      threadEngineById: {
        "shared:thread-sticky-engine": "codex",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-sticky-engine",
        "切回 claude 后继续发送",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "shared:thread-sticky-engine",
        engine: "claude",
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadEngine",
        workspaceId: "ws-1",
        threadId: "shared:thread-sticky-engine",
        engine: "claude",
      }),
    );
  });
  it("uses the current Composer target only during explicit Shared V0 rollback", async () => {
    window.localStorage.setItem("mossx.sharedV2Send", "0");
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-provider-target",
      resolveComposerSelection: () => ({
        id: "provider-model",
        model: "claude-provider-model",
        source: "provider",
        providerProfileId: "provider-openrouter",
        effort: "high",
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-provider-target",
        "hello provider",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "claude",
        model: "claude-provider-model",
        effort: "high",
        target: {
          engine: "claude",
          providerProfileId: "provider-openrouter",
          model: "claude-provider-model",
          reasoning: { effort: "high" },
        },
      }),
    );
  });
  it("fails closed before UI mutations when Shared V2 has no durable Target", async () => {
    const dispatch = vi.fn();
    const { result, markProcessing, recordThreadActivity, pushThreadErrorMessage } =
      makeThreadMessagingHook("claude", {
        activeThreadId: "shared:thread-missing-target",
        dispatch,
        resolveComposerSelection: () => ({
          id: "stale-provider-model",
          model: "stale-provider-model",
          source: "provider",
          providerProfileId: "stale-provider",
          effort: "high",
          collaborationMode: null,
        }),
      });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-missing-target",
        "must not rebuild target from Composer",
      );
    });

    expect(sendSharedSessionTurnRouted).not.toHaveBeenCalled();
    expect(markProcessing).not.toHaveBeenCalled();
    expect(recordThreadActivity).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-missing-target",
      expect.stringContaining("目标不完整"),
    );
  });
  it("uses the Shared Target Store instead of a stale global Composer selection", async () => {
    selectNextTarget("ws-1", "shared:thread-provider-store", {
      engine: "codex",
      providerProfileId: "provider-b",
      modelCatalogEntryId: "provider-b:gpt-provider-b",
      providerProfileNameSnapshot: "Provider B",
      providerProfileSource: "managed",
      model: "gpt-provider-b",
      reasoning: { effort: "medium" },
    });
    const dispatch = vi.fn();
    const { result, onDebug } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-provider-store",
      dispatch,
      resolveComposerSelection: () => ({
        id: "stale-claude-model",
        model: "stale-claude-model",
        source: "provider",
        providerProfileId: "provider-a",
        effort: "high",
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-provider-store",
        "use selected target",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        model: "gpt-provider-b",
        effort: "medium",
        target: {
          engine: "codex",
          providerProfileId: "provider-b",
          modelCatalogEntryId: "provider-b:gpt-provider-b",
          providerProfileNameSnapshot: "Provider B",
          providerProfileSource: "managed",
          model: "gpt-provider-b",
          reasoning: { effort: "medium" },
        },
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "model/resolve",
        payload: expect.objectContaining({
          engine: "codex",
          selectedModelId: "provider-b:gpt-provider-b",
          selectedModelSource: "managed",
          resolvedModel: "gpt-provider-b",
          modelForSend: "gpt-provider-b",
        }),
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "turn/start",
        payload: expect.objectContaining({
          engine: "codex",
          providerProfileId: "provider-b",
          modelCatalogEntryId: "provider-b:gpt-provider-b",
          model: "gpt-provider-b",
          effort: "medium",
        }),
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "setThreadEngine",
        threadId: "shared:thread-provider-store",
        engine: "codex",
      }),
    );
  });
  it("does not assemble Shared send from leftover Composer resolver or global model", async () => {
    selectNextTarget("ws-1", "shared:thread-override-ignored", {
      engine: "claude",
      providerProfileId: "k3",
      modelCatalogEntryId: "kimi-k3",
      providerProfileNameSnapshot: "k3",
      providerProfileSource: "managed",
      model: "kimi-k3",
      reasoning: null,
    });
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-override-ignored",
      model: "foreign-global-model",
      resolveComposerSelection: () => ({
        id: "stale-overlay-model",
        model: "stale-overlay-model",
        source: "custom",
        providerProfileId: "leftover-override",
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-override-ignored",
        "ignore leftover override",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "claude",
        model: "kimi-k3",
        target: expect.objectContaining({
          engine: "claude",
          providerProfileId: "k3",
          model: "kimi-k3",
        }),
      }),
    );
  });
  it("uses the committed Native resolver instead of a foreign global selectedModelId", async () => {
    const { result } = makeThreadMessagingHook("claude", {
      model: "foreign-global-model",
      resolveComposerSelection: () => ({
        id: "clicked-runtime",
        model: "clicked-runtime",
        source: "custom",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello committed runtime",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "clicked-runtime",
      }),
    );
  });
  it("does not fall back to hook model when Native resolver model is empty but id is committed", async () => {
    const { result } = makeThreadMessagingHook("claude", {
      model: "foreign-global-model",
      resolveComposerSelection: () => ({
        id: "clicked-runtime",
        model: null,
        source: "custom",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello resolver id",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "clicked-runtime",
      }),
    );
  });
  it("returns the Shared typed commit and prefers a frozen queue target", async () => {
    const threadId = "shared:thread-frozen-target";
    selectNextTarget("ws-1", threadId, {
      engine: "claude",
      providerProfileId: "current-provider",
      modelCatalogEntryId: "current-provider:claude",
      providerProfileNameSnapshot: "Current Provider",
      providerProfileSource: "managed",
      model: "claude-current",
      reasoning: { effort: "high" },
    });
    const frozenTarget = {
      engine: "codex" as const,
      providerProfileId: "queued-provider",
      modelCatalogEntryId: "queued-provider:gpt-5.6-sol",
      providerProfileNameSnapshot: "Queued Provider",
      providerProfileSource: "managed" as const,
      model: "gpt-5.6-sol",
      reasoning: { effort: "max" },
    };
    const committedResponse = {
      status: "accepted",
      runtimeTurnId: "runtime-turn-queued",
      v2: {
        attemptId: "attempt-queued",
        logicalTurnId: "logical-turn-queued",
        committed: true,
        duplicate: false,
      },
    };
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce(
      committedResponse,
    );
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: threadId,
    });

    let response: unknown;
    await act(async () => {
      response = await result.current.sendUserMessageToThread(
        workspace,
        threadId,
        "use frozen target",
        [],
        { sharedExecutionTarget: frozenTarget },
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "codex",
        model: "gpt-5.6-sol",
        effort: "max",
        target: frozenTarget,
      }),
    );
    expect(response).toEqual(committedResponse);
  });
  it("keeps Shared PI reasoning effort at the send boundary (capability-neutral passthrough)", async () => {
    // send 边界的 PI model ref 只有字符串（无 supportedReasoningEfforts），
    // reconcile 走 capability-neutral 直通：不发明、不清档（allowlist reconcile
    // 由 Composer 层带 catalog metadata 完成）。合法档位 high 原样送达。
    const threadId = "shared:thread-pi-effort-high";
    const piTarget = {
      engine: "pi" as const,
      providerProfileId: "provider-pi",
      modelCatalogEntryId: "provider-pi:google/gemini-2.5-pro",
      providerProfileNameSnapshot: "PI Provider",
      providerProfileSource: "managed" as const,
      model: "google/gemini-2.5-pro",
      reasoning: { effort: "high" },
    };
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce({
      status: "accepted",
      runtimeTurnId: "runtime-turn-pi-high",
      v2: {
        attemptId: "attempt-pi-high",
        logicalTurnId: "logical-turn-pi-high",
        committed: true,
        duplicate: false,
      },
    });
    const { result } = makeThreadMessagingHook("pi", {
      activeThreadId: threadId,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, threadId, "pi boundary high", [], {
        sharedExecutionTarget: piTarget,
      });
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "pi",
        model: "google/gemini-2.5-pro",
        effort: "high",
        target: piTarget,
      }),
    );
  });
  it("keeps an out-of-band Shared PI effort value at the send boundary instead of inventing a level", async () => {
    // 边界无 capability metadata 时禁止发明档位：ultra 直通（既不映射 default
    // 也不清空）；「非法档位收敛到模型 default」由带 metadata 的
    // reconcileAtomicReasoningEffort 路径负责（atomicModelReasoning.test 覆盖）。
    const threadId = "shared:thread-pi-effort-ultra";
    const piTarget = {
      engine: "pi" as const,
      providerProfileId: "provider-pi",
      modelCatalogEntryId: "provider-pi:google/gemini-2.5-pro",
      providerProfileNameSnapshot: "PI Provider",
      providerProfileSource: "managed" as const,
      model: "google/gemini-2.5-pro",
      reasoning: { effort: "ultra" },
    };
    vi.mocked(sendSharedSessionTurnRouted).mockResolvedValueOnce({
      status: "accepted",
      runtimeTurnId: "runtime-turn-pi-ultra",
      v2: {
        attemptId: "attempt-pi-ultra",
        logicalTurnId: "logical-turn-pi-ultra",
        committed: true,
        duplicate: false,
      },
    });
    const { result } = makeThreadMessagingHook("pi", {
      activeThreadId: threadId,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, threadId, "pi boundary ultra", [], {
        sharedExecutionTarget: piTarget,
      });
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        engine: "pi",
        model: "google/gemini-2.5-pro",
        effort: "ultra",
        target: piTarget,
      }),
    );
  });
  it("fails closed for a stale unsupported Shared Target", async () => {
    selectNextTarget("ws-1", "shared:thread-1", {
      engine: "gemini",
      providerProfileId: "provider-gemini",
      modelCatalogEntryId: "provider-gemini:gemini-pro",
      providerProfileNameSnapshot: "Gemini Provider",
      providerProfileSource: "managed",
      model: "gemini-pro",
      reasoning: null,
    });
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-1",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-1",
        "hello shared",
      );
    });
    expect(sendSharedSessionTurnRouted).not.toHaveBeenCalled();
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      "ws-1",
      "shared:thread-1",
      expect.stringContaining("当前 Shared Session 目标暂不可执行"),
    );
  });
  it("rejects a historical Gemini target before creating a replacement thread", async () => {
    const startThreadForWorkspace = vi.fn(async () => "claude-pending-new");
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "gemini:historical-session",
      ensuredThreadId: "gemini:historical-session",
      threadEngineById: {
        "gemini:historical-session": "gemini",
      },
      startThreadForWorkspace,
    });

    await expect(result.current.sendUserMessage("do not switch providers")).rejects.toThrow(
      "Selected CLI engine is disabled by product policy",
    );

    expect(startThreadForWorkspace).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
  it("disables Claude CLI thinking for shared Claude sends when visibility is off", async () => {
    selectNextTarget("ws-1", "shared:thread-disable-thinking", {
      engine: "claude",
      providerProfileId: null,
      modelCatalogEntryId: "claude-local:sonnet",
      providerProfileNameSnapshot: "本机配置",
      providerProfileSource: "disk",
      model: "sonnet",
      reasoning: null,
    });
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "shared:thread-disable-thinking",
      claudeThinkingVisible: false,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "shared:thread-disable-thinking",
        "hello shared claude",
      );
    });

    expect(sendSharedSessionTurnRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        threadId: "shared:thread-disable-thinking",
        engine: "claude",
        disableThinking: true,
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalled();
  });
});
