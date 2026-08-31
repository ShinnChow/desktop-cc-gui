import { invoke } from "@tauri-apps/api/core";
import type {
  GitBranchCompareCommitSets,
  GitBranchListResponse,
  GitBranchUpdateResult,
  GitCommitDetails,
  GitCommitDiff,
  GitFileDiff,
  GitFileBlameResponse,
  GitFileStatus,
  GitHistoryResponse,
  GitHubIssuesResponse,
  GitHubPullRequestComment,
  GitHubPullRequestDiff,
  GitHubPullRequestsResponse,
  GitLogResponse,
  GitPrWorkflowDefaults,
  GitPrWorkflowResult,
  GitPushPreviewResponse,
  GitRepositorySummary,
} from "../../types";
import { traceStartupCommand, type StartupWorkspaceScope } from "../../features/startup-orchestration/utils/startupTrace";

function workspaceScope(workspaceId: string): StartupWorkspaceScope {
  return { workspaceId };
}

function traceStartupInvoke<T>(
  commandLabel: string,
  scope: StartupWorkspaceScope,
  run: () => Promise<T>,
) {
  return traceStartupCommand(commandLabel, scope, run);
}

export async function getGitStatus(workspace_id: string, repositoryRoot?: string | null): Promise<{
  isGitRepository?: boolean;
  branchName: string;
  files: GitFileStatus[];
  stagedFiles: GitFileStatus[];
  unstagedFiles: GitFileStatus[];
  totalAdditions: number;
  totalDeletions: number;
}> {
  return traceStartupInvoke("get_git_status", workspaceScope(workspace_id), () =>
    invoke("get_git_status", { workspaceId: workspace_id, repositoryRoot: repositoryRoot ?? null }),
  );
}

export async function listGitRoots(workspace_id: string, depth: number): Promise<string[]> {
  return invoke("list_git_roots", { workspaceId: workspace_id, depth });
}

export async function listGitRepositorySummaries(
  workspaceId: string,
  depth = 2,
): Promise<GitRepositorySummary[]> {
  return invoke<GitRepositorySummary[]>("list_git_repository_summaries", {
    workspaceId,
    depth,
  });
}

export async function getGitDiffs(
  workspace_id: string,
  repositoryRoot?: string | null,
): Promise<GitFileDiff[]> {
  return traceStartupInvoke("get_git_diffs", workspaceScope(workspace_id), () =>
    invoke("get_git_diffs", {
      workspaceId: workspace_id,
      ...(repositoryRoot == null ? {} : { repositoryRoot }),
    }),
  );
}

export async function getGitFileFullDiff(
  workspace_id: string,
  path: string,
  repositoryRoot?: string | null,
): Promise<string> {
  return invoke("get_git_file_full_diff", {
    workspaceId: workspace_id,
    path,
    ...(repositoryRoot == null ? {} : { repositoryRoot }),
  });
}

export async function getGitFileBlame(
  workspaceId: string,
  path: string,
  repositoryRoot?: string | null,
): Promise<GitFileBlameResponse> {
  return invoke("get_git_file_blame", {
    workspaceId,
    path,
    ...(repositoryRoot == null ? {} : { repositoryRoot }),
  });
}

export async function getGitLog(workspace_id: string, limit = 40): Promise<GitLogResponse> {
  return invoke("get_git_log", { workspaceId: workspace_id, limit });
}

export async function getGitCommitHistory(
  workspace_id: string,
  options?: {
    branch?: string | null;
    query?: string | null;
    author?: string | null;
    dateFrom?: number | null;
    dateTo?: number | null;
    snapshotId?: string | null;
    path?: string | null;
    offset?: number;
    limit?: number;
    repositoryRoot?: string | null;
  },
): Promise<GitHistoryResponse> {
  return invoke("get_git_commit_history", {
    workspaceId: workspace_id,
    branch: options?.branch ?? null,
    query: options?.query ?? null,
    author: options?.author ?? null,
    dateFrom: options?.dateFrom ?? null,
    dateTo: options?.dateTo ?? null,
    snapshotId: options?.snapshotId ?? null,
    path: options?.path ?? null,
    offset: options?.offset ?? 0,
    limit: options?.limit ?? 100,
    ...(options?.repositoryRoot == null
      ? {}
      : { repositoryRoot: options.repositoryRoot }),
  });
}

