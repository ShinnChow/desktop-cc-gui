use chrono::{DateTime, Duration, Local, TimeZone, Utc};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::{Duration as StdDuration, Instant, SystemTime, UNIX_EPOCH};
use tauri::State;
use tokio::sync::Mutex;
use tokio::time::timeout;

use crate::app_paths;
use crate::codex::home::{resolve_default_codex_home, resolve_workspace_codex_home};
use crate::state::AppState;
use crate::types::{
    LocalUsageDay, LocalUsageModel, LocalUsageSessionSummary, LocalUsageSnapshot, LocalUsageTotals,
    LocalUsageUsageData, WorkspaceEntry,
};

#[path = "local_usage/codex_rewind.rs"]
mod codex_rewind;
pub(crate) use codex_rewind::commit_codex_rewind_for_workspace;
#[path = "local_usage/session_delete.rs"]
mod session_delete;
pub(crate) use session_delete::{
    delete_codex_session_file_at, delete_codex_session_for_workspace,
    delete_codex_sessions_for_workspace, locate_codex_session_file_fast,
};

#[path = "local_usage/codex_session_list.rs"]
mod codex_session_list;
pub(crate) use codex_session_list::{
    collect_codex_jsonl_candidates_capped, collect_jsonl_files,
    list_codex_day_partitions, scan_codex_session_summaries_bounded_with_mode,
    scan_codex_session_summaries_for_day_dirs, scan_codex_session_summaries_for_files,
    scan_codex_session_summaries_for_index,
};
#[cfg(test)]
pub(crate) use codex_session_list::{
    collect_codex_jsonl_candidates_recent_first, resolve_codex_candidate_scan_limit,
    scan_codex_session_summaries,
};

#[path = "local_usage/codex_session_parse.rs"]
mod codex_session_parse;
pub(crate) use codex_session_parse::{
    infer_managed_codex_provider_profile_id_from_session_path,
    parse_codex_session_summary_with_mode,
};
#[cfg(test)]
pub(crate) use codex_session_parse::{parse_codex_session_summary};

#[path = "local_usage/codex_summary_helpers.rs"]
mod codex_summary_helpers;
pub(crate) use codex_summary_helpers::{
    CodexSubagentSessionMetadata, codex_subagent_display_title, count_apply_patch_changed_lines,
    extract_codex_message_text, extract_codex_subagent_metadata_from_session_value,
    extract_session_id_from_session_value, extract_source_provider_from_session_value,
    extract_tool_output_text, is_codex_background_helper_text, is_codex_session_title_candidate,
    is_successful_apply_patch_output, parse_changed_lines_from_git_diff_stat_output,
    peek_codex_session_titles, read_string_from_object, stringify_tool_output_value,
    truncate_summary,
};

#[path = "local_usage/codex_session_roots.rs"]
mod codex_session_roots;
pub(crate) use codex_session_roots::{
    day_dir_for_key, make_day_keys, resolve_sessions_roots,
    resolve_sessions_roots_with_diagnostics,
};
#[cfg(test)]
pub(crate) use codex_session_roots::{
    merge_codex_session_roots, resolve_managed_codex_provider_session_roots_from_root,
    resolve_workspace_codex_home_for_path,
};

#[path = "local_usage/claude_scan.rs"]
mod claude_scan;
pub(crate) use claude_scan::{scan_claude_projects};

#[derive(Default, Clone, Copy)]
pub(crate) struct DailyTotals {
    input: i64,
    cached: i64,
    output: i64,
    agent_ms: i64,
    agent_runs: i64,
}

#[derive(Default, Clone, Copy)]
pub(crate) struct UsageTotals {
    input: i64,
    cached: i64,
    output: i64,
}

