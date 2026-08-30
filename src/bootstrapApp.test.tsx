// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const createRootMock = vi.hoisted(() => vi.fn());
const renderMock = vi.hoisted(() => vi.fn());
const preloadCriticalClientStoresMock = vi.hoisted(() => vi.fn());
const preloadDeferredClientStoresMock = vi.hoisted(() => vi.fn());
const migrateLocalStorageToFileStoreMock = vi.hoisted(() => vi.fn());
const initInputHistoryStoreMock = vi.hoisted(() => vi.fn());
const appendRendererDiagnosticMock = vi.hoisted(() => vi.fn());
const flushRendererDiagnosticsBufferMock = vi.hoisted(() => vi.fn());
const startRendererBlankScreenWatchdogMock = vi.hoisted(() => vi.fn());
const pushGlobalRuntimeNoticeMock = vi.hoisted(() => vi.fn());
const recordStartupMilestoneMock = vi.hoisted(() => vi.fn());
const subscribeStartupGateReadyMock = vi.hoisted(() => {
  let pending: Array<(reason: string | null) => void> = [];
  const mock = vi.fn((listener: (reason: string | null) => void) => {
    pending.push(listener);
    return () => {
      pending = pending.filter((item) => item !== listener);
    };
  });
  (mock as typeof mock & { flush: (reason?: string | null) => void }).flush = (
    reason = "first-paint-complete",
  ) => {
    const listeners = [...pending];
    pending = [];
    listeners.forEach((listener) => listener(reason));
  };
  (mock as typeof mock & { resetQueue: () => void }).resetQueue = () => {
    pending = [];
  };
  return mock as typeof mock & {
    flush: (reason?: string | null) => void;
    resetQueue: () => void;
  };
});
const recordStartupTaskTraceMock = vi.hoisted(() => vi.fn());
const recordStartupPerfMarkerMock = vi.hoisted(() => vi.fn());
const invokeMock = vi.hoisted(() => vi.fn());
const isTauriMock = vi.hoisted(() => vi.fn(() => false));
const i18nReadyMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: createRootMock,
  },
}));

vi.mock("./services/clientStorage", () => ({
  preloadCriticalClientStores: preloadCriticalClientStoresMock,
  preloadDeferredClientStores: preloadDeferredClientStoresMock,
}));

vi.mock("./services/migrateLocalStorage", () => ({
  migrateLocalStorageToFileStore: migrateLocalStorageToFileStoreMock,
}));

vi.mock("./features/composer/hooks/useInputHistoryStore", () => ({
  initInputHistoryStore: initInputHistoryStoreMock,
}));

vi.mock("./services/rendererDiagnostics", () => ({
  appendRendererDiagnostic: appendRendererDiagnosticMock,
  appendRendererDiagnosticImmediate: vi.fn(),
  flushRendererDiagnosticsBuffer: flushRendererDiagnosticsBufferMock,
  installMainThreadStallWatchdog: vi.fn(),
  startRendererBlankScreenWatchdog: startRendererBlankScreenWatchdogMock,
}));

vi.mock("./services/globalRuntimeNotices", () => ({
  pushGlobalRuntimeNotice: pushGlobalRuntimeNoticeMock,
}));

vi.mock("./features/startup-orchestration/utils/startupTrace", () => ({
  recordStartupMilestone: recordStartupMilestoneMock,
  recordStartupTaskTrace: recordStartupTaskTraceMock,
}));

vi.mock("./features/startup-orchestration/utils/startupGateReady", () => ({
  subscribeStartupGateReady: subscribeStartupGateReadyMock,
}));

vi.mock("./services/perfBaseline/startupMarkers", () => ({
  recordStartupPerfMarker: recordStartupPerfMarkerMock,
}));

vi.mock("./i18n", () => ({
  i18nCriticalReady: Promise.resolve(),
  ensureI18nReady: () => i18nReadyMock(),
  get i18nReady() {
    return i18nReadyMock();
  },
}));

vi.mock("./App", () => ({
  default: () => null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  isTauri: isTauriMock,
}));

vi.mock("./components/ErrorBoundary", () => ({
  ErrorBoundary: ({ children }: { children: unknown }) => children,
}));

