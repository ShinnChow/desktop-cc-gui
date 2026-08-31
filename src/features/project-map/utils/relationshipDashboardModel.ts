import type {
  ProjectMapApiCallChain,
  ProjectMapApiConfidence,
  ProjectMapApiContractGraph,
  ProjectMapApiCallChainEdge,
  ProjectMapApiEndpoint,
  ProjectMapApiEvidence,
  ProjectMapApiGroup,
  ProjectMapApiGroupLevel,
  ProjectMapApiParameter,
  ProjectMapApiParameterLocation,
  ProjectMapApiParserSource,
  ProjectMapApiProtocol,
  ProjectMapApiRequestBody,
  ProjectMapApiResponse,
  ProjectMapApiSchemaRef,
  ProjectMapFileRelation,
  ProjectMapRelationshipAgentReadPlan,
  ProjectMapRelationshipHotspot,
  ProjectMapRelationshipImpactSummary,
  ProjectMapRelationshipModuleSummary,
  ProjectMapRelationshipReadResponse,
  ProjectMapRelationshipRepairIssue,
  ProjectMapRelationshipScanResponse,
  ProjectMapRelationshipStaleReason,
  ProjectMapRelationshipStaleSummary,
  ProjectMapRelationshipSymbol,
  ProjectMapScannedFile,
} from "../types";

export type ProjectMapRelationshipDashboardData = {
  files: ProjectMapScannedFile[];
  relations: ProjectMapFileRelation[];
  symbols: ProjectMapRelationshipSymbol[];
  modules: ProjectMapRelationshipModuleSummary[];
  hotspots: ProjectMapRelationshipHotspot[];
  impactSummary: ProjectMapRelationshipImpactSummary | null;
  contextPack: ProjectMapRelationshipAgentReadPlan | null;
  apiContracts: ProjectMapApiContractGraph | null;
  staleSummary: ProjectMapRelationshipStaleSummary | null;
  repairIssues: ProjectMapRelationshipRepairIssue[];
  readErrors: Array<{ path: string; message: string }>;
};

const PROJECT_MAP_RELATIONSHIP_ROLE_PRIORITY: Record<string, number> = {
  controller: 10,
  route: 15,
  service: 20,
  repository: 30,
  entity: 35,
  component: 40,
  hook: 45,
  command: 50,
  module: 55,
  type: 60,
  test: 70,
  manifest: 80,
  config: 90,
  document: 100,
  infra: 110,
  migration: 120,
  style: 130,
  unknown: 140,
};

const PROJECT_MAP_RELATIONSHIP_TYPE_PRIORITY: Record<string, number> = {
  imports: 10,
  calls: 15,
  bridges_to: 20,
  tested_by: 30,
  specified_by: 40,
  documents: 50,
  configures: 60,
  styled_by: 70,
  contains: 80,
  exports: 90,
  related: 100,
};

export function normalizeProjectMapRelationshipError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown relationship scan failure.";
}

function isProjectMapRelationshipRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readProjectMapRelationshipString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field : null;
}

function readProjectMapRelationshipNumber(
  value: Record<string, unknown>,
  key: string,
): number {
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : 0;
}

export function normalizeProjectMapRelationshipReadSummary(
  response: ProjectMapRelationshipReadResponse,
): ProjectMapRelationshipScanResponse | null {
  const manifest = response.manifest;
  if (!response.exists || !isProjectMapRelationshipRecord(manifest)) {
    return null;
  }
  const scanRunId = readProjectMapRelationshipString(manifest, "scanRunId");
  const generatedAt = readProjectMapRelationshipString(manifest, "generatedAt");
  if (!scanRunId || !generatedAt) {
    return null;
  }

  return {
    storageKey:
      readProjectMapRelationshipString(manifest, "storageKey") ?? response.storageKey,
    storageDir: response.storageDir,
    scanRunId,
    generatedAt,
    scannedRoot: readProjectMapRelationshipString(manifest, "scannedRoot") ?? "",
    fileCount: readProjectMapRelationshipNumber(manifest, "fileCount"),
    relationCount: readProjectMapRelationshipNumber(manifest, "relationCount"),
    ignoredCount: readProjectMapRelationshipNumber(manifest, "ignoredCount"),
    repairIssueCount: readProjectMapRelationshipNumber(manifest, "repairIssueCount"),
  };
}

function readProjectMapRelationshipStringArray(
  value: Record<string, unknown>,
  key: string,
): string[] {
  const field = value[key];
  if (!Array.isArray(field)) {
    return [];
  }
  return field.filter((item): item is string => typeof item === "string");
}

