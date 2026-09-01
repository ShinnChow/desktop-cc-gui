export type TurnSettlementEngine = "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";

export type TurnSettlementTerminalKind =
  | "completed"
  | "error"
  | "stalled"
  | "runtime-ended"
  | "user-stop"
  | "status-confirmed-completed"
  | "status-confirmed-error"
  | "replayed-terminal";

export type TurnSettlementAction =
  | "settle"
  | "reject"
  | "defer"
  | "keep-running"
  | "request-reconciliation"
  | "cleanup-residue";

export type TurnSettlementReason =
  | "matched-terminal"
  | "scope-mismatch"
  | "stale-turn"
  | "stale-runtime-lease"
  | "missing-terminal"
  | "progress-protected"
  | "busy-residue"
  | "runtime-ended-degraded"
  | "missing-scope"
  | "needs-authoritative-status"
  | "status-confirmed-running"
  | "status-unknown";

export type TurnSettlementPolicy = {
  progressFreshWindowMs: number;
  allowRuntimeEndedDegradedSettlement: boolean;
  allowBusyResidueCleanup: boolean;
  allowStatusQueryReconciliation: boolean;
};

export type TurnSettlementEvidence = {
  workspaceId: string;
  engine: TurnSettlementEngine;
  threadId: string;
  turnId: string | null;
  runtimeSessionId: string | null;
  runtimeLeaseId: string | null;
  source: "event" | "status-query" | "terminal-replay" | "user-action";
  scope: {
    foreground: boolean;
    currentWorkspaceId: string;
    currentEngine: TurnSettlementEngine;
    currentThreadId: string;
    currentTurnId: string | null;
    currentRuntimeLeaseId: string | null;
  };
  terminal: {
    kind: TurnSettlementTerminalKind | null;
    sourceMethod: string | null;
    receivedAtMs: number | null;
    finalContentPresent?: boolean;
  };
  state: {
    isProcessing: boolean;
    activeTurnId: string | null;
    aliasTurnId: string | null;
    blockers: string[];
  };
  progress: {
    lastSource: string | null;
    lastAtMs: number | null;
    ageMs: number | null;
    sequence: number;
    fresh: boolean;
  };
  reconciliation?: {
    attempted: boolean;
    status:
      | "not-needed"
      | "completed"
      | "running"
      | "failed"
      | "stalled"
      | "runtime-ended"
      | "unknown"
      | "query-failed";
    replayRequested: boolean;
  };
};

export type TurnSettlementDecision = {
  action: TurnSettlementAction;
  reason: TurnSettlementReason;
  scopeMatch: {
    matched: boolean;
    workspace: boolean;
    engine: boolean;
    thread: boolean;
    turn: boolean;
    runtimeLease: boolean | null;
    foregroundOwner: boolean;
  };
  acceptedEvidence: {
    terminal: boolean;
    state: boolean;
    progress: boolean;
    reconciliation: boolean;
  };
  diagnostics: {
    boundedReason: string;
    staleEvidence?: boolean;
    missingScope?: string[];
    residue?: boolean;
    reconciliationAttempted?: boolean;
  };
};

export const DEFAULT_TURN_SETTLEMENT_POLICY: TurnSettlementPolicy = {
  progressFreshWindowMs: 30_000,
  allowRuntimeEndedDegradedSettlement: false,
  allowBusyResidueCleanup: false,
  allowStatusQueryReconciliation: true,
};

const REQUIRED_SCOPE_FIELDS = [
  "workspaceId",
  "engine",
  "threadId",
  "currentWorkspaceId",
  "currentEngine",
  "currentThreadId",
] as const;

