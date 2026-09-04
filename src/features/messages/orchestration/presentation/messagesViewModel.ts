import type { ConversationItem, RequestUserInputRequest } from "../../../../types";
import type { PresentationProfile } from "../../../../conversation-presentation/presentationProfile";
import {
  groupToolItems,
  shouldHideToolItemForRender,
  type GroupedEntry,
} from "../../utils/groupToolItems";
import type { MessagesEngine } from "../../utils/messagesRenderUtils";
import {
  countRenderableCollapsedEntries,
  filterCanvasHiddenProcessTools,
  scrollKeyForItems,
  shouldHideCodexCanvasCommandCard,
  toConversationEngine,
} from "../../utils/messagesRenderUtils";
import {
  collapseConsecutiveReasoningRuns,
  dedupeAdjacentReasoningItems,
  isExplicitReasoningSegmentId,
  parseReasoning,
} from "../../presentation/messagesReasoning";
import { filterMultiAgentCanvasItems } from "../../../multi-agent/utils/canvasItems";

export type MessageActionTargets = {
  targetByAssistantId: Map<string, string>;
  copyTextByAssistantId: Map<string, string>;
  latestFinalAssistantMessageId: string | null;
  latestUserMessageId: string | null;
  // 最近一条用户消息之后尚无最终回复 = 有新回合正在进行中。
  hasPendingUserTurn: boolean;
  userMessageCount: number;
};

/** 只有尾部最新用户消息 id 变了才算新发送。prepend 旧历史会涨 count，不得当发送。 */
export function isNewTailUserMessage(
  previousLatestUserMessageId: string | null,
  nextLatestUserMessageId: string | null,
): boolean {
  return (
    nextLatestUserMessageId != null &&
    nextLatestUserMessageId !== previousLatestUserMessageId
  );
}

export type HistoryExpansionScrollSnapshot = {
  scrollHeight: number;
  scrollTop: number;
};

export type PreservedReadableWindow = {
  workspaceId: string | null;
  threadId: string | null;
  turnId: string | null;
  renderedItems: ConversationItem[];
  visibleCollapsedHistoryItemCount: number;
};

/**
 * One causal process phase: the contiguous tool/reasoning/explore run that
 * immediately precedes an assistant prose message.
 *
 * Timeline shape:
 *   user → [process…] → assistant text A → [process…] → assistant text B → [open process…]
 * Each completed process run becomes a drawer above its own prose:
 *   [header chip] → [process body…] → assistant text
 * Intermediate assistant text is a segment boundary, not a hole to walk across.
 */
export type ProcessPhaseBreakdown = {
  reasoningCount: number;
  toolCount: number;
  exploreCount: number;
  /** 极简展示 turn chip 统计：被折叠的中间叙述 prose 段数（默认模式恒 0）。 */
  proseCount: number;
};

export type ProcessPhaseCollapse = {
  phaseKey: string;
  assistantItemId: string;
  /**
   * Insert the drawer header immediately before this process item
   * (first tool/reasoning/explore of the phase) so collapse stays at the top.
   */
  insertBeforeItemId: string;
  /**
   * Trailing live phase has no assistant prose: collapsed header sits
   * immediately before this still-visible tail item.
   */
  collapsedAnchorItemId?: string;
  count: number;
  breakdown: ProcessPhaseBreakdown;
  durationMs: number | null;
  expanded: boolean;
  hiddenItemIds: readonly string[];
};

export type CollapsedTimelineItemsResult = {
  timelineItems: ConversationItem[];
  phases: ProcessPhaseCollapse[];
};

function emptyCollapsedTimelineResult(
  timelineSourceItems: ConversationItem[],
): CollapsedTimelineItemsResult {
  return {
    timelineItems: timelineSourceItems,
    phases: [],
  };
}

function isAssistantMessageWithVisibleText(item: ConversationItem): boolean {
  return (
    item.kind === "message" &&
    item.role === "assistant" &&
    item.text.trim().length > 0
  );
}

/** Process items that can form a causal phase above assistant prose. */
function isCollapsibleProcessItem(item: ConversationItem): boolean {
  // BackgroundTaskCard has its own fold control. Keep the card mounted so its
  // completion receipt remains anchored beside it in minimal transcript mode.
  if (item.kind === "tool" && item.toolType === "backgroundTask") {
    return false;
  }
  // SubAgent 小队卡与其它 tool 一样参与 process-phase 折叠：
  // 收起时 hard-unmount 进「已处理」chip，展开后落在折叠区域内，
  // 禁止再钉在 chip 外侧单独占位。
  return (
    item.kind === "tool" ||
    item.kind === "reasoning" ||
    item.kind === "explore"
  );
}