const PROJECT_MAP_API_SECRET_VALUE_PATTERN =
  /(authorization|cookie|token|password|passwd|secret|api[-_ ]?key|private[-_ ]?key|credential)(\s*[:=]\s*)(["']?)[^\s"',;}]+/gi;

export function redactProjectMapApiEvidenceText(value: string): string {
  return value.replace(
    PROJECT_MAP_API_SECRET_VALUE_PATTERN,
    (_match, key: string, separator: string, quote: string) => `${key}${separator}${quote}[REDACTED]`,
  );
}

function normalizeProjectMapRelationshipConfidence(
  value: unknown,
): ProjectMapFileRelation["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function normalizeProjectMapRelationshipType(value: unknown): ProjectMapFileRelation["type"] {
  const normalized = typeof value === "string" ? value : "related";
  switch (normalized) {
    case "imports":
    case "exports":
    case "calls":
    case "contains":
    case "tested_by":
    case "styled_by":
    case "specified_by":
    case "documents":
    case "configures":
    case "bridges_to":
    case "related":
      return normalized;
    default:
      return "related";
  }
}

function normalizeProjectMapScannedFiles(value: unknown): ProjectMapScannedFile[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const id = readProjectMapRelationshipString(item, "id");
    const path = readProjectMapRelationshipString(item, "path");
    if (!id || !path) {
      return [];
    }
    return [{
      id,
      path,
      basename: readProjectMapRelationshipString(item, "basename") ?? path.split("/").pop() ?? path,
      extension: readProjectMapRelationshipString(item, "extension") ?? "",
      language: (readProjectMapRelationshipString(item, "language") ?? "unknown") as ProjectMapScannedFile["language"],
      layer: (readProjectMapRelationshipString(item, "layer") ?? "unknown") as ProjectMapScannedFile["layer"],
      role: (readProjectMapRelationshipString(item, "role") ?? "unknown") as ProjectMapScannedFile["role"],
      sizeBytes: readProjectMapRelationshipNumber(item, "sizeBytes"),
      lineCount: readProjectMapRelationshipNumber(item, "lineCount"),
      contentHash: readProjectMapRelationshipString(item, "contentHash") ?? "",
      parseStatus: (readProjectMapRelationshipString(item, "parseStatus") ?? "skipped") as ProjectMapScannedFile["parseStatus"],
    }];
  });
}

function normalizeProjectMapFileRelations(value: unknown): ProjectMapFileRelation[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const id = readProjectMapRelationshipString(item, "id");
    const sourceFileId = readProjectMapRelationshipString(item, "sourceFileId");
    const targetFileId = readProjectMapRelationshipString(item, "targetFileId");
    if (!id || !sourceFileId || !targetFileId) {
      return [];
    }
    const relationType = item.type ?? item.relationType;
    const evidence = Array.isArray(item.evidence)
      ? item.evidence.flatMap((entry) => {
          if (!isProjectMapRelationshipRecord(entry)) {
            return [];
          }
          const path = readProjectMapRelationshipString(entry, "path");
          if (!path) {
            return [];
          }
          return [{
            path,
            line: readProjectMapRelationshipNumber(entry, "line") || undefined,
            excerpt: readProjectMapRelationshipString(entry, "excerpt") ?? undefined,
            extractorVersion:
              readProjectMapRelationshipString(entry, "extractorVersion") ?? undefined,
            observedAt: readProjectMapRelationshipString(entry, "observedAt") ?? undefined,
          }];
        })
      : [];

    return [{
      id,
      sourceFileId,
      targetFileId,
      type: normalizeProjectMapRelationshipType(relationType),
      direction: "forward",
      confidence: normalizeProjectMapRelationshipConfidence(item.confidence),
      sourceKind: "deterministic",
      evidence,
      fingerprint: readProjectMapRelationshipString(item, "fingerprint") ?? undefined,
    }];
  });
}

function normalizeProjectMapRelationshipSymbols(value: unknown): ProjectMapRelationshipSymbol[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const id = readProjectMapRelationshipString(item, "id");
    const fileId = readProjectMapRelationshipString(item, "fileId");
    const name = readProjectMapRelationshipString(item, "name");
    const line = readProjectMapRelationshipNumber(item, "line");
    if (!id || !fileId || !name || line < 1) {
      return [];
    }
    return [{
      id,
      fileId,
      name,
      kind: readProjectMapRelationshipString(item, "kind") ?? "symbol",
      language: (readProjectMapRelationshipString(item, "language") ?? "unknown") as ProjectMapRelationshipSymbol["language"],
      line,
    }];
  });
}

