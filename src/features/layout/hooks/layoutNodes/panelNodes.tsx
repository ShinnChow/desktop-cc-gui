import { lazy, Suspense, type ReactNode } from "react";
import { GitDiffViewer } from "../../../git/components/GitDiffViewer";
import { WorkspaceNoteCardPanel } from "../../../note-cards/components/WorkspaceNoteCardPanel";
import { WorkspaceFileComparePanel } from "../../../files/components/WorkspaceFileComparePanel";
import type { FileRenderPressure } from "../../../files/types/fileRenderPressure";
import type {
  NoteCaptureDraft,
  WorkspaceNoteCaptureRequest,
} from "../../../note-cards/types";
import type {
  WorkspaceNoteCard,
  WorkspaceNoteCardSource,
} from "../../../../services/tauri";
import type { IntentCanvasCodeSelectionAnchor } from "../../../intent-canvas/types";
import type { ProjectMapImpactInput } from "../../../project-map/utils/impactSources";
import type { EditorNavigationLocation } from "../../../app/hooks/useGitPanelController";
import type {
  CodeAnnotationDraftInput,
  CodeAnnotationSelection,
} from "../../../code-annotations/types";
import type { LayoutNodesFlatOptions } from "../layoutNodesTypes";

const FileViewPanel = lazy(() =>
  import("../../../files/components/FileViewPanel").then((m) => ({
    default: m.FileViewPanel,
  })),
);
const ProjectMapPanel = lazy(() =>
  import("../../../project-map/components/ProjectMapPanel").then((m) => ({
    default: m.ProjectMapPanel,
  })),
);
const IntentCanvasManager = lazy(() =>
  import("../../../intent-canvas/components/IntentCanvasManager").then((m) => ({
    default: m.IntentCanvasManager,
  })),
);

export function HeavyPanelFallback() {
  return <div className="heavy-panel-fallback" aria-hidden="true" />;
}

export type BuildGitDiffViewerNodeInput = {
  options: LayoutNodesFlatOptions;
  handleCreateCodeAnnotation: (annotation: CodeAnnotationDraftInput) => void;
  handleRemoveCodeAnnotation: (annotationId: string) => void;
  selectedCodeAnnotations: CodeAnnotationSelection[];
};

export function buildGitDiffViewerNode({
  options,
  handleCreateCodeAnnotation,
  handleRemoveCodeAnnotation,
  selectedCodeAnnotations,
}: BuildGitDiffViewerNodeInput): ReactNode {
  return (
    <GitDiffViewer
      workspaceId={options.activeWorkspace?.id ?? null}
      diffs={options.gitDiffs}
      listView={options.gitDiffListView}
      selectedPath={options.selectedDiffPath}
      scrollRequestId={options.diffScrollRequestId}
      isLoading={options.gitDiffLoading}
      error={options.gitDiffError}
      diffStyle={options.gitDiffViewStyle}
      alignedTextPreview
      onDiffStyleChange={options.onGitDiffViewStyleChange}
      pullRequest={options.selectedPullRequest}
      pullRequestComments={options.selectedPullRequestComments}
      pullRequestCommentsLoading={options.selectedPullRequestCommentsLoading}
      pullRequestCommentsError={options.selectedPullRequestCommentsError}
      onActivePathChange={options.onDiffActivePathChange}
      onOpenFile={options.onOpenFile}
      onRequestClose={options.onExitDiff}
      onCreateCodeAnnotation={handleCreateCodeAnnotation}
      onRemoveCodeAnnotation={handleRemoveCodeAnnotation}
      codeAnnotations={selectedCodeAnnotations}
      codeAnnotationSurface="embedded-diff-view"
    />
  );
}

export type BuildFileViewPanelNodeInput = {
  options: LayoutNodesFlatOptions;
  activeWorkspaceCustomSpecRoot: string | null;
  handleAssociateIntentCanvasCodeAnchor: (anchor: IntentCanvasCodeSelectionAnchor) => Promise<void>;
  handleRevealInFileTree: (path: string) => void;
  handleCreateCodeAnnotation: (annotation: CodeAnnotationDraftInput) => void;
  handleCaptureWorkspaceNote: (draft: NoteCaptureDraft) => void;
  handleRemoveCodeAnnotation: (annotationId: string) => void;
  selectedCodeAnnotations: CodeAnnotationSelection[];
  fileRenderPressure: FileRenderPressure;
};

