import type { TFunction } from "i18next";

import type { MemoryBrief } from "../../project-memory/utils/memoryScout";
import { extractSessionIdFromEngineSendResponse } from "./threadMessagingHelpers";

const MEMORY_SCOUT_TIMEOUT_MS = 1500;
const CLAUDE_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
/** Keep aligned with composer / grok.rs allowlist (low|medium|high). */
const GROK_REASONING_EFFORTS = new Set(["low", "medium", "high"]);
/** DSH host deepseek adapter reasoning efforts (llm.models reasoning.efforts). */
const DSH_REASONING_EFFORTS = new Set(["off", "low", "high", "max"]);
/** PI thinking levels — keep aligned with pi CLI / `THINKING_LEVELS` in pi.rs. */
const PI_REASONING_EFFORTS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function buildLocalizedMemoryScoutPreviewText(brief: MemoryBrief, t: TFunction) {
  if (brief.status === "ok") {
    const titles = brief.items.map((item) => item.title).slice(0, 3).join("；");
    return t("threads.memoryReferenceReferenced", {
      count: brief.items.length,
      titlesSuffix: titles
        ? t("threads.memoryReferenceTitlesSuffix", { titles })
        : "",
    });
  }
  if (brief.status === "timeout") {
    return t("threads.memoryReferenceTimeout");
  }
  if (brief.status === "error") {
    return t("threads.memoryReferenceError");
  }
  return t("threads.memoryReferenceNoRelated");
}

export function extractClaudeCandidateSessionId(response: Record<string, unknown>): string | null {
  const candidate = extractSessionIdFromEngineSendResponse(response);
  return candidate && candidate !== "pending" ? candidate : null;
}

export function normalizeEngineScopedEffort(
  engine: "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder",
  effort: string | null | undefined,
): string | null {
  if (typeof effort !== "string") {
    return null;
  }
  const trimmed = effort.trim();
  if (!trimmed) {
    return null;
  }
  if (engine === "claude") {
    return CLAUDE_REASONING_EFFORTS.has(trimmed) ? trimmed : null;
  }
  if (engine === "grok") {
    return GROK_REASONING_EFFORTS.has(trimmed) ? trimmed : null;
  }
  if (engine === "codex") {
    return trimmed;
  }
  if (engine === "dsh") {
    return DSH_REASONING_EFFORTS.has(trimmed) ? trimmed : null;
  }
  if (engine === "pi") {
    return PI_REASONING_EFFORTS.has(trimmed) ? trimmed : null;
  }
  // omp 与 pi 共享 thinking levels（off/minimal/low/medium/high/xhigh/max）。
  if (engine === "omp") {
    return PI_REASONING_EFFORTS.has(trimmed) ? trimmed : null;
  }
  return null;
}

export function withMemoryScoutTimeout(
  action: Promise<MemoryBrief>,
  timeoutMs = MEMORY_SCOUT_TIMEOUT_MS,
) {
  const startedAt = Date.now();
  return Promise.race<MemoryBrief>([
    action,
    new Promise((resolve) => {
      globalThis.setTimeout(() => {
        resolve({
          status: "timeout",
          query: "",
          memories: [],
          items: [],
          conflicts: [],
          truncated: false,
          elapsedMs: Date.now() - startedAt,
          retrievalMode: "lexical",
        });
      }, timeoutMs);
    }),
  ]);
}
