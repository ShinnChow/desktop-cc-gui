import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DebugEntry, ModelOption, WorkspaceInfo } from "../../../types";
import { getConfigModel, getModelList } from "../../../services/tauri";
import {
  CODEX_MODEL_CATALOG,
  CODEX_MODEL_FALLBACK_ENTRIES,
} from "../codexModelCatalog";
import {
  createModelCatalogCache,
  mergeModelCatalogSources,
  type ModelCatalogEntry,
} from "../modelProviderCatalog";
import {
  STORAGE_KEYS as PROVIDER_STORAGE_KEYS,
  validateCodexCustomModels,
} from "../../composer/types/provider";
import { startupOrchestrator } from "../../startup-orchestration/utils/startupOrchestrator";
import {
  CUSTOM_MODEL_DEFAULT_REASONING_EFFORT,
  CUSTOM_MODEL_SUPPORTED_REASONING_OPTIONS,
} from "../customModelReasoning";
import { buildSelectionApplyEpochKey } from "./modelSelectionApplyCircuit";

type UseModelsOptions = {
  activeWorkspace: WorkspaceInfo | null;
  /**
   * D4-Live：切线程时清用户模型/档位锁（保留 selection state 作显示回退）。
   * 防止上一线程（如 claude）的 freeform 保留把模型 id 压进另一引擎线程的
   * 选择收敛与触发器显示（nativeSessionTarget 的 propModelId 路径）。
   */
  activeThreadId?: string | null;
  onDebug?: (entry: DebugEntry) => void;
  preferredModelId?: string | null;
  preferredEffort?: string | null;
  preferredSelectionReady?: boolean;
};

type UseModelsResult = {
  models: ModelOption[];
  modelsReady: boolean;
  selectedModel: ModelOption | null;
  reasoningSupported: boolean;
  selectedModelId: string | null;
  setSelectedModelId: (next: string | null) => void;
  reasoningOptions: string[];
  selectedEffort: string | null;
  setSelectedEffort: (next: string | null) => void;
  refreshModels: () => Promise<void>;
  globalSelectionReady: boolean;
};

type ModelRefreshPhase = "active-workspace" | "idle-prewarm" | "on-demand";

const CONFIG_MODEL_DESCRIPTION = "Configured in CODEX_HOME/config.toml";

const createModelOption = (
  id: string,
  displayName: string,
  description = "",
  source = "unknown",
  supportedReasoningEfforts: ModelOption["supportedReasoningEfforts"] = [],
  defaultReasoningEffort: string | null = null,
): ModelOption => ({
  id,
  model: id,
  displayName,
  description,
  source,
  supportedReasoningEfforts,
  defaultReasoningEffort,
  isDefault: false,
});

const normalizeModelIdentity = (model: ModelOption): string => {
  const modelId = model.model.trim().toLowerCase();
  if (modelId.length > 0) {
    return modelId;
  }
  return model.id.trim().toLowerCase();
};

const mergeReasoningMetadata = (
  existingModel: ModelOption,
  overridingModel: ModelOption,
) => ({
  supportedReasoningEfforts:
    overridingModel.supportedReasoningEfforts.length > 0
      ? overridingModel.supportedReasoningEfforts
      : existingModel.supportedReasoningEfforts,
  defaultReasoningEffort:
    overridingModel.defaultReasoningEffort ?? existingModel.defaultReasoningEffort,
});

const mergeModelOption = (existing: ModelOption, next: ModelOption): ModelOption => ({
  ...existing,
  id: next.id || existing.id,
  model: next.model || existing.model,
  displayName: next.displayName || existing.displayName,
  description: next.description || existing.description,
  source: next.source || existing.source,
  provider: next.provider ?? existing.provider,
  protocol: next.protocol ?? existing.protocol,
  provenance: next.provenance ?? existing.provenance,
  observedAt: next.observedAt ?? existing.observedAt,
  lastVerifiedAt: next.lastVerifiedAt ?? existing.lastVerifiedAt,
  lifecycle: next.lifecycle ?? existing.lifecycle,
  ...mergeReasoningMetadata(existing, next),
});

const upsertModelOption = (
  mergedModels: ModelOption[],
  seenIdentities: Map<string, number>,
  model: ModelOption,
  replaceExisting = false,
) => {
  const identity = normalizeModelIdentity(model);
  if (identity.length === 0) {
    return;
  }
  const existingIndex = seenIdentities.get(identity);
  if (existingIndex === undefined) {
    seenIdentities.set(identity, mergedModels.length);
    mergedModels.push(model);
    return;
  }
  if (replaceExisting) {
    mergedModels[existingIndex] = mergeModelOption(mergedModels[existingIndex], model);
  }
};

