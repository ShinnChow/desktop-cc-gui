import type { MutableRefObject } from "react";
import { asString } from "../utils/threadNormalize";
import {
  workspaceScopedHas,
  type WorkspaceScopedMap,
} from "./workspaceScopedMap";

import { inferEngineFromLegacyThreadId } from "../contracts/engineRuntimeIdentity";

const inferEngineFromThreadId = inferEngineFromLegacyThreadId;

export const CLAUDE_STREAM_DEBUG_FLAG_KEY = "ccgui.debug.claude.stream";

export function canProgressEventStartProcessing(
  engine:
    | "claude"
    | "codex"
    | "gemini"
    | "grok"
    | "kimi"
    | "opencode"
    | "pi"
    | "dsh"
    | "qoder",
) {
  return engine !== "codex";
}

export function isClaudeThread(threadId: string) {
  return (
    threadId.startsWith("claude:") || threadId.startsWith("claude-pending-")
  );
}

export function isGeminiThread(threadId: string) {
  return (
    threadId.startsWith("gemini:") || threadId.startsWith("gemini-pending-")
  );
}

export function isGrokThread(threadId: string) {
  return threadId.startsWith("grok:") || threadId.startsWith("grok-pending-");
}

export function isKimiThread(threadId: string) {
  return threadId.startsWith("kimi:") || threadId.startsWith("kimi-pending-");
}

export function isDshThread(threadId: string) {
  return threadId.startsWith("dsh:") || threadId.startsWith("dsh-pending-");
}

export function isPiThread(threadId: string) {
  return threadId.startsWith("pi:") || threadId.startsWith("pi-pending-");
}

export function isQoderThread(threadId: string) {
  return threadId.startsWith("qoder:") || threadId.startsWith("qoder-pending-");
}

export function readHighResolutionNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export type ReasoningEngineHint =
  | "gemini"
  | "grok"
  | "kimi"
  | "pi"
  | "dsh"
  | "qoder"
  | null;

export function isGeminiEventThread(
  threadId: string,
  engineHint?: ReasoningEngineHint,
) {
  return engineHint === "gemini" || isGeminiThread(threadId);
}

export function isGrokEventThread(threadId: string, engineHint?: ReasoningEngineHint) {
  return engineHint === "grok" || isGrokThread(threadId);
}

export function isKimiEventThread(threadId: string, engineHint?: ReasoningEngineHint) {
  return engineHint === "kimi" || isKimiThread(threadId);
}

export function isDshEventThread(threadId: string, engineHint?: ReasoningEngineHint) {
  return engineHint === "dsh" || isDshThread(threadId);
}

export function isPiEventThread(threadId: string, engineHint?: ReasoningEngineHint) {
  return engineHint === "pi" || isPiThread(threadId);
}

export function isQoderEventThread(
  threadId: string,
  engineHint?: ReasoningEngineHint,
) {
  return engineHint === "qoder" || isQoderThread(threadId);
}

export function inferItemEngineSource(
  item: Record<string, unknown>,
  threadId: string,
):
  | "claude"
  | "codex"
  | "gemini"
  | "grok"
  | "kimi"
  | "opencode"
  | "pi"
  | "dsh"
  | "qoder" {
  const rawEngineSource = asString(
    item.engineSource ?? item.engine_source ?? "",
  )
    .trim()
    .toLowerCase();
  if (
    rawEngineSource === "claude" ||
    rawEngineSource === "codex" ||
    rawEngineSource === "gemini" ||
    rawEngineSource === "grok" ||
    rawEngineSource === "kimi" ||
    rawEngineSource === "opencode" ||
    rawEngineSource === "pi" ||
    rawEngineSource === "dsh" ||
    rawEngineSource === "qoder"
  ) {
    return rawEngineSource;
  }
  return inferEngineFromThreadId(threadId);
}

export function isInterruptedThread(
  interruptedThreadsRef: MutableRefObject<WorkspaceScopedMap<true>>,
  workspaceId: string | null,
  threadId: string,
) {
  return workspaceScopedHas(
    interruptedThreadsRef.current,
    workspaceId,
    threadId,
  );
}

export function isClaudeStreamDebugEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    const value = window.localStorage.getItem(CLAUDE_STREAM_DEBUG_FLAG_KEY);
    if (!value) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "on";
  } catch {
    return false;
  }
}

export function createDebugPreview(value: string, maxLength = 160) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...`
    : normalized;
}

