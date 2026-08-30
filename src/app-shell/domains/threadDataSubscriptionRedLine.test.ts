// F5（fix-session-switch-jank-red-lines）：threads 全量 map 订阅红线 gate。
// ownership matrix 性能红线（docs/plans/app-shell-ownership-matrix.md §3.4 / §1
// settingsContext 行）：threadsByWorkspace / threadStatusById / threadItemsByThread /
// threadListLoadingByWorkspace 必须归属独立 threadDataContext，且不得经由被 left/right
// 无差别消费的 settingsContext 扩散。本 gate 把红线变成可执行断言。
import { describe, expect, it } from "vitest";
import {
  APP_SHELL_CONSUMER_DOMAIN_SELECTION,
  APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS,
} from "./appShellDomainContexts";

export const THREAD_FULL_MAP_KEYS = [
  "threadsByWorkspace",
  "threadStatusById",
  "threadItemsByThread",
  "threadListLoadingByWorkspace",
] as const;

describe("threads 全量 map 订阅红线", () => {
  it("threads 全量 map 归属 threadDataContext，settingsContext 不再持有", () => {
    for (const key of THREAD_FULL_MAP_KEYS) {
      expect(
        APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.settingsContext,
        `settingsContext 不应再持有 ${key}`,
      ).not.toContain(key);
      expect(
        APP_SHELL_DOMAIN_CONTEXT_OWNED_KEYS.threadDataContext,
        `threadDataContext 应持有 ${key}`,
      ).toContain(key);
    }
  });

  it("layoutNodesChrome 消费集不得选择 threadDataContext", () => {
    // chrome zone 无任何线程 map 消费者（useAppShellLayoutNodesSection chrome 分支
    // 只读 settings/layout/mode 等冷域）；线程 dispatch 不得重建 chrome bag。
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.layoutNodesChrome).not.toContain(
      "threadDataContext",
    );
  });

  it("sections/render 对 threadDataContext 的消费必须显式（记录在案）", () => {
    // 阶段 4a 语义：sections/render 是线程 map 的真实消费者（flows/radar/quickSwitcher/
    // settings workspace 管理），允许显式选择 threadDataContext；但该选择必须出现在
    // 本清单里，防止未来无差别回流。4b 深化收窄时按消费点逐一移出并更新本清单。
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.sections).toContain(
      "threadDataContext",
    );
    expect(APP_SHELL_CONSUMER_DOMAIN_SELECTION.render).toContain(
      "threadDataContext",
    );
  });
});
