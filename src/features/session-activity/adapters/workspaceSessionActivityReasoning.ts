import type { ConversationItem } from "../../../types";
import { longestSuffixPrefixOverlap } from "../../../utils/stringOverlap";

export const PARAGRAPH_BREAK_SPLIT_REGEX = /\n{2,}/;

export function sanitizeReasoningTitle(title: string) {
  return title
    .replace(/[`*_~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}

export function summarizeTurnUserMessage(text: string, maxLength = 180) {
  const normalized = text
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1)}…`;
}

export function findLatestUserTurnSemantic(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.kind !== "message" || item.role !== "user") {
      continue;
    }
    const summary = summarizeTurnUserMessage(item.text);
    if (summary) {
      return summary;
    }
  }
  return "";
}

export function compactReasoningText(value: string) {
  return value.replace(/\s+/g, "");
}

export function compactComparableReasoningText(value: string) {
  return compactReasoningText(value)
    .replace(/[！!]/g, "!")
    .replace(/[？?]/g, "?")
    .replace(/[，,]/g, ",")
    .replace(/[。．.]/g, ".");
}

export function sliceByComparableLength(text: string, targetLength: number) {
  if (targetLength <= 0) {
    return text;
  }
  let compactLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    const currentChar = text[index] ?? "";
    if (!/\s/.test(currentChar)) {
      compactLength += 1;
    }
    if (compactLength >= targetLength) {
      return text.slice(index + 1);
    }
  }
  return "";
}

export function stripLeadingReasoningTitleOverlap(content: string, candidates: string[]) {
  const trimmedContent = content.trim();
  if (!trimmedContent) {
    return trimmedContent;
  }
  const normalizedCandidates = candidates
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 8);
  if (normalizedCandidates.length === 0) {
    return trimmedContent;
  }

  for (const candidate of normalizedCandidates) {
    if (trimmedContent.startsWith(candidate)) {
      return trimmedContent
        .slice(candidate.length)
        .replace(/^[\s，。！？!?:：;；、-]+/, "")
        .trim();
    }
  }

  const compactContent = compactComparableReasoningText(trimmedContent);
  for (const candidate of normalizedCandidates) {
    const compactCandidate = compactComparableReasoningText(candidate);
    if (!compactCandidate || compactCandidate.length < 8) {
      continue;
    }
    if (compactContent === compactCandidate) {
      return "";
    }
    if (compactContent.startsWith(compactCandidate)) {
      const sliced = sliceByComparableLength(trimmedContent, compactCandidate.length);
      return sliced.replace(/^[\s，。！？!?:：;；、-]+/, "").trim();
    }
  }

  return trimmedContent;
}

export function splitComparableReasoningClauses(value: string) {
  return value
    .split(/[。！？!?；;\n]+/)
    .map((entry) => compactComparableReasoningText(entry.trim()))
    .filter((entry) => entry.length >= 6);
}

export function hasSharedReasoningClauseSuffix(left: string, right: string) {
  const leftClauses = splitComparableReasoningClauses(left);
  const rightClauses = splitComparableReasoningClauses(right);
  if (leftClauses.length < 3 || rightClauses.length < 3) {
    return false;
  }
  const max = Math.min(leftClauses.length, rightClauses.length);
  let shared = 0;
  for (let offset = 1; offset <= max; offset += 1) {
    if (leftClauses[leftClauses.length - offset] !== rightClauses[rightClauses.length - offset]) {
      break;
    }
    shared += 1;
  }
  return shared >= 2;
}

