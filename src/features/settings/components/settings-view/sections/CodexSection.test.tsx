// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppSettings, CliInstallPlan, CliInstallResult } from "@/types";
import {
  getCliInstallPlan,
  previewCodexLaunchProfile,
  runCliInstaller,
} from "@/services/tauri";
import { subscribeCliInstallerEvents } from "@/services/events";
import { CodexSection } from "./CodexSection";

vi.mock("@/services/tauri", () => ({
  getCliInstallPlan: vi.fn(),
  previewCodexLaunchProfile: vi.fn(),
  runCliInstaller: vi.fn(),
}));
vi.mock("@/services/events", () => ({
  subscribeCliInstallerEvents: vi.fn(() => vi.fn()),
}));
vi.mock("@/features/computer-use/constants", () => ({
  ENABLE_COMPUTER_USE_BRIDGE: false,
}));
vi.mock("@/features/computer-use/components/ComputerUseStatusCard", () => ({
  ComputerUseStatusCard: () => null,
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(subscribeCliInstallerEvents).mockReturnValue(vi.fn());
});

function baseSettings(): AppSettings {
  return {
    backendMode: "local",
    disabledCliEngines: [],
  } as unknown as AppSettings;
}

function t(key: string) {
  const labels: Record<string, string> = {
    "settings.cliInstallLatest": "Install latest",
    "settings.cliInstallerConfirm": "Confirm and run",
    "settings.cliInstallerCommand": "Will run",
    "settings.cliInstallerSucceeded": "Installer completed",
    "settings.cliInstallerLiveLog": "Live log",
    "settings.cliInstallerElapsed": "Elapsed",
    "settings.cliInstallerWaitingForOutput": "Waiting for installer output...",
    "settings.runDoctor": "Run Doctor",
    "settings.runClaudeDoctor": "Run Claude Doctor",
    "settings.cliPathManagedInVendors":
      "Executable paths are configured in CLI Config Management.",
    "settings.previewLaunch": "Preview launch",
    "settings.previewingLaunch": "Previewing launch...",
    "settings.codexLaunchPreviewTitle": "Launch preview",
    "settings.codexLaunchPreviewIssueTitle": "Launch preview issue",
    "settings.codexLaunchResolvedExecutable": "Resolved executable",
    "settings.codexLaunchWrapperKind": "Wrapper kind",
    "settings.codexLaunchUserArguments": "User arguments",
    "settings.codexLaunchInjectedArguments": "Injected arguments",
    "settings.codexLaunchNoArguments": "No arguments",
    "settings.codexLaunchNextLaunchOnly": "Next launch only",
    "settings.codexLaunchExecutableDraft": "draft executable override",
    "settings.codexLaunchArgumentsDraft": "draft arguments override",
    "settings.codexWorkspaceSourceLabel": "Source",
    "settings.codexWorkspaceSelect": "Workspace",
    "settings.codexWorkspacePath": "Workspace Codex path override",
    "settings.codexWorkspaceArgs": "Workspace Codex args override",
    "settings.codexWorkspaceInheritPath": "Inherit global executable",
    "settings.codexWorkspaceInheritArgs": "Inherit parent or global arguments",
    "settings.codexWorkspaceExecutableGlobal": "global executable",
    "settings.codexWorkspaceExecutablePath": "PATH resolution",
    "settings.codexWorkspaceExecutableOverride": "workspace executable override",
    "settings.codexWorkspaceArgsGlobal": "global arguments",
    "settings.codexWorkspaceArgsDefault": "default arguments",
    "settings.codexWorkspaceArgsOverride": "workspace arguments override",
    "settings.codexWorkspaceArgsParent": "parent workspace arguments",
    "settings.codexWorkspaceSave": "Save workspace launch",
    "settings.codexWorkspaceSaveFailed": "Workspace launch save failed",
    "settings.versionLabel": "Version:",
    "settings.appServerLabel": "App-server:",
    "settings.nodeLabel": "Node:",
    "settings.statusOk": "ok",
    "settings.doctorEnvironmentDiagnosis": "Environment Diagnosis",
    "settings.doctorNetworkDiagnosis": "Network Diagnosis",
    "settings.doctorProxyEnvironment": "Proxy Environment",
    "common.cancel": "Cancel",
  };
  return labels[key] ?? key;
}

function renderCodexSection(
  onInstallerDoctorResult = vi.fn(),
  overrides: Partial<ComponentProps<typeof CodexSection>> = {},
) {
  const rendered = render(
    <CodexSection
      active
      t={t}
      appSettings={baseSettings()}
      onUpdateAppSettings={vi.fn()}
      handleRunClaudeDoctor={vi.fn()}
      claudeDoctorState={{ status: "idle", result: null }}
      handleRunKimiDoctor={vi.fn()}
      kimiDoctorState={{ status: "idle", result: null }}
      handleRunGrokDoctor={vi.fn()}
      grokDoctorState={{ status: "idle", result: null }}
      handleRunOpenCodeDoctor={vi.fn()}
      openCodeDoctorState={{ status: "idle", result: null }}
      handleRunDshDoctor={vi.fn()}
      dshDoctorState={{ status: "idle", result: null }}
      handleRunPiDoctor={vi.fn()}
      piDoctorState={{ status: "idle", result: null }}
      handleRunOmpDoctor={vi.fn()}
      ompDoctorState={{ status: "idle", result: null }}
      handleRunQoderDoctor={vi.fn()}
      qoderDoctorState={{ status: "idle", result: null }}
      handleRunDoctor={vi.fn()}
      doctorState={{ status: "done", result: { ok: false } as any }}
      remoteHostDraft=""
      setRemoteHostDraft={vi.fn()}
      remoteTokenDraft=""
      setRemoteTokenDraft={vi.fn()}
      handleCommitRemoteHost={vi.fn()}
      handleCommitRemoteToken={vi.fn()}
      onInstallerDoctorResult={onInstallerDoctorResult}
      {...overrides}
    />,
  );
  return { onInstallerDoctorResult, ...rendered };
}

function createPlan(): CliInstallPlan {
  return {
    engine: "codex",
    action: "installLatest",
    strategy: "npmGlobal",
    backend: "local",
    platform: "macos",
    commandPreview: ["npm", "install", "-g", "@openai/codex@latest"],
    canRun: true,
    blockers: [],
    warnings: [],
    manualFallback: "npm install -g @openai/codex@latest",
  };
}

describe("CodexSection CLI installer", () => {
  it("hides successful unknown network and empty proxy diagnostics", () => {
    renderCodexSection(vi.fn(), {
      doctorState: {
        status: "done",
        result: {
          ok: true,
          codexBin: null,
          version: "1.0.0",
          appServerOk: true,
          details: null,
          path: null,
          nodeOk: true,
          nodeVersion: "v22.0.0",
          nodeDetails: null,
          proxyEnvSnapshot: {
            HTTP_PROXY: null,
            HTTPS_PROXY: null,
          },
          environmentDiagnosis: {
            category: "resolved",
            message: "Executable is visible to the runtime resolver.",
          },
          networkDiagnosis: {
            category: "unknown",
          },
        } as any,
      },
    });

    expect(screen.queryByText(/Environment Diagnosis/)).toBeNull();
    expect(screen.queryByText(/Network Diagnosis/)).toBeNull();
    expect(screen.queryByText(/Proxy Environment/)).toBeNull();
  });

  it("shows actionable environment, network, and configured proxy diagnostics", () => {
    renderCodexSection(vi.fn(), {
      doctorState: {
        status: "done",
        result: {
          ok: false,
          codexBin: null,
          version: null,
          appServerOk: false,
          details: "Timed out while checking endpoint",
          path: null,
          nodeOk: true,
          nodeVersion: "v22.0.0",
          nodeDetails: null,
          proxyEnvSnapshot: {
            HTTP_PROXY: "http://proxy.example:8080",
            HTTPS_PROXY: null,
          },
          environmentDiagnosis: {
            category: "environmentDrift",
            message: "Executable was found by platform fallback.",
          },
          networkDiagnosis: {
            category: "timeout",
          },
        } as any,
      },
    });

    expect(screen.getByText(/Environment Diagnosis/)).not.toBeNull();
    expect(screen.getByText(/environmentDrift/)).not.toBeNull();
    expect(screen.getByText(/Network Diagnosis/)).not.toBeNull();
    expect(screen.getByText(/timeout/)).not.toBeNull();
    expect(screen.getByText(/HTTP_PROXY=http:\/\/proxy.example:8080/)).not.toBeNull();
    expect(screen.queryByText(/HTTPS_PROXY/)).toBeNull();
  });

  it("previews global launch configuration from saved settings", async () => {
    vi.mocked(previewCodexLaunchProfile).mockResolvedValueOnce({
      ok: true,
      scope: "global",
      workspaceId: null,
      executableSource: "global",
      argumentsSource: "global",
      codexBin: "/bin/codex",
      codexArgs: "--profile demo",
      resolvedExecutable: "/bin/codex",
      wrapperKind: "direct",
      userArguments: ["--profile", "demo"],
      injectedArguments: ["app-server"],
      launchArguments: ["--profile", "demo", "app-server"],
      pathEnvUsed: null,
      warnings: [],
      details: null,
      nextLaunchOnly: true,
    });
    renderCodexSection(vi.fn(), {
      appSettings: {
        ...baseSettings(),
        codexBin: "/bin/codex",
        codexArgs: "--profile demo",
      },
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Preview launch" })[0]);

    await waitFor(() => {
      expect(previewCodexLaunchProfile).toHaveBeenCalledWith({
        codexBin: null,
        codexArgs: null,
        workspaceId: null,
        useWorkspaceDraft: false,
      });
    });
    expect(await screen.findByText("Launch preview")).not.toBeNull();
    expect(await screen.findByText("/bin/codex")).not.toBeNull();
  });

  it("saves workspace launch overrides as next-launch-only settings", async () => {
    const updateWorkspaceCodexBin = vi.fn().mockResolvedValue(undefined);
    const updateWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    const { container } = renderCodexSection(vi.fn(), {
      workspaces: [
        {
          id: "ws-1",
          name: "Workspace One",
          path: "/tmp/ws-1",
          connected: true,
          codex_bin: null,
          settings: { sidebarCollapsed: false, codexArgs: null },
        },
      ],
      activeWorkspace: {
        id: "ws-1",
        name: "Workspace One",
        path: "/tmp/ws-1",
        connected: true,
        codex_bin: null,
        settings: { sidebarCollapsed: false, codexArgs: null },
      },
      onUpdateWorkspaceCodexBin: updateWorkspaceCodexBin,
      onUpdateWorkspaceSettings: updateWorkspaceSettings,
    });
    await act(async () => undefined);

    const workspacePathInput = container.querySelector<HTMLInputElement>(
      "#codex-workspace-path",
    );
    expect(workspacePathInput).not.toBeNull();
    await act(async () => {
      fireEvent.change(workspacePathInput!, {
        target: { value: "/workspace/codex" },
      });
    });
    expect(workspacePathInput?.value).toBe("/workspace/codex");
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Save workspace launch"),
    );
    expect(saveButton).not.toBeUndefined();
    await act(async () => {
      fireEvent.click(saveButton!);
    });

    expect(updateWorkspaceCodexBin).toHaveBeenCalled();
    expect(updateWorkspaceCodexBin).toHaveBeenCalledWith(
      "ws-1",
      "/workspace/codex",
    );
    expect(updateWorkspaceSettings).not.toHaveBeenCalled();
    expect(screen.getAllByText("Next launch only").length).toBeGreaterThan(0);
  });

  it("runs plan-confirm-result flow without raw command input", async () => {
    const plan = createPlan();
    const result: CliInstallResult = {
      ok: true,
      engine: "codex",
      action: "installLatest",
      strategy: "npmGlobal",
      backend: "local",
      exitCode: 0,
      stdoutSummary: null,
      stderrSummary: null,
      details: null,
      durationMs: 120,
      doctorResult: {
        ok: true,
        codexBin: null,
        version: "codex 1.0.0",
        appServerOk: true,
        details: null,
        path: null,
        nodeOk: true,
        nodeVersion: "v22.0.0",
        nodeDetails: null,
      },
    };
    vi.mocked(getCliInstallPlan).mockResolvedValueOnce(plan);
    vi.mocked(runCliInstaller).mockResolvedValueOnce(result);
    const { onInstallerDoctorResult } = renderCodexSection();

    fireEvent.click(screen.getByRole("button", { name: "Install latest" }));

    expect(
      await screen.findAllByText("npm install -g @openai/codex@latest"),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Confirm and run" }));

    await waitFor(() => {
      expect(runCliInstaller).toHaveBeenCalledWith(
        "codex",
        "installLatest",
        "npmGlobal",
        expect.stringMatching(/^codex-/),
      );
    });
    expect(getCliInstallPlan).toHaveBeenCalledWith(
      "codex",
      "installLatest",
      "npmGlobal",
    );
    expect(onInstallerDoctorResult).toHaveBeenCalledWith(
      "codex",
      result.doctorResult,
    );
    expect(await screen.findByText("Installer completed")).not.toBeNull();
  });

  it("renders live installer logs for the matching run id", async () => {
    let progressHandler: Parameters<
      typeof subscribeCliInstallerEvents
    >[0] = () => {};
    vi.mocked(subscribeCliInstallerEvents).mockImplementationOnce((handler) => {
      progressHandler = handler;
      return vi.fn();
    });
    vi.mocked(getCliInstallPlan).mockResolvedValueOnce(createPlan());
    vi.mocked(runCliInstaller).mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    renderCodexSection();

    fireEvent.click(screen.getByRole("button", { name: "Install latest" }));
    await waitFor(() => {
      expect(getCliInstallPlan).toHaveBeenCalledWith(
        "codex",
        "installLatest",
        "npmGlobal",
      );
    });
    await screen.findAllByText("npm install -g @openai/codex@latest");
    fireEvent.click(screen.getByRole("button", { name: "Confirm and run" }));

    await waitFor(() => {
      expect(runCliInstaller).toHaveBeenCalled();
    });
    const runId = vi.mocked(runCliInstaller).mock.calls[0]?.[3] ?? "";
    act(() => {
      progressHandler({
        runId,
        engine: "codex",
        action: "installLatest",
        strategy: "npmGlobal",
        backend: "local",
        phase: "stdout",
        stream: "stdout",
        message: "added 1 package",
        exitCode: null,
        durationMs: null,
      });
    });

    expect(await screen.findByText("Live log")).not.toBeNull();
    expect(
      await screen.findByText(/\[stdout\] added 1 package/),
    ).not.toBeNull();
  });
});
