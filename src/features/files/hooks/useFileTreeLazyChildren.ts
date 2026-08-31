import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  getWorkspaceDirectoryChildren,
  type WorkspaceDirectoryEntry,
} from "../../../services/tauri";
import { appendWorkspaceFileListingBudgetDiagnostic } from "../../../services/rendererDiagnostics";
import type { useFileTreeViewState } from "../components/useFileTreeViewState";

type FileTreeViewState = ReturnType<typeof useFileTreeViewState>;

function hashFileTreeDiagnosticPath(path: string) {
  let hash = 0;
  for (let index = 0; index < path.length; index += 1) {
    hash = (hash * 31 + path.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export function useFileTreeLazyChildren({
  viewState,
  workspaceId,
  effectiveExpandedFolders,
  effectiveLazyLoadableDirectories,
  setManuallyCollapsedAutoExpandedFolders,
}: {
  viewState: FileTreeViewState;
  workspaceId: string;
  effectiveExpandedFolders: Set<string>;
  effectiveLazyLoadableDirectories: Set<string>;
  setManuallyCollapsedAutoExpandedFolders: Dispatch<SetStateAction<Set<string>>>;
}) {
  const {
    loadedLazyDirectoriesRef,
    loadingLazyDirectoriesRef,
    setExpandedFolders,
    setLazyDirectories,
    setLazyDirectoryLoadErrors,
    setLazyDirectoryMetadata,
    setLazyFiles,
    setLazyGitignoredDirectories,
    setLazyGitignoredFiles,
    setLazyLoadableDirectories,
    setLoadedLazyDirectories,
    setLoadingLazyDirectories,
    sourceVersionRef,
  } = viewState;

  const loadLazyDirectoryChildren = useCallback(
    async (path: string) => {
      if (
        loadedLazyDirectoriesRef.current.has(path) ||
        loadingLazyDirectoriesRef.current.has(path)
      ) {
        return;
      }
      loadingLazyDirectoriesRef.current = new Set(loadingLazyDirectoriesRef.current).add(path);
      const requestSourceVersion = sourceVersionRef.current;
      const requestedAt = Date.now();
      setLoadingLazyDirectories((prev) => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });
      setLazyDirectoryLoadErrors((prev) => {
        const next = new Map(prev);
        next.delete(path);
        return next;
      });
      try {
        const response = await getWorkspaceDirectoryChildren(workspaceId, path);
        const elapsedMs = Date.now() - requestedAt;
        if (sourceVersionRef.current !== requestSourceVersion) {
          appendWorkspaceFileListingBudgetDiagnostic({
            surfaceId: "subtree-listing",
            workspaceId,
            durationMs: elapsedMs,
            returnedEntries: response.listingBudget?.returnedEntries ?? 0,
            payloadBytes: response.listingBudget?.payloadBytes ?? response.payloadBudget?.estimatedBytes ?? null,
            cacheState: response.listingBudget?.cacheState ?? response.payloadBudget?.cacheState ?? "unsupported",
            scanState: response.scan_state ?? response.listingBudget?.scanState ?? null,
            partial: true,
            limitHit: Boolean(response.limit_hit ?? response.listingBudget?.limitHit),
            sourceVersion: response.sourceVersion ?? response.listingBudget?.sourceVersion ?? null,
            requestedPathHash: hashFileTreeDiagnosticPath(path),
            evidenceClass: "proxy",
            fallbackReason: "stale-source-version",
          });
          return;
        }
        const nextFiles = Array.isArray(response.files) ? response.files : [];
        const nextDirectories = Array.isArray(response.directories) ? response.directories : [];
        const nextGitignoredFiles = Array.isArray(response.gitignored_files)
          ? response.gitignored_files
          : [];
        const nextGitignoredDirectories = Array.isArray(response.gitignored_directories)
          ? response.gitignored_directories
          : [];
        const nextDirectoryMetadata = Array.isArray(response.directory_entries)
          ? response.directory_entries.filter((entry): entry is WorkspaceDirectoryEntry =>
              Boolean(entry && typeof entry.path === "string" && typeof entry.child_state === "string"),
            )
          : [];
        appendWorkspaceFileListingBudgetDiagnostic({
          surfaceId: "subtree-listing",
          workspaceId,
          durationMs: elapsedMs,
          returnedEntries:
            response.listingBudget?.returnedEntries ??
            nextFiles.length + nextDirectories.length + nextDirectoryMetadata.length,
          payloadBytes: response.listingBudget?.payloadBytes ?? response.payloadBudget?.estimatedBytes ?? null,
          cacheState: response.listingBudget?.cacheState ?? response.payloadBudget?.cacheState ?? "unsupported",
          scanState: response.scan_state ?? response.listingBudget?.scanState ?? null,
          partial: response.scan_state === "partial" || Boolean(response.limit_hit ?? response.listingBudget?.limitHit),
          limitHit: Boolean(response.limit_hit ?? response.listingBudget?.limitHit),
          sourceVersion: response.sourceVersion ?? response.listingBudget?.sourceVersion ?? null,
          requestedPathHash: hashFileTreeDiagnosticPath(path),
          evidenceClass: response.sourceVersion || response.listingBudget?.sourceVersion ? "measured" : "unsupported",
        });

        setLazyFiles((prev) => {
          const next = new Set(prev);
          nextFiles.forEach((entry) => next.add(entry));
          return next;
        });
        setLazyDirectories((prev) => {
          const next = new Set(prev);
          nextDirectories.forEach((entry) => next.add(entry));
          return next;
        });
        setLazyLoadableDirectories((prev) => {
          const next = new Set(prev);
          nextDirectories.forEach((entry) => next.add(entry));
          nextDirectoryMetadata.forEach((entry) => {
            if (entry.child_state === "unknown" || entry.child_state === "partial") {
              next.add(entry.path);
            }
            if (entry.child_state === "empty" || entry.child_state === "loaded") {
              next.delete(entry.path);
            }
          });
          return next;
        });
        setLazyDirectoryMetadata((prev) => {
          const next = new Map(prev);
          if (nextDirectoryMetadata.length === 0) {
            const childState = nextFiles.length === 0 && nextDirectories.length === 0
              ? "empty"
              : "loaded";
            next.set(path, { path, child_state: childState });
          } else {
            nextDirectoryMetadata.forEach((entry) => next.set(entry.path, entry));
          }
          return next;
        });
        setLazyGitignoredFiles((prev) => {
          const next = new Set(prev);
          nextGitignoredFiles.forEach((entry) => next.add(entry));
          return next;
        });
        setLazyGitignoredDirectories((prev) => {
          const next = new Set(prev);
          nextGitignoredDirectories.forEach((entry) => next.add(entry));
          return next;
        });
        loadedLazyDirectoriesRef.current = new Set(loadedLazyDirectoriesRef.current).add(path);
        setLoadedLazyDirectories((prev) => {
          const next = new Set(prev);
          next.add(path);
          return next;
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLazyDirectoryLoadErrors((prev) => {
          const next = new Map(prev);
          next.set(path, message);
          return next;
        });
      } finally {
        const nextLoadingDirectories = new Set(loadingLazyDirectoriesRef.current);
        nextLoadingDirectories.delete(path);
        loadingLazyDirectoriesRef.current = nextLoadingDirectories;
        setLoadingLazyDirectories((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [
      loadedLazyDirectoriesRef,
      loadingLazyDirectoriesRef,
      setLazyDirectories,
      setLazyDirectoryLoadErrors,
      setLazyDirectoryMetadata,
      setLazyFiles,
      setLazyGitignoredDirectories,
      setLazyGitignoredFiles,
      setLazyLoadableDirectories,
      setLoadedLazyDirectories,
      setLoadingLazyDirectories,
      sourceVersionRef,
      workspaceId,
    ],
  );

  useEffect(() => {
    effectiveExpandedFolders.forEach((path) => {
      if (
        !effectiveLazyLoadableDirectories.has(path) ||
        loadedLazyDirectoriesRef.current.has(path) ||
        loadingLazyDirectoriesRef.current.has(path)
      ) {
        return;
      }
      void loadLazyDirectoryChildren(path);
    });
  }, [
    effectiveExpandedFolders,
    effectiveLazyLoadableDirectories,
    loadLazyDirectoryChildren,
    loadedLazyDirectoriesRef,
    loadingLazyDirectoriesRef,
  ]);

  const toggleFolderExpandedState = useCallback(
    (path: string, isLazyFolder: boolean) => {
      const shouldExpand = !effectiveExpandedFolders.has(path);
      setManuallyCollapsedAutoExpandedFolders((prev) => {
        if (shouldExpand) {
          if (!prev.has(path)) {
            return prev;
          }
          const next = new Set(prev);
          next.delete(path);
          return next;
        }
        if (prev.has(path)) {
          return prev;
        }
        return new Set(prev).add(path);
      });
      setExpandedFolders((prev) => {
        if (shouldExpand && prev.has(path)) {
          return prev;
        }
        if (!shouldExpand && !prev.has(path)) {
          return prev;
        }
        const next = new Set(prev);
        if (shouldExpand) {
          next.add(path);
        } else {
          next.delete(path);
        }
        return next;
      });
      if (shouldExpand && isLazyFolder) {
        void loadLazyDirectoryChildren(path);
      }
    },
    [
      effectiveExpandedFolders,
      loadLazyDirectoryChildren,
      setExpandedFolders,
      setManuallyCollapsedAutoExpandedFolders,
    ],
  );

  return { loadLazyDirectoryChildren, toggleFolderExpandedState };
}