const MAX_ACTIVITY_GAP_MS: i64 = 2 * 60 * 1000;
const LOCAL_SESSION_SCAN_TIMEOUT: StdDuration = StdDuration::from_secs(60);
/// Codex 列表扫描内层硬截止：对齐前端 catalog 30s 超时 +2s 余量。
/// 外层 `timeout(LOCAL_SESSION_SCAN_TIMEOUT, spawn_blocking)` 只放弃
/// JoinHandle，扫描线程会继续 open/read 到自然结束（Windows Defender 下
/// 单文件 open 可达数十 ms，≤200 候选/根 × 多根可拖数分钟），与后续扫描
/// 叠加成 IO 风暴。内层 deadline 保证线程在 ~32s 内真正退出
/// （fix-codex-scan-deadline-abort）。
const CODEX_LIST_SCAN_DEADLINE: StdDuration = StdDuration::from_secs(32);
pub(crate) const CODEX_SCAN_DEADLINE_EXCEEDED: &str = "codex session scan deadline exceeded";
pub(crate) const CODEX_THREAD_PREVIEW_MAX_BYTES: u64 = 256 * 1024;
pub(crate) const CODEX_BOUNDED_CANDIDATE_LOOKAHEAD: usize = 20;
pub(crate) const CODEX_PROVIDER_PROFILE_SOURCE_MANAGED: &str = "managed";
pub(crate) const CODEX_PROVIDER_PROFILE_AVAILABILITY_UNKNOWN: &str = "unknown";
pub(crate) const CODEX_BACKGROUND_HELPER_PROMPT_PREFIXES: &[&str] = &[
    "Generate a concise title for a coding chat thread from the first user message.",
    "You create concise run metadata for a coding task.",
    "You are generating OpenSpec project context.",
    "## Memory Writing Agent: Phase 2",
    "Memory Writing Agent: Phase 2",
    "Please generate a commit message.",
    "请生成一次提交（commit）信息",
    "Generate a concise git commit message for the following changes.",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CodexSessionParseMode {
    Full,
    ThreadPreview,
}

#[derive(Default, Clone, Copy)]
pub(crate) struct CostRates {
    input: f64,
    output: f64,
    cache_write: f64,
    cache_read: f64,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct CodexSessionRootResolution {
    pub(crate) roots: Vec<PathBuf>,
    pub(crate) provider_home_diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct CodexSessionSummaryList {
    pub(crate) workspace_path: String,
    pub(crate) sessions: Vec<LocalUsageSessionSummary>,
    pub(crate) provider_home_diagnostics: Vec<String>,
}

#[tauri::command]
pub(crate) async fn local_usage_snapshot(
    days: Option<u32>,
    workspace_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<LocalUsageSnapshot, String> {
    let days = days.unwrap_or(30).clamp(1, 90);
    let workspace_path = workspace_path.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(PathBuf::from(trimmed))
        }
    });
    let sessions_roots = {
        let workspaces = state.workspaces.lock().await;
        resolve_sessions_roots(&workspaces, workspace_path.as_deref())
    };
    let snapshot = tokio::task::spawn_blocking(move || {
        scan_local_usage(days, workspace_path.as_deref(), &sessions_roots)
    })
    .await
    .map_err(|err| err.to_string())??;
    Ok(snapshot)
}

pub(crate) async fn list_codex_session_summaries_for_workspace(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    limit: usize,
) -> Result<(String, Vec<LocalUsageSessionSummary>), String> {
    let result =
        list_codex_session_summary_list_for_workspace(workspaces, workspace_id, limit).await?;
    Ok((result.workspace_path, result.sessions))
}

pub(crate) async fn list_codex_session_previews_for_workspace(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    limit: usize,
) -> Result<(String, Vec<LocalUsageSessionSummary>), String> {
    let result = list_codex_session_summary_list_for_workspace_with_mode(
        workspaces,
        workspace_id,
        limit,
        CodexSessionParseMode::ThreadPreview,
    )
    .await?;
    Ok((result.workspace_path, result.sessions))
}

pub(crate) async fn list_codex_session_summary_list_for_workspace(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    limit: usize,
) -> Result<CodexSessionSummaryList, String> {
    list_codex_session_summary_list_for_workspace_with_mode(
        workspaces,
        workspace_id,
        limit,
        CodexSessionParseMode::Full,
    )
    .await
}

pub(crate) async fn list_codex_session_summary_list_for_workspace_preview(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    limit: usize,
) -> Result<CodexSessionSummaryList, String> {
    list_codex_session_summary_list_for_workspace_with_mode(
        workspaces,
        workspace_id,
        limit,
        CodexSessionParseMode::ThreadPreview,
    )
    .await
}

async fn list_codex_session_summary_list_for_workspace_with_mode(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: &str,
    limit: usize,
    parse_mode: CodexSessionParseMode,
) -> Result<CodexSessionSummaryList, String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    let requested_limit = limit.max(1);
    let (workspace_path_str, workspace_path, root_resolution) = {
        let workspaces = workspaces.lock().await;
        let entry = workspaces
            .get(workspace_id)
            .ok_or_else(|| "workspace not found".to_string())?;
        let workspace_path = PathBuf::from(&entry.path);
        let root_resolution =
            resolve_sessions_roots_with_diagnostics(&workspaces, Some(workspace_path.as_path()));
        (entry.path.clone(), workspace_path, root_resolution)
    };
    for diagnostic in &root_resolution.provider_home_diagnostics {
        log::warn!(
            "[local_usage.codex] provider home source degraded for workspace {}: {}",
            workspace_id,
            diagnostic
        );
    }
    let sessions_roots = root_resolution.roots;
    let sessions = timeout(
        LOCAL_SESSION_SCAN_TIMEOUT,
        tokio::task::spawn_blocking(move || {
            let scan_deadline = Some(Instant::now() + CODEX_LIST_SCAN_DEADLINE);
            let (summaries, _) = scan_codex_session_summaries_bounded_with_mode(
                Some(workspace_path.as_path()),
                &sessions_roots,
                requested_limit,
                parse_mode,
                scan_deadline,
            )?;
            Ok::<Vec<LocalUsageSessionSummary>, String>(summaries)
        }),
    )
    .await
    .map_err(|_| "local codex session fallback timed out".to_string())?
    .map_err(|err| err.to_string())??;

    Ok(CodexSessionSummaryList {
        workspace_path: workspace_path_str,
        sessions,
        provider_home_diagnostics: root_resolution.provider_home_diagnostics,
    })
}

