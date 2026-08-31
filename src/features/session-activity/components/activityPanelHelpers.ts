import { useTranslation } from "react-i18next";
import type { CSSProperties } from "react";
import {
  buildSemanticDiffSummary,
  type SemanticDiffSummary,
  type TurnValidationEvidence,
} from "../../git/utils/semanticDiffSummary";
import type {
  SessionActivityEvent,
  SessionActivityFileChangeEntry,
  SessionActivitySessionSummary,
} from "../types";

export type ActivityTab =
  | "all"
  | "command"
  | "fileChange"
  | "task"
  | "subagent"
  | "explore"
  | "reasoning";
export type SessionActivityTurnGroup = {
  id: string;
  threadId: string;
  turnIndex: number | null;
  threadName: string;
  sessionRole: SessionActivityEvent["sessionRole"];
  occurredAt: number;
  events: SessionActivityEvent[];
};
export type TurnArtifactTab = "artifacts" | "semantic";
export type SemanticSummarySectionKey = keyof Pick<
  SemanticDiffSummary,
  "intent" | "behavior" | "risks" | "validation"
>;
export type TurnArtifactSummary = {
  files: SessionActivityFileChangeEntry[];
  semanticSummary: SemanticDiffSummary;
  turnSemantic: string | null;
  additions: number;
  deletions: number;
};
export type StickyChildSessionSummary = SessionActivitySessionSummary & {
  lastSeenAt: number;
};
export type FollowNudgeContext = {
  turnKey: string;
  eventId: string;
};
export type FollowBubbleGeometry = {
  top: number;
  left: number;
  width: number;
  arrowLeft: number;
};

export const RUNNING_CARD_MIN_EXPANDED_MS = 2000;
export const FOLLOW_BUBBLE_AUTO_DISMISS_MS = 8000;
export const REASONING_FOLLOW_PAUSE_THRESHOLD_PX = 48;
export const MAX_STICKY_CHILD_SESSION_COUNT = 24;
export const SOLO_FOLLOW_COACH_DISMISSED_BY_WORKSPACE_STORAGE_KEY =
  "ccgui.sessionActivity.soloFollowCoachDismissedByWorkspace";
export const SOLO_FOLLOW_DISCOVERY_COACH_FLAG_KEY = "ccgui.flags.soloFollow.discovery.coachmark";
export const SOLO_FOLLOW_DISCOVERY_NUDGE_FLAG_KEY = "ccgui.flags.soloFollow.discovery.nudge";
export const SESSION_PILL_COLOR_PALETTE = [
  { hue: 158, saturation: 66, lightness: 44 },
  { hue: 210, saturation: 72, lightness: 48 },
  { hue: 258, saturation: 68, lightness: 56 },
  { hue: 24, saturation: 88, lightness: 56 },
  { hue: 338, saturation: 76, lightness: 55 },
  { hue: 186, saturation: 70, lightness: 46 },
] as const;
export const MAX_VISIBLE_STICKY_CHILD_SESSION_SUMMARIES = 10;

export function readSoloFollowCoachDismissedByWorkspace() {
  if (typeof window === "undefined" || !window.localStorage) {
    return {} as Record<string, number>;
  }
  try {
    const raw = window.localStorage.getItem(
      SOLO_FOLLOW_COACH_DISMISSED_BY_WORKSPACE_STORAGE_KEY,
    );
    if (!raw) {
      return {} as Record<string, number>;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return {} as Record<string, number>;
    }
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([workspaceId, value]) =>
          typeof workspaceId === "string" &&
          typeof value === "number" &&
          Number.isFinite(value) &&
          value > 0,
      ),
    ) as Record<string, number>;
  } catch {
    return {} as Record<string, number>;
  }
}

export function readSoloFollowFeatureFlag(flagKey: string, defaultValue = true) {
  if (typeof window === "undefined" || !window.localStorage) {
    return defaultValue;
  }
  try {
    const raw = window.localStorage.getItem(flagKey);
    if (typeof raw !== "string" || raw.trim() === "") {
      return defaultValue;
    }
    const normalized = raw.trim().toLowerCase();
    if (["0", "false", "off", "disabled", "no"].includes(normalized)) {
      return false;
    }
    if (["1", "true", "on", "enabled", "yes"].includes(normalized)) {
      return true;
    }
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export function writeSoloFollowCoachDismissedByWorkspace(nextMap: Record<string, number>) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      SOLO_FOLLOW_COACH_DISMISSED_BY_WORKSPACE_STORAGE_KEY,
      JSON.stringify(nextMap),
    );
  } catch {
    // ignore localStorage failures
  }
}

