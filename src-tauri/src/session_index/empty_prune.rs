//! Stale empty native session GC.
//!
//! Sidebar placeholders (`grok session`, UUID titles, …) are real Index + disk
//! rows created when an engine opens a session before the first user prompt.
//! This module deletes those rows after 10 minutes iff disk confirms there is
//! still no real user prompt. Shared and unconfirmed engines are skipped.

use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde_json::Value;

use std::time::Duration;

use super::store::{list_for_workspace_path, now_ms, SessionIndexRow};
use super::writers::{
    claude_value_has_media_part, extract_text_preview, is_claude_control_or_synthetic_user_text,
    is_claude_user_or_human_entry, is_mossx_shared_protocol_owner_text, read_jsonl_line_capped,
    should_omit_codex_index_title, JsonlLine,
};
use crate::claude_home::resolve_effective_claude_home;
use crate::engine::claude_history::encode_project_path;
use crate::engine::dsh::history::DshLatestUserPeek;
use crate::engine::dsh::host::DshHostClient;
use crate::engine::grok_history::{
    candidate_encoded_cwd_names, first_user_prompt_from_line, resolve_grok_base_dir,
    session_dir_looks_valid,
};
use crate::engine::pi_history::{locate_pi_family_session_file, scan_pi_jsonl_user_prompt, PiUserPromptScan};
use crate::state::AppState;
use std::sync::Arc;

pub(crate) const STALE_EMPTY_SESSION_AGE_MS: i64 = 10 * 60 * 1000;
pub(crate) const PRUNE_SCAN_LIMIT: usize = 200;
pub(crate) const PRUNE_DELETE_CAP: usize = 20;
const DSH_CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const DSH_PEEK_TIMEOUT: Duration = Duration::from_secs(2);
const DSH_PRUNE_BUDGET: Duration = Duration::from_secs(3);

const ENGINE_SESSION_PREFIXES: &[&str] = &[
    "claude session",
    "codex session",
    "gemini session",
    "grok session",
    "kimi session",
    "opencode session",
    "pi session",
    "omp session",
    "dsh session",
];
const JSONL_SCAN_LINE_LIMIT: usize = 80;
const JSONL_LINE_BYTE_CAP: usize = 256 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PruneTarget {
    pub engine: String,
    pub session_id: String,
    /// False = disk file already gone; only tombstone the Index row.
    pub delete_disk: bool,
    pub physical_path: Option<String>,
}

pub(crate) fn should_run_stale_empty_prune(is_keyset_page: bool) -> bool {
    !is_keyset_page
}

pub(crate) fn is_placeholder_session_title(title: &str, session_id: &str) -> bool {
    let title = title.trim();
    let session_id = session_id.trim();
    if title.is_empty() {
        return true;
    }
    if !session_id.is_empty() && title.eq_ignore_ascii_case(session_id) {
        return true;
    }
    let lower = title.to_ascii_lowercase();
    if lower == "deepseek harness session" || lower == "warmup" {
        return true;
    }
    is_ordinal_agent_title(&lower)
        || is_short_hex_title(&lower)
        || is_engine_session_placeholder(&lower)
        || is_control_plane_placeholder_title(title)
}

fn is_engine_session_placeholder(lower: &str) -> bool {
    ENGINE_SESSION_PREFIXES.iter().any(|prefix| {
        if lower == *prefix {
            return true;
        }
        lower
            .strip_prefix(prefix)
            .map(str::trim)
            .is_some_and(is_hex_or_uuid_token)
    })
}

fn is_ordinal_agent_title(lower: &str) -> bool {
    lower
        .strip_prefix("agent ")
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|ch| ch.is_ascii_digit()))
}

