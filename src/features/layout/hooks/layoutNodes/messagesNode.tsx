import type { ReactNode } from "react";
import { CollabTimelineWaiting } from "../../../multi-agent/components/CollabTimelineWaiting";
import type { NoteCaptureDraft } from "../../../note-cards/types";
import { ProviderContinuationContextCard } from "../../../shared-session/components/ProviderContinuationContextCard";
import type { ProviderContinuationSourceExcerpt } from "../../../shared-session/components/providerContinuationSourceExcerpt";
import { SharedProviderRetryHint } from "../../../shared-session/provider-retry/SharedProviderRetryHint";
import {
  CODEX_DISK_PROVIDER_PROFILE_ID,
  type CodexProviderProfileOption,
  type CodexProviderProfileSelection,
} from "../../../threads/constants/codexProviderProfiles";
import type { ConversationEngine } from "../../../threads/contracts/conversationCurtainContracts";
import type { ThreadSummary } from "../../../../types";
import { resolvePresentationProfile } from "../../../../conversation-presentation/presentationProfile";
import { EMPTY_ACTIVE_CANVAS_ITEMS } from "../activeCanvasStore";
import { buildConversationCanvasNode } from "../conversationCanvasNode";
import type { LayoutNodesFlatOptions } from "../layoutNodesTypes";

export type BuildMessagesNodeInput = Pick<
  LayoutNodesFlatOptions,
  | "activeWorkspaceId"
  | "activeThreadId"
  | "openAppTargets"
  | "selectedOpenAppId"
  | "codeBlockCopyUseModifier"
  | "workspaces"
  | "handleUserInputSubmit"
  | "handleUserInputDismiss"
  | "onRecoverThreadRuntime"
  | "onRecoverThreadRuntimeAndResend"
  | "onThreadRecoveryFork"
  | "onRewind"
  | "handleApprovalDecision"
  | "handleApprovalBatchAccept"
  | "handleApprovalRemember"
  | "selectedCollaborationModeId"
  | "isPlanMode"
  | "onOpenPlanPanel"
  | "handleExitPlanModeExecute"
  | "onOpenFile"
  | "agentTaskScrollRequest"
  | "systemProxyEnabled"
  | "systemProxyUrl"
> & {
  activeThreadSummary: ThreadSummary | null;
  continuationContext: {
    source: ThreadSummary | null;
    sourceExcerpt: ProviderContinuationSourceExcerpt | null;
    onOpenSource: (() => void) | null;
  } | null;
  showMessageAnchors: boolean;
  onForkFromMessage: LayoutNodesFlatOptions["onForkFromMessage"];
  handleOpenForkConfirmFromMessage: (messageId: string) => void;
  handleOpenRewindDialogFromMessage: (messageId: string) => void;
  presentationProfile: ReturnType<typeof resolvePresentationProfile> | null;
  conversationEngine: ConversationEngine;
  claudeThinkingVisible: boolean | undefined;
  handleOpenDiffPath: (path: string) => void;
  handlePreviewFileDiff: (path: string) => void;
  handleCaptureWorkspaceNote: (draft: NoteCaptureDraft) => void;
  handleRetryHistory: () => void;
  forkConfirmUserMessageId: string | null;
  handleCancelForkConfirm: () => void;
  handleConfirmForkFromMessage: (
    messageId: string,
    options?: CodexProviderProfileSelection,
  ) => Promise<void>;
  codexForkProviderProfiles: CodexProviderProfileOption[];
};

