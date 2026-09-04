import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";

export const MAX_PINS_SOFT_LIMIT = 5;

export type ThreadActivityMap = Record<string, Record<string, number>>;
export type PinnedThreadsMap = Record<string, number>;
export type CustomNamesMap = Record<string, string>;
export type AutoTitlePendingMap = Record<string, true>;
export type ThreadAliasMap = Record<string, string>;
export type ActiveThreadIdByWorkspaceMap = Record<string, string | null>;
export type CanonicalActiveThreadRebinding = {
  workspaceId: string;
  threadId: string;
  canonicalThreadId: string;
};
export const MAX_THREAD_ALIAS_ENTRIES = 2_000;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinalizedNativeThreadId(threadId: string) {
  const normalizedThreadId = threadId.toLowerCase();
  return (
    normalizedThreadId.startsWith("claude:") ||
    normalizedThreadId.startsWith("gemini:") ||
    normalizedThreadId.startsWith("grok:") ||
    normalizedThreadId.startsWith("kimi:") ||
    normalizedThreadId.startsWith("pi:") ||
    normalizedThreadId.startsWith("qoder:") ||
    normalizedThreadId.startsWith("opencode:") ||
    normalizedThreadId.startsWith("dsh:")
  );
}

export function loadThreadActivity(): ThreadActivityMap {
  return getClientStoreSync<ThreadActivityMap>("threads", "lastUserActivity") ?? {};
}

export function saveThreadActivity(activity: ThreadActivityMap) {
  writeClientStoreValue("threads", "lastUserActivity", activity);
}

