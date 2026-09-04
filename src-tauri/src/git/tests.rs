use super::*;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use git2::{BranchType, Oid, Repository, Sort, Status, StatusOptions};
use serde_json::json;
use super::remote_forward::GIT_REMOTE_FORWARDING_MATRIX;
use crate::types::{GitBlameHunk, GitLogEntry};
use serde_json::Value;
use std::fs;
use super::validation::validate_local_branch_name;

#[test]
fn git_remote_forwarding_matrix_has_unique_daemon_methods() {
    let mut methods = GIT_REMOTE_FORWARDING_MATRIX
        .iter()
        .map(|entry| entry.method)
        .collect::<Vec<_>>();
    methods.sort_unstable();
    methods.dedup();
    assert_eq!(
        methods.len(),
        GIT_REMOTE_FORWARDING_MATRIX.len(),
        "Git remote forwarding matrix contains duplicate methods"
    );

    let daemon_dispatch = include_str!("../bin/cc_gui_daemon.rs");
    let mut categories = HashSet::new();
    for entry in GIT_REMOTE_FORWARDING_MATRIX {
        categories.insert(entry.category);
        assert_eq!(entry.forwarding, "implemented");
        assert!(!entry.desktop_module.trim().is_empty());
        assert!(!entry.coverage.trim().is_empty());
        assert!(
            daemon_dispatch.contains(&format!("\"{}\" =>", entry.daemon_dispatch)),
            "daemon dispatch is missing Git remote method {}",
            entry.daemon_dispatch
        );
    }
    for category in ["read", "history", "write", "branch", "worktree", "github"] {
        assert!(
            categories.contains(category),
            "Git remote forwarding matrix is missing category {category}"
        );
    }
}

#[test]
fn pull_request_content_generation_remote_mode_fails_closed() {
    let command_source = include_str!("commands.rs");
    let command = command_source
        .split("pub(crate) async fn generate_pull_request_content(")
        .nth(1)
        .expect("PR content generation command");
    assert!(command.contains("PR content generation is unavailable in remote mode"));
    assert!(!command.contains("\"generate_pull_request_content\","));
}

#[test]
fn git_file_blame_daemon_contract_preserves_payload_and_response_shape() {
    let daemon_dispatch = include_str!("../bin/cc_gui_daemon.rs");
    let blame_arm = daemon_dispatch
        .split("\"get_git_file_blame\" => {")
        .nth(1)
        .and_then(|tail| tail.split("\"get_git_log\" => {").next())
        .expect("daemon blame dispatch arm");
    for payload_field in ["workspaceId", "path", "repositoryRoot"] {
        assert!(
            blame_arm.contains(payload_field),
            "daemon blame dispatch is missing payload field {payload_field}"
        );
    }
    assert!(blame_arm.contains("serde_json::to_value(response)"));

    let response = GitFileBlameResponse {
        path: "src/main.rs".to_string(),
        head_sha: "abc123".to_string(),
        line_count: 2,
        hunks: vec![GitBlameHunk {
            start_line: 1,
            line_count: 2,
            commit_sha: "abc123".to_string(),
            author: "Ada".to_string(),
            authored_at: 1_700_000_000,
            summary: "Initial commit".to_string(),
            original_path: None,
        }],
    };
    let value = serde_json::to_value(&response).expect("serialize blame response");
    assert_eq!(value.get("headSha").and_then(Value::as_str), Some("abc123"));
    assert_eq!(value.get("lineCount").and_then(Value::as_u64), Some(2));
    let hunk = value
        .get("hunks")
        .and_then(Value::as_array)
        .and_then(|hunks| hunks.first())
        .expect("serialized blame hunk");
    assert_eq!(hunk.get("startLine").and_then(Value::as_u64), Some(1));
    assert_eq!(
        hunk.get("authoredAt").and_then(Value::as_i64),
        Some(1_700_000_000)
    );
    assert_eq!(
        serde_json::from_value::<GitFileBlameResponse>(value).expect("deserialize blame response"),
        response
    );
}

