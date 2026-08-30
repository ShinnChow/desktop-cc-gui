import { useCallback, useMemo, useRef } from "react";
import type { DebugEntry } from "../../../types";
import { playNotificationSoundBySelection } from "../../../utils/notificationSounds";
import { useAppServerEvents } from "../../app/hooks/useAppServerEvents";

type SoundNotificationOptions = {
  enabled: boolean;
  soundId?: string | null;
  customSoundPath?: string | null;
  onDebug?: (entry: DebugEntry) => void;
};

function normalizeEventToken(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

function buildCompositeEventKey(parts: Array<string | null | undefined>) {
  const normalizedParts = parts.map((part) => normalizeEventToken(part));
  return normalizedParts.every((part) => part.length > 0)
    ? JSON.stringify(normalizedParts)
    : null;
}

function buildThreadKey(workspaceId: string | null | undefined, threadId: string | null | undefined) {
  return buildCompositeEventKey([workspaceId, threadId]);
}

function buildTurnCompletionKey(threadKey: string | null, turnId: string | null | undefined) {
  return buildCompositeEventKey([threadKey, turnId]);
}

const LEGACY_COMPLETION_SOUND_THROTTLE_MS = 1500;
const COMPLETED_TURN_HISTORY_LIMIT = 20;

function rememberCompletedTurn(
  completedTurnKeysByThread: Map<string, string[]>,
  threadKey: string,
  completedTurnKey: string,
) {
  const previousKeys = completedTurnKeysByThread.get(threadKey) ?? [];
  if (previousKeys.includes(completedTurnKey)) {
    return false;
  }
  completedTurnKeysByThread.set(
    threadKey,
    [...previousKeys, completedTurnKey].slice(-COMPLETED_TURN_HISTORY_LIMIT),
  );
  return true;
}

function isPiConversationThread(threadId: string): boolean {
  // pi 的 run 含多个原生 turn，每 turn 一次 turn/completed 会让完成音连响；
  // pi 线程的完成音改听 thread/runSettled（run 粒度，一次发送一声）。
  return /^pi(:|-pending)/.test(threadId);
}

export function useAgentSoundNotifications({
  enabled,
  soundId,
  customSoundPath,
  onDebug,
}: SoundNotificationOptions) {
  const lastPlayedAtByThread = useRef(new Map<string, number>());
  const completedTurnKeysByThread = useRef(new Map<string, string[]>());

  const playSound = useCallback(
    () => {
      playNotificationSoundBySelection({
        soundId,
        customSoundPath,
        label: "notification",
        onDebug,
      });
    },
    [customSoundPath, onDebug, soundId],
  );

  const shouldPlaySound = useCallback(
    (threadKey: string | null, turnId: string | null | undefined) => {
      if (!enabled || !threadKey) {
        return false;
      }
      const completedTurnKey = buildTurnCompletionKey(threadKey, turnId);
      if (completedTurnKey) {
        if (
          !rememberCompletedTurn(
            completedTurnKeysByThread.current,
            threadKey,
            completedTurnKey,
          )
        ) {
          return false;
        }
      }

      const now = Date.now();
      if (!completedTurnKey) {
        const lastPlayedAt = lastPlayedAtByThread.current.get(threadKey);
        if (
          lastPlayedAt &&
          now - lastPlayedAt < LEGACY_COMPLETION_SOUND_THROTTLE_MS
        ) {
          return false;
        }
      }

      lastPlayedAtByThread.current.set(threadKey, now);
      return true;
    },
    [enabled],
  );

  const handleTurnCompleted = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      // pi 走 thread/runSettled（run 粒度）：pi 的 run 含多个原生 turn，
      // 每 turn 一次 turn/completed 会让完成音连响。
      if (isPiConversationThread(threadId)) {
        return;
      }
      const threadKey = buildThreadKey(workspaceId, threadId);
      if (!threadKey || !shouldPlaySound(threadKey, turnId)) {
        return;
      }
      playSound();
    },
    [playSound, shouldPlaySound],
  );

  const handleThreadRunSettled = useCallback(
    (workspaceId: string, threadId: string, turnId: string) => {
      if (!isPiConversationThread(threadId)) {
        return;
      }
      const threadKey = buildThreadKey(workspaceId, threadId);
      if (!threadKey || !shouldPlaySound(threadKey, `run:${turnId}`)) {
        return;
      }
      playSound();
    },
    [playSound, shouldPlaySound],
  );

  const handlers = useMemo(
    () => ({
      onTurnCompleted: handleTurnCompleted,
      onThreadRunSettled: handleThreadRunSettled,
    }),
    [handleTurnCompleted, handleThreadRunSettled],
  );

  useAppServerEvents(handlers);
}
