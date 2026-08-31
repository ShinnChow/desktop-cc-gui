import type { ProjectMapAutoIngestionRunContext, ProjectMapDataset, ProjectMapGenerationIntent, ProjectMapGenerationRequest, ProjectMapGenerationScope, ProjectMapNode, ProjectMapPreferredLanguage, ProjectMapRunMetadata, ProjectMapRunOwnership, ProjectMapSource, ProjectMapStorageLocation } from "../types";

import {
  getProjectMapPathBasename,
  inferProjectMapWorkspaceFilePath,
} from "./evidencePaths";

function nowIso(): string {
  return new Date().toISOString();
}

function requestId(prefix: ProjectMapRunMetadata["kind"]): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const SUPPORTED_SOURCE_TYPES = new Set<ProjectMapSource["type"]>([
  "file",
  "symbol",
  "spec",
  "task",
  "document",
  "commit",
  "test",
  "conversation",
]);

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeSourceType(value: unknown): ProjectMapSource["type"] {
  const sourceType = asTrimmedString(value);
  return SUPPORTED_SOURCE_TYPES.has(sourceType as ProjectMapSource["type"])
    ? (sourceType as ProjectMapSource["type"])
    : "file";
}

function inferWorkspaceFilePath(input: {
  label: string;
  path: string;
  ref: string;
}): string {
  return inferProjectMapWorkspaceFilePath(input);
}

function normalizeOptionalLine(value: unknown): number | undefined {
  const line = typeof value === "number" ? value : Number(asTrimmedString(value));
  return Number.isFinite(line) && line > 0 ? Math.floor(line) : undefined;
}

function normalizeProjectMapSource(source: unknown): ProjectMapSource | null {
  const legacyLabel = asTrimmedString(source);
  if (legacyLabel) {
    const inferredPath = inferWorkspaceFilePath({ label: legacyLabel, path: "", ref: "" });
    return {
      type: "symbol",
      label: legacyLabel,
      ...(inferredPath ? { path: inferredPath } : {}),
    };
  }
  if (!isRecord(source)) {
    return null;
  }

  const type = normalizeSourceType(source.type);
  const label = asTrimmedString(source.label);
  const path = asTrimmedString(source.path);
  const hash = "hash" in source ? asTrimmedString(source.hash) : "";
  const ref = "ref" in source ? asTrimmedString(source.ref) : "";
  const excerpt = "excerpt" in source ? asTrimmedString(source.excerpt) : "";
  const inferredPath = inferWorkspaceFilePath({ label, path, ref });
  if (!label && !path && !hash && !ref) {
    return null;
  }
  const normalizedLabel = label || (inferredPath ? getProjectMapPathBasename(inferredPath) : "") || ref || hash || type;
  const line = normalizeOptionalLine(source.line);
  return {
    type,
    label: normalizedLabel,
    ...(inferredPath ? { path: inferredPath } : {}),
    ...(line ? { line } : {}),
    ...(hash ? { hash } : {}),
    ...(excerpt ? { excerpt } : {}),
  };
}

