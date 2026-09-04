import { invoke } from "@tauri-apps/api/core";

/**
 * PI RPC session command surface (`pi --mode rpc` resident).
 * All commands resolve the per-workspace resident via the Rust side; they
 * never touch the print-json fallback path.
 */

export type PiContextUsage = {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
};

export type PiSessionStats = {
  sessionId: string | null;
  userMessages: number | null;
  assistantMessages: number | null;
  totalMessages: number | null;
  cost: number | null;
  contextUsage: PiContextUsage | null;
};

export type PiCompactResult = {
  summary: string | null;
  tokensBefore: number | null;
  estimatedTokensAfter: number | null;
  firstKeptEntryId: string | null;
};

export type PiForkResult = {
  text: string | null;
  cancelled: boolean;
  sessionId: string | null;
  /** The NEW session file created by fork (source session is restored). */
  forkedSessionId: string | null;
};

export type PiForkMessage = {
  entryId: string;
  text: string;
};

export type PiTreeEntry = {
  id: string;
  parentId: string | null;
  type: string;
  timestamp?: string;
  role: string | null;
  text: string;
};

export type PiTreeNode = {
  entry: PiTreeEntry;
  label: string | null;
  children: PiTreeNode[];
};

export type PiSessionTree = {
  nodes: PiTreeNode[];
  leafId: string | null;
  /** Fork-derived session files (parentSession chain): lanes of the same
   *  conversation family living in separate files. */
  derivedLanes: PiDerivedLane[];
  /** 会话族 root session id（lane 0 = 主线，可跳回）。 */
  rootSessionId: string | null;
  /** root 不是当前文件时，主线条目从磁盘只读解析（此时 tree 为空）。 */
  rootEntries: PiDerivedLaneEntry[];
};

export type PiDerivedLane = {
  sessionId: string;
  sessionFile: string;
  entries: PiDerivedLaneEntry[];
};

export type PiDerivedLaneEntry = {
  id: string;
  parentId: string | null;
  type: string;
  timestamp?: string;
  role: string | null;
  text: string;
};

type CommandOptions = {
  workspaceId: string;
  /** Native pi session id of the VIEWED thread (resident must align first). */
  sessionId?: string | null;
  providerProfileId?: string | null;
};

/** Extract the native pi session id from a mossx thread id (`pi:<id>`). */
export function piSessionIdFromThreadId(threadId: string): string | null {
  if (!threadId.startsWith("pi:")) {
    return null;
  }
  const id = threadId.slice(3).trim();
  return id.length > 0 ? id : null;
}

/** Extract the native omp session id from a mossx thread id (`omp:<id>`). */
export function ompSessionIdFromThreadId(threadId: string): string | null {
  if (!threadId.startsWith("omp:")) {
    return null;
  }
  const id = threadId.slice(4).trim();
  return id.length > 0 ? id : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// pi-family（pi/omp）共享载荷映射：stats/compact 响应形状全等，仅命令名不同。
function mapSessionStats(raw: Record<string, unknown>): PiSessionStats {
  const contextUsage = raw?.contextUsage as Record<string, unknown> | undefined;
  return {
    sessionId: asString(raw?.sessionId),
    userMessages: asNumber(raw?.userMessages),
    assistantMessages: asNumber(raw?.assistantMessages),
    totalMessages: asNumber(raw?.totalMessages),
    cost: asNumber(raw?.cost),
    contextUsage: contextUsage
      ? {
          tokens: asNumber(contextUsage.tokens),
          contextWindow: asNumber(contextUsage.contextWindow),
          percent: asNumber(contextUsage.percent),
        }
      : null,
  };
}

function mapCompactResult(raw: Record<string, unknown>): PiCompactResult {
  return {
    summary: asString(raw?.summary),
    tokensBefore: asNumber(raw?.tokensBefore),
    estimatedTokensAfter: asNumber(raw?.estimatedTokensAfter),
    firstKeptEntryId: asString(raw?.firstKeptEntryId),
  };
}

export async function piGetSessionStats(
  options: CommandOptions,
): Promise<PiSessionStats> {
  const raw = await invoke<Record<string, unknown>>("pi_get_session_stats", {
    workspaceId: options.workspaceId,
    sessionId: options.sessionId ?? null,
    providerProfileId: options.providerProfileId ?? null,
  });
  return mapSessionStats(raw);
}

/** omp（pi 协议全等 fork）会话统计：命令面 `omp_get_session_stats`。 */
export async function ompGetSessionStats(
  options: CommandOptions,
): Promise<PiSessionStats> {
  const raw = await invoke<Record<string, unknown>>("omp_get_session_stats", {
    workspaceId: options.workspaceId,
    sessionId: options.sessionId ?? null,
    providerProfileId: options.providerProfileId ?? null,
  });
  return mapSessionStats(raw);
}

export async function piCompact(
  options: CommandOptions & { customInstructions?: string },
): Promise<PiCompactResult> {
  const raw = await invoke<Record<string, unknown>>("pi_compact", {
    workspaceId: options.workspaceId,
    sessionId: options.sessionId ?? null,
    customInstructions: options.customInstructions ?? null,
    providerProfileId: options.providerProfileId ?? null,
  });
  return mapCompactResult(raw);
}

/** omp 手动压缩：命令面 `omp_compact`（omp 无 fork/tree，仅 compact/stats）。 */
export async function ompCompact(
  options: CommandOptions & { customInstructions?: string },
): Promise<PiCompactResult> {
  const raw = await invoke<Record<string, unknown>>("omp_compact", {
    workspaceId: options.workspaceId,
    sessionId: options.sessionId ?? null,
    customInstructions: options.customInstructions ?? null,
    providerProfileId: options.providerProfileId ?? null,
  });
  return mapCompactResult(raw);
}

export async function piFork(
  options: CommandOptions & { entryId: string },
): Promise<PiForkResult> {
  const raw = await invoke<Record<string, unknown>>("pi_fork", {
    workspaceId: options.workspaceId,
    sessionId: options.sessionId ?? null,
    entryId: options.entryId,
    providerProfileId: options.providerProfileId ?? null,
  });
  return {
    text: asString(raw?.text),
    cancelled: raw?.cancelled === true,
    sessionId: asString(raw?.sessionId),
    forkedSessionId: asString(raw?.forkedSessionId),
  };
}

export async function piGetForkMessages(
  options: CommandOptions,
): Promise<PiForkMessage[]> {
  const raw = await invoke<Record<string, unknown>>("pi_get_fork_messages", {
    workspaceId: options.workspaceId,
    sessionId: options.sessionId ?? null,
    providerProfileId: options.providerProfileId ?? null,
  });
  const messages = Array.isArray(raw?.messages) ? raw.messages : [];
  return messages
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      const entryId = asString(record?.entryId);
      const text = typeof record?.text === "string" ? record.text : "";
      return entryId ? { entryId, text } : null;
    })
    .filter((entry): entry is PiForkMessage => entry !== null);
}

