// Batch 1（enhance-perf-diagnostics-evidence）：崩溃取证结构化契约。
// F1/F2：error-boundary / window 级错误持久化 payload 必须携带安全命名的结构化
// 归因字段（errorName / messageHash / messageLength / componentFrames），
// 且 message/error/componentStack 文本本体仍被既有策略脱敏。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientStorageMocks = vi.hoisted(() => ({
  getClientStoreSync: vi.fn(),
  isPreloaded: vi.fn(),
  writeClientStoreValue: vi.fn(),
}));

vi.mock("./clientStorage", () => clientStorageMocks);

import {
  buildDiagnosticComponentFrames,
  buildDiagnosticErrorAttribution,
  flushRendererDiagnosticsBuffer,
  appendRendererDiagnostic,
} from "./rendererDiagnostics";

function persistedEntries(): Array<{
  label: string;
  payload: Record<string, unknown>;
}> {
  flushRendererDiagnosticsBuffer();
  return clientStorageMocks.writeClientStoreValue.mock.calls.flatMap(
    ([, , entries]) =>
      (
        (entries ?? []) as Array<{
          label?: string;
          payload?: Record<string, unknown>;
        }>
      ).map((entry) => ({
        label: entry.label ?? "",
        payload: entry.payload ?? {},
      })),
  );
}

