import {
  Fragment,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { SessionListSection } from "./SessionManagementSessionList";
import Archive from "lucide-react/dist/esm/icons/archive";
import CheckSquare2 from "lucide-react/dist/esm/icons/check-square-2";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import ChevronsDown from "lucide-react/dist/esm/icons/chevrons-down";
import CircleX from "lucide-react/dist/esm/icons/circle-x";
import FolderInput from "lucide-react/dist/esm/icons/folder-input";
import FolderTree from "lucide-react/dist/esm/icons/folder-tree";
import GitBranch from "lucide-react/dist/esm/icons/git-branch";
import RotateCw from "lucide-react/dist/esm/icons/rotate-cw";
import SlidersHorizontal from "lucide-react/dist/esm/icons/sliders-horizontal";
import Trash2 from "lucide-react/dist/esm/icons/trash-2";
import Undo2 from "lucide-react/dist/esm/icons/undo-2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_VISIBLE_THREAD_ROOT_COUNT,
  MAX_VISIBLE_THREAD_ROOT_COUNT,
  MIN_VISIBLE_THREAD_ROOT_COUNT,
  normalizeGlobalVisibleThreadRootCount,
  normalizeVisibleThreadRootCount,
  resolveVisibleThreadRootPageSize,
} from "../../../../app/constants";
import type {
  AppSettings,
  WorkspaceSessionAttributionMode,
  WorkspaceInfo,
  WorkspaceSettings,
} from "../../../../../types";
import {
  buildWorkspaceSessionSelectionKey,
  useWorkspaceSessionCatalog,
  type WorkspaceSessionCatalogMode,
  type WorkspaceSessionCatalogFilters,
  type WorkspaceSessionCatalogSource,
} from "../hooks/useWorkspaceSessionCatalog";
import { useWorkspaceSessionProjectionSummary } from "../../../../workspaces/hooks/useWorkspaceSessionProjectionSummary";
import type { WorkspaceSessionFolder } from "../../../../../services/tauri";
import {
  buildLoadedSessionFolderCountSummary,
  buildSessionFolderNavItems,
  buildWorkspaceOptions,
  type GroupedWorkspace,
  type SessionFolderCountSummary,
} from "./sessionManagementSectionUtils";
import {
  createWorkspaceSessionFolder,
  listWorkspaceSessionFolders,
} from "../../../../../services/tauri";
import {
  SESSION_FOLDER_FILTER_ALL,
  SESSION_FOLDER_FILTER_ROOT,
  areWorkspaceSessionCatalogFiltersEqual,
  collectDeletedThreadIdsByWorkspaceId,
  collectSucceededWorkspaceIds,
  parseVisibleThreadRootCountDraft,
  resolveMutationFailureReason,
  resolveStatusFilterLabel,
  type SessionFolderFilter,
} from "./sessionManagementSectionHelpers";
import { useSessionCurtain } from "./useSessionCurtain";
import { SessionFolderNavControls } from "./SessionFolderNavControls";
import { SessionCurtainDialog } from "./SessionCurtainDialog";

export {
  collectSucceededWorkspaceIds,
  parseVisibleThreadRootCountDraft,
  resolveMutationFailureReason,
  resolveStatusFilterLabel,
} from "./sessionManagementSectionHelpers";
export type { CodexCurtainSourceResult } from "./useSessionCurtain";
export {
  extractHistoryMessagesPayload,
  extractThreadFromResumeResponse,
  getConversationItemLabel,
  getConversationItemText,
  loadCodexCurtainItemsWithTimeout,
  loadCodexLocalCurtainItems,
  loadCodexResumeCurtainItems,
  resolveNativeSessionId,
} from "./useSessionCurtain";

type NoticeState =
  | { kind: "success"; text: string }
  | { kind: "error"; text: string }
  | null;

type SessionManagementSectionProps = {
  title: string;
  description: string;
  appSettings?: AppSettings;
  workspaces: WorkspaceInfo[];
  groupedWorkspaces: GroupedWorkspace[];
  initialWorkspaceId?: string | null;
  onUpdateAppSettings?: (next: AppSettings) => Promise<void>;
  onUpdateWorkspaceSettings?: (
    workspaceId: string,
    settings: Partial<WorkspaceSettings>,
  ) => Promise<void>;
  onSessionsMutated?: (
    workspaceId: string,
    options?: { deletedThreadIds?: string[] },
  ) => void;
};


const ENGINE_FILTER_ALL_VALUE = "__all__";

const DEFAULT_FILTERS: WorkspaceSessionCatalogFilters = {
  keyword: "",
  engine: "",
  status: "active",
};

