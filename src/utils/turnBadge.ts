import type { EngineType } from "../types";

export type TurnBadgeSnapshot = {
  engine: EngineType;
  providerProfileId?: string | null;
  model?: string | null;
  reasoning?: { effort: string } | null;
  providerProfileNameSnapshot?: string | null;
  providerProfileSource?: string | null;
};

export type RuntimeReceiptView = {
  model: string;
  windowLabel: string | null;
  show: boolean;
};

const SYNTHETIC_RUNTIME_MODELS = new Set(["<synthetic>", "synthetic"]);
const LONG_CONTEXT_SUFFIX = "[1m]";

export function sanitizeRuntimeReceiptModel(
  model: string | null | undefined,
): string | null {
  const trimmed = model?.trim() || "";
  if (!trimmed) {
    return null;
  }
  if (SYNTHETIC_RUNTIME_MODELS.has(trimmed.toLowerCase())) {
    return null;
  }
  return trimmed;
}

export function formatRuntimeReceiptWindowLabel(
  tokens: number | null | undefined,
  model?: string | null,
): string | null {
  if (typeof tokens === "number" && Number.isFinite(tokens) && tokens > 0) {
    if (tokens >= 1_000_000) {
      const millions = tokens / 1_000_000;
      return Number.isInteger(millions)
        ? `${millions}M`
        : `${millions.toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}K`;
    }
    return String(Math.round(tokens));
  }
  const runtime = sanitizeRuntimeReceiptModel(model);
  if (runtime && runtime.toLowerCase().includes(LONG_CONTEXT_SUFFIX)) {
    return null;
  }
  return "?";
}

export function resolveTurnRuntimeReceipt(options: {
  model?: string | null;
  contextWindowTokens?: number | null;
}): RuntimeReceiptView {
  const model = sanitizeRuntimeReceiptModel(options.model);
  if (!model) {
    return { model: "", windowLabel: null, show: false };
  }
  return {
    model,
    windowLabel: formatRuntimeReceiptWindowLabel(
      options.contextWindowTokens,
      model,
    ),
    show: true,
  };
}

export type RuntimeReceiptPanelRow = {
  label: string;
  value: string;
  note?: string | null;
};

const RECEIPT_SOURCE_COPY: Record<
  import("../types").RuntimeModelReceiptSource,
  { title: string; detail: string }
> = {
  "send.request": {
    title: "发送时记下的请求名",
    detail: "流式还没回写真实模型，先用你点的 picker / mapping 名",
  },
  "system.init.model": {
    title: "CLI 初始化事件",
    detail: "system/init 里的 model，通常是本轮最早的真实 ID",
  },
  "assistant.message.model": {
    title: "助手消息回写",
    detail: "assistant.message.model，网关实际落到的模型",
  },
  "turn.completed": {
    title: "本轮结束回写",
    detail: "turn/completed 的 result.model",
  },
};

const WINDOW_SOURCE_COPY: Record<
  NonNullable<import("../types").RuntimeModelReceiptWindowSource>,
  string
> = {
  live: "占用环 / live tokenUsage 上报",
  init: "CLI init 声明的窗口",
  unknown: "来源未标注，不按 picker 估 200K",
};

function formatRuntimeReceiptCount(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatRuntimeReceiptDuration(durationMs: number | null | undefined): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }
  if (durationMs < 1000) {
    return Math.round(durationMs) + "ms";
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return (seconds < 10 ? seconds.toFixed(1) : String(Math.round(seconds))) + "s";
  }
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? minutes + "m" : minutes + "m" + String(rest).padStart(2, "0") + "s";
}

function formatRuntimeReceiptSourceCopy(
  source: import("../types").RuntimeModelReceiptSource | null | undefined,
): { title: string; detail: string } {
  if (source && RECEIPT_SOURCE_COPY[source]) {
    return RECEIPT_SOURCE_COPY[source];
  }
  return RECEIPT_SOURCE_COPY["send.request"];
}

function formatProviderSourceLabel(source: string | null | undefined): string | null {
  if (source === "disk" || source === "local") {
    return "本地配置";
  }
  if (source === "managed") {
    return "托管供应商";
  }
  return null;
}