pub(crate) async fn list_global_codex_session_summaries(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    limit: usize,
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    list_global_codex_session_summaries_with_mode(workspaces, limit, CodexSessionParseMode::Full)
        .await
}

pub(crate) async fn list_global_codex_session_summaries_preview(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    limit: usize,
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    list_global_codex_session_summaries_with_mode(
        workspaces,
        limit,
        CodexSessionParseMode::ThreadPreview,
    )
    .await
}

async fn list_global_codex_session_summaries_with_mode(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    limit: usize,
    parse_mode: CodexSessionParseMode,
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    let requested_limit = limit.max(1);
    let root_resolution = {
        let workspaces = workspaces.lock().await;
        resolve_sessions_roots_with_diagnostics(&workspaces, None)
    };
    for diagnostic in &root_resolution.provider_home_diagnostics {
        log::warn!(
            "[local_usage.codex] provider home source degraded for global scan: {}",
            diagnostic
        );
    }
    let sessions_roots = root_resolution.roots;
    let sessions = timeout(
        LOCAL_SESSION_SCAN_TIMEOUT,
        tokio::task::spawn_blocking(move || {
            let scan_deadline = Some(Instant::now() + CODEX_LIST_SCAN_DEADLINE);
            let (summaries, _) = scan_codex_session_summaries_bounded_with_mode(
                None,
                &sessions_roots,
                requested_limit,
                parse_mode,
                scan_deadline,
            )?;
            Ok::<Vec<LocalUsageSessionSummary>, String>(summaries)
        }),
    )
    .await
    .map_err(|_| "global codex session scan timed out".to_string())?
    .map_err(|err| err.to_string())??;

    Ok(sessions)
}

#[tauri::command]
pub(crate) async fn list_codex_session_summaries(
    workspace_id: String,
    limit: Option<u32>,
    state: State<'_, AppState>,
) -> Result<Vec<LocalUsageSessionSummary>, String> {
    let capped_limit = limit.unwrap_or(200).clamp(1, 200) as usize;
    let (_, sessions) =
        list_codex_session_summaries_for_workspace(&state.workspaces, &workspace_id, capped_limit)
            .await?;
    Ok(sessions)
}

#[tauri::command]
pub(crate) async fn load_codex_session(
    workspace_id: String,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    load_codex_session_for_workspace(&state.workspaces, workspace_id, session_id).await
}