function normalizeProjectMapRelationshipModules(
  value: unknown,
): ProjectMapRelationshipModuleSummary[] {
  if (!isProjectMapRelationshipRecord(value) || !Array.isArray(value.modules)) {
    return [];
  }
  return value.modules.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const id = readProjectMapRelationshipString(item, "id");
    const label = readProjectMapRelationshipString(item, "label");
    if (!id || !label) {
      return [];
    }
    return [{
      id,
      label,
      fileIds: readProjectMapRelationshipStringArray(item, "fileIds"),
      fileCount: readProjectMapRelationshipNumber(item, "fileCount"),
      relationCount: readProjectMapRelationshipNumber(item, "relationCount"),
    }];
  });
}

function normalizeProjectMapRelationshipHotspotReason(
  value: string,
): ProjectMapRelationshipHotspot["reason"] {
  switch (value) {
    case "many-dependents":
    case "cross-layer-hub":
    case "missing-test":
    case "stale":
    case "large-file":
      return value;
    default:
      return "many-dependents";
  }
}

function normalizeProjectMapRelationshipHotspots(value: unknown): ProjectMapRelationshipHotspot[] {
  if (!isProjectMapRelationshipRecord(value) || !Array.isArray(value.hotspots)) {
    return [];
  }
  return value.hotspots.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const fileId = readProjectMapRelationshipString(item, "fileId");
    const reason = readProjectMapRelationshipString(item, "reason");
    if (!fileId || !reason) {
      return [];
    }
    return [{
      fileId,
      reason: normalizeProjectMapRelationshipHotspotReason(reason),
      score: readProjectMapRelationshipNumber(item, "score"),
      rationale: readProjectMapRelationshipString(item, "rationale") ?? undefined,
    }];
  });
}

function normalizeProjectMapRelationshipRiskFlags(
  value: unknown,
): ProjectMapRelationshipImpactSummary["riskFlags"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const id = readProjectMapRelationshipString(item, "id");
    const label = readProjectMapRelationshipString(item, "label");
    if (!id || !label) {
      return [];
    }
    const severity = readProjectMapRelationshipString(item, "severity");
    return [{
      id,
      label,
      severity: severity === "critical" || severity === "warning" ? severity : "info",
      nodeId: readProjectMapRelationshipString(item, "nodeId")
        ?? readProjectMapRelationshipString(item, "fileId")
        ?? undefined,
    }];
  });
}

function normalizeProjectMapRelationshipImpactSummary(
  value: unknown,
): ProjectMapRelationshipImpactSummary | null {
  if (!isProjectMapRelationshipRecord(value)) {
    return null;
  }
  const generatedAt = readProjectMapRelationshipString(value, "generatedAt");
  if (!generatedAt) {
    return null;
  }
  return {
    schemaVersion: 1,
    generatedAt,
    inputFiles: readProjectMapRelationshipStringArray(value, "inputFiles"),
    changedFiles: readProjectMapRelationshipStringArray(value, "changedFiles"),
    directlyAffectedFiles: readProjectMapRelationshipStringArray(value, "directlyAffectedFiles"),
    transitivelyAffectedFiles: readProjectMapRelationshipStringArray(value, "transitivelyAffectedFiles"),
    unmappedFiles: readProjectMapRelationshipStringArray(value, "unmappedFiles"),
    ignoredFiles: readProjectMapRelationshipStringArray(value, "ignoredFiles"),
    riskFlags: normalizeProjectMapRelationshipRiskFlags(value.riskFlags),
  };
}

function normalizeProjectMapRelationshipContextPack(
  value: unknown,
): ProjectMapRelationshipAgentReadPlan | null {
  if (!isProjectMapRelationshipRecord(value)) {
    return null;
  }
  const generatedAt = readProjectMapRelationshipString(value, "generatedAt");
  const provenance = isProjectMapRelationshipRecord(value.provenance) ? value.provenance : null;
  const scanRunId = provenance
    ? readProjectMapRelationshipString(provenance, "scanRunId")
    : null;
  if (!generatedAt || !scanRunId) {
    return null;
  }
  return {
    schemaVersion: 1,
    generatedAt,
    mustReadFiles: readProjectMapRelationshipStringArray(value, "mustReadFiles"),
    relatedFiles: readProjectMapRelationshipStringArray(value, "relatedFiles"),
    testTargets: readProjectMapRelationshipStringArray(value, "testTargets"),
    contracts: readProjectMapRelationshipStringArray(value, "contracts"),
    riskFlags: normalizeProjectMapRelationshipRiskFlags(value.riskFlags),
    staleReason: readProjectMapRelationshipString(value, "staleReason") ?? undefined,
    staleReasons: normalizeProjectMapRelationshipStaleReasons(value.staleReasons),
    provenance: {
      scanRunId,
      relationIds: provenance ? readProjectMapRelationshipStringArray(provenance, "relationIds") : [],
      fileIds: provenance ? readProjectMapRelationshipStringArray(provenance, "fileIds") : [],
    },
  };
}

