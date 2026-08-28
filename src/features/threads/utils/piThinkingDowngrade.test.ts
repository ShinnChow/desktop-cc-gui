import { describe, expect, it } from "vitest";
import {
  PI_AUTO_DOWNGRADE_MAX_PROMPT_CHARS,
  resolvePiFirstMessageEffort,
} from "./piThinkingDowngrade";

describe("resolvePiFirstMessageEffort", () => {
  it("downgrades a short untouched first message on a new pi thread to low", () => {
    expect(
      resolvePiFirstMessageEffort({
        engine: "pi",
        effort: null,
        hasSession: false,
        promptText: "hi",
      }),
    ).toBe("low");
  });

  it("never overrides an explicit effort selection (including high)", () => {
    expect(
      resolvePiFirstMessageEffort({
        engine: "pi",
        effort: "high",
        hasSession: false,
        promptText: "hi",
      }),
    ).toBe("high");
    expect(
      resolvePiFirstMessageEffort({
        engine: "pi",
        effort: "medium",
        hasSession: false,
        promptText: "hi",
      }),
    ).toBe("medium");
  });

  it("keeps the untouched default for long prompts", () => {
    expect(
      resolvePiFirstMessageEffort({
        engine: "pi",
        effort: null,
        hasSession: false,
        promptText: "a".repeat(PI_AUTO_DOWNGRADE_MAX_PROMPT_CHARS + 1),
      }),
    ).toBeNull();
    expect(
      resolvePiFirstMessageEffort({
        engine: "pi",
        effort: null,
        hasSession: false,
        promptText: "a".repeat(PI_AUTO_DOWNGRADE_MAX_PROMPT_CHARS),
      }),
    ).toBe("low");
  });

  it("skips resumed threads even when effort is untouched", () => {
    expect(
      resolvePiFirstMessageEffort({
        engine: "pi",
        effort: null,
        hasSession: true,
        promptText: "hi",
      }),
    ).toBeNull();
  });

  it("passes through non-pi engines unchanged", () => {
    expect(
      resolvePiFirstMessageEffort({
        engine: "claude",
        effort: null,
        hasSession: false,
        promptText: "hi",
      }),
    ).toBeNull();
    expect(
      resolvePiFirstMessageEffort({
        engine: "codex",
        effort: "high",
        hasSession: false,
        promptText: "hi",
      }),
    ).toBe("high");
  });

  it("normalizes whitespace-only effort to the untouched path", () => {
    expect(
      resolvePiFirstMessageEffort({
        engine: "pi",
        effort: "   ",
        hasSession: false,
        promptText: "hi",
      }),
    ).toBe("low");
  });
});
