import React from "react";
import ReactDOM from "react-dom/client";
import { recordHotspotSample } from "./services/perfBaseline/hotspotTracker";
import {
  preloadCriticalClientStores,
  preloadDeferredClientStores,
} from "./services/clientStorage";
import { runClientStoreMaintenance } from "./services/clientStoreMaintenance";
import {
  pushGlobalRuntimeNotice,
  type GlobalRuntimeNoticeSeverity,
} from "./services/globalRuntimeNotices";
import { migrateLocalStorageToFileStore } from "./services/migrateLocalStorage";
import { initInputHistoryStore } from "./features/composer/hooks/useInputHistoryStore";
import { ErrorBoundary } from "./components/ErrorBoundary";
import {
  appendRendererDiagnostic,
  flushRendererDiagnosticsBuffer,
  installMainThreadStallWatchdog,
  startRendererBlankScreenWatchdog,
} from "./services/rendererDiagnostics";
import {
  recordStartupMilestone,
  recordStartupTaskTrace,
  type StartupPhase,
} from "./features/startup-orchestration/utils/startupTrace";
import { recordStartupPerfMarker } from "./services/perfBaseline/startupMarkers";
import { scheduleFullMarkdownRuntimePrewarm } from "./markdown/prewarmFullMarkdownRuntime";
import { subscribeStartupGateReady } from "./features/startup-orchestration/utils/startupGateReady";

function renderBootstrapFallback(error: unknown) {
  const root = document.getElementById("root");
  if (!root) {
    console.error("[bootstrap] Failed before root mount and root element is missing:", error);
    return;
  }

  const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "#0d0d0d",
          color: "#e2e8f0",
          fontFamily: "ui-monospace, monospace",
          fontSize: 13,
          padding: 32,
          overflow: "auto",
        }}
      >
        <h2 style={{ color: "#f87171", margin: "0 0 12px", fontSize: 18 }}>Application Startup Error</h2>
        <p style={{ color: "#94a3b8", margin: "0 0 16px" }}>
          The app failed to initialize. Please reload and try again.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            padding: "8px 16px",
            background: "#1e293b",
            color: "#e2e8f0",
            border: "1px solid #334155",
            borderRadius: 6,
            cursor: "pointer",
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          Reload
        </button>
        <pre
          style={{
            margin: 0,
            padding: 12,
            background: "#1e1e2e",
            borderRadius: 6,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
            lineHeight: 1.5,
            color: "#f87171",
          }}
        >
          {errorMessage}
        </pre>
      </div>
    </React.StrictMode>,
  );
}

function resolveRootElement() {
  const root = document.getElementById("root");
  if (!(root instanceof HTMLElement)) {
    throw new Error("Bootstrap root element #root is missing");
  }
  return root;
}

function pushBootstrapNotice(
  messageKey: string,
  severity: GlobalRuntimeNoticeSeverity = "info",
) {
  pushGlobalRuntimeNotice({
    severity,
    category: "bootstrap",
    messageKey,
    dedupeKey: `bootstrap:${messageKey}`,
  });
}