export function dedupeAdjacentReasoningParagraphs(value: string) {
  const collapseRepeatedParagraph = (paragraph: string) => {
    const trimmed = paragraph.trim();
    if (trimmed.length < 12) {
      return trimmed;
    }
    const directRepeat = trimmed.match(/^([\s\S]{6,}?)\s+\1$/);
    if (directRepeat?.[1]) {
      return directRepeat[1].trim();
    }
    const compact = compactReasoningText(trimmed);
    if (compact.length >= 12 && compact.length % 2 === 0) {
      const half = compact.slice(0, compact.length / 2);
      if (`${half}${half}` === compact) {
        let compactLength = 0;
        for (let index = 0; index < trimmed.length; index += 1) {
          const currentChar = trimmed[index] ?? "";
          if (!/\s/.test(currentChar)) {
            compactLength += 1;
          }
          if (compactLength >= half.length) {
            return trimmed.slice(0, index + 1).trim();
          }
        }
      }
    }
    const sentenceMatches = trimmed.match(/[^。！？!?]+[。！？!?]/g);
    if (sentenceMatches && sentenceMatches.length >= 4 && sentenceMatches.length % 2 === 0) {
      const mid = sentenceMatches.length / 2;
      const left = compactReasoningText(sentenceMatches.slice(0, mid).join(""));
      const right = compactReasoningText(sentenceMatches.slice(mid).join(""));
      if (left.length >= 6 && left === right) {
        return sentenceMatches.slice(0, mid).join("").trim();
      }
    }
    return trimmed;
  };

  const paragraphs = value
    .split(PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((line) => collapseRepeatedParagraph(line))
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    return paragraphs[0] ?? value.trim();
  }
  const deduped: string[] = [];
  for (const paragraph of paragraphs) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      compactReasoningText(previous) === compactReasoningText(paragraph) &&
      compactReasoningText(paragraph).length >= 8
    ) {
      continue;
    }
    deduped.push(paragraph);
  }
  return deduped.join("\n\n");
}

export function scoreReasoningTextQuality(value: string) {
  const paragraphs = value
    .split(PARAGRAPH_BREAK_SPLIT_REGEX)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    return 0;
  }
  const shortParagraphs = paragraphs.filter((entry) => entry.length <= 8).length;
  return shortParagraphs * 3 + paragraphs.length;
}

export function chooseBetterReasoningText(left: string, right: string) {
  const leftScore = scoreReasoningTextQuality(left);
  const rightScore = scoreReasoningTextQuality(right);
  if (leftScore < rightScore) {
    return left;
  }
  if (rightScore < leftScore) {
    return right;
  }
  const leftLength = compactComparableReasoningText(left).length;
  const rightLength = compactComparableReasoningText(right).length;
  return rightLength >= leftLength ? right : left;
}

export function isGenericReasoningTitle(title: string) {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[.:：。!！]+$/g, "");
  return (
    normalized === "reasoning" ||
    normalized === "thinking" ||
    normalized === "planning" ||
    normalized === "思考中" ||
    normalized === "正在思考" ||
    normalized === "正在规划"
  );
}

export type ParsedReasoningMeta = {
  summaryTitle: string;
  bodyText: string;
  hasBody: boolean;
  workingLabel: string | null;
};

