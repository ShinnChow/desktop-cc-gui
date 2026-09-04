import { describe, expect, it, vi } from "vitest";
import {
  setWebRuntimeFlag,
  setupTauriInvokeWrapperTestState,
} from "./tauriTestSetup";
import { invoke } from "@tauri-apps/api/core";
import {
  connectOpenCodeProvider,
  getOpenCodeProviderHealth,
  getCodeIntelDefinition,
  getCodeIntelImplementations,
  getCodeIntelReferences,
  prepareCodeIntel,
  getOpenCodeLspDefinition,
  getOpenCodeLspReferences,
  getOpenCodeStatusSnapshot,
  detectEngines,
  getActiveEngine,
  getEngineModels,
  getEngineActiveProcessDiagnostics,
  getEngineStatus,
  engineSendMessage,
  engineInterrupt,
  setOpenCodeMcpToggle,
  switchEngine,
  engineSendMessageSync,
  deleteClaudeSession,
  deleteGeminiSession,
  deleteGrokSession,
  deleteKimiSession,
  hydrateClaudeDeferredImage,
} from "./tauri";

describe("tauri invoke wrappers", () => {
  setupTauriInvokeWrapperTestState();

  it("maps opencode provider health params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      provider: "openai",
      connected: true,
      credentialCount: 1,
      matched: true,
    });

    await getOpenCodeProviderHealth("ws-16", "openai");

    expect(invokeMock).toHaveBeenCalledWith("opencode_provider_health", {
      workspaceId: "ws-16",
      provider: "openai",
    });
  });

  it("maps opencode provider connect params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ started: true });

    await connectOpenCodeProvider("ws-17", null);

    expect(invokeMock).toHaveBeenCalledWith("opencode_provider_connect", {
      workspaceId: "ws-17",
      providerId: null,
    });
  });

  it("maps opencode status snapshot params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      providerHealth: {
        provider: "openai",
        connected: true,
        credentialCount: 1,
        matched: true,
      },
      mcpEnabled: true,
      mcpServers: [],
      mcpRaw: "",
      managedToggles: true,
    });

    await getOpenCodeStatusSnapshot({
      workspaceId: "ws-18",
      threadId: "opencode:ses_18",
      model: "openai/gpt-5.3-codex",
      agent: "default",
      variant: "default",
    });

    expect(invokeMock).toHaveBeenCalledWith("opencode_status_snapshot", {
      workspaceId: "ws-18",
      threadId: "opencode:ses_18",
      model: "openai/gpt-5.3-codex",
      agent: "default",
      variant: "default",
    });
  });

  it("maps opencode MCP toggle params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      workspaceId: "ws-19",
      mcpEnabled: true,
      serverStates: {},
      managedToggles: true,
    });

    await setOpenCodeMcpToggle("ws-19", { serverName: "fs", enabled: false });

    expect(invokeMock).toHaveBeenCalledWith("opencode_mcp_toggle", {
      workspaceId: "ws-19",
      serverName: "fs",
      enabled: false,
      globalEnabled: null,
    });
  });

  it("maps opencode lsp definition params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 10,
      character: 4,
      result: [],
    });

    await getOpenCodeLspDefinition("ws-lsp-1", {
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 10,
      character: 4,
    });

    expect(invokeMock).toHaveBeenCalledWith("opencode_lsp_definition", {
      workspaceId: "ws-lsp-1",
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 10,
      character: 4,
    });
  });

  it("maps code intel definition params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "src/Main.java",
      line: 10,
      character: 4,
      result: [],
    });

    const response = await getCodeIntelDefinition("ws-ci-1", {
      filePath: "src/Main.java",
      line: 10,
      character: 4,
    });

    expect(invokeMock).toHaveBeenCalledWith("code_intel_definition", {
      workspaceId: "ws-ci-1",
      filePath: "src/Main.java",
      line: 10,
      character: 4,
    });
    expect(response).toMatchObject({
      mode: "fast-search",
      provider: "heuristic",
      fallbackReasonCode: null,
      result: [],
    });
  });

  it("maps code intel prepare params and lifecycle", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      language: "JavaScript",
      provider: "typescript-language-server",
      lifecycle: "starting",
      fallbackReasonCode: null,
    });

    await expect(prepareCodeIntel("ws-ci-prepare", "src/main.js")).resolves.toEqual({
      language: "JavaScript",
      provider: "typescript-language-server",
      lifecycle: "starting",
      fallbackReasonCode: null,
    });
    expect(invokeMock).toHaveBeenCalledWith("code_intel_prepare", {
      workspaceId: "ws-ci-prepare",
      filePath: "src/main.js",
    });
  });

  it("preserves semantic navigation metadata and rejects unknown reason codes", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "src/Main.ts",
      line: 2,
      character: 3,
      language: "typescript",
      mode: "semantic",
      provider: "typescript-language-server",
      fallbackReasonCode: "not-a-public-reason",
      result: [{ uri: "file:///repo/src/Main.ts", line: 2, character: 3 }],
    });

    await expect(getCodeIntelDefinition("ws-ci-semantic", {
      filePath: "src/Main.ts",
      line: 2,
      character: 3,
    })).resolves.toMatchObject({
      language: "typescript",
      mode: "semantic",
      provider: "typescript-language-server",
      fallbackReasonCode: null,
    });
  });

  it("propagates code intel definition errors", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("code intel unavailable"));

    await expect(
      getCodeIntelDefinition("ws-ci-err-1", {
        filePath: "src/Main.java",
        line: 1,
        character: 1,
      }),
    ).rejects.toThrow("code intel unavailable");
  });

  it("maps code intel implementation params with current document text", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ result: [] });

    await getCodeIntelImplementations("ws-ci-rust", {
      filePath: "src/lib.rs",
      line: 4,
      character: 9,
      documentText: "trait Renderer {}",
    });

    expect(invokeMock).toHaveBeenCalledWith("code_intel_implementations", {
      workspaceId: "ws-ci-rust",
      filePath: "src/lib.rs",
      line: 4,
      character: 9,
      documentText: "trait Renderer {}",
    });
  });

  it("maps code intel references params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: false,
      result: [],
    });

    await getCodeIntelReferences("ws-ci-2", {
      filePath: "src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("code_intel_references", {
      workspaceId: "ws-ci-2",
      filePath: "src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: false,
    });
  });

  it("propagates code intel references errors", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockRejectedValueOnce(new Error("references unavailable"));

    await expect(
      getCodeIntelReferences("ws-ci-err-2", {
        filePath: "src/Main.java",
        line: 2,
        character: 3,
      }),
    ).rejects.toThrow("references unavailable");
  });

  it("maps opencode lsp references params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: true,
      result: [],
    });

    await getOpenCodeLspReferences("ws-lsp-2", {
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("opencode_lsp_references", {
      workspaceId: "ws-lsp-2",
      fileUri: "file:///tmp/ws/src/Main.java",
      line: 11,
      character: 8,
      includeDeclaration: true,
    });
  });

  it("maps sync engine send payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      engine: "codex",
      text: '{"projectType":"legacy"}',
    });

    await engineSendMessageSync("ws-21", {
      text: "Generate project context",
      engine: "codex",
      accessMode: "read-only",
      continueSession: false,
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message_sync", {
      workspaceId: "ws-21",
      text: "Generate project context",
      engine: "codex",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: "read-only",
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      customSpecRoot: null,
      autoSession: null,
      dshAgentPreset: null,
    });
  });

  it("rejects every Gemini execution RPC before invoking the backend", async () => {
    const invokeMock = vi.mocked(invoke);

    await expect(switchEngine("gemini")).rejects.toThrow(
      "Selected CLI engine is disabled by product policy",
    );
    await expect(getEngineModels("gemini")).rejects.toThrow(
      "Selected CLI engine is disabled by product policy",
    );
    await expect(
      engineSendMessage("ws-gemini", {
        text: "must not run",
        engine: "gemini",
      }),
    ).rejects.toThrow("Selected CLI engine is disabled by product policy");
    await expect(
      engineSendMessageSync("ws-gemini", {
        text: "must not run",
        engine: "gemini",
      }),
    ).rejects.toThrow("Selected CLI engine is disabled by product policy");

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("maps sync engine send custom spec root payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      engine: "opencode",
      text: "ok",
    });

    await engineSendMessageSync("ws-22", {
      text: "check spec",
      engine: "opencode",
      customSpecRoot: "/tmp/external-openspec",
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message_sync", {
      workspaceId: "ws-22",
      text: "check spec",
      engine: "opencode",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      customSpecRoot: "/tmp/external-openspec",
      autoSession: null,
      dshAgentPreset: null,
    });
  });

  it("maps automatic session metadata in sync engine send payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      engine: "codex",
      text: "ok",
    });

    await engineSendMessageSync("ws-auto", {
      text: "enhance prompt",
      engine: "codex",
      autoSession: {
        sessionPurpose: "prompt-enhancer",
        visibility: "hidden",
        ownerFeature: "composer",
        autoArchive: true,
        createdBy: "system",
      },
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message_sync", {
      workspaceId: "ws-auto",
      text: "enhance prompt",
      engine: "codex",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      customSpecRoot: null,
      autoSession: {
        sessionPurpose: "prompt-enhancer",
        visibility: "hidden",
        ownerFeature: "composer",
        autoArchive: true,
        createdBy: "system",
      },
      dshAgentPreset: null,
    });
  });

  it("falls back to codex-only engine statuses in web runtime when detect command is unavailable", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock.mockRejectedValueOnce(
      new Error("unknown method: detect_engines"),
    );

    const statuses = await detectEngines();
    const codexStatus = statuses.find((entry) => entry.engineType === "codex");
    const claudeStatus = statuses.find(
      (entry) => entry.engineType === "claude",
    );

    expect(codexStatus?.installed).toBe(true);
    expect(claudeStatus?.installed).toBe(false);
    expect(claudeStatus?.error).toContain("Codex CLI");
  });

  it("returns a friendly error after web runtime fallback state is learned", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock.mockRejectedValueOnce(
      new Error("unknown method: detect_engines"),
    );

    await detectEngines();

    const response = await engineSendMessage("ws-web", {
      text: "hello",
      engine: "claude",
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      error: {
        message:
          "Web 服务当前仅支持 Codex CLI。请切换到 Codex CLI（Web service currently supports Codex CLI only）.",
      },
    });
  });

  it("continues to invoke codex engine send after web runtime fallback state is learned", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock
      .mockRejectedValueOnce(new Error("unknown method: detect_engines"))
      .mockResolvedValueOnce({ engine: "codex", threadId: "codex-thread-1" });

    await detectEngines();

    const response = await engineSendMessage("ws-web", {
      text: "hello codex",
      engine: "codex",
      threadId: "codex-thread-1",
    });

    expect(response).toEqual({ engine: "codex", threadId: "codex-thread-1" });
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("engine_send_message", {
      workspaceId: "ws-web",
      text: "hello codex",
      engine: "codex",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      threadId: "codex-thread-1",
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      providerProfileId: null,
      customSpecRoot: null,
      autoSession: null,
      skillInvocations: null,
      dshAgentPreset: null,
    });
  });

  it("preserves Claude reasoning effort in engine_send_message payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      engine: "claude",
      threadId: "claude:session-1",
    });

    await engineSendMessage("ws-claude", {
      text: "think harder",
      engine: "claude",
      model: "Cxn[1m]",
      effort: "high",
      threadId: "claude:session-1",
      providerProfileId: "claude-provider-a",
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message", {
      workspaceId: "ws-claude",
      text: "think harder",
      engine: "claude",
      model: "Cxn[1m]",
      effort: "high",
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      threadId: "claude:session-1",
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      providerProfileId: "claude-provider-a",
      customSpecRoot: null,
      autoSession: null,
      skillInvocations: null,
      dshAgentPreset: null,
    });
  });

  it("preserves Claude fork session id in engine_send_message payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ engine: "claude" });

    await engineSendMessage("ws-claude", {
      text: "start from here",
      engine: "claude",
      threadId: "claude-fork:parent-session-1:local-1",
      forkSessionId: "parent-session-1",
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message", {
      workspaceId: "ws-claude",
      text: "start from here",
      engine: "claude",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      threadId: "claude-fork:parent-session-1:local-1",
      sessionId: null,
      forkSessionId: "parent-session-1",
      agent: null,
      variant: null,
      providerProfileId: null,
      customSpecRoot: null,
      autoSession: null,
      skillInvocations: null,
      dshAgentPreset: null,
    });
  });

  it("passes structured skill invocations through engine_send_message payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ engine: "claude" });

    await engineSendMessage("ws-claude", {
      text: "/Code-Review 请审查这段代码",
      engine: "claude",
      skillInvocations: [{ name: "Code-Review" }],
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_send_message", {
      workspaceId: "ws-claude",
      text: "/Code-Review 请审查这段代码",
      engine: "claude",
      model: null,
      effort: null,
      disableThinking: false,
      images: null,
      continueSession: false,
      accessMode: null,
      threadId: null,
      sessionId: null,
      forkSessionId: null,
      agent: null,
      variant: null,
      providerProfileId: null,
      customSpecRoot: null,
      autoSession: null,
      skillInvocations: [{ name: "Code-Review" }],
      dshAgentPreset: null,
    });
  });

  it("blocks non-codex engine switch after web runtime fallback state is learned", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock.mockRejectedValueOnce(
      new Error("unknown method: detect_engines"),
    );

    await detectEngines();

    await expect(switchEngine("claude")).rejects.toThrow(
      "Web 服务当前仅支持 Codex CLI。请切换到 Codex CLI（Web service currently supports Codex CLI only）.",
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty models for non-codex engine after web runtime fallback state is learned", async () => {
    const invokeMock = vi.mocked(invoke);
    setWebRuntimeFlag(true);
    invokeMock.mockRejectedValueOnce(
      new Error("unknown method: detect_engines"),
    );

    await detectEngines();

    await expect(getEngineModels("claude")).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("invokes get_active_engine", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("claude");

    const engine = await getActiveEngine();

    expect(engine).toBe("claude");
    expect(invokeMock).toHaveBeenCalledWith("get_active_engine");
  });

  it("maps switch_engine params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await switchEngine("claude");

    expect(invokeMock).toHaveBeenCalledWith("switch_engine", {
      engineType: "claude",
    });
  });

  it("maps get_engine_status params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(null);

    const status = await getEngineStatus("claude");

    expect(status).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("get_engine_status", {
      engineType: "claude",
    });
  });

  it("invokes get_engine_active_process_diagnostics", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      measured: true,
      sampledAtMs: 1_765_647_000_000,
      totalActiveProcessCount: 2,
      workspaces: [
        {
          workspaceId: "ws-1",
          engine: "claude",
          activeProcessIds: [101, 102],
          registeredActiveProcesses: [
            { pid: 101, registeredAgeMs: 0 },
            { pid: 102, registeredAgeMs: 0 },
          ],
        },
      ],
      unsupportedReason: null,
      osChildLiveness: {
        evidenceClass: "unsupported",
        sampledAfterCloseMs: 0,
        sampledOsChildCount: null,
        sampler: null,
        rationale:
          "Runtime does not ship a cross-platform OS child process sampler.",
      },
      staleChildCandidates: [],
    });

    const diagnostics = await getEngineActiveProcessDiagnostics();

    expect(diagnostics.totalActiveProcessCount).toBe(2);
    expect(diagnostics.workspaces[0]?.activeProcessIds).toEqual([101, 102]);
    expect(diagnostics.workspaces[0]?.registeredActiveProcesses).toEqual([
      { pid: 101, registeredAgeMs: 0 },
      { pid: 102, registeredAgeMs: 0 },
    ]);
    expect(diagnostics.osChildLiveness.evidenceClass).toBe("unsupported");
    expect(diagnostics.staleChildCandidates).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith(
      "get_engine_active_process_diagnostics",
    );
  });

  it("maps get_engine_models params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([
      {
        id: "claude-sonnet-option",
        model: "sonnet",
        displayName: "Sonnet",
        description: "Discovered",
        source: "cli-discovered",
        isDefault: true,
      },
    ]);

    const models = await getEngineModels("claude");

    expect(models).toEqual([
      {
        id: "claude-sonnet-option",
        model: "sonnet",
        displayName: "Sonnet",
        description: "Discovered",
        source: "cli-discovered",
        isDefault: true,
      },
    ]);
    expect(invokeMock).toHaveBeenCalledWith("get_engine_models", {
      engineType: "claude",
    });
  });

  it("maps get_engine_models force refresh params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    const models = await getEngineModels("claude", { forceRefresh: true });

    expect(models).toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("get_engine_models", {
      engineType: "claude",
      forceRefresh: true,
    });
  });

  it("maps get_engine_models provider scope without leaking blank ids", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue([]);

    await getEngineModels("kimi", {
      providerProfileId: "  provider-k3  ",
      forceRefresh: true,
    });
    expect(invokeMock).toHaveBeenLastCalledWith("get_engine_models", {
      engineType: "kimi",
      providerProfileId: "provider-k3",
      forceRefresh: true,
    });

    await getEngineModels("kimi", { providerProfileId: "   " });
    expect(invokeMock).toHaveBeenLastCalledWith("get_engine_models", {
      engineType: "kimi",
    });
  });

  it("maps engine_interrupt params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await engineInterrupt("ws-interrupt");

    expect(invokeMock).toHaveBeenCalledWith("engine_interrupt", {
      workspaceId: "ws-interrupt",
    });
  });

  it("maps delete_claude_session params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteClaudeSession("/tmp/workspace", "claude-session-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_claude_session", {
      workspacePath: "/tmp/workspace",
      sessionId: "claude-session-1",
    });
  });

  it("maps delete_gemini_session params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteGeminiSession("/tmp/workspace", "gemini-session-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_gemini_session", {
      workspacePath: "/tmp/workspace",
      sessionId: "gemini-session-1",
    });
  });

  it("maps delete_kimi_session params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteKimiSession("/tmp/workspace", "kimi-session-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_kimi_session", {
      workspacePath: "/tmp/workspace",
      sessionId: "kimi-session-1",
    });
  });

  it("maps delete_grok_session params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await deleteGrokSession("/tmp/workspace", "grok-session-1");

    expect(invokeMock).toHaveBeenCalledWith("delete_grok_session", {
      workspacePath: "/tmp/workspace",
      sessionId: "grok-session-1",
    });
  });

  it("maps hydrate_claude_deferred_image params", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      src: "data:image/png;base64,AAAA",
      mediaType: "image/png",
      byteSize: 3,
      locator: {
        sessionId: "claude-session-1",
        lineIndex: 4,
        blockIndex: 1,
        mediaType: "image/png",
      },
    });

    const locator = {
      sessionId: "claude-session-1",
      lineIndex: 4,
      blockIndex: 1,
      mediaType: "image/png",
    };
    const result = await hydrateClaudeDeferredImage("/tmp/workspace", locator);

    expect(result.src).toBe("data:image/png;base64,AAAA");
    expect(invokeMock).toHaveBeenCalledWith("hydrate_claude_deferred_image", {
      workspacePath: "/tmp/workspace",
      locator,
    });
  });
});
