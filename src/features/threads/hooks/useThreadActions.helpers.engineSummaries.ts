import { asNumber } from "../utils/threadNormalize";
import { extractThreadSizeBytes } from "./useThreadActions.helpers.recovery";
import type { ThreadSummary } from "../../../types";
import { previewThreadName } from "../../../utils/threadItems";
import { getCollabWorkerNativeHideIds } from "../../multi-agent/runtime/collabNativeHideRegistry";
import { asString } from "../utils/threadNormalize";
import {
  hasCodexBackgroundHelperPreview,
  isCommitMessageHelperPreview,
} from "../utils/codexBackgroundHelpers";
import {
  isWeakSessionDisplayTitle,
  mergeSessionDisplaySummary,
  normalizeSessionDisplayTitle,
  selectProjectedSessionDisplayName,
  SessionDisplayTitleSources,
} from "../utils/sessionDisplayProjection";
import {
  classifyContextProtocolText,
  isMossxProgramControlTitle,
} from "../../../utils/contextProtocol";
import { remapThreadParentsToSharedOwners } from "../../shared-session/runtime/sharedSessionSummaries";
import { sharedHideIdentityIntersects } from "../../shared-session/runtime/sharedHideIdentity";
import { resolveMergedThreadCreatedAt } from "../utils/threadSummarySort";
import {
  canonicalQoderProviderProfileId,
  canonicalQoderThreadId,
} from "../utils/qoderSessionIdentity";
import {
  shouldHidePlaceholderNativeDraftFromSidebar,
  stripEmptyClaudeIndexFallbackSummaries,
} from "./sessionIndexThreadSummaries";

export type GeminiSessionSummary = {
  sessionId: string;
  firstMessage: string;
  createdAt?: number;
  updatedAt: number;
  fileSizeBytes?: number;
};

// Kimi session summaries share the Gemini summary shape (id/message/updatedAt/size).
export type KimiSessionSummary = GeminiSessionSummary;

// Pi：fork 派生文件带 parentSessionId（源 session id）——侧栏「pi 派生隐藏」
// 过滤（useThreadRows）依赖它转成 parentThreadId；丢了会让派生分支泄露成
// 顶层行（session-index 路径有 parent，live disk list 路径不能缺）。
export type PiSessionSummary = GeminiSessionSummary & {
  parentSessionId?: string | null;
};

export type QoderSessionSummary = KimiSessionSummary & {
  providerProfileId: string;
  providerProfileName?: string | null;
};

export type DshSessionSummary = GeminiSessionSummary & {
  agentPreset?: string | null;
};

// Grok：在 Gemini 形状上扩展 parent / sessionKind（子代理树）
export type GrokSessionSummary = GeminiSessionSummary & {
  parentSessionId?: string | null;
  sessionKind?: string | null;
};

export type CodexCatalogSessionSummary = {
  sessionId: string;
  workspaceId?: string | null;
  title: string;
  nativeTitle?: string | null;
  createdAt?: number;
  updatedAt: number;
  archivedAt?: number | null;
  sizeBytes?: number;
  physicalPath?: string | null;
  parentSessionId?: string | null;
  engine?: ThreadSummary["engineSource"] | string | null;
  source?: string | null;
  provider?: string | null;
  sourceLabel?: string | null;
  providerProfileId?: string | null;
  providerProfileSource?: string | null;
  providerProfileName?: string | null;
  providerAvailability?: string | null;
  folderId?: string | null;
  autoSession?: ThreadSummary["autoSession"];
  originKind?: string | null;
  sourceSessionId?: string | null;
  sourceProviderProfileId?: string | null;
  familyId?: string | null;
  familyRootSessionId?: string | null;
  lineageParentSessionId?: string | null;
  lineageKind?: string | null;
  lineageDepth?: number | null;
};

