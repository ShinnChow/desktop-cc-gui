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
use crate::git_utils::{
    blob_to_base64, build_git_file_blame, build_image_commit_diff, checkout_branch,
    commit_to_entry, diff_patch_to_string, diff_stats_for_identity, find_git_diff_renames,
    git_action_paths_for_file as action_paths_for_file, git_diff_paths_for_file,
    git_status_path_identity, image_mime_type,
    list_git_repository_summaries as scan_git_repository_summaries,
    list_git_roots as scan_git_roots, parse_github_repo, path_has_git_repository_marker,
    read_image_base64, resolve_git_root, resolve_git_root_for_scope, GitStatusLayer,
    GitStatusPathIdentity,
};
use crate::state::AppState;
use crate::types::{
    BranchInfo, GitBranchCompareCommitSets, GitBranchListItem, GitBranchUpdateResult,
    GitCommitDetails, GitCommitDiff, GitCommitFileChange, GitFileBlameResponse, GitFileDiff,
    GitFileStatus, GitHistoryCommit, GitHistoryResponse, GitHubIssue, GitHubIssuesResponse,
    GitHubPullRequest, GitHubPullRequestComment, GitHubPullRequestDiff, GitHubPullRequestsResponse,
    GitLogResponse, GitPrExistingPullRequest, GitPrWorkflowDefaults, GitPrWorkflowResult,
    GitPrWorkflowStage, GitPushPreviewResponse, GitRepositorySummary,
};
use crate::utils::{git_env_path, normalize_git_path, resolve_git_binary};
use range_gate::{evaluate_pr_range_gate, parse_pr_range_fingerprint, PrRangeGateDecision};
use validation::validate_local_branch_name;

#[cfg(test)]
use crate::types::{GitPrRangeGate, GitPrRangeGateSeverity};

mod pull_request_content;
mod range_gate;
mod validation;

mod commands;
pub(crate) use commands::*;

mod diff_collect;
mod pr_workflow_helpers;
mod push;
mod remote_forward;

pub(crate) use diff_collect::*;
pub(crate) use pr_workflow_helpers::*;
pub(crate) use push::*;
pub(crate) use remote_forward::*;

#[cfg(test)]
mod tests;
