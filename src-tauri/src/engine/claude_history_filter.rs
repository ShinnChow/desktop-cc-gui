use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::SystemTime;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Semaphore;
use tokio::time::timeout;

use super::super::claude_history_entries::{
    classify_claude_history_entry, extract_command_prompt_text, extract_text_from_content,
    ClaudeHistoryEntryClassification, ClaudeHistoryHiddenReason,
};
use super::super::claude_history_large_payload::parse_claude_summary_entry;
use super::super::claude_history_subagents::{
    normalize_claude_session_id, read_subagent_meta, ClaudeSubagentSessionId,
};
use super::super::EngineConfig;

const LOCAL_SESSION_SCAN_TIMEOUT: Duration = Duration::from_secs(60);
/// Sidebar list scan: stop after this many content bytes (align Index peek).
pub(crate) const CLAUDE_LIST_SCAN_MAX_BYTES: u64 = 64 * 1024;
/// Sidebar list scan: stop after this many non-empty lines.
pub(crate) const CLAUDE_LIST_SCAN_MAX_LINES: usize = 40;
const CLAUDE_LIST_PREVIEW_MAX_LINES: usize = CLAUDE_LIST_SCAN_MAX_LINES;
/// Skip a single JSONL line larger than this once a title already exists.
const CLAUDE_LIST_SKIP_LINE_BYTES: usize = 200_000;
const CLAUDE_LIST_DEFAULT_LIMIT: usize = 200;

#[derive(Default)]
struct ClaudeScanIoLog {
    /// (absolute path, opens, bytes)
    entries: Vec<(String, u64, u64)>,
}

static CLAUDE_SCAN_IO: Mutex<ClaudeScanIoLog> = Mutex::new(ClaudeScanIoLog {
    entries: Vec::new(),
});

#[allow(dead_code)]
pub(crate) fn reset_claude_list_io_stats() {
    if let Ok(mut guard) = CLAUDE_SCAN_IO.lock() {
        guard.entries.clear();
    }
}

pub(crate) fn claude_list_io_stats_for_prefix(prefix: &Path) -> (u64, u64) {
    let prefix = prefix.to_string_lossy();
    let Ok(guard) = CLAUDE_SCAN_IO.lock() else {
        return (0, 0);
    };
    let mut opens = 0;
    let mut bytes = 0;
    for (path, open_count, read_bytes) in &guard.entries {
        if path.starts_with(prefix.as_ref()) {
            opens += *open_count;
            bytes += *read_bytes;
        }
    }
    (opens, bytes)
}

fn record_claude_scan_open(path: &Path) {
    let key = path.to_string_lossy().into_owned();
    if let Ok(mut guard) = CLAUDE_SCAN_IO.lock() {
        guard.entries.push((key, 1, 0));
    }
}

fn record_claude_scan_read_bytes(path: &Path, bytes: u64) {
    let key = path.to_string_lossy().into_owned();
    if let Ok(mut guard) = CLAUDE_SCAN_IO.lock() {
        if let Some(entry) = guard.entries.iter_mut().rev().find(|(p, _, _)| p == &key) {
            entry.2 += bytes;
        } else {
            guard.entries.push((key, 0, bytes));
        }
    }
}
pub(crate) const CLAUDE_ATTRIBUTION_STRICT_MATCH: &str = "strict-match";
pub(crate) const CLAUDE_ATTRIBUTION_REASON_PROJECT_DIRECTORY: &str = "claude-project-directory";
pub(crate) const CLAUDE_ATTRIBUTION_REASON_TRANSCRIPT_CWD: &str = "claude-transcript-cwd";
pub(crate) const CLAUDE_ATTRIBUTION_REASON_GIT_ROOT: &str = "claude-git-root";
const CLAUDE_SOURCE_FACT_CACHE_SCHEMA_VERSION: u32 = 1;
// v5: explicit transcript cwd outside attribution scope is always rejected (no project-dir
// fallback override). Invalidates caches that previously leaked foreign history via
// non-ASCII path collisions (e.g. 新的空文件夹 vs 个人财务管理).
// v6: sidebar/catalog list peeks a bounded head and uses file mtime for
// updated_at instead of scanning every jsonl to EOF.
const CLAUDE_SOURCE_FACT_SCANNER_VERSION: u32 = 6;
const CLAUDE_SESSION_TITLE_PREVIEW_MAX_CHARS: usize = 60;
pub(crate) fn normalize_session_id(session_id: &str) -> Result<String, String> {
    normalize_claude_session_id(session_id)
}

