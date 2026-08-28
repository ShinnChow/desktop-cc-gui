// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceInfo } from "../../types";
import * as systemNotification from "../../services/systemNotification";
import { writeTerminalSession } from "../../services/tauri/terminalRuntime";
import { useTerminalController } from "../../features/terminal/hooks/useTerminalController";
import type { TerminalSessionState } from "../../features/terminal/hooks/useTerminalSession";
import { useWorkspaceRuntimeRun } from "../../features/app/hooks/useWorkspaceRuntimeRun";
import { useAppShellWorkspaceFlowsSection } from "./useAppShellWorkspaceFlowsSection";

vi.mock("../../services/systemNotification", () => ({
  setNotificationActionHandler: vi.fn(),
}));

vi.mock("../../services/clientStorage", () => ({
  writeClientStoreValue: vi.fn(),
}));

const { archiveWorkspaceSessionsV2Mock } = vi.hoisted(() => ({
  archiveWorkspaceSessionsV2Mock: vi.fn(),
}));
vi.mock("../../services/tauri/sessionManagement", () => ({
  archiveWorkspaceSessionsV2: archiveWorkspaceSessionsV2Mock,
}));
vi.mock("../../services/tauri/terminalRuntime", () => ({
  writeTerminalSession: vi.fn(),
}));

vi.mock("../../features/workspaces/hooks/useRenameWorktreePrompt", () => ({
  useRenameWorktreePrompt: vi.fn(() => ({
    renamePrompt: null,
    notice: null,
    upstreamPrompt: null,
    confirmUpstream: vi.fn(),
    openRenamePrompt: vi.fn(),
    handleRenameChange: vi.fn(),
    handleRenameCancel: vi.fn(),
    handleRenameConfirm: vi.fn(),
  })),
}));

vi.mock("../../features/workspaces/hooks/useClonePrompt", () => ({
  useClonePrompt: vi.fn(() => ({
    clonePrompt: null,
    openPrompt: vi.fn(),
    confirmPrompt: vi.fn(),
    cancelPrompt: vi.fn(),
    updateCopyName: vi.fn(),
    chooseCopiesFolder: vi.fn(),
    useSuggestedCopiesFolder: vi.fn(),
    clearCopiesFolder: vi.fn(),
  })),
}));

vi.mock("../../features/terminal/hooks/useTerminalController", () => ({
  useTerminalController: vi.fn(() => ({
    terminalTabs: [],
    activeTerminalId: null,
    onSelectTerminal: vi.fn(),
    onNewTerminal: vi.fn(),
    onCloseTerminal: vi.fn(),
    terminalState: {},
    ensureTerminalWithTitle: vi.fn(() => "terminal-id"),
    restartTerminalSession: vi.fn(),
  })),
}));

vi.mock("../../features/app/hooks/useWorkspaceLaunchScript", () => ({
  useWorkspaceLaunchScript: vi.fn(() => ({})),
}));

vi.mock("../../features/app/hooks/useWorkspaceRuntimeRun", () => ({
  useWorkspaceRuntimeRun: vi.fn(() => ({
    onOpenRuntimeConsole: vi.fn(),
    onSelectRuntimeCommandPreset: vi.fn(),
    onChangeRuntimeCommandInput: vi.fn(),
    onRunProject: vi.fn(),
    onStopProject: vi.fn(),
    onClearRuntimeLogs: vi.fn(),
    onCopyRuntimeLogs: vi.fn(),
    onToggleRuntimeAutoScroll: vi.fn(),
    onToggleRuntimeWrapLines: vi.fn(),
    onCloseRuntimeConsole: vi.fn(),
    runtimeAutoScroll: true,
    runtimeWrapLines: true,
    runtimeConsoleVisible: false,
    runtimeConsoleStatus: "idle",
    runtimeConsoleCommandPreview: null,
    runtimeCommandPresetOptions: ["auto"],
    runtimeCommandPresetId: "auto",
    runtimeCommandInput: "",
    runtimeConsoleLog: "",
    runtimeConsoleError: null,
    runtimeConsoleTruncated: false,
    runtimeConsoleExitCode: null,
  })),
}));

vi.mock("../../features/app/hooks/useWorkspaceLaunchScripts", () => ({
  useWorkspaceLaunchScripts: vi.fn(() => ({})),
}));

vi.mock("../../features/app/hooks/useWorktreeSetupScript", () => ({
  useWorktreeSetupScript: vi.fn(() => ({
    maybeRunWorktreeSetupScript: vi.fn(),
  })),
}));

