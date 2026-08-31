import { lazy, Suspense, type ReactNode } from "react";
import type { TFunction } from "i18next";
import {
  FileTreePanel,
  type FileTreeRevealRequest,
} from "../../../files/components/FileTreePanel";
import { WorkspaceSearchPanel } from "../../../search/components/WorkspaceSearchPanel";
import { PromptPanel } from "../../../prompts/components/PromptPanel";
import { ProjectMemoryPanel } from "../../../project-memory/components/ProjectMemoryPanel";
import { WorkspaceSessionRadarPanel } from "../../../session-activity/components/WorkspaceSessionRadarPanel";
import type { GitRepositoryActionRequest } from "../../../git/types/gitRepositoryActions";
import type { GitModalPreviewRequest } from "../../../git/components/GitDiffPanelTypes";
import type { buildCanonicalGitChanges } from "../../../git/utils/gitChangeModel";
import type {
  CodeAnnotationDraftInput,
  CodeAnnotationSelection,
} from "../../../code-annotations/types";
import { HeavyPanelFallback } from "./panelNodes";
import type { LayoutNodesFlatOptions } from "../layoutNodesTypes";

const GitDiffPanel = lazy(() =>
  import("../../../git/components/GitDiffPanel").then((m) => ({
    default: m.GitDiffPanel,
  })),
);

export type BuildGitDiffPanelNodeInput = {
  options: LayoutNodesFlatOptions;
  handleFileTreeGitRepositoryAction: (request: GitRepositoryActionRequest) => Promise<void>;
  fileTreeRevealRequest: FileTreeRevealRequest | null;
  gitModeControlsTarget: HTMLDivElement | null;
  t: TFunction;
  canonicalGitPanelTotals: { additions: number; deletions: number };
  canonicalGitPanelChanges: ReturnType<typeof buildCanonicalGitChanges>;
  gitModalPreviewRequest: GitModalPreviewRequest | null;
  sidebarSelectedDiffPath: string | null;
  handleCreateCodeAnnotation: (annotation: CodeAnnotationDraftInput) => void;
  handleRemoveCodeAnnotation: (annotationId: string) => void;
  selectedCodeAnnotations: CodeAnnotationSelection[];
};

