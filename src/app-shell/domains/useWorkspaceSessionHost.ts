import type { AppSettings, DebugEntry } from "../../types";
import { useWorkspaceController } from "../../features/app/hooks/useWorkspaceController";
import { useAppShellWorkspaceHomeState } from "../sections/useAppShellWorkspaceHomeState";

export type WorkspaceSessionHostOptions = {
  appSettings: AppSettings;
  appSettingsLoading: boolean;
  addDebugEntry: (entry: DebugEntry) => void;
  queueSaveSettings: (next: AppSettings) => Promise<AppSettings>;
};

/**
 * S4 PR-B：Workspace/Session 纯数据 host（无 UI）。
 *
 * 职责：
 * - 工作区列表 / 分组 / 连接 / CRUD（useWorkspaceController）
 * - Home 选择投影与 workspacesById/Path（useAppShellWorkspaceHomeState）
 *
 * 不负责：threads runtime、composer、layout、Git/Kanban 模式视图。
 * 后续 PR 可把 active session projection / threads 边界继续下沉到此 host 或旁路 host。
 */
export function useWorkspaceSessionHost({
  appSettings,
  appSettingsLoading,
  addDebugEntry,
  queueSaveSettings,
}: WorkspaceSessionHostOptions) {
  const workspaceController = useWorkspaceController({
    appSettings,
    addDebugEntry,
    queueSaveSettings,
  });

  const workspaceHomeState = useAppShellWorkspaceHomeState({
    activeWorkspaceId: workspaceController.activeWorkspaceId,
    appSettingsLoading,
    groupedWorkspaces: workspaceController.groupedWorkspaces,
    hasLoaded: workspaceController.hasLoaded,
    workspaces: workspaceController.workspaces,
  });

  return {
    ...workspaceController,
    ...workspaceHomeState,
  };
}


