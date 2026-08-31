/**
 * File-preview fast Markdown renderer types.
 *
 * The fast renderer compiles Markdown into a sanitized HTML document
 * surface plus a parser-derived outline. The compile result is a
 * pure, serializable value: it MUST NOT depend on React component
 * instances or mounted DOM, so the same pipeline can move to a
 * Web Worker in a later phase.
 */

export type FastMarkdownRendererProfileId =
  | "rich-react"
  | "fast-html"
  | "bounded-fast-html"
  | "low-cost-readable";

export type FastMarkdownFallbackReason =
  | "none"
  | "compile-failed"
  | "sanitizer-failed"
  | "renderer-not-selected"
  | "metrics-threshold"
  | "feature-flag-disabled";

export type MarkdownHeavyBlockKind =
  | "code-block"
  | "mermaid"
  | "math"
  | "table"
  | "html-raw";

export type FastMarkdownFeatureFlags = {
  fastHtmlRendererEnabled?: boolean;
  boundedFastHtmlRendererEnabled?: boolean;
  largeDocumentFastRendererDisabled?: boolean;
};

export type MarkdownSourceLineAnchor = {
  blockId: string;
  startLine: number;
  endLine: number;
};

export type FastMarkdownHeavyBlock = {
  blockId: string;
  kind: MarkdownHeavyBlockKind;
  startLine: number;
  endLine: number;
  language: string | null;
  contentHash: string;
};

export type MarkdownOutlineEntry = {
  id: string;
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  startLine: number;
  endLine: number;
  anchor: string;
  ordinal: number;
};

export type FastMarkdownRenderDiagnostics = {
  profile: FastMarkdownRendererProfileId;
  contentHash: string;
  cacheKey: string;
  cacheState: "hit" | "miss";
  compileDurationMs: number;
  sanitizeDurationMs: number;
  totalSourceLines: number;
  totalHeadings: number;
  totalHeavyBlocks: number;
  fallbackReason: FastMarkdownFallbackReason;
  truncated: boolean;
  featureFlagApplied: boolean;
};

export type FastMarkdownRenderResult = {
  cacheKey: string;
  contentHash: string;
  html: string;
  outline: MarkdownOutlineEntry[];
  sourceLineAnchors: MarkdownSourceLineAnchor[];
  heavyBlocks: FastMarkdownHeavyBlock[];
  diagnostics: FastMarkdownRenderDiagnostics;
  rendererProfile: FastMarkdownRendererProfileId;
};

export type FastMarkdownUnsafeArtifact = {
  cacheKey: string;
  contentHash: string;
  unsafeHtml: string;
  sanitization: "main-thread-required";
  outline: MarkdownOutlineEntry[];
  sourceLineAnchors: MarkdownSourceLineAnchor[];
  heavyBlocks: FastMarkdownHeavyBlock[];
  diagnostics: FastMarkdownRenderDiagnostics;
  rendererProfile: FastMarkdownRendererProfileId;
};

export type CompileFastMarkdownArgs = {
  documentKey: string;
  rawMarkdown: string;
  bodyStartLine?: number;
  rendererProfile: FastMarkdownRendererProfileId;
  featureFlags?: FastMarkdownFeatureFlags;
  options?: {
    maxHtmlLength?: number;
    lineLimit?: number;
  };
};

export type FastMarkdownWorkerRequestMeta = {
  requestId: string;
  documentKey: string;
  contentHash: string;
  optionsHash: string;
  schemaVersion: "fast-markdown-worker-v1";
  createdAtMs: number;
};



export type FastMarkdownWorkerDiagnostics = {
  hasWorker: boolean;
  pendingRequestCount: number;
  disposedCount: number;
  fallbackCount: number;
  unknownResponseCount: number;
  staleResultDropCount: number;
  postMessageFailureCount: number;
  lastFallbackReason: string | null;
};
