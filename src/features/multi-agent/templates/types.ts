import type { EngineType } from "../../../types";
import type { AgentExecutionTarget, AgentStageBinding } from "../types";
import { maT } from "../utils/i18n";



/** 本段启动时如何消费已成功前序产出（仅 stages[index≥1] 生效）。 */
export type UpstreamFeedMode = "summary" | "full";

export function normalizeUpstreamFeedMode(
  value: unknown,
): UpstreamFeedMode {
  return value === "full" ? "full" : "summary";
}

/** 模板内单个环节：完整 ExecutionTarget + 提示词 + 批准点 + 可选智能体。 */
export type CollaborationTemplateStage = {
  id: string;
  title: string;
  rolePrompt: string;
  target: AgentExecutionTarget;
  accessMode: "read-only" | "current";
  requiresApproval: boolean;
  /**
   * 上游喂料：summary=shortOutcome（默认）；full=fullOutcome。
   * 首段忽略；缺省 summary 兼容旧模板。
   */
  upstreamFeedMode?: UpstreamFeedMode;
  /** 客户端智能体（与 Composer # 菜单同源），可选 */
  personaAgentId?: string | null;
  personaAgentName?: string | null;
  personaAgentIcon?: string | null;
  /**
   * 智能体正文快照（选中时冻结）。
   * 发送时单独注入 CLI，不进幕布；与 rolePrompt（本步补充指令）分层。
   */
  personaAgentPrompt?: string | null;
};

export type CollaborationTemplate = {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  stages: CollaborationTemplateStage[];
  version: number;
  updatedAt: number;
};

export type TemplateCatalog = {
  selectedId: string;
  defaultId: string;
  custom: CollaborationTemplate[];
};

/** 内置模板展示名（随 UI 语言）；自定义模板用存储名。 */
export function displayTemplateName(template: CollaborationTemplate): string {
  if (!template.builtin) return template.name;
  return maT(`multiAgent.builtin.${template.id}.name`, {
    defaultValue: template.name,
  });
}

/** 内置模板描述（随 UI 语言）。 */
export function displayTemplateDescription(
  template: CollaborationTemplate,
): string {
  if (!template.builtin) return template.description;
  return maT(`multiAgent.builtin.${template.id}.description`, {
    defaultValue: template.description,
  });
}

/** 内置环节标题（随 UI 语言）；自定义环节用存储 title。 */
export function displayStageTitle(
  template: CollaborationTemplate,
  stage: Pick<CollaborationTemplateStage, "id" | "title">,
): string {
  if (!template.builtin) return stage.title;
  return maT(`multiAgent.builtin.${template.id}.stages.${stage.id}`, {
    defaultValue: stage.title,
  });
}

export function templateFlowLabel(template: CollaborationTemplate): string {
  return template.stages
    .map((stage) => displayStageTitle(template, stage))
    .join(" → ");
}

export function templateApprovalCount(template: CollaborationTemplate): number {
  return template.stages.filter((stage) => stage.requiresApproval).length;
}

/** 前端 picker 用 disk；后端 validate 认 local。发送前统一。 */
export function normalizeAgentTargetSource(
  target: AgentExecutionTarget,
): AgentExecutionTarget {
  const source = target.providerProfileSource?.trim();
  if (source === "disk") {
    return { ...target, providerProfileSource: "local" };
  }
  return target;
}

function isCompleteAgentTarget(target: AgentExecutionTarget): boolean {
  const model = target.model?.trim() || "";
  const catalog = target.modelCatalogEntryId?.trim() || "";
  const name = target.providerProfileNameSnapshot?.trim() || "";
  const source = target.providerProfileSource?.trim() || "";
  if (!model || !catalog || !name || !source) return false;
  // managed 必须有 profileId；local/disk 可无 profileId
  if (source === "managed" && !target.providerProfileId?.trim()) return false;
  return true;
}

/**
 * 合并阶段 target 与会话入口 target。
 * - 完整阶段 target（用户在 picker 选完）→ 原样用
 * - 同引擎未完成 → 用会话 target 补全，仅保留阶段 reasoningEffort 偏好
 * - 跨引擎未完成 → 回退会话 target（避免 claude 引擎 + codex model 非法组合）
 */
