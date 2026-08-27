import { useCallback, useRef } from "react";
import type { Dispatch } from "react";
import type { ConversationItem, DebugEntry, WorkspaceInfo } from "../../../types";
import {
  isClaudeRuntimeThreadId,
} from "../utils/claudeForkThread";
import { renameLiveAssistantTextThread } from "../utils/liveAssistantTextChannel";
import { renameLiveItemDeltaThread } from "../utils/liveItemDeltaChannel";
import { renameNativeTurnTarget } from "../utils/nativeTurnTargetLedger";
import { renameTurnTargetBadgeThread } from "../utils/turnTargetBadgeStorage";
import { loadClaudeSession as loadClaudeSessionService } from "../../../services/tauri";
import { parseClaudeHistoryMessagesWithShadowRecovery } from "../loaders/claudeHistoryLoader";
import type { ThreadAction } from "./useThreadsReducer";

type ThreadEngine = "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "dsh" | "qoder";

type RunWithCreateSessionLoading = <T>(
  params: {
    workspace: WorkspaceInfo;
    engine: ThreadEngine;
  },
  action: () => Promise<T>,
) => Promise<T>;

type UseThreadMessagingThreadResolutionOptions = {
  activeEngine: ThreadEngine;
  dispatch: Dispatch<ThreadAction>;
  getThreadEngine: (
    workspaceId: string,
    threadId: string,
  ) => ThreadEngine | undefined;
  getThreadKind?: (
    workspaceId: string,
    threadId: string,
  ) => "native" | "shared";
  onDebug?: (entry: DebugEntry) => void;
  runWithCreateSessionLoading?: RunWithCreateSessionLoading;
  startThreadForWorkspace: (
    workspaceId: string,
    options?: {
      activate?: boolean;
      engine?: ThreadEngine;
      folderId?: string | null;
      providerProfileId?: string | null;
    },
  ) => Promise<string | null>;
};

type ClaudePendingNativeSessionState = {
  hasActiveTurn: boolean;
  hasAwaitingMarker: boolean;
  hasLocalItems: boolean;
  isProcessing: boolean;
};

function hasClaudeTranscriptRebindEvidence(items: ConversationItem[]): boolean {
  return items.some((item) => {
    if (item.kind === "message") {
      return item.role === "assistant";
    }
    return item.kind === "tool" || item.kind === "reasoning";
  });
}

function isClaudePendingThreadAwaitingNativeSession(
  threadId: string,
  params: ClaudePendingNativeSessionState,
) {
  return (
    threadId.startsWith("claude-pending-") &&
    (params.hasAwaitingMarker ||
      params.hasLocalItems ||
      params.hasActiveTurn ||
      params.isProcessing)
  );
}

