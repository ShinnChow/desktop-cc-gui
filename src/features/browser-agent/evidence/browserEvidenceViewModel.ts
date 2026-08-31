import type {
  BrowserContextAttachment,
  BrowserDiagnostic,
  BrowserNoiseDiagnostic,
  BrowserPrivacyReport,
  BrowserSnapshotBudget,
  BrowserObservationState,
  BrowserUserAnnotation,
  BrowserSelectionLocate,
} from "../types";
import type { TaskRunBrowserEvidenceRef } from "../types";
import { dedupeBrowserUserAnnotations } from "../annotations";

export type BrowserExcerptKind =
  | "paragraph"
  | "heading"
  | "button"
  | "link"
  | "list"
  | "image"
  | "snapshot"
  | "excerpt";

export type BrowserEvidenceSectionState = BrowserObservationState | "empty";

export type BrowserEvidenceViewModelSection = {
  sectionId: string;
  title: string;
  state: BrowserEvidenceSectionState;
  items: string[];
  truncated: boolean;
  copySafeText: string;
  emptyReason: string | null;
};

export type BrowserSelectedElementPreview = {
  annotationId: string;
  title: string;
  body: string;
  kind: BrowserExcerptKind;
  elementName: string;
  role: string | null;
  meta: string;
  boundsLabel: string | null;
  selectorHint: string | null;
  hrefOrigin: string | null;
  sourceTitle: string;
  sourceUrl: string;
  locate: BrowserSelectionLocate | null;
  copySafeText: string;
};

export type BrowserEvidenceViewModel = {
  observationState: BrowserObservationState;
  staleReasons: BrowserContextAttachment["observation"]["staleReasons"];
  selectedElements: BrowserSelectedElementPreview[];
  selectedElement: BrowserSelectedElementPreview | null;
  overview: BrowserEvidenceViewModelSection;
  primaryContent: BrowserEvidenceViewModelSection;
  readableBlocks: BrowserEvidenceViewModelSection;
  interactiveElements: BrowserEvidenceViewModelSection;
  visualEvidence: BrowserEvidenceViewModelSection;
  annotations: BrowserEvidenceViewModelSection;
  codeCandidates: BrowserEvidenceViewModelSection;
  diagnostics: BrowserEvidenceViewModelSection;
  privacyBudget: BrowserEvidenceViewModelSection;
};

type BrowserEvidenceAttachmentLike = Pick<
  BrowserContextAttachment,
  "title" | "url" | "capturedAt" | "stale" | "summary"
> & {
  visibleTextExcerpt?: BrowserContextAttachment["visibleTextExcerpt"];
  elementCounts?: BrowserContextAttachment["elementCounts"];
  observation?: BrowserContextAttachment["observation"];
  pageType?: BrowserContextAttachment["pageType"];
  primaryContent?: BrowserContextAttachment["primaryContent"];
  readableBlocks?: BrowserContextAttachment["readableBlocks"];
  noiseDiagnostics?: BrowserNoiseDiagnostic[];
  visualEvidence?: BrowserContextAttachment["visualEvidence"];
  screenshotRefs?: BrowserContextAttachment["screenshotRefs"];
  ocrTextSupplements?: BrowserContextAttachment["ocrTextSupplements"];
  annotations?: BrowserContextAttachment["annotations"];
  diagnostics?: Array<Pick<BrowserDiagnostic, "severity" | "message">>;
  budget?: Partial<BrowserSnapshotBudget>;
  codeCandidates?: BrowserContextAttachment["codeCandidates"];
  privacy?: {
    redactionApplied?: boolean;
    redactedKinds: string[];
    omittedKinds: string[];
  };
};

const EMPTY_REASON_NONE_CAPTURED = "No browser evidence captured for this section.";

function compactEvidenceText(value: string, limit = 700): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function formatRoundedNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatRegionSize(region: BrowserUserAnnotation["region"]): string | null {
  if (!region) {
    return null;
  }
  return `${formatRoundedNumber(region.width)}x${formatRoundedNumber(region.height)}`;
}

function formatRegionBounds(region: BrowserUserAnnotation["region"]): string | null {
  if (!region) {
    return null;
  }
  return [
    `x=${formatRoundedNumber(region.x)}`,
    `y=${formatRoundedNumber(region.y)}`,
    `w=${formatRoundedNumber(region.width)}`,
    `h=${formatRoundedNumber(region.height)}`,
  ].join(" ");
}