pub(crate) async fn load_codex_session_for_workspace(
    workspaces: &Mutex<HashMap<String, WorkspaceEntry>>,
    workspace_id: String,
    session_id: String,
) -> Result<Value, String> {
    let workspace_id = workspace_id.trim().to_string();
    let session_id = session_id.trim().to_string();
    if workspace_id.is_empty() {
        return Err("workspace_id is required".to_string());
    }
    if session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    if is_invalid_session_path_segment(&session_id) {
        return Err("invalid session_id".to_string());
    }

    let (workspace_path, sessions_roots) = {
        let workspaces = workspaces.lock().await;
        let entry = workspaces
            .get(&workspace_id)
            .ok_or_else(|| "workspace not found".to_string())?;
        let workspace_path = PathBuf::from(&entry.path);
        let sessions_roots = resolve_sessions_roots(&workspaces, Some(workspace_path.as_path()));
        (workspace_path, sessions_roots)
    };

    let session_id_for_load = session_id.clone();
    let entries = tokio::task::spawn_blocking(move || {
        load_codex_session_entries(
            session_id_for_load.as_str(),
            workspace_path.as_path(),
            &sessions_roots,
        )
    })
    .await
    .map_err(|err| err.to_string())??;

    Ok(json!({
        "sessionId": session_id,
        "entries": entries,
    }))
}

pub(super) fn is_invalid_session_path_segment(session_id: &str) -> bool {
    session_id == "."
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains("..")
}

fn find_codex_session_file(
    session_id: &str,
    workspace_path: &Path,
    sessions_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    let matches = session_delete::collect_matching_codex_session_files(
        session_id,
        workspace_path,
        sessions_roots,
    )?;
    matches
        .into_iter()
        .next()
        .ok_or_else(|| format!("codex session file not found for session {}", session_id))
}

/// Match list-scan policy: skip multi-MB JSONL lines that are almost always
/// tool dumps / embedded media the restore UI cannot usefully render whole.
const CODEX_LOAD_LARGE_LINE_BYTE_BUDGET: usize = 512_000;

fn load_codex_session_entries(
    session_id: &str,
    workspace_path: &Path,
    sessions_roots: &[PathBuf],
) -> Result<Vec<Value>, String> {
    let session_path = find_codex_session_file(session_id, workspace_path, sessions_roots)?;
    let file = File::open(&session_path).map_err(|err| {
        format!(
            "failed to open codex session file {}: {}",
            session_path.display(),
            err
        )
    })?;
    let reader = BufReader::new(file);
    let mut entries = Vec::new();
    for line in reader.lines() {
        let line = line.map_err(|err| err.to_string())?;
        if line.trim().is_empty() {
            continue;
        }
        // Align with parse_codex_session_summary_with_mode list path.
        if line.len() > CODEX_LOAD_LARGE_LINE_BYTE_BUDGET {
            continue;
        }
        let value: Value = serde_json::from_str(&line).map_err(|err| {
            format!(
                "failed to parse codex session entry {}: {}",
                session_path.display(),
                err
            )
        })?;
        entries.push(value);
    }
    Ok(entries)
}

fn scan_local_usage(
    days: u32,
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
) -> Result<LocalUsageSnapshot, String> {
    scan_local_usage_core(days, workspace_path, sessions_roots, true)
}

fn scan_local_usage_core(
    days: u32,
    workspace_path: Option<&Path>,
    sessions_roots: &[PathBuf],
    include_claude: bool,
) -> Result<LocalUsageSnapshot, String> {
    let updated_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;

    let day_keys = make_day_keys(days);
    let mut daily: HashMap<String, DailyTotals> = day_keys
        .iter()
        .map(|key| (key.clone(), DailyTotals::default()))
        .collect();
    let mut model_totals: HashMap<String, i64> = HashMap::new();

    // Scan Codex sessions
    for root in sessions_roots {
        for day_key in &day_keys {
            let day_dir = day_dir_for_key(root, day_key);
            if !day_dir.exists() {
                continue;
            }
            let entries = match std::fs::read_dir(&day_dir) {
                Ok(entries) => entries,
                Err(_) => continue,
            };
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                    continue;
                }
                scan_file(&path, &mut daily, &mut model_totals, workspace_path)?;
            }
        }
    }

    // Also scan Claude Code projects
    if include_claude {
        scan_claude_projects(&day_keys, &mut daily, &mut model_totals, workspace_path)?;
    }

    Ok(build_snapshot(updated_at, day_keys, daily, model_totals))
}

