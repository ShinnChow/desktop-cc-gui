import {
  lazy,
  Profiler,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ProfilerOnRenderCallback,
} from "react";
import { useEventCallback } from "../../../utils/useEventCallback";
import { useSidebarThreadStatusProjection } from "../../threads/hooks/useSidebarThreadStatusProjection";
import { useTranslation } from "react-i18next";
import { Sidebar } from "../../app/components/Sidebar";
import { HomeChat } from "../../home/components/HomeChat";
import { MainHeader } from "../../app/components/MainHeader";
import {
  CODEX_DISK_PROVIDER_PROFILE_ID,
  type CodexProviderProfileSelection,
  type CodexProviderProfileOption,
} from "../../threads/constants/codexProviderProfiles";
import { isManagedEngineProviderProfileId } from "../../threads/hooks/sessionLifecycleController";
import { UpdateToast } from "../../update/components/UpdateToast";
import { ErrorToasts } from "../../notifications/components/ErrorToasts";
import { GlobalRuntimeNoticeDock } from "../../notifications/components/GlobalRuntimeNoticeDock";
import type {
  ComposerNoteCardSelectionRequest,
  ComposerRewindDialogRequest,
} from "../../composer/components/Composer";
import { GitDiffViewer } from "../../git/components/GitDiffViewer";
import { buildCanonicalGitChanges } from "../../git/utils/gitChangeModel";
import {
  publishGitRepositoryActionIntent,
  type GitRepositoryActionRequest,
} from "../../git/types/gitRepositoryActions";
import type { GitModalPreviewRequest } from "../../git/components/GitDiffPanelTypes";
import {
  FileTreePanel,
  type FileTreeRevealRequest,
} from "../../files/components/FileTreePanel";
import { WorkspaceFileComparePanel } from "../../files/components/WorkspaceFileComparePanel";
import { WorkspaceSearchPanel } from "../../search/components/WorkspaceSearchPanel";
import { PromptPanel } from "../../prompts/components/PromptPanel";
import { ProjectMemoryPanel } from "../../project-memory/components/ProjectMemoryPanel";
import type {
  CanvasSemanticGraph,
  IntentCanvasCodeSelectionAnchor,
} from "../../intent-canvas/types";
import { pushErrorToast } from "../../../services/toasts";
import {
  buildGitStatusProjectMapImpactInput,
  type ProjectMapImpactInput,
} from "../../project-map/utils/impactSources";
import { WorkspaceNoteCardPanel } from "../../note-cards/components/WorkspaceNoteCardPanel";
import type {
  NoteCaptureDraft,
  WorkspaceNoteCaptureRequest,
} from "../../note-cards/types";
import { WorkspaceSessionRadarPanel } from "../../session-activity/components/WorkspaceSessionRadarPanel";
import { TabBar } from "../../app/components/TabBar";
import { TabletNav } from "../../app/components/TabletNav";
import { useGlobalRuntimeNoticeDock } from "../../notifications/hooks/useGlobalRuntimeNoticeDock";
import type { EditorNavigationLocation } from "../../app/hooks/useGitPanelController";
import type {
  CustomCommandOption,
  EngineType,
  RequestUserInputRequest,
  ThreadSummary,
} from "../../../types";
import { __profile as threadsRuntimeProfile } from "../../threads/hooks/useThreadsReducer";
import { getClientStoreSync } from "../../../services/clientStorage";
import {
  getCodexProviders,
  type WorkspaceNoteCard,
  type WorkspaceNoteCardSource,
} from "../../../services/tauri";
import { normalizeSpecRootInput } from "../../spec/pathUtils";
import type {
  CodeAnnotationBridgeProps,
  CodeAnnotationDraftInput,
  CodeAnnotationSelection,
} from "../../code-annotations/types";
import {
  buildCodeAnnotationDedupeKey,
  createCodeAnnotationSelection,
} from "../../code-annotations/utils/codeAnnotations";
import type {
  ConversationEngine,
  ConversationState,
} from "../../threads/contracts/conversationCurtainContracts";
import { resolveDiffPathFromWorkspacePath } from "../../../utils/workspacePaths";
import { resolvePresentationProfile } from "../../../conversation-presentation/presentationProfile";
import { appendQueuedHandoffBubbleIfNeeded } from "../../threads/utils/queuedHandoffBubble";
// DISABLED: disable-session-activity-and-solo-mode — keep empty stub only
import { DISABLED_WORKSPACE_SESSION_ACTIVITY } from "../../session-activity/adapters/buildWorkspaceSessionActivity";
import { useClientUiVisibility } from "../../client-ui-visibility/hooks/useClientUiVisibility";
import {
  getHomeWorkspaceOptions,
  resolveHomeWorkspaceId,
} from "../../home/utils/homeWorkspaceOptions";
import { deriveRewindWorkspaceGitState } from "./rewindWorkspaceGitState";
import { buildWorkspaceHeaderGroups } from "./workspaceHeaderGroups";
import { loadCodeSelectionRelationshipGraph } from "./codeSelectionRelationshipGraph";
import { resolveRuntimeLifecycleForComposer } from "./runtimeLifecycle";
import { focusUserInputRequestCard } from "./userInputRequestFocus";
import { dispatchMessageJumpEvent } from "./messageJumpEvent";
import {
  EMPTY_ACTIVE_CANVAS_APPROVALS,
  EMPTY_ACTIVE_CANVAS_CHILD_SUBAGENT_THREADS,
  EMPTY_ACTIVE_CANVAS_ITEMS,
  EMPTY_ACTIVE_CANVAS_NATIVE_THREAD_IDS,
  EMPTY_ACTIVE_CANVAS_USER_INPUT_REQUESTS,
  setActiveCanvasSnapshot,
  stabilizeListByMemberIdentity,
  type ActiveCanvasSnapshot,
} from "./activeCanvasStore";
import { ActiveCanvasComposer } from "./activeCanvasComposerNode";
import { SharedSendStatusBar } from "../../shared-session/components/SharedSendStatusBar";
import { ProviderContinuationContextCard } from "../../shared-session/components/ProviderContinuationContextCard";
import { buildProviderContinuationSourceExcerpt } from "../../shared-session/components/providerContinuationSourceExcerpt";
import { useSharedSendState } from "../../shared-session/runtime/sharedSendStateStore";
import { useSharedSendStateRestore } from "../../shared-session/runtime/useSharedSendStateRestore";
import {
  isComposerInputLocked,
  isComposerSubmitLocked,
  isPickerLocked,
} from "../../shared-session/target/sendStateMachine";
import { buildShellRuntimeSummary } from "./layoutShellSummary";
import { buildConversationCanvasNode } from "./conversationCanvasNode";
import { CollabTimelineWaiting } from "../../multi-agent/components/CollabTimelineWaiting";
import { useCollabUiState } from "../../multi-agent/store/collabUiStore";
import { SharedProviderRetryHint } from "../../shared-session/provider-retry/SharedProviderRetryHint";
import { useSharedProviderRetry } from "../../shared-session/provider-retry/useSharedProviderRetry";
import { resolveIsSharedSession } from "../../shared-session/utils/sharedSessionIdentity";
import { useLayoutTopbarSessionTabs } from "./useLayoutTopbarSessionTabs";
import {
  consumePiThreadJump,
  usePiThreadJumpRequest,
} from "../../pi-session/store/piSessionStore";
import {
  buildCompactEmptyNode,
  buildCompactGitBackNode,
  buildDebugPanelNodes,
  buildDesktopTopbarLeftNode,
  buildRightPanelToolbarNode,
  buildTerminalDockNode,
} from "./layoutNodeSections";

const GitDiffPanel = lazy(() =>
  import("../../git/components/GitDiffPanel").then((m) => ({
    default: m.GitDiffPanel,
  })),
);
const FileViewPanel = lazy(() =>
  import("../../files/components/FileViewPanel").then((m) => ({
    default: m.FileViewPanel,
  })),
);
const BrowserDock = lazy(() =>
  import("../../browser-agent/components/BrowserDock").then((m) => ({
    default: m.BrowserDock,
  })),
);
const ProjectMapPanel = lazy(() =>
  import("../../project-map/components/ProjectMapPanel").then((m) => ({
    default: m.ProjectMapPanel,
  })),
);
const IntentCanvasManager = lazy(() =>
  import("../../intent-canvas/components/IntentCanvasManager").then((m) => ({
    default: m.IntentCanvasManager,
  })),
);

function HeavyPanelFallback() {
  return <div className="heavy-panel-fallback" aria-hidden="true" />;
}

import type {
  LayoutNodesFlatOptions,
  LayoutNodesOptions,
  LayoutNodesResult,
  RightPanelTabSelection,
} from "./layoutNodesTypes";
const EMPTY_COMMANDS: CustomCommandOption[] = [];
const EMPTY_PROJECT_MAP_IMPACT_INPUT: ProjectMapImpactInput = {
  filePaths: [],
  source: {
    kind: "none",
    label: "No impact source",
    fileCount: 0,
  },
};

function toConversationEngine(
  engine: EngineType | undefined,
): ConversationEngine {
  if (
    engine === "claude" ||
    engine === "gemini" ||
    engine === "grok" ||
    engine === "kimi" ||
    engine === "opencode" ||
    engine === "dsh" ||
    engine === "qoder" ||
    engine === "pi"
  ) {
    return engine;
  }
  return "codex";
}

function inferConversationEngineFromThreadId(
  threadId: string | null | undefined,
): ConversationEngine | null {
  const normalizedThreadId = threadId?.trim().toLowerCase();
  if (!normalizedThreadId) {
    return null;
  }

  if (
    normalizedThreadId.startsWith("claude:") ||
    normalizedThreadId.startsWith("claude-pending-")
  ) {
    return "claude";
  }
  if (
    normalizedThreadId.startsWith("gemini:") ||
    normalizedThreadId.startsWith("gemini-pending-")
  ) {
    return "gemini";
  }
  if (
    normalizedThreadId.startsWith("grok:") ||
    normalizedThreadId.startsWith("grok-pending-")
  ) {
    return "grok";
  }
  if (
    normalizedThreadId.startsWith("kimi:") ||
    normalizedThreadId.startsWith("kimi-pending-")
  ) {
    return "kimi";
  }
  if (
    normalizedThreadId.startsWith("pi:") ||
    normalizedThreadId.startsWith("pi-pending-")
  ) {
    return "pi";
  }
  if (
    normalizedThreadId.startsWith("opencode:") ||
    normalizedThreadId.startsWith("opencode-pending-")
  ) {
    return "opencode";
  }
  if (
    normalizedThreadId.startsWith("dsh:") ||
    normalizedThreadId.startsWith("dsh-pending-")
  ) {
    return "dsh";
  }
  if (
    normalizedThreadId.startsWith("qoder:") ||
    normalizedThreadId.startsWith("qoder-pending-")
  ) {
    return "qoder";
  }
  if (
    normalizedThreadId.startsWith("codex:") ||
    normalizedThreadId.startsWith("codex-pending-")
  ) {
    return "codex";
  }

  return null;
}

function resolveActiveConversationEngine(
  activeThreadSummary: ThreadSummary | null,
  activeThreadId: string | null,
  selectedEngine: EngineType | undefined,
): ConversationEngine {
  const threadEngine =
    activeThreadSummary?.selectedEngine ??
    activeThreadSummary?.engineSource ??
    inferConversationEngineFromThreadId(activeThreadId);
  return toConversationEngine(threadEngine ?? selectedEngine);
}

/**
 * 收集当前 canvas 会话的「子代理线程」。
 *
 * - parent 直接挂到 activeId 的行（grok 等 Shared remap 后的子行）
 * - Shared 父：`claude:subagent:{owner}:{agentId}` 行 parentThreadId 为空，
 *   owner 命中该 Shared 的 nativeThreadIds 即视为子代理
 *   （与侧栏树对 claude:subagent id 的解析口径一致）。
 */
export function collectCanvasChildSubagentThreads(
  activeId: string | null | undefined,
  workspaceId: string | null | undefined,
  threads: readonly ThreadSummary[] | undefined,
  threadParentById: Record<string, string>,
  nativeThreadIds: readonly string[] | undefined,
): ThreadSummary[] {
  if (!activeId || !workspaceId || !threads) {
    return [];
  }
  const isSharedParent = activeId.startsWith("shared:");
  const owners = isSharedParent
    ? (nativeThreadIds ?? []).filter((id) => id.trim().length > 0)
    : [];
  return threads.filter((thread) => {
    // pi fork 派生会话不是子代理：pi 没有 subagent 概念，parentThreadId 在 pi
    // 语义里是会话分支（fork-to-new-file），分支归属由会话树单独控制，
    // 不计入子代理（capability-router-allow-engine-branch：pi 分域，见
    // enhance-pi-native-rpc-session）。
    if (thread.engineSource === "pi" || thread.id.startsWith("pi:")) {
      return false;
    }
    const parent =
      thread.parentThreadId ?? threadParentById[thread.id] ?? null;
    if (parent === activeId) {
      return true;
    }
    if (owners.length === 0) {
      return false;
    }
    return owners.some((owner) => {
      const bare = owner.startsWith("claude:")
        ? owner.slice("claude:".length)
        : owner;
      return (
        thread.id.startsWith(`claude:subagent:${owner}:`) ||
        thread.id.startsWith(`claude:subagent:${bare}:`)
      );
    });
  });
}

function flattenLayoutNodesOptions(
  options: LayoutNodesOptions,
): LayoutNodesFlatOptions {
  return {
    ...options.workspace,
    ...options.runtime,
    ...options.chrome,
    ...options.editor,
    ...options.git,
    ...options.composer,
    ...options.panels,
  };
}

