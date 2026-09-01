import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { useRenderScheduler } from "../../hooks/useRenderScheduler";
import type { MutableRefObject } from "react";
import type { WorkspaceInfo } from "../../types";
import {
  startupOrchestrator,
  type StartupTaskDescriptor,
} from "../../features/startup-orchestration/utils/startupOrchestrator";
import {
  getStartupTraceSnapshot,
  recordStartupMilestone,
  type StartupMilestoneName,
} from "../../features/startup-orchestration/utils/startupTrace";
import {
  isStartupForceEntered,
  registerStartupIdleHydrationCancel,
  subscribeStartupForceEnter,
} from "../../features/startup-orchestration/utils/startupForceEnter";
import {
  clearFullCatalogAutoRetryCooldown,
  isFullCatalogAutoRetryBlocked,
  noteFullCatalogAutoRetrySuccess,
  noteFullCatalogAutoRetryTimeout,
} from "../../features/startup-orchestration/utils/fullCatalogAutoRetry";
import {
  clearFullCatalogFresh,
  isFullCatalogFresh,
  markFullCatalogFresh,
} from "../../features/startup-orchestration/utils/fullCatalogFreshness";
import { stampStartupGateReady } from "../../features/startup-orchestration/utils/startupGateReady";
import { shouldSkipWorkspaceThreadListLoad } from "./workspaceThreadListLoadGuard";
import {
  ensureInteractiveInputHooks,
  hadRecentInteractiveInput,
  scheduleWhenInteractiveQuiet,
} from "../../utils/interactiveMainThread";

function hasStartupGateReady(): boolean {
  return Boolean(getStartupTraceSnapshot().milestones["startup-gate-ready"]);
}

/**
 * Cold-start list guard until gate-ready / force-enter:
 * - only the current active workspace may hydrate (first-paint or full)
 * - no active yet → block all (wait for active assignment)
 * After active first-paint, a quiet idle Index soft re-sync is scheduled once
 * so the sidebar picks up CLI-created rows without a multi-engine catalog scan.
 * Background workspaces stay cold until explicit expand / Session Management.
 */
function isColdStartListGuardActive(): boolean {
  return !hasStartupGateReady() && !isStartupForceEntered();
}

function shouldSkipWorkspaceDuringColdStart(
  workspaceId: string,
  activeWorkspaceId: string | null,
): boolean {
  if (!isColdStartListGuardActive()) {
    return false;
  }
  // Home has no active-list cold-start owner. Explicit on-demand/session-radar
  // requests remain allowed; background auto full-catalog is still gated.
  if (!activeWorkspaceId) {
    return false;
  }
  return workspaceId !== activeWorkspaceId;
}

type ListThreadsForWorkspace = (
  workspace: WorkspaceInfo,
  options?: {
    preserveState?: boolean;
    includeOpenCodeSessions?: boolean;
    deletedThreadIds?: string[];
    /** 归档摘行：仅本地移除 deletedThreadIds，零 IPC / 零 catalog 重扫。 */
    localRemovalOnly?: boolean;
    startupHydrationMode?: "full-catalog" | "first-paint";
    allowRuntimeReconnect?: boolean;
    /**
     * Soft recovery callers (focus-refresh) must not re-run multi-engine
     * full-catalog while the catalog is still fresh after a successful settle.
     */
    recoverySource?: string;
    /** Quiet post-first-paint index re-scan (writers), not cold first paint. */
    forceSessionIndexSync?: boolean;
    includeEngineDiskLists?: boolean;
    /** 只补 pi 单引擎盘扫（首刷后后台软刷）：独立 pi main 必须可达。 */
    includePiDiskList?: boolean;
    /** 与 includePiDiskList 同形：omp 单引擎盘扫（pi-family 独立 main）。 */
    includeOmpDiskList?: boolean;
    /** Importer refresh: merge SQLite rows onto the current list. */
    mergeExistingThreads?: boolean;
    /** When true mid-flight, list apply must no-op (workspace cancelled/switched). */
    isStale?: () => boolean;
  },
) => Promise<void | {
  applied?: boolean;
  stale?: boolean;
  visibleCount?: number;
  authoritativeEmpty?: boolean;
}>;

type UseWorkspaceThreadListHydrationOptions = {
  activeWorkspaceId: string | null;
  activeWorkspaceProjectionOwnerIds: readonly string[];
  listThreadsForWorkspace: ListThreadsForWorkspace;
  threadListLoadingByWorkspace: Record<string, boolean>;
  workspaces: WorkspaceInfo[];
  workspacesById: Map<string, WorkspaceInfo>;
};

type UseWorkspaceThreadListHydrationResult = {
  ensureWorkspaceThreadListLoaded: (
    workspaceId: string,
    options?: {
      preserveState?: boolean;
      force?: boolean;
      deletedThreadIds?: string[];
      /** 归档摘行：仅本地移除 deletedThreadIds，零 IPC / 零 catalog 重扫。 */
      localRemovalOnly?: boolean;
      startupHydrationMode?: "full-catalog" | "first-paint";
      mergeExistingThreads?: boolean;
    },
  ) => boolean;
  /** Immutable snapshot identity for UI (memo-safe). Prefer this over the ref for render props. */
  hydratedThreadListWorkspaceIds: ReadonlySet<string>;
  hydratedThreadListWorkspaceIdsRef: MutableRefObject<Set<string>>;
  listThreadsForWorkspaceTracked: ListThreadsForWorkspace;
  prewarmSessionRadarForWorkspace: (workspaceId: string) => void;
};

type ThreadHydrationPhase = "active-workspace" | "idle-prewarm" | "on-demand";
type ThreadHydrationKind = "full-catalog" | "session-radar" | "first-paint";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IS_VITEST =
  typeof import.meta !== "undefined" &&
  (import.meta as any).env?.MODE === "test";

/**
 * Cold-start / first bind / Cmd+R: do not start first-paint until the user has
 * been quiet. Rapid click after reload freezes WebView when list IPC + setThreads
 * overlap hit-test (field repro).
 * @internal exported for tests
 */
/**
 * Cold start used to wait 1.5s before any list work so clicks wouldn't race
 * setThreads. That left stale sidebarSnapshot visible far too long.
 * Session Index early-paint is cheap; start almost immediately when we already
 * have a cached list that needs correcting.
 */
export const COLD_START_IDLE_MIN_DELAY_MS = IS_VITEST ? 0 : 120;
/** Must stay quiet this long before auto first-paint may start. */
export const COLD_START_INPUT_QUIET_MS = IS_VITEST ? 0 : 80;
/** Absolute ceiling so list still converges if the user never stops clicking. */
export const COLD_START_IDLE_TIMEOUT_MS = IS_VITEST ? 0 : 15_000;
/**
 * User switched workspace (A→B): short intent delay, still quiet-gated slightly.
 * @internal exported for tests
 */