function normalizeProjectMapRelationshipStaleReasons(value: unknown): ProjectMapRelationshipStaleReason[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const message = readProjectMapRelationshipString(item, "message");
    if (!message) {
      return [];
    }
    const kind = readProjectMapRelationshipString(item, "kind") ?? "fingerprint-changed";
    const normalizedKind: ProjectMapRelationshipStaleReason["kind"] =
      kind === "git-commit-changed" ||
      kind === "fingerprint-changed" ||
      kind === "unmapped-changed-file" ||
      kind === "file-read-failed" ||
      kind === "scan-scope-warning"
        ? kind
        : "fingerprint-changed";
    return [{
      kind: normalizedKind,
      message,
      path: readProjectMapRelationshipString(item, "path") ?? undefined,
      previous: readProjectMapRelationshipString(item, "previous") ?? undefined,
      current: readProjectMapRelationshipString(item, "current") ?? undefined,
    }];
  });
}

function normalizeProjectMapRelationshipStaleSummary(value: unknown): ProjectMapRelationshipStaleSummary | null {
  if (!isProjectMapRelationshipRecord(value)) {
    return null;
  }
  const generatedAt = readProjectMapRelationshipString(value, "generatedAt");
  if (!generatedAt || typeof value.isFresh !== "boolean") {
    return null;
  }
  const suggestedMode = isProjectMapRelationshipRecord(value.refreshSuggestion)
    ? readProjectMapRelationshipString(value.refreshSuggestion, "mode")
    : undefined;
  const refreshMode: NonNullable<ProjectMapRelationshipStaleSummary["refreshSuggestion"]>["mode"] =
    suggestedMode === "partial" || suggestedMode === "ignore-only" ? suggestedMode : "full";
  const refreshSuggestion = isProjectMapRelationshipRecord(value.refreshSuggestion)
    ? {
        mode: refreshMode,
        changedFiles: readProjectMapRelationshipStringArray(value.refreshSuggestion, "changedFiles"),
        reason: readProjectMapRelationshipString(value.refreshSuggestion, "reason") ?? "",
      }
    : null;
  return {
    schemaVersion: 1,
    generatedAt,
    isFresh: value.isFresh,
    reasons: normalizeProjectMapRelationshipStaleReasons(value.reasons),
    staleFileCount: readProjectMapRelationshipNumber(value, "staleFileCount"),
    changedFiles: readProjectMapRelationshipStringArray(value, "changedFiles"),
    refreshSuggestion,
  };
}

function normalizeProjectMapApiProtocol(value: unknown): ProjectMapApiProtocol {
  switch (value) {
    case "http":
    case "grpc":
    case "graphql":
    case "rpc":
    case "c-abi":
      return value;
    default:
      return "unknown";
  }
}

function normalizeProjectMapApiConfidence(value: unknown): ProjectMapApiConfidence {
  switch (value) {
    case "spec":
    case "high":
    case "medium":
    case "low":
      return value;
    default:
      return "low";
  }
}

function normalizeProjectMapApiParserSource(value: unknown): ProjectMapApiParserSource {
  switch (value) {
    case "schema-parser":
    case "compiler-api":
    case "syntax-tree-parser":
    case "descriptor":
    case "fallback-pattern":
      return value;
    default:
      return "unknown";
  }
}

function normalizeProjectMapApiParameterLocation(value: unknown): ProjectMapApiParameterLocation {
  switch (value) {
    case "path":
    case "query":
    case "header":
    case "cookie":
    case "body":
      return value;
    default:
      return "query";
  }
}

function normalizeProjectMapApiGroupLevel(value: unknown): ProjectMapApiGroupLevel {
  switch (value) {
    case "protocol":
    case "module":
    case "namespace":
    case "controller":
    case "endpoint":
      return value;
    default:
      return "module";
  }
}

function normalizeProjectMapApiEvidence(value: unknown): ProjectMapApiEvidence[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const path = readProjectMapRelationshipString(item, "path");
    if (!path) {
      return [];
    }
    const excerpt = readProjectMapRelationshipString(item, "excerpt");
    const redactedExcerpt = excerpt ? redactProjectMapApiEvidenceText(excerpt) : undefined;
    const wasRedacted = typeof item.redacted === "boolean" ? item.redacted : false;
    return [{
      path,
      line: readProjectMapRelationshipNumber(item, "line") || undefined,
      excerpt: redactedExcerpt,
      parserSource: normalizeProjectMapApiParserSource(item.parserSource),
      extractorVersion: readProjectMapRelationshipString(item, "extractorVersion") ?? undefined,
      observedAt: readProjectMapRelationshipString(item, "observedAt") ?? undefined,
      redacted: wasRedacted || (excerpt ? redactedExcerpt !== excerpt : false) || undefined,
    }];
  });
}

