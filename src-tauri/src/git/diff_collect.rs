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
use super::remote_forward::*;
use super::range_gate::{evaluate_pr_range_gate, parse_pr_range_fingerprint, PrRangeGateDecision};

pub(crate) fn trim_lowercase(input: Option<String>) -> Option<String> {
    input
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_lowercase())
}

pub(crate) fn trim_optional(input: Option<String>) -> Option<String> {
    input
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn is_branch_used_by_worktree_error(raw: &str) -> bool {
    let message = raw.to_lowercase();
    message.contains("cannot delete branch") && message.contains("used by worktree at")
}

pub(crate) fn extract_worktree_path_from_delete_error(raw: &str) -> Option<String> {
    let marker = "used by worktree at '";
    let start = raw.find(marker)?;
    let tail = &raw[start + marker.len()..];
    let end = tail.find('\'')?;
    let path = tail[..end].trim();
    if path.is_empty() {
        return None;
    }
    Some(path.to_string())
}

pub(crate) fn build_delete_branch_worktree_error(branch_name: &str, raw: &str) -> String {
    if let Some(path) = extract_worktree_path_from_delete_error(raw) {
        return format!(
            "Cannot delete branch '{branch_name}' because it is currently used by worktree at '{path}'. Switch that worktree to another branch or remove that worktree, then retry."
        );
    }
    format!(
        "Cannot delete branch '{branch_name}' because it is currently used by another worktree. Switch that worktree to another branch or remove that worktree, then retry."
    )
}

pub(crate) fn truncate_diff_lines(content: &str, max_lines: usize) -> (String, usize, bool) {
    if max_lines == 0 {
        return (String::new(), 0, false);
    }
    let mut lines = content.lines();
    let mut kept = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;
    for line in lines.by_ref() {
        total += 1;
        if total <= max_lines {
            kept.push(line);
        } else {
            truncated = true;
        }
    }
    (kept.join("\n"), total, truncated || total > max_lines)
}

pub(crate) fn normalize_guard_path(path: &str) -> String {
    path.replace('\\', "/").to_ascii_lowercase()
}

pub(crate) fn is_heavy_diff_path(path: &str) -> bool {
    let normalized = normalize_guard_path(path);
    let segments: Vec<&str> = normalized
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();
    let file_name = segments.last().copied().unwrap_or(normalized.as_str());

    if matches!(
        file_name,
        "pnpm-lock.yaml"
            | "package-lock.json"
            | "yarn.lock"
            | "bun.lockb"
            | "cargo.lock"
            | "pipfile.lock"
            | "poetry.lock"
            | "composer.lock"
    ) {
        return true;
    }

    if file_name.ends_with(".lock")
        || file_name.ends_with(".min.js")
        || file_name.ends_with(".bundle.js")
    {
        return true;
    }

    segments.iter().any(|segment| {
        matches!(
            *segment,
            "node_modules"
                | ".pnpm"
                | ".pnpm-store"
                | ".next"
                | "dist"
                | "build"
                | "coverage"
                | "release-artifacts"
        )
    })
}

pub(crate) fn is_large_worktree_file(repo_root: &Path, path: &str, limit_bytes: u64) -> bool {
    let candidate = repo_root.join(path);
    match fs::metadata(candidate) {
        Ok(metadata) => metadata.is_file() && metadata.len() > limit_bytes,
        Err(_) => false,
    }
}

pub(crate) fn should_skip_diff_stats(repo_root: &Path, path: &str) -> bool {
    is_heavy_diff_path(path)
        || is_large_worktree_file(repo_root, path, GIT_STATUS_DIFF_STATS_MAX_FILE_BYTES)
}

pub(crate) fn utf8_safe_prefix(input: &str, max_bytes: usize) -> &str {
    if input.len() <= max_bytes {
        return input;
    }
    let mut end = max_bytes;
    while end > 0 && !input.is_char_boundary(end) {
        end -= 1;
    }
    &input[..end]
}

pub(crate) fn truncate_diff_preview(content: String, max_lines: usize, max_bytes: usize) -> String {
    let (mut trimmed, _total_lines, line_truncated) = truncate_diff_lines(&content, max_lines);
    let mut truncated = line_truncated;

    if trimmed.len() > max_bytes {
        let safe_prefix = utf8_safe_prefix(&trimmed, max_bytes).to_string();
        trimmed = safe_prefix;
        truncated = true;
    }

    if truncated {
        trimmed.push_str("\n\n[diff truncated for performance]");
    }

    trimmed
}

pub(crate) fn collect_commit_refs_map(repo: &Repository) -> HashMap<Oid, Vec<String>> {
    let mut map: HashMap<Oid, Vec<String>> = HashMap::new();
    let references = match repo.references() {
        Ok(references) => references,
        Err(_) => return map,
    };
    for reference in references.flatten() {
        let oid = match reference.target() {
            Some(oid) => oid,
            None => continue,
        };
        let name = reference
            .shorthand()
            .or_else(|| reference.name())
            .unwrap_or("")
            .to_string();
        if name.is_empty() {
            continue;
        }
        map.entry(oid).or_default().push(name);
    }
    for values in map.values_mut() {
        values.sort();
        values.dedup();
    }
    map
}

pub(crate) fn open_repository_at_root(repo_root: &Path) -> Result<Repository, String> {
    Repository::open_ext(
        repo_root,
        git2::RepositoryOpenFlags::NO_SEARCH,
        std::iter::empty::<&Path>(),
    )
    .map_err(|e| e.to_string())
}

pub(crate) fn paginate_history_commits(
    commits: Vec<GitHistoryCommit>,
    offset: usize,
    limit: usize,
) -> (Vec<GitHistoryCommit>, usize, bool) {
    let total = commits.len();
    let page: Vec<GitHistoryCommit> = commits.into_iter().skip(offset).take(limit).collect();
    let has_more = offset.saturating_add(page.len()) < total;
    (page, total, has_more)
}

pub(crate) fn resolve_ref_to_oid(repo: &Repository, reference: &str) -> Result<Oid, String> {
    let trimmed = reference.trim();
    if trimmed.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }
    let local_ref = format!("refs/heads/{trimmed}");
    if let Ok(oid) = repo.refname_to_id(&local_ref) {
        return Ok(oid);
    }
    let remote_ref = format!("refs/remotes/{trimmed}");
    if let Ok(oid) = repo.refname_to_id(&remote_ref) {
        return Ok(oid);
    }
    repo.revparse_single(trimmed)
        .map(|object| object.id())
        .map_err(|_| format!("Branch or ref not found: {trimmed}"))
}

