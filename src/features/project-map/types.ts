export type ProjectMapLensId = string;

export type ProjectMapLensStatus = "detected" | "candidate" | "notApplicable";

export type ProjectMapLanguage =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "java"
  | "rust"
  | "c"
  | "cpp"
  | "mixed"
  | "unknown";

export type ProjectMapProjectShape =
  | "backend-service"
  | "frontend-app"
  | "desktop-app"
  | "cli"
  | "library"
  | "monorepo"
  | "data-project"
  | "native-app"
  | "unknown";

export type ProjectMapKnownNodeKind =
  | "module"
  | "capability"
  | "api"
  | "interface"
  | "data"
  | "record"
  | "dependency"
  | "quality"
  | "build"
  | "runtime"
  | "tech-stack"
  | "flow"
  | "risk"
  | "timeline"
  | "cross-cutting"
  | "concept";

export type ProjectMapNodeKind = ProjectMapKnownNodeKind | string;

export type ProjectMapConfidence = "high" | "medium" | "low" | "unknown";

export type ProjectMapPreferredLanguage = "zh" | "en";

export type ProjectMapSourceType =
  | "file"
  | "symbol"
  | "spec"
  | "task"
  | "document"
  | "commit"
  | "test"
  | "conversation";

export type ProjectMapEvidencePriority =
  | "code"
  | "spec"
  | "task"
  | "document"
  | "tests"
  | "commit"
  | "memory";

export type ProjectMapGeneratedBy = {
  engine: string;
  model: string;
  runId: string;
};

export type ProjectMapRelatedArtifact = {
  type: ProjectMapSourceType;
  label: string;
  path?: string;
  line?: number;
  ref?: string;
};

export type ProjectMapDiagramArtifact = {
  id: string;
  label: string;
  path: string;
  kind?: "flowchart" | "sequence" | "state" | "class" | "er" | "timeline" | "mindmap" | "other" | string;
  summary?: string;
  sourceRefs?: string[];
};

export type ProjectMapDiagramDocument = {
  id: string;
  nodeId: string;
  title: string;
  kind: NonNullable<ProjectMapDiagramArtifact["kind"]>;
  summary: string;
  sourceRefs: string[];
  relativePath: string;
  path: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
};

export type ProjectMapSource = {
  type: ProjectMapSourceType;
  label: string;
  path?: string;
  line?: number;
  hash?: string;
  excerpt?: string;
};

export type ProjectMapEvidenceRecord = {
  id: string;
  source: ProjectMapSource;
  priority: ProjectMapEvidencePriority;
  observedHash: string | null;
  observedAt: string;
};

export type ProjectMapNodeDetail = {
  coreDescription: string;
  keyFacts: string[];
  keyLogic: string[];
  riskSignals: string[];
  diagramArtifacts?: ProjectMapDiagramArtifact[];
  relatedArtifacts: ProjectMapRelatedArtifact[];
};

export type ProjectMapNode = {
  id: string;
  lensId: ProjectMapLensId;
  nodeKind: ProjectMapNodeKind;
  title: string;
  summary: string;
  detail: ProjectMapNodeDetail;
  parentId?: string;
  children: string[];
  sources: ProjectMapSource[];
  confidence: ProjectMapConfidence;
  stale: boolean;
  staleReasons?: ProjectMapStaleReason[];
  candidate: boolean;
  lastGeneratedAt: string;
  generatedBy: ProjectMapGeneratedBy;
};

export type ProjectMapLensStats = {
  lensId: ProjectMapLensId;
  nodeCount: number;
  staleCount: number;
  candidateCount: number;
};

export type ProjectMapLayoutPreset = "radial" | "tree" | "force";

export type ProjectMapNodeLayout = {
  x: number;
  y: number;
  pinned?: boolean;
  updatedAt?: string;
};

export type ProjectMapViewState = {
  layoutPreset: ProjectMapLayoutPreset;
  nodeLayouts: Record<string, ProjectMapNodeLayout>;
  updatedAt?: string;
};

export type ProjectMapTourPurpose =
  | "onboarding"
  | "architecture-review"
  | "risk-review"
  | "task-planning"
  | string;

export type ProjectMapTourStep = {
  id: string;
  purpose: ProjectMapTourPurpose;
  title: string;
  summary: string;
  nodeIds: string[];
  priority?: number;
};

export type ProjectMapTourMetadata = {
  steps: ProjectMapTourStep[];
  updatedAt?: string;
  generatedBy?: ProjectMapGeneratedBy;
};

export type ProjectMapDetectedFramework = {
  name: string;
  confidence: ProjectMapConfidence;
  evidence: ProjectMapSource[];
};

