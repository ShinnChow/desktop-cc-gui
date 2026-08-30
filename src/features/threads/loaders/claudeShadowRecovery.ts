import type { ConversationItem } from "../../../types";
import { findLiveAssistantShadowTranscriptForRestore } from "../utils/liveAssistantShadowTranscript";
import { noteThreadRecoverySourceObserved } from "../utils/streamLatencyDiagnostics";
import { asString } from "./historyLoaderUtils";
import { isCliInjectedAgentTaskNotificationText } from "../../engine-task-output/contracts/agentTaskNotification";
import { asRecord } from "./claudeHistoryPrimitives";
import { extractTurnIdFromRawMessage } from "./claudeControlPlaneClassifier";
import { extractClaudeAssistantFinalFlag } from "./claudeAssistantFinalTiming";
import { parseClaudeHistoryMessages } from "./claudeHistoryLoader";

type MessageItemWithTurn = Extract<ConversationItem, { kind: "message" }> & {
  role: "assistant";
  turnId?: string | null;
};


export function isShadowRecoveryTurnBoundaryUser(item: ConversationItem) {
  return (
    item.kind === "message" &&
    item.role === "user" &&
    !isCliInjectedAgentTaskNotificationText(item.text)
  );
}

export function isEquivalentShadowAssistantText(existingText: string, shadowText: string) {
  const normalizedExisting = existingText.trim();
  const normalizedShadow = shadowText.trim();
  if (!normalizedExisting || !normalizedShadow) {
    return false;
  }
  return (
    normalizedShadow === normalizedExisting ||
    normalizedShadow.startsWith(normalizedExisting) ||
    normalizedExisting.startsWith(normalizedShadow)
  );
}

export function findExistingAssistantEquivalentToShadow(
  items: ConversationItem[],
  shadowText: string,
) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== "message" || item.role !== "assistant") {
      continue;
    }
    if (isEquivalentShadowAssistantText(item.text, shadowText)) {
      return { index, item };
    }
  }
  return null;
}

export function findLastAssistantAfterLastUser(items: ConversationItem[]) {
  let lastUserIndex = -1;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item && isShadowRecoveryTurnBoundaryUser(item)) {
      lastUserIndex = index;
    }
  }
  if (lastUserIndex < 0) {
    return null;
  }
  for (let index = items.length - 1; index > lastUserIndex; index -= 1) {
    const item = items[index];
    if (item?.kind === "message" && item.role === "assistant") {
      return { index, item };
    }
  }
  return null;
}

export function isLikelySameTurnForRecovery(
  item: MessageItemWithTurn,
  expectedTurnId: string | null,
  shadowTurnId: string | null,
) {
  if (!expectedTurnId || !item.turnId || !shadowTurnId) {
    return true;
  }
  return item.turnId === expectedTurnId && item.turnId === shadowTurnId;
}

export function buildRecoveredAssistantFromShadow(shadow: {
  id: string;
  text: string;
  turnId: string | null;
  itemId: string;
}) {
  return {
    id: `claude-shadow-recovered-${shadow.itemId}`,
    kind: "message" as const,
    role: "assistant" as const,
    text: shadow.text,
    ...(shadow.turnId ? { turnId: shadow.turnId } : {}),
    isFinal: false,
    recoveredFromLiveShadow: true,
    recoveryStatus: "interrupted" as const,
    recoverySourceId: shadow.id,
    engineSource: "claude" as const,
  };
}