pub(crate) fn commit_to_history_commit(
    commit: &git2::Commit<'_>,
    refs_map: &HashMap<Oid, Vec<String>>,
) -> GitHistoryCommit {
    let oid = commit.id();
    let sha = oid.to_string();
    let short_sha: String = sha.chars().take(7).collect();
    let summary = commit.summary().unwrap_or("").to_string();
    let message = commit.message().unwrap_or("").to_string();
    let author = commit.author().name().unwrap_or("").to_string();
    let author_email = commit.author().email().unwrap_or("").to_string();
    let timestamp = commit.time().seconds();
    let parents = commit
        .parents()
        .map(|parent| parent.id().to_string())
        .collect();
    let refs = refs_map.get(&oid).cloned().unwrap_or_default();
    GitHistoryCommit {
        sha,
        short_sha,
        summary,
        message,
        author,
        author_email,
        timestamp,
        parents,
        refs,
        file_path: None,
    }
}

pub(crate) fn collect_unique_commits(
    repo: &Repository,
    include_ref: &str,
    exclude_ref: &str,
    refs_map: &HashMap<Oid, Vec<String>>,
    limit: usize,
) -> Result<Vec<GitHistoryCommit>, String> {
    let include_oid = resolve_ref_to_oid(repo, include_ref)?;
    let exclude_oid = resolve_ref_to_oid(repo, exclude_ref)?;
    let mut revwalk = repo.revwalk().map_err(|e| e.to_string())?;
    revwalk
        .set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .map_err(|e| e.to_string())?;
    revwalk.push(include_oid).map_err(|e| e.to_string())?;
    revwalk.hide(exclude_oid).map_err(|e| e.to_string())?;

    let mut commits = Vec::new();
    for oid_result in revwalk.take(limit) {
        let oid = oid_result.map_err(|e| e.to_string())?;
        let commit = repo.find_commit(oid).map_err(|e| e.to_string())?;
        commits.push(commit_to_history_commit(&commit, refs_map));
    }
    Ok(commits)
}

pub(crate) fn parse_remote_branch(name: &str) -> Option<(String, String)> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_prefix = trimmed
        .strip_prefix("refs/remotes/")
        .or_else(|| trimmed.strip_prefix("remotes/"))
        .unwrap_or(trimmed);
    let mut parts = without_prefix.splitn(2, '/');
    let remote = parts.next()?.trim();
    let branch = parts.next()?.trim();
    if remote.is_empty() || branch.is_empty() {
        return None;
    }
    Some((remote.to_string(), branch.to_string()))
}

