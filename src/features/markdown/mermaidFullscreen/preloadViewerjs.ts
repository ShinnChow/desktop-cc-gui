import type Viewer from "viewerjs";

/**
 * Cached module-level Promise so that repeated preloads (e.g. every time a
 * Mermaid block successfully renders) do not retrigger `import("viewerjs")`.
 * The first call kicks off the dynamic import; subsequent calls return the
 * same Promise. This removes the ~50-200ms first-click latency users would
 * otherwise see when opening the fullscreen viewer for the first time.
 */
let viewerjsPromise: Promise<typeof import("viewerjs")> | null = null;

export function preloadViewerjs(): Promise<{ default: typeof Viewer }> {
  if (!viewerjsPromise) {
    viewerjsPromise = import("viewerjs");
  }
  return viewerjsPromise;
}


