import { invoke } from "@tauri-apps/api/core";
import type { AppSettings, CuratedSkillOption } from "../../types";
import { traceStartupCommand, type StartupWorkspaceScope } from "../../features/startup-orchestration/utils/startupTrace";
import { isOpenCodeCliUnavailableError } from "./openCode";

function workspaceScope(workspaceId: string): StartupWorkspaceScope {
  return { workspaceId };
}

function traceStartupInvoke<T>(
  commandLabel: string,
  scope: StartupWorkspaceScope | "global",
  run: () => Promise<T>,
) {
  return traceStartupCommand(commandLabel, scope, run);
}

export async function getSkillsList(
  workspaceId: string,
  customSkillRoots?: string[],
) {
  return traceStartupInvoke("skills_list", workspaceScope(workspaceId), () =>
    invoke<unknown>("skills_list", {
      workspaceId,
      customSkillRoots: customSkillRoots ?? [],
    }),
  );
}

export async function getCuratedSkills() {
  return invoke<CuratedSkillOption[]>("get_curated_skills");
}

export async function setCuratedSkillEnabled(
  skillId: string,
  enabled: boolean,
) {
  return invoke<AppSettings>("set_curated_skill_enabled", {
    skillId,
    enabled,
  });
}

export async function getEnabledCuratedSkillIds() {
  return invoke<string[]>("get_enabled_curated_skill_ids");
}



export async function getClaudeCommandsList(workspaceId?: string | null) {
  return traceStartupInvoke(
    "claude_commands_list",
    workspaceId ? workspaceScope(workspaceId) : "global",
    () =>
      invoke<unknown>("claude_commands_list", {
        workspaceId: workspaceId ?? null,
      }),
  );
}

export async function getOpenCodeCommandsList(refresh = false) {
  return traceStartupInvoke("opencode_commands_list", "global", async () => {
    try {
      return await invoke<unknown>("opencode_commands_list", { refresh });
    } catch (error) {
      // Active engine can be opencode while CLI is missing; treat as empty
      // catalog so idle-prewarm does not surface "内部命令失败".
      if (isOpenCodeCliUnavailableError(error)) {
        return [];
      }
      throw error;
    }
  });
}

export async function startClaudeCommandsWatch(workspaceId?: string | null) {
  return invoke<void>("claude_commands_watch_start", {
    workspaceId: workspaceId ?? null,
  });
}

export async function stopClaudeCommandsWatch(workspaceId?: string | null) {
  return invoke<void>("claude_commands_watch_stop", {
    workspaceId: workspaceId ?? null,
  });
}

export type CreatedClaudeCommand = {
  name: string;
  path: string;
  source: string;
  description: string | null;
  argumentHint: string | null;
  content: string;
};

export async function claudeCommandCreate(options: {
  workspaceId: string;
  name: string;
  content: string;
}) {
  return invoke<CreatedClaudeCommand>("claude_command_create", {
    workspaceId: options.workspaceId,
    name: options.name,
    content: options.content,
  });
}

export async function getOpenCodeAgentsList(refresh = false) {
  return traceStartupInvoke("opencode_agents_list", "global", async () => {
    try {
      return await invoke<unknown>("opencode_agents_list", { refresh });
    } catch (error) {
      // Same soft-empty contract as commands/session list when CLI is absent.
      if (isOpenCodeCliUnavailableError(error)) {
        return [];
      }
      throw error;
    }
  });
}
