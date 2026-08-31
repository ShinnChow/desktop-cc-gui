import type { IntentCanvasContextSendAttachment } from "../../../types";

export type IntentCanvasContextCount = {
  total: number;
  sent: number;
  omitted: number;
};

export type IntentCanvasContextSummary = IntentCanvasContextSendAttachment;

const INTENT_CANVAS_CONTEXT_START = "请把下面的 Intent Canvas 当作本轮对话的结构化上下文。";
const COMPACT_PAYLOAD_MARKER = "Structured transmission payload compact JSON:";
const LEGACY_PAYLOAD_MARKER = "Structured semantic payload:";
const FENCED_JSON_REGEX = /```json\s*([\s\S]*?)```/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asFiniteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function normalizeCount(value: unknown): IntentCanvasContextCount {
  const record = asRecord(value);
  return {
    total: asFiniteCount(record?.total),
    sent: asFiniteCount(record?.sent),
    omitted: asFiniteCount(record?.omitted),
  };
}

function findNextPayloadMarker(text: string, fromIndex: number) {
  const compactIndex = text.indexOf(COMPACT_PAYLOAD_MARKER, fromIndex);
  const legacyIndex = text.indexOf(LEGACY_PAYLOAD_MARKER, fromIndex);
  if (compactIndex < 0 && legacyIndex < 0) {
    return null;
  }
  if (compactIndex >= 0 && (legacyIndex < 0 || compactIndex < legacyIndex)) {
    return {
      payloadStart: compactIndex + COMPACT_PAYLOAD_MARKER.length,
    };
  }
  return {
    payloadStart: legacyIndex + LEGACY_PAYLOAD_MARKER.length,
  };
}

function parseIntentCanvasPayload(
  rawPayload: string,
  attachmentIndex: number,
): IntentCanvasContextSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    return null;
  }
  const payload = asRecord(parsed);
  if (payload?.type !== "intent_canvas_context") {
    return null;
  }
  const completeness = asRecord(payload.completeness);
  const canvasId = asString(payload.canvasId, "unknown");
  return {
    kind: "intent_canvas_context",
    attachmentId: `intent-canvas-inline-${canvasId}-${attachmentIndex}`,
    canvasId,
    title: asString(payload.title, "Intent Canvas"),
    mode: asString(payload.mode, "unknown"),
    compressionMode: asString(completeness?.compressionMode, "unknown"),
    truncated: asBoolean(completeness?.truncated),
    payloadCharacters: rawPayload.length,
    rawPayload,
    semanticNodes: normalizeCount(completeness?.semanticNodes),
    semanticEdges: normalizeCount(completeness?.semanticEdges),
    evidence: normalizeCount(completeness?.evidence),
    visualTextBlocks: normalizeCount(completeness?.visualTextBlocks),
  };
}

export function stripIntentCanvasContextPrompt(text: string): string {
  const contextStart = text.indexOf(INTENT_CANVAS_CONTEXT_START);
  if (contextStart < 0) {
    return text;
  }
  return text.slice(0, contextStart).trimEnd();
}

export function parseIntentCanvasContextSummaries(text: string): IntentCanvasContextSummary[] {
  const summaries: IntentCanvasContextSummary[] = [];
  let searchIndex = 0;
  while (searchIndex < text.length) {
    const marker = findNextPayloadMarker(text, searchIndex);
    if (!marker) {
      break;
    }
    const match = FENCED_JSON_REGEX.exec(text.slice(marker.payloadStart));
    if (!match?.[0] || !match[1]) {
      searchIndex = marker.payloadStart;
      continue;
    }
    const rawPayload = match[1].trim();
    const summary = parseIntentCanvasPayload(rawPayload, summaries.length);
    if (summary) {
      summaries.push(summary);
    }
    searchIndex = marker.payloadStart + match.index + match[0].length;
  }
  return summaries;
}


