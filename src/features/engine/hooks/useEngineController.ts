import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DebugEntry,
  CodexDoctorResult,
  EngineModelInfo,
  EngineStatus,
  EngineType,
  WorkspaceInfo,
} from "../../../types";
import {
  getActiveEngine,
  getEngineModels,
  isWebServiceRuntime,
  runCodexDoctor,
  switchEngine,
} from "../../../services/tauri";
import {
  subscribeEngineStatusEvents,
  type EngineStatusUpdatedEvent,
} from "../../../services/tauri/appServer";
import { requestEngineDetection } from "./engineDetectionCoordinator";

/**
 * switch_engine IPC 没有内建超时：后端 CLI spawn 卡住时，会把绑定它的
 * 创建流（loading 弹窗）永久挂死（Qoder CN 点击卡死事故）。Chrome 在等待前
 * 已乐观切换，这里只等有限时长；超时保乐观态返回，迟到的 switch 结果由
 * generation 守卫在后台合并，不回滚（避免和迟到成功互相打架）。
 */
const ENGINE_SWITCH_WAIT_TIMEOUT_MS = 15_000;
import { PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT } from "../../composer/components/ChatInputBox/hooks/useProviderTargetCatalogOwners";
import { PI_AUTH_CATALOG_CHANGED_EVENT } from "../../vendors/piAuthCatalogEvent";
import { startupOrchestrator } from "../../startup-orchestration/utils/startupOrchestrator";
import {
  buildAvailableEngines,
  ENABLED_ENGINE_TYPES,
  type EngineDisplayInfo,
} from "./engineControllerAvailability";
import {
  areEngineModelCatalogsEqual,
  engineModelToOption,
  normalizeEngineModelEntry,
  projectActiveEngineModels,
  projectEngineModelCatalogs,
} from "./engineControllerCatalog";
import {
  buildCodexSwitchUnavailablePayload,
  persistEngineSelection,
  readPersistedEngineSelection,
} from "./engineControllerSelection";
import {
  WEB_RUNTIME_DEFAULT_ENGINE,
  WEB_RUNTIME_INITIAL_STATUSES,
} from "./engineControllerWebRuntime";
import { resolveEngineCatalogLoadPhase } from "./engineControllerCatalog";
import { useEngineRuntimeNotices } from "./useEngineRuntimeNotices";
import { useEngineCatalogRevision } from "./useEngineCatalogRevision";

export type { EngineDisplayInfo } from "./engineControllerAvailability";

type UseEngineControllerOptions = {
  activeWorkspace: WorkspaceInfo | null;
  onDebug?: (entry: DebugEntry) => void;
};

type RefreshEngineModelsOptions = {
  forceRefresh?: boolean;
  phase?: "idle-prewarm" | "on-demand";
  providerProfileId?: string | null;
};

export type EngineRefreshResult = {
  availableEngines: EngineDisplayInfo[];
  activeEngine: EngineType;
};

/**
 * Hook for managing multi-engine state and selection
 */