pub(crate) async fn run_git_command(repo_root: &Path, args: &[&str]) -> Result<(), String> {
    let git_bin = resolve_git_binary().map_err(|e| format!("Failed to run git: {e}"))?;
    let mut command = crate::utils::async_command(git_bin);
    command
        .args(args)
        .current_dir(repo_root)
        .env("PATH", git_env_path())
        // Force non-interactive git in GUI context so pull/fetch does not hang on hidden prompts.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = match timeout(
        Duration::from_secs(GIT_COMMAND_TIMEOUT_SECS),
        command.output(),
    )
    .await
    {
        Ok(result) => result.map_err(|e| format!("Failed to run git: {e}"))?,
        Err(_) => {
            let command_name = args.join(" ");
            return Err(format!(
                "Git command timed out after {GIT_COMMAND_TIMEOUT_SECS}s: git {command_name}. Check network/authentication and retry."
            ));
        }
    };

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if detail.is_empty() {
        return Err("Git command failed.".to_string());
    }
    Err(detail.to_string())
}

pub(crate) fn parse_upstream_ref(name: &str) -> Option<(String, String)> {
    let trimmed = name.strip_prefix("refs/remotes/").unwrap_or(name);
    let mut parts = trimmed.splitn(2, '/');
    let remote = parts.next()?;
    let branch = parts.next()?;
    if remote.is_empty() || branch.is_empty() {
        return None;
    }
    Some((remote.to_string(), branch.to_string()))
}

pub(crate) fn normalize_local_branch_ref(raw: &str) -> String {
    raw.trim()
        .trim_start_matches("refs/heads/")
        .trim()
        .to_string()
}

pub(crate) fn normalize_remote_target_branch(remote: &str, raw: &str) -> String {
    let trimmed = raw.trim();
    let without_refs = trimmed
        .strip_prefix("refs/remotes/")
        .or_else(|| trimmed.strip_prefix("remotes/"))
        .unwrap_or(trimmed);
    let remote_prefix = format!("{remote}/");
    without_refs
        .strip_prefix(&remote_prefix)
        .unwrap_or(without_refs)
        .trim()
        .to_string()
}

pub(crate) fn upstream_remote_and_branch(
    repo_root: &Path,
) -> Result<Option<(String, String)>, String> {
    let repo = open_repository_at_root(repo_root)?;
    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => return Ok(None),
    };
    if !head.is_branch() {
        return Ok(None);
    }
    let branch_name = match head.shorthand() {
        Some(name) => name,
        None => return Ok(None),
    };
    let branch = repo
        .find_branch(branch_name, BranchType::Local)
        .map_err(|e| e.to_string())?;
    let upstream_branch = match branch.upstream() {
        Ok(upstream) => upstream,
        Err(_) => return Ok(None),
    };
    let upstream_ref = upstream_branch.get();
    let upstream_name = upstream_ref.name().or_else(|| upstream_ref.shorthand());
    Ok(upstream_name.and_then(parse_upstream_ref))
}

pub(crate) fn current_local_branch(repo_root: &Path) -> Result<Option<String>, String> {
    let repo = open_repository_at_root(repo_root)?;
    let head = match repo.head() {
        Ok(head) => head,
        Err(_) => return Ok(None),
    };
    if !head.is_branch() {
        return Ok(None);
    }
    Ok(head
        .shorthand()
        .map(normalize_local_branch_ref)
        .filter(|name| !name.is_empty()))
}

pub(crate) fn split_csv_values(input: Option<String>) -> Vec<String> {
    trim_optional(input)
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn build_gerrit_push_suffix(
    topic: Option<String>,
    reviewers: Option<String>,
    cc: Option<String>,
) -> String {
    let mut params = Vec::new();
    if let Some(topic_name) = trim_optional(topic) {
        params.push(format!("topic={topic_name}"));
    }
    for reviewer in split_csv_values(reviewers) {
        params.push(format!("r={reviewer}"));
    }
    for cc_member in split_csv_values(cc) {
        params.push(format!("cc={cc_member}"));
    }
    params.join(",")
}

pub(crate) async fn push_with_upstream(repo_root: &Path) -> Result<(), String> {
    let upstream = upstream_remote_and_branch(repo_root)?;
    if let Some((remote, branch)) = upstream {
        let refspec = format!("HEAD:{branch}");
        return run_git_command(repo_root, &["push", remote.as_str(), refspec.as_str()]).await;
    }
    run_git_command(repo_root, &["push"]).await
}

pub(crate) fn status_for_index(status: Status) -> Option<&'static str> {
    if status.contains(Status::INDEX_NEW) {
        Some("A")
    } else if status.contains(Status::INDEX_MODIFIED) {
        Some("M")
    } else if status.contains(Status::INDEX_DELETED) {
        Some("D")
    } else if status.contains(Status::INDEX_RENAMED) {
        Some("R")
    } else if status.contains(Status::INDEX_TYPECHANGE) {
        Some("T")
    } else {
        None
    }
}