/// Summary of a Claude Code session for sidebar display
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSummary {
    pub session_id: String,
    pub first_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_title: Option<String>,
    pub updated_at: i64,
    pub created_at: i64,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSourceFact {
    pub canonical_session_id: String,
    pub display_session_id: String,
    pub physical_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_project_dir: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub first_real_user_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_title: Option<String>,
    pub updated_at: i64,
    pub created_at: i64,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_mtime_ms: Option<i64>,
    pub source_health: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subagent_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ClaudeSessionScanDiagnosticCode {
    UnreadableFile,
    EmptyTranscript,
    MissingSessionId,
    CwdOutsideAttributionScope,
    MissingCwdWithoutFallback,
    MalformedTranscript,
}

impl ClaudeSessionScanDiagnosticCode {
    fn as_str(&self) -> &'static str {
        match self {
            Self::UnreadableFile => "unreadable-file",
            Self::EmptyTranscript => "empty-transcript",
            Self::MissingSessionId => "missing-session-id",
            Self::CwdOutsideAttributionScope => "cwd-outside-attribution-scope",
            Self::MissingCwdWithoutFallback => "missing-cwd-without-fallback",
            Self::MalformedTranscript => "malformed-transcript",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionScanDiagnostic {
    pub code: ClaudeSessionScanDiagnosticCode,
    pub reason: String,
    pub physical_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionScanOutcome {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fact: Option<ClaudeSessionSourceFact>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ClaudeSessionScanDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSourceFactCacheMetrics {
    pub hits: usize,
    pub misses: usize,
    pub stale: usize,
    pub rebuilds: usize,
    pub failures: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSourceFactList {
    pub facts: Vec<ClaudeSessionSourceFact>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub diagnostics: Vec<ClaudeSessionScanDiagnostic>,
    pub scanned_candidates: usize,
    pub skipped_candidates: usize,
    pub scan_cap_reached: bool,
    pub cache_metrics: ClaudeSessionSourceFactCacheMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeSessionSourceFactCacheEntry {
    schema_version: u32,
    scanner_version: u32,
    cache_namespace: String,
    physical_path: String,
    file_mtime_ms: Option<i64>,
    file_size_bytes: Option<u64>,
    fact: Option<ClaudeSessionSourceFact>,
    #[serde(default)]
    diagnostics: Vec<ClaudeSessionScanDiagnostic>,
}

impl ClaudeSessionSourceFact {
    pub(crate) fn to_summary(&self) -> ClaudeSessionSummary {
        let first_message = self.first_real_user_message.clone().unwrap_or_else(|| {
            format!(
                "Session {}",
                &self.canonical_session_id[..8.min(self.canonical_session_id.len())]
            )
        });
        ClaudeSessionSummary {
            session_id: self.canonical_session_id.clone(),
            first_message,
            native_title: self.native_title.clone(),
            updated_at: self.updated_at,
            created_at: self.created_at,
            message_count: self.message_count,
            file_size_bytes: self.file_size_bytes,
            cwd: self.cwd.clone(),
            attribution_status: self.attribution_status.clone(),
            attribution_reason: self.attribution_reason.clone(),
            parent_session_id: self.parent_session_id.clone(),
            subagent_type: self.subagent_type.clone(),
        }
    }
}

impl ClaudeSessionScanOutcome {
    fn into_summary(self) -> Option<ClaudeSessionSummary> {
        self.fact.map(|fact| fact.to_summary())
    }
}

#[derive(Debug, Clone)]
pub struct ClaudeSessionAttributionScope {
    pub path: PathBuf,
    pub reason: String,
}

impl ClaudeSessionAttributionScope {
    pub fn workspace_path(path: PathBuf) -> Self {
        Self {
            path,
            reason: CLAUDE_ATTRIBUTION_REASON_TRANSCRIPT_CWD.to_string(),
        }
    }

    pub fn git_root(path: PathBuf) -> Self {
        Self {
            path,
            reason: CLAUDE_ATTRIBUTION_REASON_GIT_ROOT.to_string(),
        }
    }
}

/// Encode a filesystem path to Claude's project directory name.
/// All non-alphanumeric characters (except hyphens) become hyphens.
pub(crate) fn encode_project_path(path: &str) -> String {
    path.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Get the Claude projects base directory (`<effective-claude-home>/projects`).
pub(crate) fn claude_projects_dir(config: Option<&EngineConfig>) -> Option<PathBuf> {
    crate::claude_home::resolve_claude_projects_dir(config)
}

fn candidate_workspace_paths(workspace_path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();

    let raw = workspace_path.to_path_buf();
    let raw_str = raw.to_string_lossy().to_string();
    if !raw_str.is_empty() && seen.insert(raw_str.clone()) {
        candidates.push(raw);
    }

    let trimmed = raw_str.trim_end_matches(['/', '\\']);
    if trimmed != raw_str && seen.insert(trimmed.to_string()) {
        candidates.push(PathBuf::from(trimmed.to_string()));
    }

    if let Ok(canonical) = std::fs::canonicalize(workspace_path) {
        let canonical_str = canonical.to_string_lossy().to_string();
        if !canonical_str.is_empty() && seen.insert(canonical_str) {
            candidates.push(canonical);
        }
    }

    if trimmed != raw_str {
        if let Ok(canonical_trimmed) = std::fs::canonicalize(trimmed) {
            let canonical_trimmed_str = canonical_trimmed.to_string_lossy().to_string();
            if !canonical_trimmed_str.is_empty() && seen.insert(canonical_trimmed_str) {
                candidates.push(canonical_trimmed);
            }
        }
    }

    candidates
}

/// True when `candidate` is the workspace project dir or a nested subdir of it.
///
/// Claude encodes every non-ASCII character to `-`, so two Chinese sibling
/// folders of different lengths become pure-hyphen suffixes of each other
/// (e.g. `Desktop-------` vs `Desktop-------------`). Treating that as a
/// nested project dir incorrectly merges unrelated history. Require at least
/// one ASCII alphanumeric in the remainder so real ASCII nests
/// (`…-repo-packages-foo`) still match while pure-hyphen collisions do not.
pub(crate) fn is_encoded_workspace_prefix_match(candidate: &str, encoded_workspace: &str) -> bool {
    if candidate == encoded_workspace {
        return true;
    }
    if !candidate.starts_with(encoded_workspace) {
        return false;
    }
    let rest = &candidate[encoded_workspace.len()..];
    if !rest.starts_with('-') {
        return false;
    }
    rest.chars().any(|c| c.is_ascii_alphanumeric())
}

pub(crate) fn claude_project_dirs_for_path(base_dir: &Path, workspace_path: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let mut seen = HashSet::new();
    let mut encoded_workspace_paths = Vec::new();
    for path in candidate_workspace_paths(workspace_path) {
        let encoded = encode_project_path(&path.to_string_lossy());
        if !encoded.is_empty() {
            encoded_workspace_paths.push(encoded.clone());
        }
        let dir = base_dir.join(&encoded);
        if seen.insert(dir.clone()) {
            dirs.push(dir);
        }
    }
    encoded_workspace_paths.sort();
    encoded_workspace_paths.dedup();

    if let Ok(entries) = std::fs::read_dir(base_dir) {
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() {
                continue;
            }
            let file_name = entry.file_name();
            let Some(dir_name) = file_name.to_str() else {
                continue;
            };
            if !encoded_workspace_paths.iter().any(|encoded_workspace| {
                is_encoded_workspace_prefix_match(dir_name, encoded_workspace)
            }) {
                continue;
            }
            let dir = entry.path();
            if seen.insert(dir.clone()) {
                dirs.push(dir);
            }
        }
    }

    dirs
}

pub(crate) fn all_claude_project_dirs(base_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    let Ok(entries) = std::fs::read_dir(base_dir) else {
        return dirs;
    };
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            dirs.push(entry.path());
        }
    }
    dirs.sort();
    dirs.dedup();
    dirs
}

/// Parse an ISO 8601 timestamp string to epoch milliseconds
fn parse_timestamp(ts: &str) -> Option<i64> {
    // Parse ISO 8601 format: "2026-02-02T06:36:06.284Z"
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis())
}


/// Truncate a string to max_chars, adding ellipsis if truncated
pub(crate) fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        let truncated: String = s.chars().take(max_chars).collect();
        format!("{}…", truncated)
    }
}

pub(crate) fn first_non_empty_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToString::to_string)
}

fn extract_claude_entry_cwd(entry: &Value) -> Option<String> {
    first_non_empty_string(entry.get("cwd"))
        .or_else(|| first_non_empty_string(entry.get("currentWorkingDirectory")))
        .or_else(|| first_non_empty_string(entry.get("workspacePath")))
        .or_else(|| first_non_empty_string(entry.get("workspace_path")))
        .or_else(|| {
            entry.get("payload").and_then(|payload| {
                first_non_empty_string(payload.get("cwd"))
                    .or_else(|| first_non_empty_string(payload.get("currentWorkingDirectory")))
                    .or_else(|| {
                        payload
                            .get("sessionMeta")
                            .and_then(|meta| first_non_empty_string(meta.get("cwd")))
                    })
                    .or_else(|| {
                        payload
                            .get("session_meta")
                            .and_then(|meta| first_non_empty_string(meta.get("cwd")))
                    })
            })
        })
        .or_else(|| {
            entry
                .get("message")
                .and_then(|message| first_non_empty_string(message.get("cwd")))
        })
}

fn build_scan_diagnostic(
    code: ClaudeSessionScanDiagnosticCode,
    path: &Path,
    session_id: Option<String>,
    cwd: Option<String>,
) -> ClaudeSessionScanDiagnostic {
    ClaudeSessionScanDiagnostic {
        reason: code.as_str().to_string(),
        code,
        physical_path: path.to_string_lossy().to_string(),
        session_id,
        cwd,
    }
}

fn file_mtime_millis_sync(path: &Path) -> i64 {
    std::fs::metadata(path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_to_epoch_millis)
        .unwrap_or(0)
}

fn cap_claude_scan_paths_by_mtime(
    jsonl_paths: &mut Vec<(PathBuf, bool)>,
    subagent_jsonl_paths: &mut Vec<(PathBuf, String, bool)>,
    limit: usize,
) {
    if jsonl_paths.len() <= limit {
        return;
    }
    jsonl_paths.sort_by(|left, right| {
        file_mtime_millis_sync(&right.0)
            .cmp(&file_mtime_millis_sync(&left.0))
            .then_with(|| left.0.cmp(&right.0))
    });
    jsonl_paths.truncate(limit);
    let selected_parents: HashSet<String> = jsonl_paths
        .iter()
        .filter_map(|(path, _)| {
            path.file_stem()
                .and_then(|name| name.to_str())
                .map(str::to_string)
        })
        .collect();
    subagent_jsonl_paths
        .retain(|(_, parent_session_id, _)| selected_parents.contains(parent_session_id));
}

fn system_time_to_epoch_millis(value: SystemTime) -> Option<i64> {
    value
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

async fn source_fact_file_fingerprint(path: &Path) -> (Option<u64>, Option<i64>) {
    match fs::metadata(path).await {
        Ok(metadata) => (
            Some(metadata.len()),
            metadata
                .modified()
                .ok()
                .and_then(system_time_to_epoch_millis),
        ),
        Err(_) => (None, None),
    }
}

fn source_fact_cache_namespace(
    base_dir: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(base_dir.to_string_lossy().as_bytes());
    for scope in attribution_scopes {
        hasher.update(b"\0scope\0");
        hasher.update(scope.reason.as_bytes());
        hasher.update(b"\0path\0");
        hasher.update(scope.path.to_string_lossy().as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn workspace_only_source_fact_cache_namespace(
    base_dir: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"workspace-only\0");
    hasher.update(base_dir.to_string_lossy().as_bytes());
    for scope in attribution_scopes {
        hasher.update(b"\0scope\0");
        hasher.update(scope.reason.as_bytes());
        hasher.update(b"\0path\0");
        hasher.update(scope.path.to_string_lossy().as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn source_fact_cache_path(
    cache_dir: &Path,
    namespace: &str,
    path: &Path,
    allow_project_directory_fallback: bool,
) -> PathBuf {
    let mut hasher = Sha256::new();
    hasher.update(namespace.as_bytes());
    hasher.update(b"\0");
    hasher.update(path.to_string_lossy().as_bytes());
    hasher.update(b"\0fallback\0");
    hasher.update(if allow_project_directory_fallback {
        "true"
    } else {
        "false"
    });
    cache_dir.join(format!("{:x}.json", hasher.finalize()))
}

async fn read_cached_source_fact_outcome(
    cache_path: &Path,
    namespace: &str,
    path: &Path,
    file_size_bytes: Option<u64>,
    file_mtime_ms: Option<i64>,
    metrics: &mut ClaudeSessionSourceFactCacheMetrics,
) -> Option<ClaudeSessionScanOutcome> {
    let payload = match fs::read_to_string(cache_path).await {
        Ok(payload) => payload,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            metrics.misses += 1;
            return None;
        }
        Err(_) => {
            metrics.failures += 1;
            return None;
        }
    };

    let entry = match serde_json::from_str::<ClaudeSessionSourceFactCacheEntry>(&payload) {
        Ok(entry) => entry,
        Err(_) => {
            metrics.failures += 1;
            return None;
        }
    };

    let physical_path = path.to_string_lossy();
    let is_current = entry.schema_version == CLAUDE_SOURCE_FACT_CACHE_SCHEMA_VERSION
        && entry.scanner_version == CLAUDE_SOURCE_FACT_SCANNER_VERSION
        && entry.cache_namespace == namespace
        && entry.physical_path == physical_path
        && entry.file_size_bytes == file_size_bytes
        && entry.file_mtime_ms == file_mtime_ms;

    if !is_current {
        metrics.stale += 1;
        return None;
    }

    metrics.hits += 1;
    Some(ClaudeSessionScanOutcome {
        fact: entry.fact,
        diagnostics: entry.diagnostics,
    })
}

async fn write_cached_source_fact_outcome(
    cache_path: &Path,
    namespace: &str,
    path: &Path,
    file_size_bytes: Option<u64>,
    file_mtime_ms: Option<i64>,
    outcome: &ClaudeSessionScanOutcome,
    metrics: &mut ClaudeSessionSourceFactCacheMetrics,
) {
    let Some(parent) = cache_path.parent() else {
        metrics.failures += 1;
        return;
    };
    if fs::create_dir_all(parent).await.is_err() {
        metrics.failures += 1;
        return;
    }
    let entry = ClaudeSessionSourceFactCacheEntry {
        schema_version: CLAUDE_SOURCE_FACT_CACHE_SCHEMA_VERSION,
        scanner_version: CLAUDE_SOURCE_FACT_SCANNER_VERSION,
        cache_namespace: namespace.to_string(),
        physical_path: path.to_string_lossy().to_string(),
        file_mtime_ms,
        file_size_bytes,
        fact: outcome.fact.clone(),
        diagnostics: outcome.diagnostics.clone(),
    };
    let Ok(payload) = serde_json::to_string(&entry) else {
        metrics.failures += 1;
        return;
    };
    if fs::write(cache_path, payload).await.is_err() {
        metrics.failures += 1;
        return;
    }
    metrics.rebuilds += 1;
}

async fn scan_session_source_file_with_cache(
    path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
    cache_dir: Option<&Path>,
    cache_namespace: Option<&str>,
    metrics: &mut ClaudeSessionSourceFactCacheMetrics,
) -> ClaudeSessionScanOutcome {
    let (file_size_bytes, file_mtime_ms) = source_fact_file_fingerprint(path).await;
    let cache_path = if file_size_bytes.is_some() && file_mtime_ms.is_some() {
        cache_dir.zip(cache_namespace).map(|(dir, namespace)| {
            source_fact_cache_path(dir, namespace, path, allow_project_directory_fallback)
        })
    } else {
        None
    };

    if let (Some(cache_path), Some(namespace)) = (cache_path.as_ref(), cache_namespace) {
        if let Some(outcome) = read_cached_source_fact_outcome(
            cache_path,
            namespace,
            path,
            file_size_bytes,
            file_mtime_ms,
            metrics,
        )
        .await
        {
            return outcome;
        }
    }

    let outcome = scan_session_source_file_preview(
        path,
        attribution_scopes,
        allow_project_directory_fallback,
    )
    .await;

    if let (Some(cache_path), Some(namespace)) = (cache_path.as_ref(), cache_namespace) {
        write_cached_source_fact_outcome(
            cache_path,
            namespace,
            path,
            file_size_bytes,
            file_mtime_ms,
            &outcome,
            metrics,
        )
        .await;
    }

    outcome
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ClaudeSessionScanDepth {
    /// Sidebar / catalog list: stop after a bounded head peek.
    Preview,
    /// Cache rebuild / diagnostic path: read to EOF for counts and last title.
    Full,
}

/// Scan a single JSONL file and extract session summary metadata.
/// Preview stops after a bounded head peek; Full reads to EOF.
pub(crate) async fn scan_session_source_file(
    path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
) -> ClaudeSessionScanOutcome {
    scan_session_source_file_with_depth(
        path,
        attribution_scopes,
        allow_project_directory_fallback,
        ClaudeSessionScanDepth::Full,
    )
    .await
}

async fn scan_session_source_file_preview(
    path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
) -> ClaudeSessionScanOutcome {
    scan_session_source_file_with_depth(
        path,
        attribution_scopes,
        allow_project_directory_fallback,
        ClaudeSessionScanDepth::Preview,
    )
    .await
}

async fn scan_session_source_file_with_depth(
    path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
    depth: ClaudeSessionScanDepth,
) -> ClaudeSessionScanOutcome {
    let mut diagnostics = Vec::new();
    let file = match fs::File::open(path).await {
        Ok(file) => {
            record_claude_scan_open(path);
            file
        }
        Err(_) => {
            diagnostics.push(build_scan_diagnostic(
                ClaudeSessionScanDiagnosticCode::UnreadableFile,
                path,
                path.file_stem()
                    .and_then(|value| value.to_str())
                    .map(ToString::to_string),
                None,
            ));
            return ClaudeSessionScanOutcome {
                fact: None,
                diagnostics,
            };
        }
    };
    let file_metadata = file.metadata().await.ok();
    let file_size_bytes = file_metadata.as_ref().map(|metadata| metadata.len());
    let file_mtime_ms = file_metadata
        .and_then(|metadata| metadata.modified().ok())
        .and_then(system_time_to_epoch_millis);
    // Do not `take(64KiB)` on the reader: a first-line custom-title / first-user
    // payload can be larger (redacted image) and must still parse. Preview stops
    // after the budget in the line loop, so sparse tails are never consumed.
    let mut lines = BufReader::new(file).lines();
    let mut preview_lines_seen = 0usize;
    let mut preview_bytes_seen: u64 = 0;

    let mut first_user_message: Option<String> = None;
    let mut latest_native_title: Option<String> = None;
    let mut first_timestamp: Option<i64> = None;
    let mut last_timestamp: Option<i64> = None;
    let mut message_count: usize = 0;
    let mut transcript_cwd: Option<String> = None;
    let mut malformed_line_count: usize = 0;
    let mut read_error_count: usize = 0;
    let mut suppress_polluted_assistant_until_next_user = false;

    loop {
        let Some(line) = (match lines.next_line().await {
            Ok(line) => line,
            Err(_) => {
                read_error_count += 1;
                break;
            }
        }) else {
            break;
        };
        let line_bytes = line.len() as u64 + 1;
        if depth == ClaudeSessionScanDepth::Preview {
            record_claude_scan_read_bytes(path, line_bytes);
            preview_bytes_seen = preview_bytes_seen.saturating_add(line_bytes);
        }
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }
        if depth == ClaudeSessionScanDepth::Preview {
            preview_lines_seen += 1;
            if preview_lines_seen > CLAUDE_LIST_PREVIEW_MAX_LINES {
                break;
            }
            if line.len() > CLAUDE_LIST_SKIP_LINE_BYTES
                && (first_user_message.is_some() || latest_native_title.is_some())
            {
                break;
            }
        }

        let entry: Value = match parse_claude_summary_entry(&line) {
            Ok(v) => v,
            Err(_) => {
                malformed_line_count += 1;
                continue;
            }
        };

        if entry.get("type").and_then(Value::as_str) == Some("custom-title") {
            if let Some(title) = first_non_empty_string(entry.get("customTitle")) {
                latest_native_title = Some(title);
            }
        }

        let classification = classify_claude_history_entry(&entry);
        if matches!(
            classification,
            ClaudeHistoryEntryClassification::Hidden(
                ClaudeHistoryHiddenReason::StreamJsonStdinPayload
            )
        ) {
            suppress_polluted_assistant_until_next_user = true;
            continue;
        }
        if matches!(classification, ClaudeHistoryEntryClassification::Hidden(_)) {
            continue;
        }

        if transcript_cwd.is_none() {
            transcript_cwd = extract_claude_entry_cwd(&entry);
        }

        // Track timestamps from any entry that has one
        if let Some(ts_str) = entry.get("timestamp").and_then(|v| v.as_str()) {
            if let Some(ts) = parse_timestamp(ts_str) {
                if first_timestamp.is_none() {
                    first_timestamp = Some(ts);
                }
                last_timestamp = Some(ts);
            }
        }

        // Count message entries (user or assistant)
        let msg = entry.get("message");
        let role = msg
            .and_then(|m| m.get("role"))
            .and_then(|r| r.as_str())
            .unwrap_or("");
        let is_meta = is_claude_meta_entry(&entry, msg);

        if suppress_polluted_assistant_until_next_user && role == "assistant" {
            continue;
        }
        if suppress_polluted_assistant_until_next_user
            && role == "user"
            && matches!(classification, ClaudeHistoryEntryClassification::Normal)
        {
            suppress_polluted_assistant_until_next_user = false;
        }

        if (role == "user" || role == "assistant")
            && matches!(classification, ClaudeHistoryEntryClassification::Normal)
            && !is_meta
        {
            message_count += 1;
        }

        // Extract first user message (non-meta, non-filtered)
        if first_user_message.is_none()
            && role == "user"
            && matches!(classification, ClaudeHistoryEntryClassification::Normal)
        {
            if is_meta {
                continue;
            }

            if let Some(content) = msg.and_then(|m| m.get("content")) {
                if let Some(text) = extract_text_from_content(content) {
                    first_user_message = Some(truncate(
                        &extract_command_prompt_text(&text),
                        CLAUDE_SESSION_TITLE_PREVIEW_MAX_CHARS,
                    ));
                }
            }
        }

        if depth == ClaudeSessionScanDepth::Preview {
            let has_title = first_user_message.is_some() || latest_native_title.is_some();
            if has_title && first_timestamp.is_some() {
                break;
            }
            if preview_lines_seen >= CLAUDE_LIST_PREVIEW_MAX_LINES {
                break;
            }
            if preview_bytes_seen >= CLAUDE_LIST_SCAN_MAX_BYTES {
                break;
            }
        }
    }

    let session_id = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let diagnostic_session_id = if session_id.is_empty() {
        None
    } else {
        Some(session_id.clone())
    };

    if malformed_line_count > 0 {
        diagnostics.push(build_scan_diagnostic(
            ClaudeSessionScanDiagnosticCode::MalformedTranscript,
            path,
            diagnostic_session_id.clone(),
            transcript_cwd.clone(),
        ));
    }
    if read_error_count > 0 {
        diagnostics.push(build_scan_diagnostic(
            ClaudeSessionScanDiagnosticCode::UnreadableFile,
            path,
            diagnostic_session_id.clone(),
            transcript_cwd.clone(),
        ));
    }

    if message_count < 1 {
        diagnostics.push(build_scan_diagnostic(
            if read_error_count > 0 {
                ClaudeSessionScanDiagnosticCode::UnreadableFile
            } else if malformed_line_count > 0 {
                ClaudeSessionScanDiagnosticCode::MalformedTranscript
            } else {
                ClaudeSessionScanDiagnosticCode::EmptyTranscript
            },
            path,
            diagnostic_session_id,
            transcript_cwd,
        ));
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics,
        };
    }

    if session_id.is_empty() {
        diagnostics.push(build_scan_diagnostic(
            ClaudeSessionScanDiagnosticCode::MissingSessionId,
            path,
            None,
            transcript_cwd,
        ));
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics,
        };
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let matched_scope_reason = transcript_cwd.as_deref().and_then(|cwd| {
        attribution_scopes
            .iter()
            .find(|scope| crate::local_usage::path_matches_workspace(cwd, &scope.path))
            .map(|scope| scope.reason.clone())
    });
    // Explicit transcript cwd always wins over project-directory placement.
    // Claude's encode_project_path maps distinct non-ASCII paths onto the same
    // bucket (e.g. 新的空文件夹 vs 个人财务管理), so trusting the project dir
    // when cwd points elsewhere leaks foreign history into empty/new folders.
    // Project-directory fallback remains only for missing-cwd transcripts.
    if transcript_cwd.is_some() && matched_scope_reason.is_none() {
        diagnostics.push(build_scan_diagnostic(
            ClaudeSessionScanDiagnosticCode::CwdOutsideAttributionScope,
            path,
            Some(session_id),
            transcript_cwd,
        ));
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics,
        };
    }
    if transcript_cwd.is_none() && !allow_project_directory_fallback {
        diagnostics.push(build_scan_diagnostic(
            ClaudeSessionScanDiagnosticCode::MissingCwdWithoutFallback,
            path,
            Some(session_id),
            None,
        ));
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics,
        };
    }
    let attribution_reason = Some(
        matched_scope_reason
            .unwrap_or_else(|| CLAUDE_ATTRIBUTION_REASON_PROJECT_DIRECTORY.to_string()),
    );
    ClaudeSessionScanOutcome {
        fact: Some(ClaudeSessionSourceFact {
            canonical_session_id: session_id.clone(),
            display_session_id: session_id,
            physical_path: path.to_string_lossy().to_string(),
            claude_project_dir: path
                .parent()
                .map(|parent| parent.to_string_lossy().to_string()),
            cwd: transcript_cwd,
            parent_session_id: None,
            first_real_user_message: first_user_message,
            native_title: latest_native_title,
            source_health: if malformed_line_count > 0 || read_error_count > 0 {
                "partial".to_string()
            } else {
                "complete".to_string()
            },
            updated_at: match depth {
                ClaudeSessionScanDepth::Preview => {
                    file_mtime_ms.or(last_timestamp).unwrap_or(now_ms)
                }
                ClaudeSessionScanDepth::Full => last_timestamp.unwrap_or(now_ms),
            },
            created_at: first_timestamp.or(file_mtime_ms).unwrap_or(now_ms),
            message_count,
            file_size_bytes,
            file_mtime_ms,
            attribution_status: Some(CLAUDE_ATTRIBUTION_STRICT_MATCH.to_string()),
            attribution_reason,
            subagent_type: None,
        }),
        diagnostics,
    }
}

pub(crate) fn is_claude_meta_entry(entry: &Value, msg: Option<&Value>) -> bool {
    entry
        .get("isMeta")
        .or_else(|| msg.and_then(|message| message.get("isMeta")))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

async fn scan_session_file(
    path: &Path,
    _workspace_path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
) -> Option<ClaudeSessionSummary> {
    scan_session_source_file_preview(path, attribution_scopes, allow_project_directory_fallback)
        .await
        .into_summary()
}

async fn scan_subagent_session_file(
    path: &Path,
    parent_session_id: &str,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
) -> Option<ClaudeSessionSummary> {
    let agent_file_stem = path.file_stem().and_then(|s| s.to_str())?;
    let agent_id = agent_file_stem.strip_prefix("agent-")?;
    let subagent_session_id =
        ClaudeSubagentSessionId::from_path_segments(parent_session_id, agent_id)?;
    let (description, subagent_type) = read_subagent_meta(&path.with_extension("meta.json")).await;
    let mut summary = scan_session_file(
        path,
        Path::new(""),
        attribution_scopes,
        allow_project_directory_fallback,
    )
    .await?;
    summary.session_id = subagent_session_id.to_session_id();
    if let Some(description) = description {
        summary.first_message = truncate(&description, CLAUDE_SESSION_TITLE_PREVIEW_MAX_CHARS);
    }
    summary.parent_session_id = Some(parent_session_id.to_string());
    summary.subagent_type = subagent_type;
    Some(summary)
}

async fn scan_subagent_source_file(
    path: &Path,
    parent_session_id: &str,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    allow_project_directory_fallback: bool,
    cache_dir: Option<&Path>,
    cache_namespace: Option<&str>,
    cache_metrics: &mut ClaudeSessionSourceFactCacheMetrics,
) -> ClaudeSessionScanOutcome {
    let Some(agent_file_stem) = path.file_stem().and_then(|s| s.to_str()) else {
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics: vec![build_scan_diagnostic(
                ClaudeSessionScanDiagnosticCode::MissingSessionId,
                path,
                None,
                None,
            )],
        };
    };
    let Some(agent_id) = agent_file_stem.strip_prefix("agent-") else {
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics: vec![build_scan_diagnostic(
                ClaudeSessionScanDiagnosticCode::MissingSessionId,
                path,
                None,
                None,
            )],
        };
    };
    let Some(subagent_session_id) =
        ClaudeSubagentSessionId::from_path_segments(parent_session_id, agent_id)
    else {
        return ClaudeSessionScanOutcome {
            fact: None,
            diagnostics: vec![build_scan_diagnostic(
                ClaudeSessionScanDiagnosticCode::MissingSessionId,
                path,
                None,
                None,
            )],
        };
    };
    let mut outcome = scan_session_source_file_with_cache(
        path,
        attribution_scopes,
        allow_project_directory_fallback,
        cache_dir,
        cache_namespace,
        cache_metrics,
    )
    .await;
    if let Some(fact) = outcome.fact.as_mut() {
        let (description, subagent_type) =
            read_subagent_meta(&path.with_extension("meta.json")).await;
        fact.canonical_session_id = subagent_session_id.to_session_id();
        fact.display_session_id = fact.canonical_session_id.clone();
        fact.parent_session_id = Some(parent_session_id.to_string());
        if let Some(description) = description {
            fact.first_real_user_message = Some(truncate(
                &description,
                CLAUDE_SESSION_TITLE_PREVIEW_MAX_CHARS,
            ));
        }
        fact.subagent_type = subagent_type;
    }
    outcome
}

pub async fn list_claude_sessions_with_config(
    workspace_path: &Path,
    limit: Option<usize>,
    config: Option<&EngineConfig>,
) -> Result<Vec<ClaudeSessionSummary>, String> {
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    let attribution_scopes = vec![ClaudeSessionAttributionScope::workspace_path(
        workspace_path.to_path_buf(),
    )];
    list_claude_sessions_from_base_dir(&base_dir, workspace_path, &attribution_scopes, limit).await
}

pub async fn list_claude_sessions_for_attribution_scopes_with_config(
    workspace_path: &Path,
    attribution_scopes: Vec<ClaudeSessionAttributionScope>,
    limit: Option<usize>,
    config: Option<&EngineConfig>,
) -> Result<Vec<ClaudeSessionSummary>, String> {
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    list_claude_sessions_from_base_dir(&base_dir, workspace_path, &attribution_scopes, limit).await
}

pub(crate) async fn list_claude_session_source_facts_for_attribution_scopes_with_config(
    workspace_path: &Path,
    attribution_scopes: Vec<ClaudeSessionAttributionScope>,
    limit: Option<usize>,
    config: Option<&EngineConfig>,
    cache_dir: Option<&Path>,
) -> Result<ClaudeSessionSourceFactList, String> {
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    list_claude_session_source_facts_from_base_dir(
        &base_dir,
        workspace_path,
        &attribution_scopes,
        limit,
        cache_dir,
    )
    .await
}

pub(crate) async fn list_workspace_only_claude_session_source_facts_for_attribution_scopes_with_config(
    workspace_path: &Path,
    attribution_scopes: Vec<ClaudeSessionAttributionScope>,
    limit: Option<usize>,
    config: Option<&EngineConfig>,
    cache_dir: Option<&Path>,
) -> Result<ClaudeSessionSourceFactList, String> {
    let base_dir = claude_projects_dir(config).ok_or("Cannot determine Claude home directory")?;
    list_workspace_only_claude_session_source_facts_from_base_dir(
        &base_dir,
        workspace_path,
        &attribution_scopes,
        limit,
        cache_dir,
    )
    .await
}

pub(crate) async fn list_workspace_only_claude_session_source_facts_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    limit: Option<usize>,
    cache_dir: Option<&Path>,
) -> Result<ClaudeSessionSourceFactList, String> {
    timeout(LOCAL_SESSION_SCAN_TIMEOUT, async {
        let cache_namespace =
            workspace_only_source_fact_cache_namespace(base_dir, attribution_scopes);
        let project_dirs = claude_project_dirs_for_path(base_dir, workspace_path);
        let mut jsonl_paths: Vec<(PathBuf, bool)> = Vec::new();
        let mut subagent_jsonl_paths: Vec<(PathBuf, String, bool)> = Vec::new();
        let mut seen_paths = HashSet::new();
        let mut diagnostics = Vec::new();
        let mut found_dir = false;

        for project_dir in project_dirs {
            if !project_dir.exists() {
                continue;
            }
            found_dir = true;
            let mut entries = match fs::read_dir(&project_dir).await {
                Ok(entries) => entries,
                Err(_) => {
                    diagnostics.push(build_scan_diagnostic(
                        ClaudeSessionScanDiagnosticCode::UnreadableFile,
                        &project_dir,
                        None,
                        None,
                    ));
                    continue;
                }
            };

            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    if seen_paths.insert(path.clone()) {
                        jsonl_paths.push((path.clone(), true));
                    }
                    let parent_session_id = name.trim_end_matches(".jsonl").to_string();
                    let subagents_dir = path.with_extension("").join("subagents");
                    if subagents_dir.exists() {
                        let mut subagent_entries = match fs::read_dir(&subagents_dir).await {
                            Ok(entries) => entries,
                            Err(_) => {
                                diagnostics.push(build_scan_diagnostic(
                                    ClaudeSessionScanDiagnosticCode::UnreadableFile,
                                    &subagents_dir,
                                    Some(parent_session_id.clone()),
                                    None,
                                ));
                                continue;
                            }
                        };
                        while let Ok(Some(subagent_entry)) = subagent_entries.next_entry().await {
                            let subagent_path = subagent_entry.path();
                            let Some(subagent_name) =
                                subagent_path.file_name().and_then(|n| n.to_str())
                            else {
                                continue;
                            };
                            if subagent_name.starts_with("agent-")
                                && subagent_name.ends_with(".jsonl")
                                && seen_paths.insert(subagent_path.clone())
                            {
                                subagent_jsonl_paths.push((
                                    subagent_path,
                                    parent_session_id.clone(),
                                    true,
                                ));
                            }
                        }
                    }
                }
            }
        }

        if !found_dir {
            return Ok(ClaudeSessionSourceFactList {
                facts: Vec::new(),
                diagnostics: Vec::new(),
                scanned_candidates: 0,
                skipped_candidates: 0,
                scan_cap_reached: false,
                cache_metrics: ClaudeSessionSourceFactCacheMetrics::default(),
            });
        }

        let discovered_candidates = jsonl_paths.len() + subagent_jsonl_paths.len();
        cap_claude_scan_paths_by_mtime(
            &mut jsonl_paths,
            &mut subagent_jsonl_paths,
            limit.unwrap_or(200),
        );
        jsonl_paths.sort_by(|left, right| left.0.cmp(&right.0));
        subagent_jsonl_paths.sort_by(|left, right| left.0.cmp(&right.0));
        let scanned_candidates = jsonl_paths.len() + subagent_jsonl_paths.len();
        let scan_cap_reached = discovered_candidates > limit.unwrap_or(200);
        let mut facts = Vec::new();
        let mut cache_metrics = ClaudeSessionSourceFactCacheMetrics::default();

        for (path, allow_fallback) in jsonl_paths {
            let outcome = scan_session_source_file_with_cache(
                &path,
                attribution_scopes,
                allow_fallback,
                cache_dir,
                Some(&cache_namespace),
                &mut cache_metrics,
            )
            .await;
            diagnostics.extend(outcome.diagnostics);
            if let Some(fact) = outcome.fact {
                facts.push(fact);
            }
        }
        for (path, parent_session_id, allow_fallback) in subagent_jsonl_paths {
            let outcome = scan_subagent_source_file(
                &path,
                &parent_session_id,
                attribution_scopes,
                allow_fallback,
                cache_dir,
                Some(&cache_namespace),
                &mut cache_metrics,
            )
            .await;
            diagnostics.extend(outcome.diagnostics);
            if let Some(fact) = outcome.fact {
                facts.push(fact);
            }
        }

        facts.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        let limited_facts =
            limit_claude_source_facts_preserving_relationships(facts, limit.unwrap_or(200));

        let skipped_candidates = diagnostics
            .iter()
            .filter(|diagnostic| {
                matches!(
                    diagnostic.code,
                    ClaudeSessionScanDiagnosticCode::CwdOutsideAttributionScope
                        | ClaudeSessionScanDiagnosticCode::MissingCwdWithoutFallback
                        | ClaudeSessionScanDiagnosticCode::EmptyTranscript
                        | ClaudeSessionScanDiagnosticCode::MalformedTranscript
                        | ClaudeSessionScanDiagnosticCode::MissingSessionId
                        | ClaudeSessionScanDiagnosticCode::UnreadableFile
                )
            })
            .count();

        Ok(ClaudeSessionSourceFactList {
            facts: limited_facts,
            diagnostics,
            scanned_candidates,
            skipped_candidates,
            scan_cap_reached,
            cache_metrics,
        })
    })
    .await
    .map_err(|_| "Claude workspace-only session source fact scan timed out".to_string())?
}

