import type { ModelInfo } from "../types";

const PROVIDER_LABEL_SEPARATOR = " / ";

export type DshModelVendorSection<
  T extends Pick<ModelInfo, "id" | "label"> & Partial<Pick<ModelInfo, "provider">>,
> = {
  key: string;
  label: string;
  models: T[];
};

export type DshModelDisplayLabelOptions = {
  /** Closed trigger shows `provider / lastSegment` so it cannot collide with other CLI names. */
  closed?: boolean;
  /**
   * List rows whose last segment collides with a sibling row (PI custom
   * providers routing several upstreams under one provider, e.g.
   * `cpa/cline/x` vs `cpa/fb2api/x`) keep the middle path so the rows stay
   * distinguishable.
   */
  disambiguate?: boolean;
};

const SLASH_CATALOG_ENGINES = new Set(["dsh", "pi", "omp"]);

export function isSlashCatalogEngine(
  providerId: string | null | undefined,
): boolean {
  return Boolean(providerId && SLASH_CATALOG_ENGINES.has(providerId));
}

/**
 * DSH catalog rows are stored as `{provider} / {model}` and some model ids
 * are routed (`ovh/Qwen2.5-VL-72B-Instruct`). PI `--list-models` rows use
 * the same `{provider}/{model}` id. List rows show the last model token; the
 * closed trigger keeps the provider prefix.
 */
export function formatDshModelDisplayLabel(
  model: Pick<ModelInfo, "id"> & Partial<Pick<ModelInfo, "model" | "label">>,
  options: DshModelDisplayLabelOptions = {},
): string {
  const lastSegment = resolveDshLastSegment(model);
  if (!options.closed) {
    if (options.disambiguate) {
      return resolveDshCollisionLabel(model) ?? lastSegment;
    }
    return lastSegment;
  }
  const provider = firstPathSegment(model.id);
  if (!provider || provider.toLowerCase() === lastSegment.toLowerCase()) {
    return lastSegment;
  }
  return `${provider}${PROVIDER_LABEL_SEPARATOR}${lastSegment}`;
}

function resolveDshLastSegment(
  model: Pick<ModelInfo, "id"> & Partial<Pick<ModelInfo, "model" | "label">>,
): string {
  const candidates = [
    model.model?.trim(),
    takeAfterProviderSeparator(model.label),
    model.id.trim(),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const last = lastPathSegment(candidate);
    if (last) {
      return last;
    }
  }
  return model.id;
}

function takeAfterProviderSeparator(label?: string): string {
  const value = label?.trim() ?? "";
  const index = value.lastIndexOf(PROVIDER_LABEL_SEPARATOR);
  return index >= 0
    ? value.slice(index + PROVIDER_LABEL_SEPARATOR.length).trim()
    : value;
}

/**
 * Collision fallback for PI custom-provider rows: strip the vendor-section
 * prefix (first id segment) so `cpa/cline/x` shows as `cline/x`. When
 * nothing beyond the last segment remains (two-segment ids where the
 * upstream only differs before the slash), keep the full catalog id.
 */
function resolveDshCollisionLabel(model: Pick<ModelInfo, "id">): string | null {
  const id = model.id.trim();
  const last = lastPathSegment(id);
  if (!id || id === last) {
    return null;
  }
  const rest = id.slice(id.indexOf("/") + 1).trim();
  if (rest && rest !== last) {
    return rest;
  }
  return id;
}

function firstPathSegment(value: string): string {
  const slash = value.indexOf("/");
  return (slash >= 0 ? value.slice(0, slash) : "").trim();
}

function lastPathSegment(value: string): string {
  const slash = value.lastIndexOf("/");
  return (slash >= 0 ? value.slice(slash + 1) : value).trim();
}

/**
 * Official DSH picker sections by host catalog `group.name`. mossx flattens
 * that catalog to `{provider} / {model}` labels, so recover the vendor heading
 * from the catalog label prefix, then `provider`, then the catalog id.
 *
 * PI reuses the same heading recovery: `pi --list-models` already stores
 * `provider` plus `{provider}/{model}` ids, so the fallback path is enough.
 */
export function groupDshModelsByVendor<
  T extends Pick<ModelInfo, "id" | "label"> & Partial<Pick<ModelInfo, "provider">>,
>(models: readonly T[]): DshModelVendorSection<T>[] {
  const sections: DshModelVendorSection<T>[] = [];
  const indexByKey = new Map<string, number>();

  for (const model of models) {
    const label = resolveDshVendorSectionLabel(model);
    const key = model.provider?.trim() || firstPathSegment(model.id) || label;
    const existing = indexByKey.get(key);
    if (existing !== undefined) {
      sections[existing].models.push(model);
      continue;
    }
    indexByKey.set(key, sections.length);
    sections.push({ key, label, models: [model] });
  }

  return sections;
}

export function resolveDshVendorSectionLabel(
  model: Pick<ModelInfo, "id" | "label"> & Partial<Pick<ModelInfo, "provider">>,
): string {
  const fromLabel = takeBeforeProviderSeparator(model.label);
  if (fromLabel) {
    return fromLabel;
  }
  const fromProvider = model.provider?.trim();
  if (fromProvider) {
    return fromProvider;
  }
  return firstPathSegment(model.id) || model.id;
}

function takeBeforeProviderSeparator(label?: string): string {
  const value = label?.trim() ?? "";
  const index = value.lastIndexOf(PROVIDER_LABEL_SEPARATOR);
  return index >= 0 ? value.slice(0, index).trim() : "";
}