fn is_short_hex_title(lower: &str) -> bool {
    let len = lower.len();
    (4..=8).contains(&len) && lower.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn is_hex_or_uuid_token(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    if value.chars().all(|ch| ch.is_ascii_hexdigit()) && (4..=40).contains(&value.len()) {
        return true;
    }
    let parts: Vec<&str> = value.split('-').collect();
    parts.len() == 5
        && parts
            .iter()
            .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_hexdigit()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UserPromptScan {
    HasUser,
    ScannedEmpty,
    Unknown,
}

fn is_control_plane_placeholder_title(title: &str) -> bool {
    let lower = title.trim().to_ascii_lowercase();
    lower.starts_with("mossx_")
        || lower.starts_with("<command-")
        || lower.starts_with("<local-command-")
        || lower.starts_with("<project-memory")
        || lower.starts_with("<user_info")
        || lower.starts_with("<rules")
        || lower.starts_with("<git_status")
        || lower.starts_with("<system-reminder")
        || lower.starts_with("<open_and_recently_viewed_files")
        || lower.starts_with("<agent_skills")
        || lower.starts_with("<mcp_servers")
        || lower.starts_with("<image_compression_notice")
        || lower.starts_with("<goal_round")
        || lower.starts_with("<available_skills")
        || lower.starts_with("current runtime context.")
        || lower.starts_with("current runtime context:")
}

pub(crate) fn stale_age_anchor(created_at: Option<i64>, updated_at: i64) -> i64 {
    created_at
        .filter(|value| *value > 0)
        .unwrap_or(updated_at.max(0))
}

pub(crate) fn is_stale_empty_age(anchor_ms: i64, now: i64) -> bool {
    now.saturating_sub(anchor_ms) >= STALE_EMPTY_SESSION_AGE_MS
}

#[derive(Debug, Default)]
pub(crate) struct EmptyPrunePlan {
    pub targets: Vec<PruneTarget>,
    pub dsh_session_ids: Vec<String>,
}

pub(crate) fn collect_confirmed_empty_targets(
    connection: &Connection,
    workspace_path: &str,
    now: i64,
) -> Result<Vec<PruneTarget>, String> {
    Ok(collect_empty_prune_plan(connection, workspace_path, now)?.targets)
}

pub(crate) fn collect_empty_prune_plan(
    connection: &Connection,
    workspace_path: &str,
    now: i64,
) -> Result<EmptyPrunePlan, String> {
    let rows = list_for_workspace_path(connection, workspace_path, PRUNE_SCAN_LIMIT, false)?;
    let workspace = PathBuf::from(workspace_path);
    let mut plan = EmptyPrunePlan::default();
    for row in rows {
        if plan.targets.len() + plan.dsh_session_ids.len() >= PRUNE_DELETE_CAP {
            break;
        }
        if !is_prune_engine(&row.engine) {
            continue;
        }
        if !is_placeholder_session_title(&row.title, &row.session_id) {
            continue;
        }
        // Index 为 protocol hide 保留 MOSSX_CONTEXT_PACKAGE 标题；这不是空草稿。
        if is_mossx_shared_protocol_owner_text(&row.title) {
            continue;
        }
        let anchor = stale_age_anchor(row.created_at, row.updated_at);
        if !is_stale_empty_age(anchor, now) {
            continue;
        }
        // Client "new session" drafts are written to Index before any engine
        // file exists. Locator miss here is not Unknown — the pending id is
        // the confirmation that there is no disk artifact to keep.
        if is_local_pending_draft_id(&row.engine, &row.session_id) {
            plan.targets.push(PruneTarget {
                engine: row.engine.clone(),
                session_id: row.session_id.clone(),
                delete_disk: false,
                physical_path: None,
            });
            continue;
        }
        if row.engine == "dsh" {
            plan.dsh_session_ids.push(row.session_id.clone());
            continue;
        }
        match confirm_disk_empty(&row, &workspace) {
            DiskEmptyVerdict::Empty {
                delete_disk,
                confirmed_path,
            } => plan.targets.push(PruneTarget {
                engine: row.engine.clone(),
                session_id: row.session_id.clone(),
                delete_disk,
                physical_path: confirmed_path
                    .map(|path| path.to_string_lossy().into_owned())
                    .or_else(|| row.physical_path.clone()),
            }),
            DiskEmptyVerdict::HasContent | DiskEmptyVerdict::Unknown => {}
        }
    }
    Ok(plan)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DiskEmptyVerdict {
    Empty {
        delete_disk: bool,
        confirmed_path: Option<PathBuf>,
    },
    HasContent,
    Unknown,
}

fn is_prune_engine(engine: &str) -> bool {
    matches!(
        engine,
        // qoder history is ACP-based with no vendor disk sessions root
        // (add-qoder-engine design: skip prune/fingerprint wiring).
        "claude" | "codex" | "gemini" | "grok" | "kimi" | "pi" | "omp" | "dsh"
    )
}

/// `{engine}-pending-{millis}-{nonce}` from `writeClientCreatedSessionIndex`.
/// Shared (`-pending-shared-`) and subagent placeholders are not drafts.
pub(crate) fn is_local_pending_draft_id(engine: &str, session_id: &str) -> bool {
    let engine = engine.trim();
    let session_id = session_id.trim();
    if engine.is_empty() || session_id.is_empty() {
        return false;
    }
    let Some(rest) = session_id
        .strip_prefix(engine)
        .and_then(|value| value.strip_prefix("-pending-"))
    else {
        return false;
    };
    if rest.starts_with("shared-") || rest.starts_with("subagent:") {
        return false;
    }
    let Some((timestamp, nonce)) = rest.split_once('-') else {
        return false;
    };
    (10..=16).contains(&timestamp.len())
        && timestamp.chars().all(|ch| ch.is_ascii_digit())
        && (4..=12).contains(&nonce.len())
        && nonce.chars().all(|ch| ch.is_ascii_alphanumeric())
}

fn confirm_disk_empty(row: &SessionIndexRow, workspace_path: &Path) -> DiskEmptyVerdict {
    match row.engine.as_str() {
        "claude" => confirm_claude_empty(row, workspace_path),
        "grok" => confirm_grok_empty(row, workspace_path),
        "pi" => confirm_pi_empty(row, workspace_path),
        "omp" => confirm_omp_empty(row, workspace_path),
        "codex" => confirm_codex_empty(row),
        "gemini" | "kimi" => confirm_physical_path_empty(row),
        _ => DiskEmptyVerdict::Unknown,
    }
}

fn confirm_claude_empty(row: &SessionIndexRow, workspace_path: &Path) -> DiskEmptyVerdict {
    let candidates = claude_jsonl_candidates(row, workspace_path);
    if candidates.is_empty() {
        return DiskEmptyVerdict::Unknown;
    }
    let mut empty_path = None;
    let mut saw_unknown = false;
    for path in candidates {
        if !path.is_file() {
            continue;
        }
        match scan_claude_jsonl_user_prompt(&path) {
            UserPromptScan::HasUser => return DiskEmptyVerdict::HasContent,
            UserPromptScan::ScannedEmpty => empty_path = Some(path),
            UserPromptScan::Unknown => saw_unknown = true,
        }
    }
    if saw_unknown {
        return DiskEmptyVerdict::Unknown;
    }
    if let Some(confirmed_path) = empty_path {
        DiskEmptyVerdict::Empty {
            delete_disk: true,
            confirmed_path: Some(confirmed_path),
        }
    } else {
        // Missing reconstructed file is not proof of empty — skip (do not tombstone).
        DiskEmptyVerdict::Unknown
    }
}

fn scan_claude_jsonl_user_prompt(path: &Path) -> UserPromptScan {
    let Ok(file) = File::open(path) else {
        return UserPromptScan::Unknown;
    };
    let mut reader = BufReader::new(file);
    let mut reached_eof = false;
    for _ in 0..JSONL_SCAN_LINE_LIMIT {
        match read_jsonl_line_capped(&mut reader, JSONL_LINE_BYTE_CAP) {
            Ok(Some(JsonlLine::Text(line))) => {
                let Ok(value) = serde_json::from_str::<Value>(&line) else {
                    continue;
                };
                match claude_entry_user_prompt_verdict(&value) {
                    UserPromptScan::HasUser => return UserPromptScan::HasUser,
                    UserPromptScan::ScannedEmpty | UserPromptScan::Unknown => {}
                }
            }
            Ok(Some(JsonlLine::SkippedHuge)) => {}
            Ok(None) => {
                reached_eof = true;
                break;
            }
            Err(_) => return UserPromptScan::Unknown,
        }
    }
    if reached_eof {
        UserPromptScan::ScannedEmpty
    } else {
        UserPromptScan::Unknown
    }
}

fn claude_entry_user_prompt_verdict(value: &Value) -> UserPromptScan {
    if !is_claude_user_or_human_entry(value) {
        return UserPromptScan::ScannedEmpty;
    }
    if claude_value_has_media_part(value) {
        return UserPromptScan::HasUser;
    }
    let Some(text) = extract_text_preview(value) else {
        return UserPromptScan::ScannedEmpty;
    };
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return UserPromptScan::ScannedEmpty;
    }
    if is_mossx_shared_protocol_owner_text(trimmed) {
        return UserPromptScan::HasUser;
    }
    if is_claude_control_or_synthetic_user_text(trimmed) {
        return UserPromptScan::ScannedEmpty;
    }
    UserPromptScan::HasUser
}

fn claude_jsonl_candidates(row: &SessionIndexRow, workspace_path: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Some(physical) = row
        .physical_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        paths.push(PathBuf::from(physical));
    }
    let session_id = row.session_id.trim();
    if session_id.is_empty() {
        return paths;
    }
    let filename = format!("{session_id}.jsonl");
    for home in claude_home_candidates() {
        let encoded = encode_project_path(&workspace_path.to_string_lossy());
        paths.push(home.join("projects").join(&encoded).join(&filename));
    }
    paths
}

fn claude_home_candidates() -> Vec<PathBuf> {
    let mut homes = Vec::new();
    if let Some(configured) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        if !configured.is_empty() {
            homes.push(PathBuf::from(configured));
        }
    }
    if let Some(effective) = resolve_effective_claude_home(None) {
        if !homes.iter().any(|home| home == &effective) {
            homes.push(effective);
        }
    }
    homes
}

