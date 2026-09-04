import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ConversationItem,
  EngineType,
  ModelOption,
} from "../../../../../types";
import type { ComposerProps } from "../types";
import {
  hydrateSharedTargetState,
  useSharedTargetState,
} from "../../../../shared-session/target/targetStore";
import {
  isAtomicExecutionTarget,
  isResolvedExecutionTarget,
  type ExecutionTarget,
} from "../../../../shared-session/target/types";
import { isSharedSessionThreadId } from "../../../../shared-session/utils/sharedSessionIdentity";
import { resolveDefaultCreationExecutionTarget } from "../../../utils/resolveDefaultCreationExecutionTarget";
import { resolveDshNativeRuntimeModel } from "../../../utils/dshNativeModelSelection";
import {
  CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  CODEX_DISK_PROVIDER_PROFILE_ID,
  LOCAL_PROVIDER_PROFILE_DISPLAY_NAME,
} from "../../../../threads/constants/codexProviderProfiles";
import { useNativeAtomicSelectionOverlay } from "../../../hooks/useNativeAtomicSelectionOverlay";
import {
  isBlankDshComposerThread,
  normalizeDshAgentPreset,
  resolveDshComposerAgentPreset,
  type DshAgentPresetId,
} from "../../ChatInputBox/selectors/dshAgentPresets";
import {
  getComposerEnginePrefForEngine,
  setComposerEnginePref,
} from "../../../hooks/composerEnginePrefsStore";
import {
  reconcileAtomicReasoningEffort,
  resolveAtomicReasoningOptions,
} from "../../../../models/atomicModelReasoning";
import {
  acceptImagesWithinEngineLimit,
  engineSupportsImageInput,
  formatEngineImageTooLargeMessage,
  getEngineImageInputLabel,
} from "../../../../engine/utils/engineImageInput";
import { pushErrorToast } from "../../../../../services/toasts";

export interface UseComposerExecutionTargetsOptions {
  items: ConversationItem[];
  activeWorkspaceId: string | null;
  activeThreadId: string | null;
  isSharedSession: boolean;
  createSessionTargetPicker: boolean;
  sharedTargetPickerLocked: boolean;
  selectedEngine: ComposerProps["selectedEngine"];
  selectedModelId: ComposerProps["selectedModelId"];
  selectedEffort: ComposerProps["selectedEffort"];
  providerProfileId: ComposerProps["providerProfileId"];
  providerProfileName: ComposerProps["providerProfileName"];
  models: ComposerProps["models"];
  providerModelCatalogs: ComposerProps["providerModelCatalogs"];
  reasoningOptions: ComposerProps["reasoningOptions"];
  sessionDshAgentPreset: ComposerProps["dshAgentPreset"];
  onCreationTargetEngineChange: ComposerProps["onCreationTargetEngineChange"];
  onAttachImages: ComposerProps["onAttachImages"];
  onPickImages: ComposerProps["onPickImages"];
}

