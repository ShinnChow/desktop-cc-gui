import type { ConversationItem, ThreadSummary } from "../../../types";
import {
  isCommitMessageHelperPreview,
} from "../utils/codexBackgroundHelpers";
import {
  collectQoderSessionIdentityKeys,
} from "../utils/qoderSessionIdentity";

const CLAUDE_HISTORY_MESSAGE_ID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type MessageConversationItem = Extract<ConversationItem, { kind: "message" }>;
type UserConversationMessage = MessageConversationItem & { role: "user" };

export type ThreadRecoveryStrategy =
  | "replacement"
  | "new-discovery"
  | "history-match"
  | "fresh-continuation";

export type ThreadRecoveryReasonCode =
  | "matched"
  | "ambiguous"
  | "no-candidate"
  | "low-confidence"
  | "verified"
  | "fresh-only";

export type ThreadRecoveryDecision = {
  oldThreadId: string;
  candidateThreadId: string | null;
  strategy: ThreadRecoveryStrategy;
  confidence: number;
  scoreGap: number;
  featureSignals: string[];
  reasonCode: ThreadRecoveryReasonCode;
  isPersistent: boolean;
  summary?: ThreadSummary;
};

const THREAD_RECOVERY_ALIAS_PERSISTENCE_THRESHOLD = 0.8;
const THREAD_RECOVERY_REPLACEMENT_GAP_THRESHOLD = 50;
const THREAD_RECOVERY_TIME_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Expand catalog/native session id aliases so hidden automatic helpers can be
 * matched across `engine:id`, `engine:workspace:id`, and raw id forms.
 */
export function buildHiddenAutomaticSessionIdSet(
  ids: readonly string[] | null | undefined,
): Set<string> {
  const set = new Set<string>();
  if (!ids || ids.length === 0) {
    return set;
  }
  for (const rawId of ids) {
    const trimmed = String(rawId ?? "").trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.toLowerCase().startsWith("qoder:")) {
      collectQoderSessionIdentityKeys(trimmed).forEach((id) => set.add(id));
      continue;
    }
    set.add(trimmed);
    const parts = trimmed.split(":").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }
    const last = parts[parts.length - 1];
    if (last) {
      set.add(last);
    }
    if (parts.length >= 2) {
      const engine = parts[0];
      if (engine && last) {
        set.add(`${engine}:${last}`);
      }
    }
  }
  return set;
}

export function threadIdMatchesHiddenAutomaticSessionSet(
  threadId: string,
  hiddenIds: ReadonlySet<string>,
): boolean {
  const trimmed = threadId.trim();
  if (!trimmed || hiddenIds.size === 0) {
    return false;
  }
  if (hiddenIds.has(trimmed)) {
    return true;
  }
  if (trimmed.toLowerCase().startsWith("qoder:")) {
    return collectQoderSessionIdentityKeys(trimmed).some((id) =>
      hiddenIds.has(id),
    );
  }
  const parts = trimmed.split(":").filter(Boolean);
  if (parts.length === 0) {
    return false;
  }
  const last = parts[parts.length - 1];
  if (last && hiddenIds.has(last)) {
    return true;
  }
  if (parts.length >= 2) {
    const engine = parts[0];
    if (engine && last && hiddenIds.has(`${engine}:${last}`)) {
      return true;
    }
  }
  return false;
}

export function isAutomaticHelperSessionTitle(name: string | null | undefined): boolean {
  return isCommitMessageHelperPreview(String(name ?? ""));
}

export function filterHiddenAutomaticThreadSummaries<
  T extends { id: string; name?: string; autoSession?: ThreadSummary["autoSession"] },
>(
  summaries: readonly T[],
  hiddenIds: ReadonlySet<string>,
): T[] {
  if (summaries.length === 0) {
    return [];
  }
  if (hiddenIds.size === 0) {
    return summaries.filter(
      (summary) =>
        summary.autoSession?.visibility !== "hidden" &&
        !isAutomaticHelperSessionTitle(summary.name),
    );
  }
  return summaries.filter((summary) => {
    if (summary.autoSession?.visibility === "hidden") {
      return false;
    }
    if (isAutomaticHelperSessionTitle(summary.name)) {
      return false;
    }
    return !threadIdMatchesHiddenAutomaticSessionSet(summary.id, hiddenIds);
  });
}