const readCustomCodexModelOptions = (): ModelOption[] => {
  if (typeof window === "undefined" || !window.localStorage) {
    return [];
  }
  try {
    const stored = window.localStorage.getItem(PROVIDER_STORAGE_KEYS.CODEX_CUSTOM_MODELS);
    if (!stored) {
      return [];
    }
    return validateCodexCustomModels(JSON.parse(stored)).map((model) =>
      // 用户管理自定义模型：无 runtime capability 来源，统一暴露主流默认档
      // （enrichScopedCodexReasoningMetadata 的 authoritative 匹配仍优先覆盖）。
      createModelOption(
        model.id,
        model.label,
        model.description ?? "",
        "custom",
        CUSTOM_MODEL_SUPPORTED_REASONING_OPTIONS,
        CUSTOM_MODEL_DEFAULT_REASONING_EFFORT,
      ),
    );
  } catch {
    return [];
  }
};

const getBuiltInCodexModelOptions = (): ModelOption[] =>
  CODEX_MODEL_CATALOG.map((model) => ({
    ...createModelOption(
      model.id,
      model.label,
      model.description,
      "catalog",
      model.supportedReasoningEfforts ?? [],
      normalizeEffort(model.defaultReasoningEffort),
    ),
    provider: model.provider,
    protocol: model.protocol,
    provenance: model.provenance,
    lastVerifiedAt: model.lastVerifiedAt,
    lifecycle: model.lifecycle,
  }));

const mergeCodexSelectableModels = (baseModels: ModelOption[]): ModelOption[] => {
  const mergedModels: ModelOption[] = [];
  const seenIdentities = new Map<string, number>();
  const builtInModels = getBuiltInCodexModelOptions();
  const customModels = readCustomCodexModelOptions();

  builtInModels.forEach((model) =>
    upsertModelOption(mergedModels, seenIdentities, model),
  );
  customModels.forEach((model) =>
    upsertModelOption(mergedModels, seenIdentities, model, true),
  );
  baseModels.forEach((model) =>
    upsertModelOption(mergedModels, seenIdentities, model, true),
  );

  const mergedByIdentity = new Map(
    mergedModels.map((model) => [normalizeModelIdentity(model), model]),
  );
  const toCatalogEntries = (
    entries: readonly ModelOption[],
    source: ModelCatalogEntry["source"],
  ): ModelCatalogEntry[] =>
    entries.map((model) => ({
      engine: "codex",
      provider: "openai",
      protocol: "openai-responses",
      id: normalizeModelIdentity(model),
      label: model.displayName,
      description: model.description,
      source,
      provenance: `codex:${model.source || source}`,
      supportedReasoningEfforts: model.supportedReasoningEfforts,
      defaultReasoningEffort: model.defaultReasoningEffort,
    }));
  const catalog = mergeModelCatalogSources([
    toCatalogEntries(baseModels, "runtime"),
    toCatalogEntries(customModels, "configured"),
    CODEX_MODEL_FALLBACK_ENTRIES,
  ]);
  return catalog.flatMap((entry) => {
    const mergedModel = mergedByIdentity.get(entry.id);
    return mergedModel ? [mergedModel] : [];
  });
};

const normalizeEffort = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** catalog 结构指纹：仅业务字段，切断无意义 array 换引用触发的 layout 环。 */
function modelOptionsFingerprint(models: readonly ModelOption[]): string {
  if (models.length === 0) {
    return "";
  }
  return models
    .map((model) => {
      const efforts = model.supportedReasoningEfforts
        .map((entry) => entry.reasoningEffort)
        .join(",");
      return [
        model.id,
        model.model,
        model.source ?? "",
        model.defaultReasoningEffort ?? "",
        model.isDefault ? "1" : "0",
        efforts,
      ].join("\u001f");
    })
    .join("\u001e");
}

const normalizeReasoningEfforts = (
  value: unknown,
): ModelOption["supportedReasoningEfforts"] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((effort) => {
    if (typeof effort === "string") {
      const reasoningEffort = normalizeEffort(effort);
      return reasoningEffort ? [{ reasoningEffort, description: "" }] : [];
    }
    if (!effort || typeof effort !== "object") {
      return [];
    }
    const record = effort as Record<string, unknown>;
    const reasoningEffort = normalizeEffort(
      record.reasoningEffort ?? record.reasoning_effort,
    );
    if (!reasoningEffort) {
      return [];
    }
    return [
      {
        reasoningEffort,
        description: String(record.description ?? ""),
      },
    ];
  });
};

const findModelByIdOrModel = (
  models: ModelOption[],
  idOrModel: string | null,
): ModelOption | null => {
  if (!idOrModel) {
    return null;
  }
  return (
    models.find((model) => model.id === idOrModel) ??
    models.find((model) => model.model === idOrModel) ??
    null
  );
};

const pickDefaultModel = (models: ModelOption[], configModel: string | null) =>
  findModelByIdOrModel(models, configModel) ??
  models.find((model) => model.isDefault) ??
  models[0] ??
  null;

