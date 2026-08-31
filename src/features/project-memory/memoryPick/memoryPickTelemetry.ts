/**
 * Memory Pick 可观测埋点：结构化 emit + 可注入 sink。
 * Props 白名单禁止 query 全文与记忆正文。
 */

export type MemoryPickTelemetryEvent =
  | "memory_pick_retrieve"
  | "memory_pick_gate_shown"
  | "memory_pick_confirm"
  | "memory_pick_skip"
  | "memory_pick_dismiss"
  | "memory_pick_cancel"
  | "memory_pick_auto_confirm"
  | "memory_pick_inject"
  | "memory_pick_embed_index";

export type MemoryPickTelemetryPropValue = string | number | boolean | null;

export type MemoryPickTelemetryProps = Record<
  string,
  MemoryPickTelemetryPropValue
>;

/** 允许写入 sink 的 prop 键（禁正文 / 全文） */
export const MEMORY_PICK_TELEMETRY_ALLOWED_KEYS = new Set([
  "mode",
  "candidateCount",
  "selectedCount",
  "retrievalMode",
  "emptyReason",
  "providerStatus",
  "ms",
  "elapsedMs",
  "phase",
  "autoConfirmed",
  "injectedCount",
  "packChars",
  "cleanerStatus",
  "firstPick",
  "action",
  "scannedCount",
  "queryLength",
  "queryHash",
  "fallbackReason",
  "error",
  "reason",
  "count",
  "workspaceIdLength",
]);

/** 明确禁止的键（正文 / 原文） */
const FORBIDDEN_KEY_PATTERN =
  /^(query|queryText|text|body|detail|raw|content|pack|memory|title|summary)$/i;

export type MemoryPickTelemetrySink = (
  event: MemoryPickTelemetryEvent,
  props: MemoryPickTelemetryProps,
) => void;

let injectedSink: MemoryPickTelemetrySink | null = null;

export function setMemoryPickTelemetrySink(
  sink: MemoryPickTelemetrySink | null,
): void {
  injectedSink = sink;
}



/** 过滤 props：只保留白名单，剔除疑似正文键 */
export function sanitizeMemoryPickTelemetryProps(
  props: MemoryPickTelemetryProps,
): MemoryPickTelemetryProps {
  const out: MemoryPickTelemetryProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) continue;
    if (!MEMORY_PICK_TELEMETRY_ALLOWED_KEYS.has(key)) continue;
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      continue;
    }
    // 字符串过长视为疑似正文
    if (typeof value === "string" && value.length > 120) continue;
    out[key] = value;
  }
  return out;
}

function defaultSink(
  event: MemoryPickTelemetryEvent,
  props: MemoryPickTelemetryProps,
): void {
  // eslint-disable-next-line no-console -- structured diagnostics sink
  console.info("[memory-pick]", event, props);
}

export function emitMemoryPickTelemetry(
  event: MemoryPickTelemetryEvent,
  props: MemoryPickTelemetryProps = {},
): void {
  const safe = sanitizeMemoryPickTelemetryProps(props);
  try {
    if (injectedSink) {
      injectedSink(event, safe);
    } else {
      defaultSink(event, safe);
    }
  } catch {
    // sink 失败不得影响发送主路径
  }
}

/** 轻量 hash（非加密）：query 关联用，不落全文 */
export function hashQueryForTelemetry(query: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < query.length; i += 1) {
    hash ^= query.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