export function useComposerExecutionTargets({
  items,
  activeWorkspaceId,
  activeThreadId,
  isSharedSession,
  createSessionTargetPicker,
  sharedTargetPickerLocked,
  selectedEngine,
  selectedModelId,
  selectedEffort,
  providerProfileId,
  providerProfileName,
  models,
  providerModelCatalogs,
  reasoningOptions,
  sessionDshAgentPreset,
  onCreationTargetEngineChange,
  onAttachImages,
  onPickImages,
}: UseComposerExecutionTargetsOptions) {
  const { t } = useTranslation();
  const sharedTargetState = useSharedTargetState(
    activeWorkspaceId ?? "",
    activeThreadId ?? "",
  );
  const selectedSharedTarget = sharedTargetState.selectedNextTarget;
  const [selectedCreationTarget, setSelectedCreationTarget] =
    useState<ExecutionTarget | null>(null);
  // 首页 picker 主动切换 engine 时，parent selectedEngine 可能尚未异步跟上；
  // 用 ref 标记「等待 parent 追上的目标」，避免误清 sticky creation target。
  const pendingPickerEngineRef = useRef<EngineType | null>(null);
  const defaultCreationTarget = useMemo<ExecutionTarget | null>(() => {
    return resolveDefaultCreationExecutionTarget({
      enabled: createSessionTargetPicker,
      selectedEngine,
      selectedModelId,
      selectedEffort,
      providerProfileId,
      models,
    });
  }, [
    createSessionTargetPicker,
    models,
    providerProfileId,
    selectedEffort,
    selectedEngine,
    selectedModelId,
  ]);
  const effectiveCreationTarget =
    selectedCreationTarget ?? defaultCreationTarget;
  // 只在 engine 语义变化时通知父层，避免等价 setState 触发 layout 重渲染环
  const publishedCreationTargetEngineRef = useRef<
    EngineType | null | undefined
  >(undefined);
  useEffect(() => {
    if (!createSessionTargetPicker) {
      publishedCreationTargetEngineRef.current = undefined;
      return;
    }
    const nextEngine =
      effectiveCreationTarget?.engine ?? selectedEngine ?? null;
    if (publishedCreationTargetEngineRef.current === nextEngine) {
      return;
    }
    publishedCreationTargetEngineRef.current = nextEngine;
    onCreationTargetEngineChange?.(nextEngine);
  }, [
    createSessionTargetPicker,
    effectiveCreationTarget?.engine,
    onCreationTargetEngineChange,
    selectedEngine,
  ]);
  useEffect(() => {
    if (!createSessionTargetPicker) {
      return;
    }
    return () => {
      publishedCreationTargetEngineRef.current = undefined;
      pendingPickerEngineRef.current = null;
      onCreationTargetEngineChange?.(null);
    };
  }, [createSessionTargetPicker, onCreationTargetEngineChange]);
  // 全局 selectedEngine 外部变更（启动 restore / 从会话回首页）时，丢掉与其不一致的
  // sticky creation target，否则首页会卡在首屏默认 claude，而会话区已是 grok。
  // 仅依赖 selectedEngine：用户点选时只写 sticky、不立刻改 prop，故不会误清。
  useEffect(() => {
    if (!createSessionTargetPicker || !selectedEngine) {
      return;
    }
    if (pendingPickerEngineRef.current != null) {
      if (pendingPickerEngineRef.current === selectedEngine) {
        // 用户点选已落地，保留 sticky 的 model/profile 细节
        pendingPickerEngineRef.current = null;
        return;
      }
      // parent 走到了别的 engine（外部 restore 或 switch 失败后的回落）
      pendingPickerEngineRef.current = null;
    }
    setSelectedCreationTarget((prev) => {
      if (prev == null || prev.engine === selectedEngine) {
        return prev;
      }
      return null;
    });
  }, [createSessionTargetPicker, selectedEngine]);
  /**
   * Native Atomic 点选的即时投影。
   * Shared 写 selectedNextTarget 即可立刻刷新勾选；Native 若只走 onSelectModel
   * 长链，catalog 分叉时勾选/触发器不更新。用本状态对齐 Shared 的「target 即 UI」。
   * 只覆盖 model 身份；effort 仍跟 selectedEffort prop，避免抢走推理档位选择器。
   */
  const nativeAtomicResetKey = `${activeThreadId ?? ""}::${selectedEngine ?? ""}::${providerProfileId ?? ""}`;
  const [nativeAtomicSelection, setNativeAtomicSelection] =
    useNativeAtomicSelectionOverlay(nativeAtomicResetKey);
  // Native 会话合成 ExecutionTarget，驱动与首页相同的 Atomic 双栏选中态（含渠道）。
  const nativeSessionTarget = useMemo((): ExecutionTarget | null => {
    if (isSharedSession || createSessionTargetPicker || !selectedEngine) {
      return null;
    }
    const rawProfileId = providerProfileId?.trim() || null;
    // 本地 sentinel 与 Shared 一致：对外投影为 null + disk，避免 __disk__ 被当成 managed
    const isLocalCodexDisk =
      selectedEngine === "codex" &&
      rawProfileId === CODEX_DISK_PROVIDER_PROFILE_ID;
    const isLocalClaude =
      selectedEngine === "claude" &&
      rawProfileId === CLAUDE_LOCAL_PROVIDER_PROFILE_ID;
    const profileId = isLocalCodexDisk || isLocalClaude ? null : rawProfileId;
    const profileName = providerProfileName?.trim() || null;
    const propModelId = selectedModelId?.trim() || null;
    const modelCatalogEntryId =
      nativeAtomicSelection?.modelCatalogEntryId ?? propModelId;
    // runtime 优先 catalog 当前映射，禁止用档位 id / 跨供应商残留冒充 --model。
    const catalogEntry =
      modelCatalogEntryId != null
        ? (models.find((candidate) => candidate.id === modelCatalogEntryId) ??
          null)
        : null;
    const catalogRuntime = catalogEntry?.model?.trim() || null;
    const atomicRuntime = nativeAtomicSelection?.model?.trim() || null;
    const runtimeModel =
      selectedEngine === "dsh"
        ? resolveDshNativeRuntimeModel({
            catalogEntryId: modelCatalogEntryId,
            catalogRuntime,
            overlayRuntime: atomicRuntime,
          })
        : catalogRuntime ||
          (atomicRuntime &&
          atomicRuntime !== modelCatalogEntryId &&
          !/^k3$/i.test(atomicRuntime) &&
          !/^kimi-/i.test(atomicRuntime)
            ? atomicRuntime
            : null) ||
          null;
    return {
      engine: selectedEngine,
      providerProfileId: profileId,
      modelCatalogEntryId,
      model: runtimeModel,
      reasoning: selectedEffort ? { effort: selectedEffort } : null,
      // managed 必须带上创建时供应商名，底栏渠道芯片才能显示 kimi/m3 而非回落 DeepSeek
      providerProfileNameSnapshot: profileId
        ? profileName || profileId
        : LOCAL_PROVIDER_PROFILE_DISPLAY_NAME,
      providerProfileSource: profileId ? "managed" : "disk",
    };
  }, [
    createSessionTargetPicker,
    isSharedSession,
    models,
    nativeAtomicSelection,
    providerProfileId,
    providerProfileName,
    selectedEffort,
    selectedEngine,
    selectedModelId,
  ]);
  // 身份 id-first 纵深防御（fix-shared-session-identity-id-first）：
  // prop 链收敛正确时与 isSharedSession 一致；prop 过期时 shared: id 仍兜底，
  // 保证 shared id 永不进入 native 续接分支。
  const isSharedSessionResolved =
    isSharedSession || isSharedSessionThreadId(activeThreadId);
  const selectedAtomicTarget = isSharedSessionResolved
    ? selectedSharedTarget
    : createSessionTargetPicker
      ? effectiveCreationTarget
      : nativeSessionTarget;
  const isDshComposerEngine =
    (selectedAtomicTarget?.engine ?? selectedEngine) === "dsh";
  const hasDshUserMessages = items.some(
    (item) => item.kind === "message" && item.role === "user",
  );
  const [draftDshAgentPreset, setDraftDshAgentPreset] =
    useState<DshAgentPresetId>(() =>
      normalizeDshAgentPreset(
        getComposerEnginePrefForEngine("dsh").dshAgentPreset,
      ),
    );
  const resolvedDshComposerPreset = resolveDshComposerAgentPreset({
    threadId: activeThreadId,
    sessionHeader: sessionDshAgentPreset,
    draftOrPref: draftDshAgentPreset,
    hasUserMessages: hasDshUserMessages,
  });
  const dshAgentPresetLocked =
    isDshComposerEngine && resolvedDshComposerPreset.locked;
  const resolvedDshAgentPreset = resolvedDshComposerPreset.value;
  useEffect(() => {
    if (!isBlankDshComposerThread(activeThreadId)) {
      return;
    }
    setDraftDshAgentPreset(
      normalizeDshAgentPreset(
        getComposerEnginePrefForEngine("dsh").dshAgentPreset,
      ),
    );
  }, [activeThreadId, selectedEngine]);
  const handleDshAgentPresetSelect = useCallback(
    (preset: string) => {
      if (dshAgentPresetLocked) {
        return;
      }
      const next = normalizeDshAgentPreset(preset);
      setDraftDshAgentPreset(next);
      setComposerEnginePref("dsh", { dshAgentPreset: next });
    },
    [dshAgentPresetLocked],
  );
  /**
   * Shared / create-session Atomic：思考档位 options + effort 只信 target 的
   * engine+model。Native Codex 残留的 activeEngine / selectedEffort /
   * reasoningOptions 禁止在 Shared 初始化或 target 短暂为空时回灌 UI。
   */
  const atomicModelReasoningRef = useMemo(() => {
    const target = selectedAtomicTarget;
    if (!target?.engine) {
      return null;
    }
    const catalogEntryId = target.modelCatalogEntryId?.trim() || null;
    const runtimeModel = target.model?.trim() || null;
    // P0 后统一：所有引擎（含 dsh/qoder/kimi/grok/opencode）走同一份
    // catalog 匹配投影——目录条目带 supportedReasoningEfforts 即联动思考
    // 档（首页创建框与会话内 ButtonArea 共用数据源），缺 metadata 保持
    // 「只填 id/model」capability-neutral，不再按引擎白名单特判。
    type ModelReasoningLike = {
      id: string;
      model?: string;
      source?: string | null;
      supportedReasoningEfforts?: ModelOption["supportedReasoningEfforts"];
      defaultReasoningEffort?: string | null;
    };
    const catalog = (providerModelCatalogs?.[target.engine] ??
      []) as ModelReasoningLike[];
    const parentModels = models as ModelReasoningLike[];
    const matchByIdentity = (entry: ModelReasoningLike) => {
      if (catalogEntryId && entry.id === catalogEntryId) {
        return true;
      }
      if (
        runtimeModel &&
        (entry.model === runtimeModel || entry.id === runtimeModel)
      ) {
        return true;
      }
      return false;
    };
    const matchedCatalog = catalog.find(matchByIdentity) ?? null;
    const matchedParent = parentModels.find(matchByIdentity) ?? null;
    const preferred = matchedCatalog ?? matchedParent;
    const reasoningEfforts =
      preferred?.supportedReasoningEfforts &&
      preferred.supportedReasoningEfforts.length > 0
        ? preferred.supportedReasoningEfforts
        : matchedParent?.supportedReasoningEfforts;
    const reasoningDefault =
      preferred?.defaultReasoningEffort ??
      matchedParent?.defaultReasoningEffort ??
      null;
    return {
      engine: target.engine,
      model: {
        id: catalogEntryId ?? preferred?.id ?? runtimeModel,
        model: runtimeModel ?? preferred?.model ?? catalogEntryId,
        source: preferred?.source ?? undefined,
        ...(reasoningEfforts && reasoningEfforts.length > 0
          ? { supportedReasoningEfforts: reasoningEfforts }
          : {}),
        ...(reasoningDefault ? { defaultReasoningEffort: reasoningDefault } : {}),
      },
    };
  }, [models, providerModelCatalogs, selectedAtomicTarget]);
  const useAtomicReasoningProjection =
    isSharedSessionResolved || Boolean(createSessionTargetPicker);
  const atomicReasoningOptions = useMemo(() => {
    if (!useAtomicReasoningProjection) {
      return reasoningOptions;
    }
    // Shared / create-session：即使 target 尚未 hydrate，也禁止回落父层
    // Native Codex 的全量 options（会带出 xhigh/max/ultra + 脏 effort）。
    if (atomicModelReasoningRef) {
      return resolveAtomicReasoningOptions(
        atomicModelReasoningRef.engine,
        atomicModelReasoningRef.model,
      );
    }
    return [];
  }, [atomicModelReasoningRef, reasoningOptions, useAtomicReasoningProjection]);
  const atomicSelectedEffort = useMemo(() => {
    if (!useAtomicReasoningProjection) {
      return selectedEffort;
    }
    if (!selectedAtomicTarget?.engine) {
      // Shared 无 target：不展示父层 Codex high 等残留
      return null;
    }
    return reconcileAtomicReasoningEffort({
      engine: selectedAtomicTarget.engine,
      model: atomicModelReasoningRef?.model ?? null,
      effort: selectedAtomicTarget.reasoning?.effort ?? null,
    });
  }, [
    atomicModelReasoningRef,
    selectedAtomicTarget,
    selectedEffort,
    useAtomicReasoningProjection,
  ]);
  // Shared：收敛 null/非法 effort（含 Claude/Grok 夹紧 + Codex 播种）。
  useEffect(() => {
    if (
      !isSharedSessionResolved ||
      sharedTargetPickerLocked ||
      !selectedSharedTarget ||
      !isResolvedExecutionTarget(selectedSharedTarget) ||
      !atomicModelReasoningRef
    ) {
      return;
    }
    if (!activeWorkspaceId || !activeThreadId) {
      return;
    }
    const engine = selectedSharedTarget.engine;
    if (
      engine !== "codex" &&
      engine !== "claude" &&
      engine !== "grok" &&
      engine !== "pi"
    ) {
      return;
    }
    const raw = selectedSharedTarget.reasoning?.effort ?? null;
    const normalizedRaw = typeof raw === "string" ? raw.trim() || null : null;
    const reconciled = reconcileAtomicReasoningEffort({
      engine,
      model: atomicModelReasoningRef.model,
      effort: normalizedRaw,
    });
    if (reconciled === normalizedRaw) {
      return;
    }
    // 仅内存收敛：保证本会话 UI/send 一致；下次 hydrate 仍会再 reconcile。
    hydrateSharedTargetState(activeWorkspaceId, activeThreadId, {
      ...selectedSharedTarget,
      reasoning: reconciled ? { effort: reconciled } : null,
    });
  }, [
    activeThreadId,
    activeWorkspaceId,
    atomicModelReasoningRef,
    isSharedSessionResolved,
    selectedSharedTarget,
    sharedTargetPickerLocked,
  ]);
  const imageAttachEngine = useMemo((): EngineType | null => {
    if (isSharedSession && isResolvedExecutionTarget(selectedSharedTarget)) {
      return selectedSharedTarget.engine;
    }
    if (
      createSessionTargetPicker &&
      isAtomicExecutionTarget(effectiveCreationTarget)
    ) {
      return effectiveCreationTarget.engine;
    }
    return selectedEngine ?? null;
  }, [
    createSessionTargetPicker,
    effectiveCreationTarget,
    isSharedSession,
    selectedEngine,
    selectedSharedTarget,
  ]);
  const imageInputSupported = engineSupportsImageInput(imageAttachEngine);
  const notifyImageInputUnsupported = useCallback(() => {
    if (!imageAttachEngine) {
      return;
    }
    pushErrorToast({
      title: t("composer.imageInputUnsupportedTitle", {
        defaultValue: "Image not supported",
      }),
      message: t("composer.imageAttachUnsupported", {
        engine: getEngineImageInputLabel(imageAttachEngine),
        defaultValue:
          "{{engine}} does not support image attachments in this release",
      }),
      durationMs: 3600,
    });
  }, [imageAttachEngine, t]);
  const notifyImageTooLarge = useCallback(
    (bytes: number, maxBytes: number) => {
      if (!imageAttachEngine) {
        return;
      }
      pushErrorToast({
        title: t("composer.imageTooLargeTitle", {
          defaultValue: "Image too large",
        }),
        message: formatEngineImageTooLargeMessage(
          imageAttachEngine,
          bytes,
          maxBytes,
          t as (key: string, options?: Record<string, unknown>) => string,
        ),
        durationMs: 4200,
      });
    },
    [imageAttachEngine, t],
  );
  const handleAttachImagesGuarded = useCallback(
    (paths: string[]) => {
      if (!imageInputSupported) {
        notifyImageInputUnsupported();
        return;
      }
      const { accepted, rejected } = acceptImagesWithinEngineLimit(
        paths,
        imageAttachEngine,
      );
      if (rejected) {
        notifyImageTooLarge(rejected.bytes, rejected.maxBytes);
      }
      if (accepted.length === 0) {
        return;
      }
      onAttachImages?.(accepted);
    },
    [
      imageAttachEngine,
      imageInputSupported,
      notifyImageInputUnsupported,
      notifyImageTooLarge,
      onAttachImages,
    ],
  );
  const handlePickImagesGuarded = useCallback(() => {
    if (!imageInputSupported) {
      notifyImageInputUnsupported();
      return;
    }
    onPickImages?.();
  }, [imageInputSupported, notifyImageInputUnsupported, onPickImages]);
  return {
    selectedSharedTarget,
    selectedCreationTarget,
    setSelectedCreationTarget,
    pendingPickerEngineRef,
    effectiveCreationTarget,
    setNativeAtomicSelection,
    isSharedSessionResolved,
    selectedAtomicTarget,
    resolvedDshAgentPreset,
    dshAgentPresetLocked,
    handleDshAgentPresetSelect,
    useAtomicReasoningProjection,
    atomicReasoningOptions,
    atomicSelectedEffort,
    imageAttachEngine,
    imageInputSupported,
    handleAttachImagesGuarded,
    handlePickImagesGuarded,
  };
}
