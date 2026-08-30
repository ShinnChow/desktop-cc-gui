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
use super::diff_collect::*;
use super::remote_forward::*;
use super::range_gate::{evaluate_pr_range_gate, parse_pr_range_fingerprint, PrRangeGateDecision};

pub(crate) async fn push_with_options(
    repo_root: &Path,
    remote: Option<String>,
    branch: Option<String>,
    force_with_lease: bool,
    push_tags: bool,
    run_hooks: bool,
    push_to_gerrit: bool,
    topic: Option<String>,
    reviewers: Option<String>,
    cc: Option<String>,
) -> Result<(), String> {
    let mut args = vec!["push".to_string()];
    if !run_hooks {
        args.push("--no-verify".to_string());
    }
    if force_with_lease {
        args.push("--force-with-lease".to_string());
    }
    if push_tags {
        args.push("--follow-tags".to_string());
    }

    let explicit_remote = trim_optional(remote);
    let explicit_branch = trim_optional(branch)
        .map(|value| normalize_local_branch_ref(&value))
        .filter(|value| !value.is_empty());
    let current_branch = current_local_branch(repo_root)?;
    let target_branch = explicit_branch.or(current_branch);

    if push_to_gerrit {
        let target_remote = explicit_remote
            .or_else(|| {
                upstream_remote_and_branch(repo_root)
                    .ok()
                    .flatten()
                    .map(|(name, _)| name)
            })
            .unwrap_or_else(|| "origin".to_string());
        let target_branch =
            target_branch.ok_or_else(|| "Branch is required for Gerrit push.".to_string())?;

        let mut refspec = format!("HEAD:refs/for/{target_branch}");
        let suffix = build_gerrit_push_suffix(topic, reviewers, cc);
        if !suffix.is_empty() {
            refspec.push('%');
            refspec.push_str(&suffix);
        }
        args.push(target_remote);
        args.push(refspec);
        let command: Vec<&str> = args.iter().map(String::as_str).collect();
        return run_git_command(repo_root, &command).await;
    }

    if explicit_remote.is_none() && target_branch.is_none() {
        if !force_with_lease && !push_tags && run_hooks {
            return push_with_upstream(repo_root).await;
        }
        let command: Vec<&str> = args.iter().map(String::as_str).collect();
        return run_git_command(repo_root, &command).await;
    }

    let target_remote = explicit_remote
        .or_else(|| {
            upstream_remote_and_branch(repo_root)
                .ok()
                .flatten()
                .map(|(name, _)| name)
        })
        .unwrap_or_else(|| "origin".to_string());
    args.push(target_remote);
    if let Some(target_branch) = target_branch {
        args.push(format!("HEAD:{target_branch}"));
    }

    let command: Vec<&str> = args.iter().map(String::as_str).collect();
    run_git_command(repo_root, &command).await
}
