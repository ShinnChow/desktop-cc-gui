// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { CliInstallEngine, CodexDoctorResult } from "@/types";
import {
  useDoctorRunner,
  useSettingsDoctorRunners,
  type SettingsDoctorEngine,
  type SettingsDoctorSpec,
} from "./useDoctorRunner";

const createDoctorResult = (
  overrides: Partial<CodexDoctorResult> = {},
): CodexDoctorResult => ({
  ok: true,
  codexBin: null,
  version: "1.0.0",
  appServerOk: true,
  details: null,
  path: null,
  nodeOk: true,
  nodeVersion: null,
  nodeDetails: null,
  ...overrides,
});

const createSpec = (
  overrides: Partial<SettingsDoctorSpec> = {},
): SettingsDoctorSpec => ({
  resolveBin: () => "/bin/engine",
  runDoctor: vi.fn().mockResolvedValue(createDoctorResult()),
  unavailableMessage: "Engine doctor is not available.",
  ...overrides,
});

describe("useDoctorRunner", () => {
  it("runs the doctor and stores the successful result", async () => {
    const runDoctor = vi.fn().mockResolvedValue(createDoctorResult());
    const { result } = renderHook(() =>
      useDoctorRunner(createSpec({ runDoctor })),
    );

    expect(result.current.state).toEqual({ status: "idle", result: null });

    await act(async () => {
      await result.current.run();
    });

    expect(runDoctor).toHaveBeenCalledWith("/bin/engine");
    expect(result.current.state.status).toBe("done");
    expect(result.current.state.result?.ok).toBe(true);
    expect(result.current.state.result?.version).toBe("1.0.0");
  });

  it("wraps a missing doctor callback into an error result with the unavailable message", async () => {
    const { result } = renderHook(() =>
      useDoctorRunner(
        createSpec({
          resolveBin: () => "/bin/claude",
          runDoctor: null,
          unavailableMessage: "Claude doctor is not available.",
        }),
      ),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.state.status).toBe("done");
    expect(result.current.state.result).toEqual({
      ok: false,
      codexBin: "/bin/claude",
      version: null,
      appServerOk: false,
      details: "Claude doctor is not available.",
      path: null,
      nodeOk: false,
      nodeVersion: null,
      nodeDetails: null,
    });
  });

  it("wraps a rejected doctor run into an error result", async () => {
    const runDoctor = vi.fn().mockRejectedValue(new Error("spawn failed"));
    const { result } = renderHook(() =>
      useDoctorRunner(createSpec({ runDoctor })),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.state.status).toBe("done");
    expect(result.current.state.result?.ok).toBe(false);
    expect(result.current.state.result?.details).toBe("spawn failed");
  });

  it("stringifies non-Error rejections", async () => {
    const runDoctor = vi.fn().mockRejectedValue("raw failure");
    const { result } = renderHook(() =>
      useDoctorRunner(createSpec({ runDoctor })),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.state.result?.details).toBe("raw failure");
  });

  it("stores installer-reported results via report", async () => {
    const { result } = renderHook(() => useDoctorRunner(createSpec()));
    const installerResult = createDoctorResult({ version: "9.9.9" });

    act(() => {
      result.current.report(installerResult);
    });

    expect(result.current.state).toEqual({
      status: "done",
      result: installerResult,
    });
  });
});

describe("useSettingsDoctorRunners", () => {
  const createSpecs = () => {
    const runDoctors = {} as Record<SettingsDoctorEngine, Mock>;
    const specs = {} as Record<SettingsDoctorEngine, SettingsDoctorSpec>;
    const engines: SettingsDoctorEngine[] = [
      "codex",
      "claude",
      "kimi",
      "grok",
      "opencode",
      "dsh",
      "pi",
      "qoder",
    ];
    for (const engine of engines) {
      runDoctors[engine] = vi
        .fn()
        .mockResolvedValue(createDoctorResult({ version: `${engine}-1` }));
      specs[engine] = createSpec({
        resolveBin: () => `/bin/${engine}`,
        runDoctor: runDoctors[engine],
      });
    }
    return { specs, runDoctors };
  };

  it("keeps eight independent engine runners keyed by the registry", async () => {
    const { specs, runDoctors } = createSpecs();
    const { result } = renderHook(() => useSettingsDoctorRunners(specs));

    await act(async () => {
      await result.current.runners.kimi.run();
    });

    expect(runDoctors.kimi).toHaveBeenCalledWith("/bin/kimi");
    expect(runDoctors.codex).not.toHaveBeenCalled();
    expect(result.current.runners.kimi.state.result?.version).toBe("kimi-1");
    expect(result.current.runners.codex.state).toEqual({
      status: "idle",
      result: null,
    });
  });

  it("routes installer results to the matching engine runner", () => {
    const { specs } = createSpecs();
    const { result } = renderHook(() => useSettingsDoctorRunners(specs));
    const installerResult = createDoctorResult({ version: "2.0.0" });

    act(() => {
      result.current.reportInstallerResult("qoder", installerResult);
    });

    expect(result.current.runners.qoder.state).toEqual({
      status: "done",
      result: installerResult,
    });
    expect(result.current.runners.claude.state.status).toBe("idle");
  });

  it("falls back to the claude runner for engines outside the registry", () => {
    const { specs } = createSpecs();
    const { result } = renderHook(() => useSettingsDoctorRunners(specs));
    const installerResult = createDoctorResult({ version: "3.0.0" });

    act(() => {
      result.current.reportInstallerResult(
        "gemini" as CliInstallEngine,
        installerResult,
      );
    });

    expect(result.current.runners.claude.state).toEqual({
      status: "done",
      result: installerResult,
    });
  });

  it("ignores empty installer results", () => {
    const { specs } = createSpecs();
    const { result } = renderHook(() => useSettingsDoctorRunners(specs));

    act(() => {
      result.current.reportInstallerResult("codex", null);
    });

    expect(result.current.runners.codex.state.status).toBe("idle");
  });
});