export async function getGitPushPreview(
  workspace_id: string,
  options: {
    remote: string;
    branch: string;
    limit?: number;
    repositoryRoot?: string | null;
  },
): Promise<GitPushPreviewResponse> {
  return invoke("get_git_push_preview", {
    workspaceId: workspace_id,
    remote: options.remote,
    branch: options.branch,
    limit: options.limit ?? 120,
    ...(options.repositoryRoot == null
      ? {}
      : { repositoryRoot: options.repositoryRoot }),
  });
}

export type CreateGitPrWorkflowOptions = {
  upstreamRepo: string;
  baseBranch: string;
  headOwner: string;
  headBranch: string;
  title: string;
  body?: string | null;
  commentAfterCreate?: boolean;
  commentBody?: string | null;
  allowLargeRange?: boolean;
  confirmedRangeFingerprint?: string | null;
};

export async function getGitPrWorkflowDefaults(workspaceId: string): Promise<GitPrWorkflowDefaults> {
  return invoke<GitPrWorkflowDefaults>("get_git_pr_workflow_defaults", {
    workspaceId,
  });
}

export async function createGitPrWorkflow(workspaceId: string, options: CreateGitPrWorkflowOptions): Promise<GitPrWorkflowResult> {
  return invoke<GitPrWorkflowResult>("create_git_pr_workflow", {
    workspaceId,
    upstreamRepo: options.upstreamRepo,
    baseBranch: options.baseBranch,
    headOwner: options.headOwner,
    headBranch: options.headBranch,
    title: options.title,
    body: options.body ?? null,
    commentAfterCreate: options.commentAfterCreate ?? null,
    commentBody: options.commentBody ?? null,
    allowLargeRange: options.allowLargeRange ?? null,
    confirmedRangeFingerprint: options.confirmedRangeFingerprint ?? null,
  });
}



export async function getGitCommitDetails(
  workspace_id: string,
  commitHash: string,
  maxDiffLines = 10_000,
  repositoryRoot?: string | null,
): Promise<GitCommitDetails> {
  return invoke("get_git_commit_details", {
    workspaceId: workspace_id,
    commitHash,
    maxDiffLines,
    ...(repositoryRoot == null ? {} : { repositoryRoot }),
  });
}

export async function getGitCommitDiff(
  workspace_id: string,
  sha: string,
  options?: {
    path?: string | null;
    contextLines?: number;
    repositoryRoot?: string | null;
  },
): Promise<GitCommitDiff[]> {
  return invoke("get_git_commit_diff", {
    workspaceId: workspace_id,
    sha,
    path: options?.path ?? null,
    contextLines: options?.contextLines ?? null,
    ...(options?.repositoryRoot == null
      ? {}
      : { repositoryRoot: options.repositoryRoot }),
  });
}

export async function getGitRemote(workspace_id: string): Promise<string | null> {
  return invoke("get_git_remote", { workspaceId: workspace_id });
}

export async function stageGitFile(workspaceId: string, path: string, repositoryRoot?: string | null) {
  return invoke("stage_git_file", { workspaceId, path, repositoryRoot: repositoryRoot ?? null });
}

export async function stageGitAll(workspaceId: string, repositoryRoot?: string | null): Promise<void> {
  return invoke("stage_git_all", { workspaceId, repositoryRoot: repositoryRoot ?? null });
}

export async function unstageGitFile(workspaceId: string, path: string, repositoryRoot?: string | null) {
  return invoke("unstage_git_file", { workspaceId, path, repositoryRoot: repositoryRoot ?? null });
}

export async function unstageGitAll(workspaceId: string, repositoryRoot?: string | null): Promise<void> {
  return invoke("unstage_git_all", { workspaceId, repositoryRoot: repositoryRoot ?? null });
}