export type ProjectMapProfile = {
  primaryLanguage: ProjectMapLanguage;
  languages: ProjectMapLanguage[];
  shapes: ProjectMapProjectShape[];
  frameworks: ProjectMapDetectedFramework[];
  interfaceKinds: Array<"http" | "rpc" | "cli" | "library" | "event" | "native" | "unknown">;
  buildSystems: string[];
};

export type ProjectMapLens = {
  id: ProjectMapLensId;
  title: string;
  shortTitle: string;
  description: string;
  status: ProjectMapLensStatus;
  confidence: ProjectMapConfidence;
  evidence: ProjectMapSource[];
};

export type ProjectMapManifest = {
  schemaVersion: number;
  projectName: string;
  workspacePath: string;
  storageKey: string;
  createdAt: string;
  updatedAt: string;
  lastRunId: string | null;
  sourceRootHash: string | null;
  lensStats: ProjectMapLensStats[];
};

export type ProjectMapRunFailureCategory =
  | "output_parse_failed"
  | "ownership_mismatch"
  | "evidence_read_failed"
  | "persistence_failed"
  | "cancelled";

export type ProjectMapRunOwnership = {
  workspaceId: string | null;
  workspacePath: string;
  storageKey: string;
  storageLocation: ProjectMapStorageLocation;
};

export type ProjectMapOrganizerRunResult = {
  unassignedCount: number;
  candidateCount: number;
  skippedCount: number;
  unsafeCount: number;
  skips?: ProjectMapOrganizerRunItem[];
  unsafe?: ProjectMapOrganizerRunItem[];
};

export type ProjectMapOrganizerRunItem = {
  nodeId: string;
  title: string;
  reason: string;
};

export type ProjectMapRunMetadata = {
  id: string;
  kind: "global" | "node" | "auto" | "conversation" | "organizer";
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  phase?:
    | "queued"
    | "preparingSources"
    | "askingAi"
    | "validatingOutput"
    | "writingMap"
    | "completed"
    | "failed"
    | "cancelled";
  progress?: number;
  threadId?: string | null;
  logs?: ProjectMapRunLog[];
  engine: string;
  model: string;
  startedAt: string;
  completedAt: string | null;
  scope: string;
  requestScope?: ProjectMapGenerationScope;
  generationIntent?: ProjectMapGenerationIntent;
  preferredLanguage?: ProjectMapPreferredLanguage;
  readSources?: ProjectMapSource[];
  storageLocation?: ProjectMapStorageLocation;
  ownership?: ProjectMapRunOwnership;
  writePath?: string;
  autoIngestion?: ProjectMapAutoIngestionRunContext;
  organizerResult?: ProjectMapOrganizerRunResult;
  error?: string | null;
  failureCategory?: ProjectMapRunFailureCategory | null;
};

export type ProjectMapRunLog = {
  at: string;
  phase: NonNullable<ProjectMapRunMetadata["phase"]>;
  message: string;
};

export type ProjectMapStorageLocation = "global" | "project";

export type ProjectMapGenerationIntent =
  | "global"
  | "completeNode"
  | "calibrateNode"
  | "autoIngestion"
  | "organizeUnassigned";

export type ProjectMapGenerationScope =
  | { kind: "global"; lensIds: ProjectMapLensId[] }
  | { kind: "node"; nodeId: string; includeDescendants: boolean }
  | { kind: "auto"; messageHashes: string[] }
  | { kind: "conversation"; memoryId: string }
  | { kind: "organizer"; unassignedCount: number };

export type ProjectMapGenerationRequest = {
  id: string;
  kind: ProjectMapRunMetadata["kind"];
  engine: string;
  model: string;
  scope: ProjectMapGenerationScope;
  generationIntent: ProjectMapGenerationIntent;
  preferredLanguage: ProjectMapPreferredLanguage;
  readSources: ProjectMapSource[];
  storageLocation: ProjectMapStorageLocation;
  ownership?: ProjectMapRunOwnership;
  writePath: string;
  createdAt: string;
  autoIngestion?: ProjectMapAutoIngestionRunContext;
};

export type ProjectMapNodePatch = {
  nodeId: string;
  summary?: string;
  detail?: Partial<ProjectMapNodeDetail>;
  sources?: ProjectMapSource[];
  confidence?: ProjectMapConfidence;
  stale?: boolean;
  candidate?: boolean;
};

export type ProjectMapCandidateKind = "contentPatch" | "parentMove";

export type ProjectMapParentMoveCandidate = {
  nodeId: string;
  fromParentId: string;
  suggestedParentId: string;
  confidence: ProjectMapConfidence;
  reason: string;
};

