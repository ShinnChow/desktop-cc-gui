// 引擎可用性投影（refactor-engine-detection-pipeline B7/D7）：composer 侧经
// app-shell host bus **字段级订阅** catalog.availableEngines，把检测快照的
// availabilityState 投影为四级 picker 分组的同源状态——新建会话菜单与模型
// 下拉从此看同一本账。低频事件驱动，不新增根链订阅面（Render Perf Baseline）。

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useHostFieldsSafe } from "../../../../../app-shell/hosts/appShellHostBus";
import type { EngineType } from "../../../../../types";

export type EngineAvailabilityUiState =
  | "detecting"
  | "ready"
  | "requires-login"
  | "unavailable"
  | "failed";

export type EngineAvailabilityProjection = {
  stateByEngine: Readonly<Partial<Record<EngineType, EngineAvailabilityUiState>>>;
  /** 分组 disabledReason / 标注文案（已翻译）。 */
  reasonByEngine: Readonly<Partial<Record<EngineType, string>>>;
};

/**
 * catalog slice 中不在投影里的引擎（用户停用 / host 未挂载）不产状态：
 * 消费方按「ready + 既有可见性过滤」处理，避免首帧闪禁与越权拦截。
 */
export function useEngineAvailabilityProjection(): EngineAvailabilityProjection {
  const { t } = useTranslation();
  const { availableEngines } = useHostFieldsSafe("catalog", [
    "availableEngines",
  ] as const);

  return useMemo(() => {
    const stateByEngine: Partial<Record<EngineType, EngineAvailabilityUiState>> =
      {};
    const reasonByEngine: Partial<Record<EngineType, string>> = {};
    const options = (availableEngines ?? []) as ReadonlyArray<{
      type: EngineType;
      availabilityState?: string;
      availabilityLabelKey?: string | null;
    }>;
    for (const engine of options) {
      switch (engine.availabilityState) {
        case "loading":
          stateByEngine[engine.type] = "detecting";
          reasonByEngine[engine.type] = t("workspace.engineStatusLoading");
          break;
        case "failed":
          stateByEngine[engine.type] = "failed";
          reasonByEngine[engine.type] = t("workspace.engineStatusFailed");
          break;
        case "requires-login":
          stateByEngine[engine.type] = "requires-login";
          reasonByEngine[engine.type] = t("workspace.engineStatusRequiresLogin");
          break;
        case "unavailable":
          stateByEngine[engine.type] = "unavailable";
          reasonByEngine[engine.type] = t("sidebar.cliNotInstalled");
          break;
        default:
          stateByEngine[engine.type] = "ready";
          break;
      }
    }
    return { stateByEngine, reasonByEngine };
  }, [availableEngines, t]);
}