export function useLayoutNodes(input: LayoutNodesOptions): LayoutNodesResult {
  const options = flattenLayoutNodesOptions(input);
  const { t } = useTranslation();
  const clientUiVisibility = useClientUiVisibility();
  const onOpenFile = options.onOpenFile;
  const onFilePanelModeChange = options.onFilePanelModeChange;
  const [rewindDialogRequest, setRewindDialogRequest] =
    useState<ComposerRewindDialogRequest | null>(null);
  const [forkConfirmUserMessageId, setForkConfirmUserMessageId] = useState<
    string | null
  >(null);
  const [codexProviderProfiles, setCodexProviderProfiles] = useState<
    CodexProviderProfileOption[]
  >([]);
  const [noteCardSelectionRequest, setNoteCardSelectionRequest] =
    useState<ComposerNoteCardSelectionRequest | null>(null);
  const [homeCreationTargetEngine, setHomeCreationTargetEngineState] =
    useState<EngineType | null>(null);
  // 幂等：Composer 创建态会在 effect 中回写 engine，等价值禁止触发父树重渲染
  const setHomeCreationTargetEngine = useCallback(
    (next: EngineType | null) => {
      setHomeCreationTargetEngineState((prev) => (prev === next ? prev : next));
    },
    [],
  );
  const [gitModalPreviewRequest, setGitModalPreviewRequest] =
    useState<GitModalPreviewRequest | null>(null);
  const [gitModeControlsTarget, setGitModeControlsTarget] =
    useState<HTMLDivElement | null>(null);
  const [fileTreeRevealRequest, setFileTreeRevealRequest] =
    useState<FileTreeRevealRequest | null>(null);
  const rewindDialogRequestSerialRef = useRef(0);
  const noteCardSelectionRequestSerialRef = useRef(0);
  const gitModalPreviewRequestSerialRef = useRef(0);
  const fileTreeRevealRequestSerialRef = useRef(0);
  const handleRevealInFileTree = useCallback(
    (path: string) => {
      const workspaceId = options.activeWorkspace?.id;
      if (!workspaceId) {
        return;
      }
      onFilePanelModeChange("files");
      fileTreeRevealRequestSerialRef.current += 1;
      setFileTreeRevealRequest({
        workspaceId,
        path,
        requestId: fileTreeRevealRequestSerialRef.current,
      });
    },
    [onFilePanelModeChange, options.activeWorkspace?.id],
  );
  const historyRetryInFlightRef = useRef<Promise<unknown> | null>(null);
  const activeThreadStatus = options.activeThreadId
    ? (options.threadStatusById[options.activeThreadId] ?? null)
    : null;
  const activeThreadSummary =
    options.activeWorkspaceId && options.activeThreadId
      ? ((options.threadsByWorkspace[options.activeWorkspaceId] ?? []).find(
          (thread) => thread.id === options.activeThreadId,
        ) ?? null)
      : null;
  useEffect(() => {
    let cancelled = false;
    getCodexProviders()
      .then((providers) => {
        if (cancelled) {
          return;
        }
        setCodexProviderProfiles(
          providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            source: "managed",
          })),
        );
      })
      .catch(() => {
        if (!cancelled) {
          setCodexProviderProfiles([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const historyRestoredAtMsByThread = options.historyRestoredAtMsByThread ?? {};
  const activeHistoryRestoredAtMs = options.activeThreadId
    ? (historyRestoredAtMsByThread[options.activeThreadId] ?? null)
    : null;
  const activeThreadHistoryLoading = options.activeThreadId
    ? options.historyLoadingByThreadId[options.activeThreadId] === true
    : false;
  const activeThreadHistoryLoadingProgress =
    options.activeThreadId && activeThreadHistoryLoading
      ? options.historyLoadingProgressByThreadId?.[options.activeThreadId] ??
        null
      : null;
  const activeThreadHistoryRecoveryFailureReason =
    options.activeThreadId &&
    options.historyLoadingByThreadId[options.activeThreadId] === "failed"
      ? "history-empty-after-retry"
      : null;
  const handleRetryHistory = useEventCallback(() => {
    if (
      !options.activeWorkspaceId ||
      !options.activeThreadId ||
      !options.onRecoverThreadRuntime ||
      historyRetryInFlightRef.current
    ) {
      return;
    }
    const retry = Promise.resolve(
      options.onRecoverThreadRuntime(
        options.activeWorkspaceId,
        options.activeThreadId,
      ),
    );
    historyRetryInFlightRef.current = retry;
    const clearRetry = () => {
      if (historyRetryInFlightRef.current === retry) {
        historyRetryInFlightRef.current = null;
      }
    };
    void retry.then(clearRetry, clearRetry);
  });
  const showMessageAnchors =
    options.showMessageAnchors &&
    clientUiVisibility.isControlVisible("cornerStatus.messageAnchors");
  const showTopSessionTabs =
    clientUiVisibility.isPanelVisible("topSessionTabs");
  const showTopRunControls =
    clientUiVisibility.isControlVisible("topRun.start");
  const showOpenWorkspaceAppControl = clientUiVisibility.isControlVisible(
    "topTool.openWorkspace",
  );
  const showRightActivityToolbar = clientUiVisibility.isPanelVisible(
    "rightActivityToolbar",
  );
  const conversationEngine = useMemo(
    () =>
      resolveActiveConversationEngine(
        activeThreadSummary,
        options.activeThreadId,
        options.selectedEngine,
      ),
    [activeThreadSummary, options.activeThreadId, options.selectedEngine],
  );
  // 树面板「↪ 跳转」请求消费（store 中转，panel 无布局上下文）。
  const piThreadJumpRequest = usePiThreadJumpRequest();
  const onSelectThread = options.onSelectThread;
  useEffect(() => {
    if (piThreadJumpRequest) {
      onSelectThread(
        piThreadJumpRequest.workspaceId,
        piThreadJumpRequest.threadId,
      );
      consumePiThreadJump();
    }
  }, [piThreadJumpRequest, onSelectThread]);
  const rightToolbarVisibleTabs = useMemo(
    () => ({
      // Kill-switched: never show activity entry even if client UI visibility allows it.
      activity: false as const,
      projectMap: clientUiVisibility.isControlVisible("rightToolbar.projectMap"),
      radar: clientUiVisibility.isControlVisible("rightToolbar.radar"),
      git: clientUiVisibility.isControlVisible("rightToolbar.git"),
      files: clientUiVisibility.isControlVisible("rightToolbar.files"),
      search: clientUiVisibility.isControlVisible("rightToolbar.search"),
      notes: clientUiVisibility.isControlVisible("rightToolbar.notes"),
    }),
    [clientUiVisibility],
  );
  const hasVisibleRightToolbarControl = Object.values(
    rightToolbarVisibleTabs,
  ).some(Boolean);
  const showGlobalRuntimeNoticeDock = clientUiVisibility.isPanelVisible(
    "globalRuntimeNoticeDock",
  );
  const shellRuntimeSummary = useMemo(
    () =>
      buildShellRuntimeSummary({
        activeWorkspaceId: options.activeWorkspaceId,
        activeThreadId: options.activeThreadId,
        activeItems: options.activeItems,
        activeThreadStatus,
      }),
    [
      activeThreadStatus,
      options.activeItems,
      options.activeThreadId,
      options.activeWorkspaceId,
    ],
  );
  const isThreadThinking = shellRuntimeSummary.isActiveThreadProcessing;
  const fileRenderPressure = useMemo(
    () => ({
      engineProcessing: isThreadThinking,
      editorSplitChatVisible:
        options.centerMode === "editor" && !options.isEditorFileMaximized,
      activeSurface: "editor" as const,
    }),
    [isThreadThinking, options.centerMode, options.isEditorFileMaximized],
  );
  // Keep heartbeatPulse in a ref so conversationState doesn't change
  // on every heartbeat tick — heartbeat only affects WorkingIndicator
  // which receives it as a separate prop via Messages.
  const heartbeatPulseRef = useRef(activeThreadStatus?.heartbeatPulse ?? null);
  heartbeatPulseRef.current = activeThreadStatus?.heartbeatPulse ?? null;
  const conversationItems = useMemo(
    () =>
      appendQueuedHandoffBubbleIfNeeded(
        options.activeItems,
        options.activeQueuedHandoffBubble,
      ),
    [options.activeItems, options.activeQueuedHandoffBubble],
  );
  // 仅暴露三个布尔位且引用稳定：heartbeat/continuation pulse 不再击穿 Sidebar/topbar tabs 的 memo。
  const sidebarThreadStatusById = useSidebarThreadStatusProjection(
    options.threadStatusById,
  );
  const conversationState = useMemo<ConversationState>(
    () => ({
      items: conversationItems,
      plan: options.plan,
      userInputQueue: options.userInputRequests,
      meta: {
        workspaceId: options.activeWorkspace?.id ?? "",
        threadId: options.activeThreadId ?? "",
        engine: conversationEngine,
        activeTurnId: options.activeTurnId ?? null,
        isThinking: activeThreadStatus?.isProcessing ?? false,
        backgroundTaskRunningCount:
          activeThreadStatus?.backgroundTaskRunningCount ?? 0,
        heartbeatPulse: heartbeatPulseRef.current,
        historyRestoredAtMs: activeHistoryRestoredAtMs,
      },
    }),
    [
      conversationItems,
      options.plan,
      options.userInputRequests,
      options.activeWorkspace?.id,
      options.activeThreadId,
      options.activeTurnId,
      conversationEngine,
      activeThreadStatus?.isProcessing,
      activeThreadStatus?.backgroundTaskRunningCount,
      activeHistoryRestoredAtMs,
    ],
  );
  const presentationProfile = useMemo(
    () =>
      options.usePresentationProfile
        ? resolvePresentationProfile(conversationEngine)
        : null,
    [options.usePresentationProfile, conversationEngine],
  );
  const activeWorkspacePath = options.activeWorkspace?.path ?? null;
  const gitDiffItems = options.gitDiffs;
  const canonicalGitPanelChanges = useMemo(
    () =>
      buildCanonicalGitChanges({
        files: options.gitStatus.files,
        stagedFiles: options.gitStatus.stagedFiles,
        unstagedFiles: options.gitStatus.unstagedFiles,
        diffs: options.gitDiffs,
      }),
    [
      options.gitDiffs,
      options.gitStatus.files,
      options.gitStatus.stagedFiles,
      options.gitStatus.unstagedFiles,
    ],
  );
  const canonicalGitPanelTotals = useMemo(
    () => ({
      additions: [
        ...canonicalGitPanelChanges.stagedFiles,
        ...canonicalGitPanelChanges.unstagedFiles,
      ].reduce((total, file) => total + file.additions, 0),
      deletions: [
        ...canonicalGitPanelChanges.stagedFiles,
        ...canonicalGitPanelChanges.unstagedFiles,
      ].reduce((total, file) => total + file.deletions, 0),
    }),
    [
      canonicalGitPanelChanges.stagedFiles,
      canonicalGitPanelChanges.unstagedFiles,
    ],
  );
  const handlePreviewFileDiff = useCallback(
    (path: string) => {
      const normalizedPath = path.trim();
      if (!normalizedPath) {
        return;
      }
      const availablePaths = [
        ...canonicalGitPanelChanges.stagedFiles,
        ...canonicalGitPanelChanges.unstagedFiles,
      ].map((file) => file.path);
      const resolvedPath = resolveDiffPathFromWorkspacePath(
        normalizedPath,
        availablePaths,
        activeWorkspacePath,
      );
      gitModalPreviewRequestSerialRef.current += 1;
      setGitModalPreviewRequest({
        path: resolvedPath ?? normalizedPath,
        requestId: gitModalPreviewRequestSerialRef.current,
        maximized: true,
      });
      onFilePanelModeChange("git");
    },
    [
      activeWorkspacePath,
      canonicalGitPanelChanges.stagedFiles,
      canonicalGitPanelChanges.unstagedFiles,
      onFilePanelModeChange,
    ],
  );
  const onGitDiffListViewChange = options.onGitDiffListViewChange;
  const onSelectDiff = options.onSelectDiff;
  const handleOpenDiffPath = useCallback(
    (path: string) => {
      const availablePaths = gitDiffItems.map((entry) =>
        entry.path
          .replace(/\\/g, "/")
          .replace(/^\.\/+/, "")
          .trim(),
      );
      const resolvedPath = resolveDiffPathFromWorkspacePath(
        path,
        availablePaths,
        activeWorkspacePath,
      );
      onGitDiffListViewChange("tree");
      onSelectDiff(resolvedPath ?? null);
    },
    [gitDiffItems, activeWorkspacePath, onGitDiffListViewChange, onSelectDiff],
  );
  // DISABLED: disable-session-activity-and-solo-mode — no derivation while kill-switch is on
  const workspaceActivity = DISABLED_WORKSPACE_SESSION_ACTIVITY;
  const isEditorFileMaximized = options.isEditorFileMaximized;
  const onToggleEditorFileMaximized = options.onToggleEditorFileMaximized;
  const handleOpenProjectMapEvidenceFile = useCallback(
    (path: string, location?: EditorNavigationLocation) => {
      onOpenFile(path, location, { editorSplitCompanion: "projectMap" });
      if (isEditorFileMaximized) {
        onToggleEditorFileMaximized();
      }
    },
    [isEditorFileMaximized, onOpenFile, onToggleEditorFileMaximized],
  );
  const groupedWorkspacesForHeader = useMemo(() => {
    return buildWorkspaceHeaderGroups(
      options.groupedWorkspaces,
      options.workspaces,
    );
  }, [options.groupedWorkspaces, options.workspaces]);

  const { contextMenuNode: topbarTabContextMenuNode, sessionTabsNode } =
    useLayoutTopbarSessionTabs({
      activeThreadId: options.activeThreadId,
      activeWorkspaceId: options.activeWorkspaceId,
      closeCurrentSessionShortcut: options.closeCurrentSessionShortcut,
      cycleOpenSessionNextShortcut: options.cycleOpenSessionNextShortcut,
      cycleOpenSessionPrevShortcut: options.cycleOpenSessionPrevShortcut,
      isPhone: options.isPhone,
      isTablet: options.isTablet,
      showTopSessionTabs,
      threadStatusById: sidebarThreadStatusById,
      threadsByWorkspace: options.threadsByWorkspace,
      t,
      onSelectThread: options.onSelectThread,
      onClearActiveThread: options.onClearActiveThread,
    });
  const handleRuntimeProfileRender = useCallback<ProfilerOnRenderCallback>(
    (id) => {
      threadsRuntimeProfile.recordComponentRender(id);
    },
    [],
  );
  const globalRuntimeNoticeDock = useGlobalRuntimeNoticeDock(
    options.workspaces,
  );
  // 稳定 dock 元素身份：它既作为 prop 直接进 AppLayout（手机端），又经
  // sidebarRuntimeNoticeDockNode 进入 sidebarNode 的 deps；若每次 render 新建元素，
  // 两条 memo 链都会失效（与 sidebarNode 同构处理）。
  const globalRuntimeNoticeDockNode = useMemo(
    () =>
      showGlobalRuntimeNoticeDock ? (
        <GlobalRuntimeNoticeDock
          notices={globalRuntimeNoticeDock.notices}
          visibility={globalRuntimeNoticeDock.visibility}
          status={globalRuntimeNoticeDock.status}
          onExpand={globalRuntimeNoticeDock.expand}
          onMinimize={globalRuntimeNoticeDock.minimize}
          onClear={globalRuntimeNoticeDock.clear}
          // 桌面侧栏：不外显气泡，入口在设置二级菜单；手机端仍用底部气泡。
          hideMinimizedTrigger={!options.isPhone}
        />
      ) : null,
    [
      showGlobalRuntimeNoticeDock,
      globalRuntimeNoticeDock.notices,
      globalRuntimeNoticeDock.visibility,
      globalRuntimeNoticeDock.status,
      globalRuntimeNoticeDock.expand,
      globalRuntimeNoticeDock.minimize,
      globalRuntimeNoticeDock.clear,
      options.isPhone,
    ],
  );
  const sidebarRuntimeNoticeDockNode = options.isPhone ? null : globalRuntimeNoticeDockNode;
  const appRuntimeNoticeDockNode = options.isPhone ? globalRuntimeNoticeDockNode : null;
  const sidebarActiveItems = shellRuntimeSummary.sidebarSubagentItems;
  const canCopyActiveThread = shellRuntimeSummary.canCopyActiveThread;

  // 稳定 sidebar 元素引用，避免 AppLayout memo 因 ReactNode 身份变化而失效。
  // Sidebar 本身已 memo；根链合法更新时若 props 未变则整棵侧栏跳过协调。
  const sidebarNode = useMemo(
    () => (
      <Profiler id="sidebar" onRender={handleRuntimeProfileRender}>
        <Sidebar
          workspaces={options.workspaces}
          groupedWorkspaces={options.groupedWorkspaces}
          hasWorkspaceGroups={options.hasWorkspaceGroups}
          deletingWorktreeIds={options.deletingWorktreeIds}
          threadsByWorkspace={options.threadsByWorkspace}
          activeItems={sidebarActiveItems}
          threadParentById={options.threadParentById}
          threadStatusById={sidebarThreadStatusById}
          runningSessionCountByWorkspaceId={
            options.runningSessionCountByWorkspaceId
          }
          recentSessionCountByWorkspaceId={
            options.recentCompletedSessionCountByWorkspaceId
          }
          hydratedThreadListWorkspaceIds={options.hydratedThreadListWorkspaceIds}
          threadListLoadingByWorkspace={options.threadListLoadingByWorkspace}
          threadListPagingByWorkspace={options.threadListPagingByWorkspace}
          threadListCursorByWorkspace={options.threadListCursorByWorkspace}
          activeWorkspaceId={options.activeWorkspaceId}
          activeThreadId={options.activeThreadId}
          systemProxyEnabled={options.systemProxyEnabled}
          systemProxyUrl={options.systemProxyUrl}
          onUpdateSystemProxy={options.onUpdateSystemProxy}
          accountRateLimits={options.activeRateLimits}
          usageShowRemaining={options.usageShowRemaining}
          showProviderLabels={options.showSidebarProviderLabels}
          defaultVisibleThreadRootCount={options.defaultVisibleThreadRootCount}
          onChangeDefaultVisibleThreadRootCount={
            options.onChangeDefaultVisibleThreadRootCount
          }
          accountInfo={options.accountInfo}
          onSwitchAccount={options.onSwitchAccount}
          onCancelSwitchAccount={options.onCancelSwitchAccount}
          accountSwitching={options.accountSwitching}
          onOpenSettings={options.onOpenSettings}
          onOpenSessionManagement={options.onOpenSessionManagement}
          onOpenDebug={options.onOpenDebug}
          showDebugButton={options.showDebugButton}
          onAddWorkspace={options.onAddWorkspace}
          onSelectHome={options.onSelectHome}
          onSelectWorkspace={options.onSelectWorkspace}
          onReorderWorkspaces={options.onReorderWorkspaces}
          onConnectWorkspace={options.onConnectWorkspace}
          onAddAgent={options.onAddAgent}
          engineOptions={options.engineOptions}
          onRefreshEngineOptions={options.onRefreshEngineOptions}
          onAddSharedAgent={options.onAddSharedAgent}
          onAddWorktreeAgent={options.onAddWorktreeAgent}
          onAddCloneAgent={options.onAddCloneAgent}
          onToggleWorkspaceCollapse={options.onToggleWorkspaceCollapse}
          onSelectThread={options.onSelectThread}
          onProviderContinuationTargetReady={
            options.onProviderContinuationTargetReady
          }
          onDeleteThread={options.onDeleteThread}
          onArchiveThread={options.onArchiveThread}
          deleteConfirmThreadId={options.deleteConfirmThreadId}
          deleteConfirmWorkspaceId={options.deleteConfirmWorkspaceId}
          deleteConfirmBusy={options.deleteConfirmBusy}
          onCancelDeleteConfirm={options.onCancelDeleteConfirm}
          onConfirmDeleteConfirm={options.onConfirmDeleteConfirm}
          renameThreadId={options.renameThreadId}
          renameWorkspaceId={options.renameWorkspaceId}
          renameName={options.renameName}
          onRenameChange={options.onRenameChange}
          onRenameCancel={options.onRenameCancel}
          onRenameConfirm={options.onRenameConfirm}
          onSyncThread={options.onSyncThread}
          pinThread={options.pinThread}
          unpinThread={options.unpinThread}
          isThreadPinned={options.isThreadPinned}
          isThreadAutoNaming={options.isThreadAutoNaming}
          getPinTimestamp={options.getPinTimestamp}
          pinnedThreadsVersion={options.pinnedThreadsVersion}
          onRenameThread={options.onRenameThread}
          onAutoNameThread={options.onAutoNameThread}
          onOpenClaudeTui={options.onOpenClaudeTui}
          onDeleteWorkspace={options.onDeleteWorkspace}
          onDeleteWorktree={options.onDeleteWorktree}
          onRenameWorkspaceAlias={options.onRenameWorkspaceAlias}
          workspaceGroups={options.workspaceGroups}
          onAssignWorkspaceGroup={options.onAssignWorkspaceGroup}
          onLoadOlderThreads={options.onLoadOlderThreads}
          onReloadWorkspaceThreads={options.onReloadWorkspaceThreads}
          onQuickReloadWorkspaceThreads={options.onQuickReloadWorkspaceThreads}
          onRequestRootSessionFolderDraft={options.onRequestRootSessionFolderDraft}
          isExitedSessionsHidden={options.isExitedSessionsHidden}
          onToggleExitedSessionsHidden={options.onToggleExitedSessionsHidden}
          rootSessionFolderDraftRequestByWorkspaceId={
            options.rootSessionFolderDraftRequestByWorkspaceId
          }
          workspaceDropTargetRef={options.workspaceDropTargetRef}
          isWorkspaceDropActive={options.isWorkspaceDropActive}
          workspaceDropText={options.workspaceDropText}
          onWorkspaceDragOver={options.onWorkspaceDragOver}
          onWorkspaceDragEnter={options.onWorkspaceDragEnter}
          onWorkspaceDragLeave={options.onWorkspaceDragLeave}
          onWorkspaceDrop={options.onWorkspaceDrop}
          appMode={options.appMode}
          onAppModeChange={options.onAppModeChange}
          onOpenHomeChat={options.onOpenHomeChat}
          onLockPanel={options.onLockPanel}
          onOpenProjectMemory={options.onOpenProjectMemory}
          onOpenReleaseNotes={options.onOpenReleaseNotes}
          onOpenGlobalSearch={options.onOpenGlobalSearch}
          onOpenQuickSwitcher={options.onOpenQuickSwitcher}
          onCollapseSidebar={options.onCollapseSidebar}
          globalSearchShortcut={options.globalSearchShortcut}
          openChatShortcut={options.openChatShortcut}
          openSettingsShortcut={options.openSettingsShortcut}
          showLoadingProgressDialog={options.showLoadingProgressDialog}
          hideLoadingProgressDialog={options.hideLoadingProgressDialog}
          onOpenSpecHub={options.onOpenSpecHub}
          onOpenWorkspaceHome={options.onOpenWorkspaceHome}
          showTerminalButton={options.showTerminalButton}
          isTerminalOpen={options.terminalOpen}
          onToggleTerminal={options.onToggleTerminal}
          runtimeNoticeDockNode={sidebarRuntimeNoticeDockNode}
          onOpenRuntimeNotice={
            showGlobalRuntimeNoticeDock ? globalRuntimeNoticeDock.expand : undefined
          }
          showRuntimeNoticeMenuItem={
            Boolean(showGlobalRuntimeNoticeDock && !options.isPhone)
          }
          runtimeNoticeHasError={globalRuntimeNoticeDock.status === "has-error"}
        />
      </Profiler>
    ),
    [
      globalRuntimeNoticeDock.expand,
      globalRuntimeNoticeDock.status,
      handleRuntimeProfileRender,
      options.accountInfo,
      options.accountSwitching,
      options.activeRateLimits,
      options.activeThreadId,
      options.activeWorkspaceId,
      options.appMode,
      options.deletingWorktreeIds,
      options.deleteConfirmBusy,
      options.deleteConfirmThreadId,
      options.deleteConfirmWorkspaceId,
      options.engineOptions,
      options.getPinTimestamp,
      options.globalSearchShortcut,
      options.openSettingsShortcut,
      options.groupedWorkspaces,
      options.hasWorkspaceGroups,
      options.hideLoadingProgressDialog,
      options.hydratedThreadListWorkspaceIds,
      options.isExitedSessionsHidden,
      options.isPhone,
      options.isThreadAutoNaming,
      options.isThreadPinned,
      options.isWorkspaceDropActive,
      options.onAddAgent,
      options.onAddCloneAgent,
      options.onAddSharedAgent,
      options.onAddWorkspace,
      options.onAddWorktreeAgent,
      options.onAppModeChange,
      options.onArchiveThread,
      options.onAssignWorkspaceGroup,
      options.onAutoNameThread,
      options.onCancelDeleteConfirm,
      options.onCancelSwitchAccount,
      options.onCollapseSidebar,
      options.onConfirmDeleteConfirm,
      options.onConnectWorkspace,
      options.onDeleteThread,
      options.onDeleteWorkspace,
      options.onDeleteWorktree,
      options.onLoadOlderThreads,
      options.onLockPanel,
      options.onOpenClaudeTui,
      options.onOpenDebug,
      options.onOpenGlobalSearch,
      options.onOpenHomeChat,
      options.onOpenProjectMemory,
      options.onOpenQuickSwitcher,
      options.onOpenReleaseNotes,
      options.onOpenSettings,
      options.onOpenSessionManagement,
      options.onOpenSpecHub,
      options.onOpenWorkspaceHome,
      options.onProviderContinuationTargetReady,
      options.onQuickReloadWorkspaceThreads,
      options.onRefreshEngineOptions,
      options.onReloadWorkspaceThreads,
      options.onRenameChange,
      options.onRenameCancel,
      options.onRenameConfirm,
      options.onRenameThread,
      options.onRenameWorkspaceAlias,
      options.onReorderWorkspaces,
      options.onRequestRootSessionFolderDraft,
      options.onSelectHome,
      options.onSelectThread,
      options.onSelectWorkspace,
      options.onSwitchAccount,
      options.onSyncThread,
      options.onToggleExitedSessionsHidden,
      options.onToggleTerminal,
      options.onToggleWorkspaceCollapse,
      options.onWorkspaceDragEnter,
      options.onWorkspaceDragLeave,
      options.onWorkspaceDragOver,
      options.onWorkspaceDrop,
      options.openChatShortcut,
      options.pinThread,
      options.pinnedThreadsVersion,
      options.renameName,
      options.renameThreadId,
      options.renameWorkspaceId,
      options.recentCompletedSessionCountByWorkspaceId,
      options.rootSessionFolderDraftRequestByWorkspaceId,
      options.runningSessionCountByWorkspaceId,
      options.showDebugButton,
      options.showLoadingProgressDialog,
      options.showSidebarProviderLabels,
      options.defaultVisibleThreadRootCount,
      options.onChangeDefaultVisibleThreadRootCount,
      options.showTerminalButton,
      options.systemProxyEnabled,
      options.systemProxyUrl,
      options.terminalOpen,
      options.threadListCursorByWorkspace,
      options.threadListLoadingByWorkspace,
      options.threadListPagingByWorkspace,
      options.threadParentById,
      options.threadsByWorkspace,
      options.unpinThread,
      options.usageShowRemaining,
      options.workspaceDropTargetRef,
      options.workspaceDropText,
      options.workspaceGroups,
      options.workspaces,
      showGlobalRuntimeNoticeDock,
      sidebarActiveItems,
      sidebarRuntimeNoticeDockNode,
      sidebarThreadStatusById,
    ],
  );

  const [localClaudeThinkingVisible, setLocalClaudeThinkingVisible] = useState<
    boolean | undefined
  >(undefined);
  const reportedClaudeThinkingVisibleRef = useRef<boolean | undefined>(
    typeof options.claudeThinkingVisible === "boolean"
      ? options.claudeThinkingVisible
      : undefined,
  );
  const [selectedCodeAnnotations, setSelectedCodeAnnotations] = useState<
    CodeAnnotationSelection[]
  >([]);
  const [workspaceNoteCaptureRequest, setWorkspaceNoteCaptureRequest] =
    useState<WorkspaceNoteCaptureRequest | null>(null);
  const workspaceNoteCaptureRequestSerialRef = useRef(0);
  const noteCaptureWorkspaceId = options.activeWorkspace?.id ?? null;
  const setNoteCaptureCenterMode = options.setCenterMode;
  const handleCaptureWorkspaceNote = useCallback(
    (draft: NoteCaptureDraft) => {
      if (!noteCaptureWorkspaceId) {
        return;
      }
      const requestId = workspaceNoteCaptureRequestSerialRef.current + 1;
      workspaceNoteCaptureRequestSerialRef.current = requestId;
      setWorkspaceNoteCaptureRequest({ requestId, draft });
      onFilePanelModeChange("notes");
      setNoteCaptureCenterMode("notes");
    },
    [
      noteCaptureWorkspaceId,
      onFilePanelModeChange,
      setNoteCaptureCenterMode,
    ],
  );
  const handleWorkspaceNoteCaptureRequestHandled = useCallback(
    (requestId: number) => {
      setWorkspaceNoteCaptureRequest((current) =>
        current?.requestId === requestId ? null : current,
      );
    },
    [],
  );
  const handleCreateCodeAnnotation = useCallback(
    (annotation: CodeAnnotationDraftInput) => {
      const selection = createCodeAnnotationSelection(annotation);
      const dedupeKey = buildCodeAnnotationDedupeKey(annotation);
      if (!selection || !dedupeKey) {
        return;
      }
      setSelectedCodeAnnotations((current) => {
        const existingIndex = current.findIndex(
          (entry) => buildCodeAnnotationDedupeKey(entry) === dedupeKey,
        );
        if (existingIndex === -1) {
          return [...current, selection];
        }
        return current.map((entry, index) =>
          index === existingIndex ? selection : entry,
        );
      });
    },
    [],
  );
  const handleRemoveCodeAnnotation = useCallback((annotationId: string) => {
    setSelectedCodeAnnotations((current) =>
      current.filter((entry) => entry.id !== annotationId),
    );
  }, []);
  const handleClearCodeAnnotations = useCallback(() => {
    setSelectedCodeAnnotations((current) =>
      current.length === 0 ? current : [],
    );
  }, []);
  const codeAnnotationBridgeProps = useMemo<CodeAnnotationBridgeProps>(
    () => ({
      onCreateCodeAnnotation: handleCreateCodeAnnotation,
      onRemoveCodeAnnotation: handleRemoveCodeAnnotation,
      codeAnnotations: selectedCodeAnnotations,
    }),
    [
      handleCreateCodeAnnotation,
      handleRemoveCodeAnnotation,
      selectedCodeAnnotations,
    ],
  );
  useEffect(() => {
    setSelectedCodeAnnotations((current) =>
      current.length === 0 ? current : [],
    );
  }, [options.activeThreadId, options.activeWorkspace?.id]);
  useEffect(() => {
    setWorkspaceNoteCaptureRequest(null);
  }, [options.activeWorkspace?.id]);
  const claudeThinkingVisible =
    typeof options.claudeThinkingVisible === "boolean"
      ? options.claudeThinkingVisible
      : localClaudeThinkingVisible;
  useEffect(() => {
    if (typeof options.claudeThinkingVisible === "boolean") {
      reportedClaudeThinkingVisibleRef.current = options.claudeThinkingVisible;
    }
  }, [options.claudeThinkingVisible]);
  const onResolvedClaudeThinkingVisibleChange =
    options.onResolvedClaudeThinkingVisibleChange;
  const handleResolvedAlwaysThinkingChange = useCallback(
    (enabled: boolean) => {
      if (reportedClaudeThinkingVisibleRef.current === enabled) {
        return;
      }
      reportedClaudeThinkingVisibleRef.current = enabled;
      setLocalClaudeThinkingVisible((previous) =>
        previous === enabled ? previous : enabled,
      );
      onResolvedClaudeThinkingVisibleChange?.(enabled);
    },
    [onResolvedClaudeThinkingVisibleChange],
  );
  const onForkFromMessage = options.onForkFromMessage;
  const handleOpenForkConfirmFromMessage = useCallback((messageId: string) => {
    const normalizedMessageId = messageId.trim();
    if (!normalizedMessageId) {
      return;
    }
    setForkConfirmUserMessageId(normalizedMessageId);
  }, []);
  const handleCancelForkConfirm = useCallback(() => {
    setForkConfirmUserMessageId(null);
  }, []);
  const handleConfirmForkFromMessage = useCallback(
    async (messageId: string, options?: CodexProviderProfileSelection) => {
      await onForkFromMessage?.(messageId, options);
    },
    [onForkFromMessage],
  );
  const codexForkProviderProfiles = useMemo<
    CodexProviderProfileOption[]
  >(() => {
    const activeProviderId =
      activeThreadSummary?.providerProfileId?.trim() ||
      CODEX_DISK_PROVIDER_PROFILE_ID;
    const activeProfile = codexProviderProfiles.find(
      (profile) => profile.id === activeProviderId,
    );
    return [
      activeProfile ?? {
        id: activeProviderId,
        name:
          activeThreadSummary?.providerProfileName?.trim() || activeProviderId,
        source:
          activeThreadSummary?.providerProfileSource === "managed"
            ? "managed"
            : "disk",
      },
    ];
  }, [
    activeThreadSummary?.providerProfileId,
    activeThreadSummary?.providerProfileName,
    activeThreadSummary?.providerProfileSource,
    codexProviderProfiles,
  ]);
  const handleOpenRewindDialogFromMessage = useCallback((messageId: string) => {
    const normalizedMessageId = messageId.trim();
    if (!normalizedMessageId) {
      return;
    }
    const nextRequestId = rewindDialogRequestSerialRef.current + 1;
    rewindDialogRequestSerialRef.current = nextRequestId;
    setRewindDialogRequest({
      requestId: nextRequestId,
      userMessageId: normalizedMessageId,
    });
  }, []);
  const handleRewindDialogRequestConsumed = useCallback((requestId: number) => {
    setRewindDialogRequest((current) =>
      current?.requestId === requestId ? null : current,
    );
  }, []);

  // childSubagent / nativeThreadIds：禁止每帧 `[]` 或 filter 新数组击穿 canvas shallowEqual（#185 / App-BG-8EZ_F）
  // stabilize 放在 useMemo 内：仅 deps 变化时比较；避免每帧 render 写 ref（Concurrent 更干净）。
  const childSubagentThreadsStableRef = useRef(
    EMPTY_ACTIVE_CANVAS_CHILD_SUBAGENT_THREADS,
  );
  const childSubagentThreads = useMemo(() => {
    const activeId = options.activeThreadId;
    const workspaceId = options.activeWorkspaceId;
    let next = EMPTY_ACTIVE_CANVAS_CHILD_SUBAGENT_THREADS;
    if (activeId && workspaceId) {
      const filtered = collectCanvasChildSubagentThreads(
        activeId,
        workspaceId,
        options.threadsByWorkspace[workspaceId],
        options.threadParentById,
        activeThreadSummary?.nativeThreadIds,
      );
      next =
        filtered.length === 0
          ? EMPTY_ACTIVE_CANVAS_CHILD_SUBAGENT_THREADS
          : filtered;
    }
    const stable = stabilizeListByMemberIdentity(
      childSubagentThreadsStableRef.current,
      next,
      EMPTY_ACTIVE_CANVAS_CHILD_SUBAGENT_THREADS,
    );
    childSubagentThreadsStableRef.current = stable;
    return stable;
  }, [
    options.activeThreadId,
    options.activeWorkspaceId,
    options.threadParentById,
    options.threadsByWorkspace,
    activeThreadSummary?.nativeThreadIds,
  ]);

  const activeNativeThreadIdsStableRef = useRef(
    EMPTY_ACTIVE_CANVAS_NATIVE_THREAD_IDS,
  );
  const activeNativeThreadIds = useMemo(() => {
    const next =
      activeThreadSummary?.nativeThreadIds ??
      EMPTY_ACTIVE_CANVAS_NATIVE_THREAD_IDS;
    const stable = stabilizeListByMemberIdentity(
      activeNativeThreadIdsStableRef.current,
      next,
      EMPTY_ACTIVE_CANVAS_NATIVE_THREAD_IDS,
    );
    activeNativeThreadIdsStableRef.current = stable;
    return stable;
  }, [activeThreadSummary?.nativeThreadIds]);

  const canvasUserInputRequests =
    options.userInputRequests.length === 0
      ? EMPTY_ACTIVE_CANVAS_USER_INPUT_REQUESTS
      : options.userInputRequests;
  const canvasApprovals =
    options.approvals.length === 0
      ? EMPTY_ACTIVE_CANVAS_APPROVALS
      : options.approvals;

  const activeCanvasSnapshot = useMemo<ActiveCanvasSnapshot>(
    () => ({
      activeWorkspaceId: options.activeWorkspaceId,
      activeTurnId: options.activeTurnId ?? null,
      items: options.activeItems,
      threadId: options.activeThreadId ?? null,
      workspaceId: options.activeWorkspace?.id ?? null,
      workspacePath: options.activeWorkspace?.path ?? null,
      userInputRequests: canvasUserInputRequests,
      approvals: canvasApprovals,
      conversationState,
      plan: options.plan,
      isThinking: isThreadThinking,
      isHistoryLoading: activeThreadHistoryLoading,
      historyLoadingProgress: activeThreadHistoryLoadingProgress,
      historyRecoveryFailureReason: activeThreadHistoryRecoveryFailureReason,
      isContextCompacting: activeThreadStatus?.isContextCompacting ?? false,
      processingStartedAt: activeThreadStatus?.processingStartedAt ?? null,
      lastDurationMs: activeThreadStatus?.lastDurationMs ?? null,
      heartbeatPulse: heartbeatPulseRef.current ?? 0,
      codexSilentSuspectedAt:
        activeThreadStatus?.codexSilentSuspectedAt ?? null,
      threadItemsByThread: options.threadItemsByThread,
      threadStatusById: sidebarThreadStatusById,
      activeThreadStatus,
      activeTokenUsage: options.activeTokenUsage,
      activeRateLimits: options.activeRateLimits,
      childSubagentThreads,
      activeNativeThreadIds,
    }),
    [
      options.activeWorkspaceId,
      options.activeTurnId,
      options.activeItems,
      options.activeThreadId,
      options.activeWorkspace?.id,
      options.activeWorkspace?.path,
      canvasUserInputRequests,
      canvasApprovals,
      conversationState,
      options.plan,
      isThreadThinking,
      activeThreadHistoryLoading,
      activeThreadHistoryLoadingProgress,
      activeThreadHistoryRecoveryFailureReason,
      activeThreadStatus,
      options.threadItemsByThread,
      sidebarThreadStatusById,
      options.activeTokenUsage,
      options.activeRateLimits,
      childSubagentThreads,
      activeNativeThreadIds,
    ],
  );

  useLayoutEffect(() => {
    setActiveCanvasSnapshot(activeCanvasSnapshot);
  }, [activeCanvasSnapshot]);

  const continuationWorkspaceId = options.activeWorkspaceId ?? "";
  const continuationThreadsByWorkspace = options.threadsByWorkspace;
  const selectContinuationThread = options.onSelectThread;
  const continuationSourceItems = activeThreadSummary?.sourceSessionId
    ? options.threadItemsByThread[activeThreadSummary.sourceSessionId]
    : undefined;
  const continuationContext = useMemo(() => {
    if (
      activeThreadSummary?.originKind !== "provider-continuation" ||
      !activeThreadSummary.sourceSessionId
    ) {
      return null;
    }
    const sourceSessionId = activeThreadSummary.sourceSessionId;
    const source = continuationThreadsByWorkspace[
      continuationWorkspaceId
    ]?.find(
      (thread) => thread.id === sourceSessionId,
    ) ?? null;
    return {
      source,
      sourceExcerpt: buildProviderContinuationSourceExcerpt(
        continuationSourceItems ?? EMPTY_ACTIVE_CANVAS_ITEMS,
      ),
      onOpenSource: source
        ? () =>
            selectContinuationThread(
              continuationWorkspaceId,
              sourceSessionId,
            )
        : null,
    };
  }, [
    activeThreadSummary,
    continuationThreadsByWorkspace,
    continuationWorkspaceId,
    continuationSourceItems,
    selectContinuationThread,
  ]);

  const messagesNode = useMemo(
    () =>
      buildConversationCanvasNode({
        isProviderContinuation:
          activeThreadSummary?.originKind === "provider-continuation",
        timelineTrailingNode: (
          <>
            <CollabTimelineWaiting
              workspaceId={options.activeWorkspaceId}
              threadId={options.activeThreadId ?? null}
            />
            <SharedProviderRetryHint
              workspaceId={options.activeWorkspaceId}
              threadId={options.activeThreadId ?? null}
            />
          </>
        ),
        continuationContextNode:
          activeThreadSummary?.originKind === "provider-continuation" ? (
            <ProviderContinuationContextCard
              thread={activeThreadSummary}
              source={continuationContext?.source ?? null}
              sourceExcerpt={continuationContext?.sourceExcerpt ?? null}
              onOpenSource={continuationContext?.onOpenSource ?? null}
            />
          ) : null,
        messagesProps: {
          items: EMPTY_ACTIVE_CANVAS_ITEMS,
          threadId: null,
          workspaceId: null,
          workspacePath: null,
          openTargets: options.openAppTargets,
          selectedOpenAppId: options.selectedOpenAppId,
          showMessageAnchors,
          codeBlockCopyUseModifier: options.codeBlockCopyUseModifier,
          userInputRequests: [],
          approvals: [],
          workspaces: options.workspaces,
          onUserInputSubmit: options.handleUserInputSubmit,
          onUserInputDismiss: options.handleUserInputDismiss,
          onRecoverThreadRuntime: options.onRecoverThreadRuntime,
          onRecoverThreadRuntimeAndResend:
            options.onRecoverThreadRuntimeAndResend,
          onThreadRecoveryFork: options.onThreadRecoveryFork,
          onForkFromMessage: onForkFromMessage
            ? handleOpenForkConfirmFromMessage
            : undefined,
          onRewindFromMessage: options.onRewind
            ? handleOpenRewindDialogFromMessage
            : undefined,
          onApprovalDecision: options.handleApprovalDecision,
          onApprovalBatchAccept: options.handleApprovalBatchAccept,
          onApprovalRemember: options.handleApprovalRemember,
          conversationState: null,
          presentationProfile,
          activeEngine: conversationEngine,
          claudeThinkingVisible,
          activeCollaborationModeId: options.selectedCollaborationModeId,
          plan: null,
          isPlanMode: options.isPlanMode,
          isPlanProcessing: false,
          onOpenDiffPath: handleOpenDiffPath,
          onPreviewFileDiff: handlePreviewFileDiff,
          onOpenPlanPanel: options.onOpenPlanPanel,
          onExitPlanModeExecute: options.handleExitPlanModeExecute,
          onOpenWorkspaceFile: options.onOpenFile,
          onCaptureNote: handleCaptureWorkspaceNote,
          agentTaskScrollRequest: options.agentTaskScrollRequest,
          isThinking: false,
          isHistoryLoading: false,
          historyRecoveryFailureReason: null,
          onRetryHistory: options.onRecoverThreadRuntime
            ? handleRetryHistory
            : undefined,
          isContextCompacting: false,
          proxyEnabled: options.systemProxyEnabled,
          proxyUrl: options.systemProxyUrl,
          processingStartedAt: null,
          lastDurationMs: null,
          heartbeatPulse: 0,
          codexSilentSuspectedAt: null,
        },
        forkConfirmDialogProps: {
          userMessageId: forkConfirmUserMessageId,
          onCancel: handleCancelForkConfirm,
          onConfirm: handleConfirmForkFromMessage,
          showProviderSelector: conversationEngine === "codex",
          defaultProviderProfileId:
            activeThreadSummary?.providerProfileId ??
            CODEX_DISK_PROVIDER_PROFILE_ID,
          providerProfiles: codexForkProviderProfiles,
        },
      }),
    [
      options.systemProxyEnabled,
      options.systemProxyUrl,
      options.openAppTargets,
      activeThreadSummary,
      continuationContext,
      options.selectedOpenAppId,
      showMessageAnchors,
      options.codeBlockCopyUseModifier,
      options.workspaces,
      options.handleUserInputSubmit,
      options.handleUserInputDismiss,
      options.onRecoverThreadRuntime,
      handleRetryHistory,
      options.onRecoverThreadRuntimeAndResend,
      options.onThreadRecoveryFork,
      onForkFromMessage,
      handleOpenForkConfirmFromMessage,
      forkConfirmUserMessageId,
      handleCancelForkConfirm,
      handleConfirmForkFromMessage,
      codexForkProviderProfiles,
      options.onRewind,
      handleOpenRewindDialogFromMessage,
      options.handleApprovalDecision,
      options.handleApprovalBatchAccept,
      options.handleApprovalRemember,
      presentationProfile,
      conversationEngine,
      claudeThinkingVisible,
      options.selectedCollaborationModeId,
      options.isPlanMode,
      handleOpenDiffPath,
      handlePreviewFileDiff,
      options.onOpenPlanPanel,
      options.handleExitPlanModeExecute,
      options.onOpenFile,
      handleCaptureWorkspaceNote,
      options.agentTaskScrollRequest,
      options.activeWorkspaceId,
      options.activeThreadId,
      // heartbeatPulse removed from deps — uses ref to avoid
      // recreating messagesNode on every heartbeat tick
    ],
  );

  const composerSelectedAgent = useMemo(
    () =>
      options.selectedAgent
        ? {
            id: options.selectedAgent.id,
            name: options.selectedAgent.name,
            prompt: options.selectedAgent.prompt ?? undefined,
            icon: options.selectedAgent.icon ?? undefined,
          }
        : null,
    [options.selectedAgent],
  );
  const composerCommands = options.commands ?? EMPTY_COMMANDS;
  const composerRuntimeLifecycleState = resolveRuntimeLifecycleForComposer(
    globalRuntimeNoticeDock.runtimeRows,
    options.activeWorkspaceId,
    options.selectedEngine,
  );
  const handleJumpToUserInputRequest = useCallback(
    (request: RequestUserInputRequest) => {
      if (focusUserInputRequestCard(request)) {
        return;
      }
      dispatchMessageJumpEvent(request.params.item_id);
    },
    [],
  );
  // 身份 id-first：shared: 前缀是 hard gate，threadKind 投影仅兜底
  // （fix-shared-session-identity-id-first）。
  const isSharedSession = resolveIsSharedSession(
    options.activeThreadId,
    activeThreadSummary,
  );
  // Wave 4 / B.6：Shared Send UI 状态机（§14.5）。V2 flag 关闭时状态恒为 idle，不影响现有行为。
  const sharedSendEntry = useSharedSendState(
    options.activeWorkspaceId ?? "",
    options.activeThreadId ?? "",
  );
  useSharedSendStateRestore(
    options.activeWorkspaceId ?? null,
    options.activeThreadId ?? null,
    isSharedSession,
  );
  const sharedSendState = isSharedSession ? sharedSendEntry.state : "idle";
  const collabUi = useCollabUiState(
    options.activeWorkspaceId,
    options.activeThreadId,
  );
  const collabRunActive = Boolean(
    collabUi && collabUi.phase !== "idle" && collabUi.phase !== "done",
  );
  const sendSharedProviderRetryResume = useEventCallback(
    (
      workspaceId: string,
      threadId: string,
      text: string,
      meta: { attempt: number; atMs: number },
    ) => {
      if (workspaceId !== options.activeWorkspaceId || threadId !== options.activeThreadId) {
        return;
      }
      return options.onSend(text, [], {
        originKind: "shared-provider-retry",
        providerRetryAttempt: meta.attempt,
        providerRetryAtMs: meta.atMs,
      });
    },
  );
  useSharedProviderRetry({
    workspaceId: options.activeWorkspaceId,
    threadId: options.activeThreadId,
    engine:
      activeThreadSummary?.selectedEngine ??
      activeThreadSummary?.engineSource ??
      conversationEngine ??
      null,
    collabRunActive,
    sendResume: sendSharedProviderRetryResume,
  });
  const gitStatusError = options.gitStatus.error;
  const gitStatusFiles = options.gitStatus.files;
  // deriveRewindWorkspaceGitState 每次 render 返回新对象；它是 renderComposerNode
  // 的 deps，若不 memo 会让 composerNode / homeComposerNode 的 memo 永远失效。
  const rewindWorkspaceGitState = useMemo(
    () =>
      deriveRewindWorkspaceGitState({
        error: gitStatusError,
        files: gitStatusFiles,
      }),
    [gitStatusError, gitStatusFiles],
  );
  const selectGitRoot = options.onSelectGitRoot;
  const clearGitRoot = options.onClearGitRoot;
  const changeGitPanelMode = options.onGitPanelModeChange;
  const changeAppMode = options.onAppModeChange;
  const stageGitAll = options.onStageGitAll;
  const updateBranch = options.onUpdateBranch;
  const activeWorkspaceForClone = options.activeWorkspace;
  const addCloneAgent = options.onAddCloneAgent;
  const selectComposerGitRoot = useCallback(
    async (repositoryRoot: string) => {
      if (repositoryRoot) {
        await selectGitRoot(repositoryRoot);
      } else {
        await clearGitRoot();
      }
    },
    [clearGitRoot, selectGitRoot],
  );
  const handleComposerGitCommit = useCallback(
    async (repositoryRoot: string) => {
      await selectComposerGitRoot(repositoryRoot);
      changeGitPanelMode("diff");
      onFilePanelModeChange("git");
    },
    [changeGitPanelMode, onFilePanelModeChange, selectComposerGitRoot],
  );
  const handleComposerGitPush = useCallback(
    async (repositoryRoot: string) => {
      await selectComposerGitRoot(repositoryRoot);
      changeAppMode("gitHistory");
    },
    [changeAppMode, selectComposerGitRoot],
  );
  const handleFileTreeGitRepositoryAction = useCallback(
    async (request: GitRepositoryActionRequest) => {
      const { action, repositoryRoot } = request;
      if (action === "update") {
        await updateBranch?.(request.branchName, repositoryRoot);
        return;
      }
      await selectComposerGitRoot(repositoryRoot);
      if (action === "stage-all") {
        await stageGitAll();
        return;
      }
      if (action === "clone" && activeWorkspaceForClone) {
        await addCloneAgent(activeWorkspaceForClone);
        return;
      }
      if (
        action === "commit" ||
        action === "show-diff" ||
        action === "rollback" ||
        action === "add-to-gitignore"
      ) {
        changeGitPanelMode("diff");
        onFilePanelModeChange("git");
        return;
      }
      publishGitRepositoryActionIntent({ action, repositoryRoot });
      changeAppMode("gitHistory");
    },
    [
      changeAppMode,
      changeGitPanelMode,
      onFilePanelModeChange,
      stageGitAll,
      activeWorkspaceForClone,
      addCloneAgent,
      selectComposerGitRoot,
      updateBranch,
    ],
  );
  // Stabilize the composer branch-control object and diff-path handler so they
  // don't recreate a new reference on every render (which would defeat the
  // memoized Composer). Behavior is identical to the previous inline literals.
  const composerBranchControl = useMemo(
    () =>
      options.activeWorkspace && options.branchName
        ? {
            branchName: options.branchName,
            branches: options.branches,
            localBranches: options.branchLocalItems,
            remoteBranches: options.branchRemoteItems,
            currentBranch: options.branchCurrentName,
            repositories: options.gitRepositories,
            repositoriesLoading: options.gitRepositoriesLoading,
            repositoriesError: options.gitRepositoriesError,
            selectedRepositoryRoot: options.selectedGitRepositoryRoot,
            branchError: options.branchError,
            onSelectRepository: options.onSelectGitRepository,
            onCheckout: options.onCheckoutBranch,
            onCreate: options.onCreateBranch,
            onUpdate: options.onUpdateBranch,
            onUpdateAllRepositories: options.onUpdateAllRepositories,
            onCheckoutAllRepositories: options.onCheckoutAllRepositories,
            onLoadCommonRepositoryBranches: options.onLoadCommonRepositoryBranches,
            onCommit: handleComposerGitCommit,
            onPush: handleComposerGitPush,
            disabled: options.isWorktreeWorkspace,
          }
        : null,
    [
      options.activeWorkspace,
      options.branchName,
      options.branches,
      options.branchLocalItems,
      options.branchRemoteItems,
      options.branchCurrentName,
      options.gitRepositories,
      options.gitRepositoriesLoading,
      options.gitRepositoriesError,
      options.selectedGitRepositoryRoot,
      options.branchError,
      options.onSelectGitRepository,
      options.onCheckoutBranch,
      options.onCreateBranch,
      options.onUpdateBranch,
      options.onUpdateAllRepositories,
      options.onCheckoutAllRepositories,
      options.onLoadCommonRepositoryBranches,
      handleComposerGitCommit,
      handleComposerGitPush,
      options.isWorktreeWorkspace,
    ],
  );
  const handleComposerOpenDiffPath = useEventCallback((path: string) =>
    options.onOpenFile(path),
  );
  const handleReferenceWorkspaceNote = useCallback((note: WorkspaceNoteCard) => {
    noteCardSelectionRequestSerialRef.current += 1;
    setNoteCardSelectionRequest({
      requestId: noteCardSelectionRequestSerialRef.current,
      noteCard: {
        id: note.id,
        title: note.title,
        plainTextExcerpt: note.plainTextExcerpt,
        bodyMarkdown: note.bodyMarkdown,
        updatedAt: note.updatedAt,
        archived: Boolean(note.archivedAt),
        imageCount: note.attachments.length,
        previewAttachments: note.attachments.map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          contentType: attachment.contentType,
          absolutePath: attachment.absolutePath,
        })),
      },
    });
  }, []);
  const handleOpenWorkspaceNoteCodeSource = useCallback(
    (
      source: Extract<WorkspaceNoteCardSource, { kind: "codeSelection" }>,
    ) => {
      onOpenFile(source.path, {
        line: source.startLine,
        endLine: source.endLine,
        column: 1,
        scrollPosition: "center",
      }, {
        editorSplitCompanion: "notes",
      });
    },
    [onOpenFile],
  );

  // 稳定 composer 工厂：先稳定回调，再在调用点用 useMemo 固定 ReactNode 身份，
  // 避免 AppLayout memo 因每次新建元素而失效（与 sidebarNode 同构）。
  // 高频心跳 / 无关根 state 不得入 deps（messagesNode 已去 heartbeat 同理）。
  const renderComposerNode = useCallback(
    (
      _showStatusPanelToggleOverride?: boolean,
      branchControlEnabled: boolean = true,
      externalNoteCardRequest: ComposerNoteCardSelectionRequest | null = null,
      createSessionTargetPicker: boolean = false,
    ) =>
    options.showComposer ? (
      <Profiler id="composer" onRender={handleRuntimeProfileRender}>
        {/*
          SharedSendStatusBar 与无协作 Shared 一致：贴在 Composer 输入区底部集群。
          放在 ActiveCanvasComposer 之后，避免协作 sticky 卡把状态条夹在中间。
        */}
        <ActiveCanvasComposer
          items={EMPTY_ACTIVE_CANVAS_ITEMS}
          activeThreadId={null}
          threadItemsByThread={{}}
          threadParentById={options.threadParentById}
          threadStatusById={{}}
          onSend={options.onSend}
          onQueue={options.onQueue}
          onRequestContextCompaction={options.onRequestContextCompaction}
          onStop={options.onStop}
          completionEmailSelected={options.completionEmailSelected}
          completionEmailDisabled={options.completionEmailDisabled}
          onToggleCompletionEmail={options.onToggleCompletionEmail}
          onRewind={options.onRewind}
          rewindDialogRequest={rewindDialogRequest}
          onRewindDialogRequestConsumed={handleRewindDialogRequestConsumed}
          canStop={options.canStop}
          disabled={
            options.isReviewing ||
            (!createSessionTargetPicker &&
              isComposerInputLocked(sharedSendState))
          }
          submitDisabled={
            !createSessionTargetPicker &&
            isComposerSubmitLocked(sharedSendState)
          }
          contextUsage={null}
          contextDualViewEnabled={options.contextDualViewEnabled}
          codexAutoCompactionEnabled={options.codexAutoCompactionEnabled}
          codexAutoCompactionThresholdPercent={
            options.codexAutoCompactionThresholdPercent
          }
          onCodexAutoCompactionSettingsChange={
            options.onCodexAutoCompactionSettingsChange
          }
          isContextCompacting={activeThreadStatus?.isContextCompacting ?? false}
          codexCompactionLifecycleState={
            activeThreadStatus?.codexCompactionLifecycleState ?? "idle"
          }
          codexCompactionSource={
            activeThreadStatus?.codexCompactionSource ?? null
          }
          codexCompactionCompletedAt={
            activeThreadStatus?.codexCompactionCompletedAt ?? null
          }
          lastTokenUsageUpdatedAt={
            activeThreadStatus?.lastTokenUsageUpdatedAt ?? null
          }
          accountRateLimits={null}
          usageShowRemaining={options.usageShowRemaining}
          onRefreshAccountRateLimits={options.onRefreshAccountRateLimits}
          queuedMessages={options.activeQueue}
          userInputRequests={[]}
          onJumpToUserInputRequest={handleJumpToUserInputRequest}
          runtimeLifecycleState={composerRuntimeLifecycleState}
          sendLabel={
            options.composerSendLabel ??
            ((isSharedSession &&
              (sharedSendState === "running" ||
                sharedSendState === "settling")) ||
            (options.isProcessing && !options.steerEnabled)
              ? t("messages.queue")
              : t("messages.send"))
          }
          steerEnabled={options.steerEnabled}
          isProcessing={options.isProcessing}
          onDraftChange={options.onDraftChange}
          attachedImages={options.activeImages}
          onPickImages={options.onPickImages}
          onAttachImages={options.onAttachImages}
          onRemoveImage={options.onRemoveImage}
          intentCanvasAttachments={options.pendingIntentCanvasDocuments}
          onRemoveIntentCanvasAttachment={options.onRemovePendingIntentCanvas}
          prefillDraft={options.prefillDraft}
          onPrefillHandled={options.onPrefillHandled}
          insertText={options.insertText}
          onInsertHandled={options.onInsertHandled}
          onEditQueued={options.onEditQueued}
          onDeleteQueued={options.onDeleteQueued}
          onFuseQueued={options.onFuseQueued}
          canFuseQueuedMessages={options.canFuseActiveQueue}
          fuseDisabledReasonKey={options.fuseDisabledReasonKey ?? null}
          fusingQueuedMessageId={options.activeFusingMessageId}
          collaborationModes={options.collaborationModes}
          collaborationModesEnabled={options.collaborationModesEnabled}
          selectedCollaborationModeId={options.selectedCollaborationModeId}
          onSelectCollaborationMode={options.onSelectCollaborationMode}
          isSharedSession={isSharedSession && !createSessionTargetPicker}
          createSessionTargetPicker={createSessionTargetPicker}
          onCreationTargetEngineChange={
            createSessionTargetPicker
              ? setHomeCreationTargetEngine
              : undefined
          }
          sharedTargetPickerLocked={
            !createSessionTargetPicker && isPickerLocked(sharedSendState)
          }
          engines={options.engines}
          selectedEngine={options.selectedEngine}
          onSelectEngine={options.onSelectEngine}
          models={options.models}
          providerModelCatalogs={options.providerModelCatalogs}
          providerProfileId={
            isManagedEngineProviderProfileId(
              activeThreadSummary?.providerProfileId,
            )
              ? activeThreadSummary?.providerProfileId
              : null
          }
          providerProfileName={activeThreadSummary?.providerProfileName ?? null}
          dshAgentPreset={activeThreadSummary?.dshAgentPreset ?? null}
          selectedModelId={options.selectedModelId}
          onSelectModel={options.onSelectModel}
          reasoningOptions={options.reasoningOptions}
          selectedEffort={options.selectedEffort}
          onSelectEffort={options.onSelectEffort}
          reasoningSupported={options.reasoningSupported}
          onResolvedAlwaysThinkingChange={handleResolvedAlwaysThinkingChange}
          opencodeAgents={options.opencodeAgents}
          selectedOpenCodeAgent={options.selectedOpenCodeAgent}
          onSelectOpenCodeAgent={options.onSelectOpenCodeAgent}
          selectedAgent={composerSelectedAgent}
          onAgentSelect={options.onSelectAgent}
          onOpenAgentSettings={options.onOpenAgentSettings}
          onOpenPromptSettings={options.onOpenPromptSettings}
          onOpenModelSettings={options.onOpenModelSettings}
          onOpenCliSettings={options.onOpenCliSettings}
          onRefreshModelConfig={options.onRefreshModelConfig}
          isModelConfigRefreshing={options.isModelConfigRefreshing}
          opencodeVariantOptions={options.opencodeVariantOptions}
          selectedOpenCodeVariant={options.selectedOpenCodeVariant}
          onSelectOpenCodeVariant={options.onSelectOpenCodeVariant}
          accessMode={options.accessMode}
          onSelectAccessMode={options.onSelectAccessMode}
          skills={options.skills}
          customSkillDirectories={options.customSkillDirectories}
          prompts={options.prompts}
          commands={composerCommands}
          files={options.files}
          directories={options.directories}
          textareaRef={options.textareaRef}
          editorSettings={options.composerEditorSettings}
          sendShortcut={options.composerSendShortcut}
          interruptShortcutLabel={options.composerInterruptShortcutLabel}
          textareaHeight={options.textareaHeight}
          onTextareaHeightChange={options.onTextareaHeightChange}
          onOpenSkillsSettings={options.onOpenSkillsSettings}
          onOpenExperimentalSettings={options.onOpenExperimentalSettings}
          activeFilePath={options.activeComposerFilePath}
          activeFileLineRange={options.activeComposerFileLineRange}
          fileReferenceMode={options.fileReferenceMode}
          activeWorkspaceId={options.activeWorkspaceId}
          activeWorkspaceName={options.activeWorkspace?.name ?? null}
          activeWorkspacePath={options.activeWorkspace?.path ?? null}
          branchControl={branchControlEnabled ? composerBranchControl : null}
          // 首页（branchControlEnabled=false）的分支/指示器行由 HomeChat 自行渲染
          footerUsageIndicatorEnabled={branchControlEnabled}
          rewindWorkspaceGitState={rewindWorkspaceGitState}
          plan={options.plan}
          isPlanMode={options.isPlanMode}
          onOpenDiffPath={handleComposerOpenDiffPath}
          gitChangedFiles={
            // 非 git 仓库时传 null，退回 tool 统计；空数组表示 clean working tree
            options.gitStatus.error === "not a git repository"
              ? null
              : options.gitStatus.files
          }
          isGitRepository={options.gitStatus.error !== "not a git repository"}
          onRequestGitStatusRefresh={options.queueGitStatusRefresh}
          onRevertFile={options.onRevertGitFile}
          onRevertAllFiles={options.onRevertGitPaths}
          showStatusPanelToggleOverride={false}
          statusPanelExpandedOverride={false}
          onToggleStatusPanelOverride={undefined}
          selectedCodeAnnotations={selectedCodeAnnotations}
          onRemoveCodeAnnotation={handleRemoveCodeAnnotation}
          onClearCodeAnnotations={handleClearCodeAnnotations}
          externalNoteCardSelectionRequest={externalNoteCardRequest}
          reviewPrompt={options.reviewPrompt}
          onReviewPromptClose={options.onReviewPromptClose}
          onReviewPromptShowPreset={options.onReviewPromptShowPreset}
          onReviewPromptChoosePreset={options.onReviewPromptChoosePreset}
          highlightedPresetIndex={options.highlightedPresetIndex}
          onReviewPromptHighlightPreset={options.onReviewPromptHighlightPreset}
          highlightedBranchIndex={options.highlightedBranchIndex}
          onReviewPromptHighlightBranch={options.onReviewPromptHighlightBranch}
          highlightedCommitIndex={options.highlightedCommitIndex}
          onReviewPromptHighlightCommit={options.onReviewPromptHighlightCommit}
          onReviewPromptKeyDown={options.onReviewPromptKeyDown}
          onReviewPromptSelectBranch={options.onReviewPromptSelectBranch}
          onReviewPromptSelectBranchAtIndex={
            options.onReviewPromptSelectBranchAtIndex
          }
          onReviewPromptConfirmBranch={options.onReviewPromptConfirmBranch}
          onReviewPromptSelectCommit={options.onReviewPromptSelectCommit}
          onReviewPromptSelectCommitAtIndex={
            options.onReviewPromptSelectCommitAtIndex
          }
          onReviewPromptConfirmCommit={options.onReviewPromptConfirmCommit}
          onReviewPromptUpdateCustomInstructions={
            options.onReviewPromptUpdateCustomInstructions
          }
          onReviewPromptConfirmCustom={options.onReviewPromptConfirmCustom}
        />
        <SharedSendStatusBar
          workspaceId={options.activeWorkspaceId ?? null}
          threadId={options.activeThreadId ?? null}
          isSharedSession={isSharedSession && !createSessionTargetPicker}
        />
      </Profiler>
    ) : null,
    [
      options.showComposer,
      options.threadParentById,
      options.onSend,
      options.onQueue,
      options.onRequestContextCompaction,
      options.onStop,
      options.completionEmailSelected,
      options.completionEmailDisabled,
      options.onToggleCompletionEmail,
      options.onRewind,
      rewindDialogRequest,
      handleRewindDialogRequestConsumed,
      options.canStop,
      options.isReviewing,
      isSharedSession,
      sharedSendState,
      options.contextDualViewEnabled,
      options.codexAutoCompactionEnabled,
      options.codexAutoCompactionThresholdPercent,
      options.onCodexAutoCompactionSettingsChange,
      activeThreadStatus?.isContextCompacting,
      activeThreadStatus?.codexCompactionLifecycleState,
      activeThreadStatus?.codexCompactionSource,
      activeThreadStatus?.codexCompactionCompletedAt,
      activeThreadStatus?.lastTokenUsageUpdatedAt,
      options.usageShowRemaining,
      options.onRefreshAccountRateLimits,
      options.activeQueue,
      handleJumpToUserInputRequest,
      composerRuntimeLifecycleState,
      options.composerSendLabel,
      options.isProcessing,
      options.steerEnabled,
      t,
      options.onDraftChange,
      options.activeImages,
      options.onPickImages,
      options.onAttachImages,
      options.onRemoveImage,
      options.pendingIntentCanvasDocuments,
      options.onRemovePendingIntentCanvas,
      options.prefillDraft,
      options.onPrefillHandled,
      options.insertText,
      options.onInsertHandled,
      options.onEditQueued,
      options.onDeleteQueued,
      options.onFuseQueued,
      options.canFuseActiveQueue,
      options.fuseDisabledReasonKey,
      options.activeFusingMessageId,
      options.collaborationModes,
      options.collaborationModesEnabled,
      options.selectedCollaborationModeId,
      options.onSelectCollaborationMode,
      setHomeCreationTargetEngine,
      options.engines,
      options.selectedEngine,
      options.onSelectEngine,
      options.models,
      options.providerModelCatalogs,
      activeThreadSummary?.providerProfileId,
      activeThreadSummary?.providerProfileName,
      options.selectedModelId,
      options.onSelectModel,
      options.reasoningOptions,
      options.selectedEffort,
      options.onSelectEffort,
      options.reasoningSupported,
      handleResolvedAlwaysThinkingChange,
      options.opencodeAgents,
      options.selectedOpenCodeAgent,
      options.onSelectOpenCodeAgent,
      composerSelectedAgent,
      options.onSelectAgent,
      options.onOpenAgentSettings,
      options.onOpenPromptSettings,
      options.onOpenModelSettings,
      options.onOpenCliSettings,
      options.onRefreshModelConfig,
      options.isModelConfigRefreshing,
      options.opencodeVariantOptions,
      options.selectedOpenCodeVariant,
      options.onSelectOpenCodeVariant,
      options.accessMode,
      options.onSelectAccessMode,
      options.skills,
      options.customSkillDirectories,
      options.prompts,
      composerCommands,
      options.files,
      options.directories,
      options.textareaRef,
      options.composerEditorSettings,
      options.composerSendShortcut,
      options.composerInterruptShortcutLabel,
      options.textareaHeight,
      options.onTextareaHeightChange,
      options.onOpenSkillsSettings,
      options.onOpenExperimentalSettings,
      options.activeComposerFilePath,
      options.activeComposerFileLineRange,
      options.fileReferenceMode,
      options.activeWorkspaceId,
      options.activeWorkspace?.name,
      options.activeWorkspace?.path,
      options.activeThreadId,
      composerBranchControl,
      rewindWorkspaceGitState,
      options.plan,
      options.isPlanMode,
      handleComposerOpenDiffPath,
      options.gitStatus.error,
      options.gitStatus.files,
      options.queueGitStatusRefresh,
      options.onRevertGitFile,
      options.onRevertGitPaths,
      selectedCodeAnnotations,
      handleRemoveCodeAnnotation,
      handleClearCodeAnnotations,
      options.reviewPrompt,
      options.onReviewPromptClose,
      options.onReviewPromptShowPreset,
      options.onReviewPromptChoosePreset,
      options.highlightedPresetIndex,
      options.onReviewPromptHighlightPreset,
      options.highlightedBranchIndex,
      options.onReviewPromptHighlightBranch,
      options.highlightedCommitIndex,
      options.onReviewPromptHighlightCommit,
      options.onReviewPromptKeyDown,
      options.onReviewPromptSelectBranch,
      options.onReviewPromptSelectBranchAtIndex,
      options.onReviewPromptConfirmBranch,
      options.onReviewPromptSelectCommit,
      options.onReviewPromptSelectCommitAtIndex,
      options.onReviewPromptConfirmCommit,
      options.onReviewPromptUpdateCustomInstructions,
      options.onReviewPromptConfirmCustom,
      handleRuntimeProfileRender,
    ],
  );

  // Composer 内部 ComposerGate 负责轻量→完整过渡（根治：不再外层 Deferred 双层延迟）
  const composerNode = useMemo(
    () => renderComposerNode(false, true, noteCardSelectionRequest),
    [renderComposerNode, noteCardSelectionRequest],
  );

  // 首页：分支徽标与工作区选择并排渲染在 HomeChat 里，故 Composer 内不再重复
  const homeComposerNode = useMemo(
    () => renderComposerNode(false, false, null, true),
    [renderComposerNode],
  );
  const approvalToastsNode = null;

  const updateToastNode = useMemo(
    () => (
      <UpdateToast
        state={options.updaterState}
        onUpdate={options.onUpdate}
        onDismiss={options.onDismissUpdate}
      />
    ),
    [options.updaterState, options.onUpdate, options.onDismissUpdate],
  );

  const errorToastsNode = useMemo(
    () => (
      <ErrorToasts
        toasts={options.errorToasts}
        onDismiss={options.onDismissErrorToast}
      />
    ),
    [options.errorToasts, options.onDismissErrorToast],
  );
  const homeWorkspaceOptions = useMemo(
    () =>
      getHomeWorkspaceOptions(options.groupedWorkspaces, options.workspaces),
    [options.groupedWorkspaces, options.workspaces],
  );

  const homeNode = useMemo(
    () => (
      <HomeChat
        workspaces={homeWorkspaceOptions}
        selectedWorkspaceId={resolveHomeWorkspaceId(
          options.activeWorkspace?.id ?? null,
          homeWorkspaceOptions,
        )}
        onSelectWorkspace={options.onSelectHomeWorkspace}
        onAddWorkspace={options.onAddWorkspace}
        composerNode={homeComposerNode}
        selectedEngine={homeCreationTargetEngine ?? options.selectedEngine}
        branchControl={composerBranchControl}
      />
    ),
    [
      homeWorkspaceOptions,
      options.activeWorkspace?.id,
      options.onSelectHomeWorkspace,
      options.onAddWorkspace,
      homeComposerNode,
      homeCreationTargetEngine,
      options.selectedEngine,
      composerBranchControl,
    ],
  );

  const mainHeaderNode = useMemo(
    () =>
      options.activeWorkspace ? (
        <MainHeader
          workspace={options.activeWorkspace}
          parentName={options.activeParentWorkspace?.name ?? null}
          worktreePath={
            options.isWorktreeWorkspace ? options.activeWorkspace.path : null
          }
          activeFilePath={options.activeComposerFilePath}
          openTargets={options.openAppTargets}
          openAppIconById={options.openAppIconById}
          selectedOpenAppId={options.selectedOpenAppId}
          onSelectOpenAppId={options.onSelectOpenAppId}
          sessionTabsNode={sessionTabsNode}
          canCopyThread={canCopyActiveThread}
          onCopyThread={options.onCopyThread}
          onLockPanel={options.onLockPanel}
          launchScript={options.launchScript}
          launchScriptEditorOpen={options.launchScriptEditorOpen}
          launchScriptDraft={options.launchScriptDraft}
          launchScriptSaving={options.launchScriptSaving}
          launchScriptError={options.launchScriptError}
          onRunLaunchScript={options.onRunLaunchScript}
          onOpenLaunchScriptEditor={options.onOpenLaunchScriptEditor}
          onCloseLaunchScriptEditor={options.onCloseLaunchScriptEditor}
          onLaunchScriptDraftChange={options.onLaunchScriptDraftChange}
          onSaveLaunchScript={options.onSaveLaunchScript}
          launchScriptsState={options.launchScriptsState}
          showLaunchScriptControls={showTopRunControls}
          showOpenAppMenu={showOpenWorkspaceAppControl}
          openAppExtraActions={options.mainHeaderActions}
          groupedWorkspaces={groupedWorkspacesForHeader}
          activeWorkspaceId={options.activeWorkspaceId}
          onSelectWorkspace={options.onSelectWorkspace}
          onOpenShortcutsSettings={options.onOpenShortcutsSettings}

        />
      ) : null,
    [
      options.activeWorkspace,
      options.activeParentWorkspace?.name,
      options.isWorktreeWorkspace,
      options.activeComposerFilePath,
      options.openAppTargets,
      options.openAppIconById,
      options.selectedOpenAppId,
      options.onSelectOpenAppId,
      sessionTabsNode,
      canCopyActiveThread,
      options.onCopyThread,
      options.onLockPanel,
      options.launchScript,
      options.launchScriptEditorOpen,
      options.launchScriptDraft,
      options.launchScriptSaving,
      options.launchScriptError,
      options.onRunLaunchScript,
      options.onOpenLaunchScriptEditor,
      options.onCloseLaunchScriptEditor,
      options.onLaunchScriptDraftChange,
      options.onSaveLaunchScript,
      options.launchScriptsState,
      showTopRunControls,
      showOpenWorkspaceAppControl,
      options.mainHeaderActions,
      groupedWorkspacesForHeader,
      options.activeWorkspaceId,
      options.onSelectWorkspace,
      options.onOpenShortcutsSettings,
    ],
  );

  const desktopTopbarLeftNode = useMemo(
    () =>
      buildDesktopTopbarLeftNode({
        centerMode: options.centerMode,
        backLabel: t("files.backToChat"),
        mainHeaderNode,
        contextMenuNode: topbarTabContextMenuNode,
        onExitDiff: options.onExitDiff,
      }),
    [
      options.centerMode,
      t,
      mainHeaderNode,
      topbarTabContextMenuNode,
      options.onExitDiff,
    ],
  );

  const tabletNavNode = useMemo(
    () => (
      <TabletNav
        activeTab={options.tabletNavTab}
        onSelect={options.onSelectTab}
      />
    ),
    [options.tabletNavTab, options.onSelectTab],
  );

  const tabBarNode = useMemo(
    () => (
      <TabBar activeTab={options.activeTab} onSelect={options.onSelectTab} />
    ),
    [options.activeTab, options.onSelectTab],
  );
  const activeWorkspaceCustomSpecRoot = useMemo(() => {
    if (!options.activeWorkspace?.id) {
      return null;
    }
    const value = getClientStoreSync<string | null>(
      "app",
      `specHub.specRoot.${options.activeWorkspace.id}`,
    );
    return normalizeSpecRootInput(value);
  }, [options.activeWorkspace?.id]);

  const sidebarSelectedDiffPath =
    options.centerMode === "diff" ? options.selectedDiffPath : null;
  const onOpenProjectMap = options.onOpenProjectMap;
  const onOpenIntentCanvas = options.onOpenIntentCanvas;
  const onOpenSpecHub = options.onOpenSpecHub;
  const onOpenDetachedFileExplorer = options.onOpenDetachedFileExplorer;
  const handleAssociateIntentCanvasCodeAnchor = useCallback(
    async (anchor: IntentCanvasCodeSelectionAnchor) => {
      if (!options.activeWorkspace) {
        pushErrorToast({
          title: "无法关联 Canvas",
          message: "请先选择一个工作区。",
          variant: "info",
          durationMs: 4200,
        });
        return;
      }
      let graph: CanvasSemanticGraph;
      try {
        graph = await loadCodeSelectionRelationshipGraph({
          workspaceId: options.activeWorkspace.id,
          anchor,
          storageLocation:
            options.projectMapDatasetController?.activeReadLocation,
        });
      } catch (error) {
        pushErrorToast({
          title: "无法生成方法关系图",
          message: error instanceof Error ? error.message : String(error),
          variant: "info",
          durationMs: 5200,
        });
        return;
      }
      onOpenIntentCanvas?.({
        mode: "file",
        target: "new",
        title: `${anchor.symbolName} Canvas`,
        summary: `${anchor.symbolKind} ${anchor.symbolName} at ${anchor.filePath}:${anchor.declarationLine}`,
        source: {
          filePath: anchor.filePath,
          nodeTitle: anchor.symbolName,
          nodeKind: anchor.symbolKind,
          summary: `${anchor.symbolKind} ${anchor.symbolName}`,
        },
        seedSemanticGraphs: [graph],
      });
    },
    [
      onOpenIntentCanvas,
      options.activeWorkspace,
      options.projectMapDatasetController?.activeReadLocation,
    ],
  );
  const centerMode = options.centerMode;
  const setCenterMode = options.setCenterMode;
  const editorSplitCompanion = options.editorSplitCompanion;
  const setEditorSplitCompanion = options.setEditorSplitCompanion;
  const isProjectMapSurfaceActive =
    centerMode === "projectMap" ||
    (centerMode === "editor" && editorSplitCompanion === "projectMap");
  const isIntentCanvasSurfaceActive = centerMode === "intentCanvas";

  const handleRightPanelTabSelect = useCallback(
    (tabId: RightPanelTabSelection) => {
      // DISABLED: disable-session-activity-and-solo-mode
      if (tabId === "activity") {
        onFilePanelModeChange("files");
        return;
      }
      if (tabId === "specHub") {
        onOpenSpecHub();
        return;
      }
      if (tabId === "detachedExplorer") {
        onOpenDetachedFileExplorer?.();
        return;
      }
      if (tabId === "intentCanvas") {
        if (isIntentCanvasSurfaceActive) {
          setCenterMode("chat");
          return;
        }
        onOpenIntentCanvas?.();
        return;
      }
      if (tabId === "projectMap") {
        if (isProjectMapSurfaceActive) {
          if (centerMode === "editor") {
            setEditorSplitCompanion("chat");
            return;
          }
          setCenterMode("chat");
          return;
        }
        if (centerMode === "editor") {
          setEditorSplitCompanion("projectMap");
          if (isEditorFileMaximized) {
            onToggleEditorFileMaximized();
          }
          return;
        }
        onOpenProjectMap();
        return;
      }
      if (tabId === "notes") {
        onFilePanelModeChange("notes");
        setCenterMode(centerMode === "notes" ? "chat" : "notes");
        return;
      }
      if (centerMode === "notes") {
        setCenterMode("chat");
      }
      onFilePanelModeChange(tabId);
    },
    [
      isIntentCanvasSurfaceActive,
      isProjectMapSurfaceActive,
      centerMode,
      onFilePanelModeChange,
      onOpenProjectMap,
      onOpenIntentCanvas,
      onOpenSpecHub,
      onOpenDetachedFileExplorer,
      isEditorFileMaximized,
      onToggleEditorFileMaximized,
      setCenterMode,
      setEditorSplitCompanion,
    ],
  );

  const rightPanelToolbarNode = useMemo(
    () =>
      buildRightPanelToolbarNode({
        active: options.activeTab === "spec"
          ? "specHub"
          : isIntentCanvasSurfaceActive
            ? "intentCanvas"
            : isProjectMapSurfaceActive
              ? "projectMap"
              : options.filePanelMode,
        showToolbar: showRightActivityToolbar,
        hasVisibleControl: hasVisibleRightToolbarControl,
        activityLive: workspaceActivity.isProcessing,
        radarLive: options.sessionRadarRunningSessions.length > 0,
        visibleTabs: rightToolbarVisibleTabs,
        gitModeControlsTargetRef: setGitModeControlsTarget,
        onSelect: handleRightPanelTabSelect,
      }),
    [
      options.activeTab,
      isIntentCanvasSurfaceActive,
      isProjectMapSurfaceActive,
      options.filePanelMode,
      showRightActivityToolbar,
      hasVisibleRightToolbarControl,
      workspaceActivity.isProcessing,
      options.sessionRadarRunningSessions.length,
      rightToolbarVisibleTabs,
      setGitModeControlsTarget,
      handleRightPanelTabSelect,
    ],
  );

  const gitDiffPanelNode = useMemo(() => {
    if (
      (options.filePanelMode === "files" ||
        options.filePanelMode === "notes" ||
        // DISABLED activity: treat residual mode as files until normalize runs
        options.filePanelMode === "activity") &&
      options.activeWorkspace
    ) {
      return (
        <FileTreePanel
          workspaceId={options.activeWorkspace.id}
          workspaceName={options.activeWorkspace.name}
          workspacePath={options.activeWorkspace.path}
          gitRoot={options.gitRoot}
          files={options.files}
          directories={options.directories}
          directoryMetadata={options.directoryMetadata}
          sourceVersion={options.fileTreeSourceVersion}
          isLoading={options.fileTreeLoading}
          loadError={options.fileTreeLoadError}
          filePanelMode="files"
          onFilePanelModeChange={options.onFilePanelModeChange}
          onInsertText={options.onInsertComposerText}
          onOpenFile={options.onOpenFile}
          onCompareFiles={options.onCompareFiles}
          openTargets={options.openAppTargets}
          openAppIconById={options.openAppIconById}
          selectedOpenAppId={options.selectedOpenAppId}
          onSelectOpenAppId={options.onSelectOpenAppId}
          onToggleRuntimeConsole={options.onToggleRuntimeConsole}
          isRuntimeConsoleVisible={options.runtimeConsoleVisible}
          showSpecHubAction={false}
          showDetachedExplorerAction={false}
          gitStatusFiles={options.gitStatus.files}
          gitRepositories={options.gitRepositories}
          onGitRepositoryAction={handleFileTreeGitRepositoryAction}
          onOpenFileHistory={options.onOpenFileHistory}
          gitignoredFiles={options.gitignoredFiles}
          gitignoredDirectories={options.gitignoredDirectories}
          onRefreshFiles={options.onRefreshFiles}
          revealRequest={fileTreeRevealRequest}
        />
      );
    }
    if (options.filePanelMode === "search") {
      return (
        <WorkspaceSearchPanel
          workspaceId={options.activeWorkspace?.id ?? null}
          filePanelMode={options.filePanelMode}
          onFilePanelModeChange={options.onFilePanelModeChange}
          onOpenFile={options.onOpenFile}
        />
      );
    }
    if (options.filePanelMode === "prompts") {
      return (
        <PromptPanel
          prompts={options.prompts}
          workspacePath={options.activeWorkspace?.path ?? null}
          filePanelMode={options.filePanelMode}
          onFilePanelModeChange={options.onFilePanelModeChange}
          onSendPrompt={options.onSendPrompt}
          onSendPromptToNewAgent={options.onSendPromptToNewAgent}
          onCreatePrompt={options.onCreatePrompt}
          onUpdatePrompt={options.onUpdatePrompt}
          onDeletePrompt={options.onDeletePrompt}
          onMovePrompt={options.onMovePrompt}
          onRevealWorkspacePrompts={options.onRevealWorkspacePrompts}
          onRevealGeneralPrompts={options.onRevealGeneralPrompts}
          canRevealGeneralPrompts={options.canRevealGeneralPrompts}
        />
      );
    }
    if (options.filePanelMode === "memory") {
      return (
        <ProjectMemoryPanel
          workspaceId={options.activeWorkspace?.id ?? null}
          workspaces={options.workspaces}
          onSelectWorkspace={options.onSelectWorkspace}
          filePanelMode={options.filePanelMode}
          onFilePanelModeChange={options.onFilePanelModeChange}
          focusMemoryId={options.focusedProjectMemoryId ?? null}
          focusRequestKey={options.focusedProjectMemoryRequestKey ?? 0}
        />
      );
    }
    if (options.filePanelMode === "radar") {
      return (
        <WorkspaceSessionRadarPanel
          runningSessions={options.sessionRadarRunningSessions}
          recentCompletedSessions={options.sessionRadarRecentCompletedSessions}
          onSelectThread={options.onSelectThread}
        />
      );
    }
    return (
      <Suspense fallback={<HeavyPanelFallback />}>
        <GitDiffPanel
          workspaceId={options.activeWorkspace?.id ?? null}
          workspacePath={options.activeWorkspace?.path ?? null}
          headerControlsTarget={gitModeControlsTarget}
          mode={options.gitPanelMode}
          onModeChange={options.onGitPanelModeChange}
          onOpenGitHistoryPanel={options.onOpenGitHistoryPanel}
          isGitHistoryOpen={options.appMode === "gitHistory"}
          diffEntries={options.gitDiffs}
          gitDiffListView={options.gitDiffListView}
          onGitDiffListViewChange={options.onGitDiffListViewChange}
          toggleGitDiffListViewShortcut={options.toggleGitDiffListViewShortcut}
          filePanelMode={options.filePanelMode}
          onFilePanelModeChange={options.onFilePanelModeChange}
          worktreeApplyLabel={options.worktreeApplyLabel}
          worktreeApplyTitle={options.worktreeApplyTitle}
          worktreeApplyLoading={options.worktreeApplyLoading}
          worktreeApplyError={options.worktreeApplyError}
          worktreeApplySuccess={options.worktreeApplySuccess}
          onApplyWorktreeChanges={options.onApplyWorktreeChanges}
          branchName={
            options.gitStatus.branchName || t("workspace.unknownBranch")
          }
          totalAdditions={canonicalGitPanelTotals.additions}
          totalDeletions={canonicalGitPanelTotals.deletions}
          fileStatus={options.fileStatus}
          diffViewStyle={options.gitDiffViewStyle}
          onDiffViewStyleChange={options.onGitDiffViewStyleChange}
          error={options.gitStatus.error}
          logError={options.gitLogError}
          logLoading={options.gitLogLoading}
          stagedFiles={canonicalGitPanelChanges.stagedFiles}
          unstagedFiles={canonicalGitPanelChanges.unstagedFiles}
          onSelectFile={options.onSelectDiff}
          onOpenFile={(path, repositoryRoot) =>
            options.onOpenFile(path, undefined, {
              pathDomain: "git",
              repositoryRoot,
            })
          }
          onOpenFileHistory={options.onOpenFileHistory}
          modalPreviewRequest={gitModalPreviewRequest}
          selectedPath={sidebarSelectedDiffPath}
          logEntries={options.gitLogEntries}
          logTotal={options.gitLogTotal}
          logAhead={options.gitLogAhead}
          logBehind={options.gitLogBehind}
          logAheadEntries={options.gitLogAheadEntries}
          logBehindEntries={options.gitLogBehindEntries}
          logUpstream={options.gitLogUpstream}
          selectedCommitSha={options.selectedCommitSha}
          onSelectCommit={options.onSelectCommit}
          issues={options.gitIssues}
          issuesTotal={options.gitIssuesTotal}
          issuesLoading={options.gitIssuesLoading}
          issuesError={options.gitIssuesError}
          pullRequests={options.gitPullRequests}
          pullRequestsTotal={options.gitPullRequestsTotal}
          pullRequestsLoading={options.gitPullRequestsLoading}
          pullRequestsError={options.gitPullRequestsError}
          selectedPullRequest={options.selectedPullRequestNumber}
          onSelectPullRequest={options.onSelectPullRequest}
          gitRemoteUrl={options.gitRemoteUrl}
          gitRoot={options.gitRoot}
          gitRootCandidates={options.gitRootCandidates}
          gitRootScanDepth={options.gitRootScanDepth}
          gitRootScanLoading={options.gitRootScanLoading}
          gitRootScanError={options.gitRootScanError}
          gitRootScanHasScanned={options.gitRootScanHasScanned}
          onGitRootScanDepthChange={options.onGitRootScanDepthChange}
          onScanGitRoots={options.onScanGitRoots}
          onSelectGitRoot={options.onSelectGitRoot}
          onClearGitRoot={options.onClearGitRoot}
          onPickGitRoot={options.onPickGitRoot}
          onStageAllChanges={options.onStageGitAll}
          onStageFile={options.onStageGitFile}
          onUnstageAllChanges={options.onUnstageGitAll}
          onUnstageFile={options.onUnstageGitFile}
          onUnstageFiles={options.onUnstageGitPaths}
          onRevertFile={options.onRevertGitFile}
          onRevertFiles={options.onRevertGitPaths}
          onRevertAllChanges={options.onRevertAllGitChanges}
          commitMessage={options.commitMessage}
          commitMessageLoading={options.commitMessageLoading}
          commitMessageError={options.commitMessageError}
          onCommitMessageChange={options.onCommitMessageChange}
          onGenerateCommitMessage={options.onGenerateCommitMessage}
          onCommit={options.onCommit}
          onCommitAndPush={options.onCommitAndPush}
          onCommitAndSync={options.onCommitAndSync}
          onPush={options.onPush}
          onSync={options.onSync}
          commitLoading={options.commitLoading}
          pushLoading={options.pushLoading}
          syncLoading={options.syncLoading}
          commitError={options.commitError}
          pushError={options.pushError}
          syncError={options.syncError}
          commitsAhead={options.commitsAhead}
          multiRepositoryMode={options.multiRepositoryMode}
          repositoryStatuses={options.repositoryStatuses}
          repositoryStatusesLoading={options.repositoryStatusesLoading}
          onRefreshRepositoryStatuses={options.onRefreshRepositoryStatuses}
          onStageRepositoryFile={options.onStageRepositoryFile}
          onUnstageRepositoryFile={options.onUnstageRepositoryFile}
          onUnstageRepositoryAll={options.onUnstageRepositoryAll}
          onUnstageRepositoryFiles={options.onUnstageRepositoryFiles}
          onRevertRepositoryFile={options.onRevertRepositoryFile}
          onRevertRepositoryFiles={options.onRevertRepositoryFiles}
          onStageRepositoryAll={options.onStageRepositoryAll}
          onCommitRepositories={options.onCommitRepositories}
          repositoryCommitSummary={options.repositoryCommitSummary}
          onRefreshGitStatus={options.queueGitStatusRefresh}
          onRefreshGitLog={options.refreshGitLog}
          onRefreshGitDiffs={options.refreshGitDiffs}
          onCreateCodeAnnotation={handleCreateCodeAnnotation}
          onRemoveCodeAnnotation={handleRemoveCodeAnnotation}
          codeAnnotations={selectedCodeAnnotations}
        />
      </Suspense>
    );
  }, [
    options.filePanelMode,
    options.activeWorkspace,
    options.gitRoot,
    options.files,
    options.directories,
    options.directoryMetadata,
    options.fileTreeSourceVersion,
    options.fileTreeLoading,
    options.fileTreeLoadError,
    options.onFilePanelModeChange,
    options.onInsertComposerText,
    options.onOpenFile,
    options.onCompareFiles,
    options.openAppTargets,
    options.openAppIconById,
    options.selectedOpenAppId,
    options.onSelectOpenAppId,
    options.onToggleRuntimeConsole,
    options.runtimeConsoleVisible,
    options.gitStatus.files,
    options.gitStatus.branchName,
    options.gitStatus.error,
    options.gitRepositories,
    handleFileTreeGitRepositoryAction,
    options.onOpenFileHistory,
    options.gitignoredFiles,
    options.gitignoredDirectories,
    options.onRefreshFiles,
    fileTreeRevealRequest,
    options.prompts,
    options.onSendPrompt,
    options.onSendPromptToNewAgent,
    options.onCreatePrompt,
    options.onUpdatePrompt,
    options.onDeletePrompt,
    options.onMovePrompt,
    options.onRevealWorkspacePrompts,
    options.onRevealGeneralPrompts,
    options.canRevealGeneralPrompts,
    options.workspaces,
    options.onSelectWorkspace,
    options.focusedProjectMemoryId,
    options.focusedProjectMemoryRequestKey,
    options.sessionRadarRunningSessions,
    options.sessionRadarRecentCompletedSessions,
    options.onSelectThread,
    gitModeControlsTarget,
    options.gitPanelMode,
    options.onGitPanelModeChange,
    options.onOpenGitHistoryPanel,
    options.appMode,
    options.gitDiffs,
    options.gitDiffListView,
    options.onGitDiffListViewChange,
    options.toggleGitDiffListViewShortcut,
    options.worktreeApplyLabel,
    options.worktreeApplyTitle,
    options.worktreeApplyLoading,
    options.worktreeApplyError,
    options.worktreeApplySuccess,
    options.onApplyWorktreeChanges,
    t,
    canonicalGitPanelTotals.additions,
    canonicalGitPanelTotals.deletions,
    options.fileStatus,
    options.gitDiffViewStyle,
    options.onGitDiffViewStyleChange,
    options.gitLogError,
    options.gitLogLoading,
    canonicalGitPanelChanges.stagedFiles,
    canonicalGitPanelChanges.unstagedFiles,
    options.onSelectDiff,
    gitModalPreviewRequest,
    sidebarSelectedDiffPath,
    options.gitLogEntries,
    options.gitLogTotal,
    options.gitLogAhead,
    options.gitLogBehind,
    options.gitLogAheadEntries,
    options.gitLogBehindEntries,
    options.gitLogUpstream,
    options.selectedCommitSha,
    options.onSelectCommit,
    options.gitIssues,
    options.gitIssuesTotal,
    options.gitIssuesLoading,
    options.gitIssuesError,
    options.gitPullRequests,
    options.gitPullRequestsTotal,
    options.gitPullRequestsLoading,
    options.gitPullRequestsError,
    options.selectedPullRequestNumber,
    options.onSelectPullRequest,
    options.gitRemoteUrl,
    options.gitRootCandidates,
    options.gitRootScanDepth,
    options.gitRootScanLoading,
    options.gitRootScanError,
    options.gitRootScanHasScanned,
    options.onGitRootScanDepthChange,
    options.onScanGitRoots,
    options.onSelectGitRoot,
    options.onClearGitRoot,
    options.onPickGitRoot,
    options.onStageGitAll,
    options.onStageGitFile,
    options.onUnstageGitAll,
    options.onUnstageGitFile,
    options.onUnstageGitPaths,
    options.onRevertGitFile,
    options.onRevertGitPaths,
    options.onRevertAllGitChanges,
    options.commitMessage,
    options.commitMessageLoading,
    options.commitMessageError,
    options.onCommitMessageChange,
    options.onGenerateCommitMessage,
    options.onCommit,
    options.onCommitAndPush,
    options.onCommitAndSync,
    options.onPush,
    options.onSync,
    options.commitLoading,
    options.pushLoading,
    options.syncLoading,
    options.commitError,
    options.pushError,
    options.syncError,
    options.commitsAhead,
    options.multiRepositoryMode,
    options.repositoryStatuses,
    options.repositoryStatusesLoading,
    options.onRefreshRepositoryStatuses,
    options.onStageRepositoryFile,
    options.onUnstageRepositoryFile,
    options.onUnstageRepositoryAll,
    options.onUnstageRepositoryFiles,
    options.onRevertRepositoryFile,
    options.onRevertRepositoryFiles,
    options.onStageRepositoryAll,
    options.onCommitRepositories,
    options.repositoryCommitSummary,
    options.queueGitStatusRefresh,
    options.refreshGitLog,
    options.refreshGitDiffs,
    handleCreateCodeAnnotation,
    handleRemoveCodeAnnotation,
    selectedCodeAnnotations,
  ]);

  const gitDiffViewerNode = useMemo(
    () => (
      <GitDiffViewer
        workspaceId={options.activeWorkspace?.id ?? null}
        diffs={options.gitDiffs}
        listView={options.gitDiffListView}
        selectedPath={options.selectedDiffPath}
        scrollRequestId={options.diffScrollRequestId}
        isLoading={options.gitDiffLoading}
        error={options.gitDiffError}
        diffStyle={options.gitDiffViewStyle}
        alignedTextPreview
        onDiffStyleChange={options.onGitDiffViewStyleChange}
        pullRequest={options.selectedPullRequest}
        pullRequestComments={options.selectedPullRequestComments}
        pullRequestCommentsLoading={options.selectedPullRequestCommentsLoading}
        pullRequestCommentsError={options.selectedPullRequestCommentsError}
        onActivePathChange={options.onDiffActivePathChange}
        onOpenFile={options.onOpenFile}
        onRequestClose={options.onExitDiff}
        onCreateCodeAnnotation={handleCreateCodeAnnotation}
        onRemoveCodeAnnotation={handleRemoveCodeAnnotation}
        codeAnnotations={selectedCodeAnnotations}
        codeAnnotationSurface="embedded-diff-view"
      />
    ),
    [
      options.activeWorkspace?.id,
      options.gitDiffs,
      options.gitDiffListView,
      options.selectedDiffPath,
      options.diffScrollRequestId,
      options.gitDiffLoading,
      options.gitDiffError,
      options.gitDiffViewStyle,
      options.onGitDiffViewStyleChange,
      options.selectedPullRequest,
      options.selectedPullRequestComments,
      options.selectedPullRequestCommentsLoading,
      options.selectedPullRequestCommentsError,
      options.onDiffActivePathChange,
      options.onOpenFile,
      options.onExitDiff,
      handleCreateCodeAnnotation,
      handleRemoveCodeAnnotation,
      selectedCodeAnnotations,
    ],
  );

  // 重面板节点必须 memo：未 memo 的新元素身份会击穿 AppLayout 的 ReactNode
  // props Object.is 比较，让根 render 反复重渲染已挂载的重面板（S1 残余项）。
  const fileViewPanelNode = useMemo(
    () =>
      options.editorFilePath && options.activeWorkspace ? (
      <Suspense fallback={<HeavyPanelFallback />}>
        <FileViewPanel
          workspaceId={options.activeWorkspace.id}
          workspaceName={options.activeWorkspace.name}
          workspacePath={options.activeWorkspace.path}
          gitRoot={options.gitRoot}
          gitRepositories={options.gitRepositories}
          customSpecRoot={activeWorkspaceCustomSpecRoot}
          filePath={options.editorFilePath}
          navigationTarget={options.editorNavigationTarget}
          highlightMarkers={
            options.editorHighlightTarget?.path === options.editorFilePath
              ? options.editorHighlightTarget.markers
              : null
          }
          gitStatusFiles={options.gitStatus.files}
          openTabs={options.openEditorTabs}
          activeTabPath={options.editorFilePath}
          onActivateTab={options.onActivateEditorTab}
          onCloseTab={options.onCloseEditorTab}
          onCloseOtherTabs={options.onCloseOtherEditorTabs}
          onCloseAllTabs={options.onCloseAllEditorTabs}
          onReorderTabs={options.onReorderEditorTabs}
          fileReferenceMode={options.fileReferenceMode}
          onFileReferenceModeChange={options.onFileReferenceModeChange}
          activeFileLineRange={options.activeComposerFileLineRange}
          onActiveFileLineRangeChange={options.onActiveEditorLineRangeChange}
          onActiveCodeAnchorChange={options.onActiveCodeSelectionAnchorChange}
          onAssociateIntentCanvasCodeAnchor={
            handleAssociateIntentCanvasCodeAnchor
          }
          openTargets={options.openAppTargets}
          openAppIconById={options.openAppIconById}
          selectedOpenAppId={options.selectedOpenAppId}
          onSelectOpenAppId={options.onSelectOpenAppId}
          editorSplitLayout={options.editorSplitLayout}
          onToggleEditorSplitLayout={options.onToggleEditorSplitLayout}
          isEditorFileMaximized={options.isEditorFileMaximized}
          onToggleEditorFileMaximized={options.onToggleEditorFileMaximized}
          onNavigateToLocation={options.onOpenFile}
          onOpenFileHistory={options.onOpenFileHistory}
          onRevealInFileTree={handleRevealInFileTree}
          onClose={options.onExitEditor}
          onInsertText={options.onInsertComposerText}
          onCreateCodeAnnotation={handleCreateCodeAnnotation}
          onCaptureNote={handleCaptureWorkspaceNote}
          onRemoveCodeAnnotation={handleRemoveCodeAnnotation}
          codeAnnotations={selectedCodeAnnotations}
          externalChangeMonitoringEnabled={
            options.externalChangeMonitoringEnabled
          }
          externalChangeTransportMode={options.externalChangeTransportMode}
          externalChangeApplyMode={options.externalChangeApplyMode}
          externalChangeAutoApplyDebounceMs={
            options.externalChangeAutoApplyDebounceMs
          }
          markdownPreviewSnapshotMode={
            options.liveEditPreviewEnabled ? "live" : "stable"
          }
          fileRenderPressure={fileRenderPressure}
          saveFileShortcut={options.saveFileShortcut}
          findInFileShortcut={options.findInFileShortcut}
          expandSelectionShortcut={options.expandSelectionShortcut}
        />
      </Suspense>
      ) : null,
    [
      options.editorFilePath,
      options.activeWorkspace,
      options.gitRoot,
      options.gitRepositories,
      activeWorkspaceCustomSpecRoot,
      options.editorNavigationTarget,
      options.editorHighlightTarget,
      options.gitStatus.files,
      options.openEditorTabs,
      options.onActivateEditorTab,
      options.onCloseEditorTab,
      options.onCloseOtherEditorTabs,
      options.onCloseAllEditorTabs,
      options.onReorderEditorTabs,
      options.fileReferenceMode,
      options.onFileReferenceModeChange,
      options.activeComposerFileLineRange,
      options.onActiveEditorLineRangeChange,
      options.onActiveCodeSelectionAnchorChange,
      handleAssociateIntentCanvasCodeAnchor,
      options.openAppTargets,
      options.openAppIconById,
      options.selectedOpenAppId,
      options.onSelectOpenAppId,
      options.editorSplitLayout,
      options.onToggleEditorSplitLayout,
      options.isEditorFileMaximized,
      options.onToggleEditorFileMaximized,
      options.onOpenFile,
      options.onOpenFileHistory,
      handleRevealInFileTree,
      options.onExitEditor,
      options.onInsertComposerText,
      handleCreateCodeAnnotation,
      handleCaptureWorkspaceNote,
      handleRemoveCodeAnnotation,
      selectedCodeAnnotations,
      options.externalChangeMonitoringEnabled,
      options.externalChangeTransportMode,
      options.externalChangeApplyMode,
      options.externalChangeAutoApplyDebounceMs,
      options.liveEditPreviewEnabled,
      fileRenderPressure,
      options.saveFileShortcut,
      options.findInFileShortcut,
      options.expandSelectionShortcut,
    ],
  );

  const isWorkspaceNoteCardsMounted =
    options.centerMode === "notes" ||
    (options.centerMode === "editor" &&
      options.editorSplitCompanion === "notes");
  const noteCardsPanelNode = useMemo(
    () =>
      isWorkspaceNoteCardsMounted ? (
        <WorkspaceNoteCardPanel
          workspaceId={options.activeWorkspace?.id ?? null}
          workspaceName={options.activeWorkspace?.name ?? null}
          workspacePath={options.activeWorkspace?.path ?? null}
          focusNoteId={options.focusedWorkspaceNoteId ?? null}
          focusRequestKey={options.focusedWorkspaceNoteRequestKey ?? 0}
          captureRequest={workspaceNoteCaptureRequest}
          onCaptureRequestHandled={handleWorkspaceNoteCaptureRequestHandled}
          onReferenceNote={handleReferenceWorkspaceNote}
          onOpenCodeSource={handleOpenWorkspaceNoteCodeSource}
        />
      ) : null,
    [
      isWorkspaceNoteCardsMounted,
      options.activeWorkspace,
      options.focusedWorkspaceNoteId,
      options.focusedWorkspaceNoteRequestKey,
      workspaceNoteCaptureRequest,
      handleWorkspaceNoteCaptureRequestHandled,
      handleReferenceWorkspaceNote,
      handleOpenWorkspaceNoteCodeSource,
    ],
  );

  const fileComparePanelNode = useMemo(
    () =>
      options.centerMode === "fileCompare" ? (
        <WorkspaceFileComparePanel
          session={options.fileCompareSession}
          workspaceId={options.activeWorkspace?.id ?? null}
          workspaceName={options.activeWorkspace?.name ?? null}
          workspacePath={options.activeWorkspace?.path ?? null}
          saveFileShortcut={options.saveFileShortcut}
          onClose={options.onCloseFileCompare}
        />
      ) : null,
    [
      options.centerMode,
      options.fileCompareSession,
      options.activeWorkspace,
      options.saveFileShortcut,
      options.onCloseFileCompare,
    ],
  );

  const projectMapImpactInput = useMemo(
    () =>
      isProjectMapSurfaceActive
        ? buildGitStatusProjectMapImpactInput(options.gitStatus.files)
        : EMPTY_PROJECT_MAP_IMPACT_INPUT,
    [isProjectMapSurfaceActive, options.gitStatus.files],
  );
  const projectMapPanelNode = useMemo(
    () =>
      isProjectMapSurfaceActive ? (
        <Suspense fallback={<HeavyPanelFallback />}>
          <ProjectMapPanel
            key={options.activeWorkspace?.id ?? "no-workspace"}
            activeWorkspace={options.activeWorkspace ?? null}
            workspaceName={options.activeWorkspace?.name ?? null}
            selectedEngine={options.selectedEngine ?? null}
            selectedModelId={options.selectedModelId}
            models={options.models}
            datasetController={options.projectMapDatasetController}
            changedFilePaths={projectMapImpactInput.filePaths}
            changedFileSource={projectMapImpactInput.source}
            activeCodeSelectionAnchor={options.activeCodeSelectionAnchor}
            onOpenEvidenceFile={handleOpenProjectMapEvidenceFile}
            onOpenIntentCanvas={options.onOpenIntentCanvas}
            onOpenIntentCanvasFromRelationship={options.onOpenIntentCanvas}
          />
        </Suspense>
      ) : null,
    [
      isProjectMapSurfaceActive,
      options.activeWorkspace,
      options.selectedEngine,
      options.selectedModelId,
      options.models,
      options.projectMapDatasetController,
      projectMapImpactInput,
      options.activeCodeSelectionAnchor,
      handleOpenProjectMapEvidenceFile,
      options.onOpenIntentCanvas,
    ],
  );

  const intentCanvasPanelNode = useMemo(
    () =>
      isIntentCanvasSurfaceActive ? (
        <Suspense fallback={<HeavyPanelFallback />}>
          <IntentCanvasManager
            activeWorkspace={options.activeWorkspace ?? null}
            activeThreadId={options.activeThreadId ?? null}
            openRequest={options.intentCanvasOpenRequest ?? null}
            onOpenRequestConsumed={options.onIntentCanvasOpenRequestConsumed}
            onAttachToThread={options.onAttachIntentCanvasToThread}
            onOpenProjectMap={options.onOpenProjectMap}
            onOpenSourceFile={handleOpenProjectMapEvidenceFile}
          />
        </Suspense>
      ) : null,
    [
      isIntentCanvasSurfaceActive,
      options.activeWorkspace,
      options.activeThreadId,
      options.intentCanvasOpenRequest,
      options.onIntentCanvasOpenRequestConsumed,
      options.onAttachIntentCanvasToThread,
      options.onOpenProjectMap,
      handleOpenProjectMapEvidenceFile,
    ],
  );

  // 运行态入口改挂 Composer 上方 strip；底部 dock 暂不挂载。
  const planPanelNode = null;

  const terminalDockNode = buildTerminalDockNode({
    terminalState: options.terminalState,
    terminalOpen: options.terminalOpen,
    terminalTabs: options.terminalTabs,
    activeTerminalId: options.activeTerminalId,
    onToggleTerminal: options.onToggleTerminal,
    onSelectTerminal: options.onSelectTerminal,
    onNewTerminal: options.onNewTerminal,
    onCloseTerminal: options.onCloseTerminal,
    onResizeTerminal: options.onResizeTerminal,
    onInsertComposerText: options.onInsertComposerText,
  });

  const { debugPanelNode, debugPanelFullNode } = buildDebugPanelNodes({
    debugEntries: options.debugEntries,
    debugOpen: options.debugOpen,
    onClearDebug: options.onClearDebug,
    onCopyDebug: options.onCopyDebug,
    onResizeDebug: options.onResizeDebug,
  });

  const compactEmptyCodexNode = buildCompactEmptyNode({
    title: t("workspace.noWorkspaceSelected"),
    description: t("workspace.chooseProjectToChat"),
    buttonLabel: t("workspace.goToProjects"),
    onGoProjects: options.onGoProjects,
  });

  const compactEmptyGitNode = buildCompactEmptyNode({
    title: t("workspace.noWorkspaceSelected"),
    description: t("workspace.selectProjectToInspect"),
    buttonLabel: t("workspace.goToProjects"),
    onGoProjects: options.onGoProjects,
  });

  const compactEmptySpecNode = buildCompactEmptyNode({
    title: t("workspace.noWorkspaceSelected"),
    description: t("workspace.selectProjectToReadSpecs"),
    buttonLabel: t("workspace.goToProjects"),
    onGoProjects: options.onGoProjects,
  });

  const compactGitBackNode = buildCompactGitBackNode({
    backLabel: t("workspace.back"),
    diffLabel: t("workspace.diff"),
    onBackFromDiff: options.onBackFromDiff,
  });
  const browserDockNode =
    options.browserDockOpen &&
    options.centerMode === "chat" &&
    options.activeWorkspaceId ? (
      <Suspense fallback={<HeavyPanelFallback />}>
        <BrowserDock
          workspaceId={options.activeWorkspaceId}
          ownerSurface="main-split-browser-dock"
          displayMode="embedded"
          className="browser-agent-center-panel-dock"
          onClosePanel={options.onCloseBrowserDock}
        />
      </Suspense>
    ) : null;

  return {
    codeAnnotationBridgeProps,
    sidebarNode,
    messagesNode,
    composerNode,
    approvalToastsNode,
    updateToastNode,
    errorToastsNode,
    globalRuntimeNoticeDockNode: appRuntimeNoticeDockNode,
    homeNode,
    mainHeaderNode,
    desktopTopbarLeftNode,
    tabletNavNode,
    tabBarNode,
    rightPanelToolbarNode,
    gitDiffPanelNode,
    gitDiffViewerNode,
    fileViewPanelNode,
    noteCardsPanelNode,
    fileComparePanelNode,
    projectMapPanelNode,
    intentCanvasPanelNode,
    browserDockNode,
    planPanelNode,
    debugPanelNode,
    debugPanelFullNode,
    terminalDockNode,
    compactEmptyCodexNode,
    compactEmptySpecNode,
    compactEmptyGitNode,
    compactGitBackNode,
  };
}
