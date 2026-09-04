import type { RealtimeReplayEvent } from "./realtimeReplayTypes";

type ThreadFixture = {
  threadId: string;
  engine: "codex" | "claude" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "qoder";
  threadLabel: string;
};

export const REALTIME_REPLAY_WORKSPACE_ID = "ws-realtime-perf";
export const REALTIME_REPLAY_BATCH_WINDOW_MS = 12;
export const REALTIME_REPLAY_CYCLE_MS = 5_000;
export const REALTIME_REPLAY_THREADS: ThreadFixture[] = [
  {
    threadId: "codex:replay-thread-1",
    engine: "codex",
    threadLabel: "codex",
  },
  {
    threadId: "claude:replay-thread-2",
    engine: "claude",
    threadLabel: "claude",
  },
  {
    threadId: "opencode:replay-thread-3",
    engine: "opencode",
    threadLabel: "opencode",
  },
];

function pushCycleEvents(
  events: RealtimeReplayEvent[],
  cycleIndex: number,
  cycleStartAtMs: number,
  thread: ThreadFixture,
  threadOffsetMs: number,
) {
  const turnToken = `${thread.threadLabel}-turn-${cycleIndex + 1}`;
  const assistantId = `${thread.threadId}:assistant:${turnToken}`;
  const reasoningId = `${thread.threadId}:reasoning:${turnToken}`;
  const toolId = `${thread.threadId}:tool:${turnToken}`;
  const eventPrefix = `${thread.threadLabel}:${cycleIndex + 1}`;
  const at = (offset: number) => cycleStartAtMs + threadOffsetMs + offset;

  events.push(
    {
      id: `${eventPrefix}:agent-delta-1`,
      kind: "agentDelta",
      workspaceId: REALTIME_REPLAY_WORKSPACE_ID,
      threadId: thread.threadId,
      itemId: assistantId,
      delta: `[${turnToken}] drafting response `,
      atMs: at(0),
    },
    {
      id: `${eventPrefix}:reasoning-summary`,
      kind: "reasoningSummaryDelta",
      workspaceId: REALTIME_REPLAY_WORKSPACE_ID,
      threadId: thread.threadId,
      itemId: reasoningId,
      delta: `Plan ${turnToken}`,
      atMs: at(2),
    },
    {
      id: `${eventPrefix}:reasoning-content-1`,
      kind: "reasoningContentDelta",
      workspaceId: REALTIME_REPLAY_WORKSPACE_ID,
      threadId: thread.threadId,
      itemId: reasoningId,
      delta: `Inspect ${turnToken} scope. `,
      atMs: at(4),
    },
    {
      id: `${eventPrefix}:tool-start`,
      kind: "toolStarted",
      workspaceId: REALTIME_REPLAY_WORKSPACE_ID,
      threadId: thread.threadId,
      itemId: toolId,
      command: "pnpm vitest --run",
      atMs: at(6),
    },
    {
      id: `${eventPrefix}:tool-output-1`,
      kind: "toolOutputDelta",
      workspaceId: REALTIME_REPLAY_WORKSPACE_ID,
      threadId: thread.threadId,
      itemId: toolId,
      delta: `running ${turnToken}\n`,
      atMs: at(8),
    },
    {
      id: `${eventPrefix}:agent-delta-2`,
      kind: "agentDelta",
      workspaceId: REALTIME_REPLAY_WORKSPACE_ID,
      threadId: thread.threadId,
      itemId: assistantId,
      delta: `with evidence ${turnToken}.`,
      atMs: at(10),
    },
    {
      id: `${eventPrefix}:reasoning-content-2`,
      kind: "reasoningContentDelta",
      workspaceId: REALTIME_REPLAY_WORKSPACE_ID,
      threadId: thread.threadId,
      itemId: reasoningId,
      delta: `Close ${turnToken} decisions.`,
      atMs: at(12),
    },
    {
      id: `${eventPrefix}:tool-output-2`,
      kind: "toolOutputDelta",
      workspaceId: REALTIME_REPLAY_WORKSPACE_ID,
      threadId: thread.threadId,
      itemId: toolId,
      delta: `ok:${turnToken}`,
      atMs: at(14),
    },
    {
      id: `${eventPrefix}:agent-complete`,
      kind: "agentCompleted",
      workspaceId: REALTIME_REPLAY_WORKSPACE_ID,
      threadId: thread.threadId,
      itemId: assistantId,
      text: `[${turnToken}] drafting response with evidence ${turnToken}.`,
      atMs: at(20),
    },
  );
}

export function buildThreeThreadReplayEventsForDuration(durationMs: number): RealtimeReplayEvent[] {
  const totalCycles = Math.max(1, Math.ceil(durationMs / REALTIME_REPLAY_CYCLE_MS));
  const events: RealtimeReplayEvent[] = [];

  for (let cycleIndex = 0; cycleIndex < totalCycles; cycleIndex += 1) {
    const cycleStartAtMs = cycleIndex * REALTIME_REPLAY_CYCLE_MS;
    REALTIME_REPLAY_THREADS.forEach((thread, threadIndex) => {
      pushCycleEvents(events, cycleIndex, cycleStartAtMs, thread, threadIndex * 7);
    });
  }

  return events;
}

export function buildThreeThreadReplayEventsForMinutes(minutes: number): RealtimeReplayEvent[] {
  const safeMinutes = Math.max(1, minutes);
  return buildThreeThreadReplayEventsForDuration(safeMinutes * 60_000);
}