export async function unstageGitPaths(
  workspaceId: string,
  paths: string[],
  repositoryRoot?: string | null,
): Promise<void> {
  return invoke("unstage_git_paths", {
    workspaceId,
    paths,
    repositoryRoot: repositoryRoot ?? null,
  });
}

export async function revertGitFile(workspaceId: string, path: string, repositoryRoot?: string | null) {
  return invoke("revert_git_file", { workspaceId, path, repositoryRoot: repositoryRoot ?? null });
}

export async function revertGitPaths(
  workspaceId: string,
  paths: string[],
  repositoryRoot?: string | null,
): Promise<void> {
  return invoke("revert_git_paths", {
    workspaceId,
    paths,
    repositoryRoot: repositoryRoot ?? null,
  });
}

export async function revertGitAll(workspaceId: string, repositoryRoot?: string | null) {
  return invoke("revert_git_all", { workspaceId, repositoryRoot: repositoryRoot ?? null });
}

export async function commitGit(workspaceId: string, message: string, repositoryRoot?: string | null): Promise<void> {
  return invoke("commit_git", { workspaceId, message, repositoryRoot: repositoryRoot ?? null });
}

export type GitPushOptions = {
  remote?: string | null;
  branch?: string | null;
  forceWithLease?: boolean;
  pushTags?: boolean;
  runHooks?: boolean;
  pushToGerrit?: boolean;
  topic?: string | null;
  reviewers?: string | null;
  cc?: string | null;
};

export type GitPullStrategyOption = "--rebase" | "--ff-only" | "--no-ff" | "--squash";

export type GitPullOptions = {
  remote?: string | null;
  branch?: string | null;
  strategy?: GitPullStrategyOption | null;
  noCommit?: boolean;
  noVerify?: boolean;
};

export async function pushGit(workspaceId: string, options?: GitPushOptions, repositoryRoot?: string | null): Promise<void> {
  return invoke("push_git", {
    workspaceId,
    remote: options?.remote ?? null,
    branch: options?.branch ?? null,
    forceWithLease: options?.forceWithLease ?? null,
    pushTags: options?.pushTags ?? null,
    runHooks: options?.runHooks ?? null,
    pushToGerrit: options?.pushToGerrit ?? null,
    topic: options?.topic ?? null,
    reviewers: options?.reviewers ?? null,
    cc: options?.cc ?? null,
    repositoryRoot: repositoryRoot ?? null,
  });
}

export async function pullGit(workspaceId: string, options?: GitPullOptions, repositoryRoot?: string | null): Promise<void> {
  return invoke("pull_git", {
    workspaceId,
    remote: options?.remote ?? null,
    branch: options?.branch ?? null,
    strategy: options?.strategy ?? null,
    noCommit: options?.noCommit ?? null,
    noVerify: options?.noVerify ?? null,
    repositoryRoot: repositoryRoot ?? null,
  });
}

export async function syncGit(workspaceId: string, repositoryRoot?: string | null): Promise<void> {
  return invoke("sync_git", { workspaceId, repositoryRoot: repositoryRoot ?? null });
}

export async function fetchGit(workspaceId: string, remote?: string | null, repositoryRoot?: string | null): Promise<void> {
  return invoke("git_fetch", { workspaceId, remote: remote ?? null, repositoryRoot: repositoryRoot ?? null });
}

export async function updateGitBranch(
  workspaceId: string,
  branchName: string,
  repositoryRoot?: string | null,
): Promise<GitBranchUpdateResult> {
  return invoke<GitBranchUpdateResult>("update_git_branch", {
    workspaceId,
    branchName,
    repositoryRoot: repositoryRoot ?? null,
  });
}

export async function cherryPickCommit(workspaceId: string, commitHash: string): Promise<void> {
  return invoke("cherry_pick_commit", { workspaceId, commitHash });
}

export async function revertCommit(workspaceId: string, commitHash: string): Promise<void> {
  return invoke("revert_commit", { workspaceId, commitHash });
}