export function buildRuntimeReceiptPanelRows(input: {
  engineLabel: string;
  providerLabel: string;
  providerSource?: string | null;
  requestModel?: string | null;
  catalogId?: string | null;
  reasoning?: string | null;
  runtimeModel: string;
  modelSource?: import("../types").RuntimeModelReceiptSource | null;
  windowLabel?: string | null;
  windowTokens?: number | null;
  windowSource?: import("../types").RuntimeModelReceiptWindowSource | null;
  durationMs?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
}): RuntimeReceiptPanelRow[] {
  const requestModel = sanitizeRuntimeReceiptModel(input.requestModel);
  const catalogId = input.catalogId?.trim() || null;
  const runtimeModel = sanitizeRuntimeReceiptModel(input.runtimeModel) ?? input.runtimeModel;
  const matched = Boolean(requestModel && requestModel === runtimeModel);
  const providerSource = formatProviderSourceLabel(input.providerSource);
  const sourceCopy = formatRuntimeReceiptSourceCopy(input.modelSource);
  const windowTokens =
    typeof input.windowTokens === "number" &&
    Number.isFinite(input.windowTokens) &&
    input.windowTokens > 0
      ? input.windowTokens
      : null;
  const windowValue = windowTokens
    ? formatRuntimeReceiptCount(windowTokens) + " tokens"
    : input.windowLabel && input.windowLabel !== "?"
      ? input.windowLabel
      : "未上报";
  const windowNote = windowTokens
    ? WINDOW_SOURCE_COPY[input.windowSource ?? "unknown"]
    : "CLI 没给 model_context_window，不按 picker 估 200K";
  const duration = formatRuntimeReceiptDuration(input.durationMs);
  const usageParts: string[] = [];
  if (typeof input.inputTokens === "number" && Number.isFinite(input.inputTokens)) {
    usageParts.push("入 " + formatRuntimeReceiptCount(input.inputTokens));
  }
  if (typeof input.outputTokens === "number" && Number.isFinite(input.outputTokens)) {
    usageParts.push("出 " + formatRuntimeReceiptCount(input.outputTokens));
  }
  const rows: RuntimeReceiptPanelRow[] = [
    { label: "CLI", value: input.engineLabel },
    {
      label: "供应商",
      value: input.providerLabel,
      note: providerSource,
    },
    {
      label: "请求模型",
      value: requestModel ?? "未记录",
      note: catalogId && catalogId !== requestModel ? "catalog " + catalogId : null,
    },
    {
      label: "实际模型",
      value: runtimeModel,
      note: matched
        ? "与请求名一致"
        : requestModel
          ? "网关把 " + requestModel + " 映射到这个 ID"
          : "stream / init 回写",
    },
  ];
  if (input.reasoning?.trim()) {
    rows.push({ label: "思考档位", value: input.reasoning.trim() });
  }
  rows.push({
    label: "回执来源",
    value: sourceCopy.title,
    note: sourceCopy.detail + " · " + (input.modelSource ?? "send.request"),
  });
  rows.push({
    label: "上下文窗口",
    value: windowValue,
    note: windowNote,
  });
  if (duration || usageParts.length > 0) {
    rows.push({
      label: "本轮用量",
      value: [duration, usageParts.join(" · ")].filter(Boolean).join(" · ") || "未上报",
    });
  }
  return rows;
}

export type TurnBadgeUnavailableReason =
  | "provider-deleted"
  | "provider-missing"
  | "runtime-missing";

export type TurnBadgeModel = {
  engine: EngineType;
  engineLabel: string;
  providerLabel: string;
  modelLabel: string | null;
  reasoningLabel: string | null;
  unavailable: boolean;
  unavailableReason: TurnBadgeUnavailableReason | null;
};

export type TurnBadgeAvailability = {
  providerExists: boolean;
  providerAvailable: boolean;
  runtimeAvailable: boolean;
};

const FULLY_AVAILABLE: TurnBadgeAvailability = {
  providerExists: true,
  providerAvailable: true,
  runtimeAvailable: true,
};

export const LOCAL_PROVIDER_LABEL = "本地配置";
export const LOCAL_PROVIDER_SOURCE = "disk";

