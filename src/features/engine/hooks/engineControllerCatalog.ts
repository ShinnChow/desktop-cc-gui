import type {
  EngineModelInfo,
  EngineStatus,
  EngineType,
  ModelOption,
} from "../../../types";
import {
  STORAGE_KEYS as PROVIDER_STORAGE_KEYS,
  validateCodexCustomModels,
} from "../../composer/types/provider";
import { readClaudeCustomModelsFromStorage } from "../../models/claudeCustomModels";
import { getGeneratedModelFallbacks } from "../../models/generatedModelFallbacks";

const UNKNOWN_MODEL_SOURCE = "unknown";
const CUSTOM_MODEL_SOURCE = "custom";
const GEMINI_FALLBACK_MODELS = getGeneratedModelFallbacks("gemini");
const GEMINI_DEFAULT_MODEL_ID =
  GEMINI_FALLBACK_MODELS.find((model) => model.default)?.id ??
  GEMINI_FALLBACK_MODELS[0]?.id ??
  "";

export function isEngineCatalogStorageKey(key: string | null | undefined) {
  return (
    key === PROVIDER_STORAGE_KEYS.GEMINI_CUSTOM_MODELS ||
    key === PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS
  );
}

export function normalizeEngineModelEntry(
  model: Partial<EngineModelInfo> & { id: string },
  fallbackSource = UNKNOWN_MODEL_SOURCE,
): EngineModelInfo {
  const normalizedId = model.id.trim();
  const runtimeModel = model.model?.trim() || normalizedId;
  return {
    id: normalizedId,
    model: runtimeModel,
    displayName:
      model.displayName && model.displayName.trim().length > 0
        ? model.displayName.trim()
        : normalizedId,
    description: model.description?.trim() ?? "",
    source: model.source?.trim() || fallbackSource,
    provider: model.provider?.trim() || null,
    protocol: model.protocol?.trim() || null,
    provenance: model.provenance?.trim() || null,
    observedAt: model.observedAt ?? null,
    lastVerifiedAt: model.lastVerifiedAt?.trim() || null,
    lifecycle: model.lifecycle?.trim() || null,
    providerProfileId: model.providerProfileId?.trim() || null,
    supportedReasoningEfforts: (model.supportedReasoningEfforts ?? []).map((id) =>
      id.trim().length > 0 ? id.trim() : null,
    ).filter((id): id is string => id !== null),
    defaultReasoningEffort: model.defaultReasoningEffort?.trim() || null,
    isDefault: Boolean(model.isDefault),
  };
}

export function areEngineModelCatalogsEqual(
  left: readonly EngineModelInfo[],
  right: readonly EngineModelInfo[],
): boolean {
  if (left === right) {
    return true;
  }
  if (left.length !== right.length) {
    return false;
  }
  return left.every((model, index) => {
    const candidate = right[index];
    return (
      candidate !== undefined &&
      model.id === candidate.id &&
      model.model === candidate.model &&
      model.displayName === candidate.displayName &&
      model.description === candidate.description &&
      model.source === candidate.source &&
      model.provider === candidate.provider &&
      model.protocol === candidate.protocol &&
      model.provenance === candidate.provenance &&
      model.observedAt === candidate.observedAt &&
      model.lastVerifiedAt === candidate.lastVerifiedAt &&
      model.lifecycle === candidate.lifecycle &&
      model.providerProfileId === candidate.providerProfileId &&
      model.isDefault === candidate.isDefault &&
      areStringListsEqual(
        model.supportedReasoningEfforts ?? [],
        candidate.supportedReasoningEfforts ?? [],
      ) &&
      (model.defaultReasoningEffort ?? null) === (candidate.defaultReasoningEffort ?? null)
    );
  });
}

function areStringListsEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function getEngineModelIdentity(
  model: Pick<EngineModelInfo, "id" | "model">,
): string {
  return model.model?.trim() || model.id.trim();
}

