import { describe, expect, it } from "vitest";
import { DEFAULT_HOME_APPEARANCE, sanitizeHomeAppearance } from "./homeAppearance";

describe("home appearance storage boundary", () => {
  it("recovers corrupt and old preferences without hiding the default heading", () => {
    expect(sanitizeHomeAppearance(null)).toEqual(DEFAULT_HOME_APPEARANCE);
    expect(sanitizeHomeAppearance({ title: 1, spacing: NaN, particles: "false" })).toEqual(DEFAULT_HOME_APPEARANCE);
    expect(sanitizeHomeAppearance({ title: "  我的\n工作台  ", particles: false })).toMatchObject({
      title: "我的 工作台", particles: false,
    });
  });

  it("bounds content and density, and rejects remote or executable logo sources", () => {
    expect(sanitizeHomeAppearance({ title: "字".repeat(100), spacing: 0 })).toMatchObject({ title: "字".repeat(80), spacing: 1 });
    expect(sanitizeHomeAppearance({ spacing: 999 }).spacing).toBe(3);
    for (const logoDataUrl of ["https://example.com/logo.png", "javascript:alert(1)", "data:image/svg+xml;base64,PHN2Zz4="]) {
      expect(sanitizeHomeAppearance({ logoDataUrl }).logoDataUrl).toBe("");
    }
    expect(sanitizeHomeAppearance({ logoDataUrl: "data:image/png;base64,YQ==" }).logoDataUrl).toBe("data:image/png;base64,YQ==");
    expect(sanitizeHomeAppearance({ color: "red; background:url(x)" }).color).toBe(DEFAULT_HOME_APPEARANCE.color);
  });
});
