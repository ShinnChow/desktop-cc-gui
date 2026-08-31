import type {
  ProjectMapFileRelation,
  ProjectMapRelationshipReadResponse,
  ProjectMapScannedFile,
  ProjectMapStorageLocation,
} from "../../project-map/types";
import type { CanvasEvidenceRef } from "../types";
import { readProjectMapRelationships } from "../../project-map/services/projectMapPersistence";
import {
  getProjectMapRelationshipCallCandidate,
  normalizeProjectMapRelationshipDashboardData,
  normalizeProjectMapRelationshipReadSummary,
} from "../../project-map/utils/relationshipDashboardModel";

export type ProjectMapRelationshipImportDirection =
  | "callers"
  | "callees"
  | "both"
  | "neighborhood";

export type ProjectMapRelationshipSnapshotMetadata = {
  scanRunId: string;
  generatedAt: string;
};

export type ProjectMapRelationshipNodeSnapshot = {
  id: string;
  path: string;
  basename: string;
  depth: number;
  reachable: boolean;
  role?: ProjectMapScannedFile["role"];
  layer?: ProjectMapScannedFile["layer"];
  parseStatus?: ProjectMapScannedFile["parseStatus"];
};

export type ProjectMapRelationshipEdgeSnapshot = {
  relation: ProjectMapFileRelation;
  evidenceIds: string[];
  evidenceRefs: CanvasEvidenceRef[];
  evidenceSummary: string[];
};

export type ProjectMapRelationshipImportSourceState = {
  exists: boolean;
  scan: ProjectMapRelationshipSnapshotMetadata | null;
  fileNodeIds: Set<string>;
  relationEdgeIds: Set<string>;
};

export type ProjectMapRelationshipNeighborhood = {
  scan: ProjectMapRelationshipSnapshotMetadata;
  centerFileId: string;
  nodes: ProjectMapRelationshipNodeSnapshot[];
  edges: ProjectMapRelationshipEdgeSnapshot[];
  omittedNodeCount: number;
  omittedEdgeCount: number;
};

export type ProjectMapRelationshipEdgeContext = ProjectMapRelationshipEdgeSnapshot & {
  scan: ProjectMapRelationshipSnapshotMetadata;
  sourceNode?: ProjectMapScannedFile;
  targetNode?: ProjectMapScannedFile;
  contextPack: {
    sourceFileId: string;
    targetFileId: string;
    sourceRole?: ProjectMapScannedFile["role"];
    targetRole?: ProjectMapScannedFile["role"];
  };
};

function normalizePathValue(value: string | null | undefined): string {
  return typeof value === "string" ? value.replace(/\\/g, "/") : "";
}

function makeEvidenceId(input: { relationId: string; path: string; line?: number | null; index: number }): string {
  const normalizedPath = normalizePathValue(input.path);
  const line = input.line && input.line > 0 ? `:${input.line}` : "";
  return `${input.relationId}:evidence:${input.index}:${normalizedPath}${line}`;
}

function createEvidenceRef(input: {
  relationId: string;
  path: string;
  line?: number | null;
  excerpt?: string | null;
  index: number;
}): CanvasEvidenceRef {
  const normalizedPath = normalizePathValue(input.path);
  const safeLine = input.line && input.line > 0 ? input.line : null;
  return {
    id: makeEvidenceId({
      relationId: input.relationId,
      path: input.path,
      line: input.line,
      index: input.index,
    }),
    path: normalizedPath || null,
    line: safeLine,
    excerpt: input.excerpt ?? null,
    label: `${normalizedPath}${safeLine ? `:${safeLine}` : ""}`,
  };
}

function asNormalizedEvidenceSummary(relationId: string, entry: {
  path: string;
  line?: number | null;
  excerpt?: string;
}): string {
  const path = normalizePathValue(entry.path);
  const line = entry.line && entry.line > 0 ? `:${entry.line}` : "";
  return `${relationId}:${path}${line}${entry.excerpt ? ` ${entry.excerpt}` : ""}`;
}

