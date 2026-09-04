/**
 * Hook-level (caller-side) stale visible-result diagnostics.
 *
 * The adapter is the lifecycle owner. The hook is the latest-source owner:
 * it ignores resolutions from a previous document snapshot because the
 * request ordinal has moved on. Those drops are the user-visible "the
 * content you see should never come from a stale snapshot" guarantee.
 *
 * This store is intentionally separate from the adapter diagnostics so the
 * two evidence classes do not bleed into each other.
 */

export type FastMarkdownHookDiagnostics = {
  staleVisibleResultDropCount: number;
  lastStaleDropAtMs: number | null;
};

const DEFAULT: FastMarkdownHookDiagnostics = {
  staleVisibleResultDropCount: 0,
  lastStaleDropAtMs: null,
};

class HookDiagnosticsStore {
  private state: FastMarkdownHookDiagnostics = { ...DEFAULT };

  snapshot(): FastMarkdownHookDiagnostics {
    return { ...this.state };
  }

  reset(): void {
    this.state = { ...DEFAULT };
  }

  recordStaleVisibleDrop(): void {
    this.state.staleVisibleResultDropCount += 1;
    this.state.lastStaleDropAtMs = Date.now();
  }
}

export const hookDiagnostics = new HookDiagnosticsStore();