export function normalizeQoderSessionSummaries(
  value: unknown,
  fallbackProviderProfileId?: string | null,
): QoderSessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sessions: QoderSessionSummary[] = [];
  value.forEach((entry) => {
    const base = normalizeGeminiSessionSummary(entry);
    if (!base || !entry || typeof entry !== "object") {
      return;
    }
    const record = entry as Record<string, unknown>;
    const recordedProviderProfileId = asString(
      record.providerProfileId ?? record.provider_profile_id,
    ).trim();
    const providerProfileId = canonicalQoderProviderProfileId(
      recordedProviderProfileId || fallbackProviderProfileId,
    );
    if (!providerProfileId) {
      return;
    }
    const providerProfileName = asString(
      record.providerProfileName ?? record.provider_profile_name,
    ).trim();
    sessions.push({
      ...base,
      providerProfileId,
      ...(providerProfileName ? { providerProfileName } : {}),
    });
  });
  return sessions;
}

function normalizeDshSessionSummary(value: unknown): DshSessionSummary | null {
  const base = normalizeGeminiSessionSummary(value);
  if (!base) {
    return null;
  }
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value as Record<string, unknown>;
  const agentPreset = asString(record.agentPreset ?? record.agent_preset).trim();
  return agentPreset ? { ...base, agentPreset } : base;
}

export function normalizeDshSessionSummaries(
  value: unknown,
): DshSessionSummary[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? ((value as Record<string, unknown>).sessions ??
        (value as Record<string, unknown>).items ??
        (value as Record<string, unknown>).data)
      : [];
  if (!Array.isArray(raw)) {
    return [];
  }
  const summaries: DshSessionSummary[] = [];
  raw.forEach((entry) => {
    const summary = normalizeDshSessionSummary(entry);
    if (summary) {
      summaries.push(summary);
    }
  });
  return summaries;
}

function normalizeGrokSessionSummary(value: unknown): GrokSessionSummary | null {
  const base = normalizeGeminiSessionSummary(value);
  if (!base) {
    return null;
  }
  if (!value || typeof value !== "object") {
    return base;
  }
  const record = value as Record<string, unknown>;
  const parentSessionId = asString(
    record.parentSessionId ?? record.parent_session_id,
  ).trim();
  const sessionKind = asString(
    record.sessionKind ?? record.session_kind,
  ).trim();
  return {
    ...base,
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(sessionKind ? { sessionKind } : {}),
  };
}

export function normalizeGrokSessionSummaries(
  value: unknown,
): GrokSessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const summaries: GrokSessionSummary[] = [];
  value.forEach((entry) => {
    const summary = normalizeGrokSessionSummary(entry);
    if (summary) {
      summaries.push(summary);
    }
  });
  return summaries;
}

/**
 * 协作 multi-agent worker 的 Codex 首包标题（整段 multi-line context）。
 * 特征：MOSSX 包 + `binding:squad:`（Provider Continuation 单行 package 不含 squad）。
 * 安全：不单凭 `Agent N` / 普通 MOSSX 单行 package 误杀用户会话或续接会话。
 */
export function isSharedCollabWorkerSpawnTitle(
  value: string | null | undefined,
): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return false;
  // 协作 worker context 必含 squad binding key
  if (
    /binding\s*:\s*squad:/i.test(normalized) &&
    (normalized.includes("MOSSX_CONTEXT_PACKAGE:") ||
      normalized.includes("MOSSX_SHARED_CONTEXT_V1"))
  ) {
    return true;
  }
  return false;
}

/**
 * 协作规划段把模型首行 `SUMMARY: …` 写进 native session 标题（preview 后常见
 * `SUMMARY: 创建…` / 截断 `SUM`）。这不是用户会话，侧栏必须隐藏。
 * 不匹配句中讨论（非行首），避免误伤。
 */
export function isCollabPlanSummarySidebarTitle(
  value: string | null | undefined,
): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return false;
  // 半角/全角冒号
  if (/^SUMMARY\s*[:：]/i.test(normalized)) return true;
  // previewThreadName 截到极短：`SUM` / `SUMMARY`
  if (/^SUM(?:MARY)?$/i.test(normalized)) return true;
  return false;
}

/**
 * 协作 worker 首包/改名后的侧栏碎片标题。
 *
 * ⚠️ 仅匹配 **协作管线特有** 文案，禁止泛 Markdown（`##` / `**`）——否则 native
 * 用户首条消息是「## 需求」会被误踢出侧栏。
 */
