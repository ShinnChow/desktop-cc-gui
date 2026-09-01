import type { AppSettings, EngineType } from "../../types";
import type { CenterMode } from "../../features/app/hooks/useGitPanelController";

export type NotificationActionExtra = {
  workspaceId?: unknown;
  threadId?: unknown;
};

export type PendingClaudeTuiOpen = {
  workspaceId: string;
  terminalId: string;
  command: string;
};

export type PendingTerminalCommand = {
  workspaceId: string;
  terminalId: string;
  command: string;
  followUpCommand?: string;
  followUpDelayMs?: number;
};

export type ThreadSwitchScope = {
  workspaceId: string;
  threadId: string;
};

export type WorkspaceShellSettings = Pick<AppSettings, "workspaceGroups"> &
  Partial<Pick<AppSettings, "selectedOpenAppId">>;
export type WorkspaceShellTab = "projects" | "codex" | "spec" | "git" | "log";
export type WorkspaceShellCenterMode = CenterMode;

export function isEngineType(value: unknown): value is EngineType {
  return (
    value === "claude" ||
    value === "codex" ||
    value === "gemini" ||
    value === "grok" ||
    value === "kimi" ||
    value === "opencode" ||
    value === "pi" ||
    value === "omp" ||
    value === "dsh" ||
    value === "qoder"
  );
}
