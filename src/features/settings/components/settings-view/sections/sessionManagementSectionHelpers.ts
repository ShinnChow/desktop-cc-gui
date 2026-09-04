import { useTranslation } from "react-i18next";
import type {
  WorkspaceSessionCatalogFilters,
  WorkspaceSessionCatalogMutationResponse,
} from "../hooks/useWorkspaceSessionCatalog";

export type SessionFolderFilter = "__all__" | "__root__" | string;

export const SESSION_FOLDER_FILTER_ALL = "__all__";
export const SESSION_FOLDER_FILTER_ROOT = "__root__";
const OWNER_UNRESOLVED_CODE = "OWNER_WORKSPACE_UNRESOLVED";
const MISSING_MUTATION_RESULT_CODE = "MISSING_MUTATION_RESULT";
const ALREADY_MISSING_CLEANED_CODE = "ALREADY_MISSING_CLEANED";

export function resolveStatusFilterLabel(
  status: WorkspaceSessionCatalogFilters["status"],
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (status === "archived") {
    return t("settings.sessionManagementStatusArchived");
  }
  if (status === "all") {
    return t("settings.sessionManagementStatusAll");
  }
  return t("settings.sessionManagementStatusActive");
}

export function parseVisibleThreadRootCountDraft(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function resolveMutationFailureReason(
  result: WorkspaceSessionCatalogMutationResponse["results"][number],
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (result.code === OWNER_UNRESOLVED_CODE) {
    return t("settings.sessionManagementOwnerUnresolved");
  }
  if (result.code === MISSING_MUTATION_RESULT_CODE) {
    return t("settings.sessionManagementMissingMutationResult");
  }
  if (result.code === ALREADY_MISSING_CLEANED_CODE) {
    return t("settings.sessionManagementMissingSessionCleaned");
  }
  return (
    result.error?.trim() || t("settings.projectSessionDeleteUnknownReason")
  );
}

export function collectSucceededWorkspaceIds(
  results: WorkspaceSessionCatalogMutationResponse["results"],
): string[] {
  return [
    ...new Set(
      results.filter((item) => item.ok).map((item) => item.workspaceId),
    ),
  ];
}

export function collectDeletedThreadIdsByWorkspaceId(
  results: WorkspaceSessionCatalogMutationResponse["results"],
): Map<string, string[]> {
  const threadIdsByWorkspaceId = new Map<string, string[]>();
  results.forEach((item) => {
    if (!item.ok || !item.sessionId.trim()) {
      return;
    }
    const list = threadIdsByWorkspaceId.get(item.workspaceId) ?? [];
    list.push(item.sessionId);
    threadIdsByWorkspaceId.set(item.workspaceId, list);
  });
  return threadIdsByWorkspaceId;
}

export function areWorkspaceSessionCatalogFiltersEqual(
  left: WorkspaceSessionCatalogFilters,
  right: WorkspaceSessionCatalogFilters,
): boolean {
  return (
    left.keyword === right.keyword &&
    left.engine === right.engine &&
    left.status === right.status &&
    (left.folderId ?? null) === (right.folderId ?? null)
  );
}
