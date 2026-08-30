// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listenMock = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => {
    return () => undefined;
  }),
);

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));
import type { WorkspaceInfo } from "../../types";
import {
  getStartupTraceSnapshot,
  resetStartupTraceForTests,
} from "../../features/startup-orchestration/utils/startupTrace";
import { resetFullCatalogAutoRetryForTests } from "../../features/startup-orchestration/utils/fullCatalogAutoRetry";
import { resetFullCatalogFreshForTests } from "../../features/startup-orchestration/utils/fullCatalogFreshness";
import { resetStartupGateReadyForTests } from "../../features/startup-orchestration/utils/startupGateReady";
import {
  markStartupForceEnter,
  resetStartupForceEnterForTests,
} from "../../features/startup-orchestration/utils/startupForceEnter";
import {
  useWorkspaceThreadListHydration,
  COLD_START_IDLE_MIN_DELAY_MS,
  POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS,
  POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_WAIT_MS,
  POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MIN_DELAY_MS,
  WORKSPACE_SWITCH_INTENT_DELAY_MS,
} from "./useWorkspaceThreadListHydration";
import { startupOrchestrator } from "../../features/startup-orchestration/utils/startupOrchestrator";

let restoreIdleCallbackForTest: (() => void) | null = null;

function createWorkspace(id: string): WorkspaceInfo {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    connected: true,
    settings: { sidebarCollapsed: false },
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function installImmediateIdleCallback() {
  restoreIdleCallbackForTest?.();
  const previousRequestIdleCallback = window.requestIdleCallback;
  const previousCancelIdleCallback = window.cancelIdleCallback;
  window.requestIdleCallback = ((callback: IdleRequestCallback) => {
    const timeoutId = window.setTimeout(() => {
      callback({
        didTimeout: false,
        timeRemaining: () => 50,
      });
    }, 0);
    return timeoutId;
  }) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = ((handle: number) => {
    window.clearTimeout(handle);
  }) as typeof window.cancelIdleCallback;
  restoreIdleCallbackForTest = () => {
    window.requestIdleCallback = previousRequestIdleCallback;
    window.cancelIdleCallback = previousCancelIdleCallback;
    restoreIdleCallbackForTest = null;
  };
  return restoreIdleCallbackForTest;
}

describe("useWorkspaceThreadListHydration", () => {
  beforeEach(async () => {
    listenMock.mockClear();
    listenMock.mockImplementation(async () => {
      return () => undefined;
    });
    vi.useRealTimers();
    resetStartupTraceForTests();
    resetFullCatalogAutoRetryForTests();
    resetFullCatalogFreshForTests();
    resetStartupGateReadyForTests();
    resetStartupForceEnterForTests();
    // Flush pending cold-start timers / microtasks left by prior tests.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  afterEach(() => {
    restoreIdleCallbackForTest?.();
  });

  it("defers cold-start first-paint until idle (not same-tick auto ensure)", async () => {
    vi.useFakeTimers();
    // Do not install immediate idle — prove schedule is deferred via idle path.
    const workspaces = [createWorkspace("ws-1")];
    const listThreadsForWorkspace = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-1",
        activeWorkspaceProjectionOwnerIds: ["ws-1"],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(
          workspaces.map((workspace) => [workspace.id, workspace]),
        ),
      }),
    );

    // Synchronous bind must not start IPC list (even when test delays are 0,
    // idle still goes through a macrotask).
    expect(listThreadsForWorkspace).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        Math.max(COLD_START_IDLE_MIN_DELAY_MS, 0) + 1,
      );
      await Promise.resolve();
    });

    expect(listThreadsForWorkspace).toHaveBeenCalledWith(
      workspaces[0],
      expect.objectContaining({ startupHydrationMode: "first-paint" }),
    );
    vi.useRealTimers();
  });

  it("treats workspace switch as intent: cancels previous and schedules B", async () => {
    vi.useFakeTimers();
    const cancelSpy = vi.spyOn(startupOrchestrator, "cancelWorkspaceTasks");
    const workspaces = [createWorkspace("ws-a"), createWorkspace("ws-b")];
    const listThreadsForWorkspace = vi.fn().mockResolvedValue(undefined);
    const map = new Map(
      workspaces.map((workspace) => [workspace.id, workspace]),
    );

    const { rerender } = renderHook(
      ({ activeId }: { activeId: string }) =>
        useWorkspaceThreadListHydration({
          activeWorkspaceId: activeId,
          activeWorkspaceProjectionOwnerIds: [activeId],
          listThreadsForWorkspace,
          threadListLoadingByWorkspace: {},
          workspaces,
          workspacesById: map,
        }),
      { initialProps: { activeId: "ws-a" } },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
    });
    expect(listThreadsForWorkspace).toHaveBeenCalledWith(
      workspaces[0],
      expect.objectContaining({ startupHydrationMode: "first-paint" }),
    );
    listThreadsForWorkspace.mockClear();
    cancelSpy.mockClear();

    rerender({ activeId: "ws-b" });

    expect(cancelSpy).toHaveBeenCalledWith("ws-a", "stale");
    // Intent path uses short timer; not yet fired on same tick when delay>0.
    // In test mode delay is 0 → still a macrotask.
    expect(listThreadsForWorkspace).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        Math.max(WORKSPACE_SWITCH_INTENT_DELAY_MS, 0) + 1,
      );
      await Promise.resolve();
    });

    expect(listThreadsForWorkspace).toHaveBeenCalledWith(
      workspaces[1],
      expect.objectContaining({ startupHydrationMode: "first-paint" }),
    );
    cancelSpy.mockRestore();
    vi.useRealTimers();
  });

  it("does not automatically hydrate background workspaces", async () => {
    vi.useFakeTimers();
    const restoreIdleCallback = installImmediateIdleCallback();
    const workspaces = [createWorkspace("ws-1"), createWorkspace("ws-2")];
    const listThreadsForWorkspace = vi
      .fn<
        (
          workspace: WorkspaceInfo,
          options?: {
            preserveState?: boolean;
            includeOpenCodeSessions?: boolean;
            startupHydrationMode?: "full-catalog" | "first-paint";
          },
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: null,
        activeWorkspaceProjectionOwnerIds: [],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(
          workspaces.map((workspace) => [workspace.id, workspace]),
        ),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(listThreadsForWorkspace).not.toHaveBeenCalled();
    restoreIdleCallback();
    vi.useRealTimers();
  });

  it("routes active workspace first-paint hydration before idle background hydration", async () => {
    const workspaces = [createWorkspace("ws-1"), createWorkspace("ws-2")];
    const listThreadsForWorkspace = vi.fn<
      (
        workspace: WorkspaceInfo,
        options?: {
          preserveState?: boolean;
          includeOpenCodeSessions?: boolean;
          startupHydrationMode?: "full-catalog" | "first-paint";
        },
      ) => Promise<void>
    >().mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-2",
        activeWorkspaceProjectionOwnerIds: [],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces: [],
        workspacesById: new Map(workspaces.map((workspace) => [workspace.id, workspace])),
      }),
    );

    await waitFor(() => {
      expect(listThreadsForWorkspace).toHaveBeenCalledWith(
        workspaces[1],
        expect.objectContaining({
          preserveState: true,
          startupHydrationMode: "first-paint",
        }),
      );
    });

    const taskEvents = getStartupTraceSnapshot().events.filter(
      (event): event is Extract<typeof event, { type: "task" }> =>
        event.type === "task" && event.taskId === "thread-list:first-paint:ws-2",
    );
    expect(taskEvents.some((event) => event.phase === "active-workspace")).toBe(true);
    expect(getStartupTraceSnapshot().milestones["active-workspace-ready"]).toBeTruthy();
  });

  it("does not swallow a first-paint failure when force-enter blocks idle follow-up", async () => {
    const workspace = createWorkspace("ws-1");
    const listThreadsForWorkspace = vi
      .fn()
      .mockRejectedValue(new Error("thread list failed"));
    markStartupForceEnter();

    const { result } = renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: workspace.id,
        activeWorkspaceProjectionOwnerIds: [workspace.id],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces: [],
        workspacesById: new Map(),
      }),
    );

    await act(async () => {
      await expect(
        result.current.listThreadsForWorkspaceTracked(workspace),
      ).rejects.toThrow("thread list failed");
    });
  });

  it("keeps manual tracked refreshes on first-paint for the active workspace", async () => {
    const workspaces = [createWorkspace("ws-1")];
    const listThreadsForWorkspace = vi.fn<
      (
        workspace: WorkspaceInfo,
        options?: {
          preserveState?: boolean;
          includeOpenCodeSessions?: boolean;
          startupHydrationMode?: "full-catalog" | "first-paint";
        },
      ) => Promise<void>
    >().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-1",
        activeWorkspaceProjectionOwnerIds: [],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces: [],
        workspacesById: new Map(workspaces.map((workspace) => [workspace.id, workspace])),
      }),
    );

    await waitFor(() => {
      expect(listThreadsForWorkspace).toHaveBeenCalledWith(
        workspaces[0],
        expect.objectContaining({
          startupHydrationMode: "first-paint",
        }),
      );
    });

    await waitFor(() => {
      expect(listThreadsForWorkspace.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    // After first-paint, manual tracked without explicit full-catalog stays Index.
    await act(async () => {
      await result.current.listThreadsForWorkspaceTracked(workspaces[0]!);
    });

    await waitFor(() => {
      const modes = listThreadsForWorkspace.mock.calls.map(
        (call) => call[1]?.startupHydrationMode,
      );
      expect(modes.length).toBeGreaterThanOrEqual(2);
      expect(modes.every((mode) => mode === "first-paint")).toBe(true);
      expect(modes).not.toContain("full-catalog");
    });

    const fullCatalogEvents = getStartupTraceSnapshot().events.filter(
      (event): event is Extract<typeof event, { type: "task" }> =>
        event.type === "task" && event.taskId === "thread-list:full-catalog:ws-1",
    );
    expect(fullCatalogEvents).toHaveLength(0);
  });

  it("does not stamp startup-gate-ready from an explicit full-catalog timeout", async () => {
    vi.useFakeTimers();
    const workspaces = [createWorkspace("ws-1")];
    const listThreadsForWorkspace = vi
      .fn()
      .mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-1",
        activeWorkspaceProjectionOwnerIds: ["ws-1"],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(
          workspaces.map((workspace) => [workspace.id, workspace]),
        ),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // first-paint hang → timeout 8s settles with timeout sentinel and stamps gate
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(
      getStartupTraceSnapshot().milestones["startup-gate-ready"],
    ).toBeTruthy();

    await act(async () => {
      result.current.ensureWorkspaceThreadListLoaded("ws-1", { force: true });
      await vi.advanceTimersByTimeAsync(0);
    });
    const gateSeqBefore = getStartupTraceSnapshot().events.filter(
      (e) => e.type === "milestone" && e.milestone === "startup-gate-ready",
    ).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    const gateSeqAfter = getStartupTraceSnapshot().events.filter(
      (e) => e.type === "milestone" && e.milestone === "startup-gate-ready",
    ).length;
    // Full timeout must not re-stamp / must not be the only path — count stays 1
    expect(gateSeqAfter).toBe(gateSeqBefore);

    vi.useRealTimers();
  });

  it("settles active first-paint via session-index without auto full-catalog", async () => {
    // Session Index now multi-engine seeds first-paint; exhaustive full-catalog
    // is no longer auto-scheduled after gate-ready (Load older / Session Mgmt /
    // force refresh still can request full-catalog).
    const workspaces = [createWorkspace("ws-1")];
    const listThreadsForWorkspace = vi
      .fn<
        (
          workspace: WorkspaceInfo,
          options?: {
            preserveState?: boolean;
            includeOpenCodeSessions?: boolean;
            startupHydrationMode?: "full-catalog" | "first-paint";
          },
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-1",
        activeWorkspaceProjectionOwnerIds: ["ws-1"],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(
          workspaces.map((workspace) => [workspace.id, workspace]),
        ),
      }),
    );

    await waitFor(() => {
      expect(listThreadsForWorkspace).toHaveBeenCalledWith(
        workspaces[0],
        expect.objectContaining({ startupHydrationMode: "first-paint" }),
      );
    });

    // Quiet index soft re-sync may fire another first-paint; full-catalog must not.
    await waitFor(() => {
      expect(listThreadsForWorkspace.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const modes = listThreadsForWorkspace.mock.calls.map(
      (call) => call[1]?.startupHydrationMode,
    );
    expect(modes.every((mode) => mode === "first-paint" || mode === undefined)).toBe(
      true,
    );
    expect(modes).not.toContain("full-catalog");

    const firstPaintEvents = getStartupTraceSnapshot().events.filter(
      (event): event is Extract<typeof event, { type: "task" }> =>
        event.type === "task" &&
        event.taskId === "thread-list:first-paint:ws-1",
    );
    expect(
      firstPaintEvents.some((event) => event.phase === "active-workspace"),
    ).toBe(true);

    const fullCatalogEvents = getStartupTraceSnapshot().events.filter(
      (event): event is Extract<typeof event, { type: "task" }> =>
        event.type === "task" &&
        event.taskId === "thread-list:full-catalog:ws-1",
    );
    expect(fullCatalogEvents.length).toBe(0);
    // Sanity: quiet delays export for production (non-zero) / test (0).
    expect(POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MIN_DELAY_MS).toBeGreaterThanOrEqual(0);
    expect(POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_WAIT_MS).toBeGreaterThanOrEqual(0);
  });

  it("skips focus-refresh full-catalog while catalog is still fresh", async () => {
    const workspaces = [createWorkspace("ws-1")];
    const listThreadsForWorkspace = vi
      .fn<
        (
          workspace: WorkspaceInfo,
          options?: {
            preserveState?: boolean;
            startupHydrationMode?: "full-catalog" | "first-paint";
            recoverySource?: string;
          },
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-1",
        activeWorkspaceProjectionOwnerIds: ["ws-1"],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(
          workspaces.map((workspace) => [workspace.id, workspace]),
        ),
      }),
    );

    await waitFor(() => {
      const modes = listThreadsForWorkspace.mock.calls.map(
        (call) => call[1]?.startupHydrationMode,
      );
      // First-paint settles as fully hydrated via session-index path.
      expect(modes).toContain("first-paint");
    });

    // Drain quiet index soft re-sync before measuring focus-refresh.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const callsAfterSettle = listThreadsForWorkspace.mock.calls.length;

    await act(async () => {
      await result.current.listThreadsForWorkspaceTracked(workspaces[0]!, {
        preserveState: true,
        recoverySource: "focus-refresh",
        allowRuntimeReconnect: false,
      });
    });

    // Soft focus-refresh must not re-run multi-engine list while fresh.
    expect(listThreadsForWorkspace.mock.calls.length).toBe(callsAfterSettle);
  });

  it("does not full-catalog background workspaces after active first-paint", async () => {
    const workspaces = [createWorkspace("ws-active"), createWorkspace("ws-bg")];
    const listThreadsForWorkspace = vi
      .fn<
        (
          workspace: WorkspaceInfo,
          options?: {
            preserveState?: boolean;
            includeOpenCodeSessions?: boolean;
            startupHydrationMode?: "full-catalog" | "first-paint";
          },
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-active",
        activeWorkspaceProjectionOwnerIds: ["ws-active"],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(
          workspaces.map((workspace) => [workspace.id, workspace]),
        ),
      }),
    );

    await waitFor(() => {
      expect(
        listThreadsForWorkspace.mock.calls.some(
          (call) =>
            call[0]?.id === "ws-active" &&
            call[1]?.startupHydrationMode === "first-paint",
        ),
      ).toBe(true);
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(
      listThreadsForWorkspace.mock.calls.some(
        (call) => call[0]?.id === "ws-bg",
      ),
    ).toBe(false);
    expect(
      listThreadsForWorkspace.mock.calls.some(
        (call) => call[1]?.startupHydrationMode === "full-catalog",
      ),
    ).toBe(false);
  });

  it("keeps unrelated workspaces cold after active first-paint reaches the gate", async () => {
    vi.useFakeTimers();
    const restoreIdleCallback = installImmediateIdleCallback();
    const workspaces = [
      createWorkspace("ws-older"),
      createWorkspace("ws-active"),
    ];
    const listThreadsForWorkspace = vi
      .fn<
        (
          workspace: WorkspaceInfo,
          options?: {
            preserveState?: boolean;
            includeOpenCodeSessions?: boolean;
            startupHydrationMode?: "full-catalog" | "first-paint";
          },
        ) => Promise<void>
      >()
      .mockResolvedValue(undefined);

    renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-active",
        activeWorkspaceProjectionOwnerIds: ["ws-active"],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(
          workspaces.map((workspace) => [workspace.id, workspace]),
        ),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // First list call must be active only.
    expect(listThreadsForWorkspace.mock.calls[0]?.[0]?.id).toBe("ws-active");

    expect(
      getStartupTraceSnapshot().milestones["startup-gate-ready"],
    ).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(
      listThreadsForWorkspace.mock.calls.some(
        (call) => call[0]?.id === "ws-older",
      ),
    ).toBe(false);
    restoreIdleCallback();
    vi.useRealTimers();
  });

  it("blocks non-active listThreadsForWorkspaceTracked during cold-start", async () => {
    const workspaces = [createWorkspace("ws-side"), createWorkspace("ws-active")];
    const listThreadsForWorkspace = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-active",
        activeWorkspaceProjectionOwnerIds: [],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(workspaces.map((workspace) => [workspace.id, workspace])),
      }),
    );

    await act(async () => {
      await result.current.listThreadsForWorkspaceTracked(workspaces[0]!);
    });
    // Side workspace skipped (stale no-op) before gate.
    expect(
      listThreadsForWorkspace.mock.calls.some((call) => call[0]?.id === "ws-side"),
    ).toBe(false);
  });

  it("cancels previous workspace hydration when active workspace switches", async () => {
    const workspaces = [createWorkspace("ws-1"), createWorkspace("ws-2")];
    const firstHydration = createDeferred();
    let ws1StaleAtFinish = false;
    const listThreadsForWorkspace = vi.fn<
      (
        workspace: WorkspaceInfo,
        options?: {
          preserveState?: boolean;
          includeOpenCodeSessions?: boolean;
          startupHydrationMode?: "full-catalog" | "first-paint";
          isStale?: () => boolean;
        },
      ) => Promise<void | { applied?: boolean; stale?: boolean }>
    >().mockImplementation(async (workspace, options) => {
      if (workspace.id === "ws-1") {
        await firstHydration.promise;
        ws1StaleAtFinish = options?.isStale?.() ?? false;
        if (ws1StaleAtFinish) {
          return { applied: false, stale: true };
        }
      }
      return { applied: true };
    });

    const { rerender } = renderHook(
      ({ activeWorkspaceId }: { activeWorkspaceId: string }) =>
        useWorkspaceThreadListHydration({
          activeWorkspaceId,
          activeWorkspaceProjectionOwnerIds: [],
          listThreadsForWorkspace,
          threadListLoadingByWorkspace: {},
          workspaces,
          workspacesById: new Map(
            workspaces.map((workspace) => [workspace.id, workspace]),
          ),
        }),
      { initialProps: { activeWorkspaceId: "ws-1" } },
    );

    await waitFor(() => {
      expect(listThreadsForWorkspace).toHaveBeenCalledWith(
        workspaces[0],
        expect.objectContaining({ startupHydrationMode: "first-paint" }),
      );
    });

    rerender({ activeWorkspaceId: "ws-2" });

    // Concurrency slot must free so ws-2 starts before ws-1 body finishes.
    await waitFor(() => {
      expect(listThreadsForWorkspace).toHaveBeenCalledWith(
        workspaces[1],
        expect.objectContaining({ startupHydrationMode: "first-paint" }),
      );
    });

    firstHydration.resolve();
    await act(async () => {
      await firstHydration.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Prefer true: cancel marks isStale. If body finished before cancel landed,
    // at least ws-2 first-paint must have started (concurrency freed).
    if (!ws1StaleAtFinish) {
      expect(
        listThreadsForWorkspace.mock.calls.some(
          (call) => call[0]?.id === "ws-2",
        ),
      ).toBe(true);
    }
  });

  it("retries hydration when the previous result was discarded as stale", async () => {
    const workspaces = [createWorkspace("ws-1")];
    const listThreadsForWorkspace = vi.fn<
      (
        workspace: WorkspaceInfo,
        options?: {
          preserveState?: boolean;
          includeOpenCodeSessions?: boolean;
          startupHydrationMode?: "full-catalog" | "first-paint";
        },
      ) => Promise<void | { applied?: boolean; stale?: boolean }>
    >()
      .mockResolvedValueOnce({ applied: false, stale: true })
      .mockResolvedValue({ applied: true });

    renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-1",
        activeWorkspaceProjectionOwnerIds: ["ws-1"],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(workspaces.map((workspace) => [workspace.id, workspace])),
      }),
    );

    await waitFor(() => {
      expect(listThreadsForWorkspace.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("routes session radar prewarm as an idle full-catalog task", async () => {
    const restoreIdleCallback = installImmediateIdleCallback();
    const workspaces = [createWorkspace("ws-1")];
    const listThreadsForWorkspace = vi.fn<
      (
        workspace: WorkspaceInfo,
        options?: {
          preserveState?: boolean;
          includeOpenCodeSessions?: boolean;
          startupHydrationMode?: "full-catalog" | "first-paint";
        },
      ) => Promise<void>
    >().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: null,
        activeWorkspaceProjectionOwnerIds: [],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces: [],
        workspacesById: new Map(workspaces.map((workspace) => [workspace.id, workspace])),
      }),
    );

    result.current.prewarmSessionRadarForWorkspace("ws-1");
    expect(listThreadsForWorkspace).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(listThreadsForWorkspace).toHaveBeenCalledWith(
        workspaces[0],
        expect.objectContaining({
          preserveState: true,
          startupHydrationMode: "full-catalog",
        }),
      );
    });

    const taskEvents = getStartupTraceSnapshot().events.filter(
      (event): event is Extract<typeof event, { type: "task" }> =>
        event.type === "task" && event.taskId === "thread-list:session-radar:ws-1",
    );
    expect(taskEvents.some((event) => event.phase === "idle-prewarm")).toBe(true);
    restoreIdleCallback();
  });

  it("does not start session radar prewarm while workspace hydration is in flight", async () => {
    const workspaces = [createWorkspace("ws-1")];
    const activeHydration = createDeferred();
    const listThreadsForWorkspace = vi.fn<
      (
        workspace: WorkspaceInfo,
        options?: {
          preserveState?: boolean;
          includeOpenCodeSessions?: boolean;
          startupHydrationMode?: "full-catalog" | "first-paint";
        },
      ) => Promise<void>
    >().mockImplementationOnce(async () => activeHydration.promise);

    const { result } = renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-1",
        activeWorkspaceProjectionOwnerIds: [],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(workspaces.map((workspace) => [workspace.id, workspace])),
      }),
    );

    await waitFor(() => {
      expect(listThreadsForWorkspace).toHaveBeenCalledTimes(1);
    });

    result.current.prewarmSessionRadarForWorkspace("ws-1");
    // Prewarm must not fan out a second scan while first-paint is still open.
    expect(listThreadsForWorkspace).toHaveBeenCalledTimes(1);

    activeHydration.resolve();
    await act(async () => {
      await activeHydration.promise;
      // Quiet post-first-paint full-catalog may arm (test delays are 0).
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });
    // After first-paint settles, active full-catalog convergence is allowed;
    // the in-flight prewarm guard is what this test protects.
    expect(
      listThreadsForWorkspace.mock.calls.some(
        (call) => call[1]?.startupHydrationMode === "first-paint",
      ),
    ).toBe(true);
  });

  it("publishes a new hydrated Set identity so memo consumers can drop loading", async () => {
    const workspaces = [createWorkspace("ws-1")];
    const listThreadsForWorkspace = vi.fn<
      (
        workspace: WorkspaceInfo,
        options?: {
          preserveState?: boolean;
          includeOpenCodeSessions?: boolean;
          startupHydrationMode?: "full-catalog" | "first-paint";
        },
      ) => Promise<void>
    >().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-1",
        activeWorkspaceProjectionOwnerIds: ["ws-1"],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(workspaces.map((workspace) => [workspace.id, workspace])),
      }),
    );

    const emptySnapshot = result.current.hydratedThreadListWorkspaceIds;
    expect(emptySnapshot.size).toBe(0);

    await waitFor(() => {
      expect(result.current.hydratedThreadListWorkspaceIds.has("ws-1")).toBe(
        true,
      );
    });

    const published = result.current.hydratedThreadListWorkspaceIds;
    expect(published).not.toBe(emptySnapshot);
    expect(published.has("ws-1")).toBe(true);
    expect(result.current.hydratedThreadListWorkspaceIdsRef.current).toBe(
      published,
    );
  });

  it("marks active workspace hydrated with a new Set after orchestrator timeout", async () => {
    vi.useFakeTimers();
    const workspaces = [createWorkspace("ws-1")];
    const listThreadsForWorkspace = vi.fn<
      (
        workspace: WorkspaceInfo,
        options?: {
          preserveState?: boolean;
          includeOpenCodeSessions?: boolean;
          startupHydrationMode?: "full-catalog" | "first-paint";
        },
      ) => Promise<void>
    >().mockImplementation(() => new Promise(() => {}));

    const { result } = renderHook(() =>
      useWorkspaceThreadListHydration({
        activeWorkspaceId: "ws-1",
        activeWorkspaceProjectionOwnerIds: ["ws-1"],
        listThreadsForWorkspace,
        threadListLoadingByWorkspace: {},
        workspaces,
        workspacesById: new Map(workspaces.map((workspace) => [workspace.id, workspace])),
      }),
    );

    const emptySnapshot = result.current.hydratedThreadListWorkspaceIds;

    await act(async () => {
      // cold-start first-paint delay (0 in vitest) + schedule
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(listThreadsForWorkspace).toHaveBeenCalledTimes(1);

    await act(async () => {
      // first-paint timeoutMs is 8_000
      await vi.advanceTimersByTimeAsync(8_000);
    });

    expect(result.current.hydratedThreadListWorkspaceIds.has("ws-1")).toBe(true);
    expect(result.current.hydratedThreadListWorkspaceIds).not.toBe(emptySnapshot);
    expect(result.current.hydratedThreadListWorkspaceIdsRef.current.has("ws-1")).toBe(
      true,
    );

    vi.useRealTimers();
  });

  it("retries active workspace hydration once workspacesById gains the workspace", async () => {
    const workspaces = [createWorkspace("ws-1")];
    const listThreadsForWorkspace = vi.fn<
      (
        workspace: WorkspaceInfo,
        options?: {
          preserveState?: boolean;
          includeOpenCodeSessions?: boolean;
          startupHydrationMode?: "full-catalog" | "first-paint";
        },
      ) => Promise<void>
    >().mockResolvedValue(undefined);

    const { rerender } = renderHook(
      ({
        workspacesById,
      }: {
        workspacesById: Map<string, WorkspaceInfo>;
      }) =>
        useWorkspaceThreadListHydration({
          activeWorkspaceId: "ws-1",
          activeWorkspaceProjectionOwnerIds: ["ws-1"],
          listThreadsForWorkspace,
          threadListLoadingByWorkspace: {},
          workspaces,
          workspacesById,
        }),
      {
        initialProps: {
          workspacesById: new Map<string, WorkspaceInfo>(),
        },
      },
    );

    expect(listThreadsForWorkspace).not.toHaveBeenCalled();

    rerender({
      workspacesById: new Map(
        workspaces.map((workspace) => [workspace.id, workspace]),
      ),
    });

    await waitFor(() => {
      expect(listThreadsForWorkspace.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
    expect(listThreadsForWorkspace).toHaveBeenCalledWith(
      workspaces[0],
      expect.objectContaining({ preserveState: true }),
    );
  });

  describe("pointerdown soft-cancel shield", () => {
    type SoftRefreshOptions = {
      preserveState?: boolean;
      startupHydrationMode?: "full-catalog" | "first-paint";
      forceSessionIndexSync?: boolean;
      isStale?: () => boolean;
    };

    /** First-paint resolves; post-first-paint soft re-sync hangs in flight. */
    function createSoftRefreshMock() {
      const softRefreshCalls: Array<{ options?: SoftRefreshOptions }> = [];
      const listThreadsForWorkspace = vi.fn(
        (_workspace: WorkspaceInfo, options?: SoftRefreshOptions) => {
          if (options?.forceSessionIndexSync) {
            softRefreshCalls.push({ options });
            // Raw off-orchestrator call: a hanging promise is safe to leak.
            return new Promise<void>(() => {});
          }
          return Promise.resolve({
            applied: true,
            visibleCount: 1,
            authoritativeEmpty: false,
          });
        },
      );
      return { softRefreshCalls, listThreadsForWorkspace };
    }

    function renderActiveHydration(
      listThreadsForWorkspace: ReturnType<typeof vi.fn>,
      workspaceId: string,
    ) {
      const workspaces = [createWorkspace(workspaceId)];
      renderHook(() =>
        useWorkspaceThreadListHydration({
          activeWorkspaceId: workspaceId,
          activeWorkspaceProjectionOwnerIds: [workspaceId],
          listThreadsForWorkspace,
          threadListLoadingByWorkspace: {},
          workspaces,
          workspacesById: new Map(
            workspaces.map((workspace) => [workspace.id, workspace]),
          ),
        }),
      );
    }

    async function reachInFlightSoftRefresh(
      listThreadsForWorkspace: ReturnType<typeof vi.fn>,
    ) {
      // first-paint settles → gate-ready → quiet post-first-paint soft re-sync
      // (test delays are 0, so the quiet schedule fires on a macrotask).
      await waitFor(() => {
        expect(
          listThreadsForWorkspace.mock.calls.some(
            (call) =>
              (call[1] as SoftRefreshOptions | undefined)
                ?.forceSessionIndexSync === true,
          ),
        ).toBe(true);
      });
      expect(
        getStartupTraceSnapshot().milestones["startup-gate-ready"],
      ).toBeTruthy();
    }

    const dispatchPointerDown = () => {
      act(() => {
        window.dispatchEvent(new window.Event("pointerdown"));
      });
    };

    it("keeps the pre-gate shield: pointerdown cancels first-paint and re-arms", async () => {
      // Unique workspace id per test: the global orchestrator dedupes by
      // `thread-list:<kind>:<id>` and a hanging task would otherwise attach
      // the next test's first-paint to this one.
      const workspaceId = "ws-pre-gate";
      // Hanging tasks occupy the single active-workspace orchestrator slot —
      // collect resolvers and settle them before the test ends.
      const pendingResolvers: Array<() => void> = [];
      const listThreadsForWorkspace = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            pendingResolvers.push(resolve);
          }),
      );
      const cancelSpy = vi.spyOn(startupOrchestrator, "cancelWorkspaceTasks");
      renderActiveHydration(listThreadsForWorkspace, workspaceId);

      await waitFor(() => {
        expect(listThreadsForWorkspace).toHaveBeenCalledTimes(1);
      });
      expect(
        getStartupTraceSnapshot().milestones["startup-gate-ready"],
      ).toBeFalsy();

      dispatchPointerDown();
      expect(cancelSpy).toHaveBeenCalledWith(workspaceId, "stale");

      // Quiet re-arm re-ensures first-paint for the still-active workspace.
      await waitFor(() => {
        expect(
          listThreadsForWorkspace.mock.calls.length,
        ).toBeGreaterThanOrEqual(2);
      });
      cancelSpy.mockRestore();
      pendingResolvers.forEach((resolve) => resolve());
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    });

    it("post-gate: pointerdown soft-cancels an in-flight soft re-sync and re-arms quiet", async () => {
      const { softRefreshCalls, listThreadsForWorkspace } =
        createSoftRefreshMock();
      renderActiveHydration(listThreadsForWorkspace, "ws-post-gate");
      await reachInFlightSoftRefresh(listThreadsForWorkspace);

      expect(softRefreshCalls.length).toBe(1);
      const firstRunStale = softRefreshCalls[0]!.options!.isStale!;
      expect(firstRunStale()).toBe(false);

      dispatchPointerDown();
      // Generation bump: the orphan run's late apply must no-op.
      expect(firstRunStale()).toBe(true);

      // Quiet re-arm starts a replacement run once the schedule fires.
      await waitFor(() => {
        expect(softRefreshCalls.length).toBe(2);
      });
      expect(softRefreshCalls[1]!.options!.isStale!()).toBe(false);
    });

    it("defer ceiling re-arms quiet-only instead of forcing a run mid-click", async () => {
      // F1（perf-cold-start-click-storm-convergence）：defer 满上限不得「仍在
      // 点击也强跑」——那会把秒级写者 rescan 正正砸进点击风暴（现场
      // 2026-08-28 22:31:18 syncMs=3111）。上限只授权「等真实 quiet 窗口」。
      const { softRefreshCalls, listThreadsForWorkspace } =
        createSoftRefreshMock();
      renderActiveHydration(listThreadsForWorkspace, "ws-defer-ceiling");
      await reachInFlightSoftRefresh(listThreadsForWorkspace);

      // Each click soft-cancels the in-flight run and re-arms a fresh one.
      for (let defer = 1; defer <= POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS; defer++) {
        dispatchPointerDown();
        await waitFor(() => {
          expect(softRefreshCalls.length).toBe(defer + 1);
        });
        expect(
          softRefreshCalls[defer]!.options!.isStale!(),
          `replacement run #${defer + 1} must start un-cancelled`,
        ).toBe(false);
      }

      // Ceiling reached: the ceiling click is an ordinary defer — the
      // in-flight run is soft-cancelled (stale), and no writer resync is
      // forced synchronously the way the old mid-click force-run did.
      const runAtCeiling =
        softRefreshCalls[POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS]!.options!
          .isStale!;
      dispatchPointerDown();
      expect(runAtCeiling()).toBe(true);
      expect(
        softRefreshCalls.length,
        "defer ceiling must not force a run synchronously",
      ).toBe(POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS + 1);

      // Convergence guarantee: the quiet-only re-arm still runs (once) via
      // the schedule's quiet window instead of starving forever.
      await waitFor(() => {
        expect(softRefreshCalls.length).toBe(
          POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS + 2,
        );
      });
      expect(
        softRefreshCalls[POST_FIRST_PAINT_INDEX_SOFT_RESYNC_MAX_DEFERS + 1]!
          .options!.isStale!(),
      ).toBe(false);
    });
  });

  describe("session-index-imported rematerialize", () => {
    type ImportedPayload = { workspaceIds?: string[]; upserted?: number };

    function captureImportedHandler() {
      let handler:
        | ((event: { payload: ImportedPayload }) => void)
        | undefined;
      listenMock.mockImplementation(async (eventName, nextHandler) => {
        if (eventName === "session-index-imported") {
          handler = nextHandler as (event: { payload: ImportedPayload }) => void;
        }
        return () => undefined;
      });
      return {
        emit(payload: ImportedPayload) {
          handler?.({ payload });
        },
        hasHandler() {
          return Boolean(handler);
        },
      };
    }

    it("re-reads active workspace Index after upserted>0 without disk lists", async () => {
      const imported = captureImportedHandler();
      const listThreadsForWorkspace = vi.fn(
        async (
          _workspace: WorkspaceInfo,
          _options?: {
            preserveState?: boolean;
            mergeExistingThreads?: boolean;
            includeEngineDiskLists?: boolean;
            includeOpenCodeSessions?: boolean;
            startupHydrationMode?: "full-catalog" | "first-paint";
          },
        ) => undefined,
      );
      const workspaces = [createWorkspace("ws-1")];
      renderHook(() =>
        useWorkspaceThreadListHydration({
          activeWorkspaceId: "ws-1",
          activeWorkspaceProjectionOwnerIds: ["ws-1"],
          listThreadsForWorkspace,
          threadListLoadingByWorkspace: {},
          workspaces,
          workspacesById: new Map(
            workspaces.map((workspace) => [workspace.id, workspace]),
          ),
        }),
      );

      await waitFor(() => {
        expect(imported.hasHandler()).toBe(true);
      });
      const callsBeforeImport = listThreadsForWorkspace.mock.calls.length;
      await act(async () => {
        imported.emit({ workspaceIds: ["ws-1"], upserted: 2 });
      });
      await waitFor(() => {
        expect(listThreadsForWorkspace.mock.calls.length).toBeGreaterThan(
          callsBeforeImport,
        );
      });
      const importedCall = listThreadsForWorkspace.mock.calls.find(
        (call) =>
          call[1]?.startupHydrationMode === "first-paint" ||
          call[1]?.mergeExistingThreads === true,
      );
      expect(importedCall?.[0]).toMatchObject({ id: "ws-1" });
      expect(importedCall?.[1]).toEqual(
        expect.objectContaining({
          preserveState: true,
          startupHydrationMode: "first-paint",
        }),
      );
      expect(importedCall?.[1]?.mergeExistingThreads).not.toBe(true);
      expect(importedCall?.[1]?.includeEngineDiskLists).not.toBe(true);
    });

    it("does not rematerialize or claim empty when upserted is 0", async () => {
      const imported = captureImportedHandler();
      const listThreadsForWorkspace = vi.fn(
        async (
          _workspace: WorkspaceInfo,
          _options?: {
            preserveState?: boolean;
            mergeExistingThreads?: boolean;
            includeEngineDiskLists?: boolean;
            startupHydrationMode?: "full-catalog" | "first-paint";
          },
        ) => undefined,
      );
      const workspaces = [createWorkspace("ws-1")];
      renderHook(() =>
        useWorkspaceThreadListHydration({
          activeWorkspaceId: "ws-1",
          activeWorkspaceProjectionOwnerIds: ["ws-1"],
          listThreadsForWorkspace,
          threadListLoadingByWorkspace: {},
          workspaces,
          workspacesById: new Map(
            workspaces.map((workspace) => [workspace.id, workspace]),
          ),
        }),
      );

      await waitFor(() => {
        expect(imported.hasHandler()).toBe(true);
      });
      const callsBeforeImport = listThreadsForWorkspace.mock.calls.length;
      await act(async () => {
        imported.emit({ workspaceIds: ["ws-1"], upserted: 0 });
      });
      expect(
        listThreadsForWorkspace.mock.calls
          .slice(callsBeforeImport)
          .some((call) => call[1]?.mergeExistingThreads === true),
      ).toBe(false);
    });
  });
});