export function parseReasoning(item: Extract<ConversationItem, { kind: "reasoning" }>): ParsedReasoningMeta {
  const summary = item.summary ?? "";
  const content = item.content ?? "";
  const hasSummary = summary.trim().length > 0 && !isGenericReasoningTitle(summary);
  const titleSource = hasSummary ? summary : content;
  const titleLines = titleSource.split("\n");
  const trimmedLines = titleLines.map((line) => line.trim());
  const titleLineIndex = trimmedLines.findIndex(Boolean);
  const rawTitle = titleLineIndex >= 0 ? (trimmedLines[titleLineIndex] ?? "") : "";
  const cleanTitle = sanitizeReasoningTitle(rawTitle);
  const summaryTitle = cleanTitle
    ? cleanTitle.length > 80
      ? `${cleanTitle.slice(0, 80)}…`
      : cleanTitle
    : "Reasoning";
  const summaryLines = summary.split("\n");
  const contentLines = content.split("\n");
  const summaryBody =
    hasSummary && titleLineIndex >= 0
      ? summaryLines
          .filter((_, index) => index !== titleLineIndex)
          .join("\n")
          .trim()
      : "";
  let contentBody = hasSummary
    ? content.trim()
    : titleLineIndex >= 0
      ? contentLines
          .filter((_, index) => index !== titleLineIndex)
          .join("\n")
          .trim()
      : content.trim();
  if (!hasSummary && !contentBody && content.trim()) {
    contentBody = content.trim();
  }
  const normalizedSummaryBody = summaryBody.trim();
  const normalizedContentBody = stripLeadingReasoningTitleOverlap(
    contentBody,
    [rawTitle, cleanTitle, normalizedSummaryBody],
  ).trim();
  const compactSummaryBody = compactReasoningText(normalizedSummaryBody);
  const compactContentBody = compactReasoningText(normalizedContentBody);
  let bodyParts: string[] = [];
  if (normalizedSummaryBody && normalizedContentBody) {
    if (compactSummaryBody === compactContentBody) {
      bodyParts = [normalizedContentBody];
    } else if (compactContentBody.startsWith(compactSummaryBody)) {
      bodyParts = [normalizedContentBody];
    } else if (compactSummaryBody.startsWith(compactContentBody)) {
      bodyParts = [normalizedSummaryBody];
    } else if (hasSharedReasoningClauseSuffix(normalizedSummaryBody, normalizedContentBody)) {
      bodyParts = [chooseBetterReasoningText(normalizedSummaryBody, normalizedContentBody)];
    } else {
      bodyParts = [normalizedSummaryBody, normalizedContentBody];
    }
  } else {
    bodyParts = [normalizedSummaryBody, normalizedContentBody].filter(Boolean);
  }
  const bodyText = dedupeAdjacentReasoningParagraphs(bodyParts.join("\n\n")).trim();
  const hasBody = bodyText.length > 0;
  const hasAnyText = titleSource.trim().length > 0;
  const workingLabel = hasAnyText ? summaryTitle : null;
  return {
    summaryTitle,
    bodyText,
    hasBody,
    workingLabel,
  };
}

export function isReasoningDuplicate(previous: ParsedReasoningMeta, next: ParsedReasoningMeta) {
  const previousBody = compactComparableReasoningText(previous.bodyText || "");
  const nextBody = compactComparableReasoningText(next.bodyText || "");
  if (previousBody && nextBody) {
    if (previousBody === nextBody) {
      return true;
    }
    if (previousBody.length >= 16 && nextBody.includes(previousBody)) {
      return true;
    }
    if (nextBody.length >= 16 && previousBody.includes(nextBody)) {
      return true;
    }
    return false;
  }

  const previousTitle = compactComparableReasoningText(
    previous.summaryTitle || previous.workingLabel || "",
  );
  const nextTitle = compactComparableReasoningText(
    next.summaryTitle || next.workingLabel || "",
  );

  if (!previousBody && !nextBody) {
    if (
      previousTitle &&
      nextTitle &&
      previousTitle.length >= 8 &&
      nextTitle.length >= 8
    ) {
      return previousTitle === nextTitle;
    }
    return false;
  }

  if (
    previousTitle &&
    nextTitle &&
    previousTitle.length >= 6 &&
    nextTitle.length >= 6 &&
    previousTitle !== nextTitle
  ) {
    return false;
  }

  return false;
}

export function dedupeAdjacentReasoningItems(
  list: ConversationItem[],
  reasoningMetaById: Map<string, ParsedReasoningMeta>,
  appendOnly = false,
) {
  const deduped: ConversationItem[] = [];
  for (const item of list) {
    const previous = deduped[deduped.length - 1];
    if (item.kind !== "reasoning" || previous?.kind !== "reasoning") {
      deduped.push(item);
      continue;
    }
    if (
      isExplicitReasoningSegmentId(previous.id) ||
      isExplicitReasoningSegmentId(item.id)
    ) {
      deduped.push(item);
      continue;
    }
    const previousMeta = reasoningMetaById.get(previous.id) ?? parseReasoning(previous);
    const nextMeta = reasoningMetaById.get(item.id) ?? parseReasoning(item);
    if (!isReasoningDuplicate(previousMeta, nextMeta)) {
      deduped.push(item);
      continue;
    }
    deduped[deduped.length - 1] = {
      ...item,
      summary: appendOnly
        ? appendReasoningRunText(previous.summary, item.summary)
        : chooseBetterReasoningText(previous.summary, item.summary),
      content: appendOnly
        ? appendReasoningRunText(previous.content, item.content)
        : chooseBetterReasoningText(previous.content, item.content),
    };
  }
  return deduped;
}