function resolvePhaseDurationMs(items: readonly ConversationItem[]): number | null {
  let total = 0;
  let hasDuration = false;
  for (const item of items) {
    if (item.kind === "tool" && typeof item.durationMs === "number" && item.durationMs >= 0) {
      total += item.durationMs;
      hasDuration = true;
    }
  }
  return hasDuration ? total : null;
}

function resolvePhaseBreakdown(
  items: readonly ConversationItem[],
  activeEngine: MessagesEngine,
): ProcessPhaseBreakdown {
  let reasoningCount = 0;
  let toolCount = 0;
  let exploreCount = 0;
  for (const item of items) {
    if (item.kind === "reasoning") {
      reasoningCount += 1;
    } else if (item.kind === "tool") {
      // Chip numbers must match visible tools only (hidden shell excluded).
      if (!shouldHideCodexCanvasCommandCard(item, activeEngine)) {
        toolCount += 1;
      }
    } else if (item.kind === "explore") {
      exploreCount += 1;
    }
  }
  return { reasoningCount, toolCount, exploreCount, proseCount: 0 };
}

export function findItemById(items: ConversationItem[], itemId: string | null) {
  if (!itemId) {
    return null;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.id === itemId) {
      return item;
    }
  }
  return null;
}

export function readHistoryExpansionScrollSnapshot(
  container: HTMLDivElement | null,
): HistoryExpansionScrollSnapshot | null {
  if (!container) {
    return null;
  }
  const { scrollHeight, scrollTop } = container;
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(scrollTop)) {
    return null;
  }
  return { scrollHeight, scrollTop };
}

export function restoreHistoryExpansionScrollPosition(
  container: HTMLDivElement,
  snapshot: HistoryExpansionScrollSnapshot,
) {
  const currentScrollHeight = container.scrollHeight;
  if (!Number.isFinite(currentScrollHeight)) {
    return false;
  }
  const scrollHeightDelta = currentScrollHeight - snapshot.scrollHeight;
  const nextScrollTop = snapshot.scrollTop + scrollHeightDelta;
  if (!Number.isFinite(nextScrollTop)) {
    return false;
  }
  container.scrollTop = Math.max(0, nextScrollTop);
  return true;
}

export function findLatestAssistantTextLength(items: ConversationItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item || item.kind !== "message" || item.role !== "assistant") {
      continue;
    }
    return item.text.length;
  }
  return 0;
}

export function mergeReadableRecoveryItems(
  preservedItems: ConversationItem[],
  currentItems: ConversationItem[],
) {
  if (currentItems.length === 0) {
    return preservedItems;
  }
  const preservedItemIds = new Set(preservedItems.map((item) => item.id));
  const appendedCurrentItems = currentItems.filter((item) => !preservedItemIds.has(item.id));
  return appendedCurrentItems.length > 0
    ? [...preservedItems, ...appendedCurrentItems]
    : preservedItems;
}

export function buildMessageActionTargets(items: ConversationItem[]): MessageActionTargets {
  const targetByAssistantId = new Map<string, string>();
  const copyTextByAssistantId = new Map<string, string>();
  let latestUserMessageId: string | null = null;
  let latestFinalAssistantMessageId: string | null = null;
  let hasPendingUserTurn = false;
  let userMessageCount = 0;
  let assistantTurnTextParts: string[] = [];
  for (const item of items) {
    if (item.kind !== "message") {
      continue;
    }
    if (item.role === "user") {
      userMessageCount += 1;
      latestUserMessageId = item.id;
      hasPendingUserTurn = true;
      assistantTurnTextParts = [];
      continue;
    }
    if (item.role !== "assistant") {
      continue;
    }
    if (latestUserMessageId) {
      targetByAssistantId.set(item.id, latestUserMessageId);
    }
    assistantTurnTextParts.push(item.text);
    if (item.isFinal === true) {
      latestFinalAssistantMessageId = item.id;
      hasPendingUserTurn = false;
      copyTextByAssistantId.set(item.id, assistantTurnTextParts.join("\n\n"));
      assistantTurnTextParts = [];
    }
  }
  return {
    targetByAssistantId,
    copyTextByAssistantId,
    latestFinalAssistantMessageId,
    latestUserMessageId,
    hasPendingUserTurn,
    userMessageCount,
  };
}

