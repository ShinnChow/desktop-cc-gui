import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getClientStoreSync,
  resetClientStorageForTests,
  writeClientStoreValue,
} from "../../../services/clientStorage";
import { appendVolatileRendererDiagnostic } from "../../../services/rendererDiagnostics";
import type { QueuedMessage } from "../../../types";
import {
  readSharedQueuedFollowUps,
  writeSharedQueuedFollowUps,
} from "./sharedQueuedFollowUpStore";

vi.mock("../../../services/rendererDiagnostics", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../services/rendererDiagnostics")
  >()),
  appendVolatileRendererDiagnostic: vi.fn(),
}));

vi.mock("../../../services/clientStorage", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../services/clientStorage")
  >();
  return {
    ...actual,
    writeClientStoreValue: vi.fn(actual.writeClientStoreValue),
  };
});

const TARGET = {
  engine: "codex" as const,
  providerProfileId: "provider-1",
  modelCatalogEntryId: "catalog-1",
  model: "gpt-5.6-sol",
  reasoning: { effort: "max" },
  providerProfileNameSnapshot: "OpenAI",
  providerProfileSource: "managed" as const,
};

describe("sharedQueuedFollowUpStore", () => {
  beforeEach(() => {
    resetClientStorageForTests();
    vi.clearAllMocks();
  });

  it("round-trips the frozen Shared envelope", () => {
    const item: QueuedMessage = {
      id: "queued-1",
      text: "继续检查",
      createdAt: 42,
      images: ["local://image"],
      sendOptions: { effort: "max" },
      sharedExecutionTarget: TARGET,
      sharedPredecessorAttemptId: "attempt-1",
      ownerWorkspaceId: "workspace-1",
      ownerThreadId: "shared:thread-1",
    };

    writeSharedQueuedFollowUps("workspace-1", "shared:thread-1", [item]);

    expect(readSharedQueuedFollowUps("workspace-1", "shared:thread-1")).toEqual(
      [item],
    );
    expect(
      getClientStoreSync("composer", "sharedQueuedFollowUps.v1"),
    ).toBeTruthy();
  });

  it("fails closed for a persisted item without a resolved target", () => {
    writeClientStoreValue(
      "composer",
      "sharedQueuedFollowUps.v1",
      {
        [JSON.stringify(["workspace-1", "shared:thread-1"])]: [
          {
            id: "queued-1",
            text: "不要回退 Picker",
            createdAt: 42,
            sharedExecutionTarget: {
              engine: "codex",
              model: "gpt-5.6-sol",
            },
          },
        ],
      },
      { immediate: true },
    );

    expect(readSharedQueuedFollowUps("workspace-1", "shared:thread-1")).toEqual(
      [],
    );
  });

  it("does not restore an options-level Target beside the frozen envelope", () => {
    const item: QueuedMessage = {
      id: "queued-1",
      text: "只允许 envelope owner",
      createdAt: 42,
      sendOptions: {
        sharedExecutionTarget: {
          ...TARGET,
          providerProfileId: "provider-stale",
        },
      },
      sharedExecutionTarget: TARGET,
      sharedPredecessorAttemptId: "attempt-1",
    };

    writeSharedQueuedFollowUps("workspace-1", "shared:thread-1", [item]);

    expect(
      readSharedQueuedFollowUps("workspace-1", "shared:thread-1")[0]
        ?.sendOptions,
    ).not.toHaveProperty("sharedExecutionTarget");
  });

  it("persists without the immediate channel", () => {
    writeSharedQueuedFollowUps("workspace-1", "shared:thread-1", [
      buildQueuedMessage("queued-1", "排队消息"),
    ]);

    const envelopeWrites = vi
      .mocked(writeClientStoreValue)
      .mock.calls.filter(
        ([store, key]) =>
          store === "composer" && key === "sharedQueuedFollowUps.v1",
      );
    expect(envelopeWrites.length).toBeGreaterThan(0);
    for (const [, , , options] of envelopeWrites) {
      expect(
        (options as { immediate?: boolean } | undefined)?.immediate,
      ).not.toBe(true);
    }
  });

  it("prunes queues whose workspace or thread no longer exists on write", () => {
    seedSidebarSnapshot();
    writeClientStoreValue("composer", "sharedQueuedFollowUps.v1", {
      [JSON.stringify(["workspace-gone", "shared:thread-9"])]: [
        buildQueuedMessage("queued-stale-ws", "失效 workspace"),
      ],
      [JSON.stringify(["workspace-1", "shared:thread-gone"])]: [
        buildQueuedMessage("queued-stale-thread", "失效 thread"),
      ],
    });

    writeSharedQueuedFollowUps("workspace-1", "shared:thread-1", [
      buildQueuedMessage("queued-live", "存活队列"),
    ]);

    const envelope = getClientStoreSync<Record<string, unknown>>(
      "composer",
      "sharedQueuedFollowUps.v1",
    ) as Record<string, unknown>;
    expect(Object.keys(envelope)).toEqual([
      JSON.stringify(["workspace-1", "shared:thread-1"]),
    ]);
  });

  it("keeps queues for an empty-but-known workspace thread list", () => {
    seedSidebarSnapshot({ "workspace-1": [] });
    writeClientStoreValue("composer", "sharedQueuedFollowUps.v1", {
      [JSON.stringify(["workspace-1", "shared:thread-1"])]: [
        buildQueuedMessage("queued-keep", "线程列表未水化"),
      ],
    });

    writeSharedQueuedFollowUps("workspace-1", "shared:thread-1", [
      buildQueuedMessage("queued-live", "存活队列"),
    ]);

    const envelope = getClientStoreSync<Record<string, unknown>>(
      "composer",
      "sharedQueuedFollowUps.v1",
    ) as Record<string, unknown>;
    expect(envelope[JSON.stringify(["workspace-1", "shared:thread-1"])]).toBeTruthy();
  });

  it("strips oversize images beyond the persisted budget while keeping small ones", () => {
    const smallImage = `data:image/png;base64,${"A".repeat(100 * 1024)}`;
    const hugeImage = `data:image/png;base64,${"B".repeat(600 * 1024)}`;
    const item: QueuedMessage = {
      ...buildQueuedMessage("queued-img", "带图排队"),
      images: [smallImage, hugeImage],
    };

    writeSharedQueuedFollowUps("workspace-1", "shared:thread-1", [item]);

    const persisted = readSharedQueuedFollowUps(
      "workspace-1",
      "shared:thread-1",
    );
    expect(persisted[0]?.images).toEqual([smallImage]);
    expect(vi.mocked(appendVolatileRendererDiagnostic)).toHaveBeenCalledWith(
      "composer/queue-image-stripped",
      expect.objectContaining({ stripped: 1, kept: 1 }),
    );
  });
});

function buildQueuedMessage(id: string, text: string): QueuedMessage {
  return {
    id,
    text,
    createdAt: 42,
    sharedExecutionTarget: TARGET,
    ownerWorkspaceId: "workspace-1",
    ownerThreadId: "shared:thread-1",
  };
}

function seedSidebarSnapshot(
  threadsByWorkspaceOverride?: Record<string, unknown[]>,
): void {
  writeClientStoreValue("threads", "sidebarSnapshot", {
    version: 1,
    updatedAt: 1,
    workspaces: [
      { id: "workspace-1", name: "Repo", path: "/tmp/repo", connected: true },
    ],
    threadsByWorkspace:
      threadsByWorkspaceOverride ??
      {
        "workspace-1": [{ id: "shared:thread-1", name: "Chat", updatedAt: 1 }],
      },
  });
}
