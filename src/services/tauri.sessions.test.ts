import { describe, expect, it, vi } from "vitest";
import {
  rendererDiagnosticsMocks,
  setupTauriInvokeWrapperTestState,
} from "./tauriTestSetup";
import { invoke } from "@tauri-apps/api/core";
import {
  forkClaudeSession,
  forkClaudeSessionFromMessage,
  forkDshSession,
  forkThread,
  rewindCodexThread,
  generateThreadTitle,
  listThreadTitles,
  listMcpServerStatus,
  listGlobalMcpServers,
  setGlobalMcpServerEnabled,
  prewarmCodexDiskRuntime,
  renameThreadTitleKey,
  setThreadTitle,
  respondToServerRequest,
  respondToUserInputRequest,
  sendUserMessage,
  startThread,
  startReview,
  getWorkspaceSessionProjectionSummary,
  listGlobalCodexSessions,
  listProjectRelatedCodexSessions,
  listProjectRelatedSessions,
  listWorkspaceSessions,
  listWorkspaceSessionArchiveEvidence,
  listWorkspaceSessionFolders,
  createWorkspaceSessionFolder,
  renameWorkspaceSessionFolder,
  moveWorkspaceSessionFolder,
  deleteWorkspaceSessionFolder,
  assignWorkspaceSessionFolder,
  assignWorkspaceSessionFolders,
  recordAutoSessionMetadata,
  archiveWorkspaceSessionsV2,
  unarchiveWorkspaceSessionsV2,
  deleteWorkspaceSessions,
} from "./tauri";