export function resolveFollowNudgeTurnKey(event: SessionActivityEvent) {
  if (event.turnId?.trim()) {
    return event.turnId.trim();
  }
  if (typeof event.turnIndex === "number") {
    return `${event.threadId}:turn-index:${event.turnIndex}`;
  }
  return `${event.threadId}:event:${event.eventId}`;
}

export function emitSoloFollowMetric(
  name: string,
  payload: { workspaceId: string; threadId: string | null; turnKey?: string } | undefined,
) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.dispatchEvent(
      new CustomEvent("ccgui:solo-follow-metric", {
        detail: {
          name,
          ...(payload ?? {}),
        },
      }),
    );
  } catch {
    // swallow metric dispatch failures
  }
}

export function formatSignedCount(value: number | undefined, positivePrefix: "+" | "-") {
  if (!value || value <= 0) {
    return null;
  }
  return `${positivePrefix}${value}`;
}

export function focusRovingTab(tablistElement: HTMLElement, tabIndex: number) {
  const tabs = tablistElement.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabs[tabIndex]?.focus();
}

export function formatActivityTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

export function buildHeaderSummary(
  t: ReturnType<typeof useTranslation>["t"],
  timelineCount: number,
  sessionCount: number,
  isProcessing: boolean,
) {
  return [
    t("activityPanel.eventsCount", { count: timelineCount }),
    t("activityPanel.sessionsCount", { count: sessionCount }),
    isProcessing ? t("activityPanel.liveNow") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function canExpandCommand(event: SessionActivityEvent) {
  if (event.kind !== "command") {
    return false;
  }
  return (
    event.status === "running" ||
    Boolean(
    event.commandText ||
      event.commandDescription ||
      event.commandWorkingDirectory ||
      event.commandPreview,
    )
  );
}

export function isPlaceholderCommandText(value: string | undefined) {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[：:。.!！?？]/g, "");
  return normalized === "command" || normalized === "命令";
}

export function canExpandReasoning(event: SessionActivityEvent) {
  return event.kind === "reasoning" && Boolean(event.reasoningPreview);
}

export function canExpandTask(event: SessionActivityEvent) {
  return event.kind === "task" && Boolean(event.explorePreview);
}

export function canExpandExplore(event: SessionActivityEvent) {
  if (event.kind !== "explore" || !event.explorePreview) {
    return false;
  }
  if (event.jumpTarget?.type === "file") {
    return false;
  }
  return true;
}

export function canExpandEvent(event: SessionActivityEvent) {
  return (
    canExpandCommand(event) ||
    canExpandReasoning(event) ||
    canExpandTask(event) ||
    canExpandExplore(event)
  );
}

export function unwrapShellCommand(command: string) {
  let normalized = command.trim();
  const shellLaunchers = new Set([
    "bash",
    "zsh",
    "sh",
    "fish",
    "bash.exe",
    "zsh.exe",
    "sh.exe",
    "fish.exe",
  ]);
  const shellWrapperPattern = /^(.+?)\s+-lc\s+([\s\S]+)$/i;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const wrapperMatch = normalized.match(shellWrapperPattern);
    if (!wrapperMatch) {
      break;
    }
    const launcherRaw = (wrapperMatch[1] ?? "").trim();
    const payloadRaw = (wrapperMatch[2] ?? "").trim();
    const launcherUnquoted = launcherRaw.replace(/^['"]|['"]$/g, "");
    const launcherBase = launcherUnquoted.split(/[\\/]/).pop()?.toLowerCase() ?? "";
    if (!shellLaunchers.has(launcherBase)) {
      break;
    }
    const payloadMatch = payloadRaw.match(/^(["'])([\s\S]*)\1$/);
    const payload = (payloadMatch ? payloadMatch[2] : payloadRaw)
      .replace(/\\{2,}(?=["'])/g, "\\")
      .trim();
    normalized = payload;
  }
  return normalized;
}

export function stripShellPrelude(command: string) {
  let normalized = command.trim();
  const sourcePattern = /^\s*(?:source|\.)\s+~\/\.zshrc\s*(?:&&|;)\s*/i;
  const cdPattern = /^\s*cd\s+[^;&|]+(?:&&|;)\s*/i;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const next = normalized.replace(sourcePattern, "").replace(cdPattern, "").trim();
    if (next === normalized) {
      break;
    }
    normalized = next;
  }
  return normalized;
}

export function normalizeCollapsedCommand(command: string) {
  const unwrapped = unwrapShellCommand(command);
  const stripped = stripShellPrelude(unwrapped);
  return stripped || unwrapped || command.trim();
}

export function splitCommandTokens(command: string) {
  const primarySegment = command.split(/\s*(?:&&|\|\||;|\|)\s*/)[0]?.trim() ?? "";
  if (!primarySegment) {
    return [];
  }
  return primarySegment.split(/\s+/).filter(Boolean);
}

export function resolvePackageSubcommand(tokens: string[]) {
  const packageRunners = new Set(["pnpm", "npm", "yarn", "bun", "npx"]);
  if (tokens.length === 0 || !packageRunners.has(tokens[0]?.toLowerCase() ?? "")) {
    return "";
  }
  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]?.toLowerCase() ?? "";
    if (!token || token.startsWith("-")) {
      continue;
    }
    if (token === "run" && index + 1 < tokens.length) {
      const nextToken = tokens[index + 1]?.toLowerCase() ?? "";
      if (nextToken && !nextToken.startsWith("-")) {
        return nextToken;
      }
      continue;
    }
    return token;
  }
  return "";
}

export function resolveCollapsedCommandCategory(
  command: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const tokens = splitCommandTokens(command);
  const primary = tokens[0]?.toLowerCase() ?? "";
  const packageSubcommand = resolvePackageSubcommand(tokens);
  const resolvedRunner = packageSubcommand || primary;

  if (["rg", "grep", "ripgrep", "findstr", "ag", "ack"].includes(primary)) {
    return t("activityPanel.commandCategories.search");
  }
  if (["sed", "cat", "head", "tail", "less", "more", "awk", "nl", "wc", "bat"].includes(primary)) {
    return t("activityPanel.commandCategories.read");
  }
  if (["ls", "tree", "find", "fd", "dir"].includes(primary)) {
    return t("activityPanel.commandCategories.list");
  }
  if (["git", "gh"].includes(primary)) {
    return t("activityPanel.commandCategories.git");
  }
  if (
    ["vitest", "jest", "pytest", "mocha", "ava", "tap", "test"].includes(resolvedRunner) ||
    resolvedRunner.endsWith(":test") ||
    resolvedRunner.endsWith("_test")
  ) {
    return t("activityPanel.commandCategories.test");
  }
  if (
    ["lint", "eslint", "stylelint"].includes(resolvedRunner) ||
    resolvedRunner.endsWith(":lint")
  ) {
    return t("activityPanel.commandCategories.lint");
  }
  if (
    ["build", "tsc", "webpack", "rollup", "vite"].includes(resolvedRunner) ||
    resolvedRunner.endsWith(":build")
  ) {
    return t("activityPanel.commandCategories.build");
  }
  if (["node", "python", "python3", "ruby", "perl", "php", "go", "java"].includes(primary)) {
    return t("activityPanel.commandCategories.run");
  }
  return t("activityPanel.commandCategories.command");
}

export function truncateCollapsedCommand(command: string, maxLength = 108) {
  if (command.length <= maxLength) {
    return command;
  }
  return `${command.slice(0, maxLength - 1)}…`;
}

export function extractAgentNumber(value: string) {
  const agentMatch = value.match(/\bagent\s*([0-9]{1,4})\b/i);
  if (!agentMatch?.[1]) {
    return null;
  }
  return agentMatch[1];
}

export function resolveChildSessionPillLabel(
  session: SessionActivitySessionSummary,
  index: number,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const fromName = extractAgentNumber(session.threadName);
  if (fromName) {
    return `Agent ${fromName}`;
  }
  const fromThreadId = extractAgentNumber(session.threadId);
  if (fromThreadId) {
    return `Agent ${fromThreadId}`;
  }
  return `${t("activityPanel.childSession")} ${index + 1}`;
}

export function resolveStringHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function resolveSessionPillStyle(
  session: SessionActivitySessionSummary,
  index: number,
): CSSProperties & Record<string, string> {
  const hashSeed = resolveStringHash(`${session.threadId}:${session.threadName}:${index}`);
  const paletteEntry =
    SESSION_PILL_COLOR_PALETTE[hashSeed % SESSION_PILL_COLOR_PALETTE.length] ??
    SESSION_PILL_COLOR_PALETTE[0];
  return {
    "--session-pill-accent-h": `${paletteEntry?.hue ?? 214}`,
    "--session-pill-accent-s": `${paletteEntry?.saturation ?? 72}%`,
    "--session-pill-accent-l": `${paletteEntry?.lightness ?? 54}%`,
  };
}

export function shouldAutoExpandRunningEvent(
  event: SessionActivityEvent,
  latestRunningReasoningEventId: string | null,
) {
  if (event.status !== "running") {
    return false;
  }
  if (event.kind === "reasoning") {
    return event.eventId === latestRunningReasoningEventId;
  }
  return true;
}

export function getCollapsedCommandSummary(
  event: SessionActivityEvent,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (event.kind !== "command") {
    return event.summary;
  }
  const description = event.commandDescription?.trim();
  if (description) {
    return description;
  }
  const commandText = event.commandText?.trim();
  if (commandText) {
    const normalized = normalizeCollapsedCommand(commandText);
    const category = resolveCollapsedCommandCategory(normalized, t);
    const concise = truncateCollapsedCommand(normalized);
    return `${category} · ${concise}`;
  }
  return t("activityPanel.commandPendingSummary");
}

export function sortTurnGroupEvents(events: SessionActivityEvent[]) {
  return [...events].sort((left, right) => {
    const leftReasoningPriority = left.kind === "reasoning" ? 0 : 1;
    const rightReasoningPriority = right.kind === "reasoning" ? 0 : 1;
    if (leftReasoningPriority !== rightReasoningPriority) {
      return leftReasoningPriority - rightReasoningPriority;
    }
    if (left.kind === "reasoning" && right.kind === "reasoning") {
      return left.occurredAt - right.occurredAt;
    }
    return right.occurredAt - left.occurredAt;
  });
}

export function mergeStatusLetter(
  current: SessionActivityFileChangeEntry["statusLetter"],
  next: SessionActivityFileChangeEntry["statusLetter"],
) {
  if (current === next) {
    return current;
  }
  if (current === "D" || next === "D") {
    return "D";
  }
  if (current === "A" || next === "A") {
    return "A";
  }
  if (current === "R" || next === "R") {
    return "R";
  }
  return "M";
}

export function buildTurnValidationEvidence(events: SessionActivityEvent[]): TurnValidationEvidence[] {
  return events
    .filter((event) => event.kind === "command" && event.commandText?.trim())
    .map((event) => ({
      eventId: event.eventId,
      commandText: event.commandText?.trim() ?? "",
      commandDescription: event.commandDescription?.trim() || event.summary,
      status: event.status,
    }));
}

export function buildTurnArtifactSummary(events: SessionActivityEvent[]): TurnArtifactSummary | null {
  const filesByPath = new Map<string, SessionActivityFileChangeEntry>();
  const turnSemantic =
    events.find((event) => event.turnSemantic?.trim())?.turnSemantic?.trim() ?? null;
  for (const event of events) {
    if (event.kind !== "fileChange") {
      continue;
    }
    const entries = event.fileChanges?.length
      ? event.fileChanges
      : event.filePath
        ? [
            {
              filePath: event.filePath,
              fileName: event.filePath.split(/[\\/]/).pop() ?? event.filePath,
              statusLetter: event.fileChangeStatusLetter ?? "M",
              additions: event.additions ?? 0,
              deletions: event.deletions ?? 0,
            },
          ]
        : [];
    for (const entry of entries) {
      const normalizedPath = entry.filePath.replace(/\\/g, "/");
      const existing = filesByPath.get(normalizedPath);
      if (!existing) {
        filesByPath.set(normalizedPath, { ...entry, filePath: normalizedPath });
        continue;
      }
      filesByPath.set(normalizedPath, {
        ...existing,
        statusLetter: mergeStatusLetter(existing.statusLetter, entry.statusLetter),
        additions: Math.max(existing.additions, entry.additions),
        deletions: Math.max(existing.deletions, entry.deletions),
        diff: entry.diff?.trim() ? entry.diff : existing.diff,
        line: existing.line ?? entry.line,
        markers: existing.markers ?? entry.markers,
      });
    }
  }
  const files = Array.from(filesByPath.values());
  if (files.length === 0) {
    return null;
  }
  const semanticSummary = buildSemanticDiffSummary({
    entries: files.map((file) => ({
      path: file.filePath,
      status: file.statusLetter,
      diff: file.diff ?? "",
    })),
    validationEvidence: buildTurnValidationEvidence(events),
  });
  return {
    files,
    semanticSummary,
    turnSemantic,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  };
}

export function countTurnArtifactFiles(events: SessionActivityEvent[]) {
  const paths = new Set<string>();
  for (const event of events) {
    if (event.kind !== "fileChange") {
      continue;
    }
    const entries = event.fileChanges?.length
      ? event.fileChanges
      : event.filePath
        ? [{ filePath: event.filePath }]
        : [];
    for (const entry of entries) {
      const normalizedPath = entry.filePath.replace(/\\/g, "/");
      if (normalizedPath) {
        paths.add(normalizedPath);
      }
    }
  }
  return paths.size;
}

export function countVisibleActivityItems(events: SessionActivityEvent[], activeTab: ActivityTab) {
  if (activeTab === "fileChange") {
    return countTurnArtifactFiles(events);
  }
  return events.length;
}

