import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendRendererDiagnostic } from "../../../../services/rendererDiagnostics";
import { createFastMarkdownCompileIdentity } from "../compileCore";
import {
  __resetFastMarkdownWorkerBackoffForTests,
  disposeFastMarkdownWorker,
  precomputeFastMarkdownInWorker,
} from "../workerAdapter";
import type { FastMarkdownUnsafeArtifact } from "../types";

vi.mock("../../../../services/rendererDiagnostics", () => ({
  appendRendererDiagnostic: vi.fn(),
}));

type WorkerListener = (event: {
  type: string;
  message?: string;
  error?: unknown;
  data?: unknown;
}) => void;

class FakeWorker {
  static instances: FakeWorker[] = [];
  listeners = new Map<string, WorkerListener[]>();
  lastRequest: { requestId?: string } | null = null;
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: WorkerListener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  removeEventListener() {
    // not needed by the adapter under test
  }

  postMessage(request: { requestId?: string }) {
    this.lastRequest = request;
  }

  terminate() {
    this.terminated = true;
  }

  dispatch(
    type: "error" | "message",
    event: { message?: string; error?: unknown; data?: unknown },
  ) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, ...event });
    }
  }
}

const compileArgs = {
  documentKey: "doc-crash-backoff",
  rawMarkdown: "# hello",
  rendererProfile: "fast-html" as const,
  featureFlags: {
    fastHtmlRendererEnabled: true,
    boundedFastHtmlRendererEnabled: false,
  },
};

function buildValidArtifactFor(
  args: typeof compileArgs,
): FastMarkdownUnsafeArtifact {
  const identity = createFastMarkdownCompileIdentity(args);
  return {
    cacheKey: identity.cacheKey,
    contentHash: identity.contentHash,
    unsafeHtml: "<h1>hi</h1>",
    sanitization: "main-thread-required",
    outline: [],
    sourceLineAnchors: [],
    heavyBlocks: [],
    rendererProfile: "fast-html",
    diagnostics: {
      profile: "fast-html",
      contentHash: identity.contentHash,
      cacheKey: identity.cacheKey,
      cacheState: "miss",
      compileDurationMs: 1,
      sanitizeDurationMs: 1,
      totalSourceLines: 1,
      totalHeadings: 1,
      totalHeavyBlocks: 0,
      fallbackReason: "none",
      truncated: false,
      featureFlagApplied: false,
    },
  };
}

function latestWorker(): FakeWorker {
  return FakeWorker.instances[FakeWorker.instances.length - 1];
}

