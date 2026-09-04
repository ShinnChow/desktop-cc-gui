import { invoke } from "@tauri-apps/api/core";
import { normalizeEngineForExecution } from "../../../utils/engineExecutionPolicy";

import type { ProjectMapAutoIngestionSettings, ProjectMapCandidate, ProjectMapDiagramArtifact, ProjectMapDiagramDocument, ProjectMapDataset, ProjectMapEvidenceRecord, ProjectMapGraphIntegrityIssueKind, ProjectMapGraphRepairActionKind, ProjectMapGraphRepairSummary, ProjectMapLens, ProjectMapManifest, ProjectMapMemoryIngestionCursor, ProjectMapNode, ProjectMapNodeDetail, ProjectMapProfile, ProjectMapRelatedArtifact, ProjectMapRelation, ProjectMapRelationshipReadResponse, ProjectMapRelationshipReadSection, ProjectMapRelationshipScanOptions, ProjectMapRelationshipScanResponse, ProjectMapRefreshReasonKind, ProjectMapRefreshSummary, ProjectMapRunMetadata, ProjectMapSource, ProjectMapSourceType, ProjectMapStorageLocation, ProjectMapStaleReason, ProjectMapTourMetadata, ProjectMapTourStep, ProjectMapViewState } from "../types";
import { normalizeProjectMapNodeTopology } from "../utils/incrementalGeneration";
import { deriveProjectMapStorageKey } from "../utils/storageKey";
import {
  getProjectMapPathBasename,
  inferProjectMapWorkspaceFilePath,
  isProjectMapDiagramRelativePath,
  normalizeWorkspaceEvidencePath,
  uniqueProjectMapPathSegment,
} from "../utils/evidencePaths";

export const PROJECT_MAP_SCHEMA_VERSION = 2;
const PROJECT_MAP_WRITE_TIMEOUT_MS = 20_000;

export type ProjectMapReadResponse = {
  storageKey: string;
  storageDir: string;
  exists: boolean;
  manifest?: unknown;
  profile?: unknown;
  lenses?: unknown;
  lensNodes: Record<string, unknown>;
  viewState?: unknown;
  settings?: unknown;
  cursor?: unknown;
  processed?: unknown;
  candidates: Record<string, unknown>;
  evidence: Record<string, unknown>;
  runs: Record<string, unknown>;
  diagrams?: unknown;
  relations?: unknown;
};

export type ProjectMapWriteFile = {
  relativePath: string;
  content: string;
};

export type ProjectMapWriteSnapshotInput = {
  workspaceId: string;
  files: ProjectMapWriteFile[];
  createBackup?: boolean;
  storageLocation?: ProjectMapStorageLocation;
};

export type ProjectMapStorageIdentity = {
  projectName: string;
  workspacePath: string;
  workspaceId?: string | null;
};

async function withProjectMapWriteTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(
        new Error(
          "Project map write did not finish within 20s. Please retry after checking workspace file permissions.",
        ),
      );
    }, PROJECT_MAP_WRITE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId) {
      globalThis.clearTimeout(timeoutId);
    }
  }
}

const DEFAULT_AUTO_INGESTION_SETTINGS: ProjectMapAutoIngestionSettings = {
  enabled: false,
  engine: "codex",
  model: "default",
  newSessionThreshold: 5,
  checkIntervalMinutes: 30,
  applyMode: "createCandidate",
};

const DEFAULT_MEMORY_CURSOR: ProjectMapMemoryIngestionCursor = {
  lastCheckedAt: new Date(0).toISOString(),
  processedMessages: [],
  pendingMessages: [],
};