export function buildFileViewPanelNode({
  options,
  activeWorkspaceCustomSpecRoot,
  handleAssociateIntentCanvasCodeAnchor,
  handleRevealInFileTree,
  handleCreateCodeAnnotation,
  handleCaptureWorkspaceNote,
  handleRemoveCodeAnnotation,
  selectedCodeAnnotations,
  fileRenderPressure,
}: BuildFileViewPanelNodeInput): ReactNode {
  return options.editorFilePath && options.activeWorkspace ? (
    <Suspense fallback={<HeavyPanelFallback />}>
      <FileViewPanel
        workspaceId={options.activeWorkspace.id}
        workspaceName={options.activeWorkspace.name}
        workspacePath={options.activeWorkspace.path}
        gitRoot={options.gitRoot}
        gitRepositories={options.gitRepositories}
        customSpecRoot={activeWorkspaceCustomSpecRoot}
        filePath={options.editorFilePath}
        navigationTarget={options.editorNavigationTarget}
        highlightMarkers={
          options.editorHighlightTarget?.path === options.editorFilePath
            ? options.editorHighlightTarget.markers
            : null
        }
        gitStatusFiles={options.gitStatus.files}
        openTabs={options.openEditorTabs}
        activeTabPath={options.editorFilePath}
        onActivateTab={options.onActivateEditorTab}
        onCloseTab={options.onCloseEditorTab}
        onCloseOtherTabs={options.onCloseOtherEditorTabs}
        onCloseAllTabs={options.onCloseAllEditorTabs}
        onReorderTabs={options.onReorderEditorTabs}
        fileReferenceMode={options.fileReferenceMode}
        onFileReferenceModeChange={options.onFileReferenceModeChange}
        activeFileLineRange={options.activeComposerFileLineRange}
        onActiveFileLineRangeChange={options.onActiveEditorLineRangeChange}
        onActiveCodeAnchorChange={options.onActiveCodeSelectionAnchorChange}
        onAssociateIntentCanvasCodeAnchor={
          handleAssociateIntentCanvasCodeAnchor
        }
        openTargets={options.openAppTargets}
        openAppIconById={options.openAppIconById}
        selectedOpenAppId={options.selectedOpenAppId}
        onSelectOpenAppId={options.onSelectOpenAppId}
        editorSplitLayout={options.editorSplitLayout}
        onToggleEditorSplitLayout={options.onToggleEditorSplitLayout}
        isEditorFileMaximized={options.isEditorFileMaximized}
        onToggleEditorFileMaximized={options.onToggleEditorFileMaximized}
        onNavigateToLocation={options.onOpenFile}
        onOpenFileHistory={options.onOpenFileHistory}
        onRevealInFileTree={handleRevealInFileTree}
        onClose={options.onExitEditor}
        onInsertText={options.onInsertComposerText}
        onCreateCodeAnnotation={handleCreateCodeAnnotation}
        onCaptureNote={handleCaptureWorkspaceNote}
        onRemoveCodeAnnotation={handleRemoveCodeAnnotation}
        codeAnnotations={selectedCodeAnnotations}
        externalChangeMonitoringEnabled={
          options.externalChangeMonitoringEnabled
        }
        externalChangeTransportMode={options.externalChangeTransportMode}
        externalChangeApplyMode={options.externalChangeApplyMode}
        externalChangeAutoApplyDebounceMs={
          options.externalChangeAutoApplyDebounceMs
        }
        markdownPreviewSnapshotMode={
          options.liveEditPreviewEnabled ? "live" : "stable"
        }
        fileRenderPressure={fileRenderPressure}
        saveFileShortcut={options.saveFileShortcut}
        findInFileShortcut={options.findInFileShortcut}
        expandSelectionShortcut={options.expandSelectionShortcut}
      />
    </Suspense>
  ) : null;
}

export type BuildNoteCardsPanelNodeInput = {
  options: LayoutNodesFlatOptions;
  isWorkspaceNoteCardsMounted: boolean;
  workspaceNoteCaptureRequest: WorkspaceNoteCaptureRequest | null;
  handleWorkspaceNoteCaptureRequestHandled: (requestId: number) => void;
  handleReferenceWorkspaceNote: (note: WorkspaceNoteCard) => void;
  handleOpenWorkspaceNoteCodeSource: (source: Extract<WorkspaceNoteCardSource, { kind: "codeSelection" }>) => void;
};

