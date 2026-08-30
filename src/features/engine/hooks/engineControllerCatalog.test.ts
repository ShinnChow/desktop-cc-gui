import { describe, expect, it } from "vitest";
import { resolveEngineCatalogLoadPhase } from "./engineControllerCatalog";

describe("resolveEngineCatalogLoadPhase (detached catalog engines)", () => {
  it("defaults detached engines (pi/qoder/opencode) to on-demand", () => {
    expect(resolveEngineCatalogLoadPhase("pi")).toBe("on-demand");
    expect(resolveEngineCatalogLoadPhase("qoder")).toBe("on-demand");
    expect(resolveEngineCatalogLoadPhase("opencode")).toBe("on-demand");
  });

  it("keeps fast-catalog engines on idle-prewarm by default", () => {
    expect(resolveEngineCatalogLoadPhase("kimi")).toBe("idle-prewarm");
    expect(resolveEngineCatalogLoadPhase("claude")).toBe("idle-prewarm");
    expect(resolveEngineCatalogLoadPhase("codex")).toBe("idle-prewarm");
  });

  it("explicit phase and force always win", () => {
    expect(
      resolveEngineCatalogLoadPhase("pi", { phase: "idle-prewarm" }),
    ).toBe("idle-prewarm");
    expect(
      resolveEngineCatalogLoadPhase("kimi", { forceRefresh: true }),
    ).toBe("on-demand");
  });
});
