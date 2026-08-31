import type { Dispatch, MutableRefObject } from "react";
import type {
  DebugEntry,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import {
  listGeminiSessions as listGeminiSessionsService,
  listGrokSessions as listGrokSessionsService,
  listKimiSessions as listKimiSessionsService,
  listPiSessions as listPiSessionsService,
  listQoderSessions as listQoderSessionsService,
  listDshSessions as listDshSessionsService,
} from "../../../services/tauri";
import { listSharedSessions as listSharedSessionsService } from "../../shared-session/services/sharedSessions";
import {
  buildNativeOwnerToSharedThreadMap,
  expandHiddenSharedBindingIds,
  normalizeSharedSessionSummaries,
  remapThreadParentsToSharedOwners,
} from "../../shared-session/runtime/sharedSessionSummaries";
import { getCollabWorkerNativeHideIds } from "../../multi-agent/runtime/collabNativeHideRegistry";
import { reconcilePiDerivedHideWithAuthoritativeRows } from "../../pi-session/store/piSessionStore";
import { debugPiSummaryLayerDrops } from "../../pi-session/store/piSidebarDropDiagnostics";
import { applySessionArchiveState } from "./useThreadActions.localState";
import { yieldIfInteractiveInputPending } from "../../../utils/interactiveMainThread";
import {
  QODER_CN_PROVIDER_PROFILE_ID,
  QODER_GLOBAL_PROVIDER_PROFILE_ID,
} from "../constants/codexProviderProfiles";
import { canonicalQoderThreadId } from "../utils/qoderSessionIdentity";
import {
  DSH_SESSION_FETCH_TIMEOUT_MS,
  GEMINI_SESSION_FETCH_TIMEOUT_MS,
  GROK_SESSION_FETCH_TIMEOUT_MS,
  KIMI_SESSION_FETCH_TIMEOUT_MS,
  NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
  PI_SESSION_FETCH_TIMEOUT_MS,
  QODER_SESSION_FETCH_TIMEOUT_MS,
} from "./useThreadActions.threadList";
import {
  mergeDshSessionSummaries,
  mergeGeminiSessionSummaries,
  mergeGrokSessionSummaries,
  mergeKimiSessionSummaries,
  mergePiSessionSummaries,
  mergeQoderSessionSummaries,
  normalizeDshSessionSummaries,
  normalizeGeminiSessionSummaries,
  normalizeGrokSessionSummaries,
  normalizeKimiSessionSummaries,
  normalizePiSessionSummaries,
  normalizeQoderSessionSummaries,
  stripHiddenSharedBindingSummaries,
  threadIdInHiddenSharedBindingSet,
  withTimeout,
  type DshSessionSummary,
  type GeminiSessionSummary,
  type GrokSessionSummary,
  type KimiSessionSummary,
  type PiSessionSummary,
  type QoderSessionSummary,
} from "./useThreadActions.helpers";
import type { ArchivedSessionMapResult } from "./useThreadActionsSessionCatalog";
import type { ThreadAction } from "./useThreadsReducer";

type SessionCacheEntry<T> = { fetchedAt: number; sessions: T[] };

type EngineAsyncSessionMergeParams = {
  workspace: WorkspaceInfo;
  dispatch: Dispatch<ThreadAction>;
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  onDebug?: (entry: DebugEntry) => void;
  isLatestThreadListRequest: () => boolean;
  mappedTitles: Record<string, string>;
  allSummaries: ThreadSummary[];
  hiddenSharedBindingIds: Set<string>;
  latestThreadsByWorkspaceRef: MutableRefObject<
    Record<string, ThreadSummary[]>
  >;
  archivedSessionMapPromise: Promise<ArchivedSessionMapResult | null>;
  includeEngineDiskLists: boolean;
  includePiDiskList: boolean;
  hasGeminiSignal: boolean;
  hasKimiSignal: boolean;
  hasPiSignal: boolean;
  hasQoderSignal: boolean;
  hasGrokSignal: boolean;
  hasDshSignal: boolean;
  cachedGemini: SessionCacheEntry<GeminiSessionSummary>;
  cachedKimi: SessionCacheEntry<KimiSessionSummary>;
  cachedPi: SessionCacheEntry<PiSessionSummary>;
  cachedQoder: SessionCacheEntry<QoderSessionSummary>;
  cachedGrok: SessionCacheEntry<GrokSessionSummary>;
  cachedDsh: SessionCacheEntry<DshSessionSummary>;
  geminiSessionCacheRef: MutableRefObject<
    Record<string, SessionCacheEntry<GeminiSessionSummary>>
  >;
  kimiSessionCacheRef: MutableRefObject<
    Record<string, SessionCacheEntry<KimiSessionSummary>>
  >;
  piSessionCacheRef: MutableRefObject<
    Record<string, SessionCacheEntry<PiSessionSummary>>
  >;
  qoderSessionCacheRef: MutableRefObject<
    Record<string, SessionCacheEntry<QoderSessionSummary>>
  >;
  grokSessionCacheRef: MutableRefObject<
    Record<string, SessionCacheEntry<GrokSessionSummary>>
  >;
  dshSessionCacheRef: MutableRefObject<
    Record<string, SessionCacheEntry<DshSessionSummary>>
  >;
  geminiRefreshAttemptedRef: MutableRefObject<Record<string, boolean>>;
  kimiRefreshAttemptedRef: MutableRefObject<Record<string, boolean>>;
  piRefreshAttemptedRef: MutableRefObject<Record<string, boolean>>;
  qoderRefreshAttemptedRef: MutableRefObject<Record<string, boolean>>;
  grokRefreshAttemptedRef: MutableRefObject<Record<string, boolean>>;
  dshRefreshAttemptedRef: MutableRefObject<Record<string, boolean>>;
};

export function scheduleEngineAsyncSessionMerges({
  workspace,
  dispatch,
  getCustomName,
  onDebug,
  isLatestThreadListRequest,
  mappedTitles,
  allSummaries,
  hiddenSharedBindingIds,
  latestThreadsByWorkspaceRef,
  archivedSessionMapPromise,
  includeEngineDiskLists,
  includePiDiskList,
  hasGeminiSignal,
  hasKimiSignal,
  hasPiSignal,
  hasQoderSignal,
  hasGrokSignal,
  hasDshSignal,
  cachedGemini,
  cachedKimi,
  cachedPi,
  cachedQoder,
  cachedGrok,
  cachedDsh,
  geminiSessionCacheRef,
  kimiSessionCacheRef,
  piSessionCacheRef,
  qoderSessionCacheRef,
  grokSessionCacheRef,
  dshSessionCacheRef,
  geminiRefreshAttemptedRef,
  kimiRefreshAttemptedRef,
  piRefreshAttemptedRef,
  qoderRefreshAttemptedRef,
  grokRefreshAttemptedRef,
  dshRefreshAttemptedRef,
}: EngineAsyncSessionMergeParams): void {
  const hasAttemptedGeminiRefresh =
    geminiRefreshAttemptedRef.current[workspace.id] === true;
  const shouldRefreshGeminiSessions =
    isLatestThreadListRequest() &&
    includeEngineDiskLists &&
    (hasGeminiSignal || !!cachedGemini || !hasAttemptedGeminiRefresh);
  if (shouldRefreshGeminiSessions) {
    void (async () => {
      geminiRefreshAttemptedRef.current[workspace.id] = true;
      const geminiResult = await withTimeout(
        listGeminiSessionsService(workspace.path, 50),
        GEMINI_SESSION_FETCH_TIMEOUT_MS,
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      if (geminiResult === null) {
        onDebug?.({
          id: `${Date.now()}-client-gemini-session-timeout`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/list gemini timeout",
          payload: {
            workspaceId: workspace.id,
            timeoutMs: GEMINI_SESSION_FETCH_TIMEOUT_MS,
          },
        });
        return;
      }
      const normalizedGeminiSessions =
        normalizeGeminiSessionSummaries(geminiResult);
      geminiSessionCacheRef.current[workspace.id] = {
        fetchedAt: Date.now(),
        sessions: normalizedGeminiSessions,
      };
      const currentSnapshot =
        latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
      const baselineSummaries =
        currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
      // Gemini Shared 已退役，但仍走同一 hide 契约，避免 stale set 误注入。
      const sharedSessionsForGeminiHide = normalizeSharedSessionSummaries(
        (await withTimeout(
          listSharedSessionsService(workspace.id).catch(() => []),
          NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
        )) ?? [],
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      // fresh ∪ outer：shared list 失败回空时不得放宽已有 hide 可见性。
      const freshHiddenSharedBindingIds = expandHiddenSharedBindingIds([
        ...sharedSessionsForGeminiHide.flatMap(
          (session) => session.nativeThreadIds,
        ),
        ...hiddenSharedBindingIds,
        ...getCollabWorkerNativeHideIds(),
      ]);
      const nextSummaries = mergeGeminiSessionSummaries(
        baselineSummaries,
        normalizedGeminiSessions.filter(
          (session) =>
            !threadIdInHiddenSharedBindingSet(
              `gemini:${session.sessionId}`,
              freshHiddenSharedBindingIds,
            ),
        ),
        workspace.id,
        mappedTitles,
        getCustomName,
        freshHiddenSharedBindingIds,
      );
      const visibleNextSummaries = applySessionArchiveState(
        stripHiddenSharedBindingSummaries(
          nextSummaries,
          freshHiddenSharedBindingIds,
        ),
        await archivedSessionMapPromise,
      );
      const unchanged =
        visibleNextSummaries.length === baselineSummaries.length &&
        visibleNextSummaries.every((entry, index) => {
          const prev = baselineSummaries[index];
          return (
            !!prev &&
            prev.id === entry.id &&
            prev.name === entry.name &&
            prev.updatedAt === entry.updatedAt &&
            prev.engineSource === entry.engineSource &&
            prev.threadKind === entry.threadKind
          );
        });
      if (!unchanged) {
        // Input-aware batch boundary: let a pending click land before
        // this commit, then re-verify freshness — a newer list request
        // (or soft-cancel) during the yield must win over this apply.
        await yieldIfInteractiveInputPending();
        if (!isLatestThreadListRequest()) {
          return;
        }
        dispatch({
          type: "setThreads",
          workspaceId: workspace.id,
          threads: visibleNextSummaries,
          unionMembership: true,
        });
        latestThreadsByWorkspaceRef.current = {
          ...latestThreadsByWorkspaceRef.current,
          [workspace.id]: visibleNextSummaries,
        };
      }
    })();
  }

  const hasAttemptedKimiRefresh =
    kimiRefreshAttemptedRef.current[workspace.id] === true;
  const shouldRefreshKimiSessions =
    isLatestThreadListRequest() &&
    includeEngineDiskLists &&
    (hasKimiSignal || !!cachedKimi || !hasAttemptedKimiRefresh);
  const hasAttemptedGrokRefresh =
    grokRefreshAttemptedRef.current[workspace.id] === true;
  const shouldRefreshGrokSessions =
    isLatestThreadListRequest() &&
    includeEngineDiskLists &&
    (hasGrokSignal || !!cachedGrok || !hasAttemptedGrokRefresh);
  const hasAttemptedDshRefresh =
    dshRefreshAttemptedRef.current[workspace.id] === true;
  // Sidebar first-paint / Index soft re-sync never probes DSH host.
  // Disk/host list is opt-in only (tests / Session Management).
  const shouldRefreshDshSessions =
    isLatestThreadListRequest() &&
    includeEngineDiskLists &&
    (hasDshSignal || !!cachedDsh || !hasAttemptedDshRefresh);
  if (shouldRefreshGrokSessions) {
    void (async () => {
      grokRefreshAttemptedRef.current[workspace.id] = true;
      const grokResult = await withTimeout(
        listGrokSessionsService(workspace.path, 50),
        GROK_SESSION_FETCH_TIMEOUT_MS,
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      if (grokResult === null) {
        onDebug?.({
          id: `${Date.now()}-client-grok-session-timeout`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/list grok timeout",
          payload: {
            workspaceId: workspace.id,
            timeoutMs: GROK_SESSION_FETCH_TIMEOUT_MS,
          },
        });
        return;
      }
      const normalizedGrokSessions =
        normalizeGrokSessionSummaries(grokResult);
      grokSessionCacheRef.current[workspace.id] = {
        fetchedAt: Date.now(),
        sessions: normalizedGrokSessions,
      };
      const currentSnapshot =
        latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
      const baselineSummaries =
        currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
      // 异步 refresh 时 binding 可能已 materialize；必须重建 hide set，
      // 禁止复用 listThreads 开头的 stale 闭包（创建 Shared 时往往是空集）。
      const sharedSessionsForRemap = normalizeSharedSessionSummaries(
        (await withTimeout(
          listSharedSessionsService(workspace.id).catch(() => []),
          NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
        )) ?? [],
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      // fresh ∪ outer：shared list 失败回空时不得放宽已有 hide 可见性。
      const freshHiddenSharedBindingIds = expandHiddenSharedBindingIds([
        ...sharedSessionsForRemap.flatMap((session) => session.nativeThreadIds),
        ...hiddenSharedBindingIds,
        ...getCollabWorkerNativeHideIds(),
      ]);
      const nativeOwnerToShared =
        buildNativeOwnerToSharedThreadMap(sharedSessionsForRemap);
      const nextSummaries = mergeGrokSessionSummaries(
        baselineSummaries,
        normalizedGrokSessions.filter(
          (session) =>
            !threadIdInHiddenSharedBindingSet(
              `grok:${session.sessionId}`,
              freshHiddenSharedBindingIds,
            ),
        ),
        workspace.id,
        mappedTitles,
        getCustomName,
        nativeOwnerToShared,
        freshHiddenSharedBindingIds,
      );
      const visibleNextSummaries = applySessionArchiveState(
        stripHiddenSharedBindingSummaries(
          nextSummaries,
          freshHiddenSharedBindingIds,
        ),
        await archivedSessionMapPromise,
      );
      const unchanged =
        visibleNextSummaries.length === baselineSummaries.length &&
        visibleNextSummaries.every((entry, index) => {
          const prev = baselineSummaries[index];
          return (
            !!prev &&
            prev.id === entry.id &&
            prev.name === entry.name &&
            prev.updatedAt === entry.updatedAt &&
            prev.engineSource === entry.engineSource &&
            prev.threadKind === entry.threadKind &&
            (prev.parentThreadId ?? null) === (entry.parentThreadId ?? null)
          );
        });
      if (!unchanged) {
        // Input-aware batch boundary: let a pending click land before
        // this commit, then re-verify freshness — a newer list request
        // (or soft-cancel) during the yield must win over this apply.
        await yieldIfInteractiveInputPending();
        if (!isLatestThreadListRequest()) {
          return;
        }
        dispatch({
          type: "setThreads",
          workspaceId: workspace.id,
          threads: visibleNextSummaries,
          unionMembership: true,
        });
        latestThreadsByWorkspaceRef.current = {
          ...latestThreadsByWorkspaceRef.current,
          [workspace.id]: visibleNextSummaries,
        };
      }
    })();
  }
  if (shouldRefreshKimiSessions) {
    void (async () => {
      kimiRefreshAttemptedRef.current[workspace.id] = true;
      const kimiResult = await withTimeout(
        listKimiSessionsService(workspace.path, 50),
        KIMI_SESSION_FETCH_TIMEOUT_MS,
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      if (kimiResult === null) {
        onDebug?.({
          id: `${Date.now()}-client-kimi-session-timeout`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/list kimi timeout",
          payload: {
            workspaceId: workspace.id,
            timeoutMs: KIMI_SESSION_FETCH_TIMEOUT_MS,
          },
        });
        return;
      }
      const normalizedKimiSessions =
        normalizeKimiSessionSummaries(kimiResult);
      kimiSessionCacheRef.current[workspace.id] = {
        fetchedAt: Date.now(),
        sessions: normalizedKimiSessions,
      };
      const currentSnapshot =
        latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
      const baselineSummaries =
        currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
      // 与 Grok 同构：异步路径用 fresh hide set，避免 pending→established
      // rebind 后仍按 list 开头的空/旧 hide set 注入 native 行。
      const sharedSessionsForKimiHide = normalizeSharedSessionSummaries(
        (await withTimeout(
          listSharedSessionsService(workspace.id).catch(() => []),
          NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
        )) ?? [],
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      // fresh ∪ outer：shared list 失败回空时不得放宽已有 hide 可见性。
      const freshHiddenSharedBindingIds = expandHiddenSharedBindingIds([
        ...sharedSessionsForKimiHide.flatMap(
          (session) => session.nativeThreadIds,
        ),
        ...hiddenSharedBindingIds,
        ...getCollabWorkerNativeHideIds(),
      ]);
      const nativeOwnerToSharedKimi =
        buildNativeOwnerToSharedThreadMap(sharedSessionsForKimiHide);
      // 与 Grok 异步路径对齐：merge 后 parent-id 改挂 shared:（有 parent 才生效）
      const nextSummaries = remapThreadParentsToSharedOwners(
        mergeKimiSessionSummaries(
          baselineSummaries,
          normalizedKimiSessions.filter(
            (session) =>
              !threadIdInHiddenSharedBindingSet(
                `kimi:${session.sessionId}`,
                freshHiddenSharedBindingIds,
              ),
          ),
          workspace.id,
          mappedTitles,
          getCustomName,
          freshHiddenSharedBindingIds,
        ),
        nativeOwnerToSharedKimi,
      );
      const visibleNextSummaries = applySessionArchiveState(
        stripHiddenSharedBindingSummaries(
          nextSummaries,
          freshHiddenSharedBindingIds,
        ),
        await archivedSessionMapPromise,
      );
      const unchanged =
        visibleNextSummaries.length === baselineSummaries.length &&
        visibleNextSummaries.every((entry, index) => {
          const prev = baselineSummaries[index];
          return (
            !!prev &&
            prev.id === entry.id &&
            prev.name === entry.name &&
            prev.updatedAt === entry.updatedAt &&
            prev.engineSource === entry.engineSource &&
            prev.threadKind === entry.threadKind &&
            (prev.parentThreadId ?? null) === (entry.parentThreadId ?? null)
          );
        });
      if (!unchanged) {
        // Input-aware batch boundary: let a pending click land before
        // this commit, then re-verify freshness — a newer list request
        // (or soft-cancel) during the yield must win over this apply.
        await yieldIfInteractiveInputPending();
        if (!isLatestThreadListRequest()) {
          return;
        }
        dispatch({
          type: "setThreads",
          workspaceId: workspace.id,
          threads: visibleNextSummaries,
          unionMembership: true,
        });
        latestThreadsByWorkspaceRef.current = {
          ...latestThreadsByWorkspaceRef.current,
          [workspace.id]: visibleNextSummaries,
        };
      }
    })();
  }
  if (shouldRefreshDshSessions) {
    void (async () => {
      dshRefreshAttemptedRef.current[workspace.id] = true;
      const dshResult = await withTimeout(
        listDshSessionsService(workspace.path, 50),
        DSH_SESSION_FETCH_TIMEOUT_MS,
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      if (dshResult === null) {
        onDebug?.({
          id: `${Date.now()}-client-dsh-session-timeout`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/list dsh timeout",
          payload: {
            workspaceId: workspace.id,
            timeoutMs: DSH_SESSION_FETCH_TIMEOUT_MS,
          },
        });
        return;
      }
      const normalizedDshSessions =
        normalizeDshSessionSummaries(dshResult);
      dshSessionCacheRef.current[workspace.id] = {
        fetchedAt: Date.now(),
        sessions: normalizedDshSessions,
      };
      const currentSnapshot =
        latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
      const baselineSummaries =
        currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
      const nextSummaries = mergeDshSessionSummaries(
        baselineSummaries,
        normalizedDshSessions.filter(
          (session) =>
            !threadIdInHiddenSharedBindingSet(
              `dsh:${session.sessionId}`,
              hiddenSharedBindingIds,
            ),
        ),
        workspace.id,
        mappedTitles,
        getCustomName,
        hiddenSharedBindingIds,
      );
      const visibleNextSummaries = applySessionArchiveState(
        stripHiddenSharedBindingSummaries(
          nextSummaries,
          hiddenSharedBindingIds,
        ),
        await archivedSessionMapPromise,
      );
      const unchanged =
        visibleNextSummaries.length === baselineSummaries.length &&
        visibleNextSummaries.every((entry, index) => {
          const prev = baselineSummaries[index];
          return (
            !!prev &&
            prev.id === entry.id &&
            prev.name === entry.name &&
            prev.updatedAt === entry.updatedAt &&
            prev.engineSource === entry.engineSource &&
            prev.threadKind === entry.threadKind
          );
        });
      if (!unchanged) {
        await yieldIfInteractiveInputPending();
        if (!isLatestThreadListRequest()) {
          return;
        }
        dispatch({
          type: "setThreads",
          workspaceId: workspace.id,
          threads: visibleNextSummaries,
          unionMembership: true,
        });
        latestThreadsByWorkspaceRef.current = {
          ...latestThreadsByWorkspaceRef.current,
          [workspace.id]: visibleNextSummaries,
        };
      }
    })();
  }
  const hasAttemptedPiRefresh =
    piRefreshAttemptedRef.current[workspace.id] === true;
  // Same as DSH: first-paint never probes PI disk. Index is the read layer.
  const shouldRefreshPiSessions =
    isLatestThreadListRequest() &&
    includePiDiskList &&
    (hasPiSignal || !!cachedPi || !hasAttemptedPiRefresh);
  if (shouldRefreshPiSessions) {
    void (async () => {
      piRefreshAttemptedRef.current[workspace.id] = true;
      const piResult = await withTimeout(
        listPiSessionsService(workspace.path, 50),
        PI_SESSION_FETCH_TIMEOUT_MS,
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      if (piResult === null) {
        onDebug?.({
          id: `${Date.now()}-client-pi-session-timeout`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/list pi timeout",
          payload: {
            workspaceId: workspace.id,
            timeoutMs: PI_SESSION_FETCH_TIMEOUT_MS,
          },
        });
        return;
      }
      const normalizedPiSessions = normalizePiSessionSummaries(piResult);
      // 自愈：磁盘 list 是 pi 血缘权威——无 parentSession 的主线立即放归。
      reconcilePiDerivedHideWithAuthoritativeRows(normalizedPiSessions);
      piSessionCacheRef.current[workspace.id] = {
        fetchedAt: Date.now(),
        sessions: normalizedPiSessions,
      };
      const currentSnapshot =
        latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
      const baselineSummaries =
        currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
      const sharedSessionsForPiHide = normalizeSharedSessionSummaries(
        (await withTimeout(
          listSharedSessionsService(workspace.id).catch(() => []),
          NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
        )) ?? [],
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      const freshHiddenSharedBindingIds = expandHiddenSharedBindingIds([
        ...sharedSessionsForPiHide.flatMap(
          (session) => session.nativeThreadIds,
        ),
        ...hiddenSharedBindingIds,
        ...getCollabWorkerNativeHideIds(),
      ]);
      const nextSummaries = mergePiSessionSummaries(
        baselineSummaries,
        normalizedPiSessions.filter(
          (session) =>
            !threadIdInHiddenSharedBindingSet(
              `pi:${session.sessionId}`,
              freshHiddenSharedBindingIds,
            ),
        ),
        workspace.id,
        mappedTitles,
        getCustomName,
        freshHiddenSharedBindingIds,
      );
      debugPiSummaryLayerDrops(
        "pi-disk-list-merge",
        normalizedPiSessions,
        new Set(nextSummaries.map((summary) => summary.id)),
      );
      const visibleNextSummaries = applySessionArchiveState(
        stripHiddenSharedBindingSummaries(
          nextSummaries,
          freshHiddenSharedBindingIds,
        ),
        await archivedSessionMapPromise,
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      dispatch({
        type: "setThreads",
        workspaceId: workspace.id,
        threads: visibleNextSummaries,
        unionMembership: true,
      });
      latestThreadsByWorkspaceRef.current = {
        ...latestThreadsByWorkspaceRef.current,
        [workspace.id]: visibleNextSummaries,
      };
    })();
  }
  const hasAttemptedQoderRefresh =
    qoderRefreshAttemptedRef.current[workspace.id] === true;
  const shouldRefreshQoderSessions =
    isLatestThreadListRequest() &&
    includeEngineDiskLists &&
    (hasQoderSignal || !!cachedQoder || !hasAttemptedQoderRefresh);
  if (shouldRefreshQoderSessions) {
    void (async () => {
      qoderRefreshAttemptedRef.current[workspace.id] = true;
      const qoderResults = await withTimeout(
        Promise.all([
          listQoderSessionsService(
            workspace.path,
            50,
            QODER_GLOBAL_PROVIDER_PROFILE_ID,
          ),
          listQoderSessionsService(
            workspace.path,
            50,
            QODER_CN_PROVIDER_PROFILE_ID,
          ),
        ]),
        QODER_SESSION_FETCH_TIMEOUT_MS,
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      if (qoderResults === null) {
        onDebug?.({
          id: `${Date.now()}-client-qoder-session-timeout`,
          timestamp: Date.now(),
          source: "client",
          label: "thread/list qoder timeout",
          payload: {
            workspaceId: workspace.id,
            timeoutMs: QODER_SESSION_FETCH_TIMEOUT_MS,
          },
        });
        return;
      }
      const normalizedQoderSessions = [
        ...normalizeQoderSessionSummaries(
          qoderResults[0],
          QODER_GLOBAL_PROVIDER_PROFILE_ID,
        ),
        ...normalizeQoderSessionSummaries(
          qoderResults[1],
          QODER_CN_PROVIDER_PROFILE_ID,
        ),
      ];
      qoderSessionCacheRef.current[workspace.id] = {
        fetchedAt: Date.now(),
        sessions: normalizedQoderSessions,
      };
      const currentSnapshot =
        latestThreadsByWorkspaceRef.current[workspace.id] ?? [];
      const baselineSummaries =
        currentSnapshot.length > 0 ? currentSnapshot : allSummaries;
      const sharedSessionsForQoderHide = normalizeSharedSessionSummaries(
        (await withTimeout(
          listSharedSessionsService(workspace.id).catch(() => []),
          NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
        )) ?? [],
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      const freshHiddenSharedBindingIds = expandHiddenSharedBindingIds([
        ...sharedSessionsForQoderHide.flatMap(
          (session) => session.nativeThreadIds,
        ),
        ...hiddenSharedBindingIds,
        ...getCollabWorkerNativeHideIds(),
      ]);
      const nextSummaries = mergeQoderSessionSummaries(
        baselineSummaries,
        normalizedQoderSessions.filter((session) => {
          const threadId = canonicalQoderThreadId(
            session.sessionId,
            session.providerProfileId,
          );
          return (
            !!threadId &&
            !threadIdInHiddenSharedBindingSet(
              threadId,
              freshHiddenSharedBindingIds,
            )
          );
        }),
        workspace.id,
        mappedTitles,
        getCustomName,
        freshHiddenSharedBindingIds,
      );
      const visibleNextSummaries = applySessionArchiveState(
        stripHiddenSharedBindingSummaries(
          nextSummaries,
          freshHiddenSharedBindingIds,
        ),
        await archivedSessionMapPromise,
      );
      if (!isLatestThreadListRequest()) {
        return;
      }
      dispatch({
        type: "setThreads",
        workspaceId: workspace.id,
        threads: visibleNextSummaries,
        unionMembership: true,
      });
      latestThreadsByWorkspaceRef.current = {
        ...latestThreadsByWorkspaceRef.current,
        [workspace.id]: visibleNextSummaries,
      };
    })();
  }
}
