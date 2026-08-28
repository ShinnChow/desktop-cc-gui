// rAF 掉帧监视器 + PerformanceObserver('longtask') 采集。
//
// rAF 掉帧检测是 macOS 打包版(WKWebView)里唯一稳定可用的掉帧信号:react-scan 在生产
// 构建下拿不到 per-render 计时,而 requestAnimationFrame 始终可用。掉帧瞬间把
// perfContextBridge 的上下文一并写进 renderer diagnostics,供"复制卡顿现场"导出。
//
// longtask 观测作为补充信号(直接对应 react-scan 面板里的 190ms JS-heavy 帧),但
// WebKit 对 longtask 支持较晚,不支持时静默降级、只依赖 rAF。
//
// appendRendererDiagnostic 不受 build-time PROD 门控,故本模块在打包版天然可用。

import {
  appendRendererDiagnostic,
  appendVolatileRendererDiagnostic,
} from "../rendererDiagnostics";
import { getRecentHotspotSummary } from "./hotspotTracker";
import { readPerfContext } from "./perfContextBridge";
import { getRecentReactScanRenderSummary } from "./reactScanRenderLog";

const WARN_FRAME_MS = 50; // 约掉 3 帧(60fps 下)
const SEVERE_FRAME_MS = 100; // 约掉 6 帧
const MIN_REPORT_INTERVAL_MS = 500; // 节流:相邻掉帧上报最短间隔,避免日志雪崩
const MAX_FRAME_DROP_REPORTS = 200; // 单次会话上报上限
const DURABLE_SEVERE_FRAME_REPORT_INTERVAL_MS = 60_000;
// F3（enhance-perf-diagnostics-evidence）：worst-K 持久环。volatile 环（200 条内存）
// 重启即失，severe 持久又受 1/min 节流 + diagnostics-owned 降级——最重现场可能留不下。
// top-10 内的新掉帧以 perf.frame-drop-worst 持久化（60s 节流），重启不丢。
const WORST_FRAME_DROPS_LIMIT = 10;
const WORST_FRAME_DROPS_PERSIST_INTERVAL_MS = 60_000;
// rAF 间隔超过该值视为挂起(睡眠/后台)恢复而非渲染掉帧:WKWebView 在页面不可见或系统
// 睡眠时会暂停 rAF,恢复后第一帧的 delta 等于整段停摆时长(实测可达几十分钟),曾把
// worstFrameMs 污染成无意义的天文数字。diagnosticsReport 统计时用同一阈值剔除历史脏数据。
export const SUSPEND_GAP_MS = 5000;

let rafHandle: number | null = null;
let lastFrameTime: number | null = null;
let lastReportAt = Number.NEGATIVE_INFINITY;
let lastDurableSevereReportAt = Number.NEGATIVE_INFINITY;
let frameDropReports = 0;
let longTaskObserver: PerformanceObserver | null = null;
let detachVisibilityListener: (() => void) | null = null;

type WorstFrameDropEntry = {
  deltaMs: number;
  at: number;
  hotspots: ReturnType<typeof getRecentHotspotSummary>;
};

let worstFrameDrops: WorstFrameDropEntry[] = [];
let lastWorstPersistAt = Number.NEGATIVE_INFINITY;

/**
 * top-10 内的新掉帧进环；进环且距上次持久 ≥60s 时以 perf.frame-drop-worst
 * 持久化降序全量列表。掉帧瞬间的 hotspot 归因随条目冻结（此后读到的聚合
 * 与该帧无关，必须当场捕获）。
 */