function appendGeminiFallbackModels(
  models: readonly EngineModelInfo[],
): EngineModelInfo[] {
  const merged: EngineModelInfo[] = [];
  const seenIds = new Set<string>();
  const pushModel = (model: Partial<EngineModelInfo> & { id: string }) => {
    const normalized = normalizeEngineModelEntry(model);
    if (!normalized.id || seenIds.has(normalized.id)) {
      return;
    }
    seenIds.add(normalized.id);
    merged.push(normalized);
  };

  models.forEach(pushModel);
  GEMINI_FALLBACK_MODELS.forEach((model) =>
    pushModel({
      id: model.id,
      displayName: model.label,
      description: model.description,
      source: "fallback",
      isDefault: Boolean(model.default),
    }),
  );
  return merged;
}

function mergeGeminiModels(
  engineModels: readonly EngineModelInfo[],
  customModels: readonly EngineModelInfo[],
): EngineModelInfo[] {
  const customIds = new Set(customModels.map((model) => model.id));
  const merged =
    customModels.length === 0
      ? [...engineModels]
      : [
          ...customModels,
          ...engineModels.filter((model) => !customIds.has(model.id)),
        ];
  const withFallback = appendGeminiFallbackModels(merged);
  if (!withFallback.some((model) => model.id === GEMINI_DEFAULT_MODEL_ID)) {
    return withFallback;
  }
  return withFallback.map((model) => ({
    ...model,
    isDefault: model.id === GEMINI_DEFAULT_MODEL_ID,
  }));
}

function readCustomGeminiModels(): EngineModelInfo[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(
      PROVIDER_STORAGE_KEYS.GEMINI_CUSTOM_MODELS,
    );
    if (!raw) {
      return [];
    }
    return validateCodexCustomModels(JSON.parse(raw)).map((model) => ({
      id: model.id,
      model: model.id,
      displayName: model.label?.trim() || model.id,
      description: model.description?.trim() ?? "",
      source: CUSTOM_MODEL_SOURCE,
      isDefault: false,
    }));
  } catch {
    return [];
  }
}

function readCustomClaudeModels(): EngineModelInfo[] {
  return readClaudeCustomModelsFromStorage(
    PROVIDER_STORAGE_KEYS.CLAUDE_CUSTOM_MODELS,
  ).map((model) => ({
    id: model.id,
    model: model.model,
    displayName: model.label,
    description: model.description ?? "",
    source: CUSTOM_MODEL_SOURCE,
    // Optional ownership only — never invent. Open-session / Native Claude
    // create still do not bind provider from Claude custom model picks
    // (useAppShellComposerModelSection keeps Claude resolvedProviderProfileId null).
    providerProfileId: model.providerProfileId?.trim() || null,
    isDefault: false,
  }));
}

function mergeClaudeModels(
  engineModels: readonly EngineModelInfo[],
  customModels: readonly EngineModelInfo[],
): EngineModelInfo[] {
  if (customModels.length === 0) {
    return [...engineModels];
  }
  const defaults = new Set(
    engineModels
      .filter((model) => model.isDefault)
      .map(getEngineModelIdentity),
  );
  const patchedCustomModels = customModels.map((model) => ({
    ...model,
    isDefault: defaults.has(getEngineModelIdentity(model)),
    source: model.source?.trim() || CUSTOM_MODEL_SOURCE,
  }));
  const customRuntimeModels = new Set(
    patchedCustomModels.map(getEngineModelIdentity),
  );
  return [
    ...patchedCustomModels,
    ...engineModels.filter(
      (model) => !customRuntimeModels.has(getEngineModelIdentity(model)),
    ),
  ];
}

function projectEngineModels(
  engineType: EngineType,
  models: readonly EngineModelInfo[],
): EngineModelInfo[] {
  const normalized = models.map((model) => normalizeEngineModelEntry(model));
  if (engineType === "gemini") {
    return mergeGeminiModels(normalized, readCustomGeminiModels());
  }
  if (engineType === "claude") {
    return mergeClaudeModels(normalized, readCustomClaudeModels());
  }
  return normalized;
}

