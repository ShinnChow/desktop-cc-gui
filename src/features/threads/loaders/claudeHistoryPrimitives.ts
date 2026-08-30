import { computeDiff } from "../../../utils/diff";
import { asString } from "./historyLoaderUtils";

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseJsonRecordFromText(
  value: string,
): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return asRecord(parsed);
  } catch {
    return null;
  }
}

export function recordContainsKey(value: unknown, targetKey: string): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => recordContainsKey(entry, targetKey));
  }
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return Object.entries(record).some(
    ([key, nested]) =>
      key === targetKey || recordContainsKey(nested, targetKey),
  );
}

export function recordContainsString(value: unknown, needle: string): boolean {
  if (typeof value === "string") {
    return value.includes(needle);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => recordContainsString(entry, needle));
  }
  const record = asRecord(value);
  if (!record) {
    return false;
  }
  return Object.values(record).some((nested) =>
    recordContainsString(nested, needle),
  );
}

export function unwrapTaggedText(text: string, tag: string): string | null {
  const trimmed = text.trim();
  const open = `<${tag}>`;
  if (!trimmed.startsWith(open)) {
    return null;
  }
  const close = `</${tag}>`;
  return (
    trimmed.endsWith(close)
      ? trimmed.slice(open.length, -close.length)
      : trimmed.slice(open.length)
  ).trim();
}

export function stripAnsiEscapeSequences(text: string) {
  const output: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) !== 27) {
      output.push(text[index]);
      continue;
    }
    if (text[index + 1] !== "[") {
      continue;
    }
    index += 2;
    while (index < text.length) {
      const charCode = text.charCodeAt(index);
      if (charCode >= 0x40 && charCode <= 0x7e) {
        break;
      }
      index += 1;
    }
  }
  return output.join("");
}

export function booleanField(record: Record<string, unknown> | null, key: string) {
  return record?.[key] === true;
}

export function getFirstStringFieldFromRecords(
  records: Array<Record<string, unknown> | null>,
  keys: string[],
) {
  for (const record of records) {
    if (!record) {
      continue;
    }
    for (const key of keys) {
      const value = asString(record[key]).trim();
      if (value) {
        return value;
      }
    }
  }
  return "";
}

export function buildUnifiedDiff(oldText: string, newText: string) {
  const diff = computeDiff(oldText, newText);
  const oldLines = oldText ? oldText.split("\n").length : 0;
  const newLines = newText ? newText.split("\n").length : 0;
  const header = `@@ -1,${oldLines} +1,${newLines} @@`;
  const body = diff.lines
    .map((line) => {
      if (line.type === "added") {
        return `+${line.content}`;
      }
      if (line.type === "deleted") {
        return `-${line.content}`;
      }
      return ` ${line.content}`;
    })
    .join("\n");
  return body ? `${header}\n${body}` : header;
}

export function asBooleanFlag(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") {
      return true;
    }
    if (normalized === "false" || normalized === "0" || normalized === "no") {
      return false;
    }
  }
  return undefined;
}

export function parseHistoryTimestampMs(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 1_000_000_000_000 ? value * 1000 : value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }
  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function asFiniteNonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/**
 * 从 load_claude_session 的返回值里提取 token 用量（后端会附带历史 JSONL
 * 中最后一条 assistant 消息的 usage）。窗口总量历史里没有，留 null，
 * 由展示层按模型估算。
 */