export function resolveActiveUserInputRequest(options: {
  requests: RequestUserInputRequest[];
  threadId: string | null;
  workspaceId: string | null | undefined;
}) {
  const { requests, threadId, workspaceId } = options;
  if (!threadId || requests.length === 0) {
    return null;
  }
  return requests.find(
    (request) =>
      request.params.thread_id === threadId &&
      (!workspaceId || request.workspace_id === workspaceId),
  ) ?? null;
}

export function buildMessagesScrollKey(
  items: ConversationItem[],
  activeUserInputRequestId: string | number | null,
) {
  return `${scrollKeyForItems(items)}-${activeUserInputRequestId ?? "no-input"}`;
}



export function resolveActiveMessageAnchor(
  container: HTMLDivElement | null,
  messageNodeById: Map<string, HTMLDivElement>,
) {
  if (!container) {
    return null;
  }
  const containerRect = container.getBoundingClientRect();
  const viewportAnchorY =
    containerRect.top + Math.min(96, container.clientHeight * 0.32);
  let bestId: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [messageId, node] of messageNodeById) {
    const distance = Math.abs(node.getBoundingClientRect().top - viewportAnchorY);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = messageId;
    }
  }
  return bestId;
}

export function resolveVisibleMessageItems(options: {
  items: ConversationItem[];
  activeEngine: MessagesEngine;
  hideClaudeReasoning: boolean;
  latestTitleOnlyReasoningId: string | null;
  presentationProfile: PresentationProfile | null;
  reasoningMetaById: Map<string, ReturnType<typeof parseReasoning>>;
}) {
  const {
    items,
    activeEngine,
    hideClaudeReasoning,
    latestTitleOnlyReasoningId,
    presentationProfile,
    reasoningMetaById,
  } = options;
  // Multi-Agent：吞 durable settle 摘要气泡 + 同一 run 双轨 user 去重
  const canvasSourceItems = filterMultiAgentCanvasItems(items);
  const filtered = canvasSourceItems.filter((item) => {
    if (
      (activeEngine === "codex" || activeEngine === "claude") &&
      item.kind === "explore" &&
      item.status === "exploring"
    ) {
      return false;
    }
    if (hideClaudeReasoning && item.kind === "reasoning") {
      return false;
    }
    if (item.kind === "tool" && shouldHideToolItemForRender(item)) {
      return false;
    }
    if (item.kind !== "reasoning") {
      return true;
    }
    const parsed = reasoningMetaById.get(item.id);
    const hasBody = parsed?.hasBody ?? false;
    if (hasBody) {
      return true;
    }
    if (!parsed?.workingLabel) {
      return false;
    }
    if (
      (activeEngine === "gemini" || activeEngine === "grok" || activeEngine === "kimi" || activeEngine === "opencode" || activeEngine === "dsh") &&
      isExplicitReasoningSegmentId(item.id)
    ) {
      return true;
    }
    if (activeEngine === "claude") {
      return true;
    }
    const keepTitleOnlyReasoning = presentationProfile
      ? presentationProfile.showReasoningLiveDot
      : activeEngine === "codex";
    return keepTitleOnlyReasoning || item.id === latestTitleOnlyReasoningId;
  });
  // Shell/bash 在幕布上永久隐藏，但若仍留在 list 里会把相邻思考拆成多卡。
  // 必须先丢掉这些不可见工具，再做相邻 reasoning 合并——对话中与完成后同一条路径。
  const canvasVisible = filterCanvasHiddenProcessTools(filtered, activeEngine);
  const appendReasoningRuns =
    activeEngine === "claude" || activeEngine === "gemini" || activeEngine === "grok" || activeEngine === "kimi" || activeEngine === "opencode" || activeEngine === "dsh" || activeEngine === "pi" || activeEngine === "omp" || activeEngine === "qoder";
  const deduped = dedupeAdjacentReasoningItems(
    canvasVisible,
    reasoningMetaById,
    appendReasoningRuns,
    toConversationEngine(activeEngine),
  );
  // codex 也合并相邻思考块（与 session-activity 面板行为一致），中间有可见工具调用会自然断开。
  return collapseConsecutiveReasoningRuns(deduped, true, appendReasoningRuns);
}

