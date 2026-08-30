import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  assignWorkspaceSessionFolders,
  archiveWorkspaceSessionsV2,
  deleteWorkspaceSessions,
  listGlobalCodexSessions,
  listProjectRelatedSessions,
  listWorkspaceSessions,
  scheduleTombstoneClaudeForkIndexRow,
  unarchiveWorkspaceSessionsV2,
  type WorkspaceSessionBatchMutationResponse,
  type WorkspaceSessionCatalogEntry,
  type WorkspaceSessionCatalogPage,
  type WorkspaceSessionCatalogQuery,
} from "../../../../../services/tauri";
import type { WorkspaceSessionAttributionMode } from "../../../../../types";
import {
  isSessionDeleteSuccessCode,
  isSessionDeleteV2Enabled,
  requestSessionDelete,
} from "../../../../threads/utils/sessionDeleteV2";

export type WorkspaceSessionCatalogStatus = "active" | "archived" | "all";
export type WorkspaceSessionCatalogMode = "project" | "global";
export type WorkspaceSessionCatalogSource = "strict" | "related";

export type WorkspaceSessionCatalogFilters = {
  keyword: string;
  engine: string;
  status: WorkspaceSessionCatalogStatus;
  folderId?: string | null;
};

type MutationKind = "archive" | "unarchive" | "delete" | "move-folder";

export type WorkspaceSessionCatalogMutationResult = {
  selectionKey: string;
  sessionId: string;
  workspaceId: string;
  ok: boolean;
  archivedAt?: number | null;
  error?: string | null;
  code?: string | null;
  deletedFromDisk?: boolean | null;
  metadataCleaned?: boolean | null;
};

export type WorkspaceSessionCatalogMutationResponse = {
  results: WorkspaceSessionCatalogMutationResult[];
};

export type WorkspaceSessionCatalogPageLimitInfo = {
  requestedLimit: number | null;
  effectiveLimit: number | null;
  limitCapped: boolean;
};

type WorkspaceSessionCatalogPageLike = {
  data?: WorkspaceSessionCatalogEntry[] | null;
  nextCursor?: string | null;
  requestedLimit?: number | null;
  effectiveLimit?: number | null;
  limitCapped?: boolean | null;
  partialSource?: string | null;
} | null;

type UseWorkspaceSessionCatalogOptions = {
  mode: WorkspaceSessionCatalogMode;
  workspaceId: string | null;
  filters: WorkspaceSessionCatalogFilters;
  sessionAttributionMode?: WorkspaceSessionAttributionMode;
  source?: WorkspaceSessionCatalogSource;
  enabled?: boolean;
};

export const SESSION_CATALOG_PAGE_SIZE = 100;
const UNASSIGNED_WORKSPACE_ID = "__global_unassigned__";
const OWNER_UNRESOLVED_CODE = "OWNER_WORKSPACE_UNRESOLVED";
const inFlightCatalogPageByKey = new Map<
  string,
  Promise<WorkspaceSessionCatalogPage>
>();

export function buildWorkspaceSessionSelectionKey(
  entry: Pick<
    WorkspaceSessionCatalogEntry,
    "workspaceId" | "sessionId" | "stableSessionKey"
  >,
): string {
  const stableKey = entry.stableSessionKey?.trim();
  return `${entry.workspaceId}::${stableKey || entry.sessionId}`;
}

function toSelectionKeySet(selectionKeys: string[]): Set<string> {
  return new Set(selectionKeys);
}

function toWorkspaceMutationFailure(
  entry: WorkspaceSessionCatalogEntry,
  error: unknown,
): WorkspaceSessionCatalogMutationResult {
  return {
    selectionKey: buildWorkspaceSessionSelectionKey(entry),
    sessionId: entry.sessionId,
    workspaceId: entry.workspaceId,
    ok: false,
    archivedAt: null,
    error: normalizeErrorMessage(error),
    code: "MUTATION_REQUEST_FAILED",
  };
}

function normalizeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toQuery(
  filters: WorkspaceSessionCatalogFilters,
  sessionAttributionMode: WorkspaceSessionAttributionMode,
): WorkspaceSessionCatalogQuery {
  return {
    keyword: filters.keyword.trim() || null,
    engine: filters.engine.trim() || null,
    status: filters.status,
    folderId: filters.folderId?.trim() || null,
    sessionAttributionMode,
  };
}

