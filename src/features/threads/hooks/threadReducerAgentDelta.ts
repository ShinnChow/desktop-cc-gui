import type {
  ConversationItem,
  ExecutionTargetSnapshot,
  RuntimeModelReceipt,
} from "../../../types";
import {
  normalizeItem,
  prepareThreadItems,
  rebalanceTrailingToolsBeforeFinalAssistants,
} from "../../../utils/threadItems";
import { isIncrementalDerivationEnabled } from "../utils/realtimePerfFlags";
import { schedulePersistTurnFinalMetaFromItems } from "../utils/turnFinalMetaStorage";
import {
  buildLegacyTextDeltaItemId,
  findAssistantMessageIndexByLegacyTextDelta,
  isLegacyTextDeltaItemId,
} from "./threadReducerItemLookup";
import {
  clearAssistantFinalMetadata,
  shouldPreserveAssistantFinalMetadata,
  withAssistantTurnTokenCounts,
} from "./threadReducerAssistantFinalMetadata";
import {
  canUseLiveAssistantDeltaFastPath,
  findAssistantMessageIndexForLiveSettlement,
  isAssistantMessageItem,
  isThreadActiveInState,
  resolveLiveAssistantMessageId,
  withThreadStatusDefaults,
} from "./threadReducerCoreHelpers";
import {
  isLowRiskStreamingAppendFragmentWithoutBoundary,
  mergeAgentMessageText,
  mergeCompletedAgentText,
} from "./threadReducerTextMerge";
import {
  findEquivalentCodexAssistantMessageIndex,
  shouldDeduplicateCodexAssistantMessages,
} from "./useThreadsReducerAssistantDedup";
import { maybeRenameThreadFromAgent } from "./threadReducerThreadNaming";
import type { ThreadAction, ThreadState } from "./threadReducerTypes";

const INCREMENTAL_DERIVATION_ENABLED = isIncrementalDerivationEnabled();

/**
 * Native turn-target（badge 快照 + 回执）的统一落地规则：仅当 item 缺失时
 * 采纳 incoming，绝不覆盖既有值；无字段可加时保持原引用以便 fast-path
 * 等价短路。action/params 不携带时原样返回。
 */
type TurnBadgeMetadataCarrier = {
  executionTargetSnapshot?: ExecutionTargetSnapshot;
  runtimeReceipt?: RuntimeModelReceipt;
};

function withMissingTurnBadgeMetadata<T extends object>(
  base: T,
  incoming?: TurnBadgeMetadataCarrier,
): T {
  if (!incoming) {
    return base;
  }
  const carrier = base as TurnBadgeMetadataCarrier;
  let patch: Partial<TurnBadgeMetadataCarrier> | null = null;
  if (!carrier.executionTargetSnapshot && incoming.executionTargetSnapshot) {
    patch = { executionTargetSnapshot: incoming.executionTargetSnapshot };
  }
  if (!carrier.runtimeReceipt && incoming.runtimeReceipt) {
    patch = { ...(patch ?? {}), runtimeReceipt: incoming.runtimeReceipt };
  }
  return patch ? ({ ...base, ...patch } as T) : base;
}