export function isCollabWorkerOrchestrationPromptTitle(
  value: string | null | undefined,
): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return false;
  // 自定义模板 stage id 也是【draft】/【polish】等，不能只认中文规划/实现/审查
  if (/多\s*Agent\s*协作管线/i.test(normalized)) return true;
  if (/【[^】]{1,32}】\s*环节/.test(normalized)) return true;
  if (/binding\s*:\s*squad:/i.test(normalized)) return true;
  // 本环节自定义指令 / 协作交付说明块（非任意 **bold**）
  if (normalized.includes("本环节自定义指令")) return true;
  if (/^\*\*交付说明\*\*/.test(normalized)) return true;
  if (/^交付说明\b/.test(normalized)) return true;
  return false;
}

/**
 * Codex catalog 常把 worker 显示名压成 `Agent 11`。
 * 仅当同时具备协作信号时才 hide，避免误杀用户真·Agent 会话。
 * 协作信号：shared 父、hide set（由调用方先查）、nativeTitle/raw 仍含协作特征。
 */
export function isCollabWorkerAgentNumberTitle(
  value: string | null | undefined,
): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  return /^Agent\s+\d+$/i.test(normalized);
}

/**
 * Shared control-plane / 程序内部 session 标题闸（侧栏 hide 安全网）。
 *
 * 命中任一即视为非用户顶层会话：
 * 1. 行首 `MOSSX_*`（含 previewThreadName 截断后的半截 package）
 * 2. 完整 protocol classify（未截断的 exact marker / envelope）
 * 3. 协作 worker multi-line（MOSSX + binding:squad:）
 * 4. 协作规划 SUMMARY 标题（改名后仍泄漏的主形态）
 *
 * 不单凭 `Agent N` 删行；Shared 顶层行由 stripHiddenSharedBindingSummaries 豁免。
 */
export function isSharedControlPlaneSpawnTitle(
  value: string | null | undefined,
): boolean {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) return false;
  // 行首 MOSSX_：覆盖截断 title（主缺口）与全部已知 control token
  if (isMossxProgramControlTitle(normalized)) {
    return true;
  }
  // 完整 protocol envelope（未截断 multi-line 也可能被 classify 命中）
  if (classifyContextProtocolText(normalized) !== null) {
    return true;
  }
  // 协作规划 SUMMARY 当 title（实机侧栏：`SUMMARY: 创建…` / `SUM`）
  if (isCollabPlanSummarySidebarTitle(normalized)) {
    return true;
  }
  // 协作 worker 管线 prompt 当 firstMessage / title
  if (isCollabWorkerOrchestrationPromptTitle(normalized)) {
    return true;
  }
  // 协作 worker multi-line 包（binding:squad: 可能在截断后丢失，raw 路径另拦）
  return isSharedCollabWorkerSpawnTitle(normalized);
}

/** hide set 命中：id 本体 + 已知 engine 前缀 + Codex rollout stem / canonical uuid */
export function threadIdInHiddenSharedBindingSet(
  threadId: string,
  hiddenSharedBindingIds: ReadonlySet<string>,
): boolean {
  return sharedHideIdentityIntersects(threadId, hiddenSharedBindingIds);
}

/**
 * 从侧栏快照剔除 Shared Hidden Native Binding。
 * hide set 由 expandHiddenSharedBindingIds 构建（含 raw / engine:raw / pending 变体）。
 * 额外：剔除 control-plane 标题的 native 行（MOSSX 包 / 协作 context）。
 */
export function stripHiddenSharedBindingSummaries(
  summaries: ThreadSummary[],
  hiddenSharedBindingIds: ReadonlySet<string>,
): ThreadSummary[] {
  if (summaries.length === 0) {
    return summaries;
  }
  // 并入协作 worker runtime 登记表（改名 Agent N 后 id 仍命中）
  const collabHide = getCollabWorkerNativeHideIds();
  const effectiveHide =
    collabHide.size === 0
      ? hiddenSharedBindingIds
      : new Set<string>([...hiddenSharedBindingIds, ...collabHide]);
  let changed = false;
  const next = summaries.filter((summary) => {
    if (threadIdInHiddenSharedBindingSet(summary.id, effectiveHide)) {
      changed = true;
      return false;
    }
    // Shared 顶层会话永不因 control-plane 标题被误杀
    if (summary.id.startsWith("shared:") || summary.threadKind === "shared") {
      return true;
    }
    if (isSharedControlPlaneSpawnTitle(summary.name)) {
      changed = true;
      return false;
    }
    // Shared 子代理：store 中保留（childSubagentThreads / Strip / 幕布合成）。
    // 侧栏「不展示崽子」由 useThreadRows.isSharedSidebarHiddenPup 负责，不在此删行。
    return true;
  });
  return changed ? next : summaries;
}