function elementNameFromAnnotation(annotation: BrowserUserAnnotation): string {
  const selectorTag = annotation.nearestElement?.selectorHint
    ?.trim()
    .match(/^[a-zA-Z][a-zA-Z0-9-]*/)?.[0];
  return selectorTag || annotation.nearestElement?.role || annotation.anchor;
}

function firstMeaningfulLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? value.trim();
}

function pickLongestText(values: Array<string | null | undefined>): string {
  return values
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

function boundMultilineText(value: string, limit: number): string {
  const trimmed = value.replace(/[ \t]+\n/g, "\n").trim();
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}...` : trimmed;
}

function selectedElementTitle(annotation: BrowserUserAnnotation): string {
  return compactEvidenceText(
    annotation.userNote ||
      annotation.nearestElement?.label ||
      annotation.nearbyText ||
      annotation.nearestElement?.role ||
      annotation.anchor,
    220,
  );
}

function pageContextTexts(
  attachment: Pick<
    BrowserEvidenceAttachmentLike,
    "primaryContent" | "visibleTextExcerpt" | "readableBlocks"
  >,
): string[] {
  return [
    ...(attachment.readableBlocks ?? []).map((block) => block.text),
    attachment.primaryContent,
    attachment.visibleTextExcerpt,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function selectedElementBody(
  annotation: BrowserUserAnnotation,
  title: string,
  pageTexts: string[],
): string {
  const seed = pickLongestText([
    annotation.nearbyText,
    annotation.userNote,
    annotation.nearestElement?.label,
    title,
  ]);
  const needle = firstMeaningfulLine(seed);
  if (needle.length >= 8) {
    const matchedPageText = pageTexts.find(
      (text) => text.trimStart().startsWith(needle) && text.length > seed.length,
    );
    if (matchedPageText) {
      return boundMultilineText(matchedPageText, 4_000);
    }
  }
  return boundMultilineText(seed, 4_000);
}

function selectedElementKind(annotation: BrowserUserAnnotation): BrowserExcerptKind {
  const role = annotation.nearestElement?.role?.toLowerCase() ?? "";
  const tag = annotation.nearestElement?.selectorHint?.toLowerCase() ?? "";
  const token = `${role} ${tag}`;
  if (/\b(h[1-6]|heading)\b/.test(token)) {
    return "heading";
  }
  if (/\bbutton\b/.test(token)) {
    return "button";
  }
  if (/\b(link|a)\b/.test(token)) {
    return "link";
  }
  if (/\b(listitem|li)\b/.test(token)) {
    return "list";
  }
  if (/\b(img|image)\b/.test(token)) {
    return "image";
  }
  return "paragraph";
}

function resolveSelectionLocate(
  annotation: BrowserUserAnnotation,
): BrowserSelectionLocate | null {
  if (annotation.locate) {
    return annotation.locate;
  }
  if (!annotation.region) {
    return null;
  }
  const scrollX = annotation.viewport.scrollX ?? 0;
  const scrollY = annotation.viewport.scrollY ?? 0;
  return {
    documentX: scrollX + annotation.region.x,
    documentY: scrollY + annotation.region.y,
    viewportX: annotation.region.x,
    viewportY: annotation.region.y,
    width: annotation.region.width,
    height: annotation.region.height,
    scrollX,
    scrollY,
    listIndex: null,
    listLength: null,
    previousText: null,
    nextText: null,
    ancestorLabel: null,
    cssPath: null,
  };
}

function buildBrowserSelectedElementPreviewFromAnnotation(
  attachment: Pick<
    BrowserEvidenceAttachmentLike,
    "title" | "url" | "primaryContent" | "visibleTextExcerpt" | "readableBlocks"
  >,
  annotation: BrowserUserAnnotation,
): BrowserSelectedElementPreview {
  const elementName = elementNameFromAnnotation(annotation);
  const role = annotation.nearestElement?.role ?? null;
  const size = formatRegionSize(annotation.region);
  const boundsLabel = formatRegionBounds(annotation.region);
  const title = selectedElementTitle(annotation);
  const body = selectedElementBody(annotation, title, pageContextTexts(attachment));
  const kind = selectedElementKind(annotation);
  const locate = resolveSelectionLocate(annotation);
  const meta = [
    elementName,
    role ? `role=${role}` : null,
    size,
  ].filter((value): value is string => Boolean(value)).join(" · ");
  const sourceTitle = annotation.title || attachment.title || attachment.url;
  const sourceUrl = annotation.url || attachment.url;
  const copySafeText = [
    "Selected browser element:",
    "- intent: user pointed at this exact page target; treat it as the subject of the question",
    `- text: ${body}`,
    `- element: ${meta || elementName}`,
    locate
      ? `- documentPosition: x=${formatRoundedNumber(locate.documentX)} y=${formatRoundedNumber(locate.documentY)}`
      : null,
    locate
      ? `- viewportBox: x=${formatRoundedNumber(locate.viewportX)} y=${formatRoundedNumber(locate.viewportY)} w=${formatRoundedNumber(locate.width)} h=${formatRoundedNumber(locate.height)}`
      : boundsLabel
        ? `- bounds: ${boundsLabel}`
        : null,
    locate && locate.listIndex && locate.listLength
      ? `- inList: ${locate.listIndex} of ${locate.listLength}`
      : null,
    locate?.previousText ? `- previous: ${locate.previousText}` : null,
    locate?.nextText ? `- next: ${locate.nextText}` : null,
    locate?.ancestorLabel ? `- ancestor: ${locate.ancestorLabel}` : null,
    locate?.cssPath
      ? `- cssPath: ${locate.cssPath}`
      : annotation.nearestElement?.selectorHint
        ? `- selector: ${annotation.nearestElement.selectorHint}`
        : null,
    annotation.nearestElement?.hrefOrigin
      ? `- href origin: ${annotation.nearestElement.hrefOrigin}`
      : null,
    `- source: ${sourceTitle}`,
    `- url: ${sourceUrl}`,
  ].filter((value): value is string => Boolean(value)).join("\n");
  return {
    annotationId: annotation.annotationId,
    title,
    body,
    kind,
    elementName,
    role,
    meta,
    boundsLabel,
    selectorHint: annotation.nearestElement?.selectorHint ?? null,
    hrefOrigin: annotation.nearestElement?.hrefOrigin ?? null,
    sourceTitle,
    sourceUrl,
    locate,
    copySafeText,
  };
}

export function buildBrowserSelectedElementPreviews(
  attachment: Pick<
    BrowserEvidenceAttachmentLike,
    "title" | "url" | "annotations" | "primaryContent" | "visibleTextExcerpt" | "readableBlocks"
  >,
): BrowserSelectedElementPreview[] {
  return dedupeBrowserUserAnnotations(attachment.annotations ?? [])
    .filter((annotation) => annotation.anchor === "element")
    .map((annotation) => buildBrowserSelectedElementPreviewFromAnnotation(attachment, annotation));
}



function buildSection(
  sectionId: string,
  title: string,
  state: BrowserObservationState,
  items: string[],
  truncated = false,
  emptyReason = EMPTY_REASON_NONE_CAPTURED,
): BrowserEvidenceViewModelSection {
  const boundedItems = items.map((item) => compactEvidenceText(item));
  return {
    sectionId,
    title,
    state: boundedItems.length > 0 ? state : "empty",
    items: boundedItems,
    truncated,
    copySafeText: boundedItems.join("\n"),
    emptyReason: boundedItems.length > 0 ? null : emptyReason,
  };
}

export function buildBrowserEvidenceViewModel(
  attachment: BrowserEvidenceAttachmentLike,
): BrowserEvidenceViewModel {
  const observationState = attachment.observation?.state ?? (attachment.stale ? "stale" : "available");
  const staleReasons = attachment.observation?.staleReasons ?? [];
  const selectedElements = buildBrowserSelectedElementPreviews(attachment);
  const elementCounts = attachment.elementCounts ?? {
    headings: 0,
    links: 0,
    buttons: 0,
    forms: 0,
    landmarks: 0,
    codeCandidates: attachment.codeCandidates?.length ?? 0,
    readableBlocks: attachment.readableBlocks?.length ?? 0,
    visualEvidence: attachment.visualEvidence?.length ?? 0,
    annotations: attachment.annotations?.length ?? 0,
  };
  const budget = attachment.budget ?? {
    charLimit: 0,
    visibleTextLimit: 0,
    elementLimit: 0,
    formFieldLimit: 0,
    diagnosticLimit: 0,
    tokenEstimate: null,
    truncated: false,
    omittedElementCount: 0,
  };
  const privacy = attachment.privacy ?? {
    redactionApplied: false,
    redactedKinds: [],
    omittedKinds: [],
  };
  const overviewItems = [
    `${attachment.title || attachment.url}`,
    `URL: ${attachment.url}`,
    `Observation: ${observationState}`,
    staleReasons.length > 0
      ? `Stale reasons: ${staleReasons.join(", ")}`
      : "Stale reasons: none",
  ];
  const interactiveItems = [
    `Headings: ${elementCounts.headings}`,
    `Links: ${elementCounts.links}`,
    `Buttons: ${elementCounts.buttons}`,
    `Forms: ${elementCounts.forms}`,
    `Landmarks: ${elementCounts.landmarks}`,
  ];
  const visualItems = (attachment.visualEvidence ?? []).map((item) =>
    [
      `${item.kind}: ${item.label}`,
      item.altText ? `alt=${item.altText}` : "",
      item.srcOrigin ? `origin=${item.srcOrigin}` : "",
      item.nearbyText ? `nearby=${item.nearbyText}` : "",
    ].filter(Boolean).join("; "),
  );
  const screenshotItems = (attachment.screenshotRefs ?? []).map((item) =>
    `screenshotRef: ${item.refId}; storage=${item.storage}; modelPayloadAllowed=${item.modelPayloadAllowed}`,
  );
  const ocrItems = (attachment.ocrTextSupplements ?? []).map((item) =>
    `ocrText: ${item.text}; screenshotRef=${item.screenshotRefId}; truncated=${item.truncated}; modelPayloadAllowed=${item.modelPayloadAllowed}`,
  );
  const annotationItems = (attachment.annotations ?? []).map((annotation) =>
    [
      `${annotation.anchor}: ${annotation.userNote || "none"}`,
      annotation.region
        ? `region=${annotation.region.x},${annotation.region.y},${annotation.region.width},${annotation.region.height}`
        : "",
      annotation.nearbyText ? `nearby=${annotation.nearbyText}` : "",
      annotation.nearestElement
        ? `nearest=${annotation.nearestElement.role}:${annotation.nearestElement.label ?? "unlabeled"}`
        : "",
      annotation.staleReasons.length > 0
        ? `stale=${annotation.staleReasons.join(",")}`
        : "stale=none",
    ].filter(Boolean).join("; "),
  );
  const diagnosticItems = [
    ...(attachment.observation?.diagnostics ?? []).map(
      (diagnostic) => `${diagnostic.severity}: ${diagnostic.userMessage}`,
    ),
    ...(attachment.diagnostics ?? []).map(
      (diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`,
    ),
    ...(attachment.noiseDiagnostics ?? []).map(
      (diagnostic) => `${diagnostic.severity}: ${diagnostic.kind}; ${diagnostic.message}`,
    ),
  ];
  const privacyBudgetItems = [
    `Transport: ${attachment.observation?.transport ?? "unavailable"}`,
    `Renderer binding: ${attachment.observation?.rendererBinding ?? "unavailable"}`,
    `Budget truncated: ${budget.truncated}`,
    `Omitted elements: ${budget.omittedElementCount}`,
    `Redacted kinds: ${privacy.redactedKinds.join(", ") || "none"}`,
    `Omitted kinds: ${privacy.omittedKinds.join(", ") || "none"}`,
    `Omitted capabilities: ${attachment.observation?.omittedCapabilities.join(", ") || "none"}`,
  ];

  return {
    observationState,
    staleReasons,
    selectedElements,
    selectedElement: selectedElements[0] ?? null,
    overview: buildSection("overview", "Overview", observationState, overviewItems),
    primaryContent: buildSection(
      "primaryContent",
      "Primary content",
      observationState,
      attachment.primaryContent || attachment.visibleTextExcerpt || attachment.summary
        ? [attachment.primaryContent || attachment.visibleTextExcerpt || attachment.summary]
        : [],
      budget.truncated,
    ),
    readableBlocks: buildSection(
      "readableBlocks",
      "Readable blocks",
      observationState,
      (attachment.readableBlocks ?? []).map(
        (block) => `${block.role} score=${block.score}: ${block.text}`,
      ),
      (attachment.readableBlocks ?? []).some((block) => block.truncated),
    ),
    interactiveElements: buildSection(
      "interactiveElements",
      "Interactive elements",
      observationState,
      interactiveItems,
    ),
    visualEvidence: buildSection(
      "visualEvidence",
      "Visual evidence",
      observationState,
      [...visualItems, ...screenshotItems, ...ocrItems],
    ),
    annotations: buildSection(
      "annotations",
      "User annotations",
      observationState,
      annotationItems,
    ),
    codeCandidates: buildSection(
      "codeCandidates",
      "Code candidates",
      observationState,
      (attachment.codeCandidates ?? []).map(
        (candidate) =>
          `${candidate.filePath} (${candidate.reason}, ${candidate.confidence})${candidate.matchedText ? `: ${candidate.matchedText}` : ""}${candidate.explanation ? `; ${candidate.explanation}` : ""}`,
      ),
    ),
    diagnostics: buildSection(
      "diagnostics",
      "Diagnostics",
      observationState,
      diagnosticItems,
    ),
    privacyBudget: buildSection(
      "privacyBudget",
      "Privacy and budget",
      observationState,
      privacyBudgetItems,
      budget.truncated,
    ),
  };
}