export type ProjectMapCandidate = {
  id: string;
  status: "pending" | "confirmed" | "rejected";
  createdAt: string;
  updatedAt: string;
  source: "global" | "node" | "auto" | "conversation" | "organizer";
  kind?: ProjectMapCandidateKind;
  targetLensId: ProjectMapLensId;
  targetNodeId?: string | null;
  patch: ProjectMapNodePatch;
  move?: ProjectMapParentMoveCandidate;
  evidence: ProjectMapEvidenceRecord[];
};

export type ProjectMapAutoIngestionSettings = {
  enabled: boolean;
  engine: string;
  model: string;
  newSessionThreshold: number;
  checkIntervalMinutes: number;
  applyMode: "autoApplyEvidenceBacked" | "createCandidate";
};

export type ProjectMapProcessedMemoryMessage = {
  sessionId: string;
  messageHash: string;
  processedAt?: string;
  runId?: string;
};

export type ProjectMapAutoIngestionMemoryEvidence = {
  memoryId: string;
  sessionId: string;
  messageHash: string;
  title: string;
  summary: string;
  detail?: string | null;
  cleanText?: string | null;
  rawText?: string | null;
  userInput?: string | null;
  assistantResponse?: string | null;
  workspacePath?: string | null;
  source: string;
  updatedAt: number;
};

export type ProjectMapAutoIngestionRunContext = {
  applyMode: ProjectMapAutoIngestionSettings["applyMode"];
  consumedMessages: ProjectMapProcessedMemoryMessage[];
  memoryEvidence: ProjectMapAutoIngestionMemoryEvidence[];
};

export type ProjectMapMemoryIngestionCursor = {
  lastCheckedAt: string;
  processedMessages: ProjectMapProcessedMemoryMessage[];
  pendingMessages: ProjectMapProcessedMemoryMessage[];
  lastRunId?: string;
};

export type ProjectMapDataset = {
  manifest: ProjectMapManifest;
  profile: ProjectMapProfile;
  lenses: ProjectMapLens[];
  nodes: ProjectMapNode[];
  relations?: ProjectMapRelation[];
  tours?: ProjectMapTourMetadata;
  refreshState?: ProjectMapRefreshSummary;
  graphRepair?: ProjectMapGraphRepairSummary;
  viewState?: ProjectMapViewState;
  runs: ProjectMapRunMetadata[];
  candidates?: ProjectMapCandidate[];
  evidenceRecords?: ProjectMapEvidenceRecord[];
  diagramDocuments?: ProjectMapDiagramDocument[];
  autoIngestionSettings: ProjectMapAutoIngestionSettings;
  memoryCursor: ProjectMapMemoryIngestionCursor;
};

export type ProjectMapRelationType =
  | "contains"
  | "depends_on"
  | "calls"
  | "configures"
  | "documents"
  | "tested_by"
  | "implements"
  | "specified_by"
  | "validated_by"
  | "changed_by"
  | "generated_from"
  | "serves"
  | "triggers"
  | "reads_from"
  | "writes_to"
  | "risk_affects"
  | "evidence_for"
  | "task_candidate_for"
  | "related"
  | string;

export type ProjectMapRelationSourceKind =
  | "deterministic"
  | "spec-link"
  | "task-link"
  | "doc-link"
  | "git-diff"
  | "llm-inferred"
  | "manual"
  | string;

export type ProjectMapRelation = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: ProjectMapRelationType;
  direction: "forward" | "backward" | "bidirectional";
  confidence: ProjectMapConfidence;
  stale?: boolean;
  weight?: number;
  label?: string;
  sourceKind: ProjectMapRelationSourceKind;
  evidence: ProjectMapEvidenceRecord[];
  generatedBy?: ProjectMapGeneratedBy;
};

export type ProjectMapRelationshipLanguage =
  | "typescript"
  | "javascript"
  | "rust"
  | "java"
  | "kotlin"
  | "python"
  | "go"
  | "csharp"
  | "php"
  | "ruby"
  | "c"
  | "cpp"
  | "swift"
  | "dart"
  | "vue"
  | "svelte"
  | "json"
  | "toml"
  | "xml"
  | "yaml"
  | "properties"
  | "gradle"
  | "terraform"
  | "dockerfile"
  | "makefile"
  | "cmake"
  | "sql"
  | "html"
  | "text"
  | "markdown"
  | "css"
  | "shell"
  | "unknown";

export type ProjectMapRelationshipLayer =
  | "frontend"
  | "backend"
  | "spec"
  | "test"
  | "style"
  | "config"
  | "docs"
  | "runtime"
  | "unknown";