export function SessionManagementSection({
  title,
  appSettings,
  workspaces,
  groupedWorkspaces,
  initialWorkspaceId = null,
  onUpdateAppSettings,
  onUpdateWorkspaceSettings,
  onSessionsMutated,
}: SessionManagementSectionProps) {
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const workspaceScopeLabels = useMemo(
    () => ({
      project: t("settings.sessionManagementScopeTagProject"),
      worktree: t("settings.sessionManagementScopeTagWorktree"),
    }),
    [t],
  );
  const workspaceOptions = useMemo(
    () =>
      buildWorkspaceOptions(
        workspaces,
        groupedWorkspaces,
        workspaceScopeLabels,
      ),
    [groupedWorkspaces, workspaceScopeLabels, workspaces],
  );
  const workspaceLabelById = useMemo(
    () => new Map(workspaceOptions.map((option) => [option.id, option.label])),
    [workspaceOptions],
  );
  const [workspaceId, setWorkspaceId] = useState<string | null>(
    initialWorkspaceId &&
      workspaceOptions.some((item) => item.id === initialWorkspaceId)
      ? initialWorkspaceId
      : (workspaceOptions[0]?.id ?? null),
  );
  const appliedInitialWorkspaceIdRef = useRef<string | null>(null);
  const [mode, setMode] = useState<WorkspaceSessionCatalogMode>("project");
  const [draftFilters, setDraftFilters] =
    useState<WorkspaceSessionCatalogFilters>(DEFAULT_FILTERS);
  const [queryFilters, setQueryFilters] =
    useState<WorkspaceSessionCatalogFilters>(DEFAULT_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({});
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [notice, setNotice] = useState<NoticeState>(null);
  const [sessionFolderFilter, setSessionFolderFilter] =
    useState<SessionFolderFilter>(SESSION_FOLDER_FILTER_ALL);
  const [sessionFolders, setSessionFolders] = useState<
    WorkspaceSessionFolder[]
  >([]);
  const [sessionFoldersLoading, setSessionFoldersLoading] = useState(false);
  const [sessionFolderError, setSessionFolderError] = useState<string | null>(
    null,
  );
  const [sessionFolderDraftOpen, setSessionFolderDraftOpen] = useState(false);
  const [sessionFolderDraftName, setSessionFolderDraftName] = useState("");
  const [isCreatingSessionFolder, setIsCreatingSessionFolder] = useState(false);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string>(
    SESSION_FOLDER_FILTER_ROOT,
  );
  const [visibleThreadRootCountDraft, setVisibleThreadRootCountDraft] =
    useState(String(DEFAULT_VISIBLE_THREAD_ROOT_COUNT));
  const [isSavingVisibleThreadRootCount, setIsSavingVisibleThreadRootCount] =
    useState(false);
  const [isSavingAttributionMode, setIsSavingAttributionMode] =
    useState(false);
  const {
    sessionCurtain,
    handleOpenSessionCurtain,
    handleReloadSessionCurtain,
    handleCloseSessionCurtain,
    closeSessionCurtainIfDeleted,
  } = useSessionCurtain({ workspaces });
  const primarySource: WorkspaceSessionCatalogSource = "strict";
  const resolvedAppSettings =
    appSettings ?? ({ sessionAttributionMode: "related" } as AppSettings);
  const effectiveAttributionMode: WorkspaceSessionAttributionMode =
    resolvedAppSettings.sessionAttributionMode === "workspace-only"
      ? "workspace-only"
      : "related";
  const effectiveAttributionModeLabel =
    effectiveAttributionMode === "workspace-only"
      ? t("settings.sessionAttributionModeWorkspaceOnly")
      : t("settings.sessionAttributionModeRelated");
  useEffect(() => {
    if (areWorkspaceSessionCatalogFiltersEqual(queryFilters, draftFilters)) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      startTransition(() => {
        setQueryFilters((current) =>
          areWorkspaceSessionCatalogFiltersEqual(current, draftFilters)
            ? current
            : draftFilters,
        );
      });
    }, 300);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draftFilters, queryFilters]);
  const summaryQuery = useMemo(
    () => ({
      keyword: queryFilters.keyword,
      engine: queryFilters.engine,
      status: queryFilters.status,
      sessionAttributionMode: effectiveAttributionMode,
    }),
    [
      effectiveAttributionMode,
      queryFilters.engine,
      queryFilters.keyword,
      queryFilters.status,
    ],
  );
  const catalogFilters = useMemo<WorkspaceSessionCatalogFilters>(
    () => ({
      ...queryFilters,
      folderId:
        mode === "project" && sessionFolderFilter !== SESSION_FOLDER_FILTER_ALL
          ? sessionFolderFilter
          : null,
    }),
    [mode, queryFilters, sessionFolderFilter],
  );
  const {
    summary: projectionSummary,
    error: projectionSummaryError,
    isLoading: projectionSummaryLoading,
    reload: reloadProjectionSummary,
  } = useWorkspaceSessionProjectionSummary({
    workspaceId: mode === "project" ? workspaceId : null,
    query: summaryQuery,
    enabled: mode === "project" && Boolean(workspaceId),
  });
  const {
    entries: primaryEntries,
    nextCursor: primaryNextCursor,
    partialSource: primaryPartialSource,
    pageLimit: primaryPageLimit,
    error: primaryError,
    isLoading: primaryIsLoading,
    isLoadingMore: primaryIsLoadingMore,
    isMutating,
    reload: reloadPrimary,
    loadMore: loadMorePrimary,
    mutate,
  } = useWorkspaceSessionCatalog({
    mode,
    workspaceId,
    filters: catalogFilters,
    sessionAttributionMode: effectiveAttributionMode,
    source: primarySource,
  });
  const {
    entries: relatedEntries,
    nextCursor: relatedNextCursor,
    partialSource: relatedPartialSource,
    pageLimit: relatedPageLimit,
    error: relatedError,
    isLoading: relatedIsLoading,
    isLoadingMore: relatedIsLoadingMore,
    reload: reloadRelated,
    loadMore: loadMoreRelated,
  } = useWorkspaceSessionCatalog({
    mode: "project",
    workspaceId,
    filters: queryFilters,
    sessionAttributionMode: effectiveAttributionMode,
    source: "related",
    enabled: mode === "project" && effectiveAttributionMode === "related",
  });

  const loadedFolderCountSummary = useMemo(
    () => buildLoadedSessionFolderCountSummary(primaryEntries),
    [primaryEntries],
  );
  const summaryFolderCountsById = projectionSummary?.folderCountsById;
  const effectiveFolderCountSummary = useMemo<SessionFolderCountSummary>(() => {
    if (summaryFolderCountsById) {
      return {
        folderCountsById: new Map(Object.entries(summaryFolderCountsById)),
        unassignedFolderCount:
          projectionSummary.unassignedFolderCount ??
          loadedFolderCountSummary.unassignedFolderCount,
      };
    }
    return loadedFolderCountSummary;
  }, [
    loadedFolderCountSummary,
    projectionSummary?.unassignedFolderCount,
    summaryFolderCountsById,
  ]);
  const folderNavItems = useMemo(
    () =>
      buildSessionFolderNavItems(
        sessionFolders,
        effectiveFolderCountSummary.folderCountsById,
      ),
    [effectiveFolderCountSummary.folderCountsById, sessionFolders],
  );
  const folderIds = useMemo(
    () => new Set(sessionFolders.map((folder) => folder.id)),
    [sessionFolders],
  );
  const visiblePrimaryEntries = useMemo(() => primaryEntries, [primaryEntries]);
  const visibleRelatedEntries = useMemo(
    () =>
      effectiveAttributionMode === "related" &&
      sessionFolderFilter === SESSION_FOLDER_FILTER_ALL
        ? relatedEntries
        : [],
    [effectiveAttributionMode, relatedEntries, sessionFolderFilter],
  );
  const visibleEntries = useMemo(
    () =>
      mode === "global"
        ? primaryEntries
        : [...visiblePrimaryEntries, ...visibleRelatedEntries],
    [mode, primaryEntries, visiblePrimaryEntries, visibleRelatedEntries],
  );
  const visiblePrimaryCount = visiblePrimaryEntries.length;
  const projectScopeTotalCount =
    projectionSummary?.filteredTotal ?? visiblePrimaryCount;
  const selectedFolderTotalCount =
    sessionFolderFilter === SESSION_FOLDER_FILTER_ALL
      ? projectScopeTotalCount
      : sessionFolderFilter === SESSION_FOLDER_FILTER_ROOT
        ? effectiveFolderCountSummary.unassignedFolderCount
        : (effectiveFolderCountSummary.folderCountsById.get(
            sessionFolderFilter,
          ) ?? 0);
  const filteredTotalCount =
    mode === "project" ? selectedFolderTotalCount : visiblePrimaryCount;
  const currentPageVisibleCount = visiblePrimaryCount;
  const activeProjectionOwnerCount =
    projectionSummary?.ownerWorkspaceIds.length ?? 0;
  const activeTotalCount = projectionSummary?.activeTotal ?? 0;
  const summaryPartialSource =
    projectionSummary?.partialSources &&
    projectionSummary.partialSources.length > 0
      ? projectionSummary.partialSources.join(",")
      : null;
  const primaryPartialSourceNotice =
    primaryPartialSource && primaryPartialSource !== summaryPartialSource
      ? primaryPartialSource
      : null;

  const selectedCount = useMemo(
    () => Object.keys(selectedIds).length,
    [selectedIds],
  );
  const allSelected =
    visibleEntries.length > 0 &&
    visibleEntries.every((entry) =>
      Boolean(selectedIds[buildWorkspaceSessionSelectionKey(entry)]),
    );

  const engineFilterLabel = useMemo(
    () => ({
      all: t("settings.sessionManagementEngineAll"),
      codex: t("settings.projectSessionEngineCodex"),
      claude: t("settings.projectSessionEngineClaude"),
      gemini: t("settings.projectSessionEngineGemini"),
      opencode: t("settings.projectSessionEngineOpencode"),
      kimi: t("settings.projectSessionEngineKimi"),
      grok: t("settings.projectSessionEngineGrok"),
      pi: t("settings.projectSessionEnginePi"),
      qoder: t("settings.projectSessionEngineQoder"),
      dsh: t("settings.projectSessionEngineDsh"),
      shared: t("settings.projectSessionEngineShared"),
    }),
    [t],
  );

  const toggleSelection = (selectionKey: string) => {
    setSelectedIds((current) => {
      if (current[selectionKey]) {
        const next = { ...current };
        delete next[selectionKey];
        return next;
      }
      return { ...current, [selectionKey]: true };
    });
  };

  const resetSelection = () => {
    setSelectedIds({});
    setDeleteArmed(false);
  };

  const keepOnlySelected = (selectionKeys: string[]) => {
    const next: Record<string, true> = {};
    selectionKeys.forEach((selectionKey) => {
      next[selectionKey] = true;
    });
    setSelectedIds(next);
    setDeleteArmed(false);
  };

  const handleSelectAll = () => {
    const next: Record<string, true> = {};
    visibleEntries.forEach((entry) => {
      next[buildWorkspaceSessionSelectionKey(entry)] = true;
    });
    setSelectedIds(next);
  };

  const getSelectedVisibleEntries = () =>
    visibleEntries.filter((entry) =>
      Boolean(selectedIds[buildWorkspaceSessionSelectionKey(entry)]),
    );

  const handleWorkspaceChange = (nextWorkspaceId: string | null) => {
    setWorkspaceId(nextWorkspaceId ?? null);
    setSessionFolderFilter(SESSION_FOLDER_FILTER_ALL);
    setSessionFolderDraftOpen(false);
    setSessionFolderDraftName("");
    setMoveTargetFolderId(SESSION_FOLDER_FILTER_ROOT);
    resetSelection();
    setNotice(null);
  };

  const handleFiltersChange = (
    nextFilters: Partial<WorkspaceSessionCatalogFilters>,
  ) => {
    const hasImmediateQueryChange =
      nextFilters.engine !== undefined ||
      nextFilters.status !== undefined ||
      nextFilters.folderId !== undefined;
    const applyPatch = (current: WorkspaceSessionCatalogFilters) => ({
      ...current,
      ...nextFilters,
    });
    setDraftFilters(applyPatch);
    if (hasImmediateQueryChange) {
      startTransition(() => {
        setQueryFilters(applyPatch);
      });
    }
    resetSelection();
    setNotice(null);
  };

  const handleRefresh = async () => {
    await Promise.all([
      reloadPrimary(),
      mode === "project" ? reloadRelated() : Promise.resolve(),
      mode === "project" && workspaceId
        ? reloadSessionFolders(workspaceId)
        : Promise.resolve(),
      mode === "project" && workspaceId
        ? reloadProjectionSummary()
        : Promise.resolve(),
    ]);
    resetSelection();
  };

  const handleModeChange = (nextMode: WorkspaceSessionCatalogMode) => {
    setMode(nextMode);
    setSessionFolderFilter(SESSION_FOLDER_FILTER_ALL);
    setSessionFolderDraftOpen(false);
    setSessionFolderDraftName("");
    setMoveTargetFolderId(SESSION_FOLDER_FILTER_ROOT);
    resetSelection();
    setNotice(null);
  };

  const handleAttributionModeChange = async (
    nextMode: WorkspaceSessionAttributionMode,
  ) => {
    if (nextMode === effectiveAttributionMode || isSavingAttributionMode) {
      return;
    }
    if (!onUpdateAppSettings) {
      return;
    }
    setIsSavingAttributionMode(true);
    try {
      await onUpdateAppSettings({
        ...resolvedAppSettings,
        sessionAttributionMode: nextMode,
      });
      resetSelection();
      setNotice(null);
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSavingAttributionMode(false);
    }
  };

  const handleSessionFolderFilterChange = (
    nextFolderFilter: SessionFolderFilter,
  ) => {
    setSessionFolderFilter(nextFolderFilter);
    setSessionFolderDraftOpen(false);
    setSessionFolderDraftName("");
    resetSelection();
    setNotice(null);
  };

  const reloadSessionFolders = async (targetWorkspaceId: string) => {
    setSessionFoldersLoading(true);
    setSessionFolderError(null);
    try {
      const response = await listWorkspaceSessionFolders(targetWorkspaceId);
      setSessionFolders(response.folders);
    } catch (error) {
      setSessionFolderError(
        error instanceof Error ? error.message : String(error),
      );
      setSessionFolders([]);
    } finally {
      setSessionFoldersLoading(false);
    }
  };

  const handleCreateRootSessionFolder = async () => {
    const targetWorkspaceId = workspaceId;
    const folderName = sessionFolderDraftName.trim();
    if (!targetWorkspaceId || !folderName || isCreatingSessionFolder) {
      return;
    }

    setIsCreatingSessionFolder(true);
    try {
      const response = await createWorkspaceSessionFolder(
        targetWorkspaceId,
        folderName,
        null,
      );
      await reloadSessionFolders(targetWorkspaceId);
      setSessionFolderFilter(response.folder.id);
      setSessionFolderDraftOpen(false);
      setSessionFolderDraftName("");
      setNotice({
        kind: "success",
        text: t("settings.sessionManagementFolderCreateSuccess", {
          name: response.folder.name,
        }),
      });
      void reloadProjectionSummary();
    } catch (error) {
      setNotice({
        kind: "error",
        text:
          error instanceof Error
            ? error.message
            : t("settings.sessionManagementFolderCreateFailed"),
      });
    } finally {
      setIsCreatingSessionFolder(false);
    }
  };

  const handleSaveVisibleThreadRootCount = async () => {
    if (!selectedWorkspace || !onUpdateWorkspaceSettings) {
      return;
    }

    const nextVisibleThreadRootCount = normalizedVisibleThreadRootCountDraft;
    setIsSavingVisibleThreadRootCount(true);
    try {
      await onUpdateWorkspaceSettings(selectedWorkspace.id, {
        visibleThreadRootCount: nextVisibleThreadRootCount,
      });
      setVisibleThreadRootCountDraft(String(nextVisibleThreadRootCount));
      setNotice({
        kind: "success",
        text: t("settings.sessionManagementThreadVisibilitySaved", {
          count: nextVisibleThreadRootCount,
        }),
      });
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSavingVisibleThreadRootCount(false);
    }
  };

  useEffect(() => {
    if (workspaceOptions.length === 0) {
      if (workspaceId !== null) {
        setWorkspaceId(null);
      }
      return;
    }
    if (workspaceId && workspaceLabelById.has(workspaceId)) {
      return;
    }
    setWorkspaceId(workspaceOptions[0]?.id ?? null);
  }, [workspaceId, workspaceLabelById, workspaceOptions]);
  useEffect(() => {
    const nextInitialWorkspaceId = initialWorkspaceId ?? null;
    if (
      !nextInitialWorkspaceId ||
      !workspaceLabelById.has(nextInitialWorkspaceId)
    ) {
      return;
    }
    if (appliedInitialWorkspaceIdRef.current === nextInitialWorkspaceId) {
      return;
    }
    appliedInitialWorkspaceIdRef.current = nextInitialWorkspaceId;
    if (workspaceId === nextInitialWorkspaceId) {
      return;
    }
    setWorkspaceId(nextInitialWorkspaceId);
    setSessionFolderFilter(SESSION_FOLDER_FILTER_ALL);
    setSessionFolderDraftOpen(false);
    setSessionFolderDraftName("");
    resetSelection();
    setNotice(null);
  }, [initialWorkspaceId, workspaceId, workspaceLabelById]);
  useEffect(() => {
    if (mode !== "project" || !workspaceId) {
      setSessionFolders([]);
      setSessionFolderError(null);
      setSessionFoldersLoading(false);
      return;
    }
    void reloadSessionFolders(workspaceId);
  }, [mode, workspaceId]);
  useEffect(() => {
    if (
      moveTargetFolderId === SESSION_FOLDER_FILTER_ROOT ||
      folderIds.has(moveTargetFolderId)
    ) {
      return;
    }
    setMoveTargetFolderId(SESSION_FOLDER_FILTER_ROOT);
  }, [folderIds, moveTargetFolderId]);
  useEffect(() => {
    if (
      sessionFolderFilter === SESSION_FOLDER_FILTER_ALL ||
      sessionFolderFilter === SESSION_FOLDER_FILTER_ROOT ||
      folderIds.has(sessionFolderFilter)
    ) {
      return;
    }
    setSessionFolderFilter(SESSION_FOLDER_FILTER_ALL);
  }, [folderIds, sessionFolderFilter]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((entry) => entry.id === workspaceId) ?? null,
    [workspaceId, workspaces],
  );
  const globalVisibleThreadRootCount = normalizeGlobalVisibleThreadRootCount(
    resolvedAppSettings.defaultVisibleThreadRootCount,
  );
  const effectiveVisibleThreadRootCount = useMemo(
    () =>
      resolveVisibleThreadRootPageSize(
        selectedWorkspace?.settings.visibleThreadRootCount,
        globalVisibleThreadRootCount,
      ),
    [
      globalVisibleThreadRootCount,
      selectedWorkspace?.settings.visibleThreadRootCount,
    ],
  );
  const normalizedVisibleThreadRootCountDraft = useMemo(
    () =>
      normalizeVisibleThreadRootCount(
        parseVisibleThreadRootCountDraft(visibleThreadRootCountDraft),
      ),
    [visibleThreadRootCountDraft],
  );
  const canSaveVisibleThreadRootCount =
    Boolean(selectedWorkspace && onUpdateWorkspaceSettings) &&
    !isSavingVisibleThreadRootCount &&
    normalizedVisibleThreadRootCountDraft !== effectiveVisibleThreadRootCount;
  useEffect(() => {
    setVisibleThreadRootCountDraft(String(effectiveVisibleThreadRootCount));
  }, [effectiveVisibleThreadRootCount, selectedWorkspace?.id]);
  const projectScopeWorktreeCount = useMemo(() => {
    if (
      !selectedWorkspace ||
      (selectedWorkspace.kind ?? "main") === "worktree"
    ) {
      return 0;
    }
    return workspaces.filter(
      (entry) =>
        (entry.kind ?? "main") === "worktree" &&
        entry.parentId === selectedWorkspace.id,
    ).length;
  }, [selectedWorkspace, workspaces]);
  const shouldShowSidebarStatusHint =
    mode === "project" && draftFilters.status !== "active";
  const shouldShowProjectScopeHint =
    mode === "project" && projectScopeWorktreeCount > 0;
  const shouldShowVisibleCountHint =
    mode === "project" && filteredTotalCount > currentPageVisibleCount;
  const statusFilterLabel = resolveStatusFilterLabel(draftFilters.status, t);

  const handleMutation = async (kind: "archive" | "unarchive" | "delete") => {
    const selectedEntries = getSelectedVisibleEntries();
    if (selectedEntries.length === 0) {
      return;
    }
    const relatedSelectionKeys = new Set(
      relatedEntries.map((entry) => buildWorkspaceSessionSelectionKey(entry)),
    );
    const hasSelectedRelatedEntry = selectedEntries.some((entry) =>
      relatedSelectionKeys.has(buildWorkspaceSessionSelectionKey(entry)),
    );
    if (kind === "delete" && !deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    try {
      const response = await mutate(kind, selectedEntries);
      const succeeded = response.results.filter((item) => item.ok);
      const failed = response.results.filter((item) => !item.ok);
      if (kind === "delete") {
        closeSessionCurtainIfDeleted(response.results);
      }
      if (failed.length === 0) {
        const successKey =
          kind === "archive"
            ? "settings.sessionManagementArchiveSuccess"
            : kind === "unarchive"
              ? "settings.sessionManagementUnarchiveSuccess"
              : "settings.sessionManagementDeleteSuccess";
        setNotice({
          kind: "success",
          text: t(successKey, { count: succeeded.length }),
        });
      } else {
        const failureText = failed
          .map((item) => resolveMutationFailureReason(item, t))
          .join(" · ");
        setNotice({
          kind: "error",
          text: t("settings.sessionManagementMutationPartial", {
            succeeded: succeeded.length,
            failed: failed.length,
            reason: failureText,
          }),
        });
      }
      // archive/unarchive v2 全成功：本地 patch 即终态，不再三查齐发；
      // delete 与失败对账保持原有 reload 行为不变。
      const shouldReloadPrimary = failed.length > 0;
      const shouldReloadRelated =
        mode === "project" &&
        (shouldReloadPrimary || (kind === "delete" && hasSelectedRelatedEntry));
      const shouldReloadProjectionSummary =
        mode === "project" &&
        Boolean(workspaceId) &&
        (kind === "delete" || failed.length > 0);
      if (shouldReloadPrimary || shouldReloadRelated) {
        void Promise.all([
          shouldReloadPrimary ? reloadPrimary() : Promise.resolve(),
          shouldReloadRelated ? reloadRelated() : Promise.resolve(),
          shouldReloadProjectionSummary
            ? reloadProjectionSummary()
            : Promise.resolve(),
        ]);
      } else if (shouldReloadProjectionSummary) {
        void reloadProjectionSummary();
      }
      const succeededWorkspaceIds = collectSucceededWorkspaceIds(
        response.results,
      );
      const deletedThreadIdsByWorkspaceId =
        kind === "delete"
          ? collectDeletedThreadIdsByWorkspaceId(response.results)
          : new Map<string, string[]>();
      succeededWorkspaceIds.forEach((ownerWorkspaceId) => {
        onSessionsMutated?.(
          ownerWorkspaceId,
          kind === "delete"
            ? {
                deletedThreadIds:
                  deletedThreadIdsByWorkspaceId.get(ownerWorkspaceId) ?? [],
              }
            : undefined,
        );
      });
      if (failed.length > 0) {
        keepOnlySelected(failed.map((item) => item.selectionKey));
      } else {
        resetSelection();
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleMoveSelectedSessions = async (targetFolderId: string | null) => {
    if (mode !== "project" || !workspaceId) {
      return;
    }
    const selectedEntries = getSelectedVisibleEntries();
    if (selectedEntries.length === 0) {
      return;
    }
    const relatedSelectionKeys = new Set(
      relatedEntries.map((entry) => buildWorkspaceSessionSelectionKey(entry)),
    );
    const hasSelectedRelatedEntry = selectedEntries.some((entry) =>
      relatedSelectionKeys.has(buildWorkspaceSessionSelectionKey(entry)),
    );
    if (hasSelectedRelatedEntry) {
      setNotice({
        kind: "error",
        text: t("settings.sessionManagementMoveRelatedBlocked"),
      });
      return;
    }

    try {
      const response = await mutate("move-folder", selectedEntries, {
        folderId: targetFolderId,
      });
      const succeeded = response.results.filter((item) => item.ok);
      const failed = response.results.filter((item) => !item.ok);
      if (failed.length === 0) {
        setNotice({
          kind: "success",
          text: t(
            targetFolderId
              ? "settings.sessionManagementMoveSuccess"
              : "settings.sessionManagementMoveToUnfiledSuccess",
            { count: succeeded.length },
          ),
        });
      } else {
        setNotice({
          kind: "error",
          text: t("settings.sessionManagementMutationPartial", {
            succeeded: succeeded.length,
            failed: failed.length,
            reason: failed
              .map((item) => resolveMutationFailureReason(item, t))
              .join(" · "),
          }),
        });
      }

      void Promise.all([reloadPrimary(), reloadProjectionSummary()]);
      collectSucceededWorkspaceIds(response.results).forEach(
        (ownerWorkspaceId) => {
          onSessionsMutated?.(ownerWorkspaceId);
        },
      );
      if (failed.length > 0) {
        keepOnlySelected(failed.map((item) => item.selectionKey));
      } else {
        resetSelection();
      }
    } catch (error) {
      setNotice({
        kind: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const expandCount =
    mode === "global" ? primaryEntries.length : projectScopeTotalCount;
  const showProjectStrictEmpty =
    mode === "project" &&
    !primaryIsLoading &&
    visiblePrimaryEntries.length === 0;
  const showRelatedSection =
    mode === "project" &&
    sessionFolderFilter === SESSION_FOLDER_FILTER_ALL &&
    (relatedIsLoading ||
      Boolean(relatedError) ||
      Boolean(relatedPartialSource) ||
      visibleRelatedEntries.length > 0);
  const activeFolderLabel = useMemo(() => {
    if (sessionFolderFilter === SESSION_FOLDER_FILTER_ALL) {
      return t("settings.sessionManagementFolderAll");
    }
    if (sessionFolderFilter === SESSION_FOLDER_FILTER_ROOT) {
      return t("settings.sessionManagementFolderUnassigned");
    }
    return (
      sessionFolders.find((folder) => folder.id === sessionFolderFilter)
        ?.name ?? t("settings.sessionManagementFolderAll")
    );
  }, [sessionFolderFilter, sessionFolders, t]);

  const renderSessionFolderNavControls = (workspaceDepth: number) => (
    <SessionFolderNavControls
      workspaceDepth={workspaceDepth}
      sessionFolderFilter={sessionFolderFilter}
      projectScopeTotalCount={projectScopeTotalCount}
      unassignedFolderCount={effectiveFolderCountSummary.unassignedFolderCount}
      sessionFolderDraftOpen={sessionFolderDraftOpen}
      sessionFolderDraftName={sessionFolderDraftName}
      isCreatingSessionFolder={isCreatingSessionFolder}
      folderNavItems={folderNavItems}
      sessionFoldersLoading={sessionFoldersLoading}
      sessionFolderError={sessionFolderError}
      onFolderFilterChange={handleSessionFolderFilterChange}
      onSessionFolderDraftOpenChange={setSessionFolderDraftOpen}
      onSessionFolderDraftNameChange={setSessionFolderDraftName}
      onCreateRootSessionFolder={handleCreateRootSessionFolder}
      onNoticeClear={() => setNotice(null)}
      t={t}
    />
  );

  return (
    <div
      className={`settings-project-sessions settings-project-sessions--redesign${
        expanded ? " is-open" : ""
      }`}
    >
      <div className="settings-project-sessions-topbar">
        <button
          type="button"
          className={`settings-project-sessions-expand-btn${expanded ? " is-open" : ""}`}
          onClick={() => setExpanded((current) => !current)}
          data-testid="settings-project-sessions-expand-toggle"
        >
          {expanded ? (
            <ChevronDown
              className="settings-project-sessions-expand-icon"
              size={14}
              aria-hidden
            />
          ) : (
            <ChevronRight
              className="settings-project-sessions-expand-icon"
              size={14}
              aria-hidden
            />
          )}
          <span className="settings-project-sessions-expand-label">{title}</span>
          <span className="settings-project-sessions-expand-count">
            {expandCount}
          </span>
        </button>
        {expanded ? (
          <div className="settings-project-sessions-header-actions">
            <div
              className="settings-project-sessions-mode-toggle"
              role="group"
              aria-label={t("settings.sessionManagementModeProject")}
            >
              <button
                type="button"
                aria-pressed={mode === "project"}
                className={`settings-project-sessions-mode-btn${
                  mode === "project" ? " is-active" : ""
                }`}
                onClick={() => handleModeChange("project")}
              >
                <FolderTree size={14} aria-hidden />
                {t("settings.sessionManagementModeProject")}
              </button>
              <button
                type="button"
                aria-pressed={mode === "global"}
                className={`settings-project-sessions-mode-btn${
                  mode === "global" ? " is-active" : ""
                }`}
                onClick={() => handleModeChange("global")}
              >
                <Archive size={14} aria-hidden />
                {t("settings.sessionManagementModeGlobal")}
              </button>
            </div>
            <button
              type="button"
              className="settings-project-sessions-ghost-btn"
              onClick={() => void handleRefresh()}
              disabled={
                (mode === "project" && !workspaceId) ||
                primaryIsLoading ||
                isMutating
              }
            >
              <RotateCw size={14} aria-hidden />
              {t("settings.projectSessionRefresh")}
            </button>
          </div>
        ) : null}
      </div>

      {expanded ? (
        <div className="settings-project-sessions-body">
          <details className="settings-project-sessions-attribution-details">
            <summary className="settings-project-sessions-attribution-summary">
              <span className="settings-project-sessions-attribution-summary-main">
                <span className="settings-project-sessions-attribution-title">
                  {t("settings.sessionAttributionModeTitle")}
                </span>
                <span className="settings-project-sessions-attribution-current">
                  {t("settings.sessionAttributionModeCurrent", {
                    mode: effectiveAttributionModeLabel,
                  })}
                </span>
              </span>
              <span className="settings-project-sessions-attribution-summary-hint">
                {t("settings.sessionAttributionModeDescription")}
              </span>
            </summary>
            <div className="settings-project-sessions-attribution-panel">
              <div
                className="settings-project-sessions-attribution-toggle"
                role="radiogroup"
                aria-label={t("settings.sessionAttributionModeTitle")}
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={effectiveAttributionMode === "related"}
                  className={`settings-project-sessions-attribution-option${
                    effectiveAttributionMode === "related" ? " is-active" : ""
                  }`}
                  disabled={isSavingAttributionMode}
                  onClick={() => void handleAttributionModeChange("related")}
                >
                  <span className="settings-project-sessions-attribution-option-title">
                    {t("settings.sessionAttributionModeRelated")}
                  </span>
                  <span className="settings-project-sessions-attribution-option-description">
                    {t("settings.sessionAttributionModeRelatedDescription")}
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={effectiveAttributionMode === "workspace-only"}
                  className={`settings-project-sessions-attribution-option${
                    effectiveAttributionMode === "workspace-only"
                      ? " is-active"
                      : ""
                  }`}
                  disabled={isSavingAttributionMode}
                  onClick={() =>
                    void handleAttributionModeChange("workspace-only")
                  }
                >
                  <span className="settings-project-sessions-attribution-option-title">
                    {t("settings.sessionAttributionModeWorkspaceOnly")}
                  </span>
                  <span className="settings-project-sessions-attribution-option-description">
                    {t(
                      "settings.sessionAttributionModeWorkspaceOnlyDescription",
                    )}
                  </span>
                </button>
              </div>
            </div>
          </details>

          <div className="settings-project-sessions-shell">
            {mode === "project" ? (
              <aside
                className="settings-project-sessions-nav"
                aria-label={t("settings.workspacePickerLabel")}
              >
                <div className="settings-project-sessions-nav-title">
                  {t("settings.workspacePickerLabel")}
                </div>
                <div className="settings-project-sessions-nav-list scrollable">
                  {workspaceOptions.map((option) => {
                    const active = option.id === workspaceId;
                    return (
                      <Fragment key={option.id}>
                        <button
                          type="button"
                          className={`settings-project-sessions-nav-item is-workspace${active ? " is-active" : ""}${option.kind === "worktree" ? " is-worktree" : ""}`}
                          style={{ paddingLeft: 10 + option.depth * 18 }}
                          onClick={() => handleWorkspaceChange(option.id)}
                        >
                          <span className="settings-project-sessions-nav-name">
                            {option.kind === "worktree" ? (
                              <GitBranch size={13} aria-hidden />
                            ) : (
                              <FolderTree size={13} aria-hidden />
                            )}
                            {option.pickerLabel}
                          </span>
                          {active ? (
                            <span className="settings-project-sessions-nav-count">
                              {projectScopeTotalCount}
                            </span>
                          ) : null}
                        </button>
                        {active
                          ? renderSessionFolderNavControls(option.depth)
                          : null}
                      </Fragment>
                    );
                  })}
                </div>
                {summaryPartialSource ? (
                  <div className="settings-project-sessions-nav-warning">
                    {t("settings.sessionManagementPartialSource", {
                      source: summaryPartialSource,
                    })}
                  </div>
                ) : null}
              </aside>
            ) : null}

            <div className="settings-project-sessions-main">
              <div className="settings-project-sessions-control-panel">
                <div className="settings-project-sessions-control-head">
                  {mode === "project" && selectedWorkspace ? (
                    <div className="settings-project-sessions-scope-summary">
                      <span>
                        {workspaceLabelById.get(selectedWorkspace.id) ??
                          selectedWorkspace.name}
                      </span>
                      <span aria-hidden>/</span>
                      <span>{activeFolderLabel}</span>
                    </div>
                  ) : (
                    <div className="settings-project-sessions-scope-summary">
                      <span>{t("settings.sessionManagementModeGlobal")}</span>
                    </div>
                  )}
                  {mode === "project" && selectedWorkspace ? (
                    <details className="settings-project-sessions-advanced">
                      <summary>
                        <SlidersHorizontal size={13} aria-hidden />
                        {t("settings.sessionManagementThreadVisibilityLabel")}
                      </summary>
                      <div className="settings-project-sessions-advanced-body">
                        <div className="settings-project-sessions-advanced-copy">
                          {t("settings.sessionManagementThreadVisibilityHint", {
                            defaultCount: globalVisibleThreadRootCount,
                            min: MIN_VISIBLE_THREAD_ROOT_COUNT,
                            max: MAX_VISIBLE_THREAD_ROOT_COUNT,
                            count: effectiveVisibleThreadRootCount,
                          })}
                        </div>
                        <div className="settings-project-sessions-advanced-actions">
                          <Input
                            data-testid="settings-project-sessions-visible-root-count-input"
                            value={visibleThreadRootCountDraft}
                            onChange={(event) =>
                              setVisibleThreadRootCountDraft(event.target.value)
                            }
                            onBlur={() =>
                              setVisibleThreadRootCountDraft(
                                String(normalizedVisibleThreadRootCountDraft),
                              )
                            }
                            inputMode="numeric"
                            pattern="[0-9]*"
                            className="h-8 w-20"
                            aria-label={t(
                              "settings.sessionManagementThreadVisibilityLabel",
                            )}
                          />
                          <Button
                            type="button"
                            size="sm"
                            data-testid="settings-project-sessions-visible-root-count-save"
                            disabled={!canSaveVisibleThreadRootCount}
                            onClick={() => {
                              void handleSaveVisibleThreadRootCount();
                            }}
                          >
                            <CheckSquare2 size={14} aria-hidden />
                            {isSavingVisibleThreadRootCount
                              ? t(
                                  "settings.sessionManagementThreadVisibilitySaving",
                                )
                              : t("common.save")}
                          </Button>
                        </div>
                      </div>
                    </details>
                  ) : null}
                </div>

                <div className="settings-project-sessions-filterbar">
                  <Input
                    value={draftFilters.keyword}
                    onChange={(event) =>
                      handleFiltersChange({ keyword: event.target.value })
                    }
                    placeholder={t(
                      "settings.sessionManagementSearchPlaceholder",
                    )}
                    aria-label={t(
                      "settings.sessionManagementSearchPlaceholder",
                    )}
                  />

                  {mode === "project" ? (
                    <Select
                      value={draftFilters.engine || ENGINE_FILTER_ALL_VALUE}
                      onValueChange={(value) =>
                        handleFiltersChange({
                          engine:
                            value === ENGINE_FILTER_ALL_VALUE || value == null
                              ? ""
                              : value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={t("settings.sessionManagementEngineAll")}
                        >
                          {engineFilterLabel[
                            (draftFilters.engine ||
                              "all") as keyof typeof engineFilterLabel
                          ] ?? t("settings.sessionManagementEngineAll")}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ENGINE_FILTER_ALL_VALUE}>
                          {t("settings.sessionManagementEngineAll")}
                        </SelectItem>
                        <SelectItem value="codex">
                          {engineFilterLabel.codex}
                        </SelectItem>
                        <SelectItem value="claude">
                          {engineFilterLabel.claude}
                        </SelectItem>
                        <SelectItem value="gemini">
                          {engineFilterLabel.gemini}
                        </SelectItem>
                        <SelectItem value="opencode">
                          {engineFilterLabel.opencode}
                        </SelectItem>
                        <SelectItem value="kimi">
                          {engineFilterLabel.kimi}
                        </SelectItem>
                        <SelectItem value="grok">
                          {engineFilterLabel.grok}
                        </SelectItem>
                        <SelectItem value="pi">
                          {engineFilterLabel.pi}
                        </SelectItem>
                        <SelectItem value="qoder">
                          {engineFilterLabel.qoder}
                        </SelectItem>
                        <SelectItem value="dsh">
                          {engineFilterLabel.dsh}
                        </SelectItem>
                        <SelectItem value="shared">
                          {engineFilterLabel.shared}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="settings-project-sessions-static-filter">
                      {t("settings.projectSessionEngineCodex")}
                    </div>
                  )}

                  <Select
                    value={draftFilters.status}
                    onValueChange={(value) =>
                      handleFiltersChange({
                        status:
                          value as WorkspaceSessionCatalogFilters["status"],
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {draftFilters.status === "archived"
                          ? t("settings.sessionManagementStatusArchived")
                          : draftFilters.status === "all"
                            ? t("settings.sessionManagementStatusAll")
                            : t("settings.sessionManagementStatusActive")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">
                        {t("settings.sessionManagementStatusActive")}
                      </SelectItem>
                      <SelectItem value="archived">
                        {t("settings.sessionManagementStatusArchived")}
                      </SelectItem>
                      <SelectItem value="all">
                        {t("settings.sessionManagementStatusAll")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div
                className={`settings-project-sessions-toolbar${
                  selectedCount > 0 ? " has-selection" : ""
                }`}
              >
                <div className="settings-project-sessions-stats">
                  <span className="settings-project-sessions-selected">
                    {t("settings.projectSessionSelectedCount", {
                      count: selectedCount,
                    })}
                  </span>
                  {mode === "project" ? (
                    <span className="settings-project-sessions-selected">
                      {t("settings.sessionManagementFilteredTotalCount", {
                        count: filteredTotalCount,
                      })}
                    </span>
                  ) : null}
                  {mode === "project" ? (
                    <span className="settings-project-sessions-selected">
                      {t("settings.sessionManagementCurrentPageCount", {
                        count: currentPageVisibleCount,
                      })}
                    </span>
                  ) : null}
                </div>
                <div className="settings-project-sessions-actions">
                  <button
                    type="button"
                    className="settings-project-sessions-btn"
                    onClick={handleSelectAll}
                    disabled={visibleEntries.length === 0 || allSelected}
                  >
                    <CheckSquare2 size={14} aria-hidden />
                    {t("settings.projectSessionSelectAll")}
                  </button>
                  {selectedCount > 0 ? (
                    <>
                      <button
                        type="button"
                        className="settings-project-sessions-btn"
                        onClick={resetSelection}
                      >
                        <CircleX size={14} aria-hidden />
                        {t("settings.projectSessionClearSelection")}
                      </button>
                      {mode === "project" ? (
                        <div className="settings-project-sessions-move-control">
                          <Select
                            value={moveTargetFolderId}
                            onValueChange={(value) =>
                              setMoveTargetFolderId(
                                value ?? SESSION_FOLDER_FILTER_ROOT,
                              )
                            }
                          >
                            <SelectTrigger
                              className="settings-project-sessions-move-select"
                              aria-label={t(
                                "settings.sessionManagementMoveTargetLabel",
                              )}
                            >
                              <SelectValue>
                                {moveTargetFolderId ===
                                SESSION_FOLDER_FILTER_ROOT
                                  ? t(
                                      "settings.sessionManagementFolderUnassigned",
                                    )
                                  : (sessionFolders.find(
                                      (folder) =>
                                        folder.id === moveTargetFolderId,
                                    )?.name ??
                                    t(
                                      "settings.sessionManagementMoveTargetLabel",
                                    ))}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={SESSION_FOLDER_FILTER_ROOT}>
                                {t(
                                  "settings.sessionManagementFolderUnassigned",
                                )}
                              </SelectItem>
                              {folderNavItems.map((folder) => (
                                <SelectItem key={folder.id} value={folder.id}>
                                  {" ".repeat(
                                    Math.max(0, folder.depth - 1) * 2,
                                  )}
                                  {folder.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <button
                            type="button"
                            className="settings-project-sessions-btn"
                            onClick={() =>
                              void handleMoveSelectedSessions(
                                moveTargetFolderId ===
                                  SESSION_FOLDER_FILTER_ROOT
                                  ? null
                                  : moveTargetFolderId,
                              )
                            }
                            disabled={isMutating}
                          >
                            <FolderInput size={14} aria-hidden />
                            {moveTargetFolderId === SESSION_FOLDER_FILTER_ROOT
                              ? t("settings.sessionManagementMoveToUnfiled")
                              : t("settings.sessionManagementMoveSelected")}
                          </button>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="settings-project-sessions-btn"
                        onClick={() => void handleMutation("archive")}
                        disabled={isMutating}
                      >
                        <Archive size={14} aria-hidden />
                        {t("settings.sessionManagementArchiveSelected")}
                      </button>
                      <button
                        type="button"
                        className="settings-project-sessions-btn"
                        onClick={() => void handleMutation("unarchive")}
                        disabled={isMutating}
                      >
                        <Undo2 size={14} aria-hidden />
                        {t("settings.sessionManagementUnarchiveSelected")}
                      </button>
                      <button
                        type="button"
                        className="settings-project-sessions-btn is-danger"
                        onClick={() => void handleMutation("delete")}
                        disabled={isMutating}
                        data-testid="settings-project-sessions-delete-selected"
                      >
                        <Trash2 size={14} aria-hidden />
                        {deleteArmed
                          ? t(
                              "settings.projectSessionConfirmDeleteSelected",
                              {
                                count: selectedCount,
                              },
                            )
                          : t("settings.projectSessionDeleteSelected")}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              {notice ? (
                <div
                  className={`settings-project-sessions-notice is-${notice.kind}`}
                >
                  {notice.text}
                </div>
              ) : null}
              {shouldShowSidebarStatusHint ? (
                <div className="settings-project-sessions-notice">
                  {t("settings.sessionManagementSidebarStatusHint", {
                    status: statusFilterLabel,
                  })}
                </div>
              ) : null}
              {shouldShowProjectScopeHint ? (
                <div className="settings-project-sessions-notice">
                  {t("settings.sessionManagementProjectScopeHint", {
                    count: projectScopeWorktreeCount,
                  })}
                </div>
              ) : null}
              {shouldShowVisibleCountHint ? (
                <div className="settings-project-sessions-notice">
                  {t("settings.sessionManagementVisibleWindowHint", {
                    visible: currentPageVisibleCount,
                    total: filteredTotalCount,
                  })}
                </div>
              ) : null}
              {mode === "project" && activeProjectionOwnerCount > 1 ? (
                <div className="settings-project-sessions-notice">
                  {t("settings.sessionManagementActiveProjectionScopeHint", {
                    count: activeProjectionOwnerCount,
                    active: activeTotalCount,
                  })}
                </div>
              ) : null}
              {projectionSummaryLoading ? (
                <div className="settings-project-sessions-notice">
                  {t("settings.sessionManagementProjectionLoading")}
                </div>
              ) : null}
              {projectionSummaryError ? (
                <div className="settings-project-sessions-notice is-error">
                  {projectionSummaryError}
                </div>
              ) : null}
              {summaryPartialSource ? (
                <div className="settings-project-sessions-notice">
                  {t("settings.sessionManagementPartialSource", {
                    source: summaryPartialSource,
                  })}
                </div>
              ) : null}
              {primaryPartialSourceNotice ? (
                <div className="settings-project-sessions-notice">
                  {t("settings.sessionManagementPartialSource", {
                    source: primaryPartialSourceNotice,
                  })}
                </div>
              ) : null}
              {primaryPageLimit.limitCapped &&
              primaryPageLimit.requestedLimit != null &&
              primaryPageLimit.effectiveLimit != null ? (
                <div className="settings-project-sessions-notice">
                  {t("settings.sessionManagementPageLimitCapped", {
                    requested: primaryPageLimit.requestedLimit,
                    effective: primaryPageLimit.effectiveLimit,
                  })}
                </div>
              ) : null}
              {primaryError ? (
                <div className="settings-project-sessions-notice is-error">
                  {primaryError}
                </div>
              ) : null}

              {mode === "project" && !workspaceId ? (
                <div className="settings-project-sessions-empty">
                  {t("settings.projectSessionWorkspaceRequired")}
                </div>
              ) : primaryIsLoading ? (
                <div className="settings-project-sessions-empty">
                  {t("settings.projectSessionLoading")}
                </div>
              ) : mode === "global" && primaryEntries.length === 0 ? (
                <div className="settings-project-sessions-empty space-y-3">
                  <div>{t("settings.sessionManagementGlobalEmpty")}</div>
                </div>
              ) : (
                <>
                  {mode === "project" ? (
                    <>
                      {showProjectStrictEmpty ? (
                        <div className="settings-project-sessions-empty space-y-3">
                          <div>{t("settings.projectSessionEmpty")}</div>
                          <div className="text-sm text-muted-foreground">
                            {t(
                              "settings.sessionManagementProjectEmptyStrictHint",
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleModeChange("global")}
                          >
                            <Archive size={14} aria-hidden />
                            {t("settings.sessionManagementViewGlobalCta")}
                          </Button>
                        </div>
                      ) : (
                        <SessionListSection
                          title={t(
                            "settings.sessionManagementStrictSectionTitle",
                          )}
                          entries={visiblePrimaryEntries}
                          selectedIds={selectedIds}
                          workspaceLabelById={workspaceLabelById}
                          engineFilterLabel={engineFilterLabel}
                          locale={i18n.language}
                          onToggleSelection={toggleSelection}
                          onOpenSessionCurtain={(entry) =>
                            void handleOpenSessionCurtain(entry)
                          }
                          t={t}
                        />
                      )}

                      {primaryNextCursor ? (
                        <div className="flex justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void loadMorePrimary()}
                            disabled={primaryIsLoadingMore}
                          >
                            <ChevronsDown size={14} aria-hidden />
                            {primaryIsLoadingMore
                              ? t("settings.sessionManagementLoadingMore")
                              : t("settings.sessionManagementLoadMore")}
                          </Button>
                        </div>
                      ) : null}

                      {showRelatedSection ? (
                        <div className="space-y-3">
                          {relatedPartialSource ? (
                            <div className="settings-project-sessions-notice">
                              {t("settings.sessionManagementPartialSource", {
                                source: relatedPartialSource,
                              })}
                            </div>
                          ) : null}
                          {relatedPageLimit.limitCapped &&
                          relatedPageLimit.requestedLimit != null &&
                          relatedPageLimit.effectiveLimit != null ? (
                            <div className="settings-project-sessions-notice">
                              {t("settings.sessionManagementPageLimitCapped", {
                                requested: relatedPageLimit.requestedLimit,
                                effective: relatedPageLimit.effectiveLimit,
                              })}
                            </div>
                          ) : null}
                          {relatedError ? (
                            <div className="settings-project-sessions-notice is-error">
                              {relatedError}
                            </div>
                          ) : null}
                          {relatedIsLoading ? (
                            <div className="settings-project-sessions-empty">
                              {t("settings.projectSessionLoading")}
                            </div>
                          ) : relatedEntries.length > 0 ? (
                            <>
                              <SessionListSection
                                title={t(
                                  "settings.sessionManagementRelatedSectionTitle",
                                )}
                                description={t(
                                  "settings.sessionManagementRelatedSectionDescription",
                                )}
                                entries={visibleRelatedEntries}
                                selectedIds={selectedIds}
                                workspaceLabelById={workspaceLabelById}
                                engineFilterLabel={engineFilterLabel}
                                locale={i18n.language}
                                onToggleSelection={toggleSelection}
                                onOpenSessionCurtain={(entry) =>
                                  void handleOpenSessionCurtain(entry)
                                }
                                t={t}
                              />
                              {relatedNextCursor ? (
                                <div className="flex justify-center">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void loadMoreRelated()}
                                    disabled={relatedIsLoadingMore}
                                  >
                                    <ChevronsDown size={14} aria-hidden />
                                    {relatedIsLoadingMore
                                      ? t(
                                          "settings.sessionManagementLoadingMore",
                                        )
                                      : t("settings.sessionManagementLoadMore")}
                                  </Button>
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <SessionListSection
                        title={t(
                          "settings.sessionManagementGlobalSectionTitle",
                        )}
                        description={t(
                          "settings.sessionManagementGlobalSectionDescription",
                        )}
                        entries={primaryEntries}
                        selectedIds={selectedIds}
                        workspaceLabelById={workspaceLabelById}
                        engineFilterLabel={engineFilterLabel}
                        locale={i18n.language}
                        onToggleSelection={toggleSelection}
                        onOpenSessionCurtain={(entry) =>
                          void handleOpenSessionCurtain(entry)
                        }
                        t={t}
                      />
                      {primaryNextCursor ? (
                        <div className="flex justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void loadMorePrimary()}
                            disabled={primaryIsLoadingMore}
                          >
                            <ChevronsDown size={14} aria-hidden />
                            {primaryIsLoadingMore
                              ? t("settings.sessionManagementLoadingMore")
                              : t("settings.sessionManagementLoadMore")}
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {sessionCurtain ? (
        <SessionCurtainDialog
          sessionCurtain={sessionCurtain}
          workspaceLabelById={workspaceLabelById}
          onClose={handleCloseSessionCurtain}
          onReload={handleReloadSessionCurtain}
          t={t}
        />
      ) : null}
    </div>
  );
}