#[test]
fn git_log_payload_budget_serializes_content_safe_metadata() {
    let response = GitLogResponse {
        total: 10,
        entries: vec![GitLogEntry {
            sha: "abc123".to_string(),
            summary: "summary".to_string(),
            author: "author".to_string(),
            timestamp: 1,
        }],
        ahead: 0,
        behind: 0,
        ahead_entries: Vec::new(),
        behind_entries: Vec::new(),
        upstream: None,
        payload_budget: Some(PayloadBudgetMetadata {
            command: "get_git_log".to_string(),
            surface_id: "git-history-log".to_string(),
            item_count: 1,
            estimated_bytes: 64,
            partial: true,
            truncated: true,
            cache_state: ScanCacheState::Unsupported,
            evidence_class: "proxy".to_string(),
        }),
    };

    let value = serde_json::to_value(response).expect("serialize response");
    let budget = value
        .get("payloadBudget")
        .and_then(|entry| entry.as_object())
        .expect("payload budget object");
    assert_eq!(
        budget.get("command").and_then(|entry| entry.as_str()),
        Some("get_git_log")
    );
    assert_eq!(
        budget.get("itemCount").and_then(|entry| entry.as_u64()),
        Some(1)
    );
    assert!(budget.get("absolutePath").is_none());
    assert!(budget.get("prompt").is_none());
    assert!(budget.get("toolOutput").is_none());
}

fn create_temp_repo() -> (PathBuf, Repository) {
    let root = std::env::temp_dir().join(format!("moss-x-test-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).expect("create temp repo root");
    let repo = Repository::init(&root).expect("init repo");
    (root, repo)
}

async fn commit_all_with_message(repo_root: &Path, message: &str) {
    run_git_command(repo_root, &["add", "-A"])
        .await
        .expect("stage files");
    run_git_command(
        repo_root,
        &[
            "-c",
            "user.name=TestUser",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            message,
        ],
    )
    .await
    .expect("commit staged files");
}

fn assert_worktree_clean(repo_root: &Path) {
    let repo = open_repository_at_root(repo_root).expect("open repo");
    let mut status_options = StatusOptions::new();
    status_options
        .include_untracked(true)
        .recurse_untracked_dirs(true)
        .include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut status_options))
        .expect("collect statuses");
    assert!(
        statuses.is_empty(),
        "expected clean worktree, found {} entries",
        statuses.len()
    );
}

#[tokio::test]
async fn checkout_roundtrip_between_divergent_branches_stays_clean() {
    let (root, _repo) = create_temp_repo();

    fs::write(root.join("shared.txt"), "main base\n").expect("write initial main file");
    commit_all_with_message(&root, "init main").await;
    run_git_command(&root, &["branch", "-M", "main"])
        .await
        .expect("rename default branch to main");

    run_git_command(&root, &["checkout", "-b", "feature/divergent"])
        .await
        .expect("create feature branch");
    fs::remove_file(root.join("shared.txt")).expect("remove shared file on feature branch");
    fs::write(root.join("feature-only.txt"), "feature branch content\n")
        .expect("write feature-only file");
    commit_all_with_message(&root, "feature commit").await;

    run_git_command(&root, &["checkout", "main"])
        .await
        .expect("switch back to main");
    fs::write(root.join("shared.txt"), "main updated\n").expect("rewrite shared file on main");
    fs::write(root.join("main-only.txt"), "main branch content\n").expect("write main-only file");
    commit_all_with_message(&root, "main commit").await;

    for target in ["feature/divergent", "main", "feature/divergent", "main"] {
        run_git_command(&root, &["checkout", target])
            .await
            .unwrap_or_else(|error| panic!("checkout {target} failed: {error}"));
        assert_worktree_clean(&root);
    }
}