fn build_snapshot(
    updated_at: i64,
    day_keys: Vec<String>,
    daily: HashMap<String, DailyTotals>,
    model_totals: HashMap<String, i64>,
) -> LocalUsageSnapshot {
    let mut days: Vec<LocalUsageDay> = Vec::with_capacity(day_keys.len());
    let mut total_tokens = 0;

    for day_key in &day_keys {
        let totals = daily.get(day_key).copied().unwrap_or_default();
        let total = totals.input + totals.output;
        total_tokens += total;
        days.push(LocalUsageDay {
            day: day_key.clone(),
            input_tokens: totals.input,
            cached_input_tokens: totals.cached,
            output_tokens: totals.output,
            total_tokens: total,
            agent_time_ms: totals.agent_ms,
            agent_runs: totals.agent_runs,
        });
    }

    let last7 = days.iter().rev().take(7).cloned().collect::<Vec<_>>();
    let last7_tokens: i64 = last7.iter().map(|day| day.total_tokens).sum();
    let last7_input: i64 = last7.iter().map(|day| day.input_tokens).sum();
    let last7_cached: i64 = last7.iter().map(|day| day.cached_input_tokens).sum();

    let average_daily_tokens = if last7.is_empty() {
        0
    } else {
        ((last7_tokens as f64) / (last7.len() as f64)).round() as i64
    };

    let cache_hit_rate_percent = if last7_input > 0 {
        ((last7_cached as f64) / (last7_input as f64) * 1000.0).round() / 10.0
    } else {
        0.0
    };

    let peak = days
        .iter()
        .max_by_key(|day| day.total_tokens)
        .filter(|day| day.total_tokens > 0);
    let peak_day = peak.map(|day| day.day.clone());
    let peak_day_tokens = peak.map(|day| day.total_tokens).unwrap_or(0);

    let mut top_models: Vec<LocalUsageModel> = model_totals
        .into_iter()
        .filter(|(model, tokens)| model != "unknown" && *tokens > 0)
        .map(|(model, tokens)| LocalUsageModel {
            model,
            tokens,
            share_percent: if total_tokens > 0 {
                ((tokens as f64) / (total_tokens as f64) * 1000.0).round() / 10.0
            } else {
                0.0
            },
        })
        .collect();
    top_models.sort_by(|a, b| b.tokens.cmp(&a.tokens));
    top_models.truncate(4);

    LocalUsageSnapshot {
        updated_at,
        days,
        totals: LocalUsageTotals {
            last7_days_tokens: last7_tokens,
            last30_days_tokens: total_tokens,
            average_daily_tokens,
            cache_hit_rate_percent,
            peak_day,
            peak_day_tokens,
        },
        top_models,
    }
}

pub(crate) fn calculate_usage_cost(usage: &LocalUsageUsageData, rates: CostRates) -> f64 {
    let input_cost = (usage.input_tokens as f64 / 1_000_000.0) * rates.input;
    let output_cost = (usage.output_tokens as f64 / 1_000_000.0) * rates.output;
    let cache_write_cost = (usage.cache_write_tokens as f64 / 1_000_000.0) * rates.cache_write;
    let cache_read_cost = (usage.cache_read_tokens as f64 / 1_000_000.0) * rates.cache_read;
    input_cost + output_cost + cache_write_cost + cache_read_cost
}

pub(crate) fn codex_cost_rates() -> CostRates {
    CostRates {
        input: 3.0,
        output: 15.0,
        cache_write: 0.0,
        cache_read: 0.30,
    }
}