function normalizeProjectMapApiSchemaRef(value: unknown): ProjectMapApiSchemaRef | undefined {
  if (!isProjectMapRelationshipRecord(value)) {
    return undefined;
  }
  const id = readProjectMapRelationshipString(value, "id");
  const name = readProjectMapRelationshipString(value, "name");
  if (!id || !name) {
    return undefined;
  }
  return {
    id,
    name,
    language: (readProjectMapRelationshipString(value, "language") ?? undefined) as ProjectMapApiSchemaRef["language"],
    sourceFile: readProjectMapRelationshipString(value, "sourceFile") ?? undefined,
    evidence: normalizeProjectMapApiEvidence(value.evidence),
  };
}

function normalizeProjectMapApiParameters(value: unknown): ProjectMapApiParameter[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const name = readProjectMapRelationshipString(item, "name");
    if (!name) {
      return [];
    }
    const example = readProjectMapRelationshipString(item, "example");
    return [{
      name,
      location: normalizeProjectMapApiParameterLocation(item.location),
      required: typeof item.required === "boolean" ? item.required : undefined,
      schema: normalizeProjectMapApiSchemaRef(item.schema),
      description: readProjectMapRelationshipString(item, "description") ?? undefined,
      defaultValue: readProjectMapRelationshipString(item, "defaultValue") ?? undefined,
      example: example ? redactProjectMapApiEvidenceText(example) : undefined,
      structuredFields: normalizeProjectMapApiStructuredSchemaFields(item.structuredFields),
      evidence: normalizeProjectMapApiEvidence(item.evidence),
    }];
  });
}

function normalizeProjectMapApiRequestBody(value: unknown): ProjectMapApiRequestBody | undefined {
  if (!isProjectMapRelationshipRecord(value)) {
    return undefined;
  }
  return {
    contentType: readProjectMapRelationshipString(value, "contentType") ?? undefined,
    required: typeof value.required === "boolean" ? value.required : undefined,
    schema: normalizeProjectMapApiSchemaRef(value.schema),
    structuredFields: normalizeProjectMapApiStructuredSchemaFields(value.structuredFields),
    examples: readProjectMapRelationshipStringArray(value, "examples")
      .map(redactProjectMapApiEvidenceText),
    evidence: normalizeProjectMapApiEvidence(value.evidence),
  };
}

function normalizeProjectMapApiResponses(value: unknown): ProjectMapApiResponse[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    return [{
      statusCode: readProjectMapRelationshipString(item, "statusCode") ?? undefined,
      contentType: readProjectMapRelationshipString(item, "contentType") ?? undefined,
      schema: normalizeProjectMapApiSchemaRef(item.schema),
      structuredFields: normalizeProjectMapApiStructuredSchemaFields(item.structuredFields),
      examples: readProjectMapRelationshipStringArray(item, "examples")
        .map(redactProjectMapApiEvidenceText),
      isError: typeof item.isError === "boolean" ? item.isError : undefined,
      evidence: normalizeProjectMapApiEvidence(item.evidence),
    }];
  });
}

function normalizeProjectMapApiCountMap(value: unknown): Record<string, number> | undefined {
  if (!isProjectMapRelationshipRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).flatMap(([key, count]) => {
    if (typeof count !== "number" || !Number.isFinite(count)) {
      return [];
    }
    return [[key, count] as const];
  });
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function normalizeProjectMapApiEndpointIdentityKind(value: unknown): ProjectMapApiEndpoint["identityKind"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (["http", "grpc", "graphql", "c-abi", "generic-rpc", "source-candidate"].includes(value)) {
    return value as ProjectMapApiEndpoint["identityKind"];
  }
  return undefined;
}

function normalizeProjectMapApiDescriptionSourceKind(value: unknown) {
  if (
    value === "doc-comment"
    || value === "swagger-annotation"
    || value === "schema-description"
    || value === "route-name"
    || value === "fallback"
  ) {
    return value;
  }
  return "fallback";
}

function normalizeProjectMapApiStructuredSchemaFields(value: unknown): NonNullable<ProjectMapApiEndpoint["requestBody"]>["structuredFields"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const name = readProjectMapRelationshipString(item, "name");
    if (!name) {
      return [];
    }
    return [{
      name,
      type: readProjectMapRelationshipString(item, "type") ?? undefined,
      required: typeof item.required === "boolean" ? item.required : undefined,
      defaultValue: readProjectMapRelationshipString(item, "defaultValue") ?? undefined,
      description: readProjectMapRelationshipString(item, "description") ?? undefined,
      enumValues: readProjectMapRelationshipStringArray(item, "enumValues"),
      range: readProjectMapRelationshipString(item, "range") ?? undefined,
      example: readProjectMapRelationshipString(item, "example") ?? undefined,
      children: normalizeProjectMapApiStructuredSchemaFields(item.children),
      evidence: normalizeProjectMapApiEvidence(item.evidence),
    }];
  });
}