#[tokio::test]
async fn file_history_follows_root_file_rename() {
    let (root, _repo) = create_temp_repo();
    fs::write(root.join("before.txt"), "first\n").expect("write original file");
    commit_all_with_message(&root, "create original").await;
    fs::rename(root.join("before.txt"), root.join("after.txt")).expect("rename file");
    commit_all_with_message(&root, "rename file").await;
    fs::write(root.join("after.txt"), "first\nsecond\n").expect("edit renamed file");
    commit_all_with_message(&root, "edit renamed file").await;

    let entries = crate::shared::git_core::list_file_history_entries(&root, None, "after.txt")
        .await
        .expect("list file history");

    assert_eq!(entries.len(), 3);
    assert!(entries.iter().all(|entry| entry.oid.len() == 40));
    assert_eq!(entries[0].path, "after.txt");
    assert_eq!(entries[1].path, "after.txt");
    assert_eq!(entries[2].path, "before.txt");

    let option_like_ref =
        crate::shared::git_core::list_file_history_oids(&root, Some("--no-walk"), "after.txt")
            .await;
    assert!(option_like_ref.is_err());
}

#[test]
fn file_history_rejects_invalid_paths() {
    for path in [
        "",
        "/absolute.txt",
        "../outside.txt",
        "src/../../outside.txt",
    ] {
        assert!(crate::shared::git_core::normalize_file_history_path(path).is_err());
    }
    assert_eq!(
        crate::shared::git_core::normalize_file_history_path("src\\main.rs")
            .expect("normalize Windows path"),
        "src/main.rs"
    );
}

#[test]
fn file_history_path_participates_in_snapshot_identity() {
    let first = crate::shared::git_core::build_git_history_snapshot_id(
        "head",
        None,
        None,
        None,
        None,
        None,
        Some("packages/app"),
        Some("src/first.ts"),
    );
    let second = crate::shared::git_core::build_git_history_snapshot_id(
        "head",
        None,
        None,
        None,
        None,
        None,
        Some("packages/app"),
        Some("src/second.ts"),
    );
    assert_ne!(first, second);
}

#[test]
fn collect_workspace_diff_prefers_staged_changes() {
    let (root, repo) = create_temp_repo();
    let file_path = root.join("staged.txt");
    fs::write(&file_path, "staged\n").expect("write staged file");
    let mut index = repo.index().expect("index");
    index.add_path(Path::new("staged.txt")).expect("add path");
    index.write().expect("write index");

    let diff = collect_workspace_diff(&root).expect("collect diff");
    assert!(diff.contains("staged.txt"));
    assert!(diff.contains("staged"));
}

#[test]
fn collect_workspace_diff_falls_back_to_workdir() {
    let (root, _repo) = create_temp_repo();
    let file_path = root.join("unstaged.txt");
    fs::write(&file_path, "unstaged\n").expect("write unstaged file");

    let diff = collect_workspace_diff(&root).expect("collect diff");
    assert!(diff.contains("unstaged.txt"));
    assert!(diff.contains("unstaged"));
}

#[test]
fn collect_commit_scope_diff_limits_selected_staged_files() {
    let (root, repo) = create_temp_repo();
    fs::write(root.join("selected.txt"), "selected\n").expect("write selected file");
    fs::write(root.join("ignored.txt"), "ignored\n").expect("write ignored file");

    let mut index = repo.index().expect("repo index");
    index
        .add_path(Path::new("selected.txt"))
        .expect("stage selected file");
    index
        .add_path(Path::new("ignored.txt"))
        .expect("stage ignored file");
    index.write().expect("write index");

    let selected_paths = vec!["selected.txt".to_string()];
    let diff =
        collect_commit_scope_diff(&root, Some(&selected_paths)).expect("collect scoped diff");
    assert!(diff.contains("selected.txt"));
    assert!(!diff.contains("ignored.txt"));
}

#[test]
fn collect_commit_scope_diff_includes_selected_unstaged_only_file() {
    let (root, _repo) = create_temp_repo();
    fs::write(root.join("selected.txt"), "selected\n").expect("write selected file");
    fs::write(root.join("ignored.txt"), "ignored\n").expect("write ignored file");

    let selected_paths = vec!["selected.txt".to_string()];
    let diff =
        collect_commit_scope_diff(&root, Some(&selected_paths)).expect("collect scoped diff");
    assert!(diff.contains("selected.txt"));
    assert!(!diff.contains("ignored.txt"));
}

