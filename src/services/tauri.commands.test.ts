import { describe, expect, it, vi } from "vitest";
import {
  authorizationContinuity,
  setupTauriInvokeWrapperTestState,
} from "./tauriTestSetup";
import { invoke } from "@tauri-apps/api/core";
import {
  addWorkspace,
  getGitDiffs,
  getOpenAppIcon,
  getModelList,
  discoverCodexModels,
  getPromptsList,
  getWorkspaceFiles,
  listThreadTitles,
  listThreads,
  readGlobalAgentsMd,
  readGlobalCodexAuthJson,
  readGlobalCodexConfigToml,
  runWorkspaceCommand,
  runSpecCommand,
  listWorkspaces,
  reloadCodexRuntimeConfig,
  openWorkspaceIn,
  openNewWindow,
  readAgentMd,
  readClaudeMd,
  setCodexUnifiedExecOfficialOverride,
  writeGlobalAgentsMd,
  writeGlobalCodexAuthJson,
  writeGlobalCodexConfigToml,
  writeAgentMd,
  writeClaudeMd,
  exportRewindFiles,
  getComputerUseBridgeStatus,
  getSkillsList,
  runComputerUseActivationProbe,
  runComputerUseCodexBroker,
  runComputerUseHostContractDiagnostics,
  listExternalSpecTree,
  previewCodexLaunchProfile,
  runCodexDoctor,
  runClaudeDoctor,
  getCliInstallPlan,
  getCliVersionStatus,
  runCliInstaller,
  readExternalSpecFile,
  readExternalAbsoluteFile,
  readEngineTaskOutputArtifact,
  resolveFilePreviewHandle,
  writeExternalSpecFile,
  writeExternalAbsoluteFile,
  sendConversationCompletionEmail,
  appendClientErrorLog,
  exportDiagnosticsBundle,
  setMainWindowOpacity,
  fetchClaudeProviderModels,
  readClaudeSettingsJson,
  reorderClaudeProviders,
  saveClaudeSettingsJson,
  getWebAssetsStatus,
  installWebAssets,
  installWebAssetsFromFile,
} from "./tauri";
import { getStartupTraceSnapshot } from "../features/startup-orchestration/utils/startupTrace";

