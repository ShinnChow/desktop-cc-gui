import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";

const clientStorageMocks = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: clientStorageMocks.getClientStoreSync,
  writeClientStoreValue: clientStorageMocks.writeClientStoreValue,
}));

import {
  MAX_TURN_FINAL_META_ENTRIES_PER_THREAD,
  MAX_TURN_FINAL_META_THREADS,
  TURN_FINAL_META_STORE_KEY,
  deleteTurnFinalMetaForThread,
  mergeTurnFinalMetaIntoItems,
  normalizeTurnFinalMetaMap,
  persistTurnFinalMetaFromAssistant,
  persistTurnFinalMetaFromItems,
  pruneTurnFinalMetaEntries,
  pruneTurnFinalMetaMap,
  recordFromAssistantMessage,
  renameTurnFinalMetaThreadId,
  upsertTurnFinalMetaRecord,
  type TurnFinalMetaMap,
  type TurnFinalMetaRecord,
} from "./turnFinalMetaStorage";

function assistant(
  partial: Partial<Extract<ConversationItem, { kind: "message" }>> & {
    id: string;
    text?: string;
  },
): ConversationItem {
  return {
    kind: "message",
    role: "assistant",
    text: partial.text ?? "hello",
    ...partial,
  };
}

describe("turnFinalMetaStorage", () => {
  let store: TurnFinalMetaMap;

  beforeEach(() => {
    store = {};
    clientStorageMocks.getClientStoreSync.mockReset();
    clientStorageMocks.writeClientStoreValue.mockReset();
    clientStorageMocks.getClientStoreSync.mockImplementation(
      (_store: string, key: string) => {
        if (key === TURN_FINAL_META_STORE_KEY) {
          return store;
        }
        return undefined;
      },
    );
    clientStorageMocks.writeClientStoreValue.mockImplementation(
      (_store: string, key: string, value: unknown) => {
        if (key === TURN_FINAL_META_STORE_KEY) {
          store = value as TurnFinalMetaMap;
        }
      },
    );
  });

  it("records final meta from a final assistant message", () => {
    const item = assistant({
      id: "a1",
      isFinal: true,
      turnId: "turn-1",
      finalCompletedAt: 1_000,
      finalDurationMs: 38_000,
      finalInputTokens: 147_900,
      finalOutputTokens: 849,
    });
    const record = recordFromAssistantMessage(
      item as Extract<ConversationItem, { kind: "message"; role: "assistant" }>,
      2_000,
    );
    expect(record).toEqual({
      assistantItemId: "a1",
      turnId: "turn-1",
      finalCompletedAt: 1_000,
      finalDurationMs: 38_000,
      finalInputTokens: 147_900,
      finalOutputTokens: 849,
      updatedAt: 2_000,
    });
  });

  it("ignores non-final assistants when recording", () => {
    expect(
      recordFromAssistantMessage(
        assistant({ id: "a1", finalInputTokens: 10 }) as Extract<
          ConversationItem,
          { kind: "message"; role: "assistant" }
        >,
      ),
    ).toBeNull();
  });

  it("persists and upserts richer token fields for the same assistant id", () => {
    persistTurnFinalMetaFromAssistant(
      "thread-1",
      assistant({
        id: "a1",
        isFinal: true,
        finalDurationMs: 1_000,
        finalCompletedAt: 10_000,
      }),
    );
    persistTurnFinalMetaFromAssistant(
      "thread-1",
      assistant({
        id: "a1",
        isFinal: true,
        finalDurationMs: 1_000,
        finalCompletedAt: 10_000,
        finalInputTokens: 100,
        finalOutputTokens: 20,
      }),
    );

    expect(store["thread-1"]).toHaveLength(1);
    expect(store["thread-1"]?.[0]).toMatchObject({
      assistantItemId: "a1",
      finalDurationMs: 1_000,
      finalInputTokens: 100,
      finalOutputTokens: 20,
    });
  });

  it("merges sidecar meta into history items without overwriting explicit values", () => {
    const records: TurnFinalMetaRecord[] = [
      {
        assistantItemId: "old-id",
        turnId: "turn-1",
        finalCompletedAt: 5_000,
        finalDurationMs: 38_000,
        finalInputTokens: 147_900,
        finalOutputTokens: 849,
        updatedAt: 5_000,
      },
    ];
    const items: ConversationItem[] = [
      assistant({
        id: "history-id",
        turnId: "turn-1",
        isFinal: true,
        finalCompletedAt: 5_000,
        // history only recovered duration; tokens missing
        finalDurationMs: 40_000,
      }),
    ];

    const merged = mergeTurnFinalMetaIntoItems("thread-1", items, records);
    const message = merged[0];
    expect(message).toMatchObject({
      id: "history-id",
      isFinal: true,
      // explicit duration wins
      finalDurationMs: 40_000,
      // tokens filled from sidecar
      finalInputTokens: 147_900,
      finalOutputTokens: 849,
      finalCompletedAt: 5_000,
    });
  });

  it("falls back to ordinal matching when item ids change on reload", () => {
    const records: TurnFinalMetaRecord[] = [
      {
        assistantItemId: "live-a",
        finalCompletedAt: 1_000,
        finalDurationMs: 10_000,
        finalInputTokens: 11,
        finalOutputTokens: 1,
        updatedAt: 1_000,
      },
      {
        assistantItemId: "live-b",
        finalCompletedAt: 2_000,
        finalDurationMs: 20_000,
        finalInputTokens: 22,
        finalOutputTokens: 2,
        updatedAt: 2_000,
      },
    ];
    const items: ConversationItem[] = [
      assistant({ id: "hist-1", isFinal: true }),
      assistant({ id: "hist-2", isFinal: true }),
    ];

    const merged = mergeTurnFinalMetaIntoItems("thread-1", items, records);
    expect(merged[0]).toMatchObject({
      id: "hist-1",
      finalInputTokens: 11,
      finalOutputTokens: 1,
      finalDurationMs: 10_000,
    });
    expect(merged[1]).toMatchObject({
      id: "hist-2",
      finalInputTokens: 22,
      finalOutputTokens: 2,
      finalDurationMs: 20_000,
    });
  });

  it("returns the same array reference when nothing needs filling", () => {
    const items: ConversationItem[] = [
      assistant({
        id: "a1",
        isFinal: true,
        finalCompletedAt: 1,
        finalDurationMs: 2,
        finalInputTokens: 3,
        finalOutputTokens: 4,
      }),
    ];
    const records: TurnFinalMetaRecord[] = [
      {
        assistantItemId: "a1",
        finalCompletedAt: 9,
        finalDurationMs: 9,
        finalInputTokens: 9,
        finalOutputTokens: 9,
        updatedAt: 9,
      },
    ];
    const merged = mergeTurnFinalMetaIntoItems("thread-1", items, records);
    expect(merged).toBe(items);
  });

  it("renames thread meta keys and merges into the target", () => {
    store = {
      "thread-old": [
        {
          assistantItemId: "a1",
          finalDurationMs: 1_000,
          finalInputTokens: 10,
          finalOutputTokens: 1,
          updatedAt: 1,
        },
      ],
      "thread-new": [
        {
          assistantItemId: "a2",
          finalDurationMs: 2_000,
          finalInputTokens: 20,
          finalOutputTokens: 2,
          updatedAt: 2,
        },
      ],
    };

    renameTurnFinalMetaThreadId("thread-old", "thread-new");

    expect(store["thread-old"]).toBeUndefined();
    expect(store["thread-new"]).toHaveLength(2);
    expect(store["thread-new"]?.map((entry) => entry.assistantItemId).sort()).toEqual([
      "a1",
      "a2",
    ]);
  });

  it("deletes meta for a removed thread", () => {
    store = {
      "thread-1": [
        {
          assistantItemId: "a1",
          finalDurationMs: 1,
          updatedAt: 1,
        },
      ],
    };
    deleteTurnFinalMetaForThread("thread-1");
    expect(store["thread-1"]).toBeUndefined();
  });

  it("prunes oldest entries per thread", () => {
    const entries: TurnFinalMetaRecord[] = Array.from({ length: 5 }, (_, index) => ({
      assistantItemId: `a${index}`,
      finalDurationMs: index,
      updatedAt: index + 1,
    }));
    const pruned = pruneTurnFinalMetaEntries(entries, 3);
    expect(pruned).toHaveLength(3);
    expect(pruned.map((entry) => entry.assistantItemId)).toEqual(["a2", "a3", "a4"]);
  });

  it("caps thread count at the tightened 200-thread budget, keeping newest", () => {
    // F2c（fix-session-switch-jank-red-lines）：500 线程上限曾把存量堆到 633KB。
    expect(MAX_TURN_FINAL_META_THREADS).toBe(200);

    const map: TurnFinalMetaMap = {};
    for (let index = 0; index < 201; index += 1) {
      map[`thread-${index}`] = [
        {
          assistantItemId: `a-${index}`,
          finalDurationMs: index,
          updatedAt: index + 1,
        },
      ];
    }
    const pruned = pruneTurnFinalMetaMap(map);
    expect(Object.keys(pruned)).toHaveLength(200);
    // 最旧的 thread-0 被剪掉，最新的 thread-200 保留
    expect(pruned["thread-0"]).toBeUndefined();
    expect(pruned["thread-200"]).toEqual([
      { assistantItemId: "a-200", finalDurationMs: 200, updatedAt: 201 },
    ]);
  });

  it("normalizes corrupted store payloads", () => {
    expect(normalizeTurnFinalMetaMap(null)).toEqual({});
    expect(
      normalizeTurnFinalMetaMap({
        "thread-1": [
          { assistantItemId: "a1", finalDurationMs: 10, updatedAt: 1 },
          { assistantItemId: "", finalDurationMs: 10 },
          "bad",
        ],
        " ": [{ assistantItemId: "x", finalDurationMs: 1 }],
      }),
    ).toEqual({
      "thread-1": [
        {
          assistantItemId: "a1",
          finalDurationMs: 10,
          updatedAt: 1,
        },
      ],
    });
  });

  it("persistTurnFinalMetaFromItems writes all final assistants with meta", () => {
    persistTurnFinalMetaFromItems("thread-1", [
      assistant({ id: "u-skip", role: "user", text: "hi" } as never),
      assistant({
        id: "a1",
        isFinal: true,
        finalDurationMs: 1_000,
        finalInputTokens: 5,
        finalOutputTokens: 1,
      }),
      assistant({
        id: "a2",
        isFinal: true,
        finalDurationMs: 2_000,
        finalInputTokens: 6,
        finalOutputTokens: 2,
      }),
    ]);
    expect(store["thread-1"]).toHaveLength(2);
    expect(clientStorageMocks.writeClientStoreValue).toHaveBeenCalledWith(
      "threads",
      TURN_FINAL_META_STORE_KEY,
      expect.any(Object),
    );
  });

  it("upserts by turnId when assistant item id changes", () => {
    const first = upsertTurnFinalMetaRecord(
      [],
      {
        assistantItemId: "live-id",
        turnId: "turn-9",
        finalInputTokens: 10,
        finalOutputTokens: 1,
        updatedAt: 1,
      },
    );
    const second = upsertTurnFinalMetaRecord(first, {
      assistantItemId: "history-id",
      turnId: "turn-9",
      finalInputTokens: 12,
      finalOutputTokens: 2,
      updatedAt: 2,
    });
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      assistantItemId: "history-id",
      turnId: "turn-9",
      finalInputTokens: 12,
      finalOutputTokens: 2,
    });
  });

  it("keeps the per-thread entry cap constant", () => {
    expect(MAX_TURN_FINAL_META_ENTRIES_PER_THREAD).toBeGreaterThan(0);
  });
});