#[tokio::test]
async fn collect_commit_scope_diff_uses_only_staged_portion_for_hybrid_path() {
    let (root, _repo) = create_temp_repo();
    fs::write(root.join("hybrid.txt"), "before\n").expect("write initial file");
    commit_all_with_message(&root, "init hybrid").await;

    fs::write(root.join("hybrid.txt"), "staged only\n").expect("write staged content");
    run_git_command(&root, &["add", "--", "hybrid.txt"])
        .await
        .expect("stage hybrid file");
    fs::write(root.join("hybrid.txt"), "staged only\nunstaged extra\n")
        .expect("write unstaged tail");

    let selected_paths = vec!["hybrid.txt".to_string()];
    let diff =
        collect_commit_scope_diff(&root, Some(&selected_paths)).expect("collect scoped diff");
    assert!(diff.contains("hybrid.txt"));
    assert!(diff.contains("staged only"));
    assert!(!diff.contains("unstaged extra"));
}

#[test]
fn collect_commit_scope_diff_normalizes_windows_style_selected_paths() {
    let (root, _repo) = create_temp_repo();
    let nested_dir = root.join("src").join("feature");
    fs::create_dir_all(&nested_dir).expect("create nested dir");
    fs::write(nested_dir.join("file.ts"), "console.log('hi');\n").expect("write nested file");
    fs::write(root.join("ignored.ts"), "console.log('ignored');\n").expect("write sibling file");

    let selected_paths = vec!["src\\feature\\file.ts".to_string()];
    let diff =
        collect_commit_scope_diff(&root, Some(&selected_paths)).expect("collect scoped diff");
    assert!(diff.contains("src/feature/file.ts"));
    assert!(!diff.contains("ignored.ts"));
}

#[test]
fn collect_commit_scope_diff_resolves_staged_rename_destination() {
    let (root, repo) = create_temp_repo();
    fs::write(root.join("before.txt"), "rename content\n").expect("write source file");
    let mut index = repo.index().expect("repo index");
    index
        .add_path(Path::new("before.txt"))
        .expect("stage source file");
    let tree_id = index.write_tree().expect("write source tree");
    let tree = repo.find_tree(tree_id).expect("find source tree");
    let signature = git2::Signature::now("Test", "test@example.com").expect("signature");
    repo.commit(Some("HEAD"), &signature, &signature, "init", &tree, &[])
        .expect("commit source file");
    drop(tree);

    fs::rename(root.join("before.txt"), root.join("after.txt")).expect("rename source file");
    let mut index = repo.index().expect("repo index");
    index
        .remove_path(Path::new("before.txt"))
        .expect("remove source path");
    index
        .add_path(Path::new("after.txt"))
        .expect("stage destination path");
    index.write().expect("write renamed index");

    let selected_paths = vec!["after.txt".to_string()];
    let diff =
        collect_commit_scope_diff(&root, Some(&selected_paths)).expect("collect rename diff");

    assert!(diff.contains("before.txt"));
    assert!(diff.contains("after.txt"));
}

#[test]
fn collect_commit_scope_diff_keeps_staged_first_fallback_without_explicit_scope() {
    let (root, repo) = create_temp_repo();
    fs::write(root.join("staged.txt"), "staged\n").expect("write staged file");
    fs::write(root.join("unstaged.txt"), "unstaged\n").expect("write unstaged file");

    let mut index = repo.index().expect("repo index");
    index
        .add_path(Path::new("staged.txt"))
        .expect("stage staged file");
    index.write().expect("write index");

    let diff = collect_commit_scope_diff(&root, None).expect("collect scoped diff");
    assert!(diff.contains("staged.txt"));
    assert!(!diff.contains("unstaged.txt"));
}

#[test]
fn collect_commit_scope_diff_returns_empty_for_explicit_empty_scope() {
    let (root, repo) = create_temp_repo();
    fs::write(root.join("staged.txt"), "staged\n").expect("write staged file");

    let mut index = repo.index().expect("repo index");
    index
        .add_path(Path::new("staged.txt"))
        .expect("stage staged file");
    index.write().expect("write index");

    let explicit_empty: Vec<String> = Vec::new();
    let diff =
        collect_commit_scope_diff(&root, Some(&explicit_empty)).expect("collect scoped diff");
    assert!(diff.trim().is_empty());
}

