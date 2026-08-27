// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveWorkspaceSessionsV2,
  listGlobalCodexSessions,
  listProjectRelatedSessions,
  listWorkspaceSessions,
} from "../../../../../services/tauri";
import {
  SESSION_CATALOG_PAGE_SIZE,
  buildWorkspaceSessionSelectionKey,
  useWorkspaceSessionCatalog,
  type WorkspaceSessionCatalogFilters,
  type WorkspaceSessionCatalogMutationResponse,
} from "./useWorkspaceSessionCatalog";

vi.mock("../../../../../services/tauri", () => ({
  listGlobalCodexSessions: vi.fn(),
  listProjectRelatedSessions: vi.fn(),
  listWorkspaceSessions: vi.fn(),
  archiveWorkspaceSessionsV2: vi.fn(),
  unarchiveWorkspaceSessionsV2: vi.fn(),
  deleteWorkspaceSessions: vi.fn(),
  scheduleTombstoneClaudeForkIndexRow: vi.fn(),
}));

vi.mock("../../../../threads/utils/sessionDeleteV2", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../threads/utils/sessionDeleteV2")>();
  return {
    ...actual,
    isSessionDeleteV2Enabled: vi.fn(() => false),
    requestSessionDelete: vi.fn(),
  };
});

import {
  isSessionDeleteV2Enabled,
  requestSessionDelete,
} from "../../../../threads/utils/sessionDeleteV2";

const DEFAULT_FILTERS: WorkspaceSessionCatalogFilters = {
  keyword: "",
  engine: "",
  status: "active",
};

