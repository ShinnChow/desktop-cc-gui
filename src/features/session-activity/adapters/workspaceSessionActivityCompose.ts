import type { ConversationItem, ThreadSummary } from "../../../types";
import {
  extractToolName,
  isBashTool,
  resolveToolStatus,
} from "../../../utils/toolSemantics";
import { extractFileChangeEventDetails } from "../../operation-facts/operationFacts";
import {
  findPrimaryGitMarkerLine,
  parseLineMarkersFromDiff,
} from "../../files/utils/gitLineMarkers";
import { parseCollabFallbackLink } from "../../../utils/collabToolParsing";
import { getThreadTimestamp } from "../../../utils/threadItems";
import type {
  SessionActivityEvent,
  SessionActivityEventStatus,
  SessionActivityRelationshipSource,
  SessionActivitySessionSummary,
  WorkspaceSessionActivityViewModel,
} from "../types";
import type {
  BuildWorkspaceSessionActivityOptions,
  WorkspaceSessionActivityContext,
  WorkspaceSessionActivityThreadContext,
  WorkspaceSessionActivityThreadSnapshot,
} from "./workspaceSessionActivityTypes";
import {
  getToolDetail,
  getToolOutput,
  getToolTitle,
  getToolType,
} from "./workspaceSessionActivityToolAccessors";
import {
  appendReasoningRunText,
  findLatestUserTurnSemantic,
  inferReasoningPresentationEngine,
  normalizeReasoningItemsForTimeline,
  parseReasoning,
  summarizeTurnUserMessage,
} from "./workspaceSessionActivityReasoning";
import {
  extractCommandMetadata,
  extractCommandOutputWindow,
  extractDisplayFileName,
  extractPrimaryChangeDiff,
  isClaudeSubagentTool,
  isClaudeThreadId,
  resolveExploreReadPath,
  summarizeClaudeSubagent,
  summarizeInspectionTool,
  summarizeTask,
} from "./workspaceSessionActivityToolSummaries";

export function resolveEventStatus(
  status: string | undefined,
  hasOutput: boolean,
  threadIsProcessing: boolean,
): SessionActivityEventStatus {
  const resolved = resolveToolStatus(status, hasOutput);
  if (resolved === "failed") {
    return "failed";
  }
  if (resolved === "completed") {
    return "completed";
  }
  if (!threadIsProcessing) {
    return "completed";
  }
  return "running";
}

export function resolveExploreEventStatus(
  status: "exploring" | "explored" | undefined,
  threadIsProcessing: boolean,
): SessionActivityEventStatus {
  if (status === "explored" || !threadIsProcessing) {
    return "completed";
  }
  return "running";
}
export function buildFallbackParentById(
  threads: ThreadSummary[],
  itemsByThread: Record<string, ConversationItem[]>,
) {
  const fallbackParentById: Record<string, string> = {};
  for (const thread of threads) {
    const items = itemsByThread[thread.id] ?? [];
    for (const item of items) {
      if (item.kind !== "tool" || getToolType(item) !== "collabToolCall") {
        continue;
      }
      const parsed = parseCollabFallbackLink(getToolDetail(item), thread.id);
      if (!parsed) {
        continue;
      }
      for (const receiverId of parsed.receivers) {
        if (!fallbackParentById[receiverId]) {
          fallbackParentById[receiverId] = parsed.parentId;
        }
      }
    }
  }
  return fallbackParentById;
}

export function resolveRootThreadId(
  activeThreadId: string,
  threadParentById: Record<string, string>,
  fallbackParentById: Record<string, string>,
) {
  const visited = new Set<string>();
  let current = activeThreadId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const nextParent = threadParentById[current] ?? fallbackParentById[current];
    if (!nextParent) {
      return current;
    }
    current = nextParent;
  }
  return activeThreadId;
}