describe("fast markdown worker crash backoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker);
    __resetFastMarkdownWorkerBackoffForTests();
  });

  afterEach(() => {
    disposeFastMarkdownWorker();
    __resetFastMarkdownWorkerBackoffForTests();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("first crash re-creates immediately, second consecutive crash defers re-creation", async () => {
    const first = precomputeFastMarkdownInWorker(compileArgs);
    expect(first).not.toBeNull();
    latestWorker().dispatch("error", { message: "boom one" });
    await expect(first).rejects.toThrow("boom one");

    const second = precomputeFastMarkdownInWorker(compileArgs);
    expect(second).not.toBeNull();
    expect(FakeWorker.instances).toHaveLength(2);
    latestWorker().dispatch("error", { message: "boom two" });
    await expect(second).rejects.toThrow("boom two");

    // 连续第 2 次崩溃进入退避窗：不再新建 worker，直接走 worker-unavailable 路径。
    const third = precomputeFastMarkdownInWorker(compileArgs);
    expect(third).toBeNull();
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it("re-creates the worker after the backoff window elapses", async () => {
    let nowMs = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    const first = precomputeFastMarkdownInWorker(compileArgs);
    latestWorker().dispatch("error", { message: "boom one" });
    await expect(first).rejects.toThrow("boom one");
    const second = precomputeFastMarkdownInWorker(compileArgs);
    latestWorker().dispatch("error", { message: "boom two" });
    await expect(second).rejects.toThrow("boom two");

    nowMs += 29_999;
    expect(precomputeFastMarkdownInWorker(compileArgs)).toBeNull();

    nowMs += 1;
    const afterBackoff = precomputeFastMarkdownInWorker(compileArgs);
    expect(afterBackoff).not.toBeNull();
    expect(FakeWorker.instances).toHaveLength(3);
    afterBackoff?.catch(() => {
      // afterEach dispose 会 reject 未 settle 的请求，吞掉避免 unhandled rejection。
    });
    dateNowSpy.mockRestore();
  });

  it("a successful worker response resets the crash counter", async () => {
    let nowMs = 2_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    const first = precomputeFastMarkdownInWorker(compileArgs);
    latestWorker().dispatch("error", { message: "boom one" });
    await expect(first).rejects.toThrow("boom one");

    // 成功响应把连续崩溃计数清零。
    const success = precomputeFastMarkdownInWorker(compileArgs);
    latestWorker().dispatch("message", {
      data: {
        type: "fast-markdown-result",
        requestId: latestWorker().lastRequest?.requestId,
        result: buildValidArtifactFor(compileArgs),
      },
    });
    await expect(success).resolves.toBeDefined();

    const crashAfterSuccess = precomputeFastMarkdownInWorker(compileArgs);
    latestWorker().dispatch("error", { message: "boom after success" });
    await expect(crashAfterSuccess).rejects.toThrow("boom after success");

    // 计数被清零后，这一次崩溃仍是「首崩」，下一次请求必须立刻重建 worker。
    const next = precomputeFastMarkdownInWorker(compileArgs);
    expect(next).not.toBeNull();
    expect(FakeWorker.instances).toHaveLength(3);
    next?.catch(() => {
      // afterEach dispose 会 reject 未 settle 的请求，吞掉避免 unhandled rejection。
    });
    dateNowSpy.mockRestore();
  });

  it("caps the backoff window at five minutes regardless of crash count", async () => {
    let nowMs = 3_000_000;
    const dateNowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowMs);
    let lastCrashAtMs = nowMs;

    // 连崩 6 次：退避按 30s×2^n 增长但必须被 5min 封顶。每次崩溃后推进
    // 310s（> 任何可能的退避窗）保证下一次请求能重建 worker 继续崩。
    for (let crash = 0; crash < 6; crash += 1) {
      const pending = precomputeFastMarkdownInWorker(compileArgs);
      expect(
        pending,
        `crash ${crash} should reach a live worker`,
      ).not.toBeNull();
      latestWorker().dispatch("error", { message: `boom ${crash}` });
      await expect(pending).rejects.toThrow();
      lastCrashAtMs = nowMs;
      nowMs += 310_000;
    }

    // 第 6 次崩溃（count=6，理论 30s×2^5=960s）退避必须被 5min 封顶：
    // 距最后一次崩溃 299_999ms 仍被挡，恰好 300s 时恢复重建。
    nowMs = lastCrashAtMs + 299_999;
    expect(precomputeFastMarkdownInWorker(compileArgs)).toBeNull();

    nowMs = lastCrashAtMs + 300_000;
    const afterCap = precomputeFastMarkdownInWorker(compileArgs);
    expect(afterCap).not.toBeNull();
    afterCap?.catch(() => {
      // afterEach dispose 会 reject 未 settle 的请求，吞掉避免 unhandled rejection。
    });
    dateNowSpy.mockRestore();
  });

  it("crash diagnostics carry a message fingerprint and console.warn the full message", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = precomputeFastMarkdownInWorker(compileArgs);
    latestWorker().dispatch("error", {
      message: "Uncaught ReferenceError: boom is not defined",
    });
    await expect(first).rejects.toThrow();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("fast-markdown-worker"),
      expect.objectContaining({
        message: "Uncaught ReferenceError: boom is not defined",
      }),
    );
    expect(appendRendererDiagnostic).toHaveBeenCalledWith(
      "fast-markdown-worker/failed",
      expect.objectContaining({
        reasonCode: "worker-runtime-error",
        messageHash: expect.stringMatching(/^[a-z0-9]{1,16}$/i),
        messageLength: "Uncaught ReferenceError: boom is not defined".length,
      }),
    );
  });

  it("crash diagnostics carry the errorName class", async () => {
    const first = precomputeFastMarkdownInWorker(compileArgs);
    latestWorker().dispatch("error", {
      message: "boom",
      error: new TypeError("boom"),
    });
    await expect(first).rejects.toThrow();

    expect(appendRendererDiagnostic).toHaveBeenCalledWith(
      "fast-markdown-worker/failed",
      expect.objectContaining({
        reasonCode: "worker-runtime-error",
        errorName: "TypeError",
      }),
    );
  });

  it("keeps the worker alive when an idle error passes the health probe", async () => {
    // 先建立 worker 并成功响应，进入空闲健康态
    const initial = precomputeFastMarkdownInWorker(compileArgs);
    respondToLatestRequest(compileArgs);
    await expect(initial).resolves.toBeDefined();

    // 空闲期 error（无在途请求）：应探活而非处决
    latestWorker().dispatch("error", {
      message: "Uncaught TypeError: x is undefined",
      error: new TypeError("x is undefined"),
    });

    // 探活请求已发出（documentKey 为探活专用 key）
    const probeRequest = latestWorker().lastRequest;
    expect(probeRequest?.requestId).toContain("doc-health-probe");
    respondToLatestRequest(probeArgs);
    // 探活成功路径在微任务里收尾
    await vi.waitFor(() => {
      expect(appendRendererDiagnostic).toHaveBeenCalledWith(
        "fast-markdown-worker/failed",
        expect.objectContaining({
          reasonCode: "worker-error-kept-alive",
          errorName: "TypeError",
        }),
      );
    });

    expect(latestWorker().terminated).toBe(false);

    // 后续请求仍由同一 worker 服务
    const next = precomputeFastMarkdownInWorker(compileArgs);
    expect(next).not.toBeNull();
    expect(FakeWorker.instances).toHaveLength(1);
    next?.catch(() => {
      // afterEach dispose 会 reject 未 settle 的请求，吞掉避免 unhandled rejection。
    });
  });

  it("disposes the worker when the idle-error health probe times out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const initial = precomputeFastMarkdownInWorker(compileArgs);
    respondToLatestRequest(compileArgs);
    await expect(initial).resolves.toBeDefined();

    latestWorker().dispatch("error", { message: "worker truly gone" });

    // 探活请求无人应答 → 2s 超时 → 按既有语义 dispose（首崩无退避）
    await vi.advanceTimersByTimeAsync(2_000);

    expect(latestWorker().terminated).toBe(true);
    const next = precomputeFastMarkdownInWorker(compileArgs);
    expect(next).not.toBeNull();
    expect(FakeWorker.instances).toHaveLength(2);
    next?.catch(() => {
      // afterEach dispose 会 reject 未 settle 的请求，吞掉避免 unhandled rejection。
    });
  });
});

const probeArgs = {
  documentKey: "doc-health-probe",
  rawMarkdown: "# probe",
  rendererProfile: "fast-html" as const,
  featureFlags: {
    fastHtmlRendererEnabled: true,
    boundedFastHtmlRendererEnabled: false,
  },
};

function respondToLatestRequest(args: typeof compileArgs) {
  latestWorker().dispatch("message", {
    data: {
      type: "fast-markdown-result",
      requestId: latestWorker().lastRequest?.requestId,
      result: buildValidArtifactFor(args),
    },
  });
}
