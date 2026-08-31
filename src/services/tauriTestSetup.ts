import { beforeEach, vi } from "vitest";

const rendererDiagnosticsMocks = vi.hoisted(() => ({
  appendRendererDiagnostic: vi.fn(),
}));

vi.mock("./rendererDiagnostics", () => rendererDiagnosticsMocks);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { resetRuntimeModeStateForTests } from "./tauri/runtimeMode";
import { resetStartupTraceForTests } from "../features/startup-orchestration/utils/startupTrace";

export { rendererDiagnosticsMocks };

export function authorizationContinuity() {
  return {
    kind: "matching_host",
    diagnosticMessage:
      "current host matches the last successful authorization host",
    currentHost: {
      displayName: "ccgui.app",
      executablePath: "/Applications/ccgui.app/Contents/MacOS/cc-gui",
      identifier: "com.codex.ccgui",
      teamIdentifier: "TEAM123",
      backendMode: "local",
      hostRole: "foreground_app",
      launchMode: "packaged_app",
      signingSummary: "Authority=Developer ID Application: Demo",
    },
    lastSuccessfulHost: {
      displayName: "ccgui.app",
      executablePath: "/Applications/ccgui.app/Contents/MacOS/cc-gui",
      identifier: "com.codex.ccgui",
      teamIdentifier: "TEAM123",
      backendMode: "local",
      hostRole: "foreground_app",
      launchMode: "packaged_app",
      signingSummary: "Authority=Developer ID Application: Demo",
    },
    driftFields: [],
  };
}

export function setWebRuntimeFlag(value: boolean) {
  const globalRef = globalThis as any;
  if (!globalRef.window) {
    globalRef.window = {};
  }
  globalRef.window.__MOSSX_WEB_SERVICE__ = value;
}

export function clearWebRuntimeFlag() {
  const globalRef = globalThis as any;
  if (!globalRef.window) {
    return;
  }
  delete globalRef.window.__MOSSX_WEB_SERVICE__;
}

export function setupTauriInvokeWrapperTestState() {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWebRuntimeFlag();
    resetRuntimeModeStateForTests();
    resetStartupTraceForTests();
  });
}