fn confirm_grok_empty(row: &SessionIndexRow, workspace_path: &Path) -> DiskEmptyVerdict {
    let Some(session_dir) = locate_grok_session_dir(workspace_path, &row.session_id) else {
        return DiskEmptyVerdict::Unknown;
    };
    let chat_history = session_dir.join("chat_history.jsonl");
    if !chat_history.is_file() {
        return DiskEmptyVerdict::Unknown;
    }
    match scan_grok_chat_history(&chat_history) {
        UserPromptScan::HasUser => DiskEmptyVerdict::HasContent,
        UserPromptScan::ScannedEmpty => DiskEmptyVerdict::Empty {
            delete_disk: true,
            confirmed_path: Some(session_dir),
        },
        UserPromptScan::Unknown => DiskEmptyVerdict::Unknown,
    }
}

fn locate_grok_session_dir(workspace_path: &Path, session_id: &str) -> Option<PathBuf> {
    let session_id = session_id.trim();
    if session_id.is_empty() || session_id.contains('/') || session_id.contains('\\') {
        return None;
    }
    let sessions_root = resolve_grok_base_dir(None).join("sessions");
    for encoded_cwd in candidate_encoded_cwd_names(workspace_path) {
        let candidate = sessions_root.join(encoded_cwd).join(session_id);
        if session_dir_looks_valid(&candidate) {
            return Some(candidate);
        }
    }
    // Encoding drift: session id is unique; scan sibling cwd dirs before giving up.
    let Ok(dirs) = std::fs::read_dir(&sessions_root) else {
        return None;
    };
    for entry in dirs.flatten().take(128) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let candidate = path.join(session_id);
        if session_dir_looks_valid(&candidate) {
            return Some(candidate);
        }
    }
    None
}

fn confirm_pi_empty(row: &SessionIndexRow, workspace_path: &Path) -> DiskEmptyVerdict {
    confirm_pi_family_empty(crate::engine::EngineType::Pi, row, workspace_path)
}

fn confirm_omp_empty(row: &SessionIndexRow, workspace_path: &Path) -> DiskEmptyVerdict {
    confirm_pi_family_empty(crate::engine::EngineType::Omp, row, workspace_path)
}

fn confirm_pi_family_empty(
    engine: crate::engine::EngineType,
    row: &SessionIndexRow,
    workspace_path: &Path,
) -> DiskEmptyVerdict {
    let Some(path) = locate_pi_family_session_file(engine, workspace_path, &row.session_id) else {
        return DiskEmptyVerdict::Unknown;
    };
    match scan_pi_jsonl_user_prompt(&path) {
        PiUserPromptScan::HasUser => DiskEmptyVerdict::HasContent,
        PiUserPromptScan::ScannedEmpty => DiskEmptyVerdict::Empty {
            delete_disk: true,
            confirmed_path: Some(path),
        },
        PiUserPromptScan::Unknown => DiskEmptyVerdict::Unknown,
    }
}

fn scan_grok_chat_history(path: &Path) -> UserPromptScan {
    let Ok(file) = File::open(path) else {
        return UserPromptScan::Unknown;
    };
    let mut reader = BufReader::new(file);
    let mut reached_eof = false;
    for _ in 0..JSONL_SCAN_LINE_LIMIT {
        match read_jsonl_line_capped(&mut reader, JSONL_LINE_BYTE_CAP) {
            Ok(Some(JsonlLine::Text(line))) => {
                if first_user_prompt_from_line(&line).is_some() {
                    return UserPromptScan::HasUser;
                }
            }
            Ok(Some(JsonlLine::SkippedHuge)) => {}
            Ok(None) => {
                reached_eof = true;
                break;
            }
            Err(_) => return UserPromptScan::Unknown,
        }
    }
    if reached_eof {
        UserPromptScan::ScannedEmpty
    } else {
        UserPromptScan::Unknown
    }
}

fn confirm_physical_path_empty(row: &SessionIndexRow) -> DiskEmptyVerdict {
    let Some(physical) = row
        .physical_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return DiskEmptyVerdict::Unknown;
    };
    let path = Path::new(physical);
    if !path.exists() {
        return DiskEmptyVerdict::Empty {
            delete_disk: false,
            confirmed_path: None,
        };
    }
    if !path.is_file() {
        return DiskEmptyVerdict::Unknown;
    }
    let size = match std::fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(_) => return DiskEmptyVerdict::Unknown,
    };
    if size == 0 {
        return DiskEmptyVerdict::Empty {
            delete_disk: true,
            confirmed_path: Some(path.to_path_buf()),
        };
    }
    DiskEmptyVerdict::Unknown
}

fn confirm_codex_empty(row: &SessionIndexRow) -> DiskEmptyVerdict {
    let Some(physical) = row
        .physical_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return DiskEmptyVerdict::Unknown;
    };
    let path = Path::new(physical);
    if !path.exists() {
        return DiskEmptyVerdict::Empty {
            delete_disk: false,
            confirmed_path: None,
        };
    }
    if !path.is_file() {
        return DiskEmptyVerdict::Unknown;
    }
    let size = match std::fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(_) => return DiskEmptyVerdict::Unknown,
    };
    if size == 0 {
        return DiskEmptyVerdict::Empty {
            delete_disk: true,
            confirmed_path: Some(path.to_path_buf()),
        };
    }
    match crate::local_usage::peek_codex_session_titles(path) {
        Ok(peeked) => {
            let title = peeked
                .and_then(|(native, summary)| native.or(summary))
                .unwrap_or_else(|| "Codex Session".to_string());
            if should_omit_codex_index_title(&title) {
                DiskEmptyVerdict::Empty {
                    delete_disk: false,
                    confirmed_path: Some(path.to_path_buf()),
                }
            } else {
                DiskEmptyVerdict::HasContent
            }
        }
        Err(_) => DiskEmptyVerdict::Unknown,
    }
}