export type ProjectMapRelationshipFileRole =
  | "component"
  | "hook"
  | "service"
  | "controller"
  | "repository"
  | "entity"
  | "manifest"
  | "migration"
  | "infra"
  | "route"
  | "type"
  | "test"
  | "style"
  | "command"
  | "module"
  | "spec"
  | "config"
  | "document"
  | "unknown";

export type ProjectMapRelationshipParseStatus = "parsed" | "parse-failed" | "skipped";

export type ProjectMapRelationshipRelationType =
  | "imports"
  | "exports"
  | "calls"
  | "contains"
  | "tested_by"
  | "styled_by"
  | "specified_by"
  | "documents"
  | "configures"
  | "bridges_to"
  | "related";

export type ProjectMapRelationshipSourceKind = "deterministic";



export type ProjectMapRelationshipEvidence = {
  path: string;
  line?: number;
  excerpt?: string;
  extractorVersion?: string;
  observedAt?: string;
};

export type ProjectMapScannedFile = {
  id: string;
  path: string;
  basename: string;
  extension: string;
  language: ProjectMapRelationshipLanguage;
  layer: ProjectMapRelationshipLayer;
  role: ProjectMapRelationshipFileRole;
  sizeBytes: number;
  lineCount: number;
  contentHash: string;
  parseStatus: ProjectMapRelationshipParseStatus;
};

export type ProjectMapRelationshipSymbol = {
  id: string;
  fileId: string;
  name: string;
  kind: string;
  language: ProjectMapRelationshipLanguage;
  line: number;
};

export type ProjectMapFileRelation = {
  id: string;
  sourceFileId: string;
  targetFileId: string;
  type: ProjectMapRelationshipRelationType;
  direction: "forward" | "backward" | "bidirectional";
  confidence: ProjectMapConfidence;
  sourceKind: ProjectMapRelationshipSourceKind;
  evidence: ProjectMapRelationshipEvidence[];
  stale?: boolean;
  fingerprint?: string;
};

export type ProjectMapRelationshipHotspotReason =
  | "many-dependents"
  | "cross-layer-hub"
  | "missing-test"
  | "stale"
  | "large-file";

export type ProjectMapRelationshipDashboardIndex = {
  schemaVersion: 1;
  generatedAt: string;
  byFileId: Record<
    string,
    {
      incoming: string[];
      outgoing: string[];
      tests: string[];
      specs: string[];
      styles: string[];
      bridgeTargets: string[];
    }
  >;
  byType: Record<ProjectMapRelationshipRelationType | string, string[]>;
  hotspots: Array<{
    fileId: string;
    reason: ProjectMapRelationshipHotspotReason;
    score: number;
    rationale?: string;
  }>;
};

export type ProjectMapRelationshipHotspot = ProjectMapRelationshipDashboardIndex["hotspots"][number];

export type ProjectMapRelationshipModuleSummary = {
  id: string;
  label: string;
  fileIds: string[];
  fileCount: number;
  relationCount: number;
};

export type ProjectMapRelationshipRepairIssueKind =
  | "missing-node"
  | "inverted-direction"
  | "duplicate-relation"
  | "parse-failed"
  | "unresolved-target";

export type ProjectMapRelationshipRepairIssue = {
  id: string;
  kind: ProjectMapRelationshipRepairIssueKind;
  severity: "info" | "warning" | "critical";
  message: string;
  fileId?: string;
  relationId?: string;
  path?: string;
  action?: "repaired" | "quarantined" | "ignored";
};



export type ProjectMapRelationshipImpactSummary = {
  schemaVersion: 1;
  generatedAt: string;
  inputFiles: string[];
  changedFiles: string[];
  directlyAffectedFiles: string[];
  transitivelyAffectedFiles: string[];
  unmappedFiles: string[];
  ignoredFiles: string[];
  riskFlags: ProjectMapContextRiskFlag[];
};

export type ProjectMapRelationshipStaleReasonKind =
  | "git-commit-changed"
  | "fingerprint-changed"
  | "unmapped-changed-file"
  | "file-read-failed"
  | "scan-scope-warning";

export type ProjectMapRelationshipRefreshMode = "full" | "partial" | "ignore-only";

export type ProjectMapRelationshipStaleReason = {
  kind: ProjectMapRelationshipStaleReasonKind;
  message: string;
  path?: string;
  previous?: string;
  current?: string;
};

export type ProjectMapRelationshipStaleSummary = {
  schemaVersion: 1;
  generatedAt: string;
  isFresh: boolean;
  reasons: ProjectMapRelationshipStaleReason[];
  staleFileCount: number;
  changedFiles: string[];
  refreshSuggestion?: {
    mode: ProjectMapRelationshipRefreshMode;
    changedFiles: string[];
    reason: string;
  } | null;
};

