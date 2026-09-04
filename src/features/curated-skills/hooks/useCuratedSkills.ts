import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCuratedSkills } from "../../../services/tauri";
import type { CuratedSkillOption } from "../../../types";

/**
 * Source of truth for the curated-skill UI. Reads the bundled entries via
 * `get_curated_skills` and the live `enabled` flag from the caller's
 * `AppSettings` snapshot.
 *
 * We accept `enabledCuratedSkillIds` as a prop (rather than calling
 * `useAppSettings()` internally) so the read path and the toggle write
 * path share a single React state slot in the parent. Without this
 * lift, the two hooks would each instantiate their own
 * `useAppSettings()` and toggle updates would land in a different slot
 * from the one this hook reads — making the switch visually appear to
 * do nothing.
 */
export function useCuratedSkills(options: {
  enabledCuratedSkillIds: string[] | undefined;
}) {
  const { enabledCuratedSkillIds } = options;
  const [skills, setSkills] = useState<CuratedSkillOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(false);

  const enabledIds = useMemo(
    () => new Set(enabledCuratedSkillIds ?? []),
    [enabledCuratedSkillIds],
  );

  const refresh = useCallback(async () => {
    if (!mountedRef.current) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const entries = await getCuratedSkills();
      if (mountedRef.current) {
        setSkills(entries);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  // Decorate each entry with the live `enabled` flag from AppSettings.
  // Server-side `get_curated_skills` already returns the current flag, but
  // we re-derive it from the AppSettings snapshot so the UI never
  // displays a stale value between toggle and refresh.
  const decorated = useMemo(
    () =>
      skills.map((entry) => ({
        ...entry,
        enabled: enabledIds.has(entry.name),
      })),
    [skills, enabledIds],
  );

  return {
    skills: decorated,
    loading,
    error,
    refresh,
  };
}