/**
 * 纯函数：统一 model effort 解析语义（唯一事实源）。
 * 优先级：用户当前选择 → preferred → model default。
 * supported 为空时仍允许 preferred / default，避免与 UI backfill 语义分裂。
 */
export const resolveModelEffort = (
  model: ModelOption,
  options: {
    preferCurrent: boolean;
    currentEffort: string | null;
    preferredEffort: string | null;
  },
): string | null => {
  const supportedEfforts = model.supportedReasoningEfforts.map(
    (effort) => effort.reasoningEffort,
  );
  const currentEffort = normalizeEffort(options.currentEffort);
  if (options.preferCurrent && currentEffort) {
    return currentEffort;
  }
  const preferred = normalizeEffort(options.preferredEffort);
  const modelDefault = normalizeEffort(model.defaultReasoningEffort);
  if (supportedEfforts.length === 0) {
    return preferred ?? modelDefault;
  }
  if (preferred && supportedEfforts.includes(preferred)) {
    return preferred;
  }
  return modelDefault;
};

type ComposerSelectionPlan = {
  nextModelId: string | null;
  nextEffort: string | null;
  clearUserSelectedModel: boolean;
};

/**
 * 纯函数：从 catalog + preferred + 用户意图计算下一次应提交的 selection。
 * layout / refresh 共用，保证只有一套收敛规则。
 */
export const planComposerModelSelection = (input: {
  models: ModelOption[];
  configModel: string | null;
  preferredModelId: string | null;
  preferredEffort: string | null;
  preferredSelectionReady: boolean;
  selectedModelId: string | null;
  selectedEffort: string | null;
  hasUserSelectedModel: boolean;
  hasUserSelectedEffort: boolean;
}): ComposerSelectionPlan | null => {
  const {
    models,
    configModel,
    preferredModelId,
    preferredEffort,
    preferredSelectionReady,
    selectedModelId,
    selectedEffort,
    hasUserSelectedModel,
    hasUserSelectedEffort,
  } = input;

  if (models.length === 0) {
    return null;
  }
  if (!preferredSelectionReady && !hasUserSelectedModel) {
    return null;
  }

  const existingSelection = findModelByIdOrModel(models, selectedModelId);
  let clearUserSelectedModel = false;
  let keepUserModel = hasUserSelectedModel;
  // catalog 外 freeform：用户显式点过则保留，禁止 layout 反复清回 default（#185 / freeform 业务不变量）。
  // 非用户锁且不在 catalog → 才允许回退 preferred/default。
  let freeformSelection: ModelOption | null = null;
  if (selectedModelId && !existingSelection) {
    if (hasUserSelectedModel) {
      keepUserModel = true;
      freeformSelection = {
        id: selectedModelId,
        model: selectedModelId,
        displayName: selectedModelId,
        description: "",
        source: "custom",
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null,
        isDefault: false,
      };
    } else {
      clearUserSelectedModel = true;
      keepUserModel = false;
    }
  }

  const preferredSelection = findModelByIdOrModel(models, preferredModelId);
  const defaultModel = pickDefaultModel(models, configModel);
  const nextModel =
    (keepUserModel && existingSelection ? existingSelection : null) ??
    (keepUserModel && freeformSelection ? freeformSelection : null) ??
    preferredSelection ??
    defaultModel ??
    existingSelection ??
    null;
  if (!nextModel) {
    return null;
  }

  // effort 锁定策略（兼容旧行为，避免业务漂移）：
  // 1) 用户显式选过 effort → 始终 preferCurrent
  // 2) 用户锁住 model 且已有非空 effort → 不随 preferred 漂移（旧 layout early-return）
  // 3) effort 仍为空 → 走 preferred/default 单源解析（替代旧 backfill effect）
  const currentEffort = normalizeEffort(selectedEffort);
  const preferCurrentEffort =
    hasUserSelectedEffort || (keepUserModel && currentEffort !== null);

  const nextModelId = nextModel.id;
  const nextEffort = resolveModelEffort(nextModel, {
    preferCurrent: preferCurrentEffort,
    currentEffort: selectedEffort,
    preferredEffort,
  });
  const nextEffortNormalized = normalizeEffort(nextEffort);

  // 已收敛则返回 null：layout / refresh 不再发起任何 commit，
  // 避免「语义等价 plan 反复 apply」在父树重渲染下叠满 update depth。
  // 用 id/model 双通道匹配 selected，避免 "id vs model 字段" 语义相等却反复 commit。
  // clearUserSelectedModel 只清用户锁 ref，不单独触发 setState；state 已对齐时直接 null。
  const selectedMatchesNext =
    selectedModelId === nextModelId ||
    existingSelection?.id === nextModelId ||
    existingSelection?.model === nextModel.model ||
    (freeformSelection !== null && selectedModelId === nextModelId);
  if (selectedMatchesNext && nextEffortNormalized === currentEffort) {
    return null;
  }

  return {
    nextModelId,
    nextEffort: nextEffortNormalized,
    clearUserSelectedModel,
  };
};