function mergeNativeCliSessionSummaries(params: {
  baseSummaries: ThreadSummary[];
  sessions: Array<
    GeminiSessionSummary & {
      parentSessionId?: string | null;
      sessionKind?: string | null;
      agentPreset?: string | null;
      providerProfileId?: string | null;
      providerProfileName?: string | null;
    }
  >;
  idPrefix: "gemini" | "grok" | "kimi" | "pi" | "dsh" | "qoder";
  engineSource: "gemini" | "grok" | "kimi" | "pi" | "dsh" | "qoder";
  fallbackTitle: string;
  workspaceId: string;
  mappedTitles: Record<string, string>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  /** Shared-owned native ids；baseline 与新增 session 都必须剔除 */
  hiddenSharedBindingIds?: ReadonlySet<string>;
}): ThreadSummary[] {
  const {
    sessions,
    idPrefix,
    engineSource,
    fallbackTitle,
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  } = params;
  // sessions 全被 hide 过滤为空时，仍要清 baseline 泄漏；禁止 early-return 原 base。
  const baseSummaries = stripEmptyClaudeIndexFallbackSummaries(
    stripHiddenSharedBindingSummaries(
      params.baseSummaries,
      hiddenSharedBindingIds ?? new Set(),
    ),
  );
  if (sessions.length === 0) {
    return baseSummaries;
  }
  const mergedById = new Map<string, ThreadSummary>();
  baseSummaries.forEach((entry) => mergedById.set(entry.id, entry));
  sessions.forEach((session) => {
    const id =
      engineSource === "qoder"
        ? canonicalQoderThreadId(session.sessionId, session.providerProfileId)
        : `${idPrefix}:${session.sessionId}`;
    if (!id) {
      return;
    }
    // id 本体 + bare uuid（与 Codex catalog 路径对齐，避免 hide set 变体漏网）
    if (
      threadIdInHiddenSharedBindingSet(
        id,
        hiddenSharedBindingIds ?? new Set(),
      )
    ) {
      return;
    }
    // 在 clip 标题前用 raw firstMessage 拦 control-plane（截断会丢 sha256 body）
    if (isSharedControlPlaneSpawnTitle(session.firstMessage)) {
      return;
    }
    // commit-message / title / memory helpers：native CLI 列表常丢 autoSession
    if (isCommitMessageHelperPreview(session.firstMessage)) {
      return;
    }
    const prev = mergedById.get(id);
    const updatedAt = Number.isFinite(session.updatedAt)
      ? Math.max(0, session.updatedAt)
      : 0;
    const createdAt = resolveMergedThreadCreatedAt(prev, {
      createdAt: session.createdAt,
      updatedAt,
    });
    const mappedTitle = mappedTitles[id];
    const customTitle = getCustomName(workspaceId, id);
    const title = previewThreadName(session.firstMessage, fallbackTitle);
    if (
      shouldHidePlaceholderNativeDraftFromSidebar({
        engine: engineSource,
        threadId: id,
        displayName: title,
        hasCustomName: Boolean(customTitle || mappedTitle),
      })
    ) {
      return;
    }
    // 双闸：clip 后 name 仍 control-plane / SUMMARY / MOSSX 则不入侧栏
    if (isSharedControlPlaneSpawnTitle(title)) {
      return;
    }
    // mapped/custom 改名后的展示名也过闸（避免「继续：」类之外的协作残留）
    if (
      isSharedControlPlaneSpawnTitle(mappedTitle) ||
      isSharedControlPlaneSpawnTitle(customTitle)
    ) {
      return;
    }
    const rawParent = session.parentSessionId?.trim() || "";
    const parentThreadId =
      rawParent.length > 0
        ? engineSource === "qoder"
          ? canonicalQoderThreadId(rawParent, session.providerProfileId)
          : rawParent.startsWith(`${idPrefix}:`)
            ? rawParent
            : `${idPrefix}:${rawParent}`
        : prev?.parentThreadId ?? null;
    const next: ThreadSummary = {
      id,
      name: selectProjectedSessionDisplayName({
        previous: prev,
        nextName: title,
        mappedTitle,
        customTitle,
      }),
      updatedAt,
      ...(createdAt !== undefined ? { createdAt } : {}),
      sizeBytes: session.fileSizeBytes,
      engineSource,
      ...(parentThreadId ? { parentThreadId } : {}),
      ...(typeof session.agentPreset === "string" && session.agentPreset.trim()
        ? { dshAgentPreset: session.agentPreset.trim() }
        : {}),
      ...(engineSource === "qoder" && session.providerProfileId
        ? {
            providerProfileId: session.providerProfileId,
            ...(session.providerProfileName
              ? { providerProfileName: session.providerProfileName }
              : {}),
          }
        : {}),
    };
    if (
      !prev ||
      next.updatedAt >= prev.updatedAt ||
      (
        isWeakSessionDisplayTitle(prev.name) &&
        !isWeakSessionDisplayTitle(next.name)
      )
    ) {
      const merged = mergeSessionDisplaySummary(prev, next, {
        mappedTitle,
        customTitle,
      });
      // 保留 parent 链接（mergeSessionDisplaySummary 可能丢掉新字段）
      mergedById.set(id, {
        ...merged,
        parentThreadId:
          next.parentThreadId ?? merged.parentThreadId ?? prev?.parentThreadId ?? null,
        dshAgentPreset:
          next.dshAgentPreset ?? merged.dshAgentPreset ?? prev?.dshAgentPreset,
        providerProfileId:
          next.providerProfileId ??
          merged.providerProfileId ??
          prev?.providerProfileId,
        providerProfileName:
          next.providerProfileName ??
          merged.providerProfileName ??
          prev?.providerProfileName,
      });
    } else if (
      (parentThreadId && !prev.parentThreadId) ||
      (next.dshAgentPreset && !prev.dshAgentPreset)
    ) {
      // 本地 live 线程 updatedAt 更新时，仍要把 list 扫到的 parent / preset 补回去
      mergedById.set(id, {
        ...prev,
        ...(parentThreadId ? { parentThreadId } : {}),
        ...(next.dshAgentPreset ? { dshAgentPreset: next.dshAgentPreset } : {}),
        ...(next.providerProfileId
          ? { providerProfileId: next.providerProfileId }
          : {}),
        ...(next.providerProfileName
          ? { providerProfileName: next.providerProfileName }
          : {}),
      });
    }
  });
  return stripEmptyClaudeIndexFallbackSummaries(
    Array.from(mergedById.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    ),
  );
}

