import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { ThreadSummary } from "../../../types";
import {
  assignWorkspaceSessionFolders,
  assignWorkspaceSessionFolder,
  createWorkspaceSessionFolder,
  deleteWorkspaceSessionFolder,
  listWorkspaceSessionFolders,
  renameWorkspaceSessionFolder,
  type WorkspaceSessionFolder,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import { registerKeydownHandler } from "../hooks/keyboardDispatcher";
import type { ThreadMoveFolderTarget } from "../hooks/useSidebarMenus";
import {
  buildWorkspaceSessionFolderMoveTargets,
  getCachedWorkspaceSessionFolderWorkspaceProjection,
  type WorkspaceSessionFolderWorkspaceProjection,
  type WorkspaceSessionFolderWorkspaceProjectionCacheEntry,
} from "../utils/workspaceSessionFolders";
import {
  runWithLoadingProgress,
  type LoadingProgressController,
} from "../utils/loadingProgressActions";
import {
  EMPTY_SESSION_FOLDER_OVERRIDES,
  EMPTY_SESSION_FOLDERS,
  collectThreadSubtreeIds,
  isPendingEngineThreadId,
  isPendingSubagentThreadId,
  isSessionCatalogNotReadyError,
  isSharedSessionThreadId,
  readPersistedCollapsedSessionFolderIds,
  resolveFolderIntentReplacementThreadId,
  updateCollapsedSessionFolderIdsForWorkspace,
  writePersistedCollapsedSessionFolderIds,
  type ThreadFolderMovePickerState,
  type WorkspaceGroupSection,
  type WorkspaceThreadRows,
} from "./sidebarInternals";

type SessionFolderActionsParams = {
  getProjectedThreads: (workspaceId: string) => ThreadSummary[];
  threadParentById: Record<string, string>;
  threadsByWorkspace: Record<string, ThreadSummary[]>;
  filteredGroupedWorkspaces: WorkspaceGroupSection[];
  onQuickReloadWorkspaceThreads?: (workspaceId: string) => Promise<void> | void;
  onToggleWorkspaceCollapse: (workspaceId: string, collapsed: boolean) => void;
  onRequestRootSessionFolderDraft?: (workspaceId: string) => void;
  showLoadingProgressDialog?: LoadingProgressController["showLoadingProgressDialog"];
  hideLoadingProgressDialog?: LoadingProgressController["hideLoadingProgressDialog"];
};

export function useSessionFolderActions({
  getProjectedThreads,
  threadParentById,
  threadsByWorkspace,
  filteredGroupedWorkspaces,
  onQuickReloadWorkspaceThreads,
  onToggleWorkspaceCollapse,
  onRequestRootSessionFolderDraft,
  showLoadingProgressDialog,
  hideLoadingProgressDialog,
}: SessionFolderActionsParams) {
  const { t } = useTranslation();
  const [sessionFoldersByWorkspaceId, setSessionFoldersByWorkspaceId] =
    useState<Record<string, WorkspaceSessionFolder[]>>(() => ({}));
  const loadedSessionFolderWorkspaceIdsRef = useRef<Set<string>>(new Set());
  const [sessionFolderErrorByWorkspaceId, setSessionFolderErrorByWorkspaceId] =
    useState<Record<string, string>>(() => ({}));
  const [
    sessionFolderOverrideByWorkspaceId,
    setSessionFolderOverrideByWorkspaceId,
  ] = useState<Record<string, Record<string, string | null>>>(() => ({}));
  const [
    pendingSessionFolderIntentByWorkspaceId,
    setPendingSessionFolderIntentByWorkspaceId,
  ] = useState<Record<string, Record<string, string>>>(() => ({}));
  const [
    localRootSessionFolderDraftRequestByWorkspaceId,
    setLocalRootSessionFolderDraftRequestByWorkspaceId,
  ] = useState<Record<string, number>>(() => ({}));
  const [
    collapsedSessionFolderIdsByWorkspaceId,
    setCollapsedSessionFolderIdsByWorkspaceId,
  ] = useState<Record<string, string[]>>(() =>
    readPersistedCollapsedSessionFolderIds(),
  );
  const pendingSessionFolderAssignInFlightRef = useRef<Set<string>>(new Set());
  const [folderMovePicker, setFolderMovePicker] =
    useState<ThreadFolderMovePickerState | null>(null);
  const sessionFolderProjectionCacheByWorkspaceIdRef = useRef(
    new Map<string, WorkspaceSessionFolderWorkspaceProjectionCacheEntry>(),
  );
  const [folderMovePickerQuery, setFolderMovePickerQuery] = useState("");
  const handleOpenRootSessionFolderDraft = useCallback(
    (workspaceId: string) => {
      onToggleWorkspaceCollapse(workspaceId, false);
      if (onRequestRootSessionFolderDraft) {
        onRequestRootSessionFolderDraft(workspaceId);
        return;
      }
      setLocalRootSessionFolderDraftRequestByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: (current[workspaceId] ?? 0) + 1,
      }));
    },
    [onRequestRootSessionFolderDraft, onToggleWorkspaceCollapse],
  );

  const mergeSessionFolder = useCallback((folder: WorkspaceSessionFolder) => {
    setSessionFoldersByWorkspaceId((current) => {
      const existingFolders = current[folder.workspaceId] ?? [];
      const replaced = existingFolders.some((entry) => entry.id === folder.id);
      const nextFolders = replaced
        ? existingFolders.map((entry) =>
            entry.id === folder.id ? folder : entry,
          )
        : [...existingFolders, folder];
      return {
        ...current,
        [folder.workspaceId]: nextFolders,
      };
    });
  }, []);

  const removeSessionFolder = useCallback(
    (workspaceId: string, folderId: string) => {
      setSessionFoldersByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: (current[workspaceId] ?? []).filter(
          (folder) => folder.id !== folderId,
        ),
      }));
      setCollapsedSessionFolderIdsByWorkspaceId((current) => {
        const nextIds = (current[workspaceId] ?? []).filter(
          (id) => id !== folderId,
        );
        const next = updateCollapsedSessionFolderIdsForWorkspace(
          current,
          workspaceId,
          nextIds,
        );
        writePersistedCollapsedSessionFolderIds(next);
        return next;
      });
    },
    [],
  );

  const assignSessionToFolder = useCallback(
    async (workspaceId: string, threadId: string, folderId: string | null) => {
      const response = await assignWorkspaceSessionFolder(
        workspaceId,
        threadId,
        folderId,
      );
      const nextFolderId = response.folderId ?? null;
      setSessionFolderOverrideByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: {
          ...(current[workspaceId] ?? {}),
          [threadId]: nextFolderId,
        },
      }));
      onQuickReloadWorkspaceThreads?.(workspaceId);
    },
    [onQuickReloadWorkspaceThreads],
  );

  const assignThreadSubtreeToFolder = useCallback(
    async (workspaceId: string, threadId: string, folderId: string | null) => {
      const projectedThreads = getProjectedThreads(workspaceId);
      const threadIds = new Set(projectedThreads.map((thread) => thread.id));
      const targetThreadIds = (
        threadIds.has(threadId)
          ? collectThreadSubtreeIds(
              projectedThreads,
              threadParentById,
              threadId,
            )
          : [threadId]
      ).filter((targetThreadId) => !isPendingSubagentThreadId(targetThreadId));
      if (targetThreadIds.length === 0) {
        return;
      }
      const response = await assignWorkspaceSessionFolders(
        workspaceId,
        targetThreadIds,
        folderId,
      );
      const failedResults = response.results.filter((result) => !result.ok);
      const respondedThreadIds = new Set(
        response.results.map((result) => result.sessionId),
      );
      const missingThreadIds = targetThreadIds.filter((targetThreadId) => {
        return !respondedThreadIds.has(targetThreadId);
      });
      const successfulThreadIds = response.results
        .filter((result) => result.ok)
        .map((result) => result.sessionId);
      if (successfulThreadIds.length > 0) {
        setSessionFolderOverrideByWorkspaceId((current) => {
          const workspaceOverrides = current[workspaceId] ?? {};
          const nextWorkspaceOverrides = { ...workspaceOverrides };
          successfulThreadIds.forEach((targetThreadId) => {
            nextWorkspaceOverrides[targetThreadId] = folderId;
          });
          return {
            ...current,
            [workspaceId]: nextWorkspaceOverrides,
          };
        });
        onQuickReloadWorkspaceThreads?.(workspaceId);
      }
      if (failedResults.length > 0 || missingThreadIds.length > 0) {
        const firstFailureMessage =
          failedResults.find((result) => result.error?.trim())?.error ??
          (missingThreadIds.length > 0
            ? `Missing assignment response for ${missingThreadIds.length} session(s).`
            : "Session folder assignment failed.");
        if (successfulThreadIds.length === 0) {
          throw new Error(firstFailureMessage);
        }
        throw new Error(
          `${firstFailureMessage} ${successfulThreadIds.length}/${targetThreadIds.length} session(s) moved.`,
        );
      }
    },
    [getProjectedThreads, onQuickReloadWorkspaceThreads, threadParentById],
  );

  const loadingProgressController =
    useMemo<LoadingProgressController | null>(() => {
      if (!showLoadingProgressDialog || !hideLoadingProgressDialog) {
        return null;
      }
      return {
        showLoadingProgressDialog,
        hideLoadingProgressDialog,
      };
    }, [hideLoadingProgressDialog, showLoadingProgressDialog]);

  const resolveMoveTargetLabel = useCallback(
    (workspaceId: string, folderId: string | null, fallbackLabel?: string) => {
      if (fallbackLabel?.trim()) {
        return fallbackLabel;
      }
      if (!folderId) {
        return t("threads.moveToProjectRoot");
      }
      return (
        sessionFoldersByWorkspaceId[workspaceId]?.find(
          (folder) => folder.id === folderId,
        )?.name ?? t("threads.moveToFolder")
      );
    },
    [sessionFoldersByWorkspaceId, t],
  );

  const moveThreadSubtreeToFolder = useCallback(
    async (
      workspaceId: string,
      threadId: string,
      folderId: string | null,
      fallbackLabel?: string,
    ) => {
      const moveAction = () =>
        assignThreadSubtreeToFolder(workspaceId, threadId, folderId);
      if (!loadingProgressController) {
        await moveAction();
        return;
      }
      await runWithLoadingProgress(
        loadingProgressController,
        {
          title: t("sidebar.loadingProgressMoveSessionTitle"),
          message: t("sidebar.loadingProgressMoveSessionMessage", {
            folder: resolveMoveTargetLabel(
              workspaceId,
              folderId,
              fallbackLabel,
            ),
          }),
        },
        moveAction,
      );
    },
    [
      assignThreadSubtreeToFolder,
      loadingProgressController,
      resolveMoveTargetLabel,
      t,
    ],
  );

  const clearPendingSessionFolderIntent = useCallback(
    (workspaceId: string, threadId: string) => {
      setPendingSessionFolderIntentByWorkspaceId((current) => {
        const intents = current[workspaceId];
        if (!intents || !Object.hasOwn(intents, threadId)) {
          return current;
        }
        const { [threadId]: _removed, ...restIntents } = intents;
        if (Object.keys(restIntents).length === 0) {
          const { [workspaceId]: _workspaceRemoved, ...rest } = current;
          return rest;
        }
        return {
          ...current,
          [workspaceId]: restIntents,
        };
      });
    },
    [],
  );

  const rememberPendingSessionFolderIntent = useCallback(
    (workspaceId: string, threadId: string, folderId: string) => {
      setPendingSessionFolderIntentByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: {
          ...(current[workspaceId] ?? {}),
          [threadId]: folderId,
        },
      }));
      setSessionFolderOverrideByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: {
          ...(current[workspaceId] ?? {}),
          [threadId]: folderId,
        },
      }));
    },
    [],
  );

  const rememberLocalSessionFolderOverride = useCallback(
    (workspaceId: string, threadId: string, folderId: string) => {
      setSessionFolderOverrideByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: {
          ...(current[workspaceId] ?? {}),
          [threadId]: folderId,
        },
      }));
    },
    [],
  );

  const migrateLocalSessionFolderOverride = useCallback(
    (
      workspaceId: string,
      sourceThreadId: string,
      targetThreadId: string,
      folderId: string,
    ) => {
      setSessionFolderOverrideByWorkspaceId((current) => {
        const workspaceOverrides = current[workspaceId] ?? {};
        const sourceHasOverride = Object.hasOwn(
          workspaceOverrides,
          sourceThreadId,
        );
        if (
          workspaceOverrides[targetThreadId] === folderId &&
          (!sourceHasOverride || sourceThreadId === targetThreadId)
        ) {
          return current;
        }
        const nextWorkspaceOverrides = {
          ...workspaceOverrides,
          [targetThreadId]: folderId,
        };
        if (sourceThreadId !== targetThreadId) {
          delete nextWorkspaceOverrides[sourceThreadId];
        }
        return {
          ...current,
          [workspaceId]: nextWorkspaceOverrides,
        };
      });
    },
    [],
  );

  const assignNewSessionToFolder = useCallback(
    async (workspaceId: string, threadId: string, folderId: string) => {
      if (isSharedSessionThreadId(threadId)) {
        rememberLocalSessionFolderOverride(workspaceId, threadId, folderId);
        return;
      }
      if (isPendingEngineThreadId(threadId)) {
        rememberPendingSessionFolderIntent(workspaceId, threadId, folderId);
        return;
      }
      try {
        await assignSessionToFolder(workspaceId, threadId, folderId);
        clearPendingSessionFolderIntent(workspaceId, threadId);
      } catch (error: unknown) {
        if (isSessionCatalogNotReadyError(error)) {
          rememberPendingSessionFolderIntent(workspaceId, threadId, folderId);
          return;
        }
        pushErrorToast({
          title: t("sidebar.sessionFolderMoveFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    [
      assignSessionToFolder,
      clearPendingSessionFolderIntent,
      rememberLocalSessionFolderOverride,
      rememberPendingSessionFolderIntent,
      t,
    ],
  );

  useEffect(() => {
    Object.entries(pendingSessionFolderIntentByWorkspaceId).forEach(
      ([workspaceId, intents]) => {
        const workspaceThreads = threadsByWorkspace[workspaceId] ?? [];
        Object.entries(intents).forEach(([intentThreadId, folderId]) => {
          const targetThreadId = resolveFolderIntentReplacementThreadId(
            intentThreadId,
            workspaceThreads,
          );
          if (!targetThreadId || isPendingEngineThreadId(targetThreadId)) {
            return;
          }
          const assignKey = `${workspaceId}:${intentThreadId}:${targetThreadId}:${folderId}`;
          if (pendingSessionFolderAssignInFlightRef.current.has(assignKey)) {
            return;
          }
          migrateLocalSessionFolderOverride(
            workspaceId,
            intentThreadId,
            targetThreadId,
            folderId,
          );
          pendingSessionFolderAssignInFlightRef.current.add(assignKey);
          void assignSessionToFolder(workspaceId, targetThreadId, folderId)
            .then(() => {
              clearPendingSessionFolderIntent(workspaceId, intentThreadId);
              if (targetThreadId !== intentThreadId) {
                clearPendingSessionFolderIntent(workspaceId, targetThreadId);
              }
            })
            .catch((error: unknown) => {
              if (isSessionCatalogNotReadyError(error)) {
                return;
              }
              clearPendingSessionFolderIntent(workspaceId, intentThreadId);
              pushErrorToast({
                title: t("sidebar.sessionFolderMoveFailed"),
                message: error instanceof Error ? error.message : String(error),
                durationMs: 5000,
              });
            })
            .finally(() => {
              pendingSessionFolderAssignInFlightRef.current.delete(assignKey);
            });
        });
      },
    );
  }, [
    assignSessionToFolder,
    clearPendingSessionFolderIntent,
    migrateLocalSessionFolderOverride,
    pendingSessionFolderIntentByWorkspaceId,
    threadsByWorkspace,
    t,
  ]);

  useEffect(() => {
    let cancelled = false;
    const workspaceIds = filteredGroupedWorkspaces
      .flatMap((group) => group.workspaces)
      .filter((workspace) => !workspace.settings.sidebarCollapsed)
      .map((workspace) => workspace.id);
    const missingWorkspaceIds = workspaceIds.filter(
      (workspaceId) =>
        sessionFoldersByWorkspaceId[workspaceId] === undefined &&
        !loadedSessionFolderWorkspaceIdsRef.current.has(workspaceId),
    );
    if (missingWorkspaceIds.length === 0) {
      return;
    }

    missingWorkspaceIds.forEach((workspaceId) => {
      listWorkspaceSessionFolders(workspaceId)
        .then((tree) => {
          if (cancelled) {
            return;
          }
          loadedSessionFolderWorkspaceIdsRef.current.add(workspaceId);
          if (tree.folders.length > 0) {
            setSessionFoldersByWorkspaceId((current) => ({
              ...current,
              [workspaceId]: tree.folders,
            }));
          }
          setCollapsedSessionFolderIdsByWorkspaceId((current) => {
            const liveFolderIds = new Set(
              tree.folders.map((folder) => folder.id),
            );
            const currentIds = current[workspaceId] ?? [];
            const nextIds = currentIds.filter((id) => liveFolderIds.has(id));
            if (nextIds.length === currentIds.length) {
              return current;
            }
            const next = updateCollapsedSessionFolderIdsForWorkspace(
              current,
              workspaceId,
              nextIds,
            );
            writePersistedCollapsedSessionFolderIds(next);
            return next;
          });
          setSessionFolderErrorByWorkspaceId((current) => {
            if (!Object.hasOwn(current, workspaceId)) {
              return current;
            }
            const { [workspaceId]: _unused, ...rest } = current;
            return rest;
          });
        })
        .catch((error: unknown) => {
          if (cancelled) {
            return;
          }
          const message =
            error instanceof Error ? error.message : String(error);
          loadedSessionFolderWorkspaceIdsRef.current.add(workspaceId);
          setSessionFoldersByWorkspaceId((current) => ({
            ...current,
            [workspaceId]: [],
          }));
          setSessionFolderErrorByWorkspaceId((current) => ({
            ...current,
            [workspaceId]: message,
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [filteredGroupedWorkspaces, sessionFoldersByWorkspaceId]);

  const refreshWorkspaceSessionFolders = useCallback(
    async (workspaceId: string) => {
      const tree = await listWorkspaceSessionFolders(workspaceId);
      loadedSessionFolderWorkspaceIdsRef.current.add(workspaceId);
      setSessionFoldersByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: tree.folders,
      }));
      setCollapsedSessionFolderIdsByWorkspaceId((current) => {
        const liveFolderIds = new Set(tree.folders.map((folder) => folder.id));
        const nextIds = (current[workspaceId] ?? []).filter((id) =>
          liveFolderIds.has(id),
        );
        if (nextIds.length === (current[workspaceId] ?? []).length) {
          return current;
        }
        const next = updateCollapsedSessionFolderIdsForWorkspace(
          current,
          workspaceId,
          nextIds,
        );
        writePersistedCollapsedSessionFolderIds(next);
        return next;
      });
      setSessionFolderErrorByWorkspaceId((current) => {
        if (!Object.hasOwn(current, workspaceId)) {
          return current;
        }
        const { [workspaceId]: _unused, ...rest } = current;
        return rest;
      });
    },
    [],
  );

  const handleToggleSessionFolderCollapsed = useCallback(
    (workspaceId: string, folderId: string) => {
      setCollapsedSessionFolderIdsByWorkspaceId((current) => {
        const ids = new Set(current[workspaceId] ?? []);
        if (ids.has(folderId)) {
          ids.delete(folderId);
        } else {
          ids.add(folderId);
        }
        const next = updateCollapsedSessionFolderIdsForWorkspace(
          current,
          workspaceId,
          Array.from(ids),
        );
        writePersistedCollapsedSessionFolderIds(next);
        return next;
      });
    },
    [],
  );

  const closeFolderMovePicker = useCallback(() => {
    setFolderMovePicker(null);
    setFolderMovePickerQuery("");
  }, []);

  const openThreadFolderMovePicker = useCallback(
    (
      workspaceId: string,
      threadId: string,
      targets: ThreadMoveFolderTarget[],
      currentFolderId: string | null,
    ) => {
      setFolderMovePicker({
        workspaceId,
        threadId,
        targets,
        currentFolderId,
      });
      setFolderMovePickerQuery("");
    },
    [],
  );

  const selectFolderMoveTarget = useCallback(
    async (target: ThreadMoveFolderTarget) => {
      if (!folderMovePicker) {
        return;
      }
      if (
        (target.folderId ?? null) === (folderMovePicker.currentFolderId ?? null)
      ) {
        return;
      }
      const moveRequest = folderMovePicker;
      closeFolderMovePicker();
      try {
        await moveThreadSubtreeToFolder(
          moveRequest.workspaceId,
          moveRequest.threadId,
          target.folderId,
          target.label,
        );
      } catch (error: unknown) {
        pushErrorToast({
          title: t("sidebar.sessionFolderMoveFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    [closeFolderMovePicker, folderMovePicker, moveThreadSubtreeToFolder, t],
  );

  const filteredFolderMoveTargets = useMemo(() => {
    if (!folderMovePicker) {
      return [];
    }
    const keyword = folderMovePickerQuery.trim().toLowerCase();
    return folderMovePicker.targets.filter((target) => {
      if (target.folderId === null) {
        return true;
      }
      if (!keyword) {
        return true;
      }
      return target.label.toLowerCase().includes(keyword);
    });
  }, [folderMovePicker, folderMovePickerQuery]);

  useEffect(() => {
    if (!folderMovePicker) {
      return;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFolderMovePicker();
      }
    };
    return registerKeydownHandler(handleWindowKeyDown);
  }, [closeFolderMovePicker, folderMovePicker]);

  const handleCreateSessionFolder = useCallback(
    async (workspaceId: string, name: string, parentId: string | null) => {
      const trimmedName = name.trim();
      if (!trimmedName) {
        return;
      }
      try {
        const mutation = await createWorkspaceSessionFolder(
          workspaceId,
          trimmedName,
          parentId,
        );
        mergeSessionFolder(mutation.folder);
        await refreshWorkspaceSessionFolders(workspaceId);
      } catch (error: unknown) {
        pushErrorToast({
          title: t("sidebar.sessionFolderCreateFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    [mergeSessionFolder, refreshWorkspaceSessionFolders, t],
  );

  const handleRenameSessionFolder = useCallback(
    async (workspaceId: string, folderId: string, name: string) => {
      const trimmedName = name.trim();
      const currentFolder = sessionFoldersByWorkspaceId[workspaceId]?.find(
        (folder) => folder.id === folderId,
      );
      if (!trimmedName || trimmedName === currentFolder?.name) {
        return;
      }
      try {
        const mutation = await renameWorkspaceSessionFolder(
          workspaceId,
          folderId,
          trimmedName,
        );
        mergeSessionFolder(mutation.folder);
        await refreshWorkspaceSessionFolders(workspaceId);
      } catch (error: unknown) {
        pushErrorToast({
          title: t("sidebar.sessionFolderRenameFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    [
      mergeSessionFolder,
      refreshWorkspaceSessionFolders,
      sessionFoldersByWorkspaceId,
      t,
    ],
  );

  const handleDeleteSessionFolder = useCallback(
    async (workspaceId: string, folderId: string, _name: string) => {
      try {
        await deleteWorkspaceSessionFolder(workspaceId, folderId);
        removeSessionFolder(workspaceId, folderId);
        await refreshWorkspaceSessionFolders(workspaceId);
      } catch (error: unknown) {
        pushErrorToast({
          title: t("sidebar.sessionFolderDeleteFailed"),
          message: error instanceof Error ? error.message : String(error),
          durationMs: 5000,
        });
      }
    },
    [refreshWorkspaceSessionFolders, removeSessionFolder, t],
  );

  const moveFolderTargetsByWorkspaceId = useMemo(() => {
    const targetsByWorkspaceId: Record<string, ThreadMoveFolderTarget[]> = {};
    for (const [workspaceId, folders] of Object.entries(
      sessionFoldersByWorkspaceId,
    )) {
      targetsByWorkspaceId[workspaceId] =
        buildWorkspaceSessionFolderMoveTargets({
          folders,
          rootLabel: t("threads.moveToProjectRoot"),
        });
    }
    return targetsByWorkspaceId;
  }, [sessionFoldersByWorkspaceId, t]);

  const getWorkspaceSessionFolderProjection = useCallback(
    (
      workspaceId: string,
      rows: WorkspaceThreadRows["unpinnedRows"],
    ): WorkspaceSessionFolderWorkspaceProjection => {
      const folders =
        sessionFoldersByWorkspaceId[workspaceId] ?? EMPTY_SESSION_FOLDERS;
      const folderOverrides =
        sessionFolderOverrideByWorkspaceId[workspaceId] ??
        EMPTY_SESSION_FOLDER_OVERRIDES;
      const rootLabel = t("threads.moveToProjectRoot");
      return getCachedWorkspaceSessionFolderWorkspaceProjection(
        sessionFolderProjectionCacheByWorkspaceIdRef.current,
        workspaceId,
        {
          folders,
          rows,
          folderOverrides,
          rootLabel,
        },
      );
    },
    [sessionFolderOverrideByWorkspaceId, sessionFoldersByWorkspaceId, t],
  );

  return {
    sessionFoldersByWorkspaceId,
    sessionFolderErrorByWorkspaceId,
    collapsedSessionFolderIdsByWorkspaceId,
    setCollapsedSessionFolderIdsByWorkspaceId,
    localRootSessionFolderDraftRequestByWorkspaceId,
    folderMovePicker,
    folderMovePickerQuery,
    setFolderMovePickerQuery,
    filteredFolderMoveTargets,
    handleOpenRootSessionFolderDraft,
    assignNewSessionToFolder,
    moveThreadSubtreeToFolder,
    openThreadFolderMovePicker,
    closeFolderMovePicker,
    selectFolderMoveTarget,
    handleCreateSessionFolder,
    handleRenameSessionFolder,
    handleDeleteSessionFolder,
    handleToggleSessionFolderCollapsed,
    moveFolderTargetsByWorkspaceId,
    getWorkspaceSessionFolderProjection,
  };
}
