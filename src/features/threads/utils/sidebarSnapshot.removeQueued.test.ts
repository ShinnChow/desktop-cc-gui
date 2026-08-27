// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClientStoreSyncMock = vi.fn();
const writeClientStoreValueMock = vi.fn();

vi.mock("../../../services/clientStorage", () => ({
  getClientStoreSync: (...args: unknown[]) => getClientStoreSyncMock(...args),
  writeClientStoreValue: (...args: unknown[]) =>
    writeClientStoreValueMock(...args),
}));

import {
  flushQueuedRemovalsSyncForTests,
  queueRemoveThreadsFromSidebarSnapshot,
  resetSidebarSnapshotRemovalQueueForTests,
  type SidebarSnapshot,
} from "./sidebarSnapshot";
import type { ThreadSummary } from "../../../types";

function thread(
  id: string,
  overrides: Partial<ThreadSummary> = {},
): ThreadSummary {
  return {
    id,
    name: `name-${id}`,
    updatedAt: 1000,
    ...overrides,
  };
}

function snapshotWith(
  threadsByWorkspace: Record<string, ThreadSummary[]>,
): SidebarSnapshot {
  return {
    version: 1,
    updatedAt: 1234,
    workspaces: [
      {
        id: "ws-1",
        name: "WS 1",
        path: "/tmp/ws-1",
        connected: true,
        // 真实持久化形状必带 settings；缺省会走 normalize 失败分支。
        settings: { sidebarCollapsed: false },
      },
    ],
    threadsByWorkspace,
  };
}

function flushQueue(): void {
  flushQueuedRemovalsSyncForTests();
}

describe("queueRemoveThreadsFromSidebarSnapshot", () => {
  beforeEach(() => {
    getClientStoreSyncMock.mockReset();
    writeClientStoreValueMock.mockReset();
    resetSidebarSnapshotRemovalQueueForTests();
  });

  it("removes queued rows across workspaces in one coalesced write and keeps everything else intact", async () => {
    const snapshot = snapshotWith({
      "ws-1": [thread("keep-1"), thread("drop-A"), thread("keep-2")],
      "ws-2": [thread("drop-B"), thread("keep-3")],
    });
    getClientStoreSyncMock.mockReturnValue(snapshot);
    queueRemoveThreadsFromSidebarSnapshot("ws-1", "drop-A");
    queueRemoveThreadsFromSidebarSnapshot("ws-2", "drop-B");
    flushQueue();

    expect(writeClientStoreValueMock).toHaveBeenCalledTimes(1);
    const [, , written] = writeClientStoreValueMock.mock.calls[0] as [
      string,
      string,
      SidebarSnapshot,
    ];
    expect(written.threadsByWorkspace).toEqual({
      "ws-1": [expect.objectContaining({ id: "keep-1" }), expect.objectContaining({ id: "keep-2" })],
      "ws-2": [expect.objectContaining({ id: "keep-3" })],
    });
    // 未受影响字段原样保留
    expect(written.version).toBe(1);
    expect(written.workspaces).toEqual(snapshot.workspaces);
  });

  it("coalesces repeated removals for the same row into a single flush that no longer finds it", async () => {
    const snapshot = snapshotWith({
      "ws-1": [thread("drop-A"), thread("keep-1")],
    });
    getClientStoreSyncMock.mockReturnValue(snapshot);

    queueRemoveThreadsFromSidebarSnapshot("ws-1", "drop-A");
    queueRemoveThreadsFromSidebarSnapshot("ws-1", "drop-A");
    flushQueue();

    expect(writeClientStoreValueMock).toHaveBeenCalledTimes(1);
    const [, , written] = writeClientStoreValueMock.mock.calls[0] as [
      string,
      string,
      SidebarSnapshot,
    ];
    expect(written.threadsByWorkspace["ws-1"]).toEqual([
      expect.objectContaining({ id: "keep-1" }),
    ]);
  });

  it("skips the store write entirely when none of the queued ids exist in the snapshot", async () => {
    getClientStoreSyncMock.mockReturnValue(
      snapshotWith({ "ws-1": [thread("keep-1")] }),
    );

    queueRemoveThreadsFromSidebarSnapshot("ws-1", "ghost-id");
    queueRemoveThreadsFromSidebarSnapshot("ws-x", "also-absent");
    flushQueue();

    expect(writeClientStoreValueMock).not.toHaveBeenCalled();
  });

  it("tolerates a missing or malformed persisted snapshot without writing", async () => {
    getClientStoreSyncMock.mockReturnValue(null);

    queueRemoveThreadsFromSidebarSnapshot("ws-1", "drop-A");
    flushQueue();

    expect(writeClientStoreValueMock).not.toHaveBeenCalled();
  });

  it("drops pending removals when reset for tests", async () => {
    getClientStoreSyncMock.mockReturnValue(
      snapshotWith({ "ws-1": [thread("drop-A")] }),
    );

    queueRemoveThreadsFromSidebarSnapshot("ws-1", "drop-A");
    resetSidebarSnapshotRemovalQueueForTests();
    flushQueue();

    expect(writeClientStoreValueMock).not.toHaveBeenCalled();
  });
});
