import type {
  ConversationItem,
  ThreadTokenUsage,
} from "../../../types";
import type { SidebarSnapshot } from "../utils/sidebarSnapshot";
import {
  MAX_ITEM_TEXT,
  normalizeItem,
  prepareThreadItems,
  rebalanceTrailingToolsBeforeFinalAssistants,
  __getPrepareThreadItemsCallCountForTests,
  __resetPrepareThreadItemsCallCountForTests,
} from "../../../utils/threadItems";
import { settlePlanInProgressSteps } from "../utils/threadNormalize";
import { mergeTurnTargetBadgesIntoItems } from "../utils/turnTargetBadgeStorage";
import {
  clearBackgroundTasks,
  renameBackgroundTasksForThread,
} from "../../messages/utils/backgroundTaskStore";
import { isMultiAgentHistFoldItemId } from "../../multi-agent/utils/canvasItems";
import {
  isIncrementalDerivationEnabled,
  isReducerNoopGuardEnabled,
} from "../utils/realtimePerfFlags";
import { boundToolOutput } from "../utils/boundToolOutput";
import {
  findReasoningIndexById,
  insertLiveReasoningItem,
} from "./threadReducerItemLookup";
import {
  isGeminiReasoningThread,
  isKimiReasoningThread,
  shouldAcceptReasoningDelta,
} from "./threadReducerReasoningGuards";
import { mergeRuntimeReceipt } from "../utils/runtimeModelReceipt";
import {
  addSummaryBoundary,
  mergeReasoningTextForThread,
  mergeStreamingText,
} from "./threadReducerTextMerge";
import {
  isSameRequestUserInput,
  requestUserInputIdentityKey,
} from "../../../utils/requestUserInputIdentity";
import { isUserInputRequestSettled } from "../../../utils/userInputSettlementTombstone";
import {
  isProcessingGeneratedImageItem,
} from "../utils/generatedImagePlaceholder";
import { reduceNormalizedRealtimeEvent } from "./threadReducerNormalizedRealtime";
import { reduceEnsureThread } from "./threadReducerEnsureThread";
import { reduceSetThreads } from "./threadReducerSetThreads";
import { reduceUpsertItem } from "./threadReducerUpsertItem";
import {
  reduceAppendAgentDelta,
  reduceCompleteAgentMessage,
  reduceFlushAgentCompletedBatch,
} from "./threadReducerAgentDelta";
import {
  reduceAppendCodexCompactionMessage,
  reduceAppendContextCompacted,
  reduceDiscardLatestCodexCompactionMessage,
  reduceSettleCodexCompactionMessage,
} from "./threadReducerCodexCompaction";
import { isSameApprovalRequest } from "./threadReducerApprovalRequests";
import {
  stampLatestFinalAssistantTurnTokens,
  withAssistantTurnTokenCounts,
} from "./threadReducerAssistantFinalMetadata";
import { mergeThreadItemsPreservingOptimisticUsers } from "./threadReducerOptimisticItemMerge";
import {
  mergeTurnFinalMetaIntoItems,
  scheduleDeleteTurnFinalMetaForThread,
  schedulePersistTurnFinalMetaFromItems,
  scheduleRenameTurnFinalMetaThreadId,
} from "../utils/turnFinalMetaStorage";
import {
  scheduleTombstoneLocalPendingDraftIndexRow,
  writeRemappedClientSessionIndex,
} from "../../../services/tauri/sessionIndex";
import { shouldFinalizeToolStatus } from "./threadReducerToolStatus";
import {
  maybeRenameThreadFromAgent,
  maybeUpgradeThreadNameFromItemsByThreadId,
} from "./threadReducerThreadNaming";
import {
  isAssistantMessageItem,
  isThreadActiveInState,
  isThreadTokenUsageEqual,
  isToolConversationItem,
  resolveLiveReasoningItemId,
  withThreadStatusDefaults,
} from "./threadReducerCoreHelpers";
import {
  threadActivityStatusEqual,
} from "./threadReducerEqualityGuards";
import type {
  CodexCompactionLifecycleState,
  ThreadAction,
  ThreadState,
} from "./threadReducerTypes";
import {
  renameThreadStateIdentity,
} from "./threadReducerThreadIdentity";
export type { ThreadAction, ThreadState } from "./threadReducerTypes";

const REDUCER_NOOP_GUARD_ENABLED = isReducerNoopGuardEnabled();
const INCREMENTAL_DERIVATION_ENABLED = isIncrementalDerivationEnabled();

// Continuation evidence arrives once per engine event (heartbeat/delta/item/*)
// via raw dispatch, bypassing the delta batching layers. Consumers only do
// monotonic `>` comparisons on continuationPulse, so per-thread throttling is
// safe and keeps engine progress from forcing app-shell-root re-renders on
// every event.
const CONTINUATION_EVIDENCE_MIN_INTERVAL_MS = 1000;
type ThreadsReducerProfileSnapshot = {
  componentRenderCounts: Record<string, number>;
  prepareThreadItemsCallCount: number;
  reducerDispatchCount: number;
};
const emptyItems: Record<string, ConversationItem[]> = {};
const threadsReducerProfileState = {
  componentRenderCounts: {} as Record<string, number>,
  reducerDispatchCount: 0,
};

export const __profile = {
  recordComponentRender(componentName: string) {
    const normalizedName = componentName.trim();
    if (!normalizedName) {
      return;
    }
    threadsReducerProfileState.componentRenderCounts[normalizedName] =
      (threadsReducerProfileState.componentRenderCounts[normalizedName] ?? 0) + 1;
  },
  reset() {
    threadsReducerProfileState.componentRenderCounts = {};
    threadsReducerProfileState.reducerDispatchCount = 0;
    __resetPrepareThreadItemsCallCountForTests();
  },
  snapshot(): ThreadsReducerProfileSnapshot {
    return {
      componentRenderCounts: {
        ...threadsReducerProfileState.componentRenderCounts,
      },
      prepareThreadItemsCallCount: __getPrepareThreadItemsCallCountForTests(),
      reducerDispatchCount: threadsReducerProfileState.reducerDispatchCount,
    };
  },
};

export const initialState: ThreadState = {
  activeThreadIdByWorkspace: {},
  itemsByThread: emptyItems,
  historyRestoredAtMsByThread: {},
  historyWindowByThread: {},
  threadsByWorkspace: {},
  hiddenThreadIdsByWorkspace: {},
  threadParentById: {},
  threadStatusById: {},
  threadListLoadingByWorkspace: {},
  threadListPagingByWorkspace: {},
  threadListCursorByWorkspace: {},
  activeTurnIdByThread: {},
  codexAcceptedTurnByThread: {},
  approvals: [],
  userInputRequests: [],
  tokenUsageByThread: {},
  rateLimitsByWorkspace: {},
  accountByWorkspace: {},
  planByThread: {},
  lastAgentMessageByThread: {},
  agentSegmentByThread: {},
};

export function createInitialThreadState(snapshot?: SidebarSnapshot | null): ThreadState {
  if (!snapshot) {
    return initialState;
  }
  return {
    ...initialState,
    threadsByWorkspace: snapshot.threadsByWorkspace,
  };
}

