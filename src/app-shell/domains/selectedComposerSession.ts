import { getComposerEnginePrefForEngine } from "../../features/composer/hooks/composerEnginePrefsStore";
import { isTrustedDshCatalogId } from "../../features/threads/hooks/threadMessagingHelpers";
import {
  getClientStoreSync,
  isClientStoreReady,
  writeClientStoreValue,
} from "../../services/clientStorage";

export type ComposerSessionSelection = {
  modelId: string | null;
  effort: string | null;
};

const THREAD_COMPOSER_SELECTION_STORAGE_KEY_PREFIX = "selectedModelByThread.";
const CLAUDE_FORK_THREAD_PREFIX = "claude-fork:";
const CLAUDE_REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
/** Keep aligned with `GROK_REASONING_OPTIONS` / grok.rs allowlist. */
const GROK_REASONING_EFFORTS = new Set(["low", "medium", "high"]);
/** DSH host deepseek adapter reasoning efforts (llm.models reasoning.efforts). */
const DSH_REASONING_EFFORTS = new Set(["off", "low", "high", "max"]);
/** PI thinking levels — keep aligned with pi CLI; do not reuse for other engines. */
const PI_REASONING_EFFORTS = new Set([
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);

export function resolveThreadEngine(
  threadId: string,
): "claude" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder" | "codex" | null {
  if (
    threadId.startsWith("claude:") ||
    threadId.startsWith("claude-pending-") ||
    threadId.startsWith(CLAUDE_FORK_THREAD_PREFIX)
  ) {
    return "claude";
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
  if (threadId.startsWith("opencode:") || threadId.startsWith("opencode-pending-")) {
    return "opencode";
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
  if (threadId.startsWith("codex:") || threadId.startsWith("codex-pending-")) {
    return "codex";
  }
  return null;
}

export function extractClaudeForkParentThreadId(threadId: string): string | null {
  if (!threadId.startsWith(CLAUDE_FORK_THREAD_PREFIX)) {
    return null;
  }
  const payload = threadId.slice(CLAUDE_FORK_THREAD_PREFIX.length);
  const separatorIndex = payload.lastIndexOf(":");
  const parentSessionId = separatorIndex >= 0 ? payload.slice(0, separatorIndex) : payload;
  const trimmed = parentSessionId.trim();
  return trimmed.length > 0 ? `claude:${trimmed}` : null;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeComposerSessionSelection(
  value: unknown,
): ComposerSessionSelection | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const modelId = normalizeNullableString(record.modelId);
  const effort = normalizeNullableString(record.effort);
  if (modelId === null && effort === null) {
    return null;
  }
  return { modelId, effort };
}

export function normalizeComposerSessionSelectionForThread(
  threadId: string | null,
  value: unknown,
): ComposerSessionSelection | null {
  const normalized = normalizeComposerSessionSelection(value);
  if (!normalized) {
    return null;
  }

  const engine = threadId ? resolveThreadEngine(threadId) : null;
  let effort = normalized.effort;
  if (engine === "claude") {
    effort = effort && CLAUDE_REASONING_EFFORTS.has(effort) ? effort : null;
  } else if (engine === "grok") {
    effort = effort && GROK_REASONING_EFFORTS.has(effort) ? effort : null;
  } else if (engine === "dsh") {
    effort = effort && DSH_REASONING_EFFORTS.has(effort) ? effort : null;
  } else if (engine === "qoder") {
    effort = effort || null;
  } else if (engine === "pi" || engine === "omp") {
    // omp 与 pi 共享 thinking levels（off/minimal/low/medium/high/xhigh/max）。
    effort = effort && PI_REASONING_EFFORTS.has(effort) ? effort : null;
  } else if (engine === "gemini" || engine === "kimi" || engine === "opencode") {
    effort = null;
  }

  if (normalized.modelId === null && effort === null) {
    return null;
  }
  return {
    modelId: normalized.modelId,
    effort,
  };
}

export function getThreadComposerSelectionStorageKey(
  workspaceId: string | null,
  threadId: string,
): string {
  const workspaceKey =
    typeof workspaceId === "string" && workspaceId.trim().length > 0
      ? workspaceId.trim()
      : "__workspace__unknown__";
  return `${THREAD_COMPOSER_SELECTION_STORAGE_KEY_PREFIX}${workspaceKey}:${threadId}`;
}

export function shouldApplyDraftComposerSelectionToThread(input: {
  candidate: ComposerSessionSelection | null;
  shouldApplyDraftToNextThread: boolean;
  draftComposerSelection: ComposerSessionSelection | null;
  activeThreadId: string | null;
  /** 来源线程 id；carry 自会话时必传，Home 点选等无线程来源为 null。 */
  draftSourceThreadId?: string | null;
  /**
   * D6 闸2：目标线程引擎的 catalog 成员资格 key 集（id+model 双通道）。
   * 提供且非空时，draft 模型不在集合内 → 拒绝应用（封死 Home draft 引擎盲区
   * 把他引擎模型写进 pending 账本）。null/未提供 = catalog 不可得，维持放行。
   */
  targetEngineModelKeys?: readonly string[] | null;
}): boolean {
  const baseOk = Boolean(
    !input.candidate &&
      input.shouldApplyDraftToNextThread &&
      input.draftComposerSelection &&
      input.activeThreadId &&
      input.activeThreadId.includes("-pending-"),
  );
  if (!baseOk) {
    return false;
  }
  // composer-session-selection-isolation：draft 只允许落在同引擎 pending。
  // 与迁移路径 hasEngineMismatch 同构——任一侧引擎解析不出（Home 点选 /
  // Shared / 无前缀 id）保持既有放行语义，不在此处引入回归。
  const sourceEngine = resolveThreadEngine(input.draftSourceThreadId ?? "");
  const targetEngine = resolveThreadEngine(input.activeThreadId ?? "");
  if (
    sourceEngine !== null &&
    targetEngine !== null &&
    sourceEngine !== targetEngine
  ) {
    return false;
  }
  // D6 闸2：catalog 成员资格校验（引擎门禁覆盖不到的 Home 无源 draft 在此拦截）
  const membershipKeys = input.targetEngineModelKeys;
  if (membershipKeys && membershipKeys.length > 0) {
    const draftModelId = input.draftComposerSelection?.modelId?.trim() ?? "";
    if (draftModelId && !membershipKeys.includes(draftModelId)) {
      return false;
    }
  }
  return true;
}

export function shouldMigrateComposerSelectionBetweenThreadIds(input: {
  previousThreadId: string | null;
  activeThreadId: string | null;
  previousSessionKey: string | null;
  activeSessionKey: string | null;
  hasSourceSelection: boolean;
  hasTargetSelection: boolean;
  resolveCanonicalThreadId: (threadId: string) => string;
}): boolean {
  const {
    previousThreadId,
    activeThreadId,
    previousSessionKey,
    activeSessionKey,
    hasSourceSelection,
    hasTargetSelection,
    resolveCanonicalThreadId,
  } = input;

  const previousEngine = previousThreadId ? resolveThreadEngine(previousThreadId) : null;
  const activeEngine = activeThreadId ? resolveThreadEngine(activeThreadId) : null;
  const hasEngineMismatch =
    previousEngine !== null && activeEngine !== null && previousEngine !== activeEngine;
  const hasForwardFinalizeTransition = Boolean(
    previousThreadId &&
      activeThreadId &&
      previousThreadId.includes("-pending-") &&
      !activeThreadId.includes("-pending-"),
  );
  const hasCanonicalMatch = Boolean(
    previousThreadId &&
      activeThreadId &&
      resolveCanonicalThreadId(previousThreadId) === resolveCanonicalThreadId(activeThreadId),
  );

  return Boolean(
    previousThreadId &&
      activeThreadId &&
      previousThreadId !== activeThreadId &&
      previousSessionKey &&
      activeSessionKey &&
      hasSourceSelection &&
      !hasTargetSelection &&
      !hasEngineMismatch &&
      (hasForwardFinalizeTransition || hasCanonicalMatch),
  );
}

export function shouldInheritComposerSelectionFromClaudeForkParent(input: {
  activeThreadId: string | null;
  hasCandidate: boolean;
  hasParentSelection: boolean;
}): boolean {
  return Boolean(
    input.activeThreadId &&
      input.activeThreadId.startsWith(CLAUDE_FORK_THREAD_PREFIX) &&
      !input.hasCandidate &&
      input.hasParentSelection,
  );
}

// Seed a brand-new conversation with the model/effort the user last chose for its
// engine. Codex keeps its own global-selection path, so it opts out here.
export function resolveEngineDefaultComposerSelection(
  threadId: string,
): ComposerSessionSelection | null {
  const engine = resolveThreadEngine(threadId);
  if (!engine || engine === "codex") {
    return null;
  }
  const pref = getComposerEnginePrefForEngine(engine);
  if (pref.modelId === null && pref.effort === null) {
    return null;
  }
  return { modelId: pref.modelId, effort: pref.effort };
}

/**
 * Pending threads often arrive with draft/model selection where effort is null.
 * That null would stick as UI「默认」and block lastComposerPrefsByEngine.effort.
 * Only fill when effort is null; never override an explicit effort (including a
 * deliberate「默认」after the user cleared the engine pref).
 * Codex keeps its own global-selection path.
 */
export function fillPendingComposerSelectionEffortFromEnginePref(
  selection: ComposerSessionSelection | null,
  threadId: string | null,
): ComposerSessionSelection | null {
  if (!selection || !threadId || !threadId.includes("-pending-")) {
    return selection;
  }
  if (selection.effort !== null) {
    return selection;
  }
  const engine = resolveThreadEngine(threadId);
  if (!engine || engine === "codex") {
    return selection;
  }
  const prefEffort = getComposerEnginePrefForEngine(engine).effort;
  if (!prefEffort) {
    return selection;
  }
  return normalizeComposerSessionSelectionForThread(threadId, {
    modelId: selection.modelId,
    effort: prefEffort,
  });
}

const dshComposerSelectionSeedListeners = new Set<() => void>();

export function subscribeDshComposerSelectionSeeded(
  listener: () => void,
): () => void {
  dshComposerSelectionSeedListeners.add(listener);
  return () => {
    dshComposerSelectionSeedListeners.delete(listener);
  };
}

function notifyDshComposerSelectionSeeded() {
  for (const listener of dshComposerSelectionSeedListeners) {
    listener();
  }
}

/**
 * Seed a DSH thread ledger from host history `{provider}/{model}` only when
 * the existing ledger is missing or not a trusted DSH catalog id.
 * Never uses global `composerEnginePrefs.dsh.modelId`.
 */
export function seedDshComposerSelectionFromHost(input: {
  workspaceId: string | null;
  threadId: string;
  catalogId: string | null | undefined;
  effort?: string | null;
}): boolean {
  if (!input.threadId.startsWith("dsh:")) {
    return false;
  }
  const catalogId = input.catalogId?.trim() || "";
  if (!isTrustedDshCatalogId(catalogId)) {
    return false;
  }
  const sessionKey = getThreadComposerSelectionStorageKey(
    input.workspaceId,
    input.threadId,
  );
  const stored = isClientStoreReady("composer")
    ? getClientStoreSync<unknown>("composer", sessionKey)
    : undefined;
  const existing = normalizeComposerSessionSelectionForThread(
    input.threadId,
    stored,
  );
  const hostEffort = input.effort?.trim() || null;
  if (isTrustedDshCatalogId(existing?.modelId)) {
    // 模型一致时只回填 host 当前 thinking effort（官方切档或他端改档后仍能还原）；
    // 模型不一致时整条回填。用户显式选择以 ledger 为准，host 只在空档时补位。
    if (!existing || existing.modelId !== catalogId || existing.effort === hostEffort) {
      return false;
    }
    if (!hostEffort) {
      return false;
    }
    const next = normalizeComposerSessionSelectionForThread(input.threadId, {
      modelId: existing.modelId,
      effort: hostEffort,
    });
    if (!next || !isClientStoreReady("composer")) {
      return false;
    }
    writeClientStoreValue("composer", sessionKey, next);
    notifyDshComposerSelectionSeeded();
    return true;
  }
  const next = normalizeComposerSessionSelectionForThread(input.threadId, {
    modelId: catalogId,
    effort: existing?.effort ?? input.effort ?? null,
  });
  if (!next || !isClientStoreReady("composer")) {
    return false;
  }
  writeClientStoreValue("composer", sessionKey, next);
  notifyDshComposerSelectionSeeded();
  return true;
}