fn scan_file(
    path: &Path,
    daily: &mut HashMap<String, DailyTotals>,
    model_totals: &mut HashMap<String, i64>,
    workspace_path: Option<&Path>,
) -> Result<(), String> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => {
            return Ok(());
        }
    };
    let reader = BufReader::new(file);
    let mut previous_totals: Option<UsageTotals> = None;
    let mut current_model: Option<String> = None;
    let mut last_activity_ms: Option<i64> = None;
    let mut seen_runs: HashSet<i64> = HashSet::new();
    let mut match_known = workspace_path.is_none();
    let mut matches_workspace = workspace_path.is_none();

    for line in reader.lines() {
        let line = match line {
            Ok(line) => line,
            Err(_) => continue,
        };
        if line.len() > 512_000 {
            continue;
        }

        let value = match serde_json::from_str::<Value>(&line) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let entry_type = value
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("");

        if entry_type == "session_meta" || entry_type == "turn_context" {
            if let Some(cwd) = extract_cwd(&value) {
                if let Some(filter) = workspace_path {
                    matches_workspace = path_matches_workspace(&cwd, filter);
                    match_known = true;
                    if !matches_workspace {
                        break;
                    }
                }
            }
        }

        if entry_type == "turn_context" {
            if let Some(model) = extract_model_from_turn_context(&value) {
                current_model = Some(model);
            }
            continue;
        }

        if entry_type == "session_meta" {
            continue;
        }

        if !matches_workspace {
            if match_known {
                break;
            }
            continue;
        }

        if !match_known {
            continue;
        }

        if entry_type == "event_msg" || entry_type.is_empty() {
            let payload = value.get("payload").and_then(|value| value.as_object());
            let payload_type = payload
                .and_then(|payload| payload.get("type"))
                .and_then(|value| value.as_str());

            if payload_type == Some("agent_message") {
                if let Some(timestamp_ms) = read_timestamp_ms(&value) {
                    if seen_runs.insert(timestamp_ms) {
                        if let Some(day_key) = day_key_for_timestamp_ms(timestamp_ms) {
                            if let Some(entry) = daily.get_mut(&day_key) {
                                entry.agent_runs += 1;
                            }
                        }
                    }
                    track_activity(daily, &mut last_activity_ms, timestamp_ms);
                }
                continue;
            }

            if payload_type == Some("agent_reasoning") {
                if let Some(timestamp_ms) = read_timestamp_ms(&value) {
                    track_activity(daily, &mut last_activity_ms, timestamp_ms);
                }
                continue;
            }

            if payload_type != Some("token_count") {
                continue;
            }

            let info = payload
                .and_then(|payload| payload.get("info"))
                .and_then(|v| v.as_object());
            let (input, cached, output, used_total) = if let Some(info) = info {
                if let Some(total) = find_usage_map(info, &["total_token_usage", "totalTokenUsage"])
                {
                    (
                        read_i64(total, &["input_tokens", "inputTokens"]),
                        read_i64(
                            total,
                            &[
                                "cached_input_tokens",
                                "cache_read_input_tokens",
                                "cachedInputTokens",
                                "cacheReadInputTokens",
                            ],
                        ),
                        read_i64(total, &["output_tokens", "outputTokens"]),
                        true,
                    )
                } else if let Some(last) =
                    find_usage_map(info, &["last_token_usage", "lastTokenUsage"])
                {
                    (
                        read_i64(last, &["input_tokens", "inputTokens"]),
                        read_i64(
                            last,
                            &[
                                "cached_input_tokens",
                                "cache_read_input_tokens",
                                "cachedInputTokens",
                                "cacheReadInputTokens",
                            ],
                        ),
                        read_i64(last, &["output_tokens", "outputTokens"]),
                        false,
                    )
                } else {
                    continue;
                }
            } else {
                continue;
            };

            let mut delta = UsageTotals {
                input,
                cached,
                output,
            };

            if used_total {
                let prev = previous_totals.unwrap_or_default();
                delta = UsageTotals {
                    input: (input - prev.input).max(0),
                    cached: (cached - prev.cached).max(0),
                    output: (output - prev.output).max(0),
                };
                previous_totals = Some(UsageTotals {
                    input,
                    cached,
                    output,
                });
            } else {
                // Some streams emit `last_token_usage` deltas between `total_token_usage` snapshots.
                // Treat those as already-counted to avoid double-counting when the next total arrives.
                let mut next = previous_totals.unwrap_or_default();
                next.input += delta.input;
                next.cached += delta.cached;
                next.output += delta.output;
                previous_totals = Some(next);
            }

            if delta.input == 0 && delta.cached == 0 && delta.output == 0 {
                continue;
            }

            let timestamp_ms = read_timestamp_ms(&value);
            if let Some(day_key) = timestamp_ms.and_then(day_key_for_timestamp_ms) {
                if let Some(entry) = daily.get_mut(&day_key) {
                    let cached = delta.cached.min(delta.input);
                    entry.input += delta.input;
                    entry.cached += cached;
                    entry.output += delta.output;

                    let model = current_model
                        .clone()
                        .or_else(|| extract_model_from_token_count(&value))
                        .unwrap_or_else(|| "unknown".to_string());
                    *model_totals.entry(model).or_insert(0) += delta.input + delta.output;
                }
            }

            if let Some(timestamp_ms) = timestamp_ms {
                track_activity(daily, &mut last_activity_ms, timestamp_ms);
            }
            continue;
        }

        if entry_type == "response_item" {
            let payload = value.get("payload").and_then(|value| value.as_object());
            let payload_type = payload
                .and_then(|payload| payload.get("type"))
                .and_then(|value| value.as_str());
            let role = payload
                .and_then(|payload| payload.get("role"))
                .and_then(|value| value.as_str())
                .unwrap_or("");

            if role == "assistant" {
                if let Some(timestamp_ms) = read_timestamp_ms(&value) {
                    if seen_runs.insert(timestamp_ms) {
                        if let Some(day_key) = day_key_for_timestamp_ms(timestamp_ms) {
                            if let Some(entry) = daily.get_mut(&day_key) {
                                entry.agent_runs += 1;
                            }
                        }
                    }
                    track_activity(daily, &mut last_activity_ms, timestamp_ms);
                }
            } else if payload_type != Some("message") {
                if let Some(timestamp_ms) = read_timestamp_ms(&value) {
                    track_activity(daily, &mut last_activity_ms, timestamp_ms);
                }
            }
        }
    }

    Ok(())
}

