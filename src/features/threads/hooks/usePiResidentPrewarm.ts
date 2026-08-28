import { useEffect, useRef } from "react";
import type { DebugEntry } from "../../../types/misc";
import { enginePrewarm } from "../../../services/tauri/appServer";

/**
 * pi resident 预热（optimize-pi-first-packet-latency 阶段二）：
 * 会话激活后把 pi spawn + handshake 的 ~2.5s 冷启挪出首条发送的关键路径。
 * 形态对齐 codex 先例（useWorkspaces 的 codex disk runtime prewarm）：
 * 延迟触发避开激活瞬间高峰、per-thread 去重、fire-and-forget、失败静默
 * （双轨契约：首条发送仍走 ensure_resident 主路径）。
 */

/** 激活后延迟预热，避开切会话高峰（对齐 codex prewarm 的 setTimeout 形态）。 */
export const PI_PREWARM_DELAY_MS = 1_500;

/**
 * 只有 `pi:<session-id>` 形态的恢复会话可预热：pi-pending-* 无 session id，
 * 且 send scratch 是每 turn 唯一的 turn id，预热 resident 无法被 send 命中，
 * 只会白起一个进程。
 */
export function resolvePrewarmPiSessionId(threadId: string | null): string | null {
  if (!threadId || !threadId.startsWith("pi:")) {
    return null;
  }
  const sessionId = threadId.slice("pi:".length).trim();
  return sessionId.length > 0 ? sessionId : null;
}

type UsePiResidentPrewarmOptions = {
  workspaceId: string | null;
  threadId: string | null;
  onDebug?: ((entry: DebugEntry) => void) | null;
};

export function usePiResidentPrewarm({
  workspaceId,
  threadId,
  onDebug,
}: UsePiResidentPrewarmOptions) {
  const completedRef = useRef<Set<string>>(new Set());
  const inFlightRef = useRef<Set<string>>(new Set());
  const onDebugRef = useRef(onDebug);
  onDebugRef.current = onDebug;

  useEffect(() => {
    const sessionId = resolvePrewarmPiSessionId(threadId);
    if (!workspaceId || !sessionId) {
      return undefined;
    }
    const dedupeKey = `${workspaceId}\u0000${threadId}`;
    if (
      completedRef.current.has(dedupeKey) ||
      inFlightRef.current.has(dedupeKey)
    ) {
      return undefined;
    }
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      if (cancelled) {
        return;
      }
      inFlightRef.current.add(dedupeKey);
      void enginePrewarm(workspaceId, { engine: "pi", sessionId }).then(
        () => {
          completedRef.current.add(dedupeKey);
        },
        (error: unknown) => {
          onDebugRef.current?.({
            id: `${Date.now()}-pi-resident-prewarm-error`,
            timestamp: Date.now(),
            source: "client",
            label: "pi/resident prewarm error",
            payload: {
              workspaceId,
              threadId,
              error: error instanceof Error ? error.message : String(error),
            },
          });
        },      );
    }, PI_PREWARM_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [workspaceId, threadId]);
}
