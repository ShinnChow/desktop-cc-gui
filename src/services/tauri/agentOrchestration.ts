import { invoke } from "@tauri-apps/api/core";

import type {
  AgentExecutionTarget,
  AgentPreparedAttempt,
  AgentProjectionV1,
  AgentStageBinding,
} from "../../features/multi-agent/types";

export async function sharedAgentRequestRun(
  workspaceId: string,
  threadId: string,
  text: string,
  target: AgentExecutionTarget,
  stageBindings?: AgentStageBinding[],
  /** 首段附图（Context Fan-in）；可空 */
  images?: string[] | null,
  /** 主幕可见原文（无注入块）；缺省回退 text */
  visibleText?: string | null,
): Promise<{
  projection: AgentProjectionV1;
  stageAttempt?: AgentPreparedAttempt;
  planAttempt?: AgentPreparedAttempt;
}> {
  return invoke("shared_agent_request_run", {
    workspaceId,
    threadId,
    text,
    target,
    stageBindings: stageBindings ?? null,
    images: images?.length ? images : null,
    visibleText: visibleText?.trim() ? visibleText.trim() : null,
  });
}

export async function sharedAgentGet(
  workspaceId: string,
  threadId: string,
): Promise<AgentProjectionV1 | null> {
  return invoke("shared_agent_get", { workspaceId, threadId });
}

/** 获取该 Shared 会话中所有协作轮次（历史 + 当前），用于页面刷新后重放折叠卡 */
export async function sharedAgentListAll(
  workspaceId: string,
  threadId: string,
): Promise<AgentProjectionV1[]> {
  return invoke("shared_agent_list_all", { workspaceId, threadId });
}



export async function sharedAgentApprove(
  workspaceId: string,
  threadId: string,
  runId: string,
  revision: number,
  /** 可选：批准时用户补充，注入后续实现/审查段 */
  approvalNote?: string | null,
): Promise<{
  projection: AgentProjectionV1;
  stageAttempt?: AgentPreparedAttempt | null;
  executeAttempt?: AgentPreparedAttempt | null;
}> {
  const note = approvalNote?.trim() || null;
  return invoke("shared_agent_approve", {
    workspaceId,
    threadId,
    runId,
    revision,
    approvalNote: note,
  });
}

export async function sharedAgentRecordExecute(
  workspaceId: string,
  threadId: string,
  runId: string,
  attemptId: string,
): Promise<{
  projection: AgentProjectionV1;
  stageAttempt?: AgentPreparedAttempt | null;
}> {
  return invoke("shared_agent_record_execute", {
    workspaceId,
    threadId,
    runId,
    attemptId,
  });
}



export async function sharedAgentCancel(
  workspaceId: string,
  threadId: string,
  runId: string,
  reason: string,
): Promise<{ projection: AgentProjectionV1; attemptIds: string[] }> {
  return invoke("shared_agent_cancel", {
    workspaceId,
    threadId,
    runId,
    reason,
  });
}

/** 单节点重试：关闭卡死/失败 attempt，同 stage 新开 worker turn */
export async function sharedAgentRetryStage(
  workspaceId: string,
  threadId: string,
  runId: string,
  stageId: string,
): Promise<{
  projection: AgentProjectionV1;
  stageAttempt?: AgentPreparedAttempt | null;
}> {
  return invoke("shared_agent_retry_stage", {
    workspaceId,
    threadId,
    runId,
    stageId,
  });
}

export async function sharedAgentFinalizeCancel(
  workspaceId: string,
  threadId: string,
  runId: string,
  attemptResults: unknown[],
): Promise<AgentProjectionV1> {
  return invoke("shared_agent_finalize_cancel", {
    workspaceId,
    threadId,
    runId,
    attemptResults,
  });
}