pub(crate) async fn prune_stale_empty_native_sessions(
    workspace_path: &str,
    state: Option<&AppState>,
) {
    let path = workspace_path.to_string();
    let plan = match tokio::task::spawn_blocking(move || {
        let connection = super::store::open_connection()?;
        collect_empty_prune_plan(&connection, &path, now_ms())
    })
    .await
    {
        Ok(Ok(plan)) => plan,
        Ok(Err(error)) => {
            log::warn!("[session_index.empty_prune] collect failed: {error}");
            return;
        }
        Err(error) => {
            log::warn!("[session_index.empty_prune] collect join failed: {error}");
            return;
        }
    };
    let mut targets = plan.targets;
    log::info!(
        "[session_index.empty_prune] workspace={workspace_path} disk_or_pending={} dsh_queue={}",
        targets.len(),
        plan.dsh_session_ids.len()
    );
    let dsh_client = if plan.dsh_session_ids.is_empty() {
        None
    } else {
        confirm_dsh_empty_targets(state, plan.dsh_session_ids, &mut targets).await
    };
    if targets.is_empty() {
        return;
    }

    let workspace = PathBuf::from(workspace_path);
    let mut tombstones = Vec::new();
    let mut hard_deletes = Vec::new();
    for target in targets {
        if !still_empty_before_delete(&target) {
            continue;
        }
        let deleted = if target.delete_disk {
            delete_engine_session(&workspace, &target, dsh_client.as_ref()).await
        } else {
            true
        };
        if !deleted {
            continue;
        }
        // Codex session_meta-only files stay on disk. Tombstone would block a
        // later upsert when the same session grows a real user prompt.
        if target.engine == "codex" {
            hard_deletes.push((target.engine, target.session_id));
        } else {
            tombstones.push((target.engine, target.session_id));
        }
    }
    if tombstones.is_empty() && hard_deletes.is_empty() {
        return;
    }
    let tombstone_count = tombstones.len();
    let hard_delete_count = hard_deletes.len();
    match tokio::task::spawn_blocking(move || {
        let connection = super::store::open_connection()?;
        if !tombstones.is_empty() {
            super::store::tombstone_engine_sessions(&connection, &tombstones)?;
        }
        if !hard_deletes.is_empty() {
            super::store::delete_engine_session_rows(&connection, &hard_deletes)?;
        }
        Ok::<(), String>(())
    })
    .await
    {
        Ok(Ok(())) => {
            log::info!(
                "[session_index.empty_prune] workspace={workspace_path} tombstoned={tombstone_count} hard_deleted={hard_delete_count}"
            );
        }
        Ok(Err(error)) => {
            log::warn!("[session_index.empty_prune] index cleanup failed: {error}");
        }
        Err(error) => {
            log::warn!("[session_index.empty_prune] index cleanup join failed: {error}");
        }
    }
}

fn still_empty_before_delete(target: &PruneTarget) -> bool {
    if is_local_pending_draft_id(&target.engine, &target.session_id) {
        return true;
    }
    match target.engine.as_str() {
        "dsh" => true,
        "claude" => match target_physical_path(target) {
            Some(path) => matches!(
                scan_claude_jsonl_user_prompt(&path),
                UserPromptScan::ScannedEmpty
            ),
            None => false,
        },
        "grok" => match target_physical_path(target) {
            Some(dir) => matches!(
                scan_grok_chat_history(&dir.join("chat_history.jsonl")),
                UserPromptScan::ScannedEmpty
            ),
            None => false,
        },
        "pi" | "omp" => match target_physical_path(target) {
            Some(path) => matches!(
                scan_pi_jsonl_user_prompt(&path),
                PiUserPromptScan::ScannedEmpty
            ),
            None => false,
        },
        "codex" => still_codex_empty(target),
        "gemini" | "kimi" => still_zero_byte_or_missing(target),
        _ => false,
    }
}

fn target_physical_path(target: &PruneTarget) -> Option<PathBuf> {
    target
        .physical_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn still_zero_byte_or_missing(target: &PruneTarget) -> bool {
    let Some(path) = target_physical_path(target) else {
        return false;
    };
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_file() && meta.len() == 0 => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        _ => false,
    }
}

fn still_codex_empty(target: &PruneTarget) -> bool {
    let Some(path) = target_physical_path(target) else {
        return false;
    };
    match std::fs::metadata(&path) {
        Ok(meta) if meta.is_file() && meta.len() == 0 => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Ok(meta) if meta.is_file() => match crate::local_usage::peek_codex_session_titles(&path) {
            Ok(peeked) => {
                let title = peeked
                    .and_then(|(native, summary)| native.or(summary))
                    .unwrap_or_else(|| "Codex Session".to_string());
                should_omit_codex_index_title(&title)
            }
            Err(_) => false,
        },
        _ => false,
    }
}

async fn confirm_dsh_empty_targets(
    state: Option<&AppState>,
    session_ids: Vec<String>,
    targets: &mut Vec<PruneTarget>,
) -> Option<Arc<DshHostClient>> {
    let state = state?;
    let remaining = PRUNE_DELETE_CAP.saturating_sub(targets.len());
    if remaining == 0 {
        return None;
    }
    let settings = state.app_settings.lock().await.clone();
    let runtime = crate::engine::dsh::runtime_settings_from_app(&settings);
    let client = match tokio::time::timeout(
        DSH_CONNECT_TIMEOUT,
        crate::engine::dsh::connect_existing(&runtime),
    )
    .await
    {
        Ok(Ok((_snapshot, client))) => client,
        Ok(Err(error)) => {
            log::info!("[session_index.empty_prune] skip dsh prune, host not attached: {error}");
            return None;
        }
        Err(_) => {
            log::info!("[session_index.empty_prune] skip dsh prune, connect timed out");
            return None;
        }
    };
    let ids: Vec<String> = session_ids.into_iter().take(remaining).collect();
    let peek_client = client.clone();
    let peeks = ids.into_iter().map(|session_id| {
        let peek_client = peek_client.clone();
        async move {
            let peek = tokio::time::timeout(
                DSH_PEEK_TIMEOUT,
                crate::engine::dsh::history::peek_dsh_latest_page_user(&peek_client, &session_id),
            )
            .await;
            (session_id, peek)
        }
    });
    let peeked =
        match tokio::time::timeout(DSH_PRUNE_BUDGET, futures_util::future::join_all(peeks)).await {
            Ok(items) => items,
            Err(_) => {
                log::info!("[session_index.empty_prune] dsh peek budget exceeded, skip remainder");
                Vec::new()
            }
        };
    for (session_id, peek) in peeked {
        match peek {
            Ok(Ok(DshLatestUserPeek::Empty)) => targets.push(PruneTarget {
                engine: "dsh".into(),
                session_id,
                delete_disk: true,
                physical_path: None,
            }),
            Ok(Ok(DshLatestUserPeek::HasRealUser | DshLatestUserPeek::Unknown)) => {}
            Ok(Err(error)) => {
                log::info!(
                    "[session_index.empty_prune] skip dsh {session_id}: peek failed: {error}"
                );
            }
            Err(_) => {
                log::info!("[session_index.empty_prune] skip dsh {session_id}: peek timed out");
            }
        }
    }
    Some(client)
}

async fn delete_engine_session(
    workspace_path: &Path,
    target: &PruneTarget,
    dsh_client: Option<&Arc<DshHostClient>>,
) -> bool {
    let result = match target.engine.as_str() {
        "claude" => {
            crate::engine::claude_history::delete_claude_session_with_config(
                workspace_path,
                &target.session_id,
                None,
            )
            .await
        }
        "grok" => {
            crate::engine::grok_history::delete_grok_session(
                workspace_path,
                &target.session_id,
                None,
            )
            .await
        }
        "gemini" => {
            crate::engine::gemini_history::delete_gemini_session(
                workspace_path,
                &target.session_id,
                None,
            )
            .await
        }
        "kimi" => {
            crate::engine::kimi_history::delete_kimi_session(
                workspace_path,
                &target.session_id,
                None,
            )
            .await
        }
        "pi" => {
            crate::engine::pi_history::delete_pi_family_session(
                crate::engine::EngineType::Pi,
                workspace_path,
                &target.session_id,
                None,
            )
            .await
        }
        "omp" => {
            crate::engine::pi_history::delete_pi_family_session(
                crate::engine::EngineType::Omp,
                workspace_path,
                &target.session_id,
                None,
            )
            .await
        }
        "dsh" => {
            return match delete_dsh_session_via_existing_host(dsh_client, &target.session_id).await
            {
                Ok(()) => true,
                // Peek already confirmed Empty; host already dropped the row.
                Err(error) if is_not_found_delete_error(&error) => true,
                Err(error) => {
                    log::warn!(
                        "[session_index.empty_prune] delete dsh {} failed: {error}",
                        target.session_id
                    );
                    false
                }
            };
        }
        "codex" => delete_zero_byte_physical_path(target).await,
        _ => return false,
    };
    match result {
        Ok(()) => true,
        Err(error) => {
            if is_not_found_delete_error(&error) {
                return delete_confirmed_artifact(target).await;
            }
            log::warn!(
                "[session_index.empty_prune] delete {} {} failed: {error}",
                target.engine,
                target.session_id
            );
            false
        }
    }
}