export function useEngineController({
  activeWorkspace,
  onDebug,
}: UseEngineControllerOptions) {
  // Engine detection state
  const [engineStatuses, setEngineStatuses] = useState<EngineStatus[]>(() =>
    isWebServiceRuntime() ? WEB_RUNTIME_INITIAL_STATUSES : [],
  );
  // 首屏直接读 client store，避免默认 claude 抢先渲染后再异步 restore 造成首页闪回。
  const [activeEngine, setActiveEngineState] = useState<EngineType>(() =>
    isWebServiceRuntime()
      ? WEB_RUNTIME_DEFAULT_ENGINE
      : (readPersistedEngineSelection() ?? "claude"),
  );
  const [engineModels, setEngineModels] = useState<EngineModelInfo[]>([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  // B5：detect 失败/前端 25s 超时守卫触发后的失败态（「检测中」不得永久停留）。
  const [detectFailed, setDetectFailed] = useState(false);
  // P0 修复：解耦引擎的响应式 per-engine 目录表——任何一次真实加载落地即
  // 写入，非激活消费方（思考档联动/分组模型列表）不再读到恒空 catalog。
  const [engineCatalogsByEngine, setEngineCatalogsByEngine] = useState<
    Partial<Record<EngineType, EngineModelInfo[]>>
  >({});
  const customModelsVersion = useEngineCatalogRevision();

  // Track initialization
  const initRef = useRef(false);
  const detectPromiseRef = useRef<Promise<EngineRefreshResult | void> | null>(null);
  const visibleCatalogRequestKeyRef = useRef<string | null>(null);
  const lastGoodModelsByScopeRef = useRef(new Map<string, EngineModelInfo[]>());
  const engineSwitchGenerationRef = useRef(0);
  const engineChromeRef = useRef<{
    engine: EngineType;
    models: EngineModelInfo[];
  }>({ engine: activeEngine, models: engineModels });
  engineChromeRef.current = { engine: activeEngine, models: engineModels };
  const lastWorkspaceId = useRef<string | null>(null);
  const workspaceId = activeWorkspace?.id ?? null;
  const isConnected = Boolean(activeWorkspace?.connected);
  const enabledEngineTypes = ENABLED_ENGINE_TYPES;

  const loadModelsForEngine = useCallback(
    async (
      engineType: EngineType,
      fallbackModels: EngineModelInfo[] = [],
      options: RefreshEngineModelsOptions = {},
    ) => {
      if (!enabledEngineTypes.includes(engineType)) {
        return [];
      }
      const providerProfileId = options.providerProfileId?.trim() || null;
      const catalogScope = providerProfileId ?? "__global__";
      const catalogRequestKey = `${engineType}:${catalogScope}`;
      const previousCatalogRequestKey = visibleCatalogRequestKeyRef.current;
      visibleCatalogRequestKeyRef.current = catalogRequestKey;
      const scopedFallbackModels = providerProfileId
        ? (lastGoodModelsByScopeRef.current.get(catalogRequestKey) ?? [])
        : fallbackModels;
      if (previousCatalogRequestKey !== catalogRequestKey) {
        setEngineModels(scopedFallbackModels.map((model) => normalizeEngineModelEntry(model)));
      }
      try {
        const phase = resolveEngineCatalogLoadPhase(engineType, options);
        const models = await startupOrchestrator.run({
          id: `engine-models:${engineType}:${catalogScope}`,
          phase,
          priority: phase === "on-demand" ? 85 : 30,
          dedupeKey: `engine-models:${engineType}:${catalogScope}:${options.forceRefresh ? "force" : "cached"}`,
          concurrencyKey: "engine-model-catalog",
          // on-demand（打开菜单 / 显式刷新）必须覆盖后端最坏探测链（PI 并行化后
          // ~20s：max(version 10s, RPC 10s + list-models 10s 回退)）；idle-prewarm
          // 保持 8s 快速让路。on-demand 均为 fire-and-forget / 菜单内 spinner，
          // 拉长 timeout 不阻塞点击路径。
          timeoutMs: phase === "on-demand" ? 22_000 : 8_000,
          workspaceScope: "global",
          cancelPolicy: "yield-only",
          traceLabel: "engine/models",
          commandLabel: "get_engine_models",
          run: () => {
            if (providerProfileId) {
              return getEngineModels(engineType, {
                ...(options.forceRefresh ? { forceRefresh: true } : {}),
                providerProfileId,
              });
            }
            return options.forceRefresh
              ? getEngineModels(engineType, { forceRefresh: true })
              : getEngineModels(engineType);
          },
          fallback: () => scopedFallbackModels,
        });
        const sourceModels =
          models.length > 0 || options.forceRefresh || providerProfileId
            ? models
            : fallbackModels;
        const nextModels = sourceModels.map((model) => normalizeEngineModelEntry(model));
        lastGoodModelsByScopeRef.current.set(catalogRequestKey, nextModels);
        // forceRefresh = 权威重探：空目录也必须落表（凭证删除后目录可能真变空），
        // 否则 engineCatalogsByEngine 残留旧目录，非激活消费方读 stale。
        if (nextModels.length > 0 || options.forceRefresh) {
          setEngineCatalogsByEngine((current) => {
            const previous = current[engineType];
            if (
              (previous?.length ?? 0) === nextModels.length &&
              previous?.[0]?.id === nextModels[0]?.id
            ) {
              return current;
            }
            return { ...current, [engineType]: nextModels };
          });
        }
        if (visibleCatalogRequestKeyRef.current === catalogRequestKey) {
          setEngineModels((currentModels) =>
            areEngineModelCatalogsEqual(currentModels, nextModels)
              ? currentModels
              : nextModels,
          );
        }
        return nextModels;
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-engine-models-load-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/models load error",
          payload: {
            engine: engineType,
            providerProfileId,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        const normalizedFallback = scopedFallbackModels.map((model) => normalizeEngineModelEntry(model));
        if (visibleCatalogRequestKeyRef.current === catalogRequestKey) {
          setEngineModels((currentModels) =>
            areEngineModelCatalogsEqual(currentModels, normalizedFallback)
              ? currentModels
              : normalizedFallback,
          );
        }
        return normalizedFallback;
      }
    },
    [enabledEngineTypes, onDebug],
  );

  const refreshEngineModels = useCallback(
    async (
      engineType: EngineType,
      options: RefreshEngineModelsOptions = {},
    ) => {
      if (!enabledEngineTypes.includes(engineType)) {
        return;
      }
      const status = engineStatuses.find((entry) => entry.engineType === engineType);
      if (!status?.installed) {
        return;
      }
      const nextModels = await loadModelsForEngine(
        engineType,
        status.models,
        options,
      );
      if (
        options.forceRefresh &&
        !options.providerProfileId?.trim() &&
        nextModels.length > 0
      ) {
        setEngineStatuses((currentStatuses) =>
          currentStatuses.map((entry) =>
            entry.engineType === engineType
              ? { ...entry, models: nextModels }
              : entry,
          ),
        );
      }
    },
    [enabledEngineTypes, engineStatuses, loadModelsForEngine],
  );

  /**
   * Detect all installed engines
   */
  const refreshEngines = useCallback(async () => {
    if (detectPromiseRef.current) {
      return await detectPromiseRef.current;
    }

    const detectPromise = (async () => {
      setIsDetecting(true);
      setDetectFailed(false);

      onDebug?.({
        id: `${Date.now()}-engine-detect`,
        timestamp: Date.now(),
        source: "client",
        label: "engine/detect",
        payload: {},
      });

      try {
        const [rawStatuses, detectedEngine] = await Promise.all([
          requestEngineDetection({ source: "controller" }),
          getActiveEngine(),
        ]);
        const statuses = rawStatuses.filter((status) =>
          enabledEngineTypes.includes(status.engineType),
        );

        let nextActiveEngine = detectedEngine;
        const detectedEngineInstalled = Boolean(
          statuses.find((status) => status.engineType === detectedEngine)?.installed,
        );
        if (!enabledEngineTypes.includes(detectedEngine) || !detectedEngineInstalled) {
          nextActiveEngine =
            statuses.find((status) => status.installed)?.engineType ??
            enabledEngineTypes[0] ??
            "claude";
        }
        const persistedEngine = readPersistedEngineSelection();
        const persistedEngineInstalled = persistedEngine
          ? Boolean(
              statuses.find((status) => status.engineType === persistedEngine)
                ?.installed,
            )
          : false;
        if (
          persistedEngine &&
          enabledEngineTypes.includes(persistedEngine) &&
          persistedEngineInstalled &&
          persistedEngine !== detectedEngine
        ) {
          try {
            await switchEngine(persistedEngine);
            nextActiveEngine = persistedEngine;
          } catch (error) {
            onDebug?.({
              id: `${Date.now()}-engine-restore-selection-error`,
              timestamp: Date.now(),
              source: "error",
              label: "engine/restore persisted selection error",
              payload: {
                engine: persistedEngine,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        }
        const nextActiveEngineInstalled = Boolean(
          statuses.find((status) => status.engineType === nextActiveEngine)?.installed,
        );
        if (
          nextActiveEngine !== detectedEngine &&
          nextActiveEngineInstalled &&
          persistedEngine !== nextActiveEngine
        ) {
          try {
            await switchEngine(nextActiveEngine);
          } catch (error) {
            onDebug?.({
              id: `${Date.now()}-engine-normalize-active-error`,
              timestamp: Date.now(),
              source: "error",
              label: "engine/normalize active engine error",
              payload: {
                from: detectedEngine,
                to: nextActiveEngine,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        }

        onDebug?.({
          id: `${Date.now()}-engine-detect-result`,
          timestamp: Date.now(),
          source: "server",
          label: "engine/detect response",
          payload: { statuses, currentEngine: nextActiveEngine },
        });

        const nextAvailableEngines = buildAvailableEngines(statuses, true, false);

        setEngineStatuses(statuses);
        statuses.forEach((status) => {
          lastStatusesByEngineRef.current.set(status.engineType, status);
        });
        setActiveEngineState(nextActiveEngine);
        setIsInitialized(true);

        // Get models from the detected status first.
        const currentStatus = statuses.find((s) => s.engineType === nextActiveEngine);
        if (currentStatus?.installed && currentStatus.models.length > 0) {
          setEngineModels(
            currentStatus.models.map((model) => normalizeEngineModelEntry(model)),
          );
        } else {
          setEngineModels([]);
        }

        // B-fix：激活引擎目录在 detect 后立即加载。解耦引擎（pi/qoder/
        // opencode）走 on-demand 22s 预算覆盖后端最坏探测链——此前 idle-prewarm
        // 8s 对 PI 冷启动必超时，providerModelCatalogs[pi] 为空导致思考档
        // 联动滞后/缺失。opencode 不再跳过（其 models 同样已解耦）。
        if (currentStatus?.installed) {
          await loadModelsForEngine(nextActiveEngine, currentStatus.models, {
            phase: resolveEngineCatalogLoadPhase(nextActiveEngine),
          });
        }
        // 后台预热其余解耦引擎的目录（仅 pi/opencode：静态/低危害探测；
        // qoder 为 ACP 重探测 + runtime-only，明确排除——其目录由切换/
        // picker 显式路径按需加载）。非激活消费方（Shared 思考档联动/
        // 分组模型列表）依赖响应式目录表非空。idle-prewarm 后台预算，
        // 失败无副作用：后续切换/翻转路径会以 on-demand 重试。
        statuses
          .filter(
            (status) =>
              status.installed &&
              status.engineType !== nextActiveEngine &&
              (status.engineType === "pi" || status.engineType === "opencode"),
          )
          .forEach((status) => {
            void loadModelsForEngine(status.engineType, [], {
              phase: "idle-prewarm",
            }).catch(() => {});
          });

        return {
          availableEngines: nextAvailableEngines,
          activeEngine: nextActiveEngine,
        };
      } catch (error) {
        onDebug?.({
          id: `${Date.now()}-engine-detect-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/detect error",
          payload: error instanceof Error ? error.message : String(error),
        });
        // B5：失败/超时必置位 isInitialized + failed 态，根除永久「检测中」；
        // 晚到的真实结果（事件或迟返 invoke）恢复 ready。
        setIsInitialized(true);
        setDetectFailed(true);
      } finally {
        detectPromiseRef.current = null;
        setIsDetecting(false);
      }
    })();

    detectPromiseRef.current = detectPromise;
    return await detectPromise;
  }, [enabledEngineTypes, loadModelsForEngine, onDebug]);

  /**
   * Switch to a different engine
   */
  const setActiveEngine = useCallback(
    async (engineType: EngineType) => {
      const enabled = enabledEngineTypes.includes(engineType);
      if (!enabled) {
        onDebug?.({
          id: `${Date.now()}-engine-switch-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/switch error",
          payload: {
            reasonCode: "engine-disabled",
            engineType,
          },
        });
        return;
      }
      if (engineType === activeEngine) {
        return;
      }

      let targetStatus =
        engineStatuses.find((status) => status.engineType === engineType) ??
        null;
      // 硬红线（Qoder CN 点击卡死复盘）：本函数在创建流模态弹窗内执行，
      // 任何 await 挂住 = 弹窗永不关闭 = 整窗「卡死」。
      // ① 检测缺失/未安装时不 await 检测（探测要 spawn CLI，慢/挂起无上限），
      //    只做后台 per-engine 刷新，切换走乐观路径；后端 switch_engine 失败
      //    会走 error 分支回报。② per-engine（非全量 force，避免 9 引擎风暴）。
      if (!targetStatus?.installed) {
        void requestEngineDetection({
          source: "controller-switch",
          force: true,
          engines: [engineType],
        })
          .then((refreshedStatuses) => {
            const refreshed = refreshedStatuses.filter(
              (status) => status.engineType === engineType,
            );
            if (refreshed.length === 0) {
              return;
            }
            const refreshedById = new Map(
              refreshed.map((status) => [status.engineType, status]),
            );
            // 合并回现有状态表，不整表替换（避免清掉其他引擎的缓存状态）。
            setEngineStatuses((prev) =>
              prev.map((status) => refreshedById.get(status.engineType) ?? status),
            );
          })
          .catch((error: unknown) => {
            onDebug?.({
              id: `${Date.now()}-engine-detect-error-before-switch`,
              timestamp: Date.now(),
              source: "error",
              label: "engine/detect error",
              payload: error instanceof Error ? error.message : String(error),
            });
          });
      }

      // 检测已改为后台刷新，这里不再因「未安装/状态未知」早退：
      // ① CLI 可能刚装好而状态表还是旧缓存；② doctor / 检测都是
      // 无上限 spawn，await 会把创建流模态弹窗永久挂死（Qoder CN 卡死）。
      // 统一乐观放行，真实不可用由 switch_engine 失败走 error 分支回报。
      // codex 的 doctor 诊断证据改为后台收集（不 await、不早退），仅进 debug。
      if (targetStatus && !targetStatus.installed && engineType === "codex") {
        void runCodexDoctor(null, null)
          .catch((error: unknown) => error as unknown)
          .then((doctorOutcome) => {
            const doctorError =
              doctorOutcome instanceof Error ? doctorOutcome : null;
            const doctorResult =
              doctorError || !(doctorOutcome as CodexDoctorResult)
                ? null
                : (doctorOutcome as CodexDoctorResult);
            onDebug?.({
              id: `${Date.now()}-engine-switch-codex-doctor`,
              timestamp: Date.now(),
              source: "error",
              label: "engine/switch codex doctor evidence",
              payload: buildCodexSwitchUnavailablePayload(
                doctorResult,
                doctorError,
              ),
            });
          });
      }

      onDebug?.({
        id: `${Date.now()}-engine-switch`,
        timestamp: Date.now(),
        source: "client",
        label: "engine/switch",
        payload: { from: activeEngine, to: engineType },
      });

      const previousChrome = engineChromeRef.current;
      const lastGoodTargetModels =
        lastGoodModelsByScopeRef.current.get(`${engineType}:__global__`) ?? [];
      const optimisticModels =
        (targetStatus?.models.length ?? 0) > 0
          ? (targetStatus?.models ?? []).map((model) =>
              normalizeEngineModelEntry(model),
            )
          : lastGoodTargetModels.map((model) => normalizeEngineModelEntry(model));
      const generation = ++engineSwitchGenerationRef.current;
      // Optimistic chrome: thread-select must not wait on switch_engine IPC
      // or the first frame still binds the previous native composer.
      engineChromeRef.current = { engine: engineType, models: optimisticModels };
      setActiveEngineState(engineType);
      persistEngineSelection(engineType);
      setEngineModels(optimisticModels);
      visibleCatalogRequestKeyRef.current = `${engineType}:__global__`;

      try {
        const switchPromise = switchEngine(engineType);
        // race 超时后 switch 才 reject 的场景：挂空 catch 防 unhandled rejection。
        switchPromise.catch(() => {});
        let switchTimedOut = false;
        await new Promise<void>((resolve, reject) => {
          const switchTimer = setTimeout(() => {
            switchTimedOut = true;
            resolve();
          }, ENGINE_SWITCH_WAIT_TIMEOUT_MS);
          switchPromise.then(
            () => {
              clearTimeout(switchTimer);
              resolve();
            },
            (error: unknown) => {
              clearTimeout(switchTimer);
              reject(error);
            },
          );
        });
        if (switchTimedOut) {
          onDebug?.({
            id: `${Date.now()}-engine-switch-timeout`,
            timestamp: Date.now(),
            source: "error",
            label: "engine/switch timeout",
            payload: {
              reasonCode: "engine-switch-wait-timeout",
              engineType,
            },
          });
          return;
        }
        if (engineSwitchGenerationRef.current !== generation) {
          return;
        }
        onDebug?.({
          id: `${Date.now()}-engine-switch-success`,
          timestamp: Date.now(),
          source: "server",
          label: "engine/switch success",
          payload: { engine: engineType, models: targetStatus?.models ?? [] },
        });
        // P0 修复：B1 把 models 从 detect 解耦后，切换目标引擎的目录必须
        // 在此显式加载（此前隐含「detect 顺带带回目录」，乐观 models 即真实
        // 目录；解耦后 pi/qoder/opencode 状态 models 为空，乐观值落到空的
        // lastGood → 切换后无人加载 → providerModelCatalogs[engine] 永远
        // 为空 → 思考档/模型列表必现缺失）。phase 由共通决策给出：解耦
        // 引擎 on-demand 22s 覆盖后端最坏探测链。
        if (engineSwitchGenerationRef.current === generation) {
          void loadModelsForEngine(engineType, [], {
            phase: resolveEngineCatalogLoadPhase(engineType),
          }).catch(() => {});
        }
      } catch (error) {
        if (engineSwitchGenerationRef.current === generation) {
          engineChromeRef.current = previousChrome;
          setActiveEngineState(previousChrome.engine);
          persistEngineSelection(previousChrome.engine);
          setEngineModels(previousChrome.models);
          visibleCatalogRequestKeyRef.current = `${previousChrome.engine}:__global__`;
        }
        onDebug?.({
          id: `${Date.now()}-engine-switch-error`,
          timestamp: Date.now(),
          source: "error",
          label: "engine/switch error",
          payload: {
            reasonCode: "engine-switch-exception",
            engineType,
          },
        });
      }
    },
    [
      activeEngine,
      enabledEngineTypes,
      engineStatuses,
      loadModelsForEngine,
      onDebug,
    ],
  );

  /**
   * Get display information for all engines
   */
  const availableEngines = useMemo(
    () => buildAvailableEngines(engineStatuses, isInitialized, detectFailed),
    [engineStatuses, isInitialized],
  );

  /**
   * Get display information for installed engines only
   */
  const installedEngines = useMemo((): EngineDisplayInfo[] => {
    return availableEngines.filter((e) => e.installed);
  }, [availableEngines]);

  /**
   * Get current engine status
   */
  const currentEngineStatus = useMemo((): EngineStatus | null => {
    return engineStatuses.find((s) => s.engineType === activeEngine) ?? null;
  }, [engineStatuses, activeEngine]);

  /**
   * Get current engine display info
   */
  const currentEngineDisplay = useMemo((): EngineDisplayInfo | null => {
    return availableEngines.find((e) => e.type === activeEngine) ?? null;
  }, [availableEngines, activeEngine]);

  /**
   * Check if multiple engines are available
   */
  const hasMultipleEngines = useMemo(() => {
    return installedEngines.length > 1;
  }, [installedEngines]);

  const mappedEngineModels = useMemo(
    () => projectActiveEngineModels(activeEngine, engineModels),
    [activeEngine, engineModels, customModelsVersion],
  );

  /**
   * Convert engine models to ModelOption format for UI compatibility
   */
  const engineModelsAsOptions = useMemo(
    () => mappedEngineModels.map(engineModelToOption),
    [mappedEngineModels],
  );

  const engineModelCatalogsAsOptions = useMemo(
    () =>
      projectEngineModelCatalogs(
        engineStatuses,
        activeEngine,
        mappedEngineModels,
        engineCatalogsByEngine,
      ),
    [
      activeEngine,
      customModelsVersion,
      engineCatalogsByEngine,
      engineStatuses,
      mappedEngineModels,
    ],
  );

  // Initialize on mount
  useEffect(() => {
    if (initRef.current) {
      return;
    }
    initRef.current = true;
    refreshEngines();
  }, [refreshEngines]);

  // B4 逐引擎事件订阅：探测完成即逐项 reveal。runId 单调守卫丢弃旧 run 的
  // 迟到事件；同一轮连续事件在 microtask 内合批为单次 setState（Render Perf
  // Baseline：低频事件驱动，不进根链高频 setState）。
  const lastAppliedDetectRunIdRef = useRef(0);
  const lastStatusesByEngineRef = useRef<Map<EngineType, EngineStatus>>(new Map());
  const refreshEngineModelsRef = useRef<typeof refreshEngineModels | null>(null);
  useEffect(() => {
    refreshEngineModelsRef.current = refreshEngineModels;
  }, [refreshEngineModels]);
  // B7：供应商 CRUD 失效事件同时清除 controller 侧 per-scope last-good，
  // legacy \`engineModelCatalogsAsOptions\` 不再吃旧目录。
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handler = () => {
      lastGoodModelsByScopeRef.current.clear();
    };
    window.addEventListener(
      PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT,
      handler,
    );
    return () => {
      window.removeEventListener(
        PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT,
        handler,
      );
    };
  }, []);
  // PI 凭证（auth.json）/ models.json 写入：后端命令已 invalidate_engine_models，
  // FE 侧同步两步收敛（否则要等切换/翻转/重启才一致）：
  // ① 清状态副本中的 PI models——与 Rust 失效语义一一对应（清目录留条目），
  //    非激活投影立即失去 stale status.models；
  // ② forceRefresh 重载——空目录也被采信并落 engineCatalogsByEngine /
  //    engineModels，凭证删除后 picker 即时收敛。
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handler = () => {
      setEngineStatuses((current) =>
        current.map((status) =>
          status.engineType === "pi" && status.models.length > 0
            ? { ...status, models: [] }
            : status,
        ),
      );
      void refreshEngineModelsRef.current?.("pi", {
        forceRefresh: true,
      }).catch(() => {});
    };
    window.addEventListener(PI_AUTH_CATALOG_CHANGED_EVENT, handler);
    return () => {
      window.removeEventListener(PI_AUTH_CATALOG_CHANGED_EVENT, handler);
    };
  }, []);
  const pendingStatusEventsRef = useRef<Map<EngineType, EngineStatusUpdatedEvent>>(new Map());
  const flushScheduledRef = useRef(false);
  useEffect(() => {
    return subscribeEngineStatusEvents((event) => {
      if (
        !Number.isFinite(event.detectRunId) ||
        event.detectRunId < lastAppliedDetectRunIdRef.current ||
        !event.status ||
        typeof event.status.engineType !== "string"
      ) {
        return;
      }
      pendingStatusEventsRef.current.set(event.status.engineType, event);
      if (flushScheduledRef.current) {
        return;
      }
      flushScheduledRef.current = true;
      queueMicrotask(() => {
        flushScheduledRef.current = false;
        const pending = new Map(pendingStatusEventsRef.current);
        pendingStatusEventsRef.current.clear();
        if (pending.size === 0) {
          return;
        }
        let maxRunId = 0;
        pending.forEach((item) => {
          maxRunId = Math.max(maxRunId, item.detectRunId);
        });
        lastAppliedDetectRunIdRef.current = Math.max(
          lastAppliedDetectRunIdRef.current,
          maxRunId,
        );
        // B7 翻转失效（P0 修正版）：① 只有 installed 翻转才算状态翻转——
        // authState Unknown→Authenticated 是 phase2 的**正常到达**，每次检测
        // 轮都会发生，绝不能触发缓存失效（曾致 INVALIDATED 风暴 → 原子缓存
        // 被反复清空 → picker/执行目标竞态读串，模型 chip/思考档/发送全坏）；
        // ② 翻转检测在 updater 外完成（updater 内副作用会被 StrictMode 双调）。
        const installedFlips: EngineType[] = [];
        pending.forEach((item) => {
          const previous = lastStatusesByEngineRef.current.get(
            item.status.engineType,
          );
          if (
            previous &&
            previous.installed !== item.status.installed
          ) {
            installedFlips.push(item.status.engineType);
          }
          lastStatusesByEngineRef.current.set(
            item.status.engineType,
            item.status,
          );
        });
        if (installedFlips.length > 0 && typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(PROVIDER_TARGET_CATALOG_INVALIDATED_EVENT),
          );
          installedFlips.forEach((engineType) => {
            void refreshEngineModelsRef.current?.(engineType).catch(() => {});
          });
        }
        setEngineStatuses((currentStatuses) => {
          let changed = false;
          const next = currentStatuses.map((status) => {
            const item = pending.get(status.engineType);
            if (!item) {
              return status;
            }
            changed = true;
            return item.status;
          });
          pending.forEach((item) => {
            if (!next.some((status) => status.engineType === item.status.engineType)) {
              changed = true;
              next.push(item.status);
            }
          });
          return changed ? next : currentStatuses;
        });
      });
    });
  }, []);

  // Reset models when workspace changes
  useEffect(() => {
    if (workspaceId === lastWorkspaceId.current) {
      return;
    }
    lastWorkspaceId.current = workspaceId;
    // Optionally refresh models when workspace changes
    if (workspaceId && isConnected && currentEngineStatus?.installed) {
      void refreshEngineModels(activeEngine);
    }
  }, [
    workspaceId,
    isConnected,
    activeEngine,
    currentEngineStatus?.installed,
    refreshEngineModels,
  ]);

  useEngineRuntimeNotices(availableEngines, isInitialized);

  // B5：打开新建会话菜单的 fire-and-forget 检测——后端缓存裁决 fresh/stale
  //（fresh 即时返回 0 spawn，stale 走 SWR），不阻塞菜单渲染；结果经事件 merge。
  const requestMenuOpenDetection = useCallback(() => {
    void requestEngineDetection({ source: "menu-open" }).catch(() => {
      // fire-and-forget：失败不打扰菜单；failed 态由显式刷新/重试路径管理
    });
  }, []);

  // B5：failed 态重试——清失败态后重跑全量检测（force 语义由后端 SWR 决定）。
  const retryDetection = useCallback(async () => {
    setDetectFailed(false);
    setIsDetecting(true);
    try {
      await requestEngineDetection({ source: "controller-retry", force: true });
    } catch {
      setDetectFailed(true);
    } finally {
      setIsDetecting(false);
    }
  }, []);

  // B5：菜单单引擎刷新——per-engine force，不再全量。
  const refreshSingleEngine = useCallback(
    async (engineType: EngineType) => {
      setIsDetecting(true);
      try {
        await requestEngineDetection({
          source: "menu-single-engine",
          force: true,
          engines: [engineType],
        });
      } catch {
        // 单引擎失败不置全局 failed；该引擎条目以自身 error 呈现
      } finally {
        setIsDetecting(false);
      }
    },
    [],
  );

  return useMemo(
    () => ({
      activeEngine,
      detectFailed,
      requestMenuOpenDetection,
      retryDetection,
      refreshSingleEngine,
      engineStatuses,
      engineModels,
      engineModelsAsOptions,
      engineModelCatalogsAsOptions,
      isDetecting,
      isInitialized,
      availableEngines,
      installedEngines,
      currentEngineStatus,
      currentEngineDisplay,
      hasMultipleEngines,
      setActiveEngine,
      refreshEngines,
      refreshEngineModels,
    }),
    [
      activeEngine,
      availableEngines,
      currentEngineDisplay,
      currentEngineStatus,
      engineModelCatalogsAsOptions,
      engineModels,
      engineModelsAsOptions,
      engineStatuses,
      hasMultipleEngines,
      installedEngines,
      isDetecting,
      isInitialized,
      refreshEngineModels,
      refreshEngines,
      setActiveEngine,
    ],
  );
}
