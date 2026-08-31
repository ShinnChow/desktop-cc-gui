import { useCallback, useMemo } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { WorkspaceInfo } from "../../../types";
import type { WorkspaceGroupSection } from "./sidebarInternals";

type SidebarCollapseAllParams = {
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: WorkspaceGroupSection[];
  collapsedWorktreeSections: Set<string>;
  setCollapsedWorktreeSections: Dispatch<SetStateAction<Set<string>>>;
  collapsedGroups: Set<string>;
  replaceCollapsedGroups: (nextGroups: Set<string>) => void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
};

export function useSidebarCollapseAll({
  workspaces,
  groupedWorkspaces,
  collapsedWorktreeSections,
  setCollapsedWorktreeSections,
  collapsedGroups,
  replaceCollapsedGroups,
  onToggleWorkspaceCollapse,
}: SidebarCollapseAllParams) {
  const rootWorkspaceIds = useMemo(
    () =>
      groupedWorkspaces.flatMap((group) =>
        group.workspaces.map((workspace) => workspace.id),
      ),
    [groupedWorkspaces],
  );

  const allGroupToggleIds = useMemo(() => {
    const ids = new Set<string>();
    groupedWorkspaces.forEach((group) => {
      if (!group.id) {
        return;
      }
      ids.add(group.id);
    });
    return Array.from(ids);
  }, [groupedWorkspaces]);

  const isAllCollapsed = useMemo(() => {
    const allWorkspaceCollapsed = workspaces.every(
      (workspace) => workspace.settings.sidebarCollapsed,
    );
    const allWorktreeSectionCollapsed = rootWorkspaceIds.every((id) =>
      collapsedWorktreeSections.has(id),
    );
    const allWorkspaceGroupCollapsed = allGroupToggleIds.every((id) =>
      collapsedGroups.has(id),
    );
    return (
      allWorkspaceCollapsed &&
      allWorktreeSectionCollapsed &&
      allWorkspaceGroupCollapsed
    );
  }, [
    workspaces,
    rootWorkspaceIds,
    collapsedWorktreeSections,
    allGroupToggleIds,
    collapsedGroups,
  ]);

  const handleToggleCollapseAll = useCallback(() => {
    const shouldCollapse = !isAllCollapsed;
    workspaces.forEach((workspace) => {
      const currentlyCollapsed = workspace.settings.sidebarCollapsed;
      if (currentlyCollapsed !== shouldCollapse) {
        onToggleWorkspaceCollapse(workspace.id, shouldCollapse);
      }
    });
    setCollapsedWorktreeSections(
      shouldCollapse ? new Set(rootWorkspaceIds) : new Set<string>(),
    );
    replaceCollapsedGroups(
      shouldCollapse ? new Set(allGroupToggleIds) : new Set<string>(),
    );
  }, [
    allGroupToggleIds,
    isAllCollapsed,
    onToggleWorkspaceCollapse,
    replaceCollapsedGroups,
    rootWorkspaceIds,
    workspaces,
  ]);

  return { isAllCollapsed, handleToggleCollapseAll };
}