export function mergeTarget(
  stageTarget: AgentExecutionTarget,
  fallback: AgentExecutionTarget,
): AgentExecutionTarget {
  if (isCompleteAgentTarget(stageTarget)) {
    return { ...stageTarget };
  }
  if (stageTarget.engine === fallback.engine) {
    return {
      ...fallback,
      engine: stageTarget.engine || fallback.engine,
      reasoningEffort:
        stageTarget.reasoningEffort ?? fallback.reasoningEffort ?? null,
      model: stageTarget.model ?? fallback.model ?? null,
      modelCatalogEntryId:
        stageTarget.modelCatalogEntryId ?? fallback.modelCatalogEntryId ?? null,
      providerProfileId:
        stageTarget.providerProfileId ?? fallback.providerProfileId ?? null,
      providerProfileNameSnapshot:
        stageTarget.providerProfileNameSnapshot ??
        fallback.providerProfileNameSnapshot ??
        null,
      providerProfileSource:
        stageTarget.providerProfileSource ??
        fallback.providerProfileSource ??
        null,
    };
  }
  // 跨引擎且未配齐：安全回退入口 target，避免 validate_resolved 炸
  return {
    ...fallback,
    reasoningEffort:
      stageTarget.reasoningEffort ?? fallback.reasoningEffort ?? null,
  };
}

/**
 * 本步补充指令（rolePrompt only）。
 * 智能体正文走 personaPrompt 字段，禁止再把名字/正文塞进 rolePrompt（避免幕布泄漏）。
 */
export function composeStageRolePrompt(
  stage: CollaborationTemplateStage,
): string | null {
  const body = stage.rolePrompt?.trim() || "";
  return body.length > 0 ? body : null;
}

/** 智能体正文快照；空则 null。 */
export function composeStagePersonaPrompt(
  stage: CollaborationTemplateStage,
): string | null {
  const body = stage.personaAgentPrompt?.trim() || "";
  return body.length > 0 ? body : null;
}

/** 模板 → 后端 stageBindings（完整 N 段，不压成 3 段）。 */
export function templateToStageBindings(
  template: CollaborationTemplate,
  fallback: AgentExecutionTarget,
): AgentStageBinding[] {
  const base = normalizeAgentTargetSource(fallback);
  return template.stages.map((stage, index) => ({
    id: stage.id,
    // 内置环节 title 随 UI 语言写入 binding，投影/右栏与模板展示一致
    title: displayStageTitle(template, stage),
    rolePrompt: composeStageRolePrompt(stage),
    accessMode: stage.accessMode,
    requiresApproval: stage.requiresApproval,
    // 首段默认 full（用户全文）；后续默认 summary。可移动后由 UI 强制首段 full。
    upstreamFeedMode:
      index === 0
        ? stage.upstreamFeedMode === "summary"
          ? "summary"
          : "full"
        : normalizeUpstreamFeedMode(stage.upstreamFeedMode),
    target: normalizeAgentTargetSource(mergeTarget(stage.target, base)),
    personaAgentId: stage.personaAgentId ?? null,
    personaAgentName: stage.personaAgentName ?? null,
    personaAgentIcon: stage.personaAgentIcon ?? null,
    personaPrompt: composeStagePersonaPrompt(stage),
  }));
}

/** 移动/hydrate 后：下标 0 强制 full；其余缺省 summary。 */
export function normalizeStagesFeedModes(
  stages: CollaborationTemplateStage[],
): CollaborationTemplateStage[] {
  return stages.map((stage, index) => ({
    ...stage,
    upstreamFeedMode:
      index === 0
        ? "full"
        : normalizeUpstreamFeedMode(stage.upstreamFeedMode),
  }));
}

export function emptyTarget(engine: EngineType = "claude"): AgentExecutionTarget {
  return {
    engine,
    providerProfileId: null,
    modelCatalogEntryId: null,
    model: null,
    reasoningEffort: null,
    providerProfileNameSnapshot: null,
    providerProfileSource: null,
    runtimeCapabilityFingerprint: null,
  };
}

export function stageTargetLabel(target: AgentExecutionTarget): string {
  const engine = target.engine ?? "—";
  const model =
    target.model?.trim() ||
    target.providerProfileNameSnapshot?.trim() ||
    "";
  const effort = target.reasoningEffort?.trim();
  const parts = [String(engine)];
  if (model) parts.push(model);
  if (effort) parts.push(effort);
  return parts.join(" · ");
}
