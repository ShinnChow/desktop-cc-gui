// @vitest-environment jsdom
// F1b（fix-session-switch-jank-red-lines）：radar 持久化去 immediate 契约。
// 三类 leida key 的持久化 MUST 走默认 debounce 合并通道，MUST NOT 以 immediate:true
// 绕过 300ms 写合并。红线测试：现实现三处均传 immediate:true，必然红。
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationItem,
  ThreadSummary,
  WorkspaceInfo,
} from "../../../types";
import { writeClientStoreValue } from "../../../services/clientStorage";
import { useSessionRadarFeed } from "./useSessionRadarFeed";

const clientStoreCache = new Map<string, unknown>();

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn((store: string, key: string) =>
    clientStoreCache.get(`${store}:${key}`),
  ),
  writeClientStoreValue: vi.fn((store: string, key: string, value: unknown) => {
    clientStoreCache.set(`${store}:${key}`, value);
  }),
  isClientStoreReady: () => true,
  subscribeClientStoreHydrated: () => () => {},
}));

function createWorkspace(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    settings: { sidebarCollapsed: true },
    connected: true,
    kind: "main",
  } as unknown as WorkspaceInfo;
}

function createThread(
  id: string,
  name: string,
  updatedAt: number,
): ThreadSummary {
  return {
    id,
    name,
    updatedAt,
    engineSource: "codex",
  };
}

function createUserMessage(id: string, text: string): ConversationItem {
  return {
    id,
    kind: "message",
    role: "user",
    text,
  } as ConversationItem;
}

describe("useSessionRadarFeed 持久化去 immediate", () => {
  beforeEach(() => {
    clientStoreCache.clear();
    vi.clearAllMocks();
  });

  it("radar 持久化写入不带 immediate 通道", () => {
    const workspace = createWorkspace("ws-main", "Workspace Main");
    const updatedAt = Date.now() - 5000;

    renderHook(() =>
      useSessionRadarFeed({
        workspaces: [workspace],
        threadsByWorkspace: {
          "ws-main": [createThread("thread-1", "Done Thread", updatedAt)],
        },
        threadStatusById: {
          "thread-1": { isProcessing: false, lastDurationMs: 1200 },
        },
        threadItemsByThread: {
          "thread-1": [createUserMessage("item-1", "finished question")],
        },
        lastAgentMessageByThread: {},
      }),
    );

    const leidaWrites = vi
      .mocked(writeClientStoreValue)
      .mock.calls.filter(([store]) => store === "leida");
    expect(leidaWrites.length).toBeGreaterThan(0);
    for (const [, , , options] of leidaWrites) {
      expect(
        (options as { immediate?: boolean } | undefined)?.immediate,
      ).not.toBe(true);
    }
  });
});