describe("startApp", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
    createRootMock.mockReset();
    renderMock.mockReset();
    preloadCriticalClientStoresMock.mockReset();
    preloadCriticalClientStoresMock.mockResolvedValue(undefined);
    preloadDeferredClientStoresMock.mockReset();
    preloadDeferredClientStoresMock.mockResolvedValue(undefined);
    migrateLocalStorageToFileStoreMock.mockReset();
    initInputHistoryStoreMock.mockReset();
    appendRendererDiagnosticMock.mockReset();
    flushRendererDiagnosticsBufferMock.mockReset();
    startRendererBlankScreenWatchdogMock.mockReset();
    pushGlobalRuntimeNoticeMock.mockReset();
    recordStartupMilestoneMock.mockReset();
    subscribeStartupGateReadyMock.resetQueue();
    subscribeStartupGateReadyMock.mockClear();
    recordStartupTaskTraceMock.mockReset();
    recordStartupPerfMarkerMock.mockReset();
    invokeMock.mockReset();
    isTauriMock.mockReset();
    isTauriMock.mockReturnValue(false);
    i18nReadyMock.mockReset();
    i18nReadyMock.mockResolvedValue(undefined);
    createRootMock.mockReturnValue({ render: renderMock });
  });

  it("pushes detailed bootstrap notices during a successful startup", async () => {
    const { startApp } = await import("./bootstrapApp");

    await startApp();

    expect(pushGlobalRuntimeNoticeMock.mock.calls.map(([notice]) => notice.messageKey)).toEqual([
      "runtimeNotice.bootstrap.start",
      "runtimeNotice.bootstrap.interfaceResources",
      "runtimeNotice.bootstrap.mountShell",
      "runtimeNotice.bootstrap.ready",
      "runtimeNotice.bootstrap.storageMigrationCheck",
      "runtimeNotice.bootstrap.inputHistoryRestore",
    ]);
    expect(preloadCriticalClientStoresMock).toHaveBeenCalledTimes(1);
    expect(preloadDeferredClientStoresMock).not.toHaveBeenCalled();
    expect(migrateLocalStorageToFileStoreMock).toHaveBeenCalledTimes(1);
    expect(initInputHistoryStoreMock).toHaveBeenCalledTimes(1);
    expect(createRootMock).toHaveBeenCalledWith(document.getElementById("root"));
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(startRendererBlankScreenWatchdogMock).toHaveBeenCalledWith({
      rootId: "root",
      startDelayMs: 15_000,
    });
    expect(recordStartupMilestoneMock).toHaveBeenCalledWith("shell-ready");
    expect(recordStartupPerfMarkerMock).toHaveBeenCalledWith("first-paint");
    expect(recordStartupTaskTraceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "bootstrap:app-import",
        lifecycleState: "started",
      }),
    );
    expect(recordStartupTaskTraceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "bootstrap:storage-critical",
        lifecycleState: "started",
      }),
    );
  });

  it("mounts the shell before deferred stores and the full locale pack", async () => {
    let resolveDeferredStores: (() => void) | undefined;
    let resolveI18nReady: (() => void) | undefined;
    preloadDeferredClientStoresMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDeferredStores = resolve;
        }),
    );
    i18nReadyMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveI18nReady = resolve;
        }),
    );
    const { startApp } = await import("./bootstrapApp");

    await startApp();

    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(preloadDeferredClientStoresMock).not.toHaveBeenCalled();
    expect(recordStartupPerfMarkerMock).toHaveBeenCalledWith("first-paint");
    expect(subscribeStartupGateReadyMock).toHaveBeenCalled();

    window.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(preloadDeferredClientStoresMock).not.toHaveBeenCalled();

    subscribeStartupGateReadyMock.flush("first-paint-complete");
    await vi.waitFor(() => {
      expect(preloadDeferredClientStoresMock).toHaveBeenCalledTimes(1);
    });
    resolveDeferredStores?.();
    resolveI18nReady?.();
  });

  it("renders the bootstrap fallback and flushes diagnostics when critical preload fails early", async () => {
    const preloadError = new Error("preload failed");
    preloadCriticalClientStoresMock.mockRejectedValue(preloadError);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startApp } = await import("./bootstrapApp");

    await startApp();

    expect(appendRendererDiagnosticMock).toHaveBeenNthCalledWith(1, "bootstrap/start");
    expect(appendRendererDiagnosticMock).toHaveBeenNthCalledWith(2, "bootstrap/failed", {
      error: "Error: preload failed",
    });
    expect(pushGlobalRuntimeNoticeMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        messageKey: "runtimeNotice.bootstrap.start",
      }),
    );
    expect(pushGlobalRuntimeNoticeMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messageKey: "runtimeNotice.bootstrap.failed",
      }),
    );
    expect(flushRendererDiagnosticsBufferMock).toHaveBeenCalledTimes(1);
    expect(createRootMock).toHaveBeenCalledWith(document.getElementById("root"));
    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith("[bootstrap] Startup failed:", preloadError);

    consoleErrorSpy.mockRestore();
  });
});
