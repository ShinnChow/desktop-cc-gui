// @vitest-environment jsdom
// F6（fix-session-load-bridge-freeze / Phase C）：worker 作用域错误回传。
// worker 内部未捕获异常会同时触发主线程 Worker error 事件（已探活/退避），
// 但完整 message + stack 只有作用域内拿得到。回传结构化 detail，
// 主线程指纹落盘（全文进 console），下一轮日志直接定位真凶。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const postMessageMock = vi.fn();

vi.stubGlobal("postMessage", postMessageMock);

import "../fastMarkdown.worker";

describe("fastMarkdown.worker scope error forwarding", () => {
  beforeEach(() => {
    // 每个用例重新 stub（afterEach 的 unstubAllGlobals 会移除）
    vi.stubGlobal("postMessage", postMessageMock);
    postMessageMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("bridge 模块零依赖且被入口最先 import（保证 chunk 求值期错误也能捕获）", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const bridgeSrc = fs.readFileSync(
      path.join(dir, "../workerScopeErrorBridge.ts"),
      "utf8",
    );
    // 桥模块自身不得 import 任何模块（零依赖 → 求值即时完成）
    expect(bridgeSrc.match(/^import /m)).toBeNull();

    const workerSrc = fs.readFileSync(
      path.join(dir, "../fastMarkdown.worker.ts"),
      "utf8",
    );
    const bridgeImportIndex = workerSrc.indexOf(
      'import "./workerScopeErrorBridge"',
    );
    const compileImportIndex = workerSrc.indexOf('from "./compileCore"');
    expect(bridgeImportIndex).toBeGreaterThanOrEqual(0);
    expect(bridgeImportIndex).toBeLessThan(compileImportIndex);
  });

  it("forwards scope error details to the main thread", () => {
    const boom = new Error("Cannot read properties of chunk (reading 'init')");
    const event = new ErrorEvent("error", {
      message:
        "Uncaught Error: Cannot read properties of chunk (reading 'init')",
      filename: "http://localhost:5173/src/chunk-GNJJE6OE.js",
      lineno: 64,
      colno: 23,
      error: boom,
    });
    self.dispatchEvent(event);

    expect(postMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "fast-markdown-worker-scope-error",
        detail: expect.objectContaining({
          message:
            "Uncaught Error: Cannot read properties of chunk (reading 'init')",
          filename: "http://localhost:5173/src/chunk-GNJJE6OE.js",
          lineno: 64,
          colno: 23,
          errorName: "Error",
          stack: expect.stringContaining("Error: Cannot read properties"),
        }),
      }),
    );
  });
});
