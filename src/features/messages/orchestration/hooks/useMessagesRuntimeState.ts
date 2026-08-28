import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConversationItem, EngineType } from "../../../../types";
import { setPerfStreamingState } from "../../../../services/perfBaseline/perfContextBridge";
import {
  ASSISTANT_FINALIZING_LIVE_WINDOW_MS,
  CODEX_FINALIZING_LIVE_WINDOW_MS,
  VISIBLE_TEXT_REPORT_EAGER_PREFIX_CHARS,
  VISIBLE_TEXT_REPORT_MIN_GROWTH_CHARS,
  VISIBLE_TEXT_REPORT_MIN_INTERVAL_MS,
} from "../../constants/messagesConstants";
import type { LastVisibleTextReport } from "../../types/messagesTypes";
import {
  isAssistantMessageConversationItem,
  isReasoningConversationItem,
  isUserMessageConversationItem,
} from "../../utils/messageItemPredicates";
import {
  findLastUserMessageIndex,
  findLatestAssistantMessageIdAfterIndex,
} from "../../utils/messagesRenderUtils";
import {
  TRANSIENT_RUNTIME_RECONNECT_AUTO_DISMISS_MS,
  resolveAssistantRuntimeReconnectHint,
  resolveRetryMessageForReconnectItem,
} from "../../../../runtime-recovery/runtimeReconnect";
import type { TimelineLiveModel } from "../models/messagesTimelineModels";

type RuntimeLabels = {
  approvalResumingAfterApproval: string;
  codexSilentSuspected: string;
  waitingForFirstText: string;
  contextCompacting: string;
};

type UseMessagesRuntimeStateInput = {
  activeEngine: EngineType;
  activeTurnId: string | null;
  codexSilentSuspectedAt: number | null;
  deferredRenderSourceItems: ConversationItem[];
  isContextCompacting: boolean;
  isMacDesktop: boolean;
  isAgentTaskNotificationText: (text: string) => boolean;
  isThinking: boolean;
  isWindowsDesktop: boolean;
  items: ConversationItem[];
  labels: RuntimeLabels;
  nativeRuntimeRecoveryEnabled: boolean;
  renderScopeKey: string;
  reportVisibleTextRendered: (
    threadId: string,
    payload: { itemId: string; visibleTextLength: number; renderAt: number },
  ) => void;
  renderSourceItems: ConversationItem[];
  streamActivityPhase: TimelineLiveModel["streamActivityPhase"];
  threadId: string | null;
  threadStreamLatencyCategory: string | null;
};

