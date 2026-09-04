import type { TFunction } from "i18next";
import type { EngineType, WorkspaceInfo } from "../../../../../types";
import type {
  WorkspaceSessionCatalogEntry,
  WorkspaceSessionFolder,
} from "../../../../../services/tauri";
import { selectProjectedSessionDisplayName } from "../../../../threads/utils/sessionDisplayProjection";

export type GroupedWorkspace = {
  id: string | null;
  name: string;
  workspaces: WorkspaceInfo[];
};

export type WorkspaceOption = {
  id: string;
  label: string;
  pickerLabel: string;
  depth: number;
  kind: "project" | "worktree";
};

export type SessionFolderNavItem = {
  id: string;
  label: string;
  depth: number;
  count: number;
};

export type SessionFolderCountSummary = {
  folderCountsById: Map<string, number>;
  unassignedFolderCount: number;
};

const deterministicCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function getSortOrderValue(value: number | null | undefined) {
  return typeof value === "number" ? value : Number.MAX_SAFE_INTEGER;
}

function compareStableText(left: string, right: string) {
  const textDiff = deterministicCollator.compare(left, right);
  return textDiff !== 0 ? textDiff : left.localeCompare(right);
}

function compareWorkspaceInfo(left: WorkspaceInfo, right: WorkspaceInfo) {
  const sortDiff =
    getSortOrderValue(left.settings.sortOrder) -
    getSortOrderValue(right.settings.sortOrder);
  if (sortDiff !== 0) {
    return sortDiff;
  }
  return compareStableText(left.name, right.name) || left.id.localeCompare(right.id);
}

function buildSessionEntryKey(
  entry: Pick<
    WorkspaceSessionCatalogEntry,
    "workspaceId" | "sessionId" | "stableSessionKey"
  >,
) {
  const stableKey = entry.stableSessionKey?.trim();
  return `${entry.workspaceId}::${stableKey || entry.sessionId}`;
}

export function buildWorkspaceOptions(
  workspaces: WorkspaceInfo[],
  groupedWorkspaces: GroupedWorkspace[],
  scopeLabels: {
    project: string;
    worktree: string;
  },
): WorkspaceOption[] {
  const rootById = new Map<string, WorkspaceInfo>();
  const worktreesByParent = new Map<string, WorkspaceInfo[]>();

  workspaces.forEach((workspace) => {
    if ((workspace.kind ?? "main") === "worktree" && workspace.parentId) {
      const bucket = worktreesByParent.get(workspace.parentId) ?? [];
      bucket.push(workspace);
      worktreesByParent.set(workspace.parentId, bucket);
      return;
    }
    rootById.set(workspace.id, workspace);
  });

  const appendOptionsForWorkspace = (
    workspace: WorkspaceInfo,
    output: WorkspaceOption[],
  ) => {
    const groupPrefix =
      groupedWorkspaces.find((group) =>
        group.workspaces.some((item) => item.id === workspace.id),
      )?.name ?? "";
    const baseLabel = groupPrefix
      ? `${groupPrefix} / ${workspace.name}`
      : workspace.name;
    output.push({
      id: workspace.id,
      label: baseLabel,
      pickerLabel: groupPrefix
        ? `${groupPrefix} / ${scopeLabels.project} ${workspace.name}`
        : `${scopeLabels.project} ${workspace.name}`,
      depth: 0,
      kind: "project",
    });
    const worktrees = [...(worktreesByParent.get(workspace.id) ?? [])].sort(
      compareWorkspaceInfo,
    );
    worktrees.forEach((worktree) => {
      const scopedLabel = `${scopeLabels.worktree} ${worktree.name}`;
      output.push({
        id: worktree.id,
        label: `${groupPrefix ? `${groupPrefix} / ` : ""}${scopedLabel}`,
        pickerLabel: `${groupPrefix ? `${groupPrefix} / ` : ""}${scopedLabel}`,
        depth: 1,
        kind: "worktree",
      });
    });
  };

  const orderedRoots = [...rootById.values()].sort(compareWorkspaceInfo);

  const options: WorkspaceOption[] = [];
  orderedRoots.forEach((workspace) =>
    appendOptionsForWorkspace(workspace, options),
  );
  return options;
}