export const REASONING_SEGMENT_ID_REGEX = /(?:^|[:-])seg-\d+$/;

export function isExplicitReasoningSegmentId(id: string) {
  return REASONING_SEGMENT_ID_REGEX.test(id);
}

export function collapseConsecutiveReasoningRuns(
  list: ConversationItem[],
  enabled: boolean,
  appendOnly = false,
) {
  if (!enabled || list.length <= 1) {
    return list;
  }
  const collapsed: ConversationItem[] = [];
  let index = 0;
  while (index < list.length) {
    const item = list[index];
    if (!item) {
      index += 1;
      continue;
    }
    if (item.kind !== "reasoning") {
      collapsed.push(item);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < list.length) {
      const candidate = list[end];
      if (!candidate || candidate.kind !== "reasoning") {
        break;
      }
      end += 1;
    }

    if (end - index === 1) {
      collapsed.push(item);
      index = end;
      continue;
    }

    const run = list.slice(index, end) as Array<Extract<ConversationItem, { kind: "reasoning" }>>;
    const latest = run[run.length - 1];
    const first = run[0];
    if (!first || !latest) {
      index = end;
      continue;
    }
    let mergedSummary = first.summary;
    let mergedContent = first.content;
    for (let runIndex = 1; runIndex < run.length; runIndex += 1) {
      const candidate = run[runIndex];
      if (!candidate) {
        continue;
      }
      mergedSummary = mergeReasoningRunText(
        mergedSummary,
        candidate.summary,
        appendOnly,
      );
      mergedContent = mergeReasoningRunText(
        mergedContent,
        candidate.content,
        appendOnly,
      );
    }
    collapsed.push({
      ...latest,
      summary: mergedSummary,
      content: mergedContent,
    });
    index = end;
  }
  return collapsed;
}

export function appendReasoningRunText(existing: string, incoming: string) {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  const normalizedExisting = existing.trim();
  const normalizedIncoming = incoming.trim();
  const compactExisting = compactComparableReasoningText(normalizedExisting);
  const compactIncoming = compactComparableReasoningText(normalizedIncoming);
  if (!compactExisting) {
    return normalizedIncoming;
  }
  if (!compactIncoming) {
    return normalizedExisting;
  }
  if (compactExisting === compactIncoming) {
    return chooseBetterReasoningText(normalizedExisting, normalizedIncoming);
  }
  // KMP 线性重叠检测，替代逐字符递减 endsWith 的 O(n²) 扫描。
  const overlapLength = longestSuffixPrefixOverlap(compactExisting, compactIncoming);
  if (overlapLength > 0) {
    const suffix = sliceByComparableLength(normalizedIncoming, overlapLength).trimStart();
    return suffix ? `${normalizedExisting}${suffix}` : normalizedExisting;
  }
  if (shouldJoinReasoningFragmentsInline(normalizedExisting, normalizedIncoming)) {
    return `${normalizedExisting}${normalizedIncoming}`;
  }
  return `${normalizedExisting}\n\n${normalizedIncoming}`;
}

