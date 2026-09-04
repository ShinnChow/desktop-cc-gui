import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProxyStatusBadge } from "../../../../components/ProxyStatusBadge";
import type { PresentationProfile } from "../../../../conversation-presentation/presentationProfile";
import {
  useActiveCanvasSelector,
  type ActiveCanvasSnapshot,
} from "../../../layout/hooks/activeCanvasStore";
import {
  formatDurationMs,
  formatTokenCount,
  type MessagesEngine,
  OPENCODE_NON_STREAMING_HINT_DELAY_MS,
  shouldDisplayWorkingActivityLabel,
} from "../../utils/messagesRenderUtils";
import {
  resolveWorkingIndicatorLiveTokenCount,
  selectWorkingIndicatorLiveTokenSnapshot,
  type WorkingIndicatorLiveTokenSnapshot,
} from "../../utils/workingIndicatorLiveTokens";
import { AgentThinking } from "./AgentThinking";

function selectLiveTokenSnapshot(
  snapshot: ActiveCanvasSnapshot,
): WorkingIndicatorLiveTokenSnapshot {
  return selectWorkingIndicatorLiveTokenSnapshot(
    snapshot.activeTokenUsage,
    snapshot.activeThreadStatus?.lastTokenUsageUpdatedAt ?? null,
  );
}

function areLiveTokenSnapshotsEqual(
  left: WorkingIndicatorLiveTokenSnapshot,
  right: WorkingIndicatorLiveTokenSnapshot,
) {
  return (
    left.tokenCount === right.tokenCount &&
    left.usageUpdatedAt === right.usageUpdatedAt
  );
}

type WorkingIndicatorProps = {
  isThinking: boolean;
  proxyEnabled?: boolean;
  proxyUrl?: string | null;
  processingStartedAt?: number | null;
  lastDurationMs?: number | null;
  heartbeatPulse?: number;
  hasItems: boolean;
  /** Used only to suppress activity labels that duplicate reasoning first-line. Not rendered. */
  reasoningLabel?: string | null;
  activityLabel?: string | null;
  activeEngine?: MessagesEngine;
  waitingForFirstChunk?: boolean;
  presentationProfile?: PresentationProfile | null;
  primaryLabel?: string | null;
  /** Detached tasks are waiting for a future foreground stream, not a foreground turn. */
  isBackgroundTaskAwaiting?: boolean;
  backgroundTaskRunningCount?: number;
};

/**
 * Unified working indicator.
 * AgentThinking (BoardUI, dot-spin variant) + timer anchored to the turn start
 * + optional live tokens + fixed "响应中..." status always;
 * special primary / tool activity optional.
 * Does not echo reasoning first-line (that belongs in ReasoningRow).
 * Live tokens are read from the canvas selector so usage jitter stays off the
 * Messages root props lane.
 */
