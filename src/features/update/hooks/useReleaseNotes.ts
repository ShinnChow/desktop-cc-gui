import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { subscribeStartupGateReady } from "../../../features/startup-orchestration/utils/startupGateReady";
import { getClientStoreSync, writeClientStoreValue } from "../../../services/clientStorage";
import type { DebugEntry } from "../../../types";
import { scheduleWhenInteractiveQuiet } from "../../../utils/interactiveMainThread";
import {
  findReleaseIndex,
  normalizeReleaseVersion,
  type ReleaseNotesEntry,
} from "../utils/changelogParser";
import {
  catalogToStubEntries,
  loadReleaseNotesEntry,
  loadReleaseNotesIndex,
} from "../utils/releaseNotesCatalog";

// Re-export parser helpers so existing imports from this hook keep working.
export {
  findReleaseIndex,
  normalizeReleaseVersion,
  parseChangelogEntries,
  type ReleaseNotesEntry,
} from "../utils/changelogParser";

const RELEASE_NOTES_LAST_SEEN_KEY = "releaseNotesLastSeenVersion";

/**
 * Auto-open is gated on startup-gate-ready, then a quiet scheduler.
 * minDelay is only a first-paint flush, not a freeze timeout: the modal
 * must not compete with AppShell hydrate / Composer first mount / Markdown
 * chunk compile. maxWait is a convergence ceiling so a clicking user still
 * sees the notes.
 */
export const RELEASE_NOTES_AUTO_OPEN_MIN_DELAY_MS = 400;
export const RELEASE_NOTES_AUTO_OPEN_QUIET_MS = 800;
export const RELEASE_NOTES_AUTO_OPEN_MAX_WAIT_MS = 12_000;

type OpenReleaseNotesOptions = {
  preferredVersion?: string | null;
  forceRefresh?: boolean;
};

type UseReleaseNotesOptions = {
  enabled?: boolean;
  onDebug?: (entry: DebugEntry) => void;
};

function mergeEntryIntoList(
  list: ReleaseNotesEntry[],
  entry: ReleaseNotesEntry,
): ReleaseNotesEntry[] {
  return list.map((item) => (item.version === entry.version ? entry : item));
}

function markReleaseNotesSeen(version: string | null | undefined): void {
  const normalized = normalizeReleaseVersion(version);
  if (!normalized) {
    return;
  }
  writeClientStoreValue("app", RELEASE_NOTES_LAST_SEEN_KEY, normalized);
}