export const WORKSPACE_SWITCH_INTENT_DELAY_MS = IS_VITEST ? 0 : 100;
export const WORKSPACE_SWITCH_INPUT_QUIET_MS = IS_VITEST ? 0 : 300;

/**
 * After active first-paint: quiet-gated Session Index soft re-sync (writers),
 * not exhaustive full-catalog. Force refresh still uses full-catalog.
 * @internal exported for tests
 */
export const POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MIN_DELAY_MS = IS_VITEST
  ? 0
  : 800;
export const POST_FIRST_PAINT_INDEX_SOFT_RESYNC_QUIET_MS = IS_VITEST ? 0 : 600;
export const POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_WAIT_MS = IS_VITEST
  ? 0
  : 8_000;

/**
 * Pointer soft-cancel keeps clicks ahead of the post-first-paint Index
 * soft re-sync, but a user who never stops clicking would starve it via a
 * cancel → quiet re-arm loop. Cap consecutive deferrals: after MAX_DEFERS
 * soft-cancels or MAX_DEFER_WINDOW_MS since the first defer (whichever hits
 * first), re-arm quiet-only — the run waits for the first real quiet window
 * instead of forcing through mid-click (F1: a forced second-level writer
 * rescan inside a click storm is worse than a delayed convergence; the
 * importer poll and explicit force reload still cover new-session pickup).
 * @internal exported for tests
 */
export const POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS = 3;
export const POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFER_WINDOW_MS = 8_000;

/**
 * unconfirmed-empty settle 未证实（失败 / 超时 / 仍非权威空）后，保持 loading
 * 等 importer 填行（session-index-imported → ensure 会合行并标 hydrated）的
 * 宽限期；到期仍未见行则兜底标 hydrated 终态——真空 workspace 不永生 loading
 * （「暂无会话」占位已下线，终态即空白）。
 * @internal exported for tests
 */
export const EMPTY_SETTLE_LOADING_GRACE_MS = IS_VITEST ? 50 : 20_000;

/** @deprecated Prefer COLD_START_IDLE_* / WORKSPACE_SWITCH_INTENT_DELAY_MS */


function isDiscardedStaleHydrationResult(
  result: ThreadListHydrationResult,
): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    result.applied === false &&
    result.stale === true
  );
}

function isTimeoutHydrationResult(result: ThreadListHydrationResult): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    "timeout" in result &&
    (result as { timeout?: boolean }).timeout === true
  );
}

function hasRecordedActiveWorkspaceReady() {
  return Boolean(
    getStartupTraceSnapshot().milestones[ACTIVE_WORKSPACE_READY_MILESTONE],
  );
}

function createThreadHydrationTask(
  workspace: WorkspaceInfo,
  phase: ThreadHydrationPhase,
  kind: ThreadHydrationKind,
  run: (
    context: Parameters<
      StartupTaskDescriptor<ThreadListHydrationResult>["run"]
    >[0],
  ) => Promise<ThreadListHydrationResult>,
): StartupTaskDescriptor<ThreadListHydrationResult> {
  const dedupeKey = `thread-list:${kind}:${workspace.id}`;
  return {
    id: `thread-list:${kind}:${workspace.id}`,
    phase,
    priority:
      kind === "first-paint"
        ? 95
        : phase === "active-workspace"
          ? 90
          : phase === "on-demand"
            ? 85
            : kind === "session-radar"
              ? 30
              : 20,
    dedupeKey,
    concurrencyKey: "thread-session-scan",
    timeoutMs:
      kind === "first-paint"
        ? 8_000
        : phase === "active-workspace"
          ? 12_000
          : 20_000,
    workspaceScope: { workspaceId: workspace.id },
    // soft-ignore: timeout/cancel settle UI without hard-aborting native IPC,
    // but run() + list apply must honor isStale so late setThreads do not
    // storm the main thread after the user already moved on.
    cancelPolicy: "soft-ignore",
    traceLabel:
      kind === "session-radar"
        ? "session-radar workspace prewarm"
        : kind === "first-paint"
          ? "thread/list first-paint hydration"
          : `thread/list ${kind} hydration`,
    commandLabel: "list_threads",
    run,
    fallback: (reason) => {
      // cancelAllTasks / cancelWorkspaceTasks / abort: all must look "stale"
      // so finally skips publish-hydrate + full-catalog re-schedule.
      if (reason === "stale" || reason === "cancelled") {
        return { applied: false, stale: true };
      }
      // timeout/failure: distinguish from successful void so cooldown can apply
      // without treating every successful list (void) as timeout.
      if (reason === "timeout") {
        return { applied: false, stale: false, timeout: true };
      }
      return { applied: false, stale: false, timeout: false };
    },
  };
}

function publishHydrationUiState(
  setHydrated: (next: Set<string>) => void,
  nextHydrated: Set<string>,
): void {
  // Background lane — clicks stay urgent.
  startTransition(() => {
    setHydrated(nextHydrated);
  });
}

type ThreadListHydrationResult = void | {
  applied?: boolean;
  stale?: boolean;
  timeout?: boolean;
  visibleCount?: number;
  authoritativeEmpty?: boolean;
};
const ACTIVE_WORKSPACE_READY_MILESTONE: StartupMilestoneName =
  "active-workspace-ready";
const IDLE_PREWARM_DELAY_MS = 120;

/**
 * Publish a new Set identity so memo(Sidebar) can see hydration progress.
 * Mutating a shared Set in place is not enough:
 * layout passes the same Set reference into a memoized Sidebar and the
 * "加载中…" placeholder never leaves even after orchestrator timeout.
 */
function publishHydratedWorkspaceId(
  targetRef: MutableRefObject<Set<string>>,
  workspaceId: string,
): Set<string> {
  if (targetRef.current.has(workspaceId)) {
    return targetRef.current;
  }
  const next = new Set(targetRef.current);
  next.add(workspaceId);
  targetRef.current = next;
  return next;
}