export function mergeGeminiSessionSummaries(
  baseSummaries: ThreadSummary[],
  geminiSessions: GeminiSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  hiddenSharedBindingIds?: ReadonlySet<string>,
): ThreadSummary[] {
  return mergeNativeCliSessionSummaries({
    baseSummaries,
    sessions: geminiSessions,
    idPrefix: "gemini",
    engineSource: "gemini",
    fallbackTitle: "Gemini Session",
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  });
}

export function mergeKimiSessionSummaries(
  baseSummaries: ThreadSummary[],
  kimiSessions: KimiSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  hiddenSharedBindingIds?: ReadonlySet<string>,
): ThreadSummary[] {
  return mergeNativeCliSessionSummaries({
    baseSummaries,
    sessions: kimiSessions,
    idPrefix: "kimi",
    engineSource: "kimi",
    fallbackTitle: "Kimi Session",
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  });
}

export function mergePiSessionSummaries(
  baseSummaries: ThreadSummary[],
  piSessions: PiSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  hiddenSharedBindingIds?: ReadonlySet<string>,
): ThreadSummary[] {
  return mergeNativeCliSessionSummaries({
    baseSummaries,
    sessions: piSessions,
    idPrefix: "pi",
    engineSource: "pi",
    fallbackTitle: "PI Session",
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  });
}

