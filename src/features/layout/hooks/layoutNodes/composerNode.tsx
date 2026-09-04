import {
  Profiler,
  type ComponentProps,
  type ProfilerOnRenderCallback,
  type ReactNode,
} from "react";
import type { CodeAnnotationSelection } from "../../../code-annotations/types";
import {
  type Composer,
  type ComposerNoteCardSelectionRequest,
  type ComposerRewindDialogRequest,
} from "../../../composer/components/Composer";
import { SharedSendStatusBar } from "../../../shared-session/components/SharedSendStatusBar";
import {
  isComposerInputLocked,
  isComposerSubmitLocked,
  isPickerLocked,
  type SharedSendState,
} from "../../../shared-session/target/sendStateMachine";
import { isManagedEngineProviderProfileId } from "../../../threads/hooks/sessionLifecycleController";
import type {
  CustomCommandOption,
  EngineType,
  RequestUserInputRequest,
  ThreadSummary,
} from "../../../../types";
import { EMPTY_ACTIVE_CANVAS_ITEMS } from "../activeCanvasStore";
import { ActiveCanvasComposer } from "../activeCanvasComposerNode";
import type { deriveRewindWorkspaceGitState } from "../rewindWorkspaceGitState";
import type { resolveRuntimeLifecycleForComposer } from "../runtimeLifecycle";
import type {
  LayoutNodesFlatOptions,
  ThreadActivityStatus,
} from "../layoutNodesTypes";

export type BuildComposerNodeInput = Pick<
  LayoutNodesFlatOptions,
  | "showComposer"
  | "threadParentById"
  | "onSend"
  | "onQueue"
  | "onRequestContextCompaction"
  | "onStop"
  | "completionEmailSelected"
  | "completionEmailDisabled"
  | "onToggleCompletionEmail"
  | "onRewind"
  | "canStop"
  | "isReviewing"
  | "contextDualViewEnabled"
  | "codexAutoCompactionEnabled"
  | "codexAutoCompactionThresholdPercent"
  | "onCodexAutoCompactionSettingsChange"
  | "usageShowRemaining"
  | "onRefreshAccountRateLimits"
  | "activeQueue"
  | "composerSendLabel"
  | "isProcessing"
  | "steerEnabled"
  | "onDraftChange"
  | "activeImages"
  | "onPickImages"
  | "onAttachImages"
  | "onRemoveImage"
  | "pendingIntentCanvasDocuments"
  | "onRemovePendingIntentCanvas"
  | "prefillDraft"
  | "onPrefillHandled"
  | "insertText"
  | "onInsertHandled"
  | "onEditQueued"
  | "onDeleteQueued"
  | "onFuseQueued"
  | "canFuseActiveQueue"
  | "fuseDisabledReasonKey"
  | "activeFusingMessageId"
  | "collaborationModes"
  | "collaborationModesEnabled"
  | "selectedCollaborationModeId"
  | "onSelectCollaborationMode"
  | "engines"
  | "selectedEngine"
  | "onSelectEngine"
  | "models"
  | "providerModelCatalogs"
  | "selectedModelId"
  | "onSelectModel"
  | "reasoningOptions"
  | "selectedEffort"
  | "onSelectEffort"
  | "reasoningSupported"
  | "opencodeAgents"
  | "selectedOpenCodeAgent"
  | "onSelectOpenCodeAgent"
  | "onSelectAgent"
  | "onOpenAgentSettings"
  | "onOpenPromptSettings"
  | "onOpenModelSettings"
  | "onOpenCliSettings"
  | "onRefreshModelConfig"
  | "isModelConfigRefreshing"
  | "opencodeVariantOptions"
  | "selectedOpenCodeVariant"
  | "onSelectOpenCodeVariant"
  | "accessMode"
  | "onSelectAccessMode"
  | "skills"
  | "customSkillDirectories"
  | "prompts"
  | "files"
  | "directories"
  | "textareaRef"
  | "composerEditorSettings"
  | "composerSendShortcut"
  | "composerInterruptShortcutLabel"
  | "textareaHeight"
  | "onTextareaHeightChange"
  | "onOpenSkillsSettings"
  | "onOpenExperimentalSettings"
  | "activeComposerFilePath"
  | "activeComposerFileLineRange"
  | "fileReferenceMode"
  | "activeWorkspaceId"
  | "activeWorkspace"
  | "plan"
  | "isPlanMode"
  | "gitStatus"
  | "queueGitStatusRefresh"
  | "onRevertGitFile"
  | "onRevertGitPaths"
  | "reviewPrompt"
  | "onReviewPromptClose"
  | "onReviewPromptShowPreset"
  | "onReviewPromptChoosePreset"
  | "highlightedPresetIndex"
  | "onReviewPromptHighlightPreset"
  | "highlightedBranchIndex"
  | "onReviewPromptHighlightBranch"
  | "highlightedCommitIndex"
  | "onReviewPromptHighlightCommit"
  | "onReviewPromptKeyDown"
  | "onReviewPromptSelectBranch"
  | "onReviewPromptSelectBranchAtIndex"
  | "onReviewPromptConfirmBranch"
  | "onReviewPromptSelectCommit"
  | "onReviewPromptSelectCommitAtIndex"
  | "onReviewPromptConfirmCommit"
  | "onReviewPromptUpdateCustomInstructions"
  | "onReviewPromptConfirmCustom"
  | "activeThreadId"