export function normalizeThreadListPartialSource(
  value: unknown,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function hasHealthyThreadSummaries(
  threads: ThreadSummary[] | undefined,
): threads is ThreadSummary[] {
  return (
    Array.isArray(threads) &&
    threads.length > 0 &&
    !threads.some(
      (thread) =>
        thread.isDegraded || thread.partialSource || thread.degradedReason,
    )
  );
}

export function markThreadSummariesDegraded(
  threads: ThreadSummary[],
  partialSource: string,
  degradedReason: string,
): ThreadSummary[] {
  return threads.map((thread) => ({
    ...thread,
    isDegraded: true,
    partialSource,
    degradedReason,
  }));
}

export function isWorkspaceNotConnectedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("workspace not connected");
}

function normalizeThreadResumeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .trim()
    .toLowerCase();
}

export function isThreadResumeNotFoundError(error: unknown): boolean {
  const message = normalizeThreadResumeErrorMessage(error);
  return (
    message.includes("thread not found") ||
    message.includes("[session_not_found]") ||
    message.includes("session not found") ||
    message.includes("session file not found")
  );
}

export function inferThreadEngineSource(
  threadId: string,
  summary?: ThreadSummary,
): ThreadSummary["engineSource"] {
  if (summary?.engineSource) {
    return summary.engineSource;
  }
  const normalized = threadId.trim().toLowerCase();
  if (
    normalized.startsWith("claude:") ||
    normalized.startsWith("claude-pending-")
  ) {
    return "claude";
  }
  if (
    normalized.startsWith("gemini:") ||
    normalized.startsWith("gemini-pending-")
  ) {
    return "gemini";
  }
  if (
    normalized.startsWith("grok:") ||
    normalized.startsWith("grok-pending-")
  ) {
    return "grok";
  }
  if (
    normalized.startsWith("kimi:") ||
    normalized.startsWith("kimi-pending-")
  ) {
    return "kimi";
  }
  if (
    normalized.startsWith("pi:") ||
    normalized.startsWith("pi-pending-")
  ) {
    return "pi";
  }
  if (
    normalized.startsWith("qoder:") ||
    normalized.startsWith("qoder-pending-")
  ) {
    return "qoder";
  }
  if (
    normalized.startsWith("opencode:") ||
    normalized.startsWith("opencode-pending-")
  ) {
    return "opencode";
  }
  if (
    normalized.startsWith("dsh:") ||
    normalized.startsWith("dsh-pending-")
  ) {
    return "dsh";
  }
  return "codex";
}

export function isPendingThreadId(threadId: string): boolean {
  const normalized = threadId.trim().toLowerCase();
  return (
    normalized.startsWith("claude-pending-") ||
    normalized.startsWith("gemini-pending-") ||
    normalized.startsWith("grok-pending-") ||
    normalized.startsWith("kimi-pending-") ||
    normalized.startsWith("pi-pending-") ||
    normalized.startsWith("qoder-pending-") ||
    normalized.startsWith("opencode-pending-") ||
    normalized.startsWith("dsh-pending-") ||
    normalized.startsWith("codex-pending-")
  );
}