export type ProjectMapRelationshipAgentReadPlan = {
  schemaVersion: 1;
  generatedAt: string;
  mustReadFiles: string[];
  relatedFiles: string[];
  testTargets: string[];
  contracts: string[];
  riskFlags: ProjectMapContextRiskFlag[];
  provenance: {
    scanRunId: string;
    relationIds: string[];
    fileIds: string[];
  };
  staleReason?: string;
  staleReasons?: ProjectMapRelationshipStaleReason[];
};

export type ProjectMapApiProtocol = "http" | "grpc" | "graphql" | "rpc" | "c-abi" | "unknown";

export type ProjectMapApiConfidence = "spec" | "high" | "medium" | "low";

export type ProjectMapApiParserSource =
  | "schema-parser"
  | "compiler-api"
  | "syntax-tree-parser"
  | "descriptor"
  | "fallback-pattern"
  | "unknown";

export type ProjectMapApiParameterLocation = "path" | "query" | "header" | "cookie" | "body";

export type ProjectMapApiGroupLevel = "protocol" | "module" | "namespace" | "controller" | "endpoint";

export type ProjectMapApiEvidence = {
  path: string;
  line?: number;
  excerpt?: string;
  parserSource: ProjectMapApiParserSource;
  extractorVersion?: string;
  observedAt?: string;
  redacted?: boolean;
};

export type ProjectMapApiSchemaRef = {
  id: string;
  name: string;
  language?: ProjectMapRelationshipLanguage;
  sourceFile?: string;
  evidence?: ProjectMapApiEvidence[];
};

export type ProjectMapApiDescriptionSourceKind =
  | "doc-comment"
  | "swagger-annotation"
  | "schema-description"
  | "route-name"
  | "fallback";

export type ProjectMapApiDescriptionSource = {
  kind: ProjectMapApiDescriptionSourceKind;
  text: string;
  language?: string;
  evidence: ProjectMapApiEvidence[];
};

export type ProjectMapApiStructuredSchemaField = {
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
  description?: string;
  enumValues?: string[];
  range?: string;
  example?: string;
  children?: ProjectMapApiStructuredSchemaField[];
  evidence?: ProjectMapApiEvidence[];
};

export type ProjectMapApiParameter = {
  name: string;
  location: ProjectMapApiParameterLocation;
  required?: boolean;
  schema?: ProjectMapApiSchemaRef;
  description?: string;
  defaultValue?: string;
  example?: string;
  structuredFields?: ProjectMapApiStructuredSchemaField[];
  evidence: ProjectMapApiEvidence[];
};

export type ProjectMapApiRequestBody = {
  contentType?: string;
  required?: boolean;
  schema?: ProjectMapApiSchemaRef;
  structuredFields?: ProjectMapApiStructuredSchemaField[];
  examples?: string[];
  evidence: ProjectMapApiEvidence[];
};

export type ProjectMapApiResponse = {
  statusCode?: string;
  contentType?: string;
  schema?: ProjectMapApiSchemaRef;
  structuredFields?: ProjectMapApiStructuredSchemaField[];
  examples?: string[];
  isError?: boolean;
  evidence: ProjectMapApiEvidence[];
};

export type ProjectMapApiEndpointIdentityKind =
  | "http"
  | "grpc"
  | "graphql"
  | "c-abi"
  | "generic-rpc"
  | "source-candidate";

export type ProjectMapApiEndpoint = {
  id: string;
  protocol: ProjectMapApiProtocol;
  language: ProjectMapRelationshipLanguage | "unknown";
  framework?: string;
  method?: string;
  path?: string;
  operationName?: string;
  handlerSymbol?: string;
  sourceFile: string;
  parameters: ProjectMapApiParameter[];
  requestBody?: ProjectMapApiRequestBody;
  responses: ProjectMapApiResponse[];
  requestSchema?: ProjectMapApiSchemaRef;
  responseSchema?: ProjectMapApiSchemaRef;
  description?: string;
  descriptionSources?: ProjectMapApiDescriptionSource[];
  usageScenario?: string;
  groupIds: string[];
  callChainIds: string[];
  callChainUnavailableReason?: string;
  confidence: ProjectMapApiConfidence;
  evidence: ProjectMapApiEvidence[];
  canonicalIdentity?: string;
  identityKind?: ProjectMapApiEndpointIdentityKind;
  ambiguousIdentity?: boolean;
};

export type ProjectMapApiGroup = {
  id: string;
  label: string;
  level: ProjectMapApiGroupLevel;
  parentId?: string;
  endpointIds: string[];
  childGroupIds: string[];
  protocolCounts?: Record<string, number>;
  languageCounts?: Record<string, number>;
  confidenceCounts?: Record<string, number>;
};

