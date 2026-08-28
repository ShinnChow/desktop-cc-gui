import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { writeClientStoreValue } from "../../services/clientStorage";
import { setNotificationActionHandler } from "../../services/systemNotification";
import { useRenameWorktreePrompt } from "../../features/workspaces/hooks/useRenameWorktreePrompt";
import { useClonePrompt } from "../../features/workspaces/hooks/useClonePrompt";
import { useTerminalController } from "../../features/terminal/hooks/useTerminalController";
import { useWorkspaceLaunchScript } from "../../features/app/hooks/useWorkspaceLaunchScript";
import { useWorkspaceRuntimeRun } from "../../features/app/hooks/useWorkspaceRuntimeRun";
import { useWorkspaceLaunchScripts } from "../../features/app/hooks/useWorkspaceLaunchScripts";
import { useWorktreeSetupScript } from "../../features/app/hooks/useWorktreeSetupScript";
import { buildClaudeResumeTerminalCommand } from "../../features/app/utils/claudeResumeCommand";
import {
  TERMINAL_COMMAND_REQUEST_EVENT,
  type TerminalCommandRequest,
} from "../../features/terminal/utils/terminalCommandRequestEvent";
import { archiveWorkspaceSessionsV2 } from "../../services/tauri/sessionManagement";
import { writeTerminalSession } from "../../services/tauri/terminalRuntime";
import type { AgentTaskScrollRequest } from "../../features/messages";
import type {
  AppMode,
  DebugEntry,
  EngineType,
  WorkspaceInfo,
  WorkspaceSettings,
} from "../../types";
import { shouldPreserveEditorOnThreadSelect } from "./threadEditorPreservation";
import { commitThreadSelection } from "./threadSelect/commitThreadSelection";
import {
  type NotificationActionExtra,
  type PendingClaudeTuiOpen,
  type PendingTerminalCommand,
  type ThreadSwitchScope,
  type WorkspaceShellCenterMode,
  type WorkspaceShellSettings,
  type WorkspaceShellTab,
} from "./workspaceFlowsTypes";

const EMPTY_OPEN_APP_ICON_MAP: Record<string, string> = {};

export type WorkspaceShellBoundary = {
  activeEditorFilePath: string | null;
  activeWorkspace: WorkspaceInfo | null;
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  addCloneAgent: (
    workspace: WorkspaceInfo,
    copyName: string,
    copiesFolder: string,
  ) => Promise<WorkspaceInfo | null>;
  addDebugEntry: (entry: DebugEntry) => void;
  alertError: (message: string) => void;
  appSettings: WorkspaceShellSettings;
  clearDraftForThread: (threadId: string) => void;
  closeSettings: () => void;
  closeTerminalPanel: () => void;
  collapseRightPanel: () => void;
  connectWorkspace: (workspace: WorkspaceInfo) => Promise<void>;
  centerMode: WorkspaceShellCenterMode;
  exitDiffView: () => void;
  handleToggleTerminal: () => void;
  isCompact: boolean;
  listThreadsForWorkspaceTracked: (workspace: WorkspaceInfo) => Promise<unknown>;
  openTerminal: () => unknown;
  queueSaveSettings: (
    settings: WorkspaceShellSettings,
  ) => Promise<unknown> | unknown;
  refreshThread: (workspaceId: string, threadId: string) => Promise<unknown> | unknown;
  removeImagesForThread: (threadId: string) => void;
  ensureWorkspaceThreadListLoaded: (
    workspaceId: string,
    options?: { deletedThreadIds?: string[]; localRemovalOnly?: boolean },
  ) => boolean;
  renameWorktree: (workspaceId: string, branch: string) => Promise<WorkspaceInfo>;
  renameWorktreeUpstream: (
    workspaceId: string,
    oldBranch: string,
    newBranch: string,
  ) => Promise<void>;
  resetWorkspaceThreads: (workspaceId: string) => void;
  selectWorkspace: (workspaceId: string) => void;
  setActiveEngine: (engine: EngineType) => Promise<void> | void;
  setActiveTab: Dispatch<SetStateAction<WorkspaceShellTab>>;
  setActiveThreadId: (threadId: string | null, workspaceId: string) => void;
  setAgentTaskScrollRequest: Dispatch<SetStateAction<AgentTaskScrollRequest | null>>;
  setAppMode: Dispatch<SetStateAction<AppMode>>;
  setAppSettings: Dispatch<SetStateAction<WorkspaceShellSettings>>;
  setCenterMode: Dispatch<SetStateAction<WorkspaceShellCenterMode>>;
  setHomeOpen: (open: boolean) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
  terminalOpen: boolean;
  threadsByWorkspace: Record<string, Array<{ id: string; engineSource?: string | null }>>;
  updateWorkspaceSettings: (
    id: string,
    settings: WorkspaceSettings,
  ) => Promise<WorkspaceInfo>;
  workspaces: WorkspaceInfo[];
};

