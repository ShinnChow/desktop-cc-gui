import { invoke } from "@tauri-apps/api/core";

export type SessionIndexEngine =
  | "claude"
  | "codex"
  | "gemini"
  | "grok"
  | "kimi"
  | "pi"
  | "omp"
  | "opencode"
  | "dsh"
  | "qoder"
  | string;

export type SessionIndexRow = {
  engine: SessionIndexEngine;
  sessionId: string;
  title: string;
  nativeTitle?: string | null;
  updatedAt: number;
  createdAt?: number | null;
  cwd?: string | null;
  workspacePath?: string | null;
  physicalPath?: string | null;
  parentSessionId?: string | null;
  sizeBytes?: number | null;
  providerProfileId?: string | null;
  providerProfileName?: string | null;
};

export type SharedNativeVisibilityProjection = {
  available: boolean;
  freshness?: string | null;
  hiddenNativeIds?: string[] | null;
  protocolHiddenNativeIds?: string[] | null;
  reason?: string | null;
};

export type SessionIndexListPage = {
  data: SessionIndexRow[];
  source: string;
  synced: boolean;
  syncMs?: number | null;
  engines: string[];
  partialSource?: string | null;
  hasMore?: boolean;
  visibility?: SharedNativeVisibilityProjection | null;
};



export async function listSessionIndexForWorkspace(
  workspaceId: string,
  options?: {
    limit?: number | null;
    syncIfNeeded?: boolean | null;
    forceSync?: boolean | null;
    beforeUpdatedAt?: number | null;
    beforeSessionId?: string | null;
  },
): Promise<SessionIndexListPage> {
  return invoke<SessionIndexListPage>("list_session_index_for_workspace", {
    workspaceId,
    // Keep in sync with DEFAULT_VISIBLE_THREAD_ROOT_COUNT / DEFAULT_SIDEBAR_INDEX_LIMIT.
    limit: options?.limit ?? 5,
    syncIfNeeded: options?.syncIfNeeded ?? true,
    forceSync: options?.forceSync ?? false,
    beforeUpdatedAt: options?.beforeUpdatedAt ?? null,
    beforeSessionId: options?.beforeSessionId ?? null,
  });
}



/** Soft-invalidate SQLite source freshness so next list/sync rescans engines. */
export async function invalidateSessionIndexForWorkspace(
  workspaceId: string,
): Promise<number> {
  return invoke<number>("invalidate_session_index_for_workspace", {
    workspaceId,
  });
}

const LOCAL_PENDING_DRAFT_SESSION_ID =
  /^([a-z][a-z0-9]*)-pending-(\d{10,16})-([a-z0-9]{4,12})$/i;

const CLAUDE_FORK_THREAD_PREFIX = "claude-fork:";

const rememberedWorkspacePathById = new Map<string, string>();

export function rememberSessionIndexWorkspacePath(
  workspaceId: string,
  workspacePath: string,
): void {
  const id = workspaceId.trim();
  const path = workspacePath.trim();
  if (!id || !path) {
    return;
  }
  rememberedWorkspacePathById.set(id, path);
}

function inferEngineFromThreadId(threadId: string): string {
  const raw = threadId.trim().toLowerCase();
  if (raw.startsWith("claude:") || raw.startsWith("claude-pending-")) return "claude";
  if (raw.startsWith("gemini:") || raw.startsWith("gemini-pending-")) return "gemini";
  if (raw.startsWith("grok:") || raw.startsWith("grok-pending-")) return "grok";
  if (raw.startsWith("kimi:") || raw.startsWith("kimi-pending-")) return "kimi";
  if (raw.startsWith("opencode:") || raw.startsWith("opencode-pending-")) return "opencode";
  if (raw.startsWith("pi:") || raw.startsWith("pi-pending-")) return "pi";
  if (raw.startsWith("omp:") || raw.startsWith("omp-pending-")) return "omp";
  if (raw.startsWith("dsh:") || raw.startsWith("dsh-pending-")) return "dsh";
  if (raw.startsWith("qoder:") || raw.startsWith("qoder-pending-")) return "qoder";
  return "codex";
}