export function appendRecoveredAssistantUnlessDuplicate({
  items,
  shadow,
  expectedTurnId,
  hasExplicitFinalAfterLastUser,
}: {
  items: ConversationItem[];
  shadow: {
    id: string;
    text: string;
    turnId: string | null;
    itemId: string;
  };
  expectedTurnId: string | null;
  hasExplicitFinalAfterLastUser: boolean;
}) {
  const equivalent = findExistingAssistantEquivalentToShadow(items, shadow.text);
  if (!equivalent) {
    return [...items, buildRecoveredAssistantFromShadow(shadow)];
  }

  const latest = equivalent.item as MessageItemWithTurn;
  const normalizedLatestText = latest.text.trim();
  if (latest.isFinal === true && hasExplicitFinalAfterLastUser) {
    return items;
  }
  const sameTurn = isLikelySameTurnForRecovery(
    latest,
    expectedTurnId,
    shadow.turnId,
  );
  const normalizedShadowText = shadow.text.trim();
  if (
    sameTurn &&
    normalizedShadowText.startsWith(normalizedLatestText) &&
    normalizedShadowText.length > normalizedLatestText.length
  ) {
    const merged = items.slice();
    merged[equivalent.index] = {
      ...latest,
      text: shadow.text,
      isFinal: false,
      recoveredFromLiveShadow: true,
      recoveryStatus: "interrupted" as const,
      recoverySourceId: shadow.id,
      engineSource: "claude" as const,
      ...(shadow.turnId ? { turnId: shadow.turnId } : {}),
    };
    return merged;
  }
  return items;
}

export function recoverClaudeAssistantFromShadowIfNeeded({
  items,
  shadow,
  expectedTurnId,
  hasExplicitFinalAfterLastUser,
}: {
  items: ConversationItem[];
  shadow: {
    id: string;
    text: string;
    turnId: string | null;
    itemId: string;
  };
  expectedTurnId: string | null;
  hasExplicitFinalAfterLastUser: boolean;
}) {
  const normalizedShadowText = shadow.text.trim();
  if (normalizedShadowText.length === 0) {
    return items;
  }

  const trailingAssistant = findLastAssistantAfterLastUser(items);
  if (!trailingAssistant) {
    return appendRecoveredAssistantUnlessDuplicate({
      items,
      shadow,
      expectedTurnId,
      hasExplicitFinalAfterLastUser,
    });
  }

  const latest = trailingAssistant.item as MessageItemWithTurn;
  const normalizedLatestText = latest.text.trim();
  if (!normalizedLatestText) {
    return appendRecoveredAssistantUnlessDuplicate({
      items,
      shadow,
      expectedTurnId,
      hasExplicitFinalAfterLastUser,
    });
  }

  const sameTurn = isLikelySameTurnForRecovery(
    latest,
    expectedTurnId,
    shadow.turnId,
  );

  if (latest.isFinal === true && hasExplicitFinalAfterLastUser) {
    return items;
  }

  const isPrefixMatch = normalizedShadowText.startsWith(normalizedLatestText);

  if (sameTurn && isPrefixMatch) {
    if (normalizedShadowText.length > normalizedLatestText.length) {
      const merged = items.slice();
      merged[trailingAssistant.index] = {
        ...latest,
        text: shadow.text,
        isFinal: false,
        recoveredFromLiveShadow: true,
        recoveryStatus: "interrupted" as const,
        recoverySourceId: shadow.id,
        engineSource: "claude" as const,
        ...(shadow.turnId ? { turnId: shadow.turnId } : {}),
      };
      return merged;
    }
    return items;
  }

  return items;
}

export function deriveLatestTurnIdFromItems(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    const turnId = asString((item as { turnId?: string | null }).turnId).trim();
    if (turnId) {
      return turnId;
    }
  }
  return null;
}

export function deriveLatestTurnIdFromRawMessages(messagesData: unknown) {
  const messages = Array.isArray(messagesData) ? messagesData : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index]);
    if (!message) {
      continue;
    }
    const turnId = extractTurnIdFromRawMessage(message);
    if (turnId) {
      return turnId;
    }
  }
  return null;
}

export function resolveExpectedShadowTurnId(
  items: ConversationItem[],
  messagesData: unknown,
): string | null {
  const rawTurnId = deriveLatestTurnIdFromRawMessages(messagesData);
  if (rawTurnId) {
    return rawTurnId;
  }
  return deriveLatestTurnIdFromItems(items);
}