export function buildGitDiffPanelNode({
  options,
  handleFileTreeGitRepositoryAction,
  fileTreeRevealRequest,
  gitModeControlsTarget,
  t,
  canonicalGitPanelTotals,
  canonicalGitPanelChanges,
  gitModalPreviewRequest,
  sidebarSelectedDiffPath,
  handleCreateCodeAnnotation,
  handleRemoveCodeAnnotation,
  selectedCodeAnnotations,
}: BuildGitDiffPanelNodeInput): ReactNode {
  if (
    (options.filePanelMode === "files" ||
      options.filePanelMode === "notes" ||
      // DISABLED activity: treat residual mode as files until normalize runs
      options.filePanelMode === "activity") &&
    options.activeWorkspace
  ) {
    return (
      <FileTreePanel
        workspaceId={options.activeWorkspace.id}
        workspaceName={options.activeWorkspace.name}
        workspacePath={options.activeWorkspace.path}
        gitRoot={options.gitRoot}
        files={options.files}
        directories={options.directories}
        directoryMetadata={options.directoryMetadata}
        sourceVersion={options.fileTreeSourceVersion}
        isLoading={options.fileTreeLoading}
        loadError={options.fileTreeLoadError}
        filePanelMode="files"
        onFilePanelModeChange={options.onFilePanelModeChange}
        onInsertText={options.onInsertComposerText}
        onOpenFile={options.onOpenFile}
        onCompareFiles={options.onCompareFiles}
        openTargets={options.openAppTargets}
        openAppIconById={options.openAppIconById}
        selectedOpenAppId={options.selectedOpenAppId}
        onSelectOpenAppId={options.onSelectOpenAppId}
        onToggleRuntimeConsole={options.onToggleRuntimeConsole}
        isRuntimeConsoleVisible={options.runtimeConsoleVisible}
        showSpecHubAction={false}
        showDetachedExplorerAction={false}
        gitStatusFiles={options.gitStatus.files}
        gitRepositories={options.gitRepositories}
        onGitRepositoryAction={handleFileTreeGitRepositoryAction}
        onOpenFileHistory={options.onOpenFileHistory}
        gitignoredFiles={options.gitignoredFiles}
        gitignoredDirectories={options.gitignoredDirectories}
        onRefreshFiles={options.onRefreshFiles}
        revealRequest={fileTreeRevealRequest}
      />
    );
  }
  if (options.filePanelMode === "search") {
    return (
      <WorkspaceSearchPanel
        workspaceId={options.activeWorkspace?.id ?? null}
        filePanelMode={options.filePanelMode}
        onFilePanelModeChange={options.onFilePanelModeChange}
        onOpenFile={options.onOpenFile}
      />
    );
  }
  if (options.filePanelMode === "prompts") {
    return (
      <PromptPanel
        prompts={options.prompts}
        workspacePath={options.activeWorkspace?.path ?? null}
        filePanelMode={options.filePanelMode}
        onFilePanelModeChange={options.onFilePanelModeChange}
        onSendPrompt={options.onSendPrompt}
        onSendPromptToNewAgent={options.onSendPromptToNewAgent}
        onCreatePrompt={options.onCreatePrompt}
        onUpdatePrompt={options.onUpdatePrompt}
        onDeletePrompt={options.onDeletePrompt}
        onMovePrompt={options.onMovePrompt}
        onRevealWorkspacePrompts={options.onRevealWorkspacePrompts}
        onRevealGeneralPrompts={options.onRevealGeneralPrompts}
        canRevealGeneralPrompts={options.canRevealGeneralPrompts}
      />
    );
  }
  if (options.filePanelMode === "memory") {
    return (
      <ProjectMemoryPanel
        workspaceId={options.activeWorkspace?.id ?? null}
        workspaces={options.workspaces}
        onSelectWorkspace={options.onSelectWorkspace}
        filePanelMode={options.filePanelMode}
        onFilePanelModeChange={options.onFilePanelModeChange}
        focusMemoryId={options.focusedProjectMemoryId ?? null}
        focusRequestKey={options.focusedProjectMemoryRequestKey ?? 0}
      />
    );
  }
  if (options.filePanelMode === "radar") {
    return (
      <WorkspaceSessionRadarPanel
        runningSessions={options.sessionRadarRunningSessions}
        recentCompletedSessions={options.sessionRadarRecentCompletedSessions}
        onSelectThread={options.onSelectThread}
      />
    );
  }
  return (
    <Suspense fallback={<HeavyPanelFallback />}>
      <GitDiffPanel
        workspaceId={options.activeWorkspace?.id ?? null}
        workspacePath={options.activeWorkspace?.path ?? null}
        headerControlsTarget={gitModeControlsTarget}
        mode={options.gitPanelMode}
        onModeChange={options.onGitPanelModeChange}
        onOpenGitHistoryPanel={options.onOpenGitHistoryPanel}
        isGitHistoryOpen={options.appMode === "gitHistory"}
        diffEntries={options.gitDiffs}
        gitDiffListView={options.gitDiffListView}
        onGitDiffListViewChange={options.onGitDiffListViewChange}
        toggleGitDiffListViewShortcut={options.toggleGitDiffListViewShortcut}
        filePanelMode={options.filePanelMode}
        onFilePanelModeChange={options.onFilePanelModeChange}
        worktreeApplyLabel={options.worktreeApplyLabel}
        worktreeApplyTitle={options.worktreeApplyTitle}
        worktreeApplyLoading={options.worktreeApplyLoading}
        worktreeApplyError={options.worktreeApplyError}
        worktreeApplySuccess={options.worktreeApplySuccess}
        onApplyWorktreeChanges={options.onApplyWorktreeChanges}
        branchName={
          options.gitStatus.branchName || t("workspace.unknownBranch")
        }
        totalAdditions={canonicalGitPanelTotals.additions}
        totalDeletions={canonicalGitPanelTotals.deletions}
        fileStatus={options.fileStatus}
        diffViewStyle={options.gitDiffViewStyle}
        onDiffViewStyleChange={options.onGitDiffViewStyleChange}
        error={options.gitStatus.error}
        logError={options.gitLogError}
        logLoading={options.gitLogLoading}
        stagedFiles={canonicalGitPanelChanges.stagedFiles}
        unstagedFiles={canonicalGitPanelChanges.unstagedFiles}
        onSelectFile={options.onSelectDiff}
        onOpenFile={(path, repositoryRoot) =>
          options.onOpenFile(path, undefined, {
            pathDomain: "git",
            repositoryRoot,
          })
        }
        onOpenFileHistory={options.onOpenFileHistory}
        modalPreviewRequest={gitModalPreviewRequest}
        selectedPath={sidebarSelectedDiffPath}
        logEntries={options.gitLogEntries}
        logTotal={options.gitLogTotal}
        logAhead={options.gitLogAhead}
        logBehind={options.gitLogBehind}
        logAheadEntries={options.gitLogAheadEntries}
        logBehindEntries={options.gitLogBehindEntries}
        logUpstream={options.gitLogUpstream}
        selectedCommitSha={options.selectedCommitSha}
        onSelectCommit={options.onSelectCommit}
        issues={options.gitIssues}
        issuesTotal={options.gitIssuesTotal}
        issuesLoading={options.gitIssuesLoading}
        issuesError={options.gitIssuesError}
        pullRequests={options.gitPullRequests}
        pullRequestsTotal={options.gitPullRequestsTotal}
        pullRequestsLoading={options.gitPullRequestsLoading}
        pullRequestsError={options.gitPullRequestsError}
        selectedPullRequest={options.selectedPullRequestNumber}
        onSelectPullRequest={options.onSelectPullRequest}
        gitRemoteUrl={options.gitRemoteUrl}
        gitRoot={options.gitRoot}
        gitRootCandidates={options.gitRootCandidates}
        gitRootScanDepth={options.gitRootScanDepth}
        gitRootScanLoading={options.gitRootScanLoading}
        gitRootScanError={options.gitRootScanError}
        gitRootScanHasScanned={options.gitRootScanHasScanned}
        onGitRootScanDepthChange={options.onGitRootScanDepthChange}
        onScanGitRoots={options.onScanGitRoots}
        onSelectGitRoot={options.onSelectGitRoot}
        onClearGitRoot={options.onClearGitRoot}
        onPickGitRoot={options.onPickGitRoot}
        onStageAllChanges={options.onStageGitAll}
        onStageFile={options.onStageGitFile}
        onUnstageAllChanges={options.onUnstageGitAll}
        onUnstageFile={options.onUnstageGitFile}
        onUnstageFiles={options.onUnstageGitPaths}
        onRevertFile={options.onRevertGitFile}
        onRevertFiles={options.onRevertGitPaths}
        onRevertAllChanges={options.onRevertAllGitChanges}
        commitMessage={options.commitMessage}
        commitMessageLoading={options.commitMessageLoading}
        commitMessageError={options.commitMessageError}
        onCommitMessageChange={options.onCommitMessageChange}
        onGenerateCommitMessage={options.onGenerateCommitMessage}
        onCommit={options.onCommit}
        onCommitAndPush={options.onCommitAndPush}
        onCommitAndSync={options.onCommitAndSync}
        onPush={options.onPush}
        onSync={options.onSync}
        commitLoading={options.commitLoading}
        pushLoading={options.pushLoading}
        syncLoading={options.syncLoading}
        commitError={options.commitError}
        pushError={options.pushError}
        syncError={options.syncError}
        commitsAhead={options.commitsAhead}
        multiRepositoryMode={options.multiRepositoryMode}
        repositoryStatuses={options.repositoryStatuses}
        repositoryStatusesLoading={options.repositoryStatusesLoading}
        onRefreshRepositoryStatuses={options.onRefreshRepositoryStatuses}
        onStageRepositoryFile={options.onStageRepositoryFile}
        onUnstageRepositoryFile={options.onUnstageRepositoryFile}
        onUnstageRepositoryAll={options.onUnstageRepositoryAll}
        onUnstageRepositoryFiles={options.onUnstageRepositoryFiles}
        onRevertRepositoryFile={options.onRevertRepositoryFile}
        onRevertRepositoryFiles={options.onRevertRepositoryFiles}
        onStageRepositoryAll={options.onStageRepositoryAll}
        onCommitRepositories={options.onCommitRepositories}
        repositoryCommitSummary={options.repositoryCommitSummary}
        onRefreshGitStatus={options.queueGitStatusRefresh}
        onRefreshGitLog={options.refreshGitLog}
        onRefreshGitDiffs={options.refreshGitDiffs}
        onCreateCodeAnnotation={handleCreateCodeAnnotation}
        onRemoveCodeAnnotation={handleRemoveCodeAnnotation}
        codeAnnotations={selectedCodeAnnotations}
      />
    </Suspense>
  );

}