function noteWorstFrameDrop(deltaMs: number, at: number): void {
  const entry: WorstFrameDropEntry = {
    deltaMs: Math.round(deltaMs),
    // fix-diagnostics-forensics-hardening：epoch 毫秒（此前误用 performance.now
    // 相对值，落盘后无法对钟点）。
    at: Date.now(),
    hotspots: getRecentHotspotSummary(Math.min(3_000, deltaMs + 600)),
  };
  const insertAt = worstFrameDrops.findIndex(
    (candidate) => candidate.deltaMs < entry.deltaMs,
  );
  if (insertAt === -1) {
    if (worstFrameDrops.length >= WORST_FRAME_DROPS_LIMIT) {
      return;
    }
    worstFrameDrops.push(entry);
  } else {
    worstFrameDrops.splice(insertAt, 0, entry);
    if (worstFrameDrops.length > WORST_FRAME_DROPS_LIMIT) {
      worstFrameDrops.pop();
    }
  }
  if (at - lastWorstPersistAt >= WORST_FRAME_DROPS_PERSIST_INTERVAL_MS) {
    lastWorstPersistAt = at;
    appendRendererDiagnostic("perf.frame-drop-worst", {
      // hotspots 扁平化为字符串数组（depth 3）：嵌套对象在第 4 层会被
      // MAX_DIAGNOSTIC_PAYLOAD_DEPTH 截成 "[truncated]"，磁盘版归因全丢。
      entries: worstFrameDrops.map((worst) => ({
        deltaMs: worst.deltaMs,
        at: worst.at,
        hotspots: worst.hotspots.map(
          (row) =>
            `${row.category}=${row.totalMs}ms(max ${row.maxMs}${row.maxDetail ? ` ${row.maxDetail}` : ""})x${row.count}`,
        ),
      })),
    });
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// 交互标签只在"交互发生在这帧(或紧邻其前)"时才有归因意义。perfContextBridge 记录的
// 是"最近一次"交互且永不过期,曾把 35 秒前的 pointerdown 标到 idle 渲染风暴的帧上,
// 让报告把 82% 的 idle 掉帧误读成"指针触发"。超时的标签置空并标记 interactionStale。
function readAttributableContext(windowMs: number) {
  const ctx = readPerfContext();
  const staleThresholdMs = Math.max(250, windowMs);
  if (
    ctx.lastInteractionAgoMs === null ||
    ctx.lastInteractionAgoMs <= staleThresholdMs
  ) {
    return ctx;
  }
  return { ...ctx, lastInteractionLabel: null, interactionStale: true };
}

function isDevBuild(): boolean {
  const env = (import.meta.env ?? {}) as { DEV?: boolean; MODE?: string };
  return env.DEV === true && env.MODE !== "test";
}

function hasDiagnosticsOwnedHotspot(
  hotspots: ReturnType<typeof getRecentHotspotSummary>,
): boolean {
  return hotspots.some(
    (row) =>
      row.category === "diagnostics-persist" ||
      row.category === "diagnostics-export" ||
      row.category === "perf-jank-live-collect" ||
      (row.category === "client-store-write" &&
        row.maxDetail?.startsWith("diagnostics:") === true),
  );
}

function reportFrameDrop(deltaMs: number): void {
  const at = nowMs();
  if (at - lastReportAt < MIN_REPORT_INTERVAL_MS) {
    return;
  }
  if (frameDropReports >= MAX_FRAME_DROP_REPORTS) {
    return;
  }
  lastReportAt = at;
  frameDropReports += 1;
  const context = readAttributableContext(deltaMs);
  // 掉帧前一小段时间里主线程被哪些热路径占用(WKWebView 无 longtask 的替代归因)。
  // 窗口取掉帧时长 + 600ms:既覆盖掉帧帧本身,也覆盖紧邻其前的铺垫工作。
  const hotspots = getRecentHotspotSummary(Math.min(3_000, deltaMs + 600));
  const payload = {
    deltaMs: Math.round(deltaMs),
    approxFps: Math.max(1, Math.round(1000 / deltaMs)),
    level: deltaMs >= SEVERE_FRAME_MS ? "severe" : "warn",
    ...context,
    topRenders: getRecentReactScanRenderSummary(600),
    hotspots,
  };
  const shouldPersistSevereFrame =
    deltaMs >= SEVERE_FRAME_MS &&
    at - lastDurableSevereReportAt >= DURABLE_SEVERE_FRAME_REPORT_INTERVAL_MS &&
    !hasDiagnosticsOwnedHotspot(hotspots);
  if (shouldPersistSevereFrame) {
    lastDurableSevereReportAt = at;
    appendRendererDiagnostic("perf.frame-drop", payload);
  } else {
    appendVolatileRendererDiagnostic("perf.frame-drop", payload);
  }
  // dev 下把严重掉帧直接打进 console,便于复现时从 DevTools 一键复制现场。
  if (
    isDevBuild() &&
    deltaMs >= SEVERE_FRAME_MS &&
    typeof console !== "undefined"
  ) {
    const hotspotText = hotspots
      .map(
        (row) =>
          `${row.category}=${row.totalMs}ms(max ${row.maxMs}${row.maxDetail ? ` ${row.maxDetail}` : ""})×${row.count}`,
      )
      .join(" ");
    console.warn(
      `[perf.frame-drop] ${Math.round(deltaMs)}ms (~${Math.max(1, Math.round(1000 / deltaMs))}fps)` +
        ` streaming=${context.isStreaming ? (context.streamActivityPhase ?? "yes") : "no"}` +
        (context.lastInteractionLabel
          ? ` interaction=${context.lastInteractionLabel}@${context.lastInteractionAgoMs}ms`
          : "") +
        (hotspotText ? ` hotspots: ${hotspotText}` : " hotspots: (none ≥1ms)"),
    );
  }
}

/** 启动 rAF 掉帧监视循环。幂等。 */
export function startFrameDropMonitor(): void {
  if (
    rafHandle !== null ||
    typeof window === "undefined" ||
    typeof window.requestAnimationFrame !== "function"
  ) {
    return;
  }
  lastFrameTime = null;
  const tick = () => {
    const now = nowMs();
    if (lastFrameTime !== null) {
      const delta = now - lastFrameTime;
      if (delta >= SUSPEND_GAP_MS) {
        // 挂起恢复:单独记一条以解释日志时间轴断层,不计入掉帧。
        appendRendererDiagnostic("perf.suspend-gap", {
          gapMs: Math.round(delta),
          ...readPerfContext(),
        });
      } else if (delta >= WARN_FRAME_MS) {
        noteWorstFrameDrop(delta, now);
        reportFrameDrop(delta);
      }
    }
    lastFrameTime = now;
    rafHandle = window.requestAnimationFrame(tick);
  };
  rafHandle = window.requestAnimationFrame(tick);
  if (typeof document !== "undefined") {
    // 页面隐藏的瞬间丢弃计时起点:短暂切后台(< SUSPEND_GAP_MS)恢复后的第一帧
    // 不会被算成一次掉帧;睡眠等不触发 visibilitychange 的挂起由 SUSPEND_GAP_MS 兜底。
    const onVisibilityChange = () => {
      if (document.hidden) {
        lastFrameTime = null;
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    detachVisibilityListener = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }
}

/** 停止 rAF 掉帧监视循环。幂等。 */
export function stopFrameDropMonitor(): void {
  if (rafHandle !== null && typeof window !== "undefined") {
    window.cancelAnimationFrame(rafHandle);
  }
  rafHandle = null;
  lastFrameTime = null;
  detachVisibilityListener?.();
  detachVisibilityListener = null;
}

/** 本平台 PerformanceObserver 是否支持 longtask(WebKit 不支持);供报告标注口径。 */
export function isLongTaskObservable(): boolean {
  if (typeof PerformanceObserver === "undefined") {
    return false;
  }
  const supportedEntryTypes = (
    PerformanceObserver as typeof PerformanceObserver & {
      supportedEntryTypes?: readonly string[];
    }
  ).supportedEntryTypes;
  return supportedEntryTypes?.includes("longtask") === true;
}

/** 启动 longtask 观测;不支持时记录一次并降级依赖 rAF。幂等。 */
export function startLongTaskObserver(): void {
  if (longTaskObserver !== null) {
    return;
  }
  if (typeof PerformanceObserver === "undefined") {
    appendRendererDiagnostic("perf.longtask/unsupported", {
      reason: "no-PerformanceObserver",
    });
    return;
  }
  const supportedEntryTypes = (
    PerformanceObserver as typeof PerformanceObserver & {
      supportedEntryTypes?: readonly string[];
    }
  ).supportedEntryTypes;
  if (!supportedEntryTypes?.includes("longtask")) {
    appendRendererDiagnostic("perf.longtask/unsupported", {
      reason: "entryType-unavailable",
    });
    return;
  }
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        appendRendererDiagnostic("perf.longtask", {
          durationMs: Math.round(entry.duration),
          startTime: Math.round(entry.startTime),
          name: entry.name,
          ...readAttributableContext(entry.duration),
        });
      }
    });
    longTaskObserver.observe({ type: "longtask", buffered: true });
  } catch (error) {
    longTaskObserver = null;
    appendRendererDiagnostic("perf.longtask/install-failed", {
      error: String(error),
    });
  }
}

/** 停止 longtask 观测。幂等。 */
export function stopLongTaskObserver(): void {
  longTaskObserver?.disconnect();
  longTaskObserver = null;
}

export function __resetFrameDropMonitorForTests(): void {
  stopFrameDropMonitor();
  stopLongTaskObserver();
  lastReportAt = Number.NEGATIVE_INFINITY;
  lastDurableSevereReportAt = Number.NEGATIVE_INFINITY;
  lastWorstPersistAt = Number.NEGATIVE_INFINITY;
  worstFrameDrops = [];
  frameDropReports = 0;
}