export type ProjectMapApiCallChainEdgeKind =
  | "handler"
  | "service"
  | "repository"
  | "model"
  | "outbound-http"
  | "rpc"
  | "event"
  | "unknown";

export type ProjectMapApiCallChainEdge = {
  id: string;
  sourceSymbol: string;
  targetSymbol: string;
  sourceFile: string;
  line?: number;
  targetFile?: string;
  targetLine?: number;
  excerpt?: string;
  direction: "forward" | "backward";
  kind: ProjectMapApiCallChainEdgeKind;
  confidence: ProjectMapApiConfidence;
  evidence: ProjectMapApiEvidence[];
};

export type ProjectMapApiCallChain = {
  id: string;
  endpointId: string;
  edges: ProjectMapApiCallChainEdge[];
  maxDepth: number;
  truncatedReason?: string;
};

export type ProjectMapApiAdapterCoverage = {
  language: string;
  parserSource: ProjectMapApiParserSource;
  frameworks: string[];
  status: "active" | "no-candidate" | "not-present" | "unsupported";
  fileCount: number;
  endpointCount: number;
  noCandidateCount: number;
  unsupportedCount: number;
};

export type ProjectMapApiContractGraph = {
  schemaVersion: 1;
  generatedAt: string;
  storageKey?: string;
  scanRunId?: string;
  workspaceFingerprint?: string;
  endpoints: ProjectMapApiEndpoint[];
  groups: ProjectMapApiGroup[];
  schemas: ProjectMapApiSchemaRef[];
  callChains: ProjectMapApiCallChain[];
  adapters?: ProjectMapApiAdapterCoverage[];
  stale?: unknown;
  repair?: unknown;
  skipped?: Array<{ reason: string; count: number }>;
};

export type ProjectMapRelationshipReadSection =
  | "manifest"
  | "profile"
  | "run"
  | "scan"
  | "filesManifest"
  | "files"
  | "relations"
  | "relationsByFile"
  | "relationsByType"
  | "symbols"
  | "modules"
  | "impact"
  | "contextPack"
  | "apiContracts"
  | "stale"
  | "repair";

export type ProjectMapRelationshipReadResponse = {
  storageKey: string;
  storageDir: string;
  exists: boolean;
  manifest?: unknown;
  profile?: unknown;
  run?: unknown;
  scan?: unknown;
  filesManifest?: unknown;
  files?: unknown;
  relations?: unknown;
  relationsByFile?: unknown;
  relationsByType?: unknown;
  symbols?: unknown;
  modules?: unknown;
  impact?: unknown;
  contextPack?: unknown;
  apiContracts?: unknown;
  stale?: unknown;
  repair?: unknown;
  readErrors?: Array<{
    path: string;
    message: string;
  }>;
};

export type ProjectMapRelationshipScanOptions = {
  maxFiles?: number;
  includeIgnoredHints?: boolean;
  paths?: string[];
  changedFiles?: string[];
};

export type ProjectMapRelationshipScanResponse = {
  storageKey: string;
  storageDir: string;
  scanRunId: string;
  generatedAt: string;
  scannedRoot: string;
  fileCount: number;
  relationCount: number;
  apiEndpointCount?: number;
  apiGroupCount?: number;
  ignoredCount: number;
  repairIssueCount: number;
};

export type ProjectMapRelationshipWriteFile = {
  relativePath: string;
  content: string;
};

export type ProjectMapRelationshipWriteSnapshotInput = {
  workspaceId: string;
  files: ProjectMapRelationshipWriteFile[];
  createBackup?: boolean;
  storageLocation?: ProjectMapStorageLocation;
};

export type ProjectMapContextRiskFlag = {
  id: string;
  severity: "info" | "warning" | "critical";
  label: string;
  nodeId?: string;
};

export type ProjectMapGovernanceArtifactKind = "spec" | "task" | "document";

export type ProjectMapOpenSpecMetadata = {
  capabilityId: string;
  requirementTitle?: string;
  scenarioTitle?: string;
  changeId?: string;
  path: string;
  line?: number;
  summary?: string;
};

export type ProjectMapTrellisTaskMetadata = {
  taskId: string;
  title: string;
  status?: string;
  path: string;
  openspecChangeId?: string;
  summary?: string;
};

export type ProjectMapGovernanceLink = {
  id: string;
  kind: ProjectMapGovernanceArtifactKind;
  label: string;
  path?: string;
  line?: number;
  ref?: string;
  nodeId?: string;
  relationId?: string;
  relationType?: ProjectMapRelationType;
  sourceKind: ProjectMapRelationSourceKind;
  confidence: ProjectMapConfidence;
  deterministic: boolean;
};