pub(crate) async fn list_claude_session_source_facts_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    limit: Option<usize>,
    cache_dir: Option<&Path>,
) -> Result<ClaudeSessionSourceFactList, String> {
    timeout(LOCAL_SESSION_SCAN_TIMEOUT, async {
        let cache_namespace = source_fact_cache_namespace(base_dir, attribution_scopes);
        let project_dirs = claude_project_dirs_for_path(base_dir, workspace_path);
        let project_dir_set = project_dirs.iter().cloned().collect::<HashSet<_>>();
        let mut scan_dirs = Vec::new();
        let mut seen_dirs = HashSet::new();
        for dir in project_dirs {
            if seen_dirs.insert(dir.clone()) {
                scan_dirs.push((dir, true));
            }
        }
        for dir in all_claude_project_dirs(base_dir) {
            if seen_dirs.insert(dir.clone()) {
                scan_dirs.push((dir, false));
            }
        }

        let mut jsonl_paths: Vec<(PathBuf, bool)> = Vec::new();
        let mut subagent_jsonl_paths: Vec<(PathBuf, String, bool)> = Vec::new();
        let mut seen_paths = HashSet::new();
        let mut diagnostics = Vec::new();
        let mut found_dir = false;

        for (project_dir, allow_fallback) in scan_dirs {
            if !project_dir.exists() {
                continue;
            }
            found_dir = true;
            let mut entries = match fs::read_dir(&project_dir).await {
                Ok(entries) => entries,
                Err(_) => {
                    diagnostics.push(build_scan_diagnostic(
                        ClaudeSessionScanDiagnosticCode::UnreadableFile,
                        &project_dir,
                        None,
                        None,
                    ));
                    continue;
                }
            };

            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                    continue;
                };
                if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                    let is_direct_project_dir = project_dir_set.contains(&project_dir);
                    let allow_session_fallback = allow_fallback && is_direct_project_dir;
                    if seen_paths.insert(path.clone()) {
                        jsonl_paths.push((path.clone(), allow_session_fallback));
                    }
                    let parent_session_id = name.trim_end_matches(".jsonl").to_string();
                    let subagents_dir = path.with_extension("").join("subagents");
                    if subagents_dir.exists() {
                        let mut subagent_entries = match fs::read_dir(&subagents_dir).await {
                            Ok(entries) => entries,
                            Err(_) => {
                                diagnostics.push(build_scan_diagnostic(
                                    ClaudeSessionScanDiagnosticCode::UnreadableFile,
                                    &subagents_dir,
                                    Some(parent_session_id.clone()),
                                    None,
                                ));
                                continue;
                            }
                        };
                        while let Ok(Some(subagent_entry)) = subagent_entries.next_entry().await {
                            let subagent_path = subagent_entry.path();
                            let Some(subagent_name) =
                                subagent_path.file_name().and_then(|n| n.to_str())
                            else {
                                continue;
                            };
                            if subagent_name.starts_with("agent-")
                                && subagent_name.ends_with(".jsonl")
                                && seen_paths.insert(subagent_path.clone())
                            {
                                subagent_jsonl_paths.push((
                                    subagent_path,
                                    parent_session_id.clone(),
                                    allow_session_fallback,
                                ));
                            }
                        }
                    }
                }
            }
        }

        if !found_dir {
            return Ok(ClaudeSessionSourceFactList {
                facts: Vec::new(),
                diagnostics: Vec::new(),
                scanned_candidates: 0,
                skipped_candidates: 0,
                scan_cap_reached: false,
                cache_metrics: ClaudeSessionSourceFactCacheMetrics::default(),
            });
        }

        let discovered_candidates = jsonl_paths.len() + subagent_jsonl_paths.len();
        cap_claude_scan_paths_by_mtime(
            &mut jsonl_paths,
            &mut subagent_jsonl_paths,
            limit.unwrap_or(200),
        );
        jsonl_paths.sort_by(|left, right| left.0.cmp(&right.0));
        subagent_jsonl_paths.sort_by(|left, right| left.0.cmp(&right.0));
        let scanned_candidates = jsonl_paths.len() + subagent_jsonl_paths.len();
        let scan_cap_reached = discovered_candidates > limit.unwrap_or(200);
        let mut facts = Vec::new();
        let mut cache_metrics = ClaudeSessionSourceFactCacheMetrics::default();

        for (path, allow_fallback) in jsonl_paths {
            let outcome = scan_session_source_file_with_cache(
                &path,
                attribution_scopes,
                allow_fallback,
                cache_dir,
                Some(&cache_namespace),
                &mut cache_metrics,
            )
            .await;
            diagnostics.extend(outcome.diagnostics);
            if let Some(fact) = outcome.fact {
                facts.push(fact);
            }
        }
        for (path, parent_session_id, allow_fallback) in subagent_jsonl_paths {
            let outcome = scan_subagent_source_file(
                &path,
                &parent_session_id,
                attribution_scopes,
                allow_fallback,
                cache_dir,
                Some(&cache_namespace),
                &mut cache_metrics,
            )
            .await;
            diagnostics.extend(outcome.diagnostics);
            if let Some(fact) = outcome.fact {
                facts.push(fact);
            }
        }

        facts.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        let limited_facts =
            limit_claude_source_facts_preserving_relationships(facts, limit.unwrap_or(200));

        let skipped_candidates = diagnostics
            .iter()
            .filter(|diagnostic| {
                matches!(
                    diagnostic.code,
                    ClaudeSessionScanDiagnosticCode::CwdOutsideAttributionScope
                        | ClaudeSessionScanDiagnosticCode::MissingCwdWithoutFallback
                        | ClaudeSessionScanDiagnosticCode::EmptyTranscript
                        | ClaudeSessionScanDiagnosticCode::MalformedTranscript
                        | ClaudeSessionScanDiagnosticCode::MissingSessionId
                        | ClaudeSessionScanDiagnosticCode::UnreadableFile
                )
            })
            .count();

        Ok(ClaudeSessionSourceFactList {
            facts: limited_facts,
            diagnostics,
            scanned_candidates,
            skipped_candidates,
            scan_cap_reached,
            cache_metrics,
        })
    })
    .await
    .map_err(|_| "Claude session source fact scan timed out".to_string())?
}