export function normalizeSessionFolderId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function buildSessionFolderNavItems(
  folders: WorkspaceSessionFolder[],
  folderCountsById: ReadonlyMap<string, number>,
): SessionFolderNavItem[] {
  const folderIds = new Set(folders.map((folder) => folder.id));
  const parentById = new Map(
    folders.map(
      (folder) =>
        [folder.id, normalizeSessionFolderId(folder.parentId)] as const,
    ),
  );
  const childrenByParent = new Map<string | null, WorkspaceSessionFolder[]>();

  const hasCycle = (folderId: string) => {
    const seen = new Set<string>();
    let cursor: string | null = folderId;
    while (cursor) {
      if (seen.has(cursor)) {
        return true;
      }
      seen.add(cursor);
      cursor = parentById.get(cursor) ?? null;
    }
    return false;
  };

  [...folders]
    .sort(
      (left, right) =>
        compareStableText(left.name, right.name) ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id),
    )
    .forEach((folder) => {
      const parentId = normalizeSessionFolderId(folder.parentId);
      const safeParentId =
        parentId &&
        parentId !== folder.id &&
        folderIds.has(parentId) &&
        !hasCycle(folder.id)
          ? parentId
          : null;
      const siblings = childrenByParent.get(safeParentId) ?? [];
      siblings.push(folder);
      childrenByParent.set(safeParentId, siblings);
    });

  const items: SessionFolderNavItem[] = [];
  const visit = (parentId: string | null, depth: number) => {
    (childrenByParent.get(parentId) ?? []).forEach((folder) => {
      items.push({
        id: folder.id,
        label: folder.name,
        depth,
        count: folderCountsById.get(folder.id) ?? 0,
      });
      visit(folder.id, depth + 1);
    });
  };
  visit(null, 1);
  return items;
}

export function buildLoadedSessionFolderCountSummary(
  entries: WorkspaceSessionCatalogEntry[],
): SessionFolderCountSummary {
  const folderCountsById = new Map<string, number>();
  const effectiveFolderBySessionId = buildEffectiveSessionFolderMap(entries);
  let unassignedFolderCount = 0;

  entries.forEach((entry) => {
    const folderId = normalizeSessionFolderId(
      effectiveFolderBySessionId.get(buildSessionEntryKey(entry)),
    );
    if (!folderId) {
      unassignedFolderCount += 1;
      return;
    }
    folderCountsById.set(folderId, (folderCountsById.get(folderId) ?? 0) + 1);
  });

  return {
    folderCountsById,
    unassignedFolderCount,
  };
}

export function buildEffectiveSessionFolderMap(
  entries: WorkspaceSessionCatalogEntry[],
) {
  const entriesBySessionId = new Map<string, WorkspaceSessionCatalogEntry[]>();
  entries.forEach((entry) => {
    const bucket = entriesBySessionId.get(entry.sessionId) ?? [];
    bucket.push(entry);
    entriesBySessionId.set(entry.sessionId, bucket);
  });
  const effectiveFolderBySessionId = new Map<string, string | null>();

  const resolveParentEntry = (entry: WorkspaceSessionCatalogEntry) => {
    const parentSessionId = normalizeSessionFolderId(entry.parentSessionId);
    if (!parentSessionId) {
      return null;
    }
    const parentCandidates = entriesBySessionId.get(parentSessionId) ?? [];
    const sameWorkspaceParent =
      parentCandidates.find((parent) => parent.workspaceId === entry.workspaceId) ??
      null;
    if (sameWorkspaceParent) {
      return sameWorkspaceParent;
    }
    return parentCandidates.length === 1 ? parentCandidates[0] : null;
  };

  const resolveEffectiveFolderId = (
    entry: WorkspaceSessionCatalogEntry,
    visiting: Set<string>,
  ): string | null => {
    const entryKey = buildSessionEntryKey(entry);
    if (effectiveFolderBySessionId.has(entryKey)) {
      return effectiveFolderBySessionId.get(entryKey) ?? null;
    }

    const explicitFolderId = normalizeSessionFolderId(entry.folderId);
    if (explicitFolderId) {
      effectiveFolderBySessionId.set(entryKey, explicitFolderId);
      return explicitFolderId;
    }

    const parent = resolveParentEntry(entry);
    if (!parent || visiting.has(entryKey)) {
      effectiveFolderBySessionId.set(entryKey, null);
      return null;
    }

    visiting.add(entryKey);
    const inheritedFolderId = resolveEffectiveFolderId(parent, visiting);
    visiting.delete(entryKey);
    effectiveFolderBySessionId.set(entryKey, inheritedFolderId);
    return inheritedFolderId;
  };

  entries.forEach((entry) => {
    resolveEffectiveFolderId(entry, new Set());
  });

  return effectiveFolderBySessionId;
}