describe("tauri invoke wrappers", () => {
  setupTauriInvokeWrapperTestState();

  it("maps workspace session list options to list_workspace_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:20",
      partialSource: null,
    });

    await listWorkspaceSessions("ws-2", {
      query: { keyword: "bugfix", engine: "codex", status: "archived" },
      cursor: "offset:0",
      limit: 20,
    });

    expect(invokeMock).toHaveBeenCalledWith("list_workspace_sessions", {
      workspaceId: "ws-2",
      query: { keyword: "bugfix", engine: "codex", status: "archived" },
      cursor: "offset:0",
      limit: 20,
    });
  });

  it("preserves workspace session catalog source and ownership fields", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [
        {
          sessionId: "claude:session-1",
          stableSessionKey: "claude:child-ws:session-1",
          canonicalSessionId: "session-1",
          workspaceId: "child-ws",
          engine: "claude",
          title: "Investigate ownership",
          updatedAt: 123,
          threadKind: "native",
          sourceCompleteness: "complete",
          sourceStatusReason: null,
          attributionStatus: "strict-match",
          attributionReason: "cwd-longest",
          attributionConfidence: "high",
          matchedWorkspaceId: "child-ws",
          matchedWorkspaceLabel: "Child",
        },
      ],
      nextCursor: null,
      partialSource: null,
      sourceStatuses: [
        {
          engine: "claude",
          completeness: "complete",
          reason: null,
          scannedCandidates: 1,
          skippedCandidates: 0,
          scanCapReached: false,
          diagnostics: [
            {
              engine: "claude",
              code: "cwd-project-conflict",
              reason: "cwd-project-conflict",
              sessionId: "claude:conflict",
              physicalLocator: "conflict.jsonl:0123456789abcdef",
            },
          ],
          cache: {
            hits: 1,
            misses: 2,
            stale: 0,
            rebuilds: 2,
            failures: 0,
          },
        },
      ],
    });

    const page = await listWorkspaceSessions("parent-ws", {
      query: { status: "active" },
      limit: 50,
    });

    expect(page.data[0]).toMatchObject({
      sessionId: "claude:session-1",
      stableSessionKey: "claude:child-ws:session-1",
      sourceCompleteness: "complete",
      attributionReason: "cwd-longest",
      attributionConfidence: "high",
      matchedWorkspaceId: "child-ws",
    });
    expect(page.sourceStatuses?.[0]).toMatchObject({
      engine: "claude",
      completeness: "complete",
      scannedCandidates: 1,
      scanCapReached: false,
      diagnostics: [
        {
          code: "cwd-project-conflict",
          physicalLocator: "conflict.jsonl:0123456789abcdef",
        },
      ],
      cache: {
        hits: 1,
        rebuilds: 2,
      },
    });
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_sessions", {
      workspaceId: "parent-ws",
      query: { status: "active" },
      cursor: null,
      limit: 50,
    });
  });

  it("maps global codex session list options to list_global_codex_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:10",
      partialSource: null,
    });

    await listGlobalCodexSessions({
      query: { keyword: "archive", engine: "codex", status: "all" },
      cursor: "offset:0",
      limit: 10,
    });

    expect(invokeMock).toHaveBeenCalledWith("list_global_codex_sessions", {
      query: { keyword: "archive", engine: "codex", status: "all" },
      cursor: "offset:0",
      limit: 10,
    });
  });

  it("maps related codex session list options to list_project_related_codex_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:5",
      partialSource: null,
    });

    await listProjectRelatedCodexSessions("ws-2", {
      query: { keyword: "feature", engine: "codex", status: "active" },
      cursor: "offset:0",
      limit: 5,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "list_project_related_codex_sessions",
      {
        workspaceId: "ws-2",
        query: { keyword: "feature", engine: "codex", status: "active" },
        cursor: "offset:0",
        limit: 5,
      },
    );
  });

  it("maps engine-neutral related session list options to list_project_related_sessions", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      data: [],
      nextCursor: "offset:5",
      partialSource: null,
    });

    await listProjectRelatedSessions("ws-2", {
      query: { keyword: "feature", engine: "claude", status: "active" },
      cursor: "offset:0",
      limit: 5,
    });

    expect(invokeMock).toHaveBeenCalledWith("list_project_related_sessions", {
      workspaceId: "ws-2",
      query: { keyword: "feature", engine: "claude", status: "active" },
      cursor: "offset:0",
      limit: 5,
    });
  });

  it("maps workspace session archive evidence requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      archivedAtBySessionId: {
        "claude:session-1": 123,
      },
      partialSource: null,
      sourceStatuses: [
        {
          engine: "archive-metadata",
          completeness: "complete",
          scannedCandidates: 1,
        },
      ],
    });

    const evidence = await listWorkspaceSessionArchiveEvidence("ws-2");

    expect(evidence.archivedAtBySessionId["claude:session-1"]).toBe(123);
    expect(invokeMock).toHaveBeenCalledWith(
      "list_workspace_session_archive_evidence",
      {
        workspaceId: "ws-2",
      },
    );
  });

  it("maps workspace projection summary requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      scopeKind: "project",
      ownerWorkspaceIds: ["ws-2", "ws-3"],
      activeTotal: 8,
      archivedTotal: 2,
      allTotal: 10,
      filteredTotal: 8,
      partialSources: [],
    });

    await getWorkspaceSessionProjectionSummary("ws-2", {
      query: { keyword: "feature", engine: "codex", status: "active" },
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "get_workspace_session_projection_summary",
      {
        workspaceId: "ws-2",
        query: { keyword: "feature", engine: "codex", status: "active" },
      },
    );
  });

  it("maps workspace session batch mutations", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({
      results: [
        {
          sessionId: "opencode:1",
          ok: true,
          code: "ALREADY_MISSING_CLEANED",
          deletedFromDisk: false,
          metadataCleaned: true,
        },
      ],
    });

    await archiveWorkspaceSessionsV2("ws-2", [
      { threadId: "claude:1" },
      { threadId: "codex-1" },
    ]);
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "archive_workspace_sessions_v2",
      {
        request: {
          workspaceId: "ws-2",
          targets: [{ threadId: "claude:1" }, { threadId: "codex-1" }],
        },
      },
    );

    await unarchiveWorkspaceSessionsV2("ws-2", [{ threadId: "claude:1" }]);
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "unarchive_workspace_sessions_v2",
      {
        request: {
          workspaceId: "ws-2",
          targets: [{ threadId: "claude:1" }],
        },
      },
    );

    const deleteResult = await deleteWorkspaceSessions("ws-2", ["opencode:1"]);
    expect(invokeMock).toHaveBeenNthCalledWith(3, "delete_workspace_sessions", {
      workspaceId: "ws-2",
      sessionIds: ["opencode:1"],
    });
    expect(deleteResult.results[0]).toMatchObject({
      code: "ALREADY_MISSING_CLEANED",
      deletedFromDisk: false,
      metadataCleaned: true,
    });
  });

  it("maps workspace session folder commands", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({});

    await listWorkspaceSessionFolders("ws-2");
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "list_workspace_session_folders",
      {
        workspaceId: "ws-2",
      },
    );

    await createWorkspaceSessionFolder("ws-2", "Bugs", "parent-1");
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "create_workspace_session_folder",
      {
        workspaceId: "ws-2",
        name: "Bugs",
        parentId: "parent-1",
      },
    );

    await renameWorkspaceSessionFolder("ws-2", "folder-1", "Fixes");
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      "rename_workspace_session_folder",
      {
        workspaceId: "ws-2",
        folderId: "folder-1",
        name: "Fixes",
      },
    );

    await moveWorkspaceSessionFolder("ws-2", "folder-1", null);
    expect(invokeMock).toHaveBeenNthCalledWith(
      4,
      "move_workspace_session_folder",
      {
        workspaceId: "ws-2",
        folderId: "folder-1",
        parentId: null,
      },
    );

    await deleteWorkspaceSessionFolder("ws-2", "folder-1");
    expect(invokeMock).toHaveBeenNthCalledWith(
      5,
      "delete_workspace_session_folder",
      {
        workspaceId: "ws-2",
        folderId: "folder-1",
      },
    );

    await assignWorkspaceSessionFolder("ws-2", "claude:1", "folder-1");
    expect(invokeMock).toHaveBeenNthCalledWith(
      6,
      "assign_workspace_session_folder",
      {
        workspaceId: "ws-2",
        sessionId: "claude:1",
        folderId: "folder-1",
      },
    );

    await assignWorkspaceSessionFolders("ws-2", ["claude:1", "codex-2"], null);
    expect(invokeMock).toHaveBeenNthCalledWith(
      7,
      "assign_workspace_session_folders",
      {
        workspaceId: "ws-2",
        sessionIds: ["claude:1", "codex-2"],
        folderId: null,
      },
    );

    await recordAutoSessionMetadata("ws-2", "codex:auto-1", {
      sessionPurpose: "prompt-enhancer",
      visibility: "hidden",
      ownerFeature: "composer",
      autoArchive: true,
      createdBy: "system",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(
      8,
      "record_auto_session_metadata",
      {
        workspaceId: "ws-2",
        sessionId: "codex:auto-1",
        metadata: {
          sessionPurpose: "prompt-enhancer",
          visibility: "hidden",
          ownerFeature: "composer",
          autoArchive: true,
          createdBy: "system",
        },
      },
    );
  });

  it("maps workspaceId and threadId for fork_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkThread("ws-9", "thread-9");

    expect(invokeMock).toHaveBeenCalledWith("fork_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: null,
      providerProfileId: null,
      targetUserTurnIndex: null,
      targetUserMessageText: null,
      targetUserMessageOccurrence: null,
      localUserMessageCount: null,
    });
  });

  it("maps providerProfileId for start_thread and fork_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({});

    await startThread("ws-9", { providerProfileId: "provider-a" });
    await forkThread("ws-9", "thread-9", null, {
      providerProfileId: "provider-b",
    });

    expect(invokeMock).toHaveBeenNthCalledWith(1, "start_thread", {
      workspaceId: "ws-9",
      autoSession: null,
      providerProfileId: "provider-a",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "fork_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: null,
      providerProfileId: "provider-b",
      targetUserTurnIndex: null,
      targetUserMessageText: null,
      targetUserMessageOccurrence: null,
      localUserMessageCount: null,
    });
  });

  it("maps disk Codex runtime prewarm command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await prewarmCodexDiskRuntime("ws-9");

    expect(invokeMock).toHaveBeenCalledWith("prewarm_codex_disk_runtime", {
      workspaceId: "ws-9",
    });
  });

  it("maps codex rewind params to rewind_codex_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await rewindCodexThread("ws-9", "thread-9", 2, "user-2", {
      targetUserMessageText: "1+1",
      targetUserMessageOccurrence: 1,
      localUserMessageCount: 3,
    });

    expect(invokeMock).toHaveBeenCalledWith("rewind_codex_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "user-2",
      targetUserTurnIndex: 2,
      targetUserMessageText: "1+1",
      targetUserMessageOccurrence: 1,
      localUserMessageCount: 3,
    });
  });

  it("normalizes codex rewind index/messageId payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await rewindCodexThread("ws-9", "thread-9", 2.8, "  user-2  ", {
      targetUserMessageText: " 1+1 ",
      targetUserMessageOccurrence: Number.POSITIVE_INFINITY,
      localUserMessageCount: Number.POSITIVE_INFINITY,
    });

    expect(invokeMock).toHaveBeenCalledWith("rewind_codex_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "user-2",
      targetUserTurnIndex: 2,
      targetUserMessageText: "1+1",
    });
  });

  it("rejects codex rewind when targetUserTurnIndex is invalid", async () => {
    const invokeMock = vi.mocked(invoke);

    await expect(
      rewindCodexThread("ws-9", "thread-9", 0, "user-2"),
    ).rejects.toThrow("targetUserTurnIndex must be >= 1 for codex rewind");
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("maps optional messageId for fork_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkThread("ws-9", "thread-9", "msg-9");

    expect(invokeMock).toHaveBeenCalledWith("fork_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "msg-9",
      providerProfileId: null,
      targetUserTurnIndex: null,
      targetUserMessageText: null,
      targetUserMessageOccurrence: null,
      localUserMessageCount: null,
    });
  });

  it("maps codex provider fork anchor hints for fork_thread", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkThread("ws-9", "thread-9", "msg-9", {
      providerProfileId: "provider-b",
      targetUserTurnIndex: 2.8,
      targetUserMessageText: " 继续这里 ",
      targetUserMessageOccurrence: 1,
      localUserMessageCount: 3,
    });

    expect(invokeMock).toHaveBeenCalledWith("fork_thread", {
      workspaceId: "ws-9",
      threadId: "thread-9",
      messageId: "msg-9",
      providerProfileId: "provider-b",
      targetUserTurnIndex: 2,
      targetUserMessageText: "继续这里",
      targetUserMessageOccurrence: 1,
      localUserMessageCount: 3,
    });
  });

  it("maps workspacePath and sessionId for fork_claude_session", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkClaudeSession("/tmp/project", "claude-session-1");

    expect(invokeMock).toHaveBeenCalledWith("fork_claude_session", {
      workspacePath: "/tmp/project",
      sessionId: "claude-session-1",
    });
  });

  it("maps workspacePath and sessionId for fork_dsh_session", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkDshSession("/tmp/project", "session-dsh-1");

    expect(invokeMock).toHaveBeenCalledWith("fork_dsh_session", {
      workspacePath: "/tmp/project",
      sessionId: "session-dsh-1",
    });
  });

  it("maps workspacePath/sessionId/messageId for fork_claude_session_from_message", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await forkClaudeSessionFromMessage(
      "/tmp/project",
      "claude-session-1",
      "550e8400-e29b-41d4-a716-446655440000",
    );

    expect(invokeMock).toHaveBeenCalledWith(
      "fork_claude_session_from_message",
      {
        workspacePath: "/tmp/project",
        sessionId: "claude-session-1",
        messageId: "550e8400-e29b-41d4-a716-446655440000",
      },
    );
  });

  it("maps workspaceId/cursor/limit for list_mcp_server_status", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await listMcpServerStatus("ws-10", "cursor-1", 25);

    expect(invokeMock).toHaveBeenCalledWith("list_mcp_server_status", {
      workspaceId: "ws-10",
      cursor: "cursor-1",
      limit: 25,
    });
  });

  it("invokes list_global_mcp_servers", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    await listGlobalMcpServers();

    expect(invokeMock).toHaveBeenCalledWith("list_global_mcp_servers");
  });

  it("invokes set_global_mcp_server_enabled", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await setGlobalMcpServerEnabled("github", "ccgui_config", false);

    expect(invokeMock).toHaveBeenCalledWith("set_global_mcp_server_enabled", {
      name: "github",
      source: "ccgui_config",
      enabled: false,
    });
  });

  it("fills sendUserMessage defaults in payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await sendUserMessage("ws-4", "thread-1", "hello", {
      accessMode: "full-access",
      images: ["image.png"],
    });

    expect(invokeMock).toHaveBeenCalledWith("send_user_message", {
      workspaceId: "ws-4",
      threadId: "thread-1",
      text: "hello",
      model: null,
      effort: null,
      disableThinking: false,
      accessMode: "full-access",
      images: ["image.png"],
      preferredLanguage: null,
      resumeSource: null,
      resumeTurnId: null,
    });
  });

  it("forwards read-only access mode for claude plan flows", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await sendUserMessage("ws-4", "thread-1", "plan first", {
      accessMode: "read-only",
    });

    expect(invokeMock).toHaveBeenCalledWith("send_user_message", {
      workspaceId: "ws-4",
      threadId: "thread-1",
      text: "plan first",
      model: null,
      effort: null,
      disableThinking: false,
      accessMode: "read-only",
      images: null,
      preferredLanguage: null,
      resumeSource: null,
      resumeTurnId: null,
    });
  });

  it("forwards customSpecRoot in sendUserMessage payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await sendUserMessage("ws-4", "thread-1", "hello", {
      customSpecRoot: "/tmp/external-openspec",
    });

    expect(invokeMock).toHaveBeenCalledWith("send_user_message", {
      workspaceId: "ws-4",
      threadId: "thread-1",
      text: "hello",
      model: null,
      effort: null,
      disableThinking: false,
      accessMode: null,
      images: null,
      preferredLanguage: null,
      resumeSource: null,
      resumeTurnId: null,
      customSpecRoot: "/tmp/external-openspec",
    });
  });

  it("records content-safe Codex turn-start ack latency on send success", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ turnId: "turn-1" });
    const dateNowSpy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_125);

    try {
      await sendUserMessage("ws-4", "thread-1", "secret prompt", {
        model: "MiniMax-M3",
      });

      expect(rendererDiagnosticsMocks.appendRendererDiagnostic).toHaveBeenCalledWith(
        "stream-latency/codex-turn-start-ack",
        expect.objectContaining({
          workspaceId: "ws-4",
          threadId: "thread-1",
          model: "MiniMax-M3",
          requestStartedAtMs: 1_000,
          respondedAtMs: 1_125,
          durationMs: 125,
          outcome: "ok",
        }),
      );
      expect(JSON.stringify(rendererDiagnosticsMocks.appendRendererDiagnostic.mock.calls)).not.toContain(
        "secret prompt",
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("keeps send success when Codex turn-start ack diagnostic persistence fails", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ turnId: "turn-1" });
    rendererDiagnosticsMocks.appendRendererDiagnostic.mockImplementationOnce(() => {
      throw new Error("diagnostic persistence failed");
    });
    const dateNowSpy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(3_010);

    try {
      await expect(sendUserMessage("ws-4", "thread-1", "hello")).resolves.toEqual({
        turnId: "turn-1",
      });
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("records Codex turn-start ack latency on send error without swallowing the error", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("boom"));
    const dateNowSpy = vi.spyOn(Date, "now")
      .mockReturnValueOnce(2_000)
      .mockReturnValueOnce(2_250);

    try {
      await expect(sendUserMessage("ws-4", "thread-1", "hidden prompt")).rejects.toThrow("boom");

      expect(rendererDiagnosticsMocks.appendRendererDiagnostic).toHaveBeenCalledWith(
        "stream-latency/codex-turn-start-ack",
        expect.objectContaining({
          workspaceId: "ws-4",
          threadId: "thread-1",
          durationMs: 250,
          outcome: "error",
          errorName: "Error",
        }),
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("omits delivery when starting reviews without override", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await startReview("ws-5", "thread-2", { type: "uncommittedChanges" });

    expect(invokeMock).toHaveBeenCalledWith("start_review", {
      workspaceId: "ws-5",
      threadId: "thread-2",
      target: { type: "uncommittedChanges" },
    });
  });

  it("nests decisions for server request responses", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await respondToServerRequest("ws-6", 101, "accept");

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-6",
      requestId: 101,
      result: { decision: "accept" },
      providerProfileId: null,
    });
  });

  it("routes Shared approvals with the exact Runtime owner", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});
    const owner = {
      attemptId: "attempt-approval",
      providerRuntimeKey: "codex::ws-6::provider-a",
      sharedThreadId: "shared:thread-a",
      nativeThreadId: "codex-native-a",
      runtimeTurnId: "runtime-turn-a",
      engine: "codex" as const,
      providerProfileId: "provider-a",
    };

    await respondToServerRequest("ws-6", 102, "accept", owner);

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-6",
      requestId: 102,
      result: { decision: "accept" },
      providerProfileId: "provider-a",
      threadId: "codex-native-a",
      turnId: "runtime-turn-a",
      sharedAttemptId: "attempt-approval",
      sharedThreadId: "shared:thread-a",
      providerRuntimeKey: "codex::ws-6::provider-a",
    });
  });

  it("nests answers for user input responses", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await respondToUserInputRequest("ws-7", 202, {
      confirm_path: { answers: ["Yes"] },
    });

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-7",
      requestId: 202,
      result: {
        answers: {
          confirm_path: { answers: ["Yes"] },
        },
      },
      threadId: null,
      turnId: null,
    });
  });

  it("routes Shared user input with the exact Runtime owner", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});
    const owner = {
      attemptId: "attempt-input",
      providerRuntimeKey: "claude::ws-7::provider-b",
      sharedThreadId: "shared:thread-b",
      nativeThreadId: "claude-native-b",
      runtimeTurnId: "runtime-turn-b",
      engine: "claude" as const,
      providerProfileId: "provider-b",
    };

    await respondToUserInputRequest(
      "ws-7",
      203,
      { confirm_path: { answers: ["Yes"] } },
      {
        threadId: "poisoned-thread",
        turnId: "poisoned-turn",
        sharedOwner: owner,
      },
    );

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-7",
      requestId: 203,
      result: {
        answers: {
          confirm_path: { answers: ["Yes"] },
        },
      },
      threadId: "claude-native-b",
      turnId: "runtime-turn-b",
      providerProfileId: "provider-b",
      sharedAttemptId: "attempt-input",
      sharedThreadId: "shared:thread-b",
      providerRuntimeKey: "claude::ws-7::provider-b",
    });
  });

  it("passes through multiple user input answers", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    const answers = {
      confirm_path: { answers: ["Yes"] },
      notes: { answers: ["First line", "Second line"] },
    };

    await respondToUserInputRequest("ws-8", 303, answers);

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-8",
      requestId: 303,
      result: {
        answers,
      },
      threadId: null,
      turnId: null,
    });
  });

  it("passes skipped question ids with user input responses", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await respondToUserInputRequest(
      "ws-9",
      404,
      {
        first: { answers: ["Docs"] },
        second: { answers: [] },
      },
      { skippedQuestionIds: ["second"] },
    );

    expect(invokeMock).toHaveBeenCalledWith("respond_to_server_request", {
      workspaceId: "ws-9",
      requestId: 404,
      result: {
        answers: {
          first: { answers: ["Docs"] },
          second: { answers: [] },
        },
        skippedQuestionIds: ["second"],
      },
      threadId: null,
      turnId: null,
    });
  });

  it("lists thread titles for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ "thread-1": "Fix login flow" });

    await listThreadTitles("ws-12");

    expect(invokeMock).toHaveBeenCalledWith("list_thread_titles", {
      workspaceId: "ws-12",
    });
  });

  it("sets a thread title mapping", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("Fix login flow");

    await setThreadTitle("ws-13", "thread-13", "Fix login flow");

    expect(invokeMock).toHaveBeenCalledWith("set_thread_title", {
      workspaceId: "ws-13",
      threadId: "thread-13",
      title: "Fix login flow",
    });
  });

  it("generates a thread title with codex backend", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("Fix login flow");

    await generateThreadTitle(
      "ws-14",
      "thread-14",
      "Please fix login redirect loop",
      "zh",
    );

    expect(invokeMock).toHaveBeenCalledWith("generate_thread_title", {
      workspaceId: "ws-14",
      threadId: "thread-14",
      userMessage: "Please fix login redirect loop",
      preferredLanguage: "zh",
    });
  });

  it("renames a thread title key", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await renameThreadTitleKey("ws-15", "claude-pending-1", "claude:session-1");

    expect(invokeMock).toHaveBeenCalledWith("rename_thread_title_key", {
      workspaceId: "ws-15",
      oldThreadId: "claude-pending-1",
      newThreadId: "claude:session-1",
    });
  });

});
