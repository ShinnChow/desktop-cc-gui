import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { shouldUpgradeComposerFromLight } from "../utils/composerGateUpgrade";
import { getStartupGateReadyReason } from "../../startup-orchestration/utils/startupGateReady";
import type {
  ConversationItem,
  MessageSendOptions,
} from "../../../types";
import {
  hydrateSharedTargetState,
  getSharedTargetState,
  beginSharedTargetPersist,
  endSharedTargetPersist,
} from "../../shared-session/target/targetStore";
import {
  freezeTurnSnapshot,
  isAtomicExecutionTarget,
  isResolvedExecutionTarget,
  resolveBackendAuthoritativeExecutionTarget,
  type ExecutionTarget,
} from "../../shared-session/target/types";
import { persistSharedSessionSelectedTarget } from "../../shared-session/services/sharedSessions";
import { shouldSuppressSharedTargetPersistToast } from "../../shared-session/target/sharedTargetPersistErrors";
import { resolveComposerAtomicSelectedModelId } from "../utils/resolveComposerAtomicSelectedModelId";
import { deriveDshSessionStatsLine } from "../utils/dshSessionStats";
import {
  resolveDshAtomicCatalogIdForSend,
} from "../utils/dshNativeModelSelection";
import { dispatchSharedSendEvent } from "../../shared-session/runtime/sharedSendStateStore";
import { requestProviderContinuationDialog } from "../../threads/services/providerContinuationRequests";
import { useComposerAutocompleteState } from "../hooks/useComposerAutocompleteState";
import { useComposerDraft } from "../hooks/composerDraftStore";
import { markExplicitComposerEngineSwitch } from "../hooks/explicitComposerEngineSwitch";
import {
  ensureInteractiveInputHooks,
  getLastInteractiveInputAtMs,
  hadRecentInteractiveInput,
} from "../../../utils/interactiveMainThread";
import { ChatInputBoxAdapter } from "./ChatInputBox/ChatInputBoxAdapter";
import { ComposerLight } from "./ComposerLight";
import type { ChatInputBoxHandle } from "./ChatInputBox/ChatInputBoxAdapter";
import { isSameProviderExecutionProfile } from "./ChatInputBox/selectors/model-select/executionTarget";
import {
  accessModeToPermissionMode,
  permissionModeToAccessMode,
  type ProviderId,
} from "./ChatInputBox/types";
import {
  ClaudeRewindConfirmDialog,
} from "./ClaudeRewindConfirmDialog";
import {
  ComposerBranchBadge,
} from "./ComposerBranchBadge";
import { ContextBar } from "./ChatInputBox/ContextBar";
import { TokenIndicator } from "./ChatInputBox/TokenIndicator";
import { DshSessionStatsLine } from "./DshSessionStatsLine";
import type {
  PermissionMode,
  SelectedAgent as ChatInputSelectedAgent,
} from "./ChatInputBox/types";
import { ComposerRunStatusStrip } from "./run-status";
import {
  assembleSinglePrompt,
  expandLeadingManagedCommand,
  assembleSkillInvocations,
  shouldAssemblePrompt,
} from "../utils/promptAssembler";
import { buildComposerSendReadiness } from "../utils/composerSendReadiness";
import {
  appendCodeAnnotationsToPrompt,
  buildCodeAnnotationDedupeKey,
} from "../../code-annotations/utils/codeAnnotations";
import {
  normalizeInlineFileReferenceTokens,
  replaceVisibleFileReferenceLabels,
} from "../utils/composerFileReferences";
import { useStreamActivityPhase } from "../../threads/hooks/useStreamActivityPhase";
import { pushErrorToast } from "../../../services/toasts";
import {
  engineSupportsImageInput,
  findOversizedImageAttachment,
  formatEngineImageInputUnsupportedMessage,
  formatEngineImageTooLargeMessage,
  sanitizeImageAttachmentPaths,
} from "../../engine/utils/engineImageInput";
import { getManualMemoryInjectionMode } from "../../project-memory/utils/manualInjectionMode";
import {
  buildRetainedContextChipKeys,
  filterRetainedChipNames,
  filterRetainedEntries,
} from "../../context-ledger/utils/contextLedgerGovernance";
import {
  BrowserContextPreview,
  useBrowserContextAttachment,
} from "../../browser-agent";
import { IntentCanvasAttachmentCard } from "../../intent-canvas/components/IntentCanvasAttachmentCard";
import { requestBrowserDockOpenUrl } from "../../browser-agent/state/dockEvents";
import { resolveBrowserNavigationUrl } from "../utils/browserNavigation";
import {
  isMultiAgentTargetSupported,
  MultiAgentComposerToggle,
} from "../../multi-agent/components/ComposerToggle";
import { SharedProviderRetryToggle } from "../../shared-session/provider-retry/SharedProviderRetryToggle";
import { PiCompactEntry } from "../../pi-session/components/PiCompactDialog";

import type { ComposerProps } from "./Composer/types";
import { areComposerPropsEqual } from "./Composer/composerMemo";
import { useContextUsageProjection } from "./Composer/hooks/useContextUsageProjection";
import { useComposerRewind } from "./Composer/hooks/useComposerRewind";
import { useComposerContextSelections } from "./Composer/hooks/useComposerContextSelections";
import { useComposerRunStatusProjection } from "./Composer/hooks/useComposerRunStatusProjection";
import { ComposerContextStack } from "./Composer/ComposerContextStack";
import { useComposerExecutionTargets } from "./Composer/hooks/useComposerExecutionTargets";
import { useComposerCollabGate } from "./Composer/hooks/useComposerCollabGate";
import { useComposerQuickActions } from "./Composer/hooks/useComposerQuickActions";

export type {
  ComposerNoteCardSelectionRequest,
  ComposerProps,
  ComposerRewindDialogRequest,
} from "./Composer/types";


const EMPTY_ITEMS: ConversationItem[] = [];
const COMPOSER_MIN_HEIGHT = 20;
const COMPOSER_EXPAND_HEIGHT = 80;
const COMPOSER_INPUT_INTERACTION_IDLE_MS = 320;


