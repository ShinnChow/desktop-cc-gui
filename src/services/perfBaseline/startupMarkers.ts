// Import only the lightweight enablement module — never the perfBaseline barrel /
// index. Barrel co-chunking with mermaid diagram facades previously forced
// vendor-mermaid onto bootstrapApp's static graph (cold-start P0-1).
import {
  isPerfBaselineEnabled,
  PERF_BASELINE_SCHEMA_VERSION,
} from "./perfBaselineEnabled";

export type StartupPerfMarkerName = "first-paint" | "first-interactive";

export type StartupPerfMarker = {
  name: StartupPerfMarkerName;
  atMs: number;
};

export type StartupPerfSnapshot = {
  schemaVersion: typeof PERF_BASELINE_SCHEMA_VERSION;
  source: "startup-perf-markers";
  markers: StartupPerfMarker[];
  platform: string;
};

declare global {
  interface Window {
    __CCGUI_STARTUP_PERF__?: StartupPerfSnapshot;
  }
}

const PERFORMANCE_MARK_PREFIX = "ccgui";
const startupPerfMarkers: StartupPerfMarker[] = [];

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function getPlatformLabel() {
  if (typeof navigator === "undefined") {
    return "unknown";
  }
  const platform = navigator.platform || "unknown";
  return platform.slice(0, 80);
}

function writeWindowSnapshot() {
  if (typeof window === "undefined") {
    return;
  }
  const snapshot: StartupPerfSnapshot = {
    schemaVersion: PERF_BASELINE_SCHEMA_VERSION,
    source: "startup-perf-markers",
    markers: startupPerfMarkers.slice(),
    platform: getPlatformLabel(),
  };
  window.__CCGUI_STARTUP_PERF__ = snapshot;
  // Dynamic import keeps rendererDiagnostics (heavy) off the bootstrap static graph.
  void import("../rendererDiagnostics")
    .then(({ appendRendererDiagnostic }) => {
      appendRendererDiagnostic("perf.startup.markers", snapshot);
    })
    .catch(() => {
      // Diagnostics are best-effort during cold start.
    });
}

export function recordStartupPerfMarker(name: StartupPerfMarkerName) {
  if (!isPerfBaselineEnabled()) {
    return null;
  }
  if (startupPerfMarkers.some((marker) => marker.name === name)) {
    return startupPerfMarkers.find((marker) => marker.name === name) ?? null;
  }
  const marker = {
    name,
    atMs: nowMs(),
  };
  startupPerfMarkers.push(marker);
  if (typeof performance !== "undefined" && typeof performance.mark === "function") {
    try {
      performance.mark(`${PERFORMANCE_MARK_PREFIX}:${name}`);
    } catch {
      // `performance.mark` may be unavailable in constrained test/webview contexts.
    }
  }
  writeWindowSnapshot();
  return marker;
}



export function resetStartupPerfMarkersForTests() {
  startupPerfMarkers.length = 0;
  if (typeof window !== "undefined") {
    delete window.__CCGUI_STARTUP_PERF__;
  }
}
