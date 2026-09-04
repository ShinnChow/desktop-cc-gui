import type { ThreadSummary } from "../../../types";
import {
  isCollabWorkerNativeThreadId,
  rememberCollabWorkerNativeThreadId,
} from "../../multi-agent/runtime/collabNativeHideRegistry";
import {
  isCollabWorkerAgentNumberTitle,
  isSharedControlPlaneSpawnTitle,
} from "./useThreadActions.helpers";
import { isCommitMessageHelperPreview } from "../utils/codexBackgroundHelpers";
import { resolveMergedThreadCreatedAt } from "../utils/threadSummarySort";
import { isClaudeForkThreadId } from "../utils/claudeForkThread";
import { threadSummaryListEqual } from "./threadReducerEqualityGuards";
import { mergeProviderBindingFields } from "./threadReducerProviderBinding";
import {
  isRetainableFinalizedCodexThread,
  shouldPreferExistingThreadName,
} from "./threadReducerThreadNaming";
import type { ThreadAction, ThreadState } from "./threadReducerTypes";

const PENDING_THREAD_LAST_AGENT_ANCHOR_TTL_MS = 5 * 60 * 1000;

export function reduceSetThreads(
  state: ThreadState,
  action: Extract<ThreadAction, { type: "setThreads" }>,
): ThreadState {
  const hidden = state.hiddenThreadIdsByWorkspace[action.workspaceId] ?? {};
  const isHiddenAutomaticThread = (thread: ThreadSummary) =>
    thread.autoSession?.visibility === "hidden" ||
    isCommitMessageHelperPreview(thread.name);
  const existingThreads = state.threadsByWorkspace[action.workspaceId] ?? [];
  const now = Date.now();
  const promotedPendingAliases = new Set(
    existingThreads.flatMap((thread) =>
      (thread.nativeThreadIds ?? []).filter((threadId) =>
        threadId.includes("-pending-"),
      ),
    ),
  );
  const incomingThreads = action.threads.filter((thread) => {
    if (promotedPendingAliases.has(thread.id)) return false;
    // 协作 worker / control-plane 永不进侧栏
    if (thread.id.startsWith("agent-canvas:")) return false;
    if (isCollabWorkerNativeThreadId(thread.id)) return false;
    if (thread.parentThreadId?.startsWith("shared:")) {
      rememberCollabWorkerNativeThreadId(thread.id);
      return false;
    }
    if (
      !thread.id.startsWith("shared:") &&
      isSharedControlPlaneSpawnTitle(thread.name)
    ) {
      rememberCollabWorkerNativeThreadId(thread.id);
      return false;
    }
    // Agent N + 已登记协作 worker id（realtime 先登记、catalog 后改名）
    if (
      isCollabWorkerAgentNumberTitle(thread.name) &&
      isCollabWorkerNativeThreadId(thread.id)
    ) {
      return false;
    }
    return true;
  });
  const shouldPreserveDegradedCodexFinalizedThreads = incomingThreads.some(
    (thread) => thread.isDegraded,
  );
  // BUG FIX: Preserve engineSource and other info from existing threads when merging
  // This prevents loss of explicitly set engine types (e.g., Claude) when refreshing thread list
  const existingThreadById = new Map(
    existingThreads.map((thread) => [thread.id, thread]),
  );
  const newThreadIds = new Set(incomingThreads.map((thread) => thread.id));
  const hasPendingThreadAnchor = (threadId: string) => {
    const hasActiveTurn =
      (state.activeTurnIdByThread[threadId] ?? null) !== null;
    if (hasActiveTurn) {
      return true;
    }
    const itemCount = state.itemsByThread[threadId]?.length ?? 0;
    const isProcessing = Boolean(
      state.threadStatusById[threadId]?.isProcessing,
    );
    if (isProcessing && itemCount > 0) {
      return true;
    }
    const lastAgentMessageTimestamp =
      state.lastAgentMessageByThread[threadId]?.timestamp ?? 0;
    const hasRecentAgentMessage =
      lastAgentMessageTimestamp > 0 &&
      now - lastAgentMessageTimestamp <=
        PENDING_THREAD_LAST_AGENT_ANCHOR_TTL_MS;
    if (hasRecentAgentMessage) {
      return true;
    }
    return state.userInputRequests.some(
      (request) =>
        request.workspace_id === action.workspaceId &&
        request.params.thread_id === threadId,
    );
  };

  // Merge incoming threads with preserved existing info.
  // Apply hidden auto-session filtering AFTER merge so an incoming row that
  // lost autoSession metadata cannot resurrect a previously-hidden helper.
  const visibleThreads = incomingThreads
    .filter((thread) => !hidden[thread.id])
    .map((thread) => {
      const existing = existingThreadById.get(thread.id);
      if (existing) {
        // Preserve engineSource if new thread doesn't have one
        const engineSource = thread.engineSource || existing.engineSource;
        // fix-shared-session-target-race-and-merge T5：
        // shared: id 的 threadKind 恒为 "shared"，不受 incoming truthy 覆盖。
        const threadKind = existing.id.startsWith("shared:")
          ? "shared"
          : thread.threadKind || existing.threadKind;
        const selectedEngine = thread.selectedEngine || existing.selectedEngine;
        const nativeThreadIds =
          thread.nativeThreadIds || existing.nativeThreadIds;
        const autoSession = thread.autoSession ?? existing.autoSession ?? null;
        const incomingParentThreadId =
          thread.parentThreadId && thread.parentThreadId !== thread.id
            ? thread.parentThreadId
            : null;
        const existingParentThreadId =
          existing.parentThreadId && existing.parentThreadId !== existing.id
            ? existing.parentThreadId
            : null;
        const name = shouldPreferExistingThreadName(existing.name, thread.name)
          ? existing.name
          : thread.name;
        return mergeProviderBindingFields(
          {
            ...thread,
            name,
            parentThreadId:
              incomingParentThreadId ?? existingParentThreadId ?? null,
            engineSource,
            threadKind,
            selectedEngine,
            nativeThreadIds,
            autoSession,
            createdAt: resolveMergedThreadCreatedAt(existing, thread),
          },
          existing,
        );
      }
      const createdAt = resolveMergedThreadCreatedAt(undefined, thread);
      return createdAt === thread.createdAt ? thread : { ...thread, createdAt };
    })
    // fix-shared-session-target-race-and-merge T5 后置矫正：
    // 所有 shared: 前缀 id 的条目 threadKind 强制为 "shared"，
    // 兜底 merge 中任何路径导致的 kind 漂移。
    .map((thread) =>
      thread.id.startsWith("shared:") && thread.threadKind !== "shared"
        ? { ...thread, threadKind: "shared" as const }
        : thread,
    )
    .filter((thread) => !isHiddenAutomaticThread(thread));

  // BUG FIX: Also preserve threads that are currently active but not in the new list
  // (e.g., newly created Claude threads that haven't been synced to the backend yet)
  const activeThreadId = state.activeThreadIdByWorkspace[action.workspaceId];
  if (activeThreadId) {
    const activeThread = existingThreadById.get(activeThreadId);
    if (
      activeThread &&
      !newThreadIds.has(activeThreadId) &&
      !promotedPendingAliases.has(activeThreadId) &&
      !hidden[activeThreadId] &&
      !isHiddenAutomaticThread(activeThread)
    ) {
      // Prepend the active thread to preserve it
      visibleThreads.unshift(activeThread);
    }
  }

  // Preserve provisional runtime threads until native history can represent them.
  // Claude Fork bootstraps have no native row before their first send, while other
  // pending threads still require a realtime or folder anchor.
  const preservedThreadIds = new Set(visibleThreads.map((thread) => thread.id));
  const provisionalThreadsToPreserve = existingThreads.filter((thread) => {
    const threadId = thread.id;
    if (!threadId.includes("-pending-") && !isClaudeForkThreadId(threadId)) {
      return false;
    }
    if (promotedPendingAliases.has(threadId)) {
      return false;
    }
    if (threadId === activeThreadId) {
      return false;
    }
    if (
      hidden[threadId] ||
      isHiddenAutomaticThread(thread) ||
      newThreadIds.has(threadId) ||
      preservedThreadIds.has(threadId)
    ) {
      return false;
    }
    if (
      typeof thread.folderId === "string" &&
      thread.folderId.trim().length > 0
    ) {
      return true;
    }
    return isClaudeForkThreadId(threadId) || hasPendingThreadAnchor(threadId);
  });
  provisionalThreadsToPreserve.forEach((thread) =>
    preservedThreadIds.add(thread.id),
  );
  const finalizedCodexToPreserve = shouldPreserveDegradedCodexFinalizedThreads
    ? existingThreads.filter((thread) => {
        const threadId = thread.id;
        if (
          !isRetainableFinalizedCodexThread(thread) ||
          threadId === activeThreadId ||
          hidden[threadId] ||
          isHiddenAutomaticThread(thread) ||
          newThreadIds.has(threadId) ||
          preservedThreadIds.has(threadId)
        ) {
          return false;
        }
        return true;
      })
    : [];
  finalizedCodexToPreserve.forEach((thread) =>
    preservedThreadIds.add(thread.id),
  );
  const locallyAcceptedCodexToPreserve = existingThreads.filter((thread) => {
    const threadId = thread.id;
    if (
      (thread.engineSource ?? "codex") !== "codex" ||
      !state.codexAcceptedTurnByThread[threadId] ||
      threadId === activeThreadId ||
      hidden[threadId] ||
      isHiddenAutomaticThread(thread) ||
      newThreadIds.has(threadId) ||
      preservedThreadIds.has(threadId)
    ) {
      return false;
    }
    return true;
  });
  locallyAcceptedCodexToPreserve.forEach((thread) => {
    preservedThreadIds.add(thread.id);
  });
  const continuityThreadsToPreserve = action.unionMembership
    ? existingThreads.filter((thread) => {
        const threadId = thread.id;
        if (
          !threadId ||
          newThreadIds.has(threadId) ||
          preservedThreadIds.has(threadId) ||
          threadId === activeThreadId
        ) {
          return false;
        }
        if (
          hidden[threadId] ||
          isHiddenAutomaticThread(thread) ||
          promotedPendingAliases.has(threadId)
        ) {
          return false;
        }
        if (threadId.includes("-pending-") && !isClaudeForkThreadId(threadId)) {
          return false;
        }
        return true;
      })
    : [];
  continuityThreadsToPreserve.forEach((thread) => {
    preservedThreadIds.add(thread.id);
  });
  const hasPreservedRows =
    provisionalThreadsToPreserve.length > 0 ||
    finalizedCodexToPreserve.length > 0 ||
    locallyAcceptedCodexToPreserve.length > 0 ||
    continuityThreadsToPreserve.length > 0;
  const mergedVisibleThreads = hasPreservedRows
    ? activeThreadId && visibleThreads[0]?.id === activeThreadId
      ? [
          visibleThreads[0],
          ...finalizedCodexToPreserve,
          ...locallyAcceptedCodexToPreserve,
          ...provisionalThreadsToPreserve,
          ...continuityThreadsToPreserve,
          ...visibleThreads.slice(1),
        ]
      : [
          ...finalizedCodexToPreserve,
          ...locallyAcceptedCodexToPreserve,
          ...provisionalThreadsToPreserve,
          ...continuityThreadsToPreserve,
          ...visibleThreads,
        ]
    : visibleThreads;
  if (threadSummaryListEqual(existingThreads, mergedVisibleThreads)) {
    return state;
  }
  // 同步 parentThreadId → threadParentById，保证会话树与 live 投影一致
  let nextThreadParentById = state.threadParentById;
  let parentMapChanged = false;
  for (const thread of mergedVisibleThreads) {
    const parentId = thread.parentThreadId?.trim();
    if (!parentId || parentId === thread.id) {
      continue;
    }
    if (nextThreadParentById[thread.id] === parentId) {
      continue;
    }
    if (!parentMapChanged) {
      nextThreadParentById = { ...state.threadParentById };
      parentMapChanged = true;
    }
    nextThreadParentById[thread.id] = parentId;
  }
  return {
    ...state,
    threadsByWorkspace: {
      ...state.threadsByWorkspace,
      [action.workspaceId]: mergedVisibleThreads,
    },
    ...(parentMapChanged ? { threadParentById: nextThreadParentById } : {}),
  };
}