export const WorkingIndicator = memo(function WorkingIndicator({
  isThinking,
  proxyEnabled = false,
  proxyUrl = null,
  processingStartedAt = null,
  lastDurationMs = null,
  heartbeatPulse = 0,
  hasItems,
  reasoningLabel = null,
  activityLabel = null,
  activeEngine = "claude",
  waitingForFirstChunk = false,
  presentationProfile = null,
  primaryLabel = null,
  isBackgroundTaskAwaiting = false,
  backgroundTaskRunningCount = 0,
}: WorkingIndicatorProps) {
  const { t } = useTranslation();
  const liveTokenSnapshot = useActiveCanvasSelector(
    selectLiveTokenSnapshot,
    areLiveTokenSnapshotsEqual,
  );
  const liveTokenCount = resolveWorkingIndicatorLiveTokenCount({
    isThinking,
    tokenCount: liveTokenSnapshot.tokenCount,
    usageUpdatedAt: liveTokenSnapshot.usageUpdatedAt,
    processingStartedAt,
  });

  // 阈值到点只需一次 setTimeout 翻转，不需要每秒轮询 elapsed。
  const heartbeatWaitingHintEnabled =
    presentationProfile?.heartbeatWaitingHint ?? activeEngine === "opencode";
  const [hintDelayReached, setHintDelayReached] = useState(false);

  useEffect(() => {
    if (
      !heartbeatWaitingHintEnabled ||
      !isThinking ||
      !waitingForFirstChunk ||
      !processingStartedAt
    ) {
      setHintDelayReached(false);
      return undefined;
    }
    const remainingMs =
      OPENCODE_NON_STREAMING_HINT_DELAY_MS - (Date.now() - processingStartedAt);
    if (remainingMs <= 0) {
      setHintDelayReached(true);
      return undefined;
    }
    setHintDelayReached(false);
    const timeoutId = window.setTimeout(() => {
      setHintDelayReached(true);
    }, remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [
    heartbeatWaitingHintEnabled,
    isThinking,
    waitingForFirstChunk,
    processingStartedAt,
  ]);

  const showNonStreamingHint =
    heartbeatWaitingHintEnabled &&
    isThinking &&
    waitingForFirstChunk &&
    hintDelayReached;
  // reasoningLabel is only used to suppress activity that is itself a reasoning echo.
  const showActivityLabel = shouldDisplayWorkingActivityLabel(
    reasoningLabel,
    activityLabel,
  );
  // Special system status (context compacting / codex wait / approval resume) wins.
  // Otherwise show a fixed short status so the bar is not spinner+timer only.
  // Never fall back to reasoning first-line.
  const respondingText = t("messages.responding");
  const defaultRespondingLabel =
    respondingText === "messages.responding" ? "响应中..." : respondingText;
  const displayPrimaryLabel = primaryLabel?.trim()
    ? primaryLabel
    : defaultRespondingLabel;
  const compactLiveTokenCount =
    liveTokenCount != null ? formatTokenCount(liveTokenCount) : null;
  const translatedLiveTokenLabel =
    compactLiveTokenCount == null
      ? null
      : t("messages.liveTokenUsage", { tokens: compactLiveTokenCount });
  const liveTokenLabel =
    compactLiveTokenCount == null
      ? null
      : translatedLiveTokenLabel === "messages.liveTokenUsage"
        ? compactLiveTokenCount + " tokens"
        : translatedLiveTokenLabel;
  const nonStreamingHintText = t("messages.nonStreamingHint");
  const resolvedNonStreamingHint =
    nonStreamingHintText === "messages.nonStreamingHint"
      ? "This model may return non-streaming output, or the network may be unreachable. Please wait..."
      : nonStreamingHintText;
  const heartbeatHints = useMemo(() => {
    const keys = [
      "messages.opencodeHeartbeatHint1",
      "messages.opencodeHeartbeatHint2",
      "messages.opencodeHeartbeatHint3",
      "messages.opencodeHeartbeatHint4",
      "messages.opencodeHeartbeatHint5",
    ];
    const translated = keys
      .map((key) => t(key))
      .filter((value, index) => value !== keys[index]);
    if (translated.length > 0) {
      return translated;
    }
    return [resolvedNonStreamingHint];
  }, [resolvedNonStreamingHint, t]);
  const [heartbeatHintText, setHeartbeatHintText] = useState("");
  const heartbeatStateRef = useRef<{ lastPulse: number; lastIndex: number }>({
    lastPulse: 0,
    lastIndex: -1,
  });

  useEffect(() => {
    if (!showNonStreamingHint) {
      heartbeatStateRef.current = { lastPulse: 0, lastIndex: -1 };
      setHeartbeatHintText("");
      return;
    }
    if (
      heartbeatPulse <= 0 ||
      heartbeatPulse === heartbeatStateRef.current.lastPulse
    ) {
      return;
    }
    heartbeatStateRef.current.lastPulse = heartbeatPulse;
    let randomIndex = Math.floor(Math.random() * heartbeatHints.length);
    if (
      heartbeatHints.length > 1 &&
      randomIndex === heartbeatStateRef.current.lastIndex
    ) {
      randomIndex = (randomIndex + 1) % heartbeatHints.length;
    }
    heartbeatStateRef.current.lastIndex = randomIndex;
    const pulseText = t("messages.opencodeHeartbeatPulse", {
      pulse: heartbeatPulse,
      hint: heartbeatHints[randomIndex],
    });
    setHeartbeatHintText(
      pulseText === "messages.opencodeHeartbeatPulse"
        ? `Heartbeat ${heartbeatPulse}: ${heartbeatHints[randomIndex]}`
        : pulseText,
    );
  }, [heartbeatHints, heartbeatPulse, showNonStreamingHint, t]);

  return (
    <>
      {isThinking && (
        <div className="working">
          {proxyEnabled && (
            <ProxyStatusBadge
              proxyUrl={proxyUrl}
              label={t("messages.proxyBadge")}
              variant="prominent"
              animated
              className="working-proxy-badge"
            />
          )}
          <AgentThinking
            variant="spin"
            label={displayPrimaryLabel}
            startedAt={processingStartedAt}
            labelClassName="working-text"
            timerClassName="working-timer-clock"
            className="working-agent-thinking"
            data-background-task-awaiting={
              isBackgroundTaskAwaiting ? "true" : undefined
            }
          />
          {liveTokenLabel ? (
            <span className="working-timer">
              <span className="working-timer-separator" aria-hidden>
                ·
              </span>
              <span className="working-timer-tokens">{liveTokenLabel}</span>
            </span>
          ) : null}
          {isBackgroundTaskAwaiting && backgroundTaskRunningCount > 0 ? (
            <span className="working-activity" data-background-task-awaiting>
              {t("messages.backgroundTaskAwaitingContinuation", {
                defaultValue: "任务完成后主对话将自动继续",
              })}
            </span>
          ) : showActivityLabel ? (
            <span className="working-activity">{activityLabel}</span>
          ) : null}
          {showNonStreamingHint && (
            <span className="working-hint">
              {heartbeatHintText || resolvedNonStreamingHint}
            </span>
          )}
        </div>
      )}
      {!isThinking && lastDurationMs !== null && hasItems && (
        <div className="turn-complete" aria-live="polite">
          <span className="turn-complete-line" aria-hidden />
          <span className="turn-complete-label">
            {t("messages.doneIn", {
              duration: formatDurationMs(lastDurationMs),
            })}
          </span>
          <span className="turn-complete-line" aria-hidden />
        </div>
      )}
    </>
  );
});
