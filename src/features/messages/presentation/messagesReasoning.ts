import type { ConversationItem } from "../../../types";
import { longestSuffixPrefixOverlap } from "../../../utils/stringOverlap";
import type { ConversationEngine } from "../../threads/contracts/conversationCurtainContracts";

const PARAGRAPH_BREAK_SPLIT_REGEX = /\r?\n[^\S\r\n]*\r?\n+/;
const REASONING_SEGMENT_ID_REGEX = /(?:^|[:-])seg-(\d+)$/;

type ReasoningConversationItem = Extract<ConversationItem, { kind: "reasoning" }>;

function sanitizeReasoningTitle(title: string) {
  return title
    .replace(/[`*_~]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .trim();
}

function compactReasoningText(value: string) {
  return value.replace(/\s+/g, "");
}

// streaming 期间同一段 reasoning 文本会被反复 compact（每次 delta flush 都要跑 5 个全文正则），
// 用有界缓存把重复输入的成本降为一次 Map 查找。
const COMPACT_CACHE_MAX_ENTRIES = 256;
const compactComparableCache = new Map<string, string>();

export function compactComparableReasoningText(value: string) {
  if (value.length === 0) {
    return "";
  }
  const cached = compactComparableCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const result = compactReasoningText(value)
    .replace(/[！!]/g, "!")
    .replace(/[？?]/g, "?")
    .replace(/[，,]/g, ",")
    .replace(/[。．.]/g, ".");
  if (compactComparableCache.size >= COMPACT_CACHE_MAX_ENTRIES) {
    compactComparableCache.clear();
  }
  compactComparableCache.set(value, result);
  return result;
}

function sliceByComparableLength(text: string, targetLength: number) {
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

function shouldStripSingleLineReasoningPrefix(remainder: string) {
  const normalized = remainder.trimStart();
  return /^[([{（【]?(?:\d+[.)、]|[-*•])\s*/.test(normalized);
}

function stripLeadingReasoningTitleOverlap(
  content: string,
  candidates: string[],
  allowSingleLinePrefixStrip = false,
) {
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
      const stripped = trimmedContent
        .slice(candidate.length)
        .replace(/^[\s，。！？!?:：;；、-]+/, "")
        .trim();
      if (!stripped) {
        return trimmedContent;
      }
      if (
        allowSingleLinePrefixStrip ||
        shouldStripSingleLineReasoningPrefix(stripped)
      ) {
        return stripped;
      }
      return trimmedContent;
    }
  }

  const compactContent = compactComparableReasoningText(trimmedContent);
  for (const candidate of normalizedCandidates) {
    const compactCandidate = compactComparableReasoningText(candidate);
    if (!compactCandidate || compactCandidate.length < 8) {
      continue;
    }
    if (compactContent === compactCandidate) {
      return trimmedContent;
    }
    if (compactContent.startsWith(compactCandidate)) {
      const sliced = sliceByComparableLength(trimmedContent, compactCandidate.length);
      const stripped = sliced.replace(/^[\s，。！？!?:：;；、-]+/, "").trim();
      if (!stripped) {
        return trimmedContent;
      }
      if (
        allowSingleLinePrefixStrip ||
        shouldStripSingleLineReasoningPrefix(stripped)
      ) {
        return stripped;
      }
      return trimmedContent;
    }
  }

  return trimmedContent;
}

function splitComparableReasoningClauses(value: string) {
  return value
    .split(/[。！？!?；;\n]+/)
    .map((entry) => compactComparableReasoningText(entry.trim()))
    .filter((entry) => entry.length >= 6);
}

function hasSharedReasoningClauseSuffix(left: string, right: string) {
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

function dedupeAdjacentReasoningParagraphs(value: string) {
  const collapseRepeatedParagraph = (paragraph: string) => {
    const trimmed = paragraph.trim();
    if (trimmed.length < 12) {
      return trimmed;
    }
    // 回溯型正则对长段落是 O(n²)：超过阈值时跳过（下方 compact 半折检查覆盖整段重复场景）。
    if (trimmed.length <= 4096) {
      const directRepeat = trimmed.match(/^([\s\S]{6,}?)\s+\1$/);
      if (directRepeat?.[1]) {
        return directRepeat[1].trim();
      }
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

function scoreReasoningTextQuality(value: string) {
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

function chooseBetterReasoningText(left: string, right: string) {
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

function isGenericReasoningTitle(title: string) {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[.:：。!！]+$/g, "");
  return (
    normalized === "reasoning" ||
    normalized === "thinking" ||
    normalized === "planning" ||
    normalized === "思考" ||
    normalized === "思考中" ||
    normalized === "正在思考" ||
    normalized === "正在规划"
  );
}

export type ParsedReasoning = {
  summaryTitle: string;
  bodyText: string;
  hasBody: boolean;
  workingLabel: string | null;
};

// reducer 对 item 做不可变更新：引用不变 => summary/content 不变。
// 按引用缓存解析结果，除了避免全量重算，还让下游 memo 组件（如 ReasoningRow 的 parsed prop）
// 在 item 未变化时拿到稳定引用，从而跳过重渲染。
const parsedReasoningCache = new WeakMap<ReasoningConversationItem, ParsedReasoning>();

export function parseReasoning(item: ReasoningConversationItem): ParsedReasoning {
  const cached = parsedReasoningCache.get(item);
  if (cached) {
    return cached;
  }
  const parsed = parseReasoningUncached(item);
  parsedReasoningCache.set(item, parsed);
  return parsed;
}

function parseReasoningUncached(item: ReasoningConversationItem): ParsedReasoning {
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
  const allowSingleLinePrefixStrip =
    normalizedSummaryBody.length > 0 ||
    summary.includes("\n") ||
    (!hasSummary && contentBody.includes("\n"));
  const normalizedContentBody = stripLeadingReasoningTitleOverlap(
    contentBody,
    [rawTitle, cleanTitle, normalizedSummaryBody],
    allowSingleLinePrefixStrip,
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

function isGenericPlaceholderReasoningItem(item: ReasoningConversationItem) {
  const label = (item.summary || item.content || "").trim();
  if (!label || !isGenericReasoningTitle(label)) {
    return false;
  }
  const content = (item.content || "").trim();
  if (!content) {
    return true;
  }
  const compactLabel = compactComparableReasoningText(label);
  const compactContent = compactComparableReasoningText(content);
  if (!compactContent) {
    return true;
  }
  return compactContent === compactLabel || isGenericReasoningTitle(content);
}

function isReasoningDuplicate(previous: ParsedReasoning, next: ParsedReasoning) {
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

/**
 * A4 思考外置后，collapse 看到的经常是建壳首 token（`，` / `token` / `-meter`）。
 * 这些碎片用 `\n\n` 拼接会变成独立段落；句子已经结束的两段思考仍走段落分隔。
 */
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
  // 只粘词中后缀（token+ization）。完整英文词带空格的下一段仍走段落分隔。
  return LATIN_WORD_END_RE.test(existing) && /^[a-z]{1,12}$/.test(incoming);
}

function mergeReasoningRunText(
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

export function isExplicitReasoningSegmentId(id: string) {
  return REASONING_SEGMENT_ID_REGEX.test(id);
}

export function reasoningSegmentNumber(id: string) {
  const match = REASONING_SEGMENT_ID_REGEX.exec(id);
  return match?.[1] ? Number(match[1]) : null;
}

export function dedupeAdjacentReasoningItems(
  list: ConversationItem[],
  reasoningMetaById: Map<string, ParsedReasoning>,
  appendOnly = false,
  engine: ConversationEngine = "codex",
) {
  const deduped: ConversationItem[] = [];
  for (const item of list) {
    const previous = deduped[deduped.length - 1];
    if (item.kind !== "reasoning" || previous?.kind !== "reasoning") {
      deduped.push(item);
      continue;
    }
    // 段号不同 = 中间发生过工具调用，保持分开；同段的相邻思考走正常去重/合并。
    if (reasoningSegmentNumber(previous.id) !== reasoningSegmentNumber(item.id)) {
      if (engine === "gemini" || engine === "grok" || engine === "kimi" || engine === "opencode" || engine === "dsh" || engine === "pi" || engine === "omp" || engine === "qoder") {
        if (
          isGenericPlaceholderReasoningItem(previous) &&
          isGenericPlaceholderReasoningItem(item)
        ) {
          deduped[deduped.length - 1] = item;
          continue;
        }
      }
      deduped.push(item);
      continue;
    }
    const previousMeta =
      reasoningMetaById.get(previous.id) ?? parseReasoning(previous);
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

function isReasoningConversationItem(
  item: ConversationItem | undefined,
): item is ReasoningConversationItem {
  return item?.kind === "reasoning";
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
    if (!isReasoningConversationItem(item)) {
      collapsed.push(item);
      index += 1;
      continue;
    }

    // 相邻 reasoning 一律合并为一块 UI（换行拼接正文）。
    // 中间若有 tool / message / explore 等会自然打断；不再按 seg-N 拆分，
    // 避免「无工具夹在中间却出现连续多个思考过程卡片」的碎片化展示。
    let end = index + 1;
    while (end < list.length) {
      const candidate = list[end];
      if (!isReasoningConversationItem(candidate)) {
        break;
      }
      end += 1;
    }

    if (end - index === 1) {
      collapsed.push(item);
      index = end;
      continue;
    }

    const run = list.slice(index, end) as ReasoningConversationItem[];
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
