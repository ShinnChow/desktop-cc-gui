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
  engineSendMessage,
  sendUserMessage,
} from "../../../services/tauri";
import { sendSharedSessionTurnRouted } from "../../shared-session/runtime/sendSharedSessionTurn";

describe("useThreadMessaging", () => {
  registerThreadMessagingTestHooks();

  it.each(["claude", "kimi"] as const)(
    "sends the current %s thread provider binding to the engine",
    async (engine) => {
      const threadId = `${engine}:session-1`;
      const { result } = makeThreadMessagingHook(engine, {
        activeThreadId: threadId,
        ensuredThreadId: threadId,
        threadEngineById: { [threadId]: engine },
        providerProfileByThread: { [threadId]: "provider-a" },
      });

      await act(async () => {
        await result.current.sendUserMessage("hello");
      });

      expect(engineSendMessage).toHaveBeenCalledWith(
        "ws-1",
        expect.objectContaining({
          engine,
          threadId,
          providerProfileId: "provider-a",
        }),
      );
    },
  );
  it.each(["claude", "grok", "kimi", "opencode", "pi"] as const)(
    "does not block %s sends with non-empty images at client boundary",
    async (engine) => {
      const { result, pushThreadErrorMessage } = makeThreadMessagingHook(engine, {
        activeThreadId: `${engine}:session-1`,
        threadEngineById: {
          [`${engine}:session-1`]: engine,
        },
      });

      await act(async () => {
        await result.current.sendUserMessageToThread(
          workspace,
          `${engine}:session-1`,
          `${engine} send with image`,
          ["/tmp/example.png"],
        );
      });

      expect(pushThreadErrorMessage).not.toHaveBeenCalledWith(
        workspace.id,
        `${engine}:session-1`,
        expect.stringContaining("does not support image input"),
      );
      expect(engineSendMessage).toHaveBeenCalledWith(
        workspace.id,
        expect.objectContaining({
          engine,
          images: ["/tmp/example.png"],
        }),
      );
    },
  );
  it("blocks Grok sends when a pasted data URL exceeds the 2MB cap", async () => {
    // 3MiB decoded so size and limit stay distinguishable after formatByteSize.
    const oversized =
      "data:image/png;base64," + "A".repeat(Math.ceil((3 * 1024 * 1024) / 3) * 4);
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("grok", {
      activeThreadId: "grok:session-1",
      threadEngineById: {
        "grok:session-1": "grok",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "grok:session-1",
        "look at this screenshot",
        [oversized],
      );
    });

    expect(pushThreadErrorMessage).toHaveBeenCalledTimes(1);
    const errorMessage = String(pushThreadErrorMessage.mock.calls[0]?.[2] ?? "");
    expect(errorMessage).toContain("Grok CLI");
    expect(errorMessage).toContain("2 MB");
    expect(errorMessage).toContain("3 MB");
    expect(errorMessage).not.toContain("data:image");
    expect(errorMessage).not.toContain("AAAAAAAA");
    expect(engineSendMessage).not.toHaveBeenCalled();
  });
  it("does not block codex sends with non-empty images at client boundary", async () => {
    const { result, pushThreadErrorMessage } = makeThreadMessagingHook("codex", {
      activeThreadId: "thread-codex-1",
      threadEngineById: {
        "thread-codex-1": "codex",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "thread-codex-1",
        "codex send with image",
        ["/tmp/example.png"],
      );
    });

    expect(pushThreadErrorMessage).not.toHaveBeenCalledWith(
      workspace.id,
      "thread-codex-1",
      expect.stringContaining("does not support image input"),
    );
    // Codex native path uses sendUserMessage, not engineSendMessage.
    expect(sendUserMessage).toHaveBeenCalledWith(
      workspace.id,
      "thread-codex-1",
      "codex send with image",
      expect.objectContaining({
        images: ["/tmp/example.png"],
      }),
    );
    expect(engineSendMessage).not.toHaveBeenCalled();
  });
  it("sends a Native custom Codex model with null effort through sendUserMessage", async () => {
    const threadId = "thread-native-custom-codex";
    const { result } = makeThreadMessagingHook("codex", {
      activeThreadId: threadId,
      threadEngineById: { [threadId]: "codex" },
      resolveComposerSelection: () => ({
        id: "gpt-5.3-codex-spark",
        model: "gpt-5.3-codex-spark",
        source: "custom",
        providerProfileId: null,
        effort: null,
        collaborationMode: null,
      }),
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        threadId,
        "hello native custom model",
      );
    });

    expect(sendUserMessage).toHaveBeenCalledWith(
      workspace.id,
      threadId,
      "hello native custom model",
      expect.objectContaining({
        model: "gpt-5.3-codex-spark",
        effort: null,
      }),
    );
    expect(sendSharedSessionTurnRouted).not.toHaveBeenCalled();
    expect(engineSendMessage).not.toHaveBeenCalled();
  });
  it("treats only non-empty image entries as attachment content for grok", async () => {
    const { result } = makeThreadMessagingHook("grok", {
      activeThreadId: "grok:session-1",
      threadEngineById: {
        "grok:session-1": "grok",
      },
    });

    await act(async () => {
      await result.current.sendUserMessageToThread(
        workspace,
        "grok:session-1",
        "grok send without real images",
        ["  ", "\n", ""],
      );
    });

    expect(engineSendMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(engineSendMessage)).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({
        engine: "grok",
        images: null,
      }),
    );
  });
  it("routes opencode thread through engineSendMessage", async () => {
    const { result } = makeThreadMessagingHook("opencode");

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