const SENTENCE_TERMINAL_RE = /[。！？.!?…]["'""「」『』）)\]]*$/;
const MARKDOWN_BLOCK_START_RE = /^(?:[-*+]\s|\d+\.\s|#{1,6}\s|```|>\s)/;
const CONTINUATION_PUNCT_RE = /^[，,、；;：:）)】\]》>'"''""\-–—]/;
const LATIN_WORD_END_RE = /[A-Za-z0-9]$/;

function isIsolatedReasoningFragmentShell(text: string) {
  if (/^[，,、；;：:\-–—。！？.!?'"''""）)】\]》>]+$/.test(text)) {
    return true;
  }
  return text.length <= 2 && /^[\u3400-\u9fff]+$/.test(text);
}

function shouldJoinReasoningFragmentsInline(existing: string, incoming: string) {
  if (!existing || !incoming) {
    return false;
  }
  if (MARKDOWN_BLOCK_START_RE.test(incoming)) {
    return false;
  }
  if (SENTENCE_TERMINAL_RE.test(existing)) {
    return false;
  }
  if (CONTINUATION_PUNCT_RE.test(incoming) || isIsolatedReasoningFragmentShell(existing)) {
    return true;
  }
  return LATIN_WORD_END_RE.test(existing) && /^[a-z]{1,12}$/.test(incoming);
}

export function mergeReasoningRunText(
  existing: string,
  incoming: string,
  appendOnly = false,
) {
  if (appendOnly) {
    return appendReasoningRunText(existing, incoming);
  }
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  const normalizedExisting = existing.trim();
  const normalizedIncoming = incoming.trim();
  const compactExisting = compactComparableReasoningText(normalizedExisting);
  const compactIncoming = compactComparableReasoningText(normalizedIncoming);
  if (!compactExisting) {
    return normalizedIncoming;
  }
  if (!compactIncoming) {
    return normalizedExisting;
  }
  if (compactExisting === compactIncoming) {
    return chooseBetterReasoningText(normalizedExisting, normalizedIncoming);
  }
  if (compactIncoming.includes(compactExisting)) {
    return normalizedIncoming;
  }
  if (compactExisting.includes(compactIncoming)) {
    return normalizedExisting;
  }
  return `${normalizedExisting}\n\n${normalizedIncoming}`;
}

export function inferReasoningPresentationEngine(threadId: string) {
  if (threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")) {
    return "claude";
  }
  if (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")) {
    return "opencode";
  }
  if (threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")) {
    return "gemini";
  }
  if (threadId.startsWith("grok:") || threadId.startsWith("grok-pending-")) {
    return "grok";
  }
  if (threadId.startsWith("kimi:") || threadId.startsWith("kimi-pending-")) {
    return "kimi";
  }
  if (threadId.startsWith("dsh:") || threadId.startsWith("dsh-pending-")) {
    return "dsh";
  }
  if (threadId.startsWith("pi:") || threadId.startsWith("pi-pending-")) {
    return "pi";
  }
  if (threadId.startsWith("omp:") || threadId.startsWith("omp-pending-")) {
    return "omp";
  }
  if (threadId.startsWith("qoder:") || threadId.startsWith("qoder-pending-")) {
    return "qoder";
  }
  return "codex";
}

export function normalizeReasoningItemsForTimeline(threadId: string, items: ConversationItem[]) {
  const sourceReasoningMetaById = new Map<string, ParsedReasoningMeta>();
  const filtered = items.filter((item) => {
    if (item.kind !== "reasoning") {
      return true;
    }
    const parsed = parseReasoning(item);
    sourceReasoningMetaById.set(item.id, parsed);
    return parsed.hasBody || Boolean(parsed.workingLabel);
  });
  const engine = inferReasoningPresentationEngine(threadId);
  const appendReasoningRuns = engine === "claude" || engine === "codex" || engine === "gemini" || engine === "grok" || engine === "kimi" || engine === "dsh" || engine === "pi" || engine === "omp" || engine === "qoder";
  const deduped = dedupeAdjacentReasoningItems(
    filtered,
    sourceReasoningMetaById,
    appendReasoningRuns,
  );
  const collapseReasoningRuns =
    engine === "claude" || engine === "codex" || engine === "opencode" || engine === "gemini" || engine === "grok" || engine === "kimi" || engine === "pi" || engine === "omp" || engine === "qoder";
  const normalized = collapseConsecutiveReasoningRuns(
    deduped,
    collapseReasoningRuns,
    appendReasoningRuns,
  );
  const reasoningMetaById = new Map<string, ParsedReasoningMeta>();
  normalized.forEach((item) => {
    if (item.kind !== "reasoning") {
      return;
    }
    reasoningMetaById.set(item.id, parseReasoning(item));
  });
  return {
    items: normalized,
    reasoningMetaById,
  };
}
