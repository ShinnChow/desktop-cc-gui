use super::*;

const GIT_STATUS_DIFF_STATS_FILE_LIMIT: usize = 120;
const GIT_STATUS_DIFF_STATS_MAX_FILE_BYTES: u64 = 256 * 1024;

pub(super) fn build_pr_precheck_failure(reason: String, command: &str) -> GitPrWorkflowResult {
    GitPrWorkflowResult {
        ok: false,
        status: "failed".to_string(),
        message: reason.clone(),
        error_category: Some("precheck".to_string()),
        next_action_hint: Some("Fix the PR precheck failure, then retry.".to_string()),
        pr_url: None,
        pr_number: None,
        existing_pr: None,
        retry_command: None,
        range_gate: None,
        stages: vec![GitPrWorkflowStage {
            key: "precheck".to_string(),
            status: "failed".to_string(),
            detail: reason,
            command: Some(command.to_string()),
            stdout: None,
            stderr: None,
        }],
    }
}

pub(super) fn open_repository_at_root(repo_root: &Path) -> Result<git2::Repository, String> {
    git2::Repository::open_ext(
        repo_root,
        git2::RepositoryOpenFlags::NO_SEARCH,
        std::iter::empty::<&Path>(),
    )
    .map_err(|error| error.to_string())
}

fn normalize_guard_path(path: &str) -> String {
    path.replace('\\', "/").to_ascii_lowercase()
}

fn is_heavy_diff_path(path: &str) -> bool {
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

fn is_large_worktree_file(repo_root: &Path, path: &str, limit_bytes: u64) -> bool {
    let candidate = repo_root.join(path);
    match std::fs::metadata(candidate) {
        Ok(metadata) => metadata.is_file() && metadata.len() > limit_bytes,
        Err(_) => false,
    }
}

fn should_skip_diff_stats(repo_root: &Path, path: &str) -> bool {
    is_heavy_diff_path(path)
        || is_large_worktree_file(repo_root, path, GIT_STATUS_DIFF_STATS_MAX_FILE_BYTES)
}

fn status_for_index(status: git2::Status) -> Option<&'static str> {
    if status.contains(git2::Status::INDEX_NEW) {
        Some("A")
    } else if status.contains(git2::Status::INDEX_MODIFIED) {
        Some("M")
    } else if status.contains(git2::Status::INDEX_DELETED) {
        Some("D")
    } else if status.contains(git2::Status::INDEX_RENAMED) {
        Some("R")
    } else if status.contains(git2::Status::INDEX_TYPECHANGE) {
        Some("T")
    } else {
        None
    }
}

fn status_for_workdir(status: git2::Status) -> Option<&'static str> {
    if status.contains(git2::Status::WT_NEW) {
        Some("A")
    } else if status.contains(git2::Status::WT_MODIFIED) {
        Some("M")
    } else if status.contains(git2::Status::WT_DELETED) {
        Some("D")
    } else if status.contains(git2::Status::WT_RENAMED) {
        Some("R")
    } else if status.contains(git2::Status::WT_TYPECHANGE) {
        Some("T")
    } else {
        None
    }
}

fn status_for_delta(status: git2::Delta) -> &'static str {
    match status {
        git2::Delta::Added => "A",
        git2::Delta::Modified => "M",
        git2::Delta::Deleted => "D",
        git2::Delta::Renamed => "R",
        git2::Delta::Typechange => "T",
        _ => "M",
    }
}

pub(super) fn trim_optional(value: Option<String>) -> Option<String> {
    value
        .map(|entry| entry.trim().to_string())
        .filter(|entry| !entry.is_empty())
}

pub(super) fn normalize_local_branch_ref(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("refs/heads/")
        .trim()
        .to_string()
}

