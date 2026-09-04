// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { resolveClaudeCatalogModelLabel } from "./model-select/display";
import { resolveModelIdForIcon } from "./model-select/icon";

describe("resolveClaudeCatalogModelLabel", () => {
  const staleMapping = {
    fable: "MiniMax-M3",
    opus: "MiniMax-M3",
    sonnet: "MiniMax-M3",
    haiku: "MiniMax-M3",
  };

  it("prefers local catalog runtime over stale global mapping", () => {
    // 历史 Shared 打开本地渠道：forceRefresh 已写入 deepseek，但 localStorage
    // 仍可能是上一 managed MiniMax 映射。
    expect(
      resolveClaudeCatalogModelLabel(
        {
          id: "claude-opus-5",
          model: "deepseek-v4-pro",
          label: "deepseek-v4-pro",
        },
        staleMapping,
      ),
    ).toBe("deepseek-v4-pro");
  });

  it("prefers managed catalog runtime even when mapping disagrees", () => {
    expect(
      resolveClaudeCatalogModelLabel(
        {
          id: "claude-sonnet-5",
          model: "kimi-k3",
          label: "kimi-k3",
          providerProfileId: "k3",
        },
        staleMapping,
      ),
    ).toBe("kimi-k3");
  });

  it("falls back to global mapping when catalog runtime equals id", () => {
    expect(
      resolveClaudeCatalogModelLabel(
        {
          id: "claude-opus-5",
          model: "claude-opus-5",
          label: "Opus 5",
        },
        { opus: "MiniMax-M3" },
      ),
    ).toBe("MiniMax-M3");
  });
});

describe("resolveModelIdForIcon", () => {
  it("uses catalog runtime for icon when mapping still points at another vendor", () => {
    // 文案已是 k3，图标不得再跟 stale deepseek mapping 画鲸。
    expect(
      resolveModelIdForIcon(
        {
          id: "claude-sonnet-5",
          model: "k3",
          label: "k3",
        },
        {
          sonnet: "deepseek-v4-pro",
          main: "deepseek-v4-pro",
        },
        "claude",
      ),
    ).toBe("k3");
  });

  it("still uses mapping for icon when catalog has no runtime rewrite", () => {
    expect(
      resolveModelIdForIcon(
        {
          id: "claude-opus-5",
          model: "claude-opus-5",
          label: "Opus 5",
        },
        { opus: "kimi-k3" },
        "claude",
      ),
    ).toBe("kimi-k3");
  });
});
