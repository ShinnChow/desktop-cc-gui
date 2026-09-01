import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import type { TurnReconciliationRuntimeStatus } from "../../../types";
import {
  buildThreadStreamCorrelationDimensions,
} from "../utils/streamLatencyDiagnostics";
import {
  DEFAULT_TURN_SETTLEMENT_POLICY,
  evaluateTurnSettlement,
  toDryRunSettlementDecisionLabel,
  type TurnSettlementTerminalKind,
} from "../utils/turnSettlementDecision";
import { queryTurnReconciliationStatusWithTimeout } from "./threadReconciliationStatusQuery";
import {
  getCodexNoProgressTimeoutMs,
  inferThreadEngine,
  type ThreadLifecycleSnapshot,
  type TurnDiagnosticState,
} from "./threadEventDiagnostics";
import type { ThreadAction } from "./useThreadsReducer";
import {
  clearLiveAssistantText,
  peekLiveAssistantText,
} from "../utils/liveAssistantTextChannel";
import { drainLiveItemDeltaTail } from "../utils/liveItemDeltaChannel";

type EmitTurnDiagnostic = (
  label: string,
  payload: Record<string, unknown>,
  options?: { force?: boolean },
) => void;

type UseThreadTurnSettlementReconciliationOptions = {
  activeThreadId: string | null;
  dispatch: Dispatch<ThreadAction>;
  markProcessing: (threadId: string, isProcessing: boolean) => void;
  setActiveTurnId: (threadId: string, turnId: string | null) => void;
  threadLifecycleSnapshotRef: MutableRefObject<Map<string, ThreadLifecycleSnapshot>>;
  turnDiagnosticsRef: MutableRefObject<Map<string, TurnDiagnosticState>>;
  reconciliationQueryInFlightRef: MutableRefObject<Set<string>>;
  getThreadLifecycleSnapshot: (threadId: string) => ThreadLifecycleSnapshot;
  emitTurnDiagnostic: EmitTurnDiagnostic;
};

