import type {
  AccountSnapshot,
  ApprovalRequest,
  AutoSessionMetadata,
  ConversationItem,
  ExecutionTargetSnapshot,
  RateLimitSnapshot,
  RequestUserInputRequest,
  RuntimeModelReceipt,
  SharedRuntimeControlOwner,
  ThreadSummary,
  ThreadTokenUsage,
  TurnPlan,
} from "../../../types";
import type { NormalizedThreadEvent } from "../contracts/conversationCurtainContracts";
import type {
  CodexAcceptedTurnFact,
  CodexAcceptedTurnRecord,
} from "../utils/codexConversationLiveness";

export type CodexCompactionSource = "auto" | "manual";
export type CodexCompactionLifecycleState = "idle" | "compacting" | "completed";

export type ThreadActivityStatus = {
  isProcessing: boolean;
  hasUnread: boolean;
  isReviewing: boolean;
  isContextCompacting?: boolean;
  processingStartedAt: number | null;
  lastDurationMs: number | null;
  heartbeatPulse?: number;
  continuationPulse?: number;
  lastContinuationEvidenceAtMs?: number | null;
  terminalPulse?: number;
  codexCompactionSource?: CodexCompactionSource | null;
  codexCompactionLifecycleState?: CodexCompactionLifecycleState;
  codexCompactionCompletedAt?: number | null;
  lastTokenUsageUpdatedAt?: number | null;
  codexSilentSuspectedAt?: number | null;
  codexSilentSuspectedSource?: string | null;
};

export type ThreadBackgroundActivityProjection = {
  threadId: string;
  isRunning: boolean;
  lastActivityAt: number | null;
  bufferedOutputCount: number;
  hasUnread: boolean;
  needsApproval: boolean;
  latestErrorSummary: string | null;
};

export type ThreadState = {
  activeThreadIdByWorkspace: Record<string, string | null>;
  itemsByThread: Record<string, ConversationItem[]>;
  historyRestoredAtMsByThread: Record<string, number | null>;
  historyWindowByThread: Record<
    string,
    { hasMore: boolean; nextCursor: string | null }
  >;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  hiddenThreadIdsByWorkspace: Record<string, Record<string, true>>;
  threadParentById: Record<string, string>;
  threadStatusById: Record<string, ThreadActivityStatus>;
  threadListLoadingByWorkspace: Record<string, boolean>;
  threadListPagingByWorkspace: Record<string, boolean>;
  threadListCursorByWorkspace: Record<string, string | null>;
  activeTurnIdByThread: Record<string, string | null>;
  codexAcceptedTurnByThread: Record<string, CodexAcceptedTurnRecord>;
  approvals: ApprovalRequest[];
  userInputRequests: RequestUserInputRequest[];
  tokenUsageByThread: Record<string, ThreadTokenUsage>;
  rateLimitsByWorkspace: Record<string, RateLimitSnapshot | null>;
  accountByWorkspace: Record<string, AccountSnapshot | null>;
  planByThread: Record<string, TurnPlan | null>;
  lastAgentMessageByThread: Record<string, { text: string; timestamp: number }>;
  agentSegmentByThread: Record<string, number>;
};

