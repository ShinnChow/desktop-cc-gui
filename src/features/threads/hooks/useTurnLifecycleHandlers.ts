import { useCallback } from "react";
import type { Dispatch, MutableRefObject } from "react";
import {
  workspaceScopedDelete,
  type WorkspaceScopedMap,
} from "./workspaceScopedMap";
import { parseFirstPacketTimeoutSeconds } from "../utils/networkErrors";
import {
  buildThreadStreamCorrelationDimensions,
  completeThreadStreamTurn,
  noteThreadTurnStarted,
  reportThreadUpstreamPending,
} from "../utils/streamLatencyDiagnostics";
import { buildCodexLivenessDiagnostic } from "../utils/codexConversationLiveness";
import {
  domainEventFactories,
  type DomainEventRuntimeController,
} from "../domain-events";
import {
  clearLiveAssistantText,
  peekLiveAssistantText,
} from "../utils/liveAssistantTextChannel";
import type { ConversationEngine } from "../contracts/conversationCurtainContracts";
import type { TurnExecutionSnapshot } from "../../shared-session/target/types";
import type { ThreadAction } from "./useThreadsReducer";
import {
  createTurnDiagnosticState,
  inferThreadEngine,
} from "./threadEventDiagnostics";
import type { TurnDiagnosticsRuntime } from "./useTurnDiagnosticsRuntime";

type UseTurnLifecycleHandlersOptions = {
  dispatch: Dispatch<ThreadAction>;
  diagnostics: TurnDiagnosticsRuntime;
  flushPendingRealtimeEvents: () => void;
  drainLiveItemDeltasForThread: (threadId: string) => void;
  markRealtimeTurnTerminal: (threadId: string, turnId: string) => void;
  noteRealtimeTurnStarted: (threadId: string, turnId: string) => void;
  onTurnStarted: (workspaceId: string, threadId: string, turnId: string) => void;
  onTurnCompleted: (workspaceId: string, threadId: string, turnId: string) => boolean;
  onTurnError: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: {
      message: string;
      willRetry: boolean;
      suppressMessage?: boolean;
      executionTargetSnapshot?: TurnExecutionSnapshot;
    },
  ) => void;
  onTurnStalled: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: {
      message: string;
      reasonCode: string;
      stage: string;
      source: string;
      startedAtMs: number | null;
      timeoutMs: number | null;
    },
  ) => void;
  pendingInterruptsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>;
  onTurnCompletedExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId: string;
  }) => void;
  onTurnTerminalExternal?: (payload: {
    workspaceId: string;
    threadId: string;
    turnId: string;
    rawTurnId?: string | null;
    status: "completed" | "error" | "stalled";
  }) => void;
  domainEventController?: DomainEventRuntimeController | null;
};