#[test]
fn heavy_diff_path_guard_matches_lockfiles_and_generated_dirs() {
    assert!(is_heavy_diff_path("pnpm-lock.yaml"));
    assert!(is_heavy_diff_path(
        "packages/web/node_modules/lodash/index.js"
    ));
    assert!(is_heavy_diff_path("dist/main.bundle.js"));
    assert!(!is_heavy_diff_path("src/features/git/mod.rs"));
}

#[test]
fn truncate_diff_preview_respects_line_and_byte_budgets() {
    let mut content = String::new();
    for _ in 0..20 {
        content.push_str("0123456789abcdef\n");
    }
    let trimmed = truncate_diff_preview(content, 4, 40);
    assert!(trimmed.contains("[diff truncated for performance]"));
    assert!(trimmed.lines().count() <= 6);
    assert!(trimmed.len() <= 80);
}

#[test]
fn action_paths_for_file_expands_renames() {
    let (root, repo) = create_temp_repo();
    fs::write(root.join("a.txt"), "hello\n").expect("write file");

    let mut index = repo.index().expect("repo index");
    index.add_path(Path::new("a.txt")).expect("add path");
    let tree_id = index.write_tree().expect("write tree");
    let tree = repo.find_tree(tree_id).expect("find tree");
    let sig = git2::Signature::now("Test", "test@example.com").expect("signature");
    repo.commit(Some("HEAD"), &sig, &sig, "init", &tree, &[])
        .expect("commit");

    fs::rename(root.join("a.txt"), root.join("b.txt")).expect("rename file");

    // Stage the rename so libgit2 reports it as an INDEX_RENAMED entry.
    let mut index = repo.index().expect("repo index");
    index
        .remove_path(Path::new("a.txt"))
        .expect("remove old path");
    index.add_path(Path::new("b.txt")).expect("add new path");
    index.write().expect("write index");

    let paths = action_paths_for_file(&root, "b.txt", GitStatusLayer::Index);
    assert_eq!(paths, vec!["a.txt".to_string(), "b.txt".to_string()]);
}

#[tokio::test]
async fn chained_rename_stage_and_unstage_mutate_the_intended_layer() {
    let (stage_root, _stage_repo) = create_temp_repo();
    fs::write(stage_root.join("a.txt"), "hello\n").expect("write staged fixture");
    commit_all_with_message(&stage_root, "init staged fixture").await;
    run_git_command(&stage_root, &["mv", "a.txt", "b.txt"])
        .await
        .expect("stage a to b rename");
    fs::rename(stage_root.join("b.txt"), stage_root.join("c.txt"))
        .expect("rename b to c in workdir");

    for path in action_paths_for_file(&stage_root, "c.txt", GitStatusLayer::Workdir) {
        run_git_command(&stage_root, &["add", "-A", "--", &path])
            .await
            .expect("stage workdir rename path");
    }
    let stage_index = open_repository_at_root(&stage_root)
        .expect("open staged repo")
        .index()
        .expect("open staged index");
    assert!(stage_index.get_path(Path::new("a.txt"), 0).is_none());
    assert!(stage_index.get_path(Path::new("b.txt"), 0).is_none());
    assert!(stage_index.get_path(Path::new("c.txt"), 0).is_some());

    let (unstage_root, _unstage_repo) = create_temp_repo();
    fs::write(unstage_root.join("a.txt"), "hello\n").expect("write unstaged fixture");
    commit_all_with_message(&unstage_root, "init unstaged fixture").await;
    run_git_command(&unstage_root, &["mv", "a.txt", "b.txt"])
        .await
        .expect("stage a to b rename");
    fs::rename(unstage_root.join("b.txt"), unstage_root.join("c.txt"))
        .expect("rename b to c in workdir");

    for path in action_paths_for_file(&unstage_root, "b.txt", GitStatusLayer::Index) {
        run_git_command(&unstage_root, &["restore", "--staged", "--", &path])
            .await
            .expect("unstage index rename path");
    }
    let unstage_index = open_repository_at_root(&unstage_root)
        .expect("open unstaged repo")
        .index()
        .expect("open unstaged index");
    assert!(unstage_index.get_path(Path::new("a.txt"), 0).is_some());
    assert!(unstage_index.get_path(Path::new("b.txt"), 0).is_none());
    assert!(unstage_index.get_path(Path::new("c.txt"), 0).is_none());
}

