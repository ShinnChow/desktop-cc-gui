/**
 * UI scale is permanently locked to 100%.
 *
 * Field evidence (2026-08): any uiScale ≠ 1 could freeze WebView renderers
 * (native zoom / CSS zoom + cold-start load). Product decision: remove the
 * scale feature entirely; all callers must treat scale as identity only.
 *
 * clampUiScale / sanitizeUiScale always return 1 so load, save, shortcuts,
 * and apply paths cannot reintroduce a non-identity scale — including
 * legacy settings.json values (0.8 / 0.9 / 1.2 / …).
 */
export const UI_SCALE_LOCKED = true;
export const UI_SCALE_MIN = 1;
export const UI_SCALE_MAX = 1;

export const UI_SCALE_DEFAULT = 1;

/** Settings UI presets retired — only identity remains. */
export const UI_SCALE_PRESETS = [1] as const;

const UI_SCALE_PRESET_EPS = 0.001;

/** Always identity. Ignores input (legacy values included). */
export function clampUiScale(_value: number) {
  return UI_SCALE_DEFAULT;
}

/** Always identity. Ignores input (legacy / invalid values included). */
export function sanitizeUiScale(_value: number) {
  return UI_SCALE_DEFAULT;
}





/** Match a stored scale to a preset option value when close enough. */
export function matchUiScalePreset(value: number): number | null {
  const matched = UI_SCALE_PRESETS.find(
    (preset) => Math.abs(preset - value) < UI_SCALE_PRESET_EPS,
  );
  return matched ?? null;
}

/**
 * Options for any leftover scale select. Only 100%.
 */
export function listUiScaleSelectOptions(_current: number): number[] {
  return [...UI_SCALE_PRESETS];
}

export function formatUiScalePercentLabel(value: number): string {
  return `${Math.round(clampUiScale(value) * 100)}%`;
}
