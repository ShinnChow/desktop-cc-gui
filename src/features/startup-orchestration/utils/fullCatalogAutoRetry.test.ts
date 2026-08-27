import { describe, expect, it, beforeEach } from "vitest";
import {
  clearFullCatalogAutoRetryCooldown,
  FULL_CATALOG_AUTO_RETRY_COOLDOWN_MS,
  FULL_CATALOG_AUTO_RETRY_MAX_COOLDOWN_MS,
  getFullCatalogAutoRetryBlockedSnapshot,
  isFullCatalogAutoRetryBlocked,
  markFullCatalogAutoRetryCooldown,
  noteFullCatalogAutoRetrySuccess,
  noteFullCatalogAutoRetryTimeout,
  resetFullCatalogAutoRetryForTests,
  resolveFullCatalogTimeoutCooldownMs,
} from "./fullCatalogAutoRetry";

describe("fullCatalogAutoRetry", () => {
  beforeEach(() => {
    resetFullCatalogAutoRetryForTests();
  });

  it("blocks auto retry after mark until cleared", () => {
    expect(isFullCatalogAutoRetryBlocked("ws-a")).toBe(false);
    markFullCatalogAutoRetryCooldown("ws-a", "timeout", 60_000);
    expect(isFullCatalogAutoRetryBlocked("ws-a")).toBe(true);
    expect(getFullCatalogAutoRetryBlockedSnapshot()[0]).toContain("ws-a");
    expect(getFullCatalogAutoRetryBlockedSnapshot()[0]).toContain("timeout");
    clearFullCatalogAutoRetryCooldown("ws-a");
    expect(isFullCatalogAutoRetryBlocked("ws-a")).toBe(false);
  });

  it("expires cooldown by wall time", () => {
    markFullCatalogAutoRetryCooldown("ws-b", "timeout", 0);
    expect(isFullCatalogAutoRetryBlocked("ws-b")).toBe(false);
  });

  it("resolveFullCatalogTimeoutCooldownMs doubles per streak and caps", () => {
    expect(resolveFullCatalogTimeoutCooldownMs(1)).toBe(
      FULL_CATALOG_AUTO_RETRY_COOLDOWN_MS,
    );
    expect(resolveFullCatalogTimeoutCooldownMs(2)).toBe(
      FULL_CATALOG_AUTO_RETRY_COOLDOWN_MS * 2,
    );
    expect(resolveFullCatalogTimeoutCooldownMs(3)).toBe(
      FULL_CATALOG_AUTO_RETRY_COOLDOWN_MS * 4,
    );
    expect(resolveFullCatalogTimeoutCooldownMs(4)).toBe(
      FULL_CATALOG_AUTO_RETRY_COOLDOWN_MS * 8,
    );
    expect(resolveFullCatalogTimeoutCooldownMs(5)).toBe(
      FULL_CATALOG_AUTO_RETRY_MAX_COOLDOWN_MS,
    );
    expect(resolveFullCatalogTimeoutCooldownMs(9)).toBe(
      FULL_CATALOG_AUTO_RETRY_MAX_COOLDOWN_MS,
    );
    expect(resolveFullCatalogTimeoutCooldownMs(0)).toBe(
      FULL_CATALOG_AUTO_RETRY_COOLDOWN_MS,
    );
  });

  function snapshotRemainingMs(workspaceId: string): number | null {
    const line = getFullCatalogAutoRetryBlockedSnapshot().find((entry) =>
      entry.startsWith(`${workspaceId}:`),
    );
    const match = line?.match(/remainingMs=(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function snapshotStreak(workspaceId: string): number | null {
    const line = getFullCatalogAutoRetryBlockedSnapshot().find((entry) =>
      entry.startsWith(`${workspaceId}:`),
    );
    const match = line?.match(/streak=(\d+)/);
    return match ? Number(match[1]) : null;
  }

  it("consecutive timeouts escalate the auto-retry cooldown exponentially", () => {
    noteFullCatalogAutoRetryTimeout("ws-c");
    const first = snapshotRemainingMs("ws-c");
    expect(first).toBeGreaterThan(55_000);
    expect(first).toBeLessThanOrEqual(60_000);
    expect(snapshotStreak("ws-c")).toBe(1);

    noteFullCatalogAutoRetryTimeout("ws-c");
    const second = snapshotRemainingMs("ws-c");
    expect(second).toBeGreaterThan(115_000);
    expect(second).toBeLessThanOrEqual(120_000);
    expect(snapshotStreak("ws-c")).toBe(2);

    noteFullCatalogAutoRetryTimeout("ws-c");
    const third = snapshotRemainingMs("ws-c");
    expect(third).toBeGreaterThan(235_000);
    expect(third).toBeLessThanOrEqual(240_000);
    expect(snapshotStreak("ws-c")).toBe(3);
    expect(isFullCatalogAutoRetryBlocked("ws-c")).toBe(true);
  });

  it("caps the cooldown at 15 minutes after enough consecutive timeouts", () => {
    for (let index = 0; index < 6; index += 1) {
      noteFullCatalogAutoRetryTimeout("ws-d");
    }
    const remaining = snapshotRemainingMs("ws-d");
    expect(remaining).toBeGreaterThan(
      FULL_CATALOG_AUTO_RETRY_MAX_COOLDOWN_MS - 5_000,
    );
    expect(remaining).toBeLessThanOrEqual(
      FULL_CATALOG_AUTO_RETRY_MAX_COOLDOWN_MS,
    );
    expect(snapshotStreak("ws-d")).toBe(6);
  });

  it("success note resets the timeout streak", () => {
    noteFullCatalogAutoRetryTimeout("ws-e");
    noteFullCatalogAutoRetryTimeout("ws-e");
    noteFullCatalogAutoRetryTimeout("ws-e");
    expect(snapshotStreak("ws-e")).toBe(3);
    noteFullCatalogAutoRetrySuccess("ws-e");
    expect(isFullCatalogAutoRetryBlocked("ws-e")).toBe(false);
    noteFullCatalogAutoRetryTimeout("ws-e");
    const remaining = snapshotRemainingMs("ws-e");
    expect(remaining).toBeGreaterThan(55_000);
    expect(remaining).toBeLessThanOrEqual(60_000);
    expect(snapshotStreak("ws-e")).toBe(1);
  });

  it("clear (force refresh) resets the timeout streak", () => {
    noteFullCatalogAutoRetryTimeout("ws-f");
    noteFullCatalogAutoRetryTimeout("ws-f");
    expect(snapshotStreak("ws-f")).toBe(2);
    clearFullCatalogAutoRetryCooldown("ws-f");
    noteFullCatalogAutoRetryTimeout("ws-f");
    expect(snapshotStreak("ws-f")).toBe(1);
    const remaining = snapshotRemainingMs("ws-f");
    expect(remaining).toBeLessThanOrEqual(60_000);
  });

  it("explicit cooldown and non-timeout reasons are not affected by backoff", () => {
    markFullCatalogAutoRetryCooldown("ws-g", "timeout", 7_500);
    const explicitTimeout = snapshotRemainingMs("ws-g");
    expect(explicitTimeout).toBeLessThanOrEqual(7_500);
    expect(snapshotStreak("ws-g")).toBeNull();

    markFullCatalogAutoRetryCooldown("ws-g", "degraded");
    const degraded = snapshotRemainingMs("ws-g");
    expect(degraded).toBeGreaterThan(55_000);
    expect(degraded).toBeLessThanOrEqual(60_000);
    expect(snapshotStreak("ws-g")).toBeNull();

    // 显式 mark 不清 streak：streak 仅由 timeout note / success / clear 管理
    noteFullCatalogAutoRetryTimeout("ws-h");
    markFullCatalogAutoRetryCooldown("ws-h", "degraded", 5_000);
    expect(snapshotRemainingMs("ws-h")).toBeLessThanOrEqual(5_000);
  });
});