export function useReleaseNotes({
  enabled = true,
  onDebug,
}: UseReleaseNotesOptions = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ReleaseNotesEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const entriesRef = useRef<ReleaseNotesEntry[]>([]);
  const appVersionRef = useRef<string | null>(null);
  const autoCheckDoneRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const ensureEntryBody = useCallback(
    async (
      list: ReleaseNotesEntry[],
      index: number,
      forceRefresh = false,
    ): Promise<ReleaseNotesEntry[]> => {
      const target = list[index];
      if (!target) {
        return list;
      }
      if (
        !forceRefresh &&
        (target.englishBody.trim() || target.chineseBody.trim())
      ) {
        return list;
      }
      const full = await loadReleaseNotesEntry(target.version, forceRefresh);
      return mergeEntryIntoList(list, full);
    },
    [],
  );

  const openReleaseNotes = useCallback(
    async (options?: OpenReleaseNotesOptions) => {
      const generation = ++loadGenerationRef.current;
      setIsOpen(true);
      setLoading(true);
      setError(null);

      try {
        const forceRefresh = Boolean(options?.forceRefresh);
        const index = await loadReleaseNotesIndex(forceRefresh);
        if (generation !== loadGenerationRef.current) {
          return;
        }

        let nextEntries = catalogToStubEntries(index.entries);
        if (nextEntries.length === 0) {
          throw new Error("CHANGELOG has no release entries.");
        }

        const preferredVersion =
          options?.preferredVersion ?? appVersionRef.current;
        const nextActiveIndex = findReleaseIndex(nextEntries, preferredVersion);
        nextEntries = await ensureEntryBody(
          nextEntries,
          nextActiveIndex,
          forceRefresh,
        );
        if (generation !== loadGenerationRef.current) {
          return;
        }

        entriesRef.current = nextEntries;
        setEntries(nextEntries);
        setActiveIndex(nextActiveIndex);
        // Mark seen as soon as content is ready to show — not only on close —
        // so a freeze mid-modal does not re-auto-open on every next launch.
        markReleaseNotesSeen(preferredVersion ?? appVersionRef.current);
      } catch (caughtError) {
        if (generation !== loadGenerationRef.current) {
          return;
        }
        const message =
          caughtError instanceof Error ? caughtError.message : String(caughtError);
        setError(message);
        onDebug?.({
          id: `${Date.now()}-release-notes-open-error`,
          timestamp: Date.now(),
          source: "error",
          label: "release-notes/open-error",
          payload: message,
        });
      } finally {
        if (generation === loadGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [ensureEntryBody, onDebug],
  );

  const closeReleaseNotes = useCallback(() => {
    // Invalidate in-flight open so a late index/body resolve cannot reopen
    // state or punch another AppShell domain update after the overlay is gone.
    loadGenerationRef.current += 1;
    setIsOpen(false);
    setLoading(false);
    markReleaseNotesSeen(appVersionRef.current);
  }, []);

  const goToPrevious = useCallback(() => {
    void (async () => {
      const nextIndex = activeIndex > 0 ? activeIndex - 1 : activeIndex;
      if (nextIndex === activeIndex) {
        return;
      }
      try {
        const nextEntries = await ensureEntryBody(entriesRef.current, nextIndex);
        entriesRef.current = nextEntries;
        setEntries(nextEntries);
        setActiveIndex(nextIndex);
        setError(null);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : String(caughtError);
        setError(message);
      }
    })();
  }, [activeIndex, ensureEntryBody]);

  const goToNext = useCallback(() => {
    void (async () => {
      const nextIndex =
        activeIndex < entriesRef.current.length - 1
          ? activeIndex + 1
          : activeIndex;
      if (nextIndex === activeIndex) {
        return;
      }
      try {
        const nextEntries = await ensureEntryBody(entriesRef.current, nextIndex);
        entriesRef.current = nextEntries;
        setEntries(nextEntries);
        setActiveIndex(nextIndex);
        setError(null);
      } catch (caughtError) {
        const message =
          caughtError instanceof Error ? caughtError.message : String(caughtError);
        setError(message);
      }
    })();
  }, [activeIndex, ensureEntryBody]);

  const retryLoad = useCallback(() => {
    void openReleaseNotes({ forceRefresh: true });
  }, [openReleaseNotes]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    if (!enabled || autoCheckDoneRef.current) {
      return;
    }
    autoCheckDoneRef.current = true;
    let cancelled = false;
    let unsubscribeGate: (() => void) | null = null;
    let cancelQuiet: (() => void) | null = null;

    void getVersion()
      .then((version) => {
        if (cancelled) {
          return;
        }

        const normalizedVersion = normalizeReleaseVersion(version);
        appVersionRef.current = normalizedVersion;

        if (!normalizedVersion) {
          return;
        }

        const seenVersion = normalizeReleaseVersion(
          getClientStoreSync<string>("app", RELEASE_NOTES_LAST_SEEN_KEY),
        );

        if (seenVersion === normalizedVersion) {
          return;
        }

        // Wait for first-paint / home-input / force-enter, then a quiet
        // slice. A fixed 2s timeout still landed inside the cold-start
        // click-freeze window (field: close the auto-opened modal in the
        // first seconds and WebView2 hit-test stalls until catalog settle).
        unsubscribeGate = subscribeStartupGateReady(() => {
          if (cancelled) {
            return;
          }
          cancelQuiet = scheduleWhenInteractiveQuiet(
            () => {
              if (cancelled) {
                return;
              }
              void openReleaseNotes({ preferredVersion: normalizedVersion });
            },
            {
              quietMs: RELEASE_NOTES_AUTO_OPEN_QUIET_MS,
              minDelayMs: RELEASE_NOTES_AUTO_OPEN_MIN_DELAY_MS,
              maxWaitMs: RELEASE_NOTES_AUTO_OPEN_MAX_WAIT_MS,
            },
          );
        });
      })
      .catch((caughtError) => {
        const message =
          caughtError instanceof Error ? caughtError.message : String(caughtError);
        onDebug?.({
          id: `${Date.now()}-release-notes-version-error`,
          timestamp: Date.now(),
          source: "error",
          label: "release-notes/version-error",
          payload: message,
        });
      });

    return () => {
      cancelled = true;
      autoCheckDoneRef.current = false;
      unsubscribeGate?.();
      cancelQuiet?.();
    };
  }, [enabled, onDebug, openReleaseNotes]);

  const activeEntry = useMemo(
    () => entries[activeIndex] ?? null,
    [activeIndex, entries],
  );

  return {
    isOpen,
    loading,
    error,
    entries,
    activeIndex,
    activeEntry,
    openReleaseNotes,
    closeReleaseNotes,
    goToPrevious,
    goToNext,
    retryLoad,
  };
}