export function useMessagesRuntimeState({
  activeEngine,
  activeTurnId,
  codexSilentSuspectedAt,
  deferredRenderSourceItems,
  isContextCompacting,
  isMacDesktop,
  isAgentTaskNotificationText,
  isThinking,
  isWindowsDesktop,
  items,
  labels,
  nativeRuntimeRecoveryEnabled,
  renderScopeKey,
  reportVisibleTextRendered,
  renderSourceItems,
  streamActivityPhase,
  threadId,
  threadStreamLatencyCategory,
}: UseMessagesRuntimeStateInput) {
  const isWorking = isThinking || isContextCompacting;
  const blankingRecoveryActive =
    activeEngine === "claude" &&
    isThinking &&
    threadStreamLatencyCategory === "repeat-turn-blanking";
  const supportsStreamingReadableWindowRecovery =
    activeEngine === "claude" ||
    activeEngine === "codex" ||
    activeEngine === "gemini" ||
    activeEngine === "grok" ||
    activeEngine === "kimi" ||
    activeEngine === "opencode" ||
    activeEngine === "dsh";
  const visibleStallRecoveryActive =
    supportsStreamingReadableWindowRecovery &&
    isThinking &&
    threadStreamLatencyCategory === "visible-output-stall-after-first-delta";
  const readableWindowRecoveryActive =
    blankingRecoveryActive || visibleStallRecoveryActive;

  const transientRuntimeReconnectSeenAtByItemIdRef = useRef<Map<string, number>>(new Map());
  const [transientRuntimeReconnectClock, setTransientRuntimeReconnectClock] = useState(() =>
    Date.now(),
  );
  useEffect(() => {
    const currentMessageIds = new Set(
      items.filter((item) => item.kind === "message").map((item) => item.id),
    );
    const seenAtByItemId = transientRuntimeReconnectSeenAtByItemIdRef.current;
    for (const itemId of seenAtByItemId.keys()) {
      if (!currentMessageIds.has(itemId)) {
        seenAtByItemId.delete(itemId);
      }
    }
  }, [items]);
  const latestRuntimeReconnectItemId = useMemo(() => {
    if (!nativeRuntimeRecoveryEnabled) {
      return null;
    }
    let sawUserMessageAfterDiagnostic = false;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item || item.kind !== "message") {
        continue;
      }
      if (item.role === "user") {
        sawUserMessageAfterDiagnostic = true;
        continue;
      }
      if (item.role !== "assistant") {
        continue;
      }
      const runtimeReconnectHint = resolveAssistantRuntimeReconnectHint(
        item,
        isAgentTaskNotificationText(item.text),
      );
      if (!runtimeReconnectHint) {
        return null;
      }
      if (runtimeReconnectHint.tone === "transient" && sawUserMessageAfterDiagnostic) {
        continue;
      }
      if (runtimeReconnectHint.tone === "transient") {
        const seenAtByItemId = transientRuntimeReconnectSeenAtByItemIdRef.current;
        const seenAt = seenAtByItemId.get(item.id) ?? transientRuntimeReconnectClock;
        if (!seenAtByItemId.has(item.id)) {
          seenAtByItemId.set(item.id, seenAt);
        }
        const autoDismissMs =
          runtimeReconnectHint.autoDismissMs ?? TRANSIENT_RUNTIME_RECONNECT_AUTO_DISMISS_MS;
        if (transientRuntimeReconnectClock - seenAt >= autoDismissMs) {
          continue;
        }
      }
      return item.id;
    }
    return null;
  }, [
    isAgentTaskNotificationText,
    items,
    nativeRuntimeRecoveryEnabled,
    transientRuntimeReconnectClock,
  ]);
  useEffect(() => {
    if (!latestRuntimeReconnectItemId) {
      return;
    }
    const item = items.find((candidate) => candidate.id === latestRuntimeReconnectItemId);
    if (!item || item.kind !== "message" || item.role !== "assistant") {
      return;
    }
    const runtimeReconnectHint = resolveAssistantRuntimeReconnectHint(
      item,
      isAgentTaskNotificationText(item.text),
    );
    if (runtimeReconnectHint?.tone !== "transient") {
      return;
    }
    const seenAt =
      transientRuntimeReconnectSeenAtByItemIdRef.current.get(item.id) ??
      transientRuntimeReconnectClock;
    const autoDismissMs =
      runtimeReconnectHint.autoDismissMs ?? TRANSIENT_RUNTIME_RECONNECT_AUTO_DISMISS_MS;
    const remainingMs = Math.max(0, seenAt + autoDismissMs - Date.now());
    const timeoutId = window.setTimeout(() => {
      setTransientRuntimeReconnectClock(Date.now());
    }, remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [
    isAgentTaskNotificationText,
    items,
    latestRuntimeReconnectItemId,
    transientRuntimeReconnectClock,
  ]);
  const latestRetryMessage = useMemo(
    () => resolveRetryMessageForReconnectItem(items, latestRuntimeReconnectItemId),
    [items, latestRuntimeReconnectItemId],
  );

  const assistantFinalizingTimerRef = useRef<number | null>(null);
  const assistantFinalizingCompleteRenderedIdRef = useRef<string | null>(null);
  const lastVisibleTextReportRef = useRef<LastVisibleTextReport>({
    itemId: null,
    visibleTextLength: 0,
    reportedAt: 0,
  });
  const previousAssistantThinkingRef = useRef(isThinking);
  const previousAssistantScopeKeyRef = useRef(renderScopeKey);
  const runtimeScopeKeyRef = useRef(renderScopeKey);
  const [finalizingAssistantMessageId, setFinalizingAssistantMessageId] = useState<string | null>(null);
  const renderSourceItemsRef = useRef(renderSourceItems);
  renderSourceItemsRef.current = renderSourceItems;
  const lastUserMessageIndex = useMemo(
    () => findLastUserMessageIndex(deferredRenderSourceItems),
    [deferredRenderSourceItems],
  );
  const liveSourceLastUserMessageIndex = useMemo(
    () => findLastUserMessageIndex(renderSourceItems),
    [renderSourceItems],
  );

  const latestAssistantMessageId = useMemo(
    () => findLatestAssistantMessageIdAfterIndex(deferredRenderSourceItems, lastUserMessageIndex),
    [deferredRenderSourceItems, lastUserMessageIndex],
  );
  const latestLiveSourceAssistantMessageId = useMemo(
    () => findLatestAssistantMessageIdAfterIndex(renderSourceItems, liveSourceLastUserMessageIndex),
    [liveSourceLastUserMessageIndex, renderSourceItems],
  );
  const assistantFinalizingCandidateId =
    latestLiveSourceAssistantMessageId ?? latestAssistantMessageId;
  // live-text externalization：isThinking 关掉后若立刻 isStreaming=false，
  // MessageRow 会切回 item.text（常为建壳首字）。Claude/Codex 已有 finalizing
  // 窗口；Grok/Kimi/Gemini/OpenCode 同样走 live 通道，必须对齐，否则结束后
  // 只剩「这」「已」「**」直到重开历史（见 live settle full-text fix）。
  const supportsAssistantFinalizingWindow =
    activeEngine === "claude" ||
    activeEngine === "codex" ||
    activeEngine === "gemini" ||
    activeEngine === "grok" ||
    activeEngine === "kimi" ||
    activeEngine === "opencode" ||
    activeEngine === "dsh";
  const isAssistantCompletionFrame =
    supportsAssistantFinalizingWindow &&
    previousAssistantScopeKeyRef.current === renderScopeKey &&
    previousAssistantThinkingRef.current &&
    !isThinking &&
    assistantFinalizingCandidateId !== null;
  const liveAssistantMessageId = isThinking
    ? assistantFinalizingCandidateId
    : finalizingAssistantMessageId ??
      (isAssistantCompletionFrame ? assistantFinalizingCandidateId : null);
  const isAssistantFinalizing = !isThinking && liveAssistantMessageId !== null;
  const isWorkingRef = useRef(isWorking);
  isWorkingRef.current = isWorking;
  const isAssistantFinalizingRef = useRef(isAssistantFinalizing);
  isAssistantFinalizingRef.current = isAssistantFinalizing;

  useEffect(() => {
    if (runtimeScopeKeyRef.current === renderScopeKey) {
      return;
    }
    runtimeScopeKeyRef.current = renderScopeKey;
    transientRuntimeReconnectSeenAtByItemIdRef.current.clear();
    setTransientRuntimeReconnectClock(Date.now());
    if (assistantFinalizingTimerRef.current !== null) {
      window.clearTimeout(assistantFinalizingTimerRef.current);
      assistantFinalizingTimerRef.current = null;
    }
    assistantFinalizingCompleteRenderedIdRef.current = null;
    lastVisibleTextReportRef.current = {
      itemId: null,
      visibleTextLength: 0,
      reportedAt: 0,
    };
    setFinalizingAssistantMessageId((current) =>
      current === null ? current : null,
    );
    previousAssistantThinkingRef.current = false;
    previousAssistantScopeKeyRef.current = renderScopeKey;
  }, [renderScopeKey]);

  useEffect(() => {
    const previouslyThinking = previousAssistantThinkingRef.current;
    previousAssistantScopeKeyRef.current = renderScopeKey;
    previousAssistantThinkingRef.current = isThinking;
    if (!supportsAssistantFinalizingWindow || isThinking) {
      if (assistantFinalizingTimerRef.current !== null) {
        window.clearTimeout(assistantFinalizingTimerRef.current);
        assistantFinalizingTimerRef.current = null;
      }
      assistantFinalizingCompleteRenderedIdRef.current = null;
      // 不把 finalizingAssistantMessageId 放进 deps：避免 set→re-run 自环；只走 functional bailout
      setFinalizingAssistantMessageId((current) =>
        current === null ? current : null,
      );
      return;
    }
    if (!previouslyThinking || !assistantFinalizingCandidateId) {
      return;
    }
    setFinalizingAssistantMessageId((current) =>
      current === assistantFinalizingCandidateId
        ? current
        : assistantFinalizingCandidateId,
    );
    if (assistantFinalizingTimerRef.current !== null) {
      window.clearTimeout(assistantFinalizingTimerRef.current);
    }
    assistantFinalizingCompleteRenderedIdRef.current = null;
    const finalizingWindowMs =
      activeEngine === "codex"
        ? CODEX_FINALIZING_LIVE_WINDOW_MS
        : ASSISTANT_FINALIZING_LIVE_WINDOW_MS;
    assistantFinalizingTimerRef.current = window.setTimeout(() => {
      assistantFinalizingTimerRef.current = null;
      assistantFinalizingCompleteRenderedIdRef.current = null;
      setFinalizingAssistantMessageId((current) =>
        current === assistantFinalizingCandidateId ? null : current,
      );
    }, finalizingWindowMs);
  }, [
    activeEngine,
    assistantFinalizingCandidateId,
    isThinking,
    renderScopeKey,
    supportsAssistantFinalizingWindow,
  ]);
  useEffect(
    () => () => {
      if (assistantFinalizingTimerRef.current !== null) {
        window.clearTimeout(assistantFinalizingTimerRef.current);
        assistantFinalizingTimerRef.current = null;
      }
      assistantFinalizingCompleteRenderedIdRef.current = null;
    },
    [],
  );
  useEffect(() => {
    lastVisibleTextReportRef.current = {
      itemId: null,
      visibleTextLength: 0,
      reportedAt: 0,
    };
  }, [activeTurnId, renderScopeKey]);

  const waitingForFirstChunk = useMemo(() => {
    if (!isThinking || deferredRenderSourceItems.length === 0) {
      return false;
    }
    let latestUserIndex = -1;
    for (let index = deferredRenderSourceItems.length - 1; index >= 0; index -= 1) {
      const item = deferredRenderSourceItems[index];
      if (isUserMessageConversationItem(item)) {
        latestUserIndex = index;
        break;
      }
    }
    if (latestUserIndex < 0) {
      return false;
    }
    // pi 的流是 reasoning/tool 先行（首个 message_update 即 thinking_start）：
    // 思考或工具行一旦渲染就不再是「等待首段」静默窗，标签必须立即让位，
    // 否则流已到而文案仍称等待（2026-08-28 真机反馈）。其余引擎维持只有
    // assistant message 才算 chunk 到达的既有语义。
    const reasoningOrToolCountsAsChunk = activeEngine === "pi";
    for (
      let index = latestUserIndex + 1;
      index < deferredRenderSourceItems.length;
      index += 1
    ) {
      const item = deferredRenderSourceItems[index];
      if (isAssistantMessageConversationItem(item)) {
        return false;
      }
      if (
        reasoningOrToolCountsAsChunk &&
        (isReasoningConversationItem(item) || item?.kind === "tool")
      ) {
        return false;
      }
    }
    return true;
  }, [activeEngine, deferredRenderSourceItems, isThinking]);
  const approvalResumeWorkingLabel = useMemo(() => {
    if (!isThinking || lastUserMessageIndex < 0) {
      return null;
    }
    for (
      let index = deferredRenderSourceItems.length - 1;
      index > lastUserMessageIndex;
      index -= 1
    ) {
      const item = deferredRenderSourceItems[index];
      if (!item) {
        continue;
      }
      if (isAssistantMessageConversationItem(item)) {
        break;
      }
      if (
        item.kind === "tool" &&
        item.toolType === "fileChange" &&
        item.status === "running"
      ) {
        return item.output?.trim() || labels.approvalResumingAfterApproval;
      }
    }
    return null;
  }, [deferredRenderSourceItems, isThinking, labels.approvalResumingAfterApproval, lastUserMessageIndex]);
  useEffect(() => {
    setPerfStreamingState({
      isStreaming: isThinking,
      streamActivityPhase: streamActivityPhase ? String(streamActivityPhase) : null,
      visibleRowCount: renderSourceItems.length,
    });
  }, [isThinking, renderSourceItems.length, streamActivityPhase]);

  const codexSilentSuspectedLabel =
    activeEngine === "codex" && codexSilentSuspectedAt !== null
      ? labels.codexSilentSuspected
      : null;
  // First-text waiting is for engines whose onboarding identity used to collapse
  // to Codex copy (Codex itself, plus Native-only DSH/Qoder), plus pi whose RPC
  // prefill window runs 20-50s with zero events (pi first-packet diagnosis
  // 2026-08-28). Do not steal the default "响应中" / tool-activity working label
  // from Gemini, Claude, etc.
  const waitingForFirstTextLabel =
    isThinking &&
    waitingForFirstChunk &&
    (activeEngine === "codex" ||
      activeEngine === "qoder" ||
      activeEngine === "dsh" ||
      activeEngine === "pi")
      ? labels.waitingForFirstText
      : null;
  const primaryWorkingLabel = isContextCompacting
    ? labels.contextCompacting
    : codexSilentSuspectedLabel ??
      waitingForFirstTextLabel ??
      approvalResumeWorkingLabel;
  const enableClaudeRenderSafeMode =
    (isWindowsDesktop || isMacDesktop) && activeEngine === "claude" && isThinking;

  const handleAssistantVisibleTextRender = useCallback(
    (payload: { itemId: string; visibleText: string }) => {
      if (
        (activeEngine !== "claude" && activeEngine !== "codex" && activeEngine !== "gemini") ||
        (!isThinking && !isAssistantFinalizing) ||
        !threadId
      ) {
        return;
      }
      const visibleTextLength = payload.visibleText.length;
      let targetTextLength = 0;
      if (
        activeEngine === "codex" &&
        isAssistantFinalizing &&
        payload.itemId === finalizingAssistantMessageId
      ) {
        const targetItem = renderSourceItemsRef.current.find(
          (item) => isAssistantMessageConversationItem(item) && item.id === payload.itemId,
        );
        targetTextLength =
          targetItem && isAssistantMessageConversationItem(targetItem)
            ? targetItem.text.length
            : 0;
      }
      const previousReport = lastVisibleTextReportRef.current;
      const isNewAssistantItem = previousReport.itemId !== payload.itemId;
      const visibleTextGrew =
        isNewAssistantItem || visibleTextLength > previousReport.visibleTextLength;
      if (visibleTextGrew) {
        const now = Date.now();
        const shouldReport =
          isNewAssistantItem ||
          visibleTextLength <= VISIBLE_TEXT_REPORT_EAGER_PREFIX_CHARS ||
          visibleTextLength - previousReport.visibleTextLength >=
            VISIBLE_TEXT_REPORT_MIN_GROWTH_CHARS ||
          now - previousReport.reportedAt >= VISIBLE_TEXT_REPORT_MIN_INTERVAL_MS ||
          (targetTextLength > 0 && visibleTextLength >= targetTextLength);
        if (shouldReport) {
          reportVisibleTextRendered(threadId, {
            itemId: payload.itemId,
            visibleTextLength,
            renderAt: now,
          });
          lastVisibleTextReportRef.current = {
            itemId: payload.itemId,
            visibleTextLength,
            reportedAt: now,
          };
        }
      }
      if (
        activeEngine === "codex" &&
        isAssistantFinalizing &&
        payload.itemId === finalizingAssistantMessageId &&
        targetTextLength > 0 &&
        visibleTextLength >= targetTextLength &&
        assistantFinalizingCompleteRenderedIdRef.current !== payload.itemId
      ) {
        assistantFinalizingCompleteRenderedIdRef.current = payload.itemId;
        if (assistantFinalizingTimerRef.current !== null) {
          window.clearTimeout(assistantFinalizingTimerRef.current);
        }
        const completedAssistantMessageId = payload.itemId;
        assistantFinalizingTimerRef.current = window.setTimeout(() => {
          assistantFinalizingTimerRef.current = null;
          assistantFinalizingCompleteRenderedIdRef.current = null;
          setFinalizingAssistantMessageId((current) =>
            current === completedAssistantMessageId ? null : current,
          );
        }, ASSISTANT_FINALIZING_LIVE_WINDOW_MS);
      }
    },
    [
      activeEngine,
      finalizingAssistantMessageId,
      isAssistantFinalizing,
      isThinking,
      reportVisibleTextRendered,
      threadId,
    ],
  );

  const getPendingRuntimeResourceCount = useCallback(
    () => (assistantFinalizingTimerRef.current !== null ? 1 : 0),
    [],
  );

  return {
    blankingRecoveryActive,
    enableClaudeRenderSafeMode,
    getPendingRuntimeResourceCount,
    handleAssistantVisibleTextRender,
    isAssistantFinalizing,
    isAssistantFinalizingRef,
    isWorking,
    isWorkingRef,
    latestAssistantMessageId,
    latestRetryMessage,
    latestRuntimeReconnectItemId,
    liveAssistantMessageId,
    primaryWorkingLabel,
    readableWindowRecoveryActive,
    supportsStreamingReadableWindowRecovery,
    visibleStallRecoveryActive,
    waitingForFirstChunk,
  };
}