/** preferred 入参归一：null/"" / 空白 → null，切断 layout deps 虚抖。 */
const normalizePreferredIdentity = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/** 单次 catalog/preferred epoch 内最多 apply 次数；超限熔断防 #185 白屏。 */
const SELECTION_APPLY_CIRCUIT_LIMIT = 12;
/**
 * 跨 epoch 的滑动窗口熔断：preferred/persist 虚抖会重置 epoch 计数，
 * 单独 epoch 限额挡不住「双值对打」叠满 nested update depth。
 */
const SELECTION_APPLY_STORM_WINDOW_MS = 1_000;
const SELECTION_APPLY_STORM_LIMIT = 24;

type ComposerSelectionState = {
  modelId: string | null;
  effort: string | null;
};

export function useModels({
  activeWorkspace,
  activeThreadId,
  onDebug,
  preferredModelId = null,
  preferredEffort = null,
  preferredSelectionReady = true,
}: UseModelsOptions): UseModelsResult {
  // 边界归一 preferred，避免 ""/空白与 null 在 layout deps 上抖动
  const stablePreferredModelId = normalizePreferredIdentity(preferredModelId);
  const stablePreferredEffort = normalizeEffort(preferredEffort);
  const stablePreferredSelectionReady = Boolean(preferredSelectionReady);

  const [rawModels, setRawModels] = useState<ModelOption[]>([]);
  const [configModel, setConfigModel] = useState<string | null>(null);
  // 原子 selection：model+effort 一次 setState，避免双 commit 嵌套更新叠 depth
  const [selection, setSelection] = useState<ComposerSelectionState>({
    modelId: null,
    effort: null,
  });
  const selectedModelId = selection.modelId;
  const selectedEffort = selection.effort;
  const [modelMappingVersion, setModelMappingVersion] = useState(0);
  const lastCatalogAttemptWorkspaceId = useRef<string | null>(null);
  const inFlightWorkspaceId = useRef<string | null>(null);
  const latestRefreshRequestId = useRef(0);
  const hasUserSelectedModel = useRef(false);
  const hasUserSelectedEffort = useRef(false);
  const lastWorkspaceId = useRef<string | null>(null);
  // D4-Live：切线程清用户锁（不动 selection state；线程内选择语义不变）。
  // epoch 自增驱动同步收敛 layout effect 重评估（ref 变化不触发渲染）。
  const [userLockEpoch, setUserLockEpoch] = useState(0);
  const lastThreadIdForUserLockRef = useRef<string | null>(
    activeThreadId ?? null,
  );
  useEffect(() => {
    const nextThreadId = activeThreadId ?? null;
    if (lastThreadIdForUserLockRef.current === nextThreadId) {
      return;
    }
    lastThreadIdForUserLockRef.current = nextThreadId;
    hasUserSelectedModel.current = false;
    hasUserSelectedEffort.current = false;
    setUserLockEpoch((epoch) => epoch + 1);
  }, [activeThreadId]);
  const catalogOwnerLeaseRef = useRef<{ superseded: boolean } | null>(null);
  /** catalog/preferred epoch 熔断：同 epoch 超限 apply 直接停，防冷启 #185 白屏 */
  const selectionApplyEpochRef = useRef<string | null>(null);
  const selectionApplyCountRef = useRef(0);
  /** 跨 epoch 滑动窗口：preferred 对打时 epoch 会重置，本计数仍累积 */
  const selectionApplyStormWindowStartRef = useRef(0);
  const selectionApplyStormCountRef = useRef(0);
  const stableModelsRef = useRef<ModelOption[]>([]);
  const [catalogReadyForWorkspace, setCatalogReadyForWorkspace] = useState(false);
  const catalogCacheByWorkspace = useRef(
    new Map<string, ReturnType<typeof createModelCatalogCache>>(),
  );
  // 供 async refresh 读取最新 selection，避免把 state 塞进 refresh deps 形成反馈环
  const selectionSnapshotRef = useRef({
    selectedModelId: null as string | null,
    selectedEffort: null as string | null,
    preferredModelId: stablePreferredModelId,
    preferredEffort: stablePreferredEffort,
    preferredSelectionReady: stablePreferredSelectionReady,
  });
  selectionSnapshotRef.current = {
    selectedModelId,
    selectedEffort,
    preferredModelId: stablePreferredModelId,
    preferredEffort: stablePreferredEffort,
    preferredSelectionReady: stablePreferredSelectionReady,
  };

  const workspaceId = activeWorkspace?.id ?? null;
  const isConnected = Boolean(activeWorkspace?.connected);
  const activeWorkspaceIdRef = useRef<string | null>(workspaceId);
  activeWorkspaceIdRef.current = workspaceId;
  // onDebug 常为父组件非稳定回调；经 ref 读取，禁止拖进 apply/layout deps 形成 #185
  const onDebugRef = useRef(onDebug);
  onDebugRef.current = onDebug;
  // Codex catalog only — never apply Claude ANTHROPIC_* mapping here.
  // modelCatalogVersion bumps when custom Codex models change in localStorage.
  // 结构指纹稳定时复用上一帧 array 引用，避免 layout deps 因 merge 新数组误触发。
  const models = useMemo(() => {
    void modelMappingVersion;
    const next = mergeCodexSelectableModels(rawModels);
    const prev = stableModelsRef.current;
    if (modelOptionsFingerprint(prev) === modelOptionsFingerprint(next)) {
      return prev;
    }
    stableModelsRef.current = next;
    return next;
  }, [rawModels, modelMappingVersion]);

  // 原子幂等写入：语义相等保持同一 state 引用
  const commitSelection = useCallback(
    (nextModelId: string | null, nextEffort: string | null) => {
      const normalizedEffort = normalizeEffort(nextEffort);
      setSelection((prev) => {
        if (
          prev.modelId === nextModelId &&
          normalizeEffort(prev.effort) === normalizedEffort
        ) {
          return prev;
        }
        return { modelId: nextModelId, effort: normalizedEffort };
      });
    },
    [],
  );

  const commitSelectedModelId = useCallback((next: string | null) => {
    setSelection((prev) => (prev.modelId === next ? prev : { ...prev, modelId: next }));
  }, []);

  const commitSelectedEffort = useCallback((next: string | null) => {
    const normalized = normalizeEffort(next);
    setSelection((prev) =>
      normalizeEffort(prev.effort) === normalized
        ? prev
        : { ...prev, effort: normalized },
    );
  }, []);

  const applySelectionPlan = useCallback(
    (plan: ComposerSelectionPlan) => {
      const nextEffort = normalizeEffort(plan.nextEffort);
      const nextModelId = plan.nextModelId;
      const snapshot = selectionSnapshotRef.current;
      const stateAlreadyMatched =
        snapshot.selectedModelId === nextModelId &&
        normalizeEffort(snapshot.selectedEffort) === nextEffort;

      if (plan.clearUserSelectedModel) {
        hasUserSelectedModel.current = false;
      }

      // state 已对齐：只清锁，禁止再 setState（冷启 #185）
      if (stateAlreadyMatched) {
        return;
      }

      const epochKey = buildSelectionApplyEpochKey({
        preferredModelId: snapshot.preferredModelId,
        preferredEffort: snapshot.preferredEffort,
        preferredSelectionReady: snapshot.preferredSelectionReady,
        nextModelId,
        nextEffort,
      });
      if (selectionApplyEpochRef.current !== epochKey) {
        selectionApplyEpochRef.current = epochKey;
        selectionApplyCountRef.current = 0;
      }
      selectionApplyCountRef.current += 1;

      const nowMs = Date.now();
      if (
        nowMs - selectionApplyStormWindowStartRef.current >
        SELECTION_APPLY_STORM_WINDOW_MS
      ) {
        selectionApplyStormWindowStartRef.current = nowMs;
        selectionApplyStormCountRef.current = 0;
      }
      selectionApplyStormCountRef.current += 1;

      if (
        selectionApplyCountRef.current > SELECTION_APPLY_CIRCUIT_LIMIT ||
        selectionApplyStormCountRef.current > SELECTION_APPLY_STORM_LIMIT
      ) {
        // 熔断：不再 setState，避免 Maximum update depth 白屏
        onDebugRef.current?.({
          id: `${Date.now()}-client-model-selection-circuit-breaker`,
          timestamp: Date.now(),
          source: "error",
          label: "model selection apply circuit breaker",
          payload: {
            epochKey,
            applyCount: selectionApplyCountRef.current,
            stormCount: selectionApplyStormCountRef.current,
            nextModelId,
            nextEffort,
          },
        });
        return;
      }

      // 同 tick 乐观更新 snapshot：refresh apply 与 layout apply 不会双写叠 depth
      selectionSnapshotRef.current = {
        ...selectionSnapshotRef.current,
        selectedModelId: nextModelId,
        selectedEffort: nextEffort,
      };
      commitSelection(nextModelId, nextEffort);
    },
    [commitSelection],
  );

  // Listen for localStorage changes (cross-tab sync + custom events)
  useEffect(() => {
    const isRelevantStorageKey = (key: string | null | undefined) =>
      key === PROVIDER_STORAGE_KEYS.CODEX_CUSTOM_MODELS;

    const handleStorageChange = (e: StorageEvent) => {
      if (isRelevantStorageKey(e.key)) {
        setModelMappingVersion((v) => v + 1);
      }
    };

    const handleCustomStorageChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ key: string }>;
      if (isRelevantStorageKey(customEvent.detail?.key)) {
        setModelMappingVersion((v) => v + 1);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("localStorageChange", handleCustomStorageChange);

    // Initial read of custom Codex models in case they were set before we started listening
    if (readCustomCodexModelOptions().length > 0) {
      setModelMappingVersion((v) => v + 1);
    }

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("localStorageChange", handleCustomStorageChange);
    };
  }, []);

  useLayoutEffect(() => {
    if (workspaceId === lastWorkspaceId.current) {
      return;
    }
    const previousWorkspaceId = lastWorkspaceId.current;
    if (previousWorkspaceId) {
      startupOrchestrator.cancelTask(
        `model-catalog:${previousWorkspaceId}`,
        "stale",
      );
    }
    hasUserSelectedModel.current = false;
    hasUserSelectedEffort.current = false;
    lastWorkspaceId.current = workspaceId;
    lastCatalogAttemptWorkspaceId.current = null;
    selectionApplyEpochRef.current = null;
    selectionApplyCountRef.current = 0;
    selectionApplyStormWindowStartRef.current = 0;
    selectionApplyStormCountRef.current = 0;
    stableModelsRef.current = [];
    setConfigModel(null);
    setRawModels([]);
    setSelection({ modelId: null, effort: null });
    selectionSnapshotRef.current = {
      ...selectionSnapshotRef.current,
      selectedModelId: null,
      selectedEffort: null,
    };
    setCatalogReadyForWorkspace(false);
  }, [workspaceId]);

  useEffect(() => {
    if (catalogOwnerLeaseRef.current) {
      catalogOwnerLeaseRef.current.superseded = true;
    }
    const ownerLease = { superseded: false };
    catalogOwnerLeaseRef.current = ownerLease;
    if (!workspaceId) {
      return;
    }
    return () => {
      // StrictMode immediately replays this effect. Defer the ownership check
      // to a microtask so only a real unmount releases the catalog slot.
      queueMicrotask(() => {
        if (ownerLease.superseded) {
          return;
        }
        startupOrchestrator.cancelTask(
          `model-catalog:${workspaceId}`,
          "stale",
        );
      });
    };
  }, [workspaceId]);

  const setSelectedModelId = useCallback(
    (next: string | null) => {
      hasUserSelectedModel.current = true;
      // 用户显式选择也走乐观 snapshot，避免紧随其后的 layout plan 回写
      selectionSnapshotRef.current = {
        ...selectionSnapshotRef.current,
        selectedModelId: next,
      };
      commitSelectedModelId(next);
    },
    [commitSelectedModelId],
  );

  const setSelectedEffort = useCallback(
    (next: string | null) => {
      hasUserSelectedEffort.current = true;
      const normalized = normalizeEffort(next);
      selectionSnapshotRef.current = {
        ...selectionSnapshotRef.current,
        selectedEffort: normalized,
      };
      commitSelectedEffort(normalized);
    },
    [commitSelectedEffort],
  );

  const selectedModel = useMemo(
    () => findModelByIdOrModel(models, selectedModelId),
    [models, selectedModelId],
  );

  const reasoningSupported = useMemo(() => {
    if (!selectedModel) {
      return false;
    }
    return (
      selectedModel.supportedReasoningEfforts.length > 0 ||
      selectedModel.defaultReasoningEffort !== null
    );
  }, [selectedModel]);

  const reasoningOptions = useMemo(() => {
    const supported = selectedModel?.supportedReasoningEfforts.map(
      (effort) => effort.reasoningEffort,
    );
    if (supported && supported.length > 0) {
      return supported;
    }
    const defaultEffort = normalizeEffort(selectedModel?.defaultReasoningEffort);
    return defaultEffort ? [defaultEffort] : [];
  }, [selectedModel]);

  const refreshModels = useCallback(async (phase: ModelRefreshPhase = "on-demand") => {
    if (!workspaceId || !isConnected) {
      return;
    }
    if (inFlightWorkspaceId.current === workspaceId) {
      return;
    }
    inFlightWorkspaceId.current = workspaceId;
    const refreshRequestId = latestRefreshRequestId.current + 1;
    latestRefreshRequestId.current = refreshRequestId;
    const requestedWorkspaceId = workspaceId;
    onDebugRef.current?.({
      id: `${Date.now()}-client-model-list`,
      timestamp: Date.now(),
      source: "client",
      label: "model/list",
      payload: { workspaceId },
    });
    try {
      type ModelCatalogResult = [
        PromiseSettledResult<Awaited<ReturnType<typeof getModelList>> | null>,
        PromiseSettledResult<Awaited<ReturnType<typeof getConfigModel>>>,
      ];
      const [modelListResult, configModelResult] =
        await startupOrchestrator.run<ModelCatalogResult>({
          id: `model-catalog:${workspaceId}`,
          phase,
          priority: phase === "on-demand" ? 85 : 35,
          dedupeKey: `model-catalog:${workspaceId}`,
          concurrencyKey: "model-catalog",
          timeoutMs: 8_000,
          workspaceScope: { workspaceId },
          cancelPolicy: "soft-ignore",
          traceLabel: "model/list",
          commandLabel: "model_list",
          run: () =>
            Promise.allSettled([
              getModelList(workspaceId),
              getConfigModel(workspaceId),
            ]),
          fallback: () =>
            [
              { status: "fulfilled", value: null },
              { status: "fulfilled", value: null },
            ] satisfies ModelCatalogResult,
        });
      const configModelFromConfig =
        configModelResult.status === "fulfilled"
          ? configModelResult.value
          : null;
      if (configModelResult.status === "rejected") {
        onDebugRef.current?.({
          id: `${Date.now()}-client-config-model-error`,
          timestamp: Date.now(),
          source: "error",
          label: "config/model error",
          payload:
            configModelResult.reason instanceof Error
              ? configModelResult.reason.message
              : String(configModelResult.reason),
        });
      }
      const response =
        modelListResult.status === "fulfilled" ? modelListResult.value : null;
      if (modelListResult.status === "rejected") {
        onDebugRef.current?.({
          id: `${Date.now()}-client-model-list-error`,
          timestamp: Date.now(),
          source: "error",
          label: "model/list error",
          payload:
            modelListResult.reason instanceof Error
              ? modelListResult.reason.message
              : String(modelListResult.reason),
        });
      }
      onDebugRef.current?.({
        id: `${Date.now()}-server-model-list`,
        timestamp: Date.now(),
        source: "server",
        label: "model/list response",
        payload: response,
      });
      const isStaleResponse =
        latestRefreshRequestId.current !== refreshRequestId ||
        activeWorkspaceIdRef.current !== requestedWorkspaceId;
      if (isStaleResponse) {
        return;
      }
      setConfigModel((prev) =>
        prev === configModelFromConfig ? prev : configModelFromConfig,
      );
      const rawData = response?.result?.data ?? response?.data ?? [];
      const dataFromServer: ModelOption[] = rawData.map((item: any) => ({
        id: String(item.id ?? item.model ?? ""),
        model: String(item.model ?? item.id ?? ""),
        displayName: String(item.displayName ?? item.display_name ?? item.model ?? ""),
        description: String(item.description ?? ""),
        source: String(item.source ?? "unknown"),
        provider:
          typeof item.provider === "string" ? item.provider : null,
        protocol:
          typeof item.protocol === "string" ? item.protocol : null,
        provenance:
          typeof item.provenance === "string" ? item.provenance : null,
        observedAt:
          typeof item.observedAt === "number"
            ? item.observedAt
            : typeof item.observed_at === "number"
              ? item.observed_at
              : null,
        lastVerifiedAt:
          typeof item.lastVerifiedAt === "string"
            ? item.lastVerifiedAt
            : typeof item.last_verified_at === "string"
              ? item.last_verified_at
              : null,
        lifecycle:
          typeof item.lifecycle === "string" ? item.lifecycle : null,
        supportedReasoningEfforts: normalizeReasoningEfforts(
          item.supportedReasoningEfforts ?? item.supported_reasoning_efforts,
        ),
        defaultReasoningEffort: normalizeEffort(
          item.defaultReasoningEffort ?? item.default_reasoning_effort,
        ),
        isDefault: Boolean(item.isDefault ?? item.is_default ?? false),
      }));
      let effectiveDataFromServer = dataFromServer;
      let catalogCache = catalogCacheByWorkspace.current.get(requestedWorkspaceId);
      if (!catalogCache) {
        catalogCache = createModelCatalogCache();
        catalogCacheByWorkspace.current.set(requestedWorkspaceId, catalogCache);
      }
      if (dataFromServer.length > 0) {
        catalogCache.commit(
          dataFromServer.map((model) => ({
            engine: "codex",
            provider: "openai",
            protocol: "openai-responses",
            id: normalizeModelIdentity(model),
            label: model.displayName,
            description: model.description,
            source: "runtime",
            provenance: `codex:${model.source}`,
            observedAt: Date.now(),
            supportedReasoningEfforts: model.supportedReasoningEfforts,
            defaultReasoningEffort: model.defaultReasoningEffort,
          })),
        );
      } else if (modelListResult.status === "rejected" || response === null) {
        const staleCatalog = catalogCache.fail(
          modelListResult.status === "rejected"
            ? modelListResult.reason
            : new Error("model/list unavailable"),
        );
        effectiveDataFromServer = staleCatalog.entries.map((entry) => ({
          ...createModelOption(
            entry.id,
            entry.label,
            entry.description,
            "cache:stale",
            [...(entry.supportedReasoningEfforts ?? [])],
            entry.defaultReasoningEffort ?? null,
          ),
          provider: entry.provider,
          protocol: entry.protocol,
          provenance: entry.provenance,
          observedAt: entry.observedAt ?? null,
          lastVerifiedAt: entry.lastVerifiedAt ?? null,
          lifecycle: entry.lifecycle ?? null,
        }));
        onDebugRef.current?.({
          id: `${Date.now()}-client-model-catalog-stale`,
          timestamp: Date.now(),
          source: "error",
          label: "model catalog stale",
          payload: {
            workspaceId: requestedWorkspaceId,
            error: staleCatalog.error,
            entryCount: staleCatalog.entries.length,
            reasonCode:
              staleCatalog.entries.length > 0
                ? "using-stale-cache"
                : "empty-cache",
          },
        });
      }
      const data = (() => {
        if (!configModelFromConfig) {
          return effectiveDataFromServer;
        }
        const hasConfigModel = effectiveDataFromServer.some(
          (model) => model.model === configModelFromConfig,
        );
        if (hasConfigModel) {
          return effectiveDataFromServer;
        }
        const configOption: ModelOption = {
          id: configModelFromConfig,
          model: configModelFromConfig,
          displayName: `${configModelFromConfig} (config)`,
          description: CONFIG_MODEL_DESCRIPTION,
          source: "settings-override",
          supportedReasoningEfforts: [],
          defaultReasoningEffort: null,
          isDefault: false,
        };
        return [configOption, ...effectiveDataFromServer];
      })();
      const selectableData = mergeCodexSelectableModels(data);
      // catalog 语义未变则保留 rawModels 引用，避免 models useMemo → layout 无意义重入
      setRawModels((prev) =>
        modelOptionsFingerprint(prev) === modelOptionsFingerprint(data) ? prev : data,
      );
      lastCatalogAttemptWorkspaceId.current = requestedWorkspaceId;
      const nextCatalogReady =
        modelListResult.status === "fulfilled" && Array.isArray(rawData);
      setCatalogReadyForWorkspace((prev) =>
        prev === nextCatalogReady ? prev : nextCatalogReady,
      );
      const snapshot = selectionSnapshotRef.current;
      const plan = planComposerModelSelection({
        models: selectableData,
        configModel: configModelFromConfig,
        preferredModelId: snapshot.preferredModelId,
        preferredEffort: snapshot.preferredEffort,
        preferredSelectionReady: snapshot.preferredSelectionReady,
        selectedModelId: snapshot.selectedModelId,
        selectedEffort: snapshot.selectedEffort,
        hasUserSelectedModel: hasUserSelectedModel.current,
        hasUserSelectedEffort: hasUserSelectedEffort.current,
      });
      if (plan) {
        applySelectionPlan(plan);
      }
    } finally {
      if (inFlightWorkspaceId.current === requestedWorkspaceId) {
        inFlightWorkspaceId.current = null;
      }
    }
  }, [applySelectionPlan, isConnected, workspaceId]);

  useEffect(() => {
    if (!workspaceId || !isConnected) {
      return;
    }
    if (lastCatalogAttemptWorkspaceId.current === workspaceId) {
      return;
    }
    refreshModels("active-workspace");
  }, [isConnected, refreshModels, workspaceId]);

  // 唯一同步收敛入口：catalog / preferred 变化时规划并幂等提交。
  // 不再另设 effort backfill effect，避免双写对打（React #185）。
  // selection 经 snapshot ref 读取，不把 selected* 放进 deps——切断「commit → layout 再 commit」自反馈
  // （B1）；用户 setSelected* 已直接写入，无需 layout 回声。
  // preferred 使用归一后的 stable*，避免 ""/null 虚抖。
  useLayoutEffect(() => {
    const snapshot = selectionSnapshotRef.current;
    const plan = planComposerModelSelection({
      models,
      configModel,
      preferredModelId: stablePreferredModelId,
      preferredEffort: stablePreferredEffort,
      preferredSelectionReady: stablePreferredSelectionReady,
      selectedModelId: snapshot.selectedModelId,
      selectedEffort: snapshot.selectedEffort,
      hasUserSelectedModel: hasUserSelectedModel.current,
      hasUserSelectedEffort: hasUserSelectedEffort.current,
    });
    if (!plan) {
      return;
    }
    applySelectionPlan(plan);
  }, [
    applySelectionPlan,
    configModel,
    models,
    stablePreferredEffort,
    stablePreferredModelId,
    stablePreferredSelectionReady,
    userLockEpoch,
  ]);

  return {
    models,
    modelsReady: catalogReadyForWorkspace,
    selectedModel,
    reasoningSupported,
    selectedModelId,
    setSelectedModelId,
    reasoningOptions,
    selectedEffort,
    setSelectedEffort,
    refreshModels,
    globalSelectionReady: preferredSelectionReady && catalogReadyForWorkspace,
  };
}