export function resolveEngineLabel(engine: EngineType): string {
  switch (engine) {
    case "claude":
      return "Claude Code";
    case "codex":
      return "Codex CLI";
    case "kimi":
      return "Kimi CLI";
    case "gemini":
      return "Gemini CLI";
    case "grok":
      return "Grok CLI";
    case "pi":
      return "PI CLI";
    case "omp":
      return "OMP CLI";
    case "opencode":
      return "OpenCode";
    case "dsh":
      return "DeepSeek Harness";
    case "qoder":
      return "Qoder CLI";
  }
}

export function resolveSnapshotProviderLabel(
  snapshot: TurnBadgeSnapshot,
): string {
  const name = snapshot.providerProfileNameSnapshot?.trim();
  if (name) {
    return name;
  }
  const id = snapshot.providerProfileId?.trim();
  if (id) {
    return id;
  }
  return snapshot.providerProfileSource?.trim() === "disk" ||
    snapshot.providerProfileSource?.trim() === "local"
    ? LOCAL_PROVIDER_LABEL
    : "历史配置未知";
}

export function resolveTurnBadge(
  snapshot: TurnBadgeSnapshot,
  availability: TurnBadgeAvailability = FULLY_AVAILABLE,
): TurnBadgeModel {
  let unavailableReason: TurnBadgeUnavailableReason | null = null;
  if (!availability.providerExists) {
    unavailableReason = "provider-deleted";
  } else if (!availability.providerAvailable) {
    unavailableReason = "provider-missing";
  } else if (!availability.runtimeAvailable) {
    unavailableReason = "runtime-missing";
  }

  return {
    engine: snapshot.engine,
    engineLabel: resolveEngineLabel(snapshot.engine),
    providerLabel: resolveSnapshotProviderLabel(snapshot),
    modelLabel: snapshot.model?.trim() || null,
    reasoningLabel: snapshot.reasoning?.effort?.trim() || null,
    unavailable: unavailableReason !== null,
    unavailableReason,
  };
}

/**
 * Stable comparison key for consecutive turn-target badge dedupe.
 * Intentionally uses identity fields only (not display labels).
 */
export function buildTurnTargetBadgeKey(
  snapshot: TurnBadgeSnapshot,
): string {
  const providerId = snapshot.providerProfileId?.trim() || "";
  const providerSource = snapshot.providerProfileSource?.trim() || "";
  const providerName = snapshot.providerProfileNameSnapshot?.trim() || "";
  const model = snapshot.model?.trim() || "";
  const reasoning = snapshot.reasoning?.effort?.trim() || "";
  return [
    snapshot.engine,
    providerId,
    providerSource,
    providerName,
    model,
    reasoning,
  ].join("\u0001");
}

type TurnTargetBadgeVisibilityItem = {
  id: string;
  kind: string;
  role?: "user" | "assistant";
  executionTargetSnapshot?: TurnBadgeSnapshot | null;
};

/**
 * Decide which assistant items should render the turn-target badge.
 *
 * Policy B (per user turn + target change):
 * - Show on the first assistant message that carries a snapshot after each user message
 *   (or at conversation start).
 * - Within the same user turn, hide consecutive assistants with an identical target key.
 * - Re-show when the target key changes mid-turn.
 */
export function buildTurnTargetBadgeVisibleItemIds(
  items: readonly TurnTargetBadgeVisibilityItem[],
): Set<string> {
  const visibleIds = new Set<string>();
  let seenAssistantWithBadgeSinceUser = false;
  let previousTargetKey: string | null = null;

  for (const item of items) {
    if (item.kind === "message" && item.role === "user") {
      seenAssistantWithBadgeSinceUser = false;
      continue;
    }

    if (item.kind !== "message" || item.role !== "assistant") {
      continue;
    }

    const snapshot = item.executionTargetSnapshot;
    if (!snapshot) {
      continue;
    }

    const targetKey = buildTurnTargetBadgeKey(snapshot);
    const shouldShow =
      !seenAssistantWithBadgeSinceUser ||
      previousTargetKey === null ||
      targetKey !== previousTargetKey;

    if (shouldShow) {
      visibleIds.add(item.id);
    }

    seenAssistantWithBadgeSinceUser = true;
    previousTargetKey = targetKey;
  }

  return visibleIds;
}
