import { useCallback, useEffect, useRef } from "react";
import { useOrphanTurnWatchdog } from "./useOrphanTurnWatchdog";
import {
  workspaceScopedDelete,
  workspaceScopedHas,
} from "./workspaceScopedMap";
import { useTranslation } from "react-i18next";
import type {
  ConversationItem,
  WorkspaceInfo,
} from "../../../types";
import {
  extractClaudeForkParentSessionId,
} from "../utils/claudeForkThread";
import { emitMessagesForcePinBottom } from "../../../live-canvas/liveCanvasControls";
import {
  sendUserMessage as sendUserMessageService,
  engineSendMessage as engineSendMessageService,
} from "../../../services/tauri";
import { rememberRuntimeReceipt } from "../utils/runtimeModelReceipt";
import { subscribeMultiAgentConversationItems } from "../../multi-agent/runtime/conversationBridge";
import {
  consumeExplicitComposerEngineSwitch,
  shouldSpawnNativeThreadForEngineMismatch,
} from "../../composer/hooks/explicitComposerEngineSwitch";
import { resolveSendProviderProfileId } from "./sessionLifecycleController";
import { resolvePiFirstMessageEffort } from "../utils/piThinkingDowngrade";
import {
  canonicalQoderProviderProfileId,
  parseQoderSessionIdentity,
} from "../utils/qoderSessionIdentity";
import { getComposerEnginePrefForEngine } from "../../composer/hooks/composerEnginePrefsStore";
import {
  persistableDshAgentPreset,
  resolveDshComposerAgentPreset,
} from "../../composer/components/ChatInputBox/selectors/dshAgentPresets";
import { projectMemoryFacade } from "../../project-memory/services/projectMemoryFacade";
import {
  injectSelectedMemoriesContext,
  type InjectionResult,
} from "../../project-memory/utils/memoryContextInjection";
import {
  injectMemoryScoutBriefContext,
  scoutProjectMemory,
  type MemoryBrief,
} from "../../project-memory/utils/memoryScout";
import { injectMemoryPickContext } from "../../project-memory/memoryPick/injectMemoryPickContext";
import { emitMemoryPickTelemetry } from "../../project-memory/memoryPick/memoryPickTelemetry";
import { resolvePickSemanticContext } from "./threadMessagingMemoryPick";
import {
  recordNativeSendTurnTarget,
  resolveNativeRealSessionId,
  runNativeSendResolve,
  type NativeResolveContext,
} from "./threadMessagingNativeResolve";
import { cachePendingEngineSessionFromResponse } from "./threadMessagingPendingSessionCache";
import { runMemoryPickGate } from "./threadMessagingPickGate";
import {
  acquireSharedSendAdmission,
  noteSharedProviderRetryUserSendIfShared,
  resolveSharedActiveLifecycleCatch,
  resolveSharedSendPreflight,
  runSharedV2Send,
  settleSharedSendFailure,
  shouldEmitThreadMessagingDevLogs,
  useSharedAttemptSettlementCleanup,
  type SharedSendContext,
} from "./threadMessagingSharedSend";
import { noteCardsFacade } from "../../note-cards/services/noteCardsFacade";
import {
  injectSelectedNoteCardsContext,
  NOTE_CARD_CONTEXT_SUMMARY_PREFIX,
  type NoteCardInjectionResult,
} from "../../note-cards/utils/noteCardContextInjection";
import { MEMORY_CONTEXT_SUMMARY_PREFIX } from "../../project-memory/utils/memoryMarkers";
import { expandCustomPromptText } from "../../../utils/customPrompts";
import {
  asString,
  extractRpcErrorMessage,
} from "../utils/threadNormalize";
import { pushErrorToast } from "../../../services/toasts";
import { pushThreadFailureRuntimeNotice } from "../../../services/globalRuntimeNotices";
import { resolveAgentIconForAgent } from "../../../utils/agentIcons";
import { normalizeSharedSessionEngine } from "../../shared-session/utils/sharedSessionEngines";
import {
  engineSupportsImageInput,
  findOversizedImageAttachment,
  formatEngineImageInputUnsupportedMessage,
  formatEngineImageTooLargeMessage,
  sanitizeImageAttachmentPaths,
} from "../../engine/utils/engineImageInput";
import {
  clearPendingClaudeMcpOutputNotice,
  getClaudeMcpRuntimeSnapshot,
  setPendingClaudeMcpOutputNotice,
  rewriteClaudePlaywrightAlias,
} from "../utils/claudeMcpRuntimeSnapshot";
import {
  resolveWorkspaceSpecRoot,
  type SessionSpecLinkContext,
  probeSessionSpecLinkForSend,
} from "./threadMessagingSpecRoot";
import {
  isCodexMissingThreadBindingError,
  isRecoverableCodexThreadBindingError,
  classifyTurnStartReasonCode,
  mapNetworkErrorToUserMessage,
  primeThreadStreamLatencyForSend,
  resolveRecoverableCodexFirstPacketTimeout,
} from "./threadMessagingHelpers";
import {
  classifyStaleThreadRecovery,
  resolveThreadStabilityDiagnostic,
} from "../utils/stabilityDiagnostics";
import { useThreadMessagingSessionTooling } from "./useThreadMessagingSessionTooling";
import { useThreadMessagingThreadResolution } from "./useThreadMessagingThreadResolution";
import { useThreadInterruptTurn } from "./threadMessagingInterrupt";
import { useThreadMessagingReview } from "./threadMessagingReview";
import {
  createOptimisticGeneratedImageProcessingItem,
  extractOptimisticGeneratedImagePrompt,
} from "../utils/generatedImagePlaceholder";
import {
  resolveCodexAcceptedTurnFact,
  shouldDeferCodexActivityUntilTurnAccepted,
} from "../utils/codexConversationLiveness";
import { formatBrowserContextPromptOnce } from "../../browser-agent";
import {
  buildLocalizedMemoryScoutPreviewText,
  withMemoryScoutTimeout,
} from "./messageRuntimeController";
import { useCodexMessageRecovery } from "./useCodexMessageRecovery";
import { assertEngineExecutionEnabled } from "../../../utils/engineExecutionPolicy";
import { resolveSelectedAgentForSend } from "../utils/resolveSelectedAgentForSend";
import { BUILT_IN_AGENT_RESOLUTION_FAILED_EVENT } from "../../agent-catalog/events";

import type {
  HandleFusionStalledOptions,
  SendMessageOptions,
  SendMessageToThreadFn,
  UseThreadMessagingOptions,
  ThreadMessageDispatchResult,
} from "./threadMessagingTypes";
export type { ThreadMessageDispatchResult } from "./threadMessagingTypes";

const AGENT_PROMPT_HEADER = "## Agent Role and Instructions";
const AGENT_PROMPT_NAME_PREFIX = "Agent Name:";
const AGENT_PROMPT_ICON_PREFIX = "Agent Icon:";