export function mergeQoderSessionSummaries(
  baseSummaries: ThreadSummary[],
  qoderSessions: QoderSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  hiddenSharedBindingIds?: ReadonlySet<string>,
): ThreadSummary[] {
  return mergeNativeCliSessionSummaries({
    baseSummaries,
    sessions: qoderSessions,
    idPrefix: "qoder",
    engineSource: "qoder",
    fallbackTitle: "Qoder Session",
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  });
}

export function mergeDshSessionSummaries(
  baseSummaries: ThreadSummary[],
  dshSessions: DshSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  hiddenSharedBindingIds?: ReadonlySet<string>,
): ThreadSummary[] {
  return mergeNativeCliSessionSummaries({
    baseSummaries,
    sessions: dshSessions,
    idPrefix: "dsh",
    engineSource: "dsh",
    fallbackTitle: "DSH Session",
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  });
}

export function mergeGrokSessionSummaries(
  baseSummaries: ThreadSummary[],
  grokSessions: GrokSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  /** native owner → shared: 会话，把子代理挂到 Shared 父节点 */
  nativeOwnerToSharedThreadId?: Map<string, string>,
  hiddenSharedBindingIds?: ReadonlySet<string>,
): ThreadSummary[] {
  const merged = mergeNativeCliSessionSummaries({
    baseSummaries,
    sessions: grokSessions,
    idPrefix: "grok",
    engineSource: "grok",
    fallbackTitle: "Grok Session",
    workspaceId,
    mappedTitles,
    getCustomName,
    hiddenSharedBindingIds,
  });
  if (!nativeOwnerToSharedThreadId || nativeOwnerToSharedThreadId.size === 0) {
    return merged;
  }
  // 与主路径 remap 共用 lookup（raw / engine: 变体），禁止 exact map.get only
  return remapThreadParentsToSharedOwners(merged, nativeOwnerToSharedThreadId);
}

function normalizeCatalogEngine(
  engine: CodexCatalogSessionSummary["engine"],
): ThreadSummary["engineSource"] {
  switch (engine) {
    case "claude":
    case "codex":
    case "gemini":
    case "grok":
    case "kimi":
    case "pi":
    case "qoder":
    case "opencode":
    case "dsh":
      return engine;
    default:
      return "codex";
  }
}

function selectStableThreadSummaryName(
  params: {
    previous?: ThreadSummary;
    nextName: string;
    engineSource: ThreadSummary["engineSource"];
  } & SessionDisplayTitleSources,
): string {
  return selectProjectedSessionDisplayName(params);
}

export function mergeThreadSummaryPreservingStableIdentity(
  previous: ThreadSummary | undefined,
  next: ThreadSummary,
  titleSources: SessionDisplayTitleSources = {},
): ThreadSummary {
  return mergeSessionDisplaySummary(previous, next, titleSources);
}

