/**
 * ModelSelect 展示解析纯函数层（标签 / 选中态 / 空选判定）。
 *
 * 从 ModelSelect.tsx 平移（openspec change refactor-composer-selector-layer
 * Phase 3）：代码零改动，仅归组。
 */
import {
  resolveModelMappingValue,
  type ModelMapping,
} from "../../../../../models/constants";
import type { ExecutionTarget } from "../../../../../shared-session/target/types";
import type { ModelInfo } from "../../types";

/**
 * Claude 列表行展示名：catalog runtime 优先于全局 localStorage mapping。
 * Shared 打开历史会话时 mapping 常滞后于 selectedNextTarget 渠道。
 */
export function resolveClaudeCatalogModelLabel(
  model: Pick<ModelInfo, "id" | "model" | "label" | "providerProfileId">,
  modelMapping: ModelMapping,
): string {
  const runtime = model.model?.trim() || "";
  const catalogId = model.id.trim();
  if (runtime) {
    if (model.providerProfileId?.trim() || runtime !== catalogId) {
      return runtime;
    }
  } else if (
    model.providerProfileId?.trim() &&
    model.label &&
    model.label.trim() !== catalogId
  ) {
    return model.label.trim();
  }

  const mappedName = resolveModelMappingValue(model.id, modelMapping);
  if (mappedName) {
    return mappedName;
  }

  const parentLabel = model.label?.trim() || "";
  if (parentLabel) {
    return parentLabel;
  }
  return catalogId || model.id;
}

export function resolveRuntimeModel(model: ModelInfo): string | undefined {
  return model.model?.trim() || model.id.trim() || undefined;
}

/**
 * Atomic 闭合态选中展示解析（Shared / create-session Atomic 共用）。
 *
 * catalog 命中时用 catalog 行做友好标签；未命中时用 executionTarget 快照合成展示行。
 * Atomic 路径 MUST NOT 依赖父层 activeEngine `models` 判定“是否已选”。
 */
export function resolveAtomicSelectedModelDisplay(
  executionTarget: ExecutionTarget | null | undefined,
  selectedModelValue: string,
  catalogModels: readonly ModelInfo[] | null | undefined,
): ModelInfo | null {
  if (!executionTarget) {
    return null;
  }
  const catalogEntryId =
    executionTarget.modelCatalogEntryId?.trim() || selectedModelValue.trim();
  const runtimeModel = executionTarget.model?.trim() || "";
  if (!catalogEntryId && !runtimeModel) {
    return null;
  }

  const matchedCatalog =
    catalogModels?.find((model) => {
      if (catalogEntryId && model.id === catalogEntryId) {
        return true;
      }
      if (selectedModelValue && model.id === selectedModelValue) {
        return true;
      }
      const catalogRuntime = resolveRuntimeModel(model);
      return Boolean(
        runtimeModel && catalogRuntime && catalogRuntime === runtimeModel,
      );
    }) ?? null;
  if (matchedCatalog) {
    return matchedCatalog;
  }

  const snapshotId = catalogEntryId || runtimeModel;
  return {
    id: snapshotId,
    model: runtimeModel || snapshotId,
    label: runtimeModel || snapshotId,
    providerProfileId: executionTarget.providerProfileId?.trim() || undefined,
    source: "provider-config",
  };
}

/**
 * Atomic 空选：有引擎、无 model identity。
 * 这是模板编辑器的合法未配齐态，不是 Composer 冷启 loading。
 */
export function isAtomicEmptyModelSelection(
  executionTarget: ExecutionTarget | null | undefined,
  selectedModelValue: string,
): boolean {
  if (!executionTarget?.engine) {
    return false;
  }
  return (
    !executionTarget.modelCatalogEntryId?.trim() &&
    !executionTarget.model?.trim() &&
    !selectedModelValue.trim()
  );
}

export function isSelectedExecutionModel(
  executionTarget: ExecutionTarget | null | undefined,
  model: ModelInfo,
): boolean {
  const selectedCatalogEntryId = executionTarget?.modelCatalogEntryId?.trim();
  if (selectedCatalogEntryId) {
    return selectedCatalogEntryId === model.id;
  }
  const selectedRuntimeModel = executionTarget?.model?.trim();
  return Boolean(
    selectedRuntimeModel && selectedRuntimeModel === resolveRuntimeModel(model),
  );
}
