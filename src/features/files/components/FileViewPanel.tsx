import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import ArrowLeft from "lucide-react/dist/esm/icons/arrow-left";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right";
import type { ReactCodeMirrorProps } from "@uiw/react-codemirror";
import {
  getGitFileFullDiff,
  readWorkspaceFilePreview,
} from "../../../services/tauri";
import { pushErrorToast } from "../../../services/toasts";
import type { IntentCanvasCodeSelectionAnchor } from "../../intent-canvas/types";
import {
  formatShortcutForPlatform,
  isEditableShortcutTarget,
  matchesShortcutForPlatform,
} from "../../../utils/shortcuts";
import { highlightLine } from "../../../utils/syntax";
import {
  RendererContextMenu,
  type RendererContextMenuState,
} from "../../../components/ui/RendererContextMenu";
import type { CodeAnnotationLineRange } from "../../code-annotations/types";
import {
  attachCodeAnnotationAnchor,
  resolveCodeAnnotationsForFile,
} from "../../code-annotations/utils/codeAnnotations";
import { loadCodeMirrorExtensionsForEditorLanguage } from "../utils/codemirrorLanguageExtensions";
import { parseLineMarkersFromDiff, type GitLineMarkers } from "../utils/gitLineMarkers";
import {
  isLikelyWindowsFsPath,
  normalizeComparablePath,
  normalizeFsPath,
  resolveFileReadTarget,
  resolveGitRootWorkspacePrefix,
  resolveGitStatusPathCandidates,
  resolveWorkspacePathCandidates,
} from "../../../utils/workspacePaths";
import { FILE_CONTEXT_MENU_SHORTCUTS } from "../utils/fileContextMenuShortcuts";
import { buildCodeSelectionChatSnippet } from "../utils/codeSelectionChatSnippet";
import { reduceExternalChangeSyncState } from "../externalChangeStateMachine";
import { resolveFileRenderProfile } from "../utils/fileRenderProfile";
import { getFileDocumentSnapshotMetrics } from "../utils/fileDocumentSnapshot";
import {
  createFileEditorTypingDiagnosticsSession,
  type FileEditorTypingDiagnosticsSession,
} from "../utils/fileEditorTypingDiagnostics";
import { loadFileViewStyles } from "../../../styles/featureStyleLoaders";
import { resolveDefaultFileViewMode, resolveFileViewSurface } from "../utils/fileViewSurface";
import { FileViewBody } from "./FileViewBody";
import type { FileCodeMirrorEditorHandle } from "./FileCodeMirrorEditor";
import type { NoteCaptureDraft } from "../../note-cards/types";
import { buildCodeSelectionNoteDraft } from "../../note-cards/utils/noteCapture";
import { FileViewNavigationPanel } from "./FileViewNavigationPanel";
import { FileViewExternalChangeOverlays } from "./FileViewExternalChangeOverlays";
import { FileViewPanelFooter } from "./FileViewPanelFooter";
import { FileViewPanelTabs } from "./FileViewPanelTabs";
import {
  buildFileViewContextMenu,
  buildFileViewTabContextMenu,
} from "./fileViewContextMenus";
import { useFileDocumentState } from "../hooks/useFileDocumentState";
import { useFileExternalSync } from "../hooks/useFileExternalSync";
import { useFileGitBlame } from "../hooks/useFileGitBlame";
import { useFileImagePreview } from "../hooks/useFileImagePreview";
import { useFileNavigation } from "../hooks/useFileNavigation";
import { useFilePreviewPayload } from "../hooks/useFilePreviewPayload";
import { useFileTabDrag } from "../hooks/useFileTabDrag";
import { isThemeMutationAttribute } from "../../theme/utils/themeAppearance";
import { DEFAULT_FILE_RENDER_PRESSURE } from "../types/fileRenderPressure";
import {
  resolveFastMarkdownProfileInputs,
  resolveFastMarkdownRendererProfile,
  type FastMarkdownRendererProfileId,
} from "../../markdown/fastMarkdownRenderer";
import {
  buildDetachedFileExplorerSession,
  openNewDetachedFileExplorerWindow,
} from "../detachedFileExplorer";
import {
  EDITOR_LINE_RANGE_SYNC_DELAY_MS,
  EXTERNAL_CHANGE_POLL_INTERVAL_MS,
  formatEditorLineRangeKey,
  formatFileSize,
  hasGitLineMarkers,
  isSameEditorLineRange,
  resolveAbsolutePath,
  resolveDeclarationCodeSelectionAnchor,
  resolveEditorTheme,
  type AnnotationWidgetCallbacks,
  type EditorTheme,
} from "./fileViewPanelShared";
import { resolveFileMarkdownFastFeatureFlags } from "../utils/fileMarkdownFeatureFlags";
import {
  FILE_GIT_BLAME_MAX_BYTES,
  FILE_GIT_BLAME_MAX_LINES,
  resolveGitBlameRepositoryPath,
} from "../utils/gitBlame";
import { resolveFileGitScope } from "../utils/fileGitScope";
import {
  NAVIGATE_BACK_SHORTCUT,
  NAVIGATE_FORWARD_SHORTCUT,
  resetGitLineMarkersIfNeeded,
  type FileViewPanelProps,
} from "./FileViewPanelContract";

export { resolveEditorAnnotationWidgetOrder } from "./fileViewPanelShared";

