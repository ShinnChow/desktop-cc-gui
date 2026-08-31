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

pub(crate) fn github_repo_from_path(path: &Path) -> Result<String, String> {
    let repo = open_repository_at_root(path)?;
    let remotes = repo.remotes().map_err(|e| e.to_string())?;
    let name = if remotes.iter().any(|remote| remote == Some("origin")) {
        "origin".to_string()
    } else {
        remotes.iter().flatten().next().unwrap_or("").to_string()
    };
    if name.is_empty() {
        return Err("No git remote configured.".to_string());
    }
    let remote = repo.find_remote(&name).map_err(|e| e.to_string())?;
    let remote_url = remote.url().ok_or("Remote has no URL configured.")?;
    parse_github_repo(remote_url).ok_or("Remote is not a GitHub repository.".to_string())
}

pub(crate) fn parse_patch_diff_entries(diff: &str) -> Vec<GitCommitDiff> {
    let mut entries = Vec::new();
    let mut current_lines: Vec<&str> = Vec::new();
    let mut current_old_path: Option<String> = None;
    let mut current_new_path: Option<String> = None;
    let mut current_status: Option<String> = None;

    let finalize = |lines: &Vec<&str>,
                    old_path: &Option<String>,
                    new_path: &Option<String>,
                    status: &Option<String>,
                    results: &mut Vec<GitCommitDiff>| {
        if lines.is_empty() {
            return;
        }
        let diff_text = lines.join("\n");
        if diff_text.trim().is_empty() {
            return;
        }
        let status_value = status.clone().unwrap_or_else(|| "M".to_string());
        let path = if status_value == "D" {
            old_path.clone().unwrap_or_default()
        } else {
            new_path
                .clone()
                .or_else(|| old_path.clone())
                .unwrap_or_default()
        };
        if path.is_empty() {
            return;
        }
        results.push(GitCommitDiff {
            path: normalize_git_path(&path),
            status: status_value,
            diff: diff_text,
            is_binary: false,
            is_image: false,
            old_image_data: None,
            new_image_data: None,
            old_image_mime: None,
            new_image_mime: None,
        });
    };

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            finalize(
                &current_lines,
                &current_old_path,
                &current_new_path,
                &current_status,
                &mut entries,
            );
            current_lines = vec![line];
            current_old_path = None;
            current_new_path = None;
            current_status = None;

            let rest = line.trim_start_matches("diff --git ").trim();
            let mut parts = rest.split_whitespace();
            let old_part = parts.next().unwrap_or("").trim_start_matches("a/");
            let new_part = parts.next().unwrap_or("").trim_start_matches("b/");
            if !old_part.is_empty() {
                current_old_path = Some(old_part.to_string());
            }
            if !new_part.is_empty() {
                current_new_path = Some(new_part.to_string());
            }
            continue;
        }
        if line.starts_with("new file mode ") {
            current_status = Some("A".to_string());
        } else if line.starts_with("deleted file mode ") {
            current_status = Some("D".to_string());
        } else if line.starts_with("rename from ") {
            current_status = Some("R".to_string());
            let path = line.trim_start_matches("rename from ").trim();
            if !path.is_empty() {
                current_old_path = Some(path.to_string());
            }
        } else if line.starts_with("rename to ") {
            current_status = Some("R".to_string());
            let path = line.trim_start_matches("rename to ").trim();
            if !path.is_empty() {
                current_new_path = Some(path.to_string());
            }
        }
        current_lines.push(line);
    }

    finalize(
        &current_lines,
        &current_old_path,
        &current_new_path,
        &current_status,
        &mut entries,
    );

    entries
}

pub(crate) fn parse_pr_diff(diff: &str) -> Vec<GitHubPullRequestDiff> {
    parse_patch_diff_entries(diff)
        .into_iter()
        .map(|entry| GitHubPullRequestDiff {
            path: entry.path,
            status: entry.status,
            diff: entry.diff,
        })
        .collect()
}

#[derive(Debug)]
pub(crate) struct TokenIsolatedCommandOutput {
    pub(crate) success: bool,
    pub(crate) command: String,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct GhExistingPrEntry {
    pub(crate) number: u64,
    pub(crate) title: String,
    pub(crate) url: String,
    pub(crate) state: String,
    #[serde(rename = "headRefName")]
    pub(crate) head_ref_name: String,
    #[serde(rename = "baseRefName")]
    pub(crate) base_ref_name: String,
}

pub(crate) fn shell_escape_for_display(value: &str) -> String {
    if value.is_empty() {
        return "''".to_string();
    }
    if value.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '/' | '_' | '-' | '.' | ':' | '@' | '=')
    }) {
        return value.to_string();
    }
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub(crate) fn build_token_isolated_command_display(program: &str, args: &[String]) -> String {
    let mut rendered = vec!["env -u GH_TOKEN -u GITHUB_TOKEN".to_string()];
    rendered.push(shell_escape_for_display(program));
    rendered.extend(args.iter().map(|value| shell_escape_for_display(value)));
    rendered.join(" ")
}