fn index_blob_text(repo_root: &Path, path: &str) -> String {
    let repo = open_repository_at_root(repo_root).expect("open repo");
    let index = repo.index().expect("open index");
    let entry = index
        .get_path(Path::new(path), 0)
        .unwrap_or_else(|| panic!("missing index path {path}"));
    let blob = repo.find_blob(entry.id).expect("find index blob");
    String::from_utf8(blob.content().to_vec()).expect("index blob utf8")
}

#[tokio::test]
async fn unstaged_restore_keeps_staged_hunks_on_mixed_file() {
    let (root, _repo) = create_temp_repo();
    fs::write(root.join("mixed.txt"), "head\n").expect("write head content");
    commit_all_with_message(&root, "init mixed fixture").await;

    fs::write(root.join("mixed.txt"), "staged\n").expect("write staged content");
    run_git_command(&root, &["add", "--", "mixed.txt"])
        .await
        .expect("stage mixed file");
    fs::write(root.join("mixed.txt"), "unstaged\n").expect("write unstaged content");

    for path in action_paths_for_file(&root, "mixed.txt", GitStatusLayer::Workdir) {
        run_git_command(&root, &["restore", "--worktree", "--", &path])
            .await
            .expect("restore unstaged worktree");
    }

    assert_eq!(
        fs::read_to_string(root.join("mixed.txt")).expect("read worktree"),
        "staged\n"
    );
    assert_eq!(index_blob_text(&root, "mixed.txt"), "staged\n");

    let repo = open_repository_at_root(&root).expect("open mixed repo");
    let mut status_options = StatusOptions::new();
    status_options
        .include_untracked(true)
        .include_ignored(false);
    let statuses = repo
        .statuses(Some(&mut status_options))
        .expect("collect mixed statuses");
    let entry = statuses
        .iter()
        .find(|entry| entry.path() == Some("mixed.txt"))
        .expect("mixed.txt status");
    assert!(
        entry.status().contains(Status::INDEX_MODIFIED),
        "staged hunks must remain after unstaged discard"
    );
    assert!(
        !entry
            .status()
            .intersects(Status::WT_MODIFIED | Status::WT_DELETED | Status::WT_NEW),
        "working tree must match the index after unstaged discard"
    );
}

#[tokio::test]
async fn unstaged_restore_leaves_untracked_for_clean_fallback() {
    let (root, _repo) = create_temp_repo();
    fs::write(root.join("tracked.txt"), "tracked\n").expect("write tracked content");
    commit_all_with_message(&root, "init untracked fixture").await;
    fs::write(root.join("scratch.txt"), "untracked\n").expect("write untracked file");

    let restore_result =
        run_git_command(&root, &["restore", "--worktree", "--", "scratch.txt"]).await;
    assert!(
        restore_result.is_err(),
        "untracked paths should fail restore so discard can fall back to clean"
    );
    run_git_command(&root, &["clean", "-f", "--", "scratch.txt"])
        .await
        .expect("clean untracked path");
    assert!(!root.join("scratch.txt").exists());
    assert_eq!(
        fs::read_to_string(root.join("tracked.txt")).expect("read tracked file"),
        "tracked\n"
    );
}

