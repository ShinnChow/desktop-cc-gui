import { useCallback } from "react";
import type { MutableRefObject } from "react";
import type { ThreadSummary } from "../../../types";
import type { WorkspaceSessionCatalogSourceStatus } from "../../../services/tauri";
import { hasHealthyThreadSummaries } from "./useThreadActions.helpers";
import { inferThreadEngineSource } from "./useThreadActions.helpers";
import {
  isLocalPendingDraftThreadId,
  stripEmptyClaudeIndexFallbackSummaries,
} from "./sessionIndexThreadSummaries";
import { compareThreadSummariesByCreatedAtDesc } from "../utils/threadSummarySort";
import {
  loadSidebarSnapshot,
  queueRemoveThreadsFromSidebarSnapshot,
} from "../utils/sidebarSnapshot";

export type ThreadEngineSource = NonNullable<ThreadSummary["engineSource"]>;
export type LastGoodThreadSummariesByEngine = Partial<
  Record<ThreadEngineSource, ThreadSummary[]>
>;

export const THREAD_ENGINE_SOURCES: ThreadEngineSource[] = [
  "codex",
  "claude",
  "opencode",
  "gemini",
  "grok",
  "kimi",
  "pi",
  "omp",
  "qoder",
];

export function findCatalogSourceStatusForEngine(
  sourceStatuses: readonly WorkspaceSessionCatalogSourceStatus[] | undefined,
  engine: string,
): WorkspaceSessionCatalogSourceStatus | null {
  const normalizedEngine = engine.trim().toLowerCase();
  if (!normalizedEngine) {
    return null;
  }
  const matching =
    sourceStatuses?.filter(
      (status) => status.engine.trim().toLowerCase() === normalizedEngine,
    ) ?? [];
  return matching.sort(
    (left, right) =>
      sourceCompletenessPriority(right.completeness) -
      sourceCompletenessPriority(left.completeness),
  )[0] ?? null;
}

function sourceCompletenessPriority(
  completeness: WorkspaceSessionCatalogSourceStatus["completeness"] | undefined,
): number {
  switch (completeness) {
    case "degraded":
      return 4;
    case "partial":
      return 3;
    case "uncertain_empty":
      return 2;
    case "complete":
      return 1;
    case "authoritative_empty":
      return 0;
    default:
      return -1;
  }
}

export function isIncompleteCatalogSourceStatus(
  sourceStatus: WorkspaceSessionCatalogSourceStatus | null,
): boolean {
  return (
    sourceStatus?.completeness === "degraded" ||
    sourceStatus?.completeness === "partial" ||
    sourceStatus?.completeness === "uncertain_empty"
  );
}

export function hasAuthoritativeCatalogMembershipProof(
  sourceStatuses: readonly WorkspaceSessionCatalogSourceStatus[] | undefined,
): boolean {
  return (
    Array.isArray(sourceStatuses) &&
    sourceStatuses.length > 0 &&
    sourceStatuses.every(
      (sourceStatus) => !isIncompleteCatalogSourceStatus(sourceStatus),
    )
  );
}

function resolveThreadSummaryEngine(
  summary: ThreadSummary,
): ThreadEngineSource {
  return (summary.engineSource ??
    inferThreadEngineSource(summary.id, summary) ??
    "codex") as ThreadEngineSource;
}

function isHealthyThreadSummary(summary: ThreadSummary): boolean {
  return !summary.isDegraded && !summary.partialSource && !summary.degradedReason;
}

export function healthyThreadSummariesForEngine(
  threads: ThreadSummary[] | undefined,
  engine: ThreadEngineSource,
): ThreadSummary[] {
  if (!Array.isArray(threads) || threads.length === 0) {
    return [];
  }
  const engineThreads = threads.filter(
    (thread) => resolveThreadSummaryEngine(thread) === engine,
  );
  if (
    engineThreads.length === 0 ||
    engineThreads.some((thread) => !isHealthyThreadSummary(thread))
  ) {
    return [];
  }
  return engineThreads;
}