describe("useWorkspaceSessionCatalog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listGlobalCodexSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(listProjectRelatedSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });
  });

  it("builds selection key with workspace ownership", () => {
    expect(
      buildWorkspaceSessionSelectionKey({
        workspaceId: "ws-2",
        sessionId: "claude:123",
      }),
    ).toBe("ws-2::claude:123");
    expect(
      buildWorkspaceSessionSelectionKey({
        workspaceId: "ws-2",
        sessionId: "claude:123",
        stableSessionKey: "claude:ws-2:123",
      }),
    ).toBe("ws-2::claude:ws-2:123");
  });

  it("ignores stale responses after workspace selection is cleared", async () => {
    let resolveList:
      | ((value: {
          data: Array<{
            sessionId: string;
            workspaceId: string;
            engine: string;
            title: string;
            updatedAt: number;
            threadKind: string;
          }>;
          nextCursor: string | null;
          partialSource: string | null;
        }) => void)
      | null = null;

    vi.mocked(listWorkspaceSessions).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ workspaceId }) =>
        useWorkspaceSessionCatalog({
          mode: "project",
          workspaceId,
          filters: DEFAULT_FILTERS,
        }),
      {
        initialProps: { workspaceId: "ws-1" as string | null },
      },
    );

    await waitFor(() => {
      expect(vi.mocked(listWorkspaceSessions)).toHaveBeenCalledWith("ws-1", {
        query: {
          keyword: null,
          engine: null,
          status: "active",
          folderId: null,
          sessionAttributionMode: "related",
        },
        cursor: null,
        limit: SESSION_CATALOG_PAGE_SIZE,
      });
    });

    rerender({ workspaceId: null });

    await act(async () => {
      resolveList?.({
        data: [
          {
            sessionId: "session-a",
            workspaceId: "ws-1",
            engine: "codex",
            title: "Leaked stale entry",
            updatedAt: 1,
            threadKind: "native",
          },
        ],
        nextCursor: null,
        partialSource: null,
      });
      await Promise.resolve();
    });

    expect(result.current.entries).toEqual([]);
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("exposes backend page-size cap evidence", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:page-1",
          workspaceId: "ws-1",
          engine: "codex",
          title: "Page item",
          updatedAt: 1,
          threadKind: "native",
        },
      ],
      nextCursor: "stable:next",
      requestedLimit: SESSION_CATALOG_PAGE_SIZE,
      effectiveLimit: SESSION_CATALOG_PAGE_SIZE,
      limitCapped: false,
      partialSource: null,
    });

    const { result } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-1",
        filters: DEFAULT_FILTERS,
      }),
    );

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
    expect(result.current.nextCursor).toBe("stable:next");
    expect(result.current.pageLimit).toEqual({
      requestedLimit: SESSION_CATALOG_PAGE_SIZE,
      effectiveLimit: SESSION_CATALOG_PAGE_SIZE,
      limitCapped: false,
    });
  });

  it("dedupes equivalent in-flight catalog page requests", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:shared",
          workspaceId: "ws-1",
          engine: "codex",
          title: "Shared result",
          updatedAt: 1,
          threadKind: "native",
        },
      ],
      nextCursor: "cursor:next",
      partialSource: null,
    });

    const { result: firstResult } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-1",
        filters: DEFAULT_FILTERS,
        source: "strict",
      }),
    );
    const { result: secondResult } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-1",
        filters: { ...DEFAULT_FILTERS },
        source: "strict",
      }),
    );

    await waitFor(() => {
      expect(firstResult.current.entries[0]?.sessionId).toBe("codex:shared");
      expect(secondResult.current.entries[0]?.sessionId).toBe("codex:shared");
    });

    expect(listWorkspaceSessions).toHaveBeenCalledTimes(1);
    expect(firstResult.current.nextCursor).toBe("cursor:next");
    expect(secondResult.current.nextCursor).toBe("cursor:next");
  });

  it("does not dedupe catalog requests across attribution modes or filters", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValue({
      data: [],
      nextCursor: null,
      partialSource: null,
    });

    renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-1",
        filters: DEFAULT_FILTERS,
        sessionAttributionMode: "workspace-only",
        source: "strict",
      }),
    );
    renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-1",
        filters: { ...DEFAULT_FILTERS, keyword: "agent" },
        sessionAttributionMode: "workspace-only",
        source: "strict",
      }),
    );
    renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-1",
        filters: DEFAULT_FILTERS,
        sessionAttributionMode: "related",
        source: "strict",
      }),
    );

    await waitFor(() => {
      expect(listWorkspaceSessions).toHaveBeenCalledTimes(3);
    });
  });

  it("passes workspace-only attribution mode into project catalog queries", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [],
      nextCursor: null,
      partialSource: null,
    });

    renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-1",
        filters: DEFAULT_FILTERS,
        sessionAttributionMode: "workspace-only",
      }),
    );

    await waitFor(() => {
      expect(listWorkspaceSessions).toHaveBeenCalledWith("ws-1", {
        query: {
          keyword: null,
          engine: null,
          status: "active",
          folderId: null,
          sessionAttributionMode: "workspace-only",
        },
        cursor: null,
        limit: SESSION_CATALOG_PAGE_SIZE,
      });
    });
  });

  it("ignores stale responses when filters change before the first request resolves", async () => {
    const pendingResponses: Array<
      (value: {
        data: Array<{
          sessionId: string;
          workspaceId: string;
          engine: string;
          title: string;
          updatedAt: number;
          threadKind: string;
        }>;
        nextCursor: string | null;
        partialSource: string | null;
      }) => void
    > = [];

    vi.mocked(listWorkspaceSessions).mockImplementation(
      () =>
        new Promise((resolve) => {
          pendingResponses.push(resolve);
        }),
    );

    const { result, rerender } = renderHook(
      ({ filters }) =>
        useWorkspaceSessionCatalog({
          mode: "project",
          workspaceId: "ws-1",
          filters,
        }),
      {
        initialProps: {
          filters: { ...DEFAULT_FILTERS, keyword: "old" },
        },
      },
    );

    await waitFor(() => {
      expect(listWorkspaceSessions).toHaveBeenCalledTimes(1);
    });

    rerender({ filters: { ...DEFAULT_FILTERS, keyword: "new" } });

    await waitFor(() => {
      expect(listWorkspaceSessions).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      pendingResponses[1]?.({
        data: [
          {
            sessionId: "session-new",
            workspaceId: "ws-1",
            engine: "codex",
            title: "New result",
            updatedAt: 2,
            threadKind: "native",
          },
        ],
        nextCursor: null,
        partialSource: null,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.entries[0]?.sessionId).toBe("session-new");
    });

    await act(async () => {
      pendingResponses[0]?.({
        data: [
          {
            sessionId: "session-old",
            workspaceId: "ws-1",
            engine: "codex",
            title: "Old stale result",
            updatedAt: 1,
            threadKind: "native",
          },
        ],
        nextCursor: null,
        partialSource: null,
      });
      await Promise.resolve();
    });

    expect(result.current.entries[0]?.sessionId).toBe("session-new");
  });

  it("groups batch archive requests by owner workspace", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:main",
          workspaceId: "ws-main",
          engine: "codex",
          title: "Main session",
          updatedAt: 10,
          threadKind: "native",
        },
        {
          sessionId: "codex:worktree",
          workspaceId: "ws-worktree",
          engine: "codex",
          title: "Worktree session",
          updatedAt: 11,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(archiveWorkspaceSessionsV2)
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:main", ok: true, archivedAt: 100 }],
      })
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:worktree", ok: true, archivedAt: 101 }],
      });

    const { result } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-main",
        filters: DEFAULT_FILTERS,
      }),
    );

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });

    let response: Awaited<ReturnType<typeof result.current.mutate>> | undefined;
    await act(async () => {
      response = await result.current.mutate("archive", result.current.entries);
    });

    expect(archiveWorkspaceSessionsV2).toHaveBeenNthCalledWith(1, "ws-main", [
      { threadId: "codex:main", engine: "codex" },
    ]);
    expect(archiveWorkspaceSessionsV2).toHaveBeenNthCalledWith(2, "ws-worktree", [
      { threadId: "codex:worktree", engine: "codex" },
    ]);
    expect(response?.results).toEqual([
      {
        selectionKey: "ws-main::codex:main",
        sessionId: "codex:main",
        workspaceId: "ws-main",
        ok: true,
        archivedAt: 100,
        error: undefined,
        code: undefined,
      },
      {
        selectionKey: "ws-worktree::codex:worktree",
        sessionId: "codex:worktree",
        workspaceId: "ws-worktree",
        ok: true,
        archivedAt: 101,
        error: undefined,
        code: undefined,
      },
    ]);
  });

  it("uses returned owner workspace and stable key to reconcile aggregate mutations", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "claude:child-session",
          stableSessionKey: "claude:child-ws:child-session",
          workspaceId: "child-ws",
          engine: "claude",
          title: "Child Claude",
          updatedAt: 10,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(archiveWorkspaceSessionsV2).mockResolvedValueOnce({
      results: [
        {
          sessionId: "claude:child-session",
          stableSessionKey: "claude:child-ws:child-session",
          ownerWorkspaceId: "child-ws",
          ok: true,
          archivedAt: 100,
        },
      ],
    });

    const { result } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "parent-ws",
        filters: DEFAULT_FILTERS,
      }),
    );

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });

    let response: Awaited<ReturnType<typeof result.current.mutate>> | undefined;
    await act(async () => {
      response = await result.current.mutate("archive", result.current.entries);
    });

    expect(archiveWorkspaceSessionsV2).toHaveBeenCalledWith("child-ws", [
      { threadId: "claude:child-session", engine: "claude" },
    ]);
    expect(response?.results[0]).toMatchObject({
      selectionKey: "child-ws::claude:child-ws:child-session",
      sessionId: "claude:child-session",
      workspaceId: "child-ws",
      ok: true,
      archivedAt: 100,
    });
  });

  it("preserves successful workspace buckets when another bucket throws", async () => {
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "codex:main",
          workspaceId: "ws-main",
          engine: "codex",
          title: "Main session",
          updatedAt: 10,
          threadKind: "native",
        },
        {
          sessionId: "codex:worktree",
          workspaceId: "ws-worktree",
          engine: "codex",
          title: "Worktree session",
          updatedAt: 11,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(archiveWorkspaceSessionsV2)
      .mockResolvedValueOnce({
        results: [{ sessionId: "codex:main", ok: true, archivedAt: 100 }],
      })
      .mockRejectedValueOnce(new Error("worktree archive failed"));

    const { result } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-main",
        filters: DEFAULT_FILTERS,
      }),
    );

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(2);
    });

    let response: Awaited<ReturnType<typeof result.current.mutate>> | undefined;
    await act(async () => {
      response = await result.current.mutate("archive", result.current.entries);
    });

    expect(response?.results).toEqual([
      {
        selectionKey: "ws-main::codex:main",
        sessionId: "codex:main",
        workspaceId: "ws-main",
        ok: true,
        archivedAt: 100,
        error: undefined,
        code: undefined,
      },
      {
        selectionKey: "ws-worktree::codex:worktree",
        sessionId: "codex:worktree",
        workspaceId: "ws-worktree",
        ok: false,
        archivedAt: null,
        error: "worktree archive failed",
        code: "MUTATION_REQUEST_FAILED",
      },
    ]);
    expect(result.current.entries).toEqual([
      {
        sessionId: "codex:worktree",
        workspaceId: "ws-worktree",
        engine: "codex",
        title: "Worktree session",
        updatedAt: 11,
        threadKind: "native",
      },
    ]);
  });

  it("loads global engine sessions without forcing the codex filter", async () => {
    vi.mocked(listGlobalCodexSessions).mockResolvedValue({
      data: [
        {
          sessionId: "global:1",
          workspaceId: "__global_unassigned__",
          engine: "claude",
          title: "Global session",
          updatedAt: 12,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    const { result } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "global",
        workspaceId: null,
        filters: { ...DEFAULT_FILTERS, engine: "claude" },
      }),
    );

    await waitFor(() => {
      expect(listGlobalCodexSessions).toHaveBeenCalledWith({
        query: {
          keyword: null,
          engine: "claude",
          status: "active",
          folderId: null,
          sessionAttributionMode: "related",
        },
        cursor: null,
        limit: SESSION_CATALOG_PAGE_SIZE,
      });
    });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
  });

  it("blocks mutations for owner-unresolved global entries", async () => {
    const { result } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "global",
        workspaceId: null,
        filters: DEFAULT_FILTERS,
      }),
    );

    let response: Awaited<ReturnType<typeof result.current.mutate>> | undefined;
    await act(async () => {
      response = await result.current.mutate("archive", [
        {
          sessionId: "global:1",
          workspaceId: "__global_unassigned__",
          engine: "codex",
          title: "Unassigned",
          updatedAt: 1,
          threadKind: "native",
        },
      ]);
    });

    expect(response?.results).toEqual([
      {
        selectionKey: "__global_unassigned__::global:1",
        sessionId: "global:1",
        workspaceId: "__global_unassigned__",
        ok: false,
        archivedAt: null,
        error: "Owner workspace could not be resolved for this session.",
        code: "OWNER_WORKSPACE_UNRESOLVED",
      },
    ]);
    expect(archiveWorkspaceSessionsV2).not.toHaveBeenCalled();
  });

  it("loads inferred related codex sessions for project mode", async () => {
    vi.mocked(listProjectRelatedSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "global:related",
          workspaceId: "ws-owner",
          matchedWorkspaceId: "ws-main",
          attributionStatus: "inferred-related",
          attributionReason: "shared-git-root",
          attributionConfidence: "medium",
          engine: "codex",
          title: "Related session",
          updatedAt: 99,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    const { result } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-main",
        filters: DEFAULT_FILTERS,
        source: "related",
      }),
    );

    await waitFor(() => {
      expect(listProjectRelatedSessions).toHaveBeenCalledWith("ws-main", {
        query: {
          keyword: null,
          engine: null,
          status: "active",
          folderId: null,
          sessionAttributionMode: "related",
        },
        cursor: null,
        limit: SESSION_CATALOG_PAGE_SIZE,
      });
    });

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
    });
  });

  it("loads inferred related non-codex sessions without frontend filtering", async () => {
    vi.mocked(listProjectRelatedSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "claude:related",
          workspaceId: "ws-owner",
          matchedWorkspaceId: "ws-main",
          attributionStatus: "inferred-related",
          attributionReason: "shared-worktree-family",
          attributionConfidence: "high",
          engine: "claude",
          title: "Related Claude session",
          updatedAt: 100,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });

    const { result } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-main",
        filters: { ...DEFAULT_FILTERS, engine: "claude" },
        source: "related",
      }),
    );

    await waitFor(() => {
      expect(listProjectRelatedSessions).toHaveBeenCalledWith("ws-main", {
        query: {
          keyword: null,
          engine: "claude",
          status: "active",
          folderId: null,
          sessionAttributionMode: "related",
        },
        cursor: null,
        limit: SESSION_CATALOG_PAGE_SIZE,
      });
    });

    await waitFor(() => {
      expect(result.current.entries[0]?.engine).toBe("claude");
    });
  });
});

