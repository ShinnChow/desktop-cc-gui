// @vitest-environment jsdom
// F1a（fix-session-switch-jank-red-lines）：sidebarSnapshot 内容签名跳过契约。
// 切会话时 useThreads.ts 的 effect 因无关 dispatch 换引用触发，内容未变时必须零成本早退
// （不 normalize、不写盘），内容变化时正常写。红线测试：现实现无签名比对，必然红。
import { beforeEach, describe, expect, it, vi } from "vitest";

const backingStores: Record<string, Record<string, unknown>> = {};

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: vi.fn(
    (store: string, key: string) => backingStores[store]?.[key],
  ),
  writeClientStoreValue: vi.fn((store: string, key: string, value: unknown) => {
    backingStores[store] ??= {};
    backingStores[store][key] = value;
  }),
}));

import {
  getClientStoreSync,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import type { ThreadSummary } from "../../../types";
import {
  saveSidebarSnapshotAllThreads,
  __resetSidebarSnapshotSignatureForTests,
} from "./sidebarSnapshot";

function buildThreads(
  workspaceThreadId: string,
): Record<string, ThreadSummary[]> {
  return {
    "ws-1": [
      {
        id: workspaceThreadId,
        name: "Cached chat",
        createdAt: 40,
        updatedAt: 100,
      },
    ],
  };
}

function sidebarSnapshotKeyWriteCount(): number {
  return vi
    .mocked(writeClientStoreValue)
    .mock.calls.filter(
      ([store, key]) => store === "threads" && key === "sidebarSnapshot",
    ).length;
}

function sidebarSnapshotReadCount(): number {
  return vi
    .mocked(getClientStoreSync)
    .mock.calls.filter(
      ([store, key]) => store === "threads" && key === "sidebarSnapshot",
    ).length;
}

describe("sidebarSnapshot 内容签名跳过", () => {
  beforeEach(() => {
    for (const key of Object.keys(backingStores)) {
      delete backingStores[key];
    }
    vi.clearAllMocks();
    __resetSidebarSnapshotSignatureForTests();
  });

  it("内容未变的重复保存不写盘、不重复 normalize", () => {
    saveSidebarSnapshotAllThreads(buildThreads("t-1"));
    expect(sidebarSnapshotKeyWriteCount()).toBe(1);

    const readsBefore = sidebarSnapshotReadCount();
    const writesBefore = sidebarSnapshotKeyWriteCount();

    // 新引用、同内容：effect 换引用的典型形态
    saveSidebarSnapshotAllThreads(buildThreads("t-1"));

    expect(sidebarSnapshotKeyWriteCount()).toBe(writesBefore);
    expect(sidebarSnapshotReadCount()).toBe(readsBefore);
  });

  it("内容变化时正常写入", () => {
    saveSidebarSnapshotAllThreads(buildThreads("t-1"));
    saveSidebarSnapshotAllThreads(buildThreads("t-2"));

    expect(sidebarSnapshotKeyWriteCount()).toBe(2);
    const persisted = backingStores.threads?.sidebarSnapshot as {
      threadsByWorkspace: Record<string, unknown[]>;
    };
    expect(persisted.threadsByWorkspace["ws-1"][0]).toMatchObject({
      id: "t-2",
    });
  });

  it("reset 后同内容不重写（签名从磁盘现值初始化）", () => {
    saveSidebarSnapshotAllThreads(buildThreads("t-1"));
    expect(sidebarSnapshotKeyWriteCount()).toBe(1);

    __resetSidebarSnapshotSignatureForTests();
    saveSidebarSnapshotAllThreads(buildThreads("t-1"));

    // 磁盘上已是同内容：跳过而非重写
    expect(sidebarSnapshotKeyWriteCount()).toBe(1);
  });

  it("reset 后内容变化时写入", () => {
    saveSidebarSnapshotAllThreads(buildThreads("t-1"));
    __resetSidebarSnapshotSignatureForTests();
    saveSidebarSnapshotAllThreads(buildThreads("t-2"));

    expect(sidebarSnapshotKeyWriteCount()).toBe(2);
  });
});
