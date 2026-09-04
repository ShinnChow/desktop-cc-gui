export type RuntimePoolState =
  | "starting"
  | "startup-pending"
  | "resume-pending"
  | "acquired"
  | "streaming"
  | "graceful-idle"
  | "evictable"
  | "stopping"
  | "failed"
  | "zombie-suspected";

export type RuntimeLifecycleState =
  | "idle"
  | "acquiring"
  | "active"
  | "replacing"
  | "stopping"
  | "recovering"
  | "quarantined"
  | "ended";

export type RuntimeUserAction =
  | "wait"
  | "retry"
  | "reconnect"
  | "recover-thread"
  | "start-fresh-thread"
  | "open-runtime-console"
  | "dismiss";

export type RuntimeProcessDiagnostics = {
  rootProcesses: number;
  totalProcesses: number;
  nodeProcesses: number;
  rootCommand: string | null;
  managedRuntimeProcesses: number;
  resumeHelperProcesses: number;
  orphanResidueProcesses: number;
};

export type RuntimePoolRow = {
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  engine: string;
  state: RuntimePoolState;
  lifecycleState?: RuntimeLifecycleState;
  pid: number | null;
  runtimeGeneration?: string | null;
  wrapperKind: string | null;
  resolvedBin: string | null;
  startedAtMs: number | null;
  lastUsedAtMs: number;
  pinned: boolean;
  turnLeaseCount: number;
  streamLeaseCount: number;
  leaseSources: string[];
  activeWorkProtected: boolean;
  activeWorkReason?: string | null;
  activeWorkSinceMs?: number | null;
  activeWorkLastRenewedAtMs?: number | null;
  foregroundWorkState?: "startup-pending" | "resume-pending" | null;
  foregroundWorkSource?: "user-input-resume" | "queue-fusion-cutover" | null;
  foregroundWorkThreadId?: string | null;
  foregroundWorkTurnId?: string | null;
  foregroundWorkSinceMs?: number | null;
  foregroundWorkTimeoutAtMs?: number | null;
  foregroundWorkLastEventAtMs?: number | null;
  foregroundWorkTimedOut?: boolean;
  evictCandidate: boolean;
  evictionReason: string | null;
  error: string | null;
  lastExitReasonCode?: string | null;
  lastExitMessage?: string | null;
  lastExitAtMs?: number | null;
  lastExitCode?: number | null;
  lastExitSignal?: string | null;
  lastExitPendingRequestCount?: number;
  processDiagnostics?: RuntimeProcessDiagnostics | null;
  startupState?:
    | "starting"
    | "ready"
    | "suspect-stale"
    | "cooldown"
    | "quarantined"
    | null;
  lastRecoverySource?: string | null;
  lastGuardState?: string | null;
  lastReplaceReason?: string | null;
  lastProbeFailure?: string | null;
  lastProbeFailureSource?: string | null;
  reasonCode?: string | null;
  recoverySource?: string | null;
  retryable?: boolean;
  userAction?: RuntimeUserAction | string | null;
  hasStoppingPredecessor?: boolean;
  recentSpawnCount?: number;
  recentReplaceCount?: number;
  recentForceKillCount?: number;
};

export type RuntimeEngineObservability = {
  engine: string;
  sessionCount: number;
  trackedRootProcesses: number;
  trackedTotalProcesses: number;
  trackedNodeProcesses: number;
  hostManagedRootProcesses: number;
  hostUnmanagedRootProcesses: number;
  externalRootProcesses: number;
  hostUnmanagedTotalProcesses: number;
  externalTotalProcesses: number;
};

export type RuntimePoolSnapshot = {
  rows: RuntimePoolRow[];
  summary: {
    totalRuntimes: number;
    acquiredRuntimes: number;
    streamingRuntimes: number;
    gracefulIdleRuntimes: number;
    evictableRuntimes: number;
    activeWorkProtectedRuntimes: number;
    pinnedRuntimes: number;
    codexRuntimes: number;
    claudeRuntimes: number;
  };
  budgets: {
    maxHotCodex: number;
    maxWarmCodex: number;
    warmTtlSeconds: number;
    restoreThreadsOnlyOnLaunch: boolean;
    forceCleanupOnExit: boolean;
    orphanSweepOnLaunch: boolean;
  };
  diagnostics: {
    orphanEntriesFound: number;
    orphanEntriesCleaned: number;
    orphanEntriesFailed: number;
    forceKillCount: number;
    leaseBlockedEvictionCount: number;
    coordinatorAbortCount: number;
    startupManagedNodeProcesses: number;
    startupResumeHelperNodeProcesses: number;
    startupOrphanResidueProcesses: number;
    lastOrphanSweepAtMs: number | null;
    lastShutdownAtMs: number | null;
    runtimeEndDiagnosticsRecorded?: number;
    lastRuntimeEndReasonCode?: string | null;
    lastRuntimeEndMessage?: string | null;
    lastRuntimeEndAtMs?: number | null;
    lastRuntimeEndWorkspaceId?: string | null;
    lastRuntimeEndEngine?: string | null;
    claudeAskUserQuestionResumeAttemptCount?: number;
    claudeAskUserQuestionResumeSuccessCount?: number;
    claudeAskUserQuestionResumeFailureCount?: number;
    lastClaudeAskUserQuestionResumeAtMs?: number | null;
    lastClaudeAskUserQuestionResumeWorkspaceId?: string | null;
    lastClaudeAskUserQuestionResumeThreadId?: string | null;
    lastClaudeAskUserQuestionResumeTurnId?: string | null;
    lastClaudeAskUserQuestionResumeRequestId?: string | null;
    lastClaudeAskUserQuestionResumeStatus?: string | null;
    lastClaudeAskUserQuestionResumeError?: string | null;
  };
  engineObservability: RuntimeEngineObservability[];
};

export type TurnReconciliationRuntimeStatus =
  | "completed"
  | "running"
  | "failed"
  | "stalled"
  | "runtime-ended"
  | "unknown"
  | "query-failed";

export type TurnReconciliationStatusSource =
  | "runtime"
  | "runtime-end-context"
  | "backend-cache"
  | "session-summary"
  | "recovery-state";

export type TurnReconciliationStatusRequest = {
  workspaceId: string;
  engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
  threadId: string;
  turnId: string | null;
  runtimeSessionId: string | null;
  runtimeLeaseId: string | null;
  requestSource: "three-evidence-reconciliation";
  requestedAtMs: number;
};

export type TurnReconciliationStatusResponse = {
  workspaceId: string;
  engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
  threadId: string;
  turnId: string | null;
  runtimeSessionId: string | null;
  runtimeLeaseId: string | null;
  status: TurnReconciliationRuntimeStatus;
  statusSource: TurnReconciliationStatusSource;
  observedAtMs: number | null;
  boundedReason: string;
};

export type DiagnosticsBundleExportResult = {
  filePath: string;
  generatedAt: string;
};