export function selectReplacementThreadDecision(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadRecoveryDecision {
  const candidates = listReplacementThreadCandidates(params);
  if (candidates.length === 0) {
    return buildNoCandidateThreadRecoveryDecision(
      params.staleThreadId,
      "replacement",
    );
  }
  const scored = scoreDetailedReplacementThreadCandidates(params).sort(
    (left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.entry.updatedAt - left.entry.updatedAt;
    },
  );
  const best = scored[0];
  const next = scored[1];
  if (!best) {
    return buildNoCandidateThreadRecoveryDecision(
      params.staleThreadId,
      "replacement",
    );
  }
  const scoreGap = Math.max(0, best.score - (next?.score ?? 0));
  if (best.score > 0 && (!next || next.score < best.score)) {
    const confidence = resolveReplacementRecoveryConfidence(best.score, scoreGap);
    return buildThreadRecoveryDecision({
      oldThreadId: params.staleThreadId,
      candidate: best.entry,
      strategy: "replacement",
      confidence,
      scoreGap,
      featureSignals: best.featureSignals,
      reasonCode:
        confidence >= THREAD_RECOVERY_ALIAS_PERSISTENCE_THRESHOLD
          ? "verified"
          : "low-confidence",
    });
  }
  if (candidates.length === 1) {
    const candidate = candidates[0];
    if (!candidate) {
      return buildNoCandidateThreadRecoveryDecision(
        params.staleThreadId,
        "replacement",
      );
    }
    return buildThreadRecoveryDecision({
      oldThreadId: params.staleThreadId,
      candidate,
      strategy: "replacement",
      confidence: 0.45,
      scoreGap: 0,
      featureSignals: ["sole_candidate"],
      reasonCode: "low-confidence",
    });
  }
  return {
    oldThreadId: params.staleThreadId,
    candidateThreadId: null,
    strategy: "replacement",
    confidence: 0,
    scoreGap,
    featureSignals: ["ambiguous_score"],
    reasonCode: "ambiguous",
    isPersistent: false,
  };
}

export function selectRecoveredNewThreadSummary(params: {
  staleThreadId: string;
  previousSummaries: ThreadSummary[];
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadSummary | null {
  return selectRecoveredNewThreadDecision(params).summary ?? null;
}

export function selectRecoveredNewThreadDecision(params: {
  staleThreadId: string;
  previousSummaries: ThreadSummary[];
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadRecoveryDecision {
  const candidates = listReplacementThreadCandidates(params);
  if (candidates.length === 0) {
    return buildNoCandidateThreadRecoveryDecision(
      params.staleThreadId,
      "new-discovery",
    );
  }

  const previousIds = new Set(
    params.previousSummaries.map((entry) => entry.id.trim()).filter(Boolean),
  );
  const newlyDiscoveredCandidates = candidates.filter(
    (entry) => !previousIds.has(entry.id.trim()),
  );
  if (newlyDiscoveredCandidates.length === 1) {
    const candidate = newlyDiscoveredCandidates[0];
    if (!candidate) {
      return buildNoCandidateThreadRecoveryDecision(
        params.staleThreadId,
        "new-discovery",
      );
    }
    const timeCoherent = isRecoveryTimeCoherent(candidate, params.staleSummary);
    return buildThreadRecoveryDecision({
      oldThreadId: params.staleThreadId,
      candidate,
      strategy: "new-discovery",
      confidence: timeCoherent ? 0.84 : 0.58,
      scoreGap: timeCoherent ? 30 : 0,
      featureSignals: timeCoherent
        ? ["sole_new_candidate", "time_window_coherent"]
        : ["sole_new_candidate"],
      reasonCode: timeCoherent ? "verified" : "low-confidence",
    });
  }

  const staleUpdatedAt =
    typeof params.staleSummary?.updatedAt === "number" &&
    Number.isFinite(params.staleSummary.updatedAt)
      ? params.staleSummary.updatedAt
      : 0;
  if (staleUpdatedAt > 0) {
    const strictlyNewerCandidates = candidates.filter(
      (entry) =>
        typeof entry.updatedAt === "number" &&
        Number.isFinite(entry.updatedAt) &&
        entry.updatedAt > staleUpdatedAt,
    );
    if (strictlyNewerCandidates.length === 1) {
      const candidate = strictlyNewerCandidates[0];
      if (!candidate) {
        return buildNoCandidateThreadRecoveryDecision(
          params.staleThreadId,
          "new-discovery",
        );
      }
      const timeCoherent = isRecoveryTimeCoherent(candidate, params.staleSummary);
      return buildThreadRecoveryDecision({
        oldThreadId: params.staleThreadId,
        candidate,
        strategy: "new-discovery",
        confidence: timeCoherent ? 0.84 : 0.58,
        scoreGap: timeCoherent ? 30 : 0,
        featureSignals: timeCoherent
          ? ["strictly_newer_candidate", "time_window_coherent"]
          : ["strictly_newer_candidate"],
        reasonCode: timeCoherent ? "verified" : "low-confidence",
      });
    }
  }

  return {
    oldThreadId: params.staleThreadId,
    candidateThreadId: null,
    strategy: "new-discovery",
    confidence: 0,
    scoreGap: 0,
    featureSignals:
      newlyDiscoveredCandidates.length > 1
        ? ["multiple_new_candidates"]
        : ["no_unique_new_candidate"],
    reasonCode: newlyDiscoveredCandidates.length > 1 ? "ambiguous" : "no-candidate",
    isPersistent: false,
  };
}

function buildNoCandidateThreadRecoveryDecision(
  oldThreadId: string,
  strategy: ThreadRecoveryStrategy,
): ThreadRecoveryDecision {
  return {
    oldThreadId,
    candidateThreadId: null,
    strategy,
    confidence: 0,
    scoreGap: 0,
    featureSignals: [],
    reasonCode: "no-candidate",
    isPersistent: false,
  };
}

function buildThreadRecoveryDecision(params: {
  oldThreadId: string;
  candidate: ThreadSummary;
  strategy: ThreadRecoveryStrategy;
  confidence: number;
  scoreGap: number;
  featureSignals: string[];
  reasonCode: ThreadRecoveryReasonCode;
}): ThreadRecoveryDecision {
  const confidence = Math.max(0, Math.min(1, params.confidence));
  return {
    oldThreadId: params.oldThreadId,
    candidateThreadId: params.candidate.id,
    strategy: params.strategy,
    confidence,
    scoreGap: params.scoreGap,
    featureSignals: params.featureSignals,
    reasonCode: params.reasonCode,
    isPersistent:
      confidence >= THREAD_RECOVERY_ALIAS_PERSISTENCE_THRESHOLD &&
      params.reasonCode !== "ambiguous" &&
      params.reasonCode !== "fresh-only",
    summary: params.candidate,
  };
}

function normalizeRecoveryTitle(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function isRecoveryTimeCoherent(
  entry: ThreadSummary,
  staleSummary?: ThreadSummary,
): boolean {
  const staleUpdatedAt =
    typeof staleSummary?.updatedAt === "number" &&
    Number.isFinite(staleSummary.updatedAt)
      ? staleSummary.updatedAt
      : 0;
  if (staleUpdatedAt <= 0 || !Number.isFinite(entry.updatedAt)) {
    return false;
  }
  if (entry.updatedAt < staleUpdatedAt) {
    return false;
  }
  return entry.updatedAt - staleUpdatedAt <= THREAD_RECOVERY_TIME_WINDOW_MS;
}

function scoreReplacementThreadCandidateDetailed(
  entry: ThreadSummary,
  staleSummary?: ThreadSummary,
): { score: number; featureSignals: string[] } {
  const staleName = staleSummary?.name?.trim() ?? "";
  let score = 0;
  const featureSignals: string[] = [];
  if (staleName && entry.name.trim() === staleName) {
    score += 100;
    featureSignals.push("name_exact");
  } else if (
    staleName &&
    normalizeRecoveryTitle(entry.name) === normalizeRecoveryTitle(staleName)
  ) {
    score += 70;
    featureSignals.push("name_normalized_match");
  }
  if (
    staleSummary?.source &&
    entry.source &&
    staleSummary.source === entry.source
  ) {
    score += 20;
    featureSignals.push("source_match");
  }
  if (
    staleSummary?.provider &&
    entry.provider &&
    staleSummary.provider === entry.provider
  ) {
    score += 20;
    featureSignals.push("provider_match");
  }
  if (
    staleSummary?.sourceLabel &&
    entry.sourceLabel &&
    staleSummary.sourceLabel === entry.sourceLabel
  ) {
    score += 20;
    featureSignals.push("source_label_match");
  }
  if (isRecoveryTimeCoherent(entry, staleSummary)) {
    score += 30;
    featureSignals.push("time_window_coherent");
  }
  return { score, featureSignals };
}



function resolveReplacementRecoveryConfidence(score: number, scoreGap: number): number {
  if (score >= 130 && scoreGap >= 50) {
    return 0.95;
  }
  if (score >= 100 && scoreGap >= THREAD_RECOVERY_REPLACEMENT_GAP_THRESHOLD) {
    return 0.88;
  }
  if (score >= 70 && scoreGap >= THREAD_RECOVERY_REPLACEMENT_GAP_THRESHOLD) {
    return 0.78;
  }
  return 0.6;
}

export function listReplacementThreadCandidates(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): ThreadSummary[] {
  const { staleThreadId, summaries } = params;
  const staleSummary =
    params.staleSummary ??
    summaries.find((entry) => entry.id === staleThreadId);
  const staleEngine = inferThreadEngineSource(staleThreadId, staleSummary);
  return summaries.filter((entry) => {
    if (!entry.id || entry.id === staleThreadId) {
      return false;
    }
    if (entry.threadKind === "shared" || isPendingThreadId(entry.id)) {
      return false;
    }
    return inferThreadEngineSource(entry.id, entry) === staleEngine;
  });
}



export function scoreDetailedReplacementThreadCandidates(params: {
  staleThreadId: string;
  summaries: ThreadSummary[];
  staleSummary?: ThreadSummary;
}): Array<{ entry: ThreadSummary; score: number; featureSignals: string[] }> {
  const staleSummary =
    params.staleSummary ??
    params.summaries.find((entry) => entry.id === params.staleThreadId);
  return listReplacementThreadCandidates(params).map((entry) => {
    const { score, featureSignals } = scoreReplacementThreadCandidateDetailed(
      entry,
      staleSummary,
    );
    return { entry, score, featureSignals };
  });
}

const THREAD_RECOVERY_PATTERNS = [
  "thread not found",
  "conversation not found",
  "conversation_not_found",
  "[session_not_found]",
  "session not found",
  "session file not found",
] as const;

const THREAD_RECOVERY_ERROR_PREFIXES = [
  "会话启动失败",
  "thread not found",
  "conversation not found",
  "conversation_not_found",
  "session not found",
  "session file not found",
  "[session_not_found]",
  "failed to start",
  "turn failed to start",
  "session failed to start",
  "error: thread not found",
  "error: conversation not found",
  "error: conversation_not_found",
  "error: session not found",
] as const;

const RUNTIME_PIPE_DISCONNECT_PATTERNS = [
  "broken pipe",
  "the pipe is being closed",
  "the pipe has been ended",
  "os error 32",
  "os error 109",
  "os error 232",
] as const;

function lineLooksLikeThreadRecoveryError(line: string): boolean {
  const lowered = line.toLowerCase();
  if (!THREAD_RECOVERY_PATTERNS.some((pattern) => lowered.includes(pattern))) {
    return false;
  }
  return THREAD_RECOVERY_ERROR_PREFIXES.some((prefix) =>
    lowered.startsWith(prefix),
  );
}

function lineLooksLikeRuntimeReconnectError(line: string): boolean {
  const lowered = line.toLowerCase();
  return (
    RUNTIME_PIPE_DISCONNECT_PATTERNS.some((pattern) =>
      lowered.includes(pattern),
    ) ||
    lowered.includes("workspace not connected") ||
    lineLooksLikeThreadRecoveryError(line)
  );
}

function getRuntimeReconnectCandidate(text: string): string | null {
  const normalized = text.trim();
  if (!normalized) {
    return null;
  }
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  if (lines.length === 1) {
    return lineLooksLikeRuntimeReconnectError(lines[0] ?? "")
      ? (lines[0] ?? null)
      : null;
  }
  if (!lines.every((line) => lineLooksLikeRuntimeReconnectError(line))) {
    return null;
  }
  return lines[0] ?? null;
}

function isTransientReconnectAssistantMessage(item: ConversationItem): boolean {
  if (item.kind !== "message" || item.role !== "assistant") {
    return false;
  }
  return getRuntimeReconnectCandidate(item.text) !== null;
}

function normalizeComparableRecoveryMessageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildComparableRecoveryMessageSignature(
  item: Extract<ConversationItem, { kind: "message" }>,
): string {
  const images = Array.isArray(item.images) ? item.images.join("\u0001") : "";
  return [
    item.role,
    normalizeComparableRecoveryMessageText(item.text),
    images,
  ].join("\u0000");
}

function collectComparableRecoveryMessageSequence(
  items: ConversationItem[],
): string[] {
  return items
    .filter(
      (item): item is Extract<ConversationItem, { kind: "message" }> =>
        item.kind === "message" && !isTransientReconnectAssistantMessage(item),
    )
    .map(buildComparableRecoveryMessageSignature)
    .filter(Boolean);
}

function isComparableMessageSequencePrefix(
  prefix: string[],
  target: string[],
): boolean {
  if (prefix.length === 0 || prefix.length > target.length) {
    return false;
  }
  return prefix.every((value, index) => value === target[index]);
}

function countComparableMessageSuffixOverlap(
  left: string[],
  right: string[],
): number {
  const maxLength = Math.min(left.length, right.length);
  let overlap = 0;
  while (overlap < maxLength) {
    const leftIndex = left.length - 1 - overlap;
    const rightIndex = right.length - 1 - overlap;
    if (left[leftIndex] !== right[rightIndex]) {
      break;
    }
    overlap += 1;
  }
  return overlap;
}

function extractComparableRecoveryUserSequence(sequence: string[]): string[] {
  return sequence.filter((signature) => signature.startsWith("user\u0000"));
}

function scoreThreadRecoveryCandidateByMessages(
  staleItems: ConversationItem[],
  candidateItems: ConversationItem[],
): number {
  const staleSequence = collectComparableRecoveryMessageSequence(staleItems);
  const candidateSequence =
    collectComparableRecoveryMessageSequence(candidateItems);
  if (staleSequence.length === 0 || candidateSequence.length === 0) {
    return 0;
  }
  if (
    staleSequence.length === candidateSequence.length &&
    staleSequence.every((value, index) => value === candidateSequence[index])
  ) {
    return 4_000 + staleSequence.length;
  }
  if (isComparableMessageSequencePrefix(staleSequence, candidateSequence)) {
    return 3_000 + staleSequence.length;
  }
  if (isComparableMessageSequencePrefix(candidateSequence, staleSequence)) {
    return 2_500 + candidateSequence.length;
  }
  const messageSuffixOverlap = countComparableMessageSuffixOverlap(
    staleSequence,
    candidateSequence,
  );
  if (messageSuffixOverlap >= 2) {
    return 2_000 + messageSuffixOverlap;
  }
  const staleUserSequence =
    extractComparableRecoveryUserSequence(staleSequence);
  const candidateUserSequence =
    extractComparableRecoveryUserSequence(candidateSequence);
  if (
    staleUserSequence.length > 0 &&
    staleUserSequence.length === candidateUserSequence.length &&
    staleUserSequence.every(
      (value, index) => value === candidateUserSequence[index],
    )
  ) {
    return 1_500 + staleUserSequence.length;
  }
  if (
    isComparableMessageSequencePrefix(staleUserSequence, candidateUserSequence)
  ) {
    return 1_000 + staleUserSequence.length;
  }
  const userSuffixOverlap = countComparableMessageSuffixOverlap(
    staleUserSequence,
    candidateUserSequence,
  );
  if (userSuffixOverlap >= 1) {
    return 500 + userSuffixOverlap;
  }
  return 0;
}

export function selectReplacementThreadByMessageHistory(params: {
  staleItems: ConversationItem[];
  candidates: Array<{
    summary: ThreadSummary;
    items: ConversationItem[];
  }>;
}): ThreadSummary | null {
  return selectReplacementThreadByMessageHistoryDecision(params).summary ?? null;
}

export function selectReplacementThreadByMessageHistoryDecision(params: {
  staleItems: ConversationItem[];
  candidates: Array<{
    summary: ThreadSummary;
    items: ConversationItem[];
  }>;
  staleThreadId?: string;
}): ThreadRecoveryDecision {
  const scored = params.candidates
    .map(({ summary, items }) => ({
      entry: summary,
      score: scoreThreadRecoveryCandidateByMessages(params.staleItems, items),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return right.entry.updatedAt - left.entry.updatedAt;
    });
  const best = scored[0];
  const next = scored[1];
  if (!best) {
    return buildNoCandidateThreadRecoveryDecision(
      params.staleThreadId ?? "",
      "history-match",
    );
  }
  if (!next || next.score < best.score) {
    return buildThreadRecoveryDecision({
      oldThreadId: params.staleThreadId ?? "",
      candidate: best.entry,
      strategy: "history-match",
      confidence: 0.96,
      scoreGap: Math.max(0, best.score - (next?.score ?? 0)),
      featureSignals: ["history_boundary_match"],
      reasonCode: "verified",
    });
  }
  return {
    oldThreadId: params.staleThreadId ?? "",
    candidateThreadId: null,
    strategy: "history-match",
    confidence: 0,
    scoreGap: 0,
    featureSignals: ["ambiguous_history_match"],
    reasonCode: "ambiguous",
    isPersistent: false,
  };
}

export function mergeRecoveredThreadSummaries(
  existingSummaries: ThreadSummary[],
  refreshedSummaries: ThreadSummary[],
  engineSource: ThreadSummary["engineSource"],
): ThreadSummary[] {
  const mergedById = new Map<string, ThreadSummary>();
  existingSummaries.forEach((entry) => {
    if (inferThreadEngineSource(entry.id, entry) !== engineSource) {
      mergedById.set(entry.id, entry);
    }
  });
  refreshedSummaries.forEach((entry) => {
    const previous = mergedById.get(entry.id);
    if (!previous || entry.updatedAt >= previous.updatedAt) {
      mergedById.set(entry.id, entry);
    }
  });
  return Array.from(mergedById.values()).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

export function isUserConversationMessage(
  item: ConversationItem | undefined,
): item is UserConversationMessage {
  return item?.kind === "message" && item.role === "user";
}

export function normalizeComparableRewindText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function findLastUserMessageIndexById(
  items: UserConversationMessage[],
  messageId: string,
): number {
  const normalizedMessageId = messageId.trim();
  if (!normalizedMessageId) {
    return -1;
  }
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) {
      continue;
    }
    if (item.id.trim() === normalizedMessageId) {
      return index;
    }
  }
  return -1;
}

export function resolveClaudeRewindMessageIdFromHistory(params: {
  requestedMessageId: string;
  threadItems: ConversationItem[];
  historyItems: ConversationItem[];
}): string {
  const requestedMessageId = params.requestedMessageId.trim();
  if (!requestedMessageId) {
    return "";
  }
  if (CLAUDE_HISTORY_MESSAGE_ID_REGEX.test(requestedMessageId)) {
    return requestedMessageId;
  }

  const localUserItems = params.threadItems.filter(isUserConversationMessage);
  const targetLocalIndex = localUserItems.findIndex(
    (item) => item.id.trim() === requestedMessageId,
  );
  if (targetLocalIndex < 0) {
    return requestedMessageId;
  }
  const targetLocalItem = localUserItems[targetLocalIndex];
  if (!targetLocalItem) {
    return requestedMessageId;
  }

  const historyUserItems = params.historyItems
    .filter(isUserConversationMessage)
    .map((item) => ({
      id: item.id.trim(),
      text: normalizeComparableRewindText(item.text),
    }))
    .filter((item) => item.id.length > 0);
  if (historyUserItems.length < 1) {
    return requestedMessageId;
  }
  if (historyUserItems.some((item) => item.id === requestedMessageId)) {
    return requestedMessageId;
  }

  const targetText = normalizeComparableRewindText(targetLocalItem.text);
  if (targetText) {
    const targetOccurrenceByText =
      localUserItems.reduce((count, item, index) => {
        if (index > targetLocalIndex) {
          return count;
        }
        return normalizeComparableRewindText(item.text) === targetText
          ? count + 1
          : count;
      }, 0) || 1;
    const historyMatches = historyUserItems.filter(
      (item) => item.text === targetText,
    );
    if (historyMatches.length >= targetOccurrenceByText) {
      return (
        historyMatches[targetOccurrenceByText - 1]?.id ?? requestedMessageId
      );
    }
    if (historyMatches.length > 0) {
      return (
        historyMatches[historyMatches.length - 1]?.id ?? requestedMessageId
      );
    }
  }

  const positionFromLatest = localUserItems.length - 1 - targetLocalIndex;
  const fallbackIndex = historyUserItems.length - 1 - positionFromLatest;
  if (fallbackIndex >= 0 && fallbackIndex < historyUserItems.length) {
    return historyUserItems[fallbackIndex]?.id ?? requestedMessageId;
  }
  return (
    historyUserItems[historyUserItems.length - 1]?.id ?? requestedMessageId
  );
}

export function findLatestHistoryUserMessageId(
  items: ConversationItem[],
): string {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!isUserConversationMessage(item)) {
      continue;
    }
    const id = item.id.trim();
    if (!id) {
      continue;
    }
    return id;
  }
  return "";
}

export function findFirstHistoryUserMessageId(
  items: ConversationItem[],
): string {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!isUserConversationMessage(item)) {
      continue;
    }
    const id = item.id.trim();
    if (!id) {
      continue;
    }
    return id;
  }
  return "";
}

function normalizeThreadSizeBytes(value: unknown) {
  // Must distinguish missing size (unknown history) from explicit 0
  // (never-started). asNumber() maps missing to 0 and cannot be used here.
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.round(parsed);
    }
  }
  return undefined;
}

export function extractThreadSizeBytes(record: Record<string, unknown>) {
  return normalizeThreadSizeBytes(
    record.sizeBytes ??
      record.size_bytes ??
      record.fileSizeBytes ??
      record.file_size_bytes ??
      record.byteSize ??
      record.byte_size ??
      record.bytes,
  );
}
