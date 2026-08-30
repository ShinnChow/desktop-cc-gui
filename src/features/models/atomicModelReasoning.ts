/**
 * Atomic / Shared ExecutionTarget 的 model ↔ reasoning effort 联动。
 *
 * Native Codex 走 ModelOption.supportedReasoningEfforts；Shared Atomic 历史上
 * 只继承同 profile 的 effort 或 custom medium，跨引擎切到 Codex 时 effort=null
 * 且 options 仍可能来自全局 activeEngine（如 Grok 三档）。本模块把两条路径
 * 收敛到同一套 engine+model capability 解析。
 *
 * Native PI（`modelSelection.ts: getReasoningOptionsForModel`）走同一份 PI catalog
 * 投影（`supported_thinking_levels_for_pi_model`），Shared PI 在本模块走 `pi` 分支
 * 与 native 对齐（详见 `enrichModelReasoningForEngine` 与各 export 的 PI 臂）。
 */

import { CODEX_MODEL_CATALOG } from "./codexModelCatalog";
import {
  CUSTOM_MODEL_DEFAULT_REASONING_EFFORT,
  CUSTOM_MODEL_REASONING_EFFORTS,
  isUserManagedCustomModelSource,
} from "./customModelReasoning";

/** Keep aligned with `CLAUDE_REASONING_OPTIONS` in modelSelection.ts. */
const CLAUDE_REASONING_OPTIONS = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

/** Keep aligned with `GROK_REASONING_OPTIONS` / grok.rs allowlist. */
const GROK_REASONING_OPTIONS = ["low", "medium", "high"] as const;

export type AtomicReasoningModelRef = {
  id?: string | null;
  model?: string | null;
  source?: string | null;
  supportedReasoningEfforts?:
    | readonly (string | { reasoningEffort?: string | null })[]
    | null;
  defaultReasoningEffort?: string | null;
};