describe("tauri invoke wrappers", () => {
  setupTauriInvokeWrapperTestState();

  it("maps Web assets status and install commands without payload drift", async () => {
    const invokeMock = vi.mocked(invoke);
    const readyStatus = {
      state: "ready" as const,
      installedVersion: "0.7.2",
      requiredVersion: "0.7.2",
      lastError: null,
      installationRequired: true,
    };
    invokeMock
      .mockResolvedValueOnce(readyStatus)
      .mockResolvedValueOnce(readyStatus)
      .mockResolvedValueOnce(readyStatus);

    await expect(getWebAssetsStatus()).resolves.toEqual(readyStatus);
    await expect(installWebAssets()).resolves.toEqual(readyStatus);
    await expect(
      installWebAssetsFromFile("/tmp/ccgui-web-assets_0.7.2.zip"),
    ).resolves.toEqual(readyStatus);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "get_web_assets_status");
    expect(invokeMock).toHaveBeenNthCalledWith(2, "install_web_assets");
    expect(invokeMock).toHaveBeenNthCalledWith(
      3,
      "install_web_assets_from_file",
      { archivePath: "/tmp/ccgui-web-assets_0.7.2.zip" },
    );
  });

  it("uses codex_bin for addWorkspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ id: "ws-1" });

    await addWorkspace("/tmp/project", null);

    expect(invokeMock).toHaveBeenCalledWith("add_workspace", {
      path: "/tmp/project",
      codex_bin: null,
    });
  });

  it("maps Claude provider model fetch requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      models: ["claude-sonnet"],
      endpoint: "https://proxy.example.com/v1/models",
    });

    await fetchClaudeProviderModels("https://proxy.example.com/anthropic", "sk-test");

    expect(invokeMock).toHaveBeenCalledWith("vendor_fetch_claude_models", {
      baseUrl: "https://proxy.example.com/anthropic",
      apiKey: "sk-test",
    });
  });

  it("maps Claude provider reorder requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce(undefined);

    await reorderClaudeProviders(["provider-b", "provider-a"]);

    expect(invokeMock).toHaveBeenCalledWith("vendor_reorder_claude_providers", {
      orderedIds: ["provider-b", "provider-a"],
    });
  });

  it("maps Claude settings.json read and save requests", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce('{"model":"opus"}').mockResolvedValueOnce(undefined);

    await expect(readClaudeSettingsJson()).resolves.toBe('{"model":"opus"}');
    await saveClaudeSettingsJson('{"model":"sonnet"}');

    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "vendor_read_claude_settings_json",
    );
    expect(invokeMock).toHaveBeenNthCalledWith(
      2,
      "vendor_save_claude_settings_json",
      { content: '{"model":"sonnet"}' },
    );
  });

  it("maps native window opacity requests to the Tauri command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      requestedOpacity: 0.72,
      appliedOpacity: 0.72,
      applied: true,
      platform: "macos",
      reason: null,
    });

    await setMainWindowOpacity(0.72);

    expect(invokeMock).toHaveBeenCalledWith("set_main_window_opacity", {
      opacity: 0.72,
    });
  });

  it("maps provider-scoped Codex CLI model discovery", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ data: [] });

    await discoverCodexModels("ws-1", "  provider-b  ");

    expect(invokeMock).toHaveBeenCalledWith("discover_codex_models", {
      workspaceId: "ws-1",
      providerProfileId: "provider-b",
    });

    await discoverCodexModels("ws-1", "   ");
    expect(invokeMock).toHaveBeenLastCalledWith("discover_codex_models", {
      workspaceId: "ws-1",
      providerProfileId: null,
    });
  });

  it("traces startup-heavy wrappers without changing invoke parameters", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValue({});

    await getGitDiffs("ws-1");
    await getModelList("ws-1");
    await getSkillsList("ws-1", ["/opt/skills"]);
    await getPromptsList("ws-1");
    await getWorkspaceFiles("ws-1");
    await listThreads("ws-1", "cursor-1", 20);
    await listThreadTitles("ws-1");

    expect(invokeMock).toHaveBeenCalledWith("get_git_diffs", {
      workspaceId: "ws-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("model_list", {
      workspaceId: "ws-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("skills_list", {
      workspaceId: "ws-1",
      customSkillRoots: ["/opt/skills"],
    });
    expect(invokeMock).toHaveBeenCalledWith("prompts_list", {
      workspaceId: "ws-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("list_workspace_files", {
      workspaceId: "ws-1",
      forceRefresh: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("list_threads", {
      workspaceId: "ws-1",
      cursor: "cursor-1",
      limit: 20,
    });
    expect(invokeMock).toHaveBeenCalledWith("list_thread_titles", {
      workspaceId: "ws-1",
    });
    const labels = getStartupTraceSnapshot()
      .events.filter((event) => event.type === "command")
      .map((event) => event.commandLabel);
    expect(labels).toEqual([
      "get_git_diffs",
      "model_list",
      "skills_list",
      "prompts_list",
      "list_workspace_files",
      "list_threads",
      "list_thread_titles",
    ]);
  });

  it("traces startup-heavy wrapper failures without swallowing errors", async () => {
    const invokeMock = vi.mocked(invoke);
    const error = new Error("git failed");
    invokeMock.mockRejectedValueOnce(error);

    await expect(getGitDiffs("ws-1")).rejects.toBe(error);

    expect(getStartupTraceSnapshot().events).toEqual([
      expect.objectContaining({
        type: "command",
        commandLabel: "get_git_diffs",
        status: "failed",
      }),
    ]);
  });

  it("invokes codex runtime reload command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      status: "applied",
      stage: "swapped",
      restartedSessions: 2,
      message: null,
    });

    await reloadCodexRuntimeConfig();

    expect(invokeMock).toHaveBeenCalledWith("reload_codex_runtime_config");
  });

  it("invokes diagnostics bundle export command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "/tmp/diagnostics.json",
      generatedAt: "123",
    });

    await expect(exportDiagnosticsBundle()).resolves.toEqual({
      filePath: "/tmp/diagnostics.json",
      generatedAt: "123",
    });

    expect(invokeMock).toHaveBeenCalledWith("export_diagnostics_bundle");
  });

  it("invokes global client error log append command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      filePath: "/Users/demo/.ccgui/error-log/2026-05-29.jsonl",
    });

    await expect(
      appendClientErrorLog({
        schemaVersion: 1,
        timestamp: "2026-05-29T12:00:00.000Z",
        source: "error",
        label: "terminal write error",
        payload: { workspaceId: "ws-1" },
      }),
    ).resolves.toEqual({
      filePath: "/Users/demo/.ccgui/error-log/2026-05-29.jsonl",
    });

    expect(invokeMock).toHaveBeenCalledWith("append_client_error_log", {
      entry: {
        schemaVersion: 1,
        timestamp: "2026-05-29T12:00:00.000Z",
        source: "error",
        label: "terminal write error",
        payload: { workspaceId: "ws-1" },
      },
    });
  });

  it("passes custom skill roots to the skills_list command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce([]);

    await getSkillsList("ws-1", ["/opt/skills"]);

    expect(invokeMock).toHaveBeenCalledWith("skills_list", {
      workspaceId: "ws-1",
      customSkillRoots: ["/opt/skills"],
    });
  });

  it("invokes codex_doctor with the provided CLI inputs", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await runCodexDoctor("/bin/codex", "--profile demo");

    expect(invokeMock).toHaveBeenCalledWith("codex_doctor", {
      codexBin: "/bin/codex",
      codexArgs: "--profile demo",
    });
  });

  it("invokes codex launch profile preview with workspace draft inputs", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await previewCodexLaunchProfile({
      codexBin: "/bin/codex",
      codexArgs: "--profile demo",
      workspaceId: "ws-1",
      useWorkspaceDraft: true,
    });

    expect(invokeMock).toHaveBeenCalledWith("codex_preview_launch_profile", {
      codexBin: "/bin/codex",
      codexArgs: "--profile demo",
      workspaceId: "ws-1",
      useWorkspaceDraft: true,
    });
  });

  it("invokes claude_doctor with the provided CLI input", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ ok: true });

    await runClaudeDoctor("/bin/claude");

    expect(invokeMock).toHaveBeenCalledWith("claude_doctor", {
      claudeBin: "/bin/claude",
    });
  });

  it("invokes CLI installer commands with enum payloads only", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({ canRun: true });
    invokeMock.mockResolvedValueOnce({ ok: true });
    invokeMock.mockResolvedValueOnce({
      engine: "kimi",
      installed: false,
      localVersion: null,
      latestVersion: null,
      updateAvailable: false,
      nodeOk: true,
      details: null,
    });

    await getCliInstallPlan("codex", "installLatest", "npmGlobal");
    await runCliInstaller("claude", "updateLatest", "npmGlobal", "run-1");
    await getCliVersionStatus("kimi");

    expect(invokeMock).toHaveBeenCalledWith("cli_install_plan", {
      engine: "codex",
      action: "installLatest",
      strategy: "npmGlobal",
    });
    expect(invokeMock).toHaveBeenCalledWith("cli_install_run", {
      engine: "claude",
      action: "updateLatest",
      strategy: "npmGlobal",
      runId: "run-1",
    });
    expect(invokeMock).toHaveBeenCalledWith("cli_version_status", {
      engine: "kimi",
    });
    expect(
      invokeMock.mock.calls.flatMap(([, payload]) =>
        Object.keys(payload ?? {}),
      ),
    ).not.toContain("command");
  });

  it("invokes unified_exec official override command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      configPath: "/tmp/codex/config.toml",
      hasExplicitUnifiedExec: true,
      explicitUnifiedExecValue: true,
      officialDefaultEnabled: true,
    });

    await setCodexUnifiedExecOfficialOverride(true);

    expect(invokeMock).toHaveBeenCalledWith(
      "set_codex_unified_exec_official_override",
      { enabled: true },
    );
  });

  it("invokes conversation completion email command through the typed bridge", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      provider: "custom",
      acceptedRecipients: ["saved-recipient@example.com"],
      durationMs: 12,
    });

    await sendConversationCompletionEmail({
      workspaceId: "ws-1",
      threadId: "thread-1",
      turnId: "turn-1",
      subject: "Moss conversation completed",
      textBody: "User: hi\nAssistant: done",
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "send_conversation_completion_email",
      {
        request: {
          workspaceId: "ws-1",
          threadId: "thread-1",
          turnId: "turn-1",
          subject: "Moss conversation completed",
          textBody: "User: hi\nAssistant: done",
        },
      },
    );
  });

  it("invokes computer use bridge status command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      featureEnabled: true,
      activationEnabled: true,
      status: "blocked",
      platform: "macos",
      codexAppDetected: true,
      pluginDetected: true,
      pluginEnabled: true,
      blockedReasons: ["helper_bridge_unverified"],
      guidanceCodes: ["verify_helper_bridge"],
      codexConfigPath: "/Users/demo/.codex/config.toml",
      pluginManifestPath:
        "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
      helperPath: null,
      helperDescriptorPath:
        "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
      marketplacePath:
        "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
      diagnosticMessage: null,
      authorizationContinuity: authorizationContinuity(),
    });

    await getComputerUseBridgeStatus();

    expect(invokeMock).toHaveBeenCalledWith("get_computer_use_bridge_status");
  });

  it("invokes computer use activation probe command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outcome: "blocked",
      failureKind: "host_incompatible",
      bridgeStatus: {
        featureEnabled: true,
        activationEnabled: true,
        status: "blocked",
        platform: "macos",
        codexAppDetected: true,
        pluginDetected: true,
        pluginEnabled: true,
        blockedReasons: ["permission_required", "approval_required"],
        guidanceCodes: ["grant_system_permissions", "review_allowed_apps"],
        codexConfigPath: "/Users/demo/.codex/config.toml",
        pluginManifestPath:
          "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
        helperPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
        marketplacePath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
        diagnosticMessage: null,
        authorizationContinuity: authorizationContinuity(),
      },
      durationMs: 312,
      diagnosticMessage: "helper bridge verified",
      stderrSnippet: null,
      exitCode: 0,
    });

    await runComputerUseActivationProbe();

    expect(invokeMock).toHaveBeenCalledWith(
      "run_computer_use_activation_probe",
    );
  });

  it("invokes computer use host-contract diagnostics command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      kind: "requires_official_parent",
      bridgeStatus: {
        featureEnabled: true,
        activationEnabled: true,
        status: "blocked",
        platform: "macos",
        codexAppDetected: true,
        pluginDetected: true,
        pluginEnabled: true,
        blockedReasons: ["helper_bridge_unverified"],
        guidanceCodes: ["verify_helper_bridge"],
        codexConfigPath: "/Users/demo/.codex/config.toml",
        pluginManifestPath:
          "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
        helperPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
        marketplacePath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
        diagnosticMessage: null,
        authorizationContinuity: authorizationContinuity(),
      },
      evidence: {
        helperPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
        currentHostPath:
          "/Applications/ThirdPartyHost.app/Contents/MacOS/third-party-host",
        handoffMethod: "direct_exec_skipped_nested_app_bundle",
        codesignSummary: "codesign exited with status 0",
        spctlSummary: "spctl exited with status 0",
        durationMs: 4,
        stdoutSnippet: null,
        stderrSnippet: "Authority=Developer ID Application",
        officialParentHandoff: {
          kind: "requires_official_parent",
          methods: [],
          evidence: {
            codexInfoPlistPath: "/Applications/Codex.app/Contents/Info.plist",
            serviceInfoPlistPath:
              "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/Info.plist",
            helperInfoPlistPath:
              "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/Info.plist",
            parentCodeRequirementPath:
              "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/Resources/SkyComputerUseClient_Parent.coderequirement",
            pluginManifestPath:
              "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
            mcpDescriptorPath:
              "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/plugins/computer-use/.mcp.json",
            codexUrlSchemes: ["codex"],
            serviceBundleIdentifier: "com.openai.sky.CUAService",
            helperBundleIdentifier: "com.openai.sky.CUAService.cli",
            parentTeamIdentifier: "2DC432GLL2",
            applicationGroups: ["2DC432GLL2.com.openai.sky.CUAService"],
            xpcServiceIdentifiers: [],
            durationMs: 3,
            stdoutSnippet: null,
            stderrSnippet: null,
          },
          durationMs: 3,
          diagnosticMessage:
            "Readable metadata points to an official OpenAI parent/team contract.",
        },
      },
      durationMs: 4,
      diagnosticMessage:
        "Computer Use helper appears to require the official Codex parent contract.",
    });

    await runComputerUseHostContractDiagnostics();

    expect(invokeMock).toHaveBeenCalledWith(
      "run_computer_use_host_contract_diagnostics",
    );
  });

  it("invokes computer use Codex broker command", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outcome: "completed",
      failureKind: null,
      bridgeStatus: {
        featureEnabled: true,
        activationEnabled: true,
        status: "blocked",
        platform: "macos",
        codexAppDetected: true,
        pluginDetected: true,
        pluginEnabled: true,
        blockedReasons: ["permission_required", "approval_required"],
        guidanceCodes: ["grant_system_permissions", "review_allowed_apps"],
        codexConfigPath: "/Users/demo/.codex/config.toml",
        pluginManifestPath:
          "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.codex-plugin/plugin.json",
        helperPath:
          "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/Codex Computer Use.app/Contents/SharedSupport/SkyComputerUseClient.app/Contents/MacOS/SkyComputerUseClient",
        helperDescriptorPath:
          "/Users/demo/.codex/plugins/cache/openai-bundled/computer-use/1/.mcp.json",
        marketplacePath:
          "/Applications/Codex.app/Contents/Resources/plugins/openai-bundled/.agents/plugins/marketplace.json",
        diagnosticMessage: null,
        authorizationContinuity: authorizationContinuity(),
      },
      text: "done",
      diagnosticMessage:
        "Computer Use task completed through the official Codex runtime.",
      durationMs: 1200,
    });

    await runComputerUseCodexBroker({
      workspaceId: "workspace-1",
      instruction: "inspect Chrome",
    });

    expect(invokeMock).toHaveBeenCalledWith("run_computer_use_codex_broker", {
      request: {
        workspaceId: "workspace-1",
        instruction: "inspect Chrome",
      },
    });
  });

  it("maps rewind export params to export_rewind_files", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      outputPath:
        "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34",
      filesPath:
        "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34/files",
      manifestPath:
        "/Users/demo/.ccgui/chat-diff/claude/session-1/export-20260413T000000Z-ab12cd34/manifest.json",
      exportId: "export-20260413T000000Z-ab12cd34",
      fileCount: 2,
    });

    await exportRewindFiles({
      workspaceId: "ws-1",
      engine: "claude",
      sessionId: "session-1",
      targetMessageId: "user-1",
      conversationLabel: "test",
      files: [
        { path: "src/App.tsx", status: "M" },
        { path: "/tmp/demo.ts", status: "D" },
      ],
    });

    expect(invokeMock).toHaveBeenCalledWith("export_rewind_files", {
      workspaceId: "ws-1",
      engine: "claude",
      sessionId: "session-1",
      targetMessageId: "user-1",
      conversationLabel: "test",
      files: [
        { path: "src/App.tsx", status: "M" },
        { path: "/tmp/demo.ts", status: "D" },
      ],
    });
  });

  it("returns an empty list when the Tauri invoke bridge is missing", async () => {
    const invokeMock = vi.mocked(invoke);
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce(
      new TypeError("Cannot read properties of undefined (reading 'invoke')"),
    );

    await expect(listWorkspaces()).resolves.toEqual([]);
    expect(invokeMock).toHaveBeenCalledWith("list_workspaces");
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Tauri invoke bridge unavailable; returning empty workspaces list.",
    );
    consoleWarnSpy.mockRestore();
  });

  it("maps openWorkspaceIn options", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await openWorkspaceIn("/tmp/project", {
      appName: "Xcode",
      args: ["--reuse-window"],
    });

    expect(invokeMock).toHaveBeenCalledWith("open_workspace_in", {
      path: "/tmp/project",
      app: "Xcode",
      command: null,
      args: ["--reuse-window"],
    });
  });

  it("maps openNewWindow payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await openNewWindow("/tmp/project");

    expect(invokeMock).toHaveBeenCalledWith("open_new_window", {
      path: "/tmp/project",
    });
  });

  it("maps run workspace command payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      command: ["echo", "hello"],
      exitCode: 0,
      success: true,
      stdout: "hello",
      stderr: "",
    });

    await runWorkspaceCommand("ws-40", ["echo", "hello"], 5000);

    expect(invokeMock).toHaveBeenCalledWith("run_workspace_command", {
      workspaceId: "ws-40",
      command: ["echo", "hello"],
      timeoutMs: 5000,
    });
  });

  it("maps run spec command payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      command: ["openspec", "--version"],
      exitCode: 0,
      success: true,
      stdout: "0.6.0",
      stderr: "",
    });

    await runSpecCommand("ws-41", ["openspec", "--version"], {
      customSpecRoot: "/tmp/external-spec-root",
      timeoutMs: 7000,
    });

    expect(invokeMock).toHaveBeenCalledWith("run_spec_command", {
      workspaceId: "ws-41",
      command: ["openspec", "--version"],
      customSpecRoot: "/tmp/external-spec-root",
      timeoutMs: 7000,
    });
  });

  it("maps list external spec tree payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      files: [],
      directories: [],
      gitignored_files: [],
      gitignored_directories: [],
    });

    await listExternalSpecTree("ws-41", "/tmp/external-spec-root");

    expect(invokeMock).toHaveBeenCalledWith("list_external_spec_tree", {
      workspaceId: "ws-41",
      specRoot: "/tmp/external-spec-root",
    });
  });

  it("maps read external spec file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# spec",
      truncated: false,
    });

    await readExternalSpecFile(
      "ws-41",
      "/tmp/external-spec-root",
      "openspec/project.md",
    );

    expect(invokeMock).toHaveBeenCalledWith("read_external_spec_file", {
      workspaceId: "ws-41",
      specRoot: "/tmp/external-spec-root",
      path: "openspec/project.md",
    });
  });

  it("maps read external absolute file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      content: "# skill",
      truncated: false,
    });

    await readExternalAbsoluteFile(
      "ws-41",
      "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
    );

    expect(invokeMock).toHaveBeenCalledWith("read_external_absolute_file", {
      workspaceId: "ws-41",
      path: "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
    });
  });

  it("maps task output artifact tail payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "progress",
      truncated: false,
      byteLength: 8,
    });

    const response = await readEngineTaskOutputArtifact({
      workspaceId: "ws-41",
      path: "/tmp/tasks/task.output",
    });

    expect(invokeMock).toHaveBeenCalledWith("engine_task_output_read_artifact", {
      workspaceId: "ws-41",
      path: "/tmp/tasks/task.output",
    });
    expect(response.content).toBe("progress");
  });

  it("maps file preview handle payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      absolutePath: "/repo/docs/report.pdf",
      byteLength: 2048,
      extension: "pdf",
    });

    await resolveFilePreviewHandle("ws-41", {
      domain: "workspace",
      path: "docs/report.pdf",
    });

    expect(invokeMock).toHaveBeenCalledWith("resolve_file_preview_handle", {
      workspaceId: "ws-41",
      domain: "workspace",
      path: "docs/report.pdf",
      specRoot: null,
    });
  });

  it("maps write external spec file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeExternalSpecFile(
      "ws-41",
      "/tmp/external-spec-root",
      "openspec/project.md",
      "# Project Context",
    );

    expect(invokeMock).toHaveBeenCalledWith("write_external_spec_file", {
      workspaceId: "ws-41",
      specRoot: "/tmp/external-spec-root",
      path: "openspec/project.md",
      content: "# Project Context",
    });
  });

  it("maps write external absolute file payload", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeExternalAbsoluteFile(
      "ws-41",
      "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
      "# Updated skill",
    );

    expect(invokeMock).toHaveBeenCalledWith("write_external_absolute_file", {
      workspaceId: "ws-41",
      path: "/Users/demo/.codex/skills/openspec-apply-change/SKILL.md",
      content: "# Updated skill",
    });
  });

  it("invokes get_open_app_icon", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce("data:image/png;base64,abc");

    await getOpenAppIcon("Xcode");

    expect(invokeMock).toHaveBeenCalledWith("get_open_app_icon", {
      appName: "Xcode",
    });
  });

  it("reads agent.md for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# Agent",
      truncated: false,
    });

    await readAgentMd("ws-agent");

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "workspace",
      kind: "agents",
      workspaceId: "ws-agent",
    });
  });

  it("writes agent.md for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeAgentMd("ws-agent", "# Agent");

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "workspace",
      kind: "agents",
      workspaceId: "ws-agent",
      content: "# Agent",
    });
  });

  it("reads global AGENTS.md", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# Global",
      truncated: false,
    });

    await readGlobalAgentsMd();

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "global",
      kind: "agents",
      workspaceId: undefined,
    });
  });

  it("writes global AGENTS.md", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeGlobalAgentsMd("# Global");

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "global",
      kind: "agents",
      workspaceId: undefined,
      content: "# Global",
    });
  });

  it("reads global config.toml", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: 'model = "gpt-5"',
      truncated: false,
    });

    await readGlobalCodexConfigToml();

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "global",
      kind: "config",
      workspaceId: undefined,
    });
  });

  it("reads global auth.json", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: '{"tokens":[]}',
      truncated: false,
    });

    await readGlobalCodexAuthJson();

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "global",
      kind: "auth",
      workspaceId: undefined,
    });
  });

  it("writes global config.toml", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeGlobalCodexConfigToml('model = "gpt-5"');

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "global",
      kind: "config",
      workspaceId: undefined,
      content: 'model = "gpt-5"',
    });
  });

  it("writes global auth.json", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeGlobalCodexAuthJson('{"tokens":[]}');

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "global",
      kind: "auth",
      workspaceId: undefined,
      content: '{"tokens":[]}',
    });
  });

  it("reads CLAUDE.md for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({
      exists: true,
      content: "# Claude",
      truncated: false,
    });

    await readClaudeMd("ws-claude");

    expect(invokeMock).toHaveBeenCalledWith("file_read", {
      scope: "workspace",
      kind: "claude",
      workspaceId: "ws-claude",
    });
  });

  it("writes CLAUDE.md for a workspace", async () => {
    const invokeMock = vi.mocked(invoke);
    invokeMock.mockResolvedValueOnce({});

    await writeClaudeMd("ws-claude", "# Claude");

    expect(invokeMock).toHaveBeenCalledWith("file_write", {
      scope: "workspace",
      kind: "claude",
      workspaceId: "ws-claude",
      content: "# Claude",
    });
  });

});