pub(crate) fn summarize_command_failure(output: &TokenIsolatedCommandOutput) -> String {
    let stderr = output.stderr.trim();
    if !stderr.is_empty() {
        return stderr.to_string();
    }
    let stdout = output.stdout.trim();
    if !stdout.is_empty() {
        return stdout.to_string();
    }
    "Command failed without stderr/stdout output.".to_string()
}

pub(crate) fn truncate_debug_text(raw: &str, max_len: usize) -> String {
    if raw.chars().count() <= max_len {
        return raw.to_string();
    }
    raw.chars().take(max_len).collect::<String>() + " ...[truncated]"
}

pub(crate) async fn run_token_isolated_command(
    repo_root: &Path,
    program: &str,
    args: &[String],
    extra_env: &[(&str, &str)],
) -> Result<TokenIsolatedCommandOutput, String> {
    let mut command = if program == "git" {
        crate::utils::async_command(
            resolve_git_binary().map_err(|e| format!("Failed to run git: {e}"))?,
        )
    } else {
        crate::utils::async_command(program)
    };
    command
        .args(args)
        .current_dir(repo_root)
        .env("PATH", git_env_path())
        .env_remove("GH_TOKEN")
        .env_remove("GITHUB_TOKEN")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for (key, value) in extra_env {
        command.env(key, value);
    }

    let output = match timeout(
        Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS),
        command.output(),
    )
    .await
    {
        Ok(result) => result.map_err(|error| {
            if program == "gh" {
                format!("Failed to run gh command: {error}. Ensure GitHub CLI (gh) is installed.")
            } else {
                format!("Failed to run {program} command: {error}")
            }
        })?,
        Err(_) => {
            return Err(format!(
                "Command timed out after {GIT_COMMAND_TIMEOUT_SECS}s: {}",
                build_token_isolated_command_display(program, args)
            ));
        }
    };

    Ok(TokenIsolatedCommandOutput {
        success: output.status.success(),
        command: build_token_isolated_command_display(program, args),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

pub(crate) fn is_http2_transport_error(raw: &str) -> bool {
    let normalized = raw.to_lowercase();
    normalized.contains("http2 framing layer")
        || normalized.contains("http/2 stream")
        || normalized.contains("stream 0 was not closed cleanly")
}

pub(crate) fn is_auth_related_error(raw: &str) -> bool {
    let normalized = raw.to_lowercase();
    normalized.contains("403")
        || normalized.contains("authentication failed")
        || normalized.contains("permission denied")
        || normalized.contains("resource not accessible by personal access token")
        || normalized.contains("requires authentication")
        || normalized.contains("not logged into any github hosts")
}

pub(crate) fn is_network_related_error(raw: &str) -> bool {
    let normalized = raw.to_lowercase();
    normalized.contains("failed to connect")
        || normalized.contains("could not resolve host")
        || normalized.contains("timed out")
        || normalized.contains("connection reset")
        || normalized.contains("network is unreachable")
}

pub(crate) fn parse_repo_owner(repo: &str) -> Option<String> {
    repo.split('/')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(crate) fn resolve_remote_repo(repo: &Repository, remote_name: &str) -> Option<String> {
    let remote = repo.find_remote(remote_name).ok()?;
    let remote_url = remote.url()?;
    parse_github_repo(remote_url)
}

pub(crate) fn infer_remote_head_branch(repo: &Repository, remote_name: &str) -> Option<String> {
    let head_ref = format!("refs/remotes/{remote_name}/HEAD");
    let reference = repo.find_reference(&head_ref).ok()?;
    let symbolic_target = reference.symbolic_target()?;
    let prefix = format!("refs/remotes/{remote_name}/");
    symbolic_target
        .strip_prefix(prefix.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(crate) fn default_pr_description(base_branch: &str, head_branch: &str) -> String {
    format!(
        "## 背景\n- 从 `{base_branch}` 合并到 `{head_branch}`。\n\n## 改动点\n- \n\n## 验证\n- [ ] npm run typecheck\n- [ ] npm run lint"
    )
}

pub(crate) fn build_workflow_stages() -> Vec<GitPrWorkflowStage> {
    vec![
        GitPrWorkflowStage {
            key: "precheck".to_string(),
            status: "pending".to_string(),
            detail: "Waiting for precheck.".to_string(),
            command: None,
            stdout: None,
            stderr: None,
        },
        GitPrWorkflowStage {
            key: "push".to_string(),
            status: "pending".to_string(),
            detail: "Waiting for push.".to_string(),
            command: None,
            stdout: None,
            stderr: None,
        },
        GitPrWorkflowStage {
            key: "create".to_string(),
            status: "pending".to_string(),
            detail: "Waiting for PR creation.".to_string(),
            command: None,
            stdout: None,
            stderr: None,
        },
        GitPrWorkflowStage {
            key: "comment".to_string(),
            status: "pending".to_string(),
            detail: "Waiting for optional comment.".to_string(),
            command: None,
            stdout: None,
            stderr: None,
        },
    ]
}

pub(crate) fn update_workflow_stage(
    stages: &mut [GitPrWorkflowStage],
    key: &str,
    status: &str,
    detail: String,
    command: Option<String>,
    stdout: Option<String>,
    stderr: Option<String>,
) {
    if let Some(stage) = stages.iter_mut().find(|entry| entry.key == key) {
        stage.status = status.to_string();
        stage.detail = detail;
        stage.command = command;
        stage.stdout = stdout;
        stage.stderr = stderr;
    }
}

pub(crate) fn stage_error_category_and_hint(stage_key: &str, raw: &str) -> (String, String) {
    if stage_key == "precheck" {
        if raw.to_lowercase().contains("gh") && raw.to_lowercase().contains("not found") {
            return (
                "gh-not-installed".to_string(),
                "Install GitHub CLI and run `gh auth login` first.".to_string(),
            );
        }
        if is_auth_related_error(raw) {
            return (
                "gh-auth-missing".to_string(),
                "Run `env -u GH_TOKEN -u GITHUB_TOKEN gh auth status -h github.com` and finish login.".to_string(),
            );
        }
        if raw.to_lowercase().contains("range gate") {
            return (
                "range-abnormal".to_string(),
                "Review changed files against upstream base, then re-run after rebasing/fixing scope.".to_string(),
            );
        }
    }
    if stage_key == "push" {
        if is_http2_transport_error(raw) {
            return (
                "push-http2".to_string(),
                "Retry with HTTP/1.1 fallback: `git -c http.version=HTTP/1.1 push ...`."
                    .to_string(),
            );
        }
        if is_auth_related_error(raw) {
            return (
                "push-auth".to_string(),
                "Verify fork push permission and run with token-isolated env (`env -u GH_TOKEN -u GITHUB_TOKEN`).".to_string(),
            );
        }
        if is_network_related_error(raw) {
            return (
                "push-network".to_string(),
                "Check network/proxy connectivity to github.com:443, then retry.".to_string(),
            );
        }
    }
    if stage_key == "create" {
        if is_auth_related_error(raw) {
            return (
                "create-pr-auth".to_string(),
                "Use `env -u GH_TOKEN -u GITHUB_TOKEN` and ensure `gh auth status` is healthy."
                    .to_string(),
            );
        }
        if is_network_related_error(raw) {
            return (
                "create-pr-network".to_string(),
                "Network seems unstable. Retry once after validating GitHub connectivity."
                    .to_string(),
            );
        }
    }
    (
        "unknown".to_string(),
        "Check stage stderr and retry.".to_string(),
    )
}

pub(crate) fn extract_pr_url(raw: &str) -> Option<String> {
    raw.split_whitespace()
        .find(|token| token.starts_with("https://") && token.contains("/pull/"))
        .map(|token| {
            token
                .trim()
                .trim_matches('\'')
                .trim_matches('"')
                .trim_end_matches('.')
                .to_string()
        })
}

pub(crate) fn extract_pr_number_from_url(url: &str) -> Option<u64> {
    let pull_segment = url.split("/pull/").nth(1)?;
    let number_text = pull_segment
        .split(['/', '?', '#'])
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    number_text.parse::<u64>().ok()
}

pub(crate) fn build_failed_pr_workflow_result(
    stages: Vec<GitPrWorkflowStage>,
    stage_key: &str,
    raw_error: String,
    retry_command: Option<String>,
) -> GitPrWorkflowResult {
    let (category, hint) = stage_error_category_and_hint(stage_key, &raw_error);
    GitPrWorkflowResult {
        ok: false,
        status: "failed".to_string(),
        message: raw_error,
        error_category: Some(category),
        next_action_hint: Some(hint),
        pr_url: None,
        pr_number: None,
        existing_pr: None,
        retry_command,
        range_gate: None,
        stages,
    }
}

pub(crate) fn build_existing_pr_workflow_result(
    stages: Vec<GitPrWorkflowStage>,
    existing_pr: GitPrExistingPullRequest,
) -> GitPrWorkflowResult {
    GitPrWorkflowResult {
        ok: true,
        status: "existing".to_string(),
        message: format!(
            "Existing PR detected: #{} {}",
            existing_pr.number, existing_pr.title
        ),
        error_category: None,
        next_action_hint: Some(
            "Open the existing PR and continue updates on the same branch.".to_string(),
        ),
        pr_url: Some(existing_pr.url.clone()),
        pr_number: Some(existing_pr.number),
        existing_pr: Some(existing_pr),
        retry_command: None,
        range_gate: None,
        stages,
    }
}

pub(crate) fn build_success_pr_workflow_result(
    stages: Vec<GitPrWorkflowStage>,
    pr_url: String,
    pr_number: Option<u64>,
    message: String,
) -> GitPrWorkflowResult {
    GitPrWorkflowResult {
        ok: true,
        status: "success".to_string(),
        message,
        error_category: None,
        next_action_hint: None,
        pr_url: Some(pr_url),
        pr_number,
        existing_pr: None,
        retry_command: None,
        range_gate: None,
        stages,
    }
}