export type GitResetMode = "soft" | "mixed" | "hard" | "keep";

export async function resetGitCommit(workspaceId: string, commitHash: string, mode: GitResetMode): Promise<void> {
  return invoke("reset_git_commit", { workspaceId, commitHash, mode });
}

export async function getGitHubIssues(workspace_id: string): Promise<GitHubIssuesResponse> {
  return invoke("get_github_issues", { workspaceId: workspace_id });
}

export async function getGitHubPullRequests(workspace_id: string): Promise<GitHubPullRequestsResponse> {
  return invoke("get_github_pull_requests", { workspaceId: workspace_id });
}

export async function getGitHubPullRequestDiff(workspace_id: string, prNumber: number): Promise<GitHubPullRequestDiff[]> {
  return invoke("get_github_pull_request_diff", {
    workspaceId: workspace_id,
    prNumber,
  });
}

export async function getGitHubPullRequestComments(workspace_id: string, prNumber: number): Promise<GitHubPullRequestComment[]> {
  return invoke("get_github_pull_request_comments", {
    workspaceId: workspace_id,
    prNumber,
  });
}

export async function listGitBranches(
  workspaceId: string,
  repositoryRoot?: string | null,
): Promise<GitBranchListResponse> {
  return invoke<GitBranchListResponse>("list_git_branches", {
    workspaceId,
    repositoryRoot: repositoryRoot ?? null,
  });
}

export async function checkoutGitBranch(
  workspaceId: string,
  name: string,
  repositoryRoot?: string | null,
) {
  return invoke("checkout_git_branch", {
    workspaceId,
    name,
    repositoryRoot: repositoryRoot ?? null,
  });
}

export async function createGitBranch(
  workspaceId: string,
  name: string,
  repositoryRoot?: string | null,
) {
  return invoke("create_git_branch", {
    workspaceId,
    name,
    repositoryRoot: repositoryRoot ?? null,
  });
}

export async function createGitBranchFromBranch(workspaceId: string, name: string, sourceBranch: string) {
  return invoke("create_git_branch_from_branch", {
    workspaceId,
    name,
    sourceBranch,
  });
}

export async function createGitBranchFromCommit(workspaceId: string, name: string, commitHash: string) {
  return invoke("create_git_branch_from_commit", {
    workspaceId,
    name,
    commitHash,
  });
}

export async function deleteGitBranch(
  workspaceId: string,
  name: string,
  options?: {
    force?: boolean;
    removeOccupiedWorktree?: boolean;
  },
) {
  return invoke("delete_git_branch", {
    workspaceId,
    name,
    force: options?.force ?? false,
    removeOccupiedWorktree: options?.removeOccupiedWorktree ?? false,
  });
}

export async function renameGitBranch(workspaceId: string, oldName: string, newName: string) {
  return invoke("rename_git_branch", { workspaceId, oldName, newName });
}

export async function mergeGitBranch(workspaceId: string, name: string) {
  return invoke("merge_git_branch", { workspaceId, name });
}

export async function rebaseGitBranch(workspaceId: string, ontoBranch: string) {
  return invoke("rebase_git_branch", { workspaceId, ontoBranch });
}

export async function getGitBranchCompareCommits(workspaceId: string, targetBranch: string, currentBranch: string, limit = 200): Promise<GitBranchCompareCommitSets> {
  return invoke<GitBranchCompareCommitSets>("get_git_branch_compare_commits", {
    workspaceId,
    targetBranch,
    currentBranch,
    limit,
  });
}





export async function getGitWorktreeDiffAgainstBranch(workspaceId: string, branch: string): Promise<GitCommitDiff[]> {
  return invoke<GitCommitDiff[]>("get_git_worktree_diff_against_branch", {
    workspaceId,
    branch,
  });
}

export async function getGitWorktreeDiffFileAgainstBranch(workspaceId: string, branch: string, path: string): Promise<GitCommitDiff> {
  return invoke<GitCommitDiff>("get_git_worktree_file_diff_against_branch", {
    workspaceId,
    branch,
    path,
  });
}
