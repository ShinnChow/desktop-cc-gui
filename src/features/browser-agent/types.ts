export type BrowserAgentFeaturePhase =
  | "disabled"
  | "read_only_snapshot"
  | "safe_navigation"
  | "targeted_element_actions"
  | "form_submit"
  | "full_agent";

export type BrowserSessionStatus =
  | "idle"
  | "loading"
  | "ready"
  | "blocked"
  | "failed"
  | "closed"
  | "unsupported";

export type BrowserCapabilityState = "supported" | "degraded" | "unsupported";

export type BrowserPlatformCapability = {
  platform: "macos" | "windows" | "linux" | "unsupported";
  webviewRuntime: "wkwebview" | "webview2" | "webkitgtk" | "unknown";
  browserDock: BrowserCapabilityState;
  snapshotCapture: BrowserCapabilityState;
  screenshotCapture: BrowserCapabilityState;
  navigationActions: BrowserCapabilityState;
  elementActions: BrowserCapabilityState;
  formSubmitActions: BrowserCapabilityState;
  diagnosticsCapture: BrowserCapabilityState;
  unsupportedReasons: string[];
  degradedReasons: string[];
};

export type BrowserAgentSettings = {
  enabled: boolean;
  preferForAiBrowserOperations: boolean;
  allowReadOnlySnapshots: boolean;
  allowNavigationActions: boolean;
  allowElementActions: boolean;
  allowFormSubmitActions: boolean;
  allowExternalProviderFallback: boolean;
  defaultSnapshotBudgetChars: number;
  evidenceRetentionDays: number;
  platformWarningsAcknowledged: Record<string, boolean>;
};

export type BrowserSession = {
  browserSessionId: string;
  workspaceId: string;
  label: string;
  url: string;
  normalizedUrl: string;
  origin: string | null;
  title: string | null;
  faviconRef?: string | null;
  status: BrowserSessionStatus;
  featurePhase: BrowserAgentFeaturePhase;
  platformCapability: BrowserPlatformCapability;
  linkedThreadId?: string | null;
  linkedOrchestrationTaskId?: string | null;
  lastSnapshotId?: string | null;
  lastActionId?: string | null;
  errorCode?: string | null;
  diagnosticMessage?: string | null;
  createdAt: number;
  updatedAt: number;
  lastActivatedAt: number;
  closedAt?: number | null;
};

/** Browser evidence snapshot previously owned by Task Center; kept local so browser-agent can render standalone. */
export type TaskRunBrowserEvidenceRef = {
  attachmentId: string;
  browserSessionId: string;
  snapshotId: string;
  url: string;
  title?: string | null;
  capturedAt: number;
  state: "available" | "stale" | "expired" | "degraded" | "deleted" | "unsupported";
  summary?: string | null;
  diagnostics?: string[];
  redactedKinds?: string[];
  codeCandidates?: Array<{
    filePath: string;
    reason:
      | "route_match"
      | "file_name_match"
      | "visible_text_match"
      | "heading_match"
      | "button_label_match"
      | "form_label_match"
      | "aria_label_match"
      | "test_id_match"
      | "component_symbol_match"
      | "manual_hint";
    confidence: "high" | "medium" | "low";
    matchedText?: string | null;
    sourceEvidence?: string[];
    explanation?: string;
    openAction?: {
      kind: "open_file";
      filePath: string;
    } | null;
  }>;
};

export type BrowserUrlValidationResult = {
  rawUrl: string;
  normalizedUrl: string | null;
  allowed: boolean;
  blockedReason: string | null;
  diagnostic: BrowserDiagnostic | null;
  workspaceLocalAllowed: boolean;
};

export type CreateBrowserSessionRequest = {
  workspaceId: string;
  url: string;
  ownerSurface: string;
};

export type UpdateBrowserSessionRequest = {
  browserSessionId: string;
  workspaceId?: string | null;
  status?: BrowserSessionStatus | null;
  title?: string | null;
  url?: string | null;
  lastSnapshotId?: string | null;
  lastActionId?: string | null;
  errorCode?: string | null;
  diagnosticMessage?: string | null;
};



