import { useCallback, useMemo, useRef } from "react";
import type { Dispatch, MutableRefObject } from "react";

import type { DebugEntry, ThreadSummary } from "../../../types";
import type { AutoSessionMetadata } from "../../../services/tauri";
import {
  CODEX_DISK_PROVIDER_PROFILE_ID,
  type EngineProviderProfileOption,
} from "../constants/codexProviderProfiles";
import {
  registerCodexPrewarm,
  releaseCodexPrewarm,
  settleCodexPrewarm,
} from "../utils/codexPendingPrewarm";
import {
  connectWorkspace as connectWorkspaceService,
  deleteClaudeSession as deleteClaudeSessionService,
  deleteCodexSession as deleteCodexSessionService,
  forkClaudeSessionFromMessage as forkClaudeSessionFromMessageService,
  forkDshSession as forkDshSessionService,
  forkThread as forkThreadService,
  loadClaudeSession as loadClaudeSessionService,
  rewindCodexThread as rewindCodexThreadService,
  setThreadTitle as setThreadTitleService,
  startThread as startThreadService,
  writeClientCreatedSessionIndex,
} from "../../../services/tauri";
import { deleteSessionViaV2IfEnabled } from "../utils/sessionDeleteV2";
import { parseClaudeHistoryMessagesWithShadowRecovery } from "../loaders/claudeHistoryLoader";
import {
  applyClaudeRewindWorkspaceRestore,
  findImpactedClaudeRewindItems,
  restoreClaudeRewindWorkspaceSnapshots,
} from "../utils/claudeRewindRestore";
import {
  isClaudeForkThreadId,
  isClaudeRuntimeThreadId,
} from "../utils/claudeForkThread";
import {
  findFirstHistoryUserMessageId,
  findLastUserMessageIndexById,
  findLatestHistoryUserMessageId,
  isUserConversationMessage,
  isWorkspaceNotConnectedError,
  normalizeComparableRewindText,
  resolveClaudeRewindMessageIdFromHistory,
  resolveRewindSupportedEngine,
} from "./useThreadActions.helpers";
import {
  createStartSharedSessionForWorkspace,
} from "./useThreadActions.sessionActions";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";
import {
  normalizeRewindMode,
  shouldRestoreWorkspaceFiles,
  shouldRewindMessages,
  type RewindMode,
} from "../utils/rewindMode";
import {
  buildClaudeForkThreadId,
  createSessionLifecycleThreadStarter,
  extractHookSafeFallbackMetadata,
  extractProviderBindingFromStartedThread,
  extractThreadId,
  isManagedEngineProviderProfileId,
  localProviderBindingForEngine,
  providerBindingFromSelectedProfile,
  pushHookSafeFallbackNotice,
  resolveClaudeForkThreadName,
} from "./sessionLifecycleController";
import { assertEngineExecutionEnabled } from "../../../utils/engineExecutionPolicy";

type OnDebug = (entry: DebugEntry) => void;

type ProviderSelectionOptions = {
  providerProfileId?: string | null;
  providerProfile?: EngineProviderProfileOption | null;
};

function resolveChildProviderBinding(
  parentThread: ThreadSummary | undefined,
  options?: ProviderSelectionOptions,
) {
  const hasExplicitSelection =
    Boolean(options?.providerProfile) ||
    Boolean(options?.providerProfileId?.trim());
  if (hasExplicitSelection) {
    return providerBindingFromSelectedProfile(
      options?.providerProfile,
      options?.providerProfileId,
    );
  }
  return {
    ...(parentThread?.providerProfileId
      ? { providerProfileId: parentThread.providerProfileId }
      : {}),
    ...(parentThread?.providerProfileSource
      ? { providerProfileSource: parentThread.providerProfileSource }
      : {}),
    ...(parentThread?.providerProfileName
      ? { providerProfileName: parentThread.providerProfileName }
      : {}),
    ...(parentThread?.providerAvailability
      ? { providerAvailability: parentThread.providerAvailability }
      : {}),
  };
}

type ResumeThreadForWorkspace = (
  workspaceId: string,
  threadId: string,
  force?: boolean,
  replaceLocal?: boolean,
  options?: { preferLocalCodexHistory?: boolean },
) => Promise<string | null>;

type RewindFromMessageOptions = ProviderSelectionOptions & {
  activate?: boolean;
  mode?: RewindMode;
  operation?: "fork" | "rewind";
};

type UseThreadActionsSessionRuntimeOptions = {
  activeThreadIdByWorkspace: ThreadState["activeThreadIdByWorkspace"];
  dispatch: Dispatch<ThreadAction>;
  itemsByThread: ThreadState["itemsByThread"];
  loadedThreadsRef: MutableRefObject<Record<string, boolean>>;
  onCodexPendingThreadFinalized?: (
    workspaceId: string,
    pendingThreadId: string,
    realThreadId: string,
  ) => void;
  onDebug?: OnDebug;
  renameThreadTitleMapping: (
    workspaceId: string,
    oldThreadId: string,
    newThreadId: string,
  ) => Promise<void>;
  resumeThreadForWorkspace: ResumeThreadForWorkspace;
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  workspacePathsByIdRef: MutableRefObject<Record<string, string>>;
};

type CodexPendingStartEntry = {
  promise: Promise<Record<string, unknown> | null>;
  folderId: string | null;
  finalizedThreadId?: string;
};