export type ProjectMapIgnoredPath = {
  path: string;
  reason: string;
};

export type ProjectMapIgnoreSummary = {
  inputCount: number;
  keptPaths: string[];
  ignoredPaths: ProjectMapIgnoredPath[];
};

export type ProjectMapContextPack = {
  id: string;
  query?: string;
  selectedNode: ProjectMapNode | null;
  matchedNodes: ProjectMapNode[];
  relatedNodes: ProjectMapNode[];
  relations: ProjectMapRelation[];
  evidenceSources: ProjectMapSource[];
  evidenceRecords: ProjectMapEvidenceRecord[];
  relatedArtifacts: ProjectMapRelatedArtifact[];
  governanceEvidence: ProjectMapGovernanceLink[];
  riskFlags: ProjectMapContextRiskFlag[];
  ignored?: ProjectMapIgnoreSummary;
};

export type ProjectMapAgentTaskContext = {
  contextPackId: string;
  selectedNodeId: string | null;
  nodeIds: string[];
  relationIds: string[];
  deterministicGovernanceEvidence: ProjectMapGovernanceLink[];
  inferredGovernanceEvidence: ProjectMapGovernanceLink[];
  evidenceSources: ProjectMapSource[];
  riskFlags: ProjectMapContextRiskFlag[];
};

export type ProjectMapRefreshClassification =
  | "skip"
  | "partial-refresh"
  | "architecture-refresh"
  | "full-refresh-suggested";

export type ProjectMapRefreshReasonKind =
  | "ignored"
  | "cosmetic"
  | "source-changed"
  | "spec-changed"
  | "task-changed"
  | "architecture-changed"
  | "fingerprint-matched"
  | "unknown";

export type ProjectMapChangedFileFingerprint = {
  path: string;
  currentHash?: string | null;
};

export type ProjectMapStaleReason = {
  id: string;
  kind: ProjectMapRefreshReasonKind;
  label: string;
  path?: string;
  nodeId?: string;
  relationId?: string;
  observedHash?: string | null;
  currentHash?: string | null;
  recommendation: ProjectMapRefreshClassification;
};

export type ProjectMapRefreshSummary = {
  classification: ProjectMapRefreshClassification;
  label: string;
  changedPaths: string[];
  ignoredPaths: ProjectMapIgnoredPath[];
  staleReasons: ProjectMapStaleReason[];
  evaluatedAt: string;
};

export type ProjectMapGraphIntegrityIssueKind =
  | "duplicate-node-id"
  | "missing-parent"
  | "missing-child"
  | "missing-relation-source"
  | "missing-relation-target"
  | "duplicate-relation-id"
  | "missing-node-evidence"
  | "stale-relation";

export type ProjectMapGraphIntegrityIssue = {
  id: string;
  kind: ProjectMapGraphIntegrityIssueKind;
  severity: "info" | "warning" | "critical";
  label: string;
  nodeId?: string;
  relationId?: string;
};

export type ProjectMapGraphRepairActionKind =
  | "remove-invalid-relation"
  | "remove-missing-child-reference"
  | "clear-missing-parent"
  | "quarantine-evidence-gap";

export type ProjectMapGraphRepairAction = {
  id: string;
  kind: ProjectMapGraphRepairActionKind;
  label: string;
  nodeId?: string;
  relationId?: string;
};

export type ProjectMapGraphRepairSummary = {
  issues: ProjectMapGraphIntegrityIssue[];
  actions: ProjectMapGraphRepairAction[];
  repairedAt?: string;
};

export type ProjectMapExplainPack = ProjectMapContextPack & {
  focusNode: ProjectMapNode;
  childNodes: ProjectMapNode[];
  parentNode: ProjectMapNode | null;
};

export type ProjectMapImpactNode = {
  node: ProjectMapNode;
  reason: string;
  relationIds: string[];
};

export type ProjectMapImpactRiskSummary = {
  changedCount: number;
  affectedCount: number;
  staleCount: number;
  lowConfidenceCount: number;
  unmappedCount: number;
  ignoredCount: number;
};

export type ProjectMapImpactResult = {
  inputFiles: string[];
  source?: ProjectMapImpactSourceMetadata;
  changedNodes: ProjectMapImpactNode[];
  affectedNodes: ProjectMapImpactNode[];
  affectedLensIds: string[];
  unmappedFiles: string[];
  ignored: ProjectMapIgnoreSummary;
  riskSummary: ProjectMapImpactRiskSummary;
};

export type ProjectMapImpactSourceKind = "none" | "explicit" | "git-status" | "agent-patch";

