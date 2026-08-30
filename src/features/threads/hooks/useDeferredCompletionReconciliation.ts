import { useCallback } from "react";
import { queryTurnReconciliationStatusWithTimeout } from "./threadReconciliationStatusQuery";
import { buildThreadStreamCorrelationDimensions } from "../utils/streamLatencyDiagnostics";
import {
  inferThreadEngine,
  listDeferredCompletionBlockers,
  type DeferredCompletionFlushSource,
} from "./threadEventDiagnostics";
import type { TurnDiagnosticsRuntime } from "./useTurnDiagnosticsRuntime";
import type { TurnLifecycleHandlers } from "./useTurnLifecycleHandlers";

type UseDeferredCompletionReconciliationOptions = {
  activeThreadId: string | null;
  diagnostics: TurnDiagnosticsRuntime;
  settleCompletedTurn: TurnLifecycleHandlers["settleCompletedTurn"];
};

// Wave 2 链 A2：Codex 协作子代理仍在跑时 turn/completed 的 defer/flush/
// scoped-reconciliation 状态机（含入口 onTurnCompletedTracked）。
// flushDeferredTurnCompletionRef 由 diagnostics 工厂注入，render 期赋值语义
// 与拆分前逐字一致。
export function useDeferredCompletionReconciliation({
  activeThreadId,
  diagnostics,
  settleCompletedTurn,
}: UseDeferredCompletionReconciliationOptions) {
  const {
    turnDiagnosticsRef,
    reconciliationQueryInFlightRef,
    flushDeferredTurnCompletionRef,
    getThreadLifecycleSnapshot,
    emitTurnDiagnostic,
    buildReconciliationQueryKey,
    terminalKindFromReconciliationStatus,
    resolveTerminalSettlementTurnId,
  } = diagnostics;
  const requestDeferredCompletionReconciliation = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const engine = inferThreadEngine(threadId);
      if (engine !== "codex" || !turnId) {
        return;
      }
      const request = {
        workspaceId,
        engine,
        threadId,
        turnId,
        runtimeSessionId: null,
        runtimeLeaseId: null,
        requestSource: "three-evidence-reconciliation" as const,
        requestedAtMs: Date.now(),
      };
      const queryKey = buildReconciliationQueryKey(request);
      if (reconciliationQueryInFlightRef.current.has(queryKey)) {
        emitTurnDiagnostic("deferred-completion-reconciliation-query-skipped", {
          workspaceId,
          threadId,
          turnId,
          engine,
          diagnosticCategory: "deferred-completion-reconciliation",
          skipReason: "query-already-in-flight",
          requestSource: request.requestSource,
          queryKeyHash: queryKey.length,
          activeThreadId,
        }, { force: true });
        return;
      }

      reconciliationQueryInFlightRef.current.add(queryKey);
      emitTurnDiagnostic("deferred-completion-reconciliation-query-requested", {
        workspaceId,
        threadId,
        turnId,
        engine,
        diagnosticCategory: "deferred-completion-reconciliation",
        requestSource: request.requestSource,
        queryKeyHash: queryKey.length,
        activeThreadId,
      }, { force: true });

      void queryTurnReconciliationStatusWithTimeout(request)
        .then((response) => {
          const latestDiagnostic = turnDiagnosticsRef.current.get(threadId);
          const latestLifecycle = getThreadLifecycleSnapshot(threadId);
          const completion = latestDiagnostic?.deferredCompletion ?? null;
          const responseTerminalKind = terminalKindFromReconciliationStatus(response.status);
          const responseTurnId = response.turnId ?? null;
          const scopeMatches =
            response.workspaceId === workspaceId &&
            response.engine === engine &&
            response.threadId === threadId &&
            responseTurnId === turnId;
          const stillDeferred =
            latestDiagnostic?.turnId === turnId &&
            completion?.workspaceId === workspaceId &&
            completion.threadId === threadId &&
            completion.turnId === turnId;
          const activeTurnMatches =
            latestLifecycle.activeTurnId === null ||
            latestLifecycle.activeTurnId === turnId;
          const canFlush =
            responseTerminalKind !== null &&
            scopeMatches &&
            stillDeferred &&
            activeTurnMatches;
          const label = scopeMatches
            ? "deferred-completion-reconciliation-query-resolved"
            : "deferred-completion-reconciliation-query-rejected";
          emitTurnDiagnostic(label, {
            workspaceId,
            threadId,
            turnId,
            engine,
            diagnosticCategory: "deferred-completion-reconciliation",
            status: response.status,
            statusSource: response.statusSource,
            observedAtMs: response.observedAtMs,
            responseWorkspaceId: response.workspaceId,
            responseThreadId: response.threadId,
            responseTurnId: response.turnId,
            responseTerminalKind,
            scopeMatches,
            stillDeferred,
            activeTurnMatches,
            isProcessing: latestLifecycle.isProcessing,
            activeTurnId: latestLifecycle.activeTurnId,
            activeThreadId,
          }, { force: true });

          if (!canFlush) {
            emitTurnDiagnostic("deferred-completion-reconciliation-cleanup-skipped", {
              workspaceId,
              threadId,
              turnId,
              engine,
              diagnosticCategory: "deferred-completion-reconciliation",
              status: response.status,
              statusSource: response.statusSource,
              skipReason:
                responseTerminalKind === null
                  ? "status-not-terminal"
                  : !scopeMatches
                    ? "scope-mismatch"
                    : !stillDeferred
                      ? "deferred-completion-missing"
                      : !activeTurnMatches
                        ? "active-turn-mismatch"
                        : "guard-rejected",
              responseWorkspaceId: response.workspaceId,
              responseThreadId: response.threadId,
              responseTurnId: response.turnId,
              isProcessing: latestLifecycle.isProcessing,
              activeTurnId: latestLifecycle.activeTurnId,
              activeThreadId,
            }, { force: true });
            return;
          }

          flushDeferredTurnCompletionRef.current?.(
            threadId,
            "scoped-reconciliation-terminal",
          );
        })
        .catch((error: unknown) => {
          const latestLifecycle = getThreadLifecycleSnapshot(threadId);
          emitTurnDiagnostic("deferred-completion-reconciliation-query-failed", {
            workspaceId,
            threadId,
            turnId,
            engine,
            diagnosticCategory: "deferred-completion-reconciliation",
            status: "query-failed",
            boundedReason:
              error instanceof Error
                ? error.message
                : "status query failed with unknown error",
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
      terminalKindFromReconciliationStatus,
    ],
  );

  const deferCodexTurnCompletionIfBlocked = useCallback(
    (workspaceId: string, threadId: string, normalizedTurnId: string) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (
        inferThreadEngine(threadId) !== "codex" ||
        !diagnostic ||
        !normalizedTurnId ||
        diagnostic.turnId !== normalizedTurnId
      ) {
        return false;
      }
      const blockers = listDeferredCompletionBlockers(diagnostic);
      if (blockers.length === 0) {
        return false;
      }
      const now = Date.now();
      diagnostic.deferredCompletion = diagnostic.deferredCompletion ?? {
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        deferredAt: now,
      };
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      emitTurnDiagnostic("turn-completed-deferred", {
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        blockerCount: blockers.length,
        blockers,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        diagnosticCategory: "codex-collab-terminal-order",
        reason: "turn/completed arrived while Codex collaboration child agents were still active",
        ...buildThreadStreamCorrelationDimensions(threadId),
      }, { force: true });
      requestDeferredCompletionReconciliation(workspaceId, threadId, normalizedTurnId);
      return true;
    },
    [emitTurnDiagnostic, getThreadLifecycleSnapshot, requestDeferredCompletionReconciliation],
  );

  const flushDeferredTurnCompletionIfReady = useCallback(
    (threadId: string, source: DeferredCompletionFlushSource) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      const completion = diagnostic?.deferredCompletion ?? null;
      if (!diagnostic || !completion) {
        return;
      }
      const blockers = listDeferredCompletionBlockers(diagnostic);
      const allowBlockedFlush = source === "scoped-reconciliation-terminal";
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      if (diagnostic.turnId !== completion.turnId) {
        emitTurnDiagnostic("turn-completed-deferred-flush-skipped", {
          workspaceId: completion.workspaceId,
          threadId: completion.threadId,
          turnId: completion.turnId,
          source,
          diagnosticTurnId: diagnostic.turnId,
          diagnosticCategory: "codex-collab-terminal-order",
          skipReason: "diagnostic-turn-mismatch",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
        return;
      }
      if (
        lifecycle.activeTurnId !== null &&
        lifecycle.activeTurnId !== completion.turnId
      ) {
        emitTurnDiagnostic("turn-completed-deferred-flush-skipped", {
          workspaceId: completion.workspaceId,
          threadId: completion.threadId,
          turnId: completion.turnId,
          source,
          activeTurnId: lifecycle.activeTurnId,
          diagnosticCategory: "codex-collab-terminal-order",
          skipReason: "active-turn-mismatch",
          ...buildThreadStreamCorrelationDimensions(threadId),
        }, { force: true });
        return;
      }
      if (blockers.length > 0 && !allowBlockedFlush) {
        return;
      }
      diagnostic.deferredCompletion = null;
      const now = Date.now();
      emitTurnDiagnostic("turn-completed-deferred-flushed", {
        workspaceId: completion.workspaceId,
        threadId: completion.threadId,
        turnId: completion.turnId,
        deferredMs: Math.max(0, now - completion.deferredAt),
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        source,
        forcedByScopedReconciliation: allowBlockedFlush && blockers.length > 0,
        remainingBlockers: allowBlockedFlush ? blockers : [],
        diagnosticCategory: "codex-collab-terminal-order",
        ...buildThreadStreamCorrelationDimensions(threadId),
      }, { force: true });
      settleCompletedTurn(completion.workspaceId, completion.threadId, completion.turnId);
    },
    [emitTurnDiagnostic, getThreadLifecycleSnapshot, settleCompletedTurn],
  );
  flushDeferredTurnCompletionRef.current = flushDeferredTurnCompletionIfReady;

  const onTurnCompletedTracked = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const normalizedTurnId = resolveTerminalSettlementTurnId(threadId, turnId);
      // fix-turn-terminal-live-text-commit-loss：flush 统一收敛进
      // settleCompletedTurn（barrier 前 drain 全部 pending 正文事件）；
      // deferred 路径无 barrier，cadence flush 照常提交，无丢失风险。
      if (deferCodexTurnCompletionIfBlocked(workspaceId, threadId, normalizedTurnId)) {
        return;
      }
      settleCompletedTurn(workspaceId, threadId, normalizedTurnId, turnId);
    },
    [
      deferCodexTurnCompletionIfBlocked,
      resolveTerminalSettlementTurnId,
      settleCompletedTurn,
    ],
  );
  return { onTurnCompletedTracked };
}
