import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  claudeForkIndexTwinSessionId,
  isLocalPendingDraftSessionId,
  scheduleTombstoneClaudeForkIndexRow,
  scheduleTombstoneLocalPendingDraftIndexRow,
  writeClientCreatedSessionIndex,
} from "./sessionIndex";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

async function flushIndexWrite(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("sessionIndex pending drafts", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(1);
  });

  it("recognizes local pending session ids and rejects short aliases", () => {
    expect(
      isLocalPendingDraftSessionId("claude-pending-1787016153035-0bittx"),
    ).toBe(true);
    expect(
      isLocalPendingDraftSessionId("codex-pending-1786994371985-fv4mt5"),
    ).toBe(true);
    expect(isLocalPendingDraftSessionId("claude-pending-1")).toBe(false);
    expect(
      isLocalPendingDraftSessionId("claude-pending-subagent:parent:tool"),
    ).toBe(false);
  });

  it("does not upsert a pending client draft into Session Index", async () => {
    writeClientCreatedSessionIndex({
      engine: "claude",
      sessionId: "claude:claude-pending-1787016153035-0bittx",
      workspacePath: "/tmp/ws",
      title: "claude session",
    });
    await flushIndexWrite();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still upserts a real native session id", async () => {
    writeClientCreatedSessionIndex({
      engine: "claude",
      sessionId: "claude:session-real-1",
      workspacePath: "/tmp/ws",
      title: "帮我看一下这段代码",
    });
    await flushIndexWrite();
    expect(invoke).toHaveBeenCalledWith("upsert_session_index_rows", {
      rows: [
        expect.objectContaining({
          engine: "claude",
          sessionId: "session-real-1",
          title: "帮我看一下这段代码",
          workspacePath: "/tmp/ws",
          cwd: "/tmp/ws",
        }),
      ],
    });
  });

  it("keeps a canonical Qoder id intact for Rust-side profile validation", async () => {
    writeClientCreatedSessionIndex({
      engine: "qoder",
      sessionId: "qoder:__qoder_cn__:same-raw-session",
      workspacePath: "/tmp/ws",
      providerProfileId: "__qoder_cn__",
    });
    await flushIndexWrite();

    expect(invoke).toHaveBeenCalledWith("upsert_session_index_rows", {
      rows: [
        expect.objectContaining({
          engine: "qoder",
          sessionId: "qoder:__qoder_cn__:same-raw-session",
          providerProfileId: "__qoder_cn__",
        }),
      ],
    });
  });

  it("tombstones a remapped pending Index row and ignores non-pending ids", async () => {
    scheduleTombstoneLocalPendingDraftIndexRow(
      "claude:claude-pending-1787016153035-0bittx",
    );
    scheduleTombstoneLocalPendingDraftIndexRow("claude-pending-1");
    scheduleTombstoneLocalPendingDraftIndexRow("claude:session-real-1");
    await flushIndexWrite();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("tombstone_session_index_rows", {
      sessionIds: ["claude-pending-1787016153035-0bittx"],
    });
  });
});

describe("sessionIndex synthetic claude-fork bootstrap rows", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(1);
  });

  it("does not upsert a synthetic claude-fork bootstrap row into Session Index", async () => {
    writeClientCreatedSessionIndex({
      engine: "claude",
      sessionId: "claude-fork:0f4a6b7c-1111-2222-3333-444455556666:1787016153035-ab12cd",
      workspacePath: "/tmp/ws",
    });
    await flushIndexWrite();
    // 僵尸行根源：bareSessionId 截断会落出任何链路都还原不出来的 mangled 键
    expect(invoke).not.toHaveBeenCalled();
  });

  it("still upserts a renamed canonical claude child session id", async () => {
    writeClientCreatedSessionIndex({
      engine: "claude",
      sessionId: "claude:0f4a6b7c-1111-2222-3333-444455556666",
      workspacePath: "/tmp/ws",
    });
    await flushIndexWrite();
    expect(invoke).toHaveBeenCalledWith("upsert_session_index_rows", {
      rows: [
        expect.objectContaining({
          engine: "claude",
          sessionId: "0f4a6b7c-1111-2222-3333-444455556666",
        }),
      ],
    });
  });

  it("extracts the companion key payload from synthetic fork ids only", () => {
    expect(
      claudeForkIndexTwinSessionId(
        "claude-fork:0f4a6b7c-1111-2222-3333-444455556666:1787016153035-ab12cd",
      ),
    ).toBe(
      "0f4a6b7c-1111-2222-3333-444455556666:1787016153035-ab12cd",
    );
    expect(claudeForkIndexTwinSessionId("claude:session-real-1")).toBeNull();
    expect(claudeForkIndexTwinSessionId("  ")).toBeNull();
  });

  it("purges the mangled companion Index row when deleting a synthetic fork thread", async () => {
    scheduleTombstoneClaudeForkIndexRow(
      "claude-fork:0f4a6b7c-1111-2222-3333-444455556666:1787016153035-ab12cd",
    );
    await flushIndexWrite();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("tombstone_session_index_rows", {
      sessionIds: [
        "0f4a6b7c-1111-2222-3333-444455556666:1787016153035-ab12cd",
      ],
    });
  });

  it("ignores non-fork ids and empty payloads in companion purge", async () => {
    scheduleTombstoneClaudeForkIndexRow("claude:session-real-1");
    scheduleTombstoneClaudeForkIndexRow("codex-thread-id");
    scheduleTombstoneClaudeForkIndexRow("claude-fork:");
    scheduleTombstoneClaudeForkIndexRow("   ");
    await flushIndexWrite();
    expect(invoke).not.toHaveBeenCalled();
  });
});
