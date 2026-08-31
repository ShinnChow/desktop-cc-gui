import { useCallback, useEffect, useRef, useState } from "react";
import {
  probeOpenAppPresets,
  probeOpenAppTarget,
} from "../../../services/tauri";
import type { OpenAppTarget } from "../../../types";
import {
  healthFromTargetProbe,
  type OpenAppHealth,
  type OpenAppPresetProbe,
  type OpenAppTargetHealthEntry,
} from "../utils/openAppHealth";

type UseOpenAppTargetHealthOptions = {
  enabled: boolean;
  targets: OpenAppTarget[];
};

// Session caches — no cold-start cost; no polling.
let sessionPresetProbeCache: Record<string, OpenAppPresetProbe> | null = null;
let sessionPresetProbeInFlight: Promise<
  Record<string, OpenAppPresetProbe>
> | null = null;

function toPresetMap(
  results: Awaited<ReturnType<typeof probeOpenAppPresets>>,
): Record<string, OpenAppPresetProbe> {
  const map: Record<string, OpenAppPresetProbe> = {};
  for (const item of results) {
    map[item.id] = {
      id: item.id,
      installed: item.installed,
      resolvedPath: item.resolvedPath ?? null,
    };
  }
  return map;
}

async function loadPresetProbeMap(): Promise<Record<string, OpenAppPresetProbe>> {
  if (sessionPresetProbeCache) {
    return sessionPresetProbeCache;
  }
  if (sessionPresetProbeInFlight) {
    return sessionPresetProbeInFlight;
  }
  sessionPresetProbeInFlight = probeOpenAppPresets()
    .then((results) => {
      sessionPresetProbeCache = toPresetMap(results);
      return sessionPresetProbeCache;
    })
    .catch(() => {
      sessionPresetProbeCache = {};
      return sessionPresetProbeCache;
    })
    .finally(() => {
      sessionPresetProbeInFlight = null;
    });
  return sessionPresetProbeInFlight;
}

/**
 * Lazy health for open-with list: preset probe + per-target path/command probe.
 * Exposes click-to-refresh for unknown/missing rows.
 */
export function useOpenAppTargetHealth(options: UseOpenAppTargetHealthOptions): {
  probeById: Record<string, OpenAppPresetProbe>;
  targetHealthById: Record<string, OpenAppTargetHealthEntry>;
  refreshingIds: Record<string, boolean>;
  refreshTarget: (target: OpenAppTarget) => Promise<OpenAppHealth>;
  probing: boolean;
} {
  const { enabled, targets } = options;
  const [probeById, setProbeById] = useState<Record<string, OpenAppPresetProbe>>(
    () => sessionPresetProbeCache ?? {},
  );
  const [targetHealthById, setTargetHealthById] = useState<
    Record<string, OpenAppTargetHealthEntry>
  >({});
  const [refreshingIds, setRefreshingIds] = useState<Record<string, boolean>>(
    {},
  );
  const [probing, setProbing] = useState(false);
  const autoProbedKeysRef = useRef<Set<string>>(new Set());

  const targetFingerprint = useCallback((target: OpenAppTarget) => {
    return [
      target.id,
      target.kind,
      target.appName?.trim() ?? "",
      target.command?.trim() ?? "",
    ].join("\0");
  }, []);

  const refreshTarget = useCallback(async (target: OpenAppTarget) => {
    setRefreshingIds((prev) => ({ ...prev, [target.id]: true }));
    try {
      const result = await probeOpenAppTarget({
        kind: target.kind,
        appName: target.appName,
        command: target.command,
      });
      const status = healthFromTargetProbe(result);
      setTargetHealthById((prev) => ({
        ...prev,
        [target.id]: {
          status,
          resolvedPath: result.resolvedPath ?? null,
        },
      }));
      return status;
    } catch {
      setTargetHealthById((prev) => ({
        ...prev,
        [target.id]: { status: "unknown" },
      }));
      return "unknown" as OpenAppHealth;
    } finally {
      setRefreshingIds((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
    }
  }, []);

  // Load curated presets once when section opens.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    setProbing(true);
    void loadPresetProbeMap().then((map) => {
      if (!cancelled) {
        setProbeById(map);
        setProbing(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Auto-probe configured targets when fingerprint changes (paths / custom apps / commands).
  useEffect(() => {
    if (!enabled || targets.length === 0) {
      return;
    }
    let cancelled = false;

    const run = async () => {
      const pending = targets.filter((target) => {
        if (target.kind === "finder") {
          return false;
        }
        const key = targetFingerprint(target);
        if (autoProbedKeysRef.current.has(key)) {
          return false;
        }
        return true;
      });
      if (pending.length === 0) {
        return;
      }

      await Promise.all(
        pending.map(async (target) => {
          const key = targetFingerprint(target);
          autoProbedKeysRef.current.add(key);
          try {
            const result = await probeOpenAppTarget({
              kind: target.kind,
              appName: target.appName,
              command: target.command,
            });
            if (cancelled) {
              return;
            }
            const status = healthFromTargetProbe(result);
            setTargetHealthById((prev) => ({
              ...prev,
              [target.id]: {
                status,
                resolvedPath: result.resolvedPath ?? null,
              },
            }));
          } catch {
            if (!cancelled) {
              setTargetHealthById((prev) => ({
                ...prev,
                [target.id]: { status: "unknown" },
              }));
            }
          }
        }),
      );
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [enabled, targetFingerprint, targets]);

  return {
    probeById,
    targetHealthById,
    refreshingIds,
    refreshTarget,
    probing,
  };
}