function normalizeProjectMapApiDescriptionSources(value: unknown): ProjectMapApiEndpoint["descriptionSources"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const text = readProjectMapRelationshipString(item, "text");
    if (!text) {
      return [];
    }
    return [{
      kind: normalizeProjectMapApiDescriptionSourceKind(item.kind),
      text,
      language: readProjectMapRelationshipString(item, "language") ?? undefined,
      evidence: normalizeProjectMapApiEvidence(item.evidence),
    }];
  });
}

function normalizeProjectMapApiCallChainEdgeKind(value: unknown): ProjectMapApiCallChainEdge["kind"] {
  if (
    value === "handler"
    || value === "service"
    || value === "repository"
    || value === "model"
    || value === "outbound-http"
    || value === "rpc"
    || value === "event"
    || value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeProjectMapApiEndpoints(value: unknown): ProjectMapApiEndpoint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const id = readProjectMapRelationshipString(item, "id");
    const sourceFile = readProjectMapRelationshipString(item, "sourceFile");
    if (!id || !sourceFile) {
      return [];
    }
    return [{
      id,
      protocol: normalizeProjectMapApiProtocol(item.protocol),
      language: (readProjectMapRelationshipString(item, "language") ?? "unknown") as ProjectMapApiEndpoint["language"],
      framework: readProjectMapRelationshipString(item, "framework") ?? undefined,
      method: readProjectMapRelationshipString(item, "method") ?? undefined,
      path: readProjectMapRelationshipString(item, "path") ?? undefined,
      operationName: readProjectMapRelationshipString(item, "operationName") ?? undefined,
      handlerSymbol: readProjectMapRelationshipString(item, "handlerSymbol") ?? undefined,
      sourceFile,
      parameters: normalizeProjectMapApiParameters(item.parameters),
      requestBody: normalizeProjectMapApiRequestBody(item.requestBody),
      responses: normalizeProjectMapApiResponses(item.responses),
      requestSchema: normalizeProjectMapApiSchemaRef(item.requestSchema),
      responseSchema: normalizeProjectMapApiSchemaRef(item.responseSchema),
      description: readProjectMapRelationshipString(item, "description") ?? undefined,
      descriptionSources: normalizeProjectMapApiDescriptionSources(item.descriptionSources),
      usageScenario: readProjectMapRelationshipString(item, "usageScenario") ?? undefined,
      groupIds: readProjectMapRelationshipStringArray(item, "groupIds"),
      callChainIds: readProjectMapRelationshipStringArray(item, "callChainIds"),
      callChainUnavailableReason: readProjectMapRelationshipString(item, "callChainUnavailableReason") ?? undefined,
      confidence: normalizeProjectMapApiConfidence(item.confidence),
      evidence: normalizeProjectMapApiEvidence(item.evidence),
      canonicalIdentity: readProjectMapRelationshipString(item, "canonicalIdentity") ?? undefined,
      identityKind: normalizeProjectMapApiEndpointIdentityKind(item.identityKind),
      ambiguousIdentity: typeof item.ambiguousIdentity === "boolean" ? item.ambiguousIdentity : undefined,
    }];
  });
}

function normalizeProjectMapApiGroups(value: unknown): ProjectMapApiGroup[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const id = readProjectMapRelationshipString(item, "id");
    const label = readProjectMapRelationshipString(item, "label");
    if (!id || !label) {
      return [];
    }
    return [{
      id,
      label,
      level: normalizeProjectMapApiGroupLevel(item.level),
      parentId: readProjectMapRelationshipString(item, "parentId") ?? undefined,
      endpointIds: readProjectMapRelationshipStringArray(item, "endpointIds"),
      childGroupIds: readProjectMapRelationshipStringArray(item, "childGroupIds"),
      protocolCounts: normalizeProjectMapApiCountMap(item.protocolCounts),
      languageCounts: normalizeProjectMapApiCountMap(item.languageCounts),
      confidenceCounts: normalizeProjectMapApiCountMap(item.confidenceCounts),
    }];
  });
}