function extractEntryText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") {
          return block;
        }
        if (block && typeof block === "object") {
          const record = block as Record<string, unknown>;
          if (record.type === "text" && typeof record.text === "string") {
            return record.text;
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export async function piGetSessionTree(
  options: CommandOptions,
): Promise<PiSessionTree> {
  const raw = await invoke<Record<string, unknown>>("pi_get_session_tree", {
    workspaceId: options.workspaceId,
    sessionId: options.sessionId ?? null,
    providerProfileId: options.providerProfileId ?? null,
  });
  // 后端摊平 + 瘦身后的浅层 entries（嵌套树在深会话下会撞 serde_json
  // 递归限制且载荷巨大）；按 parentId 重建森林，保持兄弟顺序。
  const byId = new Map<string, PiTreeNode>();
  const nodes: PiTreeNode[] = [];
  const rawEntries = Array.isArray(raw?.entries) ? raw.entries : [];
  for (const item of rawEntries) {
    const record = item as Record<string, unknown>;
    const entry = record.entry as Record<string, unknown> | undefined;
    const id = asString(entry?.id);
    if (!entry || !id) {
      continue;
    }
    const message = entry.message as Record<string, unknown> | undefined;
    byId.set(id, {
      entry: {
        id,
        parentId: asString(entry.parentId),
        type: asString(entry.type) ?? "message",
        timestamp: asString(entry.timestamp) ?? undefined,
        role: asString(message?.role),
        text: extractEntryText(message),
      },
      label: asString(record.label),
      children: [],
    });
  }
  byId.forEach((node) => {
    const parentId = node.entry.parentId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      nodes.push(node);
    }
  });
  const derivedLanes: PiDerivedLane[] = [];
  if (Array.isArray(raw?.derivedLanes)) {
    for (const laneRaw of raw.derivedLanes as Record<string, unknown>[]) {
      const sessionId = asString(laneRaw?.sessionId);
      const sessionFile = asString(laneRaw?.sessionFile);
      if (!sessionId || !sessionFile) {
        continue;
      }
      const entries: PiDerivedLaneEntry[] = [];
      if (Array.isArray(laneRaw.entries)) {
        for (const entryRaw of laneRaw.entries as Record<string, unknown>[]) {
          const id = asString(entryRaw?.id);
          if (!id) {
            continue;
          }
          entries.push({
            id,
            parentId: asString(entryRaw.parentId),
            type: asString(entryRaw.type) ?? "message",
            timestamp: asString(entryRaw.timestamp) ?? undefined,
            role: asString(entryRaw.role),
            text: typeof entryRaw.text === "string" ? entryRaw.text : "",
          });
        }
      }
      derivedLanes.push({ sessionId, sessionFile, entries });
    }
  }
  const rootEntries: PiDerivedLaneEntry[] = [];
  if (Array.isArray(raw?.rootEntries)) {
    for (const entryRaw of raw.rootEntries as Record<string, unknown>[]) {
      const id = asString(entryRaw?.id);
      if (!id) {
        continue;
      }
      rootEntries.push({
        id,
        parentId: asString(entryRaw.parentId),
        type: asString(entryRaw.type) ?? "message",
        timestamp: asString(entryRaw.timestamp) ?? undefined,
        role: asString(entryRaw.role),
        text: typeof entryRaw.text === "string" ? entryRaw.text : "",
      });
    }
  }
  return {
    nodes,
    leafId: asString(raw?.leafId),
    derivedLanes,
    rootSessionId: asString(raw?.rootSessionId),
    rootEntries,
  };
}
