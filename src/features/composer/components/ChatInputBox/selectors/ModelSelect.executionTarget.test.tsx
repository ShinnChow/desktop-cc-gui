// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  buildProviderExecutionTarget,
  normalizeExecutionProviderProfileId,
  resolveActiveProviderProfileId,
} from "./model-select/executionTarget";
import { isSameProviderExecutionProfile } from "./model-select/executionTarget";

describe("buildProviderExecutionTarget", () => {
  it("builds an atomic Shared target without inferring from model id", () => {
    expect(
      buildProviderExecutionTarget(
        {
          engine: "claude",
          providerProfileId: "provider-a",
          model: "same-model",
          reasoning: { effort: "high" },
        },
        "codex",
        "provider-b",
        "same-model",
        "Provider B",
        "managed",
        true,
        "same-model",
      ),
    ).toEqual({
      engine: "codex",
      providerProfileId: "provider-b",
      modelCatalogEntryId: "same-model",
      model: "same-model",
      providerProfileNameSnapshot: "Provider B",
      providerProfileSource: "managed",
      reasoning: null,
    });
  });

  it("seeds Codex catalog model default effort when switching from Grok", () => {
    // Cross-engine: Grok high MUST NOT inherit; gpt-5.6-sol default is low.
    expect(
      buildProviderExecutionTarget(
        {
          engine: "grok",
          providerProfileId: null,
          modelCatalogEntryId: "grok-4-1-fast",
          model: "grok-4-1-fast",
          reasoning: { effort: "high" },
        },
        "codex",
        "__disk__",
        "gpt-5.6-sol",
        "Local disk",
        "disk",
        true,
        "gpt-5.6-sol",
      ),
    ).toEqual(
      expect.objectContaining({
        engine: "codex",
        modelCatalogEntryId: "gpt-5.6-sol",
        model: "gpt-5.6-sol",
        reasoning: { effort: "low" },
      }),
    );
  });

  it("keeps same-profile effort when the next Codex model still supports it", () => {
    expect(
      buildProviderExecutionTarget(
        {
          engine: "codex",
          providerProfileId: null,
          modelCatalogEntryId: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          reasoning: { effort: "high" },
        },
        "codex",
        "__disk__",
        "gpt-5.6-terra",
        "Local disk",
        "disk",
        true,
        "gpt-5.6-terra",
      ),
    ).toEqual(
      expect.objectContaining({
        modelCatalogEntryId: "gpt-5.6-terra",
        reasoning: { effort: "high" },
      }),
    );
  });

  it("normalizes local profile sentinels to the canonical default binding", () => {
    expect(
      buildProviderExecutionTarget(
        {
          engine: "claude",
          providerProfileId: null,
          model: "claude-sonnet",
          reasoning: { effort: "high" },
        },
        "claude",
        "__local_settings_json__",
        "claude-opus",
        "本地配置",
        "disk",
        true,
        "claude-opus",
      ),
    ).toEqual({
      engine: "claude",
      providerProfileId: null,
      modelCatalogEntryId: "claude-opus",
      model: "claude-opus",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
      reasoning: { effort: "high" },
    });
    expect(
      buildProviderExecutionTarget(
        null,
        "qoder",
        "__local_qoder__",
        "minimax/minimax-m3-cp",
        "本地配置",
        "disk",
        true,
        "minimax/minimax-m3-cp",
      ),
    ).toEqual({
      engine: "qoder",
      providerProfileId: null,
      modelCatalogEntryId: "minimax/minimax-m3-cp",
      model: "minimax/minimax-m3-cp",
      providerProfileNameSnapshot: "本地配置",
      providerProfileSource: "disk",
      reasoning: null,
    });
  });

  it("keeps catalog identity but freezes the runtime model for execution", () => {
    expect(
      buildProviderExecutionTarget(
        null,
        "claude",
        "provider-b",
        "settings-reasoning",
        "Provider B",
        "managed",
        false,
        "deepseek-v4-pro",
      ),
    ).toMatchObject({
      engine: "claude",
      providerProfileId: "provider-b",
      modelCatalogEntryId: "settings-reasoning",
      model: "deepseek-v4-pro",
    });
  });

  it("does not synthesize a missing runtime model from catalog identity", () => {
    expect(
      buildProviderExecutionTarget(
        null,
        "claude",
        "provider-b",
        "settings-reasoning",
        "Provider B",
        "managed",
      ),
    ).toMatchObject({
      modelCatalogEntryId: "settings-reasoning",
      model: null,
    });
  });

  it("treats local sentinel and null as the same native provider binding", () => {
    expect(
      isSameProviderExecutionProfile("claude", null, {
        engine: "claude",
        providerProfileId: "__local_settings_json__",
      }),
    ).toBe(true);
    expect(
      isSameProviderExecutionProfile("claude", "provider-a", {
        engine: "claude",
        providerProfileId: "provider-b",
      }),
    ).toBe(false);
  });

  // ===== PI engine（expand-shared-atomic-reasoning-linkage-to-pi） =====

  it("seeds PI model default effort when switching from Codex", () => {
    // Cross-engine: Codex high MUST NOT inherit; PI model default is "low".
    expect(
      buildProviderExecutionTarget(
        {
          engine: "codex",
          providerProfileId: null,
          modelCatalogEntryId: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          reasoning: { effort: "high" },
        },
        "pi",
        "__disk__",
        "claude-sonnet-4.5",
        "Local disk",
        "disk",
        true,
        "claude-sonnet-4.5",
        null,
        {
          supportedReasoningEfforts: [
            { reasoningEffort: "off" },
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
          defaultReasoningEffort: "low",
        },
      ),
    ).toEqual(
      expect.objectContaining({
        engine: "pi",
        modelCatalogEntryId: "claude-sonnet-4.5",
        model: "claude-sonnet-4.5",
        reasoning: { effort: "low" },
      }),
    );
  });

  it("keeps same-profile PI effort when next model still supports it", () => {
    expect(
      buildProviderExecutionTarget(
        {
          engine: "pi",
          providerProfileId: "__disk__",
          modelCatalogEntryId: "claude-sonnet-4.5",
          model: "claude-sonnet-4.5",
          reasoning: { effort: "high" },
        },
        "pi",
        "__disk__",
        "claude-opus-4.6",
        "Local disk",
        "disk",
        true,
        "claude-opus-4.6",
        null,
        {
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
          defaultReasoningEffort: "low",
        },
      ),
    ).toEqual(
      expect.objectContaining({
        engine: "pi",
        modelCatalogEntryId: "claude-opus-4.6",
        reasoning: { effort: "high" },
      }),
    );
  });

  it("drops PI effort when next PI model does not support it", () => {
    expect(
      buildProviderExecutionTarget(
        {
          engine: "pi",
          providerProfileId: null,
          modelCatalogEntryId: "claude-sonnet-4.5",
          model: "claude-sonnet-4.5",
          reasoning: { effort: "xhigh" },
        },
        "pi",
        "__disk__",
        "thinking-holes-model",
        "Local disk",
        "disk",
        true,
        "thinking-holes-model",
        null,
        {
          supportedReasoningEfforts: [
            { reasoningEffort: "high" },
            { reasoningEffort: "max" },
          ],
          defaultReasoningEffort: "high",
        },
      ),
    ).toEqual(
      expect.objectContaining({
        engine: "pi",
        modelCatalogEntryId: "thinking-holes-model",
        reasoning: { effort: "high" },
      }),
    );
  });

  it("PI unknown model without metadata yields null effort", () => {
    // Capability-neutral：runtime-only 模型不发明档位
    expect(
      buildProviderExecutionTarget(
        {
          engine: "codex",
          providerProfileId: null,
          modelCatalogEntryId: "gpt-5.6-sol",
          model: "gpt-5.6-sol",
          reasoning: { effort: "high" },
        },
        "pi",
        "__disk__",
        "runtime-only-pi",
        "Local disk",
        "disk",
        true,
        "runtime-only-pi",
        null,
        null,
      ),
    ).toEqual(
      expect.objectContaining({
        engine: "pi",
        modelCatalogEntryId: "runtime-only-pi",
        reasoning: null,
      }),
    );
  });
});

describe("resolveActiveProviderProfileId", () => {
  it("uses the target channel for the current engine", () => {
    expect(
      resolveActiveProviderProfileId("claude", {
        engine: "claude",
        providerProfileId: "k3",
      }),
    ).toBe("k3");
  });

  it("falls back to the local default channel for the current engine", () => {
    expect(
      resolveActiveProviderProfileId("claude", {
        engine: "claude",
        providerProfileId: null,
      }),
    ).toBe("__local_settings_json__");
    expect(
      resolveActiveProviderProfileId("claude", {
        engine: "claude",
        providerProfileId: "__local_settings_json__",
      }),
    ).toBe("__local_settings_json__");
  });

  it("always uses the local default channel for other engines", () => {
    expect(
      resolveActiveProviderProfileId("codex", {
        engine: "claude",
        providerProfileId: "k3",
      }),
    ).toBe("__disk__");
    expect(resolveActiveProviderProfileId("grok", null)).toBe(
      "__local_config_toml__",
    );
    expect(
      resolveActiveProviderProfileId("opencode", {
        engine: "claude",
        providerProfileId: null,
      }),
    ).toBe("__local_opencode_json__");
    expect(
      resolveActiveProviderProfileId("pi", {
        engine: "claude",
        providerProfileId: null,
      }),
    ).toBe("__local_pi__");
    expect(
      normalizeExecutionProviderProfileId("pi", "__local_pi__"),
    ).toBeNull();
    expect(
      resolveActiveProviderProfileId("qoder", {
        engine: "claude",
        providerProfileId: null,
      }),
    ).toBe("__qoder_global__");
    expect(
      normalizeExecutionProviderProfileId("qoder", "__local_qoder__"),
    ).toBeNull();
    expect(
      normalizeExecutionProviderProfileId("qoder", "__qoder_global__"),
    ).toBe("__qoder_global__");
    expect(
      normalizeExecutionProviderProfileId("qoder", "__qoder_cn__"),
    ).toBe("__qoder_cn__");
  });

  it("returns null for engines without provider profiles", () => {
    expect(resolveActiveProviderProfileId("gemini", null)).toBeNull();
  });
});
