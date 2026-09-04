import type { ConversationItem, ThreadSummary } from "../../../types";
import { asNumber,
  asString } from "../utils/threadNormalize";
import {
  hasCodexBackgroundHelperPreview,
} from "../utils/codexBackgroundHelpers";
import { matchesWorkspacePath } from "./useThreadActions.workspacePath";

export function isLocalSessionScanUnavailable(
  result: Record<string, unknown>,
): boolean {
  const marker = asString(result.partialSource ?? result.partial_source)
    .trim()
    .toLowerCase();
  return marker === "local-session-scan-unavailable";
}

export function shouldIncludeWorkspaceThreadEntry(
  thread: Record<string, unknown>,
  workspacePath: string,
  knownCodexThreadIds: Set<string>,
  allowKnownCodexWithoutCwd: boolean,
): boolean {
  const threadCwd = asString(thread.cwd).trim();
  if (matchesWorkspacePath(threadCwd, workspacePath)) {
    return shouldIncludeThreadEntry(thread);
  }
  if (!allowKnownCodexWithoutCwd || threadCwd.length > 0) {
    return false;
  }
  const threadId = asString(thread.id).trim();
  if (!threadId || !knownCodexThreadIds.has(threadId)) {
    return false;
  }
  return shouldIncludeThreadEntry(thread);
}

function toBooleanFlag(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }
  return false;
}

function isArchivedThread(thread: Record<string, unknown>): boolean {
  const archivedFlag = toBooleanFlag(thread.archived ?? thread.isArchived);
  if (archivedFlag) {
    return true;
  }
  return asNumber(thread.archivedAt ?? thread.archived_at) > 0;
}

function normalizeThreadMetaValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function resolveThreadSourceMeta(
  thread: Record<string, unknown>,
): Pick<
  ThreadSummary,
  "source" | "provider" | "sourceLabel" | "parentThreadId"
> {
  const source =
    normalizeThreadMetaValue(thread.source) ??
    normalizeThreadMetaValue(thread.sessionSource);
  const provider =
    normalizeThreadMetaValue(thread.provider) ??
    normalizeThreadMetaValue(thread.providerId) ??
    normalizeThreadMetaValue(thread.sessionProvider);
  const sourceLabel =
    normalizeThreadMetaValue(thread.sourceLabel) ??
    (source && provider ? `${source}/${provider}` : (source ?? provider));
  const parentThreadId =
    normalizeThreadMetaValue(thread.parentThreadId) ??
    normalizeThreadMetaValue(thread.parentSessionId) ??
    normalizeThreadMetaValue(thread.parent_thread_id) ??
    normalizeThreadMetaValue(thread.parent_session_id);
  return {
    source,
    provider,
    sourceLabel,
    ...(parentThreadId ? { parentThreadId } : {}),
  };
}

function shouldIncludeThreadEntry(thread: Record<string, unknown>): boolean {
  if (isArchivedThread(thread)) {
    return false;
  }
  if (normalizeThreadMetaValue(thread.nativeTitle)) {
    return true;
  }
  const previewCandidates = [
    asString(thread.preview).trim(),
    asString(thread.title).trim(),
    asString(thread.name).trim(),
  ].filter(Boolean);
  const isCodexHelperThread =
    hasCodexBackgroundHelperPreview(previewCandidates);
  if (isCodexHelperThread) {
    return false;
  }
  return true;
}

function parseCollabLinkDetail(detail: string, fallbackParentId: string) {
  const trimmed = detail.trim();
  if (!trimmed) {
    return null;
  }
  const hasUnicodeArrow = trimmed.includes("→");
  const hasAsciiArrow = !hasUnicodeArrow && trimmed.includes("->");
  if (!hasUnicodeArrow && !hasAsciiArrow) {
    return null;
  }
  const [leftSideRaw, rightSideRaw] = hasUnicodeArrow
    ? trimmed.split("→", 2)
    : trimmed.split("->", 2);
  const leftSide = (leftSideRaw ?? "").trim();
  const rightSide = (rightSideRaw ?? "").trim();
  const parentMatch = leftSide.match(/^From\s+(.+)$/i);
  const parentId = (parentMatch?.[1]?.trim() || fallbackParentId).trim();
  const childIds = rightSide
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!parentId || childIds.length === 0) {
    return null;
  }
  return { parentId, childIds };
}

export function restoreThreadParentLinksFromSnapshot(
  threadId: string,
  items: ConversationItem[],
  updateThreadParent?: (parentId: string, childIds: string[]) => void,
) {
  if (!updateThreadParent) {
    return;
  }
  items.forEach((item) => {
    if (item.kind !== "tool" || item.toolType !== "collabToolCall") {
      return;
    }
    const parsedLink = parseCollabLinkDetail(item.detail, threadId);
    if (!parsedLink) {
      return;
    }
    updateThreadParent(parsedLink.parentId, parsedLink.childIds);
  });
}

export function collectRelatedThreadIdsFromSnapshot(
  threadId: string,
  items: ConversationItem[],
) {
  const relatedThreadIds = new Set<string>();
  items.forEach((item) => {
    if (item.kind !== "tool" || item.toolType !== "collabToolCall") {
      return;
    }
    const parsedLink = parseCollabLinkDetail(item.detail, threadId);
    if (!parsedLink) {
      return;
    }
    parsedLink.childIds.forEach((childId) => {
      if (!childId || childId === threadId) {
        return;
      }
      relatedThreadIds.add(childId);
    });
  });
  return Array.from(relatedThreadIds);
}

export function isAskUserQuestionToolItem(
  item: ConversationItem,
): item is Extract<ConversationItem, { kind: "tool" }> {
  if (item.kind !== "tool") {
    return false;
  }
  const normalizedToolType =
    typeof item.toolType === "string" ? item.toolType.trim().toLowerCase() : "";
  if (
    normalizedToolType === "askuserquestion" ||
    normalizedToolType === "ask_user_question"
  ) {
    return true;
  }
  const normalizedTitle =
    typeof item.title === "string" ? item.title.trim().toLowerCase() : "";
  return (
    normalizedTitle.includes("askuserquestion") ||
    normalizedTitle.includes("ask_user_question")
  );
}

export function isTerminalToolStatus(status?: string) {
  if (!status) {
    return false;
  }
  const normalized = status.trim().toLowerCase();
  return /(complete|completed|success|succeed(?:ed)?|done|finish(?:ed)?|fail|error|cancel(?:led)?|abort|timeout|timed[_ -]?out)/.test(
    normalized,
  );
}

export function shouldReplaceUserInputQueueFromSnapshot(
  items: ConversationItem[],
  queueLength: number,
  hasLocalPendingQueue: boolean,
) {
  if (queueLength > 0) {
    return true;
  }
  const hasSubmittedRecord = items.some(
    (item) =>
      item.kind === "tool" && item.toolType === "requestUserInputSubmitted",
  );
  if (hasSubmittedRecord) {
    return true;
  }
  if (hasLocalPendingQueue) {
    return false;
  }
  return true;
}

export * from "./useThreadActions.helpers.recovery";
export * from "./useThreadActions.helpers.engineSummaries";
export * from "./useThreadActions.helpers.continuityMerge";
export * from "./useThreadActions.helpers.rewind";