export function useWorkspaceThreadListHydration({
  activeWorkspaceId,
  activeWorkspaceProjectionOwnerIds,
  listThreadsForWorkspace,
  threadListLoadingByWorkspace,
  workspacesById,
}: UseWorkspaceThreadListHydrationOptions): UseWorkspaceThreadListHydrationResult {
  const hydratedThreadListWorkspaceIdsRef = useRef(new Set<string>());
  const fullyHydratedThreadListWorkspaceIdsRef = useRef(new Set<string>());
  const hydratingThreadListWorkspaceIdsRef = useRef(new Set<string>());
  const hydrationPhaseByWorkspaceIdRef = useRef(
    new Map<string, ThreadHydrationPhase>(),
  );
  const hydrationKindByWorkspaceIdRef = useRef(
    new Map<string, ThreadHydrationKind>(),
  );
  const autoHydratedActiveWorkspaceIdRef = useRef<string | null>(null);
  const previousActiveWorkspaceIdRef = useRef<string | null>(null);
  const activeWorkspaceIdRef = useRef(activeWorkspaceId);
  activeWorkspaceIdRef.current = activeWorkspaceId;
  /** Pending cold-idle or intent-timer for auto first-paint (not session-radar). */
  const pendingAutoFirstPaintCleanupRef = useRef<(() => void) | null>(null);
  /** Re-arm quiet first-paint after pointer soft-cancel during cold window. */
  const rescheduleAutoFirstPaintRef = useRef<(() => void) | null>(null);
  const ensureWorkspaceThreadListLoadedRef = useRef<
    | ((
        workspaceId: string,
        options?: {
          preserveState?: boolean;
          force?: boolean;
          deletedThreadIds?: string[];
        },
      ) => void)
    | null
  >(null);
  /** Quiet idle Index soft re-sync after active first-paint (or force-enter re-arm). */
  const pendingPostFirstPaintIndexSoftResyncCleanupRef = useRef<
    (() => void) | null
  >(null);
  const postFirstPaintIndexSoftResyncTargetIdRef = useRef<string | null>(null);
  /** Workspaces that already had a post-first-paint Index soft re-sync scheduled. */
  const postFirstPaintIndexSoftResyncArmedIdsRef = useRef(new Set<string>());
  /**
   * In-flight post-first-paint soft re-sync target. This run is a raw
   * listThreadsForWorkspace call (off-orchestrator), so pointer soft-cancel
   * uses the generation guard below instead of cancelWorkspaceTasks.
   */
  const postFirstPaintIndexSoftResyncInFlightIdRef = useRef<string | null>(
    null,
  );
  /** Bumped by pointer soft-cancel so the orphan's late setThreads no-op via isStale. */
  const postFirstPaintIndexSoftResyncGenerationRef = useRef(0);
  /** Consecutive input-driven deferrals of the post-first-paint Index soft re-sync. */
  const postFirstPaintIndexSoftResyncDeferCountRef = useRef(0);
  const postFirstPaintIndexSoftResyncFirstDeferAtRef = useRef(0);
  const idleHydrationCleanupByWorkspaceIdRef = useRef(
    new Map<string, () => void>(),
  );
  // State carries the published Set identity for consumers (Sidebar via layout).
  // Ref stays the sync source of truth for in-flight guards.
  const [hydratedThreadListWorkspaceIds, setHydratedThreadListWorkspaceIds] =
    useState<ReadonlySet<string>>(
      () => hydratedThreadListWorkspaceIdsRef.current,
    );
  // loading 阶段文案由 ThreadLoadingState 本地计时切换，此处不维护 phase 状态。
  /** settle 未证实后的宽限定时器（兜底终态，防永生 loading）。 */
  const emptySettleGraceCleanupByWorkspaceIdRef = useRef(
    new Map<string, () => void>(),
  );

  const cancelEmptySettleGrace = useCallback((workspaceId: string) => {
    const cancel =
      emptySettleGraceCleanupByWorkspaceIdRef.current.get(workspaceId);
    if (cancel) {
      cancel();
      emptySettleGraceCleanupByWorkspaceIdRef.current.delete(workspaceId);
    }
  }, []);

  /** hydrated 终态统一出口：标 hydrated + 取消宽限。 */
  const markWorkspaceThreadListHydrated = useCallback(
    (workspaceId: string) => {
      cancelEmptySettleGrace(workspaceId);
      const nextHydrated = publishHydratedWorkspaceId(
        hydratedThreadListWorkspaceIdsRef,
        workspaceId,
      );
      publishHydrationUiState(setHydratedThreadListWorkspaceIds, nextHydrated);
    },
    [cancelEmptySettleGrace],
  );

  const armEmptySettleGrace = useCallback(
    (workspaceId: string) => {
      cancelEmptySettleGrace(workspaceId);
      if (hydratedThreadListWorkspaceIdsRef.current.has(workspaceId)) {
        return;
      }
      const timer = setTimeout(() => {
        emptySettleGraceCleanupByWorkspaceIdRef.current.delete(workspaceId);
        markWorkspaceThreadListHydrated(workspaceId);
      }, EMPTY_SETTLE_LOADING_GRACE_MS);
      emptySettleGraceCleanupByWorkspaceIdRef.current.set(workspaceId, () =>
        clearTimeout(timer),
      );
    },
    [cancelEmptySettleGrace, markWorkspaceThreadListHydrated],
  );
  const renderScheduler = useRenderScheduler({
    budgetMs: 0,
    idleTimeoutMs: IDLE_PREWARM_DELAY_MS,
  });
  const scheduleIdleHydration = useCallback(
    (callback: () => void): (() => void) => {
      let cancelled = false;
      renderScheduler.scheduleChunk(() => {
        if (cancelled) {
          return false;
        }
        callback();
        return false;
      });
      return () => {
        cancelled = true;
      };
    },
    [renderScheduler],
  );

  const cancelPendingPostFirstPaintIndexSoftResync = useCallback(() => {
    pendingPostFirstPaintIndexSoftResyncCleanupRef.current?.();
    pendingPostFirstPaintIndexSoftResyncCleanupRef.current = null;
    postFirstPaintIndexSoftResyncTargetIdRef.current = null;
  }, []);

  /**
   * Soft path: first-paint again with preserveState so Session Index can
   * re-sync (fingerprint window / force) without OpenCode full fan-out.
   * Tracked in-flight + generation-guarded so a post-gate pointerdown can
   * soft-cancel the late apply exactly like an orchestrator soft-ignore.
   */
  const runPostFirstPaintIndexSoftResync = useCallback(
    (workspaceId: string) => {
      if (activeWorkspaceIdRef.current !== workspaceId) {
        return;
      }
      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        return;
      }
      const generation = ++postFirstPaintIndexSoftResyncGenerationRef.current;
      postFirstPaintIndexSoftResyncInFlightIdRef.current = workspaceId;
      void Promise.resolve(
        listThreadsForWorkspace(workspace, {
          preserveState: true,
          startupHydrationMode: "first-paint",
          allowRuntimeReconnect: false,
          forceSessionIndexSync: true,
          // 首刷后后台补 pi 盘扫：独立 native pi main 在 index 首页 5 槽
          // 之外也必须可达（fork/Shared 认领行仍按契约隐藏）。单目录
          // header 读，远轻于 full-catalog 多引擎 fan-out。
          includePiDiskList: true,
          // omp 与 pi 同形（pi-family 独立 main 后台补全）。
          includeOmpDiskList: true,
          // Pointer soft-cancel bumps the generation: the orphan IPC still
          // finishes but its late setThreads no-op (soft-ignore semantics).
          isStale: () =>
            postFirstPaintIndexSoftResyncGenerationRef.current !== generation ||
            activeWorkspaceIdRef.current !== workspaceId,
        }),
      )
        .catch(() => undefined)
        .finally(() => {
          if (
            postFirstPaintIndexSoftResyncInFlightIdRef.current === workspaceId
          ) {
            postFirstPaintIndexSoftResyncInFlightIdRef.current = null;
          }
          if (
            postFirstPaintIndexSoftResyncGenerationRef.current === generation
          ) {
            // Settled without a soft-cancel: the deferral cycle is over.
            postFirstPaintIndexSoftResyncDeferCountRef.current = 0;
            postFirstPaintIndexSoftResyncFirstDeferAtRef.current = 0;
          }
        });
    },
    [listThreadsForWorkspace, workspacesById],
  );

  const unconfirmedEmptySettleArmedIdsRef = useRef(new Set<string>());

  const scheduleUnconfirmedEmptyFirstPaintSettle = useCallback(
    (workspaceId: string) => {
      const id = workspaceId.trim();
      if (!id || unconfirmedEmptySettleArmedIdsRef.current.has(id)) {
        return;
      }
      const workspace = workspacesById.get(id);
      if (!workspace) {
        return;
      }
      unconfirmedEmptySettleArmedIdsRef.current.add(id);
      void Promise.resolve(
        listThreadsForWorkspace(workspace, {
          preserveState: true,
          startupHydrationMode: "first-paint",
          mergeExistingThreads: true,
          allowRuntimeReconnect: false,
          forceSessionIndexSync: true,
        }),
      )
        .catch(() => undefined)
        .then((settleResult) => {
          // 放行后续（如 session-index-imported 触发的 ensure）再次 settle。
          unconfirmedEmptySettleArmedIdsRef.current.delete(id);
          const confirmed =
            settleResult != null &&
            settleResult.applied === true &&
            ((settleResult.visibleCount ?? 0) > 0 ||
              settleResult.authoritativeEmpty === true);
          if (confirmed) {
            markWorkspaceThreadListHydrated(id);
            return;
          }
          // settle 未证实（失败 / 超时 / 仍非权威空）：不标 hydrated、不闪
          // 空白——保持「深度扫描」loading 等 importer 填行，宽限到期仍未见行
          // 才兜底终态（armEmptySettleGrace 内部处理）。
          armEmptySettleGrace(id);
        });
    },
    [
      armEmptySettleGrace,
      listThreadsForWorkspace,
      markWorkspaceThreadListHydrated,
      workspacesById,
    ],
  );

  /**
   * Quiet soft re-sync of Session Index after first-paint (NOT exhaustive
   * full-catalog). Picks up CLI-created sessions for Gemini/Grok/OpenCode/DSH
   * without multi-GB inventory. Force refresh still uses full-catalog.
   * First-paint / this re-sync never probe DSH/PI disk or host.
   */
  const schedulePostFirstPaintIndexSoftResync = useCallback(
    (
      workspaceId: string,
      options?: { allowRepeat?: boolean; quietOnly?: boolean },
    ) => {
      const id = workspaceId.trim();
      if (!id) {
        return;
      }
      if (
        !options?.allowRepeat &&
        postFirstPaintIndexSoftResyncArmedIdsRef.current.has(id)
      ) {
        return;
      }

      cancelPendingPostFirstPaintIndexSoftResync();
      postFirstPaintIndexSoftResyncArmedIdsRef.current.add(id);
      postFirstPaintIndexSoftResyncTargetIdRef.current = id;

      let unregisterForceCancel: (() => void) | null = null;
      const detachSchedule = () => {
        unregisterForceCancel?.();
        unregisterForceCancel = null;
        if (postFirstPaintIndexSoftResyncTargetIdRef.current === id) {
          postFirstPaintIndexSoftResyncTargetIdRef.current = null;
        }
        pendingPostFirstPaintIndexSoftResyncCleanupRef.current = null;
      };

      const runIndexSoftRefresh = () => {
        detachSchedule();
        runPostFirstPaintIndexSoftResync(id);
      };

      const quietCleanup = scheduleWhenInteractiveQuiet(runIndexSoftRefresh, {
        quietMs: POST_FIRST_PAINT_INDEX_SOFT_RESYNC_QUIET_MS,
        minDelayMs: POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MIN_DELAY_MS,
        // F1（perf-cold-start-click-storm-convergence）：quietOnly（defer 满
        // 上限后的冷却重武装）不给 maxWait 强跑许可——收敛由「quiet 到达必跑」
        // 保证，上限不再授权在交互中执行（现场 2026-08-28 22:31:18 syncMs=3111）。
        maxWaitMs: options?.quietOnly
          ? Number.MAX_SAFE_INTEGER
          : POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_WAIT_MS,
      });
      unregisterForceCancel = registerStartupIdleHydrationCancel(() => {
        quietCleanup();
        detachSchedule();
      });
      const combinedCleanup = () => {
        quietCleanup();
        detachSchedule();
      };
      pendingPostFirstPaintIndexSoftResyncCleanupRef.current = combinedCleanup;
    },
    [
      cancelPendingPostFirstPaintIndexSoftResync,
      runPostFirstPaintIndexSoftResync,
    ],
  );

  /**
   * Post-gate pointerdown guard: the post-first-paint Index soft re-sync
   * starts AFTER startup-gate-ready, so the pre-gate pointer shield no
   * longer covers it — its late setThreads can collide with the first
   * clicks (field: "前 5 秒点击卡死" on Windows). Soft-cancel the background
   * run (generation bump; the orphan IPC finishes but its apply no-ops)
   * and re-arm the quiet schedule. Only this background list task is
   * touched — user-initiated actions (force refresh etc.) are never
   * cancelled here. Consecutive deferrals are capped so a clicking user
   * cannot starve convergence.
   */
  const softCancelPostFirstPaintIndexSoftResyncForInput = useCallback(
    (workspaceId: string) => {
      const isPending =
        postFirstPaintIndexSoftResyncTargetIdRef.current === workspaceId;
      const isInFlight =
        postFirstPaintIndexSoftResyncInFlightIdRef.current === workspaceId;
      if (!isPending && !isInFlight) {
        return;
      }
      const now = Date.now();
      const firstDeferAt =
        postFirstPaintIndexSoftResyncFirstDeferAtRef.current || now;
      const deferCeilingHit =
        postFirstPaintIndexSoftResyncDeferCountRef.current >=
          POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS ||
        now - firstDeferAt >=
          POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFER_WINDOW_MS;
      if (deferCeilingHit) {
        // F1（perf-cold-start-click-storm-convergence）：defer 满上限不再「仍在
        // 点击也强跑」——那会把秒级写者 rescan 正正砸进点击风暴（现场
        // 2026-08-28 22:31:18 syncMs=3111）。改为冷却：重置计数，按普通 defer
        // 走 soft-cancel + 重武装 quietOnly 调度，等真实 quiet 窗口执行。
        // 防饿死：quiet 到达必跑；新会话发现另有 importer 轮询与显式 reload
        // （forceSessionIndexSync 全量语义不变）兜底。
        postFirstPaintIndexSoftResyncDeferCountRef.current = 0;
        postFirstPaintIndexSoftResyncFirstDeferAtRef.current = 0;
      }
      postFirstPaintIndexSoftResyncDeferCountRef.current += 1;
      postFirstPaintIndexSoftResyncFirstDeferAtRef.current =
        postFirstPaintIndexSoftResyncFirstDeferAtRef.current || Date.now();
      if (isInFlight) {
        // Soft-cancel: generation bump makes the orphan's late setThreads no-op.
        postFirstPaintIndexSoftResyncGenerationRef.current += 1;
        postFirstPaintIndexSoftResyncInFlightIdRef.current = null;
      }
      // Re-arm the quiet-gated schedule so the list converges once the user
      // stops clicking. Post-ceiling re-arms are quiet-only: the schedule
      // must not force a run through maxWait while input keeps coming.
      cancelPendingPostFirstPaintIndexSoftResync();
      postFirstPaintIndexSoftResyncArmedIdsRef.current.delete(workspaceId);
      schedulePostFirstPaintIndexSoftResync(workspaceId, {
        allowRepeat: true,
        quietOnly: deferCeilingHit,
      });
    },
    [
      cancelPendingPostFirstPaintIndexSoftResync,
      runPostFirstPaintIndexSoftResync,
      schedulePostFirstPaintIndexSoftResync,
    ],
  );

  const listThreadsForWorkspaceTracked = useCallback<ListThreadsForWorkspace>(
    async (workspace, options) => {
      // Cold-start: restore/focus/reload must not dual-scan non-active workspaces
      // (dump: two workspaces first-painted on-demand together at t≈1.7s).
      if (
        shouldSkipWorkspaceDuringColdStart(
          workspace.id,
          activeWorkspaceIdRef.current,
        )
      ) {
        return { applied: false, stale: true };
      }

      // Default path for direct callers (reload / rename / daily): Index
      // first-paint. Only force or explicit full-catalog fans out engines.
      const fullyHydrated = fullyHydratedThreadListWorkspaceIdsRef.current.has(
        workspace.id,
      );
      let kind: ThreadHydrationKind =
        hydrationKindByWorkspaceIdRef.current.get(workspace.id) ??
        (options?.startupHydrationMode === "full-catalog"
          ? "full-catalog"
          : "first-paint");

      // Focus-refresh historically forced full-catalog ~30s after first settle
      // (cold-start dump: second opencode_session_list + list_claude_sessions).
      // While full-catalog is still fresh, skip the multi-engine fan-out entirely.
      if (
        options?.recoverySource === "focus-refresh" &&
        fullyHydrated &&
        isFullCatalogFresh(workspace.id) &&
        options?.startupHydrationMode !== "first-paint"
      ) {
        return { applied: false, stale: false };
      }

      // Explicit first-paint from restore / soft paths wins over default full-catalog.
      if (options?.startupHydrationMode === "first-paint") {
        kind = "first-paint";
      } else if (options?.startupHydrationMode === "full-catalog") {
        kind = "full-catalog";
      }

      const phase: ThreadHydrationPhase =
        hydrationPhaseByWorkspaceIdRef.current.get(workspace.id) ??
        (workspace.id === activeWorkspaceIdRef.current
          ? "active-workspace"
          : "on-demand");

      hydratingThreadListWorkspaceIdsRef.current.add(workspace.id);
      // Keep maps aligned for concurrent ensure/skip guards.
      hydrationKindByWorkspaceIdRef.current.set(workspace.id, kind);
      hydrationPhaseByWorkspaceIdRef.current.set(workspace.id, phase);
      if (
        kind === "first-paint" &&
        !hydratedThreadListWorkspaceIdsRef.current.has(workspace.id)
      ) {
        // 新一轮 first-paint：取消可能残留的 settle 宽限（新周期接管终态）。
        cancelEmptySettleGrace(workspace.id);
      }

      let hydrationResult: ThreadListHydrationResult = undefined;
      const finishedKind = kind;
      try {
        const mode = kind === "first-paint" ? "first-paint" : "full-catalog";
        hydrationResult = await startupOrchestrator.run(
          createThreadHydrationTask(workspace, phase, kind, async (context) => {
            if (context.isStale()) {
              return { applied: false, stale: true };
            }
            return listThreadsForWorkspace(workspace, {
              ...options,
              startupHydrationMode: options?.mergeExistingThreads
                ? undefined
                : mode,
              allowRuntimeReconnect: false,
              isStale: context.isStale,
            });
          }),
        );
      } finally {
        const discardedAsStale =
          isDiscardedStaleHydrationResult(hydrationResult);
        const settledAsTimeout =
          !discardedAsStale && isTimeoutHydrationResult(hydrationResult);
        const isStillActive = workspace.id === activeWorkspaceIdRef.current;

        if (
          !discardedAsStale &&
          isStillActive &&
          (phase === "active-workspace" || finishedKind === "first-paint") &&
          !hasRecordedActiveWorkspaceReady()
        ) {
          // Only the active workspace first-paint/list marks this notice milestone.
          recordStartupMilestone(ACTIVE_WORKSPACE_READY_MILESTONE);
        }
        hydratingThreadListWorkspaceIdsRef.current.delete(workspace.id);
        hydrationPhaseByWorkspaceIdRef.current.delete(workspace.id);
        hydrationKindByWorkspaceIdRef.current.delete(workspace.id);
        if (!discardedAsStale) {
          const visibleCount =
            typeof hydrationResult === "object" && hydrationResult
              ? (hydrationResult.visibleCount ?? 0)
              : 0;
          const authoritativeEmpty =
            typeof hydrationResult === "object" &&
            hydrationResult?.authoritativeEmpty === true;
          const firstPaintUnconfirmedEmpty =
            finishedKind === "first-paint" &&
            !settledAsTimeout &&
            visibleCount <= 0 &&
            !authoritativeEmpty;
          if (firstPaintUnconfirmedEmpty) {
            // Index 空还未证实：importer / 二次 sync 马上会填行。
            // 保持 加载中，不要先闪空。
            scheduleUnconfirmedEmptyFirstPaintSettle(workspace.id);
          } else {
            markWorkspaceThreadListHydrated(workspace.id);
          }
          if (finishedKind !== "first-paint") {
            // Mark full attempted so sidebar drops loading; cooldown on timeout.
            publishHydratedWorkspaceId(
              fullyHydratedThreadListWorkspaceIdsRef,
              workspace.id,
            );
            if (settledAsTimeout) {
              // 连续 timeout 指数退避（60s→15min 封顶），打破「永不成功扫描
              // + 固定 60s 冷却 + 清 freshness」的常驻风暴回路（2026-08-27
              // Windows 用户实测：129 次 30s 超时 / 49 分钟）。
              noteFullCatalogAutoRetryTimeout(workspace.id);
              clearFullCatalogFresh(workspace.id);
            } else {
              // Successful multi-engine settle — block soft re-scans (focus-refresh).
              markFullCatalogFresh(workspace.id);
              noteFullCatalogAutoRetrySuccess(workspace.id);
            }
            // MUST NOT stamp startup-gate-ready from full-catalog settle.
          } else if (isStillActive) {
            // Only active first-paint opens the click gate (not a side workspace).
            stampStartupGateReady("first-paint-complete");
            // Session Index seeds multi-engine rows. Mark settled for soft
            // focus-refresh, then quiet-schedule one index soft re-sync so
            // CLI-created Gemini/Grok/OpenCode sessions appear without
            // exhaustive full-catalog.
            publishHydratedWorkspaceId(
              fullyHydratedThreadListWorkspaceIdsRef,
              workspace.id,
            );
            markFullCatalogFresh(workspace.id);
            if (!firstPaintUnconfirmedEmpty) {
              schedulePostFirstPaintIndexSoftResync(workspace.id);
            }
          }
        } else {
          // Stale discard: re-ensure first-paint only for the still-active owner.
          if (finishedKind === "first-paint") {
            autoHydratedActiveWorkspaceIdRef.current = null;
            Promise.resolve().then(() => {
              // Do not re-ensure a workspace the user already left.
              if (activeWorkspaceIdRef.current !== workspace.id) {
                return;
              }
              ensureWorkspaceThreadListLoadedRef.current?.(workspace.id, {
                preserveState: true,
              });
            });
          }
        }
      }
    },
    [
      cancelEmptySettleGrace,
      listThreadsForWorkspace,
      markWorkspaceThreadListHydrated,
      schedulePostFirstPaintIndexSoftResync,
      scheduleUnconfirmedEmptyFirstPaintSettle,
    ],
  );

  const ensureWorkspaceThreadListLoaded = useCallback(
    (
      workspaceId: string,
      options?: {
        preserveState?: boolean;
        force?: boolean;
        deletedThreadIds?: string[];
        localRemovalOnly?: boolean;
        startupHydrationMode?: "full-catalog" | "first-paint";
        mergeExistingThreads?: boolean;
      },
    ) => {
      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        return false;
      }
      // 归档摘行快路径：绕过 hydration 守卫，只做本地移除，零 IPC。
      if (options?.localRemovalOnly) {
        void listThreadsForWorkspaceTracked(workspace, {
          preserveState: true,
          deletedThreadIds: options.deletedThreadIds,
          localRemovalOnly: true,
        });
        return true;
      }
      const force = options?.force ?? false;
      const isLoading = threadListLoadingByWorkspace[workspaceId] ?? false;
      const uiHydrated =
        hydratedThreadListWorkspaceIdsRef.current.has(workspaceId);
      const fullyHydrated =
        fullyHydratedThreadListWorkspaceIdsRef.current.has(workspaceId);
      // Switch / daily / already-hydrated stay on Index first-paint.
      // Only force or an explicit full-catalog request fans out engines.
      // Importer rematerialize is Index merge: not first-paint, not catalog.
      const kind: ThreadHydrationKind = force
        ? "full-catalog"
        : options?.mergeExistingThreads
          ? "first-paint"
          : options?.startupHydrationMode === "first-paint"
            ? "first-paint"
            : options?.startupHydrationMode === "full-catalog"
              ? "full-catalog"
              : "first-paint";
      // Cold-start: only active workspace may hydrate until gate-ready.
      // User force refresh may target any workspace after gate; during cold-start
      // force still restricted to active to avoid dual-scan storms.
      if (
        !force &&
        shouldSkipWorkspaceDuringColdStart(workspaceId, activeWorkspaceId)
      ) {
        return false;
      }
      if (
        force &&
        isColdStartListGuardActive() &&
        workspaceId !== activeWorkspaceId
      ) {
        return false;
      }
      if (
        kind === "full-catalog" &&
        !force &&
        (isFullCatalogAutoRetryBlocked(workspaceId) || isStartupForceEntered())
      ) {
        return false;
      }
      if (force && kind === "full-catalog") {
        clearFullCatalogAutoRetryCooldown(workspaceId);
        clearFullCatalogFresh(workspaceId);
      }
      // Soft ensure after a successful full-catalog: do not re-fan-out engines
      // until freshness expires (force / explicit user refresh still wins).
      if (
        !force &&
        kind === "full-catalog" &&
        fullyHydrated &&
        isFullCatalogFresh(workspaceId)
      ) {
        return false;
      }
      const hasHydratedThreadList = options?.mergeExistingThreads
        ? false
        : options?.startupHydrationMode === "first-paint"
          ? false
          : kind === "first-paint"
            ? uiHydrated
            : fullyHydrated;
      const isHydratingThreadList =
        hydratingThreadListWorkspaceIdsRef.current.has(workspaceId);
      if (
        shouldSkipWorkspaceThreadListLoad({
          force,
          isLoading,
          isHydratingThreadList,
          hasHydratedThreadList,
        }) &&
        options?.startupHydrationMode !== "first-paint"
      ) {
        return false;
      }
      const phase: ThreadHydrationPhase = force
        ? "on-demand"
        : workspaceId === activeWorkspaceId
          ? "active-workspace"
          : "idle-prewarm";
      hydrationPhaseByWorkspaceIdRef.current.set(workspaceId, phase);
      hydrationKindByWorkspaceIdRef.current.set(workspaceId, kind);
      void listThreadsForWorkspaceTracked(workspace, {
        preserveState: options?.preserveState,
        deletedThreadIds: options?.deletedThreadIds,
        startupHydrationMode: options?.mergeExistingThreads
          ? undefined
          : kind === "first-paint"
            ? "first-paint"
            : "full-catalog",
        mergeExistingThreads: options?.mergeExistingThreads,
        includeOpenCodeSessions: options?.mergeExistingThreads
          ? false
          : undefined,
      });
      return true;
    },
    [
      activeWorkspaceId,
      listThreadsForWorkspaceTracked,
      threadListLoadingByWorkspace,
      workspacesById,
    ],
  );

  ensureWorkspaceThreadListLoadedRef.current = ensureWorkspaceThreadListLoaded;

  const prewarmSessionRadarForWorkspace = useCallback(
    (workspaceId: string) => {
      const workspace = workspacesById.get(workspaceId);
      if (!workspace) {
        return;
      }
      if (threadListLoadingByWorkspace[workspaceId] ?? false) {
        return;
      }
      if (hydratingThreadListWorkspaceIdsRef.current.has(workspaceId)) {
        return;
      }
      if (fullyHydratedThreadListWorkspaceIdsRef.current.has(workspaceId)) {
        return;
      }
      if (idleHydrationCleanupByWorkspaceIdRef.current.has(workspaceId)) {
        return;
      }
      const cleanup = scheduleIdleHydration(() => {
        idleHydrationCleanupByWorkspaceIdRef.current.delete(workspaceId);
        if (threadListLoadingByWorkspace[workspaceId] ?? false) {
          return;
        }
        if (hydratingThreadListWorkspaceIdsRef.current.has(workspaceId)) {
          return;
        }
        if (fullyHydratedThreadListWorkspaceIdsRef.current.has(workspaceId)) {
          return;
        }
        hydrationPhaseByWorkspaceIdRef.current.set(workspaceId, "idle-prewarm");
        hydrationKindByWorkspaceIdRef.current.set(workspaceId, "session-radar");
        void listThreadsForWorkspaceTracked(workspace, {
          preserveState: true,
        });
      });
      idleHydrationCleanupByWorkspaceIdRef.current.set(workspaceId, cleanup);
    },
    [
      listThreadsForWorkspaceTracked,
      scheduleIdleHydration,
      threadListLoadingByWorkspace,
      workspacesById,
    ],
  );

  useEffect(() => {
    ensureInteractiveInputHooks();
  }, []);

  useEffect(() => {
    const previousActiveWorkspaceId = previousActiveWorkspaceIdRef.current;
    const isIntentSwitch =
      previousActiveWorkspaceId != null &&
      previousActiveWorkspaceId !== activeWorkspaceId;

    if (isIntentSwitch && previousActiveWorkspaceId) {
      // Spec: stale workspace hydration is cancelled on switch. Soft-ignore
      // marks the generation stale so late list apply no-ops via isStale.
      startupOrchestrator.cancelWorkspaceTasks(
        previousActiveWorkspaceId,
        "stale",
      );
      const idleCleanup = idleHydrationCleanupByWorkspaceIdRef.current.get(
        previousActiveWorkspaceId,
      );
      if (idleCleanup) {
        idleCleanup();
        idleHydrationCleanupByWorkspaceIdRef.current.delete(
          previousActiveWorkspaceId,
        );
      }
      // Drop scheduled auto first-paint for the previous target.
      pendingAutoFirstPaintCleanupRef.current?.();
      pendingAutoFirstPaintCleanupRef.current = null;
      // Drop pending Index soft re-sync for the workspace the user already left.
      if (
        postFirstPaintIndexSoftResyncTargetIdRef.current ===
        previousActiveWorkspaceId
      ) {
        cancelPendingPostFirstPaintIndexSoftResync();
      }
      if (
        autoHydratedActiveWorkspaceIdRef.current === previousActiveWorkspaceId
      ) {
        autoHydratedActiveWorkspaceIdRef.current = null;
      }
    }

    previousActiveWorkspaceIdRef.current = activeWorkspaceId;

    if (!activeWorkspaceId) {
      autoHydratedActiveWorkspaceIdRef.current = null;
      pendingAutoFirstPaintCleanupRef.current?.();
      pendingAutoFirstPaintCleanupRef.current = null;
      return;
    }
    if (autoHydratedActiveWorkspaceIdRef.current === activeWorkspaceId) {
      return;
    }
    // Do not mark the active workspace as auto-hydrated until it exists in the
    // workspace map. On cold start activeWorkspaceId can land before workspacesById
    // is populated; marking early permanently skips ensure and leaves the sidebar
    // on "加载中…".
    if (!workspacesById.has(activeWorkspaceId)) {
      return;
    }

    // Cancel any prior pending schedule for a different bind of the same id
    // (e.g. map late-arrival re-entry) before rescheduling.
    pendingAutoFirstPaintCleanupRef.current?.();
    pendingAutoFirstPaintCleanupRef.current = null;

    const targetId = activeWorkspaceId;

    const startEnsure = () => {
      if (activeWorkspaceIdRef.current !== targetId) {
        return;
      }
      if (autoHydratedActiveWorkspaceIdRef.current === targetId) {
        return;
      }
      if (!workspacesById.has(targetId)) {
        return;
      }
      // Last-moment gate: if the user is still clicking, do not mark auto-done
      // and re-arm quiet schedule (Cmd+R press-test).
      if (
        hadRecentInteractiveInput(
          isIntentSwitch
            ? Math.max(WORKSPACE_SWITCH_INPUT_QUIET_MS, 48)
            : Math.max(COLD_START_INPUT_QUIET_MS, 48),
        )
      ) {
        pendingAutoFirstPaintCleanupRef.current = scheduleWhenInteractiveQuiet(
          startEnsure,
          {
            quietMs: isIntentSwitch
              ? WORKSPACE_SWITCH_INPUT_QUIET_MS
              : COLD_START_INPUT_QUIET_MS,
            minDelayMs: 0,
            maxWaitMs: COLD_START_IDLE_TIMEOUT_MS,
          },
        );
        return;
      }
      pendingAutoFirstPaintCleanupRef.current = null;
      const alreadyHydrated =
        hydratedThreadListWorkspaceIdsRef.current.has(targetId);
      const started = ensureWorkspaceThreadListLoaded(targetId, {
        preserveState: true,
        startupHydrationMode: "first-paint",
      });
      if (started || alreadyHydrated) {
        autoHydratedActiveWorkspaceIdRef.current = targetId;
      }
    };

    const armQuietSchedule = () => {
      pendingAutoFirstPaintCleanupRef.current?.();
      pendingAutoFirstPaintCleanupRef.current = scheduleWhenInteractiveQuiet(
        startEnsure,
        {
          quietMs: isIntentSwitch
            ? WORKSPACE_SWITCH_INPUT_QUIET_MS
            : COLD_START_INPUT_QUIET_MS,
          minDelayMs: isIntentSwitch
            ? WORKSPACE_SWITCH_INTENT_DELAY_MS
            : COLD_START_IDLE_MIN_DELAY_MS,
          maxWaitMs: COLD_START_IDLE_TIMEOUT_MS,
        },
      );
    };

    rescheduleAutoFirstPaintRef.current = () => {
      if (activeWorkspaceIdRef.current !== targetId) {
        return;
      }
      if (autoHydratedActiveWorkspaceIdRef.current === targetId) {
        return;
      }
      armQuietSchedule();
    };

    // Quiet-gated for both cold bind and workspace switch — switch still cancels
    // the previous workspace first (above).
    armQuietSchedule();

    return () => {
      pendingAutoFirstPaintCleanupRef.current?.();
      pendingAutoFirstPaintCleanupRef.current = null;
      if (rescheduleAutoFirstPaintRef.current) {
        rescheduleAutoFirstPaintRef.current = null;
      }
    };
  }, [
    activeWorkspaceId,
    cancelPendingPostFirstPaintIndexSoftResync,
    ensureWorkspaceThreadListLoaded,
    workspacesById,
  ]);

  // Force-enter cancels pending idle Index soft re-sync; re-arm once quiet so
  // the active sidebar still leaves stale snapshot after the user unmasks early.
  useEffect(() => {
    return subscribeStartupForceEnter(() => {
      const activeId = activeWorkspaceIdRef.current;
      if (!activeId) {
        return;
      }
      if (!hydratedThreadListWorkspaceIdsRef.current.has(activeId)) {
        return;
      }
      if (fullyHydratedThreadListWorkspaceIdsRef.current.has(activeId)) {
        return;
      }
      // Allow one re-arm after force-enter cancelled the first schedule.
      postFirstPaintIndexSoftResyncArmedIdsRef.current.delete(activeId);
      schedulePostFirstPaintIndexSoftResync(activeId, { allowRepeat: true });
    });
  }, [schedulePostFirstPaintIndexSoftResync]);

  // Any pointerdown soft-cancels in-flight background list work so clicks never
  // collide with setThreads:
  // - before gate-ready: first-paint hydration (Cmd+R / reload stress), via
  //   orchestrator cancelWorkspaceTasks + quiet re-arm;
  // - after gate-ready: the post-first-paint Index soft re-sync, which
  //   only starts after the gate opens (generation-guard soft cancel + quiet
  //   re-arm, capped by POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS /
  //   MAX_DEFER_WINDOW_MS so rapid clicking cannot defer it forever).
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    ensureInteractiveInputHooks();
    const onPointerDown = () => {
      const activeId = activeWorkspaceIdRef.current;
      if (!activeId) {
        return;
      }
      if (!hasStartupGateReady() && !isStartupForceEntered()) {
        startupOrchestrator.cancelWorkspaceTasks(activeId, "stale");
        // Allow quiet scheduler to retry after the user stops clicking.
        if (autoHydratedActiveWorkspaceIdRef.current === activeId) {
          autoHydratedActiveWorkspaceIdRef.current = null;
          rescheduleAutoFirstPaintRef.current?.();
        }
        return;
      }
      softCancelPostFirstPaintIndexSoftResyncForInput(activeId);
    };
    window.addEventListener("pointerdown", onPointerDown, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [softCancelPostFirstPaintIndexSoftResyncForInput]);

  useEffect(() => {
    if (!activeWorkspaceId || activeWorkspaceProjectionOwnerIds.length <= 1) {
      return;
    }
    // Projection owners: defer until gate-ready so cold-start does not dual-scan.
    if (isColdStartListGuardActive() && activeWorkspaceId) {
      return;
    }
    activeWorkspaceProjectionOwnerIds.forEach((workspaceId) => {
      if (workspaceId === activeWorkspaceId) {
        return;
      }
      if (!workspacesById.has(workspaceId)) {
        return;
      }
      if (hydratedThreadListWorkspaceIdsRef.current.has(workspaceId)) {
        return;
      }
      ensureWorkspaceThreadListLoaded(workspaceId, { preserveState: true });
    });
  }, [
    activeWorkspaceId,
    activeWorkspaceProjectionOwnerIds,
    ensureWorkspaceThreadListLoaded,
    workspacesById,
  ]);

  useEffect(() => {
    const cleanupByWorkspaceId = idleHydrationCleanupByWorkspaceIdRef.current;
    const graceCleanupByWorkspaceId =
      emptySettleGraceCleanupByWorkspaceIdRef.current;
    return () => {
      cleanupByWorkspaceId.forEach((cleanup) => cleanup());
      cleanupByWorkspaceId.clear();
      graceCleanupByWorkspaceId.forEach((cleanup) => cleanup());
      graceCleanupByWorkspaceId.clear();
      cancelPendingPostFirstPaintIndexSoftResync();
    };
  }, [cancelPendingPostFirstPaintIndexSoftResync]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ workspaceIds?: string[]; upserted?: number }>(
      "session-index-imported",
      (event) => {
        if ((event.payload?.upserted ?? 0) <= 0) {
          return;
        }
        const ids = event.payload?.workspaceIds ?? [];
        ids.forEach((workspaceId) => {
          const alreadyHydrated =
            hydratedThreadListWorkspaceIdsRef.current.has(workspaceId);
          ensureWorkspaceThreadListLoaded(workspaceId, {
            preserveState: true,
            mergeExistingThreads: alreadyHydrated,
            ...(alreadyHydrated
              ? {}
              : { startupHydrationMode: "first-paint" as const }),
          });
        });
      },
    )
      .then((fn) => {
        if (disposed) {
          void fn();
          return;
        }
        unlisten = () => {
          void fn();
        };
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [ensureWorkspaceThreadListLoaded]);

  return {
    ensureWorkspaceThreadListLoaded,
    hydratedThreadListWorkspaceIds,
    hydratedThreadListWorkspaceIdsRef,
    listThreadsForWorkspaceTracked,
    prewarmSessionRadarForWorkspace,
  };
}