export function engineModelToOption(model: EngineModelInfo): ModelOption {
  const normalized = normalizeEngineModelEntry(model);
  return {
    id: normalized.id,
    model: normalized.model ?? normalized.id,
    displayName: normalized.displayName,
    description: normalized.description,
    source: normalized.source ?? UNKNOWN_MODEL_SOURCE,
    provider: normalized.provider ?? null,
    protocol: normalized.protocol ?? null,
    provenance: normalized.provenance ?? null,
    observedAt: normalized.observedAt ?? null,
    lastVerifiedAt: normalized.lastVerifiedAt ?? null,
    lifecycle: normalized.lifecycle ?? null,
    providerProfileId: normalized.providerProfileId ?? null,
    supportedReasoningEfforts: (normalized.supportedReasoningEfforts ?? []).map(
      (reasoningEffort) => ({ reasoningEffort, description: "" }),
    ),
    defaultReasoningEffort: normalized.defaultReasoningEffort ?? null,
    isDefault: normalized.isDefault,
  };
}

export function projectActiveEngineModels(
  activeEngine: EngineType,
  engineModels: readonly EngineModelInfo[],
): EngineModelInfo[] {
  return projectEngineModels(activeEngine, engineModels);
}

/**
 * models 已从 detect 解耦的引擎（后端慢目录链：PI RPC 链 / Qoder ACP /
 * OpenCode models spawn，refactor-engine-detection-pipeline B1）。
 * 这些引擎的目录加载 MUST 用 on-demand 预算（22s，覆盖后端最坏探测链，
 * 对齐 provider-model-catalog-refresh spec「on-demand timeout MUST 覆盖
 * 后端探测链」），不能用 idle-prewarm 8s——否则冷启动必超时拿空目录，
 * Composer 思考档联动（providerModelCatalogs[engine]）随之缺数据。
 */
export const DETACHED_CATALOG_ENGINES: ReadonlySet<EngineType> = new Set([
  "pi",
  "qoder",
  "opencode",
]);

export type EngineCatalogLoadPhase = "idle-prewarm" | "on-demand";

/**
 * 目录加载 phase 决策（共通方法，detect 后加载 / workspace 切换 / 翻转重算
 * 统一走这里）：显式 phase 优先；force 一律 on-demand；解耦引擎默认
 * on-demand，其余 idle-prewarm。
 */
export function resolveEngineCatalogLoadPhase(
  engineType: EngineType,
  options: {
    forceRefresh?: boolean;
    phase?: EngineCatalogLoadPhase;
  } = {},
): EngineCatalogLoadPhase {
  if (options.phase) {
    return options.phase;
  }
  if (options.forceRefresh || DETACHED_CATALOG_ENGINES.has(engineType)) {
    return "on-demand";
  }
  return "idle-prewarm";
}

export function projectEngineModelCatalogs(
  engineStatuses: readonly EngineStatus[],
  activeEngine: EngineType,
  activeModels: readonly EngineModelInfo[],
  /** B-fix：解耦引擎（pi/qoder/opencode）的响应式 per-engine 目录表——
   *  非激活态 status.models 恒空，任何一次真实加载落地后写入此处，
   *  供 Composer 思考档联动 / 分组模型列表等非激活消费方取数。 */
  catalogsByEngine: Partial<Record<EngineType, readonly EngineModelInfo[]>> = {},
): Partial<Record<EngineType, ModelOption[]>> {
  const catalogs: Partial<Record<EngineType, ModelOption[]>> = {};
  for (const status of engineStatuses) {
    if (!status.installed) {
      continue;
    }
    const baseModels =
      status.engineType === activeEngine
        ? activeModels
        : (status.models.length > 0
            ? status.models
            : (catalogsByEngine[status.engineType] ?? []));
    catalogs[status.engineType] = projectEngineModels(
      status.engineType,
      baseModels,
    ).map(engineModelToOption);
  }
  return catalogs;
}
