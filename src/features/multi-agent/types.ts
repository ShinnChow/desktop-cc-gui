import type { EngineType } from "../../types";

export type AgentRunStatus =
  | "planning"
  | "awaiting-approval"
  | "implementing"
  | "executing" // legacy alias
  | "reviewing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type AgentStageId = "plan" | "implement" | "review";

export type AgentStageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type AgentExecutionTarget = {
  engine: EngineType;
  providerProfileId?: string | null;
  modelCatalogEntryId?: string | null;
  model?: string | null;
  reasoningEffort?: string | null;
  providerProfileNameSnapshot?: string | null;
  providerProfileSource?: string | null;
  runtimeCapabilityFingerprint?: string | null;
};

export type AgentStageBinding = {
  id: AgentStageId | string;
  target: AgentExecutionTarget;
  title?: string | null;
  rolePrompt?: string | null;
  accessMode?: string | null;
  requiresApproval?: boolean | null;
  /**
   * 本段如何消费前序产出：summary | full。
   * 缺省 summary；首段可省略。
   */
  upstreamFeedMode?: "summary" | "full" | null;
  /** 模板绑定的客户端智能体（展示用，可选） */
  personaAgentId?: string | null;
  personaAgentName?: string | null;
  personaAgentIcon?: string | null;
  /** 智能体正文快照（仅 CLI 注入，幕布不展示） */
  personaPrompt?: string | null;
};

export type AgentPlanDraft = {
  schemaVersion: number;
  summary: string;
  markdown: string;
  steps?: string[];
};

export type AgentStageProjection = {
  id: string;
  title: string;
  role: string;
  rolePrompt?: string | null;
  target: AgentExecutionTarget;
  status: AgentStageStatus;
  accessMode: string;
  requiresApproval?: boolean;
  attemptId?: string | null;
  bindingKey?: string | null;
  startedAt?: number | null;
  settledAt?: number | null;
  shortOutcome?: string | null;
  /** 右栏节点全文（Messages 渲染，与 SubAgent 幕布同源） */
  fullOutcome?: string | null;
  /**
   * 本段启动时上游喂料策略（绑定快照）；缺省 summary。
   */
  upstreamFeedMode?: "summary" | "full" | null;
  error?: string | null;
  /** 本环节绑定的智能体（Inspector 标题行展示 icon/name；正文不展示） */
  personaAgentId?: string | null;
  personaAgentName?: string | null;
  personaAgentIcon?: string | null;
  /** 智能体正文快照（执行叠层；UI 不渲染） */
  personaPrompt?: string | null;
};

export type AgentPreparedAttempt = {
  runId: string;
  stageId: string;
  attemptId: string;
  logicalTurnId: string;
  bindingKey: string;
  target: AgentExecutionTarget;
  accessMode: string;
  /** legacy */
  phase?: string;
};

export type AgentProjectionV1 = {
  schemaVersion: number;
  runId: string;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  requestText: string;
  /** 主幕可见原文；后续段用户任务用此字段 */
  userVisibleText?: string;
  /** 首段附图路径；仅 stages[0] 消费 */
  firstStageImages?: string[];
  target: AgentExecutionTarget;
  status: AgentRunStatus;
  planRevision: number;
  plan: AgentPlanDraft | null;
  stages?: AgentStageProjection[];
  activeAttemptIds?: string[];
  diagnostics?: string[];
  requestedAt: number;
  approvedAt?: number | null;
  /** 批准时用户可选补充；后续段 prompt 已注入（展示/调试用） */
  approvalNote?: string | null;
  updatedAt: number;
  finalSummary?: string | null;
};

export function isTerminalAgentStatus(status: AgentRunStatus): boolean {
  return (
    status === "succeeded" || status === "failed" || status === "cancelled"
  );
}



export function normalizeAgentProjection(
  projection: AgentProjectionV1 | null | undefined,
): AgentProjectionV1 | null {
  if (!projection) return null;
  const plan = projection.plan
    ? {
        ...projection.plan,
        steps: projection.plan.steps ?? [],
        summary: projection.plan.summary ?? "",
        markdown: projection.plan.markdown ?? "",
        schemaVersion: projection.plan.schemaVersion ?? 1,
      }
    : null;
  const stages = (projection.stages ?? []).map((stage) => ({
    ...stage,
    status: stage.status ?? "pending",
    accessMode: stage.accessMode ?? "read-only",
  }));
  // map legacy executing
  const status =
    projection.status === "executing" ? "implementing" : projection.status;
  return {
    ...projection,
    status,
    plan,
    stages,
    activeAttemptIds: projection.activeAttemptIds ?? [],
    diagnostics: projection.diagnostics ?? [],
    planRevision: projection.planRevision ?? 0,
  };
}