export type BrowserTabContextMenuTheme = {
  colorScheme: "light" | "dark";
  surface: string;
  foreground: string;
  border: string;
  hoverSurface: string;
  disabledForeground: string;
  shadow: string;
};

export type BrowserTabContextMenuRequest = {
  browserSessionId: string;
  x: number;
  locale?: string | null;
  disabledActions: string[];
  theme: BrowserTabContextMenuTheme;
};

export type BrowserSelectionLocate = {
  documentX: number;
  documentY: number;
  viewportX: number;
  viewportY: number;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  listIndex: number | null;
  listLength: number | null;
  previousText: string | null;
  nextText: string | null;
  ancestorLabel?: string | null;
  cssPath?: string | null;
};

export type BrowserWebviewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserWebviewMountRequest = {
  browserSessionId: string;
  bounds: BrowserWebviewBounds;
};

export type BrowserWebviewEvent = {
  browserSessionId: string;
  label: string;
  url: string | null;
  title: string | null;
  status: BrowserSessionStatus;
  occurredAt: number;
  errorCode?: string | null;
  diagnosticMessage?: string | null;
};

export type BrowserSnapshotBudget = {
  charLimit: number;
  visibleTextLimit: number;
  elementLimit: number;
  formFieldLimit: number;
  diagnosticLimit: number;
  tokenEstimate?: number | null;
  truncated: boolean;
  omittedElementCount: number;
};

export type BrowserSnapshotFreshness =
  | "fresh"
  | "stale"
  | "expired"
  | "degraded";

export type BrowserObservationState =
  | "available"
  | "degraded"
  | "stale"
  | "expired"
  | "unsupported";

export type BrowserObservationStaleReason =
  | "active_tab_changed"
  | "renderer_mismatch"
  | "url_changed"
  | "title_changed"
  | "scroll_changed"
  | "dom_fingerprint_changed"
  | "ttl_expired"
  | "browser_dock_closed"
  | "session_closed"
  | "workspace_mismatch"
  | "capture_degraded";

export type BrowserObservationTransport =
  | "webview_dom"
  | "metadata_fallback"
  | "screenshot_ocr"
  | "external_provider"
  | "unavailable";

export type BrowserObservationRendererBinding =
  | "matched"
  | "mismatched"
  | "unavailable";

export type BrowserObservationDiagnostic = {
  diagnosticId: string;
  severity: "info" | "warning" | "error";
  userMessage: string;
  aiMessage: string;
};

export type BrowserObservation = {
  schemaVersion: 1;
  observationId: string;
  browserSessionId: string;
  workspaceId: string;
  capturedAt: number;
  state: BrowserObservationState;
  staleReasons: BrowserObservationStaleReason[];
  transport: BrowserObservationTransport;
  rendererBinding: BrowserObservationRendererBinding;
  source: Pick<
    BrowserSnapshotSource,
    "url" | "normalizedUrl" | "origin" | "title" | "tabLabel" | "workspaceLocalAllowed"
  >;
  budget: BrowserSnapshotBudget;
  privacy: BrowserPrivacyReport;
  diagnostics: BrowserObservationDiagnostic[];
  omittedCapabilities: string[];
};

export type BrowserUserAnnotationAnchorType =
  | "point"
  | "region"
  | "element"
  | "text_range";

export type BrowserUserAnnotationRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserUserAnnotationNearestElement = {
  role: string;
  label: string | null;
  placeholder: string | null;
  hrefOrigin: string | null;
  selectorHint: string | null;
  sensitive: boolean;
};

export type BrowserUserAnnotation = {
  annotationId: string;
  observationId: string;
  browserSessionId: string;
  workspaceId: string;
  createdAt: number;
  url: string;
  title: string | null;
  anchor: BrowserUserAnnotationAnchorType;
  userNote: string;
  viewport: Pick<
    BrowserViewportState,
    "width" | "height" | "scrollX" | "scrollY" | "devicePixelRatio"
  >;
  region: BrowserUserAnnotationRegion | null;
  nearbyText: string | null;
  nearestElement: BrowserUserAnnotationNearestElement | null;
  locate?: BrowserSelectionLocate | null;
  privacy: BrowserPrivacyReport;
  staleReasons: BrowserObservationStaleReason[];
  diagnostics: BrowserObservationDiagnostic[];
};