fn extract_model_from_turn_context(value: &Value) -> Option<String> {
    let payload = value.get("payload").and_then(|value| value.as_object())?;
    if let Some(model) = payload.get("model").and_then(|value| value.as_str()) {
        return Some(model.to_string());
    }
    let info = payload.get("info").and_then(|value| value.as_object())?;
    info.get("model")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn extract_model_from_token_count(value: &Value) -> Option<String> {
    let payload = value.get("payload").and_then(|value| value.as_object())?;
    let info = payload.get("info").and_then(|value| value.as_object());
    let model = info
        .and_then(|info| {
            info.get("model")
                .or_else(|| info.get("model_name"))
                .and_then(|value| value.as_str())
        })
        .or_else(|| payload.get("model").and_then(|value| value.as_str()))
        .or_else(|| value.get("model").and_then(|value| value.as_str()));
    model.map(|value| value.to_string())
}

fn find_usage_map<'a>(
    info: &'a serde_json::Map<String, Value>,
    keys: &[&str],
) -> Option<&'a serde_json::Map<String, Value>> {
    keys.iter()
        .find_map(|key| info.get(*key).and_then(|value| value.as_object()))
}

fn read_i64(map: &serde_json::Map<String, Value>, keys: &[&str]) -> i64 {
    keys.iter()
        .find_map(|key| map.get(*key))
        .and_then(|value| {
            value
                .as_i64()
                .or_else(|| value.as_f64().map(|value| value as i64))
                .or_else(|| {
                    value
                        .as_str()
                        .and_then(|text| text.trim().parse::<i64>().ok())
                })
        })
        .unwrap_or(0)
}

fn read_timestamp_ms(value: &Value) -> Option<i64> {
    let raw = value.get("timestamp")?;
    if let Some(text) = raw.as_str() {
        return DateTime::parse_from_rfc3339(text)
            .map(|value| value.timestamp_millis())
            .ok();
    }
    let numeric = raw
        .as_i64()
        .or_else(|| raw.as_f64().map(|value| value as i64))?;
    if numeric > 0 && numeric < 1_000_000_000_000 {
        return Some(numeric * 1000);
    }
    Some(numeric)
}

fn track_activity(
    daily: &mut HashMap<String, DailyTotals>,
    last_activity_ms: &mut Option<i64>,
    timestamp_ms: i64,
) {
    if let Some(prev_ms) = *last_activity_ms {
        let delta = timestamp_ms - prev_ms;
        if delta > 0 && delta <= MAX_ACTIVITY_GAP_MS {
            if let Some(day_key) = day_key_for_timestamp_ms(timestamp_ms) {
                if let Some(entry) = daily.get_mut(&day_key) {
                    entry.agent_ms += delta;
                }
            }
        }
    }
    *last_activity_ms = Some(timestamp_ms);
}