export function buildMessagesNode({
  activeWorkspaceId,
  activeThreadId,
  openAppTargets,
  selectedOpenAppId,
  codeBlockCopyUseModifier,
  workspaces,
  handleUserInputSubmit,
  handleUserInputDismiss,
  onRecoverThreadRuntime,
  onRecoverThreadRuntimeAndResend,
  onThreadRecoveryFork,
  onRewind,
  handleApprovalDecision,
  handleApprovalBatchAccept,
  handleApprovalRemember,
  selectedCollaborationModeId,
  isPlanMode,
  onOpenPlanPanel,
  handleExitPlanModeExecute,
  onOpenFile,
  agentTaskScrollRequest,
  systemProxyEnabled,
  systemProxyUrl,
  activeThreadSummary,
  continuationContext,
  showMessageAnchors,
  onForkFromMessage,
  handleOpenForkConfirmFromMessage,
  handleOpenRewindDialogFromMessage,
  presentationProfile,
  conversationEngine,
  claudeThinkingVisible,
  handleOpenDiffPath,
  handlePreviewFileDiff,
  handleCaptureWorkspaceNote,
  handleRetryHistory,
  forkConfirmUserMessageId,
  handleCancelForkConfirm,
  handleConfirmForkFromMessage,
  codexForkProviderProfiles,
}: BuildMessagesNodeInput): ReactNode {
  return buildConversationCanvasNode({
    isProviderContinuation:
      activeThreadSummary?.originKind === "provider-continuation",
    timelineTrailingNode: (
      <>
        <CollabTimelineWaiting
          workspaceId={activeWorkspaceId}
          threadId={activeThreadId ?? null}
        />
        <SharedProviderRetryHint
          workspaceId={activeWorkspaceId}
          threadId={activeThreadId ?? null}
        />
      </>
    ),
    continuationContextNode:
      activeThreadSummary?.originKind === "provider-continuation" ? (
        <ProviderContinuationContextCard
          thread={activeThreadSummary}
          source={continuationContext?.source ?? null}
          sourceExcerpt={continuationContext?.sourceExcerpt ?? null}
          onOpenSource={continuationContext?.onOpenSource ?? null}
        />
      ) : null,
    messagesProps: {
      items: EMPTY_ACTIVE_CANVAS_ITEMS,
      threadId: null,
      workspaceId: null,
      workspacePath: null,
      openTargets: openAppTargets,
      selectedOpenAppId: selectedOpenAppId,
      showMessageAnchors,
      codeBlockCopyUseModifier: codeBlockCopyUseModifier,
      userInputRequests: [],
      approvals: [],
      workspaces: workspaces,
      onUserInputSubmit: handleUserInputSubmit,
      onUserInputDismiss: handleUserInputDismiss,
      onRecoverThreadRuntime: onRecoverThreadRuntime,
      onRecoverThreadRuntimeAndResend:
        onRecoverThreadRuntimeAndResend,
      onThreadRecoveryFork: onThreadRecoveryFork,
      onForkFromMessage: onForkFromMessage
        ? handleOpenForkConfirmFromMessage
        : undefined,
      onRewindFromMessage: onRewind
        ? handleOpenRewindDialogFromMessage
        : undefined,
      onApprovalDecision: handleApprovalDecision,
      onApprovalBatchAccept: handleApprovalBatchAccept,
      onApprovalRemember: handleApprovalRemember,
      conversationState: null,
      presentationProfile,
      activeEngine: conversationEngine,
      claudeThinkingVisible,
      activeCollaborationModeId: selectedCollaborationModeId,
      plan: null,
      isPlanMode: isPlanMode,
      isPlanProcessing: false,
      onOpenDiffPath: handleOpenDiffPath,
      onPreviewFileDiff: handlePreviewFileDiff,
      onOpenPlanPanel: onOpenPlanPanel,
      onExitPlanModeExecute: handleExitPlanModeExecute,
      onOpenWorkspaceFile: onOpenFile,
      onCaptureNote: handleCaptureWorkspaceNote,
      agentTaskScrollRequest: agentTaskScrollRequest,
      isThinking: false,
      isHistoryLoading: false,
      historyRecoveryFailureReason: null,
      onRetryHistory: onRecoverThreadRuntime
        ? handleRetryHistory
        : undefined,
      isContextCompacting: false,
      proxyEnabled: systemProxyEnabled,
      proxyUrl: systemProxyUrl,
      processingStartedAt: null,
      lastDurationMs: null,
      heartbeatPulse: 0,
      codexSilentSuspectedAt: null,
    },
    forkConfirmDialogProps: {
      userMessageId: forkConfirmUserMessageId,
      onCancel: handleCancelForkConfirm,
      onConfirm: handleConfirmForkFromMessage,
      showProviderSelector: conversationEngine === "codex",
      defaultProviderProfileId:
        activeThreadSummary?.providerProfileId ??
        CODEX_DISK_PROVIDER_PROFILE_ID,
      providerProfiles: codexForkProviderProfiles,
    },
  });
}
