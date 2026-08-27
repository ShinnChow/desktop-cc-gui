/**
 * 分组子菜单的统一投影:legacy(modelGroups)与 atomic(targetGroups)
 * 共用同一套「引擎子菜单 → 平铺模型」渲染,差异只在选择/刷新行为。
 *
 * 从 ModelSelect.tsx 平移（openspec change refactor-composer-selector-layer
 * Phase 3）：代码零改动，仅归组；PickerModelGroup 原为私有 type，
 * 迁移后导出（ModelSelect 主体与后续复用方需要）。
 */
import {
  formatDshModelDisplayLabel,
  groupDshModelsByVendor,
  isSlashCatalogEngine,
} from "../dshModelDisplayLabel";
import type { ModelInfo, ProviderId } from "../../types";

export type PickerProfileOption = {
  id: string;
  label: string;
  source: "disk" | "managed";
  models: ModelInfo[];
  loading: boolean;
  reloading: boolean;
  error: string | null;
};

export type PickerModelGroup = {
  providerId: ProviderId;
  providerLabel: string;
  models: ModelInfo[];
  enabled: boolean;
  disabledReason?: string;
  loading: boolean;
  reloading: boolean;
  error: string | null;
  targetProfileId: string | null;
  targetProfileLabel?: string;
  targetProfileSource?: "disk" | "managed";
  /** Atomic 目标组的全部渠道,用于子菜单底栏渠道选择弹窗 */
  profiles: PickerProfileOption[];
};

export type PickerModelRow =
  | { kind: "heading"; key: string; sectionKey: string; label: string }
  | { kind: "model"; key: string; model: ModelInfo; disambiguate?: boolean };

export function pickerRowsForGroup(group: PickerModelGroup): PickerModelRow[] {
  if (!isSlashCatalogEngine(group.providerId)) {
    return group.models.map((model) => ({
      kind: "model" as const,
      key: `${group.providerId}:${model.id}`,
      model,
    }));
  }

  return groupDshModelsByVendor(group.models).flatMap((section) => {
    // PI 自定义供应商常把多个上游路由进同一 provider（cpa/cline/x 与
    // cpa/fb2api/x），last-segment 相同的行需保留中段路径才能区分。
    const labelCounts = new Map<string, number>();
    for (const model of section.models) {
      const label = formatDshModelDisplayLabel(model);
      labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    }
    return [
      {
        kind: "heading" as const,
        key: `${group.providerId}-vendor:${section.key}`,
        sectionKey: section.key,
        label: section.label,
      },
      ...section.models.map((model) => ({
        kind: "model" as const,
        key: `${group.providerId}:${section.key}:${model.id}`,
        model,
        disambiguate:
          (labelCounts.get(formatDshModelDisplayLabel(model)) ?? 0) > 1,
      })),
    ];
  });
}
