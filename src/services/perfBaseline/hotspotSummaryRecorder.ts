// F5（enhance-perf-diagnostics-evidence）：hotspot 周期汇总落盘。
//
// 背景：hotspot 聚合此前只在掉帧瞬间附着到 frame-drop payload——60s 级背景占用
// （定时轮询引发的 commit 等）若某拍 <100ms 或被节流，对应证据就永久丢失。
// 本模块按 60s 周期把近 60s 窗口的 top 类别聚合持久化为 perf.hotspot-summary，
// 背景税从此有独立时间序列证据。窗口内无样本不写，常态零写盘。

import { appendRendererDiagnostic } from "../rendererDiagnostics";
import {
  getRecentHotspotSummary,
  type HotspotSummaryRow,
} from "./hotspotTracker";
import { readPerfContext } from "./perfContextBridge";

const HOTSPOT_SUMMARY_INTERVAL_MS = 60_000;
const HOTSPOT_SUMMARY_WINDOW_MS = 60_000;
const HOTSPOT_SUMMARY_MAX_CATEGORIES = 8;
const MAX_SUMMARY_DETAIL_LENGTH = 80;

let summaryTimer: ReturnType<typeof setInterval> | null = null;

function summarizeRow(row: HotspotSummaryRow) {
  return {
    category: row.category,
    totalMs: row.totalMs,
    maxMs: row.maxMs,
    maxDetail: row.maxDetail
      ? row.maxDetail.slice(0, MAX_SUMMARY_DETAIL_LENGTH)
      : null,
    count: row.count,
  };
}

function recordHotspotSummary(): void {
  const categories = getRecentHotspotSummary(HOTSPOT_SUMMARY_WINDOW_MS)
    .slice(0, HOTSPOT_SUMMARY_MAX_CATEGORIES)
    .map(summarizeRow);
  if (categories.length === 0) {
    return;
  }
  let isStreaming = false;
  let visibilityState: string | null = null;
  try {
    isStreaming = readPerfContext().isStreaming === true;
  } catch {
    // perfContext 未就绪时降级为未知
  }
  if (typeof document !== "undefined") {
    visibilityState = document.visibilityState;
  }
  appendRendererDiagnostic("perf.hotspot-summary", {
    windowMs: HOTSPOT_SUMMARY_WINDOW_MS,
    categories,
    isStreaming,
    visibilityState,
  });
}

/** 启动 hotspot 周期汇总。幂等。 */
export function startHotspotSummaryRecorder(): void {
  if (summaryTimer !== null || typeof setInterval !== "function") {
    return;
  }
  summaryTimer = setInterval(recordHotspotSummary, HOTSPOT_SUMMARY_INTERVAL_MS);
}

/** 停止 hotspot 周期汇总。幂等。 */
export function stopHotspotSummaryRecorder(): void {
  if (summaryTimer !== null) {
    clearInterval(summaryTimer);
    summaryTimer = null;
  }
}

/** 测试专用。 */
export function __resetHotspotSummaryRecorderForTests(): void {
  stopHotspotSummaryRecorder();
}
