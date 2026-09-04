import type { ThreadSummary } from "../../../types";
import {
  isWeakSessionDisplayTitle,
  mergeSessionDisplaySummary,
  projectSessionDisplaySummaries,
} from "../utils/sessionDisplayProjection";
import { inferThreadEngineSource } from "./useThreadActions.helpers.recovery";

/**
 * 用于 `isRetainableEngineContinuitySummary` 的引擎特定 pending 前缀映射。
 *
 * 设计契约：
 * - Claude / Codex / OpenCode：检查对应 `<engine>-pending-` 前缀。
 * - Pending thread 是短期占位态，不能被 last-good seed 复活为历史会话。
 */
type EngineSource = NonNullable<ThreadSummary["engineSource"]>;

const PENDING_PREFIXES_BY_ENGINE: Partial<Record<EngineSource, string>> = {
  claude: "claude-pending-",
  codex: "codex-pending-",
  opencode: "opencode-pending-",
  dsh: "dsh-pending-",
  gemini: "gemini-pending-",
  grok: "grok-pending-",
  kimi: "kimi-pending-",
  pi: "pi-pending-",
  qoder: "qoder-pending-",
};

function isPendingEngineThreadId(
  engine: EngineSource,
  threadId: string,
): boolean {
  const prefix = PENDING_PREFIXES_BY_ENGINE[engine];
  if (!prefix) {
    return false;
  }
  const id = threadId.trim().toLowerCase();
  return id.startsWith(prefix) || id.startsWith(`${engine}:${prefix}`);
}

/**
 * 引擎归一化的 retainable 判定：用于决定 last-good 中某条 summary 是否仍可作为
 * sidebar 兜底 seed 的候选。规则跨引擎共享：
 *
 * - 引擎归属必须匹配 `engine` 参数；
 * - shared / archived 条目 MUST 拒绝；
 * - pending 前缀条目 MUST 拒绝（避免把短期占位 thread 当历史）。
 *
 * 既有 `isRetainableClaudeContinuitySummary` / `isRetainableCodexContinuitySummary`
 * 现已收敛到该通用版本的薄包装，确保跨引擎行为收口在同一处。
 */
export function isRetainableEngineContinuitySummary(
  engine: EngineSource,
  summary: ThreadSummary,
): boolean {
  if (inferThreadEngineSource(summary.id, summary) !== engine) {
    return false;
  }
  if (summary.threadKind === "shared") {
    return false;
  }
  if ((summary.archivedAt ?? 0) > 0) {
    return false;
  }
  if (isPendingEngineThreadId(engine, summary.id)) {
    return false;
  }
  return true;
}

function isRetainableCodexContinuitySummary(summary: ThreadSummary): boolean {
  return isRetainableEngineContinuitySummary("codex", summary);
}

export function shouldApplyCodexSidebarContinuity(
  partialSource: string | null,
): boolean {
  if (!partialSource) {
    return false;
  }
  const normalized = partialSource.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("thread-list") ||
    normalized.includes("codex") ||
    normalized.includes("workspace-not-connected") ||
    normalized.includes("runtime unavailable") ||
    normalized.includes("guarded-recovery") ||
    normalized.includes("local-session-scan")
  );
}

export function mergeDegradedCodexContinuitySummaries(
  baseSummaries: ThreadSummary[],
  fallbackSummaries: ThreadSummary[],
): ThreadSummary[] {
  if (fallbackSummaries.length === 0) {
    return baseSummaries;
  }
  const mergedById = new Map<string, ThreadSummary>();
  baseSummaries.forEach((entry) => mergedById.set(entry.id, entry));
  fallbackSummaries.forEach((entry) => {
    if (
      !isRetainableCodexContinuitySummary(entry) ||
      mergedById.has(entry.id)
    ) {
      return;
    }
    mergedById.set(entry.id, entry);
  });
  return Array.from(mergedById.values()).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

function isRetainableClaudeContinuitySummary(summary: ThreadSummary): boolean {
  return isRetainableEngineContinuitySummary("claude", summary);
}

export function shouldApplyClaudeSidebarContinuity(
  partialSource: string | null,
): boolean {
  if (!partialSource) {
    return false;
  }
  const normalized = partialSource.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("claude") ||
    normalized.includes("catalog") ||
    normalized.includes("empty-thread-list") ||
    normalized.includes("partial") ||
    normalized.includes("timeout")
  );
}