function isUserMessageItem(item: ConversationItem): boolean {
  return item.kind === "message" && item.role === "user";
}

/**
 * Collect the contiguous process run immediately above one assistant prose.
 *
 * Walk-back stops at the first non-process item (user, another assistant
 * segment, or any other non-collapsible row). Earlier process in the same
 * user turn stays with the assistant it actually precedes.
 *
 * Claude live may reuse one id for the dual reasoning/assistant surface;
 * that shared-identity process is the same UI unit and must not fold.
 */
function collectContiguousProcessItemsForAssistant(
  canvasItems: readonly ConversationItem[],
  assistantIndex: number,
): ConversationItem[] {
  const assistant = canvasItems[assistantIndex];
  if (!assistant || !isAssistantMessageWithVisibleText(assistant)) {
    return [];
  }

  let phaseStart = assistantIndex;
  for (let cursor = assistantIndex - 1; cursor >= 0; cursor -= 1) {
    const previous = canvasItems[cursor];
    if (!previous || !isCollapsibleProcessItem(previous)) {
      break;
    }
    phaseStart = cursor;
  }
  if (phaseStart >= assistantIndex) {
    return [];
  }

  const phaseItems: ConversationItem[] = [];
  for (let cursor = phaseStart; cursor < assistantIndex; cursor += 1) {
    const candidate = canvasItems[cursor];
    if (!candidate || !isCollapsibleProcessItem(candidate)) {
      continue;
    }
    if (candidate.id === assistant.id) {
      continue;
    }
    phaseItems.push(candidate);
  }
  return phaseItems;
}

const TRAILING_PROCESS_COLLAPSE_THRESHOLD = 5;
const TRAILING_PROCESS_VISIBLE_TAIL_COUNT = 3;
/** 极简展示 live turn 专用 trailing 阈值（默认模式保持 5，零回归）。 */
const MINIMAL_TRANSCRIPT_TRAILING_COLLAPSE_THRESHOLD = 4;

function groupedEntryProcessItems(entry: GroupedEntry): ConversationItem[] {
  return entry.kind === "item" ? [entry.item] : [...entry.items];
}

/**
 * Collapse only the process run that immediately precedes each assistant prose
 * message. Trailing process without following text stays expanded until it
 * exceeds the rolling card window.
 *
 * This is causal grouping, not whole-turn aggregation:
 * tools above text A collapse into a chip above A; tools above text B into a
 * separate chip above B.
 *
 * Performance model (hard unmount):
 * - Live open process (no following prose yet): fully mounted.
 * - After prose lands and that phase collapses: process rows are removed from
 *   the timeline (summary chip only) so React trees are freed.
 * - User expands a phase: process rows remount (no long-lived instance cache).
 */
export function resolveCollapsedTimelineItems(options: {
  activeEngine: MessagesEngine;
  /** @deprecated ignored — phase collapse is always on */
  collapseLiveMiddleStepsEnabled?: boolean;
  /** Phase keys currently expanded by the user (usually assistant item ids). */
  expandedPhaseKeys?: ReadonlySet<string>;
  /** @deprecated ignored — expand is per-phase */
  expandMiddleSteps?: boolean;
  isThinking?: boolean;
  latestAssistantMessageId?: string | null;
  latestReasoningId?: string | null;
  /** 极简展示：已完成 turn 整段折叠为单个 turn chip（含中间叙述 prose）。 */
  minimalTranscriptEnabled?: boolean;
  timelineSourceItems: ConversationItem[];
}): CollapsedTimelineItemsResult {
  const {
    activeEngine,
    expandedPhaseKeys = new Set<string>(),
    isThinking = false,
    minimalTranscriptEnabled = false,
    timelineSourceItems,
  } = options;
  // Shell/command tools stay off the canvas permanently (not only when collapsed)
  // so phase expand never remounts hundreds of bash rows. File read/write remain.
  // 再次合并：若上游未先滤 shell，隐藏后相邻的思考仍需收成一块（展开 phase 时一致）。
  const canvasItems = collapseConsecutiveReasoningRuns(
    filterCanvasHiddenProcessTools(timelineSourceItems, activeEngine),
    true,
    activeEngine === "claude" ||
      activeEngine === "gemini" ||
      activeEngine === "grok" ||
      activeEngine === "kimi" ||
      activeEngine === "opencode" ||
      activeEngine === "dsh",
  );
  if (canvasItems.length <= 2) {
    return emptyCollapsedTimelineResult(canvasItems);
  }
  if (minimalTranscriptEnabled) {
    return resolveMinimalTranscriptCollapsedTimeline({
      activeEngine,
      canvasItems,
      expandedPhaseKeys,
      isThinking,
    });
  }
  return collectProcessPhaseCollapsedTimeline({
    activeEngine,
    canvasItems,
    expandedPhaseKeys,
  });
}