fn is_not_found_delete_error(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("not found") || lower.contains("session file not found")
}

async fn delete_dsh_session_via_existing_host(
    client: Option<&Arc<DshHostClient>>,
    session_id: &str,
) -> Result<(), String> {
    let Some(client) = client else {
        return Err("dsh host state unavailable".into());
    };
    crate::engine::dsh::history::archive_dsh_session(client, session_id).await
}

/// Confirm already located the artifact. Engine delete may miss cwd-encoding
/// drift; fall back to the confirmed path instead of tombstoning a live file.
async fn delete_confirmed_artifact(target: &PruneTarget) -> bool {
    let Some(physical) = target
        .physical_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let path = PathBuf::from(physical);
    match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.is_dir() => match tokio::fs::remove_dir_all(&path).await {
            Ok(()) => true,
            Err(error) => {
                log::warn!(
                    "[session_index.empty_prune] confirmed-dir delete {} {} failed: {error}",
                    target.engine,
                    target.session_id
                );
                false
            }
        },
        Ok(meta) if meta.is_file() => match tokio::fs::remove_file(&path).await {
            Ok(()) => true,
            Err(error) => {
                log::warn!(
                    "[session_index.empty_prune] confirmed-file delete {} {} failed: {error}",
                    target.engine,
                    target.session_id
                );
                false
            }
        },
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => {
            log::warn!(
                "[session_index.empty_prune] confirmed-path stat {} {} failed: {error}",
                target.engine,
                target.session_id
            );
            false
        }
    }
}

async fn delete_zero_byte_physical_path(target: &PruneTarget) -> Result<(), String> {
    let Some(physical) = target
        .physical_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Err("missing confirmed physical path".into());
    };
    let path = PathBuf::from(physical);
    match tokio::fs::metadata(&path).await {
        Ok(meta) if meta.is_file() && meta.len() == 0 => tokio::fs::remove_file(&path)
            .await
            .map_err(|error| error.to_string()),
        Ok(meta) => Err(format!(
            "refusing to delete non-empty physical path ({} bytes)",
            meta.len()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_index::store::{tombstone_engine_sessions, upsert_rows, DDL};
    use rusqlite::Connection;
    use std::sync::Mutex;

    static GROK_HOME_TEST_LOCK: Mutex<()> = Mutex::new(());
    static PI_SESSION_DIR_TEST_LOCK: Mutex<()> = Mutex::new(());

    struct RestoreGrokHome(Option<String>);

    impl Drop for RestoreGrokHome {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("GROK_HOME", value),
                None => std::env::remove_var("GROK_HOME"),
            }
        }
    }

    struct RestorePiSessionDir(Option<String>);

    impl Drop for RestorePiSessionDir {
        fn drop(&mut self) {
            match self.0.take() {
                Some(value) => std::env::set_var("PI_CODING_AGENT_SESSION_DIR", value),
                None => std::env::remove_var("PI_CODING_AGENT_SESSION_DIR"),
            }
        }
    }

    fn sample_row(
        engine: &str,
        session_id: &str,
        title: &str,
        created_at: Option<i64>,
        updated_at: i64,
        physical_path: Option<&str>,
    ) -> SessionIndexRow {
        SessionIndexRow {
            engine: engine.into(),
            session_id: session_id.into(),
            title: title.into(),
            native_title: None,
            updated_at,
            created_at,
            cwd: Some("/tmp/proj".into()),
            workspace_path: Some("/tmp/proj".into()),
            physical_path: physical_path.map(str::to_string),
            parent_session_id: None,
            size_bytes: None,
            provider_profile_id: None,
            provider_profile_name: None,
        }
    }

    #[test]
    fn placeholder_title_matches_generic_and_session_id() {
        assert!(is_placeholder_session_title("grok session", "abc"));
        assert!(is_placeholder_session_title("Claude Session", "abc"));
        assert!(is_placeholder_session_title("Codex Session", "abc"));
        assert!(is_placeholder_session_title(
            "DeepSeek Harness Session",
            "abc"
        ));
        assert!(is_placeholder_session_title(
            "73595715-aaaa-bbbb-cccc-ddddeeeeffff",
            "73595715-aaaa-bbbb-cccc-ddddeeeeffff"
        ));
        assert!(is_placeholder_session_title(
            "<command-name>/resume</command-name>",
            "abc"
        ));
        assert!(is_placeholder_session_title(
            "Current runtime context. This snapshot supersedes earlier runtime-context snapshots.",
            "abc"
        ));
        assert!(is_placeholder_session_title(
            "MOSSX_CONTEXT_PACKAGE:sha25…",
            "abc"
        ));
        assert!(is_placeholder_session_title("MOSSX_CONTE", "abc"));
        assert!(is_placeholder_session_title(
            "PI session 019fe705",
            "019fe705-27fd-712e-a1be-f972ef3773f3"
        ));
        assert!(is_placeholder_session_title("Warmup", "abc"));
        assert!(is_placeholder_session_title("Agent 3", "abc"));
        assert!(!is_placeholder_session_title("我的草稿", "abc"));
        assert!(!is_placeholder_session_title("分析左侧栏消失问题", "abc"));
        assert!(!is_placeholder_session_title(
            "PI session about rust",
            "abc"
        ));
    }

    #[test]
    fn keyset_page_does_not_schedule_prune() {
        assert!(should_run_stale_empty_prune(false));
        assert!(!should_run_stale_empty_prune(true));
    }

    #[test]
    fn age_prefers_created_at_over_refreshed_updated_at() {
        let now = 20 * 60 * 1000;
        let created = 1_000;
        let refreshed_updated = now - 1_000;
        let anchor = stale_age_anchor(Some(created), refreshed_updated);
        assert_eq!(anchor, created);
        assert!(is_stale_empty_age(anchor, now));
        assert!(!is_stale_empty_age(now - 60_000, now));
    }

    #[test]
    fn custom_title_is_never_collected() {
        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "claude",
                "s-named",
                "我的草稿",
                Some(1),
                1,
                None,
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert!(targets.is_empty());
    }

    #[test]
    fn fresh_placeholder_is_kept() {
        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        let now = 20 * 60 * 1000;
        upsert_rows(
            &connection,
            &[sample_row(
                "claude",
                "s-fresh",
                "claude session",
                Some(now - 30_000),
                now - 30_000,
                None,
            )],
        )
        .expect("upsert");
        let targets =
            collect_confirmed_empty_targets(&connection, "/tmp/proj", now).expect("collect");
        assert!(targets.is_empty());
    }

    #[test]
    fn empty_claude_jsonl_is_collected_and_prompted_file_is_not() {
        let dir =
            std::env::temp_dir().join(format!("ccgui-empty-prune-claude-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let empty_path = dir.join("empty.jsonl");
        std::fs::write(&empty_path, "").expect("write empty");
        let filled_path = dir.join("filled.jsonl");
        std::fs::write(
            &filled_path,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"你好"}]}}
"#,
        )
        .expect("write filled");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[
                sample_row(
                    "claude",
                    "empty-1",
                    "claude session",
                    Some(1),
                    1,
                    Some(&empty_path.to_string_lossy()),
                ),
                sample_row(
                    "claude",
                    "filled-1",
                    "claude session",
                    Some(1),
                    1,
                    Some(&filled_path.to_string_lossy()),
                ),
            ],
        )
        .expect("upsert");

        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert_eq!(
            targets,
            vec![PruneTarget {
                engine: "claude".into(),
                session_id: "empty-1".into(),
                delete_disk: true,
                physical_path: Some(empty_path.to_string_lossy().into_owned()),
            }]
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_claude_physical_path_is_skipped() {
        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "claude",
                "ghost-1",
                "Claude Session",
                Some(1),
                1,
                Some("/tmp/does-not-exist-ccgui-empty-prune.jsonl"),
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert!(
            targets.is_empty(),
            "missing Claude jsonl is Unknown, not a tombstone"
        );
    }

    #[test]
    fn warmup_title_empty_claude_jsonl_is_collected() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-claude-warmup-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("warmup.jsonl");
        std::fs::write(
            &path,
            r#"{"type":"user","message":{"role":"user","content":"Warmup"}}
"#,
        )
        .expect("write");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "claude",
                "warmup-1",
                "Warmup",
                Some(1),
                1,
                Some(&path.to_string_lossy()),
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].session_id, "warmup-1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn shared_protocol_owner_is_not_pruned_as_empty() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-claude-protocol-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("1807f883-011c-46bd-94d5-ff483ffb1a4a.jsonl");
        std::fs::write(
            &path,
            r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"MOSSX_CONTEXT_PACKAGE:sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef:sha256:cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe\nMOSSX_SHARED_CONTEXT_V1\nsession:267c001d-932a-4a05-bfa9-a238937f7707\n\nCurrent user request:\n继续"}]}}
