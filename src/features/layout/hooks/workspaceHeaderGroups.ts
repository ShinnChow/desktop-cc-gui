import type { WorkspaceInfo } from "../../../types";

type WorkspaceHeaderGroup = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

function getSortOrder(value?: number | null) {
  return Number.isFinite(value) ? Number(value) : Number.MAX_SAFE_INTEGER;
}

function sortByOrderAndName(left: WorkspaceInfo, right: WorkspaceInfo) {
  const orderDiff =
    getSortOrder(left.settings.sortOrder) - getSortOrder(right.settings.sortOrder);
  if (orderDiff !== 0) {
    return orderDiff;
  }
  return left.name.localeCompare(right.name);
}

export function buildWorkspaceHeaderGroups(
  groupedWorkspaces: readonly WorkspaceHeaderGroup[],
  workspaces: readonly WorkspaceInfo[],
): WorkspaceHeaderGroup[] {
  const worktreesByParent = new Map<string, WorkspaceInfo[]>();

  workspaces
    .filter((entry) => (entry.kind ?? "main") === "worktree" && Boolean(entry.parentId))
    .forEach((worktree) => {
      const parentId = worktree.parentId as string;
      const bucket = worktreesByParent.get(parentId) ?? [];
      bucket.push(worktree);
      worktreesByParent.set(parentId, bucket);
    });

  worktreesByParent.forEach((entries) => {
    entries.sort(sortByOrderAndName);
  });

  return groupedWorkspaces.map((group) => ({
    ...group,
    workspaces: group.workspaces.flatMap((workspace) => {
      const worktrees = worktreesByParent.get(workspace.id) ?? [];
      return worktrees.length > 0 ? [workspace, ...worktrees] : [workspace];
    }),
  }));
}