/**
 * per-phase 折叠收集（默认模式形态）：对给定 items 逐条 assistant prose 收前序
 * 过程为 chip，并对尾部超限过程收 trailing chip。phases / unmountedItemIds 由
 * 调用方提供，极简模式展开 turn 时复用同一渲染形态（内层 chip 与默认模式一致）。
 */
function collectPerPhaseCollapsedInto(options: {
  activeEngine: MessagesEngine;
  items: ConversationItem[];
  expandedPhaseKeys: ReadonlySet<string>;
  phases: ProcessPhaseCollapse[];
  unmountedItemIds: Set<string>;
}): void {
  const { activeEngine, items, expandedPhaseKeys, phases, unmountedItemIds } =
    options;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || !isAssistantMessageWithVisibleText(item)) {
      continue;
    }

    const phaseItems = collectContiguousProcessItemsForAssistant(items, index);
    if (phaseItems.length === 0) {
      continue;
    }
    const renderableCount = countRenderableCollapsedEntries(
      phaseItems,
      activeEngine,
    );
    // Empty phases stay expanded on the surface. Single-step process — including
    // lone reasoning ("思考过程") — still folds into the chip so Native/Shared
    // match the clean "已处理 · 思考 1 次" shape.
    if (renderableCount < 1) {
      continue;
    }

    const phaseKey = item.id;
    const expanded = expandedPhaseKeys.has(phaseKey);
    const firstProcessItem = phaseItems[0];
    if (!firstProcessItem) {
      continue;
    }
    const hiddenItemIds = phaseItems.map((phaseItem) => phaseItem.id);
    // Hard unmount when collapsed: drop process rows so tool/reasoning trees free.
    if (!expanded) {
      for (const hiddenId of hiddenItemIds) {
        unmountedItemIds.add(hiddenId);
      }
    }
    phases.push({
      phaseKey,
      assistantItemId: item.id,
      insertBeforeItemId: firstProcessItem.id,
      count: renderableCount,
      breakdown: resolvePhaseBreakdown(phaseItems, activeEngine),
      durationMs: resolvePhaseDurationMs(phaseItems),
      expanded,
      hiddenItemIds,
    });
  }

  let trailingBoundaryIndex = -1;
  for (let cursor = items.length - 1; cursor >= 0; cursor -= 1) {
    const candidate = items[cursor];
    if (!candidate) {
      continue;
    }
    if (
      isUserMessageItem(candidate) ||
      isAssistantMessageWithVisibleText(candidate)
    ) {
      trailingBoundaryIndex = cursor;
      break;
    }
  }
  const trailingProcessItems = items
    .slice(trailingBoundaryIndex + 1)
    .filter(isCollapsibleProcessItem);
  const trailingEntries = groupToolItems(trailingProcessItems);
  if (trailingEntries.length > TRAILING_PROCESS_COLLAPSE_THRESHOLD) {
    const hiddenTrailingItems = trailingEntries
      .slice(0, trailingEntries.length - TRAILING_PROCESS_VISIBLE_TAIL_COUNT)
      .flatMap(groupedEntryProcessItems);
    const firstVisibleTailEntry =
      trailingEntries[
        trailingEntries.length - TRAILING_PROCESS_VISIBLE_TAIL_COUNT
      ];
    const firstVisibleTailItem = firstVisibleTailEntry
      ? groupedEntryProcessItems(firstVisibleTailEntry)[0]
      : undefined;
    const trailingCount = countRenderableCollapsedEntries(
      hiddenTrailingItems,
      activeEngine,
    );
    const firstHiddenItem = hiddenTrailingItems[0];
    if (firstHiddenItem && firstVisibleTailItem && trailingCount >= 1) {
      const boundaryItem = items[trailingBoundaryIndex];
      const phaseKey = `trailing:${boundaryItem?.id ?? "start"}`;
      const trailingExpanded = expandedPhaseKeys.has(phaseKey);
      if (!trailingExpanded) {
        for (const hiddenItem of hiddenTrailingItems) {
          unmountedItemIds.add(hiddenItem.id);
        }
      }
      phases.push({
        phaseKey,
        assistantItemId: phaseKey,
        insertBeforeItemId: firstHiddenItem.id,
        collapsedAnchorItemId: firstVisibleTailItem.id,
        count: trailingCount,
        breakdown: resolvePhaseBreakdown(hiddenTrailingItems, activeEngine),
        durationMs: resolvePhaseDurationMs(hiddenTrailingItems),
        expanded: trailingExpanded,
        hiddenItemIds: hiddenTrailingItems.map((hiddenItem) => hiddenItem.id),
      });
    }
  }
}