async function markRendererReady() {
  try {
    const { invoke, isTauri } = await import("@tauri-apps/api/core");
    if (!isTauri()) {
      return;
    }
    await invoke("bootstrap_mark_renderer_ready");
    appendRendererDiagnostic("bootstrap/renderer-ready-marked");
  } catch (error) {
    appendRendererDiagnostic("bootstrap/renderer-ready-mark-failed", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

async function traceBootstrapTask<T>(
  taskId: string,
  traceLabel: string,
  run: () => Promise<T> | T,
  phase: StartupPhase = "critical",
): Promise<T> {
  const startedAt = nowMs();
  recordStartupTaskTrace({
    type: "task",
    taskId,
    phase,
    traceLabel,
    workspaceScope: "global",
    lifecycleState: "started",
    durationMs: null,
    fallbackReason: null,
    cancellationMode: null,
    commandLabel: null,
  });
  try {
    const result = await run();
    recordStartupTaskTrace({
      type: "task",
      taskId,
      phase,
      traceLabel,
      workspaceScope: "global",
      lifecycleState: "completed",
      durationMs: nowMs() - startedAt,
      fallbackReason: null,
      cancellationMode: null,
      commandLabel: null,
    });
    return result;
  } catch (error) {
    recordStartupTaskTrace({
      type: "task",
      taskId,
      phase,
      traceLabel,
      workspaceScope: "global",
      lifecycleState: "failed",
      durationMs: nowMs() - startedAt,
      fallbackReason: "failure",
      cancellationMode: null,
      commandLabel: null,
    });
    throw error;
  }
}

async function runPostRenderBootstrapTasks() {
  pushBootstrapNotice("runtimeNotice.bootstrap.storageMigrationCheck");
  try {
    await traceBootstrapTask("bootstrap:migration", "migration", () => {
      migrateLocalStorageToFileStore();
    }, "first-paint");
  } catch (error) {
    appendRendererDiagnostic("bootstrap/local-storage-migration-failed", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    pushBootstrapNotice("runtimeNotice.bootstrap.localStorageMigrationFailed", "warning");
    console.error("[bootstrap] localStorage migration failed after shell mount:", error);
  }

  pushBootstrapNotice("runtimeNotice.bootstrap.inputHistoryRestore");
  try {
    await traceBootstrapTask("bootstrap:input-history", "input-history", initInputHistoryStore, "first-paint");
    appendRendererDiagnostic("bootstrap/input-history-ready");
  } catch (error) {
    appendRendererDiagnostic("bootstrap/input-history-failed", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

function scheduleAfterStartupGateReady(run: () => void, options?: {
  idleTimeoutMs?: number;
  fallbackDelayMs?: number;
  busyTimeoutMs?: number;
}): () => void {
  let started = false;
  let idleHandle: number | null = null;
  let timeoutHandle: number | null = null;
  const start = () => {
    if (started) {
      return;
    }
    started = true;
    cleanup();
    run();
  };
  const armIdle = () => {
    if (started || typeof window === "undefined") {
      return;
    }
    if (typeof window.requestIdleCallback === "function") {
      idleHandle = window.requestIdleCallback(start, {
        timeout: options?.idleTimeoutMs ?? 8_000,
      });
      timeoutHandle = window.setTimeout(start, options?.busyTimeoutMs ?? 12_000);
      return;
    }
    timeoutHandle = window.setTimeout(start, options?.fallbackDelayMs ?? 2_500);
  };
  const unsubscribeGate = subscribeStartupGateReady(() => {
    armIdle();
  });
  const cleanup = () => {
    unsubscribeGate();
    if (typeof window === "undefined") {
      return;
    }
    if (idleHandle != null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleHandle);
    }
    if (timeoutHandle != null) {
      window.clearTimeout(timeoutHandle);
    }
  };
  return cleanup;
}

async function runDeferredClientStoreHydration() {
  try {
    await traceBootstrapTask(
      "bootstrap:storage-deferred",
      "storage-deferred",
      preloadDeferredClientStores,
      "first-paint",
    );
    runClientStoreMaintenance();
    flushRendererDiagnosticsBuffer();
    appendRendererDiagnostic("bootstrap/deferred-stores-ready");
  } catch (error) {
    appendRendererDiagnostic("bootstrap/deferred-stores-failed", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
}

async function bootstrap() {
  appendRendererDiagnostic("bootstrap/start");
  pushBootstrapNotice("runtimeNotice.bootstrap.start");
  const appImportPromise = traceBootstrapTask("bootstrap:app-import", "app-import", () => import("./App"));
  const criticalStoresPromise = traceBootstrapTask(
    "bootstrap:storage-critical",
    "storage-critical",
    preloadCriticalClientStores,
  );
  const i18nImportPromise = traceBootstrapTask("bootstrap:i18n-critical", "i18n-critical", async () => {
    const module = await import("./i18n");
    await module.i18nCriticalReady;
    return module;
  });
  void appImportPromise.catch(() => undefined);
  void criticalStoresPromise.catch(() => undefined);
  void i18nImportPromise.catch(() => undefined);
  const [appModule, i18nModule] = await Promise.all([
    appImportPromise,
    i18nImportPromise,
    criticalStoresPromise,
  ]).then(([loadedApp, loadedI18n]) => [loadedApp, loadedI18n] as const);
  const { default: App } = appModule;
  appendRendererDiagnostic("bootstrap/preload-complete");
  pushBootstrapNotice("runtimeNotice.bootstrap.interfaceResources");
  appendRendererDiagnostic("bootstrap/i18n-critical-ready");
  pushBootstrapNotice("runtimeNotice.bootstrap.mountShell");
  const root = resolveRootElement();
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      {/* 根 Profiler:把每次 React commit 的 actualDuration 记入 hotspotTracker,
          掉帧现场可回答"这段时间 React 渲染花了多少毫秒"。生产版 react-dom 的
          Profiler onRender 是 no-op,零开销;dev 下仅记录 ≥4ms 的 commit。 */}
      <React.Profiler
        id="app-root"
        onRender={(_id, phase, actualDuration) => {
          recordHotspotSample("react-commit", actualDuration, phase);
        }}
      >
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.Profiler>
    </React.StrictMode>,
  );
  appendRendererDiagnostic("bootstrap/render-committed");
  installMainThreadStallWatchdog(2_000);
  startRendererBlankScreenWatchdog({
    rootId: "root",
    // getBoundingClientRect + getComputedStyle force synchronous layout on
    // WebView2 (Chromium Blink).  During cold start the StartupGate overlay
    // covers everything so blank-screen detection is worthless; defer until
    // the gate window closes (first-paint ~4.4s, force-enter at 10s, uiScale
    // phase-2 at 12s ceiling).
    startDelayMs: 15_000,
  });
  recordStartupMilestone("shell-ready");
  recordStartupPerfMarker("first-paint");
  pushBootstrapNotice("runtimeNotice.bootstrap.ready");
  void markRendererReady();
  void runPostRenderBootstrapTasks();
  scheduleAfterStartupGateReady(() => {
    void runDeferredClientStoreHydration();
    void i18nModule.ensureI18nReady().catch((error) => {
      appendRendererDiagnostic("bootstrap/i18n-deferred-failed", {
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      });
    });
  }, {
    idleTimeoutMs: 2_500,
    fallbackDelayMs: 800,
    busyTimeoutMs: 4_000,
  });
  scheduleDeferredBaiduTongji();
  // Cold-start: warm the vendor-markdown chunk during idle once the startup
  // gate opens, so the first message render does not compile it on the
  // user's first-click path (no-op until startup-gate-ready).
  scheduleFullMarkdownRuntimePrewarm();
}

/**
 * P1-2: install analytics after shell-ready on idle / first interaction,
 * never on the synchronous cold-start critical path.
 */
function scheduleDeferredBaiduTongji() {
  scheduleAfterStartupGateReady(() => {
    void import("./services/baiduTongji")
      .then(({ installBaiduTongji }) => {
        installBaiduTongji();
      })
      .catch((error) => {
        console.warn(
          "[bootstrap] deferred Baidu Tongji install failed",
          error instanceof Error ? error.message : String(error),
        );
      });
  });
}

export async function startApp() {
  try {
    await bootstrap();
  } catch (error) {
    appendRendererDiagnostic("bootstrap/failed", {
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    pushBootstrapNotice("runtimeNotice.bootstrap.failed", "error");
    flushRendererDiagnosticsBuffer();
    console.error("[bootstrap] Startup failed:", error);
    renderBootstrapFallback(error);
  }
}
