import type { AppServerEvent, ApprovalRequest, CollaborationModeBlockedRequest, CollaborationModeResolvedRequest, RequestUserInputRequest } from "../../../types";
import type { ConversationEngine, NormalizedThreadEvent } from "../../threads/contracts/conversationCurtainContracts";
import type { MutableRefObject } from "react";
import type { SharedSessionNativeBinding } from "../../shared-session/runtime/sharedSessionBridge";
import { ThreadAgentCompletedItemTracker, ThreadAgentSnapshotItemTracker } from "./appServerEventExtractors";

export type AgentDelta = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  delta: string;
  turnId?: string | null;
};

export type TurnErrorPayload = {
  message: string;
  willRetry: boolean;
  suppressMessage?: boolean;
  engine?: ConversationEngine | null;
  executionTargetSnapshot?: SharedSessionNativeBinding["executionTargetSnapshot"];
};

export type TurnStalledPayload = {
  message: string;
  reasonCode: string;
  stage: string;
  source: string;
  startedAtMs: number | null;
  timeoutMs: number | null;
  engine?: ConversationEngine | null;
};

export type AgentCompleted = {
  workspaceId: string;
  threadId: string;
  itemId: string;
  text: string;
  turnId?: string | null;
};

export type AppServerEventHandlers = {
  onNormalizedRealtimeEvent?: (event: NormalizedThreadEvent) => void;
  onWorkspaceConnected?: (workspaceId: string) => void;
  onThreadStarted?: (
    workspaceId: string,
    thread: Record<string, unknown>,
  ) => void;
  onThreadSessionIdUpdated?: (
    workspaceId: string,
    threadId: string,
    sessionId: string,
    engine?: "claude" | "opencode" | "codex" | "gemini" | "grok" | "kimi" | "pi" | "dsh" | "qoder" | null,
    turnId?: string | null,
  ) => void;
  onBackgroundThreadAction?: (
    workspaceId: string,
    threadId: string,
    action: string,
  ) => void;
  onApprovalRequest?: (request: ApprovalRequest) => void;
  onRequestUserInput?: (request: RequestUserInputRequest) => void;
  onModeBlocked?: (event: CollaborationModeBlockedRequest) => void;
  onModeResolved?: (event: CollaborationModeResolvedRequest) => void;
  onAgentMessageDelta?: (event: AgentDelta) => void;
  onAgentMessageCompleted?: (event: AgentCompleted) => void;
  onAppServerEvent?: (event: AppServerEvent) => void;
  onTurnStarted?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
  ) => void;
  onSharedRuntimeTurnStarted?: (
    threadId: string,
    runtimeTurnId: string,
  ) => void;
  onTurnCompleted?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
  ) => void;
  /**
   * pi 专属：一个 agent run 彻底 settle（pump `agent_settled` 生命周期标记）。
   * pi 的 run 含多个原生 turn，完成音等「整轮结束」语义的消费者 MUST 监听
   * 本信号而非 turn/completed（后者每原生 turn 一次，会连响）。
   */
  onThreadRunSettled?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
  ) => void;
  onProcessingHeartbeat?: (
    workspaceId: string,
    threadId: string,
    pulse: number,
  ) => void;
  onContextCompacting?: (
    workspaceId: string,
    threadId: string,
    payload: {
      usagePercent: number | null;
      thresholdPercent: number | null;
      targetPercent: number | null;
      auto?: boolean | null;
      manual?: boolean | null;
    },
  ) => void;
  onContextCompacted?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload?: {
      auto?: boolean | null;
      manual?: boolean | null;
      /** pi compaction_end 透传；缺失为 null。 */
      reason?: "threshold" | "overflow" | "manual" | null;
      tokensBefore?: number | null;
      estimatedTokensAfter?: number | null;
    },
  ) => void;
  onContextCompactionFailed?: (
    workspaceId: string,
    threadId: string,
    reason: string,
  ) => void;
  onRuntimeEnded?: (
    workspaceId: string,
    payload: {
      reasonCode: string;
      message: string;
      affectedThreadIds: string[];
      affectedTurnIds: string[];
      pendingRequestCount: number;
      hadActiveLease: boolean;
      runtimeGeneration?: string;
      runtimeProcessId?: number;
      runtimeStartedAtMs?: number;
    },
  ) => void;
  onTurnError?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: TurnErrorPayload,
  ) => void;
  onTurnStalled?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: TurnStalledPayload,
  ) => void;
  onTurnPlanUpdated?: (
    workspaceId: string,
    threadId: string,
    turnId: string,
    payload: { explanation: unknown; plan: unknown },
  ) => void;
  onItemStarted?: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  onItemUpdated?: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  onItemCompleted?: (
    workspaceId: string,
    threadId: string,
    item: Record<string, unknown>,
  ) => void;
  /**
   * PI 后台任务状态更新（pi-background-tasks 扩展）：receipt 快照（启动）与
   * `<background-task-notification>` 终态唤醒。task 为 canonical 快照；
   * notification 路径 toolId 为 null，按 task.id 关联。
   */
  onBackgroundTaskUpdated?: (
    workspaceId: string,
    threadId: string,
    payload: {
      toolId: string | null;
      task: Record<string, unknown>;
      source: string;
    },
  ) => void;
  onReasoningSummaryDelta?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    delta: string,
    engineHint?: "gemini" | "grok" | "kimi" | "pi" | "dsh" | "qoder" | null,
    turnId?: string | null,
  ) => void;
  onReasoningSummaryBoundary?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    engineHint?: "gemini" | "grok" | "kimi" | "pi" | "dsh" | "qoder" | null,
    turnId?: string | null,
  ) => void;
  onReasoningTextDelta?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    delta: string,
    engineHint?: "gemini" | "grok" | "kimi" | "pi" | "dsh" | "qoder" | null,
    turnId?: string | null,
  ) => void;
  onCommandOutputDelta?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    delta: string,
    turnId?: string | null,
  ) => void;
  onTerminalInteraction?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    stdin: string,
    turnId?: string | null,
  ) => void;
  onFileChangeOutputDelta?: (
    workspaceId: string,
    threadId: string,
    itemId: string,
    delta: string,
    turnId?: string | null,
  ) => void;
  onTurnDiffUpdated?: (
    workspaceId: string,
    threadId: string,
    diff: string,
  ) => void;
  onThreadTokenUsageUpdated?: (
    workspaceId: string,
    threadId: string,
    tokenUsage: Record<string, unknown>,
  ) => void;
  onAssistantRuntimeReceipt?: (
    workspaceId: string,
    threadId: string,
    runtimeReceipt: NonNullable<
      Extract<import("../../../types").ConversationItem, { kind: "message" }>["runtimeReceipt"]
    >,
  ) => void;
  onAccountRateLimitsUpdated?: (
    workspaceId: string,
    rateLimits: Record<string, unknown>,
  ) => void;
  /**
   * 获取指定 workspace 当前活动的 Codex thread ID
   * 仅用于低风险兼容展示路径，不能作为 lifecycle mutation owner。
   */
  getActiveCodexThreadId?: (workspaceId: string) => string | null;
  /**
   * Returns a thread only when the workspace has exactly one processing
   * Codex conversation. This is the bounded fallback for owner-gated
   * lifecycle events that lack explicit thread context.
   */
  getSingleProcessingCodexThreadId?: (workspaceId: string) => string | null;
};

export type UseAppServerEventsOptions = {
  useNormalizedRealtimeAdapters?: boolean;
  /** false = 不订阅事件总线（测试/特殊宿主可关） */
  enabled?: boolean;
};

export type DispatchAppServerEventOptions = {
  useNormalizedRealtimeAdapters: boolean;
  threadAgentDeltaSeenRef: MutableRefObject<Record<string, true>>;
  threadAgentCompletedSeenRef: MutableRefObject<ThreadAgentCompletedItemTracker>;
  threadAgentSnapshotSeenRef: MutableRefObject<ThreadAgentSnapshotItemTracker>;
};

export type DispatchAppServerEventBatchOptions = DispatchAppServerEventOptions & {
  chunkSize?: number;
  onComplete?: () => void;
};

export const DEFAULT_APP_SERVER_EVENT_BATCH_CHUNK_SIZE = 64;