export type BrowserSelectedElementEvidence = {
  tagName: string;
  role: string | null;
  label: string | null;
  text: string | null;
  href: string | null;
  selectorHint: string | null;
  sensitive: boolean;
  bounds: BrowserUserAnnotationRegion | null;
  viewport: Pick<
    BrowserViewportState,
    "width" | "height" | "scrollX" | "scrollY" | "devicePixelRatio"
  >;
  locate?: BrowserSelectionLocate | null;
  selectedAt: number;
};

export type BrowserSnapshotSource = {
  url: string;
  normalizedUrl: string;
  origin: string | null;
  title: string | null;
  tabLabel: string;
  captureReason: "manual_attach" | "refresh" | "task_dispatch" | "restore" | "legacy";
  workspaceLocalAllowed: boolean;
};

export type BrowserViewportState = {
  width: number | null;
  height: number | null;
  scrollX: number | null;
  scrollY: number | null;
  scrollHeight: number | null;
  scrollWidth: number | null;
  devicePixelRatio: number | null;
};

export type BrowserTextNode = {
  targetId: string;
  role:
    | "heading"
    | "paragraph"
    | "list_item"
    | "label"
    | "code"
    | "table_cell"
    | "other";
  level?: number | null;
  text: string;
  truncated: boolean;
};

export type BrowserElementBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserActionTarget = {
  targetId: string;
  kind:
    | "link"
    | "button"
    | "input"
    | "textarea"
    | "select"
    | "checkbox"
    | "radio"
    | "submit"
    | "other";
  label: string;
  accessibleName?: string | null;
  text?: string | null;
  href?: string | null;
  placeholder?: string | null;
  valuePreview?: string | null;
  disabled: boolean;
  visible: boolean;
  sensitive: boolean;
  bounds?: BrowserElementBounds | null;
};

export type BrowserFormSummary = {
  formId: string;
  label: string;
  method?: string | null;
  actionOrigin?: string | null;
  fields: BrowserActionTarget[];
  submitTargets: BrowserActionTarget[];
  sensitive: boolean;
};

export type BrowserLandmark = {
  targetId: string;
  role:
    | "main"
    | "navigation"
    | "search"
    | "form"
    | "banner"
    | "contentinfo"
    | "dialog"
    | "region";
  label: string;
  textPreview?: string | null;
};

export type BrowserElementLandmark = {
  landmarkId: string;
  role:
    | "heading"
    | "link"
    | "button"
    | "input"
    | "textarea"
    | "select"
    | "form"
    | "main"
    | "article"
    | "navigation"
    | "region";
  label: string;
  textPreview?: string | null;
  selectorHint?: string | null;
  href?: string | null;
  placeholder?: string | null;
  enabled: boolean;
  visible: boolean;
  sensitive: boolean;
  bounds?: BrowserElementBounds | null;
};

export type BrowserContentRegion = {
  regionId: string;
  role: "main" | "article" | "navigation" | "form" | "region";
  label: string;
  textPreview: string;
  truncated: boolean;
};

export type BrowserPageType =
  | "article"
  | "issue"
  | "docs"
  | "form"
  | "dashboard"
  | "spa"
  | "unknown";

export type BrowserPrimaryContent = {
  text: string;
  source:
    | "semantic_main"
    | "article"
    | "readable_block"
    | "body_fallback"
    | "empty";
  score: number;
  truncated: boolean;
};

export type BrowserReadableBlock = {
  blockId: string;
  role:
    | "article"
    | "issue_body"
    | "docs_section"
    | "form"
    | "dashboard_panel"
    | "paragraph"
    | "code"
    | "other";
  text: string;
  score: number;
  truncated: boolean;
};

export type BrowserNoiseDiagnostic = {
  diagnosticId: string;
  kind:
    | "navigation_noise"
    | "link_dense_region"
    | "control_dense_region"
    | "auth_wall"
    | "spa_shell"
    | "low_readability";
  severity: "info" | "warning";
  message: string;
  score: number;
};