export function hasExplicitFinalAssistantAfterLastUser(messagesData: unknown) {
  const messages = Array.isArray(messagesData) ? messagesData : [];
  let lastUserIndex = -1;
  for (let index = 0; index < messages.length; index += 1) {
    const message = asRecord(messages[index]);
    if (!message) {
      continue;
    }
    const kind = asString(message.kind ?? "");
    if (kind !== "message") {
      continue;
    }
    const role = asString(message.role ?? "") === "user" ? "user" : "assistant";
    if (
      role === "user" &&
      !isCliInjectedAgentTaskNotificationText(asString(message.text ?? ""))
    ) {
      lastUserIndex = index;
    }
  }
  if (lastUserIndex < 0) {
    return false;
  }

  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    const message = asRecord(messages[index]);
    if (!message) {
      continue;
    }
    const kind = asString(message.kind ?? "");
    if (kind !== "message") {
      continue;
    }
    const role = asString(message.role ?? "") === "user" ? "user" : "assistant";
    if (role !== "assistant") {
      continue;
    }
    if (extractClaudeAssistantFinalFlag(message) === true) {
      return true;
    }
  }
  return false;
}

export function recoverClaudeInterruptedAssistantFromShadow({
  items,
  workspaceId,
  threadId,
  sessionId,
  expectedTurnId,
  hasExplicitFinalAfterLastUser,
}: {
  items: ConversationItem[];
  workspaceId: string;
  threadId: string;
  sessionId: string;
  expectedTurnId?: string | null;
  hasExplicitFinalAfterLastUser?: boolean;
}) {
  const resolvedExpectedTurnId = expectedTurnId?.trim() || null;
  const lookupTurnId =
    resolvedExpectedTurnId || deriveLatestTurnIdFromItems(items);
  const unsettledShadow = findLiveAssistantShadowTranscriptForRestore({
    workspaceId,
    threadId,
    sessionId,
    requireUnsettled: true,
    expectedTurnId: lookupTurnId,
  });

  const shadow =
    unsettledShadow ??
    findLiveAssistantShadowTranscriptForRestore({
      workspaceId,
      threadId,
      sessionId,
      requireUnsettled: false,
      ...(lookupTurnId ? { expectedTurnId: lookupTurnId } : {}),
    });

  if (!shadow) {
    return items;
  }

  const recoveredItems = recoverClaudeAssistantFromShadowIfNeeded({
    items,
    shadow: {
      id: shadow.id,
      text: shadow.text,
      turnId: shadow.turnId,
      itemId: shadow.itemId,
    },
    expectedTurnId: lookupTurnId,
    hasExplicitFinalAfterLastUser: hasExplicitFinalAfterLastUser === true,
  });
  const recoveredAssistant = recoveredItems.find(
    (item): item is Extract<ConversationItem, { kind: "message" }> =>
      item.kind === "message" &&
      item.role === "assistant" &&
      item.recoveredFromLiveShadow === true &&
      item.recoverySourceId === shadow.id,
  );
  if (recoveredAssistant) {
    noteThreadRecoverySourceObserved(threadId, {
      source: "live-shadow",
      sourceId: shadow.id,
      itemId: recoveredAssistant.id,
      textLength: recoveredAssistant.text.length,
    });
  }
  return recoveredItems;
}

export function normalizeShadowRecoverySessionId(
  threadId: string,
  sessionId?: string | null,
) {
  const candidate = sessionId?.trim();
  if (candidate) {
    return candidate;
  }
  const threadPrefix = threadId.startsWith("claude:")
    ? threadId.slice("claude:".length)
    : threadId;
  return threadPrefix.trim();
}

export function parseClaudeHistoryMessagesWithShadowRecovery({
  messagesData,
  workspaceId,
  threadId,
  sessionId,
  workspacePath,
}: {
  messagesData: unknown;
  workspaceId: string;
  threadId: string;
  sessionId?: string | null;
  workspacePath?: string | null;
}): ConversationItem[] {
  const parsedItems = parseClaudeHistoryMessages(messagesData, workspacePath);
  return recoverClaudeInterruptedAssistantFromShadow({
    items: parsedItems,
    workspaceId,
    threadId,
    sessionId: normalizeShadowRecoverySessionId(threadId, sessionId),
    expectedTurnId: resolveExpectedShadowTurnId(parsedItems, messagesData),
    hasExplicitFinalAfterLastUser:
      hasExplicitFinalAssistantAfterLastUser(messagesData),
  });
}