export function useThreadMessagingThreadResolution({
  activeEngine,
  dispatch,
  getThreadEngine,
  getThreadKind,
  onDebug,
  runWithCreateSessionLoading,
  startThreadForWorkspace,
}: UseThreadMessagingThreadResolutionOptions) {
  const claudePendingThreadAwaitingNativeSessionRef = useRef<Set<string>>(
    new Set(),
  );
  const claudeCandidateSessionIdByPendingThreadRef = useRef<
    Map<string, string>
  >(new Map());
  const geminiSessionIdByPendingThreadRef = useRef<Map<string, string>>(
    new Map(),
  );
  const grokSessionIdByPendingThreadRef = useRef<Map<string, string>>(
    new Map(),
  );
  const kimiSessionIdByPendingThreadRef = useRef<Map<string, string>>(
    new Map(),
  );
  const dshSessionIdByPendingThreadRef = useRef<Map<string, string>>(
    new Map(),
  );
  const piSessionIdByPendingThreadRef = useRef<Map<string, string>>(
    new Map(),
  );
  const qoderSessionIdByPendingThreadRef = useRef<Map<string, string>>(
    new Map(),
  );

  const normalizeEngineSelection = useCallback(
    (engine: ThreadEngine | undefined): ThreadEngine =>
      engine === "claude" ||
      engine === "opencode" ||
      engine === "gemini" ||
      engine === "grok" ||
      engine === "kimi" ||
      engine === "pi" ||
      engine === "dsh" ||
      engine === "qoder"
        ? engine
        : "codex",
    [],
  );

  const resolveThreadEngine = useCallback(
    (workspaceId: string, threadId: string): ThreadEngine => {
      const persistedEngine = getThreadEngine(workspaceId, threadId);
      if (persistedEngine) {
        return normalizeEngineSelection(persistedEngine);
      }
      if (isClaudeRuntimeThreadId(threadId)) {
        return "claude";
      }
      if (
        threadId.startsWith("gemini:") ||
        threadId.startsWith("gemini-pending-")
      ) {
        return "gemini";
      }
      if (
        threadId.startsWith("grok:") ||
        threadId.startsWith("grok-pending-")
      ) {
        return "grok";
      }
      if (
        threadId.startsWith("kimi:") ||
        threadId.startsWith("kimi-pending-")
      ) {
        return "kimi";
      }
      if (threadId.startsWith("pi:") || threadId.startsWith("pi-pending-")) {
        return "pi";
      }
      if (threadId.startsWith("qoder:") || threadId.startsWith("qoder-pending-")) {
        return "qoder";
      }
      if (
        threadId.startsWith("opencode:") ||
        threadId.startsWith("opencode-pending-")
      ) {
        return "opencode";
      }
      if (
        threadId.startsWith("dsh:") ||
        threadId.startsWith("dsh-pending-")
      ) {
        return "dsh";
      }
      return normalizeEngineSelection(activeEngine);
    },
    [activeEngine, getThreadEngine, normalizeEngineSelection],
  );

  const resolveThreadKind = useCallback(
    (workspaceId: string, threadId: string): "native" | "shared" =>
      getThreadKind?.(workspaceId, threadId) ?? "native",
    [getThreadKind],
  );

  const isThreadIdCompatibleWithEngine = useCallback(
    (engine: ThreadEngine, threadId: string): boolean => {
      if (engine === "claude") {
        return isClaudeRuntimeThreadId(threadId);
      }
      if (engine === "gemini") {
        return (
          threadId.startsWith("gemini:") ||
          threadId.startsWith("gemini-pending-")
        );
      }
      if (engine === "grok") {
        return (
          threadId.startsWith("grok:") ||
          threadId.startsWith("grok-pending-")
        );
      }
      if (engine === "kimi") {
        return (
          threadId.startsWith("kimi:") ||
          threadId.startsWith("kimi-pending-")
        );
      }
      if (engine === "pi") {
        return threadId.startsWith("pi:") || threadId.startsWith("pi-pending-");
      }
      if (engine === "qoder") {
        return threadId.startsWith("qoder:") || threadId.startsWith("qoder-pending-");
      }
      if (engine === "opencode") {
        return (
          threadId.startsWith("opencode:") ||
          threadId.startsWith("opencode-pending-")
        );
      }
      if (engine === "dsh") {
        return (
          threadId.startsWith("dsh:") ||
          threadId.startsWith("dsh-pending-")
        );
      }
      // Codex: UUID / codex-pending; never accept other CLI prefixes (incl. pi).
      return (
        !threadId.startsWith("claude:") &&
        !threadId.startsWith("claude-pending-") &&
        !threadId.startsWith("gemini:") &&
        !threadId.startsWith("gemini-pending-") &&
        !threadId.startsWith("grok:") &&
        !threadId.startsWith("grok-pending-") &&
        !threadId.startsWith("kimi:") &&
        !threadId.startsWith("kimi-pending-") &&
        !threadId.startsWith("pi:") &&
        !threadId.startsWith("pi-pending-") &&
        !threadId.startsWith("qoder:") &&
        !threadId.startsWith("qoder-pending-") &&
        !threadId.startsWith("opencode:") &&
        !threadId.startsWith("opencode-pending-") &&
        !threadId.startsWith("dsh:") &&
        !threadId.startsWith("dsh-pending-")
      );
    },
    [],
  );

  const startThreadForMessageSend = useCallback(
    async (
      workspace: WorkspaceInfo,
      engine: ThreadEngine,
      options?: { providerProfileId?: string | null },
    ) => {
      const providerProfileId = options?.providerProfileId?.trim() || null;
      const createThread = () =>
        startThreadForWorkspace(workspace.id, {
          activate: true,
          engine,
          ...(providerProfileId ? { providerProfileId } : {}),
        });
      if (!runWithCreateSessionLoading) {
        return createThread();
      }
      return runWithCreateSessionLoading({ workspace, engine }, createThread);
    },
    [runWithCreateSessionLoading, startThreadForWorkspace],
  );

  const reconcileClaudePendingThreadFromCandidate = useCallback(
    async (
      workspace: WorkspaceInfo,
      pendingThreadId: string,
    ): Promise<string | null> => {
      const candidateSessionId =
        claudeCandidateSessionIdByPendingThreadRef.current.get(
          pendingThreadId,
        ) ?? null;
      if (!candidateSessionId) {
        return null;
      }
      const workspacePath =
        typeof workspace.path === "string" ? workspace.path : "";
      if (!workspacePath.trim()) {
        return null;
      }
      const finalizedThreadId = `claude:${candidateSessionId}`;
      try {
        const result = await loadClaudeSessionService(
          workspacePath,
          candidateSessionId,
        );
        const record =
          result && typeof result === "object"
            ? (result as Record<string, unknown>)
            : {};
        const messagesData = record.messages ?? result;
        const parsedItems = parseClaudeHistoryMessagesWithShadowRecovery({
          messagesData,
          workspacePath,
          workspaceId: workspace.id,
          threadId: finalizedThreadId,
          sessionId: candidateSessionId,
        });
        if (!hasClaudeTranscriptRebindEvidence(parsedItems)) {
          onDebug?.({
            id: `${Date.now()}-client-claude-candidate-reconcile-empty`,
            timestamp: Date.now(),
            source: "client",
            label: "thread/session candidate transcript lacks rebind evidence",
            payload: {
              workspaceId: workspace.id,
              threadId: pendingThreadId,
              sessionId: candidateSessionId,
              itemCount: parsedItems.length,
            },
          });
          return null;
        }
        dispatch({
          type: "renameThreadId",
          workspaceId: workspace.id,
          oldThreadId: pendingThreadId,
          newThreadId: finalizedThreadId,
        });
        // A4 live-text 外部化：随迁通道条目（流式早期可能已在累计）。
        renameLiveAssistantTextThread(pendingThreadId, finalizedThreadId);
        renameLiveItemDeltaThread(pendingThreadId, finalizedThreadId);
        // Native turn-target：发送可能在 pending id 下已记账，内存账本与
        // 持久化侧车随改名迁移，否则改名后实时与历史冷加载都读不到 badge。
        renameNativeTurnTarget(workspace.id, pendingThreadId, finalizedThreadId);
        renameTurnTargetBadgeThread(pendingThreadId, finalizedThreadId);
        claudePendingThreadAwaitingNativeSessionRef.current.delete(
          pendingThreadId,
        );
        claudeCandidateSessionIdByPendingThreadRef.current.delete(
          pendingThreadId,
        );
        onDebug?.({
          id: `${Date.now()}-client-claude-candidate-reconcile`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/session reconciled from candidate transcript",
          payload: {
            workspaceId: workspace.id,
            oldThreadId: pendingThreadId,
            newThreadId: finalizedThreadId,
            sessionId: candidateSessionId,
            itemCount: parsedItems.length,
          },
        });
        return finalizedThreadId;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-claude-candidate-reconcile-error`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/session candidate transcript load failed",
          payload: {
            workspaceId: workspace.id,
            threadId: pendingThreadId,
            sessionId: candidateSessionId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        return null;
      }
    },
    [dispatch, onDebug],
  );

  return {
    claudeCandidateSessionIdByPendingThreadRef,
    claudePendingThreadAwaitingNativeSessionRef,
    geminiSessionIdByPendingThreadRef,
    grokSessionIdByPendingThreadRef,
    kimiSessionIdByPendingThreadRef,
    dshSessionIdByPendingThreadRef,
    piSessionIdByPendingThreadRef,
    qoderSessionIdByPendingThreadRef,
    isClaudePendingThreadAwaitingNativeSession,
    isThreadIdCompatibleWithEngine,
    normalizeEngineSelection,
    reconcileClaudePendingThreadFromCandidate,
    resolveThreadEngine,
    resolveThreadKind,
    startThreadForMessageSend,
  };
}
