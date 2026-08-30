/**
 * full-catalog 自动重扫冷却：timeout / degraded / force-enter 后禁止同 workspace
 * 在冷却窗内再次自动 ensure full-catalog（用户 force refresh 可 clear）。
 *
 * 2026-08-27 起 timeout 冷却按连续超时次数指数退避（60s × 2^(streak-1)，
 * 封顶 15min）：在「扫描永不成功」的机器上（如 Windows 实测 100% 打满 30s
 * 超时），固定 60s 冷却 + 超时清 freshness 会形成永不自愈的常驻扫描风暴。
 */

export const FULL_CATALOG_AUTO_RETRY_COOLDOWN_MS = 60_000;
export const FULL_CATALOG_AUTO_RETRY_MAX_COOLDOWN_MS = 900_000;

type CooldownEntry = {
  untilMs: number;
  reason: string;
};

const cooldownByWorkspaceId = new Map<string, CooldownEntry>();
const timeoutStreakByWorkspaceId = new Map<string, number>();

function nowMs(): number {
  return typeof performance !== "undefined" &&
    typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

/** timeout streak → 冷却时长：60s × 2^(streak-1)，封顶 15min。streak ≤ 0 按首次计。 */
export function resolveFullCatalogTimeoutCooldownMs(streak: number): number {
  const safeStreak = Math.max(1, Math.floor(streak));
  const backoff =
    FULL_CATALOG_AUTO_RETRY_COOLDOWN_MS * 2 ** Math.min(safeStreak - 1, 20);
  return Math.min(backoff, FULL_CATALOG_AUTO_RETRY_MAX_COOLDOWN_MS);
}

export function markFullCatalogAutoRetryCooldown(
  workspaceId: string,
  reason: string,
  cooldownMs: number = FULL_CATALOG_AUTO_RETRY_COOLDOWN_MS,
): void {
  const id = workspaceId.trim();
  if (!id) {
    return;
  }
  cooldownByWorkspaceId.set(id, {
    untilMs: nowMs() + Math.max(0, cooldownMs),
    reason,
  });
}

/**
 * full-catalog settle 为 timeout：冷却按该 workspace 连续超时 streak 指数退避。
 * streak 仅由本函数递增，由 noteFullCatalogAutoRetrySuccess /
 * clearFullCatalogAutoRetryCooldown（force refresh）重置。
 */
export function noteFullCatalogAutoRetryTimeout(workspaceId: string): void {
  const id = workspaceId.trim();
  if (!id) {
    return;
  }
  const streak = (timeoutStreakByWorkspaceId.get(id) ?? 0) + 1;
  timeoutStreakByWorkspaceId.set(id, streak);
  markFullCatalogAutoRetryCooldown(
    id,
    "timeout",
    resolveFullCatalogTimeoutCooldownMs(streak),
  );
}

/** 成功 settle：重置 timeout streak 并清掉可能残留的冷却条目。 */
export function noteFullCatalogAutoRetrySuccess(workspaceId: string): void {
  const id = workspaceId.trim();
  if (!id) {
    return;
  }
  timeoutStreakByWorkspaceId.delete(id);
  cooldownByWorkspaceId.delete(id);
}

export function clearFullCatalogAutoRetryCooldown(workspaceId: string): void {
  const id = workspaceId.trim();
  cooldownByWorkspaceId.delete(id);
  timeoutStreakByWorkspaceId.delete(id);
}

export function isFullCatalogAutoRetryBlocked(workspaceId: string): boolean {
  const id = workspaceId.trim();
  if (!id) {
    return false;
  }
  const entry = cooldownByWorkspaceId.get(id);
  if (!entry) {
    return false;
  }
  if (nowMs() >= entry.untilMs) {
    cooldownByWorkspaceId.delete(id);
    return false;
  }
  return true;
}

/** For diagnostic dump. */
export function getFullCatalogAutoRetryBlockedSnapshot(): string[] {
  const now = nowMs();
  const lines: string[] = [];
  for (const [workspaceId, entry] of cooldownByWorkspaceId) {
    if (now >= entry.untilMs) {
      continue;
    }
    const streak = timeoutStreakByWorkspaceId.get(workspaceId);
    const streakSuffix = typeof streak === "number" ? `:streak=${streak}` : "";
    lines.push(
      `${workspaceId}:${entry.reason}:remainingMs=${Math.round(entry.untilMs - now)}${streakSuffix}`,
    );
  }
  return lines;
}

/** @internal */
export function resetFullCatalogAutoRetryForTests(): void {
  cooldownByWorkspaceId.clear();
  timeoutStreakByWorkspaceId.clear();
}