export type ProjectMapImpactSourceMetadata = {
  kind: ProjectMapImpactSourceKind;
  label: string;
  fileCount: number;
};

export type ProjectMapActivityKind =
  | "git-change"
  | "project-map-run"
  | "candidate"
  | "stale"
  | "evidence"
  | "manual";

export type ProjectMapActivitySourceCategory =
  | "changed-files"
  | "map-runs"
  | "stale-state"
  | "candidate-state"
  | "evidence-state"
  | "degraded";

export type ProjectMapActivityItem = {
  id: string;
  kind: ProjectMapActivityKind;
  sourceCategory: ProjectMapActivitySourceCategory;
  title: string;
  summary: string;
  occurredAt: string;
  nodeIds: string[];
  relationIds: string[];
  filePaths: string[];
  lensIds: string[];
  confidence: ProjectMapConfidence;
  sourceRefs: ProjectMapSource[];
  deterministic: boolean;
  degraded?: boolean;
};

export type ProjectMapActivityGroup = {
  id: ProjectMapActivitySourceCategory;
  title: string;
  items: ProjectMapActivityItem[];
  degraded?: boolean;
};

export type ProjectMapActivityProjection = {
  groups: ProjectMapActivityGroup[];
  items: ProjectMapActivityItem[];
  changedNodeIds: Set<string>;
  affectedNodeIds: Set<string>;
  relationIds: Set<string>;
  filePaths: Set<string>;
  degraded: boolean;
};

export type ProjectMapQueryGroup =
  | "nodes"
  | "evidence-files"
  | "relations"
  | "artifact-references"
  | "stale-reasons"
  | "activity";

export type ProjectMapQueryResult = {
  id: string;
  group: ProjectMapQueryGroup;
  title: string;
  summary: string;
  matchedFields: string[];
  nodeIds: string[];
  relationIds: string[];
  filePaths: string[];
  score: number;
  preview?: string;
  degraded?: boolean;
};

export type ProjectMapGroupedQueryResults = {
  query: string;
  groups: Array<{
    group: ProjectMapQueryGroup;
    title: string;
    results: ProjectMapQueryResult[];
    capped: boolean;
    totalCount: number;
  }>;
  nodeIds: Set<string>;
  relationIds: Set<string>;
  filePaths: Set<string>;
};

export type ProjectMapAssociationExplanationReason = {
  label: string;
  relationId?: string;
  sourceKind?: ProjectMapRelationSourceKind;
  confidence: ProjectMapConfidence;
  stale: boolean;
  evidenceCount: number;
  deterministic: boolean;
  degraded?: boolean;
};

export type ProjectMapAssociationExplanation = {
  sourceNodeId: string;
  targetNodeId: string;
  status: "idle" | "found" | "not-found";
  steps: Array<{
    nodeId: string;
    title: string;
    via: "hierarchy" | "relation" | "self";
    relationId?: string;
  }>;
  reasons: ProjectMapAssociationExplanationReason[];
};

export type ProjectMapQuickFilterId =
  | "changed"
  | "affected"
  | "stale"
  | "candidate"
  | "low-confidence"
  | "inferred-relations";

export type ProjectMapHighlightSource =
  | "selected"
  | "path"
  | "search"
  | "activity-changed"
  | "activity-affected"
  | "advisor"
  | "filter"
  | "base";

export type ProjectMapHighlightItemState = {
  id: string;
  primary: ProjectMapHighlightSource;
  sources: ProjectMapHighlightSource[];
  priority: number;
};

export type ProjectMapHighlightProjection = {
  selectedNodeIds: Set<string>;
  selectedRelationIds: Set<string>;
  pathNodeIds: Set<string>;
  pathRelationIds: Set<string>;
  searchNodeIds: Set<string>;
  activityChangedNodeIds: Set<string>;
  activityAffectedNodeIds: Set<string>;
  advisorNodeIds: Set<string>;
  advisorRelationIds: Set<string>;
  filterNodeIds: Set<string>;
  filterRelationIds: Set<string>;
  baseNodeIds: Set<string>;
  baseRelationIds: Set<string>;
  nodeStates: Map<string, ProjectMapHighlightItemState>;
  relationStates: Map<string, ProjectMapHighlightItemState>;
};

export type ProjectMapAdvisorKind =
  | "diff-impact"
  | "query-neighborhood"
  | "node-explain"
  | "guide-topology"
  | "graph-health";

export type ProjectMapAdvisorHint = {
  id: string;
  kind: ProjectMapAdvisorKind;
  title: string;
  summary: string;
  nodeIds: string[];
  relationIds: string[];
  filePaths: string[];
  severity?: "info" | "warning" | "risk";
  deterministic: boolean;
  degraded?: boolean;
};