/**
 * 默认模式：per-phase 折叠（既有行为，逻辑逐行保持，仅从
 * resolveCollapsedTimelineItems 原函数体平移）。
 */
function collectProcessPhaseCollapsedTimeline(options: {
  activeEngine: MessagesEngine;
  canvasItems: ConversationItem[];
  expandedPhaseKeys: ReadonlySet<string>;
}): CollapsedTimelineItemsResult {
  const { activeEngine, canvasItems, expandedPhaseKeys } = options;
  const phases: ProcessPhaseCollapse[] = [];
  const unmountedItemIds = new Set<string>();
  collectPerPhaseCollapsedInto({
    activeEngine,
    items: canvasItems,
    expandedPhaseKeys,
    phases,
    unmountedItemIds,
  });

  if (phases.length === 0) {
    return emptyCollapsedTimelineResult(canvasItems);
  }

  if (unmountedItemIds.size === 0) {
    return {
      timelineItems: canvasItems,
      phases,
    };
  }

  return {
    timelineItems: canvasItems.filter((item) => !unmountedItemIds.has(item.id)),
    phases,
  };
}

/**
 * 极简展示：按 user 消息切 turn，把每个已完成 turn 的「过程 + 中间叙述 prose」
 * 整段折叠为单个 turn chip，锚定在该 turn 最终回答 prose 上方（复用投影层
 * `phaseByAssistantId` 折叠放置路径，投影零改动）。
 * 尾部活跃 turn（isThinking）走 foldLiveTurn：已落定过程与中间叙述实时折成
 * 单个 live turn chip，只保留生长中的 prose 与尾部滚动窗口可见。
 */