export function reduceAppendAgentDelta(
  state: ThreadState,
  action: Extract<ThreadAction, { type: "appendAgentDelta" }>,
): ThreadState {
  const segmentedItemId = resolveLiveAssistantMessageId(
    state,
    action.threadId,
    action.itemId,
  );

  const sourceItems = state.itemsByThread[action.threadId] ?? [];
  // Prefer latest tool-separated segment when resetAgentSegment collapsed
  // resolution back to bare provider itemId (see live settlement helper).
  let index = findAssistantMessageIndexForLiveSettlement(
    sourceItems,
    action.itemId,
    segmentedItemId,
    "append",
  );
  let shouldCanonicalizeLegacyId = false;
  if (index < 0 && !isLegacyTextDeltaItemId(action.threadId, segmentedItemId)) {
    const legacySegmentedItemId = resolveLiveAssistantMessageId(
      state,
      action.threadId,
      buildLegacyTextDeltaItemId(action.threadId),
    );
    index = findAssistantMessageIndexForLiveSettlement(
      sourceItems,
      buildLegacyTextDeltaItemId(action.threadId),
      legacySegmentedItemId,
      "append",
    );
    if (index < 0) {
      index = findAssistantMessageIndexByLegacyTextDelta(
        sourceItems,
        action.threadId,
      );
    }
    shouldCanonicalizeLegacyId = index >= 0;
  }
  // Streaming deltas MUST NOT cross-id glue: short prefixes trip loose
  // areEquivalent (≥8) and can attach a new turn onto the previous bubble
  // when the user row is not yet inserted. Settlement/upsert still converge.
  const shouldDeduplicateCodexAssistant =
    shouldDeduplicateCodexAssistantMessages({
      threadsByWorkspace: state.threadsByWorkspace,
      workspaceId: action.workspaceId,
      threadId: action.threadId,
    });
  if (index < 0 && shouldDeduplicateCodexAssistant) {
    index = findEquivalentCodexAssistantMessageIndex(
      sourceItems,
      action.delta,
      "streaming",
    );
  }
  let list: ConversationItem[];
  if (index >= 0) {
    const existing = sourceItems[index];
    if (!existing || !isAssistantMessageItem(existing)) {
      return state;
    }
    const isThreadProcessing = Boolean(
      state.threadStatusById[action.threadId]?.isProcessing,
    );
    const keepFinalMetadata = shouldPreserveAssistantFinalMetadata(
      existing,
      isThreadProcessing,
    );
    const nextId = shouldCanonicalizeLegacyId ? segmentedItemId : existing.id;
    const nextText = mergeAgentMessageText(existing.text, action.delta);
    if (
      INCREMENTAL_DERIVATION_ENABLED &&
      nextId === existing.id &&
      nextText === existing.text
    ) {
      return state;
    }
    const nextBase = keepFinalMetadata
      ? existing
      : clearAssistantFinalMetadata(existing);
    list = sourceItems.slice();
    list[index] = withMissingTurnBadgeMetadata(
      {
        ...nextBase,
        id: nextId,
        text: nextText,
        isFinal: keepFinalMetadata ? true : false,
      },
      action,
    );
    if (
      canUseLiveAssistantDeltaFastPath({
        threadId: action.threadId,
        list,
        index,
        shouldCanonicalizeLegacyId,
        keepFinalMetadata,
      })
    ) {
      // 低风险追加片段跳过每 delta 的整段归一化扫描（shouldNormalizeAssistantText
      // 对全文做多趟重复检测）；归一化推迟到下一个边界 delta 或收尾快照。
      if (
        !isLowRiskStreamingAppendFragmentWithoutBoundary(
          existing.text,
          action.delta,
        )
      ) {
        list[index] = normalizeItem(list[index], {
          preserveMessageTextLength: true,
        });
      }
      const nextThreadsByWorkspace = maybeRenameThreadFromAgent({
        workspaceId: action.workspaceId,
        threadId: action.threadId,
        items: list,
        itemId: segmentedItemId,
        hasCustomName: action.hasCustomName,
        threadsByWorkspace: state.threadsByWorkspace,
      });
      return {
        ...state,
        itemsByThread: {
          ...state.itemsByThread,
          [action.threadId]: list,
        },
        threadsByWorkspace: nextThreadsByWorkspace,
      };
    }
  } else {
    list = [
      ...sourceItems,
      withMissingTurnBadgeMetadata<ConversationItem>(
        {
          id: segmentedItemId,
          kind: "message",
          role: "assistant",
          text: action.delta,
          isFinal: false,
        },
        action,
      ),
    ];
  }
  const updatedItems = prepareThreadItems(list, {
    preserveMessageTextIds: new Set([segmentedItemId]),
  });
  const nextThreadsByWorkspace = maybeRenameThreadFromAgent({
    workspaceId: action.workspaceId,
    threadId: action.threadId,
    items: updatedItems,
    itemId: segmentedItemId,
    hasCustomName: action.hasCustomName,
    threadsByWorkspace: state.threadsByWorkspace,
  });
  return {
    ...state,
    itemsByThread: {
      ...state.itemsByThread,
      [action.threadId]: updatedItems,
    },
    threadsByWorkspace: nextThreadsByWorkspace,
  };
}

export function reduceCompleteAgentMessage(
  state: ThreadState,
  action: Extract<ThreadAction, { type: "completeAgentMessage" }>,
): ThreadState {
  // §6.1: 代理给 applyCompleteAgentMessageToState, 保证旧调用路径语义不变。
  const applied = applyCompleteAgentMessageToState(state, {
    workspaceId: action.workspaceId,
    threadId: action.threadId,
    itemId: action.itemId,
    text: action.text,
    hasCustomName: action.hasCustomName,
    timestamp: action.timestamp ?? Date.now(),
    executionTargetSnapshot: action.executionTargetSnapshot,
    runtimeReceipt: action.runtimeReceipt,
  });
  if (applied.noop) {
    return state;
  }
  return {
    ...state,
    itemsByThread: applied.itemsByThread,
    threadsByWorkspace: applied.threadsByWorkspace,
  };
}

