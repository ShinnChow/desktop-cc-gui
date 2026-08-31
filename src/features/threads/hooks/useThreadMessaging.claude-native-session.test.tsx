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
  invalidateSessionIndexForWorkspace,
  loadClaudeSession,
  sendUserMessage,
} from "../../../services/tauri";
import { renameTurnTargetBadgeThread } from "../utils/turnTargetBadgeStorage";
import {
  getRuntimeReceipt,
  rememberRuntimeReceipt,
  resetRuntimeReceiptsForTests,
} from "../utils/runtimeModelReceipt";

const CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE =
  "Claude session is still initializing. Wait for the session to finish binding, then send again.";

describe("useThreadMessaging", () => {
  registerThreadMessagingTestHooks();

  it("blocks claude pending follow-up until native session confirmation arrives", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        sessionId: "session-xyz",
        result: { turn: { id: "turn-1" }, sessionId: "session-xyz" },
      });
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-abc",
      ensuredThreadId: "claude-pending-abc",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-abc",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-abc",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenNthCalledWith(
      1,
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: false,
        sessionId: null,
        threadId: "claude-pending-abc",
      }),
    );
    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "claude-pending-abc",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });
  it("rebinds claude pending follow-up after candidate transcript validates", async () => {
    resetRuntimeReceiptsForTests();
    const workspaceWithTrailingSpace = { ...workspace, path: "/tmp/mossx " };
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        sessionId: "session-xyz",
        result: { turn: { id: "turn-1" }, sessionId: "session-xyz" },
      })
      .mockResolvedValueOnce({
        sessionId: "session-xyz",
        result: { turn: { id: "turn-2" }, sessionId: "session-xyz" },
      });
    vi.mocked(loadClaudeSession).mockResolvedValueOnce({
      messages: [
        {
          kind: "message",
          id: "user-1",
          role: "user",
          text: "hello claude",
        },
        {
          kind: "message",
          id: "assistant-1",
          role: "assistant",
          text: "done",
        },
      ],
    });
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-abc",
      ensuredThreadId: "claude-pending-abc",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspaceWithTrailingSpace,
        "claude-pending-abc",
        "hello claude",
      );
    });

    // runtime 回执账本同迁：发送边界在 pending id 下记 send.request 回执
    //（pi 等无回执事件的引擎靠它出实时 Ⓡ 尾巴），candidate reconcile 改名
    // 后实时链路按正式 id 取 ingest meta，不迁则实时丢尾巴、历史反而有。
    rememberRuntimeReceipt("ws-1", "claude-pending-abc", {
      model: "claude-sonnet-4-6",
      modelSource: "send.request",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspaceWithTrailingSpace,
        "claude-pending-abc",
        "follow up",
      );
    });

    expect(loadClaudeSession).toHaveBeenCalledWith("/tmp/mossx ", "session-xyz");
    expect(dispatch).toHaveBeenCalledWith({
      type: "renameThreadId",
      workspaceId: "ws-1",
      oldThreadId: "claude-pending-abc",
      newThreadId: "claude:session-xyz",
    });
    // candidate reconcile 改名必须随迁 badge 侧车，否则首轮 badge 冷加载丢失。
    expect(renameTurnTargetBadgeThread).toHaveBeenCalledWith(
      "claude-pending-abc",
      "claude:session-xyz",
    );
    expect(getRuntimeReceipt("ws-1", "claude:session-xyz")?.model).toBe(
      "claude-sonnet-4-6",
    );
    expect(getRuntimeReceipt("ws-1", "claude:session-xyz")?.modelSource).toBe(
      "send.request",
    );
    expect(engineSendMessage).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: true,
        sessionId: "session-xyz",
        threadId: "claude:session-xyz",
      }),
    );
    expect(pushThreadErrorMessage).not.toHaveBeenCalledWith(
      "claude-pending-abc",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });
  it("does not rebind claude pending follow-up from user-only candidate transcript", async () => {
    vi.mocked(engineSendMessage).mockResolvedValueOnce({
      sessionId: "session-user-only",
      result: { turn: { id: "turn-1" }, sessionId: "session-user-only" },
    });
    vi.mocked(loadClaudeSession).mockResolvedValueOnce({
      messages: [
        {
          kind: "message",
          id: "user-1",
          role: "user",
          text: "hello claude",
        },
      ],
    });
    const dispatch = vi.fn();
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-user-only",
      ensuredThreadId: "claude-pending-user-only",
      dispatch,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-user-only",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-user-only",
        "follow up too early",
      );
    });

    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({
        type: "renameThreadId",
      }),
    );
    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "claude-pending-user-only",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });
  it("blocks restored claude pending thread with local items even without memory marker", async () => {
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-restored",
      ensuredThreadId: "claude-pending-restored",
      itemsByThread: {
        "claude-pending-restored": [
          {
            id: "user-1",
            kind: "message",
            role: "user",
            text: "hello claude",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-restored",
        "follow up after remount",
      );
    });

    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "claude-pending-restored",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });
  it("passes forkSessionId for the first send on a claude fork thread", async () => {
    vi.mocked(engineSendMessage).mockResolvedValueOnce({
      sessionId: "new-child-session",
      result: { turn: { id: "turn-1" }, sessionId: "new-child-session" },
    });
    const threadId = "claude-fork:parent-session-1:local-1";
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: threadId,
      ensuredThreadId: threadId,
      threadEngineById: {
        [threadId]: "claude",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        threadId,
        "hello from fork",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: false,
        sessionId: null,
        forkSessionId: "parent-session-1",
        threadId,
      }),
    );
  });
  it("does not accept snake_case claude session_id as pending native confirmation", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        result: {
          turn: { id: "turn-1" },
          session_id: "session-snake",
        },
      });
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-snake",
      ensuredThreadId: "claude-pending-snake",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-snake",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-snake",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "claude-pending-snake",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });
  it("does not send a stale native resolver target after switching PI sessions", async () => {
    const threadId = "pi:session-b";
    const { result } = makeThreadMessagingHook("pi", {
      activeThreadId: threadId,
      ensuredThreadId: threadId,
      threadEngineById: { [threadId]: "pi" },
      providerProfileByThread: { [threadId]: "provider-b" },
      model: "kimi-coding/k3",
      resolveComposerSelection: () => ({
        id: "openai-codex/gpt-5.6-terra",
        model: "openai-codex/gpt-5.6-terra",
        source: "managed",
        providerProfileId: "provider-a",
        effort: "high",
        collaborationMode: null,
        threadId: "pi:session-a",
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        threadId,
        "use the current PI session target",
        [],
        {
          nativeExecutionTarget: {
            engine: "pi",
            providerProfileId: "provider-b",
            modelCatalogEntryId: "kimi-coding/k3",
            model: "kimi-coding/k3",
            reasoning: { effort: "low" },
          },
        },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "pi",
        model: "kimi-coding/k3",
        effort: "low",
        providerProfileId: "provider-b",
      }),
    );
  });
  it("continues finalized pi session with native thread id", async () => {
    const { result } = makeThreadMessagingHook("pi", {
      activeThreadId: "pi:019ffb7b-dedc-7b36-8d2f-f85f35501036",
      ensuredThreadId: "pi:019ffb7b-dedc-7b36-8d2f-f85f35501036",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "pi:019ffb7b-dedc-7b36-8d2f-f85f35501036",
        "1+1",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "pi",
        continueSession: true,
        sessionId: "019ffb7b-dedc-7b36-8d2f-f85f35501036",
        threadId: "pi:019ffb7b-dedc-7b36-8d2f-f85f35501036",
      }),
    );
  });
  it("invalidates session index after pending pi send caches native id", async () => {
    vi.mocked(engineSendMessage).mockResolvedValue({
      sessionId: "019ffb98-e96c-7914-aeac-52d5744c65de",
      result: { turn: { id: "turn-pi-1" } },
    });
    vi.mocked(invalidateSessionIndexForWorkspace).mockResolvedValue(1);

    const { result } = makeThreadMessagingHook("pi", {
      activeThreadId: "pi-pending-abc",
      ensuredThreadId: "pi-pending-abc",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "pi-pending-abc",
        "1+1",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "pi",
        continueSession: false,
        sessionId: null,
        threadId: "pi-pending-abc",
      }),
    );
    await waitFor(() => {
      expect(invalidateSessionIndexForWorkspace).toHaveBeenCalledWith("ws-1");
    });
  });
  it("continues finalized claude session with native thread id", async () => {
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-native-1",
      ensuredThreadId: "claude:session-native-1",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude:session-native-1",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        continueSession: true,
        sessionId: "session-native-1",
        threadId: "claude:session-native-1",
      }),
    );
  });
  it("does not treat thread id as claude session id fallback", async () => {
    vi.mocked(engineSendMessage)
      .mockResolvedValueOnce({
        result: {
          turn: { id: "turn-1" },
          thread: { id: "claude:session-from-thread-id" },
        },
      });
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude-pending-def",
      ensuredThreadId: "claude-pending-def",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-def",
        "hello claude",
      );
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude-pending-def",
        "follow up",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(pushThreadErrorMessage).toHaveBeenCalledWith(
      workspace.id,
      "claude-pending-def",
      CLAUDE_PENDING_NATIVE_SESSION_WAIT_MESSAGE,
    );
  });
  it("routes by thread ownership when active engine mismatches", async () => {
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ engine: "opencode" }),
    );
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
});