export function evaluateTurnSettlement(
  evidence: TurnSettlementEvidence,
  policy: TurnSettlementPolicy,
  nowMs: number,
): TurnSettlementDecision {
  const acceptedEvidence = buildAcceptedEvidence(evidence);
  const missingScope = collectMissingScope(evidence);
  const scopeMatch = buildScopeMatch(evidence, missingScope);

  if (missingScope.length > 0) {
    return buildDecision("reject", "missing-scope", scopeMatch, acceptedEvidence, {
      boundedReason: "settlement evidence is missing required conversation scope",
      missingScope,
    });
  }

  if (!scopeMatch.workspace || !scopeMatch.engine || !scopeMatch.thread || !scopeMatch.foregroundOwner) {
    return buildDecision("reject", "scope-mismatch", scopeMatch, acceptedEvidence, {
      boundedReason: "settlement evidence does not match the active conversation scope",
    });
  }

  if (scopeMatch.runtimeLease === false) {
    return buildDecision("defer", "stale-runtime-lease", scopeMatch, acceptedEvidence, {
      boundedReason: "terminal evidence belongs to a stale runtime lease",
      staleEvidence: true,
    });
  }

  if (!scopeMatch.turn) {
    return buildDecision("defer", "stale-turn", scopeMatch, acceptedEvidence, {
      boundedReason: "terminal evidence does not match the active turn identity",
      staleEvidence: true,
    });
  }

  const terminalKind = evidence.terminal.kind;
  if (terminalKind) {
    if (terminalKind === "runtime-ended" && !policy.allowRuntimeEndedDegradedSettlement) {
      return buildDecision("defer", "runtime-ended-degraded", scopeMatch, acceptedEvidence, {
        boundedReason: "runtime-ended evidence requires degraded settlement policy",
      });
    }

    if (evidence.state.isProcessing || activeTurnStillMatchesEvidence(evidence)) {
      return buildDecision("cleanup-residue", "busy-residue", scopeMatch, acceptedEvidence, {
        boundedReason: "terminal evidence is matched but lifecycle state remains busy",
        residue: true,
      });
    }

    return buildDecision(
      "settle",
      terminalKind === "runtime-ended" ? "runtime-ended-degraded" : "matched-terminal",
      scopeMatch,
      acceptedEvidence,
      {
        boundedReason: "terminal evidence is matched and lifecycle state is not busy",
      },
    );
  }

  const reconciliationStatus = evidence.reconciliation?.status ?? "not-needed";
  if (reconciliationStatus === "running") {
    return buildDecision("keep-running", "status-confirmed-running", scopeMatch, acceptedEvidence, {
      boundedReason: "authoritative status reports the turn is still running",
      reconciliationAttempted: true,
    });
  }

  if (reconciliationStatus === "unknown" || reconciliationStatus === "query-failed") {
    return buildDecision("defer", "status-unknown", scopeMatch, acceptedEvidence, {
      boundedReason: "authoritative status is unavailable or unknown",
      reconciliationAttempted: true,
    });
  }

  if (isProgressFresh(evidence, policy, nowMs)) {
    return buildDecision("keep-running", "progress-protected", scopeMatch, acceptedEvidence, {
      boundedReason: "fresh progress evidence protects a running turn",
    });
  }

  if (policy.allowStatusQueryReconciliation) {
    return buildDecision(
      "request-reconciliation",
      "needs-authoritative-status",
      scopeMatch,
      acceptedEvidence,
      {
        boundedReason: "terminal evidence is missing and progress is stale",
      },
    );
  }

  return buildDecision("defer", "missing-terminal", scopeMatch, acceptedEvidence, {
    boundedReason: "terminal evidence is missing",
  });
}

export function toDryRunSettlementDecisionLabel(action: TurnSettlementAction): string {
  switch (action) {
    case "settle":
      return "wouldSettle";
    case "reject":
      return "wouldReject";
    case "defer":
      return "wouldDefer";
    case "keep-running":
      return "wouldKeepRunning";
    case "request-reconciliation":
      return "wouldRequestReconciliation";
    case "cleanup-residue":
      return "wouldCleanupResidue";
  }
}

function buildAcceptedEvidence(evidence: TurnSettlementEvidence): TurnSettlementDecision["acceptedEvidence"] {
  return {
    terminal: evidence.terminal.kind !== null,
    state: true,
    progress: evidence.progress.lastAtMs !== null || evidence.progress.lastSource !== null,
    reconciliation:
      Boolean(evidence.reconciliation?.attempted) ||
      (evidence.reconciliation?.status ?? "not-needed") !== "not-needed",
  };
}