export function reduceFlushAgentCompletedBatch(
  state: ThreadState,
  action: Extract<ThreadAction, { type: "flushAgentCompletedBatch" }>,
): ThreadState {
  // \u00a76: 1 dispatch \u5408\u5e76 completeAgentMessage + setThreadTimestamp +
  // setLastAgentMessage + (\u6761\u4ef6) markUnread\u3002\u4e0e\u539f\u591a dispatch \u5e8f \u7b49\u4ef7\u3002
  const applied = applyCompleteAgentMessageToState(state, {
    workspaceId: action.workspaceId,
    threadId: action.threadId,
    itemId: action.itemId,
    text: action.text,
    hasCustomName: action.hasCustomName,
    timestamp: action.timestamp,
    executionTargetSnapshot: action.executionTargetSnapshot,
    runtimeReceipt: action.runtimeReceipt,
  });

  // 1) setThreadTimestamp
  const tsList = state.threadsByWorkspace[action.workspaceId] ?? [];
  let tsChanged = applied.threadsByWorkspace !== state.threadsByWorkspace;
  let nextThreadsByWorkspace = applied.threadsByWorkspace;
  if (!applied.noop) {
    if (tsList.length) {
      let tsDidChange = false;
      const tsNext = tsList.map((thread) => {
        if (thread.id !== action.threadId) {
          return thread;
        }
        const current = thread.updatedAt ?? 0;
        if (current >= action.timestamp) {
          return thread;
        }
        tsDidChange = true;
        return { ...thread, updatedAt: action.timestamp };
      });
      if (tsDidChange) {
        tsChanged = true;
        nextThreadsByWorkspace = {
          ...nextThreadsByWorkspace,
          [action.workspaceId]: tsNext,
        };
      }
    }
  }

  // 2) setLastAgentMessage
  const existingLast = state.lastAgentMessageByThread[action.threadId];
  let lastAgentChanged = false;
  let nextLastAgentMessageByThread = state.lastAgentMessageByThread;
  if (!existingLast || existingLast.timestamp < action.timestamp) {
    lastAgentChanged = true;
    nextLastAgentMessageByThread = {
      ...state.lastAgentMessageByThread,
      [action.threadId]: { text: action.text, timestamp: action.timestamp },
    };
  }

  // 3) \u6761\u4ef6 markUnread — reducer active selection is SSOT.
  // Handler isActiveThread can lag after the user switches threads.
  let threadStatusChanged = false;
  let nextThreadStatusById = state.threadStatusById;
  const isActiveInState = isThreadActiveInState(
    state.activeThreadIdByWorkspace,
    action.threadId,
    action.workspaceId,
  );
  if (!isActiveInState) {
    const currentStatus = state.threadStatusById[action.threadId];
    const baseStatus = withThreadStatusDefaults(currentStatus);
    if (!baseStatus.hasUnread) {
      threadStatusChanged = true;
      nextThreadStatusById = {
        ...state.threadStatusById,
        [action.threadId]: { ...baseStatus, hasUnread: true },
      };
    }
  }

  if (applied.noop && !tsChanged && !lastAgentChanged && !threadStatusChanged) {
    return state;
  }

  return {
    ...state,
    itemsByThread: applied.noop ? state.itemsByThread : applied.itemsByThread,
    threadsByWorkspace: nextThreadsByWorkspace,
    lastAgentMessageByThread: nextLastAgentMessageByThread,
    threadStatusById: nextThreadStatusById,
  };
}

/**
 * §6.1: 抽出 `completeAgentMessage` 主体的 state 推导，让 `flushAgentCompletedBatch`
 * 在 1 dispatch 内复用同一段逻辑。返回 `{ itemsByThread, threadsByWorkspace, noop }`：
 *   - `noop=true` 时调用方应保持原 `state` 不变（与原 case "completeAgentMessage" 早返回一致）
 *   - `noop=false` 时调用方应把这两个字段写回新 state
 *
 * 与原 case 行为完全等价（已通过 §10.3 既有测试套件兜底）。
 */