export function createEmptyProjectMapDataset(input: {
  identity: ProjectMapStorageIdentity;
  storageKey?: string;
  now?: string;
}): ProjectMapDataset {
  const now = input.now ?? new Date().toISOString();
  const storageKey = input.storageKey ?? deriveProjectMapStorageKey(input.identity);

  return {
    manifest: {
      schemaVersion: PROJECT_MAP_SCHEMA_VERSION,
      projectName: input.identity.projectName,
      workspacePath: input.identity.workspacePath,
      storageKey,
      createdAt: now,
      updatedAt: now,
      lastRunId: null,
      sourceRootHash: null,
      lensStats: [],
    },
    profile: {
      primaryLanguage: "unknown",
      languages: ["unknown"],
      shapes: ["unknown"],
      frameworks: [],
      interfaceKinds: ["unknown"],
      buildSystems: [],
    },
    lenses: [],
    nodes: [],
    viewState: {
      layoutPreset: "radial",
      nodeLayouts: {},
      updatedAt: now,
    },
    runs: [],
    candidates: [],
    evidenceRecords: [],
    diagramDocuments: [],
    relations: [],
    tours: { steps: [], updatedAt: now },
    autoIngestionSettings: { ...DEFAULT_AUTO_INGESTION_SETTINGS },
    memoryCursor: {
      lastCheckedAt: DEFAULT_MEMORY_CURSOR.lastCheckedAt,
      processedMessages: [],
      pendingMessages: [],
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const SUPPORTED_SOURCE_TYPES = new Set<ProjectMapSourceType>([
  "file",
  "symbol",
  "spec",
  "task",
  "document",
  "commit",
  "test",
  "conversation",
]);

function normalizeOptionalPositiveLine(value: unknown): number | undefined {
  const line = typeof value === "number" ? value : Number(asTrimmedString(value));
  return Number.isFinite(line) && line > 0 ? Math.floor(line) : undefined;
}

function clampProjectMapInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numericValue = typeof value === "number" ? value : Number(asTrimmedString(value));
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(numericValue)));
}

function normalizeSourceType(value: unknown): ProjectMapSourceType {
  const sourceType = asTrimmedString(value);
  return SUPPORTED_SOURCE_TYPES.has(sourceType as ProjectMapSourceType)
    ? (sourceType as ProjectMapSourceType)
    : "file";
}

function sanitizeStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(asTrimmedString)
    .filter(Boolean)
    .slice(0, limit);
}

function sanitizeProjectMapSource(value: unknown): ProjectMapSource | null {
  const legacyLabel = asTrimmedString(value);
  if (legacyLabel) {
    const path = normalizeWorkspaceEvidencePath(legacyLabel);
    return {
      type: path ? "file" : "symbol",
      label: legacyLabel,
      ...(path ? { path } : {}),
    };
  }
  if (!isRecord(value)) {
    return null;
  }

  const rawLabel = asTrimmedString(value.label);
  const rawPath = asTrimmedString(value.path);
  const rawRef = asTrimmedString(value.ref);
  const hash = asTrimmedString(value.hash);
  const excerpt = asTrimmedString(value.excerpt);
  const path = inferProjectMapWorkspaceFilePath({
    label: rawLabel,
    path: rawPath,
    ref: rawRef,
  });
  const type = normalizeSourceType(value.type);
  const label = rawLabel || (path ? getProjectMapPathBasename(path) : "") || hash || type;
  if (!label && !path && !hash && !excerpt) {
    return null;
  }
  const line = normalizeOptionalPositiveLine(value.line);

  return {
    type,
    label,
    ...(path ? { path } : {}),
    ...(line ? { line } : {}),
    ...(hash ? { hash } : {}),
    ...(excerpt ? { excerpt } : {}),
  };
}

function sanitizeFrameworkConfidence(value: unknown): ProjectMapProfile["frameworks"][number]["confidence"] {
  return value === "high" || value === "medium" || value === "low" || value === "unknown"
    ? value
    : "unknown";
}

function sanitizeFrameworks(value: unknown): ProjectMapProfile["frameworks"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const frameworks: ProjectMapProfile["frameworks"] = [];
  for (const rawFramework of value) {
    const legacyName = asTrimmedString(rawFramework);
    if (legacyName) {
      frameworks.push({ name: legacyName, confidence: "unknown", evidence: [] });
      continue;
    }
    if (!isRecord(rawFramework)) {
      continue;
    }

    const name = asTrimmedString(rawFramework.name);
    if (!name) {
      continue;
    }
    const evidence = Array.isArray(rawFramework.evidence)
      ? rawFramework.evidence
          .map(sanitizeProjectMapSource)
          .filter((source): source is ProjectMapSource => Boolean(source))
      : [];
    frameworks.push({
      name,
      confidence: sanitizeFrameworkConfidence(rawFramework.confidence),
      evidence,
    });
  }

  return frameworks;
}

function safeArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(guard) : [];
}

function isProjectMapLens(value: unknown): value is ProjectMapLens {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string";
}

function sanitizeProjectMapConfidence(value: unknown): ProjectMapNode["confidence"] {
  return value === "high" || value === "medium" || value === "low" || value === "unknown"
    ? value
    : "unknown";
}

