import { describe, expect, it } from "vitest";
import type { EngineFeatures, EngineStatus } from "../../../types";
import {
  buildAvailableEngines,
  ENABLED_ENGINE_TYPES,
} from "./engineControllerAvailability";

describe("engineControllerAvailability", () => {
  it("projects labels from the canonical registry and excludes retired engines", () => {
    expect(ENABLED_ENGINE_TYPES).toEqual([
      "claude",
      "codex",
      "grok",
      "kimi",
      "opencode",
      "pi",
      "dsh",
      "qoder",
    ]);
    expect(buildAvailableEngines([], false)).toEqual([
      expect.objectContaining({
        type: "claude",
        displayName: "Claude Code",
        shortName: "Claude Code",
        availabilityState: "loading",
      }),
      expect.objectContaining({
        type: "codex",
        displayName: "Codex CLI",
        shortName: "Codex",
      }),
      expect.objectContaining({
        type: "grok",
        displayName: "Grok CLI",
        shortName: "Grok",
      }),
      expect.objectContaining({
        type: "kimi",
        displayName: "Kimi CLI",
        shortName: "Kimi",
      }),
      expect.objectContaining({
        type: "opencode",
        displayName: "OpenCode",
        shortName: "OpenCode",
      }),
      expect.objectContaining({
        type: "pi",
        displayName: "PI CLI",
        shortName: "PI",
      }),
      expect.objectContaining({
        type: "dsh",
        displayName: "DeepSeek Harness",
        shortName: "DSH",
      }),
      expect.objectContaining({
        type: "qoder",
        displayName: "Qoder CLI",
        shortName: "Qoder",
      }),
    ]);
  });
});

describe("engineControllerAvailability auth state (B6)", () => {
  const baseStatus: EngineStatus = {
    engineType: "qoder",
    features: {} as EngineFeatures,
    installed: true,
    version: "1.1.28",
    binPath: null,
    models: [],
    error: null,
  };

  it("projects requires-login when phase 2 reports requires_login", () => {
    const engines = buildAvailableEngines(
      [{ ...baseStatus, authState: "requires_login" }],
      true,
    );
    const qoder = engines.find((engine) => engine.type === "qoder");
    expect(qoder?.availabilityState).toBe("requires-login");
    expect(qoder?.availabilityLabelKey).toBe("workspace.engineStatusRequiresLogin");
  });

  it("keeps ready when authenticated or unknown", () => {
    const engines = buildAvailableEngines(
      [
        { ...baseStatus, authState: "authenticated" as const },
        baseStatus,
      ].map((status, index): EngineStatus => ({
        ...status,
        engineType: index === 0 ? "qoder" : "kimi",
      })),
      true,
    );
    expect(engines.find((engine) => engine.type === "qoder")?.availabilityState).toBe("ready");
    expect(engines.find((engine) => engine.type === "kimi")?.availabilityState).toBe("ready");
  });
});