describe("useWorkspaceSessionCatalog (delete v2)", () => {
  it("delete 走 v2 通道：批量一次调用并映射 SessionDeleteCode", async () => {
    vi.mocked(isSessionDeleteV2Enabled).mockReturnValue(true);
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "claude:s-1",
          workspaceId: "ws-1",
          engine: "claude",
          title: "A",
          updatedAt: 2,
          threadKind: "native",
        },
        {
          sessionId: "session-b",
          workspaceId: "ws-1",
          engine: "codex",
          title: "B",
          updatedAt: 1,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(requestSessionDelete).mockResolvedValue([
      { sessionId: "claude:s-1", ok: true, code: "OK" },
      { sessionId: "session-b", ok: true, code: "MARKED_DELETED" },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-1",
        filters: DEFAULT_FILTERS,
      }),
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(2));

    let response: WorkspaceSessionCatalogMutationResponse | undefined;
    await act(async () => {
      response = await result.current.mutate("delete", result.current.entries);
    });

    // 批量恒为一次调用
    expect(vi.mocked(requestSessionDelete)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(requestSessionDelete)).toHaveBeenCalledWith("ws-1", [
      "claude:s-1",
      "session-b",
    ]);
    expect(response?.results).toHaveLength(2);
    expect(response?.results.every((item) => item.ok)).toBe(true);
    // MARKED_DELETED 映射：幂等成功、磁盘未删（后台重试）、元数据已清
    const marked = response?.results.find((item) => item.sessionId === "session-b");
    expect(marked?.code).toBe("MARKED_DELETED");
    expect(marked?.deletedFromDisk).toBe(false);
    expect(marked?.metadataCleaned).toBe(true);
    // 成功项从列表移除
    expect(result.current.entries).toHaveLength(0);
  });

  it("delete v2 失败项如实上报错误码", async () => {
    vi.mocked(isSessionDeleteV2Enabled).mockReturnValue(true);
    vi.mocked(listWorkspaceSessions).mockResolvedValueOnce({
      data: [
        {
          sessionId: "dsh:s-9",
          workspaceId: "ws-1",
          engine: "dsh",
          title: "DSH",
          updatedAt: 1,
          threadKind: "native",
        },
      ],
      nextCursor: null,
      partialSource: null,
    });
    vi.mocked(requestSessionDelete).mockResolvedValue([
      { sessionId: "dsh:s-9", ok: false, code: "ENGINE_BUSY", error: "dsh daemon connect timeout" },
    ]);

    const { result } = renderHook(() =>
      useWorkspaceSessionCatalog({
        mode: "project",
        workspaceId: "ws-1",
        filters: DEFAULT_FILTERS,
      }),
    );
    await waitFor(() => expect(result.current.entries).toHaveLength(1));

    let response: WorkspaceSessionCatalogMutationResponse | undefined;
    await act(async () => {
      response = await result.current.mutate("delete", result.current.entries);
    });

    const item = response?.results[0];
    expect(item?.ok).toBe(false);
    expect(item?.code).toBe("ENGINE_BUSY");
    expect(item?.error).toBe("dsh daemon connect timeout");
    // 失败项保留在列表中
    expect(result.current.entries).toHaveLength(1);
  });
});
