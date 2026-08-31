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
  engineSendMessage,
  listGeminiSessions,
  sendUserMessage,
} from "../../../services/tauri";
import { getClientStoreSync } from "../../../services/clientStorage";

describe("useThreadMessaging", () => {
  registerThreadMessagingTestHooks();

  it("passes custom spec root through cli engine send when configured", async () => {
    vi.mocked(getClientStoreSync).mockImplementation((_store, key) => {
      if (key === "specHub.specRoot.ws-1") {
        return "/tmp/external-openspec";
      }
      return undefined;
    });
    const { result } = makeThreadMessagingHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "opencode-pending-abc", "hello");
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        customSpecRoot: "/tmp/external-openspec",
      }),
    );
  });
  it("sanitizes leaked claude model for opencode", async () => {
    const { result } = makeThreadMessagingHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
        [],
        { model: "claude-sonnet-4-5" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        model: "openai/gpt-5.3-codex",
      }),
    );
  });
  it("sanitizes leaked claude model for codex", async () => {
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello codex",
        [],
        { model: "claude-sonnet-4-5" },
      );
    });

    expect(sendUserMessage).toHaveBeenCalledWith(
      "ws-1",
      "thread-1",
      "hello codex",
      expect.objectContaining({
        model: null,
      }),
    );
  });
  it("keeps custom claude model ids for claude engine", async () => {
    const { result } = makeThreadMessagingHook("claude");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: "GLM-5.1" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "GLM-5.1",
      }),
    );
  });
  it("disables Claude CLI thinking when Claude thinking visibility is off", async () => {
    const { result } = makeThreadMessagingHook("claude", {
      claudeThinkingVisible: false,
      threadEngineById: { "claude:session-1": "claude" },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude:session-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        disableThinking: true,
      }),
    );
  });
  it("does not disable non-Claude thinking from the Claude visibility toggle", async () => {
    const { result } = makeThreadMessagingHook("opencode", {
      claudeThinkingVisible: false,
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "opencode",
        disableThinking: false,
      }),
    );
  });
  it("sends resolved Claude runtime model while diagnostics keep selected id and source", async () => {
    const { result, onDebug } = makeThreadMessagingHook("claude", {
      resolveComposerSelection: () => ({
        id: "claude-sonnet-option",
        model: "sonnet",
        source: "cli-discovered",
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "sonnet",
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "model/resolve",
        payload: expect.objectContaining({
          selectedModelId: "claude-sonnet-option",
          selectedModelSource: "cli-discovered",
          modelForSend: "sonnet",
        }),
      }),
    );
  });
  it("sends custom Claude model ids with bracket suffix to the backend", async () => {
    const { result, onDebug } = makeThreadMessagingHook("claude", {
      resolveComposerSelection: () => ({
        id: "Cxn[1m]",
        model: "Cxn[1m]",
        source: "custom",
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "Cxn[1m]",
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        model: "claude-opus-4-6[1m]",
      }),
    );
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "model/resolve",
        payload: expect.objectContaining({
          selectedModelId: "Cxn[1m]",
          selectedModelSource: "custom",
          modelForSend: "Cxn[1m]",
        }),
      }),
    );
  });
  it("keeps custom claude model ids with slash/colon/brackets for claude engine", async () => {
    const { result } = makeThreadMessagingHook("claude");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: "provider/model:202603[beta]" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "provider/model:202603[beta]",
      }),
    );
  });
  it("passes arbitrary claude custom model ids through to the backend", async () => {
    const { result } = makeThreadMessagingHook("claude");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: "bad model with spaces" },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: "bad model with spaces",
      }),
    );
  });
  it("passes overlong claude custom model ids through to the backend", async () => {
    const { result } = makeThreadMessagingHook("claude");
    const overlongModelId = `m${"x".repeat(128)}`;

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-1",
        "hello claude",
        [],
        { model: overlongModelId },
      );
    });

    expect(engineSendMessage).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({
        engine: "claude",
        model: overlongModelId,
      }),
    );
  });
  it("rejects direct and queue-fusion sends to Gemini before side effects", async () => {
    const { result } = makeThreadMessagingHook("gemini");

    await expect(
      result.current.sendUserMessageToThread(
        workspace,
        "gemini-pending-abc",
        "hello gemini",
      ),
    ).rejects.toThrow("Selected CLI engine is disabled by product policy");
    await expect(
      result.current.sendUserMessageToThread(
        workspace,
        "gemini:session-1",
        "queued follow up",
        [],
        { resumeSource: "queue-fusion-cutover" },
      ),
    ).rejects.toThrow("Selected CLI engine is disabled by product policy");

    expect(engineSendMessage).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(listGeminiSessions).not.toHaveBeenCalled();
  });
  it.each([
    ["claude", "claude:session-1"],
    ["codex", "thread-1"],
    ["opencode", "opencode:session-1"],
  ] as const)(
    "clears stale interrupted guard before a new %s send starts",
    async (engine, threadId) => {
      const { result, interruptedThreadsRef } = makeThreadMessagingHook(engine, {
        activeThreadId: threadId,
        ensuredThreadId: threadId,
        threadEngineById:
          engine === "codex"
            ? { [threadId]: "codex" }
            : { [threadId]: engine },
      });
      workspaceScopedSet(interruptedThreadsRef.current, workspace.id, threadId, true);

      await act(async () => {
        await result.current.sendUserMessageToThread(
          workspace,
          threadId,
          "hello again",
        );
      });

      expect(workspaceScopedHas(interruptedThreadsRef.current, workspace.id, threadId)).toBe(false);
    },
  );
  it("does not trigger auto title generation for opencode", async () => {
    const { result } = makeThreadMessagingHook("opencode");

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "opencode-pending-abc",
        "hello opencode",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
  });
  it("does not trigger auto title generation for codex", async () => {
    const { result } = makeThreadMessagingHook("codex");

    await act(async () => {
      await result.current.sendUserMessageToThread(workspace, "thread-1", "hello codex");
    });

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
  });
  it("does not trigger auto title generation for claude", async () => {
    const { result } = makeThreadMessagingHook("claude", {
      activeThreadId: "claude:session-1",
      ensuredThreadId: "claude:session-1",
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "claude:session-1",
        "hello claude",
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
  });
});
