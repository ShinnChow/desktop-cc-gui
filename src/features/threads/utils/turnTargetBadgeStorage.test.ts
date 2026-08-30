import { beforeEach, describe, expect, it, vi } from "vitest";

const clientStorageMocks = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: clientStorageMocks.getClientStoreSync,
  writeClientStoreValue: clientStorageMocks.writeClientStoreValue,
}));

import {
  appendTurnTargetBadge,
  loadTurnTargetBadgesForThread,
  mergeTurnTargetBadgesIntoItems,
  renameTurnTargetBadgeThread,
} from "./turnTargetBadgeStorage";
import type { ConversationItem } from "../../../types";

const SNAPSHOT_A = Object.freeze({
  engine: "pi" as const,
  model: "kimi-coding/k3",
  reasoning: { effort: "low" },
  providerProfileNameSnapshot: "本地配置",
  providerProfileSource: "local",
});

const SNAPSHOT_B = Object.freeze({
  ...SNAPSHOT_A,
  engine: "claude" as const,
  model: "claude-sonnet-5",
});

function user(text: string): ConversationItem {
  return { id: `user-${text}`, kind: "message", role: "user", text };
}

function assistant(id: string): ConversationItem {
  return {
    id,
    kind: "message",
    role: "assistant",
    text: `reply-${id}`,
    isFinal: true,
  };
}

describe("turnTargetBadgeStorage history sidecar", () => {
  let threadStores: Map<string, unknown>;

  beforeEach(() => {
    clientStorageMocks.getClientStoreSync.mockReset();
    clientStorageMocks.writeClientStoreValue.mockReset();
    threadStores = new Map();
    clientStorageMocks.getClientStoreSync.mockImplementation(
      (_store: string, key: string) => threadStores.get(key),
    );
    clientStorageMocks.writeClientStoreValue.mockImplementation(
      (_store: string, key: string, value: unknown) => {
        threadStores.set(key, JSON.parse(JSON.stringify(value ?? {})));
      },
    );
  });

  it("appends per-send entries into the threads store ring", () => {
    appendTurnTargetBadge("pi:s1", SNAPSHOT_A, 1_000);
    appendTurnTargetBadge("pi:s1", SNAPSHOT_B, 8_000);

    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledTimes(2);
    const [, key, value] =
      clientStorageMocks.writeClientStoreValue.mock.calls[1]!;
    expect(key).toBe("turnTargetBadges");
    const threadEntries = (value as Record<string, unknown>)["pi:s1"] as unknown[];
    expect(threadEntries).toHaveLength(2);
  });

  it("collapses a resend burst (<1s apart) onto the tail entry", () => {
    appendTurnTargetBadge("pi:s1", SNAPSHOT_A, 1_000);
    appendTurnTargetBadge("pi:s1", SNAPSHOT_B, 1_500);
    const [, , value] =
      clientStorageMocks.writeClientStoreValue.mock.calls[1]!;
    const threadEntries = (value as Record<string, unknown>)["pi:s1"] as Array<{
      snapshot: { engine: string };
    }>;
    expect(threadEntries).toHaveLength(1);
    expect(threadEntries[0]!.snapshot.engine).toBe("claude");
  });

  it("refuses shared routing scopes when appending and loading", () => {
    appendTurnTargetBadge("shared:t1", SNAPSHOT_A, 1_000);
    appendTurnTargetBadge("agent-canvas:a", SNAPSHOT_A, 2_000);
    appendTurnTargetBadge("kimi-pending-shared-x", SNAPSHOT_A, 3_000);
    expect(clientStorageMocks.writeClientStoreValue).not.toHaveBeenCalled();
    expect(loadTurnTargetBadgesForThread("shared:t1")).toEqual([]);
  });

  it("migrates pending-id entries onto the finalized thread id", () => {
    appendTurnTargetBadge("pi-pending-abc", SNAPSHOT_A, 1_000);

    renameTurnTargetBadgeThread("pi-pending-abc", "pi:s1");

    expect(loadTurnTargetBadgesForThread("pi:s1")).toHaveLength(1);
    expect(loadTurnTargetBadgesForThread("pi-pending-abc")).toEqual([]);
  });

  it("merges rename chronologically when the finalized id already has entries", () => {
    appendTurnTargetBadge("pi:s1", SNAPSHOT_B, 5_000);
    appendTurnTargetBadge("pi-pending-abc", SNAPSHOT_A, 1_000);

    renameTurnTargetBadgeThread("pi-pending-abc", "pi:s1");

    const entries = loadTurnTargetBadgesForThread("pi:s1");
    expect(entries.map((entry) => entry.recordedAt)).toEqual([1_000, 5_000]);
    expect(loadTurnTargetBadgesForThread("pi-pending-abc")).toEqual([]);
  });

  it("no-ops rename when ids match or the source has no entries", () => {
    appendTurnTargetBadge("pi:s1", SNAPSHOT_A, 1_000);
    const writesBefore =
      clientStorageMocks.writeClientStoreValue.mock.calls.length;

    renameTurnTargetBadgeThread("pi:s1", "pi:s1");
    renameTurnTargetBadgeThread("pi-pending-abc", "pi:s1");

    expect(clientStorageMocks.writeClientStoreValue.mock.calls.length).toBe(
      writesBefore,
    );
    expect(loadTurnTargetBadgesForThread("pi:s1")).toHaveLength(1);
  });

  it("merges ring entries tail-aligned to user turns without overwriting", () => {
    appendTurnTargetBadge("pi:s1", SNAPSHOT_A, 1_000);
    // 直接读一次存储再回灌，模拟重启后的冷加载路径
    const persisted =
      clientStorageMocks.writeClientStoreValue.mock.calls[0]![2];
    clientStorageMocks.getClientStoreSync.mockReturnValue(persisted);

    const history: ConversationItem[] = [
      user("你好"),
      assistant("a1"),
      user("在吗"),
      assistant("a2"),
    ];
    const merged = mergeTurnTargetBadgesIntoItems(
      "pi:s1",
      history,
      loadTurnTargetBadgesForThread("pi:s1"),
    );
    const firstReply = merged[1]!;
    const secondReply = merged[3]!;
    if (
      firstReply.kind !== "message" ||
      secondReply.kind !== "message"
    ) {
      throw new Error("expected message items");
    }
    // 仅一轮记录：尾对齐命中最新一轮（第二轮），第一轮不伪造。
    expect(secondReply.executionTargetSnapshot).toEqual(SNAPSHOT_A);
    // 历史补挂同时合成 send.request 回执 → Ⓡ 尾巴与展开面板可用。
    expect(secondReply.runtimeReceipt).toEqual({
      model: SNAPSHOT_A.model,
      modelSource: "send.request",
    });
    expect(firstReply.executionTargetSnapshot).toBeUndefined();
    expect(firstReply.runtimeReceipt).toBeUndefined();
  });

  it("keeps items untouched when nothing qualifies", () => {
    const lonelyHistory: ConversationItem[] = [assistant("lonely")];
    expect(mergeTurnTargetBadgesIntoItems("pi:s1", lonelyHistory)).toBe(
      lonelyHistory,
    );
    const sharedHistory: ConversationItem[] = [user("hi"), assistant("a")];
    expect(mergeTurnTargetBadgesIntoItems("shared:x", sharedHistory)).toBe(
      sharedHistory,
    );
  });
});