async function loadProjectMapRelationshipData(input: {
  workspaceId: string;
  storageLocation?: ProjectMapStorageLocation;
}): Promise<ProjectMapRelationshipReadResponse> {
  return readProjectMapRelationships({
    workspaceId: input.workspaceId,
    storageLocation: input.storageLocation,
  });
}

function buildSnapshotMetadata(response: ProjectMapRelationshipReadResponse): ProjectMapRelationshipSnapshotMetadata {
  const summary = normalizeProjectMapRelationshipReadSummary(response);
  if (!summary) {
    throw new Error("Relationship scan metadata is unavailable.");
  }
  return {
    scanRunId: summary.scanRunId,
    generatedAt: summary.generatedAt,
  };
}

export function createProjectMapRelationshipEdgeSnapshot(relation: ProjectMapFileRelation): ProjectMapRelationshipEdgeSnapshot {
  const evidence = relation.evidence ?? [];
  const evidenceIds = evidence.map((entry, index) => makeEvidenceId({
    relationId: relation.id,
    path: entry.path,
    line: entry.line,
    index,
  }));
  const evidenceRefs = evidence.map((entry, index) => createEvidenceRef({
    relationId: relation.id,
    path: entry.path,
    line: entry.line,
    excerpt: entry.excerpt,
    index,
  }));
  const evidenceSummary = evidence.map((entry) =>
    asNormalizedEvidenceSummary(relation.id, {
      path: entry.path,
      line: entry.line,
      excerpt: entry.excerpt,
    }),
  );
  return { relation, evidenceIds, evidenceRefs, evidenceSummary };
}

export function getProjectMapRelationshipEdgeDisplayLabel(edge: ProjectMapRelationshipEdgeSnapshot): string {
  return getProjectMapRelationshipCallCandidate(edge.relation)
    ?? edge.evidenceSummary.find((summary) => summary.trim().length > 0)
    ?? edge.relation.type;
}

export function isProjectMapRelationshipScanFresh(input: {
  importedScanRunId: string;
  latestScanRunId?: string | null;
}): boolean {
  return Boolean(input.latestScanRunId) && input.importedScanRunId === input.latestScanRunId;
}



export async function loadProjectMapRelationshipImportSourceState(input: {
  workspaceId: string;
  storageLocation?: ProjectMapStorageLocation;
}): Promise<ProjectMapRelationshipImportSourceState> {
  const response = await loadProjectMapRelationshipData(input);
  const summary = normalizeProjectMapRelationshipReadSummary(response);
  if (!summary) {
    return {
      exists: false,
      scan: null,
      fileNodeIds: new Set<string>(),
      relationEdgeIds: new Set<string>(),
    };
  }
  const dashboardData = normalizeProjectMapRelationshipDashboardData(response);
  return {
    exists: true,
    scan: {
      scanRunId: summary.scanRunId,
      generatedAt: summary.generatedAt,
    },
    fileNodeIds: new Set(dashboardData.files.map((file) => file.id)),
    relationEdgeIds: new Set(dashboardData.relations.map((relation) => relation.id)),
  };
}



export async function queryProjectMapRelationshipEdge(input: {
  workspaceId: string;
  edgeId: string;
  storageLocation?: ProjectMapStorageLocation;
}): Promise<ProjectMapRelationshipEdgeContext | null> {
  const response = await loadProjectMapRelationshipData(input);
  const scan = buildSnapshotMetadata(response);
  const dashboardData = normalizeProjectMapRelationshipDashboardData(response);
  const filesById = new Map(dashboardData.files.map((file) => [file.id, file]));
  const relation = dashboardData.relations.find((item) => item.id === input.edgeId) ?? null;
  if (!relation) {
    return null;
  }
  return {
    scan,
    ...createProjectMapRelationshipEdgeSnapshot(relation),
    sourceNode: filesById.get(relation.sourceFileId),
    targetNode: filesById.get(relation.targetFileId),
    contextPack: {
      sourceFileId: relation.sourceFileId,
      targetFileId: relation.targetFileId,
      sourceRole: filesById.get(relation.sourceFileId)?.role,
      targetRole: filesById.get(relation.targetFileId)?.role,
    },
  };
}