describe("崩溃取证结构化字段", () => {
  beforeEach(() => {
    clientStorageMocks.getClientStoreSync.mockReset();
    clientStorageMocks.isPreloaded.mockReset();
    clientStorageMocks.writeClientStoreValue.mockReset();
    clientStorageMocks.isPreloaded.mockReturnValue(true);
    clientStorageMocks.getClientStoreSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("buildDiagnosticErrorAttribution 提取错误名与文本指纹", () => {
    const attribution = buildDiagnosticErrorAttribution(
      new TypeError("Cannot read properties of undefined (reading 'foo')"),
    );
    expect(attribution).toEqual({
      errorName: "TypeError",
      messageHash: expect.stringMatching(/^[a-z0-9]{1,16}$/i),
      messageLength: "Cannot read properties of undefined (reading 'foo')"
        .length,
    });

    const nonError = buildDiagnosticErrorAttribution("plain rejection");
    expect(nonError.errorName).toBe("Error");
    expect(nonError.messageLength).toBe("plain rejection".length);
  });

  it("buildDiagnosticComponentFrames 解析组件帧名并限幅", () => {
    expect(
      buildDiagnosticComponentFrames(
        "\n    at TimelineRowRenderer\n    at MessagesTimeline\n    at Messages\n    at AppShell",
      ),
    ).toEqual([
      "TimelineRowRenderer",
      "MessagesTimeline",
      "Messages",
      "AppShell",
    ]);
    expect(buildDiagnosticComponentFrames(null)).toEqual([]);
    expect(buildDiagnosticComponentFrames("garbage without frames")).toEqual(
      [],
    );
    const manyFrames = Array.from(
      { length: 30 },
      (_, index) => `at Component${index}`,
    ).join("\n");
    const frames = buildDiagnosticComponentFrames(manyFrames);
    expect(frames).toHaveLength(12);
    expect(frames[0]).toBe("Component0");
  });

  it("F1: 匿名组件帧解析为 anonymous 而非丢弃（dev/生产两种格式）", () => {
    // 真机 2026-08-28：7/7 次 error-boundary frames=[] —— 无 displayName 组件树
    // 输出 `at <anonymous>`，尖括号 token 被旧正则丢弃，整条归因失效。
    expect(
      buildDiagnosticComponentFrames(
        "\n    at <anonymous> (http://localhost:5173/src/app.tsx:64:23)\n    at <anonymous> (<anonymous>)\n    at AppShell",
      ),
    ).toEqual(["anonymous", "anonymous", "AppShell"]);
    expect(
      buildDiagnosticComponentFrames("\n    at <anonymous>\n    at <wrapper>"),
    ).toEqual(["anonymous", "anonymous"]);
  });

  it("F1: componentStackLineCount 计数过 sanitize 存活", () => {
    appendRendererDiagnostic("react/error-boundary", {
      error: "Error: boom",
      errorClass: "Error",
      componentStack: "\n    at <anonymous>\n    at <anonymous>",
      errorName: "Error",
      messageHash: "abc",
      messageLength: 10,
      componentFrames: ["anonymous", "anonymous"],
      componentStackLineCount: 2,
    });

    const payload = persistedEntries().find(
      (entry) => entry.label === "react/error-boundary",
    )?.payload;
    expect(payload?.componentStackLineCount).toBe(2);
  });

  it("F3: window/error 的 sourceModule/Line/Col 过 sanitize 存活，filename 仍脱敏", () => {
    appendRendererDiagnostic("window/error", {
      message: "Uncaught Error: mystery",
      filename: "http://localhost:5173/src/features/markdown/dep.ts",
      lineno: 64,
      colno: 23,
      errorName: "Error",
      messageHash: "1wt84ny",
      messageLength: 45,
      sourceModule: "dep.ts",
      sourceLine: 64,
      sourceCol: 23,
    });

    const payload = persistedEntries().find(
      (entry) => entry.label === "window/error",
    )?.payload;
    expect(payload).toMatchObject({
      sourceModule: "dep.ts",
      sourceLine: 64,
      sourceCol: 23,
      lineno: 64,
      colno: 23,
    });
    expect(payload?.filename).toBe("[redacted]");
    expect(payload?.message).toBe("[redacted]");
  });

  it("error-boundary 结构化字段过持久化 sanitize 后存活，本体仍脱敏", () => {
    appendRendererDiagnostic("react/error-boundary", {
      error: "TypeError: boom at user context",
      errorClass: "type-error",
      componentStack: "\n    at TimelineRowRenderer\n    at Messages",
      errorName: "TypeError",
      messageHash: "1wt84ny",
      messageLength: 22,
      componentFrames: ["TimelineRowRenderer", "Messages"],
    });

    const payload = [...persistedEntries()]
      .reverse()
      .find((entry) => entry.label === "react/error-boundary")?.payload;
    expect(payload).toBeDefined();
    expect(payload).toMatchObject({
      errorName: "TypeError",
      messageHash: "1wt84ny",
      messageLength: 22,
      componentFrames: ["TimelineRowRenderer", "Messages"],
      errorClass: "type-error",
    });
    expect(payload?.error).toBe("[redacted]");
    expect(payload?.componentStack).toBe("[redacted]");
  });

  it("window/error 结构化字段过持久化 sanitize 后存活，message 仍脱敏", () => {
    appendRendererDiagnostic("window/error", {
      message: "Uncaught TypeError: boom",
      filename: "/Users/private/project/source.ts",
      lineno: 64,
      colno: 23,
      errorName: "TypeError",
      messageHash: "abc123",
      messageLength: 24,
    });

    const payload = [...persistedEntries()]
      .reverse()
      .find((entry) => entry.label === "window/error")?.payload;
    expect(payload).toMatchObject({
      errorName: "TypeError",
      messageHash: "abc123",
      messageLength: 24,
      lineno: 64,
      colno: 23,
    });
    expect(payload?.message).toBe("[redacted]");
    expect(payload?.filename).toBe("[redacted]");
  });

  it("unhandledrejection 的 reasonName/reasonHash/reasonLength 存活，reason 仍脱敏", () => {
    appendRendererDiagnostic("window/unhandledrejection", {
      reason: "TypeError: rejected promise details",
      reasonName: "TypeError",
      reasonHash: "def456",
      reasonLength: 35,
    });

    const payload = persistedEntries().find(
      (entry) => entry.label === "window/unhandledrejection",
    )?.payload;
    expect(payload).toMatchObject({
      reasonName: "TypeError",
      reasonHash: "def456",
      reasonLength: 35,
    });
    expect(payload?.reason).toBe("[redacted]");
  });
});