export type BrowserVisualEvidence = {
  evidenceId: string;
  kind: "image" | "figure" | "attachment" | "video";
  label: string;
  altText?: string | null;
  srcOrigin?: string | null;
  nearbyText?: string | null;
  visible: boolean;
  sensitive: boolean;
};

export type BrowserScreenshotReference = {
  refId: string;
  browserSessionId: string;
  snapshotId: string;
  capturedAt: number;
  kind: "thumbnail_reference";
  storage: "metadata_only" | "ephemeral_ref";
  modelPayloadAllowed: boolean;
  diagnostic?: BrowserObservationDiagnostic | null;
};

export type BrowserOcrTextSupplement = {
  refId: string;
  screenshotRefId: string;
  text: string;
  capturedAt: number;
  charBudget: number;
  truncated: boolean;
  redactedKinds: string[];
  modelPayloadAllowed: boolean;
};

export type BrowserCodeCandidateReason =
  | "route_match"
  | "file_name_match"
  | "visible_text_match"
  | "heading_match"
  | "button_label_match"
  | "form_label_match"
  | "aria_label_match"
  | "test_id_match"
  | "component_symbol_match"
  | "manual_hint";

export type BrowserCodeCandidate = {
  candidateId: string;
  filePath: string;
  symbolName?: string | null;
  reason: BrowserCodeCandidateReason;
  confidence: "high" | "medium" | "low";
  matchedText?: string | null;
  sourceEvidence?: string[];
  explanation?: string;
  openAction?: {
    kind: "open_file";
    filePath: string;
  } | null;
};

export type BrowserDiagnostic = {
  diagnosticId: string;
  kind:
    | "console_error"
    | "console_warning"
    | "network_error"
    | "security_warning"
    | "capture_warning";
  severity: "info" | "warning" | "error";
  message: string;
  source?: string | null;
  redacted: boolean;
};

export type BrowserNetworkSummary = {
  requestCount: number;
  failedRequestCount: number;
  blockedRequestCount: number;
  mainDocumentStatus?: number | null;
  slowRequestCount?: number | null;
  redacted: boolean;
};

export type BrowserPrivacyReport = {
  redactionApplied: boolean;
  redactedKinds: Array<
    | "password"
    | "token"
    | "cookie"
    | "authorization"
    | "hidden_input"
    | "email"
    | "phone"
    | "secret_like"
    | "unknown"
  >;
  omittedKinds: Array<
    "raw_dom" | "cookies" | "headers" | "scripts" | "styles" | "hidden_nodes"
  >;
};

export type BrowserContextSnapshot = {
  snapshotId: string;
  browserSessionId: string;
  workspaceId: string;
  capturedAt: number;
  freshness: BrowserSnapshotFreshness;
  source: BrowserSnapshotSource;
  viewport: BrowserViewportState;
  page: {
    visibleText: string;
    pageType?: BrowserPageType;
    primaryContent?: BrowserPrimaryContent | null;
    readableBlocks?: BrowserReadableBlock[];
    noiseDiagnostics?: BrowserNoiseDiagnostic[];
    visualEvidence?: BrowserVisualEvidence[];
    textTruncated: boolean;
    headings: BrowserTextNode[];
    landmarks: BrowserLandmark[];
    elementLandmarks: BrowserElementLandmark[];
    contentRegions: BrowserContentRegion[];
    links: BrowserActionTarget[];
    buttons: BrowserActionTarget[];
    forms: BrowserFormSummary[];
    selectedText?: string | null;
    languageHint?: string | null;
  };
  codeCandidates: BrowserCodeCandidate[];
  diagnostics: {
    console: BrowserDiagnostic[];
    network: BrowserNetworkSummary | null;
    captureWarnings: BrowserDiagnostic[];
  };
  evidence: {
    screenshotRef?: string | null;
    htmlExcerptRef?: string | null;
  };
  omittedCapabilities?: string[];
  privacy: BrowserPrivacyReport;
  budget: BrowserSnapshotBudget;
  availability: "available" | "partial" | "expired" | "deleted" | "unsupported";
};