export const UNASSIGNED_WORKSPACE_ID = "__global_unassigned__";

export function normalizeEngineType(engine: string): EngineType {
  const normalized = engine.trim().toLowerCase();
  if (
    normalized === "claude" ||
    normalized === "gemini" ||
    normalized === "opencode" ||
    normalized === "grok" ||
    normalized === "kimi" ||
    normalized === "pi" ||
    normalized === "omp"
  ) {
    return normalized;
  }
  // Shared sessions surface under catalog engine "shared"; icon falls back to
  // the selected runtime engine when callers pass entry.source instead.
  if (normalized === "shared") {
    return "codex";
  }
  return "codex";
}

export function resolveCatalogEntryEngineIcon(
  entry: Pick<WorkspaceSessionCatalogEntry, "engine" | "source" | "threadKind">,
): EngineType {
  if (
    entry.engine.trim().toLowerCase() === "shared" ||
    entry.threadKind === "shared"
  ) {
    const sourceEngine = entry.source?.trim().toLowerCase() ?? "";
    if (
      sourceEngine === "claude" ||
      sourceEngine === "codex" ||
      sourceEngine === "gemini" ||
      sourceEngine === "grok" ||
      sourceEngine === "kimi" ||
      sourceEngine === "opencode" ||
      sourceEngine === "pi" ||
      sourceEngine === "omp"
    ) {
      return sourceEngine;
    }
    return "codex";
  }
  return normalizeEngineType(entry.engine);
}

export function isSharedCatalogEntry(
  entry: Pick<WorkspaceSessionCatalogEntry, "engine" | "threadKind" | "sessionId">,
): boolean {
  return (
    entry.threadKind === "shared" ||
    entry.engine.trim().toLowerCase() === "shared" ||
    entry.sessionId.startsWith("shared:")
  );
}

export function resolveWorkspaceSessionDisplayTitle(
  entry: Pick<WorkspaceSessionCatalogEntry, "title" | "nativeTitle">,
  fallbackTitle: string,
) {
  return selectProjectedSessionDisplayName({
    nextName: entry.title,
    nativeTitle: entry.nativeTitle ?? undefined,
    mappedTitle: undefined,
    customTitle: undefined,
  }) || fallbackTitle;
}

export function formatUpdatedAtDisplay(updatedAt: number, locale: string) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return "--";
  }
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return "--";
  }
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function resolveAttributionReasonLabel(
  entry: WorkspaceSessionCatalogEntry,
  t: TFunction,
) {
  if (entry.attributionReason === "shared-worktree-family") {
    return t("settings.sessionManagementAttributionReasonWorktreeFamily");
  }
  if (entry.attributionReason === "shared-git-root") {
    return t("settings.sessionManagementAttributionReasonGitRoot");
  }
  if (entry.attributionReason === "parent-scope") {
    return t("settings.sessionManagementAttributionReasonParentScope");
  }
  return null;
}

export function resolveAttributionConfidenceLabel(
  entry: WorkspaceSessionCatalogEntry,
  t: TFunction,
) {
  if (entry.attributionConfidence === "high") {
    return t("settings.sessionManagementAttributionConfidenceHigh");
  }
  if (entry.attributionConfidence === "medium") {
    return t("settings.sessionManagementAttributionConfidenceMedium");
  }
  return null;
}