export function buildNoteCardsPanelNode({
  options,
  isWorkspaceNoteCardsMounted,
  workspaceNoteCaptureRequest,
  handleWorkspaceNoteCaptureRequestHandled,
  handleReferenceWorkspaceNote,
  handleOpenWorkspaceNoteCodeSource,
}: BuildNoteCardsPanelNodeInput): ReactNode {
  return isWorkspaceNoteCardsMounted ? (
      <WorkspaceNoteCardPanel
        workspaceId={options.activeWorkspace?.id ?? null}
        workspaceName={options.activeWorkspace?.name ?? null}
        workspacePath={options.activeWorkspace?.path ?? null}
        focusNoteId={options.focusedWorkspaceNoteId ?? null}
        focusRequestKey={options.focusedWorkspaceNoteRequestKey ?? 0}
        captureRequest={workspaceNoteCaptureRequest}
        onCaptureRequestHandled={handleWorkspaceNoteCaptureRequestHandled}
        onReferenceNote={handleReferenceWorkspaceNote}
        onOpenCodeSource={handleOpenWorkspaceNoteCodeSource}
      />
  ) : null;
}

export type BuildFileComparePanelNodeInput = {
  options: LayoutNodesFlatOptions;
};

export function buildFileComparePanelNode({
  options,
}: BuildFileComparePanelNodeInput): ReactNode {
  return options.centerMode === "fileCompare" ? (
      <WorkspaceFileComparePanel
        session={options.fileCompareSession}
        workspaceId={options.activeWorkspace?.id ?? null}
        workspaceName={options.activeWorkspace?.name ?? null}
        workspacePath={options.activeWorkspace?.path ?? null}
        saveFileShortcut={options.saveFileShortcut}
        onClose={options.onCloseFileCompare}
      />
  ) : null;
}

export type BuildProjectMapPanelNodeInput = {
  options: LayoutNodesFlatOptions;
  isProjectMapSurfaceActive: boolean;
  projectMapImpactInput: ProjectMapImpactInput;
  handleOpenProjectMapEvidenceFile: (path: string, location?: EditorNavigationLocation) => void;
};

export function buildProjectMapPanelNode({
  options,
  isProjectMapSurfaceActive,
  projectMapImpactInput,
  handleOpenProjectMapEvidenceFile,
}: BuildProjectMapPanelNodeInput): ReactNode {
  return isProjectMapSurfaceActive ? (
      <Suspense fallback={<HeavyPanelFallback />}>
        <ProjectMapPanel
          key={options.activeWorkspace?.id ?? "no-workspace"}
          activeWorkspace={options.activeWorkspace ?? null}
          workspaceName={options.activeWorkspace?.name ?? null}
          selectedEngine={options.selectedEngine ?? null}
          selectedModelId={options.selectedModelId}
          models={options.models}
          datasetController={options.projectMapDatasetController}
          changedFilePaths={projectMapImpactInput.filePaths}
          changedFileSource={projectMapImpactInput.source}
          activeCodeSelectionAnchor={options.activeCodeSelectionAnchor}
          onOpenEvidenceFile={handleOpenProjectMapEvidenceFile}
          onOpenIntentCanvas={options.onOpenIntentCanvas}
          onOpenIntentCanvasFromRelationship={options.onOpenIntentCanvas}
        />
      </Suspense>
  ) : null;
}

export type BuildIntentCanvasPanelNodeInput = {
  options: LayoutNodesFlatOptions;
  isIntentCanvasSurfaceActive: boolean;
  handleOpenProjectMapEvidenceFile: (path: string, location?: EditorNavigationLocation) => void;
};

export function buildIntentCanvasPanelNode({
  options,
  isIntentCanvasSurfaceActive,
  handleOpenProjectMapEvidenceFile,
}: BuildIntentCanvasPanelNodeInput): ReactNode {
  return isIntentCanvasSurfaceActive ? (
      <Suspense fallback={<HeavyPanelFallback />}>
        <IntentCanvasManager
          activeWorkspace={options.activeWorkspace ?? null}
          activeThreadId={options.activeThreadId ?? null}
          openRequest={options.intentCanvasOpenRequest ?? null}
          onOpenRequestConsumed={options.onIntentCanvasOpenRequestConsumed}
          onAttachToThread={options.onAttachIntentCanvasToThread}
          onOpenProjectMap={options.onOpenProjectMap}
          onOpenSourceFile={handleOpenProjectMapEvidenceFile}
        />
      </Suspense>
  ) : null;
}