function applyCompleteAgentMessageToState(
  state: ThreadState,
  params: {
    workspaceId: string;
    threadId: string;
    itemId: string;
    text: string;
    hasCustomName: boolean;
    timestamp: number;
    /** Native turn-target：仅 existing 缺失时落地（existing-first 不变式）。 */
    executionTargetSnapshot?: ExecutionTargetSnapshot;
    runtimeReceipt?: RuntimeModelReceipt;
  },
): {
  itemsByThread: ThreadState["itemsByThread"];
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  noop: boolean;
} {
  const segmentedItemId = resolveLiveAssistantMessageId(
    state,
    params.threadId,
    params.itemId,
  );
  const list = [...(state.itemsByThread[params.threadId] ?? [])];
  // Settlement-safe target: do not remount post-tool conclusion onto pre-tool
  // bare itemId after resetAgentSegment (fix-live-settle-assistant-tool-order).
  let index = findAssistantMessageIndexForLiveSettlement(
    list,
    params.itemId,
    segmentedItemId,
    "complete",
  );
  let shouldCanonicalizeLegacyId = false;
  if (index < 0 && !isLegacyTextDeltaItemId(params.threadId, segmentedItemId)) {
    const legacySegmentedItemId = resolveLiveAssistantMessageId(
      state,
      params.threadId,
      buildLegacyTextDeltaItemId(params.threadId),
    );
    index = findAssistantMessageIndexForLiveSettlement(
      list,
      buildLegacyTextDeltaItemId(params.threadId),
      legacySegmentedItemId,
      "complete",
    );
    if (index < 0) {
      index = findAssistantMessageIndexByLegacyTextDelta(list, params.threadId);
    }
    shouldCanonicalizeLegacyId = index >= 0;
  }
  const shouldDeduplicateCodexAssistant =
    shouldDeduplicateCodexAssistantMessages({
      threadsByWorkspace: state.threadsByWorkspace,
      workspaceId: params.workspaceId,
      threadId: params.threadId,
    });
  if (index < 0 && shouldDeduplicateCodexAssistant) {
    index = findEquivalentCodexAssistantMessageIndex(
      list,
      params.text,
      "settled",
    );
  }
  const targetItemId =
    index >= 0
      ? shouldCanonicalizeLegacyId
        ? segmentedItemId
        : (list[index]?.id ?? segmentedItemId)
      : segmentedItemId;
  const completedAt = params.timestamp ?? Date.now();
  const status = state.threadStatusById[params.threadId];
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
  const existingItem = index >= 0 ? list[index] : undefined;
  let computedCompletedItem: ConversationItem | null = null;
  if (isAssistantMessageItem(existingItem)) {
    const isThreadProcessing = Boolean(
      state.threadStatusById[params.threadId]?.isProcessing,
    );
    const keepFinalMetadata = shouldPreserveAssistantFinalMetadata(
      existingItem,
      isThreadProcessing,
    );
    const nextBase = keepFinalMetadata
      ? existingItem
      : clearAssistantFinalMetadata(existingItem);
    computedCompletedItem = withMissingTurnBadgeMetadata(
      withAssistantTurnTokenCounts(
        {
          ...nextBase,
          id: targetItemId,
          text: mergeCompletedAgentText(existingItem.text, params.text, true),
          isFinal: true,
          finalCompletedAt: nextBase.finalCompletedAt ?? completedAt,
          ...(typeof nextBase.finalDurationMs === "number"
            ? { finalDurationMs: nextBase.finalDurationMs }
            : derivedDuration !== null
              ? { finalDurationMs: derivedDuration }
              : {}),
        },
        state.tokenUsageByThread[params.threadId],
      ),
      params,
    );
  } else {
    computedCompletedItem = withMissingTurnBadgeMetadata(
      withAssistantTurnTokenCounts(
        {
          id: targetItemId,
          kind: "message",
          role: "assistant",
          text: params.text,
          isFinal: true,
          finalCompletedAt: completedAt,
          ...(derivedDuration !== null
            ? { finalDurationMs: derivedDuration }
            : {}),
        },
        state.tokenUsageByThread[params.threadId],
      ),
      params,
    );
  }
  if (
    INCREMENTAL_DERIVATION_ENABLED &&
    isAssistantMessageItem(existingItem) &&
    existingItem !== undefined &&
    targetItemId === existingItem.id &&
    existingItem.isFinal === true &&
    derivedDuration === null
  ) {
    const mergedCompletedText = mergeCompletedAgentText(
      existingItem.text,
      params.text,
      true,
    );
    if (mergedCompletedText === existingItem.text) {
      return {
        itemsByThread: state.itemsByThread,
        threadsByWorkspace: state.threadsByWorkspace,
        noop: true,
      };
    }
  }
  if (computedCompletedItem !== null) {
    if (isAssistantMessageItem(existingItem) && index >= 0) {
      list[index] = computedCompletedItem;
    } else {
      list.push(computedCompletedItem);
    }
  }
  const preparedItems = prepareThreadItems(list, {
    preserveMessageTextIds: new Set([targetItemId]),
  });
  // Complete marks isFinal; rebalance tools that already landed after the
  // conclusion while the bubble was still non-final (late bridge tools).
  const updatedItems =
    rebalanceTrailingToolsBeforeFinalAssistants(preparedItems);
  schedulePersistTurnFinalMetaFromItems(params.threadId, updatedItems);
  const nextThreadsByWorkspace = maybeRenameThreadFromAgent({
    workspaceId: params.workspaceId,
    threadId: params.threadId,
    items: updatedItems,
    itemId: targetItemId,
    hasCustomName: params.hasCustomName,
    threadsByWorkspace: state.threadsByWorkspace,
  });
  return {
    itemsByThread: {
      ...state.itemsByThread,
      [params.threadId]: updatedItems,
    },
    threadsByWorkspace: nextThreadsByWorkspace,
    noop: false,
  };
}
