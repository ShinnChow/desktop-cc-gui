import type { Dispatch } from "react";
import type {
  DebugEntry,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import { listSessionIndexForWorkspace as listSessionIndexForWorkspaceService } from "../../../services/tauri";
import {
  buildNativeIndexEarlyPaintSummaries,
  projectNativeIndexRowsToSummaries,
  shouldRememberHideUnreadiness,
} from "./useThreadActions.nativeIndexProjection";
import { reconcilePiDerivedHideWithAuthoritativeRows } from "../../pi-session/store/piSessionStore";
import { debugPiSummaryLayerDrops } from "../../pi-session/store/piSidebarDropDiagnostics";
import {
  expandVisibilityHideSet,
  hasVerifiedSharedHide,
  isUsableSharedNativeVisibility,
  lastVerifiedSharedHide,
  rememberVerifiedSharedHideIfComplete,
  unionHideSets,
} from "./sharedNativeVisibility";
import { expandHiddenSharedBindingIds } from "../../shared-session/runtime/sharedSessionSummaries";
import { getCollabWorkerNativeHideIds } from "../../multi-agent/runtime/collabNativeHideRegistry";
import { yieldIfInteractiveInputPending } from "../../../utils/interactiveMainThread";
import {
  threadIdInHiddenSharedBindingSet,
  withTimeout,
} from "./useThreadActions.helpers";
import {
  NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS,
  resolveInitialThreadListTargetCount,
  resolveThreadListCursorForDisplay,
} from "./useThreadActions.threadList";
import type { ThreadAction, ThreadState } from "./useThreadsReducer";

type SessionIndexPage = Awaited<
  ReturnType<typeof listSessionIndexForWorkspaceService>
> | null;

type ThreadListIndexEarlyPaintStageParams = {
  workspace: WorkspaceInfo;
  options?: {
    forceSessionIndexSync?: boolean;
    mergeExistingThreads?: boolean;
    sessionIndexOnly?: boolean;
  };
  defaultVisibleThreadRootCount: number | null;
  isFirstPaintHydration: boolean;
  threadsByWorkspace: ThreadState["threadsByWorkspace"];
  getCustomName: (workspaceId: string, threadId: string) => string | undefined;
  onDebug?: (entry: DebugEntry) => void;
  dispatch: Dispatch<ThreadAction>;
  isLatestThreadListRequest: () => boolean;
  abandonIfStale: () => { applied: false; stale: true } | null;
  rememberPartialSource: (value: unknown) => void;
  getLastGoodThreadSummariesWithoutDeleted: () => ThreadSummary[];
  appliedThreadListUpdate: boolean;
  visibleThreadCount: number;
  authoritativeEmpty: boolean;
};

type ThreadListIndexEarlyPaintStageOutcome =
  | {
      kind: "return";
      value:
        | { applied: false; stale: true }
        | {
            applied: boolean;
            visibleCount: number;
            authoritativeEmpty: boolean;
          };
    }
  | {
      kind: "continue";
      sessionIndexPage: SessionIndexPage;
      earlyIndexPaintApplied: boolean;
      indexVisibility: NonNullable<SessionIndexPage>["visibility"] | null;
      visibilityHideSet: Set<string>;
      verifiedHideSet: Set<string>;
      appliedThreadListUpdate: boolean;
    };

export async function runThreadListIndexEarlyPaintStage({
  workspace,
  options,
  defaultVisibleThreadRootCount,
  isFirstPaintHydration,
  threadsByWorkspace,
  getCustomName,
  onDebug,
  dispatch,
  isLatestThreadListRequest,
  abandonIfStale,
  rememberPartialSource,
  getLastGoodThreadSummariesWithoutDeleted,
  appliedThreadListUpdate,
  visibleThreadCount,
  authoritativeEmpty,
}: ThreadListIndexEarlyPaintStageParams): Promise<ThreadListIndexEarlyPaintStageOutcome> {
  // Session Index: list-level multi-engine source (SQLite).
  // CRITICAL UX: on first-paint, await index FIRST and paint immediately.
  // Do NOT wait for titles/shared/codex live list — that left the sidebar
  // stuck on stale sidebarSnapshot for seconds (user: old list → late correct).
  // One display page (20) per engine feeds the mixed top-20 view; older
  // rows arrive via keyset paging (sidebar 更多).
  const sessionIndexLimit = resolveInitialThreadListTargetCount(
    workspace,
    defaultVisibleThreadRootCount,
  );
  // Only explicit soft re-sync forces writers; cold first-paint must hit
  // warm SQLite (ms) so stale sidebarSnapshot is replaced immediately.
  const forceIndexSync = Boolean(options?.forceSessionIndexSync);
  const sessionIndexTimeoutMs = isFirstPaintHydration
    ? forceIndexSync
      ? 6_000
      : 2_500
    : NATIVE_SESSION_LIST_FETCH_TIMEOUT_MS;
  let sessionIndexPage: Awaited<
    ReturnType<typeof listSessionIndexForWorkspaceService>
  > | null = null;
  if (typeof listSessionIndexForWorkspaceService === "function") {
    sessionIndexPage = await withTimeout(
      listSessionIndexForWorkspaceService(workspace.id, {
        limit: sessionIndexLimit,
        // Warm SQLite should answer without rescan; force only soft re-sync.
        syncIfNeeded: !isFirstPaintHydration,
        forceSync: forceIndexSync,
      })
        .then((page) => page ?? null)
        .catch(() => null),
      sessionIndexTimeoutMs,
    );
    // First-paint 2.5s can expire if a writer is still running. Retry a
    // warm read so already-indexed native PI rows still reach the sidebar.
    if (
      sessionIndexPage === null &&
      isFirstPaintHydration &&
      !forceIndexSync
    ) {
      sessionIndexPage = await withTimeout(
        listSessionIndexForWorkspaceService(workspace.id, {
          limit: sessionIndexLimit,
          syncIfNeeded: false,
          forceSync: false,
        })
          .then((page) => page ?? null)
          .catch(() => null),
        800,
      );
    }
  }
  {
    const abandoned = abandonIfStale();
    if (abandoned) {
      return { kind: "return", value: abandoned };
    }
  }
  // Progressive paint: replace stale snapshot ASAP with index rows.
  // Urgent dispatch (not startTransition) so WebView paints before heavy work.
  // Never paint ordinary native Index rows with an empty/unverified hide set.
  let earlyIndexPaintApplied = false;
  const indexVisibility = sessionIndexPage?.visibility ?? null;
  const visibilityHideSet = expandVisibilityHideSet(indexVisibility);
  const verifiedHideSet = lastVerifiedSharedHide(workspace.id);
  const canProjectIndexNatives =
    isUsableSharedNativeVisibility(indexVisibility) ||
    hasVerifiedSharedHide(workspace.id);
  const earlyPaintHideSet = unionHideSets(
    visibilityHideSet,
    verifiedHideSet,
    expandHiddenSharedBindingIds([...getCollabWorkerNativeHideIds()]),
  );
  rememberVerifiedSharedHideIfComplete(
    workspace.id,
    indexVisibility,
    earlyPaintHideSet,
  );
  // merge(focus-refresh/restore) 路径在「本地还没有任何行」时同样
  // 提前画 index 行:否则冷 workspace 要等整条 merge 管线(引擎探测 +
  // orchestrator 串行)跑完才结束 loading。显隐逻辑与 first-paint 完全
  // 一致(同一 hideSet + hideReady defer + 同一投影函数),只是时机提前;
  // 已有行的 merge 不提前画,避免热路径双重 dispatch churn。
  const mergeColdEarlyPaint =
    !isFirstPaintHydration &&
    options?.mergeExistingThreads === true &&
    (threadsByWorkspace[workspace.id] ?? []).length === 0;
  if (
    sessionIndexPage &&
    Array.isArray(sessionIndexPage.data) &&
    sessionIndexPage.data.length > 0 &&
    ((isFirstPaintHydration && !options?.mergeExistingThreads) ||
      mergeColdEarlyPaint)
  ) {
    if (shouldRememberHideUnreadiness(canProjectIndexNatives)) {
      rememberPartialSource("shared-visibility-unavailable");
    }
    // 自愈：index 权威行证明无 parent 的 pi 主线，立即从内存派生
    // 隐藏集合放归（堵住 fork 静默 no-op 误登记的整局隐藏）。
    reconcilePiDerivedHideWithAuthoritativeRows(sessionIndexPage.data);
    const earlyIndexSummaries = buildNativeIndexEarlyPaintSummaries({
      rows: sessionIndexPage.data,
      workspaceId: workspace.id,
      getCustomName,
      hideSet: earlyPaintHideSet,
      currentThreads: threadsByWorkspace[workspace.id],
      lastGood: getLastGoodThreadSummariesWithoutDeleted(),
      hideReady: canProjectIndexNatives,
    });
    debugPiSummaryLayerDrops(
      "index-early-paint",
      sessionIndexPage.data,
      new Set(earlyIndexSummaries.map((summary) => summary.id)),
      (threadId) =>
        canProjectIndexNatives
          ? threadIdInHiddenSharedBindingSet(threadId, earlyPaintHideSet)
            ? "shared/collab-hide-set"
            : "title-gate"
          : "hide-not-ready-deferral",
    );
    if (earlyIndexSummaries.length > 0) {
      // Urgent early paint still yields one macrotask when a click is
      // pending — WebView2 hit-test starvation freezes harder than a
      // one-tick delay. Staleness is re-checked after the yield below.
      await yieldIfInteractiveInputPending();
    }
    if (earlyIndexSummaries.length > 0 && isLatestThreadListRequest()) {
      dispatch({
        type: "setThreads",
        workspaceId: workspace.id,
        threads: earlyIndexSummaries,
        unionMembership: true,
      });
      earlyIndexPaintApplied = true;
      appliedThreadListUpdate = true;
      onDebug?.({
        id: `${Date.now()}-client-session-index-early-paint`,
        timestamp: Date.now(),
        source: "client",
        label: "thread/list session-index early-paint",
        payload: {
          workspaceId: workspace.id,
          rowCount: earlyIndexSummaries.length,
          source: sessionIndexPage.source,
          syncMs: sessionIndexPage.syncMs ?? null,
          engines: sessionIndexPage.engines,
          visibilityAvailable: Boolean(indexVisibility?.available),
          hiddenCount: earlyPaintHideSet.size,
        },
      });
    }
  } else if (sessionIndexPage === null) {
    rememberPartialSource("session-index-timeout");
  }

  if (options?.sessionIndexOnly) {
    if (sessionIndexPage === null || !Array.isArray(sessionIndexPage.data)) {
      return {
        kind: "return",
        value: { applied: false, visibleCount: 0, authoritativeEmpty: false },
      };
    }
    const hiddenSharedBindingIds = unionHideSets(
      visibilityHideSet,
      verifiedHideSet,
      expandHiddenSharedBindingIds([...getCollabWorkerNativeHideIds()]),
    );
    reconcilePiDerivedHideWithAuthoritativeRows(sessionIndexPage.data);
    const indexSummaries = projectNativeIndexRowsToSummaries(
      sessionIndexPage.data,
      {
        workspaceId: workspace.id,
        mappedTitles: {},
        getCustomName,
        hiddenSharedBindingIds,
      },
    );
    if (isLatestThreadListRequest()) {
      dispatch({
        type: "setThreads",
        workspaceId: workspace.id,
        threads: indexSummaries,
        unionMembership: sessionIndexPage.hasMore === true,
      });
      const oldest = sessionIndexPage.data.at(-1);
      dispatch({
        type: "setThreadListCursor",
        workspaceId: workspace.id,
        cursor: resolveThreadListCursorForDisplay({
          catalogCursor: null,
          catalogPartialSource: null,
          runtimeCursor: null,
          sessionIndexHasMore: sessionIndexPage.hasMore === true,
          sessionIndexOldestKey: oldest
            ? {
                updatedAt: Number(oldest.updatedAt) || 0,
                sessionId: String(oldest.sessionId ?? "").trim(),
              }
            : null,
        }),
      });
      appliedThreadListUpdate = true;
      visibleThreadCount = indexSummaries.length;
      authoritativeEmpty = sessionIndexPage.data.length === 0;
    }
    return {
      kind: "return",
      value: {
        applied: appliedThreadListUpdate,
        visibleCount: visibleThreadCount,
        authoritativeEmpty,
      },
    };
  }
  return {
    kind: "continue",
    sessionIndexPage,
    earlyIndexPaintApplied,
    indexVisibility,
    visibilityHideSet,
    verifiedHideSet,
    appliedThreadListUpdate,
  };
}