function normalizeEffort(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeSupportedEfforts(
  efforts: AtomicReasoningModelRef["supportedReasoningEfforts"],
): string[] {
  if (!Array.isArray(efforts) || efforts.length === 0) {
    return [];
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of efforts) {
    const effort =
      typeof entry === "string"
        ? normalizeEffort(entry)
        : normalizeEffort(entry?.reasoningEffort);
    if (!effort || seen.has(effort)) {
      continue;
    }
    seen.add(effort);
    normalized.push(effort);
  }
  return normalized;
}

function lookupCodexCatalogEntry(
  model: AtomicReasoningModelRef | null | undefined,
) {
  const candidates = [
    normalizeEffort(model?.id),
    normalizeEffort(model?.model),
  ].filter((value): value is string => Boolean(value));
  if (candidates.length === 0) {
    return null;
  }
  return (
    CODEX_MODEL_CATALOG.find((entry) =>
      candidates.some(
        (candidate) =>
          entry.id === candidate ||
          entry.label === candidate ||
          entry.id.toLowerCase() === candidate.toLowerCase(),
      ),
    ) ?? null
  );
}

/**
 * 给 Atomic ModelInfo 补齐 Codex catalog / custom 的 reasoning 元数据。
 *
 * 字段可部分缺失：仅有 default 没有 supported 时仍会从 catalog 补全 supported，
 * 避免 options 退化为单档。unknown runtime 模型保持 capability-neutral。
 */
export function enrichModelInfoWithAtomicReasoning<
  T extends AtomicReasoningModelRef,
>(engine: string | null | undefined, model: T): T & AtomicReasoningModelRef {
  if (engine !== "codex") {
    return model;
  }

  let supported = normalizeSupportedEfforts(model.supportedReasoningEfforts);
  let defaultEffort = normalizeEffort(model.defaultReasoningEffort);
  const source = model.source ?? null;

  if (source === "custom") {
    if (supported.length === 0) {
      supported = [...CUSTOM_MODEL_REASONING_EFFORTS];
    }
    if (!defaultEffort) {
      defaultEffort = CUSTOM_MODEL_DEFAULT_REASONING_EFFORT;
    }
  } else {
    const catalog = lookupCodexCatalogEntry(model);
    if (catalog) {
      if (supported.length === 0 && catalog.supportedReasoningEfforts?.length) {
        supported = catalog.supportedReasoningEfforts.map(
          (entry) => entry.reasoningEffort,
        );
      }
      if (!defaultEffort) {
        defaultEffort = normalizeEffort(catalog.defaultReasoningEffort);
      }
    }
    // provider-owned 用户管理来源（provider-custom / provider-config）在 catalog
    // identity miss 后回落公共默认档（identity 命中优先，如 relay 上的
    // gpt-5.6-sol 保留 max/ultra）；CLI runtime 发现的 unknown model
    // （source 非 custom 的未登记来源）保持 capability-neutral。
    if (isUserManagedCustomModelSource(source)) {
      if (supported.length === 0) {
        supported = [...CUSTOM_MODEL_REASONING_EFFORTS];
      }
      if (!defaultEffort) {
        defaultEffort = CUSTOM_MODEL_DEFAULT_REASONING_EFFORT;
      }
    }
  }

  const existingSupported = normalizeSupportedEfforts(
    model.supportedReasoningEfforts,
  );
  const existingDefault = normalizeEffort(model.defaultReasoningEffort);
  const supportedUnchanged =
    existingSupported.length === supported.length &&
    existingSupported.every((effort, index) => effort === supported[index]);
  if (supportedUnchanged && existingDefault === defaultEffort) {
    return model;
  }

  return {
    ...model,
    supportedReasoningEfforts:
      supported.length > 0
        ? supported.map((reasoningEffort) => ({ reasoningEffort }))
        : (model.supportedReasoningEfforts ?? undefined),
    defaultReasoningEffort: defaultEffort,
  };
}

/**
 * 给 Atomic ModelInfo 补齐非 Codex 引擎（当前仅 PI）的 reasoning 元数据。
 *
 * 与 `enrichModelInfoWithAtomicReasoning` 的差异：PI 的 capability 由 catalog
 * 投影（`supported_thinking_levels_for_pi_model`）直接提供，
 * `providerModelCatalogs["pi"]` 已经把每个 PI 模型的 `supportedReasoningEfforts`
 * 与 `defaultReasoningEffort` 填到 ModelOption 上，与 native composer 同源；本函数
 * 不再额外做 catalog lookup 或 custom source 推导。其它 engine 直返 `model`
 * （不发明 capability 元数据；capability-neutral 语义对齐 Codex unknown 路径）。
 *
 * 注：`useProviderTargetCatalogOwners.ts` / `ModelSelect.tsx` 走的是 codex 专用
 * helper（`enrichModelInfoWithAtomicReasoning`），不受本函数影响，避免污染
 * native 路径。
 */
export function enrichModelReasoningForEngine<
  T extends AtomicReasoningModelRef,
>(engine: string | null | undefined, model: T): T & AtomicReasoningModelRef {
  if (engine !== "pi") {
    return model;
  }
  // PI capability 已在 catalog 投影阶段填到 ModelOption；缺字段时保持原值，
  // 不发明（与 Codex unknown 模型 capability-neutral 语义对齐）。
  return model;
}

/**
 * 把已有 Atomic target 上的 effort 收敛到目标模型 allowlist。
 * - Claude/Grok：非法值 → null（Default）；null 保持
 * - Codex / PI：null/非法 + 有能力元数据 → 模型 default；unknown 保持原值
 *   （PI 的 capability 由 `providerModelCatalogs["pi"]` 投影提供，与 native
 *   `modelSelection.ts: getReasoningOptionsForModel` 同源；align native 行为）
 */
export function reconcileAtomicReasoningEffort(input: {
  engine: string | null | undefined;
  model: AtomicReasoningModelRef | null | undefined;
  effort?: string | null;
}): string | null {
  const engine = input.engine ?? null;
  const current = normalizeEffort(input.effort);
  const options = resolveAtomicReasoningOptions(engine, input.model);

  if (engine === "claude" || engine === "grok") {
    if (current && options.includes(current)) {
      return current;
    }
    return null;
  }

  if (engine !== "codex" && engine !== "pi") {
    // 通用引擎（dsh/qoder/kimi/opencode…）：options 来自 catalog 投影。
    // 有 options 时非法值收敛为 null（host 侧默认语义）；无 options 维持
    // capability-neutral（不发明档位也不清值）。
    if (options.length === 0) {
      return current;
    }
    return current && options.includes(current) ? current : null;
  }

  if (options.length === 0) {
    // capability-neutral：不发明档位，也不清掉用户已有值
    return current;
  }

  if (current && options.includes(current)) {
    return current;
  }

  return resolveAtomicDefaultReasoningEffort(engine, input.model);
}

/**
 * 解析引擎+模型可用的 reasoning options（用于 ReasoningSelect options）。
 */
export function resolveAtomicReasoningOptions(
  engine: string | null | undefined,
  model: AtomicReasoningModelRef | null | undefined,
): string[] {
  if (engine === "claude") {
    return [...CLAUDE_REASONING_OPTIONS];
  }
  if (engine === "grok") {
    return [...GROK_REASONING_OPTIONS];
  }
  // 通用 catalog 驱动分支（P0 后统一，覆盖 pi/dsh/qoder/kimi/opencode 等）：
  // 任何引擎的 target 只要 catalog 条目带 supportedReasoningEfforts（PI RPC /
  // DSH host / 未来的 Qoder ACP 等），一律投影为 options——首页创建框与
  // 会话内 ButtonArea 共用同一数据源，不再按引擎白名单特判。
  // 不发明档位：catalog 缺 metadata 时返 capability-neutral（空数组）。
  if (engine !== "codex") {
    const fromModel = normalizeSupportedEfforts(
      model?.supportedReasoningEfforts,
    );
    if (fromModel.length > 0) {
      return fromModel;
    }
    const modelDefault = normalizeEffort(model?.defaultReasoningEffort);
    return modelDefault ? [modelDefault] : [];
  }

  const enriched = enrichModelInfoWithAtomicReasoning("codex", model ?? {});
  const fromModel = normalizeSupportedEfforts(
    enriched.supportedReasoningEfforts,
  );
  if (fromModel.length > 0) {
    return fromModel;
  }
  if (enriched.source === "custom") {
    return [...CUSTOM_MODEL_REASONING_EFFORTS];
  }
  const catalogDefault = normalizeEffort(enriched.defaultReasoningEffort);
  return catalogDefault ? [catalogDefault] : [];
}

/**
 * 解析模型默认 effort（不含 inherit）。
 */
export function resolveAtomicDefaultReasoningEffort(
  engine: string | null | undefined,
  model: AtomicReasoningModelRef | null | undefined,
): string | null {
  if (engine === "claude" || engine === "grok") {
    return null;
  }
  if (engine === "pi") {
    // PI：按 model 的 defaultReasoningEffort → 否则 options[0]；catalog 缺
    // metadata 时维持 null（与 Codex unknown-neutral 语义对齐）。
    const enriched = enrichModelReasoningForEngine("pi", model ?? {});
    const options = resolveAtomicReasoningOptions("pi", enriched);
    const modelDefault = normalizeEffort(enriched.defaultReasoningEffort);
    if (
      modelDefault &&
      (options.length === 0 || options.includes(modelDefault))
    ) {
      return modelDefault;
    }
    return options[0] ?? null;
  }
  if (engine !== "codex") {
    return null;
  }
  const enriched = enrichModelInfoWithAtomicReasoning("codex", model ?? {});
  const options = resolveAtomicReasoningOptions("codex", enriched);
  const modelDefault = normalizeEffort(enriched.defaultReasoningEffort);
  if (
    modelDefault &&
    (options.length === 0 || options.includes(modelDefault))
  ) {
    return modelDefault;
  }
  if (enriched.source === "custom") {
    return CUSTOM_MODEL_DEFAULT_REASONING_EFFORT;
  }
  return options[0] ?? null;
}

/**
 * 选模型 / 切渠道时解析写入 ExecutionTarget.reasoning 的 effort。
 *
 * - inherit=true（同 engine+profile）：旧 effort 仍在 allowlist 则保留
 * - 否则：落到模型 default（Codex / PI）或 null（Claude/Grok 的 Default）
 */
export function resolveAtomicReasoningEffort(input: {
  engine: string | null | undefined;
  model: AtomicReasoningModelRef | null | undefined;
  previousEffort?: string | null;
  inherit?: boolean;
}): string | null {
  const engine = input.engine ?? null;
  const options = resolveAtomicReasoningOptions(engine, input.model);
  const previous = normalizeEffort(input.previousEffort);

  if (input.inherit && previous) {
    // 有 allowlist 时必须命中；无 allowlist（unknown）才原样保留。
    if (options.length === 0 || options.includes(previous)) {
      return previous;
    }
  }

  if (engine === "claude" || engine === "grok") {
    return null;
  }

  if (engine !== "codex" && engine !== "pi") {
    // 通用引擎：options 可用时合法 previous 允许继承（与 codex/pi 对齐）；
    // 无 options 维持 null（capability-neutral）。
    if (options.length === 0) {
      return null;
    }
    return previous;
  }

  return resolveAtomicDefaultReasoningEffort(engine, input.model);
}