function sanitizeRelatedArtifact(value: unknown): ProjectMapRelatedArtifact | null {
  const legacyLabel = asTrimmedString(value);
  if (legacyLabel) {
    const path = normalizeWorkspaceEvidencePath(legacyLabel);
    return {
      type: path ? "file" : "symbol",
      label: legacyLabel,
      ...(path ? { path } : {}),
    };
  }
  if (!isRecord(value)) {
    return null;
  }
  const rawLabel = asTrimmedString(value.label);
  const rawPath = asTrimmedString(value.path);
  const ref = asTrimmedString(value.ref);
  const path = inferProjectMapWorkspaceFilePath({ label: rawLabel, path: rawPath, ref });
  const type = normalizeSourceType(value.type);
  const label = rawLabel || (path ? getProjectMapPathBasename(path) : "") || ref || type;
  if (!label) {
    return null;
  }
  const line = normalizeOptionalPositiveLine(value.line);
  return {
    type,
    label,
    ...(path ? { path } : {}),
    ...(line ? { line } : {}),
    ...(ref ? { ref } : {}),
  };
}

function sanitizeDiagramArtifact(value: unknown): ProjectMapDiagramArtifact | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asTrimmedString(value.id);
  const label = asTrimmedString(value.label);
  const path = asTrimmedString(value.path);
  if (!id || !label || !path) {
    return null;
  }
  return {
    id,
    label,
    path,
    kind: asTrimmedString(value.kind) || undefined,
    summary: asTrimmedString(value.summary) || undefined,
    sourceRefs: sanitizeStringArray(value.sourceRefs, 12),
  };
}

function sanitizeProjectMapNodeDetail(value: unknown, fallbackSummary: string): ProjectMapNodeDetail {
  const detail = isRecord(value) ? value : {};
  return {
    coreDescription: asTrimmedString(detail.coreDescription) || fallbackSummary,
    keyFacts: sanitizeStringArray(detail.keyFacts, 12),
    keyLogic: sanitizeStringArray(detail.keyLogic, 12),
    riskSignals: sanitizeStringArray(detail.riskSignals, 12),
    diagramArtifacts: Array.isArray(detail.diagramArtifacts)
      ? detail.diagramArtifacts
          .map(sanitizeDiagramArtifact)
          .filter((artifact): artifact is ProjectMapDiagramArtifact => Boolean(artifact))
      : [],
    relatedArtifacts: Array.isArray(detail.relatedArtifacts)
      ? detail.relatedArtifacts
          .map(sanitizeRelatedArtifact)
          .filter((artifact): artifact is ProjectMapRelatedArtifact => Boolean(artifact))
      : [],
  };
}

function sanitizeProjectMapNode(value: unknown): ProjectMapNode | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asTrimmedString(value.id);
  const lensId = asTrimmedString(value.lensId);
  const title = asTrimmedString(value.title);
  if (!id || !lensId || !title) {
    return null;
  }
  const summary = asTrimmedString(value.summary) || title;
  const sources = Array.isArray(value.sources)
    ? value.sources
        .map(sanitizeProjectMapSource)
        .filter((source): source is ProjectMapSource => Boolean(source))
    : [];

  return {
    id,
    lensId,
    nodeKind: asTrimmedString(value.nodeKind) || "concept",
    title,
    summary,
    detail: sanitizeProjectMapNodeDetail(value.detail, summary),
    parentId: asTrimmedString(value.parentId) || undefined,
    children: sanitizeStringArray(value.children, 200),
    sources,
    confidence: sanitizeProjectMapConfidence(value.confidence),
    stale: value.stale === true,
    staleReasons: sanitizeProjectMapStaleReasons(value.staleReasons),
    candidate: value.candidate === true,
    lastGeneratedAt: asTrimmedString(value.lastGeneratedAt) || new Date(0).toISOString(),
    generatedBy: isRecord(value.generatedBy)
      ? {
          engine: asTrimmedString(value.generatedBy.engine) || "unknown",
          model: asTrimmedString(value.generatedBy.model) || "unknown",
          runId: asTrimmedString(value.generatedBy.runId) || "unknown",
        }
      : {
          engine: "unknown",
          model: "unknown",
          runId: "unknown",
        },
  };
}

function sanitizeProjectMapNodesPayload(value: unknown): ProjectMapNode[] {
  const rawItems = isRecord(value) ? value.items : value;
  if (!Array.isArray(rawItems)) {
    return [];
  }
  return rawItems
    .map(sanitizeProjectMapNode)
    .filter((node): node is ProjectMapNode => Boolean(node));
}

function isProjectMapRun(value: unknown): value is ProjectMapRunMetadata {
  return isRecord(value) && typeof value.id === "string" && typeof value.kind === "string";
}