export function FileViewPanel({
  workspaceId,
  workspaceName = null,
  workspacePath,
  gitRoot = null,
  gitRepositories,
  customSpecRoot = null,
  filePath,
  gitStatusFiles,
  openTabs,
  activeTabPath,
  onActivateTab,
  onCloseTab,
  onCloseOtherTabs,
  onCloseAllTabs,
  onReorderTabs,
  activeFileLineRange = null,
  onActiveFileLineRangeChange,
  onActiveCodeAnchorChange,
  onAssociateIntentCanvasCodeAnchor,
  initialMode = "edit",
  openTargets,
  openAppIconById,
  selectedOpenAppId,
  onSelectOpenAppId,
  editorSplitLayout = "vertical",
  onToggleEditorSplitLayout,
  isEditorFileMaximized = false,
  onToggleEditorFileMaximized,
  navigationTarget = null,
  highlightMarkers = null,
  onNavigateToLocation,
  onOpenFileHistory,
  onRevealInFileTree,
  onInsertText,
  onCreateCodeAnnotation,
  onCaptureNote,
  onRemoveCodeAnnotation,
  codeAnnotations = [],
  headerLayout = "stacked",
  onSingleRowLeadingAction,
  singleRowLeadingDirection = "left",
  singleRowLeadingLabel,
  externalChangeMonitoringEnabled = false,
  externalChangeTransportMode = "polling",
  externalChangePollIntervalMs = EXTERNAL_CHANGE_POLL_INTERVAL_MS,
  externalChangeApplyMode = "auto",
  externalChangeAutoApplyDebounceMs = 0,
  markdownPreviewSnapshotMode = "stable",
  fileRenderPressure = DEFAULT_FILE_RENDER_PRESSURE,
  saveFileShortcut = "cmd+s",
  findInFileShortcut = "cmd+f",
  expandSelectionShortcut = "cmd+w",
  onSaveSuccess,
  onDirtyChange,
}: FileViewPanelProps) {
  const { t } = useTranslation();
  useEffect(() => {
    void loadFileViewStyles();
  }, []);
  const renderProfile = useMemo(
    () => resolveFileRenderProfile(filePath),
    [filePath],
  );
  const defaultMode = useMemo(
    () => resolveDefaultFileViewMode(renderProfile, initialMode),
    [initialMode, renderProfile],
  );
  const isImage = renderProfile.kind === "image";
  const skipTextRead = renderProfile.previewSourceKind !== "inline-bytes";
  const canEditDocument = renderProfile.editCapability !== "read-only";
  const [mode, setMode] = useState<"preview" | "edit">(() => defaultMode);
  const [editorTheme, setEditorTheme] = useState<EditorTheme>(() =>
    resolveEditorTheme(),
  );
  const [gitLineMarkers, setGitLineMarkers] = useState<GitLineMarkers>({
    added: [],
    modified: [],
  });
  const [annotationDraft, setAnnotationDraft] = useState<{
    lineRange: CodeAnnotationLineRange;
    source: "file-preview-mode" | "file-edit-mode";
    body: string;
  } | null>(null);
  const [markdownPreviewOverride, setMarkdownPreviewOverride] = useState<{
    key: string;
    content: string;
    truncated: boolean;
  } | null>(null);
  const markdownPreviewOverrideRequestRef = useRef(0);
  const [editorLocalLineRange, setEditorLocalLineRange] =
    useState<CodeAnnotationLineRange | null>(() => activeFileLineRange);
  const annotationDraftBodyRef = useRef("");
  const editorLocalLineRangeRef = useRef<CodeAnnotationLineRange | null>(
    activeFileLineRange,
  );
  const pendingEditorLineRangeRef = useRef<CodeAnnotationLineRange | null>(
    activeFileLineRange,
  );
  const editorLineRangeSyncTimerRef = useRef<number | null>(null);
  const activeCodeAnchorResolveTimerRef = useRef<number | null>(null);
  const activeCodeAnchorResolveEpochRef = useRef(0);
  const lastPublishedEditorLineRangeKeyRef = useRef(
    formatEditorLineRangeKey(activeFileLineRange),
  );
  const [activeDeclarationCodeAnchor, setActiveDeclarationCodeAnchor] =
    useState<IntentCanvasCodeSelectionAnchor | null>(null);
  const cmRef = useRef<FileCodeMirrorEditorHandle | null>(null);
  const lastReportedLineRangeRef = useRef<string>("");
  const tabsContainerRef = useRef<HTMLDivElement | null>(null);
  const panelRootRef = useRef<HTMLDivElement | null>(null);
  const [tabContextMenu, setTabContextMenu] =
    useState<RendererContextMenuState | null>(null);
  const [fileContextMenu, setFileContextMenu] =
    useState<RendererContextMenuState | null>(null);
  const pendingGitBlamePathRef = useRef<string | null>(null);
  const activeAnnotationLineRange =
    annotationDraft?.source === "file-edit-mode"
      ? annotationDraft.lineRange
      : (editorLocalLineRange ?? activeFileLineRange);
  const effectiveAnnotationDraftBody = annotationDraft
    ? annotationDraftBodyRef.current || annotationDraft.body
    : "";
  const effectiveAnnotationDraft = useMemo(
    () =>
      annotationDraft
        ? {
            ...annotationDraft,
            body: effectiveAnnotationDraftBody,
          }
        : null,
    [annotationDraft, effectiveAnnotationDraftBody],
  );
  const beginAnnotationDraft = useCallback(
    (
      lineRange: CodeAnnotationLineRange,
      source: "file-preview-mode" | "file-edit-mode",
    ) => {
      annotationDraftBodyRef.current = "";
      setAnnotationDraft({
        lineRange: {
          startLine: lineRange.startLine,
          endLine: lineRange.endLine,
        },
        source,
        body: "",
      });
    },
    [],
  );
  const handleStartEditorAnnotation = useCallback(() => {
    const lineRange =
      annotationDraft?.source === "file-edit-mode"
        ? annotationDraft.lineRange
        : (editorLocalLineRangeRef.current ?? activeAnnotationLineRange);
    if (!lineRange) {
      return;
    }
    beginAnnotationDraft(lineRange, "file-edit-mode");
  }, [activeAnnotationLineRange, annotationDraft, beginAnnotationDraft]);
  const clearPendingEditorLineRangeSync = useCallback(() => {
    if (editorLineRangeSyncTimerRef.current !== null) {
      window.clearTimeout(editorLineRangeSyncTimerRef.current);
      editorLineRangeSyncTimerRef.current = null;
    }
  }, []);
  const clearPendingActiveCodeAnchorResolve = useCallback(() => {
    if (activeCodeAnchorResolveTimerRef.current !== null) {
      window.clearTimeout(activeCodeAnchorResolveTimerRef.current);
      activeCodeAnchorResolveTimerRef.current = null;
    }
  }, []);
  const scheduleEditorLineRangePublish = useCallback(
    (lineRange: CodeAnnotationLineRange | null) => {
      pendingEditorLineRangeRef.current = lineRange;
      clearPendingEditorLineRangeSync();
      editorLineRangeSyncTimerRef.current = window.setTimeout(() => {
        editorLineRangeSyncTimerRef.current = null;
        const pendingLineRange = pendingEditorLineRangeRef.current;
        const pendingKey = formatEditorLineRangeKey(pendingLineRange);
        if (pendingKey === lastPublishedEditorLineRangeKeyRef.current) {
          return;
        }
        lastPublishedEditorLineRangeKeyRef.current = pendingKey;
        startTransition(() => {
          setEditorLocalLineRange((current) =>
            isSameEditorLineRange(current, pendingLineRange)
              ? current
              : pendingLineRange,
          );
          onActiveFileLineRangeChange?.(pendingLineRange);
        });
      }, EDITOR_LINE_RANGE_SYNC_DELAY_MS);
    },
    [clearPendingEditorLineRangeSync, onActiveFileLineRangeChange],
  );
  const handleEditorLineRangeChange = useCallback(
    (lineRange: CodeAnnotationLineRange | null) => {
      if (isSameEditorLineRange(editorLocalLineRangeRef.current, lineRange)) {
        return;
      }
      editorLocalLineRangeRef.current = lineRange;
      scheduleEditorLineRangePublish(lineRange);
    },
    [scheduleEditorLineRangePublish],
  );
  const [fileReferenceShouldRender, setFileReferenceShouldRender] =
    useState(false);
  const [fileReferenceVisible, setFileReferenceVisible] = useState(false);
  const usesSingleRowHeader = headerLayout === "single-row";
  const pendingOpenFindPanelRef = useRef(false);
  const gitRootWorkspacePrefix = useMemo(
    () => resolveGitRootWorkspacePrefix(workspacePath, gitRoot),
    [gitRoot, workspacePath],
  );
  const gitStatusMap = useMemo(() => {
    const map = new Map<string, { status: string; path: string }>();
    if (!gitStatusFiles) {
      return map;
    }
    for (const entry of gitStatusFiles) {
      const entryPath = entry.path?.trim();
      const entryStatus = entry.status?.trim();
      if (!entryPath || !entryStatus) {
        continue;
      }
      const candidates = resolveGitStatusPathCandidates(
        workspacePath,
        gitRootWorkspacePrefix,
        entryPath,
      );
      for (const candidate of candidates) {
        if (!map.has(candidate)) {
          map.set(candidate, { status: entryStatus, path: entryPath });
        }
      }
    }
    return map;
  }, [gitRootWorkspacePrefix, gitStatusFiles, workspacePath]);
  const fileReadTarget = useMemo(
    () => resolveFileReadTarget(workspacePath, filePath, customSpecRoot),
    [workspacePath, filePath, customSpecRoot],
  );
  const workspaceRelativeFilePath = fileReadTarget.workspaceRelativePath;
  const resolvedWorkspaceName = useMemo(() => {
    const explicitName = workspaceName?.trim();
    if (explicitName) {
      return explicitName;
    }
    const pathSegments = normalizeFsPath(workspacePath)
      .split("/")
      .filter(Boolean);
    return (
      pathSegments[pathSegments.length - 1] ??
      (workspacePath.trim() || workspaceId)
    );
  }, [workspaceId, workspaceName, workspacePath]);
  const matchedGitStatus = useMemo(() => {
    const fileCandidates = new Set<string>([
      ...resolveWorkspacePathCandidates(
        workspacePath,
        workspaceRelativeFilePath,
      ),
      ...resolveWorkspacePathCandidates(workspacePath, filePath),
    ]);
    for (const candidate of fileCandidates) {
      const matched = gitStatusMap.get(candidate);
      if (matched) {
        return matched;
      }
    }
    return null;
  }, [filePath, gitStatusMap, workspacePath, workspaceRelativeFilePath]);
  const fileGitStatus = matchedGitStatus?.status ?? null;
  const gitDiffTargetPath = matchedGitStatus?.path ?? workspaceRelativeFilePath;
  const resolveMatchedGitStatusByPath = useCallback(
    (path: string) => {
      for (const candidate of resolveWorkspacePathCandidates(
        workspacePath,
        path,
      )) {
        const matched = gitStatusMap.get(candidate);
        if (matched) {
          return matched;
        }
      }
      return null;
    },
    [gitStatusMap, workspacePath],
  );
  const absolutePath = useMemo(
    () =>
      fileReadTarget.domain === "workspace"
        ? resolveAbsolutePath(workspacePath, workspaceRelativeFilePath)
        : fileReadTarget.normalizedInputPath,
    [workspacePath, workspaceRelativeFilePath, fileReadTarget],
  );
  const caseInsensitivePathCompare = useMemo(
    () => isLikelyWindowsFsPath(normalizeFsPath(workspacePath)),
    [workspacePath],
  );
  const isSameWorkspacePath = useCallback(
    (leftPath: string, rightPath: string) =>
      normalizeComparablePath(leftPath, caseInsensitivePathCompare) ===
      normalizeComparablePath(rightPath, caseInsensitivePathCompare),
    [caseInsensitivePathCompare],
  );
  const {
    content,
    setContent,
    cacheDraftContent,
    documentSnapshot,
    replaceDocumentSnapshot,
    error,
    isDirty,
    isLoading,
    isSaving,
    savedContentRef,
    latestIsDirtyRef,
    externalDiskSnapshotRef,
    truncated,
    handleSave: handleDocumentSave,
  } = useFileDocumentState({
    workspaceId,
    customSpecRoot,
    workspaceRelativeFilePath,
    fileReadTarget,
    skipTextRead,
    externalAbsoluteReadOnlyMessage: t("files.externalAbsoluteReadOnly"),
  });
  const editorDraftContentRef = useRef(content);
  const handleConfirmAnnotationDraft = useCallback(
    (bodyOverride?: string) => {
      if (!annotationDraft) {
        return;
      }
      const body = (
        bodyOverride ??
        annotationDraftBodyRef.current ??
        annotationDraft.body
      ).trim();
      if (!body) {
        return;
      }
      onCreateCodeAnnotation?.(
        attachCodeAnnotationAnchor(
          {
            path: filePath,
            lineRange: annotationDraft.lineRange,
            body,
            source: annotationDraft.source,
          },
          annotationDraft.source === "file-edit-mode"
            ? editorDraftContentRef.current
            : content,
        ),
      );
      annotationDraftBodyRef.current = "";
      setAnnotationDraft(null);
    },
    [annotationDraft, content, filePath, onCreateCodeAnnotation],
  );
  const currentFileRenderToken = useMemo(
    () =>
      [
        workspaceId,
        workspaceRelativeFilePath,
        documentSnapshot.snapshotVersion,
      ].join("\u001f"),
    [documentSnapshot.snapshotVersion, workspaceId, workspaceRelativeFilePath],
  );
  const latestFileRenderTokenRef = useRef(currentFileRenderToken);
  latestFileRenderTokenRef.current = currentFileRenderToken;
  const [editorDraftDirty, setEditorDraftDirty] = useState(false);
  const effectiveIsDirty = isDirty || editorDraftDirty;
  latestIsDirtyRef.current = effectiveIsDirty;
  const hasGitRepositoryInventory = Boolean(gitRepositories?.length);
  const aggregateGitScope = useMemo(
    () =>
      gitRepositories?.length
        ? resolveFileGitScope(workspaceRelativeFilePath, gitRepositories)
        : null,
    [gitRepositories, workspaceRelativeFilePath],
  );
  const configuredGitBlameRepositoryRoot = gitRootWorkspacePrefix || null;
  const gitBlameRepositoryRoot = hasGitRepositoryInventory
    ? aggregateGitScope?.repositoryRoot || null
    : configuredGitBlameRepositoryRoot;
  const gitBlamePath = useMemo(
    () =>
      hasGitRepositoryInventory
        ? (aggregateGitScope?.path ?? workspaceRelativeFilePath)
        : resolveGitBlameRepositoryPath(
            workspaceRelativeFilePath,
            configuredGitBlameRepositoryRoot,
          ),
    [
      aggregateGitScope,
      configuredGitBlameRepositoryRoot,
      hasGitRepositoryInventory,
      workspaceRelativeFilePath,
    ],
  );
  const fileBelongsToGitRepository = hasGitRepositoryInventory
    ? aggregateGitScope !== null
    : !configuredGitBlameRepositoryRoot ||
      workspaceRelativeFilePath === configuredGitBlameRepositoryRoot ||
      workspaceRelativeFilePath.startsWith(
        `${configuredGitBlameRepositoryRoot}/`,
      );
  const activeFileGitScope = useMemo(
    () =>
      fileReadTarget.domain === "workspace" && fileBelongsToGitRepository
        ? {
            repositoryRoot: gitBlameRepositoryRoot ?? "",
            path: gitBlamePath,
          }
        : null,
    [
      fileBelongsToGitRepository,
      fileReadTarget.domain,
      gitBlamePath,
      gitBlameRepositoryRoot,
    ],
  );
  const gitBlameEligible =
    canEditDocument &&
    !skipTextRead &&
    !truncated &&
    !isLoading &&
    fileReadTarget.domain === "workspace" &&
    fileBelongsToGitRepository &&
    documentSnapshot.byteLength <= FILE_GIT_BLAME_MAX_BYTES &&
    documentSnapshot.lineCount <= FILE_GIT_BLAME_MAX_LINES;
  const gitBlame = useFileGitBlame({
    workspaceId,
    repositoryRoot: gitBlameRepositoryRoot,
    path: gitBlamePath,
    renderToken: currentFileRenderToken,
    eligible: gitBlameEligible,
    isDirty: effectiveIsDirty,
  });
  const gitBlameActionLabel =
    gitBlame.status === "loading"
      ? t("files.gitBlameLoading")
      : gitBlame.status === "stale"
        ? t("files.gitBlameStale")
        : gitBlame.status === "error"
          ? t("files.gitBlameError")
          : gitBlame.enabled
            ? t("files.gitBlameDisable")
            : t("files.gitBlameEnable");
  const typingDiagnosticsRef = useRef<FileEditorTypingDiagnosticsSession>(
    createFileEditorTypingDiagnosticsSession({
      workspaceId,
      filePath,
      fileKind: renderProfile.kind,
      byteLength: null,
      lineCount: null,
    }),
  );

  useEffect(() => {
    typingDiagnosticsRef.current = createFileEditorTypingDiagnosticsSession({
      workspaceId,
      filePath,
      fileKind: renderProfile.kind,
      byteLength: null,
      lineCount: null,
    });
  }, [filePath, renderProfile.kind, workspaceId]);

  useEffect(() => {
    editorDraftContentRef.current = content;
    setEditorDraftDirty(false);
  }, [content]);

  const handleEditorContentDraftChange = useCallback(
    (nextContent: string) => {
      editorDraftContentRef.current = nextContent;
      if (!isLoading) {
        cacheDraftContent(nextContent);
      }
      const nextIsDirty = nextContent !== savedContentRef.current;
      latestIsDirtyRef.current = nextIsDirty;
      setEditorDraftDirty((current) =>
        current === nextIsDirty ? current : nextIsDirty,
      );
    },
    [cacheDraftContent, isLoading, latestIsDirtyRef, savedContentRef],
  );

  const flushEditorDraftToDocument = useCallback(() => {
    setContent(editorDraftContentRef.current);
  }, [setContent]);

  const handleEditorContentPublished = useCallback(() => {
    typingDiagnosticsRef.current.recordPublishedUpdate();
  }, []);

  const handleEditorTypingInput = useCallback((durationMs: number) => {
    typingDiagnosticsRef.current.recordInput(durationMs);
  }, []);

  const activeDeclarationLineRange =
    editorLocalLineRange ?? activeFileLineRange;

  useEffect(() => {
    const resolveEpoch = activeCodeAnchorResolveEpochRef.current + 1;
    activeCodeAnchorResolveEpochRef.current = resolveEpoch;
    clearPendingActiveCodeAnchorResolve();

    if (!activeDeclarationLineRange) {
      startTransition(() => {
        setActiveDeclarationCodeAnchor(null);
      });
      return;
    }

    activeCodeAnchorResolveTimerRef.current = window.setTimeout(() => {
      activeCodeAnchorResolveTimerRef.current = null;
      if (activeCodeAnchorResolveEpochRef.current !== resolveEpoch) {
        return;
      }
      const nextAnchor = resolveDeclarationCodeSelectionAnchor({
        filePath,
        content: editorDraftContentRef.current,
        lineRange: activeDeclarationLineRange,
      });
      startTransition(() => {
        setActiveDeclarationCodeAnchor(nextAnchor);
      });
    }, EDITOR_LINE_RANGE_SYNC_DELAY_MS);

    return clearPendingActiveCodeAnchorResolve;
  }, [
    activeDeclarationLineRange,
    clearPendingActiveCodeAnchorResolve,
    filePath,
  ]);

  useEffect(() => {
    onActiveCodeAnchorChange?.(activeDeclarationCodeAnchor);
  }, [activeDeclarationCodeAnchor, onActiveCodeAnchorChange]);

  const handleAssociateIntentCanvasCodeAnchor = useCallback(() => {
    if (!activeDeclarationCodeAnchor) {
      pushErrorToast({
        title: t("files.associateIntentCanvasUnavailableTitle"),
        message: t("files.associateIntentCanvasUnavailable"),
        variant: "info",
        durationMs: 4200,
      });
      return;
    }
    onAssociateIntentCanvasCodeAnchor?.(activeDeclarationCodeAnchor);
  }, [activeDeclarationCodeAnchor, onAssociateIntentCanvasCodeAnchor, t]);

  const {
    externalChangeConflict,
    externalPendingRefresh,
    externalCompareOpen,
    externalAutoSyncAt,
    externalChangeSyncState,
    handleExternalReloadFromDisk,
    handleExternalApplyPendingRefresh,
    handleExternalKeepLocal,
    handleExternalToggleCompare,
    setExternalChangeSyncState,
    setExternalChangeConflict,
    setExternalPendingRefresh,
    setExternalCompareOpen,
    setExternalAutoSyncAt,
  } = useFileExternalSync({
    filePath,
    workspaceId,
    workspaceRelativeFilePath,
    fileReadTargetDomain: fileReadTarget.domain,
    externalChangeMonitoringEnabled,
    externalChangeTransportMode,
    externalChangePollIntervalMs,
    externalChangeApplyMode,
    externalChangeAutoApplyDebounceMs,
    isBinary: skipTextRead,
    isDirty: effectiveIsDirty,
    isLoading,
    caseInsensitivePathCompare,
    replaceDocumentSnapshot,
    previewSnapshotVersion: documentSnapshot.snapshotVersion,
    fileRenderPressure,
    savedContentRef,
    latestIsDirtyRef,
    externalDiskSnapshotRef,
    autoSyncedMessage: t("files.externalChangeAutoSynced"),
  });
  const handleSave = useCallback(async () => {
    flushEditorDraftToDocument();
    const saved = await handleDocumentSave();
    if (!saved) {
      return;
    }
    typingDiagnosticsRef.current.recordTauriFileWrite();
    setEditorDraftDirty(false);
    setExternalChangeSyncState((current) =>
      reduceExternalChangeSyncState(current, { type: "file-loaded" }),
    );
    setExternalChangeConflict(null);
    setExternalPendingRefresh(null);
    setExternalCompareOpen(false);
    setExternalAutoSyncAt(null);
    if (gitBlame.enabled) {
      gitBlame.refresh();
    }
    onSaveSuccess?.();
  }, [
    flushEditorDraftToDocument,
    handleDocumentSave,
    gitBlame,
    onSaveSuccess,
    setExternalChangeConflict,
    setExternalPendingRefresh,
    setExternalChangeSyncState,
    setExternalCompareOpen,
    setExternalAutoSyncAt,
  ]);

  const {
    isDefinitionLoading,
    isReferencesLoading,
    isImplementationsLoading,
    navigationError,
    definitionCandidates,
    setDefinitionCandidates,
    referenceResults,
    setReferenceResults,
    implementationCandidates,
    setImplementationCandidates,
    navigateToLocation,
    runDefinitionFromCursor,
    runReferencesFromCursor,
    runImplementationsFromCursor,
    navigationStatus,
    retryNavigation,
    resolveDefinitionAtOffset,
    openFindPanelInEditor,
    toggleFindPanelInEditor,
    canNavigateBack,
    canNavigateForward,
    navigateBack,
    navigateForward,
  } = useFileNavigation({
    workspaceId,
    workspacePath,
    filePath,
    absolutePath,
    caseInsensitivePathCompare,
    isSameWorkspacePath,
    navigationTarget,
    isLoading,
    t,
    onNavigateToLocation,
    setMode,
    cmRef,
  });
  const hasExplicitHighlightMarkers = useMemo(
    () => hasGitLineMarkers(highlightMarkers),
    [highlightMarkers],
  );
  const effectiveGitLineMarkers = useMemo(
    () => (hasExplicitHighlightMarkers ? highlightMarkers! : gitLineMarkers),
    [hasExplicitHighlightMarkers, highlightMarkers, gitLineMarkers],
  );
  const gitAddedLineNumberSet = useMemo(
    () => new Set(effectiveGitLineMarkers.added),
    [effectiveGitLineMarkers.added],
  );
  const gitModifiedLineNumberSet = useMemo(
    () => new Set(effectiveGitLineMarkers.modified),
    [effectiveGitLineMarkers.modified],
  );

  const {
    imageSrc,
    imageLoadError,
    imageInfo,
    handleImageLoad,
    handleImageError,
  } = useFileImagePreview({ absolutePath, isImage, workspaceId, t });

  useEffect(() => {
    const normalizedStatus = (fileGitStatus ?? "").toUpperCase();
    if (hasExplicitHighlightMarkers) {
      setGitLineMarkers(resetGitLineMarkersIfNeeded);
      return;
    }
    if (!gitBlame.enabled || fileReadTarget.domain !== "workspace") {
      setGitLineMarkers(resetGitLineMarkersIfNeeded);
      return;
    }
    if (
      isLoading ||
      !normalizedStatus ||
      normalizedStatus === "D" ||
      skipTextRead
    ) {
      setGitLineMarkers(resetGitLineMarkersIfNeeded);
      return;
    }
    if (effectiveIsDirty) {
      return;
    }

    let cancelled = false;
    const requestRenderToken = currentFileRenderToken;
    getGitFileFullDiff(workspaceId, gitDiffTargetPath)
      .then((diff) => {
        if (
          cancelled ||
          latestFileRenderTokenRef.current !== requestRenderToken
        ) {
          return;
        }
        setGitLineMarkers(parseLineMarkersFromDiff(diff));
      })
      .catch(() => {
        if (
          !cancelled &&
          latestFileRenderTokenRef.current === requestRenderToken
        ) {
          setGitLineMarkers(resetGitLineMarkersIfNeeded);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    currentFileRenderToken,
    effectiveIsDirty,
    workspaceId,
    gitDiffTargetPath,
    fileGitStatus,
    fileReadTarget.domain,
    gitBlame.enabled,
    hasExplicitHighlightMarkers,
    isLoading,
    skipTextRead,
  ]);

  useEffect(
    () => () => clearPendingEditorLineRangeSync(),
    [clearPendingEditorLineRangeSync],
  );
  useEffect(
    () => () => clearPendingActiveCodeAnchorResolve(),
    [clearPendingActiveCodeAnchorResolve],
  );

  useEffect(() => {
    if (
      editorLocalLineRangeRef.current !== null ||
      activeFileLineRange === null
    ) {
      return;
    }
    editorLocalLineRangeRef.current = activeFileLineRange;
    pendingEditorLineRangeRef.current = activeFileLineRange;
    lastPublishedEditorLineRangeKeyRef.current =
      formatEditorLineRangeKey(activeFileLineRange);
    setEditorLocalLineRange(activeFileLineRange);
  }, [activeFileLineRange]);

  useEffect(() => {
    pendingOpenFindPanelRef.current = false;
    setMode(defaultMode);
    clearPendingEditorLineRangeSync();
    clearPendingActiveCodeAnchorResolve();
    activeCodeAnchorResolveEpochRef.current += 1;
    editorLocalLineRangeRef.current = null;
    pendingEditorLineRangeRef.current = null;
    lastPublishedEditorLineRangeKeyRef.current = "none";
    setEditorLocalLineRange(null);
    setActiveDeclarationCodeAnchor(null);
    onActiveFileLineRangeChange?.(null);
    lastReportedLineRangeRef.current = "";
  }, [
    clearPendingEditorLineRangeSync,
    clearPendingActiveCodeAnchorResolve,
    defaultMode,
    filePath,
    onActiveFileLineRangeChange,
  ]);

  useEffect(() => {
    if (
      typeof document === "undefined" ||
      typeof MutationObserver === "undefined"
    ) {
      return;
    }
    const updateTheme = () => {
      setEditorTheme((prev) => {
        const next = resolveEditorTheme();
        return prev === next ? prev : next;
      });
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (isThemeMutationAttribute(mutation.attributeName)) {
          updateTheme();
          return;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    const media =
      typeof window !== "undefined" && window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: light)")
        : null;
    const handleMediaChange = () => updateTheme();
    if (media?.addEventListener) {
      media.addEventListener("change", handleMediaChange);
    } else if (media?.addListener) {
      media.addListener(handleMediaChange);
    }
    return () => {
      observer.disconnect();
      if (media?.removeEventListener) {
        media.removeEventListener("change", handleMediaChange);
      } else if (media?.removeListener) {
        media.removeListener(handleMediaChange);
      }
    };
  }, []);

  useEffect(() => {
    onDirtyChange?.(effectiveIsDirty);
  }, [effectiveIsDirty, onDirtyChange]);

  useEffect(() => {
    if (mode === "edit" && !isLoading && !truncated) {
      requestAnimationFrame(() => {
        cmRef.current?.view?.focus();
      });
    }
  }, [mode, isLoading, truncated]);

  const languageExtensionRequestRef = useRef(0);
  const [languageExtensions, setLanguageExtensions] = useState<
    ReactCodeMirrorProps["extensions"]
  >([]);

  useEffect(() => {
    const requestId = languageExtensionRequestRef.current + 1;
    languageExtensionRequestRef.current = requestId;
    if (mode !== "edit" || !renderProfile.editorLanguage) {
      setLanguageExtensions([]);
      return;
    }
    loadCodeMirrorExtensionsForEditorLanguage(renderProfile.editorLanguage)
      .then((extensions) => {
        if (languageExtensionRequestRef.current === requestId) {
          setLanguageExtensions(extensions);
        }
      })
      .catch((error) => {
        console.error(
          "[file-view] failed to load CodeMirror language extension:",
          error,
        );
        if (languageExtensionRequestRef.current === requestId) {
          setLanguageExtensions([]);
        }
      });
  }, [mode, renderProfile.editorLanguage]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) {
        return;
      }
      if (matchesShortcutForPlatform(event, saveFileShortcut)) {
        event.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [handleSave, saveFileShortcut]);

  useEffect(() => {
    if (onSingleRowLeadingAction) {
      return;
    }
    const handleNavigationShortcut = (event: KeyboardEvent) => {
      if (
        canNavigateBack &&
        matchesShortcutForPlatform(event, NAVIGATE_BACK_SHORTCUT)
      ) {
        event.preventDefault();
        navigateBack();
        return;
      }
      if (
        canNavigateForward &&
        matchesShortcutForPlatform(event, NAVIGATE_FORWARD_SHORTCUT)
      ) {
        event.preventDefault();
        navigateForward();
      }
    };
    window.addEventListener("keydown", handleNavigationShortcut, true);
    return () =>
      window.removeEventListener("keydown", handleNavigationShortcut, true);
  }, [
    canNavigateBack,
    canNavigateForward,
    navigateBack,
    navigateForward,
    onSingleRowLeadingAction,
  ]);

  const handleEnterEdit = useCallback(() => {
    if (truncated || !canEditDocument) return;
    setMode("edit");
    requestAnimationFrame(() => {
      cmRef.current?.view?.focus();
    });
  }, [canEditDocument, truncated]);

  const handleEnterPreview = useCallback(() => {
    flushEditorDraftToDocument();
    setMode("preview");
    clearPendingEditorLineRangeSync();
    editorLocalLineRangeRef.current = null;
    pendingEditorLineRangeRef.current = null;
    lastPublishedEditorLineRangeKeyRef.current = "none";
    setEditorLocalLineRange(null);
    onActiveFileLineRangeChange?.(null);
    lastReportedLineRangeRef.current = "";
  }, [
    clearPendingEditorLineRangeSync,
    flushEditorDraftToDocument,
    onActiveFileLineRangeChange,
  ]);

  const buildCurrentNoteCaptureDraft = useCallback(() => {
    if (!onCaptureNote || skipTextRead || truncated) {
      return null;
    }
    const editorView = mode === "edit" ? (cmRef.current?.view ?? null) : null;
    if (editorView) {
      const selection = editorView.state.selection.main;
      if (!selection.empty) {
        const endOffset = Math.max(selection.from, selection.to - 1);
        return buildCodeSelectionNoteDraft({
          path: filePath,
          content: editorView.state.sliceDoc(selection.from, selection.to),
          startLine: editorView.state.doc.lineAt(selection.from).number,
          endLine: editorView.state.doc.lineAt(endOffset).number,
          language: renderProfile.previewLanguage,
        });
      }
      return buildCodeSelectionNoteDraft({
        path: filePath,
        content: editorView.state.doc.sliceString(
          0,
          editorView.state.doc.length,
        ),
        startLine: 1,
        endLine: editorView.state.doc.lines,
        language: renderProfile.previewLanguage,
      });
    }
    return buildCodeSelectionNoteDraft({
      path: filePath,
      content,
      startLine: 1,
      endLine: documentSnapshot.lineCount,
      language: renderProfile.previewLanguage,
    });
  }, [
    content,
    documentSnapshot.lineCount,
    filePath,
    mode,
    onCaptureNote,
    renderProfile.previewLanguage,
    skipTextRead,
    truncated,
  ]);

  const resolveEditorSelectionChatSnippet = useCallback(() => {
    if (!onInsertText || skipTextRead || truncated) {
      return null;
    }
    const editorView = mode === "edit" ? (cmRef.current?.view ?? null) : null;
    if (editorView) {
      const selection = editorView.state.selection.main;
      if (selection.empty) {
        return null;
      }
      const endOffset = Math.max(selection.from, selection.to - 1);
      return buildCodeSelectionChatSnippet({
        path: filePath,
        content: editorView.state.sliceDoc(selection.from, selection.to),
        startLine: editorView.state.doc.lineAt(selection.from).number,
        endLine: editorView.state.doc.lineAt(endOffset).number,
        language: renderProfile.previewLanguage,
      });
    }
    return null;
  }, [
    filePath,
    mode,
    onInsertText,
    renderProfile.previewLanguage,
    skipTextRead,
    truncated,
  ]);

  useEffect(() => {
    const handleFileCommandShortcut = (event: KeyboardEvent) => {
      const panelRoot = panelRootRef.current;
      const target = event.target;
      if (
        !panelRoot ||
        !(target instanceof Node) ||
        !panelRoot.contains(target)
      ) {
        return;
      }
      const isCodeMirrorTarget =
        target instanceof Element && Boolean(target.closest(".cm-editor"));
      if (isEditableShortcutTarget(target) && !isCodeMirrorTarget) {
        return;
      }

      let action: (() => void) | null = null;
      if (
        matchesShortcutForPlatform(
          event,
          FILE_CONTEXT_MENU_SHORTCUTS.togglePreview,
        )
      ) {
        action =
          mode === "edit"
            ? handleEnterPreview
            : truncated || !canEditDocument
              ? null
              : handleEnterEdit;
      } else if (
        onRevealInFileTree &&
        matchesShortcutForPlatform(
          event,
          FILE_CONTEXT_MENU_SHORTCUTS.revealInFileTree,
        )
      ) {
        action = () => onRevealInFileTree(filePath);
      } else if (
        mode === "edit" &&
        onAssociateIntentCanvasCodeAnchor &&
        matchesShortcutForPlatform(
          event,
          FILE_CONTEXT_MENU_SHORTCUTS.associateIntentCanvas,
        )
      ) {
        action = handleAssociateIntentCanvasCodeAnchor;
      } else if (
        mode === "edit" &&
        onCaptureNote &&
        matchesShortcutForPlatform(
          event,
          FILE_CONTEXT_MENU_SHORTCUTS.captureNote,
        )
      ) {
        const noteDraft = buildCurrentNoteCaptureDraft();
        action = noteDraft ? () => onCaptureNote(noteDraft) : null;
      } else if (
        onInsertText &&
        matchesShortcutForPlatform(
          event,
          FILE_CONTEXT_MENU_SHORTCUTS.addToChat,
        )
      ) {
        const snippet = resolveEditorSelectionChatSnippet();
        action = snippet ? () => onInsertText(snippet) : null;
      } else if (
        activeFileGitScope &&
        onOpenFileHistory &&
        matchesShortcutForPlatform(
          event,
          FILE_CONTEXT_MENU_SHORTCUTS.showFileHistory,
        )
      ) {
        action = () =>
          onOpenFileHistory({
            workspaceId,
            workspacePath,
            repositoryRoot: activeFileGitScope.repositoryRoot,
            path: activeFileGitScope.path,
            displayPath: filePath,
          });
      } else if (
        mode === "edit" &&
        (gitBlameEligible || gitBlame.enabled) &&
        matchesShortcutForPlatform(
          event,
          FILE_CONTEXT_MENU_SHORTCUTS.toggleGitBlame,
        )
      ) {
        action = gitBlame.toggle;
      }

      if (!action) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    window.addEventListener("keydown", handleFileCommandShortcut, true);
    return () =>
      window.removeEventListener("keydown", handleFileCommandShortcut, true);
  }, [
    activeFileGitScope,
    buildCurrentNoteCaptureDraft,
    canEditDocument,
    filePath,
    gitBlame,
    gitBlameEligible,
    handleAssociateIntentCanvasCodeAnchor,
    handleEnterEdit,
    handleEnterPreview,
    mode,
    onAssociateIntentCanvasCodeAnchor,
    onCaptureNote,
    onInsertText,
    onOpenFileHistory,
    onRevealInFileTree,
    resolveEditorSelectionChatSnippet,
    truncated,
    workspaceId,
    workspacePath,
  ]);

  const showClipboardError = useCallback(
    (action: string, error: unknown) => {
      pushErrorToast({
        title: t("files.clipboardActionFailedTitle"),
        message: t("files.clipboardActionFailed", {
          action,
          message: error instanceof Error ? error.message : String(error),
        }),
      });
    },
    [t],
  );

  const openFileContextMenu = useCallback(
    (
      event: ReactMouseEvent<HTMLDivElement>,
      selectionNoteDraft?: NoteCaptureDraft,
    ) => {
      buildFileViewContextMenu({
        activeFileGitScope,
        canEditDocument,
        cmRef,
        content,
        documentSnapshot,
        effectiveIsDirty,
        event,
        expandSelectionShortcut,
        filePath,
        gitBlame,
        gitBlameActionLabel,
        gitBlameEligible,
        handleAssociateIntentCanvasCodeAnchor,
        handleEnterEdit,
        handleEnterPreview,
        handleSave,
        isDefinitionLoading,
        isImplementationsLoading,
        isReferencesLoading,
        isSaving,
        mode,
        onAssociateIntentCanvasCodeAnchor,
        onCaptureNote,
        onInsertText,
        onOpenFileHistory,
        onRevealInFileTree,
        renderProfile,
        runDefinitionFromCursor,
        runImplementationsFromCursor,
        runReferencesFromCursor,
        saveFileShortcut,
        selectionNoteDraft,
        setFileContextMenu,
        showClipboardError,
        skipTextRead,
        t,
        truncated,
        workspaceId,
        workspacePath,
      });
    },
    [
      activeFileGitScope,
      canEditDocument,
      content,
      documentSnapshot,
      effectiveIsDirty,
      expandSelectionShortcut,
      filePath,
      gitBlame,
      gitBlameEligible,
      handleAssociateIntentCanvasCodeAnchor,
      handleEnterEdit,
      handleEnterPreview,
      handleSave,
      isDefinitionLoading,
      isImplementationsLoading,
      isReferencesLoading,
      isSaving,
      mode,
      onAssociateIntentCanvasCodeAnchor,
      onCaptureNote,
      onInsertText,
      onOpenFileHistory,
      onRevealInFileTree,
      renderProfile.previewLanguage,
      runDefinitionFromCursor,
      runImplementationsFromCursor,
      runReferencesFromCursor,
      saveFileShortcut,
      showClipboardError,
      skipTextRead,
      t,
      truncated,
      workspaceId,
      workspacePath,
    ],
  );

  const handleOpenFindPanel = useCallback(() => {
    if (skipTextRead || truncated) {
      return;
    }
    pendingOpenFindPanelRef.current = true;
    if (mode !== "edit") {
      setMode("edit");
      return;
    }
    if (toggleFindPanelInEditor()) {
      pendingOpenFindPanelRef.current = false;
    }
  }, [mode, skipTextRead, toggleFindPanelInEditor, truncated]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!matchesShortcutForPlatform(event, findInFileShortcut)) {
        return;
      }
      const panelRoot = panelRootRef.current;
      const target = event.target;
      if (
        !panelRoot ||
        !(target instanceof Node) ||
        !panelRoot.contains(target)
      ) {
        return;
      }
      if (isEditableShortcutTarget(target)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleOpenFindPanel();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [findInFileShortcut, handleOpenFindPanel]);

  useEffect(() => {
    if (!pendingOpenFindPanelRef.current) {
      return;
    }
    if (mode !== "edit" || isLoading || truncated) {
      return;
    }
    let rafId = 0;
    let attemptCount = 0;
    const attemptOpen = () => {
      attemptCount += 1;
      if (openFindPanelInEditor()) {
        pendingOpenFindPanelRef.current = false;
        return;
      }
      if (attemptCount < 10) {
        rafId = window.requestAnimationFrame(attemptOpen);
      }
    };
    rafId = window.requestAnimationFrame(attemptOpen);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [isLoading, mode, openFindPanelInEditor, truncated]);

  useEffect(() => {
    const shouldLoadPreviewOverride =
      mode === "preview" &&
      truncated &&
      renderProfile.kind === "markdown" &&
      fileReadTarget.domain === "workspace";
    const overrideKey = `${workspaceId}:${workspaceRelativeFilePath}`;
    if (!shouldLoadPreviewOverride) {
      setMarkdownPreviewOverride(null);
      return;
    }

    let cancelled = false;
    const requestRenderToken = latestFileRenderTokenRef.current;
    markdownPreviewOverrideRequestRef.current += 1;
    const requestId = markdownPreviewOverrideRequestRef.current;
    readWorkspaceFilePreview(workspaceId, workspaceRelativeFilePath)
      .then((response) => {
        if (
          cancelled ||
          requestId !== markdownPreviewOverrideRequestRef.current ||
          latestFileRenderTokenRef.current !== requestRenderToken
        ) {
          return;
        }
        setMarkdownPreviewOverride({
          key: overrideKey,
          content: response.content ?? "",
          truncated: Boolean(response.truncated),
        });
      })
      .catch(() => {
        if (
          cancelled ||
          requestId !== markdownPreviewOverrideRequestRef.current ||
          latestFileRenderTokenRef.current !== requestRenderToken
        ) {
          return;
        }
        setMarkdownPreviewOverride(null);
      });
    return () => {
      cancelled = true;
    };
  }, [
    fileReadTarget.domain,
    mode,
    renderProfile.kind,
    truncated,
    workspaceId,
    workspaceRelativeFilePath,
  ]);

  const effectiveMarkdownPreviewContent =
    markdownPreviewOverride?.content ?? content;

  const previewMetrics = useMemo(() => {
    if (
      mode === "preview" &&
      renderProfile.kind === "markdown" &&
      markdownPreviewOverride?.content
    ) {
      return {
        byteLength: 0,
        lineCount: 0,
        truncated: false,
      };
    }
    return getFileDocumentSnapshotMetrics(documentSnapshot);
  }, [documentSnapshot, markdownPreviewOverride, mode, renderProfile.kind]);
  const viewSurface = useMemo(
    () => resolveFileViewSurface(renderProfile, mode, previewMetrics),
    [mode, previewMetrics, renderProfile],
  );
  const markdownFastFeatureFlags = useMemo(
    resolveFileMarkdownFastFeatureFlags,
    [],
  );
  const markdownRendererProfile = useMemo<
    FastMarkdownRendererProfileId | undefined
  >(() => {
    if (viewSurface.kind !== "markdown-preview") {
      return undefined;
    }
    return resolveFastMarkdownRendererProfile(
      resolveFastMarkdownProfileInputs({
        rawMarkdown: effectiveMarkdownPreviewContent,
        featureFlags: markdownFastFeatureFlags,
      }),
    );
  }, [
    effectiveMarkdownPreviewContent,
    markdownFastFeatureFlags,
    viewSurface.kind,
  ]);
  const previewPayloadEnabled =
    mode === "preview" &&
    (viewSurface.kind === "pdf-preview" ||
      viewSurface.kind === "tabular-preview" ||
      viewSurface.kind === "document-preview");
  const {
    payload: previewPayload,
    isLoading: previewPayloadLoading,
    error: previewPayloadError,
  } = useFilePreviewPayload({
    workspaceId,
    customSpecRoot,
    fileReadTarget,
    absolutePath,
    renderProfile,
    content,
    truncated,
    enabled: previewPayloadEnabled,
  });
  const previewLanguage = renderProfile.previewLanguage;
  const shouldBuildCodePreviewLines =
    viewSurface.kind === "code-preview" && documentSnapshot.lineCount <= 1_000;
  const highlightedPreviewLanguage = useMemo(
    () =>
      shouldBuildCodePreviewLines && !viewSurface.useLowCostPreview
        ? previewLanguage
        : null,
    [
      previewLanguage,
      shouldBuildCodePreviewLines,
      viewSurface.useLowCostPreview,
    ],
  );
  const lines = useMemo(
    () =>
      shouldBuildCodePreviewLines
        ? documentSnapshot.getLines(0, documentSnapshot.lineCount)
        : [],
    [documentSnapshot, shouldBuildCodePreviewLines],
  );
  const visibleCodeAnnotations = useMemo(
    () =>
      resolveCodeAnnotationsForFile(
        mode === "edit" ? editorDraftContentRef.current : content,
        filePath,
        codeAnnotations,
      ),
    [codeAnnotations, content, filePath, mode],
  );
  const highlightedLines = useMemo(
    () =>
      lines.map((line) => {
        const html = highlightLine(line, highlightedPreviewLanguage);
        return html || "&nbsp;";
      }),
    [highlightedPreviewLanguage, lines],
  );
  const annotationWidgetLabels = useMemo(
    () => ({
      title: t("files.annotationDraft"),
      remove: t("files.annotationRemove"),
      placeholder: t("files.annotationPlaceholder"),
      cancel: t("common.cancel"),
      submit: t("files.annotationSubmit"),
    }),
    [t],
  );
  const annotationWidgetCallbacks = useMemo<AnnotationWidgetCallbacks>(
    () => ({
      onDraftCancel: () => {
        annotationDraftBodyRef.current = "";
        setAnnotationDraft(null);
      },
      onDraftConfirm: handleConfirmAnnotationDraft,
      onRemoveAnnotation: onRemoveCodeAnnotation,
    }),
    [handleConfirmAnnotationDraft, onRemoveCodeAnnotation],
  );
  const editorCodeAnnotations = useMemo(
    () =>
      visibleCodeAnnotations.filter(
        (annotation) => annotation.source === "file-edit-mode",
      ),
    [visibleCodeAnnotations],
  );
  const editorAnnotationDraft =
    effectiveAnnotationDraft?.source === "file-edit-mode"
      ? effectiveAnnotationDraft
      : null;

  const visibleTabs = useMemo(
    () => (openTabs && openTabs.length > 0 ? openTabs : [filePath]),
    [openTabs, filePath],
  );
  const canCloseAllTabs = Boolean(onCloseAllTabs && visibleTabs.length > 0);
  const canReorderTabs = Boolean(onReorderTabs) && visibleTabs.length > 1;
  const visibleActiveFileLineRange =
    editorLocalLineRange ?? activeFileLineRange;
  const activeFileLineLabel = visibleActiveFileLineRange
    ? visibleActiveFileLineRange.startLine ===
      visibleActiveFileLineRange.endLine
      ? `L${visibleActiveFileLineRange.startLine}`
      : `L${visibleActiveFileLineRange.startLine}-L${visibleActiveFileLineRange.endLine}`
    : null;

  useEffect(() => {
    if (activeFileLineLabel) {
      setFileReferenceShouldRender(true);
      setFileReferenceVisible(true);
      return;
    }
    if (!fileReferenceShouldRender) {
      return;
    }
    setFileReferenceVisible(false);
    const timerId = window.setTimeout(() => {
      setFileReferenceShouldRender(false);
    }, 120);
    return () => window.clearTimeout(timerId);
  }, [activeFileLineLabel, fileReferenceShouldRender]);

  const closeTabContextMenu = useCallback(() => {
    setTabContextMenu(null);
  }, []);

  const {
    draggingTabPath,
    dragOverTabPath,
    suppressTabClickRef,
    endTabDrag,
    handleTabPointerDown,
    handleTabPointerMove,
    handleTabPointerUp,
  } = useFileTabDrag({ canReorderTabs, onReorderTabs, visibleTabs });

  const handleOpenDetachedTab = useCallback(
    (tabPath: string) => {
      void openNewDetachedFileExplorerWindow(
        buildDetachedFileExplorerSession({
          workspaceId,
          workspaceName: resolvedWorkspaceName,
          workspacePath,
          gitRoot,
          initialFilePath: tabPath,
          defaultSidebarCollapsed: true,
        }),
      ).catch((error) => {
        pushErrorToast({
          title: t("files.openDetachedTab"),
          message: error instanceof Error ? error.message : String(error),
        });
      });
    },
    [gitRoot, resolvedWorkspaceName, t, workspaceId, workspacePath],
  );

  const resolveTabGitScope = useCallback(
    (tabPath: string) => {
      if (gitRepositories?.length) {
        return resolveFileGitScope(tabPath, gitRepositories);
      }
      const normalizedPath = normalizeFsPath(tabPath)
        .replace(/^\.\//, "")
        .replace(/^\/+/, "");
      if (
        !normalizedPath ||
        normalizedPath.split("/").some((segment) => segment === "..") ||
        (configuredGitBlameRepositoryRoot &&
          normalizedPath !== configuredGitBlameRepositoryRoot &&
          !normalizedPath.startsWith(`${configuredGitBlameRepositoryRoot}/`))
      ) {
        return null;
      }
      return {
        repositoryRoot: configuredGitBlameRepositoryRoot ?? "",
        path: resolveGitBlameRepositoryPath(
          normalizedPath,
          configuredGitBlameRepositoryRoot,
        ),
      };
    },
    [configuredGitBlameRepositoryRoot, gitRepositories],
  );

  const handleTabGitBlame = useCallback(
    (tabPath: string) => {
      if (tabPath === filePath) {
        gitBlame.toggle();
        return;
      }
      if (!onActivateTab) {
        return;
      }
      pendingGitBlamePathRef.current = tabPath;
      onActivateTab(tabPath);
    },
    [filePath, gitBlame, onActivateTab],
  );

  useEffect(() => {
    if (pendingGitBlamePathRef.current !== filePath || isLoading) {
      return;
    }
    pendingGitBlamePathRef.current = null;
    if (gitBlameEligible && !gitBlame.enabled) {
      gitBlame.toggle();
    }
  }, [filePath, gitBlame, gitBlameEligible, isLoading]);

  const openTabContextMenu = useCallback(
    (event: ReactMouseEvent, tabPath: string) => {
      buildFileViewTabContextMenu({
        canCloseAllTabs,
        event,
        filePath,
        gitBlame,
        gitBlameEligible,
        handleOpenDetachedTab,
        handleTabGitBlame,
        onActivateTab,
        onCloseAllTabs,
        onCloseOtherTabs,
        onCloseTab,
        onOpenFileHistory,
        resolveTabGitScope,
        setTabContextMenu,
        t,
        tabPath,
        visibleTabs,
        workspaceId,
        workspacePath,
      });
    },
    [
      canCloseAllTabs,
      filePath,
      gitBlame.enabled,
      gitBlameEligible,
      handleOpenDetachedTab,
      handleTabGitBlame,
      onActivateTab,
      onCloseAllTabs,
      onCloseOtherTabs,
      onCloseTab,
      onOpenFileHistory,
      resolveTabGitScope,
      t,
      visibleTabs.length,
      workspaceId,
      workspacePath,
    ],
  );





  const renderHeader = () => (
    <div className="fvp-header-row">
      {onSingleRowLeadingAction ? (
        <button
          type="button"
          className="icon-button fvp-back"
          onClick={onSingleRowLeadingAction}
          aria-label={singleRowLeadingLabel ?? t("files.backToChat")}
          title={singleRowLeadingLabel ?? t("files.backToChat")}
          data-tauri-drag-region="false"
        >
          {singleRowLeadingDirection === "right" ? (
            <ArrowRight size={16} aria-hidden />
          ) : (
            <ArrowLeft size={16} aria-hidden />
          )}
        </button>
      ) : (
        <>
          <button
            type="button"
            className="icon-button fvp-back"
            onClick={navigateBack}
            disabled={!canNavigateBack}
            aria-label={t("files.navigationBack")}
            title={`${t("files.navigationBack")} (${formatShortcutForPlatform(NAVIGATE_BACK_SHORTCUT)})`}
            data-tauri-drag-region="false"
          >
            <ArrowLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button fvp-back"
            onClick={navigateForward}
            disabled={!canNavigateForward}
            aria-label={t("files.navigationForward")}
            title={`${t("files.navigationForward")} (${formatShortcutForPlatform(NAVIGATE_FORWARD_SHORTCUT)})`}
            data-tauri-drag-region="false"
          >
            <ArrowRight size={16} aria-hidden />
          </button>
        </>
      )}
      <div className="fvp-header-row-tabs">
        <FileViewPanelTabs
          className="fvp-tabs-inline"
          tabsContainerRef={tabsContainerRef}
          visibleTabs={visibleTabs}
          activeTabPath={activeTabPath}
          filePath={filePath}
          resolveMatchedGitStatusByPath={resolveMatchedGitStatusByPath}
          draggingTabPath={draggingTabPath}
          dragOverTabPath={dragOverTabPath}
          canReorderTabs={canReorderTabs}
          handleTabPointerDown={handleTabPointerDown}
          handleTabPointerMove={handleTabPointerMove}
          handleTabPointerUp={handleTabPointerUp}
          endTabDrag={endTabDrag}
          suppressTabClickRef={suppressTabClickRef}
          onActivateTab={onActivateTab}
          onToggleEditorFileMaximized={onToggleEditorFileMaximized}
          openTabContextMenu={openTabContextMenu}
          handleOpenDetachedTab={handleOpenDetachedTab}
          onCloseTab={onCloseTab}
          t={t}
        />
      </div>
      <div className="fvp-header-row-right">
        {effectiveIsDirty ? (
          <span
            className="fvp-dirty-dot"
            aria-label={t("files.unsavedChanges")}
          />
        ) : null}
        {truncated ? (
          <span className="fvp-truncated">{t("files.truncated")}</span>
        ) : null}
      </div>
    </div>
  );

  const renderContent = () => (
    <FileViewBody
      workspaceId={workspaceId}
      filePath={filePath}
      sourceFilePath={absolutePath}
      documentKey={`${workspaceId}:${fileReadTarget.domain}:${workspaceRelativeFilePath}`}
      imageSrc={imageSrc}
      imageInfo={imageInfo}
      handleImageLoad={handleImageLoad}
      handleImageError={handleImageError}
      imageLoadError={imageLoadError}
      error={error}
      isLoading={isLoading}
      previewPayload={previewPayload}
      previewPayloadLoading={previewPayloadLoading}
      previewPayloadError={previewPayloadError}
      viewSurface={viewSurface}
      documentSnapshot={documentSnapshot}
      content={content}
      setContent={setContent}
      onEditorContentDraftChange={handleEditorContentDraftChange}
      onEditorContentPublished={handleEditorContentPublished}
      onEditorTypingInput={handleEditorTypingInput}
      fileRenderPressure={fileRenderPressure}
      markdownPreviewSnapshotMode={markdownPreviewSnapshotMode}
      markdownPreviewRefreshKey={externalAutoSyncAt}
      markdownPreviewContentOverride={markdownPreviewOverride?.content ?? null}
      markdownRendererProfile={markdownRendererProfile}
      markdownFastFeatureFlags={markdownFastFeatureFlags}
      cmRef={cmRef}
      onActiveFileLineRangeChange={handleEditorLineRangeChange}
      languageExtensions={languageExtensions}
      gitLineMarkers={effectiveGitLineMarkers}
      gitBlameEnabled={gitBlame.enabled}
      gitBlameStatus={gitBlame.status}
      gitBlameResponse={gitBlame.response}
      onFileContextMenu={openFileContextMenu}
      editorCodeAnnotations={editorCodeAnnotations}
      editorAnnotationDraft={editorAnnotationDraft}
      annotationWidgetLabels={annotationWidgetLabels}
      annotationWidgetCallbacks={annotationWidgetCallbacks}
      runDefinitionFromCursor={runDefinitionFromCursor}
      runImplementationsFromCursor={runImplementationsFromCursor}
      runReferencesFromCursor={runReferencesFromCursor}
      resolveDefinitionAtOffset={resolveDefinitionAtOffset}
      onPreviewAnnotationStart={(lineRange) =>
        beginAnnotationDraft(lineRange, "file-preview-mode")
      }
      annotationDraft={effectiveAnnotationDraft}
      codeAnnotations={visibleCodeAnnotations}
      onRemoveCodeAnnotation={onRemoveCodeAnnotation}
      onAnnotationDraftBodyChange={(body) => {
        annotationDraftBodyRef.current = body;
      }}
      onAnnotationDraftCancel={() => {
        annotationDraftBodyRef.current = "";
        setAnnotationDraft(null);
      }}
      onAnnotationDraftConfirm={handleConfirmAnnotationDraft}
      lastReportedLineRangeRef={lastReportedLineRangeRef}
      saveFileShortcut={saveFileShortcut}
      expandSelectionShortcut={expandSelectionShortcut}
      handleSave={handleSave}
      editorTheme={editorTheme}
      previewLanguage={previewLanguage}
      highlightedLines={highlightedLines}
      lines={lines}
      gitAddedLineNumberSet={gitAddedLineNumberSet}
      gitModifiedLineNumberSet={gitModifiedLineNumberSet}
      formatFileSize={formatFileSize}
      t={t}
    />
  );


  const renderNavigationPanel = () => (
    <FileViewNavigationPanel
      workspacePath={workspacePath}
      navigationError={navigationError}
      navigationStatus={navigationStatus}
      onRetryNavigation={retryNavigation}
      definitionCandidates={definitionCandidates}
      onCloseDefinitionCandidates={() => setDefinitionCandidates([])}
      implementationCandidates={implementationCandidates}
      onCloseImplementationCandidates={() => setImplementationCandidates([])}
      referenceResults={referenceResults}
      onCloseReferenceResults={() => setReferenceResults(null)}
      onNavigateToLocation={navigateToLocation}
      t={t}
    />
  );

  return (
    <div
      className={`fvp${usesSingleRowHeader ? " fvp-single-row-header" : ""}`}
      ref={panelRootRef}
    >
      {renderHeader()}
      {tabContextMenu ? (
        <RendererContextMenu
          menu={tabContextMenu}
          onClose={closeTabContextMenu}
          className="renderer-context-menu fvp-tab-context-menu"
        />
      ) : null}
      {fileContextMenu ? (
        <RendererContextMenu
          menu={fileContextMenu}
          onClose={() => setFileContextMenu(null)}
          className="renderer-context-menu fvp-tab-context-menu fvp-file-context-menu"
        />
      ) : null}
      <FileViewExternalChangeOverlays
        externalChangeSyncState={externalChangeSyncState}
        externalPendingRefresh={externalPendingRefresh}
        externalChangeConflict={externalChangeConflict}
        externalCompareOpen={externalCompareOpen}
        handleExternalToggleCompare={handleExternalToggleCompare}
        handleExternalKeepLocal={handleExternalKeepLocal}
        handleExternalApplyPendingRefresh={handleExternalApplyPendingRefresh}
        handleExternalReloadFromDisk={handleExternalReloadFromDisk}
        editorDraftContentRef={editorDraftContentRef}
        t={t}
      />
      <div className="fvp-body" onContextMenu={openFileContextMenu}>
        {renderContent()}
      </div>
      {renderNavigationPanel()}
      <FileViewPanelFooter
        canEditDocument={canEditDocument}
        mode={mode}
        effectiveIsDirty={effectiveIsDirty}
        truncated={truncated}
        navigationStatus={navigationStatus}
        fileReferenceShouldRender={fileReferenceShouldRender}
        fileReferenceVisible={fileReferenceVisible}
        filePath={filePath}
        activeFileLineLabel={activeFileLineLabel}
        viewSurface={viewSurface}
        activeAnnotationLineRange={activeAnnotationLineRange}
        handleStartEditorAnnotation={handleStartEditorAnnotation}
        gitBlameEligible={gitBlameEligible}
        gitBlame={gitBlame}
        gitBlameActionLabel={gitBlameActionLabel}
        handleEnterEdit={handleEnterEdit}
        handleEnterPreview={handleEnterPreview}
        onInsertText={onInsertText}
        content={content}
        skipTextRead={skipTextRead}
        handleOpenFindPanel={handleOpenFindPanel}
        onToggleEditorFileMaximized={onToggleEditorFileMaximized}
        isEditorFileMaximized={isEditorFileMaximized}
        onToggleEditorSplitLayout={onToggleEditorSplitLayout}
        editorSplitLayout={editorSplitLayout}
        absolutePath={absolutePath}
        workspacePath={workspacePath}
        openTargets={openTargets}
        selectedOpenAppId={selectedOpenAppId}
        onSelectOpenAppId={onSelectOpenAppId}
        openAppIconById={openAppIconById}
        t={t}
      />
    </div>
  );
}