export function useAppShellWorkspaceFlowsSection(
  ctx: WorkspaceShellBoundary,
) {
  const {
    activeWorkspace,
    activeWorkspaceId,
    activeThreadId,
    activeEditorFilePath,
    addCloneAgent,
    addDebugEntry,
    alertError,
    appSettings,
    clearDraftForThread,
    closeSettings,
    closeTerminalPanel,
    collapseRightPanel,
    connectWorkspace,
    centerMode,
    exitDiffView,
    handleToggleTerminal,
    isCompact,
    listThreadsForWorkspaceTracked,
    openTerminal,
    queueSaveSettings,
    refreshThread,
    removeImagesForThread,
    ensureWorkspaceThreadListLoaded,
    renameWorktree,
    renameWorktreeUpstream,
    resetWorkspaceThreads,
    selectWorkspace,
    setActiveEngine,
    setActiveTab,
    setActiveThreadId,
    setAgentTaskScrollRequest,
    setAppMode,
    setAppSettings,
    setCenterMode,
    setHomeOpen,
    t,
    terminalOpen,
    threadsByWorkspace,
    updateWorkspaceSettings,
    workspaces,
  } = ctx;

  const {
    renamePrompt: renameWorktreePrompt,
    notice: renameWorktreeNotice,
    upstreamPrompt: renameWorktreeUpstreamPrompt,
    confirmUpstream: confirmRenameWorktreeUpstream,
    openRenamePrompt: openRenameWorktreePrompt,
    handleRenameChange: handleRenameWorktreeChange,
    handleRenameCancel: handleRenameWorktreeCancel,
    handleRenameConfirm: handleRenameWorktreeConfirm,
  } = useRenameWorktreePrompt({
    workspaces,
    activeWorkspaceId,
    renameWorktree,
    renameWorktreeUpstream,
    onRenameSuccess: (workspace: any) => {
      resetWorkspaceThreads(workspace.id);
      void listThreadsForWorkspaceTracked(workspace);
      if (activeThreadId && activeWorkspaceId === workspace.id) {
        void refreshThread(workspace.id, activeThreadId);
      }
    },
  });

  const handleOpenRenameWorktree = useCallback(() => {
    if (activeWorkspace) {
      openRenameWorktreePrompt(activeWorkspace.id);
    }
  }, [activeWorkspace, openRenameWorktreePrompt]);

  const {
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState,
    ensureTerminalWithTitle,
    restartTerminalSession,
  } = useTerminalController({
    activeWorkspaceId,
    activeWorkspace,
    terminalOpen,
    onCloseTerminalPanel: closeTerminalPanel,
    onDebug: addDebugEntry,
  });

  const ensureLaunchTerminal = useCallback(
    (workspaceId: string) => ensureTerminalWithTitle(workspaceId, "launch", "Launch"),
    [ensureTerminalWithTitle],
  );

  const pendingClaudeTuiOpenRef = useRef<PendingClaudeTuiOpen | null>(null);
  const pendingTerminalCommandRef = useRef<PendingTerminalCommand | null>(null);
  const threadSwitchRequestSeqRef = useRef(0);
  const latestThreadSwitchScopeRef = useRef<ThreadSwitchScope | null>(
    activeWorkspaceId && activeThreadId
      ? { workspaceId: activeWorkspaceId, threadId: activeThreadId }
      : null,
  );

  useEffect(() => {
    latestThreadSwitchScopeRef.current =
      activeWorkspaceId && activeThreadId
        ? { workspaceId: activeWorkspaceId, threadId: activeThreadId }
        : null;
  }, [activeThreadId, activeWorkspaceId]);

  const runLatestThreadSwitchWork = useCallback(
    async <T,>(
      scope: ThreadSwitchScope,
      work: () => Promise<T> | T,
      apply: (value: T) => void,
    ) => {
      const requestId = threadSwitchRequestSeqRef.current;
      const value = await work();
      const latestScope = latestThreadSwitchScopeRef.current;
      const isLatest =
        requestId === threadSwitchRequestSeqRef.current &&
        latestScope?.workspaceId === scope.workspaceId &&
        latestScope?.threadId === scope.threadId;
      if (isLatest) {
        apply(value);
      }
      return isLatest;
    },
    [],
  );

  const handleOpenClaudeTui = useCallback(
    (input: { workspaceId: string; workspacePath: string; sessionId: string }) => {
      const command = buildClaudeResumeTerminalCommand(input.sessionId);
      if (!command) {
        return;
      }
      const terminalId = ensureTerminalWithTitle(
        input.workspaceId,
        `claude-tui:${input.sessionId}`,
        t("terminal.claudeTuiResumeTitle"),
      );
      pendingClaudeTuiOpenRef.current = {
        workspaceId: input.workspaceId,
        terminalId,
        command,
      };
      openTerminal();
      void restartTerminalSession(input.workspaceId, terminalId).catch((error) => {
        pendingClaudeTuiOpenRef.current = null;
        addDebugEntry({
          id: `${Date.now()}-claude-tui-resume-terminal-error`,
          timestamp: Date.now(),
          source: "error",
          label: "claude tui resume terminal error",
          payload: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [addDebugEntry, ensureTerminalWithTitle, openTerminal, restartTerminalSession, t],
  );

  useEffect(() => {
    const pending = pendingClaudeTuiOpenRef.current;
    const pendingKey = pending
      ? `${pending.workspaceId}:${pending.terminalId}`
      : null;
    if (
      !pending ||
      terminalState?.readyKey !== pendingKey ||
      activeTerminalId !== pending.terminalId ||
      activeWorkspace?.id !== pending.workspaceId
    ) {
      return;
    }
    pendingClaudeTuiOpenRef.current = null;
    writeTerminalSession(
      pending.workspaceId,
      pending.terminalId,
      `${pending.command}\n`,
    ).catch((error) => {
      addDebugEntry({
        id: `${Date.now()}-claude-tui-resume-write-error`,
        timestamp: Date.now(),
        source: "error",
        label: "claude tui resume write error",
        payload: error instanceof Error ? error.message : String(error),
      });
    });
  }, [activeTerminalId, activeWorkspace?.id, addDebugEntry, terminalState?.readyKey]);

  useEffect(() => {
    const onTerminalCommandRequest = (event: Event) => {
      const detail = (event as CustomEvent<TerminalCommandRequest>).detail;
      if (!detail?.command || !detail.terminalId) {
        return;
      }
      if (!activeWorkspace) {
        addDebugEntry({
          id: `${Date.now()}-terminal-command-no-workspace`,
          timestamp: Date.now(),
          source: "error",
          label: "terminal command request without active workspace",
          payload: `${detail.terminalId}: ${detail.command}`,
        });
        return;
      }
      closeSettings();
      // 终端 dock 只挂在 workspace 视图（showWorkspace）内：home 态下仅关设置
      // 会露出首页且 dock 不挂载，xterm 永不 ready，命令写不进去（PI /login 断链根因）。
      setHomeOpen(false);
      const terminalId = ensureTerminalWithTitle(
        activeWorkspace.id,
        detail.terminalId,
        detail.title,
      );
      pendingTerminalCommandRef.current = {
        workspaceId: activeWorkspace.id,
        terminalId,
        command: detail.command,
        followUpCommand: detail.followUpCommand,
        followUpDelayMs: detail.followUpDelayMs,
      };
      openTerminal();
      void restartTerminalSession(activeWorkspace.id, terminalId).catch((error) => {
        pendingTerminalCommandRef.current = null;
        addDebugEntry({
          id: `${Date.now()}-terminal-command-restart-error`,
          timestamp: Date.now(),
          source: "error",
          label: "terminal command restart error",
          payload: error instanceof Error ? error.message : String(error),
        });
      });
    };
    document.addEventListener(
      TERMINAL_COMMAND_REQUEST_EVENT,
      onTerminalCommandRequest,
    );
    return () =>
      document.removeEventListener(
        TERMINAL_COMMAND_REQUEST_EVENT,
        onTerminalCommandRequest,
      );
  }, [
    activeWorkspace,
    addDebugEntry,
    closeSettings,
    ensureTerminalWithTitle,
    openTerminal,
    restartTerminalSession,
    setHomeOpen,
  ]);

  useEffect(() => {
    const pending = pendingTerminalCommandRef.current;
    const pendingKey = pending
      ? `${pending.workspaceId}:${pending.terminalId}`
      : null;
    if (
      !pending ||
      terminalState?.readyKey !== pendingKey ||
      activeTerminalId !== pending.terminalId ||
      activeWorkspace?.id !== pending.workspaceId
    ) {
      return;
    }
    pendingTerminalCommandRef.current = null;
    const reportWriteError = (stage: string) => (error: unknown) => {
      addDebugEntry({
        id: `${Date.now()}-terminal-command-write-error-${stage}`,
        timestamp: Date.now(),
        source: "error",
        label: `terminal command write error (${stage})`,
        payload: error instanceof Error ? error.message : String(error),
      });
    };
    writeTerminalSession(
      pending.workspaceId,
      pending.terminalId,
      `${pending.command}\n`,
    )
      .then(() => {
        if (!pending.followUpCommand) {
          return;
        }
        window.setTimeout(() => {
          writeTerminalSession(
            pending.workspaceId,
            pending.terminalId,
            `${pending.followUpCommand}\n`,
          ).catch(reportWriteError("follow-up"));
        }, pending.followUpDelayMs ?? 1500);
      })
      .catch(reportWriteError("initial"));
  }, [activeTerminalId, activeWorkspace?.id, addDebugEntry, terminalState?.readyKey]);

  const launchScriptState = useWorkspaceLaunchScript({
    activeWorkspace,
    updateWorkspaceSettings,
    openTerminal,
    ensureLaunchTerminal,
    restartLaunchSession: restartTerminalSession,
    terminalState,
    activeTerminalId,
  });

  const runtimeRunState = useWorkspaceRuntimeRun({ activeWorkspace });
  const {
    onCloseRuntimeConsole,
    onOpenRuntimeConsole,
    runtimeConsoleVisible,
  } = runtimeRunState;

  const handleToggleRuntimeConsole = useCallback(() => {
    if (runtimeConsoleVisible) {
      onCloseRuntimeConsole();
      return;
    }
    closeTerminalPanel();
    onOpenRuntimeConsole();
  }, [closeTerminalPanel, onCloseRuntimeConsole, onOpenRuntimeConsole, runtimeConsoleVisible]);

  const handleToggleTerminalPanel = useCallback(() => {
    if (terminalOpen) {
      onCloseRuntimeConsole();
    }
    handleToggleTerminal();
  }, [handleToggleTerminal, onCloseRuntimeConsole, terminalOpen]);

  useEffect(() => {
    if (!terminalOpen || !runtimeConsoleVisible) {
      return;
    }
    closeTerminalPanel();
  }, [closeTerminalPanel, runtimeConsoleVisible, terminalOpen]);

  const launchScriptsState = useWorkspaceLaunchScripts({
    activeWorkspace,
    updateWorkspaceSettings,
    openTerminal,
    ensureLaunchTerminal: (workspaceId, entry, title) => {
      const label = entry.label?.trim() || entry.icon;
      return ensureTerminalWithTitle(
        workspaceId,
        `launch:${entry.id}`,
        title || `Launch ${label}`,
      );
    },
    restartLaunchSession: restartTerminalSession,
    terminalState,
    activeTerminalId,
  });

  const worktreeSetupScriptState = useWorktreeSetupScript({
    ensureTerminalWithTitle,
    restartTerminalSession,
    openTerminal,
    onDebug: addDebugEntry,
  });

  const handleWorktreeCreated = useCallback(
    async (worktree: any, _parentWorkspace?: any) => {
      await worktreeSetupScriptState.maybeRunWorktreeSetupScript(worktree);
    },
    [worktreeSetupScriptState],
  );

  const resolveCloneProjectContext = useCallback(
    (workspace: any) => {
      const groupId = workspace.settings.groupId ?? null;
      const group = groupId
        ? appSettings.workspaceGroups.find((entry: any) => entry.id === groupId)
        : null;
      return {
        groupId,
        copiesFolder: group?.copiesFolder ?? null,
      };
    },
    [appSettings.workspaceGroups],
  );

  const handleSelectOpenAppId = useCallback(
    (id: string) => {
      writeClientStoreValue("app", "openWorkspaceApp", id);
      setAppSettings((current: any) => {
        if (current.selectedOpenAppId === id) {
          return current;
        }
        const nextSettings = {
          ...current,
          selectedOpenAppId: id,
        };
        void queueSaveSettings(nextSettings);
        return nextSettings;
      });
    },
    [queueSaveSettings, setAppSettings],
  );

  const navigateToThreadWithUiOptions = useCallback(
    (
      workspaceId: string,
      threadId: string,
      options: {
        collapseRightPanel?: boolean;
      } = {},
    ) => {
      const { collapseRightPanel: shouldCollapseRightPanel = true } = options;
      threadSwitchRequestSeqRef.current += 1;
      latestThreadSwitchScopeRef.current = { workspaceId, threadId };
      const preserveEditor = shouldPreserveEditorOnThreadSelect({
        isCompact,
        centerMode,
        activeWorkspaceId,
        targetWorkspaceId: workspaceId,
        activeEditorFilePath,
      });
      const threads = threadsByWorkspace[workspaceId] ?? [];
      const targetThread = threads.find((entry: any) => entry.id === threadId);
      commitThreadSelection(
        {
          workspaceId,
          threadId,
        },
        {
          selectWorkspace,
          setActiveThreadId,
        },
        {
          preserveEditor,
          requestedCollapseRightPanel: shouldCollapseRightPanel,
          engineSource: targetThread?.engineSource,
          threadId,
        },
        {
          exitDiffView,
          setAppMode,
          setActiveTab,
          setHomeOpen,
          collapseRightPanel,
          setActiveEngine,
        },
      );
    },
    [
      activeEditorFilePath,
      activeWorkspaceId,
      centerMode,
      exitDiffView,
      collapseRightPanel,
      isCompact,
      selectWorkspace,
      setActiveEngine,
      setActiveTab,
      setActiveThreadId,
      setAppMode,
      setHomeOpen,
      threadsByWorkspace,
    ],
  );

  const navigateToThread = useCallback(
    (workspaceId: string, threadId: string) => {
      navigateToThreadWithUiOptions(workspaceId, threadId);
    },
    [navigateToThreadWithUiOptions],
  );

  useEffect(() => {
    setNotificationActionHandler((extra: NotificationActionExtra) => {
      const workspaceId = typeof extra.workspaceId === "string" ? extra.workspaceId : undefined;
      const threadId = typeof extra.threadId === "string" ? extra.threadId : undefined;
      if (workspaceId && threadId) {
        navigateToThread(workspaceId, threadId);
      }
    });
    return () => {
      setNotificationActionHandler(null);
    };
  }, [navigateToThread]);

  const handleOpenMailSession = useCallback(
    (target: {
      sessionId: string;
      workspaceId: string;
      threadId: string;
      turnId: string;
    }) => {
      const workspace =
        workspaces.find((entry) => entry.id === target.workspaceId) ?? null;
      const threadId = target.threadId?.trim();
      if (!workspace || !threadId) {
        alertError(t("settings.emailOpenSessionUnavailable"));
        return;
      }
      closeSettings();
      navigateToThread(target.workspaceId, threadId);
      const hasThread = (threadsByWorkspace[target.workspaceId] ?? []).some(
        (thread) => thread.id === threadId,
      );
      if (!hasThread) {
        void listThreadsForWorkspaceTracked(workspace).catch((error) => {
          addDebugEntry({
            id: `${Date.now()}-email-mail-session-open-fallback-error`,
            timestamp: Date.now(),
            source: "error",
            label: "email/mail-session open fallback",
            payload: error instanceof Error ? error.message : String(error),
          });
        });
      }
    },
    [
      addDebugEntry,
      alertError,
      closeSettings,
      listThreadsForWorkspaceTracked,
      navigateToThread,
      t,
      threadsByWorkspace,
      workspaces,
    ],
  );

  const handleSelectStatusPanelSubagent = useCallback(
    (agent: any) => {
      const target = agent.navigationTarget;
      if (!target) {
        return;
      }
      if (target.kind === "thread") {
        if (!activeWorkspaceId) {
          return;
        }
        navigateToThreadWithUiOptions(activeWorkspaceId, target.threadId, {
          collapseRightPanel: false,
        });
        return;
      }
      if (target.kind === "claude-task") {
        exitDiffView();
        setAppMode("chat");
        setCenterMode("chat");
        setActiveTab("codex");
        setAgentTaskScrollRequest({
          nonce: Date.now(),
          taskId: target.taskId ?? null,
          toolUseId: target.toolUseId ?? null,
        });
      }
    },
    [
      activeWorkspaceId,
      exitDiffView,
      navigateToThreadWithUiOptions,
      setActiveTab,
      setAgentTaskScrollRequest,
      setAppMode,
      setCenterMode,
    ],
  );

  const openAppIconById = EMPTY_OPEN_APP_ICON_MAP;

  const persistProjectCopiesFolder = useCallback(
    async (groupId: string, copiesFolder: string) => {
      await queueSaveSettings({
        ...appSettings,
        workspaceGroups: appSettings.workspaceGroups.map((entry: any) =>
          entry.id === groupId ? { ...entry, copiesFolder } : entry,
        ),
      });
    },
    [appSettings, queueSaveSettings],
  );

  const {
    clonePrompt,
    openPrompt: openClonePrompt,
    confirmPrompt: confirmClonePrompt,
    cancelPrompt: cancelClonePrompt,
    updateCopyName: updateCloneCopyName,
    chooseCopiesFolder: chooseCloneCopiesFolder,
    useSuggestedCopiesFolder: useSuggestedCloneCopiesFolder,
    clearCopiesFolder: clearCloneCopiesFolder,
  } = useClonePrompt({
    addCloneAgent,
    connectWorkspace,
    onSelectWorkspace: selectWorkspace,
    resolveProjectContext: resolveCloneProjectContext,
    persistProjectCopiesFolder,
    onCompactActivate: isCompact ? () => setActiveTab("codex") : undefined,
    onError: (message) => {
      addDebugEntry({
        id: `${Date.now()}-client-add-clone-error`,
        timestamp: Date.now(),
        source: "error",
        label: "clone/add error",
        payload: message,
      });
    },
  });

  // 归档快捷键（archiveThread）：metadata soft-archive，不是删除。
  // OpenSpec change：redesign-session-archive-fast-path。
  const handleArchiveActiveThread = useCallback(async () => {
    if (!activeWorkspaceId || !activeThreadId) {
      return;
    }
    const workspaceId = activeWorkspaceId;
    const threadId = activeThreadId;
    try {
      const response = await archiveWorkspaceSessionsV2(workspaceId, [
        { threadId },
      ]);
      const mutationResult =
        response.results.find((result) => result.sessionId === threadId) ??
        (response.results.length === 1 ? response.results[0] : undefined);
      if (!mutationResult?.ok) {
        throw new Error(
          mutationResult?.error ?? t("workspace.archiveConversationFailed"),
        );
      }
      setActiveThreadId(null, workspaceId);
      ensureWorkspaceThreadListLoaded(workspaceId, {
        deletedThreadIds: [threadId],
        localRemovalOnly: true,
      });
      clearDraftForThread(threadId);
      removeImagesForThread(threadId);
    } catch (error: unknown) {
      alertError(error instanceof Error ? error.message : String(error));
    }
  }, [
    activeThreadId,
    activeWorkspaceId,
    alertError,
    clearDraftForThread,
    ensureWorkspaceThreadListLoaded,
    removeImagesForThread,
    setActiveThreadId,
    t,
  ]);

  return {
    renameWorktreePrompt,
    renameWorktreeNotice,
    renameWorktreeUpstreamPrompt,
    confirmRenameWorktreeUpstream,
    openRenameWorktreePrompt,
    handleOpenRenameWorktree,
    handleRenameWorktreeChange,
    handleRenameWorktreeCancel,
    handleRenameWorktreeConfirm,
    terminalTabs,
    activeTerminalId,
    onSelectTerminal,
    onNewTerminal,
    onCloseTerminal,
    terminalState,
    ensureLaunchTerminal,
    ensureTerminalWithTitle,
    restartTerminalSession,
    launchScriptState,
    runtimeRunState,
    handleToggleRuntimeConsole,
    handleToggleTerminalPanel,
    launchScriptsState,
    worktreeSetupScriptState,
    handleWorktreeCreated,
    resolveCloneProjectContext,
    handleSelectOpenAppId,
    runLatestThreadSwitchWork,
    navigateToThread,
    handleOpenMailSession,
    handleOpenClaudeTui,
    handleSelectStatusPanelSubagent,
    openAppIconById,
    persistProjectCopiesFolder,
    clonePrompt,
    openClonePrompt,
    confirmClonePrompt,
    cancelClonePrompt,
    updateCloneCopyName,
    chooseCloneCopiesFolder,
    useSuggestedCloneCopiesFolder,
    clearCloneCopiesFolder,
    handleArchiveActiveThread,
  };
}
