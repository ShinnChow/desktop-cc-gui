import type { ConversationItem } from "../../../types";
import { prepareThreadItems } from "../../../utils/threadItems";
import {
  buildCodexCompactionMessage,
  collectThreadScopedCodexCompactionMessages,
  filterThreadScopedCodexCompactionMessages,
  isThreadScopedCodexCompactionMessage,
} from "./threadReducerCoreHelpers";
import type { ThreadAction, ThreadState } from "./threadReducerTypes";

export function reduceAppendContextCompacted(
  state: ThreadState,
  action: Extract<ThreadAction, { type: "appendContextCompacted" }>,
): ThreadState {
  const list = state.itemsByThread[action.threadId] ?? [];
  const id = `context-compacted-${action.turnId}`;
  if (list.some((entry) => entry.id === id)) {
    return state;
  }
  // 压缩留痕是引擎侧系统事件，不是模型说的话：独立 context-event kind，
  // 让 finality / 折叠 / prose 聚合的既有谓词按类型天然排除（否则
  // markLatestAssistantMessageFinal 会把 isFinal 打在留痕上，极简模式
  // 锚点被劫持、真实回答被折进 chip——2026-08-27 用户反馈回归）。
  const compactedMarker: ConversationItem = {
    id,
    kind: "context-event",
    eventType: "compacted",
    reason: action.reason ?? null,
    tokensBefore: action.tokensBefore ?? null,
    estimatedTokensAfter: action.estimatedTokensAfter ?? null,
    turnId: action.turnId,
    timestampMs: action.timestampMs ?? Date.now(),
  };
  return {
    ...state,
    itemsByThread: {
      ...state.itemsByThread,
      [action.threadId]: prepareThreadItems([...list, compactedMarker]),
    },
  };
}

export function reduceSettleCodexCompactionMessage(
  state: ThreadState,
  action: Extract<ThreadAction, { type: "settleCodexCompactionMessage" }>,
): ThreadState {
  const list = state.itemsByThread[action.threadId] ?? [];
  const fallbackMessageId = action.fallbackMessageId ?? null;
  if (action.appendIfAlreadyCompleted) {
    if (
      !fallbackMessageId ||
      list.some((entry) => entry.id === fallbackMessageId)
    ) {
      return state;
    }
    return {
      ...state,
      itemsByThread: {
        ...state.itemsByThread,
        [action.threadId]: prepareThreadItems([
          ...list,
          buildCodexCompactionMessage(
            action.threadId,
            action.text,
            fallbackMessageId,
          ),
        ]),
      },
    };
  }
  const { latestMatch, matchCount } =
    collectThreadScopedCodexCompactionMessages(list, action.threadId);
  if (latestMatch?.text === action.text && matchCount === 1) {
    return state;
  }
  const next = [
    ...filterThreadScopedCodexCompactionMessages(list, action.threadId),
    buildCodexCompactionMessage(
      action.threadId,
      action.text,
      latestMatch?.id ?? fallbackMessageId ?? undefined,
    ),
  ];
  return {
    ...state,
    itemsByThread: {
      ...state.itemsByThread,
      [action.threadId]: prepareThreadItems(next),
    },
  };
}

export function reduceAppendCodexCompactionMessage(
  state: ThreadState,
  action: Extract<ThreadAction, { type: "appendCodexCompactionMessage" }>,
): ThreadState {
  const list = state.itemsByThread[action.threadId] ?? [];
  const lastItem = list[list.length - 1];
  const { latestMatch, matchCount } =
    collectThreadScopedCodexCompactionMessages(list, action.threadId);
  const shouldReuseLatestStartedMessage =
    isThreadScopedCodexCompactionMessage(lastItem, action.threadId) &&
    latestMatch?.text === action.text &&
    !latestMatch.id.includes("-completed-");
  if (shouldReuseLatestStartedMessage && matchCount === 1) {
    return state;
  }
  const next = [
    ...filterThreadScopedCodexCompactionMessages(list, action.threadId),
    shouldReuseLatestStartedMessage
      ? latestMatch
      : buildCodexCompactionMessage(action.threadId, action.text),
  ];
  return {
    ...state,
    itemsByThread: {
      ...state.itemsByThread,
      [action.threadId]: prepareThreadItems(next),
    },
  };
}

export function reduceDiscardLatestCodexCompactionMessage(
  state: ThreadState,
  action: Extract<
    ThreadAction,
    { type: "discardLatestCodexCompactionMessage" }
  >,
): ThreadState {
  const list = state.itemsByThread[action.threadId] ?? [];
  let existingIndex = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (isThreadScopedCodexCompactionMessage(list[index], action.threadId)) {
      existingIndex = index;
      break;
    }
  }
  if (existingIndex < 0) {
    return state;
  }
  const existingItem = list[existingIndex];
  if (
    !isThreadScopedCodexCompactionMessage(existingItem, action.threadId) ||
    existingItem.text !== action.text
  ) {
    return state;
  }
  const next = list.filter((_, index) => index !== existingIndex);
  return {
    ...state,
    itemsByThread: {
      ...state.itemsByThread,
      [action.threadId]: prepareThreadItems(next),
    },
  };
}
