import type { ThreadTokenUsage } from "../../../../types";
import type { ContextSelectionChip } from "../ChatInputBox/types";

export function keepArrayWhenEmpty<T>(current: T[]): T[] {
  return current.length === 0 ? current : [];
}

export function finiteNonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(value, 0)
    : null;
}

export function finitePositive(value: number | null | undefined): number | null {
  const normalizedValue = finiteNonNegative(value);
  return normalizedValue !== null && normalizedValue > 0
    ? normalizedValue
    : null;
}

export function resolveClaudeWindowUsedTokens(
  contextUsage: ThreadTokenUsage,
): number | null {
  const explicitContextUsedTokens = finiteNonNegative(
    contextUsage.contextUsedTokens,
  );
  if (explicitContextUsedTokens !== null) {
    return explicitContextUsedTokens;
  }
  const inputTokens = finiteNonNegative(contextUsage.last.inputTokens) ?? 0;
  const cachedInputTokens =
    finiteNonNegative(contextUsage.last.cachedInputTokens) ?? 0;
  const hasWindowSnapshot = inputTokens > 0 || cachedInputTokens > 0;
  return hasWindowSnapshot ? inputTokens + cachedInputTokens : null;
}

export function toContextChipCarryOverKey(chip: ContextSelectionChip) {
  return `${chip.type}:${chip.name}`;
}

export function resolveSelectedNamedItems<T extends { name: string }>(
  selectedNames: string[],
  items: T[],
): T[] {
  if (selectedNames.length === 0 || items.length === 0) {
    return [];
  }
  const firstByName = new Map<string, T>();
  for (const item of items) {
    const normalizedName = item.name.trim();
    if (!normalizedName || firstByName.has(normalizedName)) {
      continue;
    }
    firstByName.set(normalizedName, item);
  }
  const resolved: T[] = [];
  const seen = new Set<string>();
  for (const selectedName of selectedNames) {
    const normalizedName = selectedName.trim();
    if (!normalizedName || seen.has(normalizedName)) {
      continue;
    }
    const resolvedItem = firstByName.get(normalizedName);
    if (!resolvedItem) {
      continue;
    }
    seen.add(normalizedName);
    resolved.push(resolvedItem);
  }
  return resolved;
}

export const OPENCODE_DIRECT_COMMANDS = new Set(["status", "mcp", "export", "share"]);

export function normalizeCommandChipName(name: string) {
  const token = name.trim().replace(/^\/+/, "").split(/\s+/)[0];
  return token ? token.toLowerCase() : "";
}
