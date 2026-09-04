import { useMemo } from "react";
import type { TFunction } from "i18next";
import type { WorkspaceInfo } from "../../../../../types";
import { getSortOrderValue } from "./GitHistoryPanelImplHelpers";
import type { GitHistoryPickerOption } from "./GitHistoryPanelPickers";

type ProjectSectionsScope = {
  groupedWorkspaces: Array<{ id: string | null; name: string; workspaces: WorkspaceInfo[] }>;
  selectedProjectWorkspaceId: string | null;
  t: TFunction<"translation", undefined>;
  workspace: WorkspaceInfo | null;
  workspaces: WorkspaceInfo[];
  workingTreeChangedFiles: number;
};

export function useGitHistoryPanelProjectSections(scope: ProjectSectionsScope) {
  const {
    groupedWorkspaces,
    selectedProjectWorkspaceId,
    t,
    workspace,
    workspaces,
    workingTreeChangedFiles,
  } = scope;

  const workingTreeSummaryLabel =
    workingTreeChangedFiles > 0
      ? t("git.filesChanged", { count: workingTreeChangedFiles })
      : t("git.workingTreeClean");
  const projectOptions = useMemo(() => {
    if (workspaces.length > 0) {
      return workspaces;
    }
    return workspace ? [workspace] : [];
  }, [workspace, workspaces]);
  const projectSections = useMemo(() => {
    const worktreesByParent = new Map<string, WorkspaceInfo[]>();
    for (const entry of workspaces) {
      if ((entry.kind ?? "main") !== "worktree" || !entry.parentId) {
        continue;
      }
      const bucket = worktreesByParent.get(entry.parentId) ?? [];
      bucket.push(entry);
      worktreesByParent.set(entry.parentId, bucket);
    }
    for (const bucket of worktreesByParent.values()) {
      bucket.sort((a, b) => {
        const orderDiff =
          getSortOrderValue(a.settings.sortOrder) -
          getSortOrderValue(b.settings.sortOrder);
        if (orderDiff !== 0) {
          return orderDiff;
        }
        return a.name.localeCompare(b.name);
      });
    }

    const toOption = (
      entry: WorkspaceInfo,
      kind: "main" | "worktree",
      parentLabel?: string | null,
    ) =>
      ({
        id: entry.id,
        label: entry.name,
        kind,
        parentLabel: parentLabel ?? null,
        selected: entry.id === selectedProjectWorkspaceId,
      }) satisfies GitHistoryPickerOption;

    if (groupedWorkspaces.length > 0) {
      return groupedWorkspaces
        .map((section) => ({
          id: section.id,
          name: section.name,
          options: section.workspaces.flatMap((entry) => {
            const worktreeOptions = (worktreesByParent.get(entry.id) ?? []).map(
              (worktree) => toOption(worktree, "worktree", entry.name),
            );
            return [toOption(entry, "main"), ...worktreeOptions];
          }),
        }))
        .filter((section) => section.options.length > 0);
    }
    return [
      {
        id: null,
        name: "",
        options: projectOptions.map((entry) =>
          toOption(
            entry,
            (entry.kind ?? "main") === "worktree" ? "worktree" : "main",
          ),
        ),
      },
    ];
  }, [
    groupedWorkspaces,
    projectOptions,
    selectedProjectWorkspaceId,
    workspaces,
  ]);

  return {
    projectOptions,
    projectSections,
    workingTreeSummaryLabel,
  };
}
