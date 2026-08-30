import type { EngineType, ThreadSummary } from "../../../../types";
import type { ConversationEngine } from "../../../threads/contracts/conversationCurtainContracts";

function toConversationEngine(
  engine: EngineType | undefined,
): ConversationEngine {
  if (
    engine === "claude" ||
    engine === "gemini" ||
    engine === "grok" ||
    engine === "kimi" ||
    engine === "opencode" ||
    engine === "dsh" ||
    engine === "qoder" ||
    engine === "pi"
  ) {
    return engine;
  }
  return "codex";
}

function inferConversationEngineFromThreadId(
  threadId: string | null | undefined,
): ConversationEngine | null {
  const normalizedThreadId = threadId?.trim().toLowerCase();
  if (!normalizedThreadId) {
    return null;
  }

  if (
    normalizedThreadId.startsWith("claude:") ||
    normalizedThreadId.startsWith("claude-pending-")
  ) {
    return "claude";
  }
  if (
    normalizedThreadId.startsWith("gemini:") ||
    normalizedThreadId.startsWith("gemini-pending-")
  ) {
    return "gemini";
  }
  if (
    normalizedThreadId.startsWith("grok:") ||
    normalizedThreadId.startsWith("grok-pending-")
  ) {
    return "grok";
  }
  if (
    normalizedThreadId.startsWith("kimi:") ||
    normalizedThreadId.startsWith("kimi-pending-")
  ) {
    return "kimi";
  }
  if (
    normalizedThreadId.startsWith("pi:") ||
    normalizedThreadId.startsWith("pi-pending-")
  ) {
    return "pi";
  }
  if (
    normalizedThreadId.startsWith("opencode:") ||
    normalizedThreadId.startsWith("opencode-pending-")
  ) {
    return "opencode";
  }
  if (
    normalizedThreadId.startsWith("dsh:") ||
    normalizedThreadId.startsWith("dsh-pending-")
  ) {
    return "dsh";
  }
  if (
    normalizedThreadId.startsWith("qoder:") ||
    normalizedThreadId.startsWith("qoder-pending-")
  ) {
    return "qoder";
  }
  if (
    normalizedThreadId.startsWith("codex:") ||
    normalizedThreadId.startsWith("codex-pending-")
  ) {
    return "codex";
  }

  return null;
}

export function resolveActiveConversationEngine(
  activeThreadSummary: ThreadSummary | null,
  activeThreadId: string | null,
  selectedEngine: EngineType | undefined,
): ConversationEngine {
  const threadEngine =
    activeThreadSummary?.selectedEngine ??
    activeThreadSummary?.engineSource ??
    inferConversationEngineFromThreadId(activeThreadId);
  return toConversationEngine(threadEngine ?? selectedEngine);
}

/**
 * 收集当前 canvas 会话的「子代理线程」。
 *
 * - parent 直接挂到 activeId 的行（grok 等 Shared remap 后的子行）
 * - Shared 父：`claude:subagent:{owner}:{agentId}` 行 parentThreadId 为空，
 *   owner 命中该 Shared 的 nativeThreadIds 即视为子代理
 *   （与侧栏树对 claude:subagent id 的解析口径一致）。
 */
export function collectCanvasChildSubagentThreads(
  activeId: string | null | undefined,
  workspaceId: string | null | undefined,
  threads: readonly ThreadSummary[] | undefined,
  threadParentById: Record<string, string>,
  nativeThreadIds: readonly string[] | undefined,
): ThreadSummary[] {
  if (!activeId || !workspaceId || !threads) {
    return [];
  }
  const isSharedParent = activeId.startsWith("shared:");
  const owners = isSharedParent
    ? (nativeThreadIds ?? []).filter((id) => id.trim().length > 0)
    : [];
  return threads.filter((thread) => {
    // pi fork 派生会话不是子代理：pi 没有 subagent 概念，parentThreadId 在 pi
    // 语义里是会话分支（fork-to-new-file），分支归属由会话树单独控制，
    // 不计入子代理（capability-router-allow-engine-branch：pi 分域，见
    // enhance-pi-native-rpc-session）。
    if (thread.engineSource === "pi" || thread.id.startsWith("pi:")) {
      return false;
    }
    const parent =
      thread.parentThreadId ?? threadParentById[thread.id] ?? null;
    if (parent === activeId) {
      return true;
    }
    if (owners.length === 0) {
      return false;
    }
    return owners.some((owner) => {
      const bare = owner.startsWith("claude:")
        ? owner.slice("claude:".length)
        : owner;
      return (
        thread.id.startsWith(`claude:subagent:${owner}:`) ||
        thread.id.startsWith(`claude:subagent:${bare}:`)
      );
    });
  });
}
