import {
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { Dispatch, MutableRefObject } from "react";
import {
  workspaceScopedHas,
  type WorkspaceScopedMap,
} from "./workspaceScopedMap";
import type { DebugEntry } from "../../../types";
import { buildThreadDebugCorrelation } from "../utils/threadDebugCorrelation";
import { buildCodexLivenessDiagnostic } from "../utils/codexConversationLiveness";
import {
  buildThreadStreamCorrelationDimensions,
  noteThreadDeltaReceived,
  noteThreadTextIngressReceived,
  reportThreadUpstreamPending,
  type StreamIngressSource,
} from "../utils/streamLatencyDiagnostics";
import { useThreadTurnSettlementReconciliation } from "./useThreadTurnSettlementReconciliation";
import type { ConversationEngine } from "../contracts/conversationCurtainContracts";
import type { ThreadAction } from "./useThreadsReducer";
import {
  TURN_FIRST_DELTA_WARNING_MS,
  TURN_STALL_WARNING_MS,
  applyActiveExecutionItemEvent,
  asString,
  buildAssistantSnapshotIngressKey,
  buildCodexTurnIdentityKey,
  cleanupThreadTransientState,
  createThreadLifecycleSnapshot,
  getCodexNoProgressTimeoutMs,
  sweepThreadTransientState,
  TRANSIENT_TURN_STATE_SWEEP_INTERVAL_MS,
  inferThreadEngine,
  isExecutionItemType,
  isTurnDiagnosticVerboseEnabled,
  listActiveExecutionItemTypes,
  resolveAgentMessageSnapshotText,
  type CodexQuarantinedTurn,
  type DeferredCompletionFlushSource,
  type ThreadLifecycleSnapshot,
  type TurnDiagnosticState,
} from "./threadEventDiagnostics";

type UseTurnDiagnosticsRuntimeOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  onDebug?: (entry: DebugEntry) => void;
  onThreadTransientCleanupReady?: (
    cleanup: (workspaceId: string | null | undefined, threadId: string) => number,
  ) => () => void;
};

