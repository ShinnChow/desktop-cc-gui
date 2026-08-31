import type { ConversationItem } from "../../../../types";
import {
  buildMessagePresentationMetadata,
  getPresentationContext,
} from "../../../../conversation-presentation/normalizeConversationPresentation";
import { MEMORY_CONTEXT_SUMMARY_PREFIX } from "../../../project-memory/utils/memoryMarkers";

import { isEquivalentUserObservation } from "../../../threads/assembly/conversationNormalization";

export type MemoryContextSummary = {
  preview: string;
  lines: string[];
  markdown?: string;
  rawPayload?: string;
  memoryPacks?: Array<{
    source: string;
    count: number;
    cleanedContext: string;
    rawPayload: string;
  }>;
  source?: string;
  /**
   * 注入模式标识（供 UI i18n）：
   * - `pick`：本轮挑选记忆注入
   * - `always`：整轮开启自动 top(n) 记忆注入
   * 历史中文标签也会被归一到上述枚举。
   */
  injectModeLabel?: "pick" | "always" | string;
  records?: Array<{
    displayIndex: string;
    index: string;
    memoryId: string;
    source: string;
    title: string;
    summary?: string;
    score?: number;
  }>;
};





const OPTIMISTIC_USER_MESSAGE_PREFIX = "optimistic-user-";
const QUEUED_HANDOFF_MESSAGE_PREFIX = "queued-handoff-";

function normalizeMemorySummaryKeySegment(value: string) {
  return value.trim().replace(/\r\n/g, "\n").replace(/\s+/g, " ");
}

function isPendingUserBubbleId(id: string) {
  return (
    id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX) ||
    id.startsWith(QUEUED_HANDOFF_MESSAGE_PREFIX)
  );
}



function getMemoryContextSummary(item: Extract<ConversationItem, { kind: "message" }>) {
  const context = getPresentationContext(buildMessagePresentationMetadata(item), "memory");
  if (!context) {
    return null;
  }
  return {
    preview: context.preview,
    lines: context.lines,
    markdown: context.markdown,
    rawPayload: context.rawPayload,
    memoryPacks: context.packs,
    source: context.source,
    records: context.records,
  } satisfies MemoryContextSummary;
}

/**
 * 解析记忆挑选结构化 preview 行：
 * `#1 | memoryId | title | summary | 0.91`
 */
const MEMORY_PICK_RECORD_LINE_REGEX =
  /^#(\d+)\s*\|\s*([^\s|]+)\s*\|\s*([^|]+?)(?:\s*\|\s*([^|]*?))?(?:\s*\|\s*([0-9.]+))?\s*$/;

export function parseMemoryPickPreviewRecords(preview: string): NonNullable<
  MemoryContextSummary["records"]
> {
  const records: NonNullable<MemoryContextSummary["records"]> = [];
  for (const rawLine of preview.split(/\r?\n+/)) {
    const line = rawLine.trim();
    const match = MEMORY_PICK_RECORD_LINE_REGEX.exec(line);
    if (!match) continue;
    const displayIndex = `#${match[1]}`;
    const memoryId = (match[2] ?? "").trim();
    const title = (match[3] ?? "").trim() || memoryId;
    const summary = (match[4] ?? "").trim();
    const scoreRaw = (match[5] ?? "").trim();
    const score = scoreRaw ? Number.parseFloat(scoreRaw) : undefined;
    records.push({
      displayIndex,
      index: displayIndex,
      memoryId,
      source: "memory-pick",
      title,
      summary: summary || undefined,
      score: Number.isFinite(score) ? score : undefined,
    });
  }
  return records;
}

function parseMemoryPickModeLabel(
  preview: string,
): "pick" | "always" | undefined {
  const header = preview.split(/\r?\n/)[0]?.trim() ?? "";
  // 兼容历史中文 header 与未来 mode token
  if (
    header.includes("一直开启") ||
    header.includes("整轮开启") ||
    header.includes("整轮自动") ||
    /\balways\b/i.test(header)
  ) {
    return "always";
  }
  if (
    header.includes("本轮") ||
    header.includes("记忆挑选") ||
    /\bpick\b/i.test(header)
  ) {
    return "pick";
  }
  return undefined;
}

export function parseMemoryContextSummary(text: string): MemoryContextSummary | null {
  const normalized = text.trim();
  if (!normalized.startsWith(MEMORY_CONTEXT_SUMMARY_PREFIX)) {
    return null;
  }
  const preview = normalized.slice(MEMORY_CONTEXT_SUMMARY_PREFIX.length).trim();
  if (!preview) {
    return null;
  }
  const pickRecords = parseMemoryPickPreviewRecords(preview);
  if (pickRecords.length > 0) {
    const lines = pickRecords.map(
      (record) => `${record.displayIndex} ${record.title}`.trim(),
    );
    return {
      preview: lines.slice(0, 3).join("；"),
      lines,
      markdown: lines.join("\n"),
      source: "memory-pick",
      injectModeLabel: parseMemoryPickModeLabel(preview),
      records: pickRecords,
    };
  }
  const lines = preview
    .split(/[；\n]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    // 丢掉纯 header 行
    .filter((line) => !line.startsWith("记忆挑选"));
  return {
    preview: lines.length > 0 ? lines.join("；") : preview,
    lines: lines.length > 0 ? lines : [preview],
    markdown: preview,
  };
}

export function buildMemoryContextSummaryKey(summary: MemoryContextSummary | null) {
  if (!summary) {
    return null;
  }
  const normalizedLines = summary.lines
    .map((line) => normalizeMemorySummaryKeySegment(line))
    .filter(Boolean);
  if (normalizedLines.length === 0) {
    return null;
  }
  const previewHead = normalizedLines.slice(0, 2).join("；");
  const previewLooksTruncated =
    summary.preview.trim().endsWith("...") || normalizedLines.length > 2;
  if (!previewHead) {
    return null;
  }
  return previewLooksTruncated && !previewHead.endsWith("...")
    ? `${previewHead}...`
    : previewHead;
}



export function buildSuppressedUserMemoryContextMessageIdSet(items: ConversationItem[]) {
  const suppressedMessageIds = new Set<string>();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || item.kind !== "message" || item.role !== "user") {
      continue;
    }
    const userSummaryKey = buildMemoryContextSummaryKey(getMemoryContextSummary(item));
    if (!userSummaryKey) {
      continue;
    }

    for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
      const previousItem = items[previousIndex];
      if (!previousItem || previousItem.kind !== "message") {
        continue;
      }
      if (previousItem.role === "user") {
        if (
          isPendingUserBubbleId(previousItem.id) &&
          isEquivalentUserObservation(previousItem, item)
        ) {
          continue;
        }
        break;
      }
      const assistantSummaryKey = buildMemoryContextSummaryKey(
        getMemoryContextSummary(previousItem),
      );
      if (assistantSummaryKey && assistantSummaryKey === userSummaryKey) {
        suppressedMessageIds.add(item.id);
        break;
      }
    }
  }

  return suppressedMessageIds;
}