function isProjectMapCandidate(value: unknown): value is ProjectMapCandidate {
  return isRecord(value) && typeof value.id === "string" && isRecord(value.patch);
}

function isProjectMapEvidenceRecord(value: unknown): value is ProjectMapEvidenceRecord {
  return isRecord(value) && typeof value.id === "string" && isRecord(value.source);
}

function sanitizeProjectMapRelation(value: unknown): ProjectMapRelation | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asTrimmedString(value.id);
  const sourceNodeId = asTrimmedString(value.sourceNodeId);
  const targetNodeId = asTrimmedString(value.targetNodeId);
  const type = asTrimmedString(value.type);
  if (!id || !sourceNodeId || !targetNodeId || !type) {
    return null;
  }
  const direction =
    value.direction === "backward" || value.direction === "bidirectional"
      ? value.direction
      : "forward";
  const weight = typeof value.weight === "number" ? value.weight : Number(asTrimmedString(value.weight));
  return {
    id,
    sourceNodeId,
    targetNodeId,
    type,
    direction,
    confidence: sanitizeProjectMapConfidence(value.confidence),
    stale: value.stale === true,
    ...(Number.isFinite(weight) ? { weight } : {}),
    label: asTrimmedString(value.label) || undefined,
    sourceKind: asTrimmedString(value.sourceKind) || "llm-inferred",
    evidence: safeArray(
      Array.isArray(value.evidence) ? value.evidence : [],
      isProjectMapEvidenceRecord,
    ),
    generatedBy: isRecord(value.generatedBy)
      ? {
          engine: asTrimmedString(value.generatedBy.engine) || "unknown",
          model: asTrimmedString(value.generatedBy.model) || "unknown",
          runId: asTrimmedString(value.generatedBy.runId) || "unknown",
        }
      : undefined,
  };
}

function sanitizeProjectMapRelationsPayload(value: unknown, nodeIds: Set<string>): ProjectMapRelation[] {
  const rawItems = isRecord(value) ? value.items : value;
  if (!Array.isArray(rawItems)) {
    return [];
  }
  return rawItems
    .map(sanitizeProjectMapRelation)
    .filter((relation): relation is ProjectMapRelation => Boolean(relation))
    .filter(
      (relation) => nodeIds.has(relation.sourceNodeId) && nodeIds.has(relation.targetNodeId),
    );
}

function sanitizeProjectMapDiagramDocument(value: unknown): ProjectMapDiagramDocument | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asTrimmedString(value.id);
  const nodeId = asTrimmedString(value.nodeId);
  const title = asTrimmedString(value.title);
  const relativePath = asTrimmedString(value.relativePath);
  const path = asTrimmedString(value.path);
  if (!id || !nodeId || !title || !path || !isProjectMapDiagramRelativePath(relativePath)) {
    return null;
  }
  return {
    id,
    nodeId,
    title,
    kind: asTrimmedString(value.kind) || "other",
    summary: asTrimmedString(value.summary),
    sourceRefs: sanitizeStringArray(value.sourceRefs, 12),
    relativePath,
    path,
    content: typeof value.content === "string" ? value.content : "",
    createdAt: asTrimmedString(value.createdAt) || new Date(0).toISOString(),
    updatedAt: asTrimmedString(value.updatedAt) || undefined,
  };
}

function sanitizeProjectMapDiagramDocumentsPayload(value: unknown): ProjectMapDiagramDocument[] {
  const rawItems = isRecord(value) ? value.items : value;
  if (!Array.isArray(rawItems)) {
    return [];
  }
  return rawItems
    .map(sanitizeProjectMapDiagramDocument)
    .filter((diagram): diagram is ProjectMapDiagramDocument => Boolean(diagram));
}

function sanitizeManifest(
  value: unknown,
  identity: ProjectMapStorageIdentity,
  expectedStorageKey: string,
): ProjectMapManifest | null {
  if (!isRecord(value) || typeof value.schemaVersion !== "number") {
    return null;
  }
  if (value.schemaVersion > PROJECT_MAP_SCHEMA_VERSION) {
    return null;
  }
  const persistedStorageKey = typeof value.storageKey === "string" ? value.storageKey.trim() : "";
  if (persistedStorageKey && persistedStorageKey !== expectedStorageKey) {
    return null;
  }

  return {
    schemaVersion: PROJECT_MAP_SCHEMA_VERSION,
    projectName: typeof value.projectName === "string" ? value.projectName : identity.projectName,
    workspacePath:
      typeof value.workspacePath === "string" ? value.workspacePath : identity.workspacePath,
    storageKey: persistedStorageKey || expectedStorageKey,
    createdAt: typeof value.createdAt === "string" ? value.createdAt : new Date().toISOString(),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    lastRunId: typeof value.lastRunId === "string" ? value.lastRunId : null,
    sourceRootHash: typeof value.sourceRootHash === "string" ? value.sourceRootHash : null,
    lensStats: Array.isArray(value.lensStats) ? (value.lensStats as ProjectMapManifest["lensStats"]) : [],
  };
}