export function mergeDegradedClaudeContinuitySummaries(
  baseSummaries: ThreadSummary[],
  fallbackSummaries: ThreadSummary[],
  excludedThreadIds: ReadonlySet<string> = new Set(),
): ThreadSummary[] {
  if (fallbackSummaries.length === 0) {
    return baseSummaries;
  }
  return projectSessionDisplaySummaries({
    baseSummaries,
    candidateSummaries: fallbackSummaries,
    excludedThreadIds,
    canRetainCandidate: isRetainableClaudeContinuitySummary,
    mergeOlderCandidates: true,
  });
}

export function filterRetainableContinuitySummaries(
  summaries: ThreadSummary[],
  excludedThreadIds: ReadonlySet<string> = new Set(),
): ThreadSummary[] {
  return summaries.filter((summary) => {
    if (excludedThreadIds.has(summary.id)) {
      return false;
    }
    const engine = inferThreadEngineSource(summary.id, summary);
    if (engine !== "claude" && engine !== "codex" && engine !== "opencode") {
      return summary.threadKind !== "shared" && (summary.archivedAt ?? 0) <= 0;
    }
    return isRetainableEngineContinuitySummary(engine, summary);
  });
}

/**
 * 引擎归一化的 last-good seed：当指定引擎的 native listing 子请求 timeout / null / rejected 时，
 * 把 last-good 列表里仍然适用的对应引擎条目（非 archived、非 shared、非 pending、未被 hidden binding
 * 排除）seed 进当前正在合并的 mergedById。这是 partial-source merge 之前的第一道防线，避免下游
 * catalog merge / archive merge 在只看到空子源时形成残缺基底。
 *
 * 设计契约（详见 `openspec/specs/sidebar-list-timeout-fallback/spec.md`）：
 * - engine 联合类型仅含已纳入主链路 seed 的引擎（"claude" | "opencode"）。
 * - Codex 走 `mergeCodexCatalogSessionSummaries` 的空源早退路径，主链路无需 seed。
 * - Gemini 走 fire-and-forget 独立异步任务，timeout 时不触碰 mergedById，主链路无需 seed。
 * - 任何后续把 Codex / Gemini 改成主链路同步合并的重构，MUST 重新评估该 engine 联合类型并补 seed。
 *
 * 该函数原地修改 mergedById；返回实际 seed 进去的条目数，便于诊断与测试。
 */
export function seedLastGoodEngineIntoMerged(
  engine: "claude" | "opencode",
  mergedById: Map<string, ThreadSummary>,
  lastGoodSummaries: ThreadSummary[],
  excludedThreadIds: ReadonlySet<string> = new Set(),
): number {
  if (lastGoodSummaries.length === 0) {
    return 0;
  }
  let seeded = 0;
  for (const entry of lastGoodSummaries) {
    if (excludedThreadIds.has(entry.id)) {
      continue;
    }
    if (!isRetainableEngineContinuitySummary(engine, entry)) {
      continue;
    }
    const previous = mergedById.get(entry.id);
    if (previous && previous.updatedAt >= entry.updatedAt) {
      if (
        isWeakSessionDisplayTitle(previous.name) &&
        !isWeakSessionDisplayTitle(entry.name)
      ) {
        mergedById.set(entry.id, mergeSessionDisplaySummary(entry, previous));
        seeded += 1;
      }
      continue;
    }
    mergedById.set(
      entry.id,
      previous ? mergeSessionDisplaySummary(previous, entry) : entry,
    );
    seeded += 1;
  }
  return seeded;
}

/**
 * Claude 引擎兜底 seed 的薄包装：行为 100% 等价于
 * `seedLastGoodEngineIntoMerged("claude", ...)`，保留为兼容 1f2f87f1 修复中既有调用点与
 * `useThreadActions.timeout-fallback.test.tsx` 中的测试入口。
 */
export function seedLastGoodClaudeIntoMerged(
  mergedById: Map<string, ThreadSummary>,
  lastGoodSummaries: ThreadSummary[],
  excludedThreadIds: ReadonlySet<string> = new Set(),
): number {
  return seedLastGoodEngineIntoMerged(
    "claude",
    mergedById,
    lastGoodSummaries,
    excludedThreadIds,
  );
}

/**
 * OpenCode 引擎兜底 seed 的薄包装：行为 100% 等价于
 * `seedLastGoodEngineIntoMerged("opencode", ...)`，用于 OpenCode 子源 timeout / rejected 时
 * 保留上一轮可用的 OpenCode 历史条目。
 */
export function seedLastGoodOpenCodeIntoMerged(
  mergedById: Map<string, ThreadSummary>,
  lastGoodSummaries: ThreadSummary[],
  excludedThreadIds: ReadonlySet<string> = new Set(),
): number {
  return seedLastGoodEngineIntoMerged(
    "opencode",
    mergedById,
    lastGoodSummaries,
    excludedThreadIds,
  );
}
