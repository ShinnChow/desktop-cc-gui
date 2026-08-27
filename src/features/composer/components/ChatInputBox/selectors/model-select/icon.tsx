/**
 * ModelSelect 图标解析层（brand-icon 匹配 id + ModelIcon 组件）。
 *
 * 从 ModelSelect.tsx 平移（openspec change refactor-composer-selector-layer
 * Phase 3）：代码零改动，仅归组。
 */
import {
  resolveModelMappingValue,
  type ModelMapping,
} from "../../../../../models/constants";
import { EngineIcon } from "../../../../../engine/components/EngineIcon";
import { ProviderBrandIconImg } from "../../../../../vendors/components/ProviderBrandIconImg";
import {
  PROVIDER_BRAND_ICON_SRC,
  resolveProviderBrandIcon,
} from "../../../../../vendors/providerBrandIcon";
import type { ModelInfo } from "../../types";
import { resolveRuntimeModel } from "./display";

/**
 * Resolve the model id used for brand-icon matching.
 * Claude：与列表文案同源（{@link ./display resolveClaudeCatalogModelLabel}）——
 * catalog runtime 优先，禁止陈旧 localStorage mapping 把「k3」行画成 DeepSeek 鲸。
 * 其它 CLI：runtime / id。
 */
export function resolveModelIdForIcon(
  model: ModelInfo | null | undefined,
  mapping: ModelMapping,
  providerId?: string | null,
): string | null {
  if (!model) {
    return null;
  }
  if (!providerId || providerId === "claude") {
    // 与 getModelLabel 一致：catalog 改写后的 runtime 优先于全局 mapping
    const runtime = model.model?.trim() || "";
    const catalogId = model.id.trim();
    if (runtime && (model.providerProfileId?.trim() || runtime !== catalogId)) {
      return runtime;
    }
    const mapped = resolveModelMappingValue(model.id, mapping);
    if (mapped) {
      return mapped;
    }
  }
  return resolveRuntimeModel(model) ?? model.id;
}

/**
 * Each CLI's native brand mark (when it has a lobehub SVG). Used to detect
 * true cross-vendor remaps (e.g. Claude tier → kimi-k3) vs native models that
 * should keep the engine-canonical icon for visual consistency.
 */
const ENGINE_NATIVE_BRAND_SRC: Partial<Record<string, string>> = {
  claude: PROVIDER_BRAND_ICON_SRC.claude,
  codex: PROVIDER_BRAND_ICON_SRC.openai,
  kimi: PROVIDER_BRAND_ICON_SRC.kimi,
  opencode: PROVIDER_BRAND_ICON_SRC.opencode,
  dsh: PROVIDER_BRAND_ICON_SRC.deepseek,
};

function renderBrandIcon(src: string, size: number) {
  const imgStyle = { width: size, height: size, flexShrink: 0 } as const;
  return (
    <span style={imgStyle} className="selector-model-brand-icon" aria-hidden>
      <ProviderBrandIconImg src={src} />
    </span>
  );
}

/**
 * Model icon: keep provider row / model rows / composer trigger consistent per CLI.
 *
 * - Kimi → lobehub brand tile (dark pad + white K + blue dot)
 * - Codex / Grok / Claude / … → EngineIcon monochrome / asset
 * - Only show a foreign brand when a mapped runtime model points at another
 *   vendor (e.g. Claude slot remapped to kimi-k3)
 */
export const ModelIcon = ({
  provider,
  model,
  modelIdForIcon,
  size = 16,
}: {
  provider?: string;
  model?: ModelInfo | null;
  /** Pre-resolved id for brand matching (mapped runtime name preferred). */
  modelIdForIcon?: string | null;
  size?: number;
}) => {
  const imgStyle = { width: size, height: size, flexShrink: 0 } as const;
  const resolvedModelId =
    modelIdForIcon?.trim() ||
    (model ? (resolveRuntimeModel(model) ?? model.id) : null);

  // DSH host catalog (and remapped slots) can expose Grok models. Those
  // must use the same theme-aware Grok glyph as Grok CLI, not the host
  // CLI's DeepSeek whale. Match only the resolved runtime id so a later
  // remap away from Grok still follows the brand-icon path.
  if (resolvedModelId && /grok/i.test(resolvedModelId)) {
    return <EngineIcon engine="grok" size={size} style={imgStyle} />;
  }

  // Cross-vendor remap only — do not pass presetId, otherwise every Kimi model
  // without "kimi" in its id would short-circuit through brand while the
  // provider row still used EngineIcon (or vice versa).
  if (resolvedModelId) {
    const brandIconSrc = resolveProviderBrandIcon({
      modelId: resolvedModelId,
    });
    const nativeBrandSrc = provider
      ? ENGINE_NATIVE_BRAND_SRC[provider]
      : undefined;
    if (brandIconSrc && brandIconSrc !== nativeBrandSrc) {
      return renderBrandIcon(brandIconSrc, size);
    }
  }

  // Kimi's product mark is the brand tile; monochrome EngineIcon is the wrong
  // glyph for this CLI (provider row + model list + trigger must match).
  if (provider === "kimi") {
    return renderBrandIcon(PROVIDER_BRAND_ICON_SRC.kimi, size);
  }
  if (provider === "dsh") {
    return renderBrandIcon(PROVIDER_BRAND_ICON_SRC.deepseek, size);
  }

  switch (provider) {
    case "codex":
      return <EngineIcon engine="codex" size={size} style={imgStyle} />;
    case "gemini":
      return <EngineIcon engine="gemini" size={size} style={imgStyle} />;
    case "grok":
      return <EngineIcon engine="grok" size={size} style={imgStyle} />;
    case "opencode":
      return <EngineIcon engine="opencode" size={size} style={imgStyle} />;
    case "pi":
      return <EngineIcon engine="pi" size={size} style={imgStyle} />;
    case "qoder":
      return <EngineIcon engine="qoder" size={size} style={imgStyle} />;
    case "claude":
    default:
      return <EngineIcon engine="claude" size={size} style={imgStyle} />;
  }
};