export function mergeCodexCatalogSessionSummaries(
  baseSummaries: ThreadSummary[],
  codexSessions: CodexCatalogSessionSummary[],
  workspaceId: string,
  mappedTitles: Record<string, string>,
  getCustomName: (workspaceId: string, threadId: string) => string | undefined,
  /** Shared-owned native ids；merge 前剔除，避免改名成 Agent N 后漏网 */
  hiddenSharedBindingIds: ReadonlySet<string> = new Set(),
): ThreadSummary[] {
  // 先清 baseline 泄漏
  const safeBase = stripEmptyClaudeIndexFallbackSummaries(
    stripHiddenSharedBindingSummaries(
      baseSummaries,
      hiddenSharedBindingIds,
    ),
  );
  if (codexSessions.length === 0) {
    return safeBase;
  }
  const mergedById = new Map<string, ThreadSummary>();
  safeBase.forEach((entry) => mergedById.set(entry.id, entry));
  codexSessions.forEach((session) => {
    const title = normalizeSessionDisplayTitle(session.title);
    const nativeTitle = normalizeSessionDisplayTitle(session.nativeTitle);
    const engineSource = normalizeCatalogEngine(session.engine);
    if (!title && !nativeTitle) {
      return;
    }
    // id hide（含 raw / engine: 变体）
    if (
      threadIdInHiddenSharedBindingSet(
        session.sessionId,
        hiddenSharedBindingIds,
      )
    ) {
      return;
    }
    // 协作 worker multi-line（改名 Agent N 前）必须拦
    if (
      isSharedCollabWorkerSpawnTitle(title) ||
      isSharedCollabWorkerSpawnTitle(nativeTitle)
    ) {
      return;
    }
    // 程序 MOSSX_* / SUMMARY / 管线 prompt / Markdown 碎片：非 Provider Continuation 直接丢
    const isControlPlaneTitle =
      isSharedControlPlaneSpawnTitle(title) ||
      isSharedControlPlaneSpawnTitle(nativeTitle);
    const isProviderContinuation =
      session.originKind === "provider-continuation";
    if (isControlPlaneTitle && !isProviderContinuation) {
      return;
    }
    // ⚠️ 禁止：凡 Agent N + parentSessionId 就丢——会误杀 native Codex/Claude 子代理树。
    // 协作 worker 改名 Agent N 的主路径：hide set / collabNativeHideRegistry / MOSSX nativeTitle。
    if (!nativeTitle && isCommitMessageHelperPreview(title)) {
      return;
    }
    if (
      engineSource === "codex" &&
      !nativeTitle &&
      hasCodexBackgroundHelperPreview([title])
    ) {
      return;
    }
    const prev = mergedById.get(session.sessionId);
    const updatedAt = Number.isFinite(session.updatedAt)
      ? Math.max(0, session.updatedAt)
      : 0;
    const createdAt = resolveMergedThreadCreatedAt(prev, {
      createdAt: session.createdAt,
      updatedAt,
    });
    const parentThreadId =
      engineSource === "claude" && session.parentSessionId
        ? session.parentSessionId.startsWith("claude:")
          ? session.parentSessionId
          : `claude:${session.parentSessionId}`
        : (session.parentSessionId ?? null);
    const mappedTitle = mappedTitles[session.sessionId];
    const ownerWorkspaceId = session.workspaceId ?? workspaceId;
    const ownerCustomTitle = getCustomName(ownerWorkspaceId, session.sessionId);
    const selectedWorkspaceCustomTitle =
      ownerWorkspaceId === workspaceId
        ? undefined
        : getCustomName(workspaceId, session.sessionId);
    const customTitle = ownerCustomTitle || selectedWorkspaceCustomTitle;
    // Index / first-paint already drop empty native Session fallbacks.
    // Live catalog still emits them from session_meta-only files; skip so
    // hydration cannot resurrect the same pups.
    if (
      !isProviderContinuation &&
      !nativeTitle &&
      !customTitle &&
      !mappedTitle &&
      !isCollabWorkerAgentNumberTitle(title) &&
      shouldHidePlaceholderNativeDraftFromSidebar({
        engine: engineSource,
        threadId: session.sessionId,
        displayName: title,
      })
    ) {
      return;
    }
    const engineFallbackTitle =
      engineSource === "claude"
        ? "Claude Session"
        : engineSource === "gemini"
          ? "Gemini Session"
          : engineSource === "grok"
            ? "Grok Session"
            : engineSource === "kimi"
              ? "Kimi Session"
              : engineSource === "pi"
                ? "PI Session"
                : engineSource === "qoder"
                  ? "Qoder Session"
                : engineSource === "opencode"
                  ? "OpenCode Session"
                  : engineSource === "dsh"
                    ? "DSH Session"
                    : "Codex Session";
    const continuationSourceName = session.sourceSessionId
      ? mergedById.get(session.sourceSessionId)?.name?.trim()
      : null;
    const continuationFallbackTitle =
      isProviderContinuation
        ? continuationSourceName
          ? `继续：${continuationSourceName}`
          : `Provider 续接 · ${
              session.providerProfileName?.trim() ||
              engineFallbackTitle.replace(/ Session$/, "")
            }`
        : null;
    // 截断 title 无法 classify；用 control-plane 闸（含 MOSSX_ 行首）触发改写
    const fallbackTitle =
      continuationFallbackTitle && isControlPlaneTitle
        ? continuationFallbackTitle
        : previewThreadName(title || nativeTitle, engineFallbackTitle);
    const next: ThreadSummary = {
      id: session.sessionId,
      name: selectStableThreadSummaryName({
        previous: prev,
        nextName: fallbackTitle,
        mappedTitle,
        customTitle,
        nativeTitle,
        engineSource,
      }),
      updatedAt,
      ...(createdAt !== undefined ? { createdAt } : {}),
      archivedAt:
        typeof session.archivedAt === "number" &&
        Number.isFinite(session.archivedAt) &&
        session.archivedAt > 0
          ? session.archivedAt
          : undefined,
      sizeBytes: session.sizeBytes,
      physicalPath: session.physicalPath ?? undefined,
      engineSource,
      threadKind: "native",
      source: session.source ?? undefined,
      provider: session.provider ?? undefined,
      sourceLabel: session.sourceLabel ?? undefined,
      providerProfileId: session.providerProfileId ?? undefined,
      providerProfileSource: session.providerProfileSource ?? undefined,
      providerProfileName: session.providerProfileName ?? undefined,
      providerAvailability: session.providerAvailability ?? undefined,
      folderId: session.folderId ?? null,
      autoSession: session.autoSession ?? null,
      parentThreadId,
      originKind: session.originKind ?? undefined,
      sourceSessionId: session.sourceSessionId ?? undefined,
      sourceProviderProfileId: session.sourceProviderProfileId ?? undefined,
      familyId: session.familyId ?? undefined,
      familyRootSessionId: session.familyRootSessionId ?? undefined,
      lineageParentSessionId:
        session.lineageParentSessionId ?? undefined,
      lineageKind: session.lineageKind ?? undefined,
      lineageDepth: session.lineageDepth ?? undefined,
    };
    if (!prev || next.updatedAt >= prev.updatedAt) {
      mergedById.set(
        session.sessionId,
        mergeSessionDisplaySummary(prev, next, {
          mappedTitle,
          customTitle,
          nativeTitle,
        }),
      );
    }
  });
  return stripEmptyClaudeIndexFallbackSummaries(
    Array.from(mergedById.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    ),
  );
}