function createWorkspace(id: string): WorkspaceInfo {
  return {
    id,
    name: id,
    path: `workspace-${id}`,
    connected: true,
    settings: { sidebarCollapsed: false },
  };
}

function createContext(overrides: Partial<Parameters<typeof useAppShellWorkspaceFlowsSection>[0]> = {}) {
  const workspace = createWorkspace("ws-1");
  return {
    activeEditorFilePath: null,
    activeWorkspace: workspace,
    activeWorkspaceId: workspace.id,
    activeThreadId: "thread-1",
    addCloneAgent: vi.fn(),
    addDebugEntry: vi.fn(),
    alertError: vi.fn(),
    appSettings: { workspaceGroups: [] },
    clearDraftForThread: vi.fn(),
    closeSettings: vi.fn(),
    closeTerminalPanel: vi.fn(),
    collapseRightPanel: vi.fn(),
    connectWorkspace: vi.fn(),
    centerMode: "chat" as const,
    exitDiffView: vi.fn(),
    handleToggleTerminal: vi.fn(),
    isCompact: false,
    listThreadsForWorkspaceTracked: vi.fn(),
    openTerminal: vi.fn(),
    queueSaveSettings: vi.fn(),
    refreshThread: vi.fn(),
    removeImagesForThread: vi.fn(),
    ensureWorkspaceThreadListLoaded: vi.fn(),
    renameWorktree: vi.fn(),
    renameWorktreeUpstream: vi.fn(),
    resetWorkspaceThreads: vi.fn(),
    selectWorkspace: vi.fn(),
    setActiveEngine: vi.fn(),
    setActiveTab: vi.fn(),
    setActiveThreadId: vi.fn(),
    setAgentTaskScrollRequest: vi.fn(),
    setAppMode: vi.fn(),
    setAppSettings: vi.fn(),
    setCenterMode: vi.fn(),
    setHomeOpen: vi.fn(),
    t: (key: string) => key,
    terminalOpen: false,
    threadsByWorkspace: {
      [workspace.id]: [{ id: "thread-1", engineSource: "codex" }],
    },
    updateWorkspaceSettings: vi.fn(),
    workspaces: [workspace],
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe("useAppShellWorkspaceFlowsSection", () => {
  const setNotificationActionHandlerMock = vi.mocked(
    systemNotification.setNotificationActionHandler,
  );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers and cleans up the notification action handler", async () => {
    const context = createContext();
    const { unmount } = renderHook(() =>
      useAppShellWorkspaceFlowsSection(context),
    );

    expect(setNotificationActionHandlerMock).toHaveBeenCalledTimes(1);
    expect(setNotificationActionHandlerMock).toHaveBeenLastCalledWith(
      expect.any(Function),
    );

    unmount();

    expect(setNotificationActionHandlerMock).toHaveBeenCalledTimes(2);
    expect(setNotificationActionHandlerMock).toHaveBeenLastCalledWith(null);
  });

  it("navigates to a notified thread and syncs engine from thread metadata", async () => {
    const context = createContext();
    renderHook(() => useAppShellWorkspaceFlowsSection(context));

    const handler = setNotificationActionHandlerMock.mock.calls.at(-1)?.[0] as
      | ((extra: Record<string, unknown>) => void)
      | undefined;

    expect(handler).toBeTypeOf("function");

    act(() => {
      handler?.({ workspaceId: "ws-1", threadId: "thread-1" });
    });

    expect(context.exitDiffView).toHaveBeenCalled();
    expect(context.setAppMode).toHaveBeenCalledWith("chat");
    expect(context.setActiveTab).toHaveBeenCalledWith("codex");
    expect(context.setHomeOpen).toHaveBeenCalledWith(false);
    expect(context.collapseRightPanel).toHaveBeenCalled();
    expect(context.selectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(context.setActiveThreadId).toHaveBeenCalledWith("thread-1", "ws-1");
    expect(context.setActiveEngine).toHaveBeenCalledWith("codex");
    expect(vi.mocked(context.setActiveThreadId).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(context.collapseRightPanel).mock.invocationCallOrder[0],
    );
  });

  it("syncs the PI engine when navigating to a PI thread", async () => {
    const context = createContext({
      threadsByWorkspace: {
        "ws-1": [{ id: "thread-pi", engineSource: "pi" }],
      },
    });
    const { result } = renderHook(() =>
      useAppShellWorkspaceFlowsSection(context),
    );

    act(() => {
      result.current.navigateToThread("ws-1", "thread-pi");
    });

    expect(context.setActiveThreadId).toHaveBeenCalledWith("thread-pi", "ws-1");
    expect(context.setActiveEngine).toHaveBeenCalledWith("pi");
  });

  it("keeps the desktop editor visible when notification switches within the same workspace", async () => {
    const context = createContext({
      activeEditorFilePath: "src/App.tsx",
      centerMode: "editor",
      threadsByWorkspace: {
        "ws-1": [{ id: "thread-2", engineSource: "codex" }],
      },
    });
    renderHook(() => useAppShellWorkspaceFlowsSection(context));

    const handler = setNotificationActionHandlerMock.mock.calls.at(-1)?.[0] as
      | ((extra: Record<string, unknown>) => void)
      | undefined;

    act(() => {
      handler?.({ workspaceId: "ws-1", threadId: "thread-2" });
    });

    expect(context.exitDiffView).not.toHaveBeenCalled();
    expect(context.collapseRightPanel).not.toHaveBeenCalled();
    expect(context.setActiveThreadId).toHaveBeenCalledWith("thread-2", "ws-1");
    expect(context.setActiveEngine).toHaveBeenCalledWith("codex");
  });

  it("opens a known mail session and closes settings without reloading threads", () => {
    const context = createContext();
    const { result } = renderHook(() =>
      useAppShellWorkspaceFlowsSection(context),
    );

    act(() => {
      result.current.handleOpenMailSession({
        sessionId: "mail-session-1",
        workspaceId: "ws-1",
        threadId: "thread-1",
        turnId: "turn-1",
      });
    });

    expect(context.closeSettings).toHaveBeenCalledTimes(1);
    expect(context.selectWorkspace).toHaveBeenCalledWith("ws-1");
    expect(context.setActiveThreadId).toHaveBeenCalledWith("thread-1", "ws-1");
    expect(context.listThreadsForWorkspaceTracked).not.toHaveBeenCalled();
  });

  it("reloads workspace threads when a mail session thread is not listed", () => {
    const context = createContext({
      threadsByWorkspace: { "ws-1": [] },
      listThreadsForWorkspaceTracked: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() =>
      useAppShellWorkspaceFlowsSection(context),
    );

    act(() => {
      result.current.handleOpenMailSession({
        sessionId: "mail-session-1",
        workspaceId: "ws-1",
        threadId: "thread-missing",
        turnId: "turn-1",
      });
    });

    expect(context.listThreadsForWorkspaceTracked).toHaveBeenCalledWith(
      context.workspaces[0],
    );
  });

  it("rejects a mail session without a valid workspace or thread", () => {
    const context = createContext();
    const { result } = renderHook(() =>
      useAppShellWorkspaceFlowsSection(context),
    );

    act(() => {
      result.current.handleOpenMailSession({
        sessionId: "mail-session-1",
        workspaceId: "missing-workspace",
        threadId: " ",
        turnId: "turn-1",
      });
    });

    expect(context.alertError).toHaveBeenCalledWith(
      "settings.emailOpenSessionUnavailable",
    );
    expect(context.closeSettings).not.toHaveBeenCalled();
    expect(context.setActiveThreadId).not.toHaveBeenCalled();
  });

  it("drops stale thread switch work after a rapid foreground navigation", async () => {
    const context = createContext({
      threadsByWorkspace: {
        "ws-1": [
          { id: "thread-1", engineSource: "codex" },
          { id: "thread-2", engineSource: "claude" },
        ],
      },
    });
    const { result } = renderHook(() =>
      useAppShellWorkspaceFlowsSection(context),
    );
    const staleWork = createDeferred<string>();
    const freshWork = createDeferred<string>();
    const applyStale = vi.fn();
    const applyFresh = vi.fn();

    const staleResultPromise = result.current.runLatestThreadSwitchWork(
      { workspaceId: "ws-1", threadId: "thread-1" },
      () => staleWork.promise,
      applyStale,
    );

    act(() => {
      result.current.navigateToThread("ws-1", "thread-2");
    });

    const freshResultPromise = result.current.runLatestThreadSwitchWork(
      { workspaceId: "ws-1", threadId: "thread-2" },
      () => freshWork.promise,
      applyFresh,
    );

    await act(async () => {
      staleWork.resolve("late A");
      freshWork.resolve("current B");
      await Promise.all([staleResultPromise, freshResultPromise]);
    });

    await expect(staleResultPromise).resolves.toBe(false);
    await expect(freshResultPromise).resolves.toBe(true);
    expect(applyStale).not.toHaveBeenCalled();
    expect(applyFresh).toHaveBeenCalledWith("current B");
  });

  it("archives the active thread and clears draft/image state after success", async () => {
    archiveWorkspaceSessionsV2Mock.mockResolvedValue({
      results: [{ sessionId: "thread-1", ok: true, code: "OK" }],
    });
    const context = createContext();
    const { result } = renderHook(() =>
      useAppShellWorkspaceFlowsSection(context),
    );

    await act(async () => {
      await result.current.handleArchiveActiveThread();
    });

    expect(archiveWorkspaceSessionsV2Mock).toHaveBeenCalledWith("ws-1", [
      { threadId: "thread-1" },
    ]);
    expect(context.setActiveThreadId).toHaveBeenCalledWith(null, "ws-1");
    expect(context.ensureWorkspaceThreadListLoaded).toHaveBeenCalledWith(
      "ws-1",
      { deletedThreadIds: ["thread-1"], localRemovalOnly: true },
    );
    expect(context.clearDraftForThread).toHaveBeenCalledWith("thread-1");
    expect(context.removeImagesForThread).toHaveBeenCalledWith("thread-1");
    expect(context.alertError).not.toHaveBeenCalled();
  });

  it("surfaces archive failure without clearing local thread state", async () => {
    archiveWorkspaceSessionsV2Mock.mockResolvedValue({
      results: [
        { sessionId: "thread-1", ok: false, error: "archive failed" },
      ],
    });
    const context = createContext();
    const { result } = renderHook(() =>
      useAppShellWorkspaceFlowsSection(context),
    );

    await act(async () => {
      await result.current.handleArchiveActiveThread();
    });

    expect(context.alertError).toHaveBeenCalledWith("archive failed");
    expect(context.clearDraftForThread).not.toHaveBeenCalled();
    expect(context.removeImagesForThread).not.toHaveBeenCalled();
  });

  it("closes runtime console when toggling an already-open terminal panel", () => {
    const onCloseRuntimeConsole = vi.fn();
    vi.mocked(useWorkspaceRuntimeRun).mockReturnValue({
      onOpenRuntimeConsole: vi.fn(),
      onSelectRuntimeCommandPreset: vi.fn(),
      onChangeRuntimeCommandInput: vi.fn(),
      onRunProject: vi.fn(),
      onStopProject: vi.fn(),
      onClearRuntimeLogs: vi.fn(),
      onCopyRuntimeLogs: vi.fn(),
      onToggleRuntimeAutoScroll: vi.fn(),
      onToggleRuntimeWrapLines: vi.fn(),
      onCloseRuntimeConsole,
      runtimeAutoScroll: true,
      runtimeWrapLines: true,
      runtimeConsoleVisible: true,
      runtimeConsoleStatus: "running",
      runtimeConsoleCommandPreview: null,
      runtimeCommandPresetOptions: ["auto"],
      runtimeCommandPresetId: "auto",
      runtimeCommandInput: "",
      runtimeConsoleLog: "",
      runtimeConsoleError: null,
      runtimeConsoleTruncated: false,
      runtimeConsoleExitCode: null,
    });

    const context = createContext({
      terminalOpen: true,
    });
    const { result } = renderHook(() =>
      useAppShellWorkspaceFlowsSection(context),
    );

    act(() => {
      result.current.handleToggleTerminalPanel();
    });

    expect(onCloseRuntimeConsole).toHaveBeenCalledTimes(1);
    expect(context.handleToggleTerminal).toHaveBeenCalledTimes(1);
  });

  it("opens Claude TUI resume in an internal terminal and writes the resume command when ready", async () => {
    const ensureTerminalWithTitle = vi.fn(() => "claude-terminal");
    const restartTerminalSession = vi.fn().mockResolvedValue(undefined);
    const readyTerminalState: TerminalSessionState = {
      status: "ready",
      message: "Terminal ready.",
      containerRef: { current: null },
      hasSession: true,
      readyKey: "ws-1:claude-terminal",
      cleanupTerminalSession: vi.fn(),
          getSelection: () => "",
          findNext: vi.fn(() => false),
          findPrevious: vi.fn(() => false),
    };
    const terminalControllerReadyState = {
      terminalTabs: [],
      activeTerminalId: "claude-terminal",
      onSelectTerminal: vi.fn(),
      onNewTerminal: vi.fn(),
      onCloseTerminal: vi.fn(),
      terminalState: readyTerminalState,
      ensureTerminalWithTitle,
      restartTerminalSession,
    } satisfies ReturnType<typeof useTerminalController>;
    vi.mocked(useTerminalController).mockReturnValue({
      ...terminalControllerReadyState,
      activeTerminalId: null,
      terminalState: {
        ...terminalControllerReadyState.terminalState,
        readyKey: null,
      },
    });
    vi.mocked(writeTerminalSession).mockResolvedValue(undefined);

    const context = createContext();
    const { result, rerender } = renderHook(() =>
      useAppShellWorkspaceFlowsSection(context),
    );

    await act(async () => {
      result.current.handleOpenClaudeTui({
        workspaceId: "ws-1",
        workspacePath: "/tmp/ws-1",
        sessionId: "session-1",
      });
    });
    vi.mocked(useTerminalController).mockReturnValue(terminalControllerReadyState);
    await act(async () => {
      rerender();
    });

    expect(ensureTerminalWithTitle).toHaveBeenCalledWith(
      "ws-1",
      "claude-tui:session-1",
      "terminal.claudeTuiResumeTitle",
    );
    expect(context.openTerminal).toHaveBeenCalledTimes(1);
    expect(restartTerminalSession).toHaveBeenCalledWith("ws-1", "claude-terminal");
    expect(writeTerminalSession).toHaveBeenCalledWith(
      "ws-1",
      "claude-terminal",
      "claude --resume session-1\n",
    );
  });

  it("runs a cross-surface terminal command request with delayed follow-up input", async () => {
    vi.useFakeTimers();
    try {
      const ensureTerminalWithTitle = vi.fn(() => "pi-terminal");
      const restartTerminalSession = vi.fn().mockResolvedValue(undefined);
      const readyTerminalState: TerminalSessionState = {
        status: "ready",
        message: "Terminal ready.",
        containerRef: { current: null },
        hasSession: true,
        readyKey: "ws-1:pi-terminal",
        cleanupTerminalSession: vi.fn(),
        getSelection: () => "",
        findNext: vi.fn(() => false),
        findPrevious: vi.fn(() => false),
      };
      const terminalControllerReadyState = {
        terminalTabs: [],
        activeTerminalId: "pi-terminal",
        onSelectTerminal: vi.fn(),
        onNewTerminal: vi.fn(),
        onCloseTerminal: vi.fn(),
        terminalState: readyTerminalState,
        ensureTerminalWithTitle,
        restartTerminalSession,
      } satisfies ReturnType<typeof useTerminalController>;
      vi.mocked(useTerminalController).mockReturnValue({
        ...terminalControllerReadyState,
        activeTerminalId: null,
        terminalState: {
          ...terminalControllerReadyState.terminalState,
          readyKey: null,
        },
      });
      vi.mocked(writeTerminalSession).mockResolvedValue(undefined);

      const context = createContext();
      const { rerender } = renderHook(() =>
        useAppShellWorkspaceFlowsSection(context),
      );

      await act(async () => {
        document.dispatchEvent(
          new CustomEvent("mossx:terminal-command-request", {
            detail: {
              terminalId: "pi-login-openai",
              title: "pi /login openai",
              command: "pi",
              followUpCommand: "/login openai",
              followUpDelayMs: 1500,
            },
          }),
        );
      });

      expect(ensureTerminalWithTitle).toHaveBeenCalledWith(
        "ws-1",
        "pi-login-openai",
        "pi /login openai",
      );
      // 设置页等覆盖层会遮挡终端：处理事件时先退出设置
      expect(context.closeSettings).toHaveBeenCalledTimes(1);
      // 终端 dock 只挂在 workspace 视图内：home 态必须一并关闭，
      // 否则设置关了露出首页、dock 不挂载，命令永远写不进终端
      expect(context.setHomeOpen).toHaveBeenCalledWith(false);
      expect(context.openTerminal).toHaveBeenCalledTimes(1);
      expect(restartTerminalSession).toHaveBeenCalledWith("ws-1", "pi-terminal");

      vi.mocked(useTerminalController).mockReturnValue(
        terminalControllerReadyState,
      );
      await act(async () => {
        rerender();
      });

      expect(writeTerminalSession).toHaveBeenCalledWith(
        "ws-1",
        "pi-terminal",
        "pi\n",
      );

      await act(async () => {
        vi.advanceTimersByTime(1600);
      });
      expect(writeTerminalSession).toHaveBeenCalledWith(
        "ws-1",
        "pi-terminal",
        "/login openai\n",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
