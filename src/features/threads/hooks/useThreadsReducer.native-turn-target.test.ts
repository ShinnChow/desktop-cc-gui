import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationItem } from "../../../types";
import { initialState, threadReducer } from "./useThreadsReducer";
const clientStorageMocks = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: clientStorageMocks.getClientStoreSync,
  writeClientStoreValue: clientStorageMocks.writeClientStoreValue,
}));

import { appendTurnTargetBadge } from "../utils/turnTargetBadgeStorage";
import {
  getNativeTurnTarget,
  recordNativeTurnTarget,
  resetNativeTurnTargetsForTests,
} from "../utils/nativeTurnTargetLedger";

const WORKSPACE = "ws-native-badge";
const THREAD = "pi-session-native";

const SNAPSHOT = Object.freeze({
  engine: "pi" as const,
  providerProfileId: null,
  modelCatalogEntryId: "k3",
  model: "kimi-coding/k3",
  reasoning: { effort: "low" },
  providerProfileNameSnapshot: "本地配置",
  providerProfileSource: "local",
});

function assistantAt(index: number, text: string): MessageItem {
  return {
    id: `assistant-${index}`,
    kind: "message",
    role: "assistant",
    text,
    isFinal: false,
  };
}

function seedThread(items: ConversationItem[] = []) {
  return {
    ...initialState,
    threadsByWorkspace: {
      [WORKSPACE]: [
        {
          id: THREAD,
          name: "native",
          engineSource: "pi" as const,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
    },
    itemsByThread: {
      [THREAD]: items,
    },
  };
}

function readItems(state: ReturnType<typeof threadReducer>) {
  return state.itemsByThread[THREAD] ?? [];
}

type MessageItem = Extract<ConversationItem, { kind: "message" }>;

function userMsg(text: string): ConversationItem {
  return { id: `user-${text}`, kind: "message", role: "user", text };
}

function readMessage(
  state: ReturnType<typeof threadReducer>,
  itemId: string,
): MessageItem | undefined {
  const found = readItems(state).find((item) => item.id === itemId);
  return found?.kind === "message" ? found : undefined;
}

describe("threadReducer native turn-target snapshot (appendAgentDelta)", () => {
  beforeEach(() => {
    resetNativeTurnTargetsForTests();
    clientStorageMocks.getClientStoreSync.mockClear();
    clientStorageMocks.writeClientStoreValue.mockClear();
    clientStorageMocks.getClientStoreSync.mockImplementation(() => undefined);
  });

  it("creates the shell with the ledger snapshot on first delta", () => {
    recordNativeTurnTarget(WORKSPACE, THREAD, SNAPSHOT);
    const state = threadReducer(seedThread(), {
      type: "appendAgentDelta",
      workspaceId: WORKSPACE,
      threadId: THREAD,
      itemId: "msg-1",
      delta: "你好",
      hasCustomName: false,
      executionTargetSnapshot:
        getNativeTurnTarget(WORKSPACE, THREAD) ?? undefined,
    });
    expect(readMessage(state, "msg-1")?.executionTargetSnapshot).toEqual(
      SNAPSHOT,
    );
  });

  it("never overwrites an existing snapshot on later deltas", () => {
    const preexisting = {
      ...SNAPSHOT,
      engine: "claude" as const,
      providerProfileNameSnapshot: "早前目标",
    };
    const seededAssistant: MessageItem = {
      ...assistantAt(1, ""),
      executionTargetSnapshot: preexisting,
    };
    const state = threadReducer(seedThread([seededAssistant]), {
        type: "appendAgentDelta",
        workspaceId: WORKSPACE,
        threadId: THREAD,
        itemId: "assistant-1",
        delta: "正文",
        hasCustomName: false,
        executionTargetSnapshot: SNAPSHOT,
      },
    );
    expect(readMessage(state, "assistant-1")?.executionTargetSnapshot).toEqual(
      preexisting,
    );
  });
});

describe("threadReducer native turn-target snapshot (final settlement)", () => {
  beforeEach(() => {
    resetNativeTurnTargetsForTests();
  });

  it("preserves the streaming snapshot through flushAgentCompletedBatch", () => {    recordNativeTurnTarget(WORKSPACE, THREAD, SNAPSHOT);
    let state = threadReducer(seedThread(), {
      type: "appendAgentDelta",
      workspaceId: WORKSPACE,
      threadId: THREAD,
      itemId: "msg-2",
      delta: "**",
      hasCustomName: false,
      executionTargetSnapshot:
        getNativeTurnTarget(WORKSPACE, THREAD) ?? undefined,
    });
    state = threadReducer(state, {
      type: "flushAgentCompletedBatch",
      workspaceId: WORKSPACE,
      threadId: THREAD,
      itemId: "msg-2",
      text: "你好！👋 完整回复",
      hasCustomName: false,
      timestamp: Date.now(),
      isActiveThread: true,
      executionTargetSnapshot:
        getNativeTurnTarget(WORKSPACE, THREAD) ?? undefined,
    });
    const settled = readMessage(state, "msg-2");
    expect(settled?.isFinal).toBe(true);
    expect(settled?.text).toContain("完整回复");
    expect(settled?.executionTargetSnapshot).toEqual(SNAPSHOT);
  });

  it("attaches the snapshot when settling without any prior shell", () => {
    const state = threadReducer(seedThread(), {
      type: "flushAgentCompletedBatch",
      workspaceId: WORKSPACE,
      threadId: THREAD,
      itemId: "msg-3",
      text: "no-delta completion",
      hasCustomName: false,
      timestamp: Date.now(),
      isActiveThread: true,
      executionTargetSnapshot: SNAPSHOT,
    });
    expect(
      readMessage(state, "msg-3")?.executionTargetSnapshot,
    ).toEqual(SNAPSHOT);
  });
});
describe("threadReducer native turn-target history resume (setThreadItems)", () => {
  beforeEach(() => {
    resetNativeTurnTargetsForTests();
    const memoryMap = new Map<string, unknown>();
    clientStorageMocks.getClientStoreSync.mockClear();
    clientStorageMocks.writeClientStoreValue.mockClear();
    clientStorageMocks.getClientStoreSync.mockImplementation(
      (_store: string, key: string) =>
        JSON.parse(JSON.stringify(memoryMap.get(key) ?? {})),
    );
    clientStorageMocks.writeClientStoreValue.mockImplementation(
      (_store: string, key: string, value: unknown) => {
        memoryMap.set(key, value === undefined ? {} : JSON.parse(JSON.stringify(value)));
      },
    );
  });

  it("re-badges recent turns from the sidecar when reopening a session", () => {
    // 侧车会把显式 null 规范化为省略字段；期望值用同一形状。
    const firstSnapshot = {
      engine: "pi" as const,
      modelCatalogEntryId: "k3",
      model: "kimi-coding/k3",
      reasoning: { effort: "low" },
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "local" as const,
    };
    appendTurnTargetBadge(THREAD, firstSnapshot, 1_000);
    appendTurnTargetBadge(
      THREAD,
      { ...firstSnapshot, reasoning: { effort: "high" } },
      60_000,
    );


    const reloadedHistory: ConversationItem[] = [
      userMsg("你好"),
      { ...assistantAt(1, "你好！"), isFinal: true, finalCompletedAt: 2_000 },
      userMsg("继续"),
      { ...assistantAt(2, "好的"), isFinal: true, finalCompletedAt: 61_000 },
    ];

    const state = threadReducer(seedThread(), {
      type: "setThreadItems",
      threadId: THREAD,
      items: reloadedHistory,
    });

    const resumedFirst = readMessage(state, "assistant-1");
    const resumedSecond = readMessage(state, "assistant-2");
    expect(resumedFirst?.executionTargetSnapshot).toEqual(firstSnapshot);
    expect(resumedSecond?.executionTargetSnapshot).toEqual({
      ...firstSnapshot,
      reasoning: { effort: "high" },
    });
    // Ⓡ 尾巴：历史合成与实时相同的 send.request 语义回执
    expect(resumedSecond?.runtimeReceipt).toEqual({
      model: firstSnapshot.model,
      modelSource: "send.request",
    });
  });

  it("does not fabricate badges when the sidecar has no records (pre-feature history)", () => {
    const reloadedHistory: ConversationItem[] = [
      userMsg("你好"),
      assistantAt(1, "历史轮次"),
    ];
    const state = threadReducer(seedThread(), {
      type: "setThreadItems",
      threadId: THREAD,
      items: reloadedHistory,
    });
    expect(readMessage(state, "assistant-1")?.executionTargetSnapshot).toBeUndefined();
  });
});