"#,
        )
        .expect("write");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "claude",
                "1807f883-011c-46bd-94d5-ff483ffb1a4a",
                "MOSSX_CONTEXT_PACKAGE:sha256:dead…",
                Some(1),
                1,
                Some(&path.to_string_lossy()),
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert!(
            targets.is_empty(),
            "Shared protocol owner must not be GC'd: {targets:?}"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn grok_without_session_dir_is_not_collected() {
        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "grok",
                "73595715-aaaa-bbbb-cccc-ddddeeeeffff",
                "73595715-aaaa-bbbb-cccc-ddddeeeeffff",
                Some(1),
                1,
                None,
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert!(
            targets.is_empty(),
            "missing Grok dir must not be guessed into a tombstone"
        );
    }

    #[test]
    fn grok_summary_only_without_chat_history_is_skipped() {
        let _lock = GROK_HOME_TEST_LOCK.lock().expect("grok home lock");
        let grok_home = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-grok-summary-only-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&grok_home);
        let _restore = RestoreGrokHome(std::env::var("GROK_HOME").ok());
        std::env::set_var("GROK_HOME", &grok_home);

        let workspace = PathBuf::from("/tmp/proj");
        let encoded = candidate_encoded_cwd_names(&workspace)
            .into_iter()
            .next()
            .expect("encoded cwd");
        let session_id = "ses-summary-only-grok";
        let session_dir = grok_home.join("sessions").join(encoded).join(session_id);
        std::fs::create_dir_all(&session_dir).expect("mkdir grok");
        std::fs::write(
            session_dir.join("summary.json"),
            r#"{"num_chat_messages":0,"generated_title":"Chinese Hello"}"#,
        )
        .expect("summary");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "grok",
                session_id,
                "grok session",
                Some(1),
                1,
                None,
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert!(
            targets.is_empty(),
            "Grok without chat_history.jsonl is Unknown, not a delete"
        );
        let _ = std::fs::remove_dir_all(&grok_home);
    }

    #[test]
    fn grok_empty_chat_history_is_collected() {
        let _lock = GROK_HOME_TEST_LOCK.lock().expect("grok home lock");
        let grok_home =
            std::env::temp_dir().join(format!("ccgui-empty-prune-grok-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&grok_home);
        let _restore = RestoreGrokHome(std::env::var("GROK_HOME").ok());
        std::env::set_var("GROK_HOME", &grok_home);

        let workspace = PathBuf::from("/tmp/proj");
        let encoded = candidate_encoded_cwd_names(&workspace)
            .into_iter()
            .next()
            .expect("encoded cwd");
        let session_id = "ses-empty-grok";
        let session_dir = grok_home.join("sessions").join(encoded).join(session_id);
        std::fs::create_dir_all(&session_dir).expect("mkdir grok");
        std::fs::write(
            session_dir.join("summary.json"),
            r#"{"num_chat_messages":0}"#,
        )
        .expect("summary");
        std::fs::write(session_dir.join("chat_history.jsonl"), "").expect("chat");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "grok",
                session_id,
                "grok session",
                Some(1),
                1,
                None,
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert_eq!(
            targets,
            vec![PruneTarget {
                engine: "grok".into(),
                session_id: session_id.into(),
                delete_disk: true,
                physical_path: Some(session_dir.to_string_lossy().into_owned()),
            }]
        );
        let _ = std::fs::remove_dir_all(&grok_home);
    }

    #[test]
    fn grok_with_real_user_prompt_is_kept() {
        let _lock = GROK_HOME_TEST_LOCK.lock().expect("grok home lock");
        let grok_home = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-grok-keep-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&grok_home);
        let _restore = RestoreGrokHome(std::env::var("GROK_HOME").ok());
        std::env::set_var("GROK_HOME", &grok_home);

        let workspace = PathBuf::from("/tmp/proj");
        let encoded = candidate_encoded_cwd_names(&workspace)
            .into_iter()
            .next()
            .expect("encoded cwd");
        let session_id = "ses-filled-grok";
        let session_dir = grok_home.join("sessions").join(encoded).join(session_id);
        std::fs::create_dir_all(&session_dir).expect("mkdir grok");
        std::fs::write(
            session_dir.join("chat_history.jsonl"),
            r#"{"type":"user","content":[{"type":"text","text":"<user_query>帮我看一下列表</user_query>"}]}"#,
        )
        .expect("chat");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row("grok", session_id, session_id, Some(1), 1, None)],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert!(targets.is_empty());
        let _ = std::fs::remove_dir_all(&grok_home);
    }

    #[test]
    fn shared_engine_is_never_a_candidate() {
        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "shared",
                "shared-1",
                "shared session",
                Some(1),
                1,
                None,
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert!(targets.is_empty());
    }

    #[test]
    fn tombstone_after_collect_hides_row() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-tombstone-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let empty_path = dir.join("empty.jsonl");
        std::fs::write(&empty_path, "").expect("write");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "claude",
                "to-tombstone",
                "claude session",
                Some(1),
                1,
                Some(&empty_path.to_string_lossy()),
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert_eq!(targets.len(), 1);
        tombstone_engine_sessions(&connection, &[("claude".into(), "to-tombstone".into())])
            .expect("tombstone");
        let remaining = list_for_workspace_path(&connection, "/tmp/proj", 10, false).expect("list");
        assert!(remaining.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn claude_command_only_jsonl_is_collected() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-claude-cmd-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("cmd.jsonl");
        std::fs::write(
            &path,
            r#"{"type":"user","message":{"role":"user","content":"<command-name>/resume</command-name>"}}
"#,
        )
        .expect("write");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "claude",
                "cmd-1",
                "<command-name>/resume</command-name>",
                Some(1),
                1,
                Some(&path.to_string_lossy()),
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].session_id, "cmd-1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn claude_command_with_args_is_kept() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-claude-args-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("args.jsonl");
        std::fs::write(
            &path,
            r#"{"type":"user","message":{"role":"user","content":"<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>看一下这个 PR</command-args>"}}
"#,
        )
        .expect("write");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "claude",
                "args-1",
                "claude session",
                Some(1),
                1,
                Some(&path.to_string_lossy()),
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert!(targets.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn dsh_placeholder_is_queued_for_host_confirm_not_guessed() {
        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "dsh",
                "dsh-empty-1",
                "dsh session",
                Some(1),
                1,
                None,
            )],
        )
        .expect("upsert");
        let plan =
            collect_empty_prune_plan(&connection, "/tmp/proj", 20 * 60 * 1000).expect("plan");
        assert!(plan.targets.is_empty(), "DSH must not be guessed from disk");
        assert_eq!(plan.dsh_session_ids, vec!["dsh-empty-1".to_string()]);
    }

    #[test]
    fn pi_empty_jsonl_is_collected_and_missing_file_is_not() {
        let _lock = PI_SESSION_DIR_TEST_LOCK.lock().expect("pi session lock");
        let root =
            std::env::temp_dir().join(format!("ccgui-empty-prune-pi-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let _restore = RestorePiSessionDir(std::env::var("PI_CODING_AGENT_SESSION_DIR").ok());
        std::env::set_var("PI_CODING_AGENT_SESSION_DIR", &root);

        let cwd_dir = root.join("--tmp-proj--");
        std::fs::create_dir_all(&cwd_dir).expect("mkdir pi");
        let empty_id = "019fe705-27fd-712e-a1be-f972ef3773f3";
        let filled_id = "019fe705-27fd-712e-a1be-f972ef3773f4";
        std::fs::write(
            cwd_dir.join(format!("2026-08-09T14-55-02-653Z_{empty_id}.jsonl")),
            r#"{"type":"session","id":"019fe705-27fd-712e-a1be-f972ef3773f3","cwd":"/tmp/proj"}
"#,
        )
        .expect("write empty pi");
        std::fs::write(
            cwd_dir.join(format!("2026-08-09T14-56-02-653Z_{filled_id}.jsonl")),
            r#"{"type":"session","id":"019fe705-27fd-712e-a1be-f972ef3773f4","cwd":"/tmp/proj"}
{"type":"message","message":{"role":"user","content":[{"type":"text","text":"hello pi"}]}}
"#,
        )
        .expect("write filled pi");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[
                sample_row("pi", empty_id, "PI session 019fe705", Some(1), 1, None),
                sample_row("pi", filled_id, "PI session 019fe705", Some(1), 1, None),
                sample_row(
                    "pi",
                    "missing-pi-id",
                    "PI session 019fe705",
                    Some(1),
                    1,
                    None,
                ),
            ],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        let empty_file = cwd_dir.join(format!("2026-08-09T14-55-02-653Z_{empty_id}.jsonl"));
        assert_eq!(
            targets,
            vec![PruneTarget {
                engine: "pi".into(),
                session_id: empty_id.into(),
                delete_disk: true,
                physical_path: Some(empty_file.to_string_lossy().into_owned()),
            }]
        );
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn grok_fallback_scan_finds_drifted_cwd_dir() {
        let _lock = GROK_HOME_TEST_LOCK.lock().expect("grok home lock");
        let grok_home = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-grok-drift-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&grok_home);
        let _restore = RestoreGrokHome(std::env::var("GROK_HOME").ok());
        std::env::set_var("GROK_HOME", &grok_home);

        let session_id = "ses-drifted-grok";
        let session_dir = grok_home
            .join("sessions")
            .join("not-the-encoded-cwd")
            .join(session_id);
        std::fs::create_dir_all(&session_dir).expect("mkdir grok");
        std::fs::write(
            session_dir.join("summary.json"),
            r#"{"num_chat_messages":0}"#,
        )
        .expect("summary");
        std::fs::write(session_dir.join("chat_history.jsonl"), "").expect("chat");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "grok",
                session_id,
                "grok session",
                Some(1),
                1,
                None,
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert_eq!(
            targets,
            vec![PruneTarget {
                engine: "grok".into(),
                session_id: session_id.into(),
                delete_disk: true,
                physical_path: Some(session_dir.to_string_lossy().into_owned()),
            }]
        );
        let _ = std::fs::remove_dir_all(&grok_home);
    }

    #[test]
    fn claude_injection_envelope_jsonl_is_collected() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-claude-inject-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("inject.jsonl");
        std::fs::write(
            &path,
            r#"{"type":"user","message":{"role":"user","content":"<system-reminder>\nInstructions from: AGENTS.md\n</system-reminder>"}}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<user_info>\nOS Version: macos\n</user_info>"}]}}
"#,
        )
        .expect("write");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[sample_row(
                "claude",
                "inject-1",
                "claude session",
                Some(1),
                1,
                Some(&path.to_string_lossy()),
            )],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        assert_eq!(targets.len(), 1);
        assert_eq!(targets[0].session_id, "inject-1");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconfirm_skips_claude_file_that_gained_a_user_prompt() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-claude-reconfirm-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("race.jsonl");
        std::fs::write(&path, "").expect("write empty");
        let target = PruneTarget {
            engine: "claude".into(),
            session_id: "race-1".into(),
            delete_disk: true,
            physical_path: Some(path.to_string_lossy().into_owned()),
        };
        assert!(still_empty_before_delete(&target));
        std::fs::write(
            &path,
            r#"{"type":"user","message":{"role":"user","content":"刚打的字"}}
"#,
        )
        .expect("write prompt");
        assert!(!still_empty_before_delete(&target));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stale_codex_session_meta_only_is_collected_without_deleting_disk() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-codex-meta-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let empty = dir.join("empty.jsonl");
        std::fs::write(
            &empty,
            r#"{"timestamp":"2026-08-18T00:00:00.000Z","type":"session_meta","payload":{"id":"codex-empty-1","cwd":"/tmp/proj"}}
"#,
        )
        .expect("write meta");
        let filled = dir.join("filled.jsonl");
        std::fs::write(
            &filled,
            r#"{"timestamp":"2026-08-18T00:00:00.000Z","type":"session_meta","payload":{"id":"codex-filled-1","cwd":"/tmp/proj"}}
{"timestamp":"2026-08-18T00:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"分析左侧栏消失问题"}}
"#,
        )
        .expect("write filled");
        let zero = dir.join("zero.jsonl");
        std::fs::write(&zero, "").expect("write zero");

        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[
                sample_row(
                    "codex",
                    "codex-empty-1",
                    "Codex Session",
                    Some(1),
                    1,
                    Some(&empty.to_string_lossy()),
                ),
                sample_row(
                    "codex",
                    "codex-filled-1",
                    "分析左侧栏消失问题",
                    Some(1),
                    1,
                    Some(&filled.to_string_lossy()),
                ),
                sample_row(
                    "codex",
                    "codex-zero-1",
                    "Codex Session",
                    Some(1),
                    1,
                    Some(&zero.to_string_lossy()),
                ),
            ],
        )
        .expect("upsert");
        let targets = collect_confirmed_empty_targets(&connection, "/tmp/proj", 20 * 60 * 1000)
            .expect("collect");
        let by_id: std::collections::HashMap<_, _> = targets
            .iter()
            .map(|target| (target.session_id.as_str(), target))
            .collect();
        assert!(by_id.contains_key("codex-empty-1"));
        assert_eq!(by_id["codex-empty-1"].delete_disk, false);
        assert!(by_id.contains_key("codex-zero-1"));
        assert_eq!(by_id["codex-zero-1"].delete_disk, true);
        assert!(!by_id.contains_key("codex-filled-1"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reconfirm_skips_codex_file_that_gained_a_user_prompt() {
        let dir = std::env::temp_dir().join(format!(
            "ccgui-empty-prune-codex-reconfirm-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir");
        let path = dir.join("race.jsonl");
        std::fs::write(
            &path,
            r#"{"timestamp":"2026-08-18T00:00:00.000Z","type":"session_meta","payload":{"id":"codex-race-1","cwd":"/tmp/proj"}}
"#,
        )
        .expect("write meta");
        let target = PruneTarget {
            engine: "codex".into(),
            session_id: "codex-race-1".into(),
            delete_disk: false,
            physical_path: Some(path.to_string_lossy().into_owned()),
        };
        assert!(still_empty_before_delete(&target));
        std::fs::write(
            &path,
            r#"{"timestamp":"2026-08-18T00:00:00.000Z","type":"session_meta","payload":{"id":"codex-race-1","cwd":"/tmp/proj"}}
{"timestamp":"2026-08-18T00:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"刚打的字"}}
"#,
        )
        .expect("write prompt");
        assert!(!still_empty_before_delete(&target));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn local_pending_draft_id_matches_client_create_shape() {
        assert!(is_local_pending_draft_id(
            "grok",
            "grok-pending-1787016153035-0bittx"
        ));
        assert!(is_local_pending_draft_id(
            "claude",
            "claude-pending-1786994311484-kojibi"
        ));
        assert!(is_local_pending_draft_id(
            "dsh",
            "dsh-pending-1786987239499-exlwy6"
        ));
        assert!(is_local_pending_draft_id(
            "pi",
            "pi-pending-1786897785026-p4qcut"
        ));
        assert!(is_local_pending_draft_id(
            "codex",
            "codex-pending-1786994371985-fv4mt5"
        ));
        assert!(!is_local_pending_draft_id("grok", "grok-pending-shared-1"));
        assert!(!is_local_pending_draft_id(
            "claude",
            "claude-pending-subagent:parent:toolu_1"
        ));
        assert!(!is_local_pending_draft_id(
            "grok",
            "14a64a80-c9ab-4ff1-a1de-196dca031750"
        ));
        assert!(!is_local_pending_draft_id("dsh", "dsh-empty-1"));
        assert!(!is_local_pending_draft_id(
            "claude",
            "grok-pending-1787016153035-0bittx"
        ));
    }

    #[test]
    fn stale_local_pending_drafts_are_tombstoned_without_disk() {
        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        upsert_rows(
            &connection,
            &[
                sample_row(
                    "grok",
                    "grok-pending-1787016153035-0bittx",
                    "grok session",
                    None,
                    1,
                    None,
                ),
                sample_row(
                    "claude",
                    "claude-pending-1786994311484-kojibi",
                    "claude session",
                    None,
                    1,
                    None,
                ),
                sample_row(
                    "dsh",
                    "dsh-pending-1786987239499-exlwy6",
                    "dsh session",
                    None,
                    1,
                    None,
                ),
                sample_row(
                    "pi",
                    "pi-pending-1786897785026-p4qcut",
                    "pi session",
                    None,
                    1,
                    None,
                ),
                sample_row(
                    "codex",
                    "codex-pending-1786994371985-fv4mt5",
                    "codex session",
                    None,
                    1,
                    None,
                ),
                sample_row(
                    "grok",
                    "grok-pending-shared-seed1",
                    "grok session",
                    None,
                    1,
                    None,
                ),
            ],
        )
        .expect("upsert");

        let plan =
            collect_empty_prune_plan(&connection, "/tmp/proj", 20 * 60 * 1000).expect("plan");
        let mut ids: Vec<_> = plan
            .targets
            .iter()
            .map(|target| target.session_id.as_str())
            .collect();
        ids.sort_unstable();
        assert_eq!(
            ids,
            vec![
                "claude-pending-1786994311484-kojibi",
                "codex-pending-1786994371985-fv4mt5",
                "dsh-pending-1786987239499-exlwy6",
                "grok-pending-1787016153035-0bittx",
                "pi-pending-1786897785026-p4qcut",
            ]
        );
        assert!(
            plan.targets.iter().all(|target| !target.delete_disk),
            "pending drafts have no disk artifact"
        );
        assert!(
            plan.dsh_session_ids.is_empty(),
            "pending DSH must not wait on host peek"
        );
        assert!(still_empty_before_delete(&plan.targets[0]));
    }

    #[test]
    fn fresh_local_pending_draft_is_kept() {
        let connection = Connection::open_in_memory().expect("open");
        connection.execute_batch(DDL).expect("ddl");
        let now = 20 * 60 * 1000;
        upsert_rows(
            &connection,
            &[sample_row(
                "grok",
                "grok-pending-1787016153035-fresh1",
                "grok session",
                None,
                now - 30_000,
                None,
            )],
        )
        .expect("upsert");
        let plan = collect_empty_prune_plan(&connection, "/tmp/proj", now).expect("plan");
        assert!(plan.targets.is_empty());
        assert!(plan.dsh_session_ids.is_empty());
    }
}