// Wave 2 链 A2：turn 诊断运行时工厂 hook。9 个共享 timer/transient refs 在此
// 唯一创建，全部诊断/调度/隔离回调经返回的聚合对象注入各 handler 子 hook
// ——禁止各子 hook 各自新建 timer refs（会破坏共享去抖与清理语义）。
export function useTurnDiagnosticsRuntime({
  activeThreadId,
  dispatch,
  markProcessing,
  setActiveTurnId,
  interruptedThreadsRef,
  onDebug,
  onThreadTransientCleanupReady,
}: UseTurnDiagnosticsRuntimeOptions) {
  const threadLifecycleSnapshotRef = useRef<Map<string, ThreadLifecycleSnapshot>>(new Map());
  const turnDiagnosticsRef = useRef<Map<string, TurnDiagnosticState>>(new Map());
  const turnFirstDeltaTimerRef = useRef<Map<string, number>>(new Map());
  const turnStallTimerRef = useRef<Map<string, number>>(new Map());
  const codexNoProgressTimerRef = useRef<Map<string, number>>(new Map());
  const reconciliationQueryInFlightRef = useRef<Set<string>>(new Set());
  const flushDeferredTurnCompletionRef = useRef<
    ((threadId: string, source: DeferredCompletionFlushSource) => void) | null
  >(null);
  const assistantSnapshotIngressLengthRef = useRef<Map<string, number>>(new Map());
  const quarantinedCodexTurnsRef = useRef<Map<string, CodexQuarantinedTurn>>(new Map());
  const cleanupThreadTransientRefs = useCallback(
    (workspaceId: string | null | undefined, threadId: string) =>
      cleanupThreadTransientState(
        {
          turnDiagnosticsRef,
          quarantinedCodexTurnsRef,
          assistantSnapshotIngressLengthRef,
        },
        workspaceId,
        threadId,
      ),
    [],
  );
  useEffect(() => {
    return onThreadTransientCleanupReady?.(cleanupThreadTransientRefs);
  }, [cleanupThreadTransientRefs, onThreadTransientCleanupReady]);
  const getThreadLifecycleSnapshot = useCallback((threadId: string) => {
    return (
      threadLifecycleSnapshotRef.current.get(threadId) ?? createThreadLifecycleSnapshot()
    );
  }, []);
  const emitTurnDiagnostic = useCallback(
    (
      label: string,
      payload: Record<string, unknown>,
      options?: { force?: boolean },
    ) => {
      if (!options?.force && !isTurnDiagnosticVerboseEnabled()) {
        return;
      }
      onDebug?.({
        id: `${Date.now()}-turn-diagnostic-${label}`,
        timestamp: Date.now(),
        source: "event",
        label: `thread/session:turn-diagnostic:${label}`,
        payload: buildThreadDebugCorrelation(
          {
            workspaceId:
              typeof payload.workspaceId === "string" ? payload.workspaceId : null,
            threadId:
              typeof payload.threadId === "string" ? payload.threadId : null,
            action: `turn-diagnostic:${label}`,
            diagnosticCategory:
              typeof payload.diagnosticCategory === "string"
                ? payload.diagnosticCategory
                : null,
          },
          payload,
        ),
      });
    },
    [onDebug],
  );
  const {
    emitForegroundSettlementDiagnostic,
    buildReconciliationQueryKey,
    terminalKindFromReconciliationStatus,
    settleForegroundTurnResidue,
    emitThreeEvidenceDryRunDiagnostic,
  } = useThreadTurnSettlementReconciliation({
    activeThreadId,
    dispatch,
    markProcessing,
    setActiveTurnId,
    threadLifecycleSnapshotRef,
    turnDiagnosticsRef,
    reconciliationQueryInFlightRef,
    getThreadLifecycleSnapshot,
    emitTurnDiagnostic,
  });

  const clearFirstDeltaTimer = useCallback((threadId: string) => {
    const timerId = turnFirstDeltaTimerRef.current.get(threadId);
    if (timerId === undefined) {
      return;
    }
    window.clearTimeout(timerId);
    turnFirstDeltaTimerRef.current.delete(threadId);
  }, []);

  const clearTurnStallTimer = useCallback((threadId: string) => {
    const timerId = turnStallTimerRef.current.get(threadId);
    if (timerId === undefined) {
      return;
    }
    window.clearTimeout(timerId);
    turnStallTimerRef.current.delete(threadId);
  }, []);

  const clearCodexNoProgressTimer = useCallback((threadId: string) => {
    const timerId = codexNoProgressTimerRef.current.get(threadId);
    if (timerId === undefined) {
      return;
    }
    window.clearTimeout(timerId);
    codexNoProgressTimerRef.current.delete(threadId);
  }, []);

  const markCodexNoProgressSuspected = useCallback(
    (threadId: string, diagnostic: TurnDiagnosticState, elapsedSinceProgressMs: number) => {
      if (diagnostic.noProgressSuspectedAt !== null) {
        return;
      }
      const now = Date.now();
      const timeoutMs = getCodexNoProgressTimeoutMs(diagnostic);
      const activeExecutionItemTypes = listActiveExecutionItemTypes(diagnostic);
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      diagnostic.noProgressSuspectedAt = now;
      diagnostic.noProgressSuspectedSource = "frontend-no-progress-suspected";
      dispatch({
        type: "markCodexSilentSuspected",
        threadId,
        timestamp: now,
        source: "frontend-no-progress-suspected",
      });
      emitTurnDiagnostic("codex-no-progress-suspected", {
        ...buildCodexLivenessDiagnostic({
          workspaceId: diagnostic.workspaceId,
          threadId,
          stage: "suspected-silent",
          outcome: "recoverable",
          source: "frontend-no-progress-suspected",
          reason: "frontend observed no Codex progress before the watchdog window",
          turnId: diagnostic.turnId,
          lastEventAgeMs: elapsedSinceProgressMs,
        }),
        turnId: diagnostic.turnId,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        elapsedSinceProgressMs,
        timeoutMs,
        lastProgressSource: diagnostic.lastProgressSource,
        progressSequence: diagnostic.progressSequence,
        activeExecutionItemCount: diagnostic.activeExecutionItems.size,
        activeExecutionItemTypes,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        diagnosticCategory: "codex-no-progress",
        terminal: false,
        quarantine: false,
        ...buildThreadStreamCorrelationDimensions(threadId),
      }, { force: true });
      emitThreeEvidenceDryRunDiagnostic({
        workspaceId: diagnostic.workspaceId,
        threadId,
        turnId: diagnostic.turnId,
        terminalKind: null,
        sourceMethod: "frontend-no-progress-suspected",
        lifecycle,
        diagnostic,
        handled: false,
        fallbackApplied: false,
      });
    },
    [dispatch, emitThreeEvidenceDryRunDiagnostic, emitTurnDiagnostic, getThreadLifecycleSnapshot],
  );

  const emitCodexNoProgressWatchdogDiagnostic = useCallback(
    (
      stage: "scheduled" | "fired" | "skipped",
      input: {
        workspaceId?: string | null;
        threadId: string;
        diagnostic: TurnDiagnosticState | null;
        reason?: string;
        timeoutMs?: number | null;
        elapsedSinceProgressMs?: number | null;
        delayMs?: number | null;
        lifecycle?: ThreadLifecycleSnapshot | null;
      },
    ) => {
      emitTurnDiagnostic(`codex-no-progress-watchdog-${stage}`, {
        workspaceId: input.workspaceId ?? input.diagnostic?.workspaceId ?? null,
        threadId: input.threadId,
        turnId: input.diagnostic?.turnId ?? null,
        diagnosticCategory: "codex-no-progress-watchdog",
        stage,
        reason: input.reason ?? null,
        timeoutMs: input.timeoutMs ?? null,
        elapsedSinceProgressMs: input.elapsedSinceProgressMs ?? null,
        delayMs: input.delayMs ?? null,
        lastProgressSource: input.diagnostic?.lastProgressSource ?? null,
        progressSequence: input.diagnostic?.progressSequence ?? null,
        activeExecutionItemCount:
          input.diagnostic?.activeExecutionItems.size ?? null,
        isProcessing: input.lifecycle?.isProcessing ?? null,
        activeTurnId: input.lifecycle?.activeTurnId ?? null,
        activeThreadId,
        ...buildThreadStreamCorrelationDimensions(input.threadId),
      }, stage === "scheduled" ? undefined : { force: true });
    },
    [activeThreadId, emitTurnDiagnostic],
  );

  const scheduleCodexNoProgressTimer = useCallback(
    (workspaceId: string | null, threadId: string) => {
      if (typeof window === "undefined" || inferThreadEngine(threadId) !== "codex") {
        return;
      }
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        emitCodexNoProgressWatchdogDiagnostic("skipped", {
          workspaceId,
          threadId,
          diagnostic: null,
          reason: "missing-diagnostic",
        });
        return;
      }
      clearCodexNoProgressTimer(threadId);
      const now = Date.now();
      const timeoutMs = getCodexNoProgressTimeoutMs(diagnostic);
      const elapsedSinceProgressMs = Math.max(0, now - diagnostic.lastProgressAt);
      const delayMs = Math.max(0, timeoutMs - elapsedSinceProgressMs);
      emitCodexNoProgressWatchdogDiagnostic("scheduled", {
        workspaceId: diagnostic.workspaceId,
        threadId,
        diagnostic,
        timeoutMs,
        elapsedSinceProgressMs,
        delayMs,
      });
      const timerId = window.setTimeout(() => {
        const latestDiagnostic = turnDiagnosticsRef.current.get(threadId);
        if (!latestDiagnostic) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: null,
            reason: "missing-diagnostic",
          });
          return;
        }
        const now = Date.now();
        const elapsedSinceProgressMs = Math.max(0, now - latestDiagnostic.lastProgressAt);
        const timeoutMs = getCodexNoProgressTimeoutMs(latestDiagnostic);
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        emitCodexNoProgressWatchdogDiagnostic("fired", {
          workspaceId: diagnostic?.workspaceId ?? null,
          threadId,
          diagnostic: latestDiagnostic,
          timeoutMs,
          elapsedSinceProgressMs,
          lifecycle,
        });
        if (latestDiagnostic.completedAt !== null) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "completed",
            timeoutMs,
            elapsedSinceProgressMs,
          });
          return;
        }
        if (latestDiagnostic.errorAt !== null) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "error",
            timeoutMs,
            elapsedSinceProgressMs,
          });
          return;
        }
        if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId ?? latestDiagnostic.workspaceId ?? null, threadId)) {
          const inferredEngine = inferThreadEngine(threadId);
          const correlationEngine =
            buildThreadStreamCorrelationDimensions(threadId).engine;
          const engineScopeMatches =
            correlationEngine === null || correlationEngine === inferredEngine;
          const turnScopeMatches =
            lifecycle.activeTurnId === latestDiagnostic.turnId ||
            lifecycle.activeTurnId === null;
          settleForegroundTurnResidue({
            workspaceId: latestDiagnostic.workspaceId,
            threadId,
            turnId: latestDiagnostic.turnId,
            engine: inferredEngine,
            lifecycle,
            source: "watchdog-interrupted",
            decisionAction: "cleanup-residue",
            decisionReason: "interrupted",
            scopeMatch: {
              matched: engineScopeMatches && turnScopeMatches,
              workspace: true,
              engine: engineScopeMatches,
              thread: true,
              turn: turnScopeMatches,
              foregroundOwner: true,
              runtimeLease: null,
            },
            acceptedEvidence: {
              terminal: true,
              state: lifecycle.isProcessing,
              progress: false,
              reconciliation: false,
            },
            boundedReason: "watchdog skipped because turn was interrupted",
            lastProgressAgeMs: elapsedSinceProgressMs,
            allowAbandonedActiveTurn: true,
          });
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "interrupted",
            timeoutMs,
            elapsedSinceProgressMs,
            lifecycle,
          });
          return;
        }
        if (!lifecycle.isProcessing) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "not-processing",
            timeoutMs,
            elapsedSinceProgressMs,
            lifecycle,
          });
          return;
        }
        if (
          lifecycle.activeTurnId !== null &&
          lifecycle.activeTurnId !== latestDiagnostic.turnId
        ) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "active-turn-mismatch",
            timeoutMs,
            elapsedSinceProgressMs,
            lifecycle,
          });
          return;
        }
        if (elapsedSinceProgressMs < timeoutMs) {
          emitCodexNoProgressWatchdogDiagnostic("skipped", {
            workspaceId: diagnostic?.workspaceId ?? null,
            threadId,
            diagnostic: latestDiagnostic,
            reason: "progress-still-fresh",
            timeoutMs,
            elapsedSinceProgressMs,
            lifecycle,
          });
          return;
        }
        markCodexNoProgressSuspected(
          threadId,
          latestDiagnostic,
          elapsedSinceProgressMs,
        );
      }, delayMs);
      codexNoProgressTimerRef.current.set(threadId, timerId);
    },
    [
      clearCodexNoProgressTimer,
      emitCodexNoProgressWatchdogDiagnostic,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      markCodexNoProgressSuspected,
      settleForegroundTurnResidue,
    ],
  );

  const noteCodexTurnProgressEvidence = useCallback(
    (workspaceId: string | null, threadId: string, source: string) => {
      if (inferThreadEngine(threadId) !== "codex" || workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
        return;
      }
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        return;
      }
      const wasSuspected = diagnostic.noProgressSuspectedAt !== null;
      const suspectedDurationMs =
        diagnostic.noProgressSuspectedAt === null
          ? null
          : Math.max(0, Date.now() - diagnostic.noProgressSuspectedAt);
      diagnostic.lastProgressAt = Date.now();
      diagnostic.lastProgressSource = source;
      diagnostic.progressSequence += 1;
      diagnostic.noProgressSuspectedAt = null;
      diagnostic.noProgressSuspectedSource = null;
      if (wasSuspected) {
        dispatch({ type: "clearCodexSilentSuspected", threadId });
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        emitTurnDiagnostic("codex-no-progress-recovered", {
          ...buildCodexLivenessDiagnostic({
            workspaceId: diagnostic.workspaceId,
            threadId,
            stage: "active",
            outcome: "recovered",
            source,
            reason: "matching Codex progress arrived after frontend no-progress suspicion",
            turnId: diagnostic.turnId,
          }),
          turnId: diagnostic.turnId,
          progressSource: source,
          suspectedDurationMs,
          progressSequence: diagnostic.progressSequence,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          diagnosticCategory: "codex-no-progress",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
      }
      scheduleCodexNoProgressTimer(workspaceId, threadId);
    },
    [
      emitTurnDiagnostic,
      dispatch,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      scheduleCodexNoProgressTimer,
    ],
  );

  const scheduleFirstDeltaTimer = useCallback(
    (workspaceId: string | null, threadId: string) => {
      if (typeof window === "undefined") {
        return;
      }
      clearFirstDeltaTimer(threadId);
      const timerId = window.setTimeout(() => {
        if (workspaceScopedHas(interruptedThreadsRef.current, workspaceId, threadId)) {
          return;
        }
        const diagnostic = turnDiagnosticsRef.current.get(threadId);
        if (!diagnostic || diagnostic.firstDeltaAt !== null) {
          return;
        }
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        const now = Date.now();
        const elapsedMs = Math.max(0, now - diagnostic.startedAt);
        reportThreadUpstreamPending(threadId, {
          elapsedMs,
          diagnosticCategory: "first-token-delay",
          reason: "waiting-for-first-delta",
        });
        emitTurnDiagnostic("waiting-for-first-delta", {
          workspaceId: diagnostic.workspaceId,
          threadId: diagnostic.threadId,
          turnId: diagnostic.turnId,
          elapsedMs,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          diagnosticCategory: "first-token-delay",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
      }, TURN_FIRST_DELTA_WARNING_MS);
      turnFirstDeltaTimerRef.current.set(threadId, timerId);
    },
    [clearFirstDeltaTimer, emitTurnDiagnostic, getThreadLifecycleSnapshot, interruptedThreadsRef],
  );

  const scheduleTurnStallTimer = useCallback(
    (threadId: string) => {
      if (typeof window === "undefined") {
        return;
      }
      clearTurnStallTimer(threadId);
      const timerId = window.setTimeout(() => {
        const diagnostic = turnDiagnosticsRef.current.get(threadId);
        if (!diagnostic || diagnostic.stallReported || diagnostic.firstExecutionAt !== null) {
          return;
        }
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        const now = Date.now();
        diagnostic.stallReported = true;
        emitTurnDiagnostic("stalled-after-first-delta", {
          workspaceId: diagnostic.workspaceId,
          threadId: diagnostic.threadId,
          turnId: diagnostic.turnId,
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          deltaSinceMs:
            diagnostic.firstDeltaAt === null ? null : Math.max(0, now - diagnostic.firstDeltaAt),
          itemEventCount: diagnostic.itemEventCount,
          firstItemEventKind: diagnostic.firstItemEventKind,
          firstItemType: diagnostic.firstItemType,
          hasExecutionItem: false,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
      }, TURN_STALL_WARNING_MS);
      turnStallTimerRef.current.set(threadId, timerId);
    },
    [clearTurnStallTimer, emitTurnDiagnostic, getThreadLifecycleSnapshot],
  );

  const noteNonTextRuntimeProgress = useCallback(
    (
      threadId: string,
      source: string,
      evidence: {
        itemType?: string | null;
        itemId?: string | null;
        itemEventKind?: "started" | "updated" | "completed" | "output-delta" | null;
        outputLength?: number | null;
      } = {},
    ) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic || diagnostic.completedAt !== null || diagnostic.errorAt !== null) {
        return;
      }
      const now = Date.now();
      diagnostic.lastProgressAt = now;
      diagnostic.lastProgressSource = source;
      diagnostic.progressSequence += 1;
      if (diagnostic.firstDeltaAt === null) {
        clearFirstDeltaTimer(threadId);
      }
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      emitTurnDiagnostic("non-text-runtime-progress", {
        workspaceId: diagnostic.workspaceId,
        threadId,
        turnId: diagnostic.turnId,
        source,
        itemType: evidence.itemType ?? null,
        itemId: evidence.itemId ?? null,
        itemEventKind: evidence.itemEventKind ?? null,
        outputLength: evidence.outputLength ?? null,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        firstDeltaSeen: diagnostic.firstDeltaAt !== null,
        progressSequence: diagnostic.progressSequence,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        diagnosticCategory: "non-text-runtime-progress",
        ...buildThreadStreamCorrelationDimensions(threadId),
      });
    },
    [clearFirstDeltaTimer, emitTurnDiagnostic, getThreadLifecycleSnapshot],
  );

  const clearAssistantSnapshotIngressForThread = useCallback((threadId: string) => {
    const prefix = `${threadId}\u0000`;
    assistantSnapshotIngressLengthRef.current.forEach((_value, key) => {
      if (key.startsWith(prefix)) {
        assistantSnapshotIngressLengthRef.current.delete(key);
      }
    });
  }, []);

  const quarantineCodexTurn = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      reason: string,
      source: string,
      engineHint?: ConversationEngine | null,
    ) => {
      const normalizedTurnId = turnId.trim();
      const engine = engineHint ?? inferThreadEngine(threadId);
      if (engine !== "codex" || !normalizedTurnId) {
        return;
      }
      const key = buildCodexTurnIdentityKey(threadId, normalizedTurnId);
      if (quarantinedCodexTurnsRef.current.has(key)) {
        return;
      }
      quarantinedCodexTurnsRef.current.set(key, {
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        settledAt: Date.now(),
        reason,
        source,
      });
    },
    [],
  );

  const findQuarantinedCodexTurn = useCallback(
    (threadId: string, turnId?: string | null) => {
      const normalizedThreadId = threadId.trim();
      if (!normalizedThreadId) {
        return null;
      }
      const normalizedTurnId = turnId?.trim() ?? "";
      if (normalizedTurnId) {
        return (
          quarantinedCodexTurnsRef.current.get(
            buildCodexTurnIdentityKey(normalizedThreadId, normalizedTurnId),
          ) ?? null
        );
      }
      for (const quarantinedTurn of quarantinedCodexTurnsRef.current.values()) {
        if (quarantinedTurn.threadId === normalizedThreadId) {
          return quarantinedTurn;
        }
      }
      return null;
    },
    [],
  );

  const shouldSkipCodexTurnEvent = useCallback(
    (input: {
      engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "dsh" | "qoder";
      workspaceId: string;
      threadId: string;
      turnId: string;
      operation: string;
      sourceMethod: string;
    }) => {
      if (input.engine !== "codex") {
        return false;
      }
      const eventTurnId = input.turnId.trim();
      if (!eventTurnId) {
        const lifecycle = getThreadLifecycleSnapshot(input.threadId);
        const activeQuarantinedTurn = lifecycle.activeTurnId
          ? findQuarantinedCodexTurn(input.threadId, lifecycle.activeTurnId)
          : null;
        const settledTurnWithoutSuccessor =
          lifecycle.activeTurnId === null && !lifecycle.isProcessing
            ? findQuarantinedCodexTurn(input.threadId)
            : null;
        const quarantinedTurn = activeQuarantinedTurn ?? settledTurnWithoutSuccessor;
        if (!quarantinedTurn) {
          return false;
        }
        emitTurnDiagnostic("quarantined-codex-event-skipped", {
          ...buildCodexLivenessDiagnostic({
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            stage: "abandoned",
            outcome: "abandoned",
            source: input.sourceMethod,
            reason:
              "turnless event follows a quarantined Codex turn without a verified successor",
            turnId: quarantinedTurn.turnId,
          }),
          eventTurnId: null,
          activeTurnId: lifecycle.activeTurnId,
          isProcessing: lifecycle.isProcessing,
          quarantinedAtMs: quarantinedTurn.settledAt,
          quarantineReason: quarantinedTurn.reason,
          quarantineSource: quarantinedTurn.source,
          operation: input.operation,
          sourceMethod: input.sourceMethod,
          diagnosticCategory: "quarantined-codex-event",
        }, { force: true });
        return true;
      }
      const quarantineKey = buildCodexTurnIdentityKey(input.threadId, eventTurnId);
      const quarantinedTurn = quarantinedCodexTurnsRef.current.get(quarantineKey);
      if (quarantinedTurn) {
        emitTurnDiagnostic("quarantined-codex-event-skipped", {
          ...buildCodexLivenessDiagnostic({
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            stage: "abandoned",
            outcome: "abandoned",
            source: input.sourceMethod,
            reason: "event belongs to a quarantined Codex turn",
            turnId: eventTurnId,
          }),
          eventTurnId,
          quarantinedAtMs: quarantinedTurn.settledAt,
          quarantineReason: quarantinedTurn.reason,
          quarantineSource: quarantinedTurn.source,
          operation: input.operation,
          sourceMethod: input.sourceMethod,
          diagnosticCategory: "quarantined-codex-event",
        }, { force: true });
        return true;
      }
      const diagnosticTurnId = turnDiagnosticsRef.current.get(input.threadId)?.turnId ?? null;
      const activeTurnId = getThreadLifecycleSnapshot(input.threadId).activeTurnId;
      const expectedTurnId = diagnosticTurnId ?? activeTurnId;
      if (!expectedTurnId || expectedTurnId === eventTurnId) {
        return false;
      }
      emitTurnDiagnostic("late-codex-event-skipped", {
        ...buildCodexLivenessDiagnostic({
          workspaceId: input.workspaceId,
          threadId: input.threadId,
          stage: "abandoned",
          outcome: "abandoned",
          source: input.sourceMethod,
          reason: "event turn id does not match active Codex turn",
          turnId: eventTurnId,
        }),
        eventTurnId,
        activeTurnId,
        expectedTurnId,
        operation: input.operation,
        sourceMethod: input.sourceMethod,
        diagnosticCategory: "late-codex-event",
      }, { force: true });
      return true;
    },
    [emitTurnDiagnostic, findQuarantinedCodexTurn, getThreadLifecycleSnapshot],
  );

  const resolveTerminalSettlementTurnId = useCallback(
    (threadId: string, incomingTurnId: string) => {
      const normalizedTurnId = incomingTurnId.trim();
      if (normalizedTurnId) {
        return normalizedTurnId;
      }
      return (
        getThreadLifecycleSnapshot(threadId).activeTurnId ??
        turnDiagnosticsRef.current.get(threadId)?.turnId ??
        ""
      );
    },
    [getThreadLifecycleSnapshot],
  );

  const markProcessingTracked = useCallback(
    (threadId: string, isProcessing: boolean) => {
      const previous =
        threadLifecycleSnapshotRef.current.get(threadId) ?? createThreadLifecycleSnapshot();
      threadLifecycleSnapshotRef.current.set(threadId, {
        ...previous,
        isProcessing,
      });
      markProcessing(threadId, isProcessing);
    },
    [markProcessing],
  );

  const setActiveTurnIdTracked = useCallback(
    (threadId: string, turnId: string | null) => {
      const previous =
        threadLifecycleSnapshotRef.current.get(threadId) ?? createThreadLifecycleSnapshot();
      threadLifecycleSnapshotRef.current.set(threadId, {
        ...previous,
        activeTurnId: turnId,
      });
      setActiveTurnId(threadId, turnId);
    },
    [setActiveTurnId],
  );

  const captureTurnItemDiagnostic = useCallback(
    (
      workspaceId: string | null,
      threadId: string,
      kind: "started" | "updated" | "completed",
      item: Record<string, unknown>,
    ) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        return;
      }
      diagnostic.itemEventCount += 1;
      const itemType = asString(item.type).trim() || null;
      const itemId = asString(item.id).trim() || null;
      const now = Date.now();
      if (diagnostic.firstItemEventAt === null) {
        diagnostic.firstItemEventAt = now;
        diagnostic.firstItemEventKind = kind;
        diagnostic.firstItemType = itemType;
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        emitTurnDiagnostic("first-item", {
          workspaceId: diagnostic.workspaceId,
          threadId,
          turnId: diagnostic.turnId,
          itemEventKind: kind,
          itemType,
          itemId,
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          deltaSeen: diagnostic.firstDeltaAt !== null,
          isProcessing: lifecycle.isProcessing,
          activeTurnId: lifecycle.activeTurnId,
          ...buildThreadStreamCorrelationDimensions(threadId),
        });
      }
      if (isExecutionItemType(itemType)) {
        noteNonTextRuntimeProgress(threadId, `execution-item-${kind}`, {
          itemType,
          itemId,
          itemEventKind: kind,
        });
        if (diagnostic.firstExecutionAt === null) {
          diagnostic.firstExecutionAt = now;
          diagnostic.firstExecutionEventKind = kind;
          diagnostic.firstExecutionItemType = itemType;
          diagnostic.firstExecutionItemId = itemId;
          clearTurnStallTimer(threadId);
          const lifecycle = getThreadLifecycleSnapshot(threadId);
          emitTurnDiagnostic("first-execution-item", {
            workspaceId: diagnostic.workspaceId,
            threadId,
            turnId: diagnostic.turnId,
            itemEventKind: kind,
            itemType,
            itemId,
            elapsedMs: Math.max(0, now - diagnostic.startedAt),
            deltaSinceMs:
              diagnostic.firstDeltaAt === null ? null : Math.max(0, now - diagnostic.firstDeltaAt),
            isProcessing: lifecycle.isProcessing,
            activeTurnId: lifecycle.activeTurnId,
            ...buildThreadStreamCorrelationDimensions(threadId),
          });
        }
      }
      if (applyActiveExecutionItemEvent(diagnostic, kind, itemType, itemId, item, now)) {
        scheduleCodexNoProgressTimer(workspaceId, threadId);
      }
    },
    [
      clearTurnStallTimer,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      noteNonTextRuntimeProgress,
      scheduleCodexNoProgressTimer,
    ],
  );

  const recordAssistantCompletionEvidence = useCallback(
    (threadId: string, itemId: string) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!diagnostic) {
        return;
      }
      diagnostic.assistantCompletedAt = Date.now();
      diagnostic.assistantCompletedItemId = itemId || null;
    },
    [],
  );

  const recordAssistantStreamIngress = useCallback(
    (payload: {
      workspaceId: string;
      threadId: string;
      itemId: string;
      textLength: number;
      source: StreamIngressSource;
    }) => {
      if (workspaceScopedHas(interruptedThreadsRef.current, payload.workspaceId, payload.threadId)) {
        return;
      }
      const diagnostic = turnDiagnosticsRef.current.get(payload.threadId);
      if (!diagnostic) {
        return;
      }
      const deltaTimestamp = Date.now();
      const source = payload.source;
      const isDeltaIngress = source === "delta" || source === "snapshot";
      if (isDeltaIngress) {
        noteThreadDeltaReceived(payload.threadId, deltaTimestamp, {
          source,
          itemId: payload.itemId,
          textLength: payload.textLength,
        });
        diagnostic.deltaCount += 1;
      } else {
        noteThreadTextIngressReceived(payload.threadId, {
          source: payload.source,
          itemId: payload.itemId,
          textLength: payload.textLength,
          timestamp: deltaTimestamp,
        });
      }
      if (!isDeltaIngress) {
        return;
      }
      if (diagnostic.firstDeltaAt !== null) {
        return;
      }
      diagnostic.firstDeltaAt = deltaTimestamp;
      clearFirstDeltaTimer(payload.threadId);
      scheduleTurnStallTimer(payload.threadId);
      const lifecycle = getThreadLifecycleSnapshot(payload.threadId);
      emitTurnDiagnostic("first-delta", {
        workspaceId: payload.workspaceId,
        threadId: payload.threadId,
        turnId: diagnostic.turnId,
        itemId: payload.itemId,
        deltaLength: payload.textLength,
        ingressSource: payload.source,
        elapsedMs: Math.max(0, diagnostic.firstDeltaAt - diagnostic.startedAt),
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        ...buildThreadStreamCorrelationDimensions(payload.threadId),
      });
    },
    [
      clearFirstDeltaTimer,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      scheduleTurnStallTimer,
    ],
  );

  const maybeRecordAgentMessageSnapshotIngress = useCallback(
    (workspaceId: string, threadId: string, item: Record<string, unknown>) => {
      const itemType = asString(item.type).trim();
      if (itemType !== "agentMessage") {
        return;
      }
      const text = resolveAgentMessageSnapshotText(item);
      if (!text.trim()) {
        return;
      }
      const itemId = asString(item.id).trim();
      const ingressKey = buildAssistantSnapshotIngressKey(threadId, itemId);
      const previousLength =
        assistantSnapshotIngressLengthRef.current.get(ingressKey) ?? 0;
      const nextLength = text.length;
      if (nextLength <= previousLength) {
        return;
      }
      assistantSnapshotIngressLengthRef.current.set(ingressKey, nextLength);
      recordAssistantStreamIngress({
        workspaceId,
        threadId,
        itemId,
        textLength: nextLength,
        source: "snapshot",
      });
    },
    [recordAssistantStreamIngress],
  );

  useEffect(() => {
    const firstDeltaTimers = turnFirstDeltaTimerRef.current;
    const stallTimers = turnStallTimerRef.current;
    const codexNoProgressTimers = codexNoProgressTimerRef.current;
    const assistantSnapshotIngressLength = assistantSnapshotIngressLengthRef.current;
    const quarantinedCodexTurns = quarantinedCodexTurnsRef.current;
    const reconciliationQueryInFlight = reconciliationQueryInFlightRef.current;
    return () => {
      firstDeltaTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      firstDeltaTimers.clear();
      stallTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      stallTimers.clear();
      codexNoProgressTimers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      codexNoProgressTimers.clear();
      assistantSnapshotIngressLength.clear();
      quarantinedCodexTurns.clear();
      reconciliationQueryInFlight.clear();
    };
  }, []);

  // chat-stream-render-isolation-2026-06 task 8.4: 60s interval sweep
  // over turnDiagnosticsRef / quarantinedCodexTurnsRef. Active turns (no
  // settled timestamp) are never evicted; settled entries expire 30min after
  // their settledAt. See design.md §4 and sweepThreadTransientState in
  // threadEventDiagnostics.ts.
  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const now = Date.now();
      const diagnosticEntries = Array.from(
        turnDiagnosticsRef.current.entries(),
      ).map(([threadId, state]) => ({
        threadId,
        settledAt:
          state.completedAt ?? state.errorAt ?? state.assistantCompletedAt,
      }));
      const diagnosticSweep = sweepThreadTransientState(
        diagnosticEntries,
        now,
      );
      for (const threadId of diagnosticSweep.expiredThreadIds) {
        const workspaceId =
          turnDiagnosticsRef.current.get(threadId)?.workspaceId ?? null;
        cleanupThreadTransientRefs(workspaceId, threadId);
      }
      const quarantineEntries = Array.from(
        quarantinedCodexTurnsRef.current.entries(),
      ).map(([quarantineKey, entry]) => ({
        threadId: quarantineKey,
        settledAt: entry.settledAt,
      }));
      const quarantineSweep = sweepThreadTransientState(
        quarantineEntries,
        now,
      );
      for (const quarantineKey of quarantineSweep.expiredThreadIds) {
        quarantinedCodexTurnsRef.current.delete(quarantineKey);
      }
    }, TRANSIENT_TURN_STATE_SWEEP_INTERVAL_MS);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [cleanupThreadTransientRefs]);
  return {
    turnDiagnosticsRef,
    reconciliationQueryInFlightRef,
    flushDeferredTurnCompletionRef,
    emitTurnDiagnostic,
    emitForegroundSettlementDiagnostic,
    emitThreeEvidenceDryRunDiagnostic,
    scheduleFirstDeltaTimer,
    scheduleTurnStallTimer,
    scheduleCodexNoProgressTimer,
    clearFirstDeltaTimer,
    clearTurnStallTimer,
    clearCodexNoProgressTimer,
    clearAssistantSnapshotIngressForThread,
    noteCodexTurnProgressEvidence,
    noteNonTextRuntimeProgress,
    quarantineCodexTurn,
    findQuarantinedCodexTurn,
    shouldSkipCodexTurnEvent,
    captureTurnItemDiagnostic,
    recordAssistantCompletionEvidence,
    recordAssistantStreamIngress,
    maybeRecordAgentMessageSnapshotIngress,
    getThreadLifecycleSnapshot,
    markProcessingTracked,
    setActiveTurnIdTracked,
    resolveTerminalSettlementTurnId,
    buildReconciliationQueryKey,
    terminalKindFromReconciliationStatus,
  };
}

export type TurnDiagnosticsRuntime = ReturnType<typeof useTurnDiagnosticsRuntime>;
