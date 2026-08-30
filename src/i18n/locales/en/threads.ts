// threads — English UI strings
const threads = {
  threads: {
    rename: "Rename",
    autoName: "Auto name",
    autoNaming: "Auto naming...",
    runtimeProcessing: "Running",
    runtimeReviewing: "Reviewing",
    runtimeCompleted: "Completed",
    runtimeBackgroundTasks: "Background tasks running",
    archive: "Archive",
    delete: "Delete",
    openSessionManagement: "Bulk Delete in Session Management…",
    deleteThreadTitle: "Delete conversation",
    deleteThreadMessage: 'Are you sure you want to delete "{{name}}"?',
    deleteThreadHint:
      "This cannot be undone and the local session record will be removed.",
    pin: "Pin",
    pinToGlobal: "Pin to global",
    pinToProject: "Pin in project",
    unpin: "Unpin",
    sync: "Sync",
    reload: "Reload",
    renamePlaceholder: "Enter thread name",
    confirmDelete: "Are you sure you want to delete this thread?",
    confirmArchive: "Are you sure you want to archive this thread?",
    reloadThreads: "Reload threads",
    syncFromServer: "Sync from server",
    copyId: "Copy ID",
    copyClaudeResumeCommand: "Copy Claude resume command",
    providerContinuation: "Provider continuation",
    providerContinuationShort: "Continued",
    providerContinuationHint:
      "Provider continuation: open the source from the conversation header",
    providerContinuationFamilyGroup: "Continued sessions · {{count}}",
    providerContinuationTitle: "Continue with another Provider",
    providerContinuationDescription:
      "The source stays intact while a new conversation continues the work.",
    providerContinuationFailedTitle: "Continuation did not finish",
    providerContinuationFailedDescription:
      "The source conversation is unchanged. You can safely retry.",
    providerContinuationSourcePreserved:
      "The source conversation will not be changed. You can return to it from the new conversation.",
    providerContinuationFromLabel: "From",
    providerContinuationToLabel: "To",
    providerContinuationStagePrepare: "Prepare context",
    providerContinuationStageDeliver: "Deliver context",
    providerContinuationStageVerify: "Verify target",
    providerContinuationStagesAriaLabel: "Continuation progress stages",
    providerContinuationProgressAriaLabel: "Provider continuation progress",
    providerContinuationProgressWaiting: "Waiting to prepare context",
    providerContinuationProgressReading: "Reading the source conversation…",
    providerContinuationProgressCompiling: "Preparing portable context…",
    providerContinuationProgressPrepared:
      "Context is ready. Continue to start the target.",
    providerContinuationProgressStarting: "Starting the target Provider…",
    providerContinuationProgressDelivering: "Delivering context…",
    providerContinuationProgressVerifying: "Verifying the target conversation…",
    providerContinuationProgressFinalizing: "Finalizing conversation metadata…",
    providerContinuationProgressReady: "Continuation complete",
    providerContinuationPreparing: "Preparing…",
    providerContinuationContinuing: "Continuing…",
    providerContinuationContinue: "Continue",
    providerContinuationRetryPrepare: "Prepare again",
    providerContinuationRetry: "Retry verification",
    providerContinuationTechnicalDetail: "Technical details",
    providerContinuationRecoveryRequired:
      "Continuation did not finish and entered recovery. Keep the source conversation and retry.",
    providerContinuationContextAriaLabel: "Provider continuation context",
    providerContinuationCardDescription:
      "Source preserved; continuing in a separate conversation",
    providerContinuationSourceProvider: "Source Provider",
    providerContinuationSourceLabel: "Source: {{source}}",
    providerContinuationSourceUnavailable: "Source conversation unavailable",
    providerContinuationSourceExcerptUnavailable: "No source excerpt available",
    providerContinuationOpenSourceTitle: "Open source conversation",
    providerContinuationOpenSource: "Open source",
    providerContinuationEstimatedTokens: "Context tokens",
    providerContinuationTokensEstimating: "Estimating context…",
    providerContinuationErrorCode: "Error code: {{code}}",

    openClaudeTui: "Open in Claude TUI",
    claudeResumeCommandHelp:
      "If the Claude TUI /resume picker misses this GUI session, run claude --resume <session_id> or /resume <session_id> explicitly.",
    moveToFolder: "Move to folder",
    moveToProjectRoot: "Project root",
    searchFolderTargets: "Search folders...",
    size: "Size",
    deleteWorktree: "Delete worktree",
    renameThread: "Rename thread",
    currentName: "Current name:",
    newName: "New name",
    copyThread: "Copy thread",
    untitledThread: "Untitled thread",
    topbarSessionTabsAriaLabel: "Topbar session tabs",
    memoryReferenceQuerying: "Memory Reference: querying project memory...",
    memoryReferenceReferenced:
      "Memory Reference: referenced {{count}} project memories{{titlesSuffix}}",
    memoryReferenceNoRelated:
      "Memory Reference: no related project memory found",
    memoryReferenceTimeout:
      "Memory Reference: timed out, sent without memory brief",
    memoryReferenceError: "Memory Reference: failed, sent without memory brief",
    memoryReferenceTitlesSuffix: " - {{titles}}",
    closeTab: "Close tab",
    closeLeftTabs: "Close tabs to the left",
    closeRightTabs: "Close tabs to the right",
    closeAllTabs: "Close all tabs",
    closeCompletedTabs: "Close completed tabs",
    showLess: "Show less",
    more: "More...",
    loading: "Loading...",
    searchOlder: "Search older...",
    loadOlder: "Load older...",
    hideExitedSessions: "Hide exited sessions",
    showExitedSessions: "Show exited sessions",
    exitedSessionsHidden: "{{count}} exited hidden",
    subagentTag: "Subagent",
    subagentTreeExpanded: "Subagent tree expanded",
    subagentTreeExpand: "Expand subagent tree",
    subagentTreeCollapse: "Collapse subagent tree",
    degradedWorkspaceRefreshAriaLabel: "Refresh incomplete thread list",
    degradedWorkspaceRefreshTooltip:
      "This project's thread list is not fully refreshed yet and may be missing some conversations. Click to refresh it again.",
    degradedWorkspaceRefreshingAriaLabel: "Refreshing thread list",
    degradedWorkspaceRefreshingTooltip: "Refreshing thread list...",
    sessionStopped: "Session stopped.",
    sessionStoppedForFusion:
      "Switching to the merged follow-up and waiting for resume evidence...",
    turnFailed: "Turn failed.",
    turnFailedWithMessage: "Turn failed: {{message}}",
    turnOrphanedRetryable:
      "The engine sent no response events for this turn (backend restart or engine unavailable). The turn was aborted — please send again.",
    claudeMcpRouteMapped:
      "MCP routing notice: detected `playwright-mcp`, automatically mapped this session to `chrome-devtools`.",
    claudeMcpRouteUnavailable:
      "MCP routing notice: detected `playwright-mcp`, but this session has not confirmed that tool is visible.",
    turnFailedToStart: "Turn failed to start.",
    turnFailedToStartWithMessage: "Turn failed to start: {{message}}",
    turnStalled:
      "Turn stalled after user input. You can continue from the latest visible state.",
    turnStalledWithMessage: "Turn stalled after user input: {{message}}",
    fusionTurnStalled:
      "The merged follow-up did not resume. The thread is interactive again from the latest visible state.",
    fusionTurnStalledWithMessage:
      "The merged follow-up did not resume: {{message}}",
    firstPacketTimeout:
      "No initial response within {{seconds}}s. Network, proxy, or upstream service load may be causing delay. Please retry.",
    codexNoProgressStalled:
      "Codex realtime received no new progress for {{seconds}}s. This turn is quarantined as stalled, so you can stop or resend safely.",
    networkProxyHint:
      "Network connection failed. Check network and proxy settings (HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY), then retry.",
    networkConnectionHint:
      "Network connection failed. Please verify your network is reachable, then retry.",
    proxyBadge: "Proxy",
    requestTimeoutHint:
      "Request timed out before receiving a response. Network jitter or upstream service load may be causing delay. Please retry.",
    completionEmailSent: "Completion email sent.",
    completionEmailSkipped:
      "No completed assistant answer was available, so no email was sent.",
    completionEmailFailedTitle: "Completion email failed",
    codexCompactionStarted:
      "Codex is compacting background information. The response will continue after it finishes.",
    codexCompactionCompleted:
      "Codex completed background information compaction.",
    contextCompactedAuto: "Context compacted automatically",
    contextCompactedManual: "Context compacted manually",
    contextCompactedNeutral: "Context compacted",
    contextCompactionFailed: "Context compaction failed.",
    contextCompactionFailedWithMessage:
      "Context compaction failed: {{message}}",
    claudeManualCompactUnavailable:
      "No active Claude conversation is available to compact. Open an existing Claude thread, then run /compact again.",
    specRootContext: {
      title: "External Spec Root (Priority)",
      activeRoot: "Active root path",
      priorityLabel: "Read policy",
      priorityDetail:
        "Read this root first, then fall back to workspace openspec.",
    },
  },
};

export default threads;
