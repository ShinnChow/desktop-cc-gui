import { invoke } from "@tauri-apps/api/core";
import type {
  AgentConfig,
  AgentImportApplyResult,
  AgentImportPreviewResult,
  AppSettings,
  BuiltInAgentCatalog,
  BuiltInAgentPrompt,
} from "../../types";

export async function listAgentConfigs(): Promise<AgentConfig[]> {
  return invoke<AgentConfig[]>("agent_list");
}

export async function addAgentConfig(agent: AgentConfig): Promise<void> {
  return invoke("agent_add", { agent });
}

export async function updateAgentConfig(
  id: string,
  updates: Partial<Pick<AgentConfig, "name" | "prompt" | "icon">>,
): Promise<void> {
  return invoke("agent_update", { id, updates });
}

export async function deleteAgentConfig(id: string): Promise<boolean> {
  return invoke<boolean>("agent_delete", { id });
}





export async function exportAgentConfigs(
  agentIds: string[],
  path: string,
): Promise<void> {
  return invoke("agent_export", { agentIds, path });
}

export async function previewImportAgentConfigs(
  path: string,
): Promise<AgentImportPreviewResult> {
  return invoke<AgentImportPreviewResult>("agent_import_preview", { path });
}

export async function applyImportAgentConfigs(input: {
  agents: AgentConfig[];
  strategy: "skip" | "overwrite" | "duplicate";
}): Promise<AgentImportApplyResult> {
  return invoke<AgentImportApplyResult>("agent_import_apply", {
    agents: input.agents,
    strategy: input.strategy,
  });
}

export async function listBuiltInAgents(
  locale: string,
): Promise<BuiltInAgentCatalog> {
  return invoke<BuiltInAgentCatalog>("list_built_in_agents", { locale });
}

export async function setBuiltInAgentEnabled(
  agentId: string,
  enabled: boolean,
): Promise<AppSettings> {
  return invoke<AppSettings>("set_built_in_agent_enabled", {
    agentId,
    enabled,
  });
}

export async function setBuiltInAgentDivisionEnabled(
  divisionId: string,
  enabled: boolean,
): Promise<AppSettings> {
  return invoke<AppSettings>("set_built_in_agent_division_enabled", {
    divisionId,
    enabled,
  });
}

export async function getBuiltInAgentPrompt(
  agentId: string,
): Promise<BuiltInAgentPrompt> {
  return invoke<BuiltInAgentPrompt>("get_built_in_agent_prompt", { agentId });
}

export async function resolveEnabledBuiltInAgent(
  agentId: string,
): Promise<BuiltInAgentPrompt> {
  return invoke<BuiltInAgentPrompt>("resolve_enabled_built_in_agent", {
    agentId,
  });
}