function sanitizeProfile(value: unknown): ProjectMapProfile | null {
  if (!isRecord(value)) {
    return null;
  }
  return {
    primaryLanguage:
      typeof value.primaryLanguage === "string"
        ? (value.primaryLanguage as ProjectMapProfile["primaryLanguage"])
        : "unknown",
    languages: isStringArray(value.languages)
      ? (value.languages as ProjectMapProfile["languages"])
      : ["unknown"],
    shapes: isStringArray(value.shapes) ? (value.shapes as ProjectMapProfile["shapes"]) : ["unknown"],
    frameworks: sanitizeFrameworks(value.frameworks),
    interfaceKinds: isStringArray(value.interfaceKinds)
      ? (value.interfaceKinds as ProjectMapProfile["interfaceKinds"])
      : ["unknown"],
    buildSystems: isStringArray(value.buildSystems) ? value.buildSystems : [],
  };
}

function sanitizeSettings(value: unknown): ProjectMapAutoIngestionSettings {
  if (!isRecord(value)) {
    return DEFAULT_AUTO_INGESTION_SETTINGS;
  }
  const engine = normalizeEngineForExecution(value.engine);
  const didNormalizeEngine = engine !== value.engine;
  return {
    enabled: value.enabled === true && !didNormalizeEngine,
    engine,
    model:
      !didNormalizeEngine && typeof value.model === "string"
        ? value.model
        : DEFAULT_AUTO_INGESTION_SETTINGS.model,
    newSessionThreshold: clampProjectMapInteger(
      value.newSessionThreshold,
      1,
      50,
      DEFAULT_AUTO_INGESTION_SETTINGS.newSessionThreshold,
    ),
    checkIntervalMinutes: clampProjectMapInteger(
      value.checkIntervalMinutes,
      5,
      1440,
      DEFAULT_AUTO_INGESTION_SETTINGS.checkIntervalMinutes,
    ),
    applyMode:
      value.applyMode === "autoApplyEvidenceBacked" ? "autoApplyEvidenceBacked" : "createCandidate",
  };
}

function sanitizeCursor(value: unknown): ProjectMapMemoryIngestionCursor {
  if (!isRecord(value)) {
    return DEFAULT_MEMORY_CURSOR;
  }
  const processedMessages = safeArray(value.processedMessages, (item): item is ProjectMapMemoryIngestionCursor["processedMessages"][number] => {
    return isRecord(item) && typeof item.sessionId === "string" && typeof item.messageHash === "string";
  });
  const pendingMessages = safeArray(value.pendingMessages, (item): item is ProjectMapMemoryIngestionCursor["pendingMessages"][number] => {
    return isRecord(item) && typeof item.sessionId === "string" && typeof item.messageHash === "string";
  });
  return {
    lastCheckedAt:
      typeof value.lastCheckedAt === "string" ? value.lastCheckedAt : DEFAULT_MEMORY_CURSOR.lastCheckedAt,
    processedMessages,
    pendingMessages,
    lastRunId: typeof value.lastRunId === "string" ? value.lastRunId : undefined,
  };
}

function sanitizeViewState(value: unknown): ProjectMapViewState | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const layoutPreset =
    value.layoutPreset === "tree" || value.layoutPreset === "force"
      ? value.layoutPreset
      : "radial";
  const rawNodeLayouts = isRecord(value.nodeLayouts) ? value.nodeLayouts : {};
  const nodeLayouts: ProjectMapViewState["nodeLayouts"] = {};

  for (const [nodeId, rawLayout] of Object.entries(rawNodeLayouts)) {
    if (!isRecord(rawLayout)) {
      continue;
    }
    const x = typeof rawLayout.x === "number" ? rawLayout.x : Number(rawLayout.x);
    const y = typeof rawLayout.y === "number" ? rawLayout.y : Number(rawLayout.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    nodeLayouts[nodeId] = {
      x,
      y,
      pinned: rawLayout.pinned === true,
      updatedAt: typeof rawLayout.updatedAt === "string" ? rawLayout.updatedAt : undefined,
    };
  }

  return {
    layoutPreset,
    nodeLayouts,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
  };
}