> & {
  branchControlEnabled: boolean;
  externalNoteCardRequest: ComposerNoteCardSelectionRequest | null;
  createSessionTargetPicker: boolean;
  handleRuntimeProfileRender: ProfilerOnRenderCallback;
  rewindDialogRequest: ComposerRewindDialogRequest | null;
  handleRewindDialogRequestConsumed: (requestId: number) => void;
  isSharedSession: boolean;
  sharedSendState: SharedSendState;
  activeThreadStatus: ThreadActivityStatus | null;
  handleJumpToUserInputRequest: (request: RequestUserInputRequest) => void;
  composerRuntimeLifecycleState: ReturnType<
    typeof resolveRuntimeLifecycleForComposer
  >;
  t: (key: string) => string;
  composerSelectedAgent: ComponentProps<typeof Composer>["selectedAgent"];
  composerBranchControl: ComponentProps<typeof Composer>["branchControl"];
  rewindWorkspaceGitState: ReturnType<typeof deriveRewindWorkspaceGitState>;
  handleComposerOpenDiffPath: (path: string) => void;
  selectedCodeAnnotations: CodeAnnotationSelection[];
  handleRemoveCodeAnnotation: (annotationId: string) => void;
  handleClearCodeAnnotations: () => void;
  setHomeCreationTargetEngine: (next: EngineType | null) => void;
  activeThreadSummary: ThreadSummary | null;
  composerCommands: CustomCommandOption[];
  handleResolvedAlwaysThinkingChange: (enabled: boolean) => void;
};

