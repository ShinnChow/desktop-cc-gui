import type { ThreadSummary } from "../../../types";
import { prepareThreadItems } from "../../../utils/threadItems";
import { isClaudeForkThreadId } from "../utils/claudeForkThread";
import { shouldPreferExistingThreadName } from "./threadReducerThreadNaming";
import type { ThreadState } from "./threadReducerTypes";

export function attachReplacedThreadId(
  thread: ThreadSummary,
  replacedThreadId: string,
): ThreadSummary {
  if (thread.id === replacedThreadId) {
    return thread;
  }
  const nativeThreadIds = thread.nativeThreadIds ?? [];
  if (nativeThreadIds.includes(replacedThreadId)) {
    return thread;
  }
  return {
    ...thread,
    nativeThreadIds: [...nativeThreadIds, replacedThreadId],
  };
}

export function renameThreadStateIdentity({
  state,
  workspaceId,
  oldThreadId,
  newThreadId,
}: {
  state: ThreadState;
  workspaceId: string;
  oldThreadId: string;
  newThreadId: string;
}): ThreadState {
  if (oldThreadId === newThreadId) {
    return state;
  }

  const newActiveThreadIdByWorkspace = { ...state.activeThreadIdByWorkspace };
  if (newActiveThreadIdByWorkspace[workspaceId] === oldThreadId) {
    newActiveThreadIdByWorkspace[workspaceId] = newThreadId;
  }

  const newItemsByThread = { ...state.itemsByThread };
  if (newItemsByThread[oldThreadId]) {
    const oldItems = newItemsByThread[oldThreadId] ?? [];
    const existingItems = newItemsByThread[newThreadId] ?? [];
    const oldHasUserMessage = oldItems.some(
      (item) => item.kind === "message" && item.role === "user",
    );
    const existingHasUserMessage = existingItems.some(
      (item) => item.kind === "message" && item.role === "user",
    );
    const mergedItems =
      oldHasUserMessage && !existingHasUserMessage
        ? [...oldItems, ...existingItems]
        : [...existingItems, ...oldItems];
    newItemsByThread[newThreadId] = prepareThreadItems([...mergedItems]);
    delete newItemsByThread[oldThreadId];
  }

  const newHistoryRestoredAtMsByThread = { ...state.historyRestoredAtMsByThread };
  if (newHistoryRestoredAtMsByThread[oldThreadId] !== undefined) {
    newHistoryRestoredAtMsByThread[newThreadId] =
      newHistoryRestoredAtMsByThread[newThreadId]
      ?? newHistoryRestoredAtMsByThread[oldThreadId]
      ?? null;
    delete newHistoryRestoredAtMsByThread[oldThreadId];
  }

  const newHistoryWindowByThread = { ...state.historyWindowByThread };
  if (newHistoryWindowByThread[oldThreadId] !== undefined) {
    newHistoryWindowByThread[newThreadId] =
      newHistoryWindowByThread[newThreadId]
      ?? newHistoryWindowByThread[oldThreadId];
    delete newHistoryWindowByThread[oldThreadId];
  }

  const newThreadsByWorkspace = { ...state.threadsByWorkspace };
  const workspaceThreads = newThreadsByWorkspace[workspaceId];
  if (workspaceThreads) {
    const renamedThreads = workspaceThreads.map((thread) =>
      thread.id === oldThreadId
        ? attachReplacedThreadId({ ...thread, id: newThreadId }, oldThreadId)
        : thread,
    );
    const dedupedById = new Map<string, ThreadSummary>();
    for (const thread of renamedThreads) {
      const current = dedupedById.get(thread.id);
      if (!current) {
        dedupedById.set(thread.id, thread);
        continue;
      }
      const nativeThreadIds = Array.from(
        new Set([
          ...(current.nativeThreadIds ?? []),
          ...(thread.nativeThreadIds ?? []),
        ]),
      );
      dedupedById.set(thread.id, {
        ...current,
        ...thread,
        name: shouldPreferExistingThreadName(current.name, thread.name)
          ? current.name
          : thread.name,
        sourceLabel: thread.sourceLabel ?? current.sourceLabel,
        providerProfileId:
          thread.providerProfileId ?? current.providerProfileId,
        providerProfileSource:
          thread.providerProfileSource ?? current.providerProfileSource,
        providerProfileName:
          thread.providerProfileName ?? current.providerProfileName,
        providerAvailability:
          thread.providerAvailability ?? current.providerAvailability,
        dshAgentPreset: thread.dshAgentPreset ?? current.dshAgentPreset,
        updatedAt: Math.max(current.updatedAt, thread.updatedAt),
        nativeThreadIds: nativeThreadIds.length > 0 ? nativeThreadIds : undefined,
      });
    }
    newThreadsByWorkspace[workspaceId] = Array.from(dedupedById.values());
  }

  const newThreadStatusById = { ...state.threadStatusById };
  if (newThreadStatusById[oldThreadId]) {
    const oldStatus = newThreadStatusById[oldThreadId];
    const existingStatus = newThreadStatusById[newThreadId];
    newThreadStatusById[newThreadId] = existingStatus
      ? {
          isProcessing: oldStatus.isProcessing || existingStatus.isProcessing,
          hasUnread: oldStatus.hasUnread || existingStatus.hasUnread,
          isReviewing: oldStatus.isReviewing || existingStatus.isReviewing,
          isContextCompacting:
            (oldStatus.isContextCompacting ?? false)
            || (existingStatus.isContextCompacting ?? false),
          // 后台任务计数取 max：两侧都可能有 live 任务在跑，合并后总数不缩水。
          backgroundTaskRunningCount: Math.max(
            oldStatus.backgroundTaskRunningCount ?? 0,
            existingStatus.backgroundTaskRunningCount ?? 0,
          ),
          processingStartedAt:
            oldStatus.processingStartedAt ?? existingStatus.processingStartedAt,
          lastDurationMs:
            oldStatus.lastDurationMs ?? existingStatus.lastDurationMs,
          heartbeatPulse:
            oldStatus.heartbeatPulse ?? existingStatus.heartbeatPulse ?? 0,
          continuationPulse:
            oldStatus.continuationPulse ?? existingStatus.continuationPulse ?? 0,
          terminalPulse:
            oldStatus.terminalPulse ?? existingStatus.terminalPulse ?? 0,
          codexCompactionSource:
            oldStatus.codexCompactionLifecycleState !== "idle"
              ? (oldStatus.codexCompactionSource ?? null)
              : (existingStatus.codexCompactionSource ?? null),
          codexCompactionLifecycleState:
            oldStatus.codexCompactionLifecycleState !== "idle"
              ? (oldStatus.codexCompactionLifecycleState ?? "idle")
              : (existingStatus.codexCompactionLifecycleState ?? "idle"),
          codexCompactionCompletedAt:
            oldStatus.codexCompactionCompletedAt
            ?? existingStatus.codexCompactionCompletedAt
            ?? null,
          lastTokenUsageUpdatedAt:
            oldStatus.lastTokenUsageUpdatedAt
            ?? existingStatus.lastTokenUsageUpdatedAt
            ?? null,
        }
      : oldStatus;
    delete newThreadStatusById[oldThreadId];
  }

  const newActiveTurnIdByThread = { ...state.activeTurnIdByThread };
  if (newActiveTurnIdByThread[oldThreadId] !== undefined) {
    newActiveTurnIdByThread[newThreadId] =
      newActiveTurnIdByThread[oldThreadId] ??
      newActiveTurnIdByThread[newThreadId] ??
      null;
    delete newActiveTurnIdByThread[oldThreadId];
  }

  const newCodexAcceptedTurnByThread = { ...state.codexAcceptedTurnByThread };
  if (newCodexAcceptedTurnByThread[oldThreadId]) {
    const oldFact = newCodexAcceptedTurnByThread[oldThreadId];
    const existingFact = newCodexAcceptedTurnByThread[newThreadId];
    newCodexAcceptedTurnByThread[newThreadId] =
      existingFact?.fact === "accepted" ? existingFact : oldFact;
    delete newCodexAcceptedTurnByThread[oldThreadId];
  }

  const newTokenUsageByThread = { ...state.tokenUsageByThread };
  if (newTokenUsageByThread[oldThreadId]) {
    newTokenUsageByThread[newThreadId] =
      newTokenUsageByThread[newThreadId] ?? newTokenUsageByThread[oldThreadId];
    delete newTokenUsageByThread[oldThreadId];
  }

  const newPlanByThread = { ...state.planByThread };
  if (newPlanByThread[oldThreadId] !== undefined) {
    newPlanByThread[newThreadId] =
      newPlanByThread[newThreadId] ?? newPlanByThread[oldThreadId];
    delete newPlanByThread[oldThreadId];
  }

  const newLastAgentMessageByThread = { ...state.lastAgentMessageByThread };
  if (newLastAgentMessageByThread[oldThreadId]) {
    const oldMessage = newLastAgentMessageByThread[oldThreadId];
    const existingMessage = newLastAgentMessageByThread[newThreadId];
    newLastAgentMessageByThread[newThreadId] =
      existingMessage && existingMessage.timestamp > oldMessage.timestamp
        ? existingMessage
        : oldMessage;
    delete newLastAgentMessageByThread[oldThreadId];
  }

  const newAgentSegmentByThread = { ...state.agentSegmentByThread };
  if (newAgentSegmentByThread[oldThreadId] !== undefined) {
    newAgentSegmentByThread[newThreadId] = Math.max(
      newAgentSegmentByThread[oldThreadId] ?? 0,
      newAgentSegmentByThread[newThreadId] ?? 0,
    );
    delete newAgentSegmentByThread[oldThreadId];
  }

  const newThreadParentById = { ...state.threadParentById };
  if (newThreadParentById[oldThreadId]) {
    if (!isClaudeForkThreadId(oldThreadId)) {
      newThreadParentById[newThreadId] = newThreadParentById[oldThreadId];
    }
    delete newThreadParentById[oldThreadId];
  }
  for (const [threadId, parentId] of Object.entries(newThreadParentById)) {
    if (parentId === oldThreadId) {
      newThreadParentById[threadId] = newThreadId;
    }
  }

  const newHiddenThreadIdsByWorkspace = { ...state.hiddenThreadIdsByWorkspace };
  const workspaceHidden = newHiddenThreadIdsByWorkspace[workspaceId];
  if (workspaceHidden?.[oldThreadId]) {
    newHiddenThreadIdsByWorkspace[workspaceId] = {
      ...workspaceHidden,
      [newThreadId]: true,
    };
    delete newHiddenThreadIdsByWorkspace[workspaceId][oldThreadId];
  }

  const newUserInputRequests = state.userInputRequests.map((request) => {
    if (
      request.shared_runtime_owner ||
      request.workspace_id !== workspaceId ||
      request.params.thread_id !== oldThreadId
    ) {
      return request;
    }
    return {
      ...request,
      params: {
        ...request.params,
        thread_id: newThreadId,
      },
    };
  });

  return {
    ...state,
    activeThreadIdByWorkspace: newActiveThreadIdByWorkspace,
    itemsByThread: newItemsByThread,
    historyRestoredAtMsByThread: newHistoryRestoredAtMsByThread,
    historyWindowByThread: newHistoryWindowByThread,
    threadsByWorkspace: newThreadsByWorkspace,
    threadStatusById: newThreadStatusById,
    activeTurnIdByThread: newActiveTurnIdByThread,
    codexAcceptedTurnByThread: newCodexAcceptedTurnByThread,
    tokenUsageByThread: newTokenUsageByThread,
    planByThread: newPlanByThread,
    lastAgentMessageByThread: newLastAgentMessageByThread,
    agentSegmentByThread: newAgentSegmentByThread,
    threadParentById: newThreadParentById,
    hiddenThreadIdsByWorkspace: newHiddenThreadIdsByWorkspace,
    userInputRequests: newUserInputRequests,
  };
}