pub(crate) async fn list_claude_sessions_from_base_dir(
    base_dir: &Path,
    workspace_path: &Path,
    attribution_scopes: &[ClaudeSessionAttributionScope],
    limit: Option<usize>,
) -> Result<Vec<ClaudeSessionSummary>, String> {
    timeout(LOCAL_SESSION_SCAN_TIMEOUT, async {
        let project_dirs = claude_project_dirs_for_path(base_dir, workspace_path);
        let project_dir_set = project_dirs.iter().cloned().collect::<HashSet<_>>();
        let mut scan_dirs = Vec::new();
        let mut seen_dirs = HashSet::new();
        for dir in project_dirs {
            if seen_dirs.insert(dir.clone()) {
                scan_dirs.push((dir, true));
            }
        }
        for dir in all_claude_project_dirs(base_dir) {
            if seen_dirs.insert(dir.clone()) {
                scan_dirs.push((dir, false));
            }
        }

        let mut jsonl_paths: Vec<(PathBuf, bool)> = Vec::new();
        let mut seen_paths = HashSet::new();
        let mut found_dir = false;

        for (project_dir, allow_fallback) in scan_dirs {
            if !project_dir.exists() {
                continue;
            }
            found_dir = true;
            let mut entries = fs::read_dir(&project_dir)
                .await
                .map_err(|e| format!("Failed to read Claude project directory: {}", e))?;

            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if name.ends_with(".jsonl") && !name.starts_with("agent-") {
                        let is_direct_project_dir = project_dir_set.contains(&project_dir);
                        let allow_session_fallback = allow_fallback && is_direct_project_dir;
                        if seen_paths.insert(path.clone()) {
                            jsonl_paths.push((path.clone(), allow_session_fallback));
                        }
                    }
                }
            }
        }

        if !found_dir {
            return Ok(Vec::new());
        }

        // IO-before-limit: metadata/mtime only, then scan the newest `limit` files.
        // Sidebar list does not inventory subagent jsonl.
        let mut unused_subagent_jsonl_paths: Vec<(PathBuf, String, bool)> = Vec::new();
        cap_claude_scan_paths_by_mtime(
            &mut jsonl_paths,
            &mut unused_subagent_jsonl_paths,
            limit.unwrap_or(CLAUDE_LIST_DEFAULT_LIMIT),
        );

        // Scan all session files concurrently with a concurrency limit to prevent
        // memory exhaustion from spawning too many parallel file reads.
        const MAX_CONCURRENT_SCANS: usize = 10;
        let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_SCANS));
        let mut handles = Vec::new();
        for (path, allow_fallback) in jsonl_paths {
            let permit = semaphore.clone();
            let workspace_path = workspace_path.to_path_buf();
            let attribution_scopes = attribution_scopes.to_vec();
            handles.push(tokio::spawn(async move {
                let _permit = permit.acquire().await;
                scan_session_file(&path, &workspace_path, &attribution_scopes, allow_fallback).await
            }));
        }

        let mut sessions: Vec<ClaudeSessionSummary> = Vec::new();
        for handle in handles {
            if let Ok(Some(summary)) = handle.await {
                sessions.push(summary);
            }
        }

        // Sort by updated_at descending (most recent first)
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(limit_claude_sessions_preserving_relationships(
            sessions,
            limit.unwrap_or(CLAUDE_LIST_DEFAULT_LIMIT),
        ))
    })
    .await
    .map_err(|_| "Claude session scan timed out".to_string())?
}