function buildCatalogRequestKey(input: {
  mode: WorkspaceSessionCatalogMode;
  workspaceId: string | null;
  source: WorkspaceSessionCatalogSource;
  query: WorkspaceSessionCatalogQuery;
  cursor: string | null;
  limit: number;
}) {
  const { cursor, limit, mode, query, source, workspaceId } = input;
  return JSON.stringify({
    mode,
    workspaceId: workspaceId ?? null,
    source,
    cursor,
    limit,
    query: {
      keyword: query.keyword ?? null,
      engine: query.engine ?? null,
      status: query.status ?? null,
      folderId: query.folderId ?? null,
      sessionAttributionMode: query.sessionAttributionMode ?? null,
    },
  });
}

function requestCatalogPage(input: {
  mode: WorkspaceSessionCatalogMode;
  workspaceId: string | null;
  source: WorkspaceSessionCatalogSource;
  query: WorkspaceSessionCatalogQuery;
  cursor: string | null;
  limit: number;
}) {
  const requestKey = buildCatalogRequestKey(input);
  const existingRequest = inFlightCatalogPageByKey.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const request =
    input.mode === "global"
      ? listGlobalCodexSessions({
          query: input.query,
          cursor: input.cursor,
          limit: input.limit,
        })
      : input.source === "related"
        ? listProjectRelatedSessions(input.workspaceId!, {
            query: input.query,
            cursor: input.cursor,
            limit: input.limit,
          })
        : listWorkspaceSessions(input.workspaceId!, {
            query: input.query,
            cursor: input.cursor,
            limit: input.limit,
          });

  inFlightCatalogPageByKey.set(requestKey, request);
  const clearInFlightRequest = () => {
    if (inFlightCatalogPageByKey.get(requestKey) === request) {
      inFlightCatalogPageByKey.delete(requestKey);
    }
  };
  void request.then(clearInFlightRequest, clearInFlightRequest);
  return request;
}

function normalizeCatalogPage(response: WorkspaceSessionCatalogPageLike): {
  data: WorkspaceSessionCatalogEntry[];
  nextCursor: string | null;
  partialSource: string | null;
  pageLimit: WorkspaceSessionCatalogPageLimitInfo;
} {
  const requestedLimit =
    typeof response?.requestedLimit === "number" &&
    Number.isFinite(response.requestedLimit)
      ? Math.max(0, response.requestedLimit)
      : null;
  const effectiveLimit =
    typeof response?.effectiveLimit === "number" &&
    Number.isFinite(response.effectiveLimit)
      ? Math.max(0, response.effectiveLimit)
      : null;
  return {
    data: Array.isArray(response?.data) ? response.data : [],
    nextCursor: response?.nextCursor ?? null,
    partialSource: response?.partialSource ?? null,
    pageLimit: {
      requestedLimit,
      effectiveLimit,
      limitCapped: response?.limitCapped === true,
    },
  };
}

function patchArchivedState(
  current: WorkspaceSessionCatalogEntry[],
  results: WorkspaceSessionCatalogMutationResponse["results"],
): WorkspaceSessionCatalogEntry[] {
  if (results.length === 0) {
    return current;
  }
  const archivedAtBySelectionKey = new Map(
    results
      .filter((item) => item.ok)
      .map((item) => [item.selectionKey, item.archivedAt ?? null] as const),
  );
  return current.map((entry) =>
    archivedAtBySelectionKey.has(buildWorkspaceSessionSelectionKey(entry))
      ? {
          ...entry,
          archivedAt:
            archivedAtBySelectionKey.get(
              buildWorkspaceSessionSelectionKey(entry),
            ) ?? null,
        }
      : entry,
  );
}

function clearCatalogEntries(
  current: WorkspaceSessionCatalogEntry[],
): WorkspaceSessionCatalogEntry[] {
  return current.length === 0 ? current : [];
}

