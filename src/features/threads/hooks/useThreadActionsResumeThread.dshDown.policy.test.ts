import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// perf-cold-start-click-storm-convergence F4 接线锁定：
// 历史 loader 的两条 catch 路径（shared 分支 + 通用分支）都必须先识别
// dsh 宿主熔断 Down（结构化 `dsh host.down`），命中即单条状态事件早退，
// 不得落入 loader error 记账或 legacy fallback 重试。
// 跨文件断言：useThreadActionsResumeThread 允许拆分为同前缀兄弟文件，
// 合并其源码后断言，行为锁不绑死单文件布局。
const dir = new URL("./", import.meta.url);
const source = readdirSync(dir)
  .filter(
    (name) =>
      name === "useThreadActionsResumeThread.ts" ||
      (name.startsWith("useThreadActionsResumeThread.") && name.endsWith(".ts")),
  )
  .map((name) => readFileSync(new URL(name, dir), "utf8"))
  .join("\n");

describe("dsh host down fast-fail wiring", () => {
  it("classifies down signals in both history catch paths", () => {
    expect(
      source.match(/parseDshHostDownError\(error\)/g)?.length,
    ).toBe(2);
  });

  it("emits a single down status event instead of loader-error spam", () => {
    expect(source).toContain('label: "thread/dsh host down"');
    expect(source).toContain("reason: downSignal.reason");
    expect(source).toContain("retryAfterMs: downSignal.retryAfterMs");
  });

  it("imports the parser from the vendors dsh status util", () => {
    expect(source).toContain("parseDshHostDownError");
    expect(
      source.match(/from\s+"\.\.\/\.\.\/vendors\/utils\/dshHostStatus"/g)
        ?.length,
    ).toBeGreaterThan(0);
  });
});