function sanitizeRefreshClassification(value: unknown): ProjectMapStaleReason["recommendation"] {
  return value === "skip" ||
    value === "partial-refresh" ||
    value === "architecture-refresh" ||
    value === "full-refresh-suggested"
    ? value
    : "partial-refresh";
}

function sanitizeRefreshReasonKind(value: unknown): ProjectMapRefreshReasonKind {
  return value === "ignored" ||
    value === "cosmetic" ||
    value === "source-changed" ||
    value === "spec-changed" ||
    value === "task-changed" ||
    value === "architecture-changed" ||
    value === "fingerprint-matched" ||
    value === "unknown"
    ? value
    : "unknown";
}

function sanitizeGraphIssueKind(value: unknown): ProjectMapGraphIntegrityIssueKind {
  return value === "duplicate-node-id" ||
    value === "missing-parent" ||
    value === "missing-child" ||
    value === "missing-relation-source" ||
    value === "missing-relation-target" ||
    value === "duplicate-relation-id" ||
    value === "missing-node-evidence" ||
    value === "stale-relation"
    ? value
    : "missing-node-evidence";
}

function sanitizeGraphRepairActionKind(value: unknown): ProjectMapGraphRepairActionKind {
  return value === "remove-invalid-relation" ||
    value === "remove-missing-child-reference" ||
    value === "clear-missing-parent" ||
    value === "quarantine-evidence-gap"
    ? value
    : "quarantine-evidence-gap";
}

function sanitizeProjectMapStaleReason(value: unknown): ProjectMapStaleReason | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asTrimmedString(value.id);
  const label = asTrimmedString(value.label);
  if (!id || !label) {
    return null;
  }
  return {
    id,
    kind: sanitizeRefreshReasonKind(value.kind),
    label,
    path: asTrimmedString(value.path) || undefined,
    nodeId: asTrimmedString(value.nodeId) || undefined,
    relationId: asTrimmedString(value.relationId) || undefined,
    observedHash: asTrimmedString(value.observedHash) || null,
    currentHash: asTrimmedString(value.currentHash) || null,
    recommendation: sanitizeRefreshClassification(value.recommendation),
  };
}

function sanitizeProjectMapStaleReasons(value: unknown): ProjectMapStaleReason[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(sanitizeProjectMapStaleReason)
    .filter((reason): reason is ProjectMapStaleReason => Boolean(reason));
}

function sanitizeProjectMapRefreshSummary(value: unknown): ProjectMapRefreshSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const classification = sanitizeRefreshClassification(value.classification);
  return {
    classification,
    label: asTrimmedString(value.label) || classification,
    changedPaths: sanitizeStringArray(value.changedPaths, 500),
    ignoredPaths: Array.isArray(value.ignoredPaths)
      ? value.ignoredPaths.flatMap((item) => {
          if (!isRecord(item)) {
            return [];
          }
          const path = asTrimmedString(item.path);
          const reason = asTrimmedString(item.reason);
          return path && reason ? [{ path, reason }] : [];
        })
      : [],
    staleReasons: sanitizeProjectMapStaleReasons(value.staleReasons),
    evaluatedAt: asTrimmedString(value.evaluatedAt) || new Date(0).toISOString(),
  };
}

function sanitizeProjectMapGraphRepairSummary(value: unknown): ProjectMapGraphRepairSummary | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const rawIssues = Array.isArray(value.issues) ? value.issues : [];
  const rawActions = Array.isArray(value.actions) ? value.actions : [];
  return {
    issues: rawIssues.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const id = asTrimmedString(item.id);
      const label = asTrimmedString(item.label);
      if (!id || !label) {
        return [];
      }
      return [{
        id,
        kind: sanitizeGraphIssueKind(item.kind),
        severity:
          item.severity === "critical" || item.severity === "warning" || item.severity === "info"
            ? item.severity
            : "info",
        label,
        nodeId: asTrimmedString(item.nodeId) || undefined,
        relationId: asTrimmedString(item.relationId) || undefined,
      }];
    }),
    actions: rawActions.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const id = asTrimmedString(item.id);
      const label = asTrimmedString(item.label);
      if (!id || !label) {
        return [];
      }
      return [{
        id,
        kind: sanitizeGraphRepairActionKind(item.kind),
        label,
        nodeId: asTrimmedString(item.nodeId) || undefined,
        relationId: asTrimmedString(item.relationId) || undefined,
      }];
    }),
    repairedAt: asTrimmedString(value.repairedAt) || undefined,
  };
}