export function buildComposerNode({
  branchControlEnabled,
  externalNoteCardRequest,
  createSessionTargetPicker,
  handleRuntimeProfileRender,
  rewindDialogRequest,
  handleRewindDialogRequestConsumed,
  isSharedSession,
  sharedSendState,
  activeThreadStatus,
  handleJumpToUserInputRequest,
  composerRuntimeLifecycleState,
  t,
  composerSelectedAgent,
  composerBranchControl,
  rewindWorkspaceGitState,
  handleComposerOpenDiffPath,
  selectedCodeAnnotations,
  handleRemoveCodeAnnotation,
  handleClearCodeAnnotations,
  setHomeCreationTargetEngine,
  activeThreadSummary,
  composerCommands,
  handleResolvedAlwaysThinkingChange,
  showComposer,
  threadParentById,
  onSend,
  onQueue,
  onRequestContextCompaction,
  onStop,
  completionEmailSelected,
  completionEmailDisabled,
  onToggleCompletionEmail,
  onRewind,
  canStop,
  isReviewing,
  contextDualViewEnabled,
  codexAutoCompactionEnabled,
  codexAutoCompactionThresholdPercent,
  onCodexAutoCompactionSettingsChange,
  usageShowRemaining,
  onRefreshAccountRateLimits,
  activeQueue,
  composerSendLabel,
  isProcessing,
  steerEnabled,
  onDraftChange,
  activeImages,
  onPickImages,
  onAttachImages,
  onRemoveImage,
  pendingIntentCanvasDocuments,
  onRemovePendingIntentCanvas,
  prefillDraft,
  onPrefillHandled,
  insertText,
  onInsertHandled,
  onEditQueued,
  onDeleteQueued,
  onFuseQueued,
  canFuseActiveQueue,
  fuseDisabledReasonKey,
  activeFusingMessageId,
  collaborationModes,
  collaborationModesEnabled,
  selectedCollaborationModeId,
  onSelectCollaborationMode,
  engines,
  selectedEngine,
  onSelectEngine,
  models,
  providerModelCatalogs,
  selectedModelId,
  onSelectModel,
  reasoningOptions,
  selectedEffort,
  onSelectEffort,
  reasoningSupported,
  opencodeAgents,
  selectedOpenCodeAgent,
  onSelectOpenCodeAgent,
  onSelectAgent,
  onOpenAgentSettings,
  onOpenPromptSettings,
  onOpenModelSettings,
  onOpenCliSettings,
  onRefreshModelConfig,
  isModelConfigRefreshing,
  opencodeVariantOptions,
  selectedOpenCodeVariant,
  onSelectOpenCodeVariant,
  accessMode,
  onSelectAccessMode,
  skills,
  customSkillDirectories,
  prompts,
  files,
  directories,
  textareaRef,
  composerEditorSettings,
  composerSendShortcut,
  composerInterruptShortcutLabel,
  textareaHeight,
  onTextareaHeightChange,
  onOpenSkillsSettings,
  onOpenExperimentalSettings,
  activeComposerFilePath,
  activeComposerFileLineRange,
  fileReferenceMode,
  activeWorkspaceId,
  activeWorkspace,
  plan,
  isPlanMode,
  gitStatus,
  queueGitStatusRefresh,
  onRevertGitFile,
  onRevertGitPaths,
  reviewPrompt,
  onReviewPromptClose,
  onReviewPromptShowPreset,
  onReviewPromptChoosePreset,
  highlightedPresetIndex,
  onReviewPromptHighlightPreset,
  highlightedBranchIndex,
  onReviewPromptHighlightBranch,
  highlightedCommitIndex,
  onReviewPromptHighlightCommit,
  onReviewPromptKeyDown,
  onReviewPromptSelectBranch,
  onReviewPromptSelectBranchAtIndex,
  onReviewPromptConfirmBranch,
  onReviewPromptSelectCommit,
  onReviewPromptSelectCommitAtIndex,
  onReviewPromptConfirmCommit,
  onReviewPromptUpdateCustomInstructions,
  onReviewPromptConfirmCustom,
  activeThreadId,
}: BuildComposerNodeInput): ReactNode {
  return showComposer ? (
    <Profiler id="composer" onRender={handleRuntimeProfileRender}>
      {/*
        SharedSendStatusBar 与无协作 Shared 一致：贴在 Composer 输入区底部集群。
        放在 ActiveCanvasComposer 之后，避免协作 sticky 卡把状态条夹在中间。
      */}
      <ActiveCanvasComposer
        items={EMPTY_ACTIVE_CANVAS_ITEMS}
        activeThreadId={null}
        threadItemsByThread={{}}
        threadParentById={threadParentById}
        threadStatusById={{}}
        onSend={onSend}
        onQueue={onQueue}
        onRequestContextCompaction={onRequestContextCompaction}
        onStop={onStop}
        completionEmailSelected={completionEmailSelected}
        completionEmailDisabled={completionEmailDisabled}
        onToggleCompletionEmail={onToggleCompletionEmail}
        onRewind={onRewind}
        rewindDialogRequest={rewindDialogRequest}
        onRewindDialogRequestConsumed={handleRewindDialogRequestConsumed}
        canStop={canStop}
        disabled={
          isReviewing ||
          (!createSessionTargetPicker &&
            isComposerInputLocked(sharedSendState))
        }
        submitDisabled={
          !createSessionTargetPicker &&
          isComposerSubmitLocked(sharedSendState)
        }
        contextUsage={null}
        contextDualViewEnabled={contextDualViewEnabled}
        codexAutoCompactionEnabled={codexAutoCompactionEnabled}
        codexAutoCompactionThresholdPercent={
          codexAutoCompactionThresholdPercent
        }
        onCodexAutoCompactionSettingsChange={
          onCodexAutoCompactionSettingsChange
        }
        isContextCompacting={activeThreadStatus?.isContextCompacting ?? false}
        codexCompactionLifecycleState={
          activeThreadStatus?.codexCompactionLifecycleState ?? "idle"
        }
        codexCompactionSource={
          activeThreadStatus?.codexCompactionSource ?? null
        }
        codexCompactionCompletedAt={
          activeThreadStatus?.codexCompactionCompletedAt ?? null
        }
        lastTokenUsageUpdatedAt={
          activeThreadStatus?.lastTokenUsageUpdatedAt ?? null
        }
        accountRateLimits={null}
        usageShowRemaining={usageShowRemaining}
        onRefreshAccountRateLimits={onRefreshAccountRateLimits}
        queuedMessages={activeQueue}
        userInputRequests={[]}
        onJumpToUserInputRequest={handleJumpToUserInputRequest}
        runtimeLifecycleState={composerRuntimeLifecycleState}
        sendLabel={
          composerSendLabel ??
          ((isSharedSession &&
            (sharedSendState === "running" ||
              sharedSendState === "settling")) ||
          (isProcessing && !steerEnabled)
            ? t("messages.queue")
            : t("messages.send"))
        }
        steerEnabled={steerEnabled}
        isProcessing={isProcessing}
        onDraftChange={onDraftChange}
        attachedImages={activeImages}
        onPickImages={onPickImages}
        onAttachImages={onAttachImages}
        onRemoveImage={onRemoveImage}
        intentCanvasAttachments={pendingIntentCanvasDocuments}
        onRemoveIntentCanvasAttachment={onRemovePendingIntentCanvas}
        prefillDraft={prefillDraft}
        onPrefillHandled={onPrefillHandled}
        insertText={insertText}
        onInsertHandled={onInsertHandled}
        onEditQueued={onEditQueued}
        onDeleteQueued={onDeleteQueued}
        onFuseQueued={onFuseQueued}
        canFuseQueuedMessages={canFuseActiveQueue}
        fuseDisabledReasonKey={fuseDisabledReasonKey ?? null}
        fusingQueuedMessageId={activeFusingMessageId}
        collaborationModes={collaborationModes}
        collaborationModesEnabled={collaborationModesEnabled}
        selectedCollaborationModeId={selectedCollaborationModeId}
        onSelectCollaborationMode={onSelectCollaborationMode}
        isSharedSession={isSharedSession && !createSessionTargetPicker}
        createSessionTargetPicker={createSessionTargetPicker}
        onCreationTargetEngineChange={
          createSessionTargetPicker
            ? setHomeCreationTargetEngine
            : undefined
        }
        sharedTargetPickerLocked={
          !createSessionTargetPicker && isPickerLocked(sharedSendState)
        }
        engines={engines}
        selectedEngine={selectedEngine}
        onSelectEngine={onSelectEngine}
        models={models}
        providerModelCatalogs={providerModelCatalogs}
        providerProfileId={
          isManagedEngineProviderProfileId(
            activeThreadSummary?.providerProfileId,
          )
            ? activeThreadSummary?.providerProfileId
            : null
        }
        providerProfileName={activeThreadSummary?.providerProfileName ?? null}
        dshAgentPreset={activeThreadSummary?.dshAgentPreset ?? null}
        selectedModelId={selectedModelId}
        onSelectModel={onSelectModel}
        reasoningOptions={reasoningOptions}
        selectedEffort={selectedEffort}
        onSelectEffort={onSelectEffort}
        reasoningSupported={reasoningSupported}
        onResolvedAlwaysThinkingChange={handleResolvedAlwaysThinkingChange}
        opencodeAgents={opencodeAgents}
        selectedOpenCodeAgent={selectedOpenCodeAgent}
        onSelectOpenCodeAgent={onSelectOpenCodeAgent}
        selectedAgent={composerSelectedAgent}
        onAgentSelect={onSelectAgent}
        onOpenAgentSettings={onOpenAgentSettings}
        onOpenPromptSettings={onOpenPromptSettings}
        onOpenModelSettings={onOpenModelSettings}
        onOpenCliSettings={onOpenCliSettings}
        onRefreshModelConfig={onRefreshModelConfig}
        isModelConfigRefreshing={isModelConfigRefreshing}
        opencodeVariantOptions={opencodeVariantOptions}
        selectedOpenCodeVariant={selectedOpenCodeVariant}
        onSelectOpenCodeVariant={onSelectOpenCodeVariant}
        accessMode={accessMode}
        onSelectAccessMode={onSelectAccessMode}
        skills={skills}
        customSkillDirectories={customSkillDirectories}
        prompts={prompts}
        commands={composerCommands}
        files={files}
        directories={directories}
        textareaRef={textareaRef}
        editorSettings={composerEditorSettings}
        sendShortcut={composerSendShortcut}
        interruptShortcutLabel={composerInterruptShortcutLabel}
        textareaHeight={textareaHeight}
        onTextareaHeightChange={onTextareaHeightChange}
        onOpenSkillsSettings={onOpenSkillsSettings}
        onOpenExperimentalSettings={onOpenExperimentalSettings}
        activeFilePath={activeComposerFilePath}
        activeFileLineRange={activeComposerFileLineRange}
        fileReferenceMode={fileReferenceMode}
        activeWorkspaceId={activeWorkspaceId}
        activeWorkspaceName={activeWorkspace?.name ?? null}
        activeWorkspacePath={activeWorkspace?.path ?? null}
        branchControl={branchControlEnabled ? composerBranchControl : null}
        // 首页（branchControlEnabled=false）的分支/指示器行由 HomeChat 自行渲染
        footerUsageIndicatorEnabled={branchControlEnabled}
        rewindWorkspaceGitState={rewindWorkspaceGitState}
        plan={plan}
        isPlanMode={isPlanMode}
        onOpenDiffPath={handleComposerOpenDiffPath}
        gitChangedFiles={
          // 非 git 仓库时传 null，退回 tool 统计；空数组表示 clean working tree
          gitStatus.error === "not a git repository"
            ? null
            : gitStatus.files
        }
        isGitRepository={gitStatus.error !== "not a git repository"}
        onRequestGitStatusRefresh={queueGitStatusRefresh}
        onRevertFile={onRevertGitFile}
        onRevertAllFiles={onRevertGitPaths}
        showStatusPanelToggleOverride={false}
        statusPanelExpandedOverride={false}
        onToggleStatusPanelOverride={undefined}
        selectedCodeAnnotations={selectedCodeAnnotations}
        onRemoveCodeAnnotation={handleRemoveCodeAnnotation}
        onClearCodeAnnotations={handleClearCodeAnnotations}
        externalNoteCardSelectionRequest={externalNoteCardRequest}
        reviewPrompt={reviewPrompt}
        onReviewPromptClose={onReviewPromptClose}
        onReviewPromptShowPreset={onReviewPromptShowPreset}
        onReviewPromptChoosePreset={onReviewPromptChoosePreset}
        highlightedPresetIndex={highlightedPresetIndex}
        onReviewPromptHighlightPreset={onReviewPromptHighlightPreset}
        highlightedBranchIndex={highlightedBranchIndex}
        onReviewPromptHighlightBranch={onReviewPromptHighlightBranch}
        highlightedCommitIndex={highlightedCommitIndex}
        onReviewPromptHighlightCommit={onReviewPromptHighlightCommit}
        onReviewPromptKeyDown={onReviewPromptKeyDown}
        onReviewPromptSelectBranch={onReviewPromptSelectBranch}
        onReviewPromptSelectBranchAtIndex={
          onReviewPromptSelectBranchAtIndex
        }
        onReviewPromptConfirmBranch={onReviewPromptConfirmBranch}
        onReviewPromptSelectCommit={onReviewPromptSelectCommit}
        onReviewPromptSelectCommitAtIndex={
          onReviewPromptSelectCommitAtIndex
        }
        onReviewPromptConfirmCommit={onReviewPromptConfirmCommit}
        onReviewPromptUpdateCustomInstructions={
          onReviewPromptUpdateCustomInstructions
        }
        onReviewPromptConfirmCustom={onReviewPromptConfirmCustom}
      />
      <SharedSendStatusBar
        workspaceId={activeWorkspaceId ?? null}
        threadId={activeThreadId ?? null}
        isSharedSession={isSharedSession && !createSessionTargetPicker}
      />
    </Profiler>
  ) : null;
}
