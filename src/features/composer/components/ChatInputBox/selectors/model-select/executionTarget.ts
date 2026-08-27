/**
 * ExecutionTarget 构建与 provider profile 归一（ModelSelect 纯函数层）。
 *
 * 从 ModelSelect.tsx 平移（openspec change refactor-composer-selector-layer
 * Phase 3）：代码零改动，仅归组。级联语义审计见 change design §4/§5。
 */
import { resolveAtomicReasoningEffort } from "../../../../../models/atomicModelReasoning";
import {
  CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  CODEX_DISK_PROVIDER_PROFILE_ID,
  DSH_LOCAL_PROVIDER_PROFILE_ID,
  GROK_LOCAL_PROVIDER_PROFILE_ID,
  KIMI_LOCAL_PROVIDER_PROFILE_ID,
  OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
  PI_LOCAL_PROVIDER_PROFILE_ID,
  QODER_GLOBAL_PROVIDER_PROFILE_ID,
  QODER_LOCAL_PROVIDER_PROFILE_ID,
} from "../../../../../threads/constants/codexProviderProfiles";
import type { ExecutionTarget } from "../../../../../shared-session/target/types";
import type { ModelInfo, ProviderId } from "../../types";

const LOCAL_PROVIDER_PROFILE_IDS: Partial<Record<ProviderId, string>> = {
  claude: CLAUDE_LOCAL_PROVIDER_PROFILE_ID,
  codex: CODEX_DISK_PROVIDER_PROFILE_ID,
  kimi: KIMI_LOCAL_PROVIDER_PROFILE_ID,
  grok: GROK_LOCAL_PROVIDER_PROFILE_ID,
  opencode: OPENCODE_LOCAL_PROVIDER_PROFILE_ID,
  pi: PI_LOCAL_PROVIDER_PROFILE_ID,
  dsh: DSH_LOCAL_PROVIDER_PROFILE_ID,
  qoder: QODER_LOCAL_PROVIDER_PROFILE_ID,
};

export function normalizeExecutionProviderProfileId(
  providerId: ProviderId,
  providerProfileId: string | null | undefined,
): string | null {
  const normalizedProviderProfileId = providerProfileId?.trim();
  // Qoder Global/CN are fixed distribution identities, not ordinary local
  // provider profiles. Preserve them through target selection and dispatch.
  if (providerId === "qoder") {
    return !normalizedProviderProfileId ||
      normalizedProviderProfileId === QODER_LOCAL_PROVIDER_PROFILE_ID
      ? null
      : normalizedProviderProfileId;
  }
  return !normalizedProviderProfileId ||
    LOCAL_PROVIDER_PROFILE_IDS[providerId] === normalizedProviderProfileId
    ? null
    : normalizedProviderProfileId;
}

/**
 * 每个 CLI 只投影一个活跃渠道:当前 CLI 取 executionTarget 所选渠道
 * (空 = 本地默认),其余 CLI 一律取本地默认渠道。
 */
export function resolveActiveProviderProfileId(
  providerId: ProviderId,
  executionTarget:
    | Pick<ExecutionTarget, "engine" | "providerProfileId">
    | null
    | undefined,
): string | null {
  const targetProfileId =
    executionTarget?.engine === providerId
      ? normalizeExecutionProviderProfileId(
          providerId,
          executionTarget.providerProfileId,
        )
      : null;
  if (targetProfileId) {
    return targetProfileId;
  }
  return providerId === "qoder"
    ? QODER_GLOBAL_PROVIDER_PROFILE_ID
    : (LOCAL_PROVIDER_PROFILE_IDS[providerId] ?? null);
}

export function isSameProviderExecutionProfile(
  currentProvider: ProviderId,
  currentProviderProfileId: string | null | undefined,
  target: Pick<ExecutionTarget, "engine" | "providerProfileId">,
): boolean {
  return (
    target.engine === currentProvider &&
    normalizeExecutionProviderProfileId(
      currentProvider,
      target.providerProfileId,
    ) ===
      normalizeExecutionProviderProfileId(
        currentProvider,
        currentProviderProfileId,
      )
  );
}

export type BuildProviderExecutionTargetModelMeta = {
  source?: string | null;
  supportedReasoningEfforts?: ModelInfo["supportedReasoningEfforts"];
  defaultReasoningEffort?: string | null;
};

export function buildProviderExecutionTarget(
  current: ExecutionTarget | null | undefined,
  providerId: ProviderId,
  providerProfileId: string,
  modelCatalogEntryId: string,
  providerProfileNameSnapshot?: string,
  providerProfileSource?: "disk" | "managed",
  normalizeProviderProfile = true,
  runtimeModel?: string,
  /**
   * @deprecated 兼容旧调用：仅当 modelMeta 未提供 default 时作为 fallback。
   * 新代码请走 modelMeta（含 supported + default + source）。
   */
  defaultReasoningEffort?: string | null,
  /** 目标模型 capability；Shared/Atomic 据此 seed/校验 reasoning effort。 */
  modelMeta?: BuildProviderExecutionTargetModelMeta | null,
): ExecutionTarget {
  const normalizedProviderProfileId = normalizeProviderProfile
    ? normalizeExecutionProviderProfileId(providerId, providerProfileId)
    : providerProfileId;
  const normalizedRuntimeModel = runtimeModel?.trim() || null;
  const sameProfile =
    current?.engine === providerId &&
    current.providerProfileId === normalizedProviderProfileId;
  const modelRef: ModelInfo = {
    id: modelCatalogEntryId,
    model: normalizedRuntimeModel ?? modelCatalogEntryId,
    label: modelCatalogEntryId,
    source: modelMeta?.source ?? undefined,
    supportedReasoningEfforts: modelMeta?.supportedReasoningEfforts,
    defaultReasoningEffort:
      modelMeta?.defaultReasoningEffort ??
      (defaultReasoningEffort?.trim() || null),
  };
  const nextEffort = resolveAtomicReasoningEffort({
    engine: providerId,
    model: modelRef,
    previousEffort: current?.reasoning?.effort ?? null,
    inherit: sameProfile,
  });
  return {
    engine: providerId,
    providerProfileId: normalizedProviderProfileId,
    modelCatalogEntryId,
    model: normalizedRuntimeModel,
    providerProfileNameSnapshot: providerProfileNameSnapshot?.trim() || null,
    providerProfileSource: providerProfileSource ?? null,
    reasoning: nextEffort ? { effort: nextEffort } : null,
  };
}