function sanitizeProjectMapTourStep(
  value: unknown,
  nodeIds: Set<string>,
): ProjectMapTourStep | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = asTrimmedString(value.id);
  const title = asTrimmedString(value.title);
  const summary = asTrimmedString(value.summary);
  const purpose = asTrimmedString(value.purpose) || "onboarding";
  const stepNodeIds = sanitizeStringArray(value.nodeIds, 12).filter((nodeId) => nodeIds.has(nodeId));
  if (!id || !title || !summary || stepNodeIds.length === 0) {
    return null;
  }
  const priority = typeof value.priority === "number" ? value.priority : Number(asTrimmedString(value.priority));
  return {
    id,
    purpose,
    title,
    summary,
    nodeIds: stepNodeIds,
    ...(Number.isFinite(priority) ? { priority } : {}),
  };
}

function sanitizeProjectMapTourMetadata(
  value: unknown,
  nodeIds: Set<string>,
): ProjectMapTourMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const rawSteps = Array.isArray(value.steps) ? value.steps : [];
  const sanitizedSteps = rawSteps
    .map((step) => sanitizeProjectMapTourStep(step, nodeIds))
    .filter((step): step is ProjectMapTourStep => Boolean(step));
  return {
    steps: sanitizedSteps,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
    generatedBy: isRecord(value.generatedBy)
      ? {
          engine: asTrimmedString(value.generatedBy.engine) || "unknown",
          model: asTrimmedString(value.generatedBy.model) || "unknown",
          runId: asTrimmedString(value.generatedBy.runId) || "unknown",
        }
      : undefined,
  };
}

export function buildDatasetFromProjectMapRead(
  response: ProjectMapReadResponse,
  identity: ProjectMapStorageIdentity,
): ProjectMapDataset | null {
  const expectedStorageKey = response.storageKey || deriveProjectMapStorageKey(identity);
  const manifest = sanitizeManifest(response.manifest, identity, expectedStorageKey);
  const profile = sanitizeProfile(response.profile);
  const lenses = safeArray(
    isRecord(response.lenses) ? response.lenses.items : response.lenses,
    isProjectMapLens,
  );
  const nodes = normalizeProjectMapNodeTopology(
    Object.values(response.lensNodes).flatMap(sanitizeProjectMapNodesPayload),
    { attachOrphansToRoot: true },
  );
  const nodeIds = new Set(nodes.map((node) => node.id));

  if (!manifest || !profile) {
    return null;
  }

  return {
    manifest,
    profile,
    lenses,
    nodes,
    relations: sanitizeProjectMapRelationsPayload(response.relations, nodeIds),
    tours: sanitizeProjectMapTourMetadata(
      isRecord(response.viewState) ? response.viewState.tours : undefined,
      nodeIds,
    ),
    refreshState: sanitizeProjectMapRefreshSummary(
      isRecord(response.viewState) ? response.viewState.refreshState : undefined,
    ),
    graphRepair: sanitizeProjectMapGraphRepairSummary(
      isRecord(response.viewState) ? response.viewState.graphRepair : undefined,
    ),
    viewState: sanitizeViewState(response.viewState),
    runs: Object.values(response.runs).flatMap((value) =>
      safeArray(isRecord(value) ? value.items : [value], isProjectMapRun),
    ),
    candidates: Object.values(response.candidates).flatMap((value) =>
      safeArray(isRecord(value) ? value.items : [value], isProjectMapCandidate),
    ),
    evidenceRecords: Object.values(response.evidence).flatMap((value) =>
      safeArray(isRecord(value) ? value.items : [value], isProjectMapEvidenceRecord),
    ),
    diagramDocuments: sanitizeProjectMapDiagramDocumentsPayload(response.diagrams),
    autoIngestionSettings: sanitizeSettings(response.settings),
    memoryCursor: sanitizeCursor(response.cursor),
  };
}

