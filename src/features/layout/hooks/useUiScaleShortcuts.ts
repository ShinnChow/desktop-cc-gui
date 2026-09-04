import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppSettings } from "../../../types";
import { applyUiScaleToDocument } from "../../../utils/applyUiScale";
import { confirmUiScaleHealthy } from "../../../utils/uiScaleStartupGuard";
import { appendRendererDiagnostic } from "../../../services/rendererDiagnostics";
import { clampUiScale, UI_SCALE_DEFAULT } from "../../../utils/uiScale";

/**
 * Legacy cold-start defer constants kept for tests that still import them.
 * UI scale is permanently locked to 100%; phase-2 ≠1 apply no longer exists.
 */



/** @internal test-only (no-op; scale is locked). */


type UseUiScaleShortcutsOptions = {
  settings: AppSettings;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
};

type UseUiScaleShortcutsResult = {
  uiScale: number;
  scaleShortcutTitle: string;
  scaleShortcutText: string;
  queueSaveSettings: (next: AppSettings) => Promise<AppSettings>;
  increaseUiScale: () => void;
  decreaseUiScale: () => void;
  resetUiScale: () => void;
};

/**
 * UI scale is permanently locked to 100%.
 * Clears residual zoom/transform styles, never applies ≠1, and ignores
 * increase/decrease/reset shortcuts so legacy settings cannot re-enter a
 * freeze path.
 */
export function useUiScaleShortcuts({
  settings,
  setSettings,
  saveSettings,
}: UseUiScaleShortcutsOptions): UseUiScaleShortcutsResult {
  // Always identity — clampUiScale ignores stored legacy values.
  const uiScale = clampUiScale(settings.uiScale);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    let cancelled = false;
    void applyUiScaleToDocument(UI_SCALE_DEFAULT).catch((error) => {
      if (cancelled) {
        return;
      }
      appendRendererDiagnostic("ui-scale/css-apply-failed", {
        error:
          error instanceof Error
            ? `${error.name}: ${error.message}`
            : String(error),
        scale: UI_SCALE_DEFAULT,
      });
    });

    // Clear any leftover startup-guard pending mark from older builds.
    const healthyRaf =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame(() => {
            if (!cancelled) {
              confirmUiScaleHealthy();
            }
          })
        : null;
    if (healthyRaf == null) {
      confirmUiScaleHealthy();
    }

    // One-shot: if in-memory settings still carry a legacy ≠1, rewrite to 1.
    if (settings.uiScale !== UI_SCALE_DEFAULT) {
      setSettings((current) => {
        if (current.uiScale === UI_SCALE_DEFAULT) {
          return current;
        }
        const nextSettings = { ...current, uiScale: UI_SCALE_DEFAULT };
        void saveSettings(nextSettings);
        return nextSettings;
      });
    }

    return () => {
      cancelled = true;
      if (healthyRaf != null) {
        window.cancelAnimationFrame(healthyRaf);
      }
    };
    // Only re-run when the raw stored value changes so a one-shot rewrite
    // does not loop; apply path is always identity regardless.
  }, [settings.uiScale, saveSettings, setSettings]);

  const saveQueueRef = useRef(Promise.resolve());
  const queueSaveSettings = useCallback(
    (next: AppSettings) => {
      const locked = { ...next, uiScale: UI_SCALE_DEFAULT };
      const task = () => saveSettings(locked);
      const queued = saveQueueRef.current.then(task, task);
      saveQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
    [saveSettings],
  );

  // Scale feature removed: handlers are intentional no-ops (still exported
  // so search-palette / shell wiring keeps compiling without behavior).
  const noopScale = useCallback(() => undefined, []);

  return {
    uiScale,
    scaleShortcutTitle: "",
    scaleShortcutText: "",
    queueSaveSettings,
    increaseUiScale: noopScale,
    decreaseUiScale: noopScale,
    resetUiScale: noopScale,
  };
}
