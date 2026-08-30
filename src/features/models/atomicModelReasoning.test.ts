import { describe, expect, it } from "vitest";
import {
  enrichModelInfoWithAtomicReasoning,
  enrichModelReasoningForEngine,
  reconcileAtomicReasoningEffort,
  resolveAtomicDefaultReasoningEffort,
  resolveAtomicReasoningEffort,
  resolveAtomicReasoningOptions,
} from "./atomicModelReasoning";

describe("atomicModelReasoning", () => {
  it("resolves Codex gpt-5.6-sol options and default from generated catalog", () => {
    const model = { id: "gpt-5.6-sol", model: "gpt-5.6-sol" };
    const options = resolveAtomicReasoningOptions("codex", model);
    expect(options).toEqual(
      expect.arrayContaining(["low", "medium", "high", "xhigh", "max", "ultra"]),
    );
    expect(resolveAtomicDefaultReasoningEffort("codex", model)).toBe("low");
  });

  it("does not inherit Grok effort when switching to Codex catalog model", () => {
    expect(
      resolveAtomicReasoningEffort({
        engine: "codex",
        model: { id: "gpt-5.6-sol", model: "gpt-5.6-sol" },
        previousEffort: "high",
        inherit: false,
      }),
    ).toBe("low");
  });

  it("keeps same-profile effort when still allowed by the next model", () => {
    expect(
      resolveAtomicReasoningEffort({
        engine: "codex",
        model: { id: "gpt-5.6-sol", model: "gpt-5.6-sol" },
        previousEffort: "high",
        inherit: true,
      }),
    ).toBe("high");
  });

  it("drops same-profile effort that the next model does not support", () => {
    expect(
      resolveAtomicReasoningEffort({
        engine: "codex",
        model: {
          id: "slim-model",
          model: "slim-model",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
          ],
          defaultReasoningEffort: "medium",
        },
        previousEffort: "ultra",
        inherit: true,
      }),
    ).toBe("medium");
  });

  it("uses fixed Claude/Grok allowlists and null default", () => {
    expect(resolveAtomicReasoningOptions("claude", null)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(resolveAtomicReasoningOptions("grok", null)).toEqual([
      "low",
      "medium",
      "high",
    ]);
    expect(
      resolveAtomicReasoningEffort({
        engine: "grok",
        model: null,
        previousEffort: "medium",
        inherit: false,
      }),
    ).toBeNull();
    expect(
      resolveAtomicReasoningEffort({
        engine: "grok",
        model: null,
        previousEffort: "medium",
        inherit: true,
      }),
    ).toBe("medium");
  });

  it("enriches custom Codex models with mainstream defaults", () => {
    const enriched = enrichModelInfoWithAtomicReasoning("codex", {
      id: "my-custom",
      model: "my-custom",
      source: "custom",
    });
    expect(enriched.defaultReasoningEffort).toBe("medium");
    expect(resolveAtomicReasoningOptions("codex", enriched)).toEqual(
      expect.arrayContaining(["low", "medium", "high", "xhigh"]),
    );
  });

  it("enriches provider-owned Codex models with mainstream defaults when identity misses", () => {
    for (const source of ["provider-custom", "provider-config"] as const) {
      const enriched = enrichModelInfoWithAtomicReasoning("codex", {
        id: "glm-4.6",
        model: "glm-4.6",
        source,
      });
      expect(enriched.defaultReasoningEffort).toBe("medium");
      expect(resolveAtomicReasoningOptions("codex", enriched)).toEqual(
        expect.arrayContaining(["low", "medium", "high", "xhigh"]),
      );
    }
  });

  it("prefers built-in catalog identity over mainstream defaults for provider-owned models", () => {
    const enriched = enrichModelInfoWithAtomicReasoning("codex", {
      id: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      source: "provider-custom",
    });
    expect(resolveAtomicReasoningOptions("codex", enriched)).toEqual(
      expect.arrayContaining(["low", "medium", "high", "xhigh", "max", "ultra"]),
    );
    expect(enriched.defaultReasoningEffort).toBe("low");
  });

  it("keeps provider-owned runtime efforts instead of defaults", () => {
    const enriched = enrichModelInfoWithAtomicReasoning("codex", {
      id: "glm-4.6",
      model: "glm-4.6",
      source: "provider-custom",
      supportedReasoningEfforts: [{ reasoningEffort: "turbo" }],
      defaultReasoningEffort: "turbo",
    });
    expect(resolveAtomicReasoningOptions("codex", enriched)).toEqual([
      "turbo",
    ]);
    expect(enriched.defaultReasoningEffort).toBe("turbo");
  });

  it("keeps unknown runtime Codex models capability-neutral", () => {
    const model = {
      id: "some-runtime-only-model",
      model: "some-runtime-only-model",
      source: "runtime",
    };
    expect(resolveAtomicReasoningOptions("codex", model)).toEqual([]);
    expect(resolveAtomicDefaultReasoningEffort("codex", model)).toBeNull();
  });

  it("fills missing supported efforts when only default is present", () => {
    const enriched = enrichModelInfoWithAtomicReasoning("codex", {
      id: "gpt-5.6-sol",
      model: "gpt-5.6-sol",
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: [],
    });
    const options = resolveAtomicReasoningOptions("codex", enriched);
    expect(options).toEqual(
      expect.arrayContaining(["low", "medium", "high", "xhigh", "max", "ultra"]),
    );
    expect(enriched.defaultReasoningEffort).toBe("low");
  });

  it("reconciles null Codex effort to catalog default for known models", () => {
    expect(
      reconcileAtomicReasoningEffort({
        engine: "codex",
        model: { id: "gpt-5.6-sol", model: "gpt-5.6-sol" },
        effort: null,
      }),
    ).toBe("low");
  });

  it("reconciles invalid Codex effort to model default", () => {
    expect(
      reconcileAtomicReasoningEffort({
        engine: "codex",
        model: {
          id: "slim",
          model: "slim",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
          ],
          defaultReasoningEffort: "medium",
        },
        effort: "ultra",
      }),
    ).toBe("medium");
  });

  it("reconciles Claude invalid effort to null Default", () => {
    expect(
      reconcileAtomicReasoningEffort({
        engine: "claude",
        model: null,
        effort: "not-a-level",
      }),
    ).toBeNull();
  });

  // ===== PI 引擎（expand-shared-atomic-reasoning-linkage-to-pi） =====

  it("PI full seven-level catalog allowlist", () => {
    // 对应 `supported_thinking_levels_for_pi_model(true, { high: "...", xhigh: "...", max: "..." })` 形态
    const model = {
      id: "claude-sonnet-4.5",
      model: "claude-sonnet-4.5",
      supportedReasoningEfforts: [
        { reasoningEffort: "off" },
        { reasoningEffort: "minimal" },
        { reasoningEffort: "low" },
        { reasoningEffort: "medium" },
        { reasoningEffort: "high" },
        { reasoningEffort: "xhigh" },
        { reasoningEffort: "max" },
      ],
      defaultReasoningEffort: "medium",
    };
    const options = resolveAtomicReasoningOptions("pi", model);
    expect(options).toEqual([
      "off",
      "minimal",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(resolveAtomicDefaultReasoningEffort("pi", model)).toBe("medium");
  });

  it("PI thinkingLevelMap with holes yields subset allowlist", () => {
    // 对应 --list-models fallback + thinkingLevelMap 缺 off/minimal/low/medium 形态
    const model = {
      id: "thinking-holes-model",
      model: "thinking-holes-model",
      supportedReasoningEfforts: [
        { reasoningEffort: "high" },
        { reasoningEffort: "max" },
      ],
      defaultReasoningEffort: "high",
    };
    expect(resolveAtomicReasoningOptions("pi", model)).toEqual([
      "high",
      "max",
    ]);
    expect(resolveAtomicDefaultReasoningEffort("pi", model)).toBe("high");
  });

  it("PI unknown runtime-only model stays capability-neutral", () => {
    const model = {
      id: "runtime-only-pi",
      model: "runtime-only-pi",
      source: "runtime",
    };
    expect(resolveAtomicReasoningOptions("pi", model)).toEqual([]);
    expect(resolveAtomicDefaultReasoningEffort("pi", model)).toBeNull();
  });

  it("PI model with only defaultReasoningEffort yields single-entry allowlist", () => {
    // RPC handshake 失败回退 --list-models / thinking=yes 五档 等形态
    const model = {
      id: "fallback-pi",
      model: "fallback-pi",
      supportedReasoningEfforts: [],
      defaultReasoningEffort: "high",
    };
    expect(resolveAtomicReasoningOptions("pi", model)).toEqual(["high"]);
    expect(resolveAtomicDefaultReasoningEffort("pi", model)).toBe("high");
  });

  it("enrichModelReasoningForEngine passes non-PI models through untouched", () => {
    const claudeModel = { id: "claude-sonnet-4-5", model: "claude-sonnet-4-5" };
    expect(enrichModelReasoningForEngine("claude", claudeModel)).toBe(
      claudeModel,
    );
    const codexModel = { id: "gpt-5.6-sol", model: "gpt-5.6-sol" };
    expect(enrichModelReasoningForEngine("codex", codexModel)).toBe(codexModel);
    expect(enrichModelReasoningForEngine(null, codexModel)).toBe(codexModel);
    // PI 分支同样恒等直返：capability 已在 catalog 投影阶段填到 ModelOption，
    // 本函数不做 catalog lookup、不发明元数据。
    const piModel = {
      id: "google/gemini-2.5-pro",
      model: "google/gemini-2.5-pro",
      supportedReasoningEfforts: ["low", "medium", "high"],
      defaultReasoningEffort: "high",
    };
    expect(enrichModelReasoningForEngine("pi", piModel)).toBe(piModel);
  });

  it("PI inherited effort that is still in allowlist is preserved", () => {
    expect(
      resolveAtomicReasoningEffort({
        engine: "pi",
        model: {
          id: "claude-sonnet-4.5",
          model: "claude-sonnet-4.5",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
          defaultReasoningEffort: "medium",
        },
        previousEffort: "high",
        inherit: true,
      }),
    ).toBe("high");
  });

  it("PI cross-engine switch from Codex high seeds PI model default", () => {
    expect(
      resolveAtomicReasoningEffort({
        engine: "pi",
        model: {
          id: "claude-sonnet-4.5",
          model: "claude-sonnet-4.5",
          supportedReasoningEfforts: [
            { reasoningEffort: "off" },
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
          defaultReasoningEffort: "low",
        },
        previousEffort: "high",
        inherit: false,
      }),
    ).toBe("low");
  });

  it("PI inherited effort that is NOT in new allowlist drops to default", () => {
    expect(
      resolveAtomicReasoningEffort({
        engine: "pi",
        model: {
          id: "fallback-pi",
          model: "fallback-pi",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
          ],
          defaultReasoningEffort: "medium",
        },
        previousEffort: "xhigh",
        inherit: true,
      }),
    ).toBe("medium");
  });

  it("PI non-inherit null previous effort seeds default", () => {
    expect(
      resolveAtomicReasoningEffort({
        engine: "pi",
        model: {
          id: "claude-sonnet-4.5",
          model: "claude-sonnet-4.5",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
          defaultReasoningEffort: "medium",
        },
        previousEffort: null,
        inherit: false,
      }),
    ).toBe("medium");
  });

  it("reconciles null PI effort to model default for known model", () => {
    expect(
      reconcileAtomicReasoningEffort({
        engine: "pi",
        model: {
          id: "claude-sonnet-4.5",
          model: "claude-sonnet-4.5",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
          defaultReasoningEffort: "low",
        },
        effort: null,
      }),
    ).toBe("low");
  });

  it("reconciles PI effort outside allowlist to model default", () => {
    expect(
      reconcileAtomicReasoningEffort({
        engine: "pi",
        model: {
          id: "fallback-pi",
          model: "fallback-pi",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
          ],
          defaultReasoningEffort: "medium",
        },
        effort: "ultra",
      }),
    ).toBe("medium");
  });

  it("reconciles PI effort inside allowlist preserves value", () => {
    expect(
      reconcileAtomicReasoningEffort({
        engine: "pi",
        model: {
          id: "claude-sonnet-4.5",
          model: "claude-sonnet-4.5",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
          defaultReasoningEffort: "low",
        },
        effort: "high",
      }),
    ).toBe("high");
  });

  it("PI unknown model with null effort stays capability-neutral", () => {
    expect(
      reconcileAtomicReasoningEffort({
        engine: "pi",
        model: {
          id: "runtime-only-pi",
          model: "runtime-only-pi",
          source: "runtime",
        },
        effort: null,
      }),
    ).toBeNull();
    // 即使有 current effort 也维持 neutral（capability-neutral 不发明档位）
    expect(
      reconcileAtomicReasoningEffort({
        engine: "pi",
        model: {
          id: "runtime-only-pi",
          model: "runtime-only-pi",
          source: "runtime",
        },
        effort: "high",
      }),
    ).toBe("high");
  });

  it("generic engines reconcile via catalog metadata (P0 统一：首页/会话同源)", () => {
    // 用户裁定：首页创建框与会话内 ButtonArea 必须共用同一投影——
    // 目录条目带思考档元数据的引擎一律联动，不再按引擎白名单特判。
    // 有元数据 + 合法 effort → 保留
    expect(
      reconcileAtomicReasoningEffort({
        engine: "kimi",
        model: {
          id: "kimi-x",
          model: "kimi-x",
          supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          defaultReasoningEffort: "low",
        },
        effort: "low",
      }),
    ).toBe("low");
    // 有元数据 + 非法 effort → 收敛 null（host 默认语义）
    expect(
      reconcileAtomicReasoningEffort({
        engine: "dsh",
        model: {
          id: "dsh-x",
          model: "dsh-x",
          supportedReasoningEfforts: [{ reasoningEffort: "low" }],
          defaultReasoningEffort: "low",
        },
        effort: "ultra",
      }),
    ).toBeNull();
    // 无元数据 → capability-neutral（effort 原样保留，不发明）
    expect(
      reconcileAtomicReasoningEffort({
        engine: "opencode",
        model: { id: "oc-x", model: "oc-x" },
        effort: "medium",
      }),
    ).toBe("medium");
    // options 投影：dsh 目录元数据 → 档位列表（首页缺失场景的根修复）
    expect(
      resolveAtomicReasoningOptions("dsh", {
        id: "deepseek-official/deepseek-v4-flash",
        model: "deepseek-official/deepseek-v4-flash",
        supportedReasoningEfforts: [
          { reasoningEffort: "off" },
          { reasoningEffort: "low" },
          { reasoningEffort: "high" },
          { reasoningEffort: "max" },
        ],
        defaultReasoningEffort: "low",
      }),
    ).toEqual(["off", "low", "high", "max"]);
  });
});