function collectMissingScope(evidence: TurnSettlementEvidence): string[] {
  const fields: Record<(typeof REQUIRED_SCOPE_FIELDS)[number], string> = {
    workspaceId: evidence.workspaceId,
    engine: evidence.engine,
    threadId: evidence.threadId,
    currentWorkspaceId: evidence.scope.currentWorkspaceId,
    currentEngine: evidence.scope.currentEngine,
    currentThreadId: evidence.scope.currentThreadId,
  };
  return REQUIRED_SCOPE_FIELDS.filter((field) => fields[field].trim().length === 0);
}

function buildScopeMatch(
  evidence: TurnSettlementEvidence,
  missingScope: string[],
): TurnSettlementDecision["scopeMatch"] {
  const workspace = evidence.workspaceId === evidence.scope.currentWorkspaceId;
  const engine = evidence.engine === evidence.scope.currentEngine;
  const thread = evidence.threadId === evidence.scope.currentThreadId;
  const turn = matchesTurnScope(evidence);
  const runtimeLease = matchesRuntimeLeaseScope(evidence);
  const foregroundOwner = evidence.scope.foreground;
  return {
    matched:
      missingScope.length === 0 &&
      workspace &&
      engine &&
      thread &&
      turn &&
      runtimeLease !== false &&
      foregroundOwner,
    workspace,
    engine,
    thread,
    turn,
    runtimeLease,
    foregroundOwner,
  };
}

function matchesTurnScope(evidence: TurnSettlementEvidence): boolean {
  const incomingTurnId = normalizeIdentity(evidence.turnId);
  const currentTurnId = normalizeIdentity(evidence.scope.currentTurnId);
  const activeTurnId = normalizeIdentity(evidence.state.activeTurnId);
  const aliasTurnId = normalizeIdentity(evidence.state.aliasTurnId);

  if (!incomingTurnId) {
    return true;
  }
  if (currentTurnId && incomingTurnId !== currentTurnId) {
    return incomingTurnId === aliasTurnId;
  }
  if (activeTurnId && incomingTurnId !== activeTurnId) {
    return incomingTurnId === aliasTurnId;
  }
  return true;
}

function matchesRuntimeLeaseScope(evidence: TurnSettlementEvidence): boolean | null {
  const incomingLeaseId = normalizeIdentity(evidence.runtimeLeaseId);
  const currentLeaseId = normalizeIdentity(evidence.scope.currentRuntimeLeaseId);
  if (!incomingLeaseId || !currentLeaseId) {
    return null;
  }
  return incomingLeaseId === currentLeaseId;
}

function activeTurnStillMatchesEvidence(evidence: TurnSettlementEvidence): boolean {
  const incomingTurnId = normalizeIdentity(evidence.turnId);
  const activeTurnId = normalizeIdentity(evidence.state.activeTurnId);
  if (!incomingTurnId || !activeTurnId) {
    return false;
  }
  return incomingTurnId === activeTurnId;
}

function isProgressFresh(
  evidence: TurnSettlementEvidence,
  policy: TurnSettlementPolicy,
  nowMs: number,
): boolean {
  if (evidence.progress.fresh) {
    return true;
  }
  const ageMs =
    evidence.progress.ageMs ??
    (evidence.progress.lastAtMs === null
      ? null
      : Math.max(0, nowMs - evidence.progress.lastAtMs));
  return ageMs !== null && ageMs < policy.progressFreshWindowMs;
}

function buildDecision(
  action: TurnSettlementAction,
  reason: TurnSettlementReason,
  scopeMatch: TurnSettlementDecision["scopeMatch"],
  acceptedEvidence: TurnSettlementDecision["acceptedEvidence"],
  diagnostics: TurnSettlementDecision["diagnostics"],
): TurnSettlementDecision {
  return {
    action,
    reason,
    scopeMatch,
    acceptedEvidence,
    diagnostics,
  };
}

function normalizeIdentity(value: string | null): string {
  return value?.trim() ?? "";
}