export function makeCustomNameKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}:${threadId}`;
}

// customNames 历史上只增不减（实测膨胀到 ~21,000 条 / 2.8MB），
// 超容量时按插入序淘汰最旧条目（plain object 的 string key 保持插入序）。
export const MAX_CUSTOM_NAME_ENTRIES = 2_000;

export function pruneCustomNames(
  names: CustomNamesMap,
  maxEntries: number = MAX_CUSTOM_NAME_ENTRIES,
): CustomNamesMap {
  const keys = Object.keys(names);
  if (keys.length <= maxEntries) {
    return names;
  }
  const pruned: CustomNamesMap = {};
  for (const key of keys.slice(keys.length - maxEntries)) {
    pruned[key] = names[key]!;
  }
  return pruned;
}

export function loadCustomNames(): CustomNamesMap {
  return getClientStoreSync<CustomNamesMap>("threads", "customNames") ?? {};
}

export function persistCustomNames(names: CustomNamesMap): CustomNamesMap {
  const pruned = pruneCustomNames(names);
  writeClientStoreValue("threads", "customNames", pruned);
  return pruned;
}

export function saveCustomName(workspaceId: string, threadId: string, name: string): void {
  const current = loadCustomNames();
  const key = makeCustomNameKey(workspaceId, threadId);
  // 先删再插：已存在的 key 重命名时移到插入序末尾，避免被当作最旧条目淘汰。
  const updated: CustomNamesMap = { ...current };
  delete updated[key];
  updated[key] = name;
  persistCustomNames(updated);
}

/** 一次 hydrate / list 映射只写盘一次，避免 N 次全量 customNames IPC（frame-drop hotspot）。 */
export function saveCustomNamesBatch(
  workspaceId: string,
  titles: Record<string, string>,
): CustomNamesMap {
  const current = loadCustomNames();
  const updated: CustomNamesMap = { ...current };
  let changed = false;
  for (const [threadId, title] of Object.entries(titles)) {
    const trimmedId = threadId.trim();
    const trimmedTitle = title.trim();
    if (!trimmedId || !trimmedTitle) {
      continue;
    }
    const key = makeCustomNameKey(workspaceId, trimmedId);
    if (updated[key] === trimmedTitle) {
      continue;
    }
    delete updated[key];
    updated[key] = trimmedTitle;
    changed = true;
  }
  if (!changed) {
    return current;
  }
  return persistCustomNames(updated);
}





export function normalizeThreadAliases(raw: unknown): ThreadAliasMap {
  if (!isPlainRecord(raw)) {
    return {};
  }

  const normalized: ThreadAliasMap = {};
  Object.entries(raw).forEach(([source, target]) => {
    if (typeof target !== "string") {
      return;
    }
    const normalizedSource = source.trim();
    const normalizedTarget = target.trim();
    if (!normalizedSource || !normalizedTarget || normalizedSource === normalizedTarget) {
      return;
    }
    if (isFinalizedNativeThreadId(normalizedSource)) {
      return;
    }
    normalized[normalizedSource] = normalizedTarget;
  });

  const flattened: ThreadAliasMap = {};
  Object.keys(normalized).forEach((sourceThreadId) => {
    let currentThreadId = sourceThreadId;
    const visited = new Set<string>();
    let nextThreadId = normalized[currentThreadId];
    while (nextThreadId) {
      if (visited.has(currentThreadId)) {
        return;
      }
      visited.add(currentThreadId);
      currentThreadId = nextThreadId;
      nextThreadId = normalized[currentThreadId];
    }
    if (currentThreadId !== sourceThreadId) {
      flattened[sourceThreadId] = currentThreadId;
    }
  });

  const flattenedEntries = Object.entries(flattened);
  return Object.fromEntries(
    flattenedEntries.slice(
      Math.max(0, flattenedEntries.length - MAX_THREAD_ALIAS_ENTRIES),
    ),
  );
}

export function resolveCanonicalThreadAlias(
  aliases: ThreadAliasMap,
  threadId: string,
): string {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return threadId;
  }
  let current = normalizedThreadId;
  const visited = new Set<string>();
  while (aliases[current] && !visited.has(current)) {
    visited.add(current);
    current = aliases[current] ?? current;
  }
  return current;
}

export function collectCanonicalActiveThreadRebindings(
  activeThreadIdByWorkspace: ActiveThreadIdByWorkspaceMap,
  resolveCanonicalThreadId: (threadId: string) => string,
): CanonicalActiveThreadRebinding[] {
  return Object.entries(activeThreadIdByWorkspace).flatMap(([workspaceId, threadId]) => {
    const normalizedThreadId = threadId?.trim() ?? "";
    if (!normalizedThreadId) {
      return [];
    }
    const canonicalThreadId = resolveCanonicalThreadId(normalizedThreadId).trim();
    if (!canonicalThreadId || canonicalThreadId === normalizedThreadId) {
      return [];
    }
    return [
      {
        workspaceId,
        threadId: normalizedThreadId,
        canonicalThreadId,
      },
    ];
  });
}

export function loadThreadAliases(): ThreadAliasMap {
  const raw = getClientStoreSync<unknown>("threads", "threadAliases") ?? {};
  return normalizeThreadAliases(raw);
}

export function saveThreadAliases(value: ThreadAliasMap): void {
  writeClientStoreValue("threads", "threadAliases", normalizeThreadAliases(value));
}

export function buildUpdatedThreadAliases(
  current: ThreadAliasMap,
  oldThreadId: string,
  newThreadId: string,
): ThreadAliasMap {
  const normalizedCurrent = normalizeThreadAliases(current);
  const normalizedOldThreadId = oldThreadId.trim();
  const normalizedNewThreadId = newThreadId.trim();
  if (
    !normalizedOldThreadId ||
    !normalizedNewThreadId ||
    normalizedOldThreadId === normalizedNewThreadId ||
    isFinalizedNativeThreadId(normalizedOldThreadId)
  ) {
    return normalizedCurrent;
  }
  const canonicalNewThreadId = resolveCanonicalThreadAlias(
    normalizedCurrent,
    normalizedNewThreadId,
  );
  normalizedCurrent[normalizedOldThreadId] = canonicalNewThreadId;
  if (canonicalNewThreadId !== normalizedNewThreadId) {
    normalizedCurrent[normalizedNewThreadId] = canonicalNewThreadId;
  }
  Object.keys(normalizedCurrent).forEach((sourceThreadId) => {
    const canonicalThreadId = resolveCanonicalThreadAlias(
      normalizedCurrent,
      sourceThreadId,
    );
    if (!canonicalThreadId || canonicalThreadId === sourceThreadId) {
      delete normalizedCurrent[sourceThreadId];
      return;
    }
    normalizedCurrent[sourceThreadId] = canonicalThreadId;
  });
  return normalizeThreadAliases(normalizedCurrent);
}

export function buildClearedThreadAliases(
  current: ThreadAliasMap,
  oldThreadId: string,
): ThreadAliasMap {
  const normalizedCurrent = normalizeThreadAliases(current);
  const normalizedOldThreadId = oldThreadId.trim();
  if (!normalizedOldThreadId) {
    return normalizedCurrent;
  }
  delete normalizedCurrent[normalizedOldThreadId];
  return normalizeThreadAliases(normalizedCurrent);
}

export type ThreadPinScope = "global" | "workspace";

export function makePinKey(workspaceId: string, threadId: string): string {
  return `${workspaceId}:${threadId}`;
}

export function loadPinnedThreads(): PinnedThreadsMap {
  return getClientStoreSync<PinnedThreadsMap>("threads", "pinnedThreads") ?? {};
}

export function savePinnedThreads(pinned: PinnedThreadsMap) {
  writeClientStoreValue("threads", "pinnedThreads", pinned);
}

export function loadWorkspacePinnedThreads(): PinnedThreadsMap {
  return (
    getClientStoreSync<PinnedThreadsMap>("threads", "workspacePinnedThreads") ??
    {}
  );
}

export function saveWorkspacePinnedThreads(pinned: PinnedThreadsMap) {
  writeClientStoreValue("threads", "workspacePinnedThreads", pinned);
}
