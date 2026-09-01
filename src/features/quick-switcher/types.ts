export const QUICK_SWITCHER_RECENT_LIMIT = 30;

export type QuickSwitcherRecentFileSource = "opened" | "ai-modified";

export type QuickSwitcherRecentFile = {
  workspaceId: string;
  path: string;
  touchedAt: number;
  source: QuickSwitcherRecentFileSource;
  aiModifiedAt?: number;
};

export type QuickSwitcherNavigationId =
  | "globalSearch"
  | "chat"
  | "files"
  | "git"
  | "history"
  | "spec"
  | "intentCanvas"
  | "projectMap"
  | "notes"
  | "memory"
  | "terminal"
  | "settings";

/**
 * 进行中 AI 会话（来自 sessionRadarFeed.runningSessions 的投影）。
 * engine 与 SessionRadarEntry.engine 对齐（实际类型为 string）。
 * startedAt 与 SessionRadarEntry.startedAt 对齐：radar 尚未观测到开始时间时
 * 为 null（不回退 updatedAt，避免把「最近活动」误标为「开始时间」）。
 */
export type QuickSwitcherRunningSession = {
  workspaceId: string;
  workspaceName: string;
  threadId: string;
  threadName: string;
  engine: string;
  startedAt: number | null;
};

export type QuickSwitcherSession = {
  workspaceId: string;
  id: string;
  title: string;
  updatedAt: number;
  engine: "codex" | "claude" | "codex" | "gemini" | "grok" | "kimi" | "opencode" | "pi" | "omp" | "dsh" | "qoder";
  isShared: boolean;
};

export type QuickSwitcherSessionGroup = {
  workspaceId: string;
  workspaceName: string;
  latestAt: number;
  sessions: QuickSwitcherSession[];
};

export type QuickSwitcherRecentFileGroup = {
  workspaceId: string;
  workspaceName: string;
  latestAt: number;
  files: QuickSwitcherRecentFile[];
};