export type BrowserContextAttachment = {
  kind: "browser_snapshot";
  attachmentId: string;
  browserSessionId: string;
  snapshotId: string;
  workspaceId: string;
  title: string | null;
  url: string;
  capturedAt: number;
  stale: boolean;
  freshness: BrowserSnapshotFreshness;
  observation: BrowserObservation;
  summary: string;
  visibleTextExcerpt: string;
  pageType?: BrowserPageType;
  primaryContent?: string;
  readableBlocks?: BrowserReadableBlock[];
  noiseDiagnostics?: BrowserNoiseDiagnostic[];
  visualEvidence?: BrowserVisualEvidence[];
  screenshotRefs?: BrowserScreenshotReference[];
  ocrTextSupplements?: BrowserOcrTextSupplement[];
  annotations?: BrowserUserAnnotation[];
  elementCounts: {
    headings: number;
    links: number;
    buttons: number;
    forms: number;
    landmarks: number;
    codeCandidates: number;
    readableBlocks?: number;
    visualEvidence?: number;
    annotations?: number;
  };
  diagnostics: BrowserDiagnostic[];
  budget: BrowserSnapshotBudget;
  codeCandidates: BrowserCodeCandidate[];
  privacy: BrowserPrivacyReport;
};

export type BrowserActionRequest = {
  browserSessionId: string;
  action:
    | "navigate"
    | "reload"
    | "scroll"
    | "click"
    | "type"
    | "select"
    | "submit";
  targetId?: string | null;
  value?: string | null;
  reason: string;
  requestedBy: "user" | "ai" | "task_run";
  confirmed?: boolean;
};

export type BrowserActionKind = BrowserActionRequest["action"];

export type BrowserActionRiskLevel = "low" | "medium" | "high";

export type BrowserActionGateReason =
  | "settings_disabled"
  | "platform_unsupported"
  | "mutating_action_blocked_by_default"
  | "requires_user_confirmation"
  | "not_confirmed";

export type BrowserActionGateResolution = {
  allowed: boolean;
  blockedReasons: BrowserActionGateReason[];
};

export type BrowserActionPreview = {
  actionId: string;
  browserSessionId: string;
  action: BrowserActionKind;
  targetDescription: string;
  valuePreview: string | null;
  reason: string;
  riskLevel: BrowserActionRiskLevel;
  requiresUserConfirmation: boolean;
  blockedByDefault: boolean;
  beforeSnapshotId: string | null;
  afterSnapshotId?: string | null;
  expectedEffect: string;
  privacyNotice: string;
  gate: BrowserActionGateResolution;
};

export type BrowserVisualEvidenceGate = {
  state: BrowserCapabilityState;
  requiresExplicitConfirmation: boolean;
  modelPayloadAllowed: boolean;
  degradedReasons: string[];
  unsupportedReasons: string[];
  privacyNotice: string;
};

export type BrowserActionAuditEntry = {
  actionId: string;
  browserSessionId: string;
  requestedAt: number;
  completedAt?: number | null;
  action: BrowserActionRequest["action"];
  targetDescription?: string | null;
  outcome: "completed" | "blocked" | "failed" | "canceled";
  diagnosticMessage?: string | null;
  beforeSnapshotId?: string | null;
  afterSnapshotId?: string | null;
  comparison?: {
    beforeSnapshotId: string | null;
    afterSnapshotId: string | null;
    state: "available" | "degraded" | "failed";
    diagnostics: string[];
  } | null;
};

export type BrowserActionResult = {
  outcome: BrowserActionAuditEntry["outcome"];
  auditEntry: BrowserActionAuditEntry;
  preview?: BrowserActionPreview | null;
};





export type BrowserProviderRouteDecision = {
  requestedCapability:
    | "read_snapshot"
    | "navigate"
    | "reload"
    | "scroll"
    | "click"
    | "type"
    | "submit"
    | "full_agent_task";
  selectedProvider:
    | "built_in_browser_agent"
    | "browser_skill"
    | "computer_use"
    | "external_cdp"
    | "none";
  reason: string;
  userOverride: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string | null;
};

export type BrowserAgentStatus = {
  settings: BrowserAgentSettings;
  featurePhase: BrowserAgentFeaturePhase;
  platformCapability: BrowserPlatformCapability;
  providerPreference: BrowserProviderRouteDecision;
};