fn limit_claude_sessions_preserving_relationships(
    sessions: Vec<ClaudeSessionSummary>,
    limit: usize,
) -> Vec<ClaudeSessionSummary> {
    if sessions.len() <= limit {
        return sessions;
    }

    let by_session_id: HashMap<String, ClaudeSessionSummary> = sessions
        .iter()
        .cloned()
        .map(|session| (session.session_id.clone(), session))
        .collect();
    let mut selected_ids: HashSet<String> = sessions
        .iter()
        .take(limit)
        .map(|session| session.session_id.clone())
        .collect();

    for session in sessions.iter().take(limit) {
        if let Some(parent_session_id) = session.parent_session_id.as_ref() {
            selected_ids.insert(parent_session_id.clone());
        }
    }

    let selected_parent_ids: HashSet<String> = selected_ids
        .iter()
        .filter(|session_id| {
            by_session_id
                .get(*session_id)
                .map(|session| session.parent_session_id.is_none())
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    for session in &sessions {
        if let Some(parent_session_id) = session.parent_session_id.as_ref() {
            if selected_parent_ids.contains(parent_session_id) {
                selected_ids.insert(session.session_id.clone());
            }
        }
    }

    let mut selected = sessions
        .into_iter()
        .filter(|session| selected_ids.contains(&session.session_id))
        .collect::<Vec<_>>();
    selected.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    selected
}

fn limit_claude_source_facts_preserving_relationships(
    facts: Vec<ClaudeSessionSourceFact>,
    limit: usize,
) -> Vec<ClaudeSessionSourceFact> {
    if facts.len() <= limit {
        return facts;
    }

    let by_session_id: HashMap<String, ClaudeSessionSourceFact> = facts
        .iter()
        .cloned()
        .map(|fact| (fact.canonical_session_id.clone(), fact))
        .collect();
    let mut selected_ids: HashSet<String> = facts
        .iter()
        .take(limit)
        .map(|fact| fact.canonical_session_id.clone())
        .collect();

    for fact in facts.iter().take(limit) {
        if let Some(parent_session_id) = fact.parent_session_id.as_ref() {
            selected_ids.insert(parent_session_id.clone());
        }
    }

    let selected_parent_ids: HashSet<String> = selected_ids
        .iter()
        .filter(|session_id| {
            by_session_id
                .get(*session_id)
                .map(|fact| fact.parent_session_id.is_none())
                .unwrap_or(false)
        })
        .cloned()
        .collect();
    for fact in &facts {
        if let Some(parent_session_id) = fact.parent_session_id.as_ref() {
            if selected_parent_ids.contains(parent_session_id) {
                selected_ids.insert(fact.canonical_session_id.clone());
            }
        }
    }

    let mut selected = facts
        .into_iter()
        .filter(|fact| selected_ids.contains(&fact.canonical_session_id))
        .collect::<Vec<_>>();
    selected.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    selected
}