export function writeRemappedClientSessionIndex(input: {
  workspaceId: string;
  threadId: string;
  engine?: string | null;
  providerProfileId?: string | null;
  providerProfileName?: string | null;
}): void {
  const workspacePath =
    rememberedWorkspacePathById.get(input.workspaceId.trim()) ?? "";
  writeClientCreatedSessionIndex({
    engine: input.engine?.trim() || inferEngineFromThreadId(input.threadId),
    sessionId: input.threadId,
    workspacePath,
    providerProfileId: input.providerProfileId,
    providerProfileName: input.providerProfileName,
  });
}

function bareSessionId(threadId: string): string {
  const raw = threadId.trim();
  return raw.includes(":") ? raw.slice(raw.indexOf(":") + 1).trim() : raw;
}

export function isLocalPendingDraftSessionId(sessionId: string): boolean {
  return LOCAL_PENDING_DRAFT_SESSION_ID.test(sessionId.trim());
}

/** Pending client drafts must not become visible Index rows. */
export function scheduleTombstoneLocalPendingDraftIndexRow(
  threadId: string,
): void {
  const sessionId = bareSessionId(threadId);
  if (!isLocalPendingDraftSessionId(sessionId)) {
    return;
  }
  void tombstoneSessionIndexRows([sessionId]).catch(() => 0);
}

/**
 * Synthetic fork bootstrap payload: the `claude-fork:` prefix stripped. This is
 * the exact key a legacy mangled Index row was stored under (bareSessionId used
 * to split synthetic fork ids at the first colon), so it is the only reliable
 * tombstone target when such a row is deleted.
 */
export function claudeForkIndexTwinSessionId(threadId: string): string | null {
  const raw = threadId.trim();
  if (!raw.startsWith(CLAUDE_FORK_THREAD_PREFIX)) {
    return null;
  }
  const payload = raw.slice(CLAUDE_FORK_THREAD_PREFIX.length).trim();
  return payload.length > 0 ? payload : null;
}

/** Hide Index rows so sidebar hydrate cannot resurrect a deleted session. */
export function writeClientCreatedSessionIndex(input: {
  engine: string;
  sessionId: string;
  workspacePath: string;
  title?: string;
  providerProfileId?: string | null;
  providerProfileName?: string | null;
}): void {
  const engine = input.engine.trim().toLowerCase();
  const rawId = input.sessionId.trim();
  const workspacePath = input.workspacePath.trim();
  if (!engine || engine === "shared" || !rawId || !workspacePath) {
    return;
  }
  // Synthetic fork bootstraps are runtime-only rows (claude-fork-session-support
  // spec). bareSessionId would split them at the first colon into a mangled key
  // that no delete lookup / tombstone can ever reach — i.e. an undeletable row.
  if (rawId.startsWith(CLAUDE_FORK_THREAD_PREFIX)) {
    return;
  }
  // Qoder canonical id embeds its distribution. Keep it intact so Rust can
  // validate/canonicalize with providerProfileId before the composite index key
  // is written; stripping to raw would collapse Global/CN collisions.
  const sessionId = engine === "qoder" ? rawId : bareSessionId(rawId);
  if (!sessionId || isLocalPendingDraftSessionId(sessionId)) {
    return;
  }
  const providerProfileId = input.providerProfileId?.trim() || "";
  const providerProfileName = input.providerProfileName?.trim() || "";
  const now = Date.now();
  void upsertSessionIndexRows([
    {
      engine,
      sessionId,
      title: input.title?.trim() || `${engine} session`,
      createdAt: now,
      updatedAt: now,
      workspacePath,
      cwd: workspacePath,
      ...(providerProfileId ? { providerProfileId } : {}),
      ...(providerProfileName ? { providerProfileName } : {}),
    },
  ]).catch(() => 0);
}

/** Tombstone the mangled companion Index row of a synthetic fork id (best-effort). */
export function scheduleTombstoneClaudeForkIndexRow(threadId: string): void {
  const twin = claudeForkIndexTwinSessionId(threadId);
  if (!twin) {
    return;
  }
  void tombstoneSessionIndexRows([twin]).catch(() => 0);
}

export async function upsertSessionIndexRows(
  rows: SessionIndexRow[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }
  return invoke<number>("upsert_session_index_rows", { rows });
}

export async function tombstoneSessionIndexRows(
  sessionIds: string[],
): Promise<number> {
  const ids = sessionIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    return 0;
  }
  return invoke<number>("tombstone_session_index_rows", {
    sessionIds: ids,
  });
}