function normalizeGeminiSessionSummary(
  value: unknown,
): GeminiSessionSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const sessionId = asString(record.sessionId ?? record.session_id).trim();
  if (!sessionId) {
    return null;
  }
  const fileSizeBytes = extractThreadSizeBytes(record);
  const createdAt = asNumber(record.createdAt ?? record.created_at);
  return {
    sessionId,
    firstMessage: asString(record.firstMessage ?? record.first_message).trim(),
    updatedAt: asNumber(record.updatedAt ?? record.updated_at),
    ...(createdAt > 0 ? { createdAt } : {}),
    ...(fileSizeBytes !== undefined ? { fileSizeBytes } : {}),
  };
}

export function normalizeGeminiSessionSummaries(
  value: unknown,
): GeminiSessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const summaries: GeminiSessionSummary[] = [];
  value.forEach((entry) => {
    const summary = normalizeGeminiSessionSummary(entry);
    if (summary) {
      summaries.push(summary);
    }
  });
  return summaries;
}

export function normalizeKimiSessionSummaries(
  value: unknown,
): KimiSessionSummary[] {
  // Kimi session summaries share the Gemini summary shape.
  return normalizeGeminiSessionSummaries(value);
}

export function normalizePiSessionSummaries(
  value: unknown,
): PiSessionSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const summaries: PiSessionSummary[] = [];
  value.forEach((entry) => {
    const base = normalizeGeminiSessionSummary(entry);
    if (!base) {
      return;
    }
    // 与 grok 同款：parent 字段必须带回（后端 camelCase 序列化，兼容蛇形）
    const record =
      entry && typeof entry === "object"
        ? (entry as Record<string, unknown>)
        : null;
    const parentSessionId = asString(
      record?.parentSessionId ?? record?.parent_session_id,
    ).trim();
    summaries.push({
      ...base,
      ...(parentSessionId ? { parentSessionId } : {}),
    });
  });
  return summaries;
}