pub(crate) fn status_for_workdir(status: Status) -> Option<&'static str> {
    if status.contains(Status::WT_NEW) {
        Some("A")
    } else if status.contains(Status::WT_MODIFIED) {
        Some("M")
    } else if status.contains(Status::WT_DELETED) {
        Some("D")
    } else if status.contains(Status::WT_RENAMED) {
        Some("R")
    } else if status.contains(Status::WT_TYPECHANGE) {
        Some("T")
    } else {
        None
    }
}

pub(crate) fn status_for_delta(status: git2::Delta) -> &'static str {
    match status {
        git2::Delta::Added => "A",
        git2::Delta::Modified => "M",
        git2::Delta::Deleted => "D",
        git2::Delta::Renamed => "R",
        git2::Delta::Typechange => "T",
        _ => "M",
    }
}

pub(crate) fn build_combined_diff(diff: &git2::Diff) -> String {
    let mut combined_diff = String::new();
    for (index, delta) in diff.deltas().enumerate() {
        let path = delta.new_file().path().or_else(|| delta.old_file().path());
        let Some(path) = path else {
            continue;
        };
        let patch = match git2::Patch::from_diff(diff, index) {
            Ok(patch) => patch,
            Err(_) => continue,
        };
        let Some(mut patch) = patch else {
            continue;
        };
        let content = match diff_patch_to_string(&mut patch) {
            Ok(content) => content,
            Err(_) => continue,
        };
        if content.trim().is_empty() {
            continue;
        }
        if !combined_diff.is_empty() {
            combined_diff.push_str("\n\n");
        }
        combined_diff.push_str(&format!("=== {} ===\n", path.display()));
        combined_diff.push_str(&content);
    }
    combined_diff
}

pub(crate) fn collect_index_diff(
    repo: &Repository,
    head_tree: Option<&git2::Tree<'_>>,
    pathspecs: Option<&[String]>,
) -> Result<String, String> {
    if matches!(pathspecs, Some(paths) if paths.is_empty()) {
        return Ok(String::new());
    }

    let mut options = DiffOptions::new();
    if let Some(paths) = pathspecs {
        for path in paths {
            options.pathspec(path);
        }
    }

    let index = repo.index().map_err(|e| e.to_string())?;
    let mut diff = match head_tree {
        Some(tree) => repo
            .diff_tree_to_index(Some(tree), Some(&index), Some(&mut options))
            .map_err(|e| e.to_string())?,
        None => repo
            .diff_tree_to_index(None, Some(&index), Some(&mut options))
            .map_err(|e| e.to_string())?,
    };
    find_git_diff_renames(&mut diff).map_err(|e| e.to_string())?;

    Ok(build_combined_diff(&diff))
}

pub(crate) fn collect_worktree_diff(
    repo: &Repository,
    head_tree: Option<&git2::Tree<'_>>,
    pathspecs: Option<&[String]>,
) -> Result<String, String> {
    if matches!(pathspecs, Some(paths) if paths.is_empty()) {
        return Ok(String::new());
    }

    let mut options = DiffOptions::new();
    options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .show_untracked_content(true);
    if let Some(paths) = pathspecs {
        for path in paths {
            options.pathspec(path);
        }
    }

    let mut diff = match head_tree {
        Some(tree) => repo
            .diff_tree_to_workdir_with_index(Some(tree), Some(&mut options))
            .map_err(|e| e.to_string())?,
        None => repo
            .diff_tree_to_workdir_with_index(None, Some(&mut options))
            .map_err(|e| e.to_string())?,
    };
    find_git_diff_renames(&mut diff).map_err(|e| e.to_string())?;

    Ok(build_combined_diff(&diff))
}

pub(crate) fn collect_workspace_diff(repo_root: &Path) -> Result<String, String> {
    let repo = open_repository_at_root(repo_root)?;
    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());

    let staged_diff = collect_index_diff(&repo, head_tree.as_ref(), None)?;
    if !staged_diff.trim().is_empty() {
        return Ok(staged_diff);
    }

    collect_worktree_diff(&repo, head_tree.as_ref(), None)
}

