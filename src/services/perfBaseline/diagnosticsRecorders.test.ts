// F3/F5（enhance-perf-diagnostics-evidence）：worst-K 掉帧持久环 + hotspot 周期汇总。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rendererDiagnosticsMocks = vi.hoisted(() => ({
  appendRendererDiagnostic: vi.fn(),
  appendVolatileRendererDiagnostic: vi.fn(),
}));

vi.mock("../rendererDiagnostics", () => {
  return {
    appendRendererDiagnostic: rendererDiagnosticsMocks.appendRendererDiagnostic,
    appendVolatileRendererDiagnostic:
      rendererDiagnosticsMocks.appendVolatileRendererDiagnostic,
  };
});

import {
  __resetHotspotTrackerForTests,
  recordHotspotSample,
} from "./hotspotTracker";
import {
  __resetFrameDropMonitorForTests,
  startFrameDropMonitor,
  stopFrameDropMonitor,
} from "./frameDropMonitor";
import {
  __resetHotspotSummaryRecorderForTests,
  startHotspotSummaryRecorder,
  stopHotspotSummaryRecorder,
} from "./hotspotSummaryRecorder";

type RafCallback = (now: number) => void;

describe("worst-K 掉帧持久环（perf.frame-drop-worst）", () => {
  let rafCallbacks: RafCallback[];
  let nowMs: number;

  beforeEach(() => {
    vi.clearAllMocks();
    rafCallbacks = [];
    nowMs = 0;
    vi.spyOn(performance, "now").mockImplementation(() => nowMs);
    // jsdom 的 rAF 只读且不可重定义：整窗替换（对齐 rendererDiagnostics.test 模式）
    vi.stubGlobal("window", {
      requestAnimationFrame: (callback: RafCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      },
      cancelAnimationFrame: () => {},
    });
    vi.stubGlobal("document", {
      hidden: false,
      visibilityState: "visible",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    __resetFrameDropMonitorForTests();
    startFrameDropMonitor();
  });

  afterEach(() => {
    stopFrameDropMonitor();
    __resetFrameDropMonitorForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function tickTo(nextMs: number): void {
    nowMs = nextMs;
    const pending = rafCallbacks;
    rafCallbacks = [];
    for (const callback of pending) {
      callback(nowMs);
    }
  }

  it("top-10 内的新掉帧触发持久（降序、60s 节流）", () => {
    // 首帧建立计时起点
    tickTo(0);
    // +200ms → 200ms 掉帧（进环 → 立即持久一次）
    tickTo(200);
    console.log(
      "DEBUG durable calls:",
      rendererDiagnosticsMocks.appendRendererDiagnostic.mock.calls.map(
        (c) => c[0],
      ),
    );
    expect(
      rendererDiagnosticsMocks.appendRendererDiagnostic,
    ).toHaveBeenCalledWith(
      "perf.frame-drop-worst",
      expect.objectContaining({
        entries: [expect.objectContaining({ deltaMs: 200 })],
      }),
    );

    // +600ms（相对 200）→ 600ms 掉帧（进环 top1，但 60s 节流窗内不重复持久）
    rendererDiagnosticsMocks.appendRendererDiagnostic.mockClear();
    tickTo(800);
    expect(
      rendererDiagnosticsMocks.appendRendererDiagnostic,
    ).not.toHaveBeenCalledWith(
      "perf.frame-drop-worst",
      expect.objectContaining({ entries: expect.anything() }),
    );

    // 推进到 60s 节流窗外再掉一帧 → 以更新后的降序 top 列表持久
    tickTo(61_000);
    rendererDiagnosticsMocks.appendRendererDiagnostic.mockClear();
    tickTo(61_050);
    const worstCall =
      rendererDiagnosticsMocks.appendRendererDiagnostic.mock.calls.find(
        ([label]) => label === "perf.frame-drop-worst",
      );
    expect(worstCall).toBeTruthy();
    const entries = (worstCall?.[1] as { entries: Array<{ deltaMs: number }> })
      .entries;
    expect(entries[0]?.deltaMs).toBe(600);
    expect(entries).toEqual([...entries].sort((a, b) => b.deltaMs - a.deltaMs));
    expect(entries.length).toBeLessThanOrEqual(10);
  });

  it("top-10 外的小掉帧不触发持久", () => {
    tickTo(0);
    // 用 10 次 300ms 掉帧填满环（每次 tick 间隔 300ms → delta 恒为 300；
    // 首次进环持久一次，60s 节流内不重复）
    for (let index = 0; index < 10; index += 1) {
      tickTo(200 + (index + 1) * 300);
    }
    // 推进节流窗外，确认填满后没有额外持久
    tickTo(61_500);
    rendererDiagnosticsMocks.appendRendererDiagnostic.mockClear();
    // 环已满且都更差：55ms 小掉帧不进环 → 不持久
    for (let index = 0; index < 8; index += 1) {
      tickTo(61_500 + (index + 1) * 55);
    }
    expect(
      rendererDiagnosticsMocks.appendRendererDiagnostic.mock.calls.filter(
        ([label]) => label === "perf.frame-drop-worst",
      ),
    ).toHaveLength(0);
  });
});

describe("hotspot 周期汇总（perf.hotspot-summary）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.useFakeTimers({
      toFake: ["setTimeout", "setInterval", "clearInterval", "Date"],
    });
    __resetHotspotTrackerForTests();
    __resetFrameDropMonitorForTests();
    __resetHotspotSummaryRecorderForTests();
  });

  afterEach(() => {
    stopHotspotSummaryRecorder();
    __resetHotspotSummaryRecorderForTests();
    vi.useRealTimers();
  });

  it("有样本时 60s 落一条 top 类别聚合", () => {
    recordHotspotSample("react-commit", 120, "70 update");
    recordHotspotSample("client-store-write", 40, "threads:sidebarSnapshot");
    startHotspotSummaryRecorder();

    vi.advanceTimersByTime(60_000);

    expect(
      rendererDiagnosticsMocks.appendRendererDiagnostic,
    ).toHaveBeenCalledWith(
      "perf.hotspot-summary",
      expect.objectContaining({
        windowMs: 60_000,
        categories: expect.arrayContaining([
          expect.objectContaining({
            category: "react-commit",
            totalMs: expect.any(Number),
            maxDetail: "70 update",
          }),
          expect.objectContaining({ category: "client-store-write" }),
        ]),
      }),
    );
  });

  it("空窗口不写；周期持续采样", () => {
    startHotspotSummaryRecorder();
    vi.advanceTimersByTime(120_000);
    expect(
      rendererDiagnosticsMocks.appendRendererDiagnostic.mock.calls.filter(
        ([label]) => label === "perf.hotspot-summary",
      ),
    ).toHaveLength(0);

    recordHotspotSample("react-commit", 80);
    vi.advanceTimersByTime(60_000);
    expect(
      rendererDiagnosticsMocks.appendRendererDiagnostic.mock.calls.filter(
        ([label]) => label === "perf.hotspot-summary",
      ),
    ).toHaveLength(1);
  });

  it("start 幂等", () => {
    startHotspotSummaryRecorder();
    startHotspotSummaryRecorder();
    recordHotspotSample("react-commit", 80);
    vi.advanceTimersByTime(60_000);
    expect(
      rendererDiagnosticsMocks.appendRendererDiagnostic.mock.calls.filter(
        ([label]) => label === "perf.hotspot-summary",
      ),
    ).toHaveLength(1);
  });
});
