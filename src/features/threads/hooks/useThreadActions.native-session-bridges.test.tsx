// @vitest-environment jsdom
import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import {
  deleteCodexSession,
  deleteClaudeSession,
  deleteGeminiSession,
  deleteOpenCodeSession,
  deletePiSession,
  deleteWorkspaceSessions,
  tombstoneSessionIndexRows,
  connectWorkspace,
  createWorkspaceDirectory,
  getOpenCodeSessionList,
  listWorkspaceSessions,
  listClaudeSessions,
  listGeminiSessions,
  listKimiSessions,
  listGrokSessions,
  listDshSessions,
  listPiSessions,
  listSessionIndexForWorkspace,
  loadClaudeSession,
  loadGeminiSession,
  loadCodexSession,
  listThreadTitles,
  renameThreadTitleKey,
  setThreadTitle,
  listThreads,
  resumeThread,
  readWorkspaceFile,
  startThread,
  trashWorkspaceItem,
  writeWorkspaceFile,
} from "../../../services/tauri";
import { previewThreadName } from "../../../utils/threadItems";
import { loadSidebarSnapshot } from "../utils/sidebarSnapshot";
import {
  expectSetThreadsDispatched,
  renderActions,
  workspace,
} from "./useThreadActions.test-utils";

vi.mock("../../../services/tauri", () => ({
  startThread: vi.fn(),
  connectWorkspace: vi.fn(),
  createWorkspaceDirectory: vi.fn(),
  forkClaudeSession: vi.fn(),
  forkClaudeSessionFromMessage: vi.fn(),
  forkThread: vi.fn(),
  rewindCodexThread: vi.fn(),
  listClaudeSessions: vi.fn(),
  listGeminiSessions: vi.fn(),
  listKimiSessions: vi.fn(),
  listGrokSessions: vi.fn(),
  listDshSessions: vi.fn(),
  listPiSessions: vi.fn(),
  getOpenCodeSessionList: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  listSessionIndexForWorkspace: vi.fn(),
  rememberSessionIndexWorkspacePath: vi.fn(),
  loadClaudeSession: vi.fn(),
  loadGeminiSession: vi.fn(),
  loadCodexSession: vi.fn(),
  listThreadTitles: vi.fn(),
  readWorkspaceFile: vi.fn(),
  renameThreadTitleKey: vi.fn(),
  setThreadTitle: vi.fn(),
  resumeThread: vi.fn(),
  listThreads: vi.fn(),
  deleteCodexSession: vi.fn(),
  deleteClaudeSession: vi.fn(),
  deleteGeminiSession: vi.fn(),
  deleteOpenCodeSession: vi.fn(),
  deletePiSession: vi.fn(),
  deleteWorkspaceSessions: vi.fn(),
  tombstoneSessionIndexRows: vi.fn(),
  trashWorkspaceItem: vi.fn(),
  writeWorkspaceFile: vi.fn(),
}));

vi.mock("../../../utils/threadItems", () => ({
  buildItemsFromThread: vi.fn(),
  extractClaudeApprovalResumeEntries: vi.fn(() => []),
  getThreadTimestamp: vi.fn(),
  isReviewingFromThread: vi.fn(),
  mergeThreadItems: vi.fn(),
  previewThreadName: vi.fn(),
  stripClaudeApprovalResumeArtifacts: vi.fn((text: string) => text),
}));

vi.mock("../utils/threadStorage", () => ({
  makeCustomNameKey: (workspaceId: string, threadId: string) =>
    `${workspaceId}:${threadId}`,
  saveThreadActivity: vi.fn(),
}));

vi.mock("../utils/sidebarSnapshot", () => ({
  loadSidebarSnapshot: vi.fn(() => null),
}));