#[derive(Debug, Default, PartialEq, Eq)]
struct CommitScopeDiffPlan {
    index_paths: Vec<String>,
    worktree_only_paths: Vec<String>,
}

pub(crate) fn normalize_commit_scope_path(path: &str) -> String {
    normalize_git_path(path).trim_matches('/').to_string()
}

pub(crate) fn register_commit_scope_identity(
    identities_by_path: &mut HashMap<String, Vec<String>>,
    identity: &GitStatusPathIdentity,
) {
    let mut action_paths = Vec::new();
    if let Some(old_path) = identity.old_path.as_ref() {
        action_paths.push(old_path.clone());
    }
    if !action_paths.contains(&identity.path) {
        action_paths.push(identity.path.clone());
    }
    for alias in &action_paths {
        let normalized_alias = normalize_commit_scope_path(alias);
        if !normalized_alias.is_empty() {
            identities_by_path
                .entry(normalized_alias)
                .or_insert_with(|| action_paths.clone());
        }
    }
}

pub(crate) fn build_commit_scope_diff_plan(
    repo: &Repository,
    selected_paths: &[String],
) -> Result<CommitScopeDiffPlan, String> {
    let mut status_options = StatusOptions::new();
    status_options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true)
        .include_ignored(false);

    let statuses = repo
        .statuses(Some(&mut status_options))
        .map_err(|e| format!("failed to read git status for commit scope: {e}"))?;

    let mut staged_by_normalized_path = HashMap::new();
    let mut unstaged_by_normalized_path = HashMap::new();

    for entry in statuses.iter() {
        let status = entry.status();
        if status.intersects(
            Status::INDEX_NEW
                | Status::INDEX_MODIFIED
                | Status::INDEX_DELETED
                | Status::INDEX_RENAMED
                | Status::INDEX_TYPECHANGE,
        ) {
            if let Some(identity) = git_status_path_identity(&entry, GitStatusLayer::Index) {
                register_commit_scope_identity(&mut staged_by_normalized_path, &identity);
            }
        }

        if status.intersects(
            Status::WT_NEW
                | Status::WT_MODIFIED
                | Status::WT_DELETED
                | Status::WT_RENAMED
                | Status::WT_TYPECHANGE,
        ) {
            if let Some(identity) = git_status_path_identity(&entry, GitStatusLayer::Workdir) {
                register_commit_scope_identity(&mut unstaged_by_normalized_path, &identity);
            }
        }
    }

    let mut index_paths = Vec::new();
    let mut worktree_only_paths = Vec::new();
    let mut seen_index_paths = HashSet::new();
    let mut seen_worktree_paths = HashSet::new();

    for selected_path in selected_paths {
        let normalized_path = normalize_commit_scope_path(selected_path);
        if normalized_path.is_empty() {
            continue;
        }

        if let Some(raw_paths) = staged_by_normalized_path.get(&normalized_path) {
            for raw_path in raw_paths {
                if seen_index_paths.insert(raw_path.clone()) {
                    index_paths.push(raw_path.clone());
                }
            }
            continue;
        }

        if let Some(raw_paths) = unstaged_by_normalized_path.get(&normalized_path) {
            for raw_path in raw_paths {
                if seen_worktree_paths.insert(raw_path.clone()) {
                    worktree_only_paths.push(raw_path.clone());
                }
            }
        }
    }

    Ok(CommitScopeDiffPlan {
        index_paths,
        worktree_only_paths,
    })
}

pub(crate) fn collect_commit_scope_diff(
    repo_root: &Path,
    selected_paths: Option<&[String]>,
) -> Result<String, String> {
    let Some(explicit_selected_paths) = selected_paths else {
        return collect_workspace_diff(repo_root);
    };
    if explicit_selected_paths.is_empty() {
        return Ok(String::new());
    }

    let repo = open_repository_at_root(repo_root)?;
    let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
    let plan = build_commit_scope_diff_plan(&repo, explicit_selected_paths)?;

    let staged_diff = collect_index_diff(&repo, head_tree.as_ref(), Some(&plan.index_paths))?;
    let worktree_diff =
        collect_worktree_diff(&repo, head_tree.as_ref(), Some(&plan.worktree_only_paths))?;

    let mut segments = Vec::new();
    if !staged_diff.trim().is_empty() {
        segments.push(staged_diff);
    }
    if !worktree_diff.trim().is_empty() {
        segments.push(worktree_diff);
    }

    Ok(segments.join("\n\n"))
}