export function useWorkspaceSessionCatalog({
  mode,
  workspaceId,
  filters,
  sessionAttributionMode = "related",
  source = "strict",
  enabled = true,
}: UseWorkspaceSessionCatalogOptions) {
  const [entries, setEntries] = useState<WorkspaceSessionCatalogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [partialSource, setPartialSource] = useState<string | null>(null);
  const [pageLimit, setPageLimit] =
    useState<WorkspaceSessionCatalogPageLimitInfo>({
      requestedLimit: null,
      effectiveLimit: null,
      limitCapped: false,
    });
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const requestSeqRef = useRef(0);
  const { engine, folderId, keyword, status } = filters;

  const query = useMemo(
    () =>
      toQuery(
        { engine, folderId, keyword, status },
        sessionAttributionMode,
      ),
    [engine, folderId, keyword, sessionAttributionMode, status],
  );

  const loadPage = useCallback(
    async (pageMode: "replace" | "append", cursor?: string | null) => {
      const requestId = requestSeqRef.current + 1;
      requestSeqRef.current = requestId;
      if (!enabled || (mode === "project" && !workspaceId)) {
        setEntries(clearCatalogEntries);
        setNextCursor(null);
        setPartialSource(null);
        setPageLimit({
          requestedLimit: null,
          effectiveLimit: null,
          limitCapped: false,
        });
        setError(null);
        setIsLoading(false);
        setIsLoadingMore(false);
        return;
      }

      if (pageMode === "append") {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      try {
        const response = await requestCatalogPage({
          mode,
          workspaceId,
          source,
          query,
          cursor: cursor ?? null,
          limit: SESSION_CATALOG_PAGE_SIZE,
        });
        if (requestSeqRef.current !== requestId) {
          return;
        }
        const page = normalizeCatalogPage(response);
        setEntries((current) =>
          pageMode === "append" ? [...current, ...page.data] : page.data,
        );
        setNextCursor(page.nextCursor);
        setPartialSource(page.partialSource);
        setPageLimit(page.pageLimit);
        setError(null);
      } catch (incomingError) {
        if (requestSeqRef.current !== requestId) {
          return;
        }
        const message = normalizeErrorMessage(incomingError);
        if (pageMode !== "append") {
          setEntries([]);
          setNextCursor(null);
          setPartialSource(null);
          setPageLimit({
            requestedLimit: null,
            effectiveLimit: null,
            limitCapped: false,
          });
        }
        setError(message);
      } finally {
        if (requestSeqRef.current === requestId) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [enabled, mode, query, source, workspaceId],
  );

  useEffect(() => {
    void loadPage("replace", null);
  }, [loadPage]);

  const reload = useCallback(async () => {
    await loadPage("replace", null);
  }, [loadPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) {
      return;
    }
    await loadPage("append", nextCursor);
  }, [isLoadingMore, loadPage, nextCursor]);

  const mutate = useCallback(
    async (
      kind: MutationKind,
      selectedEntries: WorkspaceSessionCatalogEntry[],
      options?: { folderId?: string | null },
    ): Promise<WorkspaceSessionCatalogMutationResponse> => {
      if (mode === "project" && !workspaceId) {
        throw new Error("workspace_id is required");
      }
      if (selectedEntries.length === 0) {
        return { results: [] };
      }

      setIsMutating(true);
      try {
        const entriesByWorkspaceId = new Map<
          string,
          WorkspaceSessionCatalogEntry[]
        >();
        const unresolvedEntries: WorkspaceSessionCatalogMutationResult[] = [];
        selectedEntries.forEach((entry) => {
          if (entry.workspaceId === UNASSIGNED_WORKSPACE_ID) {
            unresolvedEntries.push({
              selectionKey: buildWorkspaceSessionSelectionKey(entry),
              sessionId: entry.sessionId,
              workspaceId: entry.workspaceId,
              ok: false,
              archivedAt: null,
              error: "Owner workspace could not be resolved for this session.",
              code: OWNER_UNRESOLVED_CODE,
            });
            return;
          }
          const bucket = entriesByWorkspaceId.get(entry.workspaceId) ?? [];
          bucket.push(entry);
          entriesByWorkspaceId.set(entry.workspaceId, bucket);
        });

        const mutationResults: WorkspaceSessionCatalogMutationResult[] = [
          ...unresolvedEntries,
        ];
        for (const [entryWorkspaceId, entryBucket] of entriesByWorkspaceId) {
          const sessionIds = entryBucket.map((entry) => entry.sessionId);
          const selectionKeyBySessionId = new Map(
            entryBucket.map((entry) => [
              entry.sessionId,
              buildWorkspaceSessionSelectionKey(entry),
            ]),
          );
          const selectionKeyByStableSessionKey = new Map(
            entryBucket
              .map((entry) => {
                const stableKey = entry.stableSessionKey?.trim();
                return stableKey
                  ? ([
                      stableKey,
                      buildWorkspaceSessionSelectionKey(entry),
                    ] as const)
                  : null;
              })
              .filter(
                (item): item is readonly [string, string] => item !== null,
              ),
          );
          try {
            const respondedSessionIds = new Set<string>();
            if (kind === "delete" && isSessionDeleteV2Enabled()) {
              // v2 删除（Index First + marker-first）：批量恒为一次 IPC，
              // 结果码对齐 SessionDeleteCode（OK / ALREADY_MISSING /
              // GHOST_CLEANED / MARKED_DELETED 为幂等成功）。
              const v2Results = await requestSessionDelete(
                entryWorkspaceId,
                sessionIds,
              );
              v2Results.forEach((item) => {
                respondedSessionIds.add(item.sessionId);
                const ok = item.ok || isSessionDeleteSuccessCode(item.code);
                if (ok) {
                  // 合成 fork ID 的 mangled 孪生键后端够不到，删除成功顺带清理
                  scheduleTombstoneClaudeForkIndexRow(item.sessionId);
                }
                mutationResults.push({
                  selectionKey:
                    selectionKeyBySessionId.get(item.sessionId) ??
                    `${entryWorkspaceId}::${item.sessionId}`,
                  sessionId: item.sessionId,
                  workspaceId: entryWorkspaceId,
                  ok,
                  archivedAt: null,
                  error: item.error ?? null,
                  code: item.code,
                  deletedFromDisk: ok ? item.code === "OK" : false,
                  metadataCleaned: ok,
                });
              });
            } else {
              let response: WorkspaceSessionBatchMutationResponse;
              if (kind === "archive" || kind === "unarchive") {
                // v2：Index First + metadata-only，后端不再全量扫描 catalog。
                const targets = entryBucket.map((entry) => ({
                  threadId: entry.sessionId,
                  engine: entry.engine,
                }));
                response =
                  kind === "archive"
                    ? await archiveWorkspaceSessionsV2(entryWorkspaceId, targets)
                    : await unarchiveWorkspaceSessionsV2(entryWorkspaceId, targets);
              } else if (kind === "delete") {
                response = await deleteWorkspaceSessions(
                  entryWorkspaceId,
                  sessionIds,
                );
              } else {
                response = await assignWorkspaceSessionFolders(
                  entryWorkspaceId,
                  sessionIds,
                  options?.folderId ?? null,
                );
              }

              response.results.forEach((item) => {
                respondedSessionIds.add(item.sessionId);
                const ownerWorkspaceId =
                  item.ownerWorkspaceId ?? entryWorkspaceId;
                const stableSessionKey = item.stableSessionKey?.trim() || null;
                mutationResults.push({
                  selectionKey:
                    selectionKeyBySessionId.get(item.sessionId) ??
                    (stableSessionKey
                      ? selectionKeyByStableSessionKey.get(stableSessionKey)
                      : undefined) ??
                    `${ownerWorkspaceId}::${stableSessionKey || item.sessionId}`,
                  sessionId: item.sessionId,
                  workspaceId: ownerWorkspaceId,
                  ok: item.ok,
                  archivedAt: item.archivedAt,
                  error: item.error,
                  code: item.code,
                  deletedFromDisk: item.deletedFromDisk,
                  metadataCleaned: item.metadataCleaned,
                });
              });
            }

            entryBucket.forEach((entry) => {
              if (respondedSessionIds.has(entry.sessionId)) {
                return;
              }
              mutationResults.push({
                selectionKey: buildWorkspaceSessionSelectionKey(entry),
                sessionId: entry.sessionId,
                workspaceId: entry.workspaceId,
                ok: false,
                archivedAt: null,
                error: "Missing session mutation result",
                code: "MISSING_MUTATION_RESULT",
              });
            });
          } catch (error) {
            entryBucket.forEach((entry) => {
              mutationResults.push(toWorkspaceMutationFailure(entry, error));
            });
          }
        }

        const succeededSelectionKeys = mutationResults
          .filter((item) => item.ok)
          .map((item) => item.selectionKey);
        if (succeededSelectionKeys.length > 0) {
          const succeededSelectionKeySet = toSelectionKeySet(
            succeededSelectionKeys,
          );
          setEntries((current) => {
            if (kind === "delete") {
              return current.filter(
                (entry) =>
                  !succeededSelectionKeySet.has(
                    buildWorkspaceSessionSelectionKey(entry),
                  ),
              );
            }
            if (kind === "move-folder") {
              return current.map((entry) =>
                succeededSelectionKeySet.has(
                  buildWorkspaceSessionSelectionKey(entry),
                )
                  ? { ...entry, folderId: options?.folderId ?? null }
                  : entry,
              );
            }
            if (filters.status === "all") {
              return patchArchivedState(current, mutationResults);
            }
            return current.filter(
              (entry) =>
                !succeededSelectionKeySet.has(
                  buildWorkspaceSessionSelectionKey(entry),
                ),
            );
          });
        }
        return { results: mutationResults };
      } finally {
        setIsMutating(false);
      }
    },
    [filters.status, mode, workspaceId],
  );

  return {
    entries,
    nextCursor,
    partialSource,
    pageLimit,
    error,
    isLoading,
    isLoadingMore,
    isMutating,
    reload,
    loadMore,
    mutate,
  };
}
