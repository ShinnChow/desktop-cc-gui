# 死代码清理清单（knip 实测，2026-08-31）

> **执行结果（同日完成）**：582 exports + 292 types → 剩余 87 exports + 19 types（其中 ui kit ~26、ai-elements 6、extensions 17 为有意保留）；duplicates 12 → 4（剩余为在用的别名导出，保留）。共删除约 500 个 barrel 再导出 + 230 个零引用实现/类型/局部声明，涉及 180+ 文件。验证：`tsc --noEmit` clean；knip 复扫确认；改动文件 eslint 无新增问题；受影响目录 vitest 与基线对比零新增失败（仓库存在 26 个文件的存量失败与本次无关）；app-shell governance / governance-evidence-bridge 通过（后者 token 表已同步删去 `findGovernanceEvidenceBySource`）。

> 数据源：knip 5（config: knip.json，entry 覆盖 main/bootstrap/workers/i18n/shell composition）。
> 口径：全仓 0 个整文件未使用；582 个 unused exports + 292 个 unused exported types；12 处 duplicate exports。

## 分级总览

| 层级 | 范围 | 数量 | 风险 |
|---|---|---|---|
| A | services/tauri.ts 大 barrel | 176 | 低（逐个 grep 可证；删除后跑 tsc + knip 复扫） |
| B | features/*/index.ts 领域 barrel（project-map 54 / browser-agent 51 / multi-agent 51 / subagent-ui 43 / fastMarkdownRenderer 31 / governance 22 等） | ~300 | 低-中（注意是否被测试或 lazy import 间接消费，已核实 knip 含测试文件） |
| C | 非 barrel 内部模块（toolConstants/selectors/hooks/utils） | ~100 | 中（可能对外提供公共 API 预留） |
| D | duplicate exports（12 处） | 12 | 低（同名导出多处声明，择一保留） |

## 逐文件明细（按 unused 数量降序）

### src/services/tauri.ts（exports 51 / types 125）

- exports: localUsageSnapshot (ns tauriService), ttProxyRequest (ns tauriService), ttServerStatus (ns tauriService), generateRunMetadata (ns tauriService), getCuratedSkillBodies (ns tauriService), getOpenCodeAgentsList (ns tauriService), getOpenCodeProviderCatalog (ns tauriService), getCommitMessagePrompt (ns tauriService), getSelectedAgentConfig (ns tauriService), setSelectedAgentConfig (ns tauriService), saveMermaidPngFile (ns tauriService), syncSessionIndexForWorkspace (ns tauriService), claudeForkIndexTwinSessionId (ns tauriService), isLocalPendingDraftSessionId (ns tauriService), scheduleTombstoneLocalPendingDraftIndexRow (ns tauriService), upsertSessionIndexRows (ns tauriService), writeRemappedClientSessionIndex (ns tauriService), getCodexConfigPath (ns tauriService), setDockIcon (ns tauriService), getRendererStabilitySnapshot (ns tauriService), recordRendererHeartbeat (ns tauriService), loadBaiduTongjiScript (ns tauriService), sendBaiduTongjiBeacon (ns tauriService), captureBrowserAgentSnapshotV2 (ns tauriService), cleanupBrowserAgentEvidence (ns tauriService), cleanupBrowserAgentSessions (ns tauriService), generateBrowserAgentCodeCandidates (ns tauriService), getBrowserAgentPlatformCapability (ns tauriService), getBrowserAgentSettings (ns tauriService), listBrowserAgentEvidence (ns tauriService), refreshBrowserAgentSnapshot (ns tauriService), routeBrowserAgentProvider (ns tauriService), runBrowserAgentAction (ns tauriService), projectMemoryEmbedHealth (ns tauriService), projectMemoryEmbedText (ns tauriService), projectMemoryEmbedIndexList (ns tauriService), projectMemoryEmbedIndexUpsert (ns tauriService), projectMemoryEmbedIndexDelete (ns tauriService), projectMemoryEmbedIndexClear (ns tauriService), ensureWorkspacePathDir (ns tauriService), readPanelLockPasswordFile (ns tauriService), writePanelLockPasswordFile (ns tauriService), getGitBranchDiffBetweenBranches (ns tauriService), getGitBranchDiffFileBetweenBranches (ns tauriService), resolveGitCommitRef (ns tauriService), copyWorkspaceItem (ns tauriService), listExternalAbsoluteDirectoryChildren (ns tauriService), pasteExternalWorkspaceItems (ns tauriService), deleteCodexSessions (ns tauriService), deleteDshSession (ns tauriService), deleteQoderSession (ns tauriService)
- types: TtCliStatus, TtInstallResult, TtServerStatus, CodingPlanBalanceItem, CodingPlanBalanceSnapshot, CodingPlanQuotaWindow, CodingPlanUsageSummary, CreatedClaudeCommand, LspLocation, LspPosition, LspRange, PullRequestGeneratedContent, WindowOpacityApplyResult, WorkspaceSessionCatalogDiagnostic, WorkspaceSessionSourceCacheMetrics, WorkspaceSessionBatchMutationResult, WorkspaceSessionFolderTree, WorkspaceSessionFolderMutation, WorkspaceSessionAssignmentResponse, NativeHistorySourceInput, ProviderContinuationTargetInput, NativeProviderContinuationResponse, SessionArchiveV2Target, SessionIndexEngine, SessionIndexListPage, SessionIndexSyncReport, SharedNativeVisibilityProjection, CodexRuntimeReloadResult, DockIconApplyResult, ImportedWorkspaceWallpaper, SettingsRecoveryNotice, WallpaperMarketSearchResult, AgentMdResponse, ClaudeMdResponse, GlobalAgentsResponse, GlobalCodexAuthResponse, GlobalCodexConfigResponse, TextFileResponse, RendererHeartbeatInput, RendererHeartbeatStatus, RendererPlatformHookSupport, RendererStabilitySnapshot, RendererSupportState, BrowserActionAuditEntry, BrowserActionRequest, BrowserActionResult, BrowserActionTarget, BrowserEvidenceCleanupResult, BrowserEvidenceRecord, BrowserAgentFeaturePhase, BrowserAgentSettings, BrowserAgentStatus, BrowserContextAttachment, BrowserContextSnapshot, BrowserCodeCandidate, BrowserSession, BrowserSessionCleanupResult, BrowserSessionStatus, BrowserUrlValidationResult, CreateBrowserSessionRequest, UpdateBrowserSessionRequest, BrowserDiagnostic, BrowserElementBounds, BrowserFormSummary, BrowserLandmark, BrowserNetworkSummary, BrowserPlatformCapability, BrowserPrivacyReport, BrowserProviderRouteDecision, BrowserSnapshotBudget, BrowserTextNode, ComputerUseActivationFailureKind, ComputerUseActivationOutcome, ComputerUseActivationResult, ComputerUseAuthorizationBackendMode, ComputerUseAuthorizationContinuityKind, ComputerUseAuthorizationContinuityStatus, ComputerUseAuthorizationHostRole, ComputerUseAuthorizationHostSnapshot, ComputerUseAuthorizationLaunchMode, ComputerUseBrokerFailureKind, ComputerUseBrokerOutcome, ComputerUseBrokerRequest, ComputerUseBrokerResult, ComputerUseBridgeStatus, ComputerUseHostContractDiagnosticsKind, ComputerUseHostContractDiagnosticsResult, ComputerUseHostContractEvidence, ComputerUseOfficialParentHandoffDiscovery, ComputerUseOfficialParentHandoffEvidence, ComputerUseOfficialParentHandoffKind, ComputerUseOfficialParentHandoffMethod, ProjectMemoryEmbedHealthDto, ProjectMemoryEmbedResultDto, ProjectMemoryEmbedIndexRecordDto, ProjectMemoryHealthState, ProjectMemoryReviewState, NoteCardAttachment, CcSwitchAppType, CcSwitchProviderList, GeminiVendorPreflightResult, GeminiVendorSettings, VendorModelListResult, OpenAppPresetProbeResult, OpenAppTargetProbeResult, WorktreeSetupStatus, GitPullOptions, GitPushOptions, GitResetMode, DetachedExternalChangeMonitorStatus, EngineTaskOutputArtifactTailResponse, ExportRewindFilesParams, ExternalSpecFileResponse, WorkspaceCommandResult, WorkspaceDirectorySpecialKind, WorkspaceFileItemKind, WorkspaceFileListingCacheState, WorkspaceFileOperationResult, EngineActiveProcessDiagnostics, EngineOsChildLivenessEvidence, EngineStaleChildCandidate, EngineWorkspaceActiveProcessDiagnostics, ClaudeSessionSummaryPayload, ThreadListPayload, ThreadListResultPayload

### src/features/project-map/index.ts（exports 25 / types 29）

- exports: ProjectMapPanel, __resetProjectMapWorkerClaimsForTests, useProjectMapDataset, buildDatasetFromProjectMapRead, readProjectMapDataset, serializeProjectMapDataset, writeProjectMapDataset, deriveProjectMapStorageKey, hashWorkspaceIdentity, isProjectMapRelativePath, markStaleNodesBySourceHash, sortSourcesByEvidencePriority, validateProjectMapNodePatch, buildProjectMapAgentTaskContextPack, buildProjectMapContextPack, buildProjectMapAgentTaskContext, collectProjectMapGovernanceLinks, extractOpenSpecMetadata, extractTrellisTaskMetadata, classifyProjectMapRefresh, getProjectMapNodeStaleReasons, repairProjectMapGraphIntegrity, validateProjectMapGraphIntegrity, confirmProjectMapCandidate, rejectProjectMapCandidate
- types: ProjectMapAutoIngestionSettings, ProjectMapAgentTaskContext, ProjectMapCandidate, ProjectMapChangedFileFingerprint, ProjectMapConfidence, ProjectMapContextPack, ProjectMapDataset, ProjectMapEvidenceRecord, ProjectMapGenerationRequest, ProjectMapGraphIntegrityIssue, ProjectMapGraphRepairSummary, ProjectMapGovernanceLink, ProjectMapLens, ProjectMapLensId, ProjectMapLensStats, ProjectMapLensStatus, ProjectMapManifest, ProjectMapMemoryIngestionCursor, ProjectMapNode, ProjectMapNodeDetail, ProjectMapNodePatch, ProjectMapOpenSpecMetadata, ProjectMapRefreshClassification, ProjectMapRefreshSummary, ProjectMapRunMetadata, ProjectMapSource, ProjectMapStaleReason, ProjectMapTrellisTaskMetadata, ProjectMapGenerationDefaults

### src/features/browser-agent/index.ts（exports 36 / types 15）

- exports: BrowserDock, BrowserEvidencePanel, BrowserActionAuditTrail, BROWSER_AGENT_ATTACHMENT_STALE_AFTER_MS, BROWSER_AGENT_CLOSED_SESSION_CLEANUP_AFTER_MS, BROWSER_AGENT_EVIDENCE_RETENTION_DAYS, BROWSER_AGENT_EVIDENCE_RETENTION_POLICY, buildBrowserObservation, buildBrowserContextAttachment, buildBrowserContextSnapshot, deriveBrowserObservationStaleReasons, formatBrowserContextPrompt, isBrowserContextAttachmentStale, parseBrowserContextPrompt, sanitizeBrowserSnapshotText, stripBrowserContextPrompt, buildBrowserEvidenceCopyText, buildBrowserEvidenceViewModel, buildBrowserEvidenceViewModelFromTaskRunEvidence, buildAnnotatedVisualEvidenceBlockedDiagnostic, buildBrowserUserAnnotationFromSelectedElement, buildBrowserUserAnnotation, formatBrowserUserAnnotationEvidence, reconcileBrowserUserAnnotationStaleReasons, buildBrowserActionPreview, confirmBrowserActionPreview, resolveBrowserActionGate, buildBrowserOcrTextSupplement, buildBrowserScreenshotReference, resolveBrowserVisualEvidenceGate, openBrowserCodeCandidateWithExistingNavigator, resolveBrowserCodeCandidateOpenTarget, clearActiveBrowserContextSession, getActiveBrowserContext, setActiveBrowserContextSession, subscribeActiveBrowserContext
- types: BrowserEvidenceRetentionPolicy, BrowserEvidenceSectionState, BrowserEvidenceViewModel, BrowserEvidenceViewModelSection, BrowserUserAnnotationContext, BrowserUserAnnotationInput, BrowserActionPreviewInput, ConfirmBrowserActionInput, BrowserVisualEvidenceGateInput, BrowserScreenshotReferenceInput, BrowserCodeCandidateOpenTarget, ActiveBrowserContextState, BrowserContextAttachmentOptions, BrowserSnapshotBuilderInput, BrowserSnapshotSanitizationResult

### src/features/multi-agent/index.ts（exports 48 / types 3）

- exports: MultiAgentComposerToggle, isMultiAgentTargetSupported, MultiAgentConversationSurface, AgentInspectorDrawer, TemplateManagerModal, StageTargetPicker, openAgentInspector, closeAgentInspector, selectAgentRound, useAgentInspectorSelection, isMultiAgentEnabled, multiAgentContextBlockReason, requestAgentPlan, approveAndExecuteAgent, rejectAndReplanAgent, stopAgent, forceStopAndUnlock, retryCollabRun, retryAgentStage, hydrateAgentProjection, isActiveAgentProjection, registerCollabThreadProcessingMarker, setCollabThreadProcessing, applyCollabThreadProcessingFromProjection, applyCollabThreadProcessingFromStatus, restoreCollabThreadProcessingIfActive, subscribeMultiAgentConversationItems, useAgentProjection, useAgentRoundList, publishAgentProjection, isAgentAttempt, findCanonicalAgentRunId, registerAgentConversationEvidence, getAgentEvidenceRunId, getSelectedTemplate, selectTemplate, useSelectedTemplate, templateToStageBindings, templateFlowLabel, isTerminalAgentStatus, multiAgentUserItemId, multiAgentHistFoldItemId, filterMultiAgentCanvasItems, isMultiAgentSettledSummaryItemId, stripCollabInternalPrompt, isCollabInternalPromptText, COLLAB_BRIEFING_MARKER, COLLAB_SUMMARY_MARKER
- types: AgentProjectionV1, AgentRunStatus, CollaborationTemplate

### src/features/subagent-ui/index.ts（exports 39 / types 4）

- exports: assignPersona, assignPersonaName, assignPersonaNamesForSquad, assignPersonasForSquad, extractCollabActionName, isCollabLifecycleTool, isSubagentOutputPoller, buildSubagentCardFromToolItem, buildSubagentCardsFromToolItems, dedupeSubagentSquadCards, enrichCardsWithChildThreads, expandSubagentToolToCards, extractAgentId, extractSwarmAgentEntries, extractClaudeParentSessionIdFromAgentOutput, isClaudeAsyncAgentLaunchOutput, isOpaqueCiphertext, looksLikeClaudeAgentId, resolveClaudeSubagentSessionFromContext, resolveClaudeSubagentThreadId, resolveSubagentProgress, buildSyntheticSpawnToolsFromChildren, hasBlockingSubagentToolSource, injectSyntheticSubagentToolsIfNeeded, shouldInjectChildSubagentSynthetic, collectSubagentStyleNotificationsFromItems, matchToolItemToNotificationToolUseId, isSubagentFinishedOutput, resolveSyntheticChildToolStatus, getSubagentInspectorSelection, syncSubagentInspectorFromCards, syncSubagentInspectorSelection, clearSubagentSessionProbeStore, getSubagentSessionProbeSnapshot, mergeSubagentEnrichmentSources, publishSubagentSessionProbe, useSubagentSessionProbeVersion, SubagentChatSplit, SubagentProgressBar
- types: ChildThreadHint, SubagentCardStatus, ChildSubagentSyntheticEligibilityInput, EnrichTimelineSyntheticSubagentInput

### src/features/markdown/fastMarkdownRenderer/index.ts（exports 19 / types 12）

- exports: getCachedFastMarkdownRender, setCachedFastMarkdownRender, clearFastMarkdownRenderCache, getFastMarkdownRenderCacheSize, isFastMarkdownProfile, extractMarkdownOutline, slugifyHeadingTitle, extractHeavyBlocks, attachSourceLineAttrs, sanitizeFastMarkdownHtml, isSafeHref, useFastMarkdownRender, compileFastMarkdownInWorker, compileFastMarkdownWithWorkerFallback, disposeFastMarkdownWorker, getFastMarkdownWorkerDiagnostics, resetFastMarkdownWorkerDiagnostics, getFastMarkdownHookDiagnostics, resetFastMarkdownHookDiagnostics
- types: CompileFastMarkdownArgs, FastMarkdownCompileCacheKey, FastMarkdownFallbackReason, FastMarkdownHeavyBlock, FastMarkdownRenderDiagnostics, FastMarkdownRenderResult, FastMarkdownUnsafeArtifact, MarkdownHeavyBlockKind, MarkdownSourceLineAnchor, FastMarkdownHookDiagnostics, FastMarkdownWorkerDiagnostics, FileMarkdownFastPreviewProps

### src/features/governance/evidence/index.ts（exports 10 / types 12）

- exports: collectGovernanceEvidence, createGovernanceConfigTemplate, deriveProjectGovernanceProfile, governanceEvidenceAdapters, selectEvidenceAdapters, findGovernanceEvidenceBySource, consolidateHarnessGateEvidence, createCapabilityGovernanceEvidence, createCostBudgetGovernanceEvidence, createGateGovernanceEvidence
- types: GovernanceEcosystem, GovernanceGateProfile, ProjectGovernanceProfile, EvidenceAdapter, ConsolidatedHarnessGateDecision, GateEvidenceInput, GovernanceEvidencePayload, GovernanceEvidenceSource, GovernanceEvidenceStatus, HarnessGovernanceEvidenceSource, LegacyGovernanceEvidenceSource, WorkspaceGovernanceSnapshot

### src/features/browser-agent/utils/index.ts（exports 9 / types 4）

- exports: buildBrowserObservation, deriveBrowserObservationStaleReasons, formatBrowserContextPrompt, parseBrowserContextPrompt, stripBrowserContextPrompt, buildBrowserContextSnapshot, sanitizeBrowserSnapshotText, buildBrowserCodeCandidates, BROWSER_AGENT_READ_ONLY_CAPTURE_SCRIPT
- types: BrowserContextAttachmentOptions, BrowserSnapshotBuilderInput, BrowserSnapshotSanitizationResult, BrowserCodeCandidateInput

### src/services/tauri/browserAgent.ts（exports 10 / types 0）

- exports: getBrowserAgentSettings (ns tauriService), getBrowserAgentPlatformCapability (ns tauriService), routeBrowserAgentProvider (ns tauriService), cleanupBrowserAgentSessions (ns tauriService), listBrowserAgentEvidence (ns tauriService), cleanupBrowserAgentEvidence (ns tauriService), captureBrowserAgentSnapshotV2 (ns tauriService), refreshBrowserAgentSnapshot (ns tauriService), generateBrowserAgentCodeCandidates (ns tauriService), runBrowserAgentAction (ns tauriService)

### src/features/extensions/tokentracker-dashboard/lib/native-bridge.js（exports 10 / types 0）

- exports: isNativeWindowsApp, isBridgeAvailable, notifyNative, requestNativeSettings, nativeAction, onNativeSettings, isPetBridgeAvailable, requestNativePetSettings, setNativePetSetting, onNativePetSettings

### src/features/curated-skills/index.ts（exports 7 / types 1）

- exports: useCuratedSkills, useCuratedSkillToggle, resolveLucideIcon, FALLBACK_ICON, resolveCategoryLabel, CATEGORY_LABELS_I18N, CATEGORY_DEFAULTS
- types: CuratedCategory

### src/components/ui/card.tsx（exports 8 / types 0）

- exports: CardFrame, CardFrameHeader, CardFrameTitle, CardFrameDescription, CardFrameFooter, CardAction, CardFooter, CardPanel

### src/features/messages/components/toolBlocks/toolConstants.ts（exports 7 / types 0）

- exports: BASH_TOOL_NAMES, READ_TOOL_NAMES, SEARCH_TOOL_NAMES, WEB_TOOL_NAMES, looksLikePathOnlyValue, normalizeCommandValue, TOOL_ICON_MAP

### src/features/messages/components/toolBlocks/index.ts（exports 7 / types 0）

- exports: GenericToolBlock, ReadToolBlock, EditToolBlock, BashToolBlock, SearchToolBlock, McpToolBlock, FileIcon

### src/services/events.ts（exports 6 / types 0）

- exports: subscribeAppServerEventBatch, subscribeRuntimeLogLine, subscribeMenuComposerCycleModel, subscribeMenuComposerCycleAccess, subscribeMenuComposerCycleReasoning, subscribeMenuComposerCycleCollaboration

### src/components/ui/dropdown-menu.tsx（exports 6 / types 0）

- exports: DropdownMenuPortal, DropdownMenuGroup, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuShortcut

### src/components/ai-elements/context.tsx（exports 6 / types 0）

- exports: ContextContentBody, ContextContentFooter, ContextInputUsage, ContextOutputUsage, ContextReasoningUsage, ContextCacheUsage

### src/services/tauri/session.ts（exports 5 / types 0）

- exports: deleteCodexSessions (ns tauriService), invalidateClaudeSessionListCache, resetClaudeSessionListCacheForTests, deleteQoderSession (ns tauriService), deleteDshSession (ns tauriService)

### src/features/shared-session/services/sharedSessions.ts（exports 5 / types 0）

- exports: rebuildSharedProjection, compareSharedProjection, sharedContextRetrieveArtifact, sharedContextScanOrphans, sharedSessionV2CommitTurn

### src/components/ui/alert-dialog.tsx（exports 5 / types 0）

- exports: AlertDialogCreateHandle, AlertDialogOverlay, AlertDialogTrigger, AlertDialogContent, AlertDialogClose

### src/features/browser-agent/evidence/index.ts（exports 2 / types 3）

- exports: buildBrowserEvidenceCopyText, buildBrowserSelectedElementPreview
- types: BrowserEvidenceSectionState, BrowserEvidenceViewModelSection, BrowserSelectedElementPreview

### src/features/browser-agent/annotations/index.ts（exports 3 / types 2）

- exports: buildAnnotatedVisualEvidenceBlockedDiagnostic, buildBrowserUserAnnotation, reconcileBrowserUserAnnotationStaleReasons
- types: BrowserUserAnnotationContext, BrowserUserAnnotationInput

### src/features/intent-canvas/index.ts（exports 3 / types 2）

- exports: IntentCanvasAttachmentCard, buildIntentCanvasContextAttachment, formatIntentCanvasThreadContext
- types: IntentCanvasDocument, IntentCanvasOpenSource

### src/features/composer/components/ChatInputBox/selectors/index.ts（exports 3 / types 2）

- exports: ModelSelect, SessionControlQuotaPane, buildAccountUsageSnapshot
- types: AccountUsageSnapshot, DshAgentPresetId

### src/features/browser-agent/actions/index.ts（exports 3 / types 2）

- exports: buildBrowserActionPreview, resolveBrowserActionGate, confirmBrowserActionPreview
- types: BrowserActionPreviewInput, ConfirmBrowserActionInput

### src/features/browser-agent/visual-evidence/index.ts（exports 3 / types 2）

- exports: resolveBrowserVisualEvidenceGate, buildBrowserOcrTextSupplement, buildBrowserScreenshotReference
- types: BrowserVisualEvidenceGateInput, BrowserScreenshotReferenceInput

### src/features/composer/components/ChatInputBox/providers/index.ts（exports 3 / types 1）

- exports: resetFileReferenceState, setupAgentsCallback, resetAgentsState
- types: PromptItem

### src/features/markdown/mermaidFullscreen/index.ts（exports 4 / types 0）

- exports: svgToDataUrl, setActiveViewer, _resetPreloadForTest, downloadMermaidPng

### src/features/project-map/components/ProjectMapPanelSurfaces.tsx（exports 4 / types 0）

- exports: ProjectMapRelationGroup, ProjectMapRelationInspector, ProjectMapEvidenceFilesPanel, InspectorList

### src/utils/customPrompts.ts（exports 4 / types 0）

- exports: buildPromptInsertText, buildCommandInsertText, findPromptArgRangeAtCursor, findNextPromptArgCursor

### src/components/ui/table.tsx（exports 4 / types 0）

- exports: TableBody, TableFooter, TableCell, TableCaption

### src/features/composer/components/ChatInputBox/hooks/index.ts（exports 4 / types 0）

- exports: useTriggerDetection, getRectAtCharOffset, computeResize, createUndoRedoHistory

### src/features/extensions/tokentracker-dashboard/lib/currency.ts（exports 4 / types 0）

- exports: CURRENCY_CNY, getCurrencyLabelKey, getSupportedCurrencies, applyCurrency

### src/features/vendors/hooks/useKimiProviderManagement.ts（exports 0 / types 4）

- types: KimiProviderLoadOptions, KimiProviderDialogState, DeleteKimiConfirmState, UseKimiProviderManagementReturn

### src/features/vendors/hooks/useGrokProviderManagement.ts（exports 0 / types 4）

- types: GrokProviderLoadOptions, GrokProviderDialogState, DeleteGrokConfirmState, UseGrokProviderManagementReturn

### src/features/vendors/hooks/useOpenCodeProviderManagement.ts（exports 0 / types 4）

- types: OpenCodeProviderLoadOptions, OpenCodeProviderDialogState, DeleteOpenCodeConfirmState, UseOpenCodeProviderManagementReturn

### src/features/composer/constants/performance.ts（exports 0 / types 4）

- types: TextLengthThresholds, RenderingLimits, PerfTiming, DebounceTiming

### src/features/app/hooks/useAppServerEvents.ts（exports 2 / types 1）

- exports: buildCoalescibleAppServerEventKey, isProviderContinuationBootstrapEvent
- types: AgentDelta

### src/utils/uiScale.ts（exports 3 / types 0）

- exports: UI_SCALE_STEP, formatUiScale, isUiScalePreset

### src/app-shell/hosts/appShellHostBus.tsx（exports 3 / types 0）

- exports: useHostSlice, useOptionalHostSlice, useHostSelector

### src/services/tauri/git.ts（exports 3 / types 0）

- exports: resolveGitCommitRef (ns tauriService), getGitBranchDiffBetweenBranches (ns tauriService), getGitBranchDiffFileBetweenBranches (ns tauriService)

### src/services/tauri/openCode.ts（exports 2 / types 1）

- exports: isOpenCodeSessionListUnavailableError, getOpenCodeProviderCatalog (ns tauriService)
- types: LspLocation
- duplicates: 

### src/features/app/components/StartupGateOverlay.tsx（exports 3 / types 0）

- exports: WINDOWS_STARTUP_GATE_FORCE_DISMISS_MS, WINDOWS_STARTUP_GATE_MIN_VISIBLE_MS, WINDOWS_STARTUP_GATE_MAX_VISIBLE_MS
- duplicates: , , 

### src/features/layout/hooks/useUiScaleShortcuts.ts（exports 3 / types 0）

- exports: UI_SCALE_COLD_START_MAX_DELAY_MS, UI_SCALE_AFTER_FORCE_ENTER_DELAY_MS, setUiScaleColdStartDeferForTests

### src/features/messages/utils/messagesRenderUtils.ts（exports 3 / types 0）

- exports: SCROLL_THRESHOLD_PX, resolveRenderableItems, buildAssistantFinalBoundaryMeta

### src/features/project-map/services/projectMapPersistence.ts（exports 3 / types 0）

- exports: writeProjectMapFiles, writeProjectMapRelationshipFiles, clearProjectMapRelationships

### src/features/session-activity/adapters/buildWorkspaceSessionActivity.ts（exports 1 / types 2）

- exports: createEmptyWorkspaceSessionActivityViewModel (ns workspaceSessionActivityAdapter)
- types: WorkspaceSessionActivityContext, WorkspaceSessionActivityThreadContext

### src/features/theme/utils/workspaceWallpaper.ts（exports 3 / types 0）

- exports: MIN_WORKSPACE_WALLPAPER_VEIL_OPACITY, MAX_WORKSPACE_WALLPAPER_VEIL_OPACITY, isWorkspaceWallpaperMode

### src/features/threads/utils/queuedHandoffBubble.ts（exports 3 / types 0）

- exports: areSameUserImages, normalizeComparableUserText, normalizeUserImages

### src/features/threads/hooks/sessionIndexThreadSummaries.ts（exports 3 / types 0）

- exports: isEmptyClaudeIndexFallbackTitle, filterSessionIndexRowsByEngine, isLocalPendingDraftSessionId

### src/features/threads/hooks/useQueuedSend.ts（exports 3 / types 0）

- exports: ENABLE_BACKGROUND_QUEUE_DRAIN, MAX_BACKGROUND_QUEUE_DRAIN, getEnableBackgroundQueueDrain

### src/services/tauri/workspaceFiles.ts（exports 3 / types 0）

- exports: listExternalAbsoluteDirectoryChildren (ns tauriService), copyWorkspaceItem (ns tauriService), pasteExternalWorkspaceItems (ns tauriService)

### src/features/composer/components/run-status/index.ts（exports 1 / types 2）

- exports: collectRunStatusSourceItems
- types: ComposerRunStatusStripProps, RunStatusSection

### src/components/ui/popover.tsx（exports 3 / types 0）

- exports: PopoverHeader, PopoverTitle, PopoverDescription

### src/features/browser-agent/code-bridge/index.ts（exports 2 / types 1）

- exports: openBrowserCodeCandidateWithExistingNavigator, resolveBrowserCodeCandidateOpenTarget
- types: BrowserCodeCandidateOpenTarget

### src/features/extensions/tokentracker-dashboard/lib/auth-token.js（exports 3 / types 0）

- exports: isValidJwtShape, isLikelyExpiredAccessToken, resolveAuthAccessTokenWithRetry

### src/features/shared-session/target/turnBadge.ts（exports 0 / types 3）

- types: TurnBadgeAvailability, TurnBadgeModel, TurnBadgeUnavailableReason

### src/types/engine.ts（exports 0 / types 3）

- types: EngineConfig, EngineSendMessageParams, EngineEvent

### src/services/clientStorage.ts（exports 2 / types 0）

- exports: CRITICAL_CLIENT_STORES (ns clientStorage), DEFERRED_CLIENT_STORES (ns clientStorage)

### src/features/threads/utils/threadStorage.ts（exports 2 / types 0）

- exports: loadAutoTitlePending, saveAutoTitlePending

### src/services/systemNotification.ts（exports 2 / types 0）

- exports: getCachedSystemNotificationPermissionState (ns systemNotification), getSystemNotificationPermissionState (ns systemNotification)

### src/features/app/constants.ts（exports 1 / types 1）

- exports: OPEN_APP_STORAGE_KEY
- types: OpenAppId

### src/features/vendors/types.ts（exports 2 / types 0）

- exports: isValidShapeOnlyCustomModel, isValidCodexCustomModel

### src/features/app/components/sidebarInternals.ts（exports 2 / types 0）

- exports: filterLiveSubagentSourceItems, buildLiveSubagentRows
- duplicates: , 

### src/features/app/hooks/useSidebarMenus.ts（exports 1 / types 1）

- exports: NEW_SESSION_ENGINE_ACTION_IDS
- types: WorkspaceMenuIconKind

### src/features/multi-agent/store/agentStore.ts（exports 2 / types 0）

- exports: getAgentRunHistory, getAgentAttemptOwner

### src/features/browser-agent/evidence/browserEvidenceViewModel.ts（exports 2 / types 0）

- exports: buildBrowserSelectedElementPreview, buildBrowserEvidenceCopyText

### src/features/composer/components/Composer.tsx（exports 1 / types 1）

- exports: __resetComposerHeavyWarmForTests
- types: NoteCardSelection

### src/features/intent-canvas/services/relationshipImportQueries.ts（exports 2 / types 0）

- exports: loadProjectMapRelationshipSnapshot, queryProjectMapRelationshipNeighborhood

### src/features/messages/utils/context/messagesNoteCardContext.ts（exports 2 / types 0）

- exports: parseNoteCardContextSummary, parseInjectedNoteCardContextFromUser

### src/features/multi-agent/templates/types.ts（exports 1 / types 1）

- exports: stageTargetLabel
- types: ReasoningEffortLevel

### src/features/multi-agent/types.ts（exports 2 / types 0）

- exports: targetBadge, defaultStageBindings

### src/features/threads/assembly/conversationNormalization.ts（exports 2 / types 0）

- exports: getPresentationContext, getPresentationContexts

### src/features/threads/hooks/useThreadActions.threadList.ts（exports 2 / types 0）

- exports: THREAD_LIST_TARGET_COUNT, DEFAULT_CLAUDE_CONTEXT_WINDOW
- duplicates: 

### src/features/threads/hooks/useThreads.ts（exports 2 / types 0）

- exports: resolvePendingThreadIdForSession, resolvePendingThreadIdForTurn

### src/features/markdown/fastMarkdownRenderer/__tests__/fixtures.ts（exports 2 / types 0）

- exports: BLOCKQUOTE_HR_FIXTURE, IMAGE_FIXTURE

### src/features/markdown/fastMarkdownRenderer/hookDiagnostics.ts（exports 2 / types 0）

- exports: getFastMarkdownHookDiagnostics, resetFastMarkdownHookDiagnostics

### src/features/messages/components/toolBlocks/EditToolGroupBlock.tsx（exports 2 / types 0）

- exports: mergeEditSceneStatus, normalizeEditScenePath

### src/services/tauri/tokentracker.ts（exports 2 / types 0）

- exports: ttServerStatus (ns tauriService), ttProxyRequest (ns tauriService)

### src/services/tauri/agents.ts（exports 2 / types 0）

- exports: getSelectedAgentConfig (ns tauriService), setSelectedAgentConfig (ns tauriService)

### src/features/markdown/imageFullscreen/index.ts（exports 1 / types 1）

- exports: resolveImageViewerSrc
- types: ResolvedImageViewerSrc

### src/components/ui/progress.tsx（exports 2 / types 0）

- exports: ProgressLabel, ProgressValue

### src/components/ui/dialog.tsx（exports 2 / types 0）

- exports: DialogClose, DialogTrigger

### src/features/engine/hooks/engineDetectionCoordinator.ts（exports 2 / types 0）

- exports: resetEngineDetectionCoordinatorForTests, EngineDetectionTimeoutError

### src/components/ui/command.tsx（exports 2 / types 0）

- exports: CommandDialog, CommandShortcut

### src/features/settings/components/settings-view/actions/settingsViewActions.ts（exports 2 / types 0）

- exports: normalizeOverrideValue, buildWorkspaceOverrideDrafts

### src/features/threads/hooks/useThreadActions.helpers.recovery.ts（exports 2 / types 0）

- exports: selectReplacementThreadSummary, scoreReplacementThreadCandidates

### src/features/extensions/tokentracker-dashboard/ui/foundation/TokenFormatProvider.jsx（exports 2 / types 0）

- exports: TokenFormatModeOverride, TOKEN_FORMAT_MODES

### src/lib/spec-core/runtimeParse.ts（exports 2 / types 0）

- exports: derivePreflightHints, deriveAffectedSpecs

### src/features/extensions/tokentracker-dashboard/lib/safe-browser.ts（exports 2 / types 0）

- exports: safeWriteClipboard, safeWriteClipboardImage

### src/app-shell/domains/composerProvider.tsx（exports 2 / types 0）

- exports: useComposerContext, useComposerCanInterrupt

### src/app-shell/domains/layoutChromeProvider.tsx（exports 2 / types 0）

- exports: useLayoutChromeContext, useOptionalLayoutChromeContext

### src/services/tauri/agentOrchestration.ts（exports 2 / types 0）

- exports: sharedAgentRecordPlan, sharedAgentRecordReview

### src/features/extensions/tokentracker-dashboard/ui/foundation/FadeIn.jsx（exports 2 / types 0）

- exports: StaggerContainer, StaggerItem

### src/services/tauri/sessionManagement.ts（exports 0 / types 2）

- types: AutoSessionCreatedBy, AutoSessionVisibility

### src/features/project-map/types.ts（exports 0 / types 2）

- types: ProjectMapRelationshipManifest, ProjectMapRelationshipRepairSummary

### src/features/threads/domain-events/eventFactories.ts（exports 0 / types 2）

- types: DomainEventFactoryCommonInput, DomainEventUsageInput

### src/features/vendors/hooks/useProviderManagement.ts（exports 0 / types 2）

- types: ClaudeProviderActionResult, UseProviderManagementReturn

### src/features/composer/components/ChatInputBox/types.ts（exports 0 / types 2）

- types: CodeSnippet, UsageInfo

### src/types/interaction.ts（exports 0 / types 2）

- types: DirectoryGrantRequest, DirectoryGrantDecision

### src/features/threads/adapters/sharedRealtimeAdapter.ts（exports 0 / types 2）

- types: EngineRealtimeAdapter, RawRealtimeAdapterInput

### src/utils/shortcuts.ts（exports 1 / types 0）

- exports: matchesShortcut

### src/app-shell/domains/appShellDomainOwnershipGate.ts（exports 1 / types 0）

- exports: findDuplicateRawContextKeys

### src/app-shell/domains/runtimeThreadProvider.tsx（exports 1 / types 0）

- exports: useRuntimeThreadContext

### src/app-shell/domains/appModeSurfaceFlags.ts（exports 1 / types 0）

- exports: useAppModeSurfaceFlags

### src/app-shell/sections/useWorkspaceThreadListHydration.ts（exports 1 / types 0）

- exports: COLD_START_FIRST_PAINT_DELAY_MS
- duplicates: 

### src/components/ui/tooltip.tsx（exports 1 / types 0）

- exports: TooltipCreateHandle

### src/features/layout/components/SidebarToggleControls.tsx（exports 1 / types 0）

- exports: RightPanelCollapseButton

### src/features/client-ui-visibility/utils/clientUiVisibility.ts（exports 1 / types 0）

- exports: DEFAULT_CLIENT_UI_VISIBILITY_QUERIES

### src/features/files/detachedFileExplorer.ts（exports 1 / types 0）

- exports: hasDetachedFileExplorerWindow

### src/features/markdown/messageMarkdownPrecompute.ts（exports 1 / types 0）

- exports: shouldPrecomputeMessageMarkdown

### src/features/quick-switcher/recentFiles.ts（exports 1 / types 0）

- exports: getQuickSwitcherRecentFiles

### src/features/session-side-effects/sessionSideEffectLedger.ts（exports 1 / types 0）

- exports: subscribeSessionSideEffectLedger

### src/features/threads/constants/codexProviderProfiles.ts（exports 1 / types 0）

- exports: QODER_LOCAL_PROVIDER_PROFILE_NAME
- duplicates: 

### src/features/markdown/markdownMath.ts（exports 1 / types 0）

- exports: getCachedKatex

### src/services/perfBaseline/startupMarkers.ts（exports 1 / types 0）

- exports: getStartupPerfSnapshotForTests

### src/services/tauri/sessionIndex.ts（exports 1 / types 0）

- exports: syncSessionIndexForWorkspace (ns tauriService)

### src/services/tauri/skills.ts（exports 1 / types 0）

- exports: getCuratedSkillBodies (ns tauriService)

### src/features/app/utils/openApp.ts（exports 1 / types 0）

- exports: getSelectedOpenAppId

### src/features/threads/utils/realtimePerfFlags.ts（exports 1 / types 0）

- exports: isStreamingScheduleAggressiveEnabled

### src/features/shared-session/target/targetStore.ts（exports 1 / types 0）

- exports: clearPersistGeneration

### src/features/browser-agent/annotations/browserSelectionIdentity.ts（exports 1 / types 0）

- exports: browserSelectionIdentityFromElement

### src/features/context-ledger/budget/budgetStore.ts（exports 1 / types 0）

- exports: createBudgetStore

### src/features/context-ledger/pricing/pricingRegistry.ts（exports 1 / types 0）

- exports: listPricingSources

### src/features/engine-task-output/utils/engineTaskOutputProjection.ts（exports 1 / types 0）

- exports: mapSubagentStatusToTaskOutputStatus

### src/features/git/utils/commitMessageMenuConfig.ts（exports 1 / types 0）

- exports: readExecutableCommitMessageConfig

### src/features/governance/evidence/governanceEvidenceBridge.ts（exports 1 / types 0）

- exports: findGovernanceEvidenceBySource

### src/features/governance/evidence/gateArtifactEvidenceReader.ts（exports 1 / types 0）

- exports: gateArtifactEvidenceReaderInternals

### src/features/governance/evidence/projectGovernanceProfile.ts（exports 1 / types 0）

- exports: projectGovernanceProfileInternals

### src/features/governance/evidence/scriptEvidenceReader.ts（exports 1 / types 0）

- exports: scriptEvidenceReaderInternals

### src/features/governance/evidence/trellisEvidenceReader.ts（exports 1 / types 0）

- exports: trellisEvidenceReaderInternals

### src/features/governance/evidence/workflowEvidenceReader.ts（exports 1 / types 0）

- exports: workflowEvidenceReaderInternals

### src/features/intent-canvas/utils/scene.ts（exports 1 / types 0）

- exports: getIntentCanvasGraphGeneratedElementIds

### src/features/layout/hooks/workspaceHeaderGroups.ts（exports 1 / types 0）

- exports: workspaceHeaderGroupsInternals

### src/features/threads/contracts/conversationAssembler.ts（exports 1 / types 0）

- exports: CONVERSATION_STATE_DIFF_WHITELIST

### src/features/messages/utils/backgroundTaskStore.ts（exports 1 / types 0）

- exports: countRunningBackgroundTasks

### src/live-canvas/liveCanvasControls.ts（exports 1 / types 0）

- exports: MESSAGES_LIVE_COLLAPSE_MIDDLE_STEPS_FLAG_KEY

### src/features/messages/utils/useBackgroundTaskRegistryWatcher.ts（exports 1 / types 0）

- exports: revealBackgroundTaskLog

### src/features/multi-agent/components/ComposerToggle.tsx（exports 1 / types 0）

- exports: templateFlowLabel

### src/features/multi-agent/runtime/collabNativeHideRegistry.ts（exports 1 / types 0）

- exports: __debugCollabWorkerRawHideIds

### src/features/onboarding/utils/editorHabit.ts（exports 1 / types 0）

- exports: isEditorHabitId

### src/features/project-map/utils/navigation.ts（exports 1 / types 0）

- exports: queryMatchesProjectMapPath

### src/features/project-map/utils/evidencePaths.ts（exports 1 / types 0）

- exports: looksLikeProjectMapWorkspaceFilePath

### src/features/project-map/utils/interactiveLayout.ts（exports 1 / types 0）

- exports: getProjectMapGraphPositionMap

### src/features/project-memory/memoryPick/memoryPickTypes.ts（exports 1 / types 0）

- exports: PICK_RETRIEVE_TIMEOUT_MS

### src/features/project-memory/memoryPick/memoryEmptyReasonToast.ts（exports 1 / types 0）

- exports: DEFAULT_MEMORY_PICK_EMPTY_TOAST_COPY
- duplicates: 

### src/features/project-memory/memoryPick/memoryPickTelemetry.ts（exports 1 / types 0）

- exports: getMemoryPickTelemetrySink

### src/features/project-memory/utils/projectMemoryCleaner.ts（exports 1 / types 0）

- exports: buildProjectMemoryCleanerFailureResult

### src/features/project-memory/utils/projectMemoryRetrievalPack.ts（exports 1 / types 0）

- exports: PROJECT_MEMORY_PACK_OPEN_TAG

### src/lib/spec-core/runtime.ts（exports 1 / types 0）

- exports: diagnoseSpecEnvironment

### src/features/messages/orchestration/presentation/messagesViewModel.ts（exports 1 / types 0）

- exports: isMessagesScrollNearBottom

### src/services/tauri/settings.ts（exports 1 / types 0）

- exports: getCodexConfigPath (ns tauriService)

### src/features/threads/loaders/claudeHistoryLoader.ts（exports 1 / types 0）

- exports: recoverClaudeInterruptedAssistantFromShadow

### src/features/threads/utils/turnTraceCorrelation.ts（exports 1 / types 0）

- exports: TURN_TRACE_MILESTONE_NAMES

### src/features/threads/contracts/realtimePerfExtendedFixture.ts（exports 1 / types 0）

- exports: buildRealtimeTurnTraceEvents

### src/features/threads/domain-events/domainEventGovernanceConsumer.ts（exports 1 / types 0）

- exports: domainEventGovernanceConsumerInternals

### src/features/threads/hooks/useThreadItemEvents.ts（exports 1 / types 0）

- exports: shouldUrgentlyDispatchReasoningDelta

### src/features/update/utils/changelogParser.ts（exports 1 / types 0）

- exports: toReleaseNotesCatalogItem

### src/features/threads/utils/runtimeSessionScheduling.ts（exports 1 / types 0）

- exports: emptyRuntimeOutputBufferState

### src/features/threads/utils/streamLatencyDiagnostics.ts（exports 1 / types 0）

- exports: noteThreadBatchFlushBoundary

### src/features/threads/utils/turnTargetBadgeStorage.ts（exports 1 / types 0）

- exports: resetTurnTargetBadgeStorageForTests

### src/features/threads/hooks/threadEventDiagnostics.ts（exports 1 / types 0）

- exports: resolveRefSettledAt

### src/features/extensions/tokentracker-dashboard/lib/skills-api.ts（exports 1 / types 0）

- exports: getSkillActivity

### src/features/messages/utils/context/messagesMemoryContext.ts（exports 1 / types 0）

- exports: parseInjectedMemoryPrefixFromUser

### src/features/composer/components/ChatInputBox/providers/agentProvider.ts（exports 1 / types 0）

- exports: setupAgentsCallback

### src/features/settings/components/settings-view/sections/CostBudgetSettingsSection.tsx（exports 1 / types 0）

- exports: costBudgetSettingsSectionInternals

### src/services/tauri/usage.ts（exports 1 / types 0）

- exports: localUsageSnapshot (ns tauriService)

### src/services/tauri/modelCatalog.ts（exports 1 / types 0）

- exports: generateRunMetadata (ns tauriService)

### src/services/tauri/rendererStability.ts（exports 1 / types 0）

- exports: getRendererStabilitySnapshot (ns tauriService)

### src/services/tauri/projectMemoryEmbed.ts（exports 1 / types 0）

- exports: projectMemoryEmbedIndexClear (ns tauriService)

### src/features/composer/components/ChatInputBox/providers/fileReferenceProvider.ts（exports 1 / types 0）

- exports: resetFileReferenceState

### src/features/browser-agent/browserAgentDockWindow.ts（exports 1 / types 0）

- exports: openOrFocusBrowserAgentDockWindow

### src/features/intent-canvas/utils/messageContext.ts（exports 1 / types 0）

- exports: parseIntentCanvasContextSummary

### src/features/models/customModelReasoning.ts（exports 1 / types 0）

- exports: resolveCustomModelDefaultReasoningEffort

### src/features/project-map/utils/relationshipDashboardModel.ts（exports 1 / types 0）

- exports: buildProjectMapRelationshipSentence

### src/features/markdown/mermaidFullscreen/preloadViewerjs.ts（exports 1 / types 0）

- exports: _resetPreloadForTest

### src/features/app/components/userInputTimeout.ts（exports 1 / types 0）

- exports: USER_INPUT_MCP_TOOL_TIMEOUT_MS

### src/components/ui/kbd.tsx（exports 1 / types 0）

- exports: KbdGroup

### src/features/skills/utils/managedInstructionSource.ts（exports 1 / types 0）

- exports: isGlobalManagedInstructionSource

### src/features/git/components/GitDiffPanelInclusion.tsx（exports 1 / types 0）

- exports: getInclusionStateForScope

### src/features/messages/utils/messageItemPredicates.ts（exports 1 / types 0）

- exports: isMessageConversationItem

### src/features/multi-agent/templates/templateStore.ts（exports 1 / types 0）

- exports: getSelectedTemplateId

### src/features/project-map/utils/generationRequests.ts（exports 1 / types 0）

- exports: validateStructuredProjectMapPatch

### src/features/project-map/utils/display.ts（exports 1 / types 0）

- exports: translateProjectMapSourceType

### src/features/project-map/components/ProjectMapRelationshipWorkspaces.tsx（exports 1 / types 0）

- exports: ProjectMapRelationshipApiWorkspace

### src/features/project-memory/memoryPick/memoryRetrieveKernel.ts（exports 1 / types 0）

- exports: hybridRerankPoolToCandidates

### src/components/ui/select.tsx（exports 1 / types 0）

- exports: SelectButton

### src/features/status-panel/utils/governanceEvidenceViewModel.ts（exports 1 / types 0）

- exports: governanceEvidenceViewModelInternals

### src/features/threads/hooks/threadMemoryCaptureHelpers.ts（exports 1 / types 0）

- exports: extractNovelAssistantOutput

### src/features/threads/hooks/queuedSendHelpers.ts（exports 1 / types 0）

- exports: ENABLE_BACKGROUND_QUEUE_DRAIN

### src/features/vendors/providerBrandIcon.ts（exports 1 / types 0）

- exports: QWEN_BRAND_ICON_SRC

### src/features/composer/components/ChatInputBox/utils/selectionUtils.ts（exports 1 / types 0）

- exports: getCursorOffset

### src/features/subagent-ui/components/SubagentChatSplit.tsx（exports 1 / types 0）

- exports: SubagentChatSplit

### src/features/extensions/tokentracker-dashboard/lib/local-api-auth.ts（exports 1 / types 0）

- exports: clearLocalApiAuthToken

### src/features/files/components/FileMarkdownPreviewRouter.tsx（exports 1 / types 0）

- exports: clearFileMarkdownPreviewRuntimeCachesForTests

### src/features/messages/components/toolBlocks/ToolMarkerShell.tsx（exports 1 / types 0）

- exports: TOOL_META_ICON_PX

### src/features/messages/components/Markdown.tsx（exports 1 / types 0）

- exports: prewarmKatexAssets

### src/features/browser-agent/constants.ts（exports 1 / types 0）

- exports: BROWSER_AGENT_EVIDENCE_RETENTION_POLICY

### src/features/multi-agent/runtime/executor.ts（exports 1 / types 0）

- exports: isActiveAgentProjection

### src/features/threads/hooks/useThreadsReducerAssistantDedup.ts（exports 1 / types 0）

- exports: getAssistantEquivalenceMinChars

### src/features/project-map/components/ProjectMapEvidenceFilesPanel.tsx（exports 1 / types 0）

- exports: ProjectMapEvidenceFilesPanel

### src/features/app/hooks/useOpenAppTargetHealth.ts（exports 1 / types 0）

- exports: __resetOpenAppTargetHealthCacheForTests

### src/features/extensions/tokentracker-dashboard/ui/dashboard/components/ActivityHeatmap3D.jsx（exports 1 / types 0）

- exports: default
- duplicates: 

### src/utils/threadItems.ts（exports 0 / types 1）

- types: ClaudeApprovalResumeEntry

### src/app-shell/hosts/appShellFeatureActivation.ts（exports 0 / types 1）

- types: AppShellFeatureActivation

### src/app-shell/sections/utils.ts（exports 0 / types 1）

- types: ThreadCompletionTracker

### src/app-shell/domains/useGitSurfaceRepositoryActionsHost.ts（exports 0 / types 1）

- types: GitSurfaceRepositoryActionsHost

### src/app-shell/domains/useWorkspaceSessionHost.ts（exports 0 / types 1）

- types: WorkspaceSessionHost

### src/features/app/hooks/useWorkspaceRuntimeRun.ts（exports 0 / types 1）

- types: RuntimeConsoleStatus

### src/features/markdown/fastMarkdownRenderer/types.ts（exports 0 / types 1）

- types: FastMarkdownCompileCacheKey

### src/features/spec/specHubVisibleCopyKeys.ts（exports 0 / types 1）

- types: SpecHubVisibleCopyKey

### src/features/app/components/sidebarVirtualItems.ts（exports 0 / types 1）

- types: SidebarVirtualItemKind

### src/features/git/utils/gitChangeModel.ts（exports 0 / types 1）

- types: CanonicalGitChange

### src/features/threads/contracts/conversationCurtainContracts.ts（exports 0 / types 1）

- types: ConversationAssembler

### src/types/conversation.ts（exports 0 / types 1）

- types: Message

### src/features/update/hooks/useReleaseNotes.ts（exports 0 / types 1）

- types: ReleaseNotesCatalogItem

### src/features/messages/presentation/sharedProjection/types.ts（exports 0 / types 1）

- types: SharedProjectionCheckpoint

### src/features/vendors/hooks/useCodexProviderManagement.ts（exports 0 / types 1）

- types: UseCodexProviderManagementReturn

### src/features/vendors/hooks/useGeminiVendorManagement.ts（exports 0 / types 1）

- types: UseGeminiVendorManagementReturn

### src/features/composer/components/run-status/useComposerRunStatus.ts（exports 0 / types 1）

- types: ComposerRunStatusModel

### src/features/files/components/FileMarkdownPreviewFast.tsx（exports 0 / types 1）

- types: FileMarkdownPreviewFastProps

### src/features/messages/components/context/CollapsibleUserTextBlock.tsx（exports 0 / types 1）

- types: UserTextParseResult

### src/types/usage.ts（exports 0 / types 1）

- types: LocalUsageSessionSummary

### src/features/curated-skills/hooks/useCuratedSkills.ts（exports 0 / types 1）

- types: UseCuratedSkillsResult

### src/features/threads/domain-events/events/base.ts（exports 0 / types 1）

- types: DomainEventFactoryInput

### src/features/composer/components/run-status/types.ts（exports 0 / types 1）

- types: RunStatusPillId

### src/app-shell/domains/useComposerDomainHost.ts（exports 0 / types 1）

- types: ComposerDomainHost

### src/app-shell/domains/useConversationDomainHost.ts（exports 0 / types 1）

- types: ConversationDomainHost

## 依赖项结论

- shadcn（devDependency）：无任何 script/import 引用，仅 CLI 工具，可按需移除或保留。
- xmlchars / yocto-queue（devDependencies, file:vendor/）：**knip 误报，禁止删除**。npm ls 证实它们是 eslint→p-limit→yocto-queue 与 jsdom→saxes→xmlchars 的 dedupe 目标。

## 未覆盖范围

- src-tauri（Rust）：knip 不覆盖；如需排查用 cargo check 的 dead_code warnings，单独一轮处理。
