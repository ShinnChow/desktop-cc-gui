use serde::{Deserialize, Serialize};
use crate::backend_budget::PayloadBudgetMetadata;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitFileStatus {
    pub(crate) path: String,
    #[serde(default, rename = "oldPath", skip_serializing_if = "Option::is_none")]
    pub(crate) old_path: Option<String>,
    pub(crate) status: String,
    pub(crate) additions: i64,
    pub(crate) deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitFileDiff {
    pub(crate) path: String,
    pub(crate) diff: String,
    #[serde(default, rename = "isBinary")]
    pub(crate) is_binary: bool,
    #[serde(default, rename = "isImage")]
    pub(crate) is_image: bool,
    #[serde(rename = "oldImageData")]
    pub(crate) old_image_data: Option<String>,
    #[serde(rename = "newImageData")]
    pub(crate) new_image_data: Option<String>,
    #[serde(rename = "oldImageMime")]
    pub(crate) old_image_mime: Option<String>,
    #[serde(rename = "newImageMime")]
    pub(crate) new_image_mime: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitBlameHunk {
    pub(crate) start_line: usize,
    pub(crate) line_count: usize,
    pub(crate) commit_sha: String,
    pub(crate) author: String,
    pub(crate) authored_at: i64,
    pub(crate) summary: String,
    pub(crate) original_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitFileBlameResponse {
    pub(crate) path: String,
    pub(crate) head_sha: String,
    pub(crate) line_count: usize,
    pub(crate) hunks: Vec<GitBlameHunk>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitCommitDiff {
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) diff: String,
    #[serde(default, rename = "isBinary")]
    pub(crate) is_binary: bool,
    #[serde(default, rename = "isImage")]
    pub(crate) is_image: bool,
    #[serde(rename = "oldImageData")]
    pub(crate) old_image_data: Option<String>,
    #[serde(rename = "newImageData")]
    pub(crate) new_image_data: Option<String>,
    #[serde(rename = "oldImageMime")]
    pub(crate) old_image_mime: Option<String>,
    #[serde(rename = "newImageMime")]
    pub(crate) new_image_mime: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitLogEntry {
    pub(crate) sha: String,
    pub(crate) summary: String,
    pub(crate) author: String,
    pub(crate) timestamp: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitLogResponse {
    pub(crate) total: usize,
    pub(crate) entries: Vec<GitLogEntry>,
    #[serde(default)]
    pub(crate) ahead: usize,
    #[serde(default)]
    pub(crate) behind: usize,
    #[serde(default, rename = "aheadEntries")]
    pub(crate) ahead_entries: Vec<GitLogEntry>,
    #[serde(default, rename = "behindEntries")]
    pub(crate) behind_entries: Vec<GitLogEntry>,
    #[serde(default)]
    pub(crate) upstream: Option<String>,
    #[serde(
        default,
        rename = "payloadBudget",
        skip_serializing_if = "Option::is_none"
    )]
    pub(crate) payload_budget: Option<PayloadBudgetMetadata>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHistoryCommit {
    pub(crate) sha: String,
    #[serde(rename = "shortSha")]
    pub(crate) short_sha: String,
    pub(crate) summary: String,
    pub(crate) message: String,
    pub(crate) author: String,
    #[serde(rename = "authorEmail")]
    pub(crate) author_email: String,
    pub(crate) timestamp: i64,
    pub(crate) parents: Vec<String>,
    #[serde(default)]
    pub(crate) refs: Vec<String>,
    #[serde(default, rename = "filePath", skip_serializing_if = "Option::is_none")]
    pub(crate) file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHistoryResponse {
    #[serde(rename = "snapshotId")]
    pub(crate) snapshot_id: String,
    pub(crate) total: usize,
    pub(crate) offset: usize,
    pub(crate) limit: usize,
    #[serde(rename = "hasMore")]
    pub(crate) has_more: bool,
    pub(crate) commits: Vec<GitHistoryCommit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitPushPreviewResponse {
    #[serde(rename = "sourceBranch")]
    pub(crate) source_branch: String,
    #[serde(rename = "targetRemote")]
    pub(crate) target_remote: String,
    #[serde(rename = "targetBranch")]
    pub(crate) target_branch: String,
    #[serde(rename = "targetRef")]
    pub(crate) target_ref: String,
    #[serde(rename = "targetFound")]
    pub(crate) target_found: bool,
    #[serde(rename = "hasMore")]
    pub(crate) has_more: bool,
    pub(crate) commits: Vec<GitHistoryCommit>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitBranchCompareCommitSets {
    #[serde(rename = "targetOnlyCommits")]
    pub(crate) target_only_commits: Vec<GitHistoryCommit>,
    #[serde(rename = "currentOnlyCommits")]
    pub(crate) current_only_commits: Vec<GitHistoryCommit>,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
pub(crate) struct PullRequestGeneratedContent {
    #[serde(default)]
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) body: String,
    #[serde(default)]
    pub(crate) engine: String,
    #[serde(default)]
    pub(crate) language: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitPrWorkflowDefaults {
    #[serde(rename = "upstreamRepo")]
    pub(crate) upstream_repo: String,
    #[serde(rename = "baseBranch")]
    pub(crate) base_branch: String,
    #[serde(rename = "headOwner")]
    pub(crate) head_owner: String,
    #[serde(rename = "headBranch")]
    pub(crate) head_branch: String,
    pub(crate) title: String,
    pub(crate) body: String,
    #[serde(rename = "commentBody")]
    pub(crate) comment_body: String,
    #[serde(rename = "canCreate")]
    pub(crate) can_create: bool,
    #[serde(rename = "disabledReason")]
    pub(crate) disabled_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitPrWorkflowStage {
    pub(crate) key: String,
    pub(crate) status: String,
    pub(crate) detail: String,
    pub(crate) command: Option<String>,
    pub(crate) stdout: Option<String>,
    pub(crate) stderr: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitPrExistingPullRequest {
    pub(crate) number: u64,
    pub(crate) title: String,
    pub(crate) url: String,
    pub(crate) state: String,
    #[serde(rename = "headRefName")]
    pub(crate) head_ref_name: String,
    #[serde(rename = "baseRefName")]
    pub(crate) base_ref_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum GitPrRangeGateSeverity {
    Large,
    DiffIncomplete,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub(crate) struct GitPrRangeGate {
    #[serde(rename = "changedFiles")]
    pub(crate) changed_files: usize,
    pub(crate) threshold: usize,
    pub(crate) severity: GitPrRangeGateSeverity,
    #[serde(rename = "requiresConfirmation")]
    pub(crate) requires_confirmation: bool,
    #[serde(rename = "rangeFingerprint")]
    pub(crate) range_fingerprint: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitPrWorkflowResult {
    pub(crate) ok: bool,
    pub(crate) status: String,
    pub(crate) message: String,
    #[serde(rename = "errorCategory")]
    pub(crate) error_category: Option<String>,
    #[serde(rename = "nextActionHint")]
    pub(crate) next_action_hint: Option<String>,
    #[serde(rename = "prUrl")]
    pub(crate) pr_url: Option<String>,
    #[serde(rename = "prNumber")]
    pub(crate) pr_number: Option<u64>,
    #[serde(rename = "existingPr")]
    pub(crate) existing_pr: Option<GitPrExistingPullRequest>,
    #[serde(rename = "retryCommand")]
    pub(crate) retry_command: Option<String>,
    #[serde(rename = "rangeGate")]
    pub(crate) range_gate: Option<GitPrRangeGate>,
    pub(crate) stages: Vec<GitPrWorkflowStage>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitCommitFileChange {
    pub(crate) path: String,
    #[serde(rename = "oldPath")]
    pub(crate) old_path: Option<String>,
    pub(crate) status: String,
    pub(crate) additions: i64,
    pub(crate) deletions: i64,
    #[serde(default, rename = "isBinary")]
    pub(crate) is_binary: bool,
    #[serde(default, rename = "isImage")]
    pub(crate) is_image: bool,
    pub(crate) diff: String,
    #[serde(rename = "lineCount")]
    pub(crate) line_count: usize,
    pub(crate) truncated: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitCommitDetails {
    pub(crate) sha: String,
    pub(crate) summary: String,
    pub(crate) message: String,
    pub(crate) author: String,
    #[serde(rename = "authorEmail")]
    pub(crate) author_email: String,
    pub(crate) committer: String,
    #[serde(rename = "committerEmail")]
    pub(crate) committer_email: String,
    #[serde(rename = "authorTime")]
    pub(crate) author_time: i64,
    #[serde(rename = "commitTime")]
    pub(crate) commit_time: i64,
    pub(crate) parents: Vec<String>,
    pub(crate) files: Vec<GitCommitFileChange>,
    #[serde(rename = "totalAdditions")]
    pub(crate) total_additions: i64,
    #[serde(rename = "totalDeletions")]
    pub(crate) total_deletions: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitBranchListItem {
    pub(crate) name: String,
    #[serde(rename = "isCurrent")]
    pub(crate) is_current: bool,
    #[serde(rename = "isRemote")]
    pub(crate) is_remote: bool,
    pub(crate) remote: Option<String>,
    #[serde(rename = "lastCommit")]
    pub(crate) last_commit: i64,
    #[serde(default, rename = "headSha")]
    pub(crate) head_sha: Option<String>,
    pub(crate) ahead: usize,
    pub(crate) behind: usize,
    #[serde(default)]
    pub(crate) upstream: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRepositoryFileStatus {
    pub(crate) path: String,
    pub(crate) status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitRepositorySummary {
    pub(crate) repository_root: String,
    pub(crate) display_name: String,
    pub(crate) current_branch: Option<String>,
    pub(crate) head_state: String,
    pub(crate) upstream: Option<String>,
    pub(crate) ahead: usize,
    pub(crate) behind: usize,
    pub(crate) staged_count: usize,
    pub(crate) modified_count: usize,
    pub(crate) untracked_count: usize,
    pub(crate) conflicted_count: usize,
    #[serde(default)]
    pub(crate) file_statuses: Vec<GitRepositoryFileStatus>,
    pub(crate) is_clean: bool,
    pub(crate) error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitBranchUpdateResult {
    pub(crate) branch: String,
    pub(crate) status: String,
    #[serde(default)]
    pub(crate) reason: Option<String>,
    pub(crate) message: String,
    #[serde(default, rename = "worktreePath")]
    pub(crate) worktree_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubIssue {
    pub(crate) number: u64,
    pub(crate) title: String,
    pub(crate) url: String,
    #[serde(rename = "updatedAt")]
    pub(crate) updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubIssuesResponse {
    pub(crate) total: usize,
    pub(crate) issues: Vec<GitHubIssue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubPullRequestAuthor {
    pub(crate) login: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubPullRequest {
    pub(crate) number: u64,
    pub(crate) title: String,
    pub(crate) url: String,
    #[serde(rename = "updatedAt")]
    pub(crate) updated_at: String,
    #[serde(rename = "createdAt")]
    pub(crate) created_at: String,
    pub(crate) body: String,
    #[serde(rename = "headRefName")]
    pub(crate) head_ref_name: String,
    #[serde(rename = "baseRefName")]
    pub(crate) base_ref_name: String,
    #[serde(rename = "isDraft")]
    pub(crate) is_draft: bool,
    #[serde(default)]
    pub(crate) author: Option<GitHubPullRequestAuthor>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubPullRequestsResponse {
    pub(crate) total: usize,
    #[serde(rename = "pullRequests")]
    pub(crate) pull_requests: Vec<GitHubPullRequest>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubPullRequestDiff {
    pub(crate) path: String,
    pub(crate) status: String,
    pub(crate) diff: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub(crate) struct GitHubPullRequestComment {
    pub(crate) id: u64,
    #[serde(default)]
    pub(crate) body: String,
    #[serde(rename = "createdAt")]
    pub(crate) created_at: String,
    #[serde(default)]
    pub(crate) url: String,
    #[serde(default)]
    pub(crate) author: Option<GitHubPullRequestAuthor>,
}