export function threadReducer(state: ThreadState, action: ThreadAction): ThreadState {
  threadsReducerProfileState.reducerDispatchCount += 1;
  switch (action.type) {
    case "setActiveThreadId": {
      const currentActiveThreadId =
        state.activeThreadIdByWorkspace[action.workspaceId] ?? null;
      const activeThreadUnchanged = currentActiveThreadId === action.threadId;
      const nextActiveThreadIdByWorkspace = activeThreadUnchanged
        ? state.activeThreadIdByWorkspace
        : {
            ...state.activeThreadIdByWorkspace,
            [action.workspaceId]: action.threadId,
          };
      if (!action.threadId) {
        return activeThreadUnchanged
          ? state
          : {
              ...state,
              activeThreadIdByWorkspace: nextActiveThreadIdByWorkspace,
            };
      }
      const currentStatus = state.threadStatusById[action.threadId];
      const nextStatus = {
        ...withThreadStatusDefaults(currentStatus),
        hasUnread: false,
      };
      const statusUnchanged = threadActivityStatusEqual(
        currentStatus,
        nextStatus,
      );
      if (activeThreadUnchanged && statusUnchanged) {
        return state;
      }
      return {
        ...state,
        activeThreadIdByWorkspace: nextActiveThreadIdByWorkspace,
        threadStatusById: statusUnchanged
          ? state.threadStatusById
          : {
              ...state.threadStatusById,
              [action.threadId]: nextStatus,
            },
      };
    }
    case "ensureThread":
      return reduceEnsureThread(state, action);
    case "hideThread": {
      const hiddenForWorkspace =
        state.hiddenThreadIdsByWorkspace[action.workspaceId] ?? {};
      if (hiddenForWorkspace[action.threadId]) {
        return state;
      }

      const nextHiddenForWorkspace = {
        ...hiddenForWorkspace,
        [action.threadId]: true as const,
      };

      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      const filtered = list.filter((thread) => thread.id !== action.threadId);
      const nextActive =
        state.activeThreadIdByWorkspace[action.workspaceId] === action.threadId
          ? filtered[0]?.id ?? null
          : state.activeThreadIdByWorkspace[action.workspaceId] ?? null;

      return {
        ...state,
        hiddenThreadIdsByWorkspace: {
          ...state.hiddenThreadIdsByWorkspace,
          [action.workspaceId]: nextHiddenForWorkspace,
        },
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: filtered,
        },
        activeThreadIdByWorkspace: {
          ...state.activeThreadIdByWorkspace,
          [action.workspaceId]: nextActive,
        },
      };
    }
    case "removeThread": {
      // 后台任务状态表随线程删除一并清理（幂等）：否则已删线程残留的
      // running 记录会让 sidebar sync 持续向幽灵线程 dispatch、registry
      // watcher 持续探测。queueMicrotask 避免 reducer 执行期同步触发
      // 外部 store 订阅（StrictMode 双调用下重复 clear 也无副作用）。
      queueMicrotask(() => {
        clearBackgroundTasks(action.workspaceId, action.threadId);
      });
      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      const filtered = list.filter((thread) => thread.id !== action.threadId);
      const nextActive =
        state.activeThreadIdByWorkspace[action.workspaceId] === action.threadId
          ? filtered[0]?.id ?? null
          : state.activeThreadIdByWorkspace[action.workspaceId] ?? null;
      scheduleDeleteTurnFinalMetaForThread(action.threadId);
      const { [action.threadId]: _items, ...restItems } = state.itemsByThread;
      const { [action.threadId]: _historyRestoredAt, ...restHistoryRestoredAt } =
        state.historyRestoredAtMsByThread;
      const { [action.threadId]: _historyWindow, ...restHistoryWindow } =
        state.historyWindowByThread;
      const { [action.threadId]: _status, ...restStatus } = state.threadStatusById;
      const { [action.threadId]: _turns, ...restTurns } = state.activeTurnIdByThread;
      const { [action.threadId]: _codexAcceptedTurn, ...restCodexAcceptedTurn } =
        state.codexAcceptedTurnByThread;
      const { [action.threadId]: _plans, ...restPlans } = state.planByThread;
      const { [action.threadId]: _parents, ...restParents } = state.threadParentById;
      const { [action.threadId]: _tokenUsage, ...restTokenUsage } = state.tokenUsageByThread;
      const { [action.threadId]: _lastAgent, ...restLastAgent } = state.lastAgentMessageByThread;
      const { [action.threadId]: _segments, ...restSegments } = state.agentSegmentByThread;
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: filtered,
        },
        itemsByThread: restItems,
        historyRestoredAtMsByThread: restHistoryRestoredAt,
        historyWindowByThread: restHistoryWindow,
        threadStatusById: restStatus,
        activeTurnIdByThread: restTurns,
        codexAcceptedTurnByThread: restCodexAcceptedTurn,
        planByThread: restPlans,
        threadParentById: restParents,
        tokenUsageByThread: restTokenUsage,
        lastAgentMessageByThread: restLastAgent,
        agentSegmentByThread: restSegments,
        activeThreadIdByWorkspace: {
          ...state.activeThreadIdByWorkspace,
          [action.workspaceId]: nextActive,
        },
      };
    }
    case "evictThreadItems": {
      if (!action.threadIds.length) {
        return state;
      }
      const nextItemsByThread = { ...state.itemsByThread };
      let didChange = false;
      action.threadIds.forEach((threadId) => {
        if (!(threadId in nextItemsByThread)) {
          return;
        }
        delete nextItemsByThread[threadId];
        didChange = true;
      });
      if (!didChange) {
        return state;
      }
      return {
        ...state,
        itemsByThread: nextItemsByThread,
      };
    }
    case "setThreadParent": {
      if (!action.parentId || action.parentId === action.threadId) {
        return state;
      }
      if (state.threadParentById[action.threadId] === action.parentId) {
        return state;
      }
      return {
        ...state,
        threadParentById: {
          ...state.threadParentById,
          [action.threadId]: action.parentId,
        },
      };
    }
    case "markProcessing": {
      const previous = state.threadStatusById[action.threadId];
      const wasProcessing = previous?.isProcessing ?? false;
      const startedAt = previous?.processingStartedAt ?? null;
      const lastDurationMs = previous?.lastDurationMs ?? null;
      const heartbeatPulse = previous?.heartbeatPulse ?? 0;
      const continuationPulse = previous?.continuationPulse ?? 0;
      const terminalPulse = previous?.terminalPulse ?? 0;
      const compactionSource = previous?.codexCompactionSource ?? null;
      const compactionLifecycleState =
        previous?.codexCompactionLifecycleState ?? "idle";
      const compactionCompletedAt =
        previous?.codexCompactionCompletedAt ?? null;
      const lastTokenUsageUpdatedAt =
        previous?.lastTokenUsageUpdatedAt ?? null;
      const codexSilentSuspectedAt =
        previous?.codexSilentSuspectedAt ?? null;
      const codexSilentSuspectedSource =
        previous?.codexSilentSuspectedSource ?? null;
      if (action.isProcessing) {
        if (REDUCER_NOOP_GUARD_ENABLED && wasProcessing) {
          return state;
        }
        return {
          ...state,
          threadStatusById: {
            ...state.threadStatusById,
            [action.threadId]: {
              isProcessing: true,
              hasUnread: previous?.hasUnread ?? false,
              isReviewing: previous?.isReviewing ?? false,
              isContextCompacting: previous?.isContextCompacting ?? false,
              backgroundTaskRunningCount:
                previous?.backgroundTaskRunningCount ?? 0,
              processingStartedAt:
                wasProcessing && startedAt ? startedAt : action.timestamp,
              lastDurationMs,
              heartbeatPulse: wasProcessing ? heartbeatPulse : 0,
              continuationPulse,
              terminalPulse,
              codexCompactionSource: compactionSource,
              codexCompactionLifecycleState: compactionLifecycleState,
              codexCompactionCompletedAt: compactionCompletedAt,
              lastTokenUsageUpdatedAt,
              codexSilentSuspectedAt,
              codexSilentSuspectedSource,
            },
          },
        };
      }
      if (
        REDUCER_NOOP_GUARD_ENABLED &&
        (!previous ||
          (!wasProcessing &&
            previous.processingStartedAt == null &&
            (previous.heartbeatPulse ?? 0) === 0))
      ) {
        return state;
      }
      const nextDuration =
        wasProcessing && startedAt
          ? Math.max(0, action.timestamp - startedAt)
          : lastDurationMs ?? null;
      // Background completion: when a live turn settles while the user is not
      // viewing this thread, mark unread so the sidebar can show the green "done"
      // dot. Active-thread settles stay clean (no green). Rely on reducer state
      // rather than agent-message paths, which often miss this transition.
      const settledWhileAway =
        wasProcessing &&
        !isThreadActiveInState(state.activeThreadIdByWorkspace, action.threadId);
      const nextHasUnread = settledWhileAway
        ? true
        : (previous?.hasUnread ?? false);
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            isProcessing: false,
            hasUnread: nextHasUnread,
            isReviewing: previous?.isReviewing ?? false,
            isContextCompacting: previous?.isContextCompacting ?? false,
            backgroundTaskRunningCount:
              previous?.backgroundTaskRunningCount ?? 0,
            processingStartedAt: null,
            lastDurationMs: nextDuration,
            heartbeatPulse: 0,
            continuationPulse,
            terminalPulse,
            codexCompactionSource: compactionSource,
            codexCompactionLifecycleState: compactionLifecycleState,
            codexCompactionCompletedAt: compactionCompletedAt,
            lastTokenUsageUpdatedAt,
            codexSilentSuspectedAt: null,
            codexSilentSuspectedSource: null,
          },
        },
      };
    }
    case "markContextCompacting": {
      const previous = state.threadStatusById[action.threadId];
      const currentIsCompacting = previous?.isContextCompacting ?? false;
      const actionTimestamp =
        typeof action.timestamp === "number" && Number.isFinite(action.timestamp)
          ? action.timestamp
          : null;
      const previousSource = previous?.codexCompactionSource ?? null;
      const previousLifecycleState =
        previous?.codexCompactionLifecycleState ?? "idle";
      const nextLifecycleState: CodexCompactionLifecycleState = action.isCompacting
        ? "compacting"
        : action.completionStatus === "completed"
          ? "completed"
          : previousLifecycleState === "completed"
            ? "completed"
          : "idle";
      const nextSource =
        action.source !== undefined
          ? action.source
          : nextLifecycleState === "completed" &&
              previousLifecycleState !== "idle"
            ? previousSource
            : null;
      if (
        currentIsCompacting === action.isCompacting &&
        previousLifecycleState === nextLifecycleState &&
        previousSource === nextSource
      ) {
        return state;
      }
      const startedAt = previous?.processingStartedAt ?? null;
      const nextStartedAt = action.isCompacting
        ? (startedAt ?? actionTimestamp ?? Date.now())
        : (previous?.isProcessing ?? false ? startedAt : null);
      const nextDuration = !action.isCompacting && currentIsCompacting
        ? (startedAt || actionTimestamp)
          ? Math.max(
              0,
              (actionTimestamp ?? Date.now()) - (startedAt ?? actionTimestamp ?? Date.now()),
            )
          : previous?.lastDurationMs ?? null
        : previous?.lastDurationMs ?? null;
      const nextCompletedAt = nextLifecycleState === "completed"
        ? (actionTimestamp ?? Date.now())
        : null;
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            isProcessing: previous?.isProcessing ?? false,
            hasUnread: previous?.hasUnread ?? false,
            isReviewing: previous?.isReviewing ?? false,
            isContextCompacting: action.isCompacting,
            backgroundTaskRunningCount:
              previous?.backgroundTaskRunningCount ?? 0,
            processingStartedAt: nextStartedAt,
            lastDurationMs: nextDuration,
            heartbeatPulse: previous?.heartbeatPulse ?? 0,
            continuationPulse: previous?.continuationPulse ?? 0,
            terminalPulse: previous?.terminalPulse ?? 0,
            codexCompactionSource: nextSource,
            codexCompactionLifecycleState: nextLifecycleState,
            codexCompactionCompletedAt: nextCompletedAt,
            lastTokenUsageUpdatedAt:
              previous?.lastTokenUsageUpdatedAt ?? null,
            codexSilentSuspectedAt:
              previous?.codexSilentSuspectedAt ?? null,
            codexSilentSuspectedSource:
              previous?.codexSilentSuspectedSource ?? null,
          },
        },
      };
    }
    case "markHeartbeat": {
      const previous = state.threadStatusById[action.threadId];
      if (!previous?.isProcessing) {
        return state;
      }
      if (action.pulse <= 0 || action.pulse <= (previous.heartbeatPulse ?? 0)) {
        return state;
      }
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            ...previous,
            heartbeatPulse: action.pulse,
          },
        },
      };
    }
    case "markContinuationEvidence": {
      const previous = state.threadStatusById[action.threadId];
      if (!action.force) {
        if (!previous?.isProcessing) {
          return state;
        }
        const lastAt = previous.lastContinuationEvidenceAtMs ?? 0;
        if (action.at - lastAt < CONTINUATION_EVIDENCE_MIN_INTERVAL_MS) {
          return state;
        }
      }
      const nextPulse = (previous?.continuationPulse ?? 0) + 1;
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            ...withThreadStatusDefaults(previous),
            continuationPulse: nextPulse,
            lastContinuationEvidenceAtMs: action.at,
          },
        },
      };
    }
    case "markTerminalSettlement": {
      const previous = state.threadStatusById[action.threadId];
      const nextPulse = (previous?.terminalPulse ?? 0) + 1;
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            ...withThreadStatusDefaults(previous),
            terminalPulse: nextPulse,
            codexSilentSuspectedAt: null,
            codexSilentSuspectedSource: null,
          },
        },
      };
    }
    case "markCodexSilentSuspected": {
      const previous = withThreadStatusDefaults(
        state.threadStatusById[action.threadId],
      );
      if (
        previous.codexSilentSuspectedAt === action.timestamp &&
        previous.codexSilentSuspectedSource === action.source
      ) {
        return state;
      }
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            ...previous,
            codexSilentSuspectedAt: action.timestamp,
            codexSilentSuspectedSource: action.source,
          },
        },
      };
    }
    case "clearCodexSilentSuspected": {
      const previous = state.threadStatusById[action.threadId];
      if (
        !previous ||
        (previous.codexSilentSuspectedAt == null &&
          previous.codexSilentSuspectedSource == null)
      ) {
        return state;
      }
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            ...withThreadStatusDefaults(previous),
            codexSilentSuspectedAt: null,
            codexSilentSuspectedSource: null,
          },
        },
      };
    }
    case "finalizePendingToolStatuses": {
      const list = state.itemsByThread[action.threadId] ?? [];
      let didChange = false;

      const nextItems = list.map((item) => {
        if (item.kind !== "tool") {
          return item;
        }

        if (shouldFinalizeToolStatus(item.status)) {
          didChange = true;
          return {
            ...item,
            status: action.status,
          };
        }

        return item;
      });

      if (!didChange) {
        return state;
      }

      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(nextItems),
        },
      };
    }
    case "setActiveTurnId":
      return {
        ...state,
        activeTurnIdByThread: {
          ...state.activeTurnIdByThread,
          [action.threadId]: action.turnId,
        },
      };
    case "markCodexAcceptedTurn": {
      const previous = state.codexAcceptedTurnByThread[action.threadId];
      if (
        previous?.fact === "accepted" &&
        action.fact !== "accepted"
      ) {
        return state;
      }
      if (
        previous?.fact === action.fact &&
        previous.source === action.source
      ) {
        return state;
      }
      return {
        ...state,
        codexAcceptedTurnByThread: {
          ...state.codexAcceptedTurnByThread,
          [action.threadId]: {
            fact: action.fact,
            source: action.source,
            updatedAt: action.timestamp,
          },
        },
      };
    }
    case "markReviewing":
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            ...withThreadStatusDefaults(
              state.threadStatusById[action.threadId],
            ),
            isReviewing: action.isReviewing,
          },
        },
      };
    case "markUnread":
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            ...withThreadStatusDefaults(
              state.threadStatusById[action.threadId],
            ),
            hasUnread: action.hasUnread,
          },
        },
      };
    case "markBackgroundTaskActivity": {
      const previous = state.threadStatusById[action.threadId];
      const previousCount = previous?.backgroundTaskRunningCount ?? 0;
      // 0 跨越收口：最后一个后台任务转终态且用户不在该会话 → 标 unread
      // （对齐 markProcessing 非活跃结算语义）；活跃线程只熄灯，靠时间线
      // 活体卡原地折叠表达完成。
      const crossedToZeroWhileAway =
        previousCount > 0 &&
        action.runningCount === 0 &&
        !isThreadActiveInState(
          state.activeThreadIdByWorkspace,
          action.threadId,
          action.workspaceId,
        );
      const nextHasUnread = crossedToZeroWhileAway
        ? true
        : (previous?.hasUnread ?? false);
      if (
        previousCount === action.runningCount &&
        (previous?.hasUnread ?? false) === nextHasUnread
      ) {
        return state;
      }
      return {
        ...state,
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            ...withThreadStatusDefaults(previous),
            backgroundTaskRunningCount: action.runningCount,
            hasUnread: nextHasUnread,
          },
        },
      };
    }
    case "addAssistantMessage": {
      const list = state.itemsByThread[action.threadId] ?? [];
      const message: ConversationItem = {
        id: `${Date.now()}-assistant`,
        kind: "message",
        role: "assistant",
        text: action.text,
        ...(action.executionTargetSnapshot
          ? { executionTargetSnapshot: action.executionTargetSnapshot }
          : {}),
      };
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems([...list, message]),
        },
      };
    }
    case "patchAssistantRuntimeReceipt": {
      const receipt = action.runtimeReceipt;
      if (!receipt?.model) {
        return state;
      }
      const list = state.itemsByThread[action.threadId] ?? [];
      let lastUserIndex = -1;
      for (let index = list.length - 1; index >= 0; index -= 1) {
        const item = list[index];
        if (item?.kind === "message" && item.role === "user") {
          lastUserIndex = index;
          break;
        }
      }
      let targetIndex = -1;
      for (let index = list.length - 1; index > lastUserIndex; index -= 1) {
        const item = list[index];
        if (item?.kind !== "message" || item.role !== "assistant") {
          continue;
        }
        if (item.id.startsWith("memory-pick-empty-")) {
          continue;
        }
        if (!item.executionTargetSnapshot && !item.runtimeReceipt) {
          continue;
        }
        targetIndex = index;
        break;
      }
      if (targetIndex < 0) {
        return state;
      }
      const target = list[targetIndex];
      if (!target || target.kind !== "message") {
        return state;
      }
      const existing = target.runtimeReceipt;
      const merged = mergeRuntimeReceipt(existing, receipt);
      if (
        !merged ||
        (existing &&
          existing.model === merged.model &&
          existing.modelSource === merged.modelSource &&
          existing.contextWindowTokens === merged.contextWindowTokens &&
          existing.contextWindowSource === merged.contextWindowSource)
      ) {
        return state;
      }
      const next = [...list];
      next[targetIndex] = {
        ...target,
        runtimeReceipt: merged,
      };
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(next),
        },
      };
    }
    case "setThreadName": {
      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      const next = list.map((thread) =>
        thread.id === action.threadId ? { ...thread, name: action.name } : thread,
      );
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: next,
        },
      };
    }
    case "setThreadEngine": {
      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      const next = list.map((thread) =>
        thread.id === action.threadId
          ? {
              ...thread,
              engineSource: action.engine,
              ...(thread.threadKind === "shared"
                ? { selectedEngine: action.engine }
                : {}),
            }
          : thread,
      );
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: next,
        },
      };
    }
    case "setThreadDshAgentPreset": {
      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      const preset = action.dshAgentPreset?.trim() || null;
      let changed = false;
      const next = list.map((thread) => {
        if (thread.id !== action.threadId) {
          return thread;
        }
        const current = thread.dshAgentPreset?.trim() || null;
        if (current === preset || (!preset && current)) {
          return thread;
        }
        changed = true;
        return { ...thread, dshAgentPreset: preset };
      });
      if (!changed) {
        return state;
      }
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: next,
        },
      };
    }
    case "setThreadTimestamp": {
      const list = state.threadsByWorkspace[action.workspaceId] ?? [];
      if (!list.length) {
        return state;
      }
      let didChange = false;
      const next = list.map((thread) => {
        if (thread.id !== action.threadId) {
          return thread;
        }
        const current = thread.updatedAt ?? 0;
        if (current >= action.timestamp) {
          return thread;
        }
        didChange = true;
        return { ...thread, updatedAt: action.timestamp };
      });
      if (!didChange) {
        return state;
      }
      return {
        ...state,
        threadsByWorkspace: {
          ...state.threadsByWorkspace,
          [action.workspaceId]: next,
        },
      };
    }
    case "appendAgentDelta":
      return reduceAppendAgentDelta(state, action);
    case "completeAgentMessage":
      return reduceCompleteAgentMessage(state, action);
    case "flushAgentCompletedBatch":
      return reduceFlushAgentCompletedBatch(state, action);
    case "upsertItem":
      return reduceUpsertItem(state, action);
    case "applyNormalizedRealtimeEvent":
      return reduceNormalizedRealtimeEvent(
        state,
        action,
        maybeRenameThreadFromAgent,
      );
    case "clearProcessingGeneratedImages": {
      const list = state.itemsByThread[action.threadId] ?? [];
      const filtered = list.filter(
        (item) => !isProcessingGeneratedImageItem(item),
      );
      if (filtered.length === list.length) {
        return state;
      }
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(filtered),
        },
      };
    }
    case "setThreadHistoryWindow": {
      const previous = state.historyWindowByThread[action.threadId];
      if (
        previous?.hasMore === action.hasMore &&
        (previous?.nextCursor ?? null) === (action.nextCursor ?? null)
      ) {
        return state;
      }
      return {
        ...state,
        historyWindowByThread: {
          ...state.historyWindowByThread,
          [action.threadId]: {
            hasMore: action.hasMore,
            nextCursor: action.nextCursor,
          },
        },
      };
    }
    case "prependThreadItems": {
      const existing = state.itemsByThread[action.threadId] ?? [];
      const existingIds = new Set(existing.map((item) => item.id));
      const older = action.items.filter((item) => !existingIds.has(item.id));
      if (older.length === 0) {
        return state;
      }
      const prependedItems = prepareThreadItems([...older, ...existing]);
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prependedItems,
        },
        threadsByWorkspace: maybeUpgradeThreadNameFromItemsByThreadId({
          threadId: action.threadId,
          items: prependedItems,
          threadsByWorkspace: state.threadsByWorkspace,
        }),
      };
    }
    case "setThreadItems": {
      const localItems = state.itemsByThread[action.threadId] ?? [];
      const mergedItems = mergeThreadItemsPreservingOptimisticUsers(
        localItems,
        action.items,
        {
          isProcessing: Boolean(state.threadStatusById[action.threadId]?.isProcessing),
          codexCompactionLifecycleState:
            state.threadStatusById[action.threadId]?.codexCompactionLifecycleState ??
            "idle",
        },
      );
      // Multi-Agent fold 卡是 bridge-only 项（后端投影不产出），历史重建时随本地保留，
      // 否则「对话结束后协作卡丢失」。位置纠偏由幕布 filter 的 relocate 承担。
      const incomingIds = new Set(mergedItems.map((item) => item.id));
      const preservedFoldItems = localItems.filter(
        (item) =>
          item.kind === "message" &&
          isMultiAgentHistFoldItemId(item.id) &&
          !incomingIds.has(item.id),
      );
      const mergedWithFolds =
        preservedFoldItems.length > 0
          ? [...mergedItems, ...preservedFoldItems]
          : mergedItems;
      // Cold reload / history path: fill missing final footer meta from local sidecar.
      const itemsWithSidecarMeta = mergeTurnTargetBadgesIntoItems(
        action.threadId,
        mergeTurnFinalMetaIntoItems(
          action.threadId,
          mergedWithFolds,
        ),
      );
      const preserveMessageTextIds = new Set<string>();
      for (const item of itemsWithSidecarMeta) {
        if (
          item.kind === "message" &&
          item.role === "assistant" &&
          item.text.length > MAX_ITEM_TEXT
        ) {
          preserveMessageTextIds.add(item.id);
        }
      }
      const preparedItems = prepareThreadItems(itemsWithSidecarMeta, {
        preserveMessageTextIds,
      });
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: preparedItems,
        },
        threadsByWorkspace: maybeUpgradeThreadNameFromItemsByThreadId({
          threadId: action.threadId,
          items: preparedItems,
          threadsByWorkspace: state.threadsByWorkspace,
        }),
      };
    }
    case "setThreadHistoryRestoredAt": {
      const previousTimestamp =
        state.historyRestoredAtMsByThread[action.threadId] ?? null;
      if (previousTimestamp === action.timestamp) {
        return state;
      }
      return {
        ...state,
        historyRestoredAtMsByThread: {
          ...state.historyRestoredAtMsByThread,
          [action.threadId]: action.timestamp,
        },
      };
    }
    case "markLatestAssistantMessageFinal": {
      const list = state.itemsByThread[action.threadId] ?? [];
      if (list.length === 0) {
        return state;
      }
      let latestAssistantIndex = -1;
      for (let index = list.length - 1; index >= 0; index -= 1) {
        const item = list[index];
        if (isAssistantMessageItem(item)) {
          latestAssistantIndex = index;
          break;
        }
      }
      if (latestAssistantIndex < 0) {
        return state;
      }
      const latestAssistant = list[latestAssistantIndex];
      if (!isAssistantMessageItem(latestAssistant)) {
        return state;
      }
      const completedAt =
        latestAssistant.finalCompletedAt ??
        Date.now();
      const status = state.threadStatusById[action.threadId];
      const statusDuration =
        typeof status?.lastDurationMs === "number"
          ? Math.max(0, status.lastDurationMs)
          : null;
      const derivedDuration =
        statusDuration !== null
          ? statusDuration
          : status?.processingStartedAt
            ? Math.max(0, completedAt - status.processingStartedAt)
            : null;
      const durationMs =
        typeof latestAssistant.finalDurationMs === "number"
          ? Math.max(0, latestAssistant.finalDurationMs)
          : derivedDuration;
      const withTokens = withAssistantTurnTokenCounts(
        {
          ...latestAssistant,
          isFinal: true,
          finalCompletedAt: completedAt,
          ...(durationMs !== null ? { finalDurationMs: durationMs } : {}),
        },
        state.tokenUsageByThread[action.threadId],
      );
      const shouldUpdate =
        latestAssistant.isFinal !== true ||
        latestAssistant.finalCompletedAt !== completedAt ||
        latestAssistant.finalDurationMs !== durationMs ||
        latestAssistant.finalInputTokens !== withTokens.finalInputTokens ||
        latestAssistant.finalOutputTokens !== withTokens.finalOutputTokens;
      const next = [...list];
      next[latestAssistantIndex] = withTokens;
      // Late tools may have been appended while this bubble was still non-final
      // (Grok bridge). After isFinal, pull trailing tools before the conclusion.
      const finalizedItems = rebalanceTrailingToolsBeforeFinalAssistants(next);
      const orderChanged = finalizedItems !== next;
      if (!shouldUpdate && !orderChanged) {
        // rebalance may return a new array even when order is unchanged — compare ids.
        const sameOrder =
          finalizedItems.length === list.length &&
          finalizedItems.every((item, index) => item.id === list[index]?.id);
        if (sameOrder) {
          return state;
        }
      }
      schedulePersistTurnFinalMetaFromItems(action.threadId, finalizedItems);
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: finalizedItems,
        },
      };
    }
    case "setLastAgentMessage":
      if (
        state.lastAgentMessageByThread[action.threadId] &&
        state.lastAgentMessageByThread[action.threadId]!.timestamp >= action.timestamp
      ) {
        return state;
      }
      return {
        ...state,
        lastAgentMessageByThread: {
          ...state.lastAgentMessageByThread,
          [action.threadId]: { text: action.text, timestamp: action.timestamp },
        },
      };
    case "renameThreadId": {
      const { workspaceId, oldThreadId, newThreadId } = action;
      scheduleRenameTurnFinalMetaThreadId(oldThreadId, newThreadId);
      scheduleTombstoneLocalPendingDraftIndexRow(oldThreadId);
      // 后台任务表随迁（同 pending-rename 分支）：store key 是 threadId。
      renameBackgroundTasksForThread(workspaceId, oldThreadId, newThreadId);
      const renamedThread = (state.threadsByWorkspace[workspaceId] ?? []).find(
        (thread) => thread.id === oldThreadId,
      );
      writeRemappedClientSessionIndex({
        workspaceId,
        threadId: newThreadId,
        engine: renamedThread?.engineSource,
        providerProfileId: renamedThread?.providerProfileId,
        providerProfileName: renamedThread?.providerProfileName,
      });
      return renameThreadStateIdentity({
        state,
        workspaceId,
        oldThreadId,
        newThreadId,
      });
    }
    case "appendReasoningSummary": {
      if (!shouldAcceptReasoningDelta(state, action.threadId)) {
        return state;
      }
      const shouldInsertBeforeAssistant =
        (isGeminiReasoningThread(action.threadId) ||
          isKimiReasoningThread(action.threadId)) &&
        !state.threadStatusById[action.threadId]?.isProcessing &&
        (state.activeTurnIdByThread[action.threadId] ?? null) === null;
      const segmentedReasoningId = resolveLiveReasoningItemId(
        state,
        action.threadId,
        action.itemId,
      );
      const list = state.itemsByThread[action.threadId] ?? [];
      const index = findReasoningIndexById(list, segmentedReasoningId);
      const base =
        index >= 0
          ? (list[index] as ConversationItem)
          : {
              id: segmentedReasoningId,
              kind: "reasoning",
              summary: "",
              content: "",
            };
      const nextSummary = mergeReasoningTextForThread(
        action.threadId,
        "summary" in base ? base.summary : "",
        action.delta,
      );
      if (
        INCREMENTAL_DERIVATION_ENABLED &&
        index >= 0 &&
        "summary" in base &&
        nextSummary === base.summary
      ) {
        return state;
      }
      const updated: ConversationItem = {
        ...base,
        summary: nextSummary,
      } as ConversationItem;
      if (INCREMENTAL_DERIVATION_ENABLED && index >= 0) {
        const next = [...list];
        next[index] = normalizeItem(updated);
        return {
          ...state,
          itemsByThread: {
            ...state.itemsByThread,
            [action.threadId]: next,
          },
        };
      }
      const next = insertLiveReasoningItem(
        list,
        index,
        updated,
        shouldInsertBeforeAssistant,
      );
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(next),
        },
      };
    }
    case "appendReasoningSummaryBoundary": {
      if (!shouldAcceptReasoningDelta(state, action.threadId)) {
        return state;
      }
      const shouldInsertBeforeAssistant =
        (isGeminiReasoningThread(action.threadId) ||
          isKimiReasoningThread(action.threadId)) &&
        !state.threadStatusById[action.threadId]?.isProcessing &&
        (state.activeTurnIdByThread[action.threadId] ?? null) === null;
      const segmentedReasoningId = resolveLiveReasoningItemId(
        state,
        action.threadId,
        action.itemId,
      );
      const list = state.itemsByThread[action.threadId] ?? [];
      const index = findReasoningIndexById(list, segmentedReasoningId);
      const base =
        index >= 0
          ? (list[index] as ConversationItem)
          : {
              id: segmentedReasoningId,
              kind: "reasoning",
              summary: "",
              content: "",
            };
      const nextSummary = addSummaryBoundary("summary" in base ? base.summary : "");
      if (
        INCREMENTAL_DERIVATION_ENABLED &&
        index >= 0 &&
        "summary" in base &&
        nextSummary === base.summary
      ) {
        return state;
      }
      const updated: ConversationItem = {
        ...base,
        summary: nextSummary,
      } as ConversationItem;
      if (INCREMENTAL_DERIVATION_ENABLED && index >= 0) {
        const next = [...list];
        next[index] = normalizeItem(updated);
        return {
          ...state,
          itemsByThread: {
            ...state.itemsByThread,
            [action.threadId]: next,
          },
        };
      }
      const next = insertLiveReasoningItem(
        list,
        index,
        updated,
        shouldInsertBeforeAssistant,
      );
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(next),
        },
      };
    }
    case "appendContextCompacted":
      return reduceAppendContextCompacted(state, action);
    case "settleCodexCompactionMessage":
      return reduceSettleCodexCompactionMessage(state, action);
    case "appendCodexCompactionMessage":
      return reduceAppendCodexCompactionMessage(state, action);
    case "discardLatestCodexCompactionMessage":
      return reduceDiscardLatestCodexCompactionMessage(state, action);
    case "appendReasoningContent": {
      if (!shouldAcceptReasoningDelta(state, action.threadId)) {
        return state;
      }
      const shouldInsertBeforeAssistant =
        (isGeminiReasoningThread(action.threadId) ||
          isKimiReasoningThread(action.threadId)) &&
        !state.threadStatusById[action.threadId]?.isProcessing &&
        (state.activeTurnIdByThread[action.threadId] ?? null) === null;
      const segmentedReasoningId = resolveLiveReasoningItemId(
        state,
        action.threadId,
        action.itemId,
      );
      const list = state.itemsByThread[action.threadId] ?? [];
      const index = findReasoningIndexById(list, segmentedReasoningId);
      const base =
        index >= 0
          ? (list[index] as ConversationItem)
          : {
              id: segmentedReasoningId,
              kind: "reasoning",
              summary: "",
              content: "",
            };
      const nextContent = mergeReasoningTextForThread(
        action.threadId,
        "content" in base ? base.content : "",
        action.delta,
      );
      if (
        INCREMENTAL_DERIVATION_ENABLED &&
        index >= 0 &&
        "content" in base &&
        nextContent === base.content
      ) {
        return state;
      }
      const updated: ConversationItem = {
        ...base,
        content: nextContent,
      } as ConversationItem;
      if (INCREMENTAL_DERIVATION_ENABLED && index >= 0) {
        const next = [...list];
        next[index] = normalizeItem(updated);
        return {
          ...state,
          itemsByThread: {
            ...state.itemsByThread,
            [action.threadId]: next,
          },
        };
      }
      const next = insertLiveReasoningItem(
        list,
        index,
        updated,
        shouldInsertBeforeAssistant,
      );
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(next),
        },
      };
    }
    case "dropReasoningItems": {
      const list = state.itemsByThread[action.threadId] ?? [];
      const filtered = list.filter((item) => item.kind !== "reasoning");
      if (filtered.length === list.length) {
        return state;
      }
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(filtered),
        },
      };
    }
    case "appendToolOutput": {
      const list = state.itemsByThread[action.threadId] ?? [];
      // 流式中的工具输出项几乎总在尾部，从尾扫描与 findAssistantMessageIndexById 一致。
      let index = -1;
      for (let cursor = list.length - 1; cursor >= 0; cursor -= 1) {
        if (list[cursor]?.id === action.itemId) {
          index = cursor;
          break;
        }
      }
      if (index < 0) {
        const placeholder: ConversationItem = {
          id: action.itemId,
          kind: "tool",
          toolType: "commandExecution",
          title: "Command",
          detail: "",
          status: "running",
          output: boundToolOutput(action.delta, "commandExecution"),
        };
        return {
          ...state,
          itemsByThread: {
            ...state.itemsByThread,
            [action.threadId]: prepareThreadItems([...list, placeholder]),
          },
        };
      }
      const existing = list[index];
      if (!isToolConversationItem(existing)) {
        return state;
      }
      const nextOutput = boundToolOutput(
        mergeStreamingText(existing.output ?? "", action.delta),
        existing.toolType ?? "commandExecution",
      );
      if (
        INCREMENTAL_DERIVATION_ENABLED &&
        nextOutput === (existing.output ?? "")
      ) {
        return state;
      }
      const updated: ConversationItem = {
        ...existing,
        output: nextOutput,
      } as ConversationItem;
      const next = [...list];
      next[index] = updated;
      if (INCREMENTAL_DERIVATION_ENABLED) {
        return {
          ...state,
          itemsByThread: {
            ...state.itemsByThread,
            [action.threadId]: next,
          },
        };
      }
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: prepareThreadItems(next),
        },
      };
    }
    case "addApproval": {
      const exists = state.approvals.some(
        (item) => isSameApprovalRequest(item, action.approval),
      );
      if (exists) {
        return state;
      }
      return { ...state, approvals: [...state.approvals, action.approval] };
    }
    case "removeApproval":
      return {
        ...state,
        approvals: state.approvals.filter(
          (item) =>
            action.approval
              ? !isSameApprovalRequest(item, action.approval)
              : item.request_id !== action.requestId ||
                item.workspace_id !== action.workspaceId,
        ),
      };
    case "addUserInputRequest": {
      // Gate history reopen / late replay: settled identities must not re-enter the queue.
      if (isUserInputRequestSettled(requestUserInputIdentityKey(action.request))) {
        return state;
      }
      if (action.request.params.completed === true) {
        return state;
      }
      const exists = state.userInputRequests.some(
        (item) => isSameRequestUserInput(item, action.request),
      );
      if (exists) {
        return state;
      }
      return {
        ...state,
        userInputRequests: [...state.userInputRequests, action.request],
      };
    }
    case "removeUserInputRequest":
      return {
        ...state,
        userInputRequests: state.userInputRequests.filter(
          (item) =>
            action.request
              ? !isSameRequestUserInput(item, action.request)
              : action.sharedRuntimeOwner
                ? item.request_id !== action.requestId ||
                  item.workspace_id !== action.workspaceId ||
                  item.shared_runtime_owner?.providerRuntimeKey !==
                    action.sharedRuntimeOwner.providerRuntimeKey ||
                  item.shared_runtime_owner?.attemptId !==
                    action.sharedRuntimeOwner.attemptId
              : item.request_id !== action.requestId ||
                item.workspace_id !== action.workspaceId,
        ),
      };
    case "clearUserInputRequestsForThread":
      return {
        ...state,
        userInputRequests: state.userInputRequests.filter(
          (item) =>
            item.workspace_id !== action.workspaceId ||
            item.params.thread_id !== action.threadId,
        ),
      };
    case "setThreads":
      return reduceSetThreads(state, action);
    case "setThreadListLoading":
      if (
        (state.threadListLoadingByWorkspace[action.workspaceId] ?? false) ===
        action.isLoading
      ) {
        return state;
      }
      return {
        ...state,
        threadListLoadingByWorkspace: {
          ...state.threadListLoadingByWorkspace,
          [action.workspaceId]: action.isLoading,
        },
      };
    case "setThreadListPaging":
      if (
        (state.threadListPagingByWorkspace[action.workspaceId] ?? false) ===
        action.isLoading
      ) {
        return state;
      }
      return {
        ...state,
        threadListPagingByWorkspace: {
          ...state.threadListPagingByWorkspace,
          [action.workspaceId]: action.isLoading,
        },
      };
    case "setThreadListCursor":
      if (
        (state.threadListCursorByWorkspace[action.workspaceId] ?? null) ===
        action.cursor
      ) {
        return state;
      }
      return {
        ...state,
        threadListCursorByWorkspace: {
          ...state.threadListCursorByWorkspace,
          [action.workspaceId]: action.cursor,
        },
      };
    case "setThreadDshTodos": {
      const previousTokenUsage = state.tokenUsageByThread[action.threadId];
      const nextUsage: ThreadTokenUsage = previousTokenUsage
        ? { ...previousTokenUsage, dshTodos: action.todos ?? [] }
        : {
            total: {
              totalTokens: 0,
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
            last: {
              totalTokens: 0,
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
            modelContextWindow: null,
            dshTodos: action.todos ?? [],
          };
      if (isThreadTokenUsageEqual(previousTokenUsage, nextUsage)) {
        return state;
      }
      return {
        ...state,
        tokenUsageByThread: {
          ...state.tokenUsageByThread,
          [action.threadId]: nextUsage,
        },
      };
    }
    case "patchThreadDshContextUsage": {
      const previousTokenUsage = state.tokenUsageByThread[action.threadId];
      const nextUsage: ThreadTokenUsage = previousTokenUsage
        ? { ...previousTokenUsage, ...action.patch }
        : {
            total: {
              totalTokens: 0,
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
            last: {
              totalTokens: 0,
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
            modelContextWindow: action.patch.modelContextWindow ?? null,
            ...action.patch,
          };
      if (isThreadTokenUsageEqual(previousTokenUsage, nextUsage)) {
        return state;
      }
      return {
        ...state,
        tokenUsageByThread: {
          ...state.tokenUsageByThread,
          [action.threadId]: nextUsage,
        },
      };
    }
    case "setThreadSessionStats": {
      const previousTokenUsage = state.tokenUsageByThread[action.threadId];
      const nextUsage: ThreadTokenUsage = previousTokenUsage
        ? { ...previousTokenUsage, sessionStats: action.sessionStats ?? null }
        : {
            total: {
              totalTokens: 0,
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
            last: {
              totalTokens: 0,
              inputTokens: 0,
              cachedInputTokens: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
            },
            modelContextWindow: null,
            sessionStats: action.sessionStats ?? null,
          };
      if (isThreadTokenUsageEqual(previousTokenUsage, nextUsage)) {
        return state;
      }
      return {
        ...state,
        tokenUsageByThread: {
          ...state.tokenUsageByThread,
          [action.threadId]: nextUsage,
        },
      };
    }
    case "hydrateThreadHistorySnapshot": {
      // F4（fix-session-switch-jank-red-lines）：hydrate 元数据合批。递归复用既有
      // case 实现（构造上保证终态与逐个 dispatch bit 级一致），单次状态转移把
      // hydrate 段的 5 个根级 dispatch 收敛为 1 个 commit。
      let next = threadReducer(state, {
        type: "ensureThread",
        workspaceId: action.workspaceId,
        threadId: action.threadId,
        ...(action.engine ? { engine: action.engine } : {}),
      });
      next = threadReducer(next, {
        type: "setThreadPlan",
        threadId: action.threadId,
        plan: action.plan ?? null,
      });
      next = threadReducer(next, {
        type: "setThreadHistoryRestoredAt",
        threadId: action.threadId,
        timestamp: action.historyRestoredAtMs,
      });
      next = threadReducer(next, {
        type: "setThreadHistoryWindow",
        threadId: action.threadId,
        hasMore: action.historyHasMore,
        nextCursor: action.historyNextCursor,
      });
      if (action.tokenUsage) {
        next = threadReducer(next, {
          type: "setThreadTokenUsage",
          threadId: action.threadId,
          tokenUsage: action.tokenUsage,
        });
      }
      return next;
    }
    case "setThreadTokenUsage": {
      const existingStatus = withThreadStatusDefaults(
        state.threadStatusById[action.threadId],
      );
      const previousTokenUsage = state.tokenUsageByThread[action.threadId] ?? null;
      const preserveDshOccupancy =
        previousTokenUsage?.contextUsageSource === "dsh-context-pressure" &&
        action.tokenUsage.contextUsageSource !== "dsh-context-pressure" &&
        action.tokenUsage.contextUsedTokens == null;
      const nextTokenUsage = {
        ...action.tokenUsage,
        sessionStats:
          action.tokenUsage.sessionStats == null && previousTokenUsage?.sessionStats
            ? previousTokenUsage.sessionStats
            : action.tokenUsage.sessionStats,
        cacheWriteInputTokens:
          action.tokenUsage.cacheWriteInputTokens == null &&
          previousTokenUsage?.cacheWriteInputTokens != null
            ? previousTokenUsage.cacheWriteInputTokens
            : action.tokenUsage.cacheWriteInputTokens,
        dshTodos:
          action.tokenUsage.dshTodos == null && previousTokenUsage?.dshTodos != null
            ? previousTokenUsage.dshTodos
            : action.tokenUsage.dshTodos,
        contextUsedTokens: preserveDshOccupancy
          ? previousTokenUsage?.contextUsedTokens
          : action.tokenUsage.contextUsedTokens == null &&
              previousTokenUsage?.contextUsedTokens != null
            ? previousTokenUsage.contextUsedTokens
            : action.tokenUsage.contextUsedTokens,
        modelContextWindow: preserveDshOccupancy
          ? previousTokenUsage?.modelContextWindow ?? null
          : action.tokenUsage.modelContextWindow == null &&
              previousTokenUsage?.modelContextWindow != null
            ? previousTokenUsage.modelContextWindow
            : action.tokenUsage.modelContextWindow,
        contextUsedPercent: preserveDshOccupancy
          ? previousTokenUsage?.contextUsedPercent
          : action.tokenUsage.contextUsedPercent == null &&
              previousTokenUsage?.contextUsedPercent != null
            ? previousTokenUsage.contextUsedPercent
            : action.tokenUsage.contextUsedPercent,
        contextRemainingPercent: preserveDshOccupancy
          ? previousTokenUsage?.contextRemainingPercent
          : action.tokenUsage.contextRemainingPercent == null &&
              previousTokenUsage?.contextRemainingPercent != null
            ? previousTokenUsage.contextRemainingPercent
            : action.tokenUsage.contextRemainingPercent,
        contextCategoryUsages: preserveDshOccupancy
          ? previousTokenUsage?.contextCategoryUsages
          : action.tokenUsage.contextCategoryUsages == null &&
              previousTokenUsage?.contextCategoryUsages != null
            ? previousTokenUsage.contextCategoryUsages
            : action.tokenUsage.contextCategoryUsages,
        contextUsageSource: preserveDshOccupancy
          ? previousTokenUsage?.contextUsageSource
          : action.tokenUsage.contextUsageSource == null &&
              previousTokenUsage?.contextUsageSource
            ? previousTokenUsage.contextUsageSource
            : action.tokenUsage.contextUsageSource,
        contextUsageFreshness: preserveDshOccupancy
          ? previousTokenUsage?.contextUsageFreshness
          : action.tokenUsage.contextUsageFreshness == null &&
              previousTokenUsage?.contextUsageFreshness
            ? previousTokenUsage.contextUsageFreshness
            : action.tokenUsage.contextUsageFreshness,
      };
      const usageSnapshotChanged = !isThreadTokenUsageEqual(
        previousTokenUsage,
        nextTokenUsage,
      );
      const shouldClearCompletedCompaction =
        existingStatus.codexCompactionLifecycleState === "completed" &&
        usageSnapshotChanged;
      const existingItems = state.itemsByThread[action.threadId] ?? [];
      const nextItems = stampLatestFinalAssistantTurnTokens(
        existingItems,
        nextTokenUsage,
      );
      const itemsChanged = nextItems !== existingItems;
      if (!usageSnapshotChanged && !shouldClearCompletedCompaction && !itemsChanged) {
        return state;
      }
      if (itemsChanged) {
        schedulePersistTurnFinalMetaFromItems(action.threadId, nextItems);
      }
      const tokenUsageUpdatedAt = usageSnapshotChanged
        ? Date.now()
        : existingStatus.lastTokenUsageUpdatedAt;
      return {
        ...state,
        tokenUsageByThread: {
          ...state.tokenUsageByThread,
          [action.threadId]: nextTokenUsage,
        },
        ...(itemsChanged
          ? {
              itemsByThread: {
                ...state.itemsByThread,
                [action.threadId]: nextItems,
              },
            }
          : {}),
        threadStatusById: {
          ...state.threadStatusById,
          [action.threadId]: {
            ...existingStatus,
            codexCompactionLifecycleState: shouldClearCompletedCompaction
              ? "idle"
              : existingStatus.codexCompactionLifecycleState,
            codexCompactionSource: shouldClearCompletedCompaction
              ? null
              : existingStatus.codexCompactionSource,
            codexCompactionCompletedAt: shouldClearCompletedCompaction
              ? null
              : existingStatus.codexCompactionCompletedAt,
            lastTokenUsageUpdatedAt: tokenUsageUpdatedAt,
          },
        },
      };
    }
    case "setRateLimits":
      return {
        ...state,
        rateLimitsByWorkspace: {
          ...state.rateLimitsByWorkspace,
          [action.workspaceId]: action.rateLimits,
        },
      };
    case "setAccountInfo":
      return {
        ...state,
        accountByWorkspace: {
          ...state.accountByWorkspace,
          [action.workspaceId]: action.account,
        },
      };
    case "setThreadPlan":
      return {
        ...state,
        planByThread: {
          ...state.planByThread,
          [action.threadId]: action.plan,
        },
      };
    case "settleThreadPlanInProgress": {
      const current = state.planByThread[action.threadId] ?? null;
      const next = settlePlanInProgressSteps(current, action.targetStatus);
      if (next === current) {
        return state;
      }
      return {
        ...state,
        planByThread: {
          ...state.planByThread,
          [action.threadId]: next,
        },
      };
    }
    case "clearThreadPlan":
      return {
        ...state,
        planByThread: {
          ...state.planByThread,
          [action.threadId]: null,
        },
      };
    case "incrementAgentSegment": {
      // 当 tool item 开始时调用，增加分段计数，确保后续文本创建新的 message
      const current = state.agentSegmentByThread[action.threadId] ?? 0;
      return {
        ...state,
        agentSegmentByThread: {
          ...state.agentSegmentByThread,
          [action.threadId]: current + 1,
        },
      };
    }
    case "resetAgentSegment":
      // 当 turn 完成时调用，重置分段计数
      return {
        ...state,
        agentSegmentByThread: {
          ...state.agentSegmentByThread,
          [action.threadId]: 0,
        },
      };
    case "hydrateSidebarSnapshot": {
      const nextThreadsByWorkspace = { ...state.threadsByWorkspace };
      let changed = false;
      for (const [workspaceId, snapshotThreads] of Object.entries(
        action.threadsByWorkspace,
      )) {
        if ((nextThreadsByWorkspace[workspaceId] ?? []).length > 0) {
          continue;
        }
        if (snapshotThreads.length === 0) {
          continue;
        }
        nextThreadsByWorkspace[workspaceId] = snapshotThreads;
        changed = true;
      }
      return changed
        ? {
            ...state,
            threadsByWorkspace: nextThreadsByWorkspace,
          }
        : state;
    }
    default:
      return state;
  }
}