function normalizeProjectMapApiCallChains(value: unknown): ProjectMapApiCallChain[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const id = readProjectMapRelationshipString(item, "id");
    const endpointId = readProjectMapRelationshipString(item, "endpointId");
    if (!id || !endpointId) {
      return [];
    }
    return [{
      id,
      endpointId,
      edges: Array.isArray(item.edges)
        ? item.edges.flatMap((edge) => {
            if (!isProjectMapRelationshipRecord(edge)) {
              return [];
            }
            const edgeId = readProjectMapRelationshipString(edge, "id");
            const sourceSymbol = readProjectMapRelationshipString(edge, "sourceSymbol");
            const targetSymbol = readProjectMapRelationshipString(edge, "targetSymbol");
            const sourceFile = readProjectMapRelationshipString(edge, "sourceFile");
            if (!edgeId || !sourceSymbol || !targetSymbol || !sourceFile) {
              return [];
            }
            return [{
              id: edgeId,
              sourceSymbol,
              targetSymbol,
              sourceFile,
              line: readProjectMapRelationshipNumber(edge, "line") || undefined,
              targetFile: readProjectMapRelationshipString(edge, "targetFile") ?? undefined,
              targetLine: readProjectMapRelationshipNumber(edge, "targetLine") || undefined,
              excerpt: readProjectMapRelationshipString(edge, "excerpt") ?? undefined,
              direction: edge.direction === "backward" ? "backward" : "forward",
              kind: normalizeProjectMapApiCallChainEdgeKind(edge.kind),
              confidence: normalizeProjectMapApiConfidence(edge.confidence),
              evidence: normalizeProjectMapApiEvidence(edge.evidence),
            }];
          })
        : [],
      maxDepth: readProjectMapRelationshipNumber(item, "maxDepth") || 4,
      truncatedReason: readProjectMapRelationshipString(item, "truncatedReason") ?? undefined,
    }];
  });
}

function normalizeProjectMapApiAdapterParserSource(
  value: unknown,
): NonNullable<ProjectMapApiContractGraph["adapters"]>[number]["parserSource"] {
  if (
    value === "schema-parser"
    || value === "compiler-api"
    || value === "syntax-tree-parser"
    || value === "descriptor"
    || value === "fallback-pattern"
  ) {
    return value;
  }
  return "fallback-pattern";
}

function normalizeProjectMapApiAdapterStatus(
  value: unknown,
): NonNullable<ProjectMapApiContractGraph["adapters"]>[number]["status"] {
  if (value === "active" || value === "no-candidate" || value === "not-present" || value === "unsupported") {
    return value;
  }
  return "unsupported";
}

function normalizeProjectMapApiAdapters(value: unknown): NonNullable<ProjectMapApiContractGraph["adapters"]> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const language = readProjectMapRelationshipString(item, "language") ?? "unknown";
    return [{
      language: language as NonNullable<ProjectMapApiContractGraph["adapters"]>[number]["language"],
      parserSource: normalizeProjectMapApiAdapterParserSource(item.parserSource),
      frameworks: readProjectMapRelationshipStringArray(item, "frameworks"),
      status: normalizeProjectMapApiAdapterStatus(item.status),
      fileCount: readProjectMapRelationshipNumber(item, "fileCount"),
      endpointCount: readProjectMapRelationshipNumber(item, "endpointCount"),
      noCandidateCount: readProjectMapRelationshipNumber(item, "noCandidateCount"),
      unsupportedCount: readProjectMapRelationshipNumber(item, "unsupportedCount"),
    }];
  });
}

function normalizeProjectMapApiContractGraph(value: unknown): ProjectMapApiContractGraph | null {
  if (!isProjectMapRelationshipRecord(value)) {
    return null;
  }
  const generatedAt = readProjectMapRelationshipString(value, "generatedAt");
  if (!generatedAt) {
    return null;
  }
  return {
    schemaVersion: 1,
    generatedAt,
    storageKey: readProjectMapRelationshipString(value, "storageKey") ?? undefined,
    scanRunId: readProjectMapRelationshipString(value, "scanRunId") ?? undefined,
    workspaceFingerprint: readProjectMapRelationshipString(value, "workspaceFingerprint") ?? undefined,
    endpoints: normalizeProjectMapApiEndpoints(value.endpoints),
    groups: normalizeProjectMapApiGroups(value.groups),
    schemas: Array.isArray(value.schemas)
      ? value.schemas.flatMap((item) => normalizeProjectMapApiSchemaRef(item) ?? [])
      : [],
    callChains: normalizeProjectMapApiCallChains(value.callChains),
    adapters: normalizeProjectMapApiAdapters(value.adapters),
    stale: value.stale,
    repair: value.repair,
    skipped: Array.isArray(value.skipped)
      ? value.skipped.flatMap((item) => {
          if (!isProjectMapRelationshipRecord(item)) {
            return [];
          }
          const reason = readProjectMapRelationshipString(item, "reason");
          if (!reason) {
            return [];
          }
          return [{ reason, count: readProjectMapRelationshipNumber(item, "count") }];
        })
      : undefined,
  };
}