function resolveMinimalTranscriptCollapsedTimeline(options: {
  activeEngine: MessagesEngine;
  canvasItems: ConversationItem[];
  expandedPhaseKeys: ReadonlySet<string>;
  isThinking: boolean;
}): CollapsedTimelineItemsResult {
  const { activeEngine, canvasItems, expandedPhaseKeys, isThinking } = options;
  const phases: ProcessPhaseCollapse[] = [];
  const unmountedItemIds = new Set<string>();

  const foldCompletedTurn = (
    segmentItems: ConversationItem[],
    legacyExpandedKeys?: readonly string[],
  ) => {
    if (segmentItems.length === 0) {
      return;
    }
    const proseItems = segmentItems.filter(isAssistantMessageWithVisibleText);
    if (proseItems.length === 0) {
      // 无 prose turn（纯工具/错误收尾）：不折叠、不产空 chip。
      return;
    }
    let finalAnchor = proseItems.at(-1);
    for (let index = proseItems.length - 1; index >= 0; index -= 1) {
      const candidate = proseItems[index];
      if (
        candidate &&
        candidate.kind === "message" &&
        candidate.isFinal === true
      ) {
        finalAnchor = candidate;
        break;
      }
    }
    if (!finalAnchor) {
      return;
    }
    // 只隐藏 process + 中间叙述 prose；其它类型（如系统提示）保持可见。
    const hiddenItems = segmentItems.filter(
      (item) =>
        item.id !== finalAnchor.id &&
        (isCollapsibleProcessItem(item) ||
          isAssistantMessageWithVisibleText(item)),
    );
    if (hiddenItems.length === 0) {
      return;
    }
    const hiddenProseItems = hiddenItems.filter(
      isAssistantMessageWithVisibleText,
    );
    const processItems = hiddenItems.filter(isCollapsibleProcessItem);
    const count =
      countRenderableCollapsedEntries(processItems, activeEngine) +
      hiddenProseItems.length;
    if (count < 1) {
      return;
    }
    const firstHiddenItem = hiddenItems[0];
    if (!firstHiddenItem) {
      return;
    }
    const phaseKey = `turn:${finalAnchor.id}`;
    // legacyExpandedKeys：live turn chip（liveturn:）展开态迁移源，避免 turn
    // 完成瞬间 chip key 切换导致用户已展开的过程突然折回。
    const expanded =
      expandedPhaseKeys.has(phaseKey) ||
      (legacyExpandedKeys?.some((key) => expandedPhaseKeys.has(key)) ?? false);
    const breakdown = {
      ...resolvePhaseBreakdown(processItems, activeEngine),
      proseCount: hiddenProseItems.length,
    };
    const durationMs = resolvePhaseDurationMs(processItems);
    const hiddenItemIds = hiddenItems.map((item) => item.id);
    if (!expanded) {
      for (const hiddenItem of hiddenItems) {
        unmountedItemIds.add(hiddenItem.id);
      }
      phases.push({
        phaseKey,
        assistantItemId: finalAnchor.id,
        insertBeforeItemId: firstHiddenItem.id,
        count,
        breakdown,
        durationMs,
        expanded,
        hiddenItemIds,
      });
      return;
    }
    // 展开态：外层 chip 保持渲染作为折回入口；turn 内部复用默认模式
    // per-phase 形态渲染，内层 chip 可独立展开/折回。
    const innerPhases: ProcessPhaseCollapse[] = [];
    collectPerPhaseCollapsedInto({
      activeEngine,
      items: segmentItems,
      expandedPhaseKeys,
      phases: innerPhases,
      unmountedItemIds,
    });
    // 外层 header 必须锚到内层折叠后仍可见的 item，否则投影层会把它
    // 跌进 fallback 渲染到幕布底部。
    const firstVisibleItem = segmentItems.find(
      (item) => !unmountedItemIds.has(item.id),
    );
    phases.push({
      phaseKey,
      assistantItemId: finalAnchor.id,
      insertBeforeItemId: (firstVisibleItem ?? firstHiddenItem).id,
      count,
      breakdown,
      durationMs,
      expanded,
      hiddenItemIds,
    });
    phases.push(...innerPhases);
  };

  /**
   * 流式活跃 turn：已落定过程 + 中间叙述实时折成单个 live turn chip，
   * 幕布只保留「chip + 生长中的 prose + 尾部滚动窗口（阈值 4 / 可见 3）」。
   */
  const foldLiveTurn = (segmentItems: ConversationItem[], phaseKey: string) => {
    if (segmentItems.length === 0) {
      return;
    }
    const proseItems = segmentItems.filter(isAssistantMessageWithVisibleText);
    const liveAnchor = proseItems.at(-1);
    const anchorIndex = liveAnchor ? segmentItems.lastIndexOf(liveAnchor) : -1;
    // 锚点之前：全部过程 + 中间叙述 prose 折叠（生长中的 anchor 本身不折）。
    const hiddenBeforeAnchor = (
      anchorIndex >= 0 ? segmentItems.slice(0, anchorIndex) : []
    ).filter(
      (item) =>
        isCollapsibleProcessItem(item) ||
        isAssistantMessageWithVisibleText(item),
    );
    // 锚点之后（无锚点时为整段）：trailing 滚动窗口，极简阈值 4。
    const trailingSource =
      anchorIndex >= 0 ? segmentItems.slice(anchorIndex + 1) : segmentItems;
    const trailingEntries = groupToolItems(
      trailingSource.filter(isCollapsibleProcessItem),
    );
    let hiddenTrailingItems: ConversationItem[] = [];
    let firstVisibleTailItem: ConversationItem | undefined;
    if (
      trailingEntries.length > MINIMAL_TRANSCRIPT_TRAILING_COLLAPSE_THRESHOLD
    ) {
      hiddenTrailingItems = trailingEntries
        .slice(0, trailingEntries.length - TRAILING_PROCESS_VISIBLE_TAIL_COUNT)
        .flatMap(groupedEntryProcessItems);
      const firstVisibleTailEntry =
        trailingEntries[
          trailingEntries.length - TRAILING_PROCESS_VISIBLE_TAIL_COUNT
        ];
      firstVisibleTailItem = firstVisibleTailEntry
        ? groupedEntryProcessItems(firstVisibleTailEntry)[0]
        : undefined;
    }
    const hiddenItems = [...hiddenBeforeAnchor, ...hiddenTrailingItems];
    const firstHiddenItem = hiddenItems[0];
    if (!firstHiddenItem) {
      return;
    }
    const hiddenProseItems = hiddenItems.filter(
      isAssistantMessageWithVisibleText,
    );
    const processItems = hiddenItems.filter(isCollapsibleProcessItem);
    const count =
      countRenderableCollapsedEntries(processItems, activeEngine) +
      hiddenProseItems.length;
    if (count < 1) {
      return;
    }
    const expanded = expandedPhaseKeys.has(phaseKey);
    const breakdown = {
      ...resolvePhaseBreakdown(processItems, activeEngine),
      proseCount: hiddenProseItems.length,
    };
    const durationMs = resolvePhaseDurationMs(processItems);
    const hiddenItemIds = hiddenItems.map((item) => item.id);
    if (expanded) {
      // 展开态：外层 chip 保持渲染；turn 内部回落默认模式 per-phase 形态
      // （trailing 阈值回到默认 5），与完成 turn 的展开语义一致。
      const innerPhases: ProcessPhaseCollapse[] = [];
      collectPerPhaseCollapsedInto({
        activeEngine,
        items: segmentItems,
        expandedPhaseKeys,
        phases: innerPhases,
        unmountedItemIds,
      });
      const firstVisibleItem = segmentItems.find(
        (item) => !unmountedItemIds.has(item.id),
      );
      phases.push({
        phaseKey,
        assistantItemId: liveAnchor ? liveAnchor.id : phaseKey,
        insertBeforeItemId: (firstVisibleItem ?? firstHiddenItem).id,
        count,
        breakdown,
        durationMs,
        expanded,
        hiddenItemIds,
      });
      phases.push(...innerPhases);
      return;
    }
    for (const hiddenItem of hiddenItems) {
      unmountedItemIds.add(hiddenItem.id);
    }
    if (liveAnchor) {
      // 折叠态锚定生长中 prose 上方（复用 phaseByAssistantId 路径）。
      phases.push({
        phaseKey,
        assistantItemId: liveAnchor.id,
        insertBeforeItemId: firstHiddenItem.id,
        count,
        breakdown,
        durationMs,
        expanded,
        hiddenItemIds,
      });
      return;
    }
    // 尚无 prose（纯工具跑动且超过阈值）：复用 trailing chip 自锚放置路径。
    if (!firstVisibleTailItem) {
      return;
    }
    phases.push({
      phaseKey,
      assistantItemId: phaseKey,
      insertBeforeItemId: firstHiddenItem.id,
      collapsedAnchorItemId: firstVisibleTailItem.id,
      count,
      breakdown,
      durationMs,
      expanded,
      hiddenItemIds,
    });
  };

  // 以 user 消息为边界切 turn；每个边界之前的 segment 都是已完成 turn。
  let tailSegmentStart = 0;
  for (let index = 0; index < canvasItems.length; index += 1) {
    const item = canvasItems[index];
    if (!item || !isUserMessageItem(item)) {
      continue;
    }
    foldCompletedTurn(canvasItems.slice(tailSegmentStart, index));
    tailSegmentStart = index + 1;
  }

  // live turn chip key：turn 周期内稳定（不随新 prose 落地而变化）。
  const liveTurnPhaseKey = `liveturn:${
    tailSegmentStart > 0
      ? (canvasItems[tailSegmentStart - 1]?.id ?? "start")
      : "start"
  }`;

  if (isThinking) {
    foldLiveTurn(canvasItems.slice(tailSegmentStart), liveTurnPhaseKey);
  } else {
    foldCompletedTurn(canvasItems.slice(tailSegmentStart), [liveTurnPhaseKey]);
  }

  if (phases.length === 0) {
    return emptyCollapsedTimelineResult(canvasItems);
  }
  if (unmountedItemIds.size === 0) {
    return { timelineItems: canvasItems, phases };
  }
  return {
    timelineItems: canvasItems.filter((item) => !unmountedItemIds.has(item.id)),
    phases,
  };
}
