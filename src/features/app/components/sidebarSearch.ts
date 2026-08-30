import type { WorkspaceInfo } from "../../../types";
import { isDefaultWorkspacePath } from "../../workspaces/utils/defaultWorkspace";
import type { WorkspaceGroupSection } from "./sidebarInternals";

export function isWorkspaceSearchMatch(
  workspace: WorkspaceInfo,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  return workspace.name.toLowerCase().includes(normalizedQuery);
}

export function filterWorkspaceGroupSections(
  groupedWorkspaces: WorkspaceGroupSection[],
  isWorkspaceMatch: (workspace: WorkspaceInfo) => boolean,
): WorkspaceGroupSection[] {
  return groupedWorkspaces
    .map((group) => ({
      ...group,
      workspaces: group.workspaces.filter(isWorkspaceMatch),
    }))
    .filter((group) => group.workspaces.length > 0);
}

export function collectDefaultWorkspaceEntries(
  filteredGroupedWorkspaces: WorkspaceGroupSection[],
): WorkspaceInfo[] {
  return filteredGroupedWorkspaces
    .flatMap((group) => group.workspaces)
    .filter((workspace) => isDefaultWorkspacePath(workspace.path));
}

export function filterOutDefaultWorkspaceEntries(
  filteredGroupedWorkspaces: WorkspaceGroupSection[],
): WorkspaceGroupSection[] {
  return filteredGroupedWorkspaces
    .map((group) => ({
      ...group,
      workspaces: group.workspaces.filter(
        (workspace) => !isDefaultWorkspacePath(workspace.path),
      ),
    }))
    .filter((group) => group.workspaces.length > 0);
}

export function collectUngroupedWorkspaceEntries(
  filteredGroupedWorkspacesWithoutDefault: WorkspaceGroupSection[],
): WorkspaceInfo[] {
  return filteredGroupedWorkspacesWithoutDefault
    .filter((group) => group.id === null)
    .flatMap((group) => group.workspaces);
}

export function collectNamedWorkspaceGroups(
  filteredGroupedWorkspacesWithoutDefault: WorkspaceGroupSection[],
): Array<WorkspaceGroupSection & { id: string }> {
  return filteredGroupedWorkspacesWithoutDefault.filter(
    (group): group is WorkspaceGroupSection & { id: string } =>
      group.id !== null,
  );
}