export function buildBrowserEvidenceViewModelFromTaskRunEvidence(
  evidence: TaskRunBrowserEvidenceRef,
): BrowserEvidenceViewModel {
  const redactedKinds = (evidence.redactedKinds ?? []).filter(
    (kind): kind is BrowserPrivacyReport["redactedKinds"][number] =>
      kind === "password" ||
      kind === "token" ||
      kind === "cookie" ||
      kind === "authorization" ||
      kind === "hidden_input" ||
      kind === "email" ||
      kind === "phone" ||
      kind === "secret_like" ||
      kind === "unknown",
  );
  return buildBrowserEvidenceViewModel({
    title: evidence.title ?? evidence.url,
    url: evidence.url,
    capturedAt: evidence.capturedAt,
    stale: evidence.state !== "available",
    summary: evidence.summary ?? evidence.url,
    visibleTextExcerpt: evidence.summary ?? evidence.url,
    observation: {
      schemaVersion: 1,
      observationId: evidence.attachmentId,
      browserSessionId: evidence.browserSessionId,
      workspaceId: "task-run",
      capturedAt: evidence.capturedAt,
      state: evidence.state === "deleted" ? "unsupported" : evidence.state,
      staleReasons: evidence.state === "available" ? [] : ["capture_degraded"],
      transport: "metadata_fallback",
      rendererBinding: "unavailable",
      source: {
        url: evidence.url,
        normalizedUrl: evidence.url,
        origin: null,
        title: evidence.title ?? null,
        tabLabel: evidence.title ?? evidence.url,
        workspaceLocalAllowed: false,
      },
      budget: {
        charLimit: 0,
        visibleTextLimit: 0,
        elementLimit: 0,
        formFieldLimit: 0,
        diagnosticLimit: evidence.diagnostics?.length ?? 0,
        tokenEstimate: null,
        truncated: false,
        omittedElementCount: 0,
      },
      privacy: {
        redactionApplied: redactedKinds.length > 0,
        redactedKinds,
        omittedKinds: [],
      },
      diagnostics: (evidence.diagnostics ?? []).map((message, index) => ({
        diagnosticId: `task-run-browser-evidence-${index + 1}`,
        severity: "warning",
        userMessage: message,
        aiMessage: message,
      })),
      omittedCapabilities: [],
    },
    codeCandidates: evidence.codeCandidates?.map((candidate, index) => ({
      candidateId: `task-run-candidate-${index + 1}`,
      filePath: candidate.filePath,
      symbolName: null,
      reason: candidate.reason,
      confidence: candidate.confidence,
      matchedText: candidate.matchedText ?? null,
      sourceEvidence: candidate.sourceEvidence ?? [],
      explanation: candidate.explanation,
      openAction: candidate.openAction ?? null,
    })),
    privacy: {
      redactionApplied: redactedKinds.length > 0,
      redactedKinds,
      omittedKinds: [],
    },
    diagnostics: (evidence.diagnostics ?? []).map((message, index) => ({
      diagnosticId: `task-run-browser-diagnostic-${index + 1}`,
      severity: "warning",
      message,
    })),
  });
}