export function flattenLastGoodEngineSnapshots(
  snapshots: LastGoodThreadSummariesByEngine,
): ThreadSummary[] {
  const mergedById = new Map<string, ThreadSummary>();
  THREAD_ENGINE_SOURCES.forEach((engine) => {
    snapshots[engine]?.forEach((summary) => {
      const previous = mergedById.get(summary.id);
      if (!previous || summary.updatedAt >= previous.updatedAt) {
        mergedById.set(summary.id, summary);
      }
    });
  });
  return Array.from(mergedById.values()).sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

function sessionContinuityKey(summary: ThreadSummary): string {
  const id = String(summary.id ?? "").trim();
  const engine = (
    summary.engineSource ??
    inferThreadEngineSource(id, summary) ??
    (id.includes(":") ? id.slice(0, id.indexOf(":")) : "codex")
  )
    .trim()
    .toLowerCase();
  const bare = id.includes(":") ? id.slice(id.indexOf(":") + 1).trim() : id;
  return `${engine}:${bare}`;
}

function isSharedContinuitySummary(summary: ThreadSummary): boolean {
  const id = String(summary.id ?? "").trim();
  return summary.threadKind === "shared" || id.startsWith("shared:");
}

/**
 * D3 last-good floor: keep every Index row; add last-good rows that Index
 * is missing or that are newer than the same `(engine, session_id)`.
 * Newer Index wins on the same key. Shared / pending drafts stay out.
 */
export function unionIndexWithNewerLastGood(
  indexSummaries: readonly ThreadSummary[],
  lastGoodSummaries: readonly ThreadSummary[],
): ThreadSummary[] {
  const mergedByKey = new Map<string, ThreadSummary>();
  for (const summary of indexSummaries) {
    if (!summary.id) {
      continue;
    }
    mergedByKey.set(sessionContinuityKey(summary), summary);
  }
  for (const candidate of lastGoodSummaries) {
    if (!candidate.id || isSharedContinuitySummary(candidate)) {
      continue;
    }
    const engine = candidate.engineSource ?? inferThreadEngineSource(candidate.id, candidate);
    if (isLocalPendingDraftThreadId(engine, candidate.id)) {
      continue;
    }
    const key = sessionContinuityKey(candidate);
    const existing = mergedByKey.get(key);
    if (!existing) {
      mergedByKey.set(key, candidate);
      continue;
    }
    if (candidate.updatedAt > existing.updatedAt) {
      mergedByKey.set(key, candidate);
    }
  }
  return Array.from(mergedByKey.values()).sort(
    compareThreadSummariesByCreatedAtDesc,
  );
}

export type LastGoodFloorProjection = {
  visibleSummaries: ThreadSummary[];
  /** null = do not promote this paint into last-good authority */
  rememberCandidates: ThreadSummary[] | null;
};

/**
 * Sidebar last-good policy: floor not ceiling.
 * Empty Index without authoritative-empty proof may paint last-good
 * but must not rewrite the remembered snapshot.
 */
export function resolveLastGoodFloorProjection(input: {
  indexSummaries: readonly ThreadSummary[];
  lastGoodSummaries: readonly ThreadSummary[];
  hasAuthoritativeEmptyCatalog: boolean;
  excludedThreadIds?: ReadonlySet<string>;
}): LastGoodFloorProjection {
  const excluded = input.excludedThreadIds ?? new Set<string>();
  const indexSummaries = input.indexSummaries.filter(
    (summary) => summary.id && !excluded.has(summary.id),
  );
  const lastGoodSummaries = input.lastGoodSummaries.filter(
    (summary) => summary.id && !excluded.has(summary.id),
  );
  if (input.hasAuthoritativeEmptyCatalog) {
    const visibleSummaries = stripEmptyClaudeIndexFallbackSummaries(indexSummaries);
    return {
      visibleSummaries,
      rememberCandidates: visibleSummaries,
    };
  }
  if (indexSummaries.length === 0) {
    return {
      visibleSummaries: stripEmptyClaudeIndexFallbackSummaries(lastGoodSummaries),
      rememberCandidates: null,
    };
  }
  const visibleSummaries = stripEmptyClaudeIndexFallbackSummaries(
    unionIndexWithNewerLastGood(indexSummaries, lastGoodSummaries),
  );
  return {
    visibleSummaries,
    rememberCandidates: visibleSummaries,
  };
}

function resolvePartialSourceEngine(
  source: string,
): ThreadEngineSource | "all" | null {
  const normalized = source.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("archive") || normalized.includes("empty-thread-list")) {
    return "all";
  }
  if (normalized.includes("claude")) {
    return "claude";
  }
  if (normalized.includes("opencode")) {
    return "opencode";
  }
  if (normalized.includes("gemini")) {
    return "gemini";
  }
  if (normalized.includes("grok")) {
    return "grok";
  }
  if (normalized.includes("kimi")) {
    return "kimi";
  }
  if (
    normalized.includes("codex") ||
    normalized.includes("workspace-not-connected") ||
    normalized.includes("thread-list-live")
  ) {
    return "codex";
  }
  return "all";
}