#[tokio::test]
async fn revert_all_still_discards_staged_and_unstaged() {
    let (root, _repo) = create_temp_repo();
    fs::write(root.join("keep.txt"), "head\n").expect("write head content");
    commit_all_with_message(&root, "init revert-all fixture").await;
    fs::write(root.join("keep.txt"), "staged\n").expect("write staged content");
    run_git_command(&root, &["add", "--", "keep.txt"])
        .await
        .expect("stage keep file");
    fs::write(root.join("keep.txt"), "unstaged\n").expect("write unstaged content");
    fs::write(root.join("scratch.txt"), "untracked\n").expect("write untracked file");

    run_git_command(&root, &["restore", "--staged", "--worktree", "--", "."])
        .await
        .expect("revert all restore");
    run_git_command(&root, &["clean", "-f", "-d"])
        .await
        .expect("revert all clean");

    assert_eq!(
        fs::read_to_string(root.join("keep.txt")).expect("read after revert all"),
        "head\n"
    );
    assert!(!root.join("scratch.txt").exists());
    assert_worktree_clean(&root);
}

#[test]
fn open_repository_at_root_does_not_search_parent_directories() {
    let (root, _repo) = create_temp_repo();
    let nested = root.join("nested").join("non-repo");
    fs::create_dir_all(&nested).expect("create nested directory");

    let result = open_repository_at_root(&nested);
    assert!(result.is_err());
}

#[test]
fn paginate_history_commits_respects_offset_and_limit() {
    let commits = (0..5)
        .map(|index| GitHistoryCommit {
            sha: format!("sha-{index}"),
            short_sha: format!("s{index}"),
            summary: format!("commit-{index}"),
            message: format!("message-{index}"),
            author: "tester".to_string(),
            author_email: "tester@example.com".to_string(),
            timestamp: 100 + index as i64,
            parents: Vec::new(),
            refs: Vec::new(),
            file_path: None,
        })
        .collect::<Vec<_>>();
    let (page, total, has_more) = paginate_history_commits(commits, 2, 2);
    assert_eq!(total, 5);
    assert_eq!(page.len(), 2);
    assert_eq!(page[0].sha, "sha-2");
    assert_eq!(page[1].sha, "sha-3");
    assert!(has_more);
}

#[test]
fn validate_local_branch_name_allows_slash_and_rejects_invalid() {
    assert_eq!(
        validate_local_branch_name("feature/git-log").expect("valid branch"),
        "feature/git-log".to_string()
    );
    assert!(validate_local_branch_name("feature..broken").is_err());
}

#[test]
fn detect_used_by_worktree_delete_error() {
    let message = "error: cannot delete branch 'feature/test' used by worktree at '/tmp/worktree'";
    assert!(is_branch_used_by_worktree_error(message));
    assert_eq!(
        extract_worktree_path_from_delete_error(message).as_deref(),
        Some("/tmp/worktree")
    );
}

#[test]
fn build_actionable_used_by_worktree_error_with_path() {
    let message = "error: cannot delete branch 'feature/test' used by worktree at '/tmp/worktree'";
    let friendly = build_delete_branch_worktree_error("feature/test", message);
    assert!(friendly.contains("Switch that worktree to another branch"));
    assert!(friendly.contains("/tmp/worktree"));
}

#[test]
fn token_isolated_command_display_includes_env_unset_prefix() {
    let rendered = build_token_isolated_command_display(
        "git",
        &[
            "push".to_string(),
            "-u".to_string(),
            "origin".to_string(),
            "HEAD:feature/a".to_string(),
        ],
    );
    assert!(rendered.starts_with("env -u GH_TOKEN -u GITHUB_TOKEN"));
    assert!(rendered.contains("git push -u origin HEAD:feature/a"));
}

#[test]
fn detect_http2_transport_error_signature() {
    let message = "error: RPC failed; curl 16 Error in the HTTP2 framing layer";
    assert!(is_http2_transport_error(message));
}

#[test]
fn parse_pr_number_from_url_works() {
    assert_eq!(
        extract_pr_number_from_url("https://github.com/a/b/pull/123"),
        Some(123)
    );
    assert_eq!(
        extract_pr_number_from_url("https://github.com/a/b/pull/456/files"),
        Some(456)
    );
    assert_eq!(
        extract_pr_number_from_url("https://github.com/a/b/issues/1"),
        None
    );
}