describe("useThreadActions native session bridges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.mocked(listThreadTitles).mockResolvedValue({});
    vi.mocked(listGeminiSessions).mockResolvedValue([]);
    vi.mocked(listKimiSessions).mockResolvedValue([]);
    vi.mocked(listGrokSessions).mockResolvedValue([]);
    vi.mocked(listPiSessions).mockResolvedValue([]);
    vi.mocked(listDshSessions).mockResolvedValue([]);
    vi.mocked(listSessionIndexForWorkspace).mockResolvedValue({
      data: [],
      source: "session-index",
      synced: false,
      engines: [],
      visibility: {
        available: true,
        freshness: "verified",
        hiddenNativeIds: [],
      },
    });
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(renameThreadTitleKey).mockResolvedValue(undefined);
    vi.mocked(setThreadTitle).mockResolvedValue("title");
    vi.mocked(connectWorkspace).mockResolvedValue(undefined);
    vi.mocked(createWorkspaceDirectory).mockResolvedValue(undefined);
    vi.mocked(previewThreadName).mockImplementation(
      (text: string, fallback: string) => {
        const trimmed = text.trim();
        return trimmed || fallback;
      },
    );
    vi.mocked(deleteClaudeSession).mockResolvedValue(undefined);
    vi.mocked(deleteGeminiSession).mockResolvedValue(undefined);
    vi.mocked(deleteOpenCodeSession).mockResolvedValue({
      deleted: true,
      method: "filesystem",
    });
    vi.mocked(deletePiSession).mockResolvedValue(undefined);
    vi.mocked(deleteWorkspaceSessions).mockImplementation(
      async (_workspaceId: string, sessionIds: string[]) => ({
        results: sessionIds.map((sessionId) => ({
          sessionId,
          ok: true,
          archivedAt: null,
          error: null,
          code: "SESSION_DELETED",
          deletedFromDisk: true,
          metadataCleaned: true,
        })),
      }),
    );
    vi.mocked(tombstoneSessionIndexRows).mockResolvedValue(0);
    vi.mocked(deleteCodexSession).mockResolvedValue({
      deleted: true,
      deletedCount: 1,
      method: "filesystem",
      archivedBeforeDelete: true,
    });
    vi.mocked(loadGeminiSession).mockResolvedValue({ messages: [] });
    vi.mocked(loadCodexSession).mockResolvedValue({ messages: [] });
    vi.mocked(readWorkspaceFile).mockResolvedValue({
      content: "",
      truncated: false,
    });
    vi.mocked(startThread).mockResolvedValue({
      result: { thread: { id: "thread-1" } },
    });
    vi.mocked(trashWorkspaceItem).mockResolvedValue(undefined);
    vi.mocked(writeWorkspaceFile).mockResolvedValue(undefined);
    vi.mocked(loadSidebarSnapshot).mockReturnValue(null);
  });

  it("falls back to claude sessions when codex thread list remains not connected after retry", async () => {
    vi.mocked(listThreads)
      .mockRejectedValueOnce(new Error("workspace not connected"))
      .mockRejectedValueOnce(new Error("workspace not connected"));
    vi.mocked(listClaudeSessions).mockResolvedValue([
      {
        sessionId: "claude-fallback-1",
        firstMessage: "Claude recovered history",
        updatedAt: 1_730_100_000_000,
      },
    ]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expect(connectWorkspace).toHaveBeenCalledWith("ws-1", "thread-list-live");
    expect(listThreads).toHaveBeenCalledTimes(2);
    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "claude:claude-fallback-1",
        name: "Claude recovered history",
        updatedAt: 1_730_100_000_000,
        engineSource: "claude",
      },
    ]);
  });

  it("merges active codex catalog sessions into sidebar threads when live codex list is unavailable", async () => {
    vi.mocked(listThreads)
      .mockRejectedValueOnce(new Error("workspace not connected"))
      .mockRejectedValueOnce(new Error("workspace not connected"));
    vi.mocked(listClaudeSessions).mockResolvedValue([
      {
        sessionId: "claude-fallback-1",
        firstMessage: "Claude recovered history",
        updatedAt: 1_730_100_000_000,
      },
    ]);
    vi.mocked(listWorkspaceSessions).mockImplementation(
      async (_workspaceId, options) => {
        if (options?.query?.status === "active") {
          return {
            data: [
              {
                sessionId: "codex-history-1",
                workspaceId: "ws-1",
                engine: "codex",
                title:
                  "Generate a concise git commit message for the following changes.",
                updatedAt: 1_730_200_000_000,
                archivedAt: null,
                threadKind: "native",
                source: "mossx",
                provider: "openai",
                sourceLabel: "mossx/openai",
              },
            ],
            nextCursor: null,
            partialSource: null,
          };
        }
        return {
          data: [],
          nextCursor: null,
          partialSource: null,
        };
      },
    );
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expect(connectWorkspace).toHaveBeenCalledWith("ws-1", "thread-list-live");
    expect(listWorkspaceSessions).toHaveBeenCalledWith("ws-1", {
      query: {
        status: "active",
        sessionAttributionMode: "related",
        scanQuality: "preview",
      },
      cursor: null,
      limit: 5,
    });
    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "claude:claude-fallback-1",
        name: "Claude recovered history",
        updatedAt: 1_730_100_000_000,
        engineSource: "claude",
      },
    ]);
  });

  it("uses catalog source status as Claude membership authority", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([
      {
        sessionId: "native-outside-workspace",
        firstMessage: "Native row from another workspace",
        updatedAt: 1_730_400_000_000,
      },
    ]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listWorkspaceSessions).mockImplementation(
      async (_workspaceId, options) => {
        if (options?.query?.status === "active") {
          return {
            data: [
              {
                sessionId: "claude:catalog-child",
                stableSessionKey: "claude:child-ws:catalog-child",
                canonicalSessionId: "catalog-child",
                workspaceId: "child-ws",
                matchedWorkspaceId: "child-ws",
                engine: "claude",
                title: "Catalog-owned Claude session",
                updatedAt: 1_730_500_000_000,
                archivedAt: null,
                threadKind: "native",
                sourceCompleteness: "complete",
              },
            ],
            nextCursor: null,
            partialSource: null,
            sourceStatuses: [
              {
                engine: "claude",
                completeness: "complete",
              },
            ],
          };
        }
        return {
          data: [],
          nextCursor: null,
          partialSource: null,
          sourceStatuses: [],
        };
      },
    );

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace);
    });

    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "claude:catalog-child",
        name: "Catalog-owned Claude session",
        updatedAt: 1_730_500_000_000,
        engineSource: "claude",
      },
    ]);
    const setThreadsActions = dispatch.mock.calls
      .map(([action]) => action)
      .filter(
        (
          action,
        ): action is {
          type: "setThreads";
          threads: Array<{ id: string }>;
        } => action?.type === "setThreads",
      );
    const lastSetThreadsAction =
      setThreadsActions[setThreadsActions.length - 1];
    expect(lastSetThreadsAction.threads.map((thread) => thread.id)).toEqual([
      "claude:catalog-child",
    ]);
  });

  it("keeps slower codex catalog scans visible in the sidebar", async () => {
    vi.useFakeTimers();
    vi.mocked(listThreads)
      .mockRejectedValueOnce(new Error("workspace not connected"))
      .mockRejectedValueOnce(new Error("workspace not connected"));
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listWorkspaceSessions).mockImplementation(
      async (_workspaceId, options) => {
        if (options?.query?.status === "active") {
          await new Promise((resolve) => setTimeout(resolve, 20_000));
          return {
            data: [
              {
                sessionId: "codex-history-slow",
                workspaceId: "ws-1",
                engine: "codex",
                title:
                  "最近对话你什么时候加进来的.还是显示出来的.之前这里没有才对啊.",
                updatedAt: 1_730_300_000_000,
                archivedAt: null,
                threadKind: "native",
                source: "mossx",
                provider: "openai",
                sourceLabel: "mossx/openai",
              },
            ],
            nextCursor: null,
            partialSource: null,
          };
        }
        return {
          data: [],
          nextCursor: null,
          partialSource: null,
        };
      },
    );

    const { result, dispatch } = renderActions();

    const refreshPromise = result.current.listThreadsForWorkspace(workspace);
    const onSettled = vi.fn();
    void refreshPromise.then(onSettled);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(onSettled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    await refreshPromise;

    expectSetThreadsDispatched(dispatch, "ws-1", [
      {
        id: "codex-history-slow",
        name: "最近对话你什么时候加进来的.还是显示出来的.之前这里没有才对啊.",
        updatedAt: 1_730_300_000_000,
        engineSource: "codex",
        source: "mossx",
        provider: "openai",
        sourceLabel: "mossx/openai",
      },
    ]);
  });

  it("refreshes gemini sessions on cold start without gemini signal", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listGeminiSessions).mockResolvedValue([
      {
        sessionId: "ses_gemini_1",
        firstMessage: "Gemini Hello",
        updatedAt: 1_730_000_100_000,
      },
    ]);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        includeEngineDiskLists: true,
      });
    });

    await waitFor(() => {
      expect(listGeminiSessions).toHaveBeenCalledWith("/tmp/codex", 50);
      expectSetThreadsDispatched(dispatch, "ws-1", [
        {
          id: "gemini:ses_gemini_1",
          name: "Gemini Hello",
          updatedAt: 1_730_000_100_000,
          engineSource: "gemini",
        },
      ]);
    });
  });

  it("normalizes gemini session summaries with snake_case fields", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listGeminiSessions).mockResolvedValue([
      {
        session_id: "ses_gemini_snake_1",
        first_message: "Gemini Snake",
        updated_at: 1_730_000_200_000,
        file_size_bytes: 2_048,
      },
    ]);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        includeEngineDiskLists: true,
      });
    });

    await waitFor(() => {
      expectSetThreadsDispatched(dispatch, "ws-1", [
        {
          id: "gemini:ses_gemini_snake_1",
          name: "Gemini Snake",
          updatedAt: 1_730_000_200_000,
          sizeBytes: 2_048,
          engineSource: "gemini",
        },
      ]);
    });
  });

  it("tombstones ghost index rows when unified delete cannot resolve workspace ownership", async () => {
    vi.mocked(deleteWorkspaceSessions).mockResolvedValueOnce({
      results: [
        {
          sessionId: "claude:hello-ghost",
          ok: false,
          archivedAt: null,
          error: "session does not belong to target workspace",
          code: "OWNER_WORKSPACE_UNRESOLVED",
          deletedFromDisk: false,
          metadataCleaned: false,
        },
      ],
    });

    const { result } = renderActions();

    await act(async () => {
      await result.current.deleteThreadForWorkspace(
        "ws-1",
        "claude:hello-ghost",
      );
    });

    expect(deleteWorkspaceSessions).toHaveBeenCalledWith("ws-1", [
      "claude:hello-ghost",
    ]);
    expect(tombstoneSessionIndexRows).toHaveBeenCalledWith([
      "claude:hello-ghost",
    ]);
  });

  it("routes opencode delete to the unified backend delete", async () => {
    const { result } = renderActions();

    await act(async () => {
      await result.current.deleteThreadForWorkspace(
        "ws-1",
        "opencode:ses_opc_1",
      );
    });

    expect(deleteOpenCodeSession).not.toHaveBeenCalled();
    expect(deleteWorkspaceSessions).toHaveBeenCalledWith("ws-1", [
      "opencode:ses_opc_1",
    ]);
  });

  it("routes pi delete to the unified backend delete", async () => {
    const { result } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
      });
    });

    await act(async () => {
      await result.current.deleteThreadForWorkspace("ws-1", "pi:ses_pi_1");
    });

    expect(deleteCodexSession).not.toHaveBeenCalled();
    expect(deletePiSession).not.toHaveBeenCalled();
    expect(deleteWorkspaceSessions).toHaveBeenCalledWith("ws-1", [
      "pi:ses_pi_1",
    ]);
  });

  it("routes codex delete to the unified backend delete", async () => {
    const { result } = renderActions();

    await act(async () => {
      await result.current.deleteThreadForWorkspace(
        "ws-1",
        "019d767b-5541-7010-a30d-a454864bccd8",
      );
    });

    expect(deleteCodexSession).not.toHaveBeenCalled();
    expect(deleteWorkspaceSessions).toHaveBeenCalledWith("ws-1", [
      "019d767b-5541-7010-a30d-a454864bccd8",
    ]);
  });

  it("keeps deleted claude sessions absent after reload", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    });
    vi.mocked(getOpenCodeSessionList).mockResolvedValue([]);
    vi.mocked(listClaudeSessions)
      .mockResolvedValueOnce([
        {
          sessionId: "session-delete-me",
          firstMessage: "Delete me",
          updatedAt: 1_730_000_000_000,
        },
      ])
      .mockResolvedValueOnce([]);

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
      });
    });

    await act(async () => {
      await result.current.deleteThreadForWorkspace(
        "ws-1",
        "claude:session-delete-me",
      );
    });

    expect(deleteWorkspaceSessions).toHaveBeenCalledWith("ws-1", [
      "claude:session-delete-me",
    ]);

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
      });
    });

    const setThreadsActions = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === "setThreads");
    expect(setThreadsActions.length).toBeGreaterThanOrEqual(2);
    expect(setThreadsActions[0]).toEqual(
      expect.objectContaining({
        type: "setThreads",
        workspaceId: "ws-1",
        threads: [
          expect.objectContaining({
            id: "claude:session-delete-me",
            name: "Delete me",
            updatedAt: 1_730_000_000_000,
            engineSource: "claude",
          }),
        ],
      }),
    );
    expect(setThreadsActions[setThreadsActions.length - 1]).toEqual({
      type: "setThreads",
      workspaceId: "ws-1",
      threads: [],
      unionMembership: false,
    });
  });

  it("skips claude history reload while turn is processing and local items exist", async () => {
    const { result } = renderActions({
      itemsByThread: {
        "claude:session-1": [
          {
            id: "reasoning-live-1",
            kind: "reasoning",
            summary: "正在分析",
            content: "正在分析",
          },
        ],
      },
      threadStatusById: {
        "claude:session-1": {
          isProcessing: true,
          hasUnread: false,
          isReviewing: false,
          processingStartedAt: Date.now(),
          lastDurationMs: null,
          heartbeatPulse: 1,
        },
      },
    });

    let resumed: string | null = null;
    await act(async () => {
      resumed = await result.current.resumeThreadForWorkspace(
        "ws-1",
        "claude:session-1",
      );
    });

    expect(resumed).toBe("claude:session-1");
    expect(loadClaudeSession).not.toHaveBeenCalled();
    expect(resumeThread).not.toHaveBeenCalled();
  });

  it("maps Claude tool_result to terminal status", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: { data: [], nextCursor: null },
    });
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(loadClaudeSession).mockResolvedValue({
      messages: [
        {
          id: "tool-1",
          kind: "tool",
          toolType: "Read",
          title: "Read",
          text: '{"file_path":"README.md"}',
        },
        {
          id: "tool-1-result",
          kind: "tool",
          toolType: "result",
          title: "Result",
          text: "",
        },
        {
          id: "tool-2",
          kind: "tool",
          toolType: "Bash",
          title: "Bash",
          text: '{"command":"echo ok"}',
        },
        {
          id: "tool-2-result",
          kind: "tool",
          toolType: "error",
          title: "Error",
          text: "permission denied",
        },
      ],
    });

    const { result, dispatch } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
      });
    });

    dispatch.mockClear();

    await act(async () => {
      await result.current.resumeThreadForWorkspace("ws-1", "claude:session-1");
    });

    expect(loadClaudeSession).toHaveBeenCalledWith("/tmp/codex", "session-1", {
      limit: 80,
    });

    const setThreadItemsCall = dispatch.mock.calls.find(
      ([action]) =>
        action.type === "setThreadItems" &&
        action.threadId === "claude:session-1",
    );
    expect(setThreadItemsCall).toBeTruthy();

    const action = setThreadItemsCall?.[0] as
      | { items?: ConversationItem[] }
      | undefined;
    const toolItems = (action?.items ?? []).filter(
      (item): item is Extract<ConversationItem, { kind: "tool" }> =>
        item.kind === "tool",
    );

    expect(toolItems).toHaveLength(2);
    expect(toolItems[0]).toEqual(
      expect.objectContaining({
        id: "tool-1",
        status: "completed",
      }),
    );
    expect(toolItems[1]).toEqual(
      expect.objectContaining({
        id: "tool-2",
        status: "failed",
        output: "permission denied",
      }),
    );
  });

  it("first-paint does not probe DSH host when Session Index has no dsh rows", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as never);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listSessionIndexForWorkspace).mockResolvedValue({
      data: [],
      source: "session-index",
      synced: true,
      engines: ["claude", "codex", "grok"],
      visibility: {
        available: true,
        freshness: "verified",
        hiddenNativeIds: [],
      },
    });
    vi.mocked(listDshSessions).mockResolvedValue([
      {
        sessionId: "session-dsh-history-1",
        firstMessage: "无法查看DSH历史记录",
        updatedAt: 1_786_896_696_172,
      },
    ]);

    const { result } = renderActions();

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        startupHydrationMode: "first-paint",
      });
    });

    expect(listDshSessions).not.toHaveBeenCalled();
    expect(listPiSessions).not.toHaveBeenCalled();
  });

  it("skips Index early-paint when rematerialize merges into the current list", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as never);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listSessionIndexForWorkspace).mockResolvedValue({
      data: [
        {
          engine: "claude",
          sessionId: "session-real-1",
          title: "帮我看一下这段代码",
          updatedAt: 1_730_000_000_000,
        },
      ],
      source: "session-index",
      synced: true,
      engines: ["claude"],
      visibility: {
        available: true,
        freshness: "verified",
        hiddenNativeIds: [],
      },
    });
    const onDebug = vi.fn();
    const { result } = renderActions({ onDebug });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        startupHydrationMode: "first-paint",
        mergeExistingThreads: true,
      });
    });

    expect(onDebug).not.toHaveBeenCalledWith(
      expect.objectContaining({
        label: "thread/list session-index early-paint",
      }),
    );
  });

  it("early-paints Index rows on focus-refresh merge for a cold workspace and skips engine probes", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as never);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listSessionIndexForWorkspace).mockResolvedValue({
      data: [
        {
          engine: "claude",
          sessionId: "session-real-1",
          title: "帮我看一下这段代码",
          updatedAt: 1_730_000_000_000,
        },
      ],
      source: "session-index",
      synced: true,
      engines: ["claude"],
      visibility: {
        available: true,
        freshness: "verified",
        hiddenNativeIds: [],
      },
    });
    const onDebug = vi.fn();
    const { dispatch, result } = renderActions({ onDebug });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        mergeExistingThreads: true,
        recoverySource: "focus-refresh",
        includeOpenCodeSessions: false,
      });
    });

    // A:冷 workspace(本地无行)的 merge 路径也提前画 index 行
    expect(onDebug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: "thread/list session-index early-paint",
      }),
    );
    expectSetThreadsDispatched(dispatch, workspace.id, [
      { id: "claude:session-real-1" },
    ]);
    // B:focus-refresh merge 不 fan-out 重探测(codex 在线分页 / claude 磁盘
    // list / 活动 catalog)
    expect(listThreads).not.toHaveBeenCalled();
    expect(listClaudeSessions).not.toHaveBeenCalled();
    expect(listWorkspaceSessions).not.toHaveBeenCalled();
  });

  it("keeps engine probes on non-focus-refresh merge (explicit reload semantics)", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as never);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    const onDebug = vi.fn();
    const { result } = renderActions({ onDebug });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        mergeExistingThreads: true,
      });
    });

    // 非 focus-refresh 的 merge(如显式 reload)仍走全量探测
    expect(listThreads).toHaveBeenCalled();
  });

  it("focus-refresh merge does not fake engine timeouts or degrade the visible list", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as never);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listSessionIndexForWorkspace).mockResolvedValue({
      data: [
        {
          engine: "claude",
          sessionId: "session-real-1",
          title: "帮我看一下这段代码",
          updatedAt: 1_730_000_000_000,
        },
      ],
      source: "session-index",
      synced: true,
      engines: ["claude"],
      visibility: {
        available: true,
        freshness: "verified",
        hiddenNativeIds: [],
      },
    });
    const onDebug = vi.fn();
    const { dispatch, result } = renderActions({ onDebug });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        mergeExistingThreads: true,
        recoverySource: "focus-refresh",
        includeOpenCodeSessions: false,
      });
    });

    // by-design skip(Promise.resolve(null))不得伪造 30s 超时日志
    const debugLabels = onDebug.mock.calls.map(
      (call) => (call[0] as { label?: string } | undefined)?.label,
    );
    expect(debugLabels).not.toContain("thread/list claude timeout");
    expect(debugLabels).not.toContain("thread/list codex catalog timeout");

    // 可见列表不得被误标 partial-thread-list degraded
    const setThreadsActions = dispatch.mock.calls
      .map((call) => call[0])
      .filter(
        (action: { type?: string; workspaceId?: string } | undefined) =>
          action?.type === "setThreads" && action?.workspaceId === workspace.id,
      );
    expect(setThreadsActions.length).toBeGreaterThan(0);
    const finalThreads = (
      setThreadsActions[setThreadsActions.length - 1] as {
        threads: Array<{
          id: string;
          partialSource?: string;
          degradedReason?: string;
          isDegraded?: boolean;
        }>;
      }
    ).threads;
    // last-good / index 行仍在(seed 兜底不回归)
    expect(finalThreads.map((thread) => thread.id)).toContain(
      "claude:session-real-1",
    );
    for (const thread of finalThreads) {
      expect(thread.partialSource ?? null).not.toBe("claude-session-timeout");
      expect(thread.partialSource ?? null).not.toBe("codex-catalog-timeout");
      expect(thread.degradedReason ?? null).not.toBe("partial-thread-list");
    }
  });

  it("first-paint hydration does not fake engine timeouts or degrade the visible list", async () => {
    vi.mocked(listThreads).mockResolvedValue({
      result: {
        data: [],
        nextCursor: null,
      },
    } as never);
    vi.mocked(listClaudeSessions).mockResolvedValue([]);
    vi.mocked(listSessionIndexForWorkspace).mockResolvedValue({
      data: [
        {
          engine: "claude",
          sessionId: "session-real-1",
          title: "帮我看一下这段代码",
          updatedAt: 1_730_000_000_000,
        },
      ],
      source: "session-index",
      synced: true,
      engines: ["claude"],
      visibility: {
        available: true,
        freshness: "verified",
        hiddenNativeIds: [],
      },
    });
    const onDebug = vi.fn();
    const { dispatch, result } = renderActions({ onDebug });

    await act(async () => {
      await result.current.listThreadsForWorkspace(workspace, {
        preserveState: true,
        mergeExistingThreads: true,
        startupHydrationMode: "first-paint",
        includeOpenCodeSessions: false,
      });
    });

    // first-paint 的 by-design skip(Promise.resolve(null))同样不得伪造
    // 30s 超时日志（与 focus-refresh merge 同构，0.9.3 起冷启动每次触发）
    const debugLabels = onDebug.mock.calls.map(
      (call) => (call[0] as { label?: string } | undefined)?.label,
    );
    expect(debugLabels).not.toContain("thread/list claude timeout");
    expect(debugLabels).not.toContain("thread/list codex catalog timeout");

    const setThreadsActions = dispatch.mock.calls
      .map((call) => call[0])
      .filter(
        (action: { type?: string; workspaceId?: string } | undefined) =>
          action?.type === "setThreads" && action?.workspaceId === workspace.id,
      );
    expect(setThreadsActions.length).toBeGreaterThan(0);
    const finalThreads = (
      setThreadsActions[setThreadsActions.length - 1] as {
        threads: Array<{
          id: string;
          partialSource?: string;
          degradedReason?: string;
        }>;
      }
    ).threads;
    expect(finalThreads.map((thread) => thread.id)).toContain(
      "claude:session-real-1",
    );
    for (const thread of finalThreads) {
      expect(thread.partialSource ?? null).not.toBe("claude-session-timeout");
      expect(thread.partialSource ?? null).not.toBe("codex-catalog-timeout");
      expect(thread.degradedReason ?? null).not.toBe("partial-thread-list");
    }
  });
});
