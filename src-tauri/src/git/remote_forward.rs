use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use git2::{BranchType, DiffOptions, Oid, Repository, Sort, Status, StatusOptions};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, State};
use tokio::time::{timeout, Duration};

use crate::backend_budget::{estimate_json_payload_bytes, PayloadBudgetMetadata, ScanCacheState};
use crate::git_utils::*;
use crate::state::AppState;
use crate::types::*;
use crate::utils::{git_env_path, normalize_git_path, resolve_git_binary};
use super::range_gate::{evaluate_pr_range_gate, parse_pr_range_fingerprint, PrRangeGateDecision};

#[cfg(test)]
#[derive(Debug, Clone, Copy)]
pub(crate) struct GitRemoteForwardingEntry {
    pub(crate) method: &'static str,
    pub(crate) category: &'static str,
    pub(crate) desktop_module: &'static str,
    pub(crate) daemon_dispatch: &'static str,
    pub(crate) forwarding: &'static str,
    pub(crate) coverage: &'static str,
}

#[cfg(test)]
pub(crate) const GIT_REMOTE_FORWARDING_MATRIX: &[GitRemoteForwardingEntry] = &[
    GitRemoteForwardingEntry {
        method: "get_git_status",
        category: "read",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_status",
        forwarding: "implemented",
        coverage: "representative-read",
    },
    GitRemoteForwardingEntry {
        method: "list_git_roots",
        category: "read",
        desktop_module: "commands.rs",
        daemon_dispatch: "list_git_roots",
        forwarding: "implemented",
        coverage: "issue-633-root-scan",
    },
    GitRemoteForwardingEntry {
        method: "list_git_repository_summaries",
        category: "read",
        desktop_module: "commands.rs",
        daemon_dispatch: "list_git_repository_summaries",
        forwarding: "implemented",
        coverage: "multi-repository-summary",
    },
    GitRemoteForwardingEntry {
        method: "get_git_diffs",
        category: "read",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_diffs",
        forwarding: "implemented",
        coverage: "read-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_file_full_diff",
        category: "read",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_file_full_diff",
        forwarding: "implemented",
        coverage: "read-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_file_blame",
        category: "read",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_file_blame",
        forwarding: "implemented",
        coverage: "file-view-blame",
    },
    GitRemoteForwardingEntry {
        method: "get_git_remote",
        category: "read",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_remote",
        forwarding: "implemented",
        coverage: "read-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_log",
        category: "history",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_log",
        forwarding: "implemented",
        coverage: "history-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_commit_history",
        category: "history",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_commit_history",
        forwarding: "implemented",
        coverage: "history-filter-matrix",
    },
    GitRemoteForwardingEntry {
        method: "resolve_git_commit_ref",
        category: "history",
        desktop_module: "commands.rs",
        daemon_dispatch: "resolve_git_commit_ref",
        forwarding: "implemented",
        coverage: "history-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_commit_details",
        category: "history",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_commit_details",
        forwarding: "implemented",
        coverage: "history-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_commit_diff",
        category: "history",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_commit_diff",
        forwarding: "implemented",
        coverage: "history-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_push_preview",
        category: "history",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_push_preview",
        forwarding: "implemented",
        coverage: "push-preview-matrix",
    },
    GitRemoteForwardingEntry {
        method: "stage_git_file",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "stage_git_file",
        forwarding: "implemented",
        coverage: "representative-write",
    },
    GitRemoteForwardingEntry {
        method: "stage_git_all",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "stage_git_all",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "unstage_git_file",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "unstage_git_file",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "unstage_git_all",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "unstage_git_all",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "unstage_git_paths",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "unstage_git_paths",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "revert_git_file",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "revert_git_file",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "revert_git_paths",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "revert_git_paths",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "revert_git_all",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "revert_git_all",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "commit_git",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "commit_git",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "push_git",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "push_git",
        forwarding: "implemented",
        coverage: "push-params-matrix",
    },
    GitRemoteForwardingEntry {
        method: "pull_git",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "pull_git",
        forwarding: "implemented",
        coverage: "pull-params-matrix",
    },
    GitRemoteForwardingEntry {
        method: "sync_git",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "sync_git",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "git_pull",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "git_pull",
        forwarding: "implemented",
        coverage: "legacy-toolbar-matrix",
    },
    GitRemoteForwardingEntry {
        method: "git_push",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "git_push",
        forwarding: "implemented",
        coverage: "legacy-toolbar-matrix",
    },
    GitRemoteForwardingEntry {
        method: "git_sync",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "git_sync",
        forwarding: "implemented",
        coverage: "legacy-toolbar-matrix",
    },
    GitRemoteForwardingEntry {
        method: "git_fetch",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "git_fetch",
        forwarding: "implemented",
        coverage: "fetch-matrix",
    },
    GitRemoteForwardingEntry {
        method: "update_git_branch",
        category: "write",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "update_git_branch",
        forwarding: "implemented",
        coverage: "branch-update-local-regression",
    },
    GitRemoteForwardingEntry {
        method: "cherry_pick_commit",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "cherry_pick_commit",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "revert_commit",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "revert_commit",
        forwarding: "implemented",
        coverage: "write-matrix",
    },
    GitRemoteForwardingEntry {
        method: "reset_git_commit",
        category: "write",
        desktop_module: "commands.rs",
        daemon_dispatch: "reset_git_commit",
        forwarding: "implemented",
        coverage: "reset-matrix",
    },
    GitRemoteForwardingEntry {
        method: "list_git_branches",
        category: "branch",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "list_git_branches",
        forwarding: "implemented",
        coverage: "branch-list-matrix",
    },
    GitRemoteForwardingEntry {
        method: "checkout_git_branch",
        category: "branch",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "checkout_git_branch",
        forwarding: "implemented",
        coverage: "branch-mutation-matrix",
    },
    GitRemoteForwardingEntry {
        method: "create_git_branch",
        category: "branch",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "create_git_branch",
        forwarding: "implemented",
        coverage: "branch-mutation-matrix",
    },
    GitRemoteForwardingEntry {
        method: "create_git_branch_from_branch",
        category: "branch",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "create_git_branch_from_branch",
        forwarding: "implemented",
        coverage: "branch-mutation-matrix",
    },
    GitRemoteForwardingEntry {
        method: "create_git_branch_from_commit",
        category: "branch",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "create_git_branch_from_commit",
        forwarding: "implemented",
        coverage: "branch-mutation-matrix",
    },
    GitRemoteForwardingEntry {
        method: "delete_git_branch",
        category: "branch",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "delete_git_branch",
        forwarding: "implemented",
        coverage: "branch-mutation-matrix",
    },
    GitRemoteForwardingEntry {
        method: "rename_git_branch",
        category: "branch",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "rename_git_branch",
        forwarding: "implemented",
        coverage: "branch-mutation-matrix",
    },
    GitRemoteForwardingEntry {
        method: "merge_git_branch",
        category: "branch",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "merge_git_branch",
        forwarding: "implemented",
        coverage: "branch-mutation-matrix",
    },
    GitRemoteForwardingEntry {
        method: "rebase_git_branch",
        category: "branch",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "rebase_git_branch",
        forwarding: "implemented",
        coverage: "branch-mutation-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_branch_compare_commits",
        category: "worktree",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "get_git_branch_compare_commits",
        forwarding: "implemented",
        coverage: "compare-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_branch_diff_between_branches",
        category: "worktree",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "get_git_branch_diff_between_branches",
        forwarding: "implemented",
        coverage: "compare-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_branch_file_diff_between_branches",
        category: "worktree",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "get_git_branch_file_diff_between_branches",
        forwarding: "implemented",
        coverage: "compare-path-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_worktree_diff_against_branch",
        category: "worktree",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "get_git_worktree_diff_against_branch",
        forwarding: "implemented",
        coverage: "worktree-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_worktree_file_diff_against_branch",
        category: "worktree",
        desktop_module: "commands_branch.rs",
        daemon_dispatch: "get_git_worktree_file_diff_against_branch",
        forwarding: "implemented",
        coverage: "worktree-path-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_github_issues",
        category: "github",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_github_issues",
        forwarding: "implemented",
        coverage: "github-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_github_pull_requests",
        category: "github",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_github_pull_requests",
        forwarding: "implemented",
        coverage: "github-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_github_pull_request_diff",
        category: "github",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_github_pull_request_diff",
        forwarding: "implemented",
        coverage: "github-pr-number-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_github_pull_request_comments",
        category: "github",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_github_pull_request_comments",
        forwarding: "implemented",
        coverage: "github-pr-number-matrix",
    },
    GitRemoteForwardingEntry {
        method: "get_git_pr_workflow_defaults",
        category: "github",
        desktop_module: "commands.rs",
        daemon_dispatch: "get_git_pr_workflow_defaults",
        forwarding: "implemented",
        coverage: "pr-workflow-matrix",
    },
    GitRemoteForwardingEntry {
        method: "create_git_pr_workflow",
        category: "github",
        desktop_module: "commands.rs",
        daemon_dispatch: "create_git_pr_workflow",
        forwarding: "implemented",
        coverage: "pr-workflow-params-matrix",
    },
];
pub(crate) async fn should_forward_git_remote(state: &State<'_, AppState>) -> bool {
    crate::remote_backend::is_remote_mode(&*state).await
}