// Wave 2 链 A2：turn 生命周期 handler（started/completed/error/stalled 与
// settle/finalize/domain-event）。timer refs 与诊断回调全部由
// useTurnDiagnosticsRuntime 聚合注入，本 hook 不新建任何共享 ref。
export function useTurnLifecycleHandlers({
  dispatch,
  diagnostics,
  flushPendingRealtimeEvents,
  drainLiveItemDeltasForThread,
  markRealtimeTurnTerminal,
  noteRealtimeTurnStarted,
  onTurnStarted,
  onTurnCompleted,
  onTurnError,
  onTurnStalled,
  pendingInterruptsRef,
  interruptedThreadsRef,
  onTurnCompletedExternal,
  onTurnTerminalExternal,
  domainEventController,
}: UseTurnLifecycleHandlersOptions) {
  const {
    turnDiagnosticsRef,
    getThreadLifecycleSnapshot,
    emitTurnDiagnostic,
    emitForegroundSettlementDiagnostic,
    emitThreeEvidenceDryRunDiagnostic,
    quarantineCodexTurn,
    findQuarantinedCodexTurn,
    clearFirstDeltaTimer,
    clearTurnStallTimer,
    clearCodexNoProgressTimer,
    clearAssistantSnapshotIngressForThread,
    scheduleFirstDeltaTimer,
    scheduleCodexNoProgressTimer,
    markProcessingTracked,
    setActiveTurnIdTracked,
    resolveTerminalSettlementTurnId,
  } = diagnostics;
  const emitTurnDomainEvent = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      status: "completed" | "failed",
      payload?: { durationMs?: number | null; errorMessage?: string },
    ) => {
      if (!domainEventController || !turnId.trim()) {
        return;
      }
      const common = {
        occurredAt: new Date().toISOString(),
        workspaceId,
        sessionId: threadId,
        logicalSessionId: threadId,
        runId: turnId,
        engine: inferThreadEngine(threadId),
        engineId: inferThreadEngine(threadId),
        provenance: {
          source: "frontend-compatibility-sink",
          rawEventType: status === "completed" ? "turn/completed" : "turn/error",
        },
        turnId,
      };
      domainEventController.emitInternal(
        status === "completed"
          ? domainEventFactories.turnCompleted({
              ...common,
              durationMs: payload?.durationMs ?? null,
            })
          : domainEventFactories.turnFailed({
              ...common,
              errorMessage: payload?.errorMessage ?? "turn failed",
            }),
      );
      domainEventController.emitInternal(
        domainEventFactories.runSettled({
          ...common,
          status,
          evidence: payload ?? {},
        }),
      );
    },
    [domainEventController],
  );

  const onTurnStartedTracked = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      const normalizedTurnId = turnId.trim();
      if (inferThreadEngine(threadId) === "codex" && normalizedTurnId) {
        const quarantinedTurn = findQuarantinedCodexTurn(threadId, normalizedTurnId);
        if (quarantinedTurn) {
          emitTurnDiagnostic("quarantined-codex-event-skipped", {
            ...buildCodexLivenessDiagnostic({
              workspaceId,
              threadId,
              stage: "abandoned",
              outcome: "abandoned",
              source: "turn/started",
              reason: "turn/started belongs to a quarantined Codex turn",
              turnId: normalizedTurnId,
            }),
            eventTurnId: normalizedTurnId,
            quarantinedAtMs: quarantinedTurn.settledAt,
            quarantineReason: quarantinedTurn.reason,
            quarantineSource: quarantinedTurn.source,
            operation: "turnStarted",
            sourceMethod: "turn/started",
            diagnosticCategory: "quarantined-codex-event",
          }, { force: true });
          return;
        }
      }
      const startedAt = Date.now();
      noteRealtimeTurnStarted(threadId, turnId);
      clearAssistantSnapshotIngressForThread(threadId);
      noteThreadTurnStarted({
        workspaceId,
        threadId,
        turnId,
        startedAt,
      });
      clearTurnStallTimer(threadId);
      clearFirstDeltaTimer(threadId);
      turnDiagnosticsRef.current.set(
        threadId,
        createTurnDiagnosticState(workspaceId, threadId, turnId, startedAt),
      );
      dispatch({ type: "clearCodexSilentSuspected", threadId });
      scheduleFirstDeltaTimer(workspaceId, threadId);
      scheduleCodexNoProgressTimer(workspaceId, threadId);
      onTurnStarted(workspaceId, threadId, turnId);
      dispatch({ type: "markContinuationEvidence", threadId, at: Date.now(), force: true });
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      emitTurnDiagnostic("started", {
        workspaceId,
        threadId,
        turnId,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        ...buildThreadStreamCorrelationDimensions(threadId),
      });
    },
    [
      clearFirstDeltaTimer,
      clearTurnStallTimer,
      dispatch,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
      onTurnStarted,
      noteRealtimeTurnStarted,
      scheduleCodexNoProgressTimer,
      scheduleFirstDeltaTimer,
      clearAssistantSnapshotIngressForThread,
      findQuarantinedCodexTurn,
    ],
  );

  const onSharedRuntimeTurnStarted = useCallback(
    (threadId: string, runtimeTurnId: string) => {
      noteRealtimeTurnStarted(threadId, runtimeTurnId);
    },
    [noteRealtimeTurnStarted],
  );

  const finalizeTurnDiagnostic = useCallback(
    (
      threadId: string,
      finalState: "completed" | "error",
      payload?: Record<string, unknown>,
    ) => {
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      clearFirstDeltaTimer(threadId);
      clearTurnStallTimer(threadId);
      clearCodexNoProgressTimer(threadId);
      if (!diagnostic) {
        return;
      }
      const now = Date.now();
      if (finalState === "completed") {
        diagnostic.completedAt = now;
      } else {
        diagnostic.errorAt = now;
      }
      const rawMessage =
        typeof payload?.message === "string" ? payload.message : null;
      const firstPacketTimeoutSeconds =
        rawMessage ? parseFirstPacketTimeoutSeconds(rawMessage) : null;
      if (diagnostic.firstDeltaAt === null && finalState === "error") {
        reportThreadUpstreamPending(threadId, {
          elapsedMs: Math.max(0, now - diagnostic.startedAt),
          diagnosticCategory:
            firstPacketTimeoutSeconds !== null
              ? "first-packet-timeout"
              : "first-token-delay",
          reason: firstPacketTimeoutSeconds !== null ? "first-packet-timeout" : "turn-error",
          firstPacketTimeoutSeconds,
          message: rawMessage,
        });
      }
      const lifecycle = getThreadLifecycleSnapshot(threadId);
      const suspectedDurationMs =
        diagnostic.noProgressSuspectedAt === null
          ? null
          : Math.max(0, now - diagnostic.noProgressSuspectedAt);
      emitTurnDiagnostic(finalState, {
        workspaceId: diagnostic.workspaceId,
        threadId,
        turnId: diagnostic.turnId,
        elapsedMs: Math.max(0, now - diagnostic.startedAt),
        firstDeltaAtMs:
          diagnostic.firstDeltaAt === null
            ? null
            : Math.max(0, diagnostic.firstDeltaAt - diagnostic.startedAt),
        firstItemAtMs:
          diagnostic.firstItemEventAt === null
            ? null
            : Math.max(0, diagnostic.firstItemEventAt - diagnostic.startedAt),
        firstItemEventKind: diagnostic.firstItemEventKind,
        firstItemType: diagnostic.firstItemType,
        firstExecutionAtMs:
          diagnostic.firstExecutionAt === null
            ? null
            : Math.max(0, diagnostic.firstExecutionAt - diagnostic.startedAt),
        firstExecutionEventKind: diagnostic.firstExecutionEventKind,
        firstExecutionItemType: diagnostic.firstExecutionItemType,
        firstExecutionItemId: diagnostic.firstExecutionItemId,
        deltaCount: diagnostic.deltaCount,
        itemEventCount: diagnostic.itemEventCount,
        stalledAfterFirstDelta: diagnostic.stallReported,
        lastProgressSource: diagnostic.lastProgressSource,
        lastProgressAgeMs: Math.max(0, now - diagnostic.lastProgressAt),
        progressSequence: diagnostic.progressSequence,
        wasNoProgressSuspected: diagnostic.noProgressSuspectedAt !== null,
        noProgressSuspectedSource: diagnostic.noProgressSuspectedSource,
        suspectedDurationMs,
        isProcessing: lifecycle.isProcessing,
        activeTurnId: lifecycle.activeTurnId,
        firstPacketTimeoutSeconds,
        ...buildThreadStreamCorrelationDimensions(threadId),
        ...payload,
      }, { force: finalState === "error" || diagnostic.stallReported });
      turnDiagnosticsRef.current.delete(threadId);
      clearAssistantSnapshotIngressForThread(threadId);
      completeThreadStreamTurn(threadId);
    },
    [
      clearAssistantSnapshotIngressForThread,
      clearFirstDeltaTimer,
      clearTurnStallTimer,
      clearCodexNoProgressTimer,
      emitTurnDiagnostic,
      getThreadLifecycleSnapshot,
    ],
  );

  const settleCompletedTurn = useCallback(
    (
      workspaceId: string,
      threadId: string,
      normalizedTurnId: string,
      rawTurnId: string | null = normalizedTurnId,
    ) => {
      // fix-turn-terminal-live-text-commit-loss：所有 terminal 结算路径统一在
      // barrier 前 drain 全部 pending 正文事件（含 contract batcher 积压 delta），
      // 防止 barrier 后的 cadence flush 把末段正文当迟到事件丢弃。
      flushPendingRealtimeEvents();
      // A4 二期：建立 terminal barrier 前把 reasoning/toolOutput 通道尾段
      // 灌回 durable items——结算不越过正文（与正文 drain 同一道 causal barrier）。
      drainLiveItemDeltasForThread(threadId);
      markRealtimeTurnTerminal(threadId, normalizedTurnId);
      quarantineCodexTurn(
        workspaceId,
        threadId,
        normalizedTurnId,
        "turn-completed",
        "turn/completed",
      );
      const handled = onTurnCompleted(workspaceId, threadId, normalizedTurnId);
      let fallbackApplied = false;
      if (handled) {
        onTurnCompletedExternal?.({ workspaceId, threadId, turnId: normalizedTurnId });
        onTurnTerminalExternal?.({
          workspaceId,
          threadId,
          turnId: normalizedTurnId,
          rawTurnId,
          status: "completed",
        });
      }
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (!handled && diagnostic && diagnostic.assistantCompletedAt !== null) {
        const lifecycle = getThreadLifecycleSnapshot(threadId);
        const canFallbackSettle =
          !normalizedTurnId ||
          lifecycle.activeTurnId === null ||
          lifecycle.activeTurnId === normalizedTurnId;
        if (canFallbackSettle) {
          // 与 onTurnCompleted 主路径一致：fallback settle 也必须先把 live 全文
          // 写入 durable state，否则 markProcessing(false) 后 UI 只剩建壳首段。
          {
            const liveEntry = peekLiveAssistantText(threadId);
            if (liveEntry?.text) {
              dispatch({
                type: "completeAgentMessage",
                workspaceId,
                threadId,
                itemId: liveEntry.itemId,
                text: liveEntry.text,
                hasCustomName: true,
                timestamp: Date.now(),
              });
              clearLiveAssistantText(threadId);
            }
          }
          dispatch({
            type: "clearProcessingGeneratedImages",
            threadId,
          });
          dispatch({ type: "markTerminalSettlement", threadId });
          dispatch({
            type: "finalizePendingToolStatuses",
            threadId,
            status: "completed",
          });
          dispatch({
            type: "markContextCompacting",
            threadId,
            isCompacting: false,
            timestamp: Date.now(),
          });
          dispatch({
            type: "settleThreadPlanInProgress",
            threadId,
            targetStatus: "completed",
          });
          markProcessingTracked(threadId, false);
          setActiveTurnIdTracked(threadId, null);
          workspaceScopedDelete(pendingInterruptsRef.current, workspaceId, threadId);
          workspaceScopedDelete(interruptedThreadsRef.current, workspaceId, threadId);
          dispatch({ type: "resetAgentSegment", threadId });
          dispatch({ type: "markLatestAssistantMessageFinal", threadId });
          onTurnCompletedExternal?.({
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
          });
          onTurnTerminalExternal?.({
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
            rawTurnId,
            status: "completed",
          });
          fallbackApplied = true;
          emitTurnDiagnostic("terminal-settlement-fallback-applied", {
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
            elapsedMs: Math.max(0, Date.now() - diagnostic.startedAt),
            assistantCompletedAtMs:
              diagnostic.assistantCompletedAt === null
                ? null
                : Math.max(0, diagnostic.assistantCompletedAt - diagnostic.startedAt),
            assistantCompletedItemId: diagnostic.assistantCompletedItemId,
            isProcessing: lifecycle.isProcessing,
            activeTurnId: lifecycle.activeTurnId,
            diagnosticCategory: "frontend-terminal-settlement",
            reason: "turn-completed-settlement-fallback-applied",
            ...buildThreadStreamCorrelationDimensions(threadId),
          }, { force: true });
        } else {
          emitTurnDiagnostic("terminal-settlement-rejected", {
            workspaceId,
            threadId,
            turnId: normalizedTurnId,
            elapsedMs: Math.max(0, Date.now() - diagnostic.startedAt),
            assistantCompletedAtMs:
              diagnostic.assistantCompletedAt === null
                ? null
                : Math.max(0, diagnostic.assistantCompletedAt - diagnostic.startedAt),
            assistantCompletedItemId: diagnostic.assistantCompletedItemId,
            isProcessing: lifecycle.isProcessing,
            activeTurnId: lifecycle.activeTurnId,
            diagnosticCategory: "frontend-terminal-settlement",
            reason: "turn-completed-settlement-rejected",
            ...buildThreadStreamCorrelationDimensions(threadId),
          }, { force: true });
        }
      }
      const postSettlementLifecycle = getThreadLifecycleSnapshot(threadId);
      emitThreeEvidenceDryRunDiagnostic({
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        terminalKind: "completed",
        sourceMethod: "turn/completed",
        lifecycle: postSettlementLifecycle,
        diagnostic: diagnostic ?? undefined,
        handled,
        fallbackApplied,
      });
      if (
        postSettlementLifecycle.isProcessing ||
        (
          normalizedTurnId &&
          postSettlementLifecycle.activeTurnId === normalizedTurnId
        )
      ) {
        const now = Date.now();
        emitForegroundSettlementDiagnostic("terminal-settlement-busy-residue", {
          workspaceId,
          threadId,
          turnId: normalizedTurnId,
          handled,
          fallbackApplied,
          isProcessing: postSettlementLifecycle.isProcessing,
          activeTurnId: postSettlementLifecycle.activeTurnId,
          lastProgressSource: diagnostic?.lastProgressSource ?? null,
          lastProgressAgeMs: diagnostic ? Math.max(0, now - diagnostic.lastProgressAt) : null,
          progressSequence: diagnostic?.progressSequence ?? null,
          wasNoProgressSuspected: Boolean(
            diagnostic && diagnostic.noProgressSuspectedAt !== null,
          ),
          reason: "terminal-event-handled-but-foreground-state-remains-busy",
          ...buildThreadStreamCorrelationDimensions(threadId),
        });
      }
      if (diagnostic && diagnostic.turnId !== normalizedTurnId) {
        return handled || fallbackApplied;
      }
      emitTurnDomainEvent(
        workspaceId,
        threadId,
        normalizedTurnId,
        "completed",
        {
          durationMs: diagnostic ? Math.max(0, Date.now() - diagnostic.startedAt) : null,
        },
      );
      finalizeTurnDiagnostic(threadId, "completed");
      return handled || fallbackApplied;
    },
    [
      dispatch,
      drainLiveItemDeltasForThread,
      emitThreeEvidenceDryRunDiagnostic,
      emitTurnDiagnostic,
      emitForegroundSettlementDiagnostic,
      emitTurnDomainEvent,
      finalizeTurnDiagnostic,
      flushPendingRealtimeEvents,
      getThreadLifecycleSnapshot,
      interruptedThreadsRef,
      markRealtimeTurnTerminal,
      markProcessingTracked,
      onTurnCompleted,
      onTurnCompletedExternal,
      onTurnTerminalExternal,
      pendingInterruptsRef,
      quarantineCodexTurn,
      setActiveTurnIdTracked,
    ],
  );

  const onTurnErrorTracked = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: {
        message: string;
        willRetry: boolean;
        suppressMessage?: boolean;
        engine?: ConversationEngine | null;
        executionTargetSnapshot?: TurnExecutionSnapshot;
      },
    ) => {
      const normalizedTurnId = resolveTerminalSettlementTurnId(threadId, turnId);
      flushPendingRealtimeEvents();
      // A4 二期：barrier 建立前把 reasoning/toolOutput 通道尾段灌回 durable
      // items——结算不越过正文（与正文 drain 同一道 terminal causal barrier）。
      drainLiveItemDeltasForThread(threadId);
      markRealtimeTurnTerminal(threadId, normalizedTurnId);
      onTurnError(workspaceId, threadId, normalizedTurnId, payload);
      if (payload.willRetry) {
        return;
      }
      quarantineCodexTurn(
        workspaceId,
        threadId,
        normalizedTurnId,
        "turn-error",
        "turn/error",
        payload.engine,
      );
      onTurnTerminalExternal?.({
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        rawTurnId: turnId,
        status: "error",
      });
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (diagnostic && diagnostic.turnId !== normalizedTurnId) {
        return;
      }
      emitTurnDomainEvent(workspaceId, threadId, normalizedTurnId, "failed", {
        errorMessage: payload.message,
      });
      finalizeTurnDiagnostic(threadId, "error", {
        message: payload.message,
        willRetry: payload.willRetry,
      });
    },
    [
      drainLiveItemDeltasForThread,
      finalizeTurnDiagnostic,
      emitTurnDomainEvent,
      flushPendingRealtimeEvents,
      markRealtimeTurnTerminal,
      onTurnError,
      onTurnTerminalExternal,
      quarantineCodexTurn,
      resolveTerminalSettlementTurnId,
    ],
  );

  const onTurnStalledTracked = useCallback(
    (
      workspaceId: string,
      threadId: string,
      turnId: string,
      payload: {
        message: string;
        reasonCode: string;
        stage: string;
        source: string;
        startedAtMs: number | null;
        timeoutMs: number | null;
        engine?: ConversationEngine | null;
      },
    ) => {
      const normalizedTurnId = resolveTerminalSettlementTurnId(threadId, turnId);
      flushPendingRealtimeEvents();
      // A4 二期：barrier 建立前把 reasoning/toolOutput 通道尾段灌回 durable
      // items——结算不越过正文（与正文 drain 同一道 terminal causal barrier）。
      drainLiveItemDeltasForThread(threadId);
      markRealtimeTurnTerminal(threadId, normalizedTurnId);
      onTurnStalled(workspaceId, threadId, normalizedTurnId, payload);
      quarantineCodexTurn(
        workspaceId,
        threadId,
        normalizedTurnId,
        payload.reasonCode || "turn-stalled",
        payload.source || "turn/stalled",
        payload.engine,
      );
      onTurnTerminalExternal?.({
        workspaceId,
        threadId,
        turnId: normalizedTurnId,
        rawTurnId: turnId,
        status: "stalled",
      });
      const diagnostic = turnDiagnosticsRef.current.get(threadId);
      if (diagnostic && diagnostic.turnId !== normalizedTurnId) {
        return;
      }
      emitTurnDomainEvent(workspaceId, threadId, normalizedTurnId, "failed", {
        errorMessage: payload.message,
      });
      finalizeTurnDiagnostic(threadId, "error", {
        message: payload.message,
        diagnosticCategory: "resume_stalled",
        reasonCode: payload.reasonCode,
        stage: payload.stage,
        source: payload.source,
        startedAtMs: payload.startedAtMs,
        timeoutMs: payload.timeoutMs,
      });
    },
    [
      drainLiveItemDeltasForThread,
      finalizeTurnDiagnostic,
      emitTurnDomainEvent,
      flushPendingRealtimeEvents,
      markRealtimeTurnTerminal,
      onTurnStalled,
      onTurnTerminalExternal,
      quarantineCodexTurn,
      resolveTerminalSettlementTurnId,
    ],
  );
  return {
    onTurnStartedTracked,
    onSharedRuntimeTurnStarted,
    onTurnErrorTracked,
    onTurnStalledTracked,
    settleCompletedTurn,
  };
}

export type TurnLifecycleHandlers = ReturnType<typeof useTurnLifecycleHandlers>;
