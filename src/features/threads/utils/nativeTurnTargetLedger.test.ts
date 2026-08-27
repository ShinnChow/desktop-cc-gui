import { beforeEach, describe, expect, it } from "vitest";

import {
  getNativeTurnTarget,
  isNativeTurnTargetLedgerScope,
  recordNativeTurnTarget,
  renameNativeTurnTarget,
  resetNativeTurnTargetsForTests,
  resolveNativeSendExecutionTarget,
} from "./nativeTurnTargetLedger";
import type { ExecutionTargetSnapshot } from "../../../types";

const SNAPSHOT: ExecutionTargetSnapshot = Object.freeze({
  engine: "pi",
  providerProfileId: null,
  modelCatalogEntryId: "k3",
  model: "kimi-coding/k3",
  reasoning: { effort: "low" },
  providerProfileNameSnapshot: "本地配置",
  providerProfileSource: "local",
});

describe("nativeTurnTargetLedger", () => {
  beforeEach(() => {
    resetNativeTurnTargetsForTests();
  });

  it("records and reads back per workspace+thread", () => {
    recordNativeTurnTarget("ws1", "pi-session-1", SNAPSHOT);
    expect(getNativeTurnTarget("ws1", "pi-session-1")).toEqual(SNAPSHOT);
    expect(getNativeTurnTarget("ws2", "pi-session-1")).toBeNull();
    expect(getNativeTurnTarget("ws1", "pi-session-2")).toBeNull();
  });

  it("latest send wins for the same thread", () => {
    recordNativeTurnTarget("ws1", "claude:abc", SNAPSHOT);
    const next: ExecutionTargetSnapshot = { ...SNAPSHOT, engine: "claude" };
    recordNativeTurnTarget("ws1", "claude:abc", next);
    expect(getNativeTurnTarget("ws1", "claude:abc")?.engine).toBe("claude");
  });

  it("refuses shared routing scopes and empty ids", () => {
    recordNativeTurnTarget("ws1", "shared:t-1", SNAPSHOT);
    recordNativeTurnTarget("ws1", "agent-canvas:x", SNAPSHOT);
    recordNativeTurnTarget("ws1", "kimi-pending-shared-9", SNAPSHOT);
    expect(getNativeTurnTarget("ws1", "shared:t-1")).toBeNull();
    expect(getNativeTurnTarget("ws1", "agent-canvas:x")).toBeNull();
    expect(getNativeTurnTarget("ws1", "kimi-pending-shared-9")).toBeNull();
    recordNativeTurnTarget("ws1", "", SNAPSHOT);
    expect(
      getNativeTurnTarget("ws1", ""),
    ).toBeNull();
  });

  it("rename moves the entry to the new thread id without overwrite", () => {
    const existing: ExecutionTargetSnapshot = { ...SNAPSHOT, engine: "codex" };
    recordNativeTurnTarget("ws1", "codex-pending-1", SNAPSHOT);
    recordNativeTurnTarget("ws1", "codex:real", existing);
    renameNativeTurnTarget("ws1", "codex-pending-1", "codex:real");
    expect(getNativeTurnTarget("ws1", "codex-pending-1")).toBeNull();
    expect(getNativeTurnTarget("ws1", "codex:real")?.engine).toBe("codex");
  });

  it("rename keeps value when target has none (alias reconcile path)", () => {
    recordNativeTurnTarget("ws1", "claude-pending-7", SNAPSHOT);
    renameNativeTurnTarget("ws1", "claude-pending-7", "claude:real-id");
    expect(getNativeTurnTarget("ws1", "claude-pending-7")).toBeNull();
    expect(getNativeTurnTarget("ws1", "claude:real-id")).toEqual(SNAPSHOT);
  });

  it("isNativeTurnTargetLedgerScope matches shared-routing exclusions", () => {
    expect(isNativeTurnTargetLedgerScope("pi:s1")).toBe(true);
    expect(isNativeTurnTargetLedgerScope("shared:s1")).toBe(false);
    expect(isNativeTurnTargetLedgerScope("grok-pending-shared-3")).toBe(false);
    expect(isNativeTurnTargetLedgerScope("agent-canvas:a/b")).toBe(false);
    expect(isNativeTurnTargetLedgerScope("  ")).toBe(false);
  });
});

describe("resolveNativeSendExecutionTarget", () => {
  it("prefers the frozen composer snapshot", () => {
    expect(
      resolveNativeSendExecutionTarget({
        frozen: SNAPSHOT,
        engine: "claude",
        model: "should-be-ignored",
      }),
    ).toEqual(SNAPSHOT);
  });

  it("synthesizes from resolved messaging values when options carry none", () => {
    const snapshot = resolveNativeSendExecutionTarget({
      engine: "qoder",
      providerProfileId: "managed-qoder",
      modelCatalogEntryId: "qoder-max",
      model: "qoder/max",
      effort: "medium",
    });
    expect(snapshot).toMatchObject({
      engine: "qoder",
      providerProfileId: "managed-qoder",
      modelCatalogEntryId: "qoder-max",
      model: "qoder/max",
      reasoning: { effort: "medium" },
    });
  });

  it("returns null without an engine and normalizes blank effort", () => {
    expect(resolveNativeSendExecutionTarget({ engine: "  " })).toBeNull();
    expect(
      resolveNativeSendExecutionTarget({ engine: "pi", effort: "  " })
        ?.reasoning,
    ).toBeNull();
  });
});