pub(crate) async fn forward_git_remote<T: DeserializeOwned>(
    state: &State<'_, AppState>,
    app: &AppHandle,
    method: &str,
    params: serde_json::Value,
) -> Result<T, String> {
    let response = crate::remote_backend::call_remote(&*state, app.clone(), method, params).await?;
    serde_json::from_value(response).map_err(|error| error.to_string())
}

pub(crate) async fn forward_git_remote_unit(
    state: &State<'_, AppState>,
    app: &AppHandle,
    method: &str,
    params: serde_json::Value,
) -> Result<(), String> {
    let _: serde_json::Value = forward_git_remote(state, app, method, params).await?;
    Ok(())
}

pub(crate) const INDEX_SKIP_WORKTREE_FLAG: u16 = 0x4000;
pub(crate) const MAX_COMMIT_DIFF_LINES: usize = 10_000;
pub(crate) const GIT_COMMAND_TIMEOUT_SECS: u64 = 120;
pub(crate) const GIT_STATUS_DIFF_STATS_FILE_LIMIT: usize = 120;
pub(crate) const GIT_STATUS_DIFF_STATS_MAX_FILE_BYTES: u64 = 256 * 1024;
pub(crate) const GIT_DIFF_PREVIEW_MAX_FILES: usize = 200;
pub(crate) const GIT_DIFF_PREVIEW_MAX_TOTAL_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const GIT_DIFF_PREVIEW_MAX_BYTES_PER_FILE: usize = 256 * 1024;
pub(crate) const GIT_DIFF_PREVIEW_MAX_LINES_PER_FILE: usize = 2_500;
pub(crate) const GIT_DIFF_PREVIEW_SKIP_FILE_SIZE_BYTES: u64 = 1024 * 1024;