export function useThreadTurnSettlementReconciliation({
  activeThreadId,
  dispatch,
  markProcessing,
  setActiveTurnId,
  threadLifecycleSnapshotRef,
  turnDiagnosticsRef,
  reconciliationQueryInFlightRef,
  getThreadLifecycleSnapshot,
  emitTurnDiagnostic,
}: UseThreadTurnSettlementReconciliationOptions) {
  const emitForegroundSettlementDiagnostic = useCallback(
    (label: string, payload: Record<string, unknown>) => {
      emitTurnDiagnostic(label, {
        diagnosticCategory: "foreground-terminal-settlement",
        ...payload,
      }, { force: true });
    },
    [emitTurnDiagnostic],
  );

  const buildReconciliationQueryKey = useCallback(
    (input: {
      workspaceId: string;
      engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
      threadId: string;
      turnId: string | null;
      runtimeSessionId: string | null;
      runtimeLeaseId: string | null;
    }) => {
      return [
        input.workspaceId,
        input.engine,
        input.threadId,
        input.turnId ?? "",
        input.runtimeSessionId ?? "",
        input.runtimeLeaseId ?? "",
      ].join("\u0000");
    },
    [],
  );

  const terminalKindFromReconciliationStatus = useCallback(
    (status: TurnReconciliationRuntimeStatus): TurnSettlementTerminalKind | null => {
      switch (status) {
        case "completed":
          return "status-confirmed-completed";
        case "failed":
          return "status-confirmed-error";
        case "stalled":
          return "stalled";
        case "runtime-ended":
          return "runtime-ended";
        case "running":
        case "unknown":
        case "query-failed":
          return null;
      }
    },
    [],
  );

  const settleForegroundTurnResidue = useCallback(
    (input: {
      workspaceId: string;
      threadId: string;
      turnId: string | null;
      engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
      lifecycle: ThreadLifecycleSnapshot;
      source: "three-evidence-query-skipped" | "three-evidence-query-resolved" | "watchdog-interrupted";
      decisionAction: string;
      decisionReason: string;
      scopeMatch: Record<string, unknown>;
      acceptedEvidence: Record<string, unknown>;
      boundedReason: string | null;
      status?: TurnReconciliationRuntimeStatus | null;
      statusSource?: string | null;
      lastProgressAgeMs?: number | null;
      allowAbandonedActiveTurn?: boolean;
    }) => {
      const activeTurnId = input.lifecycle.activeTurnId;
      const turnMatches =
        activeTurnId === input.turnId ||
        (input.allowAbandonedActiveTurn === true && activeTurnId === null);
      const scopeMatched = input.scopeMatch.matched === true;
      const engineMatched = input.scopeMatch.engine !== false;
      const terminalAccepted = input.acceptedEvidence.terminal === true;
      const stateAccepted = input.acceptedEvidence.state === true;
      const cleanupAllowed =
        input.decisionAction === "cleanup-residue" &&
        input.lifecycle.isProcessing &&
        turnMatches &&
        engineMatched &&
        (input.source === "watchdog-interrupted" ||
          (scopeMatched && terminalAccepted && stateAccepted));

      if (!cleanupAllowed) {
        emitTurnDiagnostic("three-evidence-reconciliation-cleanup-skipped", {
          workspaceId: input.workspaceId,
          threadId: input.threadId,
          turnId: input.turnId,
          engine: input.engine,
          diagnosticCategory: "three-evidence-reconciliation",
          cleanupSource: input.source,
          skipReason: !input.lifecycle.isProcessing
            ? "not-processing"
            : !turnMatches
              ? "active-turn-mismatch"
              : !engineMatched
                ? "engine-mismatch"
                : input.decisionAction !== "cleanup-residue"
                  ? "decision-not-cleanup-residue"
                  : input.source !== "watchdog-interrupted" && !scopeMatched
                    ? "scope-mismatch"
                    : input.source !== "watchdog-interrupted" &&
                        (!terminalAccepted || !stateAccepted)
                      ? "evidence-not-accepted"
                      : "guard-rejected",
          status: input.status ?? null,
          statusSource: input.statusSource ?? null,
          decisionAction: input.decisionAction,
          decisionReason: input.decisionReason,
          scopeMatch: input.scopeMatch,
          acceptedEvidence: input.acceptedEvidence,
          boundedReason: input.boundedReason,
          lastProgressAgeMs: input.lastProgressAgeMs ?? null,
          isProcessing: input.lifecycle.isProcessing,
          activeTurnId,
          activeThreadId,
        }, { force: true });
        return false;
      }

      threadLifecycleSnapshotRef.current.set(input.threadId, {
        ...input.lifecycle,
        isProcessing: false,
        activeTurnId: null,
      });
      dispatch({ type: "clearCodexSilentSuspected", threadId: input.threadId });
      // markProcessing(false) 前落 live 全文，避免 residual cleanup 只关流式却留下建壳首字。
      {
        const liveEntry = peekLiveAssistantText(input.threadId);
        if (liveEntry?.text) {
          dispatch({
            type: "completeAgentMessage",
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            itemId: liveEntry.itemId,
            text: liveEntry.text,
            hasCustomName: true,
            timestamp: Date.now(),
          });
          clearLiveAssistantText(input.threadId);
        }
      }
      // A4 二期：同一段 residual cleanup 也要把 reasoning/toolOutput 通道尾段
      // 灌回 durable items（flag 关时通道为空、天然 no-op），否则这些行只剩建壳首段。
      for (const tail of drainLiveItemDeltaTail(input.threadId)) {
        if (tail.lane === "reasoningContent") {
          dispatch({
            type: "appendReasoningContent",
            threadId: input.threadId,
            itemId: tail.itemId,
            delta: tail.text,
          });
        } else if (tail.lane === "reasoningSummary") {
          dispatch({
            type: "appendReasoningSummary",
            threadId: input.threadId,
            itemId: tail.itemId,
            delta: tail.text,
          });
        } else {
          dispatch({
            type: "appendToolOutput",
            threadId: input.threadId,
            itemId: tail.itemId,
            delta: tail.text,
          });
        }
      }
      markProcessing(input.threadId, false);
      setActiveTurnId(input.threadId, null);
      emitTurnDiagnostic("three-evidence-reconciliation-cleanup-applied", {
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        turnId: input.turnId,
        engine: input.engine,
        diagnosticCategory: "three-evidence-reconciliation",
        cleanupSource: input.source,
        status: input.status ?? null,
        statusSource: input.statusSource ?? null,
        decisionAction: input.decisionAction,
        decisionReason: input.decisionReason,
        scopeMatch: input.scopeMatch,
        acceptedEvidence: input.acceptedEvidence,
        boundedReason: input.boundedReason,
        lastProgressAgeMs: input.lastProgressAgeMs ?? null,
        wasProcessing: input.lifecycle.isProcessing,
        previousActiveTurnId: activeTurnId,
        clearedProcessing: true,
        clearedActiveTurn: activeTurnId !== null,
        activeThreadId,
      }, { force: true });
      return true;
    },
    [
      activeThreadId,
      dispatch,
      emitTurnDiagnostic,
      markProcessing,
      setActiveTurnId,
      threadLifecycleSnapshotRef,
    ],
  );

  const emitThreeEvidenceDryRunDiagnostic = useCallback(
    (input: {
      workspaceId: string;
      threadId: string;
      turnId: string;
      terminalKind: TurnSettlementTerminalKind | null;
      sourceMethod: string | null;
      lifecycle: ThreadLifecycleSnapshot;
      diagnostic: TurnDiagnosticState | undefined;
      handled: boolean;
      fallbackApplied: boolean;
    }) => {
      const now = Date.now();
      const progressFreshWindowMs = input.diagnostic
        ? getCodexNoProgressTimeoutMs(input.diagnostic)
        : DEFAULT_TURN_SETTLEMENT_POLICY.progressFreshWindowMs;
      const lastProgressAgeMs = input.diagnostic
        ? Math.max(0, now - input.diagnostic.lastProgressAt)
        : null;
      const engine = inferThreadEngine(input.threadId);
      const decision = evaluateTurnSettlement(
        {
          workspaceId: input.workspaceId,
          engine,
          threadId: input.threadId,
          turnId: input.turnId || null,
          runtimeSessionId: null,
          runtimeLeaseId: null,
          source: "event",
          scope: {
            foreground: true,
            currentWorkspaceId: input.workspaceId,
            currentEngine: engine,
            currentThreadId: input.threadId,
            currentTurnId: input.lifecycle.activeTurnId,
            currentRuntimeLeaseId: null,
          },
          terminal: {
            kind: input.terminalKind,
            sourceMethod: input.sourceMethod,
            receivedAtMs: input.terminalKind ? now : null,
          },
          state: {
            isProcessing: input.lifecycle.isProcessing,
            activeTurnId: input.lifecycle.activeTurnId,
            aliasTurnId: null,
            blockers: [],
          },
          progress: {
            lastSource: input.diagnostic?.lastProgressSource ?? null,
            lastAtMs: input.diagnostic?.lastProgressAt ?? null,
            ageMs: lastProgressAgeMs,
            sequence: input.diagnostic?.progressSequence ?? 0,
            fresh:
              lastProgressAgeMs !== null &&
              lastProgressAgeMs < progressFreshWindowMs,
          },
        },
        {
          ...DEFAULT_TURN_SETTLEMENT_POLICY,
          progressFreshWindowMs,
        },
        now,
      );
      emitTurnDiagnostic("three-evidence-dry-run", {
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        turnId: input.turnId,
        diagnosticCategory: "three-evidence-settlement-dry-run",
        dryRunDecision: toDryRunSettlementDecisionLabel(decision.action),
        decisionAction: decision.action,
        decisionReason: decision.reason,
        scopeMatch: decision.scopeMatch,
        acceptedEvidence: decision.acceptedEvidence,
        boundedReason: decision.diagnostics.boundedReason,
        missingScope: decision.diagnostics.missingScope ?? [],
        staleEvidence: Boolean(decision.diagnostics.staleEvidence),
        residue: Boolean(decision.diagnostics.residue),
        handled: input.handled,
        fallbackApplied: input.fallbackApplied,
        isProcessing: input.lifecycle.isProcessing,
        activeTurnId: input.lifecycle.activeTurnId,
        lastProgressSource: input.diagnostic?.lastProgressSource ?? null,
        lastProgressAgeMs,
        progressSequence: input.diagnostic?.progressSequence ?? null,
        activeThreadId,
        ...buildThreadStreamCorrelationDimensions(input.threadId),
      }, { force: decision.action !== "settle" });
      if (decision.action !== "request-reconciliation") {
        emitTurnDiagnostic("three-evidence-reconciliation-query-skipped", {
          workspaceId: input.workspaceId,
          threadId: input.threadId,
          turnId: input.turnId || null,
          engine,
          diagnosticCategory: "three-evidence-reconciliation",
          skipReason: "decision-not-reconciliation",
          decisionAction: decision.action,
          decisionReason: decision.reason,
          scopeMatch: decision.scopeMatch,
          acceptedEvidence: decision.acceptedEvidence,
          boundedReason: decision.diagnostics.boundedReason,
          missingScope: decision.diagnostics.missingScope ?? [],
          staleEvidence: Boolean(decision.diagnostics.staleEvidence),
          residue: Boolean(decision.diagnostics.residue),
          handled: input.handled,
          fallbackApplied: input.fallbackApplied,
          isProcessing: input.lifecycle.isProcessing,
          activeTurnId: input.lifecycle.activeTurnId,
          lastProgressSource: input.diagnostic?.lastProgressSource ?? null,
          lastProgressAgeMs,
          progressSequence: input.diagnostic?.progressSequence ?? null,
          activeThreadId,
        }, { force: decision.action !== "settle" });
        if (decision.action === "cleanup-residue") {
          settleForegroundTurnResidue({
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            turnId: input.turnId || null,
            engine,
            lifecycle: input.lifecycle,
            source: "three-evidence-query-skipped",
            decisionAction: decision.action,
            decisionReason: decision.reason,
            scopeMatch: decision.scopeMatch,
            acceptedEvidence: decision.acceptedEvidence,
            boundedReason: decision.diagnostics.boundedReason,
            lastProgressAgeMs,
          });
        }
        return;
      }

      const request = {
        workspaceId: input.workspaceId,
        engine,
        threadId: input.threadId,
        turnId: input.turnId || null,
        runtimeSessionId: null,
        runtimeLeaseId: null,
        requestSource: "three-evidence-reconciliation" as const,
        requestedAtMs: now,
      };
      const queryKey = buildReconciliationQueryKey(request);
      if (reconciliationQueryInFlightRef.current.has(queryKey)) {
        emitTurnDiagnostic("three-evidence-reconciliation-query-skipped", {
          workspaceId: input.workspaceId,
          threadId: input.threadId,
          turnId: input.turnId || null,
          engine,
          diagnosticCategory: "three-evidence-reconciliation",
          skipReason: "query-already-in-flight",
          requestSource: request.requestSource,
          decisionAction: decision.action,
          decisionReason: decision.reason,
          boundedReason: decision.diagnostics.boundedReason,
          queryKeyHash: queryKey.length,
          isProcessing: input.lifecycle.isProcessing,
          activeTurnId: input.lifecycle.activeTurnId,
          lastProgressAgeMs,
          activeThreadId,
        }, { force: true });
        return;
      }
      reconciliationQueryInFlightRef.current.add(queryKey);
      emitTurnDiagnostic("three-evidence-reconciliation-query-requested", {
        workspaceId: input.workspaceId,
        threadId: input.threadId,
        turnId: input.turnId || null,
        engine,
        diagnosticCategory: "three-evidence-reconciliation",
        requestSource: request.requestSource,
        lastProgressAgeMs,
        decisionAction: decision.action,
        decisionReason: decision.reason,
        boundedReason: decision.diagnostics.boundedReason,
        queryKeyHash: queryKey.length,
        activeThreadId,
      }, { force: true });

      void queryTurnReconciliationStatusWithTimeout(request)
        .then((response) => {
          const latestLifecycle = getThreadLifecycleSnapshot(input.threadId);
          const latestDiagnostic = turnDiagnosticsRef.current.get(input.threadId);
          const responseNow = Date.now();
          const responseLastProgressAgeMs = latestDiagnostic
            ? Math.max(0, responseNow - latestDiagnostic.lastProgressAt)
            : lastProgressAgeMs;
          const responseTerminalKind = terminalKindFromReconciliationStatus(response.status);
          const responseDecision = evaluateTurnSettlement(
            {
              workspaceId: response.workspaceId,
              engine: response.engine,
              threadId: response.threadId,
              turnId: response.turnId,
              runtimeSessionId: response.runtimeSessionId,
              runtimeLeaseId: response.runtimeLeaseId,
              source: "status-query",
              scope: {
                foreground: true,
                currentWorkspaceId: input.workspaceId,
                currentEngine: engine,
                currentThreadId: input.threadId,
                currentTurnId: latestLifecycle.activeTurnId,
                currentRuntimeLeaseId: null,
              },
              terminal: {
                kind: responseTerminalKind,
                sourceMethod: "three-evidence-reconciliation-status-query",
                receivedAtMs: responseTerminalKind ? responseNow : null,
              },
              state: {
                isProcessing: latestLifecycle.isProcessing,
                activeTurnId: latestLifecycle.activeTurnId,
                aliasTurnId: null,
                blockers: [],
              },
              progress: {
                lastSource:
                  latestDiagnostic?.lastProgressSource ??
                  input.diagnostic?.lastProgressSource ??
                  null,
                lastAtMs:
                  latestDiagnostic?.lastProgressAt ??
                  input.diagnostic?.lastProgressAt ??
                  null,
                ageMs: responseLastProgressAgeMs,
                sequence:
                  latestDiagnostic?.progressSequence ??
                  input.diagnostic?.progressSequence ??
                  0,
                fresh:
                  responseLastProgressAgeMs !== null &&
                  responseLastProgressAgeMs < progressFreshWindowMs,
              },
              reconciliation: {
                attempted: true,
                status: response.status,
                replayRequested: false,
              },
            },
            {
              ...DEFAULT_TURN_SETTLEMENT_POLICY,
              progressFreshWindowMs,
              allowRuntimeEndedDegradedSettlement: true,
            },
            responseNow,
          );
          const label = responseDecision.scopeMatch.matched
            ? "three-evidence-reconciliation-query-resolved"
            : "three-evidence-reconciliation-query-rejected";
          emitTurnDiagnostic(label, {
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            turnId: input.turnId || null,
            engine,
            diagnosticCategory: "three-evidence-reconciliation",
            status: response.status,
            statusSource: response.statusSource,
            observedAtMs: response.observedAtMs,
            responseWorkspaceId: response.workspaceId,
            responseThreadId: response.threadId,
            responseTurnId: response.turnId,
            decisionAction: responseDecision.action,
            decisionReason: responseDecision.reason,
            scopeMatch: responseDecision.scopeMatch,
            acceptedEvidence: responseDecision.acceptedEvidence,
            boundedReason: response.boundedReason,
            helperBoundedReason: responseDecision.diagnostics.boundedReason,
            lastProgressAgeMs: responseLastProgressAgeMs,
            isProcessing: latestLifecycle.isProcessing,
            activeTurnId: latestLifecycle.activeTurnId,
            activeThreadId,
          }, { force: true });
          if (responseDecision.action !== "cleanup-residue") {
            emitTurnDiagnostic("three-evidence-reconciliation-cleanup-skipped", {
              workspaceId: input.workspaceId,
              threadId: input.threadId,
              turnId: input.turnId || null,
              engine,
              diagnosticCategory: "three-evidence-reconciliation",
              skipReason: responseDecision.scopeMatch.matched
                ? "decision-not-cleanup-residue"
                : "scope-mismatch",
              status: response.status,
              statusSource: response.statusSource,
              decisionAction: responseDecision.action,
              decisionReason: responseDecision.reason,
              scopeMatch: responseDecision.scopeMatch,
              acceptedEvidence: responseDecision.acceptedEvidence,
              boundedReason: response.boundedReason,
              helperBoundedReason: responseDecision.diagnostics.boundedReason,
              lastProgressAgeMs: responseLastProgressAgeMs,
              isProcessing: latestLifecycle.isProcessing,
              activeTurnId: latestLifecycle.activeTurnId,
              activeThreadId,
            }, { force: true });
            return;
          }
          settleForegroundTurnResidue({
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            turnId: input.turnId || null,
            engine,
            lifecycle: latestLifecycle,
            source: "three-evidence-query-resolved",
            decisionAction: responseDecision.action,
            decisionReason: responseDecision.reason,
            scopeMatch: responseDecision.scopeMatch,
            acceptedEvidence: responseDecision.acceptedEvidence,
            boundedReason: responseDecision.diagnostics.boundedReason,
            status: response.status,
            statusSource: response.statusSource,
            lastProgressAgeMs: responseLastProgressAgeMs,
          });
        })
        .catch((error: unknown) => {
          const latestLifecycle = getThreadLifecycleSnapshot(input.threadId);
          emitTurnDiagnostic("three-evidence-reconciliation-query-failed", {
            workspaceId: input.workspaceId,
            threadId: input.threadId,
            turnId: input.turnId || null,
            engine,
            diagnosticCategory: "three-evidence-reconciliation",
            status: "query-failed",
            boundedReason:
              error instanceof Error
                ? error.message
                : "status query failed with unknown error",
            lastProgressAgeMs,
            isProcessing: latestLifecycle.isProcessing,
            activeTurnId: latestLifecycle.activeTurnId,
            activeThreadId,
          }, { force: true });
        })
        .finally(() => {
          reconciliationQueryInFlightRef.current.delete(queryKey);
        });
    },
    [
      activeThreadId,
      buildReconciliationQueryKey,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      reconciliationQueryInFlightRef,
      settleForegroundTurnResidue,
      terminalKindFromReconciliationStatus,
      turnDiagnosticsRef,
    ],
  );

  return {
    emitForegroundSettlementDiagnostic,
    buildReconciliationQueryKey,
    terminalKindFromReconciliationStatus,
    settleForegroundTurnResidue,
    emitThreeEvidenceDryRunDiagnostic,
  };
}