export function isDescendantOfRoot(
  threadId: string,
  rootThreadId: string,
  threadParentById: Record<string, string>,
  fallbackParentById: Record<string, string>,
) {
  if (threadId === rootThreadId) {
    return true;
  }
  const visited = new Set<string>();
  let current: string | undefined = threadId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const nextParent: string | undefined =
      threadParentById[current] ?? fallbackParentById[current];
    if (!nextParent) {
      return false;
    }
    if (nextParent === rootThreadId) {
      return true;
    }
    current = nextParent;
  }
  return false;
}

export function resolveRelationshipSource(
  threadId: string,
  rootThreadId: string,
  threadParentById: Record<string, string>,
  fallbackParentById: Record<string, string>,
): SessionActivityRelationshipSource {
  if (threadId === rootThreadId) {
    return "directParent";
  }
  if (threadParentById[threadId]) {
    return "directParent";
  }
  if (fallbackParentById[threadId]) {
    return "fallbackLinking";
  }
  return "directParent";
}

export function buildThreadActivity(args: WorkspaceSessionActivityThreadContext & {
  items: ConversationItem[];
}): WorkspaceSessionActivityThreadSnapshot {
  const events: SessionActivityEvent[] = [];
  const occurredBase = getThreadTimestamp(args.thread) || 0;
  const reasoningPresentationEngine = inferReasoningPresentationEngine(args.thread.id);
  const shouldMergeReasoningIntoFirstNode =
    reasoningPresentationEngine === "claude" ||
    reasoningPresentationEngine === "codex" ||
    reasoningPresentationEngine === "gemini" ||
    reasoningPresentationEngine === "grok" ||
    reasoningPresentationEngine === "kimi";
  const reasoningAnchorIndexByTurnId = new Map<string, number>();
  const exploreEventIndexBySignature = new Map<string, number>();
  const { items: normalizedItems, reasoningMetaById } = normalizeReasoningItemsForTimeline(
    args.thread.id,
    args.items,
  );
  const fallbackThreadOccurredAt = occurredBase > 0 ? occurredBase : Date.now();
  const resolveFallbackOccurredAt = (itemIndex: number) => {
    const reverseIndex = normalizedItems.length - 1 - itemIndex;
    const safeReverseIndex = reverseIndex > 0 ? reverseIndex : 0;
    // Keep one-second spacing so HH:mm:ss labels remain distinct per node.
    return fallbackThreadOccurredAt - safeReverseIndex * 1000;
  };
  let latestUserMessageIndex = -1;
  normalizedItems.forEach((item, index) => {
    if (item.kind === "message" && item.role === "user") {
      latestUserMessageIndex = index;
    }
  });
  let currentTurnIndex = 0;
  let currentTurnToken = "bootstrap";
  let currentTurnSemantic = args.inheritedTurnSemantic ?? "";
  const buildExploreSignature = (
    event: Pick<
      SessionActivityEvent,
      "threadId" | "turnId" | "summary" | "commandText" | "commandDescription" | "explorePreview" | "jumpTarget"
    >,
  ) => {
    let jumpTargetToken = "";
    if (event.jumpTarget?.type === "file") {
      jumpTargetToken = `file:${event.jumpTarget.path}`;
    } else if (event.jumpTarget?.type === "thread") {
      jumpTargetToken = `thread:${event.jumpTarget.threadId}`;
    } else if (event.jumpTarget?.type === "diff") {
      jumpTargetToken = `diff:${event.jumpTarget.path}`;
    }
    return [
      event.threadId,
      event.turnId ?? "",
      event.summary.trim(),
      (event.commandText ?? "").trim(),
      (event.commandDescription ?? "").trim(),
      (event.explorePreview ?? "").trim(),
      jumpTargetToken,
    ].join("\u0000");
  };
  const upsertExploreEvent = (candidate: SessionActivityEvent) => {
    const signature = buildExploreSignature(candidate);
    const existingIndex = exploreEventIndexBySignature.get(signature);
    if (existingIndex === undefined) {
      events.push(candidate);
      exploreEventIndexBySignature.set(signature, events.length - 1);
      return;
    }
    const existing = events[existingIndex];
    if (!existing) {
      events.push(candidate);
      exploreEventIndexBySignature.set(signature, events.length - 1);
      return;
    }
    events[existingIndex] = {
      ...existing,
      occurredAt: Math.max(existing.occurredAt, candidate.occurredAt),
      status: candidate.status,
      commandText: candidate.commandText ?? existing.commandText,
      commandDescription: candidate.commandDescription ?? existing.commandDescription,
      explorePreview: candidate.explorePreview ?? existing.explorePreview,
      jumpTarget: candidate.jumpTarget ?? existing.jumpTarget,
      summary: candidate.summary || existing.summary,
    };
  };
  normalizedItems.forEach((item, index) => {
    if (item.kind === "message" && item.role === "user") {
      currentTurnIndex += 1;
      currentTurnToken = item.id || `turn-${currentTurnIndex}`;
      currentTurnSemantic = summarizeTurnUserMessage(item.text);
      return;
    }
    const sessionRole = args.thread.id === args.rootThreadId ? "root" : "child";
    const threadName = args.thread.name || args.thread.id;
    const occurredAtBase = resolveFallbackOccurredAt(index);
    const turnIndex = currentTurnIndex > 0 ? currentTurnIndex : 1;
    const turnId = `${args.thread.id}:turn:${currentTurnToken}`;

    if (item.kind === "reasoning") {
      const parsed = reasoningMetaById.get(item.id) ?? parseReasoning(item);
      const summary =
        parsed.workingLabel || item.summary.trim() || item.content.trim() || "Thinking";
      const reasoningPreview =
        parsed.bodyText || item.content.trim() || item.summary.trim() || "Thinking";
      const belongsToLatestTurn =
        latestUserMessageIndex >= 0 ? index > latestUserMessageIndex : true;
      const reasoningStatus =
        args.threadIsProcessing && belongsToLatestTurn ? "running" : "completed";
      if (shouldMergeReasoningIntoFirstNode) {
        const anchorIndex = reasoningAnchorIndexByTurnId.get(turnId);
        if (anchorIndex !== undefined) {
          const anchorEvent = events[anchorIndex];
          if (anchorEvent?.kind === "reasoning") {
            events[anchorIndex] = {
              ...anchorEvent,
              occurredAt: Math.max(anchorEvent.occurredAt, occurredAtBase),
              status:
                anchorEvent.status === "running" || reasoningStatus === "running"
                  ? "running"
                  : "completed",
              reasoningPreview: appendReasoningRunText(
                anchorEvent.reasoningPreview ?? "",
                reasoningPreview,
              ),
            };
            return;
          }
        }
      }
      const nextReasoningEvent: SessionActivityEvent = {
        eventId: `reasoning:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "reasoning",
        occurredAt: occurredAtBase,
        summary: `Thinking · ${summary}`,
        turnSemantic: currentTurnSemantic || undefined,
        status: reasoningStatus,
        jumpTarget: { type: "thread", threadId: args.thread.id },
        reasoningPreview,
      };
      events.push(nextReasoningEvent);
      if (shouldMergeReasoningIntoFirstNode) {
        reasoningAnchorIndexByTurnId.set(turnId, events.length - 1);
      }
      return;
    }

    if (item.kind === "explore") {
      const entries = Array.isArray(item.entries) ? item.entries : [];
      const eventStatus = resolveExploreEventStatus(item.status, args.threadIsProcessing);
      entries.forEach((entry, entryIndex) => {
        const label = entry.label.trim();
        const detail = (entry.detail ?? "").trim();
        const occurredAt =
          occurredAtBase +
          Math.floor(((entryIndex + 1) * 900) / (entries.length + 1));
        if (entry.kind === "run") {
          upsertExploreEvent({
            eventId: `explore:run:${item.id}:${entryIndex}`,
            threadId: args.thread.id,
            threadName,
            turnId,
            turnIndex,
            sessionRole,
            relationshipSource: args.relationshipSource,
            kind: "explore",
            occurredAt,
            summary: label || "Command",
            turnSemantic: currentTurnSemantic || undefined,
            status: eventStatus,
            commandText: label || "Command",
            commandDescription: detail || undefined,
            explorePreview: detail || undefined,
          });
          return;
        }
        const summaryPrefix =
          entry.kind === "read"
            ? "Read"
            : entry.kind === "search"
              ? "Search"
              : "List";
        const displayLabel =
          entry.kind === "read"
            ? (() => {
                const candidate = resolveExploreReadPath(label, detail);
                if (!candidate) {
                  return label || detail || "workspace";
                }
                return extractDisplayFileName(candidate) || candidate;
              })()
            : label || detail || "workspace";
        upsertExploreEvent({
          eventId: `explore:${entry.kind}:${item.id}:${entryIndex}`,
          threadId: args.thread.id,
          threadName,
          turnId,
          turnIndex,
          sessionRole,
          relationshipSource: args.relationshipSource,
          kind: "explore",
          occurredAt,
          summary: `${summaryPrefix} · ${displayLabel}`,
          turnSemantic: currentTurnSemantic || undefined,
          status: eventStatus,
          explorePreview: detail || undefined,
          jumpTarget:
            entry.kind === "read"
              ? (() => {
                  const resolvedPath = resolveExploreReadPath(label, detail);
                  return resolvedPath
                    ? ({ type: "file", path: resolvedPath } as const)
                    : ({ type: "thread", threadId: args.thread.id } as const);
                })()
              : { type: "thread", threadId: args.thread.id },
        });
      });
      return;
    }

    if (item.kind !== "tool") {
      return;
    }
    const lowerToolName = extractToolName(getToolTitle(item)).trim().toLowerCase();
    const hasOutput = Boolean(getToolOutput(item)) || Boolean(item.changes?.length);
    const eventStatus = resolveEventStatus(item.status, hasOutput, args.threadIsProcessing);
    const occurredAt = occurredAtBase;

    if (getToolType(item) === "commandExecution" || isBashTool(lowerToolName)) {
      const commandMeta = extractCommandMetadata(item);
      events.push({
        eventId: `command:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "command",
        occurredAt,
        summary: commandMeta.summary || "Command",
        turnSemantic: currentTurnSemantic || undefined,
        status: eventStatus,
        commandText: commandMeta.commandText,
        commandDescription: commandMeta.commandDescription || undefined,
        commandWorkingDirectory: commandMeta.commandWorkingDirectory || undefined,
        commandPreview: extractCommandOutputWindow(getToolOutput(item)),
      });
      return;
    }

    if (isClaudeThreadId(args.thread.id) && isClaudeSubagentTool(item, lowerToolName)) {
      const subagentSummary = summarizeClaudeSubagent(item);
      events.push({
        eventId: `subagent:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "subagent",
        occurredAt,
        summary: subagentSummary.summary,
        turnSemantic: currentTurnSemantic || undefined,
        status: eventStatus,
        jumpTarget: { type: "thread", threadId: args.thread.id },
        subagentType: subagentSummary.subagentType,
        subagentDescription: subagentSummary.subagentDescription,
      });
      return;
    }

    const taskSummary = summarizeTask(item);
    if (taskSummary) {
      events.push({
        eventId: `task:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "task",
        occurredAt,
        summary: taskSummary,
        turnSemantic: currentTurnSemantic || undefined,
        status: eventStatus,
        jumpTarget: { type: "thread", threadId: args.thread.id },
      });
      return;
    }

    const fileChangeSummary = extractFileChangeEventDetails(item);
    if (fileChangeSummary) {
      const primaryEntry = fileChangeSummary.entries[0];
      const primaryDiff = primaryEntry?.diff ?? extractPrimaryChangeDiff(item, fileChangeSummary.filePath);
      const markers = parseLineMarkersFromDiff(primaryDiff);
      const primaryLine = findPrimaryGitMarkerLine(markers) ?? undefined;
      events.push({
        eventId: `file:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "fileChange",
        occurredAt,
        summary: fileChangeSummary.summary,
        turnSemantic: currentTurnSemantic || undefined,
        status: eventStatus,
        jumpTarget: fileChangeSummary.filePath
          ? {
              type: "file",
              path: fileChangeSummary.filePath,
              line: primaryLine,
              markers,
            }
          : undefined,
        fileChangeStatusLetter: fileChangeSummary.statusLetter,
        filePath: fileChangeSummary.filePath,
        fileCount: fileChangeSummary.fileCount,
        additions: fileChangeSummary.additions,
        deletions: fileChangeSummary.deletions,
        fileChanges: fileChangeSummary.entries.map((entry) => {
          const entryMarkers = parseLineMarkersFromDiff(entry.diff ?? "");
          return {
            filePath: entry.filePath,
            fileName: entry.fileName,
            statusLetter: entry.status,
            additions: entry.additions,
            deletions: entry.deletions,
            diff: entry.diff,
            line: findPrimaryGitMarkerLine(entryMarkers) ?? undefined,
            markers: entryMarkers,
          };
        }),
      });
      return;
    }

    const inspectionSummary = summarizeInspectionTool(item);
    if (inspectionSummary) {
      events.push({
        eventId: `task:${item.id}`,
        threadId: args.thread.id,
        threadName,
        turnId,
        turnIndex,
        sessionRole,
        relationshipSource: args.relationshipSource,
        kind: "task",
        occurredAt,
        summary: inspectionSummary.summary,
        turnSemantic: currentTurnSemantic || undefined,
        status: eventStatus,
        jumpTarget: inspectionSummary.jumpTarget ?? { type: "thread", threadId: args.thread.id },
        explorePreview: inspectionSummary.preview || undefined,
      });
    }
  });
  const sessionRole: SessionActivitySessionSummary["sessionRole"] =
    args.thread.id === args.rootThreadId ? "root" : "child";
  return {
    threadId: args.thread.id,
    threadName: args.thread.name || args.thread.id,
    sessionRole,
    relationshipSource: args.relationshipSource,
    isProcessing: args.threadIsProcessing,
    eventCount: events.length,
    events,
  };
}

/** Runtime-disabled / no-active-thread empty view model (kill-switch safe stub). */
export function createEmptyWorkspaceSessionActivityViewModel(): WorkspaceSessionActivityViewModel {
  return {
    rootThreadId: null,
    rootThreadName: null,
    relevantThreadIds: [],
    timeline: [],
    sessionSummaries: [],
    isProcessing: false,
    emptyState: "idle",
  };
}

/** Stable empty view model for kill-switch call sites (avoid per-render object churn). */
export const DISABLED_WORKSPACE_SESSION_ACTIVITY: WorkspaceSessionActivityViewModel =
  Object.freeze(createEmptyWorkspaceSessionActivityViewModel());

export function resolveWorkspaceSessionActivityContext({
  activeThreadId,
  threads,
  itemsByThread,
  threadParentById,
  threadStatusById,
}: BuildWorkspaceSessionActivityOptions): WorkspaceSessionActivityContext | null {
  if (!activeThreadId) {
    return null;
  }

  const threadMap = new Map(threads.map((thread) => [thread.id, thread]));
  const fallbackParentById = buildFallbackParentById(threads, itemsByThread);
  const rootThreadId = resolveRootThreadId(
    activeThreadId,
    threadParentById,
    fallbackParentById,
  );
  const relevantThreads = threads.filter((thread) =>
    isDescendantOfRoot(thread.id, rootThreadId, threadParentById, fallbackParentById),
  );

  const inferredRelatedThreadIds = new Set<string>([
    ...Object.keys(threadParentById),
    ...Object.values(threadParentById),
    ...Object.keys(fallbackParentById),
    ...Object.values(fallbackParentById),
  ]);
  inferredRelatedThreadIds.forEach((candidateThreadId) => {
    if (!candidateThreadId || threadMap.has(candidateThreadId)) {
      return;
    }
    if (
      !isDescendantOfRoot(
        candidateThreadId,
        rootThreadId,
        threadParentById,
        fallbackParentById,
      )
    ) {
      return;
    }
    const inferredThread: ThreadSummary = {
      id: candidateThreadId,
      name: candidateThreadId,
      updatedAt: 0,
    };
    threadMap.set(candidateThreadId, inferredThread);
    relevantThreads.push(inferredThread);
  });

  if (!threadMap.has(activeThreadId)) {
    const fallbackThread: ThreadSummary = {
      id: activeThreadId,
      name: activeThreadId,
      updatedAt: 0,
    };
    threadMap.set(activeThreadId, fallbackThread);
    if (isDescendantOfRoot(activeThreadId, rootThreadId, threadParentById, fallbackParentById)) {
      relevantThreads.push(fallbackThread);
    }
  }

  const uniqueRelevantThreads = Array.from(
    new Map(relevantThreads.map((thread) => [thread.id, thread])).values(),
  );

  const rootThread = threadMap.get(rootThreadId) ?? null;
  const rootTurnSemantic = findLatestUserTurnSemantic(itemsByThread[rootThreadId] ?? []);

  return {
    rootThreadId,
    rootThreadName: rootThread?.name ?? rootThreadId,
    relevantThreads: uniqueRelevantThreads.map((thread) => ({
      thread,
      rootThreadId,
      relationshipSource: resolveRelationshipSource(
        thread.id,
        rootThreadId,
        threadParentById,
        fallbackParentById,
      ),
      // 后台任务运行中（turn 已 settle）同样计为活跃：pi durable 任务仍在跑。
      threadIsProcessing:
        Boolean(threadStatusById[thread.id]?.isProcessing) ||
        (threadStatusById[thread.id]?.backgroundTaskRunningCount ?? 0) > 0,
      inheritedTurnSemantic: thread.id === rootThreadId ? undefined : rootTurnSemantic || undefined,
    })),
  };
}

export function composeWorkspaceSessionActivityViewModel(args: {
  rootThreadId: string;
  rootThreadName: string;
  threadSnapshots: WorkspaceSessionActivityThreadSnapshot[];
}): WorkspaceSessionActivityViewModel {
  const timeline = args.threadSnapshots
    .flatMap((snapshot) => snapshot.events)
    .sort((left, right) => right.occurredAt - left.occurredAt);

  const sessionSummaries: SessionActivitySessionSummary[] = args.threadSnapshots
    .map((snapshot) => ({
      threadId: snapshot.threadId,
      threadName: snapshot.threadName,
      sessionRole: snapshot.sessionRole,
      relationshipSource: snapshot.relationshipSource,
      eventCount: snapshot.eventCount,
      isProcessing: snapshot.isProcessing,
    }))
    .sort((left, right) => {
      if (left.sessionRole !== right.sessionRole) {
        return left.sessionRole === "root" ? -1 : 1;
      }
      return right.eventCount - left.eventCount;
    });

  const isProcessing = args.threadSnapshots.some((snapshot) => snapshot.isProcessing);
  const emptyState =
    timeline.length > 0 ? (isProcessing ? "running" : "completed") : isProcessing ? "running" : "idle";

  return {
    rootThreadId: args.rootThreadId,
    rootThreadName: args.rootThreadName,
    relevantThreadIds: args.threadSnapshots.map((snapshot) => snapshot.threadId),
    timeline,
    sessionSummaries,
    isProcessing,
    emptyState,
  };
}

export function buildWorkspaceSessionActivity({
  activeThreadId,
  threads,
  itemsByThread,
  threadParentById,
  threadStatusById,
}: BuildWorkspaceSessionActivityOptions): WorkspaceSessionActivityViewModel {
  const context = resolveWorkspaceSessionActivityContext({
    activeThreadId,
    threads,
    itemsByThread,
    threadParentById,
    threadStatusById,
  });
  if (!context) {
    return createEmptyWorkspaceSessionActivityViewModel();
  }

  const threadSnapshots = context.relevantThreads.map((threadContext) =>
    buildThreadActivity({
      ...threadContext,
      items: itemsByThread[threadContext.thread.id] ?? [],
    }),
  );
  return composeWorkspaceSessionActivityViewModel({
    rootThreadId: context.rootThreadId,
    rootThreadName: context.rootThreadName,
    threadSnapshots,
  });
}
