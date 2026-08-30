import type { ConversationItem } from "../../../types";
import { asBooleanFlag } from "./claudeHistoryPrimitives";

export function extractClaudeAssistantFinalFlag(
  message: Record<string, unknown>,
): boolean | undefined {
  const metadata =
    message.metadata &&
    typeof message.metadata === "object" &&
    !Array.isArray(message.metadata)
      ? (message.metadata as Record<string, unknown>)
      : null;
  const candidates: unknown[] = [
    message.isFinal,
    message.is_final,
    message.final,
    message.isFinalMessage,
    message.is_final_message,
  ];
  if (metadata) {
    candidates.push(
      metadata.isFinal,
      metadata.is_final,
      metadata.final,
      metadata.isFinalMessage,
      metadata.is_final_message,
    );
  }
  for (const candidate of candidates) {
    const parsed = asBooleanFlag(candidate);
    if (typeof parsed === "boolean") {
      return parsed;
    }
  }
  return undefined;
}

export function markClaudeAssistantFinalMessages(items: ConversationItem[]) {
  let lastAssistantIndexInTurn = -1;
  let hasExplicitFinalAssistantInTurn = false;
  const finalizeCurrentTurn = () => {
    if (hasExplicitFinalAssistantInTurn || lastAssistantIndexInTurn < 0) {
      return;
    }
    const lastAssistant = items[lastAssistantIndexInTurn];
    if (
      !lastAssistant ||
      lastAssistant.kind !== "message" ||
      lastAssistant.role !== "assistant"
    ) {
      return;
    }
    if (lastAssistant.isFinal === true) {
      return;
    }
    items[lastAssistantIndexInTurn] = {
      ...lastAssistant,
      isFinal: true,
    };
  };

  items.forEach((item, index) => {
    if (item.kind === "message" && item.role === "user") {
      finalizeCurrentTurn();
      lastAssistantIndexInTurn = -1;
      hasExplicitFinalAssistantInTurn = false;
      return;
    }
    if (item.kind === "message" && item.role === "assistant") {
      if (item.isFinal === true) {
        hasExplicitFinalAssistantInTurn = true;
      }
      lastAssistantIndexInTurn = index;
    }
  });

  finalizeCurrentTurn();
}

export function hydrateClaudeAssistantFinalTiming(
  items: ConversationItem[],
  messageTimestampById: Map<string, number>,
) {
  let turnStartedAtMs: number | undefined;
  items.forEach((item, index) => {
    if (item.kind !== "message") {
      return;
    }
    if (item.role === "user") {
      turnStartedAtMs = messageTimestampById.get(item.id);
      return;
    }
    if (item.isFinal !== true) {
      return;
    }
    const completedAtMs = messageTimestampById.get(item.id);
    const durationMs =
      typeof completedAtMs === "number" && typeof turnStartedAtMs === "number"
        ? Math.max(0, completedAtMs - turnStartedAtMs)
        : undefined;
    if (typeof completedAtMs !== "number" && typeof durationMs !== "number") {
      return;
    }
    items[index] = {
      ...item,
      ...(typeof completedAtMs === "number"
        ? { finalCompletedAt: completedAtMs }
        : {}),
      ...(typeof durationMs === "number"
        ? { finalDurationMs: durationMs }
        : {}),
    };
  });
}