export function buildLastGoodSnapshotBlockedEngines(
  sourceStatuses: readonly WorkspaceSessionCatalogSourceStatus[] | undefined,
  partialSources: ReadonlySet<string>,
): Set<ThreadEngineSource> {
  const blocked = new Set<ThreadEngineSource>();
  sourceStatuses?.forEach((sourceStatus) => {
    const engine = sourceStatus.engine.trim().toLowerCase() as ThreadEngineSource;
    if (
      THREAD_ENGINE_SOURCES.includes(engine) &&
      isIncompleteCatalogSourceStatus(sourceStatus)
    ) {
      blocked.add(engine);
    }
  });
  partialSources.forEach((partialSource) => {
    const engine = resolvePartialSourceEngine(partialSource);
    if (engine === "all") {
      THREAD_ENGINE_SOURCES.forEach((item) => blocked.add(item));
    } else if (engine) {
      blocked.add(engine);
    }
  });
  return blocked;
}

export function useThreadActionsLastGoodSnapshots({
  latestThreadsByWorkspaceRef,
  previousThreadsByWorkspaceRef,
  lastGoodThreadSummariesByWorkspaceEngineRef,
  threadsByWorkspace,
}: {
  latestThreadsByWorkspaceRef: MutableRefObject<Record<string, ThreadSummary[]>>;
  previousThreadsByWorkspaceRef: MutableRefObject<Record<string, ThreadSummary[]>>;
  lastGoodThreadSummariesByWorkspaceEngineRef: MutableRefObject<
    Record<string, LastGoodThreadSummariesByEngine>
  >;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
}) {
  const getLastGoodThreadSummaries = useCallback(
    (workspaceId: string): ThreadSummary[] => {
      const currentThreads = latestThreadsByWorkspaceRef.current[workspaceId];
      if (hasHealthyThreadSummaries(currentThreads)) {
        return currentThreads;
      }
      const previousThreads =
        previousThreadsByWorkspaceRef.current[workspaceId];
      if (hasHealthyThreadSummaries(previousThreads)) {
        return previousThreads;
      }
      const stateThreads = threadsByWorkspace[workspaceId];
      if (hasHealthyThreadSummaries(stateThreads)) {
        return stateThreads;
      }
      const snapshotThreads =
        loadSidebarSnapshot()?.threadsByWorkspace[workspaceId];
      if (hasHealthyThreadSummaries(snapshotThreads)) {
        return snapshotThreads;
      }
      const snapshots: LastGoodThreadSummariesByEngine = {};
      const candidateSources = [
        currentThreads,
        previousThreads,
        stateThreads,
        snapshotThreads,
      ];
      for (const engine of THREAD_ENGINE_SOURCES) {
        const healthyEngineThreads = candidateSources
          .map((threads) => healthyThreadSummariesForEngine(threads, engine))
          .find((threads) => threads.length > 0);
        snapshots[engine] =
          healthyEngineThreads ??
          lastGoodThreadSummariesByWorkspaceEngineRef.current[workspaceId]?.[
            engine
          ];
      }
      return flattenLastGoodEngineSnapshots(snapshots);
    },
    [
      latestThreadsByWorkspaceRef,
      previousThreadsByWorkspaceRef,
      lastGoodThreadSummariesByWorkspaceEngineRef,
      threadsByWorkspace,
    ],
  );

  const getLastGoodThreadSummariesForEngine = useCallback(
    (workspaceId: string, engine: ThreadEngineSource): ThreadSummary[] => {
      const currentThreads = latestThreadsByWorkspaceRef.current[workspaceId];
      const previousThreads =
        previousThreadsByWorkspaceRef.current[workspaceId];
      const stateThreads = threadsByWorkspace[workspaceId];
      const snapshotThreads =
        loadSidebarSnapshot()?.threadsByWorkspace[workspaceId];
      return (
        [
          currentThreads,
          previousThreads,
          stateThreads,
          snapshotThreads,
        ]
          .map((threads) => healthyThreadSummariesForEngine(threads, engine))
          .find((threads) => threads.length > 0) ??
        lastGoodThreadSummariesByWorkspaceEngineRef.current[workspaceId]?.[
          engine
        ] ??
        []
      );
    },
    [
      latestThreadsByWorkspaceRef,
      previousThreadsByWorkspaceRef,
      lastGoodThreadSummariesByWorkspaceEngineRef,
      threadsByWorkspace,
    ],
  );

  const rememberLastGoodThreadSummariesByEngine = useCallback(
    (
      workspaceId: string,
      summaries: ThreadSummary[],
      blockedEngines: ReadonlySet<ThreadEngineSource>,
    ) => {
      const currentSnapshots =
        lastGoodThreadSummariesByWorkspaceEngineRef.current[workspaceId] ?? {};
      const nextSnapshots: LastGoodThreadSummariesByEngine = {
        ...currentSnapshots,
      };
      let changed = false;
      for (const engine of THREAD_ENGINE_SOURCES) {
        if (blockedEngines.has(engine)) {
          continue;
        }
        const healthyEngineThreads = healthyThreadSummariesForEngine(
          summaries,
          engine,
        );
        if (healthyEngineThreads.length === 0) {
          continue;
        }
        nextSnapshots[engine] = healthyEngineThreads;
        changed = true;
      }
      if (!changed) {
        return;
      }
      lastGoodThreadSummariesByWorkspaceEngineRef.current = {
        ...lastGoodThreadSummariesByWorkspaceEngineRef.current,
        [workspaceId]: nextSnapshots,
      };
    },
    [lastGoodThreadSummariesByWorkspaceEngineRef],
  );

  const removeThreadFromCachedSummaries = useCallback(
    (workspaceId: string, threadId: string) => {
      // 持久化快照与内存 refs 同步摘除：否则 partial/degraded 刷新的
      // last-good floor 会从磁盘副本回灌已删会话（删了又回来的通道之一）。
      queueRemoveThreadsFromSidebarSnapshot(workspaceId, threadId);
      const filterOutThread = (
        source: Record<string, ThreadSummary[] | undefined>,
      ): ThreadSummary[] => {
        const current = source[workspaceId] ?? [];
        return current.filter((entry) => entry.id !== threadId);
      };
      latestThreadsByWorkspaceRef.current = {
        ...latestThreadsByWorkspaceRef.current,
        [workspaceId]: filterOutThread(latestThreadsByWorkspaceRef.current),
      };
      previousThreadsByWorkspaceRef.current = {
        ...previousThreadsByWorkspaceRef.current,
        [workspaceId]: filterOutThread(previousThreadsByWorkspaceRef.current),
      };
      const currentSnapshots =
        lastGoodThreadSummariesByWorkspaceEngineRef.current[workspaceId];
      if (!currentSnapshots) {
        return;
      }
      const nextSnapshots: LastGoodThreadSummariesByEngine = {};
      THREAD_ENGINE_SOURCES.forEach((engine) => {
        const nextEngineThreads = (currentSnapshots[engine] ?? []).filter(
          (entry) => entry.id !== threadId,
        );
        if (nextEngineThreads.length > 0) {
          nextSnapshots[engine] = nextEngineThreads;
        }
      });
      lastGoodThreadSummariesByWorkspaceEngineRef.current = {
        ...lastGoodThreadSummariesByWorkspaceEngineRef.current,
        [workspaceId]: nextSnapshots,
      };
    },
    [
      latestThreadsByWorkspaceRef,
      previousThreadsByWorkspaceRef,
      lastGoodThreadSummariesByWorkspaceEngineRef,
    ],
  );

  return {
    getLastGoodThreadSummaries,
    getLastGoodThreadSummariesForEngine,
    rememberLastGoodThreadSummariesByEngine,
    removeThreadFromCachedSummaries,
  };
}