#[test]
fn range_gate_passes_normal_threshold() {
    let range_fingerprint = "base-revision...head-revision";
    let paths = (0..range_gate::PR_RANGE_MAX_CHANGED_FILES)
        .map(|index| format!("src/file-{index}.ts"))
        .collect::<Vec<_>>();
    let decision = evaluate_pr_range_gate(&paths, false, None, range_fingerprint);
    assert!(matches!(
        decision,
        PrRangeGateDecision::Pass { changed_files }
            if changed_files == range_gate::PR_RANGE_MAX_CHANGED_FILES
    ));
}

#[test]
fn range_gate_requires_confirmation_above_normal_threshold() {
    let range_fingerprint = "base-revision...head-revision";
    for changed_files in [
        range_gate::PR_RANGE_MAX_CHANGED_FILES + 1,
        range_gate::PR_RANGE_COMPLETE_DIFF_MAX_FILES,
    ] {
        let paths = (0..changed_files)
            .map(|index| format!("src/file-{index}.ts"))
            .collect::<Vec<_>>();
        let decision = evaluate_pr_range_gate(&paths, false, None, range_fingerprint);
        assert!(matches!(
            decision,
            PrRangeGateDecision::ConfirmationRequired {
                range_gate: GitPrRangeGate {
                    severity: GitPrRangeGateSeverity::Large,
                    range_fingerprint: fingerprint,
                    ..
                },
                ..
            } if fingerprint == range_fingerprint
        ));
    }
}

#[test]
fn range_gate_warns_when_github_diff_will_be_incomplete() {
    let range_fingerprint = "base-revision...head-revision";
    let paths = (0..(range_gate::PR_RANGE_COMPLETE_DIFF_MAX_FILES + 1))
        .map(|index| format!("src/file-{index}.ts"))
        .collect::<Vec<_>>();
    let decision = evaluate_pr_range_gate(&paths, false, None, range_fingerprint);
    assert!(matches!(
        decision,
        PrRangeGateDecision::ConfirmationRequired {
            range_gate: GitPrRangeGate {
                severity: GitPrRangeGateSeverity::DiffIncomplete,
                ..
            },
            ..
        }
    ));
    assert!(matches!(
        evaluate_pr_range_gate(
            &paths,
            true,
            Some(range_fingerprint),
            range_fingerprint
        ),
        PrRangeGateDecision::Pass { changed_files }
            if changed_files == range_gate::PR_RANGE_COMPLETE_DIFF_MAX_FILES + 1
    ));
    assert!(matches!(
        evaluate_pr_range_gate(
            &paths,
            true,
            Some("stale-base...stale-head"),
            range_fingerprint
        ),
        PrRangeGateDecision::ConfirmationRequired { .. }
    ));
}

#[test]
fn range_gate_override_cannot_bypass_structural_anomalies() {
    let range_fingerprint = "base-revision...head-revision";
    assert!(matches!(
        evaluate_pr_range_gate(
            &[],
            true,
            Some(range_fingerprint),
            range_fingerprint
        ),
        PrRangeGateDecision::Blocked { category, .. } if category == "range-empty"
    ));

    let mut paths = (0..range_gate::PR_RANGE_SUSPICIOUS_THRESHOLD)
        .map(|index| format!("src/file-{index}.ts"))
        .collect::<Vec<_>>();
    paths.push("README.md".to_string());
    let decision = evaluate_pr_range_gate(&paths, true, Some(range_fingerprint), range_fingerprint);
    assert!(matches!(
        decision,
        PrRangeGateDecision::Blocked { category, .. } if category == "range-suspicious"
    ));
}

#[test]
fn range_fingerprint_requires_exactly_base_and_head_revisions() {
    assert_eq!(
        parse_pr_range_fingerprint("base-revision\nhead-revision\n"),
        Some("base-revision...head-revision".to_string())
    );
    assert_eq!(parse_pr_range_fingerprint("base-only\n"), None);
    assert_eq!(parse_pr_range_fingerprint("base\nhead\nunexpected\n"), None);
}
