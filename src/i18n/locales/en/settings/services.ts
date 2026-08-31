// settings/services — English UI strings
const services = {
  settings: {
    performanceDiagnosticsTitle: "Performance diagnostics",
    performanceDiagnosticsDescription:
      "Tune local realtime performance temporarily. If parallel conversations, tool output, or message streaming feel unusually janky, adjust the schedule tier first; reset the overrides after verification.",
    streamingScheduleTierTitle: "Streaming schedule tier",
    streamingScheduleTierDescription:
      "Controls realtime event dispatch pacing for tool-heavy turns, including how background messages, tool output, and session list updates yield to the main thread.",
    streamingScheduleTierRestartHint:
      "New turns use the selected tier. Reload the window when verifying module-level caches.",
    streamingScheduleTier: {
      baseline: "Baseline",
      guarded: "Guarded",
      aggressive: "Aggressive",
    },
    streamingScheduleTierDetail: {
      baseline:
        "Baseline: renders as immediately as possible and does not drop background events. Use it to check whether scheduling adds latency.",
      guarded:
        "Guarded: default tier. Background events yield to the main thread and may be coalesced to keep input and the active conversation responsive.",
      aggressive:
        "Aggressive: delays and coalesces background work more heavily. Use it when parallel sessions or dense tool output cause visible jank.",
    },
    performanceFlagsResetTitle: "Reset performance flags",
    performanceFlagsResetDescription:
      "Clears known local ccgui.perf.* localStorage overrides, including realtime batching, background render gating, streaming schedule tier, and tool-output gating. Reload the window to refresh module-level readers.",
    performanceFlagsResetButton: "Reset",
    performanceFlagsResetDone:
      "Reset {{count}} performance flag override(s). Reload the window to refresh module-level caches.",
    performanceFlagsResetAlreadyDefault:
      "Performance flags already use defaults. Reload the window if you are verifying runtime behavior.",
    reactScanTitle: "Render performance panel (react-scan)",
    reactScanDescription:
      "Overlays highlights on the UI to flag components that are re-rendering, with render counts, to help pinpoint conversation jank. Takes effect immediately.",
    reactScanDetail:
      "Developer-grade tool for local diagnostics. Note: packaged (production) builds only show re-render highlights and counts, not per-render timings — use a dev build (npm run dev:scan) for timings.",
    perfDiagnosticsCaptureTitle: "Performance diagnostics capture",
    perfDiagnosticsCaptureDescription:
      "Records frame drops (rAF), long tasks (longtask), and recent interaction context in the background; works in packaged builds too. Off by default — reproduce the jank, then export the capture in one click.",
    perfDiagnosticsCaptureDetail:
      'Very low overhead, local-only, contains no conversation content. Turn it on when hunting jank, reproduce the issue, then use "Copy performance report" below.',
    perfCopyReportTitle: "Copy performance report",
    perfCopyReportDescription:
      "Summarizes recent frame drops / long tasks / performance metrics into text you can send to the maintainer.",
    perfCopyReportButton: "Copy",
    perfCopyReportDone: "Copied to clipboard.",
    perfCopyReportDownloaded:
      "Clipboard unavailable — downloaded as a text file.",
    perfCopyReportFailed: "Copy failed, please retry.",
    perfJankLiveTitle: "Recent jank (live)",
    perfJankLiveDescription:
      "Frame drops / long tasks captured by performance diagnostics, newest first, auto-refreshing every second. Clear first, reproduce the jank, then read each entry's attribution (time, cost, streaming phase, last interaction, re-rendered components).",
    perfJankLiveClearButton: "Clear",
    perfJankLiveCleared: "Cleared — start observing from zero.",
    perfJankLiveEmpty:
      "No records yet. Enable “Performance diagnostics capture” above and frame drops will appear here in real time.",
    perfJankLiveSummary: "{{count}} entries · worst {{worst}}ms",
    perfJankLiveNoRenders: "no render attribution",
    perfJankLiveTruncated:
      "Showing the latest 40 entries; {{hidden}} older ones are in the exported report.",
    runtimePoolTitle: "Runtime Pool Console",
    runtimePoolDescription:
      "Inspect managed Codex and Claude Code runtime instances with lease, eviction, attribution, and manual control surfaced in one place. These metrics describe runtime instances, not chat thread counts.",
    runtimePanelTitle: "Runtime Pool",
    runtimePanelDescription:
      "A dedicated panel for runtime orchestration. Use it to inspect pool health, tune capacity, and manually intervene when a runtime drifts.",
    runtimeMetricTotal: "Total",
    runtimeMetricAcquired: "Acquired",
    runtimeMetricStreaming: "Streaming",
    runtimeMetricActiveProtected: "Protected",
    runtimeMetricIdle: "Graceful Idle",
    runtimeMetricEvictable: "Evictable",
    runtimeMetricPinned: "Pinned",
    runtimePolicyTitle: "Lifecycle Policy",
    runtimePolicyDescription:
      "Controls what happens to managed runtimes at launch, on shutdown, and after abnormal exits.",
    runtimeRestoreThreadsOnlyOnLaunch: "Restore thread metadata only on launch",
    runtimeRestoreThreadsOnlyOnLaunchDesc:
      "Restore workspace UI and thread metadata without bulk-starting runtimes for every visible workspace.",
    runtimeForceCleanupOnExit: "Force cleanup managed runtimes on exit",
    runtimeForceCleanupOnExitDesc:
      "Drain managed Codex runtimes when the app exits to reduce stranded background processes on slower machines.",
    runtimeOrphanSweepOnLaunch: "Sweep orphan runtimes on next launch",
    runtimeOrphanSweepOnLaunchDesc:
      "Scan startup ledger state and attempt cleanup for orphaned runtimes left behind by abnormal exits.",
    runtimeBudgetTitle: "Codex Runtime Instance Budget",
    runtimeBudgetDescription:
      "These budget settings apply only to managed Codex runtime instances and do not limit how many chat threads you can create. Claude Code remains observable and manageable in the pool, but is not controlled by this capacity section. Multiple Codex conversations may still reuse the same runtime.",
    runtimeMaxHot: "Codex hot instance limit",
    runtimeMaxHotHelp:
      "Maximum number of instantly reusable Codex runtime instances, not chat sessions. Higher is faster, but costs more memory.",
    runtimeMaxWarm: "Codex warm instance limit",
    runtimeMaxWarmHelp:
      "Maximum number of idle Codex runtime instances kept warm for quicker recovery from cold.",
    runtimeWarmTtl: "Warm instance retention (seconds)",
    runtimeWarmTtlHelp:
      "How long an idle Codex runtime instance can stay warm before it is released back to cold.",
    runtimePoolSummary: "Runtime pool summary",
    runtimeSummaryLine:
      "Total {{total}} · Acquired {{acquired}} · Streaming {{streaming}} · Idle {{idle}} · Evictable {{evictable}} · Pinned {{pinned}}",
    runtimeDiagnosticsLine:
      "Orphan cleaned {{cleaned}} · Orphan failed {{failed}} · Forced kill {{forced}} · Lease blocked {{blocked}} · Coordinator aborted {{aborted}}",
    runtimeSessionEngineTitle: "Current session engine distribution",
    runtimeSessionEngineDescription:
      "Counts loaded chat threads by their actual session engine. Use this to answer whether the current conversation is Claude or Codex, separately from managed runtime instances below.",
    runtimeSessionEngineActiveLabel: "Currently open:",
    runtimeRowsTitle: "Active runtimes",
    runtimeRowsDescription:
      "Each row is one managed runtime with its workspace, state, process details, and last activity.",
    runtimeRowDetailsSummary: "Show details",
    runtimeEngineObservationTitle: "Managed runtimes / process observability",
    runtimeEngineObservationDescription:
      "Split managed runtimes and process trees by engine to pinpoint where background processes come from.",
    runtimeEngineObservationScopeNote:
      "These metrics count ccgui-managed runtime instances and process trees, not the engine selected in the current chat tab. Claude /status and /mcp commands are passed to the Claude CLI; Codex counts usually represent the GUI background app-server/runtime.",
    runtimeEngineCodex: "Codex",
    runtimeEngineClaude: "Claude",
    runtimeEngineGemini: "Gemini",
    runtimeEngineOpenCode: "OpenCode",
    runtimeBudgetHotBadge: "Hot inst {{count}}",
    runtimeBudgetWarmBadge: "Warm inst {{count}}",
    runtimeBudgetTtlBadge: "Warm {{count}}s",
    runtimeSessionCountLabel: "Managed instances:",
    runtimeRootProcessCountLabel: "Root processes:",
    runtimeProcessTreeCountLabel: "Process tree total:",
    runtimeNodeProcessCountLabel: "Node processes:",
    runtimeTrackedRootProcessCountLabel: "Tracked roots:",
    runtimeTrackedProcessTreeCountLabel: "Tracked tree total:",
    runtimeTrackedNodeProcessCountLabel: "Tracked Node:",
    runtimeHostManagedRootProcessCountLabel: "Current host managed roots:",
    runtimeHostUnmanagedRootProcessCountLabel: "Current host unmanaged roots:",
    runtimeExternalRootProcessCountLabel: "Other host roots:",
    runtimeProcessTreeLabel: "{{count}} processes",
    runtimeNodeProcessLabel: "Node {{count}}",
    runtimePathLabel: "Workspace path:",
    runtimeLeaseSourcesLabel: "Lease sources:",
    runtimeProcessLabel: "Process:",
    runtimeProtectionLabel: "Protection:",
    runtimeActiveWorkProtected: "Protected by active work",
    runtimeProtectionTurn: "Protected by active turn",
    runtimeProtectionStream: "Protected by active stream",
    runtimeProtectionTurnStream: "Protected by turn + stream",
    runtimeProtectionSilentBusy: "Silent busy foreground turn",
    runtimeProtectionStartupPending: "Waiting for first foreground event",
    runtimeProtectionResumePending: "Waiting for resume after user input",
    runtimeProtectionIdle: "Idle and releasable",
    runtimeProtectionPinnedIdle: "Pinned while idle",
    runtimeBinaryLabel: "Resolved binary:",
    runtimeStartupStateLabel: "Startup state:",
    runtimeForegroundThreadLabel: "Foreground thread:",
    runtimeForegroundTurnLabel: "Foreground turn:",
    runtimeForegroundSourceLabel: "Foreground source:",
    runtimeForegroundStateLabel: "Foreground state:",
    runtimeForegroundSinceLabel: "Foreground since:",
    runtimeForegroundTimeoutLabel: "Foreground timeout:",
    runtimeForegroundTimedOutLabel:
      "Foreground recovery timed out but has not fully settled yet.",
    runtimeRecoverySourceLabel: "Recovery source:",
    runtimeGuardStateLabel: "Guard state:",
    runtimeRecentChurnLabel: "Recent churn:",
    runtimeRecentSpawnCountLabel: "spawn {{count}}",
    runtimeRecentReplaceCountLabel: "replace {{count}}",
    runtimeRecentForceKillCountLabel: "force-kill {{count}}",
    runtimeReplaceReasonLabel: "Last replace reason:",
    runtimeProbeFailureLabel: "Last probe failure:",
    runtimeStoppingPredecessorLabel: "Stopping predecessor",
    runtimeEvictionReasonLabel: "Eviction reason:",
    runtimeLastExitLabel: "Last exit:",
    runtimeExitPendingRequestCountLabel: "{{count}} pending request(s)",
    runtimeExitCodeLabel: "exit code {{code}}",
    runtimeExitSignalLabel: "signal {{signal}}",
    runtimeTurnLeaseCountLabel: "turn {{count}}",
    runtimeStreamLeaseCountLabel: "stream {{count}}",
    runtimePidLabel: "pid {{pid}}",
    runtimeGenerationLabel: "generation",
    runtimeManagedProcessCountLabel: "managed {{count}}",
    runtimeHelperProcessCountLabel: "helper {{count}}",
    runtimeOrphanProcessCountLabel: "orphan {{count}}",
    runtimeStateStarting: "Starting",
    runtimeStateStartupPending: "Startup Pending",
    runtimeStateResumePending: "Resume Pending",
    runtimeStateAcquired: "Acquired",
    runtimeStateStreaming: "Streaming",
    runtimeStateGracefulIdle: "Graceful Idle",
    runtimeStateEvictable: "Evictable",
    runtimeStateStopping: "Stopping",
    runtimeStateFailed: "Failed",
    runtimeStateZombieSuspected: "Zombie Suspected",
    runtimeStartupStateReady: "Ready",
    runtimeStartupStateSuspectStale: "Suspect stale",
    runtimeStartupStateCooldown: "Cooldown",
    runtimeStartupStateQuarantined: "Quarantined",
    runtimeStartedAtLabel: "Started",
    runtimeLastUsedLabel: "Last used",
    runtimePoolEmpty: "No managed runtime is active right now.",
    runtimeEmptyDescription:
      "This usually means there is no active Codex session, or the pool has already cooled idle runtimes back to cold.",
    runtimePin: "Keep warm",
    runtimeUnpin: "Allow auto release",
    runtimeRelease: "Release to cold",
    runtimeClose: "Close now",
    runtimePinHelp:
      "Keep warm: prevent automatic eviction when you expect to return soon.",
    runtimeUnpinHelp:
      "Allow auto release: let this instance follow normal eviction rules again.",
    runtimeReleaseHelp:
      "Release to cold: stop keeping this instance warm. It will restart on next use.",
    runtimeCloseHelp:
      "Close now: stop this runtime immediately. If it is still running work, that work will be interrupted.",
    webServiceTitle: "Web service",
    webServiceDescription:
      "Manage the browser-accessible Web service exposed by the daemon.",
    webServiceConfigGroup: "Configuration",
    webServiceAccessGroup: "Access",
    webServicePortHint: "Local port used by the browser-accessible Web service.",
    webServiceAssetsTitle: "Web frontend assets",
    webServiceAssetsChecking: "Checking",
    webServiceAssetsMissing: "Not installed",
    webServiceAssetsInstalling: "Downloading and installing",
    webServiceAssetsReady: "Installed ({{version}})",
    webServiceAssetsFailed: "Check or installation failed",
    webServiceAssetsInstall: "Download and install",
    webServiceAssetsReinstall: "Download and reinstall",
    webServiceAssetsInstallLocal: "Choose local package",
    webServiceAssetsSelectingLocal: "Choosing package",
    webServiceAssetsInstallingLocal: "Installing local package",
    webServiceAssetsRecheck: "Check again",
    webServiceAssetsRechecking: "Checking",
    webServiceAssetsInstallProgress:
      "Downloading, verifying, and installing Web frontend assets from the Release...",
    webServiceAssetsInstallSuccess:
      "Download and installation complete. Current version: {{version}}.",
    webServiceAssetsRecheckProgress: "Checking Web frontend assets again...",
    webServiceAssetsRecheckSuccess:
      "Check complete. Current assets version: {{version}}.",
    webServiceAssetsRecheckComplete: "Check complete. Assets status updated.",
    webServiceAssetsSelectLocalProgress:
      "Choosing a local Web frontend assets package...",
    webServiceAssetsInstallLocalProgress:
      "Verifying and installing the local Web frontend assets package...",
    webServiceAssetsInstallLocalSuccess:
      "Local package installation complete. Current version: {{version}}.",
    webServiceAssetsRequired: "Install the Web frontend assets first.",
    webServicePort: "Web port",
    webServicePortAriaLabel: "Web service port",
    webServicePortInvalid: "Port must be an integer between 1024 and 65535.",
    webServiceSavePort: "Save port",
    webServiceStatus: "Status",
    webServiceRunning: "Running",
    webServiceStopped: "Stopped",
    webServiceStart: "Start",
    webServiceStop: "Stop",
    webServiceDaemonStatus: "Daemon status",
    webServiceDaemonRunning: "Running",
    webServiceDaemonStopped: "Stopped",
    webServiceDaemonStart: "Start daemon",
    webServiceDaemonStop: "Stop daemon",
    webServiceRpcEndpoint: "Daemon RPC endpoint",
    webServiceAddresses: "Access addresses",
    webServiceNoAddress: "No access address yet. Start the service first.",
    webServiceToken: "Web access token",
    webServiceTokenEmpty: "No token available",
    webServiceShowToken: "Show",
    webServiceHideToken: "Hide",
    webServiceTokenHint:
      "The Web client must provide this token on first access.",
    webServiceFixedToken: "Fixed access token",
    webServiceFixedTokenAriaLabel: "Fixed Web service access token",
    webServiceFixedTokenAuto: "Leave empty to auto-generate on start",
    webServiceFixedTokenHint:
      "Saved in local app settings. Empty means the daemon generates a new runtime token on each start.",
    webServiceFixedTokenStoppedHint:
      "The next Start will use the saved fixed token.",
    webServiceFixedTokenRunningHint:
      "Changes are saved for the next start; the current runtime token stays unchanged until restart.",
    webServiceSaveToken: "Save token",
    webServiceClearToken: "Clear token",
    webServiceGenerateToken: "Generate token",
    webServiceRuntimeToken: "Current runtime token",
    webServiceCopied: "Copied",
    webServiceCopyFailed: "Copy failed. Please copy manually.",
    webServiceControlPlaneHint:
      "Control plane: daemon RPC {{rpc}}. Current Web port: {{port}}.",
    webServiceErrorAlreadyRunning: "Web service is already running.",
    webServiceErrorPortInvalid:
      "Web port must be an integer between 1024 and 65535.",
    webServiceErrorPortInUse:
      "The selected port is already in use. Choose another port and retry.",
    webServiceErrorBindFailed:
      "Failed to bind the Web service listener. Check address/port and retry.",
    webServiceErrorStopTimeout:
      "Stopping took too long. The process was force-terminated.",
    webServiceErrorDaemonUnavailable:
      "Daemon is unreachable. Check remote host and ensure daemon is running.",
    webServiceErrorDaemonAuth:
      "Daemon authentication failed. Verify remote backend token.",
    webServiceErrorAssetsNotReady: "Install the Web frontend assets first.",
    emailTitle: "Email sender",
    emailDescription:
      "Configure SMTP sending, read-only inbound checks, and mail-driven session management.",
    emailDocsTab: "Docs",
    emailSendConfigTab: "Send config",
    emailInboundTab: "Inbound listener",
    emailMailSessionsTab: "Mail sessions",
    emailDocsTitle: "Email module docs",
    emailDocsDesc:
      "A beginner guide to why the module exists, how to fill each field, and how to continue a session by email.",
    emailDocsPurposeTitle: "What this module does",
    emailDocsPurposeBody:
      "The email module does two things. First, it sends Moss completion results to your inbox so you can track progress away from the computer. Second, after you explicitly enable reply continuation, it lets you reply to that email to continue, change, pause, stop, or check the matching session. It is not a general email client and does not show ordinary mailbox messages.",
    emailDocsPrepTitle: "Before you configure it",
    emailDocsPrepStepEmail:
      "Prepare an email account for Moss. A dedicated mailbox or dedicated app password is recommended so it is not mixed with your personal mailbox password.",
    emailDocsPrepStepProtocol:
      "Enable SMTP in your mail provider settings. If you want inbound listening, also enable IMAP.",
    emailDocsPrepStepPassword:
      "Create an authorization code / app password. Do not enter your web login password; providers such as QQ, 163, and 126 usually require an app password.",
    emailDocsPrepStepRecipient:
      "Choose the inbox that should receive Moss mail. The common setup is sending from your own mailbox to your own inbox so you can reply and continue work.",
    emailDocsSendTitle: "Sending setup",
    emailDocsSendStepProvider:
      "Provider: choose 126 / 163 / QQ when available, or Custom SMTP for any other provider.",
    emailDocsSendStepAddress:
      "Sender email and SMTP username: usually both are the full email address, for example name@example.com. Sender name can be Moss so the message is easy to recognize.",
    emailDocsSendStepServer:
      "SMTP host / port / security: for Custom SMTP, copy these from the provider docs. Common combinations are SSL/TLS + 465 or STARTTLS + 587.",
    emailDocsSendStepSecret:
      "Authorization code / app password: paste the provider-generated secret. After saving, the UI shows that the secret is saved and normal settings do not expose it as plain text.",
    emailDocsSendStepSave:
      "Recipient inbox: enter the address that should receive Moss mail. Save, then send a test email. Receiving the test message means the SMTP sending path works.",
    emailDocsInboundTitle: "Inbound listener",
    emailDocsInboundStepServer:
      "After enabling inbound listening, fill the IMAP host and port. A common IMAP SSL port is 993; use the provider docs if STARTTLS or another port is required.",
    emailDocsInboundStepFolder:
      "Mailbox folder is usually INBOX. Moss only reads reply candidates from this folder and does not show ordinary messages as session content.",
    emailDocsInboundStepAllowlist:
      "Allowed senders are the addresses allowed to drive Moss, separated by commas. The safest default is your own recipient inbox address only.",
    emailDocsInboundStepPolling:
      "Polling interval controls how often Moss checks the mailbox, in seconds. 300 means every 5 minutes. Lower values respond faster but may hit provider limits.",
    emailDocsInboundStepCheck:
      "After saving, click Check inbox now. The status line shows queued, needs-confirmation, and rejected counts so you can tell whether Moss-related replies were found.",
    emailDocsAfterSetupTitle: "How to use it after setup",
    emailDocsUsageStepEnableSend:
      "First enable email sending and save. When completion email is enabled for a conversation, Moss sends the turn status, fix summary, and next-step suggestions after the task finishes.",
    emailDocsUsageStepEnableSession:
      "After you choose to send a completion email from a conversation, that email supports direct reply continuation by default. There is no separate manual enable step.",
    emailDocsUsageStepReply:
      "When you receive an actionable email, reply with “continue” or write one plain instruction. Moss binds the reply back to the original workspace/thread/turn using session metadata, reply token, and signature.",
    emailDocsUsageStepTrack:
      "Open the Mail sessions tab to inspect each Moss mail session state, queue, needs-confirmation items, rejected items, and sanitized timeline. You can open the matching session or inspect its mail events from there.",
    emailDocsExamplesTitle: "Reply examples",
    emailDocsExampleNext: "continue",
    emailDocsExampleChange:
      "Do not change the UI. Fix the backend save failure first.",
    emailDocsExampleStatus: "status",
    emailDocsExamplesBody:
      "Replying “continue” runs the first recommended next step from the email. A plain instruction becomes the next user request. You can also reply “status”, “pause”, or “stop”. The old ACTION/DETAIL format is still accepted but not required.",
    emailDocsSafetyTitle: "Safety boundaries",
    emailDocsSafetyStepNoInbox:
      "Moss is not an email client: ordinary unrelated mail is not shown, stored, or listed as a mail session.",
    emailDocsSafetyStepAction:
      "Empty replies, conflicting commands, auto-replies, or bounces do not run automatically; they are ignored or routed to confirmation.",
    emailDocsSafetyStepSignature:
      "Expired tokens, stale email replies, failed signatures, disallowed senders, or replies outside the current session scope do not start new work.",
    emailDocsSafetyStepReadOnly:
      "Inbound listening is always read-only: Moss only maintains a local cursor and dedupe ledger. It does not delete, move, archive, or mark remote mail as read.",
    emailDocsSafetyHint:
      "Minimum working path: finish sending setup and send a test email, then configure inbound listening and check the inbox, then enable reply continuation on a specific session. Notification-only users do not need reply continuation.",
    emailEnableTitle: "Enable email sending",
    emailEnableDesc:
      "When enabled, the backend can send controlled email through the saved SMTP settings.",
    emailProvider: "Provider",
    emailProviderCustom: "Custom SMTP",
    emailSenderAddress: "Sender email",
    emailSenderName: "Sender name",
    emailUsername: "SMTP username",
    emailSmtpHost: "SMTP host",
    emailSmtpPort: "SMTP port",
    emailSecurity: "Security",
    emailSecurityNone: "None",
    emailSecret: "Authorization code / app password",
    emailSecretPlaceholder: "Enter a new authorization code",
    emailSecretConfigured: "Secret saved",
    emailSecretMissing: "Secret not configured",
    emailShowSecret: "Show secret",
    emailHideSecret: "Hide secret",
    emailClearSecret: "Clear secret",
    emailEnableAndSave: "Enable and save email sending",
    emailSendTest: "Send test email",
    emailTestRecipient: "Recipient inbox",
    emailTestEnableFirst:
      "Enable email sending and save the settings before sending a test email.",
    emailTestSaveFirst:
      "Save the current email settings before sending a test email.",
    emailRecipientFirst:
      "Enter and save a recipient inbox before sending a test email.",
    emailTestSecretFirst:
      "Save an authorization code or app password before sending a test email.",
    emailTestReady:
      "The test email will use the currently saved SMTP settings and recipient inbox.",
    emailSaved: "Email settings saved.",
    emailEnabledSaved: "Email sending enabled and saved.",
    emailSaving: "Saving…",
    emailTesting: "Sending…",
    emailTestSent: "Test email sent.",
    emailSecretCleared: "Secret cleared.",
    emailInboundTitle: "Read-only inbound listener",
    emailInboundDesc:
      "Reads only Moss session reply candidates without deleting, moving, or marking remote mail.",
    emailInboundEnabled: "Enable inbound listener",
    emailImapHost: "IMAP host",
    emailImapPort: "IMAP port",
    emailMailboxFolder: "Mailbox folder",
    emailAllowedSenders: "Allowed senders",
    emailPollInterval: "Polling interval (seconds)",
    emailReadOnlyHint:
      "Read-only mode is always on: Moss tracks progress through local cursor and dedupe ledger.",
    emailInboundSaved: "Inbound listener settings saved.",
    emailInboundChecking: "Checking…",
    emailInboundCheckNow: "Check inbox now",
    emailInboundCheckDone:
      "Inbox check completed. Scanned {{count}} candidate messages.",
    emailInboundStatus:
      "State: {{state}}; queued {{queued}}; needs confirmation {{confirm}}; rejected {{rejected}}.",
    emailMailSessionsTitle: "Mail sessions",
    emailMailSessionsDesc:
      "Only Moss-related mail events are shown here. Ordinary unrelated mail is not stored or displayed.",
    emailRefreshSessions: "Refresh sessions",
    emailRefreshingSessions: "Refreshing…",
    emailMailSessionsRefreshed: "Mail sessions refreshed.",
    emailCleanupProcessed: "Clean processed records",
    emailCleaningProcessed: "Cleaning…",
    emailCleanupProcessedDone: "Processed mail records cleaned.",
    emailDeleteMailRecords: "Delete mail info",
    emailDeletingMailRecords: "Deleting…",
    emailDeleteMailRecordsDone:
      "Mail info deleted. The session was not deleted.",
    emailDeleteMailRecordsHint:
      "Only deletes local mail info. The session is not deleted.",
    emailNoMailSessions: "No Moss mail sessions yet.",
    emailSessionCounts:
      "Outbound {{outbound}} · inbound {{inbound}} · queued {{queued}} · needs confirmation {{confirm}}",
    emailViewTimeline: "View mail",
    emailOpenSession: "Open session",
    emailOpenSessionUnavailable:
      "This mail session cannot be opened right now. Check that the workspace and thread still exist.",
    emailPauseSession: "Pause",
    emailResumeSession: "Resume",
    emailCloseSession: "Close",
    emailEnableSessionContinuation: "Enable reply continuation",
    emailMailSessionUpdated: "Mail session updated.",
    emailTimelineTitle: "Mail event timeline",
    emailCloseTimeline: "Close mail events",
    emailTimelineOutbound: "Moss to user",
    emailTimelineInbound: "User to Moss",
    emailTimelineEmpty: "No mail events for this session yet.",
    emailError: {
      disabled: "Email sending is disabled.",
      not_configured: "Email settings are incomplete.",
      missing_secret: "Save an authorization code or app password first.",
      invalid_sender: "Sender email address is invalid.",
      invalid_recipient: "Recipient email address is invalid.",
      connect_failed:
        "Failed to connect to the SMTP server. Check host, port, or network.",
      tls_failed:
        "SMTP TLS handshake failed. Check security mode or certificate environment.",
      authentication_failed:
        "SMTP authentication failed. Check authorization code or app password.",
      send_rejected: "SMTP server rejected the message.",
      timeout: "Email sending timed out. Retry later.",
      secret_store_unavailable:
        "System credential store is unavailable, so the secret cannot be saved.",
      unknown: "Email command failed.",
    },
    runtimeEnvironmentDescription:
      "Inspect runtime pool state and validate local CLI installations from one place.",
    runtimeEnvironmentPoolTab: "Runtime Pool",
    runtimeEnvironmentCliValidationTab: "CLI Validation",
    performanceCompatibilityTitle: "Low-performance compatibility mode",
    performanceCompatibilityDesc:
      "Opt-in fallback for older machines that show high foreground CPU while idle.",
    performanceCompatibilityEnabled:
      "Enable low-performance compatibility mode",
    performanceCompatibilityStatusEnabled: "Compatibility mode on",
    performanceCompatibilityStatusDisabled: "Compatibility mode off",
    performanceCompatibilityHint:
      "When enabled, non-critical UI refreshes may update less often or pause while the window is hidden. Sending messages, files, Git, and runtime behavior stay unchanged.",
    diagnosticsBundleTitle: "Diagnostics bundle",
    diagnosticsBundleDesc:
      "Export a local JSON bundle for performance, startup, runtime, UI, or configuration bug reports.",
    diagnosticsBundleExport: "Export diagnostics",
    diagnosticsBundleExporting: "Exporting...",
    diagnosticsBundleExported: "Diagnostics bundle exported: {{path}}",
    diagnosticsBundleExportFailed: "Failed to export diagnostics: {{error}}",
    diagnosticsBundleLocalOnly: "Local file only",
    diagnosticsBundleHint:
      "The bundle includes bounded settings, runtime, renderer, platform, and client store evidence. It avoids tokens and message text.",
  },
};

export default services;