export function useThreadActionsSessionRuntime({
  activeThreadIdByWorkspace,
  dispatch,
  itemsByThread,
  loadedThreadsRef,
  onCodexPendingThreadFinalized,
  onDebug,
  renameThreadTitleMapping,
  resumeThreadForWorkspace,
  threadsByWorkspace,
  workspacePathsByIdRef,
}: UseThreadActionsSessionRuntimeOptions) {
  const claudeRewindInFlightByThreadRef = useRef<Record<string, boolean>>({});
  const codexStartInFlightByKeyRef = useRef<
    Record<string, Promise<string | null> | undefined>
  >({});
  const codexPendingStartByThreadIdRef = useRef<
    Record<string, CodexPendingStartEntry | undefined>
  >({});

  const reconnectWorkspaceBeforeThreadStart = useCallback(
    async (workspaceId: string) => {
      onDebug?.({
        id: `${Date.now()}-client-workspace-reconnect-before-thread-start`,
        timestamp: Date.now(),
        source: "client",
        label: "workspace/reconnect before thread start",
        payload: { workspaceId },
      });
      await connectWorkspaceService(workspaceId);
    },
    [onDebug],
  );

  const requestCodexThreadStart = useCallback(
    async (workspaceId: string): Promise<Record<string, unknown> | null> => {
      try {
        return (await startThreadService(workspaceId)) ?? null;
      } catch (error) {
        if (!isWorkspaceNotConnectedError(error)) {
          throw error;
        }
        await reconnectWorkspaceBeforeThreadStart(workspaceId);
        return (await startThreadService(workspaceId)) ?? null;
      }
    },
    [reconnectWorkspaceBeforeThreadStart],
  );

  const beginCodexPendingThreadStart = useCallback(
    (workspaceId: string, pendingThreadId: string, folderId: string | null) => {
      // Registered before the request goes out: app-server pushes its
      // `thread/started` notification for this thread and it can land before
      // the thread/start response does, i.e. before we know the real id.
      registerCodexPrewarm(workspaceId, pendingThreadId);
      const entry: CodexPendingStartEntry = {
        promise: requestCodexThreadStart(workspaceId)
          .catch((error) => {
            onDebug?.({
              id: `${Date.now()}-client-thread-start-prewarm-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/start prewarm error",
              payload: error instanceof Error ? error.message : String(error),
            });
            return null;
          })
          .then((response) => {
            settleCodexPrewarm(
              pendingThreadId,
              extractThreadId(response ?? undefined) || null,
            );
            return response;
          }),
        folderId,
      };
      codexPendingStartByThreadIdRef.current[pendingThreadId] = entry;
      return entry;
    },
    [onDebug, requestCodexThreadStart],
  );

  /**
   * Swap an optimistic `codex-pending-*` thread for its real backend thread.
   * Called from the send path right before the first message goes out, which
   * mirrors the timing of the Claude pending rebind (never mid-typing).
   * Idempotent: concurrent callers await the same start promise and the
   * duplicate renameThreadId no-ops in the reducer.
   */
  const finalizeCodexPendingThread = useCallback(
    async (
      workspaceId: string,
      pendingThreadId: string,
    ): Promise<string | null> => {
      if (!pendingThreadId.startsWith("codex-pending-")) {
        return pendingThreadId;
      }
      const existingEntry = codexPendingStartByThreadIdRef.current[pendingThreadId];
      if (existingEntry?.finalizedThreadId) {
        // Already finalized earlier (e.g. a caller kept the pending id
        // around, like kanban task records): replay the resolved id.
        return existingEntry.finalizedThreadId;
      }
      // The delete flow flips this flag to false. Checked before every step
      // that could mint a backend thread (initial start, failure retry) and
      // before the dispatches below, so a finalize racing a delete neither
      // creates an orphan backend thread nor resurrects the deleted thread.
      const bailIfPendingThreadDeleted = () => {
        if (loadedThreadsRef.current[pendingThreadId] === true) {
          return false;
        }
        delete codexPendingStartByThreadIdRef.current[pendingThreadId];
        onDebug?.({
          id: `${Date.now()}-client-thread-start-finalize-stale`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/start finalize skipped for deleted pending thread",
          payload: { workspaceId, pendingThreadId },
        });
        return true;
      };
      if (bailIfPendingThreadDeleted()) {
        return null;
      }
      let entry =
        existingEntry ??
        beginCodexPendingThreadStart(workspaceId, pendingThreadId, null);
      let response = await entry.promise;
      if (!extractThreadId(response ?? undefined)) {
        if (bailIfPendingThreadDeleted()) {
          return null;
        }
        // Prewarm failed (offline, runtime restart...): retry once. The
        // synchronous check-and-replace keeps concurrent finalize calls on
        // one shared retry promise instead of minting duplicate threads.
        if (codexPendingStartByThreadIdRef.current[pendingThreadId] === entry) {
          entry = beginCodexPendingThreadStart(
            workspaceId,
            pendingThreadId,
            entry.folderId,
          );
        } else {
          entry = codexPendingStartByThreadIdRef.current[pendingThreadId] ?? entry;
        }
        response = await entry.promise;
      }
      const currentEntry = codexPendingStartByThreadIdRef.current[pendingThreadId];
      if (currentEntry?.finalizedThreadId) {
        // A concurrent finalize won the race while we awaited the start.
        return currentEntry.finalizedThreadId;
      }
      if (bailIfPendingThreadDeleted()) {
        return null;
      }
      const realThreadId = extractThreadId(response ?? undefined);
      if (!response || !realThreadId) {
        delete codexPendingStartByThreadIdRef.current[pendingThreadId];
        onDebug?.({
          id: `${Date.now()}-client-thread-start-finalize-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/start finalize failed",
          payload: { workspaceId, pendingThreadId },
        });
        return null;
      }
      entry.finalizedThreadId = realThreadId;
      const fallbackMetadata = extractHookSafeFallbackMetadata(response);
      if (fallbackMetadata) {
        pushHookSafeFallbackNotice(workspaceId, fallbackMetadata);
      }
      dispatch({
        type: "renameThreadId",
        workspaceId,
        oldThreadId: pendingThreadId,
        newThreadId: realThreadId,
      });
      const remappedBinding = extractProviderBindingFromStartedThread(
        response,
        providerBindingFromSelectedProfile(undefined, null),
      );
      dispatch({
        type: "ensureThread",
        workspaceId,
        threadId: realThreadId,
        engine: "codex",
        ...(entry.folderId ? { folderId: entry.folderId } : {}),
        ...remappedBinding,
      });
      writeClientCreatedSessionIndex({
        engine: "codex",
        sessionId: realThreadId,
        workspacePath: workspacePathsByIdRef.current[workspaceId] ?? "",
        providerProfileId: remappedBinding.providerProfileId,
        providerProfileName: remappedBinding.providerProfileName,
      });
      // The real thread now owns a sidebar entry, so a late `thread/started`
      // for it is a harmless no-op ensureThread. Stop suppressing it.
      releaseCodexPrewarm(pendingThreadId);
      onCodexPendingThreadFinalized?.(workspaceId, pendingThreadId, realThreadId);
      loadedThreadsRef.current[realThreadId] = true;
      delete loadedThreadsRef.current[pendingThreadId];
      await renameThreadTitleMapping(workspaceId, pendingThreadId, realThreadId);
      onDebug?.({
        id: `${Date.now()}-client-thread-start-finalized`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/start pending finalized",
        payload: { workspaceId, pendingThreadId, threadId: realThreadId },
      });
      return realThreadId;
    },
    [
      beginCodexPendingThreadStart,
      dispatch,
      loadedThreadsRef,
      onCodexPendingThreadFinalized,
      onDebug,
      renameThreadTitleMapping,
    ],
  );

  const startThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      options?: {
        activate?: boolean;
        engine?: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
        folderId?: string | null;
        autoSession?: AutoSessionMetadata | null;
        providerProfileId?: string | null;
        providerProfile?: EngineProviderProfileOption | null;
      },
    ) => {
      const shouldActivate = options?.activate !== false;
      const engine = options?.engine;
      if (engine) {
        assertEngineExecutionEnabled(engine);
      }
      const folderId = options?.folderId?.trim() || null;
      const autoSession = options?.autoSession ?? null;
      const selectedProviderBinding = {
        ...localProviderBindingForEngine(engine),
        ...providerBindingFromSelectedProfile(
          options?.providerProfile,
          options?.providerProfileId,
        ),
      };
      const providerProfileId =
        selectedProviderBinding.providerProfileId?.trim() || null;
      const managedProviderProfileId = isManagedEngineProviderProfileId(
        providerProfileId,
      )
        ? providerProfileId
        : null;
      const autoSessionPayload = autoSession ? { autoSession } : {};
      const providerProfilePayload = managedProviderProfileId
        ? { providerProfileId: managedProviderProfileId }
        : {};
      const startThreadOptions =
        autoSession || managedProviderProfileId
          ? { ...autoSessionPayload, ...providerProfilePayload }
          : undefined;
      const startThreadWithOptionalMetadata = () =>
        startThreadOptions
          ? startThreadService(workspaceId, startThreadOptions)
          : startThreadService(workspaceId);
      const autoSessionKey = options?.autoSession
        ? `${options.autoSession.sessionPurpose}:${options.autoSession.visibility}`
        : "user-visible";
      const providerProfileKey = providerProfileId ?? "__disk__";
      const codexStartInFlightKey = `${workspaceId}:codex:${providerProfileKey}:${folderId ?? "__root__"}:${autoSessionKey}`;
      const resolveStartedThread = createSessionLifecycleThreadStarter({
        dispatch,
        loadedThreadsRef,
        workspaceId,
        folderId,
        shouldActivate,
        autoSessionPayload,
        selectedProviderBinding,
      });

      if (
        engine === "claude" ||
        engine === "grok" ||
        engine === "kimi" ||
        engine === "opencode" ||
        engine === "pi" ||
        engine === "omp" ||
        engine === "qoder" ||
        engine === "dsh"
      ) {
        const prefix = engine;
        const threadId = `${prefix}-pending-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        onDebug?.({
          id: `${Date.now()}-client-thread-start`,
          timestamp: Date.now(),
          source: "client",
          label: `thread/start (${engine})`,
          payload: { workspaceId, threadId, engine },
        });
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId,
          engine,
          ...(folderId ? { folderId } : {}),
          ...autoSessionPayload,
          ...selectedProviderBinding,
        });
        writeClientCreatedSessionIndex({
          engine,
          sessionId: threadId,
          workspacePath: workspacePathsByIdRef.current[workspaceId] ?? "",
          providerProfileId: selectedProviderBinding.providerProfileId,
          providerProfileName: selectedProviderBinding.providerProfileName,
        });
        if (shouldActivate) {
          dispatch({ type: "setActiveThreadId", workspaceId, threadId });
        }
        loadedThreadsRef.current[threadId] = true;
        return threadId;
      }

      // Optimistic codex create: only for plain user-visible disk-profile
      // sessions. Auto sessions and managed-provider sessions keep the
      // synchronous path because their metadata must be recorded against the
      // real thread id at creation time. The explicit __disk__ selection (the
      // sidebar new-session menu always sends it) is equivalent to passing no
      // profile: the backend normalizes both to the disk profile.
      const isDiskProviderSelection =
        !providerProfileId || providerProfileId === CODEX_DISK_PROVIDER_PROFILE_ID;
      if (!autoSession && isDiskProviderSelection) {
        const threadId = `codex-pending-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        onDebug?.({
          id: `${Date.now()}-client-thread-start`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/start (codex optimistic)",
          payload: { workspaceId, threadId },
        });
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId,
          engine: "codex",
          ...(folderId ? { folderId } : {}),
          ...selectedProviderBinding,
        });
        writeClientCreatedSessionIndex({
          engine: "codex",
          sessionId: threadId,
          workspacePath: workspacePathsByIdRef.current[workspaceId] ?? "",
          providerProfileId: selectedProviderBinding.providerProfileId,
          providerProfileName: selectedProviderBinding.providerProfileName,
        });
        // Mirrors createSessionLifecycleThreadStarter so the pending thread
        // survives background thread-list refreshes like a real codex thread.
        // The source must stay "thread-start": downstream liveness checks
        // compare against it literally (codexConversationLiveness.ts).
        dispatch({
          type: "markCodexAcceptedTurn",
          threadId,
          fact: "empty-draft",
          source: "thread-start",
          timestamp: Date.now(),
        });
        if (shouldActivate) {
          dispatch({ type: "setActiveThreadId", workspaceId, threadId });
        }
        loadedThreadsRef.current[threadId] = true;
        beginCodexPendingThreadStart(workspaceId, threadId, folderId);
        return threadId;
      }

      const runCodexStart = async () => {
        onDebug?.({
          id: `${Date.now()}-client-thread-start`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/start",
          payload: { workspaceId, providerProfileId: providerProfileId ?? "__disk__" },
        });
        try {
          const response = await startThreadWithOptionalMetadata();
          onDebug?.({
            id: `${Date.now()}-server-thread-start`,
            timestamp: Date.now(),
            source: "server",
            label: "thread/start response",
            payload: response,
          });
          const startedId = resolveStartedThread(response);
          if (startedId) {
            writeClientCreatedSessionIndex({
              engine: "codex",
              sessionId: startedId,
              workspacePath: workspacePathsByIdRef.current[workspaceId] ?? "",
              providerProfileId: selectedProviderBinding.providerProfileId,
              providerProfileName: selectedProviderBinding.providerProfileName,
            });
          }
          return startedId;
        } catch (error) {
          if (isWorkspaceNotConnectedError(error)) {
            try {
              await reconnectWorkspaceBeforeThreadStart(workspaceId);
              const retryResponse = await startThreadWithOptionalMetadata();
              onDebug?.({
                id: `${Date.now()}-server-thread-start-retry`,
                timestamp: Date.now(),
                source: "server",
                label: "thread/start retry response",
                payload: retryResponse,
              });
              const retryStartedId = resolveStartedThread(retryResponse);
              if (retryStartedId) {
                writeClientCreatedSessionIndex({
                  engine: "codex",
                  sessionId: retryStartedId,
                  workspacePath: workspacePathsByIdRef.current[workspaceId] ?? "",
                  providerProfileId: selectedProviderBinding.providerProfileId,
                  providerProfileName: selectedProviderBinding.providerProfileName,
                });
              }
              return retryStartedId;
            } catch (retryError) {
              onDebug?.({
                id: `${Date.now()}-client-thread-start-error`,
                timestamp: Date.now(),
                source: "error",
                label: "thread/start error",
                payload: retryError instanceof Error ? retryError.message : String(retryError),
              });
              throw retryError;
            }
          }
          onDebug?.({
            id: `${Date.now()}-client-thread-start-error`,
            timestamp: Date.now(),
            source: "error",
            label: "thread/start error",
            payload: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      };

      const existingStart = codexStartInFlightByKeyRef.current[codexStartInFlightKey];
      if (existingStart) {
        onDebug?.({
          id: `${Date.now()}-client-thread-start-reuse`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/start reuse",
          payload: { workspaceId, folderId, providerProfileId: providerProfileId ?? "__disk__" },
        });
        const threadId = await existingStart;
        if (threadId && shouldActivate) {
          dispatch({ type: "setActiveThreadId", workspaceId, threadId });
        }
        return threadId;
      }

      const startPromise = runCodexStart();
      codexStartInFlightByKeyRef.current[codexStartInFlightKey] = startPromise;
      try {
        return await startPromise;
      } finally {
        if (codexStartInFlightByKeyRef.current[codexStartInFlightKey] === startPromise) {
          delete codexStartInFlightByKeyRef.current[codexStartInFlightKey];
        }
      }
    },
    [
      beginCodexPendingThreadStart,
      dispatch,
      loadedThreadsRef,
      onDebug,
      reconnectWorkspaceBeforeThreadStart,
    ],
  );

  const startSharedSessionForWorkspace = useMemo(
    () => createStartSharedSessionForWorkspace({
      dispatch,
      extractThreadId,
      loadedThreadsRef,
      onDebug,
      threadsByWorkspace,
    }),
    [dispatch, loadedThreadsRef, onDebug, threadsByWorkspace],
  );

  const forkThreadForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      options?: {
        activate?: boolean;
        providerProfileId?: string | null;
        providerProfile?: EngineProviderProfileOption | null;
      },
    ) => {
      if (!threadId) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      const selectedProviderBinding = resolveChildProviderBinding(
        threadsByWorkspace[workspaceId]?.find((thread) => thread.id === threadId),
        options,
      );
      const providerProfileId =
        selectedProviderBinding.providerProfileId?.trim() || null;
      onDebug?.({
        id: `${Date.now()}-client-thread-fork`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/fork",
        payload: { workspaceId, threadId, providerProfileId },
      });
      try {
        let response: Record<string, unknown> | null | undefined;
        if (threadId.startsWith("claude:")) {
          const sessionId = threadId.slice("claude:".length).trim();
          if (!sessionId) {
            return null;
          }
          response = {
            thread: {
              id: buildClaudeForkThreadId(sessionId),
            },
            parentSessionId: sessionId,
          };
        } else if (threadId.startsWith("claude-pending-")) {
          return null;
        } else if (threadId.startsWith("codex-pending-")) {
          return null;
        } else if (
          threadId.startsWith("gemini:") ||
          threadId.startsWith("gemini-pending-")
        ) {
          return null;
        } else if (
          threadId.startsWith("kimi:") ||
          threadId.startsWith("kimi-pending-")
        ) {
          return null;
        } else if (threadId.startsWith("dsh-pending-")) {
          return null;
        } else if (threadId.startsWith("dsh:")) {
          const sessionId = threadId.slice("dsh:".length).trim();
          const workspacePath = workspacePathsByIdRef.current[workspaceId];
          if (!sessionId || !workspacePath) {
            return null;
          }
          response = await forkDshSessionService(workspacePath, sessionId);
        } else {
          response = await forkThreadService(workspaceId, threadId, null, {
            providerProfileId,
          });
        }
        onDebug?.({
          id: `${Date.now()}-server-thread-fork`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/fork response",
          payload: response,
        });
        const forkedThreadId = extractThreadId(response);
        if (!forkedThreadId) {
          return null;
        }
        const forkedEngine = isClaudeRuntimeThreadId(forkedThreadId)
          ? "claude"
          : forkedThreadId.startsWith("gemini:")
            ? "gemini"
            : forkedThreadId.startsWith("kimi:")
              ? "kimi"
              : forkedThreadId.startsWith("dsh:")
                ? "dsh"
                : "codex";
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: forkedThreadId,
          engine: forkedEngine,
          ...extractProviderBindingFromStartedThread(response, selectedProviderBinding),
        });
        writeClientCreatedSessionIndex({
          engine: forkedEngine,
          sessionId: forkedThreadId,
          workspacePath: workspacePathsByIdRef.current[workspaceId] ?? "",
          providerProfileId: selectedProviderBinding.providerProfileId,
          providerProfileName: selectedProviderBinding.providerProfileName,
        });
        if (shouldActivate) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        if (isClaudeForkThreadId(forkedThreadId)) {
          const forkThreadName = resolveClaudeForkThreadName({
            workspaceId,
            parentThreadId: threadId,
            threadsByWorkspace,
            itemsByThread,
          });
          dispatch({
            type: "setThreadName",
            workspaceId,
            threadId: forkedThreadId,
            name: forkThreadName,
          });
          await setThreadTitleService(workspaceId, forkedThreadId, forkThreadName).catch(() => {
            // Best-effort only. The in-memory sidebar title is already set.
          });
          dispatch({
            type: "setThreadItems",
            threadId: forkedThreadId,
            items: itemsByThread[threadId] ?? [],
          });
          loadedThreadsRef.current[forkedThreadId] = true;
          return forkedThreadId;
        }
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        return forkedThreadId;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/fork error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    [
      dispatch,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      resumeThreadForWorkspace,
      threadsByWorkspace,
      workspacePathsByIdRef,
    ],
  );

  const forkClaudeSessionFromMessageForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      messageId: string,
      options?: RewindFromMessageOptions,
    ) => {
      if (!threadId.startsWith("claude:")) {
        return null;
      }
      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) {
        return null;
      }
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (!workspacePath) {
        return null;
      }
      const sessionId = threadId.slice("claude:".length).trim();
      if (!sessionId) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      const inheritedProviderBinding = resolveChildProviderBinding(
        threadsByWorkspace[workspaceId]?.find((thread) => thread.id === threadId),
        options,
      );
      const operation = options?.operation ?? "rewind";
      const rewindMode = normalizeRewindMode(options?.mode);
      const shouldRestoreFiles = shouldRestoreWorkspaceFiles(rewindMode);
      const shouldRewindSession = shouldRewindMessages(rewindMode);
      const rewindLockKey = `${workspaceId}:${threadId}`;
      if (claudeRewindInFlightByThreadRef.current[rewindLockKey]) {
        return null;
      }
      claudeRewindInFlightByThreadRef.current[rewindLockKey] = true;
      onDebug?.({
        id: `${Date.now()}-client-thread-fork-from-message`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/fork from message",
        payload: { workspaceId, threadId, messageId: normalizedMessageId },
      });
      let rewindRestoreState:
        | Awaited<ReturnType<typeof applyClaudeRewindWorkspaceRestore>>
        | null = null;
      try {
        const threadItems = itemsByThread[threadId] ?? [];
        const historyResponse = await loadClaudeSessionService(
          workspacePath,
          sessionId,
        );
        const historyRecord =
          historyResponse && typeof historyResponse === "object"
            ? (historyResponse as Record<string, unknown>)
            : {};
        const historyItems = parseClaudeHistoryMessagesWithShadowRecovery({
          messagesData: historyRecord.messages,
          workspacePath,
          workspaceId,
          threadId,
        });
        const firstHistoryMessageId = findFirstHistoryUserMessageId(historyItems);
        const latestHistoryMessageId = findLatestHistoryUserMessageId(historyItems);
        if (!latestHistoryMessageId) {
          return null;
        }
        const requestedHistoryMessageId = resolveClaudeRewindMessageIdFromHistory({
          requestedMessageId: normalizedMessageId,
          threadItems,
          historyItems,
        });
        const resolvedMessageId = requestedHistoryMessageId.trim();
        if (!resolvedMessageId) {
          return null;
        }
        const impactedItems = findImpactedClaudeRewindItems(
          threadItems,
          normalizedMessageId,
        );
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-from-message-resolved`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/fork from message resolved",
          payload: {
            workspaceId,
            threadId,
            requestedMessageId: normalizedMessageId,
            resolvedMessageId,
            firstHistoryMessageId,
            latestHistoryMessageId,
          },
        });
        if (shouldRestoreFiles) {
          rewindRestoreState = await applyClaudeRewindWorkspaceRestore({
            workspaceId,
            workspacePath,
            impactedItems,
          });
          if ((rewindRestoreState?.ignoredCommittedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-fork-from-message-restore-committed-ignored`,
              timestamp: Date.now(),
              source: "client",
              label: "thread/fork from message restore committed ignored",
              payload: {
                workspaceId,
                threadId,
                ignoredCommittedPaths:
                  rewindRestoreState?.ignoredCommittedPaths ?? [],
              },
            });
          }
          if ((rewindRestoreState?.skippedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-fork-from-message-restore-skipped`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/fork from message restore skipped",
              payload: {
                workspaceId,
                threadId,
                skippedPaths: rewindRestoreState?.skippedPaths ?? [],
              },
            });
          }
        }
        if (!shouldRewindSession) {
          return threadId;
        }
        if (
          operation === "rewind" &&
          firstHistoryMessageId &&
          resolvedMessageId === firstHistoryMessageId
        ) {
          // rewind 归零 = 删除会话：v2 开启时走 marker-first（tombstone +
          // 元数据清理 + 残留重试），失败保持 throw 语义
          const v2Result = await deleteSessionViaV2IfEnabled(
            workspaceId,
            threadId,
            { engine: "claude" },
          );
          if (v2Result) {
            if (!v2Result.ok) {
              throw new Error(v2Result.message ?? "Failed to delete session");
            }
          } else {
            await deleteClaudeSessionService(workspacePath, sessionId);
          }
          delete loadedThreadsRef.current[threadId];
          dispatch({
            type: "removeThread",
            workspaceId,
            threadId,
          });
          return threadId;
        }
        const response = await forkClaudeSessionFromMessageService(
          workspacePath,
          sessionId,
          resolvedMessageId,
        );
        onDebug?.({
          id: `${Date.now()}-server-thread-fork-from-message`,
          timestamp: Date.now(),
          source: "server",
          label: "thread/fork from message response",
          payload: response,
        });
        const forkedThreadId = extractThreadId(response);
        if (!forkedThreadId) {
          if (shouldRestoreFiles && rewindRestoreState?.originalSnapshots?.length) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
          return null;
        }
        if (operation === "fork") {
          dispatch({
            type: "ensureThread",
            workspaceId,
            threadId: forkedThreadId,
            engine: "claude",
            ...inheritedProviderBinding,
          });
          writeClientCreatedSessionIndex({
            engine: "claude",
            sessionId: forkedThreadId,
            workspacePath: workspacePath,
            providerProfileId: inheritedProviderBinding.providerProfileId,
            providerProfileName: inheritedProviderBinding.providerProfileName,
          });
          const forkThreadName = resolveClaudeForkThreadName({
            workspaceId,
            parentThreadId: threadId,
            threadsByWorkspace,
            itemsByThread,
          });
          dispatch({
            type: "setThreadName",
            workspaceId,
            threadId: forkedThreadId,
            name: forkThreadName,
          });
          await setThreadTitleService(
            workspaceId,
            forkedThreadId,
            forkThreadName,
          ).catch(() => {
            // Best-effort only. The in-memory sidebar title is already set.
          });
          if (shouldActivate) {
            dispatch({
              type: "setActiveThreadId",
              workspaceId,
              threadId: forkedThreadId,
            });
          }
          loadedThreadsRef.current[forkedThreadId] = false;
          await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
          return forkedThreadId;
        }
        dispatch({
          type: "renameThreadId",
          workspaceId,
          oldThreadId: threadId,
          newThreadId: forkedThreadId,
        });
        dispatch({
          type: "hideThread",
          workspaceId,
          threadId,
        });
        await renameThreadTitleMapping(workspaceId, threadId, forkedThreadId);
        if (shouldActivate && !activeThreadIdByWorkspace[workspaceId]) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        delete loadedThreadsRef.current[threadId];
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        // fork 删源会话：v2 开启时走 marker-first——物理删除失败 =
        // MARKED_DELETED（源已隐藏，残留后台重试），根治「源会话复活」；
        // 失败仍按原语义 log 后继续返回 forkedThreadId
        const v2DeleteSource = await deleteSessionViaV2IfEnabled(
          workspaceId,
          threadId,
          { engine: "claude" },
        );
        if (v2DeleteSource) {
          if (!v2DeleteSource.ok) {
            onDebug?.({
              id: `${Date.now()}-client-thread-fork-from-message-delete-source-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/fork from message delete source error",
              payload: v2DeleteSource.message ?? "Failed to delete session",
            });
          }
        } else {
          try {
            await deleteClaudeSessionService(workspacePath, sessionId);
          } catch (error) {
            onDebug?.({
              id: `${Date.now()}-client-thread-fork-from-message-delete-source-error`,
              timestamp: Date.now(),
              source: "error",
              label: "thread/fork from message delete source error",
              payload: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return forkedThreadId;
      } catch (error) {
        try {
          if (shouldRestoreFiles && rewindRestoreState?.originalSnapshots?.length) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
        } catch {
          // Best effort rollback is handled in the main rewind path below.
        }
        onDebug?.({
          id: `${Date.now()}-client-thread-fork-from-message-error`,
          timestamp: Date.now(),
          source: "error",
          label: "thread/fork from message error",
          payload: error instanceof Error ? error.message : String(error),
        });
        return null;
      } finally {
        delete claudeRewindInFlightByThreadRef.current[rewindLockKey];
      }
    },
    [
      activeThreadIdByWorkspace,
      dispatch,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      renameThreadTitleMapping,
      resumeThreadForWorkspace,
      threadsByWorkspace,
      workspacePathsByIdRef,
    ],
  );

  const forkSessionFromMessageForWorkspace = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      messageId: string,
      options?: RewindFromMessageOptions,
    ) => {
      const canonicalThreadId = threadId.trim();
      const rewindEngine = resolveRewindSupportedEngine(canonicalThreadId);
      if (!rewindEngine) {
        return null;
      }
      if (rewindEngine === "claude") {
        const claudeThreadId = canonicalThreadId.replace(/^claude:/i, "claude:");
        return forkClaudeSessionFromMessageForWorkspace(
          workspaceId,
          claudeThreadId,
          messageId,
          options,
        );
      }

      const normalizedMessageId = messageId.trim();
      if (!normalizedMessageId) {
        return null;
      }
      const workspacePath = workspacePathsByIdRef.current[workspaceId];
      if (!workspacePath) {
        return null;
      }
      const shouldActivate = options?.activate !== false;
      const selectedProviderBinding = providerBindingFromSelectedProfile(
        options?.providerProfile,
        options?.providerProfileId,
      );
      const providerProfileId =
        selectedProviderBinding.providerProfileId?.trim() || null;
      const rewindMode = normalizeRewindMode(options?.mode);
      const shouldRestoreFiles = shouldRestoreWorkspaceFiles(rewindMode);
      const shouldRewindSession = shouldRewindMessages(rewindMode);
      const sourceProviderProfileId =
        threadsByWorkspace[workspaceId]
          ?.find((thread) => thread.id === canonicalThreadId)
          ?.providerProfileId?.trim() || CODEX_DISK_PROVIDER_PROFILE_ID;
      if (
        shouldRewindSession &&
        providerProfileId &&
        providerProfileId !== sourceProviderProfileId
      ) {
        throw new Error(
          "Cross-provider Codex fork was replaced by “使用其他 Provider 继续”.",
        );
      }
      const rewindLockKey = `${workspaceId}:${canonicalThreadId}`;
      if (claudeRewindInFlightByThreadRef.current[rewindLockKey]) {
        return null;
      }
      claudeRewindInFlightByThreadRef.current[rewindLockKey] = true;
      onDebug?.({
        id: `${Date.now()}-client-thread-codex-fork-from-message`,
        timestamp: Date.now(),
        source: "client",
        label: "codex/thread/fork from message",
        payload: {
          workspaceId,
          threadId: canonicalThreadId,
          messageId: normalizedMessageId,
          providerProfileId,
        },
      });
      let rewindRestoreState:
        | Awaited<ReturnType<typeof applyClaudeRewindWorkspaceRestore>>
        | null = null;
      try {
        const threadItems = itemsByThread[canonicalThreadId] ?? [];
        const userThreadItems = threadItems.filter(isUserConversationMessage);
        const targetUserTurnIndex = findLastUserMessageIndexById(
          userThreadItems,
          normalizedMessageId,
        );
        if (targetUserTurnIndex < 0) {
          onDebug?.({
            id: `${Date.now()}-client-thread-codex-fork-from-message-target-missing`,
            timestamp: Date.now(),
            source: "client",
            label: "codex/thread/fork from message target missing",
            payload: {
              workspaceId,
              threadId: canonicalThreadId,
              messageId: normalizedMessageId,
              reason: "localTargetMissing",
            },
          });
          return null;
        }
        const targetUserMessageText = normalizeComparableRewindText(
          userThreadItems[targetUserTurnIndex]?.text ?? "",
        );
        const targetUserMessageOccurrence = targetUserMessageText
          ? userThreadItems.reduce((count, item, index) => {
              if (index > targetUserTurnIndex) {
                return count;
              }
              return normalizeComparableRewindText(item.text) === targetUserMessageText
                ? count + 1
                : count;
            }, 0) || 1
          : undefined;
        const impactedItems = findImpactedClaudeRewindItems(
          threadItems,
          normalizedMessageId,
        );
        if (shouldRestoreFiles) {
          rewindRestoreState = await applyClaudeRewindWorkspaceRestore({
            workspaceId,
            workspacePath,
            impactedItems,
          });
          if ((rewindRestoreState?.ignoredCommittedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-codex-fork-from-message-restore-committed-ignored`,
              timestamp: Date.now(),
              source: "client",
              label: "codex/thread/fork from message restore committed ignored",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                ignoredCommittedPaths:
                  rewindRestoreState?.ignoredCommittedPaths ?? [],
              },
            });
          }
          if ((rewindRestoreState?.skippedPaths?.length ?? 0) > 0) {
            onDebug?.({
              id: `${Date.now()}-client-thread-codex-fork-from-message-restore-skipped`,
              timestamp: Date.now(),
              source: "error",
              label: "codex/thread/fork from message restore skipped",
              payload: {
                workspaceId,
                threadId: canonicalThreadId,
                skippedPaths: rewindRestoreState?.skippedPaths ?? [],
              },
            });
          }
        }
        if (!shouldRewindSession) {
          return canonicalThreadId;
        }

        if (providerProfileId) {
          const response = await forkThreadService(
            workspaceId,
            canonicalThreadId,
            normalizedMessageId,
            {
              providerProfileId,
              targetUserTurnIndex,
              targetUserMessageText:
                targetUserMessageText.length > 0
                  ? targetUserMessageText
                  : undefined,
              targetUserMessageOccurrence,
              localUserMessageCount: userThreadItems.length,
            },
          );
          onDebug?.({
            id: `${Date.now()}-server-thread-codex-provider-fork-from-message`,
            timestamp: Date.now(),
            source: "server",
            label: "codex/thread/provider fork from message response",
            payload: response,
          });
          const forkedThreadId = extractThreadId(response);
          if (!forkedThreadId) {
            if (shouldRestoreFiles && rewindRestoreState?.originalSnapshots?.length) {
              await restoreClaudeRewindWorkspaceSnapshots(
                workspaceId,
                rewindRestoreState.originalSnapshots,
              );
            }
            throw new Error("Codex provider fork did not return a child thread id.");
          }
          dispatch({
            type: "ensureThread",
            workspaceId,
            threadId: forkedThreadId,
            engine: "codex",
            ...extractProviderBindingFromStartedThread(response, selectedProviderBinding),
          });
          writeClientCreatedSessionIndex({
            engine: "codex",
            sessionId: forkedThreadId,
            workspacePath: workspacePathsByIdRef.current[workspaceId] ?? "",
            providerProfileId: selectedProviderBinding.providerProfileId,
            providerProfileName: selectedProviderBinding.providerProfileName,
          });
          if (shouldActivate) {
            dispatch({
              type: "setActiveThreadId",
              workspaceId,
              threadId: forkedThreadId,
            });
          }
          loadedThreadsRef.current[forkedThreadId] = false;
          await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
          return forkedThreadId;
        }

        if (targetUserTurnIndex === 0) {
          // codex rewind 归零 = 删除会话：v2 开启时走 marker-first
          // （裸 id 需 engine 定向），失败保持 throw 语义
          const v2Result = await deleteSessionViaV2IfEnabled(
            workspaceId,
            canonicalThreadId,
            { engine: "codex" },
          );
          if (v2Result) {
            if (!v2Result.ok) {
              throw new Error(v2Result.message ?? "Failed to delete session");
            }
          } else {
            await deleteCodexSessionService(workspaceId, canonicalThreadId);
          }
          delete loadedThreadsRef.current[canonicalThreadId];
          dispatch({
            type: "removeThread",
            workspaceId,
            threadId: canonicalThreadId,
          });
          return canonicalThreadId;
        }

        const response = await rewindCodexThreadService(
          workspaceId,
          canonicalThreadId,
          targetUserTurnIndex,
          normalizedMessageId,
          {
            targetUserMessageText:
              targetUserMessageText.length > 0
                ? targetUserMessageText
                : undefined,
            targetUserMessageOccurrence,
            localUserMessageCount: userThreadItems.length,
          },
        );
        onDebug?.({
          id: `${Date.now()}-server-thread-codex-fork-from-message`,
          timestamp: Date.now(),
          source: "server",
          label: "codex/thread/fork from message response",
          payload: response,
        });
        const forkedThreadId = extractThreadId(response);
        if (!forkedThreadId) {
          if (shouldRestoreFiles && rewindRestoreState?.originalSnapshots?.length) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
          return null;
        }
        dispatch({
          type: "renameThreadId",
          workspaceId,
          oldThreadId: canonicalThreadId,
          newThreadId: forkedThreadId,
        });
        dispatch({
          type: "ensureThread",
          workspaceId,
          threadId: forkedThreadId,
          engine: "codex",
          ...extractProviderBindingFromStartedThread(response, selectedProviderBinding),
        });
        dispatch({
          type: "hideThread",
          workspaceId,
          threadId: canonicalThreadId,
        });
        await renameThreadTitleMapping(
          workspaceId,
          canonicalThreadId,
          forkedThreadId,
        );
        if (shouldActivate && !activeThreadIdByWorkspace[workspaceId]) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId,
            threadId: forkedThreadId,
          });
        }
        delete loadedThreadsRef.current[canonicalThreadId];
        loadedThreadsRef.current[forkedThreadId] = false;
        await resumeThreadForWorkspace(workspaceId, forkedThreadId, true, true);
        return forkedThreadId;
      } catch (error) {
        try {
          if (shouldRestoreFiles && rewindRestoreState?.originalSnapshots?.length) {
            await restoreClaudeRewindWorkspaceSnapshots(
              workspaceId,
              rewindRestoreState.originalSnapshots,
            );
          }
        } catch {
          // Best effort rollback is handled in the main rewind path below.
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isStaleForkTarget = errorMessage.includes("[FORK_TARGET_NOT_FOUND]");
        onDebug?.({
          id: `${Date.now()}-client-thread-codex-fork-from-message-error`,
          timestamp: Date.now(),
          source: isStaleForkTarget ? "client" : "error",
          label: isStaleForkTarget
            ? "codex/thread/fork from message target missing"
            : "codex/thread/fork from message error",
          payload: isStaleForkTarget
            ? {
                workspaceId,
                threadId: canonicalThreadId,
                messageId: normalizedMessageId,
                reason: "runtimeTargetMissing",
                message: errorMessage,
              }
            : errorMessage,
        });
        if (providerProfileId) {
          throw error instanceof Error ? error : new Error(errorMessage);
        }
        return null;
      } finally {
        delete claudeRewindInFlightByThreadRef.current[rewindLockKey];
      }
    },
    [
      activeThreadIdByWorkspace,
      dispatch,
      forkClaudeSessionFromMessageForWorkspace,
      itemsByThread,
      loadedThreadsRef,
      onDebug,
      renameThreadTitleMapping,
      resumeThreadForWorkspace,
      threadsByWorkspace,
      workspacePathsByIdRef,
    ],
  );

  return {
    startThreadForWorkspace,
    finalizeCodexPendingThread,
    startSharedSessionForWorkspace,
    forkThreadForWorkspace,
    forkClaudeSessionFromMessageForWorkspace,
    forkSessionFromMessageForWorkspace,
  };
}