pub(super) fn parse_remote_branch(name: &str) -> Option<(String, String)> {
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

fn normalize_epoch_seconds(value: i64) -> i64 {
    if value.unsigned_abs() >= 1_000_000_000_000 {
        value / 1000
    } else {
        value
    }
}

fn truncate_lines(content: String, max_lines: usize) -> (String, usize, bool) {
    if max_lines == 0 {
        return (String::new(), 0, false);
    }
    let mut total_lines = 0usize;
    let mut kept_lines = Vec::new();
    let mut truncated = false;
    for line in content.lines() {
        total_lines += 1;
        if total_lines <= max_lines {
            kept_lines.push(line);
        } else {
            truncated = true;
        }
    }
    (kept_lines.join("\n"), total_lines, truncated)
}

fn first_line_or_empty(content: &str) -> String {
    content.lines().next().unwrap_or("").trim().to_string()
}

pub(super) fn csv_values(input: Option<String>) -> Vec<String> {
    trim_optional(input)
        .map(|raw| {
            raw.split(',')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

pub(super) fn parse_repo_owner(repo: &str) -> Option<String> {
    repo.split('/').next().map(str::trim).and_then(|entry| {
        if entry.is_empty() {
            None
        } else {
            Some(entry.to_string())
        }
    })
}

pub(super) fn normalize_remote_target_branch(remote: &str, raw: &str) -> String {
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

pub(super) const BRANCH_UPDATE_STATUS_SUCCESS: &str = "success";
const BRANCH_UPDATE_STATUS_NO_OP: &str = "no-op";
const BRANCH_UPDATE_STATUS_BLOCKED: &str = "blocked";
const BRANCH_UPDATE_REASON_ALREADY_UP_TO_DATE: &str = "already_up_to_date";
const BRANCH_UPDATE_REASON_AHEAD_ONLY: &str = "ahead_only";
const BRANCH_UPDATE_REASON_NO_UPSTREAM: &str = "no_upstream";
const BRANCH_UPDATE_REASON_DIVERGED: &str = "diverged";
const BRANCH_UPDATE_REASON_OCCUPIED_WORKTREE: &str = "occupied_worktree";
const BRANCH_UPDATE_REASON_STALE_REF: &str = "stale_ref";

pub(super) struct LocalBranchUpdateState {
    pub(super) branch_name: String,
    pub(super) is_current: bool,
    local_oid: git2::Oid,
    upstream_name: Option<String>,
    upstream_remote: Option<String>,
    upstream_oid: Option<git2::Oid>,
    ahead: usize,
    behind: usize,
}

pub(super) fn branch_update_result(
    branch_name: &str,
    status: &str,
    reason: Option<&str>,
    message: String,
    worktree_path: Option<String>,
) -> GitBranchUpdateResult {
    GitBranchUpdateResult {
        branch: branch_name.to_string(),
        status: status.to_string(),
        reason: reason.map(ToOwned::to_owned),
        message,
        worktree_path,
    }
}

pub(super) fn no_upstream_branch_update_result(branch_name: &str) -> GitBranchUpdateResult {
    branch_update_result(
        branch_name,
        BRANCH_UPDATE_STATUS_BLOCKED,
        Some(BRANCH_UPDATE_REASON_NO_UPSTREAM),
        format!("Branch '{branch_name}' has no upstream tracking branch configured."),
        None,
    )
}

pub(super) fn branch_update_has_upstream(state: &LocalBranchUpdateState) -> bool {
    matches!(state.upstream_name.as_deref(), Some(name) if !name.trim().is_empty())
        && matches!(state.upstream_remote.as_deref(), Some(name) if !name.trim().is_empty())
        && state.upstream_oid.is_some()
}

fn current_local_branch(repo_root: &Path) -> Result<Option<String>, String> {
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

pub(super) fn load_local_branch_update_state(
    repo_root: &Path,
    branch_name: &str,
) -> Result<LocalBranchUpdateState, String> {
    let normalized_branch = normalize_local_branch_ref(branch_name);
    if normalized_branch.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }

    let repo = open_repository_at_root(repo_root)?;
    let branch = repo
        .find_branch(normalized_branch.as_str(), git2::BranchType::Local)
        .map_err(|_| format!("Branch not found: {normalized_branch}"))?;
    let local_oid = branch
        .get()
        .target()
        .ok_or_else(|| format!("Branch '{normalized_branch}' does not point to a commit."))?;

    let mut ahead = 0usize;
    let mut behind = 0usize;
    let mut upstream_name = None;
    let mut upstream_remote = None;
    let mut upstream_oid = None;
    if let Ok(upstream_branch) = branch.upstream() {
        let upstream_ref = upstream_branch.get();
        upstream_name = upstream_ref
            .shorthand()
            .map(|name| name.to_string())
            .or_else(|| upstream_ref.name().map(|name| name.to_string()));
        upstream_remote = upstream_name
            .as_deref()
            .and_then(parse_remote_branch)
            .map(|(remote, _)| remote);
        upstream_oid = upstream_ref.target();
        if let Some(target_oid) = upstream_oid {
            if let Ok((ahead_count, behind_count)) = repo.graph_ahead_behind(local_oid, target_oid)
            {
                ahead = ahead_count;
                behind = behind_count;
            }
        }
    }

    Ok(LocalBranchUpdateState {
        branch_name: normalized_branch.clone(),
        is_current: current_local_branch(repo_root)?.as_deref() == Some(normalized_branch.as_str()),
        local_oid,
        upstream_name,
        upstream_remote,
        upstream_oid,
        ahead,
        behind,
    })
}

fn normalize_compare_path(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase()
}

async fn find_branch_worktree_path(
    repo_root: &Path,
    branch_name: &str,
) -> Result<Option<String>, String> {
    let output = git_core::run_git_command(
        &repo_root.to_path_buf(),
        &["worktree", "list", "--porcelain"],
    )
    .await?;
    let target_ref = format!("refs/heads/{branch_name}");
    let repo_root_normalized = normalize_compare_path(repo_root);
    let mut current_path: Option<String> = None;
    let mut current_branch: Option<String> = None;

    for line in output.lines().chain(std::iter::once("")) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if current_branch.as_deref() == Some(target_ref.as_str()) {
                if let Some(path) = current_path.as_ref() {
                    if normalize_compare_path(Path::new(path)) != repo_root_normalized {
                        return Ok(Some(path.clone()));
                    }
                }
            }
            current_path = None;
            current_branch = None;
            continue;
        }
        if let Some(path) = trimmed.strip_prefix("worktree ") {
            current_path = Some(path.trim().to_string());
            continue;
        }
        if let Some(branch_ref) = trimmed.strip_prefix("branch ") {
            current_branch = Some(branch_ref.trim().to_string());
        }
    }

    Ok(None)
}

fn is_stale_update_ref_error(raw: &str, branch_name: &str) -> bool {
    let normalized = raw.to_lowercase();
    normalized.contains("cannot lock ref")
        && normalized.contains(&format!("refs/heads/{}", branch_name).to_lowercase())
        && normalized.contains("expected")
}

pub(super) async fn update_non_current_local_branch(
    repo_root: &Path,
    branch_name: &str,
) -> Result<GitBranchUpdateResult, String> {
    let initial_state = load_local_branch_update_state(repo_root, branch_name)?;
    let upstream_name = match initial_state.upstream_name.as_deref() {
        Some(name) if !name.trim().is_empty() => name.to_string(),
        _ => {
            return Ok(no_upstream_branch_update_result(
                initial_state.branch_name.as_str(),
            ))
        }
    };
    let upstream_remote = match initial_state.upstream_remote.as_deref() {
        Some(name) if !name.trim().is_empty() => name.to_string(),
        _ => {
            return Ok(no_upstream_branch_update_result(
                initial_state.branch_name.as_str(),
            ))
        }
    };

    git_core::run_git_command(
        &repo_root.to_path_buf(),
        &["fetch", upstream_remote.as_str()],
    )
    .await?;

    if let Some(worktree_path) =
        find_branch_worktree_path(repo_root, initial_state.branch_name.as_str()).await?
    {
        return Ok(branch_update_result(
            initial_state.branch_name.as_str(),
            BRANCH_UPDATE_STATUS_BLOCKED,
            Some(BRANCH_UPDATE_REASON_OCCUPIED_WORKTREE),
            format!(
                "Branch '{}' is currently used by worktree at '{}'.",
                initial_state.branch_name, worktree_path
            ),
            Some(worktree_path),
        ));
    }

    let refreshed_state =
        load_local_branch_update_state(repo_root, initial_state.branch_name.as_str())?;
    let upstream_oid = match refreshed_state.upstream_oid {
        Some(oid) => oid,
        None => {
            return Ok(no_upstream_branch_update_result(
                refreshed_state.branch_name.as_str(),
            ))
        }
    };

    if refreshed_state.local_oid == upstream_oid || refreshed_state.behind == 0 {
        if refreshed_state.ahead > 0 {
            return Ok(branch_update_result(
                refreshed_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_NO_OP,
                Some(BRANCH_UPDATE_REASON_AHEAD_ONLY),
                format!(
                    "Branch '{}' is ahead of upstream '{}'; no background update is required.",
                    refreshed_state.branch_name, upstream_name
                ),
                None,
            ));
        }
        return Ok(branch_update_result(
            refreshed_state.branch_name.as_str(),
            BRANCH_UPDATE_STATUS_NO_OP,
            Some(BRANCH_UPDATE_REASON_ALREADY_UP_TO_DATE),
            format!(
                "Branch '{}' is already up to date with '{}'.",
                refreshed_state.branch_name, upstream_name
            ),
            None,
        ));
    }

    if refreshed_state.ahead > 0 && refreshed_state.behind > 0 {
        return Ok(branch_update_result(
            refreshed_state.branch_name.as_str(),
            BRANCH_UPDATE_STATUS_BLOCKED,
            Some(BRANCH_UPDATE_REASON_DIVERGED),
            format!(
                "Branch '{}' has diverged from upstream '{}'. Checkout the branch and resolve it manually.",
                refreshed_state.branch_name, upstream_name
            ),
            None,
        ));
    }

    let target_ref = format!("refs/heads/{}", refreshed_state.branch_name);
    let args_owned = [
        "update-ref".to_string(),
        target_ref,
        upstream_oid.to_string(),
        refreshed_state.local_oid.to_string(),
    ];
    let arg_refs = args_owned.iter().map(String::as_str).collect::<Vec<_>>();
    if let Err(error) = git_core::run_git_command(&repo_root.to_path_buf(), &arg_refs).await {
        if load_local_branch_update_state(repo_root, refreshed_state.branch_name.as_str())
            .map(|latest_state| latest_state.local_oid != refreshed_state.local_oid)
            .unwrap_or(false)
        {
            return Ok(branch_update_result(
                refreshed_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_BLOCKED,
                Some(BRANCH_UPDATE_REASON_STALE_REF),
                format!(
                    "Branch '{}' changed while updating. Refresh branch state and retry.",
                    refreshed_state.branch_name
                ),
                None,
            ));
        }
        if is_stale_update_ref_error(&error, refreshed_state.branch_name.as_str()) {
            return Ok(branch_update_result(
                refreshed_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_BLOCKED,
                Some(BRANCH_UPDATE_REASON_STALE_REF),
                format!(
                    "Branch '{}' changed while updating. Refresh branch state and retry.",
                    refreshed_state.branch_name
                ),
                None,
            ));
        }
        return Err(format!(
            "failed to update branch '{}': {error}",
            refreshed_state.branch_name
        ));
    }

    let verified_state =
        load_local_branch_update_state(repo_root, refreshed_state.branch_name.as_str())?;
    if verified_state.local_oid != upstream_oid {
        return Err(format!(
            "failed to verify updated branch '{}': expected {}, found {}",
            verified_state.branch_name, upstream_oid, verified_state.local_oid
        ));
    }

    Ok(branch_update_result(
        verified_state.branch_name.as_str(),
        BRANCH_UPDATE_STATUS_SUCCESS,
        None,
        format!(
            "Updated branch '{}' to upstream '{}'.",
            verified_state.branch_name, upstream_name
        ),
        None,
    ))
}

pub(super) fn parse_git_error_detail(stdout: &[u8], stderr: &[u8], fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(stderr);
    let stdout = String::from_utf8_lossy(stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    if detail.is_empty() {
        fallback.to_string()
    } else {
        detail.to_string()
    }
}

pub(super) fn extract_pr_url(stdout: &str) -> Option<String> {
    stdout
        .split_whitespace()
        .find(|entry| entry.starts_with("https://github.com/") && entry.contains("/pull/"))
        .map(ToOwned::to_owned)
}

pub(super) fn extract_pr_number(pr_url: &str) -> Option<u64> {
    pr_url
        .trim_end_matches('/')
        .split('/')
        .next_back()
        .and_then(|value| value.parse::<u64>().ok())
}

pub(super) fn parse_pr_diff_text(diff_text: &str) -> Vec<GitHubPullRequestDiff> {
    let mut results = Vec::<GitHubPullRequestDiff>::new();
    let mut current_path = String::new();
    let mut current_status = "M".to_string();
    let mut current_chunks = Vec::<String>::new();

    let flush = |path: &str,
                 status: &str,
                 chunks: &mut Vec<String>,
                 out: &mut Vec<GitHubPullRequestDiff>| {
        if path.is_empty() {
            chunks.clear();
            return;
        }
        let diff = chunks.join("\n");
        out.push(GitHubPullRequestDiff {
            path: normalize_git_path(path),
            status: status.to_string(),
            diff,
        });
        chunks.clear();
    };

    for raw_line in diff_text.lines() {
        if let Some(path) = raw_line.strip_prefix("diff --git a/") {
            flush(
                &current_path,
                &current_status,
                &mut current_chunks,
                &mut results,
            );
            let path = path.split(" b/").next().unwrap_or(path).trim().to_string();
            current_path = path;
            current_status = "M".to_string();
            continue;
        }
        if raw_line.starts_with("new file mode ") {
            current_status = "A".to_string();
        } else if raw_line.starts_with("deleted file mode ") {
            current_status = "D".to_string();
        } else if raw_line.starts_with("similarity index ") {
            current_status = "R".to_string();
        }
        current_chunks.push(raw_line.to_string());
    }
    flush(
        &current_path,
        &current_status,
        &mut current_chunks,
        &mut results,
    );
    results
}

pub(super) fn parse_patch_diff_entries(diff_text: &str) -> Vec<GitCommitDiff> {
    let mut results = Vec::<GitCommitDiff>::new();
    let mut current_path = String::new();
    let mut current_status = "M".to_string();
    let mut current_chunks = Vec::<String>::new();

    let flush =
        |path: &str, status: &str, chunks: &mut Vec<String>, out: &mut Vec<GitCommitDiff>| {
            if path.is_empty() {
                chunks.clear();
                return;
            }
            out.push(GitCommitDiff {
                path: normalize_git_path(path),
                status: status.to_string(),
                diff: chunks.join("\n"),
                is_binary: false,
                is_image: false,
                old_image_data: None,
                new_image_data: None,
                old_image_mime: None,
                new_image_mime: None,
            });
            chunks.clear();
        };

    for raw_line in diff_text.lines() {
        if let Some(path) = raw_line.strip_prefix("diff --git a/") {
            flush(
                &current_path,
                &current_status,
                &mut current_chunks,
                &mut results,
            );
            let path = path.split(" b/").next().unwrap_or(path).trim().to_string();
            current_path = path;
            current_status = "M".to_string();
            continue;
        }
        if raw_line.starts_with("new file mode ") {
            current_status = "A".to_string();
        } else if raw_line.starts_with("deleted file mode ") {
            current_status = "D".to_string();
        } else if raw_line.starts_with("similarity index ") {
            current_status = "R".to_string();
        }
        current_chunks.push(raw_line.to_string());
    }
    flush(
        &current_path,
        &current_status,
        &mut current_chunks,
        &mut results,
    );
    results
}

pub(super) fn expand_daemon_git_action_paths(
    repo_root: &Path,
    paths: &[String],
    layer: crate::git_utils::GitStatusLayer,
) -> Vec<String> {
    let mut expanded = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for path in paths {
        for action_path in crate::git_utils::git_action_paths_for_file(repo_root, path, layer) {
            if seen.insert(action_path.clone()) {
                expanded.push(action_path);
            }
        }
    }
    expanded
}

pub(super) async fn run_daemon_git_command_with_paths(
    repo_root: &PathBuf,
    prefix: &[&str],
    paths: &[String],
) -> Result<(), String> {
    if paths.is_empty() {
        return Err("path is required".to_string());
    }
    let mut args: Vec<String> = prefix.iter().map(|part| (*part).to_string()).collect();
    args.extend(paths.iter().cloned());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    git_core::run_git_command(repo_root, &arg_refs).await?;
    Ok(())
}

pub(super) fn infer_remote_head_branch(repo: &git2::Repository, remote_name: &str) -> Option<String> {
    let remote_head_ref = format!("refs/remotes/{remote_name}/HEAD");
    let reference = repo.find_reference(&remote_head_ref).ok()?;
    let target = reference.symbolic_target()?;
    target
        .strip_prefix(&format!("refs/remotes/{remote_name}/"))
        .map(|value| value.to_string())
}

impl DaemonState {
    async fn workspace_entry(&self, workspace_id: &str) -> Result<WorkspaceEntry, String> {
        let workspaces = self.workspaces.lock().await;
        workspaces
            .get(workspace_id)
            .cloned()
            .ok_or_else(|| "workspace not found".to_string())
    }

    pub(super) async fn git_repo_root(&self, workspace_id: &str) -> Result<PathBuf, String> {
        let entry = self.workspace_entry(workspace_id).await?;
        crate::git_utils::resolve_git_root(&entry)
    }

    pub(super) async fn git_repo_root_for_scope(
        &self,
        workspace_id: &str,
        repository_root: Option<&str>,
    ) -> Result<PathBuf, String> {
        let entry = self.workspace_entry(workspace_id).await?;
        crate::git_utils::resolve_git_root_for_scope(&entry, repository_root)
    }

    pub(crate) async fn list_git_roots(
        &self,
        workspace_id: String,
        depth: Option<usize>,
    ) -> Result<Vec<String>, String> {
        let entry = self.workspace_entry(&workspace_id).await?;
        let root = PathBuf::from(entry.path);
        let depth = depth.unwrap_or(2).clamp(1, 6);
        Ok(crate::git_utils::list_git_roots(&root, depth, 200))
    }

    pub(crate) async fn list_git_repository_summaries(
        &self,
        workspace_id: String,
        depth: Option<usize>,
    ) -> Result<Vec<crate::types::GitRepositorySummary>, String> {
        let entry = self.workspace_entry(&workspace_id).await?;
        let root = PathBuf::from(entry.path);
        let depth = depth.unwrap_or(2).clamp(1, 6);
        tokio::task::spawn_blocking(move || {
            crate::git_utils::list_git_repository_summaries(&root, depth, 200)
        })
        .await
        .map_err(|error| format!("Failed to scan git repositories: {error}"))
    }

    pub(crate) async fn get_git_status(
        &self,
        workspace_id: String,
        repository_root: Option<String>,
    ) -> Result<Value, String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        if !crate::git_utils::path_has_git_repository_marker(&repo_root) {
            return Ok(serde_json::json!({
                "isGitRepository": false,
                "branchName": "",
                "files": [],
                "stagedFiles": [],
                "unstagedFiles": [],
                "totalAdditions": 0,
                "totalDeletions": 0,
            }));
        }
        let repo = open_repository_at_root(&repo_root)?;
        let branch_name = repo
            .head()
            .ok()
            .and_then(|head| head.shorthand().map(|name| name.to_string()))
            .unwrap_or_else(|| "unknown".to_string());

        let mut options = git2::StatusOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .renames_head_to_index(true)
            .renames_index_to_workdir(true)
            .include_ignored(false);

        let statuses = repo
            .statuses(Some(&mut options))
            .map_err(|error| error.to_string())?;
        let should_compute_diff_stats = statuses.len() <= GIT_STATUS_DIFF_STATS_FILE_LIMIT;
        let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());

        let mut files = Vec::<GitFileStatus>::new();
        let mut staged_files = Vec::<GitFileStatus>::new();
        let mut unstaged_files = Vec::<GitFileStatus>::new();
        let mut total_additions = 0i64;
        let mut total_deletions = 0i64;

        for status_entry in statuses.iter() {
            let status = status_entry.status();
            let index_status = status_for_index(status);
            let workdir_status = status_for_workdir(status);
            let index_identity = index_status
                .is_some()
                .then(|| {
                    crate::git_utils::git_status_path_identity(
                        &status_entry,
                        crate::git_utils::GitStatusLayer::Index,
                    )
                })
                .flatten();
            let workdir_identity = workdir_status
                .is_some()
                .then(|| {
                    crate::git_utils::git_status_path_identity(
                        &status_entry,
                        crate::git_utils::GitStatusLayer::Workdir,
                    )
                })
                .flatten();
            let mut combined_additions = 0i64;
            let mut combined_deletions = 0i64;
            if let (Some(stage), Some(identity)) = (index_status, index_identity.as_ref()) {
                let should_compute_path_diff_stats = should_compute_diff_stats
                    && !should_skip_diff_stats(&repo_root, &identity.path);
                let (additions, deletions) = if should_compute_path_diff_stats {
                    crate::git_utils::diff_stats_for_identity(
                        &repo,
                        head_tree.as_ref(),
                        identity,
                        crate::git_utils::GitStatusLayer::Index,
                    )
                    .unwrap_or((0, 0))
                } else {
                    (0, 0)
                };
                staged_files.push(GitFileStatus {
                    path: identity.path.clone(),
                    old_path: identity.old_path.clone(),
                    status: stage.to_string(),
                    additions,
                    deletions,
                });
                combined_additions += additions;
                combined_deletions += deletions;
                total_additions += additions;
                total_deletions += deletions;
            }
            if let (Some(stage), Some(identity)) = (workdir_status, workdir_identity.as_ref()) {
                let should_compute_path_diff_stats = should_compute_diff_stats
                    && !should_skip_diff_stats(&repo_root, &identity.path);
                let (additions, deletions) = if should_compute_path_diff_stats {
                    crate::git_utils::diff_stats_for_identity(
                        &repo,
                        head_tree.as_ref(),
                        identity,
                        crate::git_utils::GitStatusLayer::Workdir,
                    )
                    .unwrap_or((0, 0))
                } else {
                    (0, 0)
                };
                unstaged_files.push(GitFileStatus {
                    path: identity.path.clone(),
                    old_path: identity.old_path.clone(),
                    status: stage.to_string(),
                    additions,
                    deletions,
                });
                combined_additions += additions;
                combined_deletions += deletions;
                total_additions += additions;
                total_deletions += deletions;
            }
            if let Some(identity) = workdir_identity.as_ref().or(index_identity.as_ref()) {
                files.push(GitFileStatus {
                    path: identity.path.clone(),
                    old_path: identity.old_path.clone(),
                    status: workdir_status.or(index_status).unwrap_or("--").to_string(),
                    additions: combined_additions,
                    deletions: combined_deletions,
                });
            }
        }

        Ok(json!({
            "isGitRepository": true,
            "branchName": branch_name,
            "files": files,
            "stagedFiles": staged_files,
            "unstagedFiles": unstaged_files,
            "totalAdditions": total_additions,
            "totalDeletions": total_deletions,
        }))
    }

    pub(crate) async fn get_git_diffs(
        &self,
        workspace_id: String,
        repository_root: Option<String>,
    ) -> Result<Vec<GitFileDiff>, String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        if !crate::git_utils::path_has_git_repository_marker(&repo_root) {
            return Ok(Vec::new());
        }
        tokio::task::spawn_blocking(move || {
            let repo = open_repository_at_root(&repo_root)?;
            let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());

            let mut options = git2::DiffOptions::new();
            options
                .include_untracked(true)
                .recurse_untracked_dirs(true)
                .show_untracked_content(true);

            let mut diff = match head_tree.as_ref() {
                Some(tree) => repo
                    .diff_tree_to_workdir_with_index(Some(tree), Some(&mut options))
                    .map_err(|error| error.to_string())?,
                None => repo
                    .diff_tree_to_workdir_with_index(None, Some(&mut options))
                    .map_err(|error| error.to_string())?,
            };
            crate::git_utils::find_git_diff_renames(&mut diff)
                .map_err(|error| error.to_string())?;

            let mut results = Vec::new();
            for (index, delta) in diff.deltas().enumerate() {
                let path = delta.new_file().path().or_else(|| delta.old_file().path());
                let Some(path) = path else {
                    continue;
                };
                let normalized_path = normalize_git_path(&path.to_string_lossy());
                let patch =
                    git2::Patch::from_diff(&diff, index).map_err(|error| error.to_string())?;
                if let Some(mut patch) = patch {
                    let content =
                        crate::git_utils::diff_patch_to_string(&mut patch).unwrap_or_default();
                    if content.trim().is_empty() {
                        continue;
                    }
                    results.push(GitFileDiff {
                        path: normalized_path,
                        diff: content,
                        is_binary: false,
                        is_image: false,
                        old_image_data: None,
                        new_image_data: None,
                        old_image_mime: None,
                        new_image_mime: None,
                    });
                } else {
                    results.push(GitFileDiff {
                        path: normalized_path,
                        diff: String::new(),
                        is_binary: true,
                        is_image: false,
                        old_image_data: None,
                        new_image_data: None,
                        old_image_mime: None,
                        new_image_mime: None,
                    });
                }
            }
            Ok(results)
        })
        .await
        .map_err(|error| error.to_string())?
    }

    pub(crate) async fn get_git_file_full_diff(
        &self,
        workspace_id: String,
        path: String,
        repository_root: Option<String>,
    ) -> Result<String, String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let trimmed_path = path.trim();
        if trimmed_path.is_empty() {
            return Err("path is required".to_string());
        }
        let diff_paths = crate::git_utils::git_diff_paths_for_file(&repo_root, trimmed_path);
        let mut diff_head_args = vec!["diff", "--find-renames", "HEAD", "--"];
        diff_head_args.extend(diff_paths.iter().map(String::as_str));
        let diff_head = git_core::run_git_diff(&repo_root, &diff_head_args).await;
        let mut content = match diff_head {
            Ok(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            Err(_) => String::new(),
        };
        if content.trim().is_empty() {
            let mut workdir_args = vec!["diff", "--find-renames", "--"];
            workdir_args.extend(diff_paths.iter().map(String::as_str));
            if let Ok(bytes) = git_core::run_git_diff(&repo_root, &workdir_args).await {
                content = String::from_utf8_lossy(&bytes).to_string();
            }
            let mut staged_args = vec!["diff", "--find-renames", "--cached", "--"];
            staged_args.extend(diff_paths.iter().map(String::as_str));
            if let Ok(bytes) = git_core::run_git_diff(&repo_root, &staged_args).await {
                let staged = String::from_utf8_lossy(&bytes).to_string();
                if !staged.trim().is_empty() {
                    if !content.trim().is_empty() {
                        content.push_str("\n\n");
                    }
                    content.push_str(&staged);
                }
            }
        }
        Ok(content)
    }

    pub(crate) async fn get_git_file_blame(
        &self,
        workspace_id: String,
        path: String,
        repository_root: Option<String>,
    ) -> Result<GitFileBlameResponse, String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        tokio::task::spawn_blocking(move || {
            crate::git_utils::build_git_file_blame(&repo_root, &path)
        })
        .await
        .map_err(|error| format!("Git blame worker failed: {error}"))?
    }

    pub(crate) async fn get_git_log(
        &self,
        workspace_id: String,
        limit: Option<usize>,
    ) -> Result<GitLogResponse, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo = open_repository_at_root(&repo_root)?;
        let head = repo
            .head()
            .map_err(|error| error.to_string())?
            .target()
            .ok_or_else(|| "HEAD does not point to a commit".to_string())?;
        let limit = limit.unwrap_or(40).clamp(1, 400);
        let mut revwalk = repo.revwalk().map_err(|error| error.to_string())?;
        revwalk
            .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
            .map_err(|error| error.to_string())?;
        revwalk.push(head).map_err(|error| error.to_string())?;
        let mut entries = Vec::<GitLogEntry>::new();
        for oid_result in revwalk.take(limit) {
            let oid = oid_result.map_err(|error| error.to_string())?;
            let commit = repo.find_commit(oid).map_err(|error| error.to_string())?;
            entries.push(crate::git_utils::commit_to_entry(commit));
        }
        Ok(GitLogResponse {
            total: entries.len(),
            entries,
            ahead: 0,
            behind: 0,
            ahead_entries: Vec::new(),
            behind_entries: Vec::new(),
            upstream: None,
            payload_budget: None,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn get_git_commit_history(
        &self,
        workspace_id: String,
        branch: Option<String>,
        query: Option<String>,
        author: Option<String>,
        date_from: Option<i64>,
        date_to: Option<i64>,
        snapshot_id: Option<String>,
        path: Option<String>,
        offset: usize,
        limit: usize,
        repository_root: Option<String>,
    ) -> Result<GitHistoryResponse, String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let query = trim_optional(query).map(|entry| entry.to_lowercase());
        let author = trim_optional(author).map(|entry| entry.to_lowercase());
        let date_from = date_from.map(normalize_epoch_seconds);
        let date_to = date_to.map(normalize_epoch_seconds);
        let offset = offset.min(50_000);
        let limit = limit.clamp(1, 500);
        let branch = trim_optional(branch);
        let path = path
            .as_deref()
            .map(git_core::normalize_file_history_path)
            .transpose()?;
        let file_history_entries = if let Some(path) = path.as_deref() {
            Some(git_core::list_file_history_entries(&repo_root, branch.as_deref(), path).await?)
        } else {
            None
        };
        let repo = open_repository_at_root(&repo_root)?;
        let mut historical_paths = HashMap::new();
        let history_oids = match file_history_entries {
            Some(entries) => entries
                .into_iter()
                .map(|entry| {
                    let oid = git2::Oid::from_str(&entry.oid).map_err(|error| error.to_string())?;
                    historical_paths.insert(oid, entry.path);
                    Ok(oid)
                })
                .collect::<Result<Vec<_>, String>>()?,
            None => {
                let mut revwalk = repo.revwalk().map_err(|error| error.to_string())?;
                revwalk
                    .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
                    .map_err(|error| error.to_string())?;
                git_core::push_git_history_branch_scope(&repo, &mut revwalk, branch.as_deref())?;
                revwalk
                    .map(|oid| oid.map_err(|error| error.to_string()))
                    .collect::<Result<Vec<_>, _>>()?
            }
        };
        let mut filtered = Vec::<GitHistoryCommit>::new();
        for oid in history_oids {
            let commit = repo.find_commit(oid).map_err(|error| error.to_string())?;
            let timestamp = commit.time().seconds();
            if let Some(lower_bound) = date_from {
                if timestamp < lower_bound {
                    continue;
                }
            }
            if let Some(upper_bound) = date_to {
                if timestamp > upper_bound {
                    continue;
                }
            }

            let summary = commit.summary().unwrap_or("").to_string();
            let message = commit.message().unwrap_or("").to_string();
            let author_name = commit.author().name().unwrap_or("").to_string();
            let author_email = commit.author().email().unwrap_or("").to_string();
            let searchable = format!(
                "{}\n{}\n{}\n{}",
                summary.to_lowercase(),
                message.to_lowercase(),
                author_name.to_lowercase(),
                author_email.to_lowercase()
            );
            if let Some(ref query_text) = query {
                if !searchable.contains(query_text) && !oid.to_string().contains(query_text) {
                    continue;
                }
            }
            if let Some(ref author_text) = author {
                let haystack = format!(
                    "{} {}",
                    author_name.to_lowercase(),
                    author_email.to_lowercase()
                );
                if !haystack.contains(author_text) {
                    continue;
                }
            }
            let sha = oid.to_string();
            let short_sha = sha.chars().take(7).collect::<String>();
            let parents = commit
                .parents()
                .map(|parent| parent.id().to_string())
                .collect();
            filtered.push(GitHistoryCommit {
                sha,
                short_sha,
                summary,
                message,
                author: author_name,
                author_email,
                timestamp,
                parents,
                refs: Vec::new(),
                file_path: historical_paths.get(&oid).cloned(),
            });
        }

        let total = filtered.len();
        let commits: Vec<GitHistoryCommit> =
            filtered.into_iter().skip(offset).take(limit).collect();
        let has_more = offset.saturating_add(commits.len()) < total;
        let head_sha = repo
            .head()
            .ok()
            .and_then(|head| head.target())
            .map(|oid| oid.to_string())
            .unwrap_or_else(|| "detached".to_string());
        let current_snapshot_id = git_core::build_git_history_snapshot_id(
            &head_sha,
            branch.as_deref(),
            query.as_deref(),
            author.as_deref(),
            date_from,
            date_to,
            repository_root.as_deref(),
            path.as_deref(),
        );
        if trim_optional(snapshot_id).is_some_and(|value| value != current_snapshot_id) {
            return Err("History snapshot expired. Please refresh commits.".to_string());
        }
        Ok(GitHistoryResponse {
            snapshot_id: current_snapshot_id,
            total,
            offset,
            limit,
            has_more,
            commits,
        })
    }

    pub(crate) async fn resolve_git_commit_ref(
        &self,
        workspace_id: String,
        target: String,
    ) -> Result<String, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let normalized = target.trim();
        if normalized.is_empty() {
            return Err("target is required".to_string());
        }
        let output = git_core::run_git_command(
            &repo_root,
            &["rev-parse", "--verify", &format!("{normalized}^{{commit}}")],
        )
        .await?;
        Ok(first_line_or_empty(&output))
    }

    pub(crate) async fn get_git_commit_details(
        &self,
        workspace_id: String,
        commit_hash: String,
        max_diff_lines: usize,
        repository_root: Option<String>,
    ) -> Result<GitCommitDetails, String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let repo = open_repository_at_root(&repo_root)?;
        let target = commit_hash.trim();
        if target.is_empty() {
            return Err("commit hash is required".to_string());
        }
        let object = repo
            .revparse_single(target)
            .map_err(|error| error.to_string())?;
        let commit = object.peel_to_commit().map_err(|error| error.to_string())?;
        let tree = commit.tree().map_err(|error| error.to_string())?;
        let parent_tree = if commit.parent_count() > 0 {
            Some(
                commit
                    .parent(0)
                    .map_err(|error| error.to_string())?
                    .tree()
                    .map_err(|error| error.to_string())?,
            )
        } else {
            None
        };
        let mut options = git2::DiffOptions::new();
        let diff = repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))
            .map_err(|error| error.to_string())?;

        let mut files = Vec::<GitCommitFileChange>::new();
        let mut total_additions = 0i64;
        let mut total_deletions = 0i64;
        for (index, delta) in diff.deltas().enumerate() {
            let old_path = delta
                .old_file()
                .path()
                .map(|path| normalize_git_path(&path.to_string_lossy()));
            let new_path = delta
                .new_file()
                .path()
                .map(|path| normalize_git_path(&path.to_string_lossy()));
            let display_path = new_path
                .clone()
                .or_else(|| old_path.clone())
                .unwrap_or_default();
            if display_path.is_empty() {
                continue;
            }
            let status = status_for_delta(delta.status()).to_string();
            let patch = git2::Patch::from_diff(&diff, index).map_err(|error| error.to_string())?;
            if let Some(mut patch) = patch {
                let raw_content =
                    crate::git_utils::diff_patch_to_string(&mut patch).unwrap_or_default();
                let (diff_content, line_count, truncated) =
                    truncate_lines(raw_content, max_diff_lines.max(1));
                let (_, additions, deletions) = patch.line_stats().unwrap_or((0, 0, 0));
                total_additions += additions as i64;
                total_deletions += deletions as i64;
                files.push(GitCommitFileChange {
                    path: display_path,
                    old_path: old_path
                        .filter(|value| *value != new_path.clone().unwrap_or_default()),
                    status,
                    additions: additions as i64,
                    deletions: deletions as i64,
                    is_binary: false,
                    is_image: false,
                    diff: diff_content,
                    line_count,
                    truncated,
                });
            } else {
                files.push(GitCommitFileChange {
                    path: display_path,
                    old_path: old_path
                        .filter(|value| *value != new_path.clone().unwrap_or_default()),
                    status,
                    additions: 0,
                    deletions: 0,
                    is_binary: true,
                    is_image: false,
                    diff: String::new(),
                    line_count: 0,
                    truncated: false,
                });
            }
        }

        let author_signature = commit.author();
        let committer_signature = commit.committer();
        let parents = commit
            .parents()
            .map(|parent| parent.id().to_string())
            .collect();
        let details = GitCommitDetails {
            sha: commit.id().to_string(),
            summary: commit.summary().unwrap_or("").to_string(),
            message: commit.message().unwrap_or("").to_string(),
            author: author_signature.name().unwrap_or("").to_string(),
            author_email: author_signature.email().unwrap_or("").to_string(),
            committer: committer_signature.name().unwrap_or("").to_string(),
            committer_email: committer_signature.email().unwrap_or("").to_string(),
            author_time: author_signature.when().seconds(),
            commit_time: committer_signature.when().seconds(),
            parents,
            files,
            total_additions,
            total_deletions,
        };
        Ok(details)
    }

    pub(crate) async fn get_git_commit_diff(
        &self,
        workspace_id: String,
        sha: String,
        path: Option<String>,
        context_lines: Option<usize>,
        repository_root: Option<String>,
    ) -> Result<Vec<GitCommitDiff>, String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let repo = open_repository_at_root(&repo_root)?;
        let target = sha.trim();
        if target.is_empty() {
            return Err("sha is required".to_string());
        }
        let object = repo
            .revparse_single(target)
            .map_err(|error| error.to_string())?;
        let commit = object.peel_to_commit().map_err(|error| error.to_string())?;
        let tree = commit.tree().map_err(|error| error.to_string())?;
        let parent_tree = if commit.parent_count() > 0 {
            Some(
                commit
                    .parent(0)
                    .map_err(|error| error.to_string())?
                    .tree()
                    .map_err(|error| error.to_string())?,
            )
        } else {
            None
        };
        let mut options = git2::DiffOptions::new();
        if let Some(lines) = context_lines {
            options.context_lines(lines as u32);
        }
        if let Some(path_filter) = trim_optional(path) {
            options.pathspec(path_filter);
        }
        let diff = repo
            .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut options))
            .map_err(|error| error.to_string())?;

        let mut files = Vec::<GitCommitDiff>::new();
        for (index, delta) in diff.deltas().enumerate() {
            let old_path = delta.old_file().path();
            let new_path = delta.new_file().path();
            let display_path = new_path
                .or(old_path)
                .map(|path| normalize_git_path(&path.to_string_lossy()))
                .unwrap_or_default();
            if display_path.is_empty() {
                continue;
            }
            let status = status_for_delta(delta.status()).to_string();
            if let Some(image_diff) = crate::git_utils::build_image_commit_diff(
                &repo,
                parent_tree.as_ref(),
                &tree,
                &delta,
                &status,
            ) {
                files.push(image_diff);
                continue;
            }
            let patch = git2::Patch::from_diff(&diff, index).map_err(|error| error.to_string())?;
            if let Some(mut patch) = patch {
                let content =
                    crate::git_utils::diff_patch_to_string(&mut patch).unwrap_or_default();
                files.push(GitCommitDiff {
                    path: display_path,
                    status,
                    diff: content,
                    is_binary: false,
                    is_image: false,
                    old_image_data: None,
                    new_image_data: None,
                    old_image_mime: None,
                    new_image_mime: None,
                });
            } else {
                files.push(GitCommitDiff {
                    path: display_path,
                    status,
                    diff: String::new(),
                    is_binary: true,
                    is_image: false,
                    old_image_data: None,
                    new_image_data: None,
                    old_image_mime: None,
                    new_image_mime: None,
                });
            }
        }
        Ok(files)
    }

    pub(crate) async fn get_git_remote(
        &self,
        workspace_id: String,
    ) -> Result<Option<String>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        match git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"]).await {
            Ok(value) => {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    Ok(None)
                } else {
                    Ok(Some(trimmed))
                }
            }
            Err(_) => Ok(None),
        }
    }
}

#[cfg(test)]
mod pr_precheck_tests {
    use super::*;

    #[test]
    fn daemon_pr_precheck_failure_is_structured() {
        let result =
            build_pr_precheck_failure("fetch failed".to_string(), "git fetch upstream main");

        assert!(!result.ok);
        assert_eq!(result.status, "failed");
        assert_eq!(result.error_category.as_deref(), Some("precheck"));
        assert!(result.range_gate.is_none());
        assert_eq!(result.stages.len(), 1);
        assert_eq!(result.stages[0].key, "precheck");
        assert_eq!(result.stages[0].status, "failed");
    }
}
