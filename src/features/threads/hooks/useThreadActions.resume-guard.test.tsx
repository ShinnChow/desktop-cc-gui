// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetUseThreadActionsTestMocks } from "./useThreadActions.test-mocks";
import { loadPiSession, resumeThread } from "../../../services/tauri";
import { renderActions, workspace } from "./useThreadActions.test-utils";

describe("useThreadActions resume guards", () => {
  beforeEach(() => {
    resetUseThreadActionsTestMocks();
  });

  it("skips resume when already loaded", async () => {
    const loadedThreadsRef = { current: { "thread-1": true } };
    const { result } = renderActions({ loadedThreadsRef });

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.resumeThreadForWorkspace("ws-1", "thread-1");
    });

    expect(threadId).toBe("thread-1");
    expect(resumeThread).not.toHaveBeenCalled();
  });

  it("skips resume while processing unless forced", async () => {
    const options = {
      loadedThreadsRef: { current: { "thread-1": true } },
      threadStatusById: {
        "thread-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: 123,
          lastDurationMs: null,
        },
      },
    };
    const { result: skipResult } = renderActions(options);

    await act(async () => {
      await skipResult.current.resumeThreadForWorkspace("ws-1", "thread-1");
    });

    expect(resumeThread).not.toHaveBeenCalled();

    vi.mocked(resumeThread).mockResolvedValue({
      result: { thread: { id: "thread-1", updated_at: 1 } },
    });

    const { result: forceResult } = renderActions(options);

    await act(async () => {
      await forceResult.current.resumeThreadForWorkspace("ws-1", "thread-1", true);
    });

    expect(resumeThread).toHaveBeenCalledWith("ws-1", "thread-1");
  });

  it("loads native PI history instead of the Codex resume path", async () => {
    vi.mocked(loadPiSession).mockResolvedValue({
      messages: [
        {
          id: "pi-user-1",
          kind: "message",
          role: "user",
          text: "1+1",
        },
        {
          id: "pi-assistant-1",
          kind: "message",
          role: "assistant",
          text: "2",
        },
      ],
    });
    const { result, dispatch, loadedThreadsRef } = renderActions({
      resolveWorkspacePath: () => workspace.path,
    });

    let threadId: string | null = null;
    await act(async () => {
      threadId = await result.current.resumeThreadForWorkspace(
        "ws-1",
        "pi:019ffb7b-dedc-7b36-8d2f-f85f35501036",
      );
    });

    expect(threadId).toBe("pi:019ffb7b-dedc-7b36-8d2f-f85f35501036");
    expect(resumeThread).not.toHaveBeenCalled();
    expect(loadPiSession).toHaveBeenCalledWith(
      workspace.path,
      "019ffb7b-dedc-7b36-8d2f-f85f35501036",
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "ensureThread",
      workspaceId: "ws-1",
      threadId: "pi:019ffb7b-dedc-7b36-8d2f-f85f35501036",
      engine: "pi",
    });
    expect(
      loadedThreadsRef.current["pi:019ffb7b-dedc-7b36-8d2f-f85f35501036"],
    ).toBe(true);
  });

  // harden-pi-session-curtain-fidelity：pi load 失败不再置 loaded——置位会
  // 阻止 20s 切回 refresh 与下次选中重试，形成「吞了刷新也回不来」的
  // sticky 丢失。失败须留下降级记录，且下一次 resume 重新 load。
  it("keeps a failed PI history load retryable and records the recovery failure", async () => {
    const piThreadId = "pi:019ffb7b-dedc-7b36-8d2f-f85f35501037";
    vi.mocked(loadPiSession).mockRejectedValueOnce(
      new Error("[SESSION_NOT_FOUND] PI session not found"),
    );
    const onDebug = vi.fn();
    const { result, loadedThreadsRef } = renderActions({
      resolveWorkspacePath: () => workspace.path,
      onDebug,
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", piThreadId);
    });

    expect(loadPiSession).toHaveBeenCalledTimes(1);
    // 未置位（undefined/false 均可）：置位会阻止后续 resume 重新 load。
    expect(loadedThreadsRef.current[piThreadId]).not.toBe(true);
    const recoveryFailureEntry = onDebug.mock.calls
      .map((call) => call[0] as { label?: string; payload?: { reasonCode?: string } })
      .find((entry) => entry?.payload?.reasonCode === "pi-history-load-failed");
    expect(recoveryFailureEntry).toBeDefined();

    vi.mocked(loadPiSession).mockResolvedValue({
      messages: [
        {
          id: "pi-user-1",
          kind: "message",
          role: "user",
          text: "recovered",
        },
      ],
    });
    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", piThreadId);
    });

    expect(loadPiSession).toHaveBeenCalledTimes(2);
    expect(loadedThreadsRef.current[piThreadId]).toBe(true);
  });

  it("stops retrying a permanently failing PI history load after the attempt cap", async () => {
    const piThreadId = "pi:019ffb7b-dedc-7b36-8d2f-f85f35501038";
    vi.mocked(loadPiSession).mockRejectedValue(
      new Error("[SESSION_NOT_FOUND] PI session not found"),
    );
    const { result, loadedThreadsRef } = renderActions({
      resolveWorkspacePath: () => workspace.path,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await act(async () => {
        await result.current.resumeThreadForWorkspace("ws-1", piThreadId);
      });
    }

    expect(loadPiSession).toHaveBeenCalledTimes(3);
    expect(loadedThreadsRef.current[piThreadId]).toBe(true);
  });

  // harden-pi-session-curtain-fidelity：merge 锚点 miss 回退「信任磁盘整体
  // 替换」时必须留 debug 痕迹（纯观测，合并结果不变）。
  it("logs an anchor-miss fallback debug entry during merge without changing the merge result", async () => {
    const piThreadId = "pi:019ffb7b-dedc-7b36-8d2f-f85f35501039";
    vi.mocked(loadPiSession).mockResolvedValue({
      messages: [
        {
          id: "pi-disk-1",
          kind: "message",
          role: "user",
          text: "from disk",
        },
      ],
    });
    const onDebug = vi.fn();
    const { result } = renderActions({
      resolveWorkspacePath: () => workspace.path,
      onDebug,
      itemsByThread: {
        [piThreadId]: [
          {
            id: "pi-live-only",
            kind: "message",
            role: "assistant",
            text: "live item not on disk",
          },
        ],
      },
    });

    await act(async () => {
      await result.current.resumeThreadForWorkspace(
        "ws-1",
        piThreadId,
        true,
        true,
        { mergeHydratedPrefix: true },
      );
    });

    const anchorMissEntry = onDebug.mock.calls
      .map((call) => call[0] as { label?: string })
      .find(
        (entry) =>
          entry?.label === "thread/hydrated merge anchor-miss fallback-to-disk",
      );
    expect(anchorMissEntry).toBeDefined();
  });
});