function uniqueSources(sources: ProjectMapSource[]): ProjectMapSource[] {
  const seen = new Set<string>();
  const result: ProjectMapSource[] = [];
  for (const source of sources) {
    const key = `${source.type}:${source.path ?? ""}:${source.line ?? ""}:${source.label}:${source.hash ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(source);
  }
  return result;
}

function inferGenerationIntent(input: {
  kind: ProjectMapRunMetadata["kind"];
  scope: ProjectMapGenerationScope;
  generationIntent?: ProjectMapGenerationIntent;
}): ProjectMapGenerationIntent {
  if (input.generationIntent) {
    return input.generationIntent;
  }
  if (input.kind === "global" || input.scope.kind === "global") {
    return "global";
  }
  if (input.kind === "auto" || input.scope.kind === "auto") {
    return "autoIngestion";
  }
  if (input.scope.kind === "organizer") {
    return "organizeUnassigned";
  }
  return input.scope.kind === "node" ? "completeNode" : "global";
}

function sourceFromRelatedArtifact(
  artifact: unknown,
): ProjectMapSource | null {
  return normalizeProjectMapSource(artifact);
}

function collectNodeScopedSources(input: {
  dataset: ProjectMapDataset;
  node: ProjectMapNode;
  scope: ProjectMapGenerationScope;
}): ProjectMapSource[] {
  const scopedNodeIds = new Set<string>([input.node.id]);
  if (input.scope.kind === "node" && input.scope.includeDescendants) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of input.dataset.nodes) {
        if (candidate.parentId && scopedNodeIds.has(candidate.parentId) && !scopedNodeIds.has(candidate.id)) {
          scopedNodeIds.add(candidate.id);
          changed = true;
        }
      }
    }
  }

  const nodesByPriority = [
    input.node,
    ...input.dataset.nodes.filter((candidate) => candidate.id !== input.node.id && scopedNodeIds.has(candidate.id)),
  ];
  return uniqueSources(
    nodesByPriority
      .flatMap((candidate) => [
        ...candidate.sources.map(normalizeProjectMapSource),
        ...candidate.detail.relatedArtifacts.map(sourceFromRelatedArtifact),
      ])
      .filter((source): source is ProjectMapSource => Boolean(source)),
  ).slice(0, 16);
}

export function createProjectMapGenerationRequest(input: {
  dataset: ProjectMapDataset;
  kind: ProjectMapRunMetadata["kind"];
  engine: string;
  model: string;
  scope: ProjectMapGenerationScope;
  generationIntent?: ProjectMapGenerationIntent;
  preferredLanguage?: ProjectMapPreferredLanguage | null;
  storageLocation: ProjectMapStorageLocation;
  ownership?: ProjectMapRunOwnership;
  writePath: string;
  node?: ProjectMapNode | null;
  readSources?: ProjectMapSource[];
  autoIngestion?: ProjectMapAutoIngestionRunContext;
}): ProjectMapGenerationRequest {
  const generationIntent = inferGenerationIntent(input);
  const derivedReadSources = input.node
    ? collectNodeScopedSources({
        dataset: input.dataset,
        node: input.node,
        scope: input.scope,
      })
    : uniqueSources([
        ...(input.readSources ?? []),
        ...input.dataset.lenses.flatMap((lens) => lens.evidence.map(normalizeProjectMapSource)),
        ...input.dataset.nodes.flatMap((node) => node.sources.map(normalizeProjectMapSource)),
      ].filter((source): source is ProjectMapSource => Boolean(source))).slice(0, 24);

  return {
    id: requestId(input.kind),
    kind: input.kind,
    engine: input.engine,
    model: input.model,
    scope: input.scope,
    generationIntent,
    preferredLanguage: input.preferredLanguage ?? "zh",
    readSources: derivedReadSources,
    storageLocation: input.storageLocation,
    ownership: input.ownership,
    writePath: input.writePath,
    createdAt: nowIso(),
    autoIngestion: input.autoIngestion,
  };
}

export function createRunMetadataFromRequest(
  request: ProjectMapGenerationRequest,
  status: ProjectMapRunMetadata["status"] = "pending",
): ProjectMapRunMetadata {
  return {
    id: request.id,
    kind: request.kind,
    status,
    engine: request.engine,
    model: request.model,
    startedAt: request.createdAt,
    completedAt: status === "pending" || status === "running" ? null : nowIso(),
    scope: request.scope.kind,
    requestScope: request.scope,
    generationIntent: request.generationIntent,
    preferredLanguage: request.preferredLanguage ?? "zh",
    readSources: request.readSources,
    storageLocation: request.storageLocation,
    ownership: request.ownership,
    writePath: request.writePath,
    autoIngestion: request.autoIngestion,
    phase: status === "pending" ? "queued" : undefined,
    progress: status === "pending" ? 5 : undefined,
    threadId: null,
    logs:
      status === "pending"
        ? [
            {
              at: request.createdAt,
              phase: "queued",
              message: "Generation request queued.",
            },
          ]
        : [],
    error: null,
  };
}