fn day_key_for_timestamp_ms(timestamp_ms: i64) -> Option<String> {
    let utc = Utc.timestamp_millis_opt(timestamp_ms).single()?;
    Some(utc.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

fn extract_cwd(value: &Value) -> Option<String> {
    let root = value.as_object()?;
    let payload = root.get("payload").and_then(Value::as_object);
    let session_meta = root
        .get("session_meta")
        .and_then(Value::as_object)
        .or_else(|| root.get("sessionMeta").and_then(Value::as_object))
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("context"))
                .and_then(Value::as_object)
        })
        .and_then(|context| {
            context
                .get("session_meta")
                .and_then(Value::as_object)
                .or_else(|| context.get("sessionMeta").and_then(Value::as_object))
                .or(Some(context))
        })
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("turnContext"))
                .and_then(Value::as_object)
        })
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("turn_context"))
                .and_then(Value::as_object)
        })
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("session_meta"))
                .and_then(Value::as_object)
        })
        .or_else(|| {
            payload
                .and_then(|payload| payload.get("sessionMeta"))
                .and_then(Value::as_object)
        });

    read_string_from_object(root, &["cwd"])
        .or_else(|| payload.and_then(|item| read_string_from_object(item, &["cwd"])))
        .or_else(|| {
            payload
                .and_then(|item| item.get("context"))
                .and_then(Value::as_object)
                .and_then(|item| read_string_from_object(item, &["cwd"]))
        })
        .or_else(|| {
            payload
                .and_then(|item| item.get("turnContext"))
                .and_then(Value::as_object)
                .and_then(|item| read_string_from_object(item, &["cwd"]))
        })
        .or_else(|| {
            payload
                .and_then(|item| item.get("turn_context"))
                .and_then(Value::as_object)
                .and_then(|item| read_string_from_object(item, &["cwd"]))
        })
        .or_else(|| session_meta.and_then(|item| read_string_from_object(item, &["cwd"])))
}

#[cfg(windows)]
fn normalize_workspace_match_path(value: &str) -> String {
    let mut normalized = value.trim().replace('\\', "/");
    if let Some(stripped) = normalized.strip_prefix("//?/UNC/") {
        normalized = format!("//{stripped}");
    } else if let Some(stripped) = normalized.strip_prefix("//?/") {
        normalized = stripped.to_string();
    }
    normalized.trim_end_matches('/').to_ascii_lowercase()
}

#[cfg(not(windows))]
fn normalize_posix_workspace_match_path(value: &str) -> String {
    let normalized = value.trim().replace('\\', "/");
    if normalized == "/" {
        "/".to_string()
    } else {
        normalized.trim_end_matches('/').to_string()
    }
}

#[cfg(not(windows))]
fn build_posix_workspace_match_variants(value: &str) -> Vec<String> {
    let normalized = normalize_posix_workspace_match_path(value);
    if normalized.is_empty() {
        return Vec::new();
    }
    let mut variants = vec![normalized.clone()];
    if let Some(stripped) = normalized.strip_prefix("/private/") {
        variants.push(format!("/{}", stripped));
    } else if normalized.starts_with('/') && normalized != "/private" {
        variants.push(format!("/private{}", normalized));
    }
    variants.sort();
    variants.dedup();
    variants
}

#[cfg(not(windows))]
fn posix_path_is_same_or_child(candidate: &str, base: &str) -> bool {
    if candidate.is_empty() || base.is_empty() {
        return false;
    }
    if candidate == base {
        return true;
    }
    if base == "/" {
        return candidate.starts_with('/');
    }
    candidate
        .strip_prefix(base)
        .map(|rest| rest.starts_with('/'))
        .unwrap_or(false)
}

pub(crate) fn path_matches_workspace(cwd: &str, workspace_path: &Path) -> bool {
    #[cfg(windows)]
    {
        let cwd_path = normalize_workspace_match_path(cwd);
        let workspace = normalize_workspace_match_path(&workspace_path.to_string_lossy());
        if cwd_path.is_empty() || workspace.is_empty() {
            return false;
        }
        if cwd_path == workspace {
            return true;
        }
        return cwd_path
            .strip_prefix(&workspace)
            .map(|rest| rest.starts_with('/'))
            .unwrap_or(false);
    }

    #[cfg(not(windows))]
    {
        let workspace_raw = workspace_path.to_string_lossy();
        let workspace_variants = build_posix_workspace_match_variants(&workspace_raw);
        if workspace_variants.is_empty() {
            return false;
        }
        let cwd_variants = build_posix_workspace_match_variants(cwd);
        if cwd_variants.is_empty() {
            return false;
        }

        for cwd_variant in cwd_variants {
            for workspace_variant in &workspace_variants {
                if posix_path_is_same_or_child(&cwd_variant, workspace_variant) {
                    return true;
                }
            }
        }
        false
    }
}


#[cfg(test)]
#[path = "local_usage/tests.rs"]
mod tests;
