import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  compileFastMarkdown,
  FileMarkdownFastPreview,
  FAST_MARKDOWN_RENDERER_LIMITS,
  type FastMarkdownFeatureFlags,
  type FastMarkdownRendererProfileId,
  type MarkdownOutlineEntry,
} from "../../markdown/fastMarkdownRenderer";
import {
  FileMarkdownPreviewRich,
  type FileMarkdownPreviewRichProps,
} from "./FileMarkdownPreview";
import { PreviewOutlineSidebar } from "./PreviewOutlineSidebar";
import type { PreviewOutlineItem } from "../utils/filePreviewOutline";



const LOCAL_MARKDOWN_IMAGE_TARGET_REGEX =
  /\.(?:apng|avif|bmp|gif|jpe?g|png|svg|webp)(?:[?#][^\s)]*)?$/i;
const BROWSER_IMAGE_TARGET_REGEX = /^(?:https?:|data:|blob:|asset:)/i;
const OUTLINE_REVEAL_LINE_PADDING = 80;
const EMPTY_ANNOTATIONS: NonNullable<
  FileMarkdownPreviewRichProps["annotations"]
> = [];

export type FileMarkdownPreviewProps = FileMarkdownPreviewRichProps & {
  /**
   * Profile id for the renderer. The canonical router decides whether to
   * mount the fast path or the rich path based on this value:
   *
   * - `"fast-html"`, `"bounded-fast-html"` → mount the fast
   *   `FileMarkdownFastPreview`. If the fast path reports a
   *   fallback (compile failure, sanitizer failure, or profile
   *   mismatch), the wrapper degrades to the rich path
   *   automatically.
   * - `"rich-react"`, `"low-cost-readable"`, or `undefined` →
   *   mount `FileMarkdownPreviewRich` directly.
   *
   * Leave `undefined` to use the existing default (rich path).
   */
  rendererProfile?: FastMarkdownRendererProfileId;
  featureFlags?: FastMarkdownFeatureFlags;
  /**
   * Optional callback fired when the fast path degrades to the
   * rich path. Useful for telemetry / debugging during the
   * opt-in rollout.
   */
  onFastRendererFallback?: (reason: string) => void;
  /**
   * i18n translator function. Required when the outline sidebar
   * is rendered (fast path with headings).
   */
  t?: (key: string, options?: Record<string, unknown>) => string;
};

/**
 * Canonical router for file-preview Markdown rendering.
 *
 * It routes rendering
 * through the fast HTML renderer when a fast profile is selected,
 * and degrades to the existing rich ReactMarkdown path otherwise.
 *
 * according to the following decision tree:
 *
 * 1. `rendererProfile` is undefined or one of the rich profiles
 *    (`rich-react`, `low-cost-readable`) → render the rich path.
 * 2. `rendererProfile` is a fast profile (`fast-html`,
 *    `bounded-fast-html`) → render the fast path. The fast path
 *    uses `FileMarkdownFastPreview` which fails closed via the
 *    `onShouldFallback` callback; this wrapper then re-renders
 *    with the rich path on the next tick.
 *
 * When the fast path is active and the document contains headings,
 * a table-of-contents sidebar is rendered alongside the document
 * surface. The outline is derived from the parser (mdast) before
 * HTML is generated, matching the yn-project approach.
 *
 * The router lives in `features/files/components/` (not in
 * `features/markdown/fastMarkdownRenderer/`) to avoid a circular
 * import: the rich path imports from the fast renderer module,
 * so the router has to live "above" both.
 */
export function FileMarkdownPreview({
  value,
  documentKey,
  className,
  workspaceId,
  sourceFilePath,
  rendererProfile,
  featureFlags,
  onFastRendererFallback,
  t,
  onAnnotationStart,
  annotationDraft = null,
  annotations = EMPTY_ANNOTATIONS,
  renderAnnotationDraft,
  renderAnnotationMarker,
  annotationActionLabel,
  renderPressure,
}: FileMarkdownPreviewProps) {
  const [shouldFallBackToRichPath, setShouldFallBackToRichPath] = useState(false);
  const [fastOutline, setFastOutline] = useState<PreviewOutlineItem[]>([]);
  const [richOutline, setRichOutline] = useState<PreviewOutlineItem[]>([]);
  const [activeOutlineItemId, setActiveOutlineItemId] = useState<string | null>(null);
  const [isOutlinePinned, setIsOutlinePinned] = useState(false);
  const [isOutlineCollapsed, setIsOutlineCollapsed] = useState(true);
  const [boundedFastLineLimit, setBoundedFastLineLimit] = useState(
    FAST_MARKDOWN_RENDERER_LIMITS.DEFAULT_BOUNDED_LINE_LIMIT,
  );
  const [pendingFastOutlineAnchorId, setPendingFastOutlineAnchorId] = useState<string | null>(null);
  const fastPreviewRootRef = useRef<HTMLDivElement | null>(null);
  const richPreviewRootRef = useRef<HTMLDivElement | null>(null);
  const previousOutlineLengthRef = useRef(0);
  const reportedLocalFallbackRef = useRef<string | null>(null);

  const handleFastRendererFallback = useCallback(
    (reason: string) => {
      if (onFastRendererFallback) {
        onFastRendererFallback(reason);
      }
      setShouldFallBackToRichPath(true);
    },
    [onFastRendererFallback],
  );

  const handleOutlineReady = useCallback((outline: MarkdownOutlineEntry[]) => {
    const previewItems = convertMdastOutlineToPreviewItems(outline);
    setFastOutline(previewItems);
  }, []);

  const isFastProfile =
    rendererProfile === "fast-html" || rendererProfile === "bounded-fast-html";
  const localFallbackReason = isFastProfile
    ? hasLocalMarkdownImageReference(value)
        ? "local-image-rich-fallback"
        : null
    : null;
  const useFastPath =
    isFastProfile && !shouldFallBackToRichPath && localFallbackReason === null;
  const activeOutline = useFastPath ? fastOutline : richOutline;
  const shouldRenderOutline = activeOutline.length > 0;
  const sidebarTitle = translatePreviewLabel(t, "files.previewOutlineTitle", "Outline");
  const emptyLabel = translatePreviewLabel(
    t,
    "files.documentPreviewOutlineEmpty",
    "No headings",
  );
  const expandOutlineLabel = translatePreviewLabel(
    t,
    "files.markdownPreviewExpandOutline",
    "Show outline",
  );
  const collapseOutlineLabel = translatePreviewLabel(
    t,
    "files.markdownPreviewCollapseOutline",
    "Hide outline",
  );
  const pinOutlineLabel = translatePreviewLabel(
    t,
    "files.markdownPreviewPinOutline",
    "Pin outline",
  );
  const unpinOutlineLabel = translatePreviewLabel(
    t,
    "files.markdownPreviewUnpinOutline",
    "Unpin outline",
  );
  const richOutlineFeatureFlags = useMemo(
    () => ({
      fastHtmlRendererEnabled: featureFlags?.fastHtmlRendererEnabled === true,
      boundedFastHtmlRendererEnabled: featureFlags?.boundedFastHtmlRendererEnabled === true,
    }),
    [
      featureFlags?.boundedFastHtmlRendererEnabled,
      featureFlags?.fastHtmlRendererEnabled,
    ],
  );

  useEffect(() => {
    setShouldFallBackToRichPath(false);
    setFastOutline([]);
    setRichOutline([]);
    setActiveOutlineItemId(null);
    setIsOutlinePinned(false);
    setIsOutlineCollapsed(true);
    setBoundedFastLineLimit(FAST_MARKDOWN_RENDERER_LIMITS.DEFAULT_BOUNDED_LINE_LIMIT);
    setPendingFastOutlineAnchorId(null);
    previousOutlineLengthRef.current = 0;
    reportedLocalFallbackRef.current = null;
  }, [documentKey, rendererProfile, value]);

  useEffect(() => {
    if (!localFallbackReason || reportedLocalFallbackRef.current === localFallbackReason) {
      return;
    }
    reportedLocalFallbackRef.current = localFallbackReason;
    onFastRendererFallback?.(`fast-renderer-fallback:${localFallbackReason}`);
  }, [localFallbackReason, onFastRendererFallback]);

  useEffect(() => {
    if (useFastPath) {
      return;
    }
    let isCurrentRequest = true;
    const outlineDocumentKey = documentKey ?? "file-markdown-preview-outline";
    void compileFastMarkdown({
      documentKey: outlineDocumentKey,
      rawMarkdown: value,
      rendererProfile: "rich-react",
      featureFlags: richOutlineFeatureFlags,
    })
      .then((result) => {
        if (!isCurrentRequest) {
          return;
        }
        setRichOutline(convertMdastOutlineToPreviewItems(result.outline));
      })
      .catch(() => {
        if (!isCurrentRequest) {
          return;
        }
        setRichOutline([]);
      });
    return () => {
      isCurrentRequest = false;
    };
  }, [documentKey, richOutlineFeatureFlags, useFastPath, value]);

  useEffect(() => {
    if (useFastPath || richOutline.length === 0) {
      return;
    }
    const previewRoot = richPreviewRootRef.current;
    if (!previewRoot) {
      return;
    }
    const headingNodes = Array.from(
      previewRoot.querySelectorAll<HTMLElement>(".fvp-file-markdown h1,.fvp-file-markdown h2,.fvp-file-markdown h3,.fvp-file-markdown h4,.fvp-file-markdown h5,.fvp-file-markdown h6"),
    );
    const outlineItems = flattenPreviewOutlineItems(richOutline);
    outlineItems.forEach((item, index) => {
      const headingNode = headingNodes[index];
      const anchorId =
        item.target.kind === "html-anchor" ? item.target.anchorId : undefined;
      if (!headingNode || !anchorId) {
        return;
      }
      headingNode.id = anchorId;
    });
  }, [richOutline, useFastPath]);

  useEffect(() => {
    const previousOutlineLength = previousOutlineLengthRef.current;
    previousOutlineLengthRef.current = activeOutline.length;

    if (isOutlinePinned) {
      setIsOutlineCollapsed(false);
      return;
    }

    if (previousOutlineLength === 0 && activeOutline.length > 0) {
      setIsOutlineCollapsed(true);
    }
  }, [activeOutline.length, isOutlinePinned]);

  const handleToggleOutlineCollapsed = useCallback(() => {
    setIsOutlineCollapsed((current) => !current);
  }, []);

  const handleToggleOutlinePinned = useCallback(() => {
    setIsOutlinePinned((current) => {
      const nextPinned = !current;
      if (nextPinned) {
        setIsOutlineCollapsed(false);
      }
      return nextPinned;
    });
  }, []);

  const handleOutlineMouseLeave = useCallback(() => {
    if (!isOutlinePinned) {
      setIsOutlineCollapsed(true);
    }
  }, [isOutlinePinned]);

  useEffect(() => {
    if (!useFastPath || !pendingFastOutlineAnchorId) {
      return;
    }
    const articleNode = fastPreviewRootRef.current?.querySelector(".fvp-file-markdown");
    const anchorNode = articleNode?.ownerDocument.getElementById(pendingFastOutlineAnchorId);
    if (!(articleNode instanceof HTMLElement) || !(anchorNode instanceof HTMLElement)) {
      return;
    }
    if (!articleNode.contains(anchorNode)) {
      return;
    }
    anchorNode.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    setPendingFastOutlineAnchorId(null);
  }, [boundedFastLineLimit, fastOutline, pendingFastOutlineAnchorId, useFastPath]);

  const handleSelectOutlineItem = useCallback((item: PreviewOutlineItem) => {
    if (item.target.kind !== "html-anchor") {
      return;
    }
    const articleNode = useFastPath
      ? fastPreviewRootRef.current?.querySelector(".fvp-file-markdown")
      : richPreviewRootRef.current?.querySelector(".fvp-file-markdown");
    if (!articleNode) {
      return;
    }
    let anchorNode: HTMLElement | null = null;
    const documentAnchorNode = articleNode.ownerDocument.getElementById(item.target.anchorId);
    if (documentAnchorNode instanceof HTMLElement && articleNode.contains(documentAnchorNode)) {
      anchorNode = documentAnchorNode;
    }
    if (!anchorNode && !useFastPath) {
      const outlineIndex = flattenPreviewOutlineItems(richOutline).findIndex(
        (outlineItem) => outlineItem.id === item.id,
      );
      const headingNode = articleNode.querySelectorAll<HTMLElement>(
        "h1,h2,h3,h4,h5,h6",
      )[outlineIndex];
      if (headingNode) {
        headingNode.id = item.target.anchorId;
        anchorNode = headingNode;
      }
    }
    if (!anchorNode) {
      const sourceStartLine = item.target.sourceStartLine;
      if (
        useFastPath &&
        rendererProfile === "bounded-fast-html" &&
        typeof sourceStartLine === "number"
      ) {
        setActiveOutlineItemId(item.id);
        setPendingFastOutlineAnchorId(item.target.anchorId);
        setBoundedFastLineLimit((currentLineLimit) =>
          Math.max(currentLineLimit, sourceStartLine + OUTLINE_REVEAL_LINE_PADDING),
        );
        if (!isOutlinePinned) {
          setIsOutlineCollapsed(true);
        }
      }
      return;
    }
    setActiveOutlineItemId(item.id);
    anchorNode.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    if (!isOutlinePinned) {
      setIsOutlineCollapsed(true);
    }
  }, [isOutlinePinned, rendererProfile, richOutline, useFastPath]);

  if (useFastPath) {
    return (
      <div className="fvp-markdown-preview-frame">
        <div className="fvp-markdown-outline-layer">
          {shouldRenderOutline ? (
            <PreviewOutlineSidebar
              title={sidebarTitle}
              emptyLabel={emptyLabel}
              items={fastOutline}
              activeItemId={activeOutlineItemId}
              onSelectItem={handleSelectOutlineItem}
              collapsed={isOutlineCollapsed}
              pinned={isOutlinePinned}
              onToggleCollapsed={handleToggleOutlineCollapsed}
              onTogglePinned={handleToggleOutlinePinned}
              onMouseLeave={handleOutlineMouseLeave}
              expandLabel={expandOutlineLabel}
              collapseLabel={collapseOutlineLabel}
              pinLabel={pinOutlineLabel}
              unpinLabel={unpinOutlineLabel}
            />
          ) : null}
        </div>
        <div
          ref={fastPreviewRootRef}
          className="fvp-preview-scroll fvp-markdown-preview-scroll"
          data-markdown-bounded-line-limit={
            rendererProfile === "bounded-fast-html" ? String(boundedFastLineLimit) : undefined
          }
          data-markdown-pending-outline-anchor={pendingFastOutlineAnchorId ?? undefined}
        >
          <FileMarkdownFastPreview
            value={value}
            documentKey={documentKey}
            className={className}
            rendererProfile={rendererProfile}
            featureFlags={featureFlags}
            boundedLineLimit={
              rendererProfile === "bounded-fast-html" ? boundedFastLineLimit : undefined
            }
            onShouldFallback={handleFastRendererFallback}
            onOutlineReady={handleOutlineReady}
            onAnnotationStart={onAnnotationStart}
            annotationDraft={annotationDraft}
            annotations={annotations}
            renderAnnotationDraft={renderAnnotationDraft}
            renderAnnotationMarker={renderAnnotationMarker}
            annotationActionLabel={annotationActionLabel}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className="fvp-markdown-preview-frame"
      data-markdown-render-profile={rendererProfile ?? "rich-react"}
      data-markdown-fallback-reason={localFallbackReason ?? "none"}
    >
      <div className="fvp-markdown-outline-layer">
        {shouldRenderOutline ? (
          <PreviewOutlineSidebar
            title={sidebarTitle}
            emptyLabel={emptyLabel}
            items={activeOutline}
            activeItemId={activeOutlineItemId}
            onSelectItem={handleSelectOutlineItem}
            collapsed={isOutlineCollapsed}
            pinned={isOutlinePinned}
            onToggleCollapsed={handleToggleOutlineCollapsed}
            onTogglePinned={handleToggleOutlinePinned}
            onMouseLeave={handleOutlineMouseLeave}
            expandLabel={expandOutlineLabel}
            collapseLabel={collapseOutlineLabel}
            pinLabel={pinOutlineLabel}
            unpinLabel={unpinOutlineLabel}
          />
        ) : null}
      </div>
      <div className="fvp-preview-scroll fvp-markdown-preview-scroll">
        <div ref={richPreviewRootRef} className="fvp-preview-main">
          <FileMarkdownPreviewRich
            value={value}
            documentKey={documentKey}
            className={className}
            workspaceId={workspaceId}
            sourceFilePath={sourceFilePath}
            onAnnotationStart={onAnnotationStart}
            annotationDraft={annotationDraft}
            annotations={annotations}
            renderAnnotationDraft={renderAnnotationDraft}
            renderAnnotationMarker={renderAnnotationMarker}
            annotationActionLabel={annotationActionLabel}
            renderPressure={renderPressure}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Convert the flat, parser-derived mdast outline entries into the
 * hierarchical PreviewOutlineItem format expected by the sidebar.
 *
 * The fast renderer generates heading IDs in the form `outline-${index}-${slug}`.
 * The sidebar's click-to-scroll maps the item's `anchorId` onto these IDs.
 */
function convertMdastOutlineToPreviewItems(
  entries: MarkdownOutlineEntry[],
): PreviewOutlineItem[] {
  if (entries.length === 0) {
    return [];
  }

  // Build a parent stack to reconstruct the heading hierarchy.
  const rootItems: PreviewOutlineItem[] = [];
  const parentStack: PreviewOutlineItem[] = [];

  for (const entry of entries) {
    const item: PreviewOutlineItem = {
      id: entry.id,
      title: entry.title,
      level: entry.depth,
      children: [],
      target: {
        kind: "html-anchor",
        anchorId: entry.id,
        sourceStartLine: entry.startLine,
        sourceEndLine: entry.endLine,
      },
    };

    while (
      parentStack.length > 0 &&
      parentStack[parentStack.length - 1]!.level >= entry.depth
    ) {
      parentStack.pop();
    }

    const parent = parentStack[parentStack.length - 1];
    if (parent) {
      parent.children.push(item);
    } else {
      rootItems.push(item);
    }

    parentStack.push(item);
  }

  return rootItems;
}

function flattenPreviewOutlineItems(items: PreviewOutlineItem[]): PreviewOutlineItem[] {
  const flattenedItems: PreviewOutlineItem[] = [];
  const visit = (item: PreviewOutlineItem) => {
    flattenedItems.push(item);
    item.children.forEach(visit);
  };
  items.forEach(visit);
  return flattenedItems;
}

function hasLocalMarkdownImageReference(value: string): boolean {
  const markdownImageRegex = /!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  for (const match of value.matchAll(markdownImageRegex)) {
    if (isLocalImageTarget(match[1] ?? "")) {
      return true;
    }
  }

  const htmlImageRegex = /<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/gi;
  for (const match of value.matchAll(htmlImageRegex)) {
    if (isLocalImageTarget(match[1] ?? match[2] ?? match[3] ?? "")) {
      return true;
    }
  }

  const imageTagRegex = /<image>\s*([\s\S]*?)\s*<\/image>|<image\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s/>]+))[^>]*\/?>/gi;
  for (const match of value.matchAll(imageTagRegex)) {
    if (isLocalImageTarget(match[1] ?? match[2] ?? match[3] ?? match[4] ?? "")) {
      return true;
    }
  }

  return false;
}

function isLocalImageTarget(value: string): boolean {
  const target = value.trim().replace(/^<(.+)>$/, "$1").replace(/^['"](.+)['"]$/, "$1");
  if (!target || BROWSER_IMAGE_TARGET_REGEX.test(target)) {
    return false;
  }
  return LOCAL_MARKDOWN_IMAGE_TARGET_REGEX.test(target.split(/[?#]/, 1)[0] ?? target);
}

function translatePreviewLabel(
  t: FileMarkdownPreviewProps["t"],
  key: string,
  fallback: string,
): string {
  const translated = t?.(key);
  return translated && translated !== key ? translated : fallback;
}
