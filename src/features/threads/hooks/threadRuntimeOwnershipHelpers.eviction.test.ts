import { describe, expect, it } from "vitest";
import {
  selectEvictableThreadIds,
  THREAD_ITEM_CACHE_RECENT_PROTECT_MAX,
} from "./threadRuntimeOwnershipHelpers";

// perf-cold-start-click-storm-convergence F3：驱逐候选选择纯函数。
// 在既有 activity LRU + protected（active/in-flight/pinned）之上叠加
// 「近期切换保护集」（10 分钟窗口、硬上限 8）。

const WINDOW = 10 * 60 * 1000;
const NOW = 1_000_000;

type Scenario = {
  loaded: string[];
  cacheMax: number;
  protectedIds?: string[];
  recent?: Record<string, number>;
  items?: Record<string, number>;
  activity?: Record<string, number>;
};

function run(scenario: Scenario, overrides?: { recentProtectMax?: number }) {
  return selectEvictableThreadIds({
    loadedThreadIds: scenario.loaded,
    cacheMax: scenario.cacheMax,
    protectedThreadIds: new Set(scenario.protectedIds ?? []),
    recentSwitches: new Map(Object.entries(scenario.recent ?? {})),
    nowMs: NOW,
    itemCount: (threadId) => scenario.items?.[threadId] ?? 1,
    activityAt: (threadId) => scenario.activity?.[threadId] ?? 0,
    ...overrides,
  });
}

function linearScenario(): Scenario {
  // t0..t14 已加载，activity 递增；t0 为 active（protected）。
  const loaded = Array.from({ length: 15 }, (_, index) => `t${index}`);
  const activity: Record<string, number> = {};
  loaded.forEach((threadId, index) => {
    activity[threadId] = 1000 + index;
  });
  return {
    loaded,
    cacheMax: 12,
    protectedIds: ["t0"],
    activity,
  };
}

describe("selectEvictableThreadIds", () => {
  it("matches legacy LRU eviction when the recent set is empty", () => {
    // protected=1 → slots=11；candidates=t1..t14 → 驱逐最旧的 3 条。
    expect(new Set(run(linearScenario()))).toEqual(
      new Set(["t1", "t2", "t3"]),
    );
  });

  it("never evicts threads with zero items", () => {
    const scenario = linearScenario();
    scenario.items = { t1: 0, t2: 0 };
    const evicted = new Set(run(scenario));
    expect(evicted.has("t1")).toBe(false);
    expect(evicted.has("t2")).toBe(false);
  });

  it("protects a recently switched thread from eviction", () => {
    const scenario = linearScenario();
    // t1 是最旧的 evictable，但 1 分钟前刚被切换过 → 不得驱逐。
    scenario.recent = { t1: NOW - 60_000 };
    const evicted = new Set(run(scenario));
    expect(evicted.has("t1")).toBe(false);
    // slots 同步收紧：仍驱逐 3 条，由后续最旧的补位。
    expect(evicted).toEqual(new Set(["t2", "t3", "t4"]));
  });

  it("expires recent protection after the window", () => {
    const scenario = linearScenario();
    scenario.recent = { t1: NOW - WINDOW - 1 };
    const evicted = new Set(run(scenario));
    expect(evicted.has("t1")).toBe(true);
  });

  it("caps the recent protection set by activity LRU", () => {
    const scenario = linearScenario();
    // t5..t14 十条都在窗口内切换过 → 只有 activity 最新的 8 条受保护，
    // t5/t6 溢出回 evictable；slots = 12 - 1(protected) - 8 = 3。
    const recent: Record<string, number> = {};
    for (let index = 5; index <= 14; index += 1) {
      recent[`t${index}`] = NOW - 1000 * index;
    }
    scenario.recent = recent;
    const evicted = new Set(run(scenario));
    expect(evicted.has("t7")).toBe(false);
    expect(evicted.has("t14")).toBe(false);
    expect(evicted).toEqual(new Set(["t1", "t2", "t3"]));
  });

  it("counts protected threads outside the recent cap", () => {
    const scenario = linearScenario();
    // t0 既是 active（protected）也在 recent 里：不占 recent 名额。
    scenario.recent = { t0: NOW - 1000 };
    const evicted = new Set(run(scenario));
    expect(evicted).toEqual(new Set(["t1", "t2", "t3"]));
  });

  it("respects an explicit recentProtectMax override", () => {
    const scenario = linearScenario();
    scenario.recent = { t1: NOW - 60_000, t2: NOW - 60_001 };
    const evicted = new Set(run(scenario, { recentProtectMax: 1 }));
    // 只有 activity 最新的 t2 受保护；t1 溢出回 evictable。
    expect(evicted.has("t2")).toBe(false);
    expect(evicted.has("t1")).toBe(true);
    expect(THREAD_ITEM_CACHE_RECENT_PROTECT_MAX).toBe(8);
  });
});