function ComposerImpl({
  items = EMPTY_ITEMS,
  onSend,
  onQueue,
  onRequestContextCompaction,
  onStop,
  canStop,
  disabled = false,
  submitDisabled = false,
  isProcessing,
  steerEnabled: _steerEnabled,
  collaborationModes: _collaborationModes,
  collaborationModesEnabled: _collaborationModesEnabled,
  selectedCollaborationModeId: _selectedCollaborationModeId,
  onSelectCollaborationMode: _onSelectCollaborationMode,
  isSharedSession = false,
  createSessionTargetPicker = false,
  onCreationTargetEngineChange,
  sharedTargetPickerLocked = false,
  engines,
  selectedEngine,
  onSelectEngine,
  models,
  providerModelCatalogs,
  providerProfileId,
  providerProfileName,
  dshAgentPreset: sessionDshAgentPreset = null,
  selectedModelId,
  onSelectModel,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  reasoningSupported,
  onResolvedAlwaysThinkingChange,
  opencodeAgents = [],
  selectedOpenCodeAgent = null,
  onSelectOpenCodeAgent,
  selectedAgent = null,
  onAgentSelect,
  onOpenAgentSettings,
  onOpenPromptSettings,
  onOpenModelSettings,
  onOpenCliSettings,
  onRefreshModelConfig,
  isModelConfigRefreshing,
  onForkQuickStart,
  opencodeVariantOptions: _opencodeVariantOptions = [],
  selectedOpenCodeVariant: _selectedOpenCodeVariant = null,
  onSelectOpenCodeVariant: _onSelectOpenCodeVariant,
  accessMode,
  onSelectAccessMode,
  skills,
  customSkillDirectories,
  prompts,
  commands = [],
  files,
  directories = [],
  contextUsage = null,
  contextDualViewEnabled = false,
  isContextCompacting = false,
  codexCompactionLifecycleState = "idle",
  codexCompactionSource = null,
  codexCompactionCompletedAt = null,
  lastTokenUsageUpdatedAt = null,
  codexAutoCompactionEnabled = true,
  codexAutoCompactionThresholdPercent = 92,
  onCodexAutoCompactionSettingsChange,
  accountRateLimits = null,
  usageShowRemaining = false,
  onRefreshAccountRateLimits,
  queuedMessages = [],
  onDeleteQueued,
  onFuseQueued,
  canFuseQueuedMessages = false,
  fuseDisabledReasonKey = null,
  fusingQueuedMessageId = null,
  userInputRequests = [],
  onJumpToUserInputRequest,
  runtimeLifecycleState = null,
  sendLabel: _sendLabel = "Send",
  onDraftChange,
  attachedImages = [],
  onPickImages,
  onAttachImages,
  onRemoveImage,
  intentCanvasAttachments = [],
  onRemoveIntentCanvasAttachment,
  prefillDraft = null,
  onPrefillHandled,
  insertText = null,
  onInsertHandled,
  textareaRef: externalTextareaRef,
  editorSettings: _editorSettingsProp,
  sendShortcut = "enter",
  interruptShortcutLabel,
  textareaHeight = 80,
  onTextareaHeightChange,
  onOpenSkillsSettings: _onOpenSkillsSettings,
  onOpenExperimentalSettings: _onOpenExperimentalSettings,
  reviewPrompt,
  onReviewPromptClose: _onReviewPromptClose,
  onReviewPromptShowPreset: _onReviewPromptShowPreset,
  onReviewPromptChoosePreset: _onReviewPromptChoosePreset,
  highlightedPresetIndex: _highlightedPresetIndex,
  onReviewPromptHighlightPreset: _onReviewPromptHighlightPreset,
  highlightedBranchIndex: _highlightedBranchIndex,
  onReviewPromptHighlightBranch: _onReviewPromptHighlightBranch,
  highlightedCommitIndex: _highlightedCommitIndex,
  onReviewPromptHighlightCommit: _onReviewPromptHighlightCommit,
  onReviewPromptKeyDown: _onReviewPromptKeyDown,
  onReviewPromptSelectBranch: _onReviewPromptSelectBranch,
  onReviewPromptSelectBranchAtIndex: _onReviewPromptSelectBranchAtIndex,
  onReviewPromptConfirmBranch: _onReviewPromptConfirmBranch,
  onReviewPromptSelectCommit: _onReviewPromptSelectCommit,
  onReviewPromptSelectCommitAtIndex: _onReviewPromptSelectCommitAtIndex,
  onReviewPromptConfirmCommit: _onReviewPromptConfirmCommit,
  onReviewPromptUpdateCustomInstructions:
    _onReviewPromptUpdateCustomInstructions,
  onReviewPromptConfirmCustom: _onReviewPromptConfirmCustom,
  activeFilePath = null,
  activeFileLineRange = null,
  fileReferenceMode = "path",
  activeWorkspaceId = null,
  activeWorkspaceName = null,
  activeWorkspacePath = null,
  branchControl = null,
  footerUsageIndicatorEnabled = true,
  rewindWorkspaceGitState = null,
  activeThreadId = null,
  threadItemsByThread,
  threadParentById,
  threadStatusById,
  plan = null,
  isPlanMode = false,
  onOpenDiffPath,
  gitChangedFiles = null,
  isGitRepository = true,
  onRequestGitStatusRefresh,
  onRevertFile,
  onRevertAllFiles,
  onRewind,
  rewindDialogRequest = null,
  onRewindDialogRequestConsumed,
  showStatusPanelToggleOverride,
  statusPanelExpandedOverride,
  onToggleStatusPanelOverride,
  completionEmailSelected,
  completionEmailDisabled,
  onToggleCompletionEmail,
  pendingCodeAnnotation = null,
  onCodeAnnotationConsumed,
  selectedCodeAnnotations = [],
  onRemoveCodeAnnotation,
  onClearCodeAnnotations,
  externalNoteCardSelectionRequest = null,
}: ComposerProps) {
  const { t } = useTranslation();
  const isCodexEngine = selectedEngine === "codex";
  const deferredItems = useDeferredValue(items);
  const performanceScopedItems = isProcessing ? deferredItems : items;
  const supportsStreamActivityPhaseFx =
    selectedEngine === "codex" ||
    selectedEngine === "claude" ||
    selectedEngine === "gemini" ||
    selectedEngine === "grok" ||
    selectedEngine === "kimi";
  const streamActivityPhase = useStreamActivityPhase({
    isProcessing: Boolean(isProcessing && supportsStreamActivityPhaseFx),
    items: performanceScopedItems,
  });
  const isReviewQuickActionEngine =
    selectedEngine === "codex" || selectedEngine === "claude";
  const {
    selectedSharedTarget,
    setSelectedCreationTarget,
    pendingPickerEngineRef,
    effectiveCreationTarget,
    setNativeAtomicSelection,
    isSharedSessionResolved,
    selectedAtomicTarget,
    resolvedDshAgentPreset,
    dshAgentPresetLocked,
    handleDshAgentPresetSelect,
    useAtomicReasoningProjection,
    atomicReasoningOptions,
    atomicSelectedEffort,
    imageAttachEngine,
    imageInputSupported,
    handleAttachImagesGuarded,
    handlePickImagesGuarded,
  } = useComposerExecutionTargets({
    items,
    activeWorkspaceId,
    activeThreadId,
    isSharedSession,
    createSessionTargetPicker,
    sharedTargetPickerLocked,
    selectedEngine,
    selectedModelId,
    selectedEffort,
    providerProfileId,
    providerProfileName,
    models,
    providerModelCatalogs,
    reasoningOptions,
    sessionDshAgentPreset,
    onCreationTargetEngineChange,
    onAttachImages,
    onPickImages,
  });
  const {
    agentArmed,
    setAgentArmed,
    collabRunActive,
    collabLocksComposer,
    composerInteractionDisabled,
  } = useComposerCollabGate({
    activeWorkspaceId,
    activeThreadId,
    disabled,
    selectedAtomicTarget,
  });
  const sharedTargetResolved =
    !isSharedSession || isResolvedExecutionTarget(selectedSharedTarget);
  const effectiveSubmitDisabled = submitDisabled || !sharedTargetResolved;
  const sharedTargetPersistenceByThreadRef = useRef(
    new Map<string, Promise<void>>(),
  );
  // 异步 persist 晚于切 workspace/thread 时用 ref 判断「用户是否还在该会话」。
  const activeSharedPersistScopeRef = useRef({
    workspaceId: activeWorkspaceId,
    threadId: activeThreadId,
  });
  activeSharedPersistScopeRef.current = {
    workspaceId: activeWorkspaceId,
    threadId: activeThreadId,
  };
  const handleSharedTargetChange = useCallback(
    (target: ExecutionTarget) => {
      if (!activeWorkspaceId || !activeThreadId || sharedTargetPickerLocked) {
        return;
      }
      if (!isResolvedExecutionTarget(target)) {
        // CLI / Provider 菜单导航属于 Picker 内部过渡态，不是一次持久化失败。
        // 只有完整 Model row 形成 ResolvedExecutionTarget 后才允许跨过该边界。
        return;
      }
      const workspaceId = activeWorkspaceId;
      const threadId = activeThreadId;
      // 捕获变更前值，用于 persist 失败时回滚。
      const previousState = getSharedTargetState(workspaceId, threadId);
      const previousTarget = previousState.selectedNextTarget;
      // 乐观更新：先 hydrate UI，再异步持久化。
      hydrateSharedTargetState(workspaceId, threadId, target);
      beginSharedTargetPersist(workspaceId, threadId);
      const persistenceKey = `${workspaceId}::${threadId}`;
      const previousPersistence =
        sharedTargetPersistenceByThreadRef.current.get(persistenceKey) ??
        Promise.resolve();
      const currentPersistence = previousPersistence
        .catch(() => undefined)
        .then(async () => {
          const response = await persistSharedSessionSelectedTarget(
            workspaceId,
            threadId,
            target,
          );
          const persistedTarget = resolveBackendAuthoritativeExecutionTarget(
            response,
            target,
          );
          hydrateSharedTargetState(workspaceId, threadId, persistedTarget);
          dispatchSharedSendEvent(workspaceId, threadId, {
            type: "targetRepaired",
          });
        })
        .catch((error) => {
          // 持久化失败：回滚到变更前值（不依赖 toast）。
          hydrateSharedTargetState(
            workspaceId,
            threadId,
            previousTarget ?? null,
          );
          const scope = activeSharedPersistScopeRef.current;
          if (
            shouldSuppressSharedTargetPersistToast(error, {
              persistWorkspaceId: workspaceId,
              persistThreadId: threadId,
              activeWorkspaceId: scope.workspaceId,
              activeThreadId: scope.threadId,
            })
          ) {
            // 切走会话 / meta 缺失：静默，避免用户只切空间/会话却被红字吓到。
            return;
          }
          pushErrorToast({
            title: t("sharedSend.selectionPersistFailedTitle"),
            message: t("sharedSend.selectionPersistFailedMessage", {
              reason: error instanceof Error ? error.message : String(error),
            }),
          });
        })
        .finally(() => {
          endSharedTargetPersist(workspaceId, threadId);
        });
      sharedTargetPersistenceByThreadRef.current.set(
        persistenceKey,
        currentPersistence,
      );
      void currentPersistence.finally(() => {
        if (
          sharedTargetPersistenceByThreadRef.current.get(persistenceKey) ===
          currentPersistence
        ) {
          sharedTargetPersistenceByThreadRef.current.delete(persistenceKey);
        }
      });
    },
    [activeThreadId, activeWorkspaceId, sharedTargetPickerLocked, t],
  );
  const handleNativeProviderTargetChange = useCallback(
    (target: ExecutionTarget) => {
      if (
        isSharedSessionResolved ||
        !activeWorkspaceId ||
        !activeThreadId ||
        (target.engine !== "claude" && target.engine !== "codex") ||
        !target.providerProfileId?.trim()
      ) {
        return;
      }
      const snapshot = freezeTurnSnapshot(target);
      requestProviderContinuationDialog({
        workspaceId: activeWorkspaceId,
        sourceSessionId: activeThreadId,
        destination: {
          engine: target.engine,
          providerProfileId: target.providerProfileId,
          modelCatalogEntryId: target.modelCatalogEntryId ?? null,
          model: target.model ?? null,
          reasoningEffort: target.reasoning?.effort ?? null,
          providerProfileNameSnapshot:
            target.providerProfileNameSnapshot ?? null,
          providerProfileSource: snapshot.providerProfileSource ?? null,
          runtimeCapabilityFingerprint:
            target.engine === "claude" ? "echo-checksum" : null,
        },
      });
    },
    [activeThreadId, activeWorkspaceId, isSharedSessionResolved],
  );
  /**
   * Native 会话也走首页同款 Atomic 双栏 picker（含「本地配置」渠道）。
   * 同 engine+profile 只切模型；跨 managed profile 走续接；其余走 engine/model 切换。
   *
   * 同 profile 切模型：先写 nativeAtomicSelection（勾选即时反馈），再 onSelectModel
   * 持久化；不依赖 parent catalog 是否收录该 id（catalog 外自定义名同样生效）。
   */
  const handleNativeAtomicTargetChange = useCallback(
    (target: ExecutionTarget) => {
      if (
        isSharedSessionResolved ||
        createSessionTargetPicker ||
        !selectedEngine
      ) {
        return;
      }
      const currentProvider = selectedEngine as ProviderId;
      const sameProfile = isSameProviderExecutionProfile(
        currentProvider,
        providerProfileId,
        target,
      );
      const catalogEntryId =
        target.modelCatalogEntryId?.trim() || target.model?.trim() || null;
      const runtimeModel = target.model?.trim() || catalogEntryId;
      const nextEffort = target.reasoning?.effort ?? null;
      if (sameProfile) {
        if (catalogEntryId && runtimeModel) {
          setNativeAtomicSelection({
            modelCatalogEntryId: catalogEntryId,
            model: runtimeModel,
          });
          // 持久化用 catalog entry id；自由名与 runtime 通常相同
          onSelectModel(catalogEntryId);
        }
        if (nextEffort !== selectedEffort) {
          onSelectEffort(nextEffort);
        }
        return;
      }
      // 跨渠道时清掉本会话点选覆盖，避免沿用旧模型 id
      setNativeAtomicSelection(null);
      // Claude/Codex 切到 managed 渠道 → Native Provider Continuation
      if (
        (target.engine === "claude" || target.engine === "codex") &&
        target.providerProfileId?.trim()
      ) {
        handleNativeProviderTargetChange(target);
        return;
      }
      if (target.engine !== selectedEngine) {
        markExplicitComposerEngineSwitch(target.engine);
        onSelectEngine?.(target.engine);
      }
      if (catalogEntryId && runtimeModel) {
        setNativeAtomicSelection({
          modelCatalogEntryId: catalogEntryId,
          model: runtimeModel,
        });
        onSelectModel(catalogEntryId);
      }
      if (nextEffort !== selectedEffort) {
        onSelectEffort(nextEffort);
      }
    },
    [
      createSessionTargetPicker,
      handleNativeProviderTargetChange,
      isSharedSessionResolved,
      onSelectEffort,
      onSelectEngine,
      onSelectModel,
      providerProfileId,
      selectedEffort,
      selectedEngine,
    ],
  );
  const handleCreationTargetChange = useCallback(
    (target: ExecutionTarget) => {
      // create-session 必须用 Atomic 校验（含 PI/DSH 等非 Shared 引擎）；
      // isResolvedExecutionTarget 仅 Shared 子集，会静默丢掉 PI 点击。
      if (!createSessionTargetPicker || !isAtomicExecutionTarget(target)) {
        return;
      }
      // 首页 engine 选择必须同步全局 activeEngine + client store，否则重启后首页
      // 回落到默认 claude，而项目会话因 thread.engineSource 仍显示上次的 CLI。
      if (target.engine !== selectedEngine) {
        markExplicitComposerEngineSwitch(target.engine);
        pendingPickerEngineRef.current = target.engine;
        onSelectEngine?.(target.engine);
      }
      setSelectedCreationTarget(target);
    },
    [createSessionTargetPicker, onSelectEngine, selectedEngine],
  );
  // W2（2026-08-25）：effort 回调必须是稳定 identity。原先 JSX 里每次 render 新建
  // `(effort) => handleSharedTargetChange({...})`，ComposerImpl 任意一次重渲都会
  // 打穿 ChatInputBoxAdapter memo（线上 idle 态 renderCount 冲到 318）。
  const handleSharedEffortChange = useCallback(
    (effort: string | null) => {
      if (!isResolvedExecutionTarget(selectedSharedTarget)) {
        return;
      }
      handleSharedTargetChange({
        ...selectedSharedTarget,
        reasoning: effort ? { effort } : null,
      });
    },
    [handleSharedTargetChange, selectedSharedTarget],
  );
  const handleCreationEffortChange = useCallback(
    (effort: string | null) => {
      if (!isAtomicExecutionTarget(effectiveCreationTarget)) {
        return;
      }
      setSelectedCreationTarget({
        ...effectiveCreationTarget,
        reasoning: effort ? { effort } : null,
      });
    },
    [effectiveCreationTarget],
  );
  // 草稿值直接订阅模块级 store(而非经 app-shell 根 prop 灌入):按键写 store 时
  // 只有 Composer 自身重渲染,不再把整个 app-shell 拖下水。
  const draftText = useComposerDraft(activeThreadId);
  const [text, setText] = useState(draftText);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);

  const browserContext = useBrowserContextAttachment(activeWorkspaceId);
  const [isComposerCollapsed, setIsComposerCollapsed] = useState(false);
  const [dismissedActiveFileReference, setDismissedActiveFileReference] =
    useState<string | null>(null);
  const [openCodeProviderTone, _setOpenCodeProviderTone] = useState<
    "is-ok" | "is-runtime" | "is-fail"
  >("is-fail");
  const [openCodeProviderToneReady, _setOpenCodeProviderToneReady] =
    useState(false);
  const {
    rewindInFlight,
    rewindPreviewState,
    rewindMode,
    setRewindMode,
    canRewindSession,
    handleRewind,
    handleCancelRewind,
    handleConfirmRewind,
    handleStoreRewindChanges,
  } = useComposerRewind({
    items,
    activeThreadId,
    selectedEngine,
    activeWorkspaceId,
    onRewind,
    rewindDialogRequest,
    onRewindDialogRequestConsumed,
  });
  const lastExpandedHeightRef = useRef(
    Math.max(textareaHeight, COMPOSER_EXPAND_HEIGHT),
  );
  const composerInputInteractionTimerRef = useRef<number | null>(null);
  const [
    isComposerInputInteractionActive,
    setIsComposerInputInteractionActive,
  ] = useState(false);
  const shouldDeferStatusSummary =
    isProcessing && isComposerInputInteractionActive;
  const {
    statusTodos,
    statusSubagents,
    mergePlanIntoTodos,
    sessionFileChanges,
    piTreePill,
    handleRevertFileForStrip,
    handleRevertAllFilesForStrip,
    statusPanelExpanded,
    setStatusPanelExpanded,
  } = useComposerRunStatusProjection({
    items,
    performanceScopedItems,
    activeThreadId,
    activeWorkspaceId,
    activeWorkspacePath,
    selectedEngine,
    threadParentById,
    threadItemsByThread,
    threadStatusById,
    plan,
    isPlanMode,
    isProcessing,
    gitChangedFiles,
    isGitRepository,
    shouldDeferStatusSummary,
    statusPanelExpandedOverride,
    isSharedSessionResolved,
    contextUsage,
    onRequestGitStatusRefresh,
    onRevertFile,
    onRevertAllFiles,
  });
  const internalRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = externalTextareaRef ?? internalRef;
  const chatInputRef = useRef<ChatInputBoxHandle>(null);
  const activeFileReferenceSignature = activeFilePath
    ? activeFileLineRange
      ? `${activeFilePath}:${activeFileLineRange.startLine}-${activeFileLineRange.endLine}`
      : `${activeFilePath}:all`
    : null;
  const hasActiveFileReference = Boolean(
    activeFileReferenceSignature &&
    fileReferenceMode === "path" &&
    dismissedActiveFileReference !== activeFileReferenceSignature,
  );


  useEffect(() => {
    if (!dismissedActiveFileReference) {
      return;
    }
    if (
      !activeFileReferenceSignature ||
      activeFileReferenceSignature !== dismissedActiveFileReference
    ) {
      setDismissedActiveFileReference(null);
    }
  }, [activeFileReferenceSignature, dismissedActiveFileReference]);

  useEffect(
    () => () => {
      if (composerInputInteractionTimerRef.current !== null) {
        window.clearTimeout(composerInputInteractionTimerRef.current);
      }
    },
    [],
  );

  const markComposerInputInteraction = useCallback(() => {
    setIsComposerInputInteractionActive(true);
    if (composerInputInteractionTimerRef.current !== null) {
      window.clearTimeout(composerInputInteractionTimerRef.current);
    }
    composerInputInteractionTimerRef.current = window.setTimeout(() => {
      setIsComposerInputInteractionActive(false);
      composerInputInteractionTimerRef.current = null;
    }, COMPOSER_INPUT_INTERACTION_IDLE_MS);
  }, []);

  const activeFileLinesLabel = useMemo(() => {
    if (!activeFileLineRange) {
      return undefined;
    }
    if (activeFileLineRange.startLine === activeFileLineRange.endLine) {
      return `L${activeFileLineRange.startLine}`;
    }
    return `L${activeFileLineRange.startLine}-${activeFileLineRange.endLine}`;
  }, [activeFileLineRange]);

  const selectedChatInputAgent = useMemo<ChatInputSelectedAgent | null>(() => {
    if (selectedEngine === "opencode") {
      if (!selectedOpenCodeAgent) {
        return null;
      }
      const matchedAgent = opencodeAgents.find(
        (agent) => agent.id === selectedOpenCodeAgent,
      );
      return {
        id: selectedOpenCodeAgent,
        name: selectedOpenCodeAgent,
        prompt: matchedAgent?.description,
      };
    }
    return selectedAgent;
  }, [opencodeAgents, selectedAgent, selectedEngine, selectedOpenCodeAgent]);
  const opencodeDisconnected =
    selectedEngine === "opencode" &&
    openCodeProviderToneReady &&
    openCodeProviderTone === "is-fail";


  useEffect(() => {
    if (textareaHeight > COMPOSER_MIN_HEIGHT) {
      lastExpandedHeightRef.current = textareaHeight;
    }
  }, [textareaHeight]);


  useEffect(() => {
    if (!pendingCodeAnnotation) {
      return;
    }
    const dedupeKey = buildCodeAnnotationDedupeKey(pendingCodeAnnotation);
    if (!dedupeKey) {
      onCodeAnnotationConsumed?.(dedupeKey);
      return;
    }
    onCodeAnnotationConsumed?.(dedupeKey);
  }, [onCodeAnnotationConsumed, pendingCodeAnnotation]);


  const handleExpandComposer = useCallback(() => {
    setIsComposerCollapsed(false);
    onTextareaHeightChange?.(
      Math.max(lastExpandedHeightRef.current, COMPOSER_EXPAND_HEIGHT),
    );
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [onTextareaHeightChange, textareaRef]);

  useEffect(() => {
    setText((prev) => (prev === draftText ? prev : draftText));
  }, [draftText]);

  // text / draft / catalog 经 ref 读：setComposerText 保持稳定 identity，
  // extract effect 不得因 onDraftChange / skills / commands 引用抖动重入（#185 AP-04）。
  const textRef = useRef(text);
  textRef.current = text;
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  const setComposerText = useCallback((next: string) => {
    // 等价值短路：禁止 text→draft→text 虚写叠 nested update
    if (textRef.current === next) {
      return;
    }
    textRef.current = next;
    setText(next);
    onDraftChangeRef.current?.(next);
  }, []);

  const {
    selectedSkillNames,
    selectedCommonsNames,
    selectedManualMemories,
    selectedNoteCards,
    selectedInlineFileReferences,
    selectedSkills,
    selectedCommons,
    selectedOpenCodeDirectCommand,
    contextSelectionChips,
    carryOverManualMemoryIds,
    retainedManualMemoryIds,
    carryOverNoteCardIds,
    retainedNoteCardIds,
    carryOverContextChipKeys,
    setSelectedSkillNames,
    setSelectedCommonsNames,
    setSelectedManualMemories,
    setSelectedNoteCards,
    setSelectedInlineFileReferences,
    setCarryOverManualMemoryIds,
    setRetainedManualMemoryIds,
    setCarryOverNoteCardIds,
    setRetainedNoteCardIds,
    setCarryOverContextChipKeys,
    setRetainedContextChipKeys,
    memoryReferenceMode,
    setMemoryReferenceMode,
    memoryReferenceDismissed,
    handleSetMemoryReferenceMode,
    handleRestoreMemoryReference,
    clearComposerContextSelections,
    handleSelectManualMemory,
    handleSelectNoteCard,
    handleSelectSkill,
    handleRemoveContextChip,
    handleRemoveManualMemory,
    handleRemoveNoteCard,
    selectedManualMemoryIds,
    selectedNoteCardIds,
  } = useComposerContextSelections({
    activeThreadId,
    activeWorkspaceId,
    skills,
    commands,
    selectedEngine,
    onClearCodeAnnotations,
    externalNoteCardSelectionRequest,
    chatInputRef,
    text,
    setComposerText,
  });


  const { isAutocompleteOpen, handleTextChange } =
    useComposerAutocompleteState({
      text,
      selectionStart,
      setText: setComposerText,
      setSelectionStart,
    });
  const reviewPromptOpen = Boolean(reviewPrompt);
  const suggestionsOpen = reviewPromptOpen || isAutocompleteOpen;

  const handleTextChangeWithHistory = useCallback(
    (next: string, cursor: number | null) => {
      markComposerInputInteraction();
      handleTextChange(next, cursor);
    },
    [handleTextChange, markComposerInputInteraction],
  );

  const applyActiveFileReference = useCallback(
    (message: string) => {
      if (!(
        hasActiveFileReference &&
        fileReferenceMode === "path" &&
        activeFilePath
      )) {
        return message;
      }
      const referenceTarget = activeFileLineRange
        ? `${activeFilePath}#L${activeFileLineRange.startLine}-L${activeFileLineRange.endLine}`
        : activeFilePath;
      if (
        message.includes(referenceTarget) ||
        message.includes(activeFilePath)
      ) {
        return message;
      }
      return `@file \`${referenceTarget}\`\n${message}`.trim();
    },
    [
      activeFileLineRange,
      activeFilePath,
      fileReferenceMode,
      hasActiveFileReference,
    ],
  );

  const handleClearContext = useCallback(() => {
    if (activeFileReferenceSignature) {
      setDismissedActiveFileReference(activeFileReferenceSignature);
    }
  }, [activeFileReferenceSignature]);

  const handleAgentSelect = useCallback(
    (agent: ChatInputSelectedAgent | null) => {
      if (selectedEngine === "opencode") {
        onSelectOpenCodeAgent?.(agent?.id ?? null);
        return;
      }
      onAgentSelect?.(agent);
    },
    [onAgentSelect, onSelectOpenCodeAgent, selectedEngine],
  );

  const handleModeSelect = useCallback(
    (mode: PermissionMode) => {
      onSelectAccessMode(permissionModeToAccessMode(mode));
    },
    [onSelectAccessMode],
  );

  const handleToggleStatusPanel = useCallback(() => {
    setStatusPanelExpanded((prev) => !prev);
  }, []);
  const resolvedShowStatusPanelToggle = showStatusPanelToggleOverride ?? false;
  const resolvedStatusPanelExpanded =
    statusPanelExpandedOverride ?? statusPanelExpanded;
  const resolvedToggleStatusPanel =
    onToggleStatusPanelOverride ?? handleToggleStatusPanel;

  const {
    handleManualCompactContext,
    handleCodexQuickCommand,
    handleForkQuickStart,
  } = useComposerQuickActions({
    selectedEngine,
    activeWorkspaceId,
    activeThreadId,
    disabled,
    effectiveSubmitDisabled,
    collabLocksComposer,
    isReviewQuickActionEngine,
    onRequestContextCompaction,
    onForkQuickStart,
    onSend,
  });

  const handleSend = useCallback(
    (submittedText?: string, submittedImages?: string[]) => {
      if (disabled || effectiveSubmitDisabled || collabLocksComposer) {
        return;
      }
      if (opencodeDisconnected) {
        pushErrorToast({
          title: "OpenCode 未连接",
          message:
            "当前连接状态为红色，请先在 OpenCode 管理面板完成连接后再发送。",
        });
        return;
      }
      const trimmed = (submittedText ?? text).trim();
      // Merge images from Composer state (file picker) and ChatInputBox (paste/drop)
      const mergedImages = sanitizeImageAttachmentPaths([
        ...attachedImages,
        ...(submittedImages ?? []),
      ]);
      const hasIntentCanvasAttachments = intentCanvasAttachments.length > 0;
      if (
        !trimmed &&
        mergedImages.length === 0 &&
        !selectedOpenCodeDirectCommand &&
        !hasIntentCanvasAttachments
      ) {
        return;
      }
      const isAgentSubmission = agentArmed;
      if (isAgentSubmission) {
        // Shared 内用户已启用协作：不再用 feature flag 拦截；
        // 边界只看 shared 身份 + 完整 target（native 永不会走到 arm）。
        if (
          !isSharedSessionResolved ||
          !isResolvedExecutionTarget(selectedAtomicTarget)
        ) {
          pushErrorToast({
            title: t("multiAgent.errors.unavailableTitle"),
            message: t("multiAgent.errors.incompleteTarget"),
          });
          return;
        }
        if (!isMultiAgentTargetSupported(selectedAtomicTarget.engine)) {
          setAgentArmed(false);
          pushErrorToast({
            title: t("multiAgent.errors.unavailableTitle"),
            message: t("multiAgent.errors.targetUnavailable"),
          });
          return;
        }
        // 图片：Context Fan-in 进首段，已放行。
        // Browser Context / Intent Canvas 尚未并入协作首段注入链，暂仍拦截。
        if (hasIntentCanvasAttachments || Boolean(browserContext.attachment)) {
          pushErrorToast({
            title: t("multiAgent.errors.attachmentsTitle"),
            message: t("multiAgent.errors.attachments"),
          });
          return;
        }
      }
      // Composer-side capability gate: keep draft when engine cannot accept images.
      // Current engines are all image-capable; retained for future unsupported engines.
      if (
        mergedImages.length > 0 &&
        imageAttachEngine &&
        !engineSupportsImageInput(imageAttachEngine)
      ) {
        pushErrorToast({
          title: t("composer.imageInputUnsupportedTitle", {
            defaultValue: "Image not supported",
          }),
          message: formatEngineImageInputUnsupportedMessage(
            imageAttachEngine,
            // i18next TFunction is wider than our helper; keep runtime options intact.
            t as (key: string, options?: Record<string, unknown>) => string,
          ),
          durationMs: 4200,
        });
        // ChatInputBox clears before onSubmit; restore Composer-owned draft + images.
        setComposerText(submittedText ?? text);
        onAttachImages?.(mergedImages);
        return;
      }
      const oversizedImage =
        mergedImages.length > 0 && imageAttachEngine
          ? findOversizedImageAttachment(mergedImages, imageAttachEngine)
          : null;
      if (oversizedImage && imageAttachEngine) {
        pushErrorToast({
          title: t("composer.imageTooLargeTitle", {
            defaultValue: "Image too large",
          }),
          message: formatEngineImageTooLargeMessage(
            imageAttachEngine,
            oversizedImage.bytes,
            oversizedImage.maxBytes,
            t as (key: string, options?: Record<string, unknown>) => string,
          ),
          durationMs: 4200,
        });
        setComposerText(submittedText ?? text);
        onAttachImages?.(mergedImages);
        return;
      }
      const browserNavigationUrl =
        mergedImages.length === 0 && !hasIntentCanvasAttachments
          ? resolveBrowserNavigationUrl(trimmed)
          : null;
      if (browserNavigationUrl && activeWorkspaceId) {
        requestBrowserDockOpenUrl(browserNavigationUrl);
        clearComposerContextSelections();
        setComposerText("");
        return;
      }
      if (selectedOpenCodeDirectCommand) {
        onSend(`/${selectedOpenCodeDirectCommand}`, []);
        clearComposerContextSelections();
        setComposerText("");
        return;
      }
      const shouldAssembleSelectedSkills = shouldAssemblePrompt({
        userInput: trimmed,
        selectedSkillCount: selectedSkills.length,
        selectedCommonsCount: selectedCommons.length,
      });
      const finalText = shouldAssembleSelectedSkills
        ? assembleSinglePrompt({
            userInput: trimmed,
            skills: selectedSkills,
            commons: selectedCommons.map((item) => ({ name: item.name })),
          })
        : trimmed;
      // 结构化契约与降级文本同源于一次组装：仅在真正发生拼接时下发。
      const skillInvocations = shouldAssembleSelectedSkills
        ? assembleSkillInvocations({
            skills: selectedSkills,
            commons: selectedCommons.map((item) => ({
              name: item.name,
              path: item.path,
            })),
          })
        : [];
      // managed 目录命令引擎不可见，发送前在客户端展开为正文。
      const expandedFinalText = expandLeadingManagedCommand(
        finalText,
        commands,
      );
      const finalTextWithReference =
        applyActiveFileReference(expandedFinalText);
      const resolvedFinalText = replaceVisibleFileReferenceLabels(
        normalizeInlineFileReferenceTokens(finalTextWithReference),
        selectedInlineFileReferences,
      );
      const resolvedFinalTextWithAnnotations = appendCodeAnnotationsToPrompt(
        resolvedFinalText,
        selectedCodeAnnotations,
      );
      const selectedMemoryIds = selectedManualMemories.map((entry) => entry.id);
      const selectedNoteCardIds = selectedNoteCards.map((entry) => entry.id);
      const selectedMemoryInjectionMode = getManualMemoryInjectionMode();
      // 记忆参考三态：off | pick | always（single 归一 pick）；由发送链路统一闸门
      const resolvedMemoryReferenceMode =
        memoryReferenceMode === "single" ? "pick" : memoryReferenceMode;
      const shouldPassMemoryReference = resolvedMemoryReferenceMode !== "off";
      // Context Fan-in（§8.6）：协作不再整类拦截 skill/记忆/便签；注入由发送链路首段消化。
      const browserContextAttachment = browserContext.attachment;
      const hasBrowserContextAttachment = Boolean(browserContextAttachment);
      const createSessionTarget =
        createSessionTargetPicker &&
        isAtomicExecutionTarget(effectiveCreationTarget)
          ? {
              engine: effectiveCreationTarget.engine,
              providerProfileId:
                effectiveCreationTarget.providerProfileId?.trim() || null,
              providerProfileName:
                effectiveCreationTarget.providerProfileNameSnapshot,
              providerProfileSource:
                effectiveCreationTarget.providerProfileSource,
              modelCatalogEntryId: effectiveCreationTarget.modelCatalogEntryId,
              model: effectiveCreationTarget.model,
              effort: effectiveCreationTarget.reasoning?.effort ?? null,
            }
          : null;
      const dshSendCatalogId = resolveDshAtomicCatalogIdForSend(
        selectedAtomicTarget ?? {
          engine: selectedEngine,
          modelCatalogEntryId: selectedModelId,
          model: null,
        },
      );
      // Native 发送边界固化执行目标快照（Shared / create-picker 各有自己的冻结通道）。
      const nativeExecutionTarget =
        !isSharedSessionResolved &&
        !createSessionTargetPicker &&
        selectedAtomicTarget
          ? freezeTurnSnapshot(selectedAtomicTarget)
          : undefined;
      const sendOptions: MessageSendOptions | undefined =
        skillInvocations.length > 0 ||
        selectedMemoryIds.length > 0 ||
        selectedNoteCardIds.length > 0 ||
        shouldPassMemoryReference ||
        hasBrowserContextAttachment ||
        createSessionTarget !== null ||
        isAgentSubmission ||
        Boolean(nativeExecutionTarget) ||
        (selectedAtomicTarget?.engine ?? selectedEngine) === "dsh"
          ? {
              ...((selectedAtomicTarget?.engine ?? selectedEngine) === "dsh"
                ? {
                    dshAgentPreset: resolvedDshAgentPreset,
                    ...(dshSendCatalogId ? { model: dshSendCatalogId } : {}),
                  }
                : {}),
              ...(skillInvocations.length > 0 ? { skillInvocations } : {}),
              ...(shouldPassMemoryReference
                ? {
                    memoryReferenceMode: resolvedMemoryReferenceMode,
                    // 兼容旧测试/路径：always 仍标 enabled
                    ...(resolvedMemoryReferenceMode === "always"
                      ? { memoryReferenceEnabled: true as const }
                      : {}),
                  }
                : {}),
              ...(selectedMemoryIds.length > 0
                ? { selectedMemoryIds, selectedMemoryInjectionMode }
                : {}),
              ...(selectedNoteCardIds.length > 0
                ? { selectedNoteCardIds }
                : {}),
              ...(browserContextAttachment ? { browserContextAttachment } : {}),
              ...(createSessionTarget ? { createSessionTarget } : {}),
              ...(nativeExecutionTarget ? { nativeExecutionTarget } : {}),
              ...(isAgentSubmission &&
              isResolvedExecutionTarget(selectedAtomicTarget)
                ? {
                    squadRequest: true as const,
                    sharedExecutionTarget: {
                      engine: selectedAtomicTarget.engine,
                      providerProfileId:
                        selectedAtomicTarget.providerProfileId?.trim() || null,
                      modelCatalogEntryId:
                        selectedAtomicTarget.modelCatalogEntryId,
                      model: selectedAtomicTarget.model,
                      reasoning: selectedAtomicTarget.reasoning
                        ? { ...selectedAtomicTarget.reasoning }
                        : null,
                      providerProfileNameSnapshot:
                        selectedAtomicTarget.providerProfileNameSnapshot,
                      providerProfileSource:
                        selectedAtomicTarget.providerProfileSource,
                    },
                  }
                : {}),
            }
          : undefined;
      const sendResult = onSend(
        resolvedFinalTextWithAnnotations,
        mergedImages,
        sendOptions,
      );
      if (isAgentSubmission) {
        setAgentArmed(false);
      }
      if (browserContextAttachment) {
        browserContext.remove();
      }
      const retainedManualMemories = filterRetainedEntries(
        selectedManualMemories,
        carryOverManualMemoryIds,
      );
      const retainedNoteCards = filterRetainedEntries(
        selectedNoteCards,
        carryOverNoteCardIds,
      );
      const retainedSkillNames = filterRetainedChipNames(
        selectedSkillNames,
        carryOverContextChipKeys,
        "skill",
      );
      const retainedCommonsNames = filterRetainedChipNames(
        selectedCommonsNames,
        carryOverContextChipKeys,
        "commons",
      );
      const nextRetainedContextChipKeys = buildRetainedContextChipKeys(
        retainedSkillNames,
        retainedCommonsNames,
      );
      setSelectedSkillNames([]);
      setSelectedCommonsNames([]);
      void Promise.resolve(sendResult)
        .catch((error: unknown) => {
          if (!isAgentSubmission) {
            throw error;
          }
          setComposerText(submittedText ?? text);
          setAgentArmed(true);
          const diagnostic =
            error instanceof Error ? error.message : String(error);
          let message = t("multiAgent.errors.startFailedDiagnostic", {
            diagnostic,
          });
          if (diagnostic.startsWith("agent-request-busy:")) {
            message = t("multiAgent.errors.busy");
          } else if (diagnostic.startsWith("agent-run-conflict:")) {
            message = t("multiAgent.entry.activeRun");
          } else if (
            diagnostic.startsWith("agent-request-images-unsupported:")
          ) {
            message = t("multiAgent.errors.attachments");
          } else if (
            diagnostic.startsWith("agent-request-images-too-large:")
          ) {
            message =
              diagnostic
                .slice("agent-request-images-too-large:".length)
                .trim() || t("composer.imageTooLargeTitle");
          } else if (
            diagnostic.startsWith("agent-request-context-unsupported:")
          ) {
            message = t("multiAgent.errors.contextUnsupportedTitle");
          } else if (
            diagnostic.includes("target-capability-unavailable") ||
            diagnostic.startsWith("agent-request-target-unavailable:")
          ) {
            message = t("multiAgent.errors.targetUnavailable");
          } else if (diagnostic.startsWith("agent-disabled:")) {
            // 勿再映射成 incompleteTarget，避免「配置正确却报 CLI 不完整」
            message = t("multiAgent.errors.featureDisabled");
          } else if (
            diagnostic.startsWith("agent-request-target-incomplete:") ||
            diagnostic.startsWith("agent-request-unavailable:") ||
            diagnostic.startsWith("invalid-target:") ||
            diagnostic.includes("shared-v2-target-incomplete")
          ) {
            message = t("multiAgent.errors.incompleteTarget");
          }
          pushErrorToast({
            title: t("multiAgent.errors.startFailed"),
            message,
            durationMs: 5_000,
          });
        })
        .finally(() => {
          setSelectedManualMemories(retainedManualMemories);
          setSelectedNoteCards(retainedNoteCards);
          setSelectedInlineFileReferences([]);
          onClearCodeAnnotations?.();
          setSelectedSkillNames(retainedSkillNames);
          setSelectedCommonsNames(retainedCommonsNames);
          setRetainedManualMemoryIds(
            retainedManualMemories.map((entry) => entry.id),
          );
          setRetainedNoteCardIds(retainedNoteCards.map((entry) => entry.id));
          setRetainedContextChipKeys(nextRetainedContextChipKeys);
          setCarryOverManualMemoryIds([]);
          setCarryOverNoteCardIds([]);
          setCarryOverContextChipKeys([]);
          setMemoryReferenceMode((currentMode) =>
            currentMode === "single" ? "off" : currentMode,
          );
        });
      setComposerText("");
    },
    [
      attachedImages,
      activeWorkspaceId,
      browserContext,
      createSessionTargetPicker,
      effectiveCreationTarget,
      collabLocksComposer,
      disabled,
      effectiveSubmitDisabled,
      imageAttachEngine,
      intentCanvasAttachments.length,
      applyActiveFileReference,
      commands,
      opencodeDisconnected,
      selectedOpenCodeDirectCommand,
      selectedCommons,
      selectedSkills,
      selectedInlineFileReferences,
      selectedCodeAnnotations,
      onAttachImages,
      onClearCodeAnnotations,
      selectedManualMemories,
      selectedNoteCards,
      memoryReferenceMode,
      onSend,
      setComposerText,
      selectedCommonsNames,
      selectedSkillNames,
      setSelectedManualMemories,
      t,
      text,
      agentArmed,
      isSharedSessionResolved,
      selectedAtomicTarget,
      resolvedDshAgentPreset,
      carryOverContextChipKeys,
      carryOverManualMemoryIds,
      carryOverNoteCardIds,
      clearComposerContextSelections,
    ],
  );


  const handleRemoveCodeAnnotation = useCallback(
    (annotationId: string) => {
      onRemoveCodeAnnotation?.(annotationId);
    },
    [onRemoveCodeAnnotation],
  );

  useEffect(() => {
    if (!prefillDraft) {
      return;
    }
    setComposerText(prefillDraft.text);
    onPrefillHandled?.(prefillDraft.id);
  }, [onPrefillHandled, prefillDraft, setComposerText]);

  useEffect(() => {
    if (!insertText) {
      return;
    }
    setComposerText(insertText.text);
    onInsertHandled?.(insertText.id);
  }, [insertText, onInsertHandled, setComposerText]);

  const { claudeContextUsage, legacyContextUsage, dualContextUsage } =
    useContextUsageProjection({
      contextUsage,
      selectedEngine,
      activeThreadId,
      items,
      selectedModelId,
      isContextCompacting,
      codexCompactionLifecycleState,
      codexCompactionSource,
      codexCompactionCompletedAt,
      lastTokenUsageUpdatedAt,
    });
  const deferredStreamActivityPhase = useDeferredValue(streamActivityPhase);
  const deferredLegacyContextUsage = useDeferredValue(legacyContextUsage);
  const deferredDualContextUsage = useDeferredValue(dualContextUsage);
  const deferredClaudeContextUsage = useDeferredValue(claudeContextUsage);
  const deferredAccountRateLimits = useDeferredValue(accountRateLimits);
  const resolvedComposerStreamActivityPhase =
    isProcessing && isComposerInputInteractionActive
      ? deferredStreamActivityPhase
      : streamActivityPhase;
  const resolvedLegacyContextUsage =
    isProcessing && isComposerInputInteractionActive
      ? deferredLegacyContextUsage
      : legacyContextUsage;
  const resolvedDualContextUsage =
    isProcessing && isComposerInputInteractionActive
      ? deferredDualContextUsage
      : dualContextUsage;
  const resolvedClaudeContextUsage =
    isProcessing && isComposerInputInteractionActive
      ? deferredClaudeContextUsage
      : claudeContextUsage;
  const resolvedAccountRateLimits =
    isProcessing && isComposerInputInteractionActive
      ? deferredAccountRateLimits
      : accountRateLimits;
  const selectedEngineInfo = useMemo(
    () => engines?.find((engine) => engine.type === selectedEngine),
    [engines, selectedEngine],
  );
  const selectedModelOption = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId],
  );
  const selectedPermissionMode = accessModeToPermissionMode(accessMode);
  const activeUserInputRequest = useMemo(
    () =>
      userInputRequests.find((request) => {
        if (!activeThreadId || request.params.thread_id !== activeThreadId) {
          return false;
        }
        if (activeWorkspaceId && request.workspace_id !== activeWorkspaceId) {
          return false;
        }
        return request.params.completed !== true;
      }) ?? null,
    [activeThreadId, activeWorkspaceId, userInputRequests],
  );
  const handleJumpToUserInputRequest = useCallback(() => {
    if (!activeUserInputRequest) {
      return;
    }
    onJumpToUserInputRequest?.(activeUserInputRequest);
  }, [activeUserInputRequest, onJumpToUserInputRequest]);
  const codexContextDualViewEnabled = contextDualViewEnabled && isCodexEngine;
  // 所有 provider 的上下文占用入口统一渲染在输入框下方分支行右侧；
  // Codex 继续使用 dual-view ContextBar，保留 tooltip 与 compaction controls。
  const showFooterUsageIndicator = footerUsageIndicatorEnabled;
  const composerFooterEngine = selectedAtomicTarget?.engine ?? selectedEngine;
  const showDshSessionStatsLine =
    composerFooterEngine === "dsh" &&
    deriveDshSessionStatsLine(contextUsage) != null;
  const showComposerBranchRow =
    Boolean(branchControl?.branchName) ||
    showFooterUsageIndicator ||
    isSharedSessionResolved ||
    showDshSessionStatsLine;
  const footerUsagePercentage =
    resolvedLegacyContextUsage && resolvedLegacyContextUsage.total > 0
      ? Math.round(
          (resolvedLegacyContextUsage.used / resolvedLegacyContextUsage.total) *
            100,
        )
      : null;
  const composerReadinessAccessMode =
    selectedEngine === "codex" && _selectedCollaborationModeId === "plan"
      ? "read-only"
      : accessMode;
  const composerSendReadiness = useMemo(
    () =>
      buildComposerSendReadiness({
        engine: selectedEngine ?? "claude",
        providerLabel:
          selectedEngineInfo?.shortName ||
          selectedEngineInfo?.displayName ||
          selectedEngine ||
          "Claude Code",
        modelLabel:
          selectedModelOption?.displayName ||
          selectedModelOption?.model ||
          selectedModelId ||
          t("composer.noModels"),
        modeLabel:
          selectedEngine === "codex" && _selectedCollaborationModeId === "plan"
            ? t("codexModes.plan.label")
            : selectedEngine === "dsh"
              ? t(`dshModes.${selectedPermissionMode}.label`)
              : t(`modes.${selectedPermissionMode}.label`),
        modeImpactLabel: t(
          `composer.readinessModeImpact.${composerReadinessAccessMode}`,
        ),
        accessMode: composerReadinessAccessMode,
        draftText: text,
        hasAttachments: attachedImages.length > 0,
        isProcessing,
        streamActivityPhase: resolvedComposerStreamActivityPhase,
        queuedCount: queuedMessages.length,
        fusingQueuedMessageId,
        canQueue: Boolean(onQueue),
        canStop,
        configLoading: isModelConfigRefreshing,
        runtimeLifecycleState,
        requestUserInputState: activeUserInputRequest ? "pending" : null,
        context: {
          selectedMemoryCount: selectedManualMemories.length,
          selectedNoteCardCount: selectedNoteCards.length,
          fileReferenceCount:
            selectedInlineFileReferences.length +
            (hasActiveFileReference ? 1 : 0),
          imageCount: attachedImages.length,
          selectedAgentName: selectedChatInputAgent?.name ?? null,
        },
      }),
    [
      activeUserInputRequest,
      attachedImages.length,
      canStop,
      composerReadinessAccessMode,
      fusingQueuedMessageId,
      hasActiveFileReference,
      isModelConfigRefreshing,
      isProcessing,
      onQueue,
      queuedMessages.length,
      resolvedComposerStreamActivityPhase,
      runtimeLifecycleState,
      selectedChatInputAgent?.name,
      selectedEngine,
      selectedEngineInfo?.displayName,
      selectedEngineInfo?.shortName,
      _selectedCollaborationModeId,
      selectedInlineFileReferences.length,
      selectedManualMemories.length,
      selectedModelId,
      selectedModelOption?.displayName,
      selectedModelOption?.model,
      selectedNoteCards.length,
      selectedPermissionMode,
      t,
      text,
    ],
  );
  const shouldRenderReviewInlinePrompt =
    isReviewQuickActionEngine &&
    Boolean(reviewPrompt) &&
    Boolean(_onReviewPromptClose) &&
    Boolean(_onReviewPromptShowPreset) &&
    Boolean(_onReviewPromptChoosePreset) &&
    _highlightedPresetIndex !== undefined &&
    Boolean(_onReviewPromptHighlightPreset) &&
    _highlightedBranchIndex !== undefined &&
    Boolean(_onReviewPromptHighlightBranch) &&
    _highlightedCommitIndex !== undefined &&
    Boolean(_onReviewPromptHighlightCommit) &&
    Boolean(_onReviewPromptSelectBranch) &&
    Boolean(_onReviewPromptSelectBranchAtIndex) &&
    Boolean(_onReviewPromptConfirmBranch) &&
    Boolean(_onReviewPromptSelectCommit) &&
    Boolean(_onReviewPromptSelectCommitAtIndex) &&
    Boolean(_onReviewPromptConfirmCommit) &&
    Boolean(_onReviewPromptUpdateCustomInstructions) &&
    Boolean(_onReviewPromptConfirmCustom);
  const hasScrollableContextStack =
    selectedManualMemories.length > 0 ||
    selectedNoteCards.length > 0 ||
    selectedCodeAnnotations.length > 0 ||
    shouldRenderReviewInlinePrompt;

  return (
    <footer
      className={`composer${composerInteractionDisabled ? " is-disabled" : ""}`}
    >
      <div
        className={`composer-shell${isComposerCollapsed ? " is-collapsed" : ""}`}
      >
        {isComposerCollapsed ? (
          <button
            type="button"
            className={`composer-shell-collapsed-strip${isProcessing ? " is-processing" : ""}`}
            onClick={handleExpandComposer}
            aria-label={t("composer.expandInput")}
            title={t("composer.expandInput")}
          >
            <span className="composer-shell-collapsed-rail" aria-hidden>
              <span />
              <span />
              <span />
            </span>
            <span className="composer-shell-collapsed-text">
              {isProcessing
                ? t("composer.collapsedProcessing")
                : t("composer.expandInput")}
            </span>
          </button>
        ) : (
          <>
            {/* Management toolbar (help, skill, commons, kanban) removed -- was disabled with {false && ...} */}
            {hasScrollableContextStack ? (
              <ComposerContextStack
                selectedManualMemories={selectedManualMemories}
                carryOverManualMemoryIds={carryOverManualMemoryIds}
                retainedManualMemoryIds={retainedManualMemoryIds}
                onRemoveManualMemory={handleRemoveManualMemory}
                selectedNoteCards={selectedNoteCards}
                carryOverNoteCardIds={carryOverNoteCardIds}
                retainedNoteCardIds={retainedNoteCardIds}
                onRemoveNoteCard={handleRemoveNoteCard}
                selectedCodeAnnotations={selectedCodeAnnotations}
                onRemoveCodeAnnotation={handleRemoveCodeAnnotation}
                shouldRenderReviewInlinePrompt={shouldRenderReviewInlinePrompt}
                reviewPrompt={reviewPrompt}
                onReviewPromptClose={_onReviewPromptClose}
                onReviewPromptShowPreset={_onReviewPromptShowPreset}
                onReviewPromptChoosePreset={_onReviewPromptChoosePreset}
                highlightedPresetIndex={_highlightedPresetIndex}
                onReviewPromptHighlightPreset={_onReviewPromptHighlightPreset}
                highlightedBranchIndex={_highlightedBranchIndex}
                onReviewPromptHighlightBranch={_onReviewPromptHighlightBranch}
                highlightedCommitIndex={_highlightedCommitIndex}
                onReviewPromptHighlightCommit={_onReviewPromptHighlightCommit}
                onReviewPromptSelectBranch={_onReviewPromptSelectBranch}
                onReviewPromptSelectBranchAtIndex={
                  _onReviewPromptSelectBranchAtIndex
                }
                onReviewPromptConfirmBranch={_onReviewPromptConfirmBranch}
                onReviewPromptSelectCommit={_onReviewPromptSelectCommit}
                onReviewPromptSelectCommitAtIndex={
                  _onReviewPromptSelectCommitAtIndex
                }
                onReviewPromptConfirmCommit={_onReviewPromptConfirmCommit}
                onReviewPromptUpdateCustomInstructions={
                  _onReviewPromptUpdateCustomInstructions
                }
                onReviewPromptConfirmCustom={_onReviewPromptConfirmCustom}
                onReviewPromptKeyDown={_onReviewPromptKeyDown}
              />
            ) : null}
            {activeWorkspaceId &&
            (browserContext.attachment || browserContext.error) ? (
              <div className="composer-browser-context">
                {browserContext.attachment ? (
                  <BrowserContextPreview
                    attachment={browserContext.attachment}
                    busy={browserContext.busy}
                    onRefresh={() => void browserContext.refresh()}
                    onRemove={browserContext.remove}
                  />
                ) : null}
                {browserContext.error ? (
                  <div className="composer-browser-context-error" role="status">
                    {browserContext.error ===
                    "browser_context_no_active_session"
                      ? t("browserAgent.composer.noSession")
                      : browserContext.error}
                  </div>
                ) : null}
              </div>
            ) : null}
            {intentCanvasAttachments.length > 0 ? (
              <div
                className="composer-intent-canvas-attachments"
                aria-label={t("intentCanvas.attachment.groupLabel")}
              >
                {intentCanvasAttachments.map((document) => (
                  <IntentCanvasAttachmentCard
                    key={document.id}
                    document={document}
                    onRemove={onRemoveIntentCanvasAttachment}
                  />
                ))}
              </div>
            ) : null}
            <ComposerRunStatusStrip
              todos={statusTodos}
              subagents={statusSubagents}
              plan={plan ?? null}
              isPlanMode={Boolean(isPlanMode)}
              isProcessing={Boolean(isProcessing)}
              mergePlanIntoTodos={mergePlanIntoTodos}
              sessionFileChanges={sessionFileChanges}
              sessionScopeKey={activeThreadId ?? null}
              piTree={piTreePill}
              backgroundTasksScope={{
                workspaceId: activeWorkspaceId ?? null,
                threadId: activeThreadId ?? null,
              }}
              isCodexEngine={isCodexEngine}
              onOpenDiffPath={onOpenDiffPath}
              onRevertFile={
                onRevertFile ? handleRevertFileForStrip : undefined
              }
              onRevertAllFiles={
                onRevertAllFiles ? handleRevertAllFilesForStrip : undefined
              }
            />
            <ChatInputBoxAdapter
              ref={chatInputRef}
              text={text}
              disabled={composerInteractionDisabled}
              submitDisabled={
                effectiveSubmitDisabled || collabLocksComposer
              }
              isProcessing={isProcessing}
              streamActivityPhase={resolvedComposerStreamActivityPhase}
              canStop={canStop}
              onSend={handleSend}
              onStop={onStop}
              onTextChange={handleTextChangeWithHistory}
              selectedModelId={resolveComposerAtomicSelectedModelId({
                isSharedSession: isSharedSessionResolved,
                executionTarget: selectedAtomicTarget,
                globalSelectedModelId: selectedModelId,
              })}
              selectedEngine={selectedAtomicTarget?.engine ?? selectedEngine}
              isSharedSession={isSharedSessionResolved}
              // 全场景统一首页 Atomic 双栏 picker（含「本地配置」渠道），
              // 不再维护 conversation native 单栏/无渠道分叉。
              providerTargetPickerMode={
                isSharedSessionResolved && !createSessionTargetPicker
                  ? "shared"
                  : "create-session"
              }
              threadId={activeThreadId}
              engines={engines}
              models={models}
              providerModelCatalogs={providerModelCatalogs}
              providerProfileId={
                selectedAtomicTarget
                  ? (selectedAtomicTarget.providerProfileId ?? null)
                  : providerProfileId
              }
              executionTarget={selectedAtomicTarget}
              onExecutionTargetChange={
                isSharedSessionResolved && !sharedTargetPickerLocked
                  ? handleSharedTargetChange
                  : createSessionTargetPicker
                    ? handleCreationTargetChange
                    : handleNativeAtomicTargetChange
              }
              reasoningOptions={atomicReasoningOptions}
              selectedEffort={
                useAtomicReasoningProjection
                  ? atomicSelectedEffort
                  : selectedEffort
              }
              onSelectEffort={
                sharedTargetPickerLocked
                  ? undefined
                  : isSharedSessionResolved &&
                      isResolvedExecutionTarget(selectedSharedTarget)
                    ? handleSharedEffortChange
                    : createSessionTargetPicker &&
                        isAtomicExecutionTarget(effectiveCreationTarget)
                      ? handleCreationEffortChange
                      : onSelectEffort
              }
              reasoningSupported={reasoningSupported}
              onResolvedAlwaysThinkingChange={onResolvedAlwaysThinkingChange}
              attachments={attachedImages}
              hasContextAttachment={intentCanvasAttachments.length > 0}
              onAddAttachment={
                onPickImages || !imageInputSupported
                  ? handlePickImagesGuarded
                  : undefined
              }
              onAttachImages={
                onAttachImages ? handleAttachImagesGuarded : undefined
              }
              onRemoveAttachment={onRemoveImage}
              textareaHeight={textareaHeight}
              onHeightChange={onTextareaHeightChange}
              contextUsage={resolvedLegacyContextUsage}
              claudeContextUsage={resolvedClaudeContextUsage}
              queuedMessages={queuedMessages}
              onDeleteQueued={onDeleteQueued}
              onFuseQueued={onFuseQueued}
              canFuseQueuedMessages={canFuseQueuedMessages}
              fuseDisabledReasonKey={fuseDisabledReasonKey}
              fusingQueuedMessageId={fusingQueuedMessageId}
              suggestionsOpen={suggestionsOpen}
              files={files}
              customSkillDirectories={customSkillDirectories}
              directories={directories}
              commands={commands}
              prompts={prompts}
              workspaceId={activeWorkspaceId}
              workspaceName={activeWorkspaceName}
              workspacePath={activeWorkspacePath}
              onManualMemorySelect={handleSelectManualMemory}
              onNoteCardSelect={handleSelectNoteCard}
              onSelectSkill={handleSelectSkill}
              sendShortcut={sendShortcut}
              interruptShortcutLabel={interruptShortcutLabel}
              placeholder={
                collabLocksComposer
                  ? t("multiAgent.entry.collabRunningLock")
                  : sendShortcut === "cmdEnter"
                    ? t("chat.inputPlaceholderCmdEnter")
                    : t("chat.inputPlaceholderEnter")
              }
              activeFile={
                hasActiveFileReference
                  ? (activeFilePath ?? undefined)
                  : undefined
              }
              selectedLines={
                hasActiveFileReference ? activeFileLinesLabel : undefined
              }
              onClearContext={
                hasActiveFileReference ? handleClearContext : undefined
              }
              selectedAgent={selectedChatInputAgent}
              selectedContextChips={contextSelectionChips}
              selectedManualMemoryIds={selectedManualMemoryIds}
              selectedNoteCardIds={selectedNoteCardIds}
              onRemoveContextChip={handleRemoveContextChip}
              onAgentSelect={handleAgentSelect}
              onOpenAgentSettings={onOpenAgentSettings}
              onOpenPromptSettings={onOpenPromptSettings}
              onOpenModelSettings={onOpenModelSettings}
              onOpenCliSettings={onOpenCliSettings}
              onOpenFileReference={onOpenDiffPath}
              onRefreshModelConfig={onRefreshModelConfig}
              isModelConfigRefreshing={isModelConfigRefreshing}
              permissionMode={selectedPermissionMode}
              onModeSelect={handleModeSelect}
              dshAgentPreset={resolvedDshAgentPreset}
              dshAgentPresetLocked={dshAgentPresetLocked}
              onDshAgentPresetSelect={handleDshAgentPresetSelect}
              sendReadiness={composerSendReadiness}
              onJumpToRequest={
                activeUserInputRequest
                  ? handleJumpToUserInputRequest
                  : undefined
              }
              onOpenSkillsSettings={_onOpenSkillsSettings}
              selectedCollaborationModeId={_selectedCollaborationModeId}
              onSelectCollaborationMode={_onSelectCollaborationMode}
              accountRateLimits={resolvedAccountRateLimits}
              usageShowRemaining={usageShowRemaining}
              onRefreshAccountRateLimits={onRefreshAccountRateLimits}
              onCodexQuickCommand={handleCodexQuickCommand}
              onForkQuickStart={handleForkQuickStart}
              memoryReferenceMode={memoryReferenceMode}
              memoryReferenceDismissed={memoryReferenceDismissed}
              onSetMemoryReferenceMode={handleSetMemoryReferenceMode}
              onRestoreMemoryReference={handleRestoreMemoryReference}
              hasMessages={items.length > 0}
              onRewind={handleRewind}
              showRewindEntry={canRewindSession}
              statusPanelExpanded={resolvedStatusPanelExpanded}
              showStatusPanelToggle={resolvedShowStatusPanelToggle}
              onToggleStatusPanel={resolvedToggleStatusPanel}
              completionEmailSelected={completionEmailSelected}
              completionEmailDisabled={completionEmailDisabled}
              onToggleCompletionEmail={onToggleCompletionEmail}
            />
            {showComposerBranchRow ? (
              <div className="composer-branch-row">
                {branchControl?.branchName ? (
                  <ComposerBranchBadge {...branchControl} />
                ) : null}
                {showDshSessionStatsLine ? (
                  <DshSessionStatsLine usage={contextUsage} />
                ) : null}
                {showFooterUsageIndicator || isSharedSessionResolved ? (
                  <div className="composer-branch-row-trailing">
                    {isSharedSessionResolved ? (
                      <div className="composer-collab-slot">
                        <MultiAgentComposerToggle
                          engine={selectedAtomicTarget?.engine}
                          armed={agentArmed || collabRunActive}
                          disabled={
                            disabled ||
                            effectiveSubmitDisabled ||
                            !isResolvedExecutionTarget(selectedAtomicTarget) ||
                            collabRunActive
                          }
                          hasActiveRun={collabRunActive}
                          onToggle={() => {
                            if (collabRunActive) return;
                            setAgentArmed((armed) => !armed);
                          }}
                          onArm={() => setAgentArmed(true)}
                        />
                        <SharedProviderRetryToggle
                          workspaceId={activeWorkspaceId}
                          threadId={activeThreadId}
                          engine={selectedAtomicTarget?.engine ?? selectedEngine}
                          disabled={collabRunActive}
                        />
                      </div>
                    ) : null}
                    {showFooterUsageIndicator ? (
                      <div className="composer-branch-row-usage">
                        {codexContextDualViewEnabled ? (
                          <ContextBar
                            surface="tool-popover"
                            contextDualViewEnabled
                            dualContextUsage={resolvedDualContextUsage}
                            onRequestContextCompaction={
                              handleManualCompactContext
                            }
                            codexAutoCompactionEnabled={
                              codexAutoCompactionEnabled
                            }
                            codexAutoCompactionThresholdPercent={
                              codexAutoCompactionThresholdPercent
                            }
                            onCodexAutoCompactionSettingsChange={
                              onCodexAutoCompactionSettingsChange
                            }
                            currentProvider="codex"
                          />
                        ) : selectedEngine === "pi" && // capability-router-allow-engine-branch: pi-only /compact entry, 见 enhance-pi-native-rpc-session
                        activeWorkspaceId &&
                        activeThreadId ? (
                          <PiCompactEntry
                            percentage={footerUsagePercentage}
                            workspaceId={activeWorkspaceId}
                            threadId={activeThreadId}
                            disabled={Boolean(isProcessing)}
                          />
                        ) : (
                          <TokenIndicator
                            percentage={footerUsagePercentage}
                            usedTokens={resolvedLegacyContextUsage?.used}
                            maxTokens={resolvedLegacyContextUsage?.total}
                            claudeContextUsage={
                              selectedEngine === "claude" ||
                              selectedEngine === "dsh"
                                ? resolvedClaudeContextUsage
                                : null
                            }
                          />
                        )}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>
      <ClaudeRewindConfirmDialog
        preview={rewindPreviewState}
        isBusy={rewindInFlight}
        rewindMode={rewindMode}
        shouldShowAffectedFiles={
          !rewindWorkspaceGitState?.isGitRepository ||
          Boolean(rewindWorkspaceGitState.hasDetectedChanges)
        }
        onRewindModeChange={setRewindMode}
        onOpenDiffPath={onOpenDiffPath}
        onStoreChanges={handleStoreRewindChanges}
        onCancel={handleCancelRewind}
        onConfirm={handleConfirmRewind}
      />
    </footer>
  );
}


/**
 * 根治路径：先挂 ComposerLight（与完整态同一套工具栏结构：模型位始终占位 loading），
 * 停手后再挂 ComposerImpl。模型未就绪时只在「模型选择」槽显示 loading，禁止缺位布局。
 * warm 后直开 full，避免历史会话再走一遍残缺态。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IS_VITEST =
  typeof import.meta !== "undefined" && (import.meta as any).env?.MODE === "test";

/** 进程内 warm：完整 Composer 安全挂过一次后，后续挂载直开 full */
let composerHeavyWarmed = false;

function ComposerGate(props: ComposerProps) {
  const [full, setFull] = useState(() => IS_VITEST || composerHeavyWarmed);

  useEffect(() => {
    if (IS_VITEST || full) {
      return;
    }
    ensureInteractiveInputHooks();
    const mountedAt = Date.now();
    let cancelled = false;
    let timerId: number | null = null;

    const tick = () => {
      if (cancelled) {
        return;
      }
      const now = Date.now();
      const lastInput = getLastInteractiveInputAtMs();
      const elapsed = now - mountedAt;
      const hadInputSinceMount = lastInput >= mountedAt;
      const quietFor = now - lastInput;

      // 冷启点权限模式 / 模型位 / 输入框也是 pointerdown。旧逻辑把
      // 「点过 + 静默 1.2s」当成可以挂 ComposerImpl，正好复现
      // 2026-08-11 Composer freeze。早期点击只推迟升级，不升级。
      if (
        shouldUpgradeComposerFromLight({
          elapsedMs: elapsed,
          hadInputSinceMount,
          quietForMs: quietFor,
          recentInput: hadRecentInteractiveInput(250),
          startupGateReady: getStartupGateReadyReason() != null,
        })
      ) {
        composerHeavyWarmed = true;
        setFull(true);
        return;
      }

      timerId = window.setTimeout(tick, 150);
    };

    timerId = window.setTimeout(tick, 400);
    return () => {
      cancelled = true;
      if (timerId != null) {
        window.clearTimeout(timerId);
      }
    };
  }, [full]);

  useEffect(() => {
    if (full) {
      composerHeavyWarmed = true;
    }
  }, [full]);

  if (full) {
    return <ComposerImpl {...props} />;
  }
  return <ComposerLight {...props} />;
}

export const Composer = memo(ComposerGate, areComposerPropsEqual);

/** @internal 测试可重置 warm，避免污染其它用例 */

