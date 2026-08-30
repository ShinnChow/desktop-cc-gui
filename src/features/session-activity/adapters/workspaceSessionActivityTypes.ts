import type { ConversationItem, ThreadSummary } from "../../../types";
import type {
  SessionActivityEvent,
  SessionActivityRelationshipSource,
  SessionActivitySessionSummary,
} from "../types";

export type ThreadStatusSnapshot = {
  isProcessing?: boolean;
  /** 后台任务运行中计数（turn 已 settle、durable 任务仍在跑时计入活跃度）。 */
  backgroundTaskRunningCount?: number;
};

export type BuildWorkspaceSessionActivityOptions = {
  activeThreadId: string | null;
  threads: ThreadSummary[];
  itemsByThread: Record<string, ConversationItem[]>;
  threadParentById: Record<string, string>;
  threadStatusById: Record<string, ThreadStatusSnapshot | undefined>;
};

export type WorkspaceSessionActivityThreadContext = {
  thread: ThreadSummary;
  rootThreadId: string;
  relationshipSource: SessionActivityRelationshipSource;
  threadIsProcessing: boolean;
  inheritedTurnSemantic?: string;
};

export type WorkspaceSessionActivityContext = {
  rootThreadId: string;
  rootThreadName: string;
  relevantThreads: WorkspaceSessionActivityThreadContext[];
};

export type WorkspaceSessionActivityThreadSnapshot = {
  threadId: string;
  threadName: string;
  sessionRole: SessionActivitySessionSummary["sessionRole"];
  relationshipSource: SessionActivityRelationshipSource;
  isProcessing: boolean;
  eventCount: number;
  events: SessionActivityEvent[];
};

export type ToolItem = Extract<ConversationItem, { kind: "tool" }>;
