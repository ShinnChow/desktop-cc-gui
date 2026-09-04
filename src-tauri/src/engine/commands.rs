//! Tauri commands for engine management
//!
//! Provides frontend-accessible commands for engine detection, switching,
//! and configuration.

use chrono::{
    DateTime, Duration as ChronoDuration, Local, NaiveDate, NaiveDateTime, NaiveTime, TimeZone,
};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::time::timeout;

use crate::backend::events::AppServerEvent;
use crate::remote_backend;
use crate::session_management::{self, AutoSessionMetadata};
use crate::state::AppState;
use crate::types::WorkspaceEntry;

use super::codex_prompt_service::{normalize_custom_spec_root, run_codex_prompt_sync};
use super::events::{engine_event_to_app_server_event_with_turn_context, EngineEvent};
use super::grok::resolve_grok_session_id_for_engine_send;
use super::kimi::resolve_kimi_session_id_for_engine_send;
use super::pi::{
    is_pi_agent_settled_marker, is_pi_family_external_wakeup_allowed,
    is_pi_forwardable_send_turn, resolve_pi_session_id_for_engine_send,
};
use super::remote_bridge::{
    call_remote_typed, remote_detect_engines_request, remote_engine_interrupt_request,
    remote_engine_send_message_sync_request,
};
use super::status::{
    detect_grok_status, detect_kimi_status, detect_omp_status, detect_pi_status,
    load_opencode_models,
};
use super::{
    engine_disabled_diagnostic, engine_enabled_in_settings, EngineConfig, EngineStatus, EngineType,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredEngineActiveProcessDiagnostic {
    pub pid: u32,
    pub registered_age_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineWorkspaceActiveProcessDiagnostics {
    pub workspace_id: String,
    pub engine: EngineType,
    pub active_process_ids: Vec<u32>,
    pub registered_active_processes: Vec<RegisteredEngineActiveProcessDiagnostic>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineActiveProcessDiagnostics {
    pub measured: bool,
    pub sampled_at_ms: u64,
    pub total_active_process_count: usize,
    pub workspaces: Vec<EngineWorkspaceActiveProcessDiagnostics>,
    pub unsupported_reason: Option<String>,
    /// Separate OS-level child process liveness evidence. The total_active_process_count
    /// above counts handles still registered in the runtime maps; this field makes
    /// clear that the registry count is NOT proof of OS process exit.
    pub os_child_liveness: OsChildLivenessEvidence,
    /// Diagnostics-only stale child candidates. The reconciler never auto-kills.
    pub stale_child_candidates: Vec<StaleChildCandidate>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OsChildLivenessEvidence {
    /// "measured" | "proxy" | "manual-only" | "unsupported"
    pub evidence_class: &'static str,
    pub sampled_after_close_ms: u64,
    pub sampled_os_child_count: Option<u32>,
    pub sampler: Option<String>,
    /// Bounded rationale when evidence is unsupported or manual-only.
    pub rationale: Option<String>,
}

impl OsChildLivenessEvidence {
    fn unsupported(rationale: &str) -> Self {
        Self {
            evidence_class: "unsupported",
            sampled_after_close_ms: 0,
            sampled_os_child_count: None,
            sampler: None,
            rationale: Some(rationale.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StaleChildCandidate {
    pub workspace_id: String,
    pub engine: String,
    pub pid: u32,
    pub registered_age_ms: u64,
    pub stale_reason: String,
    /// "timing-only" | "unsupported" — only Claude has structured stream timing
    /// metadata; OpenCode/Gemini currently emit age-only and report unsupported.
    pub progress_evidence: String,
}

#[path = "claude_forwarder.rs"]
mod claude_forwarder;
#[path = "commands_opencode.rs"]
mod commands_opencode;
#[path = "commands_opencode_helpers.rs"]
mod opencode_helpers;
#[path = "commands_parse_helpers.rs"]
mod parse_helpers;
#[path = "commands_opencode_catalog.rs"]
mod commands_opencode_catalog;
#[path = "commands_send.rs"]
mod commands_send;
#[path = "commands_send_sync.rs"]
mod commands_send_sync;
#[path = "commands_pi_rpc.rs"]
mod commands_pi_rpc;
use claude_forwarder::{
    handle_claude_forwarder_event, ClaudeForwarderRuntimeContext, ClaudeForwarderState,
};
pub use commands_opencode::*;
use opencode_helpers::*;
use parse_helpers::*;
pub use commands_pi_rpc::*;
pub use commands_send_sync::*;
pub use commands_send::*;
pub use commands_opencode_catalog::*;

/// Gemini may emit fallback reasoning shortly after turn/completed.
/// Keep the forwarder alive briefly so realtime reasoning is not dropped.
const GEMINI_POST_COMPLETION_REASONING_GRACE_MS: u64 = 8_000;

fn unix_timestamp_ms_for_diagnostics() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn has_non_empty_images(images: &Option<Vec<String>>) -> bool {
    images
        .as_ref()
        .is_some_and(|entries| entries.iter().any(|entry| !entry.trim().is_empty()))
}

fn features_for_engine(engine: EngineType) -> super::EngineFeatures {
    engine.features()
}

/// Reject non-empty image payloads when `EngineFeatures.image_input = false`.
/// Current engines all report `image_input = true`; this remains as a guard for
/// future unsupported engines.
pub(crate) fn require_image_support(
    engine: EngineType,
    images: &Option<Vec<String>>,
) -> Result<(), String> {
    if features_for_engine(engine).image_input {
        return Ok(());
    }
    if has_non_empty_images(images) {
        return Err(format!(
            "{} does not support image input in this release",
            engine.display_name()
        ));
    }
    Ok(())
}

fn build_engine_active_process_diagnostics(
    sampled_at_ms: u64,
    mut workspaces: Vec<EngineWorkspaceActiveProcessDiagnostics>,
    stale_child_candidates: Vec<StaleChildCandidate>,
) -> EngineActiveProcessDiagnostics {
    workspaces.sort_by(|left, right| left.workspace_id.cmp(&right.workspace_id));
    let total_active_process_count = workspaces
        .iter()
        .map(|workspace| workspace.active_process_ids.len())
        .sum();

    EngineActiveProcessDiagnostics {
        measured: true,
        sampled_at_ms,
        total_active_process_count,
        workspaces,
        unsupported_reason: None,
        // OS process liveness sampling is intentionally split from the registry
        // count. The runtime does not ship a cross-platform OS process sampler
        // (no /proc, no ps binding, no Windows API helper), so this is currently
        // reported as `unsupported` rather than inferred from registry zero.
        os_child_liveness: OsChildLivenessEvidence::unsupported(
            "Runtime does not ship a cross-platform OS child process sampler. Registry total_active_process_count=0 means no handles are registered; it does NOT prove OS processes have been reaped.",
        ),
        stale_child_candidates,
    }
}

const STALE_CHILD_CANDIDATE_MIN_AGE_MS: u64 = 5 * 60 * 1000;

fn collect_stale_child_candidates(
    workspaces: &[EngineWorkspaceActiveProcessDiagnostics],
    sampled_at_ms: u64,
) -> Vec<StaleChildCandidate> {
    // Diagnostics-only: report candidates without killing. Engines without
    // progress metadata (OpenCode, Gemini) emit progress_evidence=unsupported.
    let mut candidates = Vec::new();
    for workspace in workspaces {
        for process in &workspace.registered_active_processes {
            if process.registered_age_ms < STALE_CHILD_CANDIDATE_MIN_AGE_MS {
                continue;
            }
            let progress_evidence = match workspace.engine {
                EngineType::Claude => "timing-only",
                EngineType::OpenCode
                | EngineType::Gemini
                | EngineType::Grok
                | EngineType::Kimi
                | EngineType::Pi
                | EngineType::Omp
                | EngineType::Qoder
                | EngineType::Dsh => "unsupported",
                // Codex is intentionally not part of this child-process parity
                // path (it has its own wrapper runtime).
                EngineType::Codex => "unsupported",
            };
            candidates.push(StaleChildCandidate {
                workspace_id: workspace.workspace_id.clone(),
                engine: engine_type_label(workspace.engine).to_string(),
                pid: process.pid,
                registered_age_ms: process.registered_age_ms,
                stale_reason: "diagnostics-only-candidate".to_string(),
                progress_evidence: progress_evidence.to_string(),
            });
        }
    }
    let _ = sampled_at_ms;
    candidates
}

fn engine_type_label(engine: EngineType) -> &'static str {
    engine.icon()
}

async fn record_auto_session_metadata_if_present(
    state: &AppState,
    workspace_id: &str,
    session_id: Option<&str>,
    metadata: Option<AutoSessionMetadata>,
    engine_prefix: &str,
) {
    let (Some(session_id), Some(metadata)) = (session_id, metadata) else {
        return;
    };
    let session_id = if session_id.starts_with(&format!("{engine_prefix}:")) {
        session_id.to_string()
    } else {
        format!("{engine_prefix}:{session_id}")
    };
    let _ = session_management::record_auto_session_metadata_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id.to_string(),
        session_id,
        metadata,
    )
    .await;
}

async fn record_claude_auto_session_metadata_for_sync_result(
    workspaces: &tokio::sync::Mutex<HashMap<String, WorkspaceEntry>>,
    storage_path: &Path,
    workspace_id: &str,
    send_succeeded: bool,
    response_session_id: Option<&str>,
    observed_session_id: Option<&str>,
    metadata: Option<AutoSessionMetadata>,
) {
    let metadata_session_id = resolve_claude_auto_session_metadata_session_id(
        send_succeeded,
        response_session_id,
        observed_session_id,
    );
    let (Some(session_id), Some(metadata)) = (metadata_session_id, metadata) else {
        return;
    };
    let _ = session_management::record_auto_session_metadata_core(
        workspaces,
        storage_path,
        workspace_id.to_string(),
        format!("claude:{session_id}"),
        metadata,
    )
    .await;
}

fn resolve_claude_session_id_for_engine_send(
    normalized_fork_session_id: Option<&str>,
    explicit_session_id: Option<String>,
    continue_session: bool,
    tracked_session_id: Option<String>,
) -> Option<String> {
    if normalized_fork_session_id.is_some() {
        return None;
    }
    if continue_session {
        return explicit_session_id.or(tracked_session_id);
    }
    Some(explicit_session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
}

fn resolve_claude_auto_session_metadata_session_id(
    send_succeeded: bool,
    response_session_id: Option<&str>,
    observed_session_id: Option<&str>,
) -> Option<String> {
    if send_succeeded {
        return response_session_id.map(str::to_string);
    }

    let expected_session_id = response_session_id?;
    let observed_session_id = observed_session_id?;
    if observed_session_id == expected_session_id {
        return Some(observed_session_id.to_string());
    }
    None
}

/// Claude `/context` probing happens after the CLI turn completes. Keep the
/// forwarder subscribed long enough for the post-completion UsageUpdate.
const CLAUDE_POST_COMPLETION_USAGE_GRACE_MS: u64 = 35_000;

async fn read_app_settings_snapshot(state: &State<'_, AppState>) -> crate::types::AppSettings {
    state.app_settings.lock().await.clone()
}

fn ensure_engine_enabled(
    settings: &crate::types::AppSettings,
    engine_type: EngineType,
) -> Result<(), String> {
    if engine_enabled_in_settings(settings, engine_type) {
        return Ok(());
    }
    Err(engine_disabled_diagnostic(engine_type)
        .unwrap_or("Engine is disabled in CLI validation settings")
        .to_string())
}

fn resolve_enabled_engine_for_send(
    settings: &crate::types::AppSettings,
    requested_engine: Option<EngineType>,
    active_engine: EngineType,
) -> Result<EngineType, String> {
    let effective_engine = requested_engine.unwrap_or(active_engine);
    ensure_engine_enabled(settings, effective_engine)?;
    Ok(effective_engine)
}

fn validate_remote_requested_engine(
    settings: &crate::types::AppSettings,
    requested_engine: Option<EngineType>,
) -> Result<Option<EngineType>, String> {
    if let Some(engine_type) = requested_engine {
        ensure_engine_enabled(settings, engine_type)?;
    }
    Ok(requested_engine)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GeminiRenderLane {
    Text,
    Reasoning,
    Tool,
    Other,
}

impl Default for GeminiRenderLane {
    fn default() -> Self {
        Self::Other
    }
}

#[derive(Default)]
pub(crate) struct GeminiRenderRoutingState {
    last_render_lane: GeminiRenderLane,
    text_run_index: usize,
    reasoning_run_index: usize,
    active_text_item_id: Option<String>,
    active_reasoning_item_id: Option<String>,
    saw_text_delta: bool,
}

fn next_gemini_routed_item_id(
    state: &mut GeminiRenderRoutingState,
    render_lane: GeminiRenderLane,
    base_item_id: &str,
) -> String {
    if matches!(render_lane, GeminiRenderLane::Text)
        && (state.last_render_lane != GeminiRenderLane::Text || state.active_text_item_id.is_none())
    {
        state.text_run_index += 1;
        let text_item_id = if state.text_run_index == 1 {
            base_item_id.to_string()
        } else {
            format!("{base_item_id}:text-{}", state.text_run_index)
        };
        state.active_text_item_id = Some(text_item_id);
    }

    if matches!(render_lane, GeminiRenderLane::Reasoning)
        && (state.last_render_lane != GeminiRenderLane::Reasoning
            || state.active_reasoning_item_id.is_none())
    {
        state.reasoning_run_index += 1;
        state.active_reasoning_item_id = Some(format!(
            "{base_item_id}:reasoning-seg-{}",
            state.reasoning_run_index
        ));
    }

    let routed_item_id = match render_lane {
        GeminiRenderLane::Text => state
            .active_text_item_id
            .clone()
            .unwrap_or_else(|| base_item_id.to_string()),
        GeminiRenderLane::Reasoning => state
            .active_reasoning_item_id
            .clone()
            .unwrap_or_else(|| base_item_id.to_string()),
        GeminiRenderLane::Tool | GeminiRenderLane::Other => base_item_id.to_string(),
    };

    if !matches!(render_lane, GeminiRenderLane::Other) {
        state.last_render_lane = render_lane;
        if !matches!(render_lane, GeminiRenderLane::Reasoning) {
            state.active_reasoning_item_id = None;
        }
        if !matches!(render_lane, GeminiRenderLane::Text) {
            state.active_text_item_id = None;
        }
    }

    routed_item_id
}

/// Prefer the last text-lane item id so synthetic `item/completed` upserts the
/// same assistant bubble as streamed TextDelta (Claude-parity; avoids double bubbles).
pub(crate) fn gemini_agent_completion_item_id(
    state: &GeminiRenderRoutingState,
    base_item_id: &str,
) -> String {
    if let Some(id) = state.active_text_item_id.as_ref() {
        return id.clone();
    }
    match state.text_run_index {
        0 | 1 => base_item_id.to_string(),
        n => format!("{base_item_id}:text-{n}"),
    }
}

/// Detect all installed engines and their capabilities
///
/// B3 缓存优先：默认（无 force / 无 engines）走 TTL 缓存 + last-good SWR；
/// `force: true` 全量重探；`engines: ["kimi", ...]` 仅轻量重探指定引擎。
#[tauri::command]
pub async fn detect_engines(
    force: Option<bool>,
    engines: Option<Vec<EngineType>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<EngineStatus>, String> {
    let force = force.unwrap_or(false);
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_detect_engines_request(force, engines.as_deref());
        return call_remote_typed(&*state, &app, method, params).await;
    }
    let manager = &state.engine_manager;
    let settings = read_app_settings_snapshot(&state).await;
    let disabled_engines = crate::engine::detection_disabled_engines(&settings);
    // B4 逐引擎事件：探测完成即 emit ccgui:engine-status-updated（每引擎每轮
    // 恰好一次，detectRunId 单调），前端逐项 reveal 不再全量等待。
    let app_for_events = app.clone();
    let on_status: Option<crate::engine::status::EngineStatusEventSink> = Some(Arc::new(
        move |detect_run_id: u64, status: crate::engine::EngineStatus| {
            let _ = app_for_events.emit(
                "ccgui:engine-status-updated",
                serde_json::json!({ "detectRunId": detect_run_id, "status": status }),
            );
        },
    ));
    Ok(manager
        .detect_engines_cached(
            force,
            engines.as_deref(),
            settings.gemini_enabled,
            &disabled_engines,
            on_status,
        )
        .await)
}

/// Get the currently active engine
#[tauri::command]
pub async fn get_active_engine(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<EngineType, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return call_remote_typed(&*state, &app, "get_active_engine", json!({})).await;
    }
    let manager = &state.engine_manager;
    Ok(manager.get_active_engine().await)
}

/// Switch to a different engine
#[tauri::command]
pub async fn switch_engine(
    engine_type: EngineType,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let settings = read_app_settings_snapshot(&state).await;
    ensure_engine_enabled(&settings, engine_type)?;

    if remote_backend::is_remote_mode(&*state).await {
        let _: Value = call_remote_typed(
            &*state,
            &app,
            "switch_engine",
            json!({ "engineType": engine_type }),
        )
        .await?;
        return Ok(());
    }
    let manager = &state.engine_manager;
    manager.set_active_engine(engine_type).await
}

/// Get cached status for a specific engine
#[tauri::command]
pub async fn get_engine_status(
    engine_type: EngineType,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Option<EngineStatus>, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return call_remote_typed(
            &*state,
            &app,
            "get_engine_status",
            json!({ "engineType": engine_type }),
        )
        .await;
    }
    let manager = &state.engine_manager;
    Ok(manager.get_engine_status(engine_type).await)
}

/// Get all cached engine statuses
#[tauri::command]
pub async fn get_all_engine_statuses(
    state: State<'_, AppState>,
) -> Result<Vec<EngineStatus>, String> {
    let manager = &state.engine_manager;
    Ok(manager.get_all_statuses().await)
}

/// Set engine configuration
#[tauri::command]
pub async fn set_engine_config(
    engine_type: EngineType,
    config: EngineConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let manager = &state.engine_manager;
    manager.set_engine_config(engine_type, config).await;
    Ok(())
}

/// Get engine configuration
#[tauri::command]
pub async fn get_engine_config(
    engine_type: EngineType,
    state: State<'_, AppState>,
) -> Result<Option<EngineConfig>, String> {
    let manager = &state.engine_manager;
    Ok(manager.get_engine_config(engine_type).await)
}

/// Check if an engine is available
#[tauri::command]
pub async fn is_engine_available(
    engine_type: EngineType,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    let manager = &state.engine_manager;
    let settings = read_app_settings_snapshot(&state).await;
    if !engine_enabled_in_settings(&settings, engine_type) {
        return Ok(false);
    }
    Ok(manager.is_engine_available(engine_type).await)
}

/// Get list of available engines
#[tauri::command]
pub async fn get_available_engines(state: State<'_, AppState>) -> Result<Vec<EngineType>, String> {
    let manager = &state.engine_manager;
    let settings = read_app_settings_snapshot(&state).await;
    Ok(manager
        .get_available_engines()
        .await
        .into_iter()
        .filter(|engine| engine_enabled_in_settings(&settings, *engine))
        .collect())
}

/// Get active child-process diagnostics for local engine sessions.
#[tauri::command]
pub async fn get_engine_active_process_diagnostics(
    state: State<'_, AppState>,
) -> Result<EngineActiveProcessDiagnostics, String> {
    let sampled_at_ms = unix_timestamp_ms_for_diagnostics();
    if remote_backend::is_remote_mode(&*state).await {
        return Ok(EngineActiveProcessDiagnostics {
            measured: false,
            sampled_at_ms,
            total_active_process_count: 0,
            workspaces: Vec::new(),
            unsupported_reason: Some(
                "active process diagnostics are only available for local runtime sessions"
                    .to_string(),
            ),
            os_child_liveness: OsChildLivenessEvidence::unsupported(
                "Remote backend mode does not have local runtime registry access; OS process liveness cannot be sampled.",
            ),
            stale_child_candidates: Vec::new(),
        });
    }

    let mut workspaces = Vec::new();
    for (workspace_id, session) in state.engine_manager.claude_manager.list_sessions().await {
        let active_process_ids = session.active_process_ids().await;
        let registered_active_processes = active_process_ids
            .iter()
            .map(|pid| RegisteredEngineActiveProcessDiagnostic {
                pid: *pid,
                registered_age_ms: 0,
            })
            .collect();
        workspaces.push(EngineWorkspaceActiveProcessDiagnostics {
            workspace_id,
            engine: EngineType::Claude,
            active_process_ids,
            registered_active_processes,
        });
    }
    for (workspace_id, session) in state.engine_manager.list_opencode_sessions().await {
        let active_process_snapshots = session.active_process_snapshots(sampled_at_ms).await;
        let active_process_ids = active_process_snapshots
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>();
        if active_process_ids.is_empty() {
            continue;
        }
        let registered_active_processes = active_process_snapshots
            .into_iter()
            .map(|process| RegisteredEngineActiveProcessDiagnostic {
                pid: process.pid,
                registered_age_ms: process.registered_age_ms,
            })
            .collect();
        workspaces.push(EngineWorkspaceActiveProcessDiagnostics {
            workspace_id,
            engine: EngineType::OpenCode,
            active_process_ids,
            registered_active_processes,
        });
    }
    for (workspace_id, session) in state.engine_manager.list_gemini_sessions().await {
        let active_process_snapshots = session.active_process_snapshots(sampled_at_ms).await;
        let active_process_ids = active_process_snapshots
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>();
        if active_process_ids.is_empty() {
            continue;
        }
        let registered_active_processes = active_process_snapshots
            .into_iter()
            .map(|process| RegisteredEngineActiveProcessDiagnostic {
                pid: process.pid,
                registered_age_ms: process.registered_age_ms,
            })
            .collect();
        workspaces.push(EngineWorkspaceActiveProcessDiagnostics {
            workspace_id,
            engine: EngineType::Gemini,
            active_process_ids,
            registered_active_processes,
        });
    }
    for (workspace_id, session) in state.engine_manager.list_kimi_sessions().await {
        let active_process_snapshots = session.active_process_snapshots(sampled_at_ms).await;
        let active_process_ids = active_process_snapshots
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>();
        if active_process_ids.is_empty() {
            continue;
        }
        let registered_active_processes = active_process_snapshots
            .into_iter()
            .map(|process| RegisteredEngineActiveProcessDiagnostic {
                pid: process.pid,
                registered_age_ms: process.registered_age_ms,
            })
            .collect();
        workspaces.push(EngineWorkspaceActiveProcessDiagnostics {
            workspace_id,
            engine: EngineType::Kimi,
            active_process_ids,
            registered_active_processes,
        });
    }
    for (workspace_id, session) in state.engine_manager.list_grok_sessions().await {
        let active_process_snapshots = session.active_process_snapshots(sampled_at_ms).await;
        let active_process_ids = active_process_snapshots
            .iter()
            .map(|process| process.pid)
            .collect::<Vec<_>>();
        if active_process_ids.is_empty() {
            continue;
        }
        let registered_active_processes = active_process_snapshots
            .into_iter()
            .map(|process| RegisteredEngineActiveProcessDiagnostic {
                pid: process.pid,
                registered_age_ms: process.registered_age_ms,
            })
            .collect();
        workspaces.push(EngineWorkspaceActiveProcessDiagnostics {
            workspace_id,
            engine: EngineType::Grok,
            active_process_ids,
            registered_active_processes,
        });
    }
    let stale_child_candidates = collect_stale_child_candidates(&workspaces, sampled_at_ms);
    Ok(build_engine_active_process_diagnostics(
        sampled_at_ms,
        workspaces,
        stale_child_candidates,
    ))
}

/// Cache-first catalog resolution for engines whose model probe spawns CLI
/// processes (Pi/Kimi/Grok). Mirrors the Claude/Codex arm and the daemon
/// remote path: a non-forced call with a non-empty cache MUST NOT spawn any
/// CLI probe. A forced or cache-empty call runs `refresh`; a non-empty fresh
/// result is written back to the cache, while an empty fresh result falls
/// back to the last-good cache instead of evicting it.
///
/// Contract: openspec/changes/cache-first-engine-model-catalog
/// 全静态兜底 catalog（如 PI 探测失败时合成的 `auto` 条目）不算健康数据：
/// 非空 ≠ 可用。这类条目只允许作为「无旧数据时的 UI 降级展示」，禁止
/// ① 被 cache-first 当缓存直接命中（一次瞬时失败把 catalog 钉死在兜底）；
/// ② 在 force 刷新失败时写回 cache 顶掉上一份真实 catalog。
fn is_fallback_only_catalog(models: &[super::ModelInfo]) -> bool {
    !models.is_empty() && models.iter().all(|model| model.source == "fallback")
}

pub(crate) async fn resolve_engine_models_cache_first<F, Fut>(
    manager: &super::EngineManager,
    engine_type: EngineType,
    force_refresh: bool,
    refresh: F,
) -> Vec<super::ModelInfo>
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = super::EngineStatus>,
{
    let cached_models = manager
        .get_engine_status(engine_type)
        .await
        .map(|status| status.models)
        .filter(|models| !models.is_empty());
    // 防中毒判定仅圈 pi 族：只有 pi/omp 的 parse 层会在探测失败时合成
    // source=fallback 兜底条目（auto），「非空」唯独对 pi 族失去健康意义；
    // Kimi / Grok 等共用此函数的引擎没有合成兜底语义，cached 命中行为必须保持不变。
    let guard_fallback_poison = engine_type.is_pi_family();
    let cached_is_usable = cached_models
        .as_ref()
        .map(|models| !guard_fallback_poison || !is_fallback_only_catalog(models))
        .unwrap_or(false);
    if !force_refresh && cached_is_usable {
        return cached_models.unwrap_or_default();
    }
    let fresh_status = refresh().await;
    if fresh_status.models.is_empty() {
        return cached_models.unwrap_or_default();
    }
    let fresh_is_fallback_only =
        guard_fallback_poison && is_fallback_only_catalog(&fresh_status.models);
    if fresh_is_fallback_only && cached_is_usable {
        // 瞬时探测失败合成的兜底不得顶掉 last-good 真实 catalog。
        return cached_models.unwrap_or_default();
    }
    let models = fresh_status.models.clone();
    if !fresh_is_fallback_only {
        manager.cache_engine_status(fresh_status).await;
    }
    // 全 fallback 的 fresh（无旧 cache 或旧 cache 也是兜底）：交给 UI 降级展示，
    // 但不写回 cache——下次调用重新探测，探测恢复即自愈。
    models
}

/// Get models for a specific engine
#[tauri::command]
pub async fn get_engine_models(
    engine_type: EngineType,
    provider_profile_id: Option<String>,
    force_refresh: Option<bool>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<super::ModelInfo>, String> {
    let force_refresh = force_refresh.unwrap_or(false);
    let settings = read_app_settings_snapshot(&state).await;
    ensure_engine_enabled(&settings, engine_type)?;

    if remote_backend::is_remote_mode(&*state).await {
        return call_remote_typed(
            &*state,
            &app,
            "get_engine_models",
            json!({
                "engineType": engine_type,
                "providerProfileId": provider_profile_id,
                "forceRefresh": force_refresh
            }),
        )
        .await;
    }
    if let Some(models) = crate::engine::status::get_provider_scoped_engine_models(
        engine_type,
        provider_profile_id.as_deref(),
    )? {
        return Ok(models);
    }
    let manager = &state.engine_manager;

    match engine_type {
        EngineType::OpenCode => {
            let config = manager.get_engine_config(EngineType::OpenCode).await;
            let custom_bin = config
                .as_ref()
                .and_then(|cfg| cfg.bin_path.as_ref())
                .map(|s| s.as_str());
            let fresh_models = load_opencode_models(custom_bin).await.unwrap_or_default();

            if !fresh_models.is_empty() {
                return Ok(fresh_models);
            }

            if let Some(cached) = manager.get_engine_status(EngineType::OpenCode).await {
                if !cached.models.is_empty() {
                    return Ok(cached.models);
                }
            }

            Ok(fresh_models)
        }
        EngineType::Gemini => Ok(Vec::new()),
        EngineType::Kimi => {
            let config = manager.get_engine_config(EngineType::Kimi).await;
            let custom_bin = config.as_ref().and_then(|cfg| cfg.bin_path.clone());
            Ok(resolve_engine_models_cache_first(
                manager,
                EngineType::Kimi,
                force_refresh,
                move || async move { detect_kimi_status(custom_bin.as_deref()).await },
            )
            .await)
        }
        EngineType::Pi => {
            let config = manager.get_engine_config(EngineType::Pi).await;
            let custom_bin = config.as_ref().and_then(|cfg| cfg.bin_path.clone());
            Ok(resolve_engine_models_cache_first(
                manager,
                EngineType::Pi,
                force_refresh,
                move || async move { detect_pi_status(custom_bin.as_deref()).await },
            )
            .await)
        }
        EngineType::Omp => {
            let config = manager.get_engine_config(EngineType::Omp).await;
            let custom_bin = config.as_ref().and_then(|cfg| cfg.bin_path.clone());
            Ok(resolve_engine_models_cache_first(
                manager,
                EngineType::Omp,
                force_refresh,
                move || async move { detect_omp_status(custom_bin.as_deref()).await },
            )
            .await)
        }
        EngineType::Qoder => {
            let qoder_distribution_settings =
                super::qoder_provider_profile::QoderDistributionSettings::from_app_settings(
                    &settings,
                );
            let launch_profile =
                super::qoder_provider_profile::resolve_qoder_provider_launch_profile(
                    "model-catalog",
                    provider_profile_id.as_deref(),
                    &qoder_distribution_settings,
                )?;
            // Qoder catalog is scoped by distribution. Do not fall back to the
            // engine-wide status cache: that cache describes Global only.
            let fresh_status = super::status::detect_qoder_distribution_status(
                launch_profile.distribution,
                launch_profile.bin_path.as_deref(),
                launch_profile
                    .home_dir
                    .as_deref()
                    .and_then(|path| path.to_str()),
            )
            .await;
            Ok(fresh_status.models)
        }
        EngineType::Grok => {
            let config = manager.get_engine_config(EngineType::Grok).await;
            let custom_bin = config.as_ref().and_then(|cfg| cfg.bin_path.clone());
            Ok(resolve_engine_models_cache_first(
                manager,
                EngineType::Grok,
                force_refresh,
                move || async move { detect_grok_status(custom_bin.as_deref()).await },
            )
            .await)
        }
        EngineType::Claude | EngineType::Codex => {
            if force_refresh {
                let status = manager
                    .refresh_engine_status_with_gates(engine_type, settings.gemini_enabled)
                    .await;
                return Ok(status.models);
            }

            if let Some(status) = manager.get_engine_status(engine_type).await {
                if !status.models.is_empty() {
                    return Ok(status.models);
                }
            }

            let status = manager
                .refresh_engine_status_with_gates(engine_type, settings.gemini_enabled)
                .await;
            Ok(status.models)
        }
        EngineType::Dsh => {
            let runtime = crate::engine::dsh::runtime_settings_from_app(&settings);
            match crate::engine::dsh::load_dsh_models(&runtime).await {
                Ok(models) if !models.is_empty() => Ok(models),
                Ok(models) => {
                    if let Some(cached) = manager.get_engine_status(EngineType::Dsh).await {
                        if !cached.models.is_empty() {
                            return Ok(cached.models);
                        }
                    }
                    Ok(models)
                }
                Err(_) => {
                    if let Some(cached) = manager.get_engine_status(EngineType::Dsh).await {
                        if !cached.models.is_empty() {
                            return Ok(cached.models);
                        }
                    }
                    Ok(Vec::new())
                }
            }
        }
    }
}

fn build_claude_dispatch_receipt(
    workspace_id: &str,
    effective_provider_profile_id: Option<&str>,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
) -> Value {
    let provider_profile_id = effective_provider_profile_id.filter(|profile_id| {
        *profile_id != crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID
    });
    json!({
        "engine": "claude",
        "providerProfileId": provider_profile_id,
        "providerProfileSource": if provider_profile_id.is_some() { "managed" } else { "local" },
        "providerRuntimeKey": crate::engine::claude::provider_profile::claude_runtime_key(
            workspace_id,
            effective_provider_profile_id,
        ),
        "model": model,
        "reasoningEffort": reasoning_effort,
    })
}

fn build_provider_engine_dispatch_receipt(
    engine: EngineType,
    provider_profile_id: Option<&str>,
    provider_runtime_key: &str,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
) -> Value {
    let canonical_provider_profile_id = if engine == EngineType::Qoder {
        // Qoder Global/CN are fixed runtime distributions. Convert a legacy
        // empty/local binding to Global so the durable receipt never loses the
        // boundary that selected the binary, config directory, and PAT.
        super::qoder_provider_profile::qoder_distribution_from_provider_profile_id(
            provider_profile_id,
        )
        .ok()
        .map(|distribution| distribution.provider_profile_id())
    } else {
        provider_profile_id.filter(|profile_id| {
            !matches!(
                (engine, *profile_id),
                (
                    EngineType::Kimi,
                    super::kimi_provider_profile::KIMI_LOCAL_PROVIDER_PROFILE_ID
                ) | (
                    EngineType::Grok,
                    super::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID
                ) | (
                    EngineType::OpenCode,
                    super::opencode_provider_profile::OPENCODE_LOCAL_PROVIDER_PROFILE_ID
                ) | (
                    EngineType::Dsh,
                    super::dsh_provider_profile::DSH_LOCAL_PROVIDER_PROFILE_ID
                ) | (
                    EngineType::Pi,
                    super::pi_provider_profile::PI_LOCAL_PROVIDER_PROFILE_ID
                ) | (
                    EngineType::Omp,
                    super::omp_provider_profile::OMP_LOCAL_PROVIDER_PROFILE_ID
                )
            )
        })
    };
    json!({
        "engine": engine.icon(),
        "providerProfileId": canonical_provider_profile_id,
        "providerProfileSource": if canonical_provider_profile_id.is_some() { "managed" } else { "local" },
        "providerRuntimeKey": provider_runtime_key,
        "model": model,
        "reasoningEffort": reasoning_effort,
    })
}

fn fan_out_provider_engine_event(
    app: &AppHandle,
    provider_runtime_key: &str,
    engine: EngineType,
    runtime_turn_id: &str,
    native_session_id: Option<&str>,
    event: &EngineEvent,
    app_server_events: Vec<AppServerEvent>,
) {
    let shared_observation = app
        .try_state::<AppState>()
        .map(|app_state| {
            let observation = app_state
                .shared_runtime_coordinator
                .ingest_engine_event_with_replay_scoped(
                    provider_runtime_key,
                    engine,
                    Some(runtime_turn_id),
                    native_session_id,
                    event,
                    app_server_events.clone(),
                );
            crate::event_sink::publish_shared_runtime_observation(&app_state, &observation);
            observation
        })
        .unwrap_or_default();
    if shared_observation.ui_fanout_deferred {
        return;
    }
    for mut payload in app_server_events {
        if let Some(owner) = shared_observation.owner.as_ref() {
            crate::shared_runtime_coordinator::project_app_server_event_to_shared_owner(
                &mut payload,
                owner,
            );
        }
        let _ = app.emit("app-server-event", payload);
    }
}

/// engine-neutral 预热：对具备 resident 模型的引擎（pi）在用户阅读/打字窗口
/// 内提前 spawn + handshake，把冷启开销移出发送关键路径。形态对齐
/// prewarm_codex_disk_runtime（fire-and-forget、调用方对失败静默）。
/// 返回 true = 执行了预热；false = 引擎不支持或无事可做（no-op 不算错）。
/// 双轨契约：预热失败只影响本次加速，不影响首条发送的 ensure_resident 主路径。
#[tauri::command]
pub async fn engine_prewarm(
    workspace_id: String,
    engine: Option<EngineType>,
    session_id: Option<String>,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    // 远程模式是 daemon 侧运行时，预热是 client-local 优化，不做。
    if remote_backend::is_remote_mode(&*state).await {
        return Ok(false);
    }
    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let effective_engine = engine.unwrap_or(active_engine);
    if !effective_engine.is_pi_family() {
        return Ok(false);
    }
    let Some(session_id) = session_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
    else {
        // pending / 新会话不做预热：send scratch 是每 turn 唯一 turn id，
        // 预热 resident 无法被 send 命中，只会白起一个进程。
        return Ok(false);
    };
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| std::path::PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let effective_provider_profile_id =
        crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            Some(&session_id),
            effective_engine.icon(),
            provider_profile_id.as_deref(),
        )?;
    let provider_launch_profile =
        crate::engine::pi_provider_profile::resolve_pi_family_provider_launch_profile(
            effective_engine,
            &workspace_id,
            effective_provider_profile_id.as_deref(),
            None,
        )?;
    let session = manager
        .get_or_create_pi_family_session_for_runtime(
            effective_engine,
            &workspace_id,
            &workspace_path,
            &provider_launch_profile.runtime_key,
            provider_launch_profile.home_dir.as_deref(),
        )
        .await;
    session.prewarm_resident(&session_id).await?;
    Ok(true)
}

/// Interrupt the current operation for the active engine
#[tauri::command]
pub async fn engine_interrupt(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_engine_interrupt_request(workspace_id);
        let _: Value = call_remote_typed(&*state, &app, method, params).await?;
        return Ok(());
    }
    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;

    match active_engine {
        EngineType::Claude => {
            manager
                .claude_manager
                .interrupt_workspace_sessions(&workspace_id)
                .await
        }
        EngineType::Codex => {
            // Codex interrupts are handled via turn_interrupt RPC from the frontend.
            // This path is a fallback; log for diagnostic visibility.
            log::info!(
                "engine_interrupt called for Codex workspace: {}",
                workspace_id
            );
            Ok(())
        }
        EngineType::OpenCode => {
            manager
                .interrupt_opencode_sessions(&workspace_id, None)
                .await
        }
        EngineType::Gemini => {
            if let Some(session) = manager.get_gemini_session(&workspace_id).await {
                session.interrupt().await?;
            }
            Ok(())
        }
        EngineType::Kimi => manager.interrupt_kimi_sessions(&workspace_id, None).await,
        EngineType::Pi => manager.interrupt_pi_sessions(&workspace_id, None).await,
        EngineType::Omp => manager.interrupt_omp_sessions(&workspace_id, None).await,
        EngineType::Qoder => manager.interrupt_qoder_sessions(&workspace_id, None).await,
        EngineType::Grok => manager.interrupt_grok_sessions(&workspace_id, None).await,
        EngineType::Dsh => {
            let settings = read_app_settings_snapshot(&state).await;
            let runtime = crate::engine::dsh::runtime_settings_from_app(&settings);
            crate::engine::dsh::interrupt_workspace(&runtime, &workspace_id).await
        }
    }
}

/// Interrupt a specific turn for the active engine.
#[tauri::command]
pub async fn engine_interrupt_turn(
    workspace_id: String,
    turn_id: String,
    engine: Option<EngineType>,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if remote_backend::is_remote_mode(&*state).await {
        let _: Value = call_remote_typed(
            &*state,
            &app,
            "engine_interrupt_turn",
            json!({
                "workspaceId": workspace_id,
                "turnId": turn_id,
                "engine": engine,
                "providerProfileId": provider_profile_id,
            }),
        )
        .await?;
        return Ok(());
    }
    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let target_engine = engine.unwrap_or(active_engine);

    match target_engine {
        EngineType::Claude => {
            let provider_profile_id = provider_profile_id
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let session = if provider_profile_id.is_some() {
                let provider_session = manager
                    .claude_manager
                    .get_session_for_provider(&workspace_id, provider_profile_id)
                    .await;
                match provider_session {
                    Some(session) if session.has_active_turn(&turn_id).await => Some(session),
                    _ => None,
                }
            } else {
                manager
                    .claude_manager
                    .session_for_turn(&workspace_id, &turn_id)
                    .await
            };
            if let Some(session) = session {
                session.interrupt_turn(&turn_id).await?;
            }
            Ok(())
        }
        EngineType::Codex => {
            // Codex interrupts are handled via turn_interrupt RPC from the frontend.
            Ok(())
        }
        EngineType::OpenCode => {
            manager
                .interrupt_opencode_sessions(&workspace_id, Some(&turn_id))
                .await
        }
        EngineType::Gemini => {
            if let Some(session) = manager.get_gemini_session(&workspace_id).await {
                session.interrupt_turn(&turn_id).await?;
            }
            Ok(())
        }
        EngineType::Kimi => {
            manager
                .interrupt_kimi_sessions(&workspace_id, Some(&turn_id))
                .await
        }
        EngineType::Pi => {
            manager
                .interrupt_pi_sessions(&workspace_id, Some(&turn_id))
                .await
        }
        EngineType::Omp => {
            manager
                .interrupt_omp_sessions(&workspace_id, Some(&turn_id))
                .await
        }
        EngineType::Qoder => {
            manager
                .interrupt_qoder_session_for_profile(
                    &workspace_id,
                    provider_profile_id.as_deref(),
                    Some(&turn_id),
                )
                .await
        }
        EngineType::Grok => {
            manager
                .interrupt_grok_sessions(&workspace_id, Some(&turn_id))
                .await
        }
        EngineType::Dsh => {
            let settings = read_app_settings_snapshot(&state).await;
            let runtime = crate::engine::dsh::runtime_settings_from_app(&settings);
            crate::engine::dsh::interrupt_turn(&runtime, &turn_id).await
        }
    }
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod commands_tests;