export function serializeProjectMapDataset(dataset: ProjectMapDataset): ProjectMapWriteFile[] {
  const lensIds = new Set(dataset.lenses.map((lens) => lens.id));
  const usedLensPathSegments = new Set<string>();
  const lensPathSegmentById = new Map(
    [...lensIds].map((lensId, index) => [
      lensId,
      uniqueProjectMapPathSegment(lensId, usedLensPathSegments, `lens-${index + 1}`, "lens"),
    ]),
  );
  const files: ProjectMapWriteFile[] = [
    { relativePath: "manifest.json", content: JSON.stringify(dataset.manifest, null, 2) },
    { relativePath: "profile.json", content: JSON.stringify(dataset.profile, null, 2) },
    { relativePath: "lenses/manifest.json", content: JSON.stringify({ items: dataset.lenses }, null, 2) },
    {
      relativePath: "view-state.json",
      content: JSON.stringify(
        dataset.viewState || dataset.tours
          ? {
              ...(dataset.viewState ?? {}),
              ...(dataset.tours ? { tours: dataset.tours } : {}),
              ...(dataset.refreshState ? { refreshState: dataset.refreshState } : {}),
              ...(dataset.graphRepair ? { graphRepair: dataset.graphRepair } : {}),
            }
          : null,
        null,
        2,
      ),
    },
    { relativePath: "settings.json", content: JSON.stringify(dataset.autoIngestionSettings, null, 2) },
    { relativePath: "memory-ingestion/cursor.json", content: JSON.stringify(dataset.memoryCursor, null, 2) },
    {
      relativePath: "memory-ingestion/processed.json",
      content: JSON.stringify({ items: dataset.memoryCursor.processedMessages }, null, 2),
    },
    { relativePath: "runs/latest.json", content: JSON.stringify({ items: dataset.runs }, null, 2) },
    {
      relativePath: "candidates/latest.json",
      content: JSON.stringify({ items: dataset.candidates ?? [] }, null, 2),
    },
    {
      relativePath: "evidence/latest.json",
      content: JSON.stringify({ items: dataset.evidenceRecords ?? [] }, null, 2),
    },
    {
      relativePath: "diagrams/manifest.json",
      content: JSON.stringify({ items: dataset.diagramDocuments ?? [] }, null, 2),
    },
    {
      relativePath: "relations/latest.json",
      content: JSON.stringify({ items: dataset.relations ?? [] }, null, 2),
    },
  ];

  for (const diagram of dataset.diagramDocuments ?? []) {
    files.push({
      relativePath: diagram.relativePath,
      content: diagram.content,
    });
  }

  for (const lensId of lensIds) {
    const lensPathSegment = lensPathSegmentById.get(lensId) ?? "overview";
    files.push({
      relativePath: `lenses/${lensPathSegment}/nodes.json`,
      content: JSON.stringify(
        { items: dataset.nodes.filter((node) => node.lensId === lensId) },
        null,
        2,
      ),
    });
  }

  return files;
}

export async function readProjectMapDataset(input: {
  workspaceId: string;
  identity: ProjectMapStorageIdentity;
  storageMode?: ProjectMapStorageLocation;
}): Promise<{ dataset: ProjectMapDataset | null; response: ProjectMapReadResponse }> {
  const response = await invoke<ProjectMapReadResponse>("project_map_read", {
    workspaceId: input.workspaceId,
    storageMode: input.storageMode,
  });
  return {
    response,
    dataset: response.exists ? buildDatasetFromProjectMapRead(response, input.identity) : null,
  };
}

export async function writeProjectMapDataset(input: {
  workspaceId: string;
  dataset: ProjectMapDataset;
  createBackup?: boolean;
  storageLocation?: ProjectMapStorageLocation;
  expectedStorageKey?: string;
}): Promise<void> {
  if (
    input.expectedStorageKey &&
    input.dataset.manifest.storageKey !== input.expectedStorageKey
  ) {
    throw new Error(
      `Project map ownership mismatch: expected ${input.expectedStorageKey}, received ${input.dataset.manifest.storageKey}.`,
    );
  }
  await withProjectMapWriteTimeout(
    invoke("project_map_write_snapshot", {
      workspaceId: input.workspaceId,
      files: serializeProjectMapDataset(input.dataset),
      createBackup: input.createBackup ?? false,
      storageMode: input.storageLocation,
    }),
  );
}



export async function scanProjectMapRelationships(input: {
  workspaceId: string;
  options?: ProjectMapRelationshipScanOptions;
  storageLocation?: ProjectMapStorageLocation;
}): Promise<ProjectMapRelationshipScanResponse> {
  return invoke<ProjectMapRelationshipScanResponse>("project_map_relationship_scan", {
    workspaceId: input.workspaceId,
    options: input.options,
    storageMode: input.storageLocation,
  });
}

export async function readProjectMapRelationships(input: {
  workspaceId: string;
  storageLocation?: ProjectMapStorageLocation;
  include?: ProjectMapRelationshipReadSection[];
}): Promise<ProjectMapRelationshipReadResponse> {
  return invoke<ProjectMapRelationshipReadResponse>("project_map_relationship_read", {
    workspaceId: input.workspaceId,
    storageMode: input.storageLocation,
    include: input.include,
  });
}