export type ThreadAction =
  | { type: "setActiveThreadId"; workspaceId: string; threadId: string | null }
  | {
      type: "ensureThread";
      workspaceId: string;
      threadId: string;
      engine?: "codex" | "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "dsh" | "qoder";
      name?: string | null;
      dshAgentPreset?: string | null;
      parentThreadId?: string | null;
      folderId?: string | null;
      autoSession?: AutoSessionMetadata | null;
      sourceLabel?: string | null;
      providerProfileId?: string | null;
      providerProfileSource?: string | null;
      providerProfileName?: string | null;
      providerAvailability?: string | null;
    }
  | { type: "hideThread"; workspaceId: string; threadId: string }
  | { type: "removeThread"; workspaceId: string; threadId: string }
  | { type: "setThreadParent"; threadId: string; parentId: string }
  | {
      type: "markProcessing";
      threadId: string;
      isProcessing: boolean;
      timestamp: number;
    }
  | {
      type: "markContextCompacting";
      threadId: string;
      isCompacting: boolean;
      timestamp?: number;
      source?: CodexCompactionSource | null;
      completionStatus?: "completed" | "idle";
    }
  | {
      type: "settleCodexCompactionMessage";
      threadId: string;
      text: string;
      fallbackMessageId?: string | null;
      appendIfAlreadyCompleted?: boolean;
    }
  | {
      type: "appendCodexCompactionMessage";
      threadId: string;
      text: string;
    }
  | {
      type: "discardLatestCodexCompactionMessage";
      threadId: string;
      text: string;
    }
  | {
      type: "setThreadHistoryRestoredAt";
      threadId: string;
      timestamp: number | null;
    }
  | { type: "markHeartbeat"; threadId: string; pulse: number }
  | {
      type: "markContinuationEvidence";
      threadId: string;
      at: number;
      force?: boolean;
    }
  | { type: "markTerminalSettlement"; threadId: string }
  | {
      type: "markCodexSilentSuspected";
      threadId: string;
      timestamp: number;
      source: string;
    }
  | { type: "clearCodexSilentSuspected"; threadId: string }
  | {
      type: "finalizePendingToolStatuses";
      threadId: string;
      status: "completed" | "failed";
    }
  | { type: "markReviewing"; threadId: string; isReviewing: boolean }
  | { type: "markUnread"; threadId: string; hasUnread: boolean }
  | {
      type: "addAssistantMessage";
      threadId: string;
      text: string;
      executionTargetSnapshot?: Extract<
        ConversationItem,
        { kind: "message" }
      >["executionTargetSnapshot"];
    }
  | {
      type: "patchAssistantRuntimeReceipt";
      threadId: string;
      runtimeReceipt: Extract<
        ConversationItem,
        { kind: "message" }
      >["runtimeReceipt"];
    }
  | { type: "setThreadName"; workspaceId: string; threadId: string; name: string }
  | {
      type: "setThreadEngine";
      workspaceId: string;
      threadId: string;
      engine: "codex" | "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "dsh" | "qoder";
    }
  | {
      type: "setThreadDshAgentPreset";
      workspaceId: string;
      threadId: string;
      dshAgentPreset: string | null;
    }
  | {
      type: "setThreadTimestamp";
      workspaceId: string;
      threadId: string;
      timestamp: number;
    }
  | {
      type: "appendAgentDelta";
      workspaceId: string;
      threadId: string;
      itemId: string;
      delta: string;
      hasCustomName: boolean;
      /** Native turn-target 显示条：建壳落地、existing 缺失补；绝不覆盖既有值。 */
      executionTargetSnapshot?: ExecutionTargetSnapshot;
      /** 同上：pi 等无回执事件的引擎靠发送时 send.request 记账补 Ⓡ 尾巴。 */
      runtimeReceipt?: RuntimeModelReceipt;
    }
  | {
      type: "completeAgentMessage";
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
      hasCustomName: boolean;
      timestamp?: number;
      executionTargetSnapshot?: ExecutionTargetSnapshot;
      runtimeReceipt?: RuntimeModelReceipt;
    }
  | {
      /**
       * \u00a76: \u5408\u5e76 action\u3002\u4e00\u6b21\u6027\u628a\u539f onAgentMessageCompleted \u91cc 5 \u4e2a\u8fde\u7eed
       * dispatch \u7684 state \u526f\u4f5c\u7528\uff08completeAgentMessage / setThreadTimestamp /
       * setLastAgentMessage / markUnread + ensureThread\uff09\u5408\u6210 1 \u4e2a dispatch\u3002
       * markUnread \u4ec5\u5728 isActiveThread === false \u65f6\u5e94\u7528\uff0c
       * \u4ee5\u4fdd\u8bc1\u8bed\u4e49\u7b49\u4ef7\u3002
       */
      type: "flushAgentCompletedBatch";
      workspaceId: string;
      threadId: string;
      itemId: string;
      text: string;
      hasCustomName: boolean;
      timestamp: number;
      isActiveThread: boolean;
      /** Native turn-target 显示条：终稿合并保留已有值，仅缺失时落地。 */
      executionTargetSnapshot?: ExecutionTargetSnapshot;
      runtimeReceipt?: RuntimeModelReceipt;
    }
  | {
      type: "upsertItem";
      workspaceId: string;
      threadId: string;
      item: ConversationItem;
      hasCustomName?: boolean;
    }
  | {
      type: "applyNormalizedRealtimeEvent";
      workspaceId: string;
      threadId: string;
      event: NormalizedThreadEvent;
      hasCustomName: boolean;
    }
  | { type: "clearProcessingGeneratedImages"; threadId: string }
  | { type: "evictThreadItems"; threadIds: string[] }
  | { type: "setThreadItems"; threadId: string; items: ConversationItem[] }
  | {
      type: "prependThreadItems";
      threadId: string;
      items: ConversationItem[];
    }
  | {
      type: "setThreadHistoryWindow";
      threadId: string;
      hasMore: boolean;
      nextCursor: string | null;
    }
  | {
      type: "appendReasoningSummary";
      threadId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "appendReasoningSummaryBoundary";
      threadId: string;
      itemId: string;
    }
  | {
      type: "appendContextCompacted";
      threadId: string;
      turnId: string;
      /** pi compaction_end 的触发原因；缺失（未知 payload）为 undefined → 落库 null。 */
      reason?: "threshold" | "overflow" | "manual" | null;
      tokensBefore?: number | null;
      estimatedTokensAfter?: number | null;
      timestampMs?: number;
    }
  | { type: "appendReasoningContent"; threadId: string; itemId: string; delta: string }
  | { type: "dropReasoningItems"; threadId: string }
  | { type: "appendToolOutput"; threadId: string; itemId: string; delta: string }
  | {
      type: "setThreads";
      workspaceId: string;
      threads: ThreadSummary[];
      unionMembership?: boolean;
    }
  | {
      type: "setThreadListLoading";
      workspaceId: string;
      isLoading: boolean;
    }
  | {
      type: "setThreadListPaging";
      workspaceId: string;
      isLoading: boolean;
    }
  | {
      type: "setThreadListCursor";
      workspaceId: string;
      cursor: string | null;
    }
  | { type: "addApproval"; approval: ApprovalRequest }
  | {
      type: "removeApproval";
      requestId: number | string;
      workspaceId: string;
      approval?: ApprovalRequest;
    }
  | { type: "addUserInputRequest"; request: RequestUserInputRequest }
  | {
      type: "removeUserInputRequest";
      requestId: number | string;
      workspaceId: string;
      request?: RequestUserInputRequest;
      sharedRuntimeOwner?: SharedRuntimeControlOwner;
    }
  | {
      type: "clearUserInputRequestsForThread";
      workspaceId: string;
      threadId: string;
    }
  | { type: "setThreadTokenUsage"; threadId: string; tokenUsage: ThreadTokenUsage }
  | { type: "setThreadSessionStats"; threadId: string; sessionStats: ThreadTokenUsage["sessionStats"] }
  | { type: "setThreadDshTodos"; threadId: string; todos: ThreadTokenUsage["dshTodos"] }
  | {
      type: "patchThreadDshContextUsage";
      threadId: string;
      patch: Partial<
        Pick<
          ThreadTokenUsage,
          | "contextUsedTokens"
          | "modelContextWindow"
          | "contextUsedPercent"
          | "contextRemainingPercent"
          | "contextCategoryUsages"
          | "contextUsageSource"
          | "contextUsageFreshness"
        >
      >;
    }
  | {
      type: "setRateLimits";
      workspaceId: string;
      rateLimits: RateLimitSnapshot | null;
    }
  | {
      type: "setAccountInfo";
      workspaceId: string;
      account: AccountSnapshot | null;
    }
  | { type: "setActiveTurnId"; threadId: string; turnId: string | null }
  | {
      type: "markCodexAcceptedTurn";
      threadId: string;
      fact: CodexAcceptedTurnFact;
      source: string;
      timestamp: number;
    }
  | { type: "setThreadPlan"; threadId: string; plan: TurnPlan | null }
  | {
      type: "settleThreadPlanInProgress";
      threadId: string;
      targetStatus: "pending" | "completed";
    }
  | { type: "clearThreadPlan"; threadId: string }
  | { type: "incrementAgentSegment"; threadId: string }
  | { type: "resetAgentSegment"; threadId: string }
  | { type: "markLatestAssistantMessageFinal"; threadId: string }
  | {
      type: "setLastAgentMessage";
      threadId: string;
      text: string;
      timestamp: number;
    }
  | {
      type: "renameThreadId";
      workspaceId: string;
      oldThreadId: string;
      newThreadId: string;
    }
  | {
      type: "hydrateSidebarSnapshot";
      threadsByWorkspace: Record<string, ThreadSummary[]>;
    };