export function useThreadMessaging({
  activeWorkspace,
  activeThreadId,
  accessMode,
  model,
  effort,
  collaborationMode,
  resolveComposerSelection,
  claudeThinkingVisible,
  steerEnabled,
  customPrompts,
  activeEngine = "claude",
  threadStatusById,
  itemsByThread,
  activeTurnIdByThread,
  codexAcceptedTurnByThread,
  tokenUsageByThread,
  rateLimitsByWorkspace,
  codexCompactionInFlightByThreadRef,
  pendingInterruptsRef,
  interruptedThreadsRef,
  dispatch,
  getCustomName,
  getThreadEngine,
  getThreadKind,
  getThreadProviderProfileId,
  getThreadDshAgentPreset,
  markProcessing,
  markReviewing,
  setActiveTurnId,
  recordThreadActivity,
  safeMessageActivity,
  onDebug,
  pushThreadErrorMessage,
  ensureThreadForActiveWorkspace,
  ensureThreadForWorkspace,
  refreshThread,
  forkThreadForWorkspace,
  startThreadForWorkspace,
  finalizeCodexPendingThread,
  resolveOpenCodeAgent,
  resolveOpenCodeVariant,
  onInputMemoryCaptured,
  resolveCollaborationRuntimeMode,
  runWithCreateSessionLoading,
  onSharedDurableTurnCommitted,
}: UseThreadMessagingOptions) {
  const { t, i18n } = useTranslation();
  const internalCodexCompactionInFlightByThreadRef = useRef<
    Record<string, boolean>
  >({});
  const effectiveCodexCompactionInFlightByThreadRef =
    codexCompactionInFlightByThreadRef ??
    internalCodexCompactionInFlightByThreadRef;
  const lastOpenCodeModelByThreadRef = useRef<Map<string, string>>(new Map());
  const sessionSpecLinkByThreadRef = useRef<
    Map<string, SessionSpecLinkContext>
  >(new Map());
  const sendMessageToThreadRef = useRef<SendMessageToThreadFn | null>(null);
  const { createRecoveryAttempt } = useCodexMessageRecovery();
  const { armOrphanTurnWatchdog } = useOrphanTurnWatchdog({
    threadStatusById,
    markProcessing,
    setActiveTurnId,
    pushThreadErrorMessage,
    onDebug,
  });
  const {
    claudeCandidateSessionIdByPendingThreadRef,
    claudePendingThreadAwaitingNativeSessionRef,
    geminiSessionIdByPendingThreadRef,
    grokSessionIdByPendingThreadRef,
    kimiSessionIdByPendingThreadRef,
    dshSessionIdByPendingThreadRef,
    piSessionIdByPendingThreadRef,
    ompSessionIdByPendingThreadRef,
    qoderSessionIdByPendingThreadRef,
    isClaudePendingThreadAwaitingNativeSession,
    isThreadIdCompatibleWithEngine,
    normalizeEngineSelection,
    reconcileClaudePendingThreadFromCandidate,
    resolveThreadEngine,
    resolveThreadKind,
    startThreadForMessageSend,
  } = useThreadMessagingThreadResolution({
    activeEngine,
    dispatch,
    getThreadEngine,
    getThreadKind,
    onDebug,
    runWithCreateSessionLoading,
    startThreadForWorkspace,
  });

  useSharedAttemptSettlementCleanup({
    onSharedDurableTurnCommitted,
    markProcessing,
    setActiveTurnId,
    safeMessageActivity,
  });

  useEffect(
    () =>
      subscribeMultiAgentConversationItems(({ workspaceId, threadId, item }) => {
        dispatch({
          type: "upsertItem",
          workspaceId,
          threadId,
          item,
          hasCustomName: Boolean(getCustomName(workspaceId, threadId)),
        });
        safeMessageActivity();
      }),
    [dispatch, getCustomName, safeMessageActivity],
  );

  const sendMessageToThread = useCallback(
    async (
      workspace: WorkspaceInfo,
      threadId: string,
      text: string,
      images: string[] = [],
      options?: SendMessageOptions,
    ): Promise<ThreadMessageDispatchResult> => {
      const messageText = text.trim();
      if (!messageText && images.length === 0) {
        return;
      }
      const threadKind = resolveThreadKind(workspace.id, threadId);
      const resolvedThreadEngine = resolveThreadEngine(workspace.id, threadId);
      if (threadKind !== "shared") {
        assertEngineExecutionEnabled(resolvedThreadEngine);
      }
      if (threadId.startsWith("claude-pending-")) {
        const reconciledThreadId =
          await reconcileClaudePendingThreadFromCandidate(workspace, threadId);
        const retrySend = sendMessageToThreadRef.current;
        if (reconciledThreadId && retrySend) {
          return retrySend(
            workspace,
            reconciledThreadId,
            text,
            images,
            options,
          );
        }
      }
      if (threadId.startsWith("codex-pending-")) {
        // Optimistic codex thread: swap in the real backend thread id before
        // the first message leaves. The backend start was prewarmed at
        // creation, so this usually resolves instantly.
        const finalizedThreadId = finalizeCodexPendingThread
          ? await finalizeCodexPendingThread(workspace.id, threadId)
          : null;
        const retrySend = sendMessageToThreadRef.current;
        if (finalizedThreadId && retrySend) {
          // finalize never returns the pending id itself (it resolves to the
          // real backend id or null), so always re-enter with the resolved id
          // instead of falling through and sending the pending id upstream.
          return retrySend(workspace, finalizedThreadId, text, images, options);
        } else {
          // finalize returns null both when the backend start failed and when
          // the pending thread was deleted mid-flight; only surface the
          // failure (and keep the typed text recoverable) if it still exists.
          if (getThreadEngine(workspace.id, threadId)) {
            dispatch({
              type: "upsertItem",
              workspaceId: workspace.id,
              threadId,
              item: {
                id: `optimistic-user-${Date.now()}-${Math.random()
                  .toString(36)
                  .slice(2, 8)}`,
                kind: "message",
                role: "user",
                text: messageText,
                images: images.length > 0 ? images : undefined,
              },
              hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
            });
            pushThreadErrorMessage(
              workspace.id,
              threadId,
              t("errors.failedToCreateSession"),
            );
            safeMessageActivity();
          }
          return;
        }
      }
      const sharedCtx: SharedSendContext = {
        dispatch,
        getCustomName,
        markProcessing,
        setActiveTurnId,
        safeMessageActivity,
        pushThreadErrorMessage,
        onDebug,
        onSharedDurableTurnCommitted,
        onInputMemoryCaptured,
        itemsByThread,
        interruptedThreadsRef,
        i18n,
        t,
      };
      const sharedSendPreflight = await resolveSharedSendPreflight(sharedCtx, {
        workspace,
        threadId,
        threadKind,
        messageText,
        images,
        options,
      });
      if (sharedSendPreflight.kind === "return") {
        return sharedSendPreflight.result;
      }
      const sharedV2SendEnabled = sharedSendPreflight.sharedV2SendEnabled;
      const supportedStoredSharedTarget =
        sharedSendPreflight.supportedStoredSharedTarget;
      const resolvedEngine =
        threadKind === "shared"
          ? normalizeSharedSessionEngine(
              supportedStoredSharedTarget?.engine ?? activeEngine,
            )
          : resolvedThreadEngine;
      const sessionDshAgentPreset =
        getThreadDshAgentPreset?.(workspace.id, threadId) ?? null;
      const resolvedDshAgentPreset =
        resolvedEngine === "dsh"
          ? resolveDshComposerAgentPreset({
              threadId,
              sessionHeader: sessionDshAgentPreset,
              draftOrPref:
                options?.dshAgentPreset?.trim() ||
                getComposerEnginePrefForEngine("dsh").dshAgentPreset,
              hasUserMessages: (itemsByThread[threadId] ?? []).some(
                (item) => item.kind === "message" && item.role === "user",
              ),
            }).value
          : null;
      const persistableSessionPreset =
        resolvedEngine === "dsh"
          ? persistableDshAgentPreset(
              sessionDshAgentPreset,
              resolvedDshAgentPreset,
            )
          : null;
      dispatch({
        type: "ensureThread",
        workspaceId: workspace.id,
        threadId,
        engine: resolvedEngine,
        ...(persistableSessionPreset
          ? { dshAgentPreset: persistableSessionPreset }
          : {}),
      });
      dispatch({
        type: "setThreadEngine",
        workspaceId: workspace.id,
        threadId,
        engine: resolvedEngine,
      });
      if (resolvedEngine === "dsh" && persistableSessionPreset) {
        dispatch({
          type: "setThreadDshAgentPreset",
          workspaceId: workspace.id,
          threadId,
          dshAgentPreset: persistableSessionPreset,
        });
      }
      // 首页首发 / 纯图：在任何 await 之前立刻上屏用户气泡，否则 pending→session
      // rebind 期间幕布会长时间保持 emptyThread（「今天想构建什么」），用户以为没发出去。
      // 气泡用可见原文 + 附图；injection 只影响 model text，不改用户气泡正文。
      const earlyImages = sanitizeImageAttachmentPaths(images);
      let optimisticUserItem: Extract<
        ConversationItem,
        { kind: "message" }
      > | null = null;
      let optimisticGeneratedImageItem: Extract<
        ConversationItem,
        { kind: "generatedImage" }
      > | null = null;
      if (
        !options?.suppressUserMessageRender &&
        !options?.skipOptimisticUserBubble &&
        (messageText.length > 0 ||
          earlyImages.length > 0 ||
          Boolean(options?.browserContextAttachment) ||
          Boolean(options?.intentCanvasContextAttachments?.length))
      ) {
        optimisticUserItem = {
          id: `optimistic-user-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`,
          kind: "message",
          role: "user",
          // 可见原文（纯图为空串）；禁止写 CLI 占位 "Please analyze…"
          text: messageText,
          images: earlyImages.length > 0 ? earlyImages : undefined,
          browserContextAttachment: options?.browserContextAttachment ?? null,
          intentCanvasContextAttachments:
            options?.intentCanvasContextAttachments,
          originKind:
            options?.originKind === "shared-provider-retry"
              ? "shared-provider-retry"
              : undefined,
          providerRetryAttempt:
            options?.originKind === "shared-provider-retry"
              ? options.providerRetryAttempt
              : undefined,
          providerRetryAtMs:
            options?.originKind === "shared-provider-retry"
              ? options.providerRetryAtMs
              : undefined,
        };
        noteSharedProviderRetryUserSendIfShared({
          workspace,
          threadId,
          threadKind,
          options,
        });
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: optimisticUserItem,
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
        // 同步亮起 processing，避免 emptyThread + 无「响应中」的空白闪屏
        markProcessing(threadId, true);
        // Orphan turn watchdog（fix-orphan-turn-during-backend-unavailability）：
        // 仅 native 路径 arm；90s 零首事件（后端重启窗口 / wedge）时 settle 为
        // 可重试错误，防止「响应中」永久卡死。shared V2 由 durable 状态机自管。
        if (threadKind !== "shared") {
          armOrphanTurnWatchdog(workspace.id, threadId);
        }
        safeMessageActivity();
        emitMessagesForcePinBottom();
      }
      let finalText = messageText;
      if (!options?.skipPromptExpansion) {
        const promptExpansion = expandCustomPromptText(
          messageText,
          customPrompts,
        );
        if (promptExpansion && "error" in promptExpansion) {
          pushThreadErrorMessage(workspace.id, threadId, promptExpansion.error);
          safeMessageActivity();
          return;
        }
        finalText = promptExpansion?.expanded ?? messageText;
      }
      const visibleUserText = finalText;
      const selectedMemoryIds = Array.from(
        new Set(
          (options?.selectedMemoryIds ?? [])
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        ),
      );
      const pickGateOutcome = await runMemoryPickGate({
        workspace,
        threadId,
        visibleUserText,
        options,
        markProcessing,
        safeMessageActivity,
        dispatch,
        getCustomName,
        t,
      });
      if (pickGateOutcome.cancelled) {
        return;
      }
      const pickMemoryIds = pickGateOutcome.pickMemoryIds;
      const pickInjectMode = pickGateOutcome.pickInjectMode;
      const usedMemoryPickPath = pickGateOutcome.usedMemoryPickPath;
      /** 写入用户气泡（可见层 strip pack 后展示「已注入」卡） */
      let pickPackBlockForUserBubble: string | null = null;

      // 旧路径兼容：未走 pick 编排且仍传 memoryReferenceEnabled 时保留 scout
      const memoryReferenceEnabled =
        !usedMemoryPickPath && options?.memoryReferenceEnabled === true;
      const selectedNoteCardIds = Array.from(
        new Set(
          (options?.selectedNoteCardIds ?? [])
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0),
        ),
      );
      let injectionResult: InjectionResult = {
        finalText,
        injectedCount: 0,
        injectedChars: 0,
        retrievalMs: 0,
        previewText: null,
        disabledReason: null,
      };
      let noteInjectionResult: NoteCardInjectionResult = {
        finalText,
        injectedCount: 0,
        injectedChars: 0,
        imagePaths: [],
        previewText: null,
      };
      if (selectedMemoryIds.length > 0) {
        const retrievalStart = Date.now();
        const selectedMemoryInjectionMode =
          options?.selectedMemoryInjectionMode === "summary"
            ? "summary"
            : "detail";
        const selectedMemories = (
          await Promise.all(
            selectedMemoryIds.map((memoryId) =>
              projectMemoryFacade.get(memoryId, workspace.id).catch(() => null),
            ),
          )
        ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        injectionResult = injectSelectedMemoriesContext({
          userText: finalText,
          memories: selectedMemories,
          mode: selectedMemoryInjectionMode,
          retrievalMs: Date.now() - retrievalStart,
        });
      }
      finalText = injectionResult.finalText;
      let memoryScoutInjectionResult: InjectionResult = {
        finalText,
        injectedCount: 0,
        injectedChars: 0,
        retrievalMs: 0,
        previewText: null,
        disabledReason: null,
      };
      let memoryScoutBrief: MemoryBrief | null = null;
      const memoryScoutSummaryItemId = `memory-scout-context-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      // Pick 闸门 / always TopK 注入（source=memory-pick）
      if (pickMemoryIds.length > 0) {
        const retrievalStart = Date.now();
        const pickMemories = (
          await Promise.all(
            pickMemoryIds.map((memoryId) =>
              projectMemoryFacade.get(memoryId, workspace.id).catch(() => null),
            ),
          )
        ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        // 与 manual 去重：已在 manual 中的 id 跳过 pick 再注
        const manualIdSet = new Set(selectedMemoryIds);
        const dedupedPickMemories = pickMemories.filter(
          (memory) => !manualIdSet.has(memory.id),
        );
        if (dedupedPickMemories.length > 0) {
          memoryScoutInjectionResult = injectMemoryPickContext({
            userText: finalText,
            memories: dedupedPickMemories,
            mode: pickInjectMode,
            queryText: visibleUserText,
            retrievalMs: Date.now() - retrievalStart,
            startIndex: injectionResult.injectedCount + 1,
          });
          finalText = memoryScoutInjectionResult.finalText;
          pickPackBlockForUserBubble =
            memoryScoutInjectionResult.packBlock?.trim() || null;
          emitMemoryPickTelemetry("memory_pick_inject", {
            mode: pickInjectMode,
            injectedCount: memoryScoutInjectionResult.injectedCount,
            packChars: memoryScoutInjectionResult.injectedChars,
            cleanerStatus: "cleaned",
          });
        } else {
          onDebug?.({
            id: `${Date.now()}-memory-pick-get-empty`,
            timestamp: Date.now(),
            source: "client",
            label: "memory/pick-get-empty",
            payload: {
              workspaceId: workspace.id,
              threadId,
              pickMemoryIds,
            },
          });
        }
      } else if (memoryReferenceEnabled) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: memoryScoutSummaryItemId,
            kind: "message",
            role: "assistant",
            text: `${MEMORY_CONTEXT_SUMMARY_PREFIX}\n${t("threads.memoryReferenceQuerying")}`,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
        const { semanticProvider: scoutProvider } =
          await resolvePickSemanticContext(workspace.id);
        const memoryBrief = await withMemoryScoutTimeout(
          scoutProjectMemory({
            workspaceId: workspace.id,
            query: visibleUserText,
            listFn: projectMemoryFacade.listSummary,
            semanticProvider: scoutProvider,
          }),
        );
        memoryScoutBrief = memoryBrief;
        memoryScoutInjectionResult = injectMemoryScoutBriefContext({
          userText: finalText,
          brief: memoryBrief,
          startIndex: injectionResult.injectedCount + 1,
        });
        memoryScoutInjectionResult = {
          ...memoryScoutInjectionResult,
          previewText: buildLocalizedMemoryScoutPreviewText(memoryBrief, t),
        };
        finalText = memoryScoutInjectionResult.finalText;
      }
      let finalImages = [...images];
      if (selectedNoteCardIds.length > 0) {
        const selectedNotes = (
          await Promise.all(
            selectedNoteCardIds.map((noteId) =>
              noteCardsFacade
                .get({
                  noteId,
                  workspaceId: workspace.id,
                  workspaceName: workspace.name,
                  workspacePath: workspace.path,
                })
                .catch(() => null),
            ),
          )
        ).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
        noteInjectionResult = injectSelectedNoteCardsContext({
          userText: finalText,
          noteCards: selectedNotes,
        });
        finalText = noteInjectionResult.finalText;
        finalImages = Array.from(
          new Set([...finalImages, ...noteInjectionResult.imagePaths]),
        );
      }
      finalImages = sanitizeImageAttachmentPaths(finalImages);
      // Capability gate: matrix `image.input`. Current engines are all supported;
      // keep the guard for future unsupported engines (fail before optimistic UI).
      if (finalImages.length > 0 && !engineSupportsImageInput(resolvedEngine)) {
        pushThreadErrorMessage(
          workspace.id,
          threadId,
          formatEngineImageInputUnsupportedMessage(
            resolvedEngine,
            t as (key: string, options?: Record<string, unknown>) => string,
          ),
        );
        safeMessageActivity();
        return;
      }
      const oversizedImage = findOversizedImageAttachment(
        finalImages,
        resolvedEngine,
      );
      if (oversizedImage) {
        pushThreadErrorMessage(
          workspace.id,
          threadId,
          formatEngineImageTooLargeMessage(
            resolvedEngine,
            oversizedImage.bytes,
            oversizedImage.maxBytes,
            t as (key: string, options?: Record<string, unknown>) => string,
          ),
        );
        safeMessageActivity();
        return;
      }
      // 通过校验后立刻贴底（含无乐观气泡路径）；乐观气泡处再发一次无害。
      emitMessagesForcePinBottom();
      let resolvedSelectedAgent =
        resolvedEngine !== "opencode" ? (options?.selectedAgent ?? null) : null;
      if (resolvedSelectedAgent?.source === "builtIn") {
        const selectedBuiltInAgentId = resolvedSelectedAgent.id;
        const sendResolution = await resolveSelectedAgentForSend(
          resolvedSelectedAgent,
        );
        resolvedSelectedAgent = sendResolution.agent;
        if (sendResolution.error) {
          onDebug?.({
            id: `${Date.now()}-built-in-agent-resolution-error`,
            timestamp: Date.now(),
            source: "error",
            label: "agent/built-in resolution error",
            payload: sendResolution.error.message,
          });
          pushErrorToast({
            title: t("messages.builtInAgentUnavailableTitle"),
            message: t("messages.builtInAgentUnavailableMessage"),
            durationMs: 4200,
          });
          window.dispatchEvent(
            new CustomEvent(BUILT_IN_AGENT_RESOLUTION_FAILED_EVENT, {
              detail: { agentId: selectedBuiltInAgentId },
            }),
          );
        }
      }
      const selectedAgentName =
        resolvedEngine !== "opencode"
          ? resolvedSelectedAgent?.name?.trim() || null
          : null;
      const selectedAgentIcon =
        resolvedEngine !== "opencode" && resolvedSelectedAgent
          ? resolveAgentIconForAgent(resolvedSelectedAgent, "codicon-hubot")
          : null;
      const selectedAgentPrompt = resolvedSelectedAgent?.prompt?.trim() || "";
      const selectedAgentPromptSections: string[] = [];
      if (selectedAgentName) {
        selectedAgentPromptSections.push(
          `${AGENT_PROMPT_NAME_PREFIX} ${selectedAgentName}`,
        );
      }
      if (selectedAgentIcon) {
        selectedAgentPromptSections.push(
          `${AGENT_PROMPT_ICON_PREFIX} ${selectedAgentIcon}`,
        );
      }
      if (selectedAgentPrompt) {
        selectedAgentPromptSections.push(selectedAgentPrompt);
      }
      const selectedAgentPromptBlock = selectedAgentPromptSections
        .join("\n\n")
        .trim();
      if (selectedAgentPromptBlock) {
        if (!finalText.includes(AGENT_PROMPT_HEADER)) {
          finalText = `${finalText}\n\n${AGENT_PROMPT_HEADER}\n\n${selectedAgentPromptBlock}`;
        }
      }
      let claudeMcpDiagnostics: string[] = [];
      let claudeMcpOutputNotice: string | null = null;
      const claudeMcpSnapshot =
        resolvedEngine === "claude"
          ? getClaudeMcpRuntimeSnapshot(workspace.id)
          : null;
      if (resolvedEngine === "claude") {
        const rewriteResult = rewriteClaudePlaywrightAlias(
          workspace.id,
          finalText,
        );
        finalText = rewriteResult.text;
        claudeMcpDiagnostics = rewriteResult.diagnostics;
        if (rewriteResult.aliasMentioned) {
          onDebug?.({
            id: `${Date.now()}-claude-mcp-routing`,
            timestamp: Date.now(),
            source: "client",
            label: "claude/mcp-routing",
            payload: {
              workspaceId: workspace.id,
              threadId,
              applied: rewriteResult.applied,
              fromServer: rewriteResult.fromServer,
              toServer: rewriteResult.toServer,
              diagnostics: rewriteResult.diagnostics,
            },
          });
          claudeMcpOutputNotice = rewriteResult.applied
            ? t("threads.claudeMcpRouteMapped")
            : t("threads.claudeMcpRouteUnavailable");
        }
      }
      if (resolvedEngine === "claude") {
        setPendingClaudeMcpOutputNotice(
          workspace.id,
          threadId,
          claudeMcpOutputNotice,
        );
      } else {
        clearPendingClaudeMcpOutputNotice(workspace.id, threadId);
      }
      if (options?.browserContextAttachment) {
        finalText = formatBrowserContextPromptOnce(
          finalText,
          options.browserContextAttachment,
        );
      }
      if (injectionResult.injectedCount > 0 && injectionResult.previewText) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: `memory-context-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            kind: "message",
            role: "assistant",
            text: `${MEMORY_CONTEXT_SUMMARY_PREFIX}\n${injectionResult.previewText}`,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
      }
      // memory-pick：摘要只走用户消息 pack 展示（气泡下一行），不再插 assistant 幽灵摘要行
      // 避免历史回放时「注入卡」与真实回复时序错位
      if (
        memoryReferenceEnabled &&
        pickMemoryIds.length === 0 &&
        memoryScoutInjectionResult.previewText
      ) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: memoryScoutSummaryItemId,
            kind: "message",
            role: "assistant",
            text: `${MEMORY_CONTEXT_SUMMARY_PREFIX}\n${memoryScoutInjectionResult.previewText}`,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
      }

      if (
        noteInjectionResult.injectedCount > 0 &&
        noteInjectionResult.previewText
      ) {
        dispatch({
          type: "upsertItem",
          workspaceId: workspace.id,
          threadId,
          item: {
            id: `note-card-context-${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 8)}`,
            kind: "message",
            role: "assistant",
            text: `${NOTE_CARD_CONTEXT_SUMMARY_PREFIX}\n${noteInjectionResult.previewText}`,
          },
          hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
        });
      }
      if (memoryReferenceEnabled || pickMemoryIds.length > 0) {
        onDebug?.({
          id: `${Date.now()}-memory-scout-result`,
          timestamp: Date.now(),
          source: "client",
          label:
            pickMemoryIds.length > 0
              ? memoryScoutInjectionResult.injectedCount > 0
                ? "memory/pick-injected"
                : "memory/pick-empty"
              : memoryScoutInjectionResult.injectedCount > 0
                ? "memory/scout-injected"
                : "memory/scout-skipped",
          payload: {
            workspaceId: workspace.id,
            threadId,
            injectedCount: memoryScoutInjectionResult.injectedCount,
            injectedChars: memoryScoutInjectionResult.injectedChars,
            retrievalMs: memoryScoutInjectionResult.retrievalMs,
            reason: memoryScoutInjectionResult.disabledReason,
            retrievalMode: memoryScoutBrief?.retrievalMode ?? "lexical",
            semanticDiagnostics: memoryScoutBrief?.semanticDiagnostics ?? null,
            pickMode: pickInjectMode,
            pickIds: pickMemoryIds,
          },
        });
      }
      if (injectionResult.injectedCount > 0) {
        onDebug?.({
          id: `${Date.now()}-memory-context-injected`,
          timestamp: Date.now(),
          source: "client",
          label: "memory/context-injected",
          payload: {
            injectedCount: injectionResult.injectedCount,
            injectedChars: injectionResult.injectedChars,
            retrievalMs: injectionResult.retrievalMs,
          },
        });
      } else if (injectionResult.disabledReason) {
        onDebug?.({
          id: `${Date.now()}-memory-context-skipped`,
          timestamp: Date.now(),
          source: "client",
          label: "memory/context-skipped",
          payload: {
            reason: injectionResult.disabledReason,
            retrievalMs: injectionResult.retrievalMs,
          },
        });
      }
      const nativeResolveCtx: NativeResolveContext = {
        resolveComposerSelection,
        model,
        effort,
        collaborationMode,
        accessMode,
        claudeThinkingVisible,
        resolveOpenCodeAgent,
        resolveOpenCodeVariant,
        lastOpenCodeModelByThreadRef,
        onDebug,
        t,
      };
      const {
        resolvedComposerSelection,
        selectedModelId,
        resolvedEffort,
        disableThinkingForClaude,
        sanitizedCollaborationMode,
        userCollaborationMode,
        resolvedAccessMode,
        resolvedOpenCodeAgent,
        resolvedOpenCodeVariant,
        modelForSend,
        sanitizedModel,
      } = runNativeSendResolve(nativeResolveCtx, {
        threadId,
        threadKind,
        options,
        resolvedEngine,
        supportedStoredSharedTarget,
      });
      const sharedSendAdmission = acquireSharedSendAdmission(sharedCtx, {
        workspace,
        threadId,
        sharedV2SendEnabled,
      });
      if (!sharedSendAdmission.acquired) {
        return;
      }
      const sharedSendAdmissionRevision = sharedSendAdmission.revision;
      const wasProcessing =
        (threadStatusById[threadId]?.isProcessing ?? false) && steerEnabled;
      // 若入口已打 early bubble，这里只补 metadata / 便签附图 / codex 出图占位；
      // 否则（极少路径）再补一次，避免双气泡。
      const shouldEnrichOrAddOptimisticUserBubble =
        !options?.suppressUserMessageRender &&
        !options?.skipOptimisticUserBubble &&
        (Boolean(optimisticUserItem) ||
          resolvedEngine === "codex" ||
          wasProcessing ||
          threadKind === "shared" ||
          finalImages.length > 0 ||
          Boolean(options?.browserContextAttachment) ||
          Boolean(options?.intentCanvasContextAttachments?.length));
      if (shouldEnrichOrAddOptimisticUserBubble) {
        const optimisticDisplayText = visibleUserText;
        const optimisticImages =
          finalImages.length > 0
            ? finalImages
            : (optimisticUserItem?.images ?? []);
        if (
          optimisticDisplayText ||
          optimisticImages.length > 0 ||
          options?.browserContextAttachment ||
          options?.intentCanvasContextAttachments?.length
        ) {
          // pick pack 写回用户消息文本：气泡展示 strip pack 后的原文，
          // 同时 presentation 解析 pack 渲染「已注入」摘要卡（实时 + 历史）
          const userBubbleText = pickPackBlockForUserBubble
            ? `${pickPackBlockForUserBubble}\n${optimisticDisplayText}`
            : optimisticDisplayText;
          if (optimisticUserItem) {
            // 更新 early bubble：保留 id，补 agent 元数据与更完整附图
            optimisticUserItem = {
              ...optimisticUserItem,
              text: userBubbleText,
              images:
                optimisticImages.length > 0 ? optimisticImages : undefined,
              collaborationMode: userCollaborationMode,
              selectedAgentName,
              selectedAgentIcon,
              browserContextAttachment:
                options?.browserContextAttachment ?? null,
              intentCanvasContextAttachments:
                options?.intentCanvasContextAttachments,
            };
          } else {
            optimisticUserItem = {
              id: `optimistic-user-${Date.now()}-${Math.random()
                .toString(36)
                .slice(2, 8)}`,
              kind: "message",
              role: "user",
              text: userBubbleText,
              images:
                optimisticImages.length > 0 ? optimisticImages : undefined,
              collaborationMode: userCollaborationMode,
              selectedAgentName,
              selectedAgentIcon,
              browserContextAttachment:
                options?.browserContextAttachment ?? null,
              intentCanvasContextAttachments:
                options?.intentCanvasContextAttachments,
            };
          }
          dispatch({
            type: "upsertItem",
            workspaceId: workspace.id,
            threadId,
            item: optimisticUserItem,
            hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
          });
          const optimisticGeneratedImagePrompt =
            resolvedEngine === "codex"
              ? extractOptimisticGeneratedImagePrompt(optimisticDisplayText)
              : null;
          if (optimisticGeneratedImagePrompt && !optimisticGeneratedImageItem) {
            optimisticGeneratedImageItem =
              createOptimisticGeneratedImageProcessingItem({
                threadId,
                userMessageId: optimisticUserItem.id,
                promptText: optimisticGeneratedImagePrompt,
              });
            dispatch({
              type: "upsertItem",
              workspaceId: workspace.id,
              threadId,
              item: optimisticGeneratedImageItem,
              hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
            });
          }
        }
      }
      const timestamp = Date.now();
      const effectiveResolvedEngine = resolvedEngine;
      const codexPreSendAcceptedTurnResolution =
        effectiveResolvedEngine === "codex"
          ? resolveCodexAcceptedTurnFact({
              record: codexAcceptedTurnByThread[threadId] ?? null,
              items: itemsByThread[threadId] ?? [],
            })
          : null;
      const shouldDeferCodexDraftActivity = codexPreSendAcceptedTurnResolution
        ? shouldDeferCodexActivityUntilTurnAccepted(
            codexPreSendAcceptedTurnResolution,
          )
        : false;
      if (!shouldDeferCodexDraftActivity) {
        recordThreadActivity(workspace.id, threadId, timestamp);
        dispatch({
          type: "setThreadTimestamp",
          workspaceId: workspace.id,
          threadId,
          timestamp,
        });
      }
      if (
        workspaceScopedHas(pendingInterruptsRef.current, workspace.id, threadId)
      ) {
        workspaceScopedDelete(
          pendingInterruptsRef.current,
          workspace.id,
          threadId,
        );
      }
      if (
        workspaceScopedHas(
          interruptedThreadsRef.current,
          workspace.id,
          threadId,
        )
      ) {
        workspaceScopedDelete(
          interruptedThreadsRef.current,
          workspace.id,
          threadId,
        );
      }
      markProcessing(threadId, true);
      safeMessageActivity();
      primeThreadStreamLatencyForSend(
        workspace.id,
        threadId,
        effectiveResolvedEngine,
        modelForSend,
      );
      onDebug?.({
        id: `${Date.now()}-client-turn-start`,
        timestamp: Date.now(),
        source: "client",
        label: "turn/start",
        payload: {
          workspaceId: workspace.id,
          threadId,
          engine: effectiveResolvedEngine,
          selectedEngine: activeEngine,
          providerProfileId:
            supportedStoredSharedTarget?.providerProfileId ?? null,
          modelCatalogEntryId:
            supportedStoredSharedTarget?.modelCatalogEntryId ?? null,
          text: finalText,
          images: finalImages,
          model: modelForSend,
          effort: resolvedEffort,
          collaborationMode: sanitizedCollaborationMode,
          accessMode: resolvedAccessMode ?? null,
          agent: resolvedOpenCodeAgent,
          variant: resolvedOpenCodeVariant,
          claudeMcpSnapshot:
            resolvedEngine === "claude"
              ? {
                  capturedAt: claudeMcpSnapshot?.capturedAt ?? null,
                  sessionId: claudeMcpSnapshot?.sessionId ?? null,
                  toolsCount: claudeMcpSnapshot?.tools.length ?? 0,
                  servers: claudeMcpSnapshot?.mcpServers ?? [],
                }
              : null,
        },
      });
      if (shouldEmitThreadMessagingDevLogs) {
        console.info("[turn/start]", {
          workspaceId: workspace.id,
          threadId,
          engine: effectiveResolvedEngine,
          selectedEngine: activeEngine,
          model: modelForSend,
          effort: resolvedEffort,
          accessMode: resolvedAccessMode ?? null,
          agent: resolvedOpenCodeAgent,
          variant: resolvedOpenCodeVariant,
          textLength: finalText.length,
          hasImages: finalImages.length > 0,
        });
      }
      const retryCodexSendAfterThreadRefresh = async (errorMessage: string) => {
        const staleRecoveryClassification =
          classifyStaleThreadRecovery(errorMessage);
        if (
          threadKind === "shared" ||
          resolvedEngine !== "codex" ||
          options?.codexInvalidThreadRetryAttempted ||
          !isRecoverableCodexThreadBindingError(errorMessage)
        ) {
          return false;
        }
        let reboundThreadId: string | null = null;
        let refreshErrorMessage: string | null = null;
        try {
          reboundThreadId = await refreshThread(workspace.id, threadId);
        } catch (refreshError) {
          refreshErrorMessage =
            refreshError instanceof Error
              ? refreshError.message
              : String(refreshError);
          reboundThreadId = null;
        }
        const acceptedTurnResolution =
          codexPreSendAcceptedTurnResolution ??
          resolveCodexAcceptedTurnFact({
            record: codexAcceptedTurnByThread[threadId] ?? null,
            items: itemsByThread[threadId] ?? [],
          });
        const moveOptimisticUserIntentToThread = (targetThreadId: string) => {
          if (targetThreadId === threadId || !optimisticUserItem) {
            return;
          }
          dispatch({
            type: "setThreadItems",
            threadId,
            items: (itemsByThread[threadId] ?? []).filter(
              (item) =>
                item.id !== optimisticUserItem.id &&
                item.id !== optimisticGeneratedImageItem?.id,
            ),
          });
          dispatch({
            type: "upsertItem",
            workspaceId: workspace.id,
            threadId: targetThreadId,
            item: optimisticUserItem,
            hasCustomName: Boolean(getCustomName(workspace.id, targetThreadId)),
          });
          if (optimisticGeneratedImageItem) {
            dispatch({
              type: "upsertItem",
              workspaceId: workspace.id,
              threadId: targetThreadId,
              item: {
                ...optimisticGeneratedImageItem,
                id: `optimistic-generated-image:${targetThreadId}:${optimisticUserItem.id}`,
              },
              hasCustomName: Boolean(
                getCustomName(workspace.id, targetThreadId),
              ),
            });
          }
        };
        const retrySendOnThread = async (targetThreadId: string) => {
          markProcessing(threadId, false);
          setActiveTurnId(threadId, null);
          safeMessageActivity();
          await sendMessageToThread(
            workspace,
            targetThreadId,
            finalText,
            finalImages,
            {
              skipPromptExpansion: true,
              skipOptimisticUserBubble: true,
              model: modelForSend,
              effort: resolvedEffort,
              collaborationMode: sanitizedCollaborationMode,
              accessMode: resolvedAccessMode,
              resumeSource: options?.resumeSource,
              resumeTurnId: options?.resumeTurnId,
              codexInvalidThreadRetryAttempted: true,
            },
          );
        };
        const recoveryAttempt = createRecoveryAttempt({
          threadId,
          workspace,
          reboundThreadId,
          acceptedTurnResolution,
          staleRecoveryClassification,
          optimisticUserItem,
          moveOptimisticUserIntentToThread,
          retrySendOnThread,
          startThreadForMessageSend,
          forkThreadForWorkspace,
          dispatch,
          onDebug,
          errorMessage,
          refreshErrorMessage,
          providerProfileId: resolveSendProviderProfileId({
            threadProviderProfileId:
              getThreadProviderProfileId?.(workspace.id, threadId) ?? null,
          }),
        });
        const isSameMissingThreadRebind =
          reboundThreadId === threadId &&
          isCodexMissingThreadBindingError(errorMessage);
        if (
          !reboundThreadId ||
          recoveryAttempt.isUnverifiedSameThreadMissingRebind ||
          isSameMissingThreadRebind
        ) {
          if (
            await recoveryAttempt.tryFreshDraftReplacement(
              recoveryAttempt.isUnverifiedSameThreadMissingRebind ||
                isSameMissingThreadRebind
                ? "refresh returned the same missing thread"
                : refreshErrorMessage
                  ? `refresh failed: ${refreshErrorMessage}`
                  : null,
            )
          ) {
            return true;
          }
          return recoveryAttempt.tryForkFromMessage(refreshErrorMessage);
        }
        onDebug?.({
          id: `${Date.now()}-client-turn-start-thread-retry`,
          timestamp: Date.now(),
          source: "client",
          label: "turn/start thread rebind retry",
          payload: {
            workspaceId: workspace.id,
            originalThreadId: threadId,
            reboundThreadId,
            reboundChanged: reboundThreadId !== threadId,
            reason: errorMessage,
            reasonCode: staleRecoveryClassification?.reasonCode ?? null,
            staleReason: staleRecoveryClassification?.staleReason ?? null,
            retryable: staleRecoveryClassification?.retryable ?? true,
            userAction:
              staleRecoveryClassification?.userAction ?? "recover-thread",
            outcome:
              staleRecoveryClassification?.recommendedOutcome ?? "rebound",
          },
        });
        if (reboundThreadId !== threadId) {
          dispatch({
            type: "setActiveThreadId",
            workspaceId: workspace.id,
            threadId: reboundThreadId,
          });
          moveOptimisticUserIntentToThread(reboundThreadId);
        }
        await retrySendOnThread(reboundThreadId);
        return true;
      };
      try {
        let response: Record<string, unknown>;
        if (threadKind === "shared") {
          const sharedV2SendOutcome = await runSharedV2Send(sharedCtx, {
            workspace,
            threadId,
            resolvedEngine,
            supportedStoredSharedTarget,
            sharedV2SendEnabled,
            resolvedComposerSelection: resolvedComposerSelection ?? null,
            modelForSend,
            resolvedEffort,
            disableThinkingForClaude,
            sanitizedCollaborationMode,
            resolvedAccessMode,
            finalText,
            visibleUserText,
            finalImages,
            sharedSendAdmissionRevision,
          });
          if (sharedV2SendOutcome.kind === "return") {
            return sharedV2SendOutcome.result;
          }
          response = sharedV2SendOutcome.response;
        } else {
          const isClaudeSession = threadId.startsWith("claude:");
          const isOpenCodeSession = threadId.startsWith("opencode:");
          const cliEngine = resolvedEngine === "codex" ? null : resolvedEngine;
          const threadItems = itemsByThread[threadId] ?? [];
          const customSpecRoot = resolveWorkspaceSpecRoot(workspace.id);
          const { codexEffectiveText } = await probeSessionSpecLinkForSend(
            {
              sessionSpecLinkByThreadRef,
              onDebug,
              dispatch,
              getCustomName,
              t,
            },
            {
              workspace,
              threadId,
              resolvedEngine,
              threadItems,
              customSpecRoot,
              finalText,
            },
          );
          const realSessionId = resolveNativeRealSessionId(
            {
              geminiSessionIdByPendingThreadRef,
              grokSessionIdByPendingThreadRef,
              kimiSessionIdByPendingThreadRef,
              dshSessionIdByPendingThreadRef,
              piSessionIdByPendingThreadRef,
              ompSessionIdByPendingThreadRef,
              qoderSessionIdByPendingThreadRef,
              getThreadProviderProfileId,
            },
            {
              resolvedEngine,
              threadId,
              isClaudeSession,
              isOpenCodeSession,
              workspace,
            },
          );
          const shouldAttachCliSpecRootHint =
            realSessionId === null && Boolean(customSpecRoot);

          if (cliEngine) {
            const threadProviderProfileId =
              getThreadProviderProfileId?.(workspace.id, threadId) ?? null;
            const qoderThreadIdentity =
              resolvedEngine === "qoder" && threadId.startsWith("qoder:")
                ? parseQoderSessionIdentity(threadId, threadProviderProfileId)
                : null;
            if (
              resolvedEngine === "qoder" &&
              threadId.startsWith("qoder:") &&
              !qoderThreadIdentity
            ) {
              const message =
                "Qoder session identity conflicts with its saved distribution.";
              markProcessing(threadId, false);
              setActiveTurnId(threadId, null);
              pushThreadErrorMessage(workspace.id, threadId, message);
              safeMessageActivity();
              return;
            }
            if (
              resolvedEngine === "claude" &&
              isClaudePendingThreadAwaitingNativeSession(threadId, {
                hasAwaitingMarker:
                  claudePendingThreadAwaitingNativeSessionRef.current.has(
                    threadId,
                  ),
                hasLocalItems: threadItems.length > 0,
                hasActiveTurn: Boolean(activeTurnIdByThread[threadId]),
                isProcessing: Boolean(threadStatusById[threadId]?.isProcessing),
              })
            ) {
              const waitingMessage = t(
                "threads.claudePendingNativeSessionWait",
                {
                  defaultValue:
                    "Claude session is still initializing. Wait for the session to finish binding, then send again.",
                },
              );
              pushThreadErrorMessage(workspace.id, threadId, waitingMessage);
              markProcessing(threadId, false);
              setActiveTurnId(threadId, null);
              safeMessageActivity();
              onDebug?.({
                id: `${Date.now()}-client-claude-pending-native-session-blocked`,
                timestamp: Date.now(),
                source: "client",
                label: "thread/session pending native confirmation blocked",
                payload: {
                  workspaceId: workspace.id,
                  threadId,
                },
              });
              return;
            }

            // Claude/OpenCode/Grok/…: backend only streams assistant/tool events,
            // so add user item locally — unless an early optimistic bubble already
            // covered this turn (image-only / shared / codex paths).
            if (!options?.suppressUserMessageRender && !optimisticUserItem) {
              const userMessageId = `user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
              dispatch({
                type: "upsertItem",
                workspaceId: workspace.id,
                threadId,
                item: {
                  id: userMessageId,
                  kind: "message",
                  role: "user",
                  // Keep user-visible text free of engine-private injection
                  // (e.g. Kimi ReadMediaFile path block is CLI-only).
                  // Image-only: empty text is intentional — never invent
                  // "Please analyze the attached image(s)." for the canvas.
                  text: visibleUserText,
                  // Prefer sanitized image list so canvas screenshots (data URLs /
                  // paths) still render as thumbnails, never as wire text.
                  images: finalImages.length > 0 ? finalImages : undefined,
                  collaborationMode: userCollaborationMode,
                  selectedAgentName,
                  selectedAgentIcon,
                  intentCanvasContextAttachments:
                    options?.intentCanvasContextAttachments,
                },
                hasCustomName: Boolean(getCustomName(workspace.id, threadId)),
              });
            }

            const sendRequestedAt = Date.now();
            const providerProfileId =
              resolvedEngine === "qoder"
                ? (qoderThreadIdentity?.providerProfileId ??
                  canonicalQoderProviderProfileId(threadProviderProfileId) ??
                  resolveSendProviderProfileId({
                    threadProviderProfileId,
                  }))
                : resolveSendProviderProfileId({ threadProviderProfileId });
            // D4 思考档按需降档：新会话首条短消息 + 用户未触碰档位时本 turn
            // 以 low 发送；执行目标快照与 wire 参数必须同值（保持 honest）。
            const sendEffort = resolvePiFirstMessageEffort({
              engine: resolvedEngine,
              effort: resolvedEffort,
              hasSession: realSessionId !== null,
              promptText: finalText,
            });
            recordNativeSendTurnTarget({
              workspace,
              threadId,
              options,
              resolvedEngine,
              providerProfileId,
              selectedModelId,
              modelForSend,
              sanitizedModel,
              sendEffort,
            });
            if (modelForSend) {
              rememberRuntimeReceipt(workspace.id, threadId, {
                model: modelForSend,
                modelSource: "send.request",
              });
            }
            response = await engineSendMessageService(workspace.id, {
              text: finalText,
              engine: resolvedEngine,
              model: modelForSend,
              effort: sendEffort,
              disableThinking: disableThinkingForClaude,
              images: finalImages.length > 0 ? finalImages : null,
              accessMode: resolvedAccessMode,
              continueSession: realSessionId !== null,
              sessionId: realSessionId,
              threadId: threadId,
              agent: resolvedOpenCodeAgent,
              variant: resolvedOpenCodeVariant,
              dshAgentPreset: resolvedDshAgentPreset,
              providerProfileId,
              forkSessionId:
                resolvedEngine === "claude"
                  ? extractClaudeForkParentSessionId(threadId)
                  : null,
              autoSession: options?.autoSession ?? null,
              skillInvocations: options?.skillInvocations ?? null,
              ...(customSpecRoot && shouldAttachCliSpecRootHint
                ? { customSpecRoot }
                : {}),
            });

            onDebug?.({
              id: `${Date.now()}-server-turn-start`,
              timestamp: Date.now(),
              source: "server",
              label: `turn/start response (${cliEngine})`,
              payload: response,
            });

            const rpcError = extractRpcErrorMessage(response);
            if (rpcError) {
              const stabilityDiagnostic =
                resolveThreadStabilityDiagnostic(rpcError);
              const staleRecoveryClassification =
                classifyStaleThreadRecovery(rpcError);
              const normalized = mapNetworkErrorToUserMessage(rpcError, t);
              const claudeMcpHint =
                resolvedEngine === "claude" &&
                !normalized.isNetwork &&
                claudeMcpDiagnostics.length > 0
                  ? `\n\n${claudeMcpDiagnostics.join("\n")}`
                  : "";
              markProcessing(threadId, false);
              setActiveTurnId(threadId, null);
              pushThreadErrorMessage(
                workspace.id,
                threadId,
                normalized.isNetwork
                  ? normalized.message
                  : `${t("threads.turnFailedWithMessage", { message: normalized.message })}${claudeMcpHint}`,
              );
              pushThreadFailureRuntimeNotice({
                workspaceId: workspace.id,
                threadId,
                engine: resolvedEngine,
                message: normalized.message,
                reasonCode: staleRecoveryClassification?.reasonCode ?? null,
                userAction: staleRecoveryClassification?.userAction ?? null,
              });
              if (stabilityDiagnostic) {
                onDebug?.({
                  id: `${Date.now()}-client-turn-start-stability-diagnostic`,
                  timestamp: Date.now(),
                  source: "client",
                  label: "turn/start stability diagnostic",
                  payload: {
                    workspaceId: workspace.id,
                    threadId,
                    category: stabilityDiagnostic.category,
                    rawMessage: stabilityDiagnostic.rawMessage,
                    recoveryReason: stabilityDiagnostic.reconnectReason ?? null,
                    stage: "rpc-error",
                  },
                });
              }
              if (normalized.isNetwork) {
                pushErrorToast({
                  title: t("common.error"),
                  message: normalized.message,
                  durationMs: 4800,
                });
              }
              safeMessageActivity();
              return;
            }

            await cachePendingEngineSessionFromResponse(
              {
                claudeCandidateSessionIdByPendingThreadRef,
                claudePendingThreadAwaitingNativeSessionRef,
                geminiSessionIdByPendingThreadRef,
                grokSessionIdByPendingThreadRef,
                kimiSessionIdByPendingThreadRef,
                dshSessionIdByPendingThreadRef,
                piSessionIdByPendingThreadRef,
                ompSessionIdByPendingThreadRef,
                qoderSessionIdByPendingThreadRef,
                onDebug,
              },
              {
                resolvedEngine,
                threadId,
                response,
                workspace,
                sendRequestedAt,
                itemsByThread,
                providerProfileId,
              },
            );

            // Extract turn ID - streaming events will handle the rest
            const result = (response?.result ?? response) as Record<
              string,
              unknown
            >;
            const turn = (result?.turn ?? response?.turn ?? null) as Record<
              string,
              unknown
            > | null;
            const turnId = asString(turn?.id ?? "");

            if (!turnId) {
              markProcessing(threadId, false);
              setActiveTurnId(threadId, null);
              pushThreadErrorMessage(
                workspace.id,
                threadId,
                t("threads.turnFailedToStart"),
              );
              safeMessageActivity();
              return;
            }

            // Set active turn ID - useAppServerEvents will handle streaming deltas
            // and mark processing complete when turn/completed event arrives
            setActiveTurnId(threadId, turnId);
          } else {
            // Codex assistant/tool events are event-driven from backend.
            // User message bubble is inserted optimistically on send for instant feedback.
            const preferredLanguage = i18n.language
              .toLowerCase()
              .startsWith("zh")
              ? "zh"
              : "en";
            response = (await sendUserMessageService(
              workspace.id,
              threadId,
              codexEffectiveText,
              {
                model: modelForSend,
                effort: resolvedEffort,
                collaborationMode: sanitizedCollaborationMode,
                accessMode: resolvedAccessMode,
                images: finalImages,
                preferredLanguage,
                resumeSource: options?.resumeSource,
                resumeTurnId: options?.resumeTurnId,
                ...(customSpecRoot ? { customSpecRoot } : {}),
              },
            )) as Record<string, unknown>;
          }

          onDebug?.({
            id: `${Date.now()}-server-turn-start`,
            timestamp: Date.now(),
            source: "server",
            label: "turn/start response",
            payload: response,
          });
          const rpcError = extractRpcErrorMessage(response);
          if (rpcError) {
            if (await retryCodexSendAfterThreadRefresh(rpcError)) {
              return;
            }
            const stabilityDiagnostic =
              resolveThreadStabilityDiagnostic(rpcError);
            const staleRecoveryClassification =
              classifyStaleThreadRecovery(rpcError);
            const firstPacketTimeoutSeconds =
              resolveRecoverableCodexFirstPacketTimeout(
                resolvedEngine,
                rpcError,
              );
            if (firstPacketTimeoutSeconds) {
              const warningMessage = t("threads.firstPacketTimeout", {
                seconds: firstPacketTimeoutSeconds,
              });
              onDebug?.({
                id: `${Date.now()}-client-turn-start-timeout-warning`,
                timestamp: Date.now(),
                source: "client",
                label: "turn/start delayed",
                payload: {
                  threadId,
                  engine: resolvedEngine,
                  timeoutSeconds: firstPacketTimeoutSeconds,
                },
              });
              pushErrorToast({
                title: t("common.warning"),
                message: warningMessage,
                durationMs: 4800,
              });
              pushThreadErrorMessage(workspace.id, threadId, warningMessage);
              markProcessing(threadId, false);
              setActiveTurnId(threadId, null);
              safeMessageActivity();
              return;
            }
            const normalized = mapNetworkErrorToUserMessage(rpcError, t);
            markProcessing(threadId, false);
            setActiveTurnId(threadId, null);
            pushThreadErrorMessage(
              workspace.id,
              threadId,
              normalized.isNetwork
                ? normalized.message
                : t("threads.turnFailedToStartWithMessage", {
                    message: normalized.message,
                  }),
            );
            pushThreadFailureRuntimeNotice({
              workspaceId: workspace.id,
              threadId,
              engine: resolvedEngine,
              message: normalized.message,
              reasonCode: staleRecoveryClassification?.reasonCode ?? null,
              userAction: staleRecoveryClassification?.userAction ?? null,
            });
            if (stabilityDiagnostic) {
              onDebug?.({
                id: `${Date.now()}-client-turn-start-stability-diagnostic`,
                timestamp: Date.now(),
                source: "client",
                label: "turn/start stability diagnostic",
                payload: {
                  workspaceId: workspace.id,
                  threadId,
                  category: stabilityDiagnostic.category,
                  rawMessage: stabilityDiagnostic.rawMessage,
                  recoveryReason: stabilityDiagnostic.reconnectReason ?? null,
                  stage: "rpc-error",
                },
              });
            }
            if (normalized.isNetwork) {
              pushErrorToast({
                title: t("common.error"),
                message: normalized.message,
                durationMs: 4800,
              });
            }
            safeMessageActivity();
            return;
          }
          const result = (response?.result ?? response) as Record<
            string,
            unknown
          >;
          const turn = (result?.turn ?? response?.turn ?? null) as Record<
            string,
            unknown
          > | null;
          const turnId = asString(turn?.id ?? "");
          if (!turnId) {
            markProcessing(threadId, false);
            setActiveTurnId(threadId, null);
            pushThreadErrorMessage(
              workspace.id,
              threadId,
              t("threads.turnFailedToStart"),
            );
            safeMessageActivity();
            return;
          }
          setActiveTurnId(threadId, turnId);
          if (resolvedEngine === "codex") {
            dispatch({
              type: "markCodexAcceptedTurn",
              threadId,
              fact: "accepted",
              source: "turn-start-response",
              timestamp: Date.now(),
            });
            if (shouldDeferCodexDraftActivity) {
              const acceptedTimestamp = Date.now();
              recordThreadActivity(workspace.id, threadId, acceptedTimestamp);
              dispatch({
                type: "setThreadTimestamp",
                workspaceId: workspace.id,
                threadId,
                timestamp: acceptedTimestamp,
              });
            }
          }

          void projectMemoryFacade
            .captureTurnInput({
              workspaceId: workspace.id,
              userInput: visibleUserText,
              threadId,
              turnId,
              workspaceName: workspace.name ?? null,
              workspacePath: workspace.path ?? null,
              engine: resolvedEngine,
            })
            .then((captured) => {
              onInputMemoryCaptured?.({
                workspaceId: workspace.id,
                threadId,
                turnId,
                inputText: visibleUserText,
                memoryId: captured?.id ?? null,
                workspaceName: workspace.name ?? null,
                workspacePath: workspace.path ?? null,
                engine: resolvedEngine,
              });
            })
            .catch((err) => {
              if (shouldEmitThreadMessagingDevLogs) {
                console.warn("[project-memory] auto capture failed:", err);
              }
            });
        }
      } catch (error) {
        const rawMessage =
          error instanceof Error ? error.message : String(error);
        if (await retryCodexSendAfterThreadRefresh(rawMessage)) {
          return;
        }
        const sharedActiveLifecycleCatchResult =
          resolveSharedActiveLifecycleCatch(sharedCtx, {
            workspace,
            threadId,
            threadKind,
            error,
            rawMessage,
          });
        if (sharedActiveLifecycleCatchResult) {
          return sharedActiveLifecycleCatchResult;
        }
        const stabilityDiagnostic =
          resolveThreadStabilityDiagnostic(rawMessage);
        const staleRecoveryClassification =
          classifyStaleThreadRecovery(rawMessage);
        const firstPacketTimeoutSeconds =
          resolveRecoverableCodexFirstPacketTimeout(resolvedEngine, rawMessage);
        if (firstPacketTimeoutSeconds) {
          const warningMessage = t("threads.firstPacketTimeout", {
            seconds: firstPacketTimeoutSeconds,
          });
          onDebug?.({
            id: `${Date.now()}-client-turn-start-timeout-warning`,
            timestamp: Date.now(),
            source: "client",
            label: "turn/start delayed",
            payload: {
              threadId,
              engine: resolvedEngine,
              timeoutSeconds: firstPacketTimeoutSeconds,
            },
          });
          pushErrorToast({
            title: t("common.warning"),
            message: warningMessage,
            durationMs: 4800,
          });
          pushThreadErrorMessage(workspace.id, threadId, warningMessage);
          markProcessing(threadId, false);
          setActiveTurnId(threadId, null);
          safeMessageActivity();
          return;
        }
        const normalized = mapNetworkErrorToUserMessage(rawMessage, t);
        markProcessing(threadId, false);
        setActiveTurnId(threadId, null);
        onDebug?.({
          id: `${Date.now()}-client-turn-start-error`,
          timestamp: Date.now(),
          source: "error",
          label: "turn/start error",
          payload: {
            rawMessage,
            reasonCode: classifyTurnStartReasonCode(rawMessage),
            category: stabilityDiagnostic?.category ?? null,
            recoveryReason: stabilityDiagnostic?.reconnectReason ?? null,
          },
        });
        pushThreadErrorMessage(workspace.id, threadId, normalized.message);
        if (normalized.isNetwork || staleRecoveryClassification) {
          pushThreadFailureRuntimeNotice({
            workspaceId: workspace.id,
            threadId,
            engine: resolvedEngine,
            message: normalized.message,
            reasonCode: staleRecoveryClassification?.reasonCode ?? null,
            userAction: staleRecoveryClassification?.userAction ?? null,
          });
        }
        if (normalized.isNetwork) {
          pushErrorToast({
            title: t("common.error"),
            message: normalized.message,
            durationMs: 4800,
          });
        }
        safeMessageActivity();
        if (threadKind === "shared") {
          return settleSharedSendFailure(sharedCtx, {
            workspace,
            threadId,
            resolvedEngine,
            supportedStoredSharedTarget,
            options,
            rawMessage,
          });
        }
      }
    },
    [
      accessMode,
      activeEngine,
      activeTurnIdByThread,
      collaborationMode,
      claudeCandidateSessionIdByPendingThreadRef,
      claudePendingThreadAwaitingNativeSessionRef,
      claudeThinkingVisible,
      customPrompts,
      codexAcceptedTurnByThread,
      createRecoveryAttempt,
      dispatch,
      effort,
      finalizeCodexPendingThread,
      geminiSessionIdByPendingThreadRef,
      grokSessionIdByPendingThreadRef,
      kimiSessionIdByPendingThreadRef,
      dshSessionIdByPendingThreadRef,
      piSessionIdByPendingThreadRef,
      ompSessionIdByPendingThreadRef,
      qoderSessionIdByPendingThreadRef,
      getCustomName,
      getThreadEngine,
      isClaudePendingThreadAwaitingNativeSession,
      markProcessing,
      model,
      onDebug,
      onInputMemoryCaptured,
      onSharedDurableTurnCommitted,
      itemsByThread,
      interruptedThreadsRef,
      pendingInterruptsRef,
      pushThreadErrorMessage,
      recordThreadActivity,
      reconcileClaudePendingThreadFromCandidate,
      resolveComposerSelection,
      getThreadProviderProfileId,
      resolveThreadKind,
      resolveThreadEngine,
      resolveOpenCodeAgent,
      resolveOpenCodeVariant,
      forkThreadForWorkspace,
      refreshThread,
      safeMessageActivity,
      setActiveTurnId,
      startThreadForMessageSend,
      i18n,
      steerEnabled,
      t,
      threadStatusById,
    ],
  );
  sendMessageToThreadRef.current = sendMessageToThread;

  const sendUserMessage = useCallback(
    async (
      text: string,
      images: string[] = [],
      options?: SendMessageOptions,
    ) => {
      if (!activeWorkspace) {
        return;
      }
      const messageText = text.trim();
      if (!messageText && images.length === 0) {
        return;
      }
      const promptExpansion = expandCustomPromptText(
        messageText,
        customPrompts,
      );
      if (promptExpansion && "error" in promptExpansion) {
        if (activeThreadId) {
          pushThreadErrorMessage(
            activeWorkspace.id,
            activeThreadId,
            promptExpansion.error,
          );
          safeMessageActivity();
        } else {
          onDebug?.({
            id: `${Date.now()}-client-prompt-expand-error`,
            timestamp: Date.now(),
            source: "error",
            label: "prompt/expand error",
            payload: promptExpansion.error,
          });
        }
        return;
      }
      const finalText = promptExpansion?.expanded ?? messageText;

      // Detect engine switch from the selected engine to thread ownership.
      const currentEngine = normalizeEngineSelection(activeEngine);
      const resolvedComposerSelection = resolveComposerSelection?.() ?? null;
      const threadProviderProfileId = activeThreadId
        ? getThreadProviderProfileId?.(activeWorkspace.id, activeThreadId) ??
          null
        : null;
      const codexFirstSendProviderProfileId =
        currentEngine === "codex"
          ? resolveSendProviderProfileId({
              threadProviderProfileId,
              composerProviderProfileId:
                resolvedComposerSelection?.providerProfileId,
            })
          : null;
      const codexFirstSendOptions = codexFirstSendProviderProfileId
        ? { providerProfileId: codexFirstSendProviderProfileId }
        : undefined;
      if (activeThreadId) {
        const storedThreadEngine = getThreadEngine(
          activeWorkspace.id,
          activeThreadId,
        );
        const threadKind = resolveThreadKind(
          activeWorkspace.id,
          activeThreadId,
        );
        const threadEngine = resolveThreadEngine(
          activeWorkspace.id,
          activeThreadId,
        );
        if (threadKind !== "shared") {
          assertEngineExecutionEnabled(threadEngine);
        }
        const threadIdCompatible = isThreadIdCompatibleWithEngine(
          currentEngine,
          activeThreadId,
        );
        if (threadKind === "shared") {
          await sendMessageToThread(
            activeWorkspace,
            activeThreadId,
            finalText,
            images,
            {
              ...options,
              skipPromptExpansion: true,
            },
          );
          return;
        }
        assertEngineExecutionEnabled(currentEngine);
        const explicitEngine = consumeExplicitComposerEngineSwitch();
        const shouldSpawn = shouldSpawnNativeThreadForEngineMismatch({
          threadEngine,
          currentEngine,
          threadIdCompatible,
          explicitEngine,
        });
        // Implicit rematch / same-name runtime drift must stay on this thread.
        // Only an explicit engine-group switch may spawn another native CLI.
        if (shouldSpawn) {
          onDebug?.({
            id: `${Date.now()}-client-engine-switch`,
            timestamp: Date.now(),
            source: "client",
            label: "engine/switch",
            payload: {
              workspaceId: activeWorkspace.id,
              oldThreadId: activeThreadId,
              oldEngineFromStore: storedThreadEngine ?? null,
              oldEngine: threadEngine,
              newEngine: currentEngine,
              threadIdCompatible,
              explicitEngine,
            },
          });
          const newThreadId = await startThreadForMessageSend(
            activeWorkspace,
            currentEngine,
            codexFirstSendOptions,
          );
          if (!newThreadId) {
            return;
          }
          await sendMessageToThread(
            activeWorkspace,
            newThreadId,
            finalText,
            images,
            {
              ...options,
              skipPromptExpansion: true,
            },
          );
          return;
        }
        if (threadEngine !== currentEngine || !threadIdCompatible) {
          onDebug?.({
            id: `${Date.now()}-client-engine-stay`,
            timestamp: Date.now(),
            source: "client",
            label: "engine/stay-on-thread",
            payload: {
              workspaceId: activeWorkspace.id,
              threadId: activeThreadId,
              threadEngine,
              currentEngine,
              threadIdCompatible,
              explicitEngine,
            },
          });
        }
      }

      // No engine switch, proceed normally
      assertEngineExecutionEnabled(currentEngine);
      const threadId = activeThreadId
        ? await ensureThreadForActiveWorkspace()
        : await startThreadForMessageSend(
            activeWorkspace,
            currentEngine,
            codexFirstSendOptions,
          );
      if (!threadId) {
        return;
      }
      await sendMessageToThread(activeWorkspace, threadId, finalText, images, {
        ...options,
        skipPromptExpansion: true,
      });
    },
    [
      activeEngine,
      activeThreadId,
      activeWorkspace,
      customPrompts,
      ensureThreadForActiveWorkspace,
      isThreadIdCompatibleWithEngine,
      normalizeEngineSelection,
      onDebug,
      pushThreadErrorMessage,
      getThreadEngine,
      getThreadProviderProfileId,
      resolveThreadKind,
      resolveThreadEngine,
      resolveComposerSelection,
      safeMessageActivity,
      sendMessageToThread,
      startThreadForMessageSend,
    ],
  );

  const sendUserMessageToThread = useCallback(
    async (
      workspace: WorkspaceInfo,
      threadId: string,
      text: string,
      images: string[] = [],
      options?: SendMessageOptions,
    ) => {
      return sendMessageToThread(workspace, threadId, text, images, options);
    },
    [sendMessageToThread],
  );

  const handleFusionStalled = useCallback(
    (threadId: string, options?: HandleFusionStalledOptions) => {
      if (!activeWorkspace || !threadId) {
        return;
      }
      dispatch({
        type: "settleThreadPlanInProgress",
        threadId,
        targetStatus: "pending",
      });
      dispatch({
        type: "markContextCompacting",
        threadId,
        isCompacting: false,
        timestamp: Date.now(),
      });
      markProcessing(threadId, false);
      markReviewing(threadId, false);
      setActiveTurnId(threadId, null);
      pushThreadErrorMessage(
        activeWorkspace.id,
        threadId,
        options?.message?.trim() || t("threads.fusionTurnStalled"),
      );
      safeMessageActivity();
    },
    [
      activeWorkspace,
      dispatch,
      markProcessing,
      markReviewing,
      pushThreadErrorMessage,
      safeMessageActivity,
      setActiveTurnId,
      t,
    ],
  );

  const interruptTurn = useThreadInterruptTurn({
    activeThreadId,
    activeTurnIdByThread,
    activeWorkspace,
    dispatch,
    interruptedThreadsRef,
    markProcessing,
    onDebug,
    pendingInterruptsRef,
    getThreadProviderProfileId,
    resolveThreadEngine,
    resolveThreadKind,
    setActiveTurnId,
    t,
    threadStatusById,
  });

  const {
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
    startReview,
  } = useThreadMessagingReview({
    activeEngine,
    activeWorkspace,
    activeThreadId,
    ensureThreadForActiveWorkspace,
    ensureThreadForWorkspace,
    isThreadIdCompatibleWithEngine,
    markProcessing,
    markReviewing,
    onDebug,
    pushThreadErrorMessage,
    resolveThreadEngine,
    safeMessageActivity,
    sendMessageToThread,
    setActiveTurnId,
    startThreadForWorkspace,
  });

  const {
    startCompact,
    startContext,
    startExport,
    startFast,
    startFork,
    startImport,
    startLsp,
    startMcp,
    startMode,
    startResume,
    startShare,
    startSpecRoot,
    startStatus,
  } = useThreadMessagingSessionTooling({
    activeThreadId,
    activeWorkspace,
    accessMode,
    collaborationMode,
    dispatch,
    effort,
    ensureThreadForActiveWorkspace,
    forkThreadForWorkspace,
    getCustomName,
    isThreadIdCompatibleWithEngine,
    model,
    onDebug,
    pushThreadErrorMessage,
    rateLimitsByWorkspace,
    recordThreadActivity,
    refreshThread,
    resolveCollaborationRuntimeMode,
    resolveComposerSelection,
    resolveThreadEngine,
    resolveThreadKind,
    safeMessageActivity,
    sendMessageToThread,
    sessionSpecLinkByThreadRef,
    t,
    threadStatusById,
    codexCompactionInFlightByThreadRef:
      effectiveCodexCompactionInFlightByThreadRef,
    tokenUsageByThread,
  });

  return {
    handleFusionStalled,
    interruptTurn,
    sendUserMessage,
    sendUserMessageToThread,
    startFork,
    startReview,
    startResume,
    startMcp,
    startSpecRoot,
    startStatus,
    startContext,
    startCompact,
    startFast,
    startMode,
    startExport,
    startImport,
    startLsp,
    startShare,
    reviewPrompt,
    openReviewPrompt,
    closeReviewPrompt,
    showPresetStep,
    choosePreset,
    highlightedPresetIndex,
    setHighlightedPresetIndex,
    highlightedBranchIndex,
    setHighlightedBranchIndex,
    highlightedCommitIndex,
    setHighlightedCommitIndex,
    handleReviewPromptKeyDown,
    confirmBranch,
    selectBranch,
    selectBranchAtIndex,
    selectCommit,
    selectCommitAtIndex,
    confirmCommit,
    updateCustomInstructions,
    confirmCustom,
  };
}
