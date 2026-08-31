// 引擎检测跨模块单飞协调器（refactor-engine-detection-pipeline B5/D5）。
//
// 现状问题：CatalogHost mount、首启向导（useFirstRunSetup）、project-map
// 面板（useProjectMapGenerationOptions）各自裸调 detectEngines()，单飞只在
// useEngineController 内部 → 启动期可叠加 2~3 轮全量探测。本模块把「谁发起
// 检测」收敛到唯一入口：在途请求直接复用（fire-and-forget 的调用方也拿到
// 同一个 promise，事件 merge 由 controller 统一处理）。
//
// 注意：只收敛「请求发起」，状态仍由 CatalogHost 的 useEngineController
// 持有（单实例 owner 不变）；逐引擎事件由 controller 订阅 merge（B4）。

import {
  detectEngines,
} from "../../../services/tauri/appServer";
import type { EngineStatus, EngineType } from "../../../types";

export type EngineDetectionRequestOptions = {
  force?: boolean;
  engines?: EngineType[];
};

export type EngineDetectionRequest = EngineDetectionRequestOptions & {
  /** 测试与诊断用：标注发起方（controller / onboarding / project-map / menu）。 */
  source: string;
};

let inflight: {
  key: string;
  promise: Promise<EngineStatus[]>;
} | null = null;

function requestKey(options: EngineDetectionRequestOptions): string {
  const engines = options.engines
    ? [...options.engines].sort().join(",")
    : "all";
  return `${engines}:${options.force ? "force" : "cached"}`;
}

/**
 * 全局单飞入口。同 key 的在途请求直接复用；不同 key（如 per-engine 强刷）
 * 不复用（语义不同），但也共享后端 TTL 缓存。
 */
export function requestEngineDetection(
  options: EngineDetectionRequest,
): Promise<EngineStatus[]> {
  const key = requestKey(options);
  if (inflight && inflight.key === key) {
    return inflight.promise;
  }
  const promise = detectEngines({
    force: options.force,
    engines: options.engines,
  });

  inflight = { key, promise };
  void promise
    .catch(() => {})
    .finally(() => {
      if (inflight?.promise === promise) {
        inflight = null;
      }
    });
  return promise;
}

/** 仅供测试：清空在途请求。 */



