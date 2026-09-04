import type { ConversationItem, ThreadSummary } from "../../../types";
import { isCliInjectedAgentTaskNotificationText } from "../../engine-task-output/contracts/agentTaskNotification";
import { areEquivalentAssistantMessageTexts } from "../assembly/conversationNormalization";
import { mergeAgentMessageText } from "./threadReducerTextMerge";

type MessageItem = Extract<ConversationItem, { kind: "message" }>;
type AssistantMessageItem = MessageItem & { role: "assistant" };

export type AssistantEquivalenceMatchMode = "settled" | "streaming";

/** Settled complete/upsert: need enough text so short openers cannot glue turns. */
const SETTLED_EQUIVALENCE_MIN_CHARS = 24;
/**
 * Streaming append must not use cross-id glue at all for short deltas.
 * If ever re-enabled, keep this floor well above areEquivalent's 8-char prefix rule.
 */
const STREAMING_EQUIVALENCE_MIN_CHARS = 80;

function isAssistantMessageItem(
  item: ConversationItem | undefined,
): item is AssistantMessageItem {
  return item?.kind === "message" && item.role === "assistant";
}

/**
 * Align with conversationAssembler.shouldStopAssistantEquivalenceSearch:
 * user / tool / reasoning / media / review boundaries block cross-id merge.
 * CLI-injected task-notification users (wakeup / SubAgent) are not a turn boundary.
 */
export function shouldStopEquivalentAssistantSearch(item: ConversationItem): boolean {
  if (item.kind === "message") {
    return (
      item.role === "user" &&
      !isCliInjectedAgentTaskNotificationText(item.text)
    );
  }
  return (
    item.kind === "reasoning" ||
    item.kind === "tool" ||
    item.kind === "generatedImage" ||
    item.kind === "diff" ||
    item.kind === "review" ||
    item.kind === "explore"
  );
}

/**
 * Whether cross-itemId equivalent assistant convergence is allowed for the thread.
 * Native and Shared share the same policy; safety is in match mode + stop boundaries.
 *
 * @see openspec/changes/fix-assistant-duplicate-render-native-shared
 */
export function shouldConvergeEquivalentAssistantMessages(_params: {
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  workspaceId: string;
  threadId: string;
}) {
  return true;
}

/** @deprecated Prefer shouldConvergeEquivalentAssistantMessages; kept as stable export name. */
export function shouldDeduplicateCodexAssistantMessages(params: {
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  workspaceId: string;
  threadId: string;
}) {
  return shouldConvergeEquivalentAssistantMessages(params);
}

/**
 * Cross-id assistant lookup.
 *
 * - `settled`: complete / upsert — length floor 24 + areEquivalent.
 * - `streaming`: append/snapshot — prefer **exact body** match (full snapshot alias);
 *   loose areEquivalent only when both sides are long (≥80), so short openers cannot
 *   prefix-glue a new turn onto the previous bubble.
 */
export function findEquivalentCodexAssistantMessageIndex(
  list: ConversationItem[],
  incomingText: string,
  mode: AssistantEquivalenceMatchMode = "settled",
) {
  const trimmed = incomingText.trim();
  if (!trimmed) {
    return -1;
  }
  if (mode === "settled" && trimmed.length < SETTLED_EQUIVALENCE_MIN_CHARS) {
    return -1;
  }
  if (mode === "streaming" && trimmed.length < SETTLED_EQUIVALENCE_MIN_CHARS) {
    // Even exact snapshot aliases need a minimal body; never match tiny fragments.
    return -1;
  }

  for (let index = list.length - 1; index >= 0; index -= 1) {
    const item = list[index];
    if (!item) {
      continue;
    }
    if (shouldStopEquivalentAssistantSearch(item)) {
      return -1;
    }
    if (!isAssistantMessageItem(item)) {
      continue;
    }
    const existingTrimmed = item.text.trim();
    if (existingTrimmed.length < SETTLED_EQUIVALENCE_MIN_CHARS) {
      continue;
    }

    if (mode === "streaming") {
      // Full snapshot re-send under a new id (Codex snapshot-before-delta).
      if (existingTrimmed === trimmed) {
        return index;
      }
      // Loose prefix/near-dup only for long streaming bodies.
      if (
        existingTrimmed.length >= STREAMING_EQUIVALENCE_MIN_CHARS &&
        trimmed.length >= STREAMING_EQUIVALENCE_MIN_CHARS &&
        areEquivalentAssistantMessageTexts(
          item.text,
          incomingText,
          mergeAgentMessageText,
        )
      ) {
        return index;
      }
      continue;
    }

    if (
      areEquivalentAssistantMessageTexts(
        item.text,
        incomingText,
        mergeAgentMessageText,
      )
    ) {
      return index;
    }
  }
  return -1;
}

/** @internal test helper — documents the intentional streaming ban. */