function normalizeProjectMapRelationshipRepairIssues(
  value: unknown,
): ProjectMapRelationshipRepairIssue[] {
  if (!isProjectMapRelationshipRecord(value) || !Array.isArray(value.issues)) {
    return [];
  }
  return value.issues.flatMap((item) => {
    if (!isProjectMapRelationshipRecord(item)) {
      return [];
    }
    const id = readProjectMapRelationshipString(item, "id");
    const message = readProjectMapRelationshipString(item, "message");
    if (!id || !message) {
      return [];
    }
    return [{
      id,
      kind: (readProjectMapRelationshipString(item, "kind") ?? "unresolved-target") as ProjectMapRelationshipRepairIssue["kind"],
      severity: (readProjectMapRelationshipString(item, "severity") ?? "warning") as ProjectMapRelationshipRepairIssue["severity"],
      message,
      fileId: readProjectMapRelationshipString(item, "fileId") ?? undefined,
      relationId: readProjectMapRelationshipString(item, "relationId") ?? undefined,
      path: readProjectMapRelationshipString(item, "path") ?? undefined,
      action: (readProjectMapRelationshipString(item, "action") ?? "ignored") as ProjectMapRelationshipRepairIssue["action"],
    }];
  });
}

export function normalizeProjectMapRelationshipDashboardData(
  response: ProjectMapRelationshipReadResponse,
): ProjectMapRelationshipDashboardData {
  return {
    files: normalizeProjectMapScannedFiles(response.files),
    relations: normalizeProjectMapFileRelations(response.relations),
    symbols: normalizeProjectMapRelationshipSymbols(response.symbols),
    modules: normalizeProjectMapRelationshipModules(response.modules),
    hotspots: normalizeProjectMapRelationshipHotspots(response.modules),
    impactSummary: normalizeProjectMapRelationshipImpactSummary(response.impact),
    contextPack: normalizeProjectMapRelationshipContextPack(response.contextPack),
    apiContracts: normalizeProjectMapApiContractGraph(response.apiContracts),
    staleSummary: normalizeProjectMapRelationshipStaleSummary(response.stale),
    repairIssues: normalizeProjectMapRelationshipRepairIssues(response.repair),
    readErrors: response.readErrors ?? [],
  };
}

export function getProjectMapRelationshipRoleRank(role: string): number {
  return PROJECT_MAP_RELATIONSHIP_ROLE_PRIORITY[role] ?? 150;
}

export function getProjectMapRelationshipTypeRank(type: string): number {
  return PROJECT_MAP_RELATIONSHIP_TYPE_PRIORITY[type] ?? 120;
}

export function getProjectMapRelationshipConfidenceRank(confidence: ProjectMapFileRelation["confidence"]): number {
  switch (confidence) {
    case "high":
      return 10;
    case "medium":
      return 20;
    default:
      return 30;
  }
}

export function isProjectMapRelationshipNoiseFile(file: ProjectMapScannedFile): boolean {
  const path = file.path.toLowerCase();
  if (
    path.startsWith(".agents/")
    || path.startsWith(".codex/")
    || path.startsWith(".claude/")
  ) {
    return true;
  }
  if (
    path.startsWith(".trellis/")
    || path.startsWith("openspec/")
    || path.startsWith("docs/")
  ) {
    return file.parseStatus === "skipped" || file.role === "unknown";
  }
  return file.parseStatus === "skipped"
    || file.role === "document"
    || file.role === "infra"
    || file.role === "style"
    || file.role === "unknown";
}



export function getProjectMapRelationshipCallCandidate(relation: ProjectMapFileRelation): string | null {
  if (relation.type !== "calls") {
    return null;
  }
  const excerpt = relation.evidence[0]?.excerpt?.trim();
  if (!excerpt) {
    return null;
  }
  const match = /^calls\s+(.+)$/i.exec(excerpt);
  return match?.[1]?.trim() || excerpt;
}

export function getProjectMapRelationshipRoleColor(role: string): string {
  switch (role) {
    case "controller":
    case "route":
      return "#62b4ff";
    case "service":
      return "#65d49f";
    case "repository":
    case "entity":
      return "#d4a574";
    case "component":
    case "hook":
      return "#78dce8";
    case "test":
      return "#c6e86d";
    case "manifest":
    case "config":
      return "#f2c66d";
    case "document":
      return "#b9a5ff";
    case "style":
      return "#e08bb0";
    case "infra":
    case "migration":
      return "#9aa6b8";
    default:
      return "#8ea0b8";
  }
}
