import type { TFunction } from "i18next";

import type { ProjectMapNode, ProjectMapNodeKind, ProjectMapRunMetadata } from "../types";

export const PROJECT_MAP_ACTIVE_RUN_STATUSES = new Set<ProjectMapRunMetadata["status"]>([
  "pending",
  "running",
]);

export function formatProjectMapDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatProjectMapFallbackLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase()) || value;
}

export function translateProjectMapNodeKind(
  t: TFunction,
  nodeKind: ProjectMapNodeKind | string,
): string {
  return t(`projectMap.nodeKind.${nodeKind}`, {
    defaultValue: formatProjectMapFallbackLabel(String(nodeKind)),
  });
}



export function getProjectMapRunActionLabel(
  t: TFunction,
  run: ProjectMapRunMetadata,
): string {
  const intent =
    run.generationIntent ??
    (run.requestScope?.kind === "node" ? "completeNode" : "global");
  return t(`projectMap.tasks.action.${intent}`, {
    defaultValue: formatProjectMapFallbackLabel(intent),
  });
}

export function getProjectMapRunTargetLabel(
  t: TFunction,
  run: ProjectMapRunMetadata,
  nodeIndex: Map<string, ProjectMapNode>,
): string {
  const scope = run.requestScope;
  if (!scope || scope.kind === "global") {
    return t("projectMap.tasks.targetGlobal");
  }
  if (scope.kind === "organizer") {
    if (run.organizerResult) {
      return t("projectMap.tasks.targetOrganizerResult", {
        candidates: run.organizerResult.candidateCount,
        total: run.organizerResult.unassignedCount,
        skipped: run.organizerResult.skippedCount,
      });
    }
    return t("projectMap.tasks.targetOrganizer", { count: scope.unassignedCount });
  }
  if (scope.kind !== "node") {
    return t("projectMap.tasks.targetUnknown", { target: scope.kind });
  }
  const node = nodeIndex.get(scope.nodeId);
  if (!node) {
    return t("projectMap.tasks.targetDeleted", { nodeId: scope.nodeId });
  }
  return `${node.title} · ${scope.nodeId}`;
}

export function getProjectMapGenerationQueue(
  runs: ProjectMapRunMetadata[],
): ProjectMapRunMetadata[] {
  return runs
    .filter((run) => PROJECT_MAP_ACTIVE_RUN_STATUSES.has(run.status))
    .sort((left, right) => {
      const statusDelta = Number(right.status === "running") - Number(left.status === "running");
      return statusDelta || new Date(left.startedAt).getTime() - new Date(right.startedAt).getTime();
    });
}

export function getProjectMapRecentRuns(runs: ProjectMapRunMetadata[]): ProjectMapRunMetadata[] {
  return runs
    .filter((run) => !PROJECT_MAP_ACTIVE_RUN_STATUSES.has(run.status))
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime());
}
