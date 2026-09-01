use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::codex;
use crate::engine::{self, EngineType};
use crate::shared::codex_core;
use crate::state::AppState;

#[path = "shared_sessions/delta_sync.rs"]
mod delta_sync;
#[path = "shared_sessions/selection.rs"]
mod selection;
#[path = "shared_sessions/store.rs"]
mod store;
#[path = "shared_sessions/thread_id.rs"]
mod thread_id;

pub(crate) use delta_sync::{build_delta_sync_prefix, count_user_turns, extract_first_user_title};
#[cfg(test)]
pub(crate) use delta_sync::{inspect_shared_context_projection, MAX_DELTA_SYNC_CHARS};
pub(crate) use selection::{
    default_target_binding_availability, is_legacy_engine_only_selected_target,
    normalize_provider_selection_source, normalize_shared_selected_target, select_meta_target,
    upsert_v2_selected_target, validate_resolved_shared_selected_target,
    write_shared_session_selection, SharedEngineBinding, SharedSelectedReasoning,
    SharedTargetBindingMeta,
};
#[cfg(test)]
pub(crate) use selection::{
    apply_selected_target_selection, legacy_engine_only_selected_target,
    resolve_shared_selection_update, sanitize_shared_session_meta, select_meta_engine_compat,
};
pub use selection::SharedSelectedTarget;
pub(crate) use store::{
    append_shared_session_log_entry, list_workspace_shared_sessions,
    load_workspace_shared_ownership_seed, now_millis, read_latest_shared_session_snapshot,
    read_shared_session_meta, shared_session_dir, shared_session_projection_source,
    write_shared_session_meta, SharedSessionMeta, SharedSessionSnapshotEntry,
    SharedSessionSummary, SHARED_SESSION_SCHEMA_VERSION,
};
#[cfg(test)]
pub(crate) use store::load_seed_from_shared_sessions_dir;
pub(crate) use thread_id::{
    binding_uses_established_native_thread, canonical_shared_native_thread_id,
    engine_binding_thread_id, is_pending_shared_binding_thread_id, parse_shared_session_id,
    shared_target_binding_key, shared_thread_id, validate_shared_native_thread_id,
};

fn codex_turn_developer_instructions(settings: &crate::types::AppSettings) -> Option<String> {
    crate::backend::app_server_cli::codex_generated_developer_instructions_for_turn(settings)
}

fn is_supported_shared_session_engine(engine: EngineType) -> bool {
    matches!(
        engine,
        EngineType::Claude
            | EngineType::Codex
            | EngineType::Kimi
            | EngineType::Grok
            | EngineType::OpenCode
            | EngineType::Pi
            | EngineType::Qoder
    )
}

fn normalize_shared_session_engine(engine: EngineType) -> EngineType {
    if is_supported_shared_session_engine(engine) {
        engine
    } else {
        EngineType::Claude
    }
}

pub(crate) fn ensure_supported_shared_session_engine(
    engine: EngineType,
) -> Result<EngineType, String> {
    if is_supported_shared_session_engine(engine) {
        Ok(engine)
    } else {
        Err(format!(
            "Unsupported shared session engine: {}",
            engine.icon()
        ))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SharedSessionLoadPayload {
    id: String,
    thread_id: String,
    title: String,
    selected_engine: EngineType,
    thread_kind: String,
    engine_source: EngineType,
    selected_target: Option<SharedSelectedTarget>,
    items: Vec<Value>,
    updated_at: u64,
}

async fn ensure_shared_session_native_binding(
    workspace_id: &str,
    meta: &mut SharedSessionMeta,
    engine: EngineType,
    provider_profile_id: Option<String>,
    last_turn_seq: u64,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, String> {
    let now = now_millis();
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let binding_key = shared_target_binding_key(engine, provider_profile_id.as_deref());
    let (current_native_thread_id, needs_codex_thread) = {
        let native_thread_id = if provider_profile_id.is_some() {
            let binding = meta
                .bindings_by_target
                .entry(binding_key.clone())
                .or_insert_with(|| SharedTargetBindingMeta {
                    binding_key: binding_key.clone(),
                    engine,
                    provider_profile_id: provider_profile_id.clone(),
                    native_thread_id: engine_binding_thread_id(engine, &Uuid::new_v4().to_string()),
                    created_at: now,
                    last_used_at: now,
                    // New target binding should replay canonical shared history on first send.
                    last_synced_turn_seq: 0,
                    availability: default_target_binding_availability(),
                });
            binding.last_used_at = now;
            binding.native_thread_id.clone()
        } else {
            let binding =
                meta.bindings_by_engine
                    .entry(engine)
                    .or_insert_with(|| SharedEngineBinding {
                        engine,
                        native_thread_id: engine_binding_thread_id(
                            engine,
                            &Uuid::new_v4().to_string(),
                        ),
                        created_at: now,
                        last_used_at: now,
                        // New engine binding should replay canonical shared history on first send.
                        last_synced_turn_seq: 0,
                    });
            binding.last_used_at = now;
            binding.native_thread_id.clone()
        };
        let needs_codex_thread = engine == EngineType::Codex
            && !binding_uses_established_native_thread(engine, &native_thread_id);
        (native_thread_id, needs_codex_thread)
    };

    if !needs_codex_thread {
        return Ok(current_native_thread_id);
    }

    let started = codex::start_thread_with_runtime_retry_for_provider(
        workspace_id,
        None,
        provider_profile_id.clone(),
        state,
        app,
    )
    .await?;
    let result = started
        .get("result")
        .cloned()
        .unwrap_or_else(|| started.clone());
    let next_native_thread_id = result
        .get("thread")
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .or_else(|| result.get("threadId").and_then(Value::as_str))
        .unwrap_or_default()
        .trim()
        .to_string();
    if next_native_thread_id.is_empty() {
        return Err("Failed to create Codex binding thread".to_string());
    }

    if provider_profile_id.is_some() {
        if let Some(binding) = meta.bindings_by_target.get_mut(&binding_key) {
            binding.native_thread_id = next_native_thread_id.clone();
            binding.created_at = now;
            binding.last_used_at = now;
            binding.last_synced_turn_seq = last_turn_seq;
        }
    } else if let Some(binding) = meta.bindings_by_engine.get_mut(&engine) {
        binding.native_thread_id = next_native_thread_id.clone();
        binding.created_at = now;
        binding.last_used_at = now;
        binding.last_synced_turn_seq = last_turn_seq;
    }

    Ok(next_native_thread_id)
}

/// 读取 binding 的已同步 turn seq（provider None → engine map 权威；Some → target map）。
fn shared_binding_synced_turn_seq(
    meta: &mut SharedSessionMeta,
    engine: EngineType,
    provider_profile_id: Option<&str>,
    now: u64,
) -> u64 {
    if provider_profile_id.is_some() {
        let key = shared_target_binding_key(engine, provider_profile_id);
        let binding = meta
            .bindings_by_target
            .entry(key.clone())
            .or_insert_with(|| SharedTargetBindingMeta {
                binding_key: key,
                engine,
                provider_profile_id: provider_profile_id.map(str::to_string),
                native_thread_id: engine_binding_thread_id(engine, &Uuid::new_v4().to_string()),
                created_at: now,
                last_used_at: now,
                last_synced_turn_seq: 0,
                availability: default_target_binding_availability(),
            });
        binding.last_synced_turn_seq
    } else {
        let binding =
            meta.bindings_by_engine
                .entry(engine)
                .or_insert_with(|| SharedEngineBinding {
                    engine,
                    native_thread_id: engine_binding_thread_id(engine, &Uuid::new_v4().to_string()),
                    created_at: now,
                    last_used_at: now,
                    last_synced_turn_seq: 0,
                });
        binding.last_synced_turn_seq
    }
}

/// 发送前后触碰 binding（更新 last_used_at；可选推进 last_synced_turn_seq）。
fn touch_shared_binding(
    meta: &mut SharedSessionMeta,
    engine: EngineType,
    provider_profile_id: Option<&str>,
    now: u64,
    synced_turn_seq: Option<u64>,
) {
    if provider_profile_id.is_some() {
        let key = shared_target_binding_key(engine, provider_profile_id);
        if let Some(binding) = meta.bindings_by_target.get_mut(&key) {
            binding.last_used_at = now;
            if let Some(synced) = synced_turn_seq {
                binding.last_synced_turn_seq = synced;
            }
        }
    } else if let Some(binding) = meta.bindings_by_engine.get_mut(&engine) {
        binding.last_used_at = now;
        if let Some(synced) = synced_turn_seq {
            binding.last_synced_turn_seq = synced;
        }
    }
}

pub(crate) fn shared_binding_synced_sequence(
    meta: &SharedSessionMeta,
    engine: EngineType,
    provider_profile_id: Option<&str>,
) -> u64 {
    match provider_profile_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(provider) => meta
            .bindings_by_target
            .get(&shared_target_binding_key(engine, Some(provider)))
            .map(|binding| binding.last_synced_turn_seq)
            .unwrap_or(0),
        None => meta
            .bindings_by_engine
            .get(&engine)
            .map(|binding| binding.last_synced_turn_seq)
            .unwrap_or(0),
    }
}

async fn resolve_workspace_path(
    workspaces: &Mutex<HashMap<String, crate::types::WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let workspaces = workspaces.lock().await;
    let entry = workspaces
        .get(workspace_id)
        .ok_or_else(|| format!("workspace not found: {workspace_id}"))?;
    Ok(PathBuf::from(&entry.path))
}

async fn ensure_known_workspace(
    workspaces: &Mutex<HashMap<String, crate::types::WorkspaceEntry>>,
    workspace_id: &str,
) -> Result<(), String> {
    let workspaces = workspaces.lock().await;
    if workspaces.contains_key(workspace_id) {
        Ok(())
    } else {
        Err(format!("workspace not found: {workspace_id}"))
    }
}

fn load_meta_and_snapshot(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<(SharedSessionMeta, Option<SharedSessionSnapshotEntry>), String> {
    Ok((
        read_shared_session_meta(workspace_id, shared_session_id)?,
        read_latest_shared_session_snapshot(workspace_id, shared_session_id)?,
    ))
}

#[tauri::command]
pub async fn start_shared_session(
    workspace_id: String,
    initial_target: Option<SharedSelectedTarget>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let writer = state.shared_event_writer.as_ref().ok_or_else(|| {
        "shared event writer unavailable; cannot create a durable Shared Session".to_string()
    })?;

    let selected_target = match initial_target {
        Some(target) => {
            let target = normalize_shared_selected_target(target);
            validate_resolved_shared_selected_target(&target)?;
            target
        }
        None => {
            return Err(
                "invalid-shared-target: initialTarget is required for a new Shared Session"
                    .to_string(),
            )
        }
    };
    let selected_engine = selected_target.engine;
    let now = now_millis();
    let shared_session_id = Uuid::new_v4().to_string();
    let meta = SharedSessionMeta {
        schema_version: SHARED_SESSION_SCHEMA_VERSION,
        id: shared_session_id.clone(),
        workspace_id: workspace_id.clone(),
        title: "Shared Session".to_string(),
        created_at: now,
        updated_at: now,
        selected_engine,
        selected_target: Some(selected_target.clone()),
        last_turn_seq: 0,
        bindings_by_engine: HashMap::new(),
        bindings_by_target: HashMap::new(),
    };
    let session_dir = shared_session_dir(&workspace_id, &shared_session_id)?;
    std::fs::create_dir_all(&session_dir).map_err(|error| error.to_string())?;
    if let Err(error) = write_shared_session_meta(&meta)
        .and_then(|_| upsert_v2_selected_target(writer, &shared_session_id, &selected_target, now))
    {
        let rollback = std::fs::remove_dir_all(&session_dir);
        return Err(match rollback {
            Ok(()) => error,
            Err(rollback_error) => {
                format!("{error}; new Shared Session rollback failed: {rollback_error}")
            }
        });
    }

    Ok(json!({
        "result": {
            "thread": {
                "id": shared_thread_id(&shared_session_id),
                "name": meta.title,
                "updatedAt": meta.updated_at,
                "threadKind": "shared",
                "engineSource": meta.selected_engine,
                "selectedEngine": meta.selected_engine,
                "selectedTarget": selected_target,
                "nativeThreadIds": Vec::<String>::new(),
            }
        }
    }))
}

#[tauri::command]
pub async fn list_shared_sessions(
    workspace_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let event_log_path = state
        .storage_path
        .parent()
        .map(|parent| parent.join("shared-event-log-v2.sqlite3"));
    Ok(json!(list_workspace_shared_sessions(
        &workspace_id,
        state.shared_event_writer.as_ref(),
        event_log_path.as_deref(),
    )?))
}

#[tauri::command]
pub async fn load_shared_session(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    let (meta, snapshot) = load_meta_and_snapshot(&workspace_id, &shared_session_id)?;
    let payload = SharedSessionLoadPayload {
        id: meta.id.clone(),
        thread_id: shared_thread_id(&meta.id),
        title: meta.title.clone(),
        selected_engine: meta.selected_engine,
        thread_kind: "shared".to_string(),
        engine_source: meta.selected_engine,
        selected_target: meta.selected_target.clone(),
        items: snapshot
            .as_ref()
            .map(|entry| entry.items.clone())
            .unwrap_or_default(),
        updated_at: meta.updated_at,
    };
    Ok(json!(payload))
}

#[tauri::command]
pub async fn set_shared_session_selected_engine(
    workspace_id: String,
    thread_id: String,
    selected_engine: EngineType,
    provider_profile_id: Option<String>,
    model_catalog_entry_id: Option<String>,
    model: Option<String>,
    reasoning_effort: Option<String>,
    provider_profile_name_snapshot: Option<String>,
    provider_profile_source: Option<String>,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let selected_engine = ensure_supported_shared_session_engine(selected_engine)?;
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    let now = now_millis();
    let selected_target = normalize_shared_selected_target(SharedSelectedTarget {
        engine: selected_engine,
        provider_profile_id,
        model_catalog_entry_id: model_catalog_entry_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        model: model
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        reasoning: reasoning_effort
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .map(|effort| SharedSelectedReasoning { effort }),
        provider_profile_name_snapshot: provider_profile_name_snapshot
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        provider_profile_source: normalize_provider_selection_source(provider_profile_source),
    });
    if !is_legacy_engine_only_selected_target(&selected_target) {
        validate_resolved_shared_selected_target(&selected_target)?;
    }
    let selected_target = write_shared_session_selection(
        &workspace_id,
        &shared_session_id,
        &selected_target,
        now,
        state.shared_event_writer.as_ref().ok_or_else(|| {
            "shared event writer unavailable; cannot persist Shared Session Target".to_string()
        })?,
    )?;
    Ok(json!({
        "threadId": shared_thread_id(&shared_session_id),
        "selectedEngine": selected_target.engine,
        "engineSource": selected_target.engine,
        "threadKind": "shared",
        "selectedTarget": selected_target,
    }))
}

#[tauri::command]
pub async fn update_shared_session_native_binding(
    workspace_id: String,
    thread_id: String,
    engine: EngineType,
    old_native_thread_id: Option<String>,
    new_native_thread_id: String,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let engine = ensure_supported_shared_session_engine(engine)?;
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    let new_native_thread_id = canonical_shared_native_thread_id(
        engine,
        provider_profile_id.as_deref(),
        &validate_shared_native_thread_id(&new_native_thread_id)?,
    );
    let old_native_thread_id = old_native_thread_id.map(|native_thread_id| {
        canonical_shared_native_thread_id(engine, provider_profile_id.as_deref(), &native_thread_id)
    });
    let mut meta = read_shared_session_meta(&workspace_id, &shared_session_id)?;
    if let Some(provider) = provider_profile_id.as_deref() {
        // B.5：managed provider 走 Target 级 binding；rebind 时保留 created_at，
        // 仅更新 native_thread_id / last_used_at。
        let binding_key = shared_target_binding_key(engine, Some(provider));
        let now = now_millis();
        let entry = meta
            .bindings_by_target
            .entry(binding_key.clone())
            .or_insert_with(|| SharedTargetBindingMeta {
                binding_key,
                engine,
                provider_profile_id: Some(provider.to_string()),
                native_thread_id: new_native_thread_id.clone(),
                created_at: now,
                last_used_at: now,
                last_synced_turn_seq: meta.last_turn_seq,
                availability: default_target_binding_availability(),
            });
        let matches_old = old_native_thread_id
            .as_ref()
            .map(|value| value.trim() == entry.native_thread_id.trim())
            .unwrap_or(true);
        if matches_old {
            entry.native_thread_id = new_native_thread_id.clone();
            entry.last_used_at = now;
        }
        meta.updated_at = now_millis();
        write_shared_session_meta(&meta)?;
        return Ok(json!({
            "threadId": shared_thread_id(&meta.id),
            "engine": engine,
            "providerProfileId": provider,
            "nativeThreadId": new_native_thread_id,
        }));
    }
    let entry = meta
        .bindings_by_engine
        .entry(engine)
        .or_insert_with(|| SharedEngineBinding {
            engine,
            native_thread_id: new_native_thread_id.clone(),
            created_at: now_millis(),
            last_used_at: now_millis(),
            last_synced_turn_seq: meta.last_turn_seq,
        });
    let matches_old = old_native_thread_id
        .as_ref()
        .map(|value| value.trim() == entry.native_thread_id.trim())
        .unwrap_or(true);
    if matches_old {
        entry.native_thread_id = new_native_thread_id.clone();
        entry.last_used_at = now_millis();
    }
    meta.updated_at = now_millis();
    write_shared_session_meta(&meta)?;
    Ok(json!({
        "threadId": shared_thread_id(&meta.id),
        "engine": engine,
        "nativeThreadId": new_native_thread_id,
    }))
}

fn apply_shared_snapshot_presentation_metadata(
    meta: &mut SharedSessionMeta,
    items: &[Value],
    updated_at: u64,
) {
    meta.updated_at = updated_at;
    meta.last_turn_seq = count_user_turns(items);
    if let Some(title) = extract_first_user_title(items) {
        meta.title = title;
    }
}

#[tauri::command]
pub async fn sync_shared_session_snapshot(
    workspace_id: String,
    thread_id: String,
    items: Vec<Value>,
    selected_engine: EngineType,
    legacy_snapshot_enabled: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let selected_engine = ensure_supported_shared_session_engine(selected_engine)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    let mut meta = read_shared_session_meta(&workspace_id, &shared_session_id)?;
    // Snapshot sync 只拥有 presentation authority。Selection 的唯一写入口是
    // set_shared_session_selected_engine；stale timer 禁止反向覆盖 selectedTarget。
    apply_shared_snapshot_presentation_metadata(&mut meta, &items, now_millis());
    write_shared_session_meta(&meta)?;
    if !legacy_snapshot_enabled.unwrap_or(true) {
        return Ok(json!({
            "threadId": shared_thread_id(&meta.id),
            "updatedAt": meta.updated_at,
            "lastTurnSeq": meta.last_turn_seq,
            "legacySnapshot": {
                "status": "skipped",
                "reason": "renderer-v2-authority",
            },
            "shadowMirror": { "status": "skipped" },
        }));
    }
    let entry = SharedSessionSnapshotEntry {
        kind: "snapshot".to_string(),
        created_at: meta.updated_at,
        selected_engine,
        last_turn_seq: meta.last_turn_seq,
        items,
    };
    append_shared_session_log_entry(&workspace_id, &shared_session_id, &entry)?;
    let shadow_mirror = if let Some(writer) = state.shared_event_writer.as_ref() {
        let facts =
            crate::shared_event_log::canonical::shadow_v0::map_v0_snapshot_to_presentation_only_facts(
                &entry.items,
                selected_engine.icon(),
                i64::try_from(entry.created_at).unwrap_or(i64::MAX),
            );
        let mut mirrored_facts = 0usize;
        let mut mirror_error = None;
        for fact in facts {
            match writer.append_presentation_only_fact(shared_session_id.clone(), fact) {
                Ok(_) => mirrored_facts += 1,
                Err(error) => {
                    mirror_error = Some(error.to_string());
                    break;
                }
            }
        }
        if let Some(error) = mirror_error {
            eprintln!(
                "[shared-event-log] V0 shadow mirror failed session={shared_session_id}: {error}"
            );
            json!({ "status": "error", "error": error })
        } else {
            json!({ "status": "ok", "factCount": mirrored_facts })
        }
    } else {
        json!({ "status": "unavailable" })
    };
    Ok(json!({
        "threadId": shared_thread_id(&meta.id),
        "updatedAt": meta.updated_at,
        "lastTurnSeq": meta.last_turn_seq,
        "shadowMirror": shadow_mirror,
    }))
}

/// Deletes shared session storage for a workspace.
/// Returns `Ok(true)` when files were removed, `Ok(false)` when already absent.
pub(crate) fn delete_shared_session_files(
    workspace_id: &str,
    thread_id: &str,
) -> Result<bool, String> {
    let shared_session_id = parse_shared_session_id(thread_id)?;
    let path = shared_session_dir(workspace_id, &shared_session_id)?;
    if !path.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
pub async fn delete_shared_session(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    ensure_known_workspace(&state.workspaces, &workspace_id).await?;
    let deleted = delete_shared_session_files(&workspace_id, &thread_id)?;
    Ok(json!({ "deleted": deleted, "threadId": thread_id }))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharedContextRuntimeDelivery {
    pub package_id: String,
    pub source_checksum: String,
    pub operation: String,
    #[serde(default)]
    pub import_items: Vec<Value>,
    pub ack_fidelity: String,
}

#[tauri::command]
pub async fn send_shared_session_message(
    workspace_id: String,
    thread_id: String,
    engine: EngineType,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    collaboration_mode: Option<Value>,
    preferred_language: Option<String>,
    custom_spec_root: Option<String>,
    provider_profile_id: Option<String>,
    context_delivery: Option<SharedContextRuntimeDelivery>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let engine = ensure_supported_shared_session_engine(engine)?;
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let binding_key = shared_target_binding_key(engine, provider_profile_id.as_deref());
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    let _workspace_path = resolve_workspace_path(&state.workspaces, &workspace_id).await?;
    let (mut meta, snapshot) = load_meta_and_snapshot(&workspace_id, &shared_session_id)?;
    let now = now_millis();
    let latest_items = snapshot
        .as_ref()
        .map(|entry| entry.items.clone())
        .unwrap_or_default();
    let latest_turn_seq = count_user_turns(&latest_items);
    let sync_from_turn_seq =
        shared_binding_synced_turn_seq(&mut meta, engine, provider_profile_id.as_deref(), now);

    // Change C package 已由 Canonical Log 编译；存在 contextDelivery 时禁止再叠加
    // V0 snapshot prefix，否则同一历史会被重复投递。
    let sync_prefix = if context_delivery.is_none() && sync_from_turn_seq < latest_turn_seq {
        build_delta_sync_prefix(&latest_items, sync_from_turn_seq)
    } else {
        None
    };
    let outbound_text = if let Some(prefix) = sync_prefix {
        format!("{prefix}\n\nCurrent user request:\n{text}")
    } else {
        text.clone()
    };
    let mut context_acceptance = Value::Null;

    let response = match engine {
        EngineType::Codex => {
            let native_thread_id = ensure_shared_session_native_binding(
                &workspace_id,
                &mut meta,
                engine,
                provider_profile_id.clone(),
                latest_turn_seq,
                &state,
                &app,
            )
            .await?;
            touch_shared_binding(&mut meta, engine, provider_profile_id.as_deref(), now, None);
            select_meta_target(&mut meta, engine, provider_profile_id.clone());
            meta.updated_at = now;
            // Persist binding materialization before sending so failures don't
            // repeatedly create new native threads.
            write_shared_session_meta(&meta)?;
            if let Some(delivery) = context_delivery.as_ref() {
                if delivery.operation == "context-import" {
                    codex_core::inject_thread_items_core(
                        &state.sessions,
                        &workspace_id,
                        provider_profile_id.as_deref(),
                        &native_thread_id,
                        delivery.import_items.clone(),
                    )
                    .await?;
                    context_acceptance = json!({
                        "status": "accepted",
                        "packageId": delivery.package_id,
                        "sourceChecksum": delivery.source_checksum,
                        "ackFidelity": delivery.ack_fidelity,
                        "evidence": "thread/inject_items-jsonrpc-success",
                    });
                }
            }
            let (mode_enforcement_enabled, extra_developer_instructions) = {
                let settings = state.app_settings.lock().await;
                (
                    settings.codex_mode_enforcement_enabled,
                    codex_turn_developer_instructions(&settings),
                )
            };
            let response = codex_core::send_user_message_core(
                &state.sessions,
                workspace_id.clone(),
                provider_profile_id.clone(),
                native_thread_id.clone(),
                outbound_text,
                model,
                effort,
                access_mode,
                images,
                collaboration_mode,
                preferred_language,
                custom_spec_root,
                mode_enforcement_enabled,
                extra_developer_instructions,
            )
            .await?;
            touch_shared_binding(
                &mut meta,
                engine,
                provider_profile_id.as_deref(),
                now,
                Some(latest_turn_seq + 1),
            );
            select_meta_target(&mut meta, engine, provider_profile_id.clone());
            meta.updated_at = now;
            meta.last_turn_seq = latest_turn_seq + 1;
            write_shared_session_meta(&meta)?;
            response
        }
        EngineType::Claude => {
            let native_thread_id = ensure_shared_session_native_binding(
                &workspace_id,
                &mut meta,
                engine,
                provider_profile_id.clone(),
                latest_turn_seq,
                &state,
                &app,
            )
            .await?;
            let continue_session =
                binding_uses_established_native_thread(engine, &native_thread_id);
            let session_id = if continue_session {
                native_thread_id
                    .split_once(':')
                    .map(|(_, session_id)| session_id.to_string())
            } else {
                None
            };
            touch_shared_binding(&mut meta, engine, provider_profile_id.as_deref(), now, None);
            select_meta_target(&mut meta, engine, provider_profile_id.clone());
            meta.updated_at = now;
            write_shared_session_meta(&meta)?;
            let response = engine::engine_send_message(
                workspace_id.clone(),
                outbound_text,
                Some(engine),
                model,
                effort,
                disable_thinking,
                access_mode,
                images,
                continue_session,
                Some(native_thread_id),
                session_id,
                None,
                None,
                None,
                provider_profile_id.clone(),
                custom_spec_root,
                None,
                None,
                None,
                app,
                state,
            )
            .await?;
            touch_shared_binding(
                &mut meta,
                engine,
                provider_profile_id.as_deref(),
                now,
                Some(latest_turn_seq + 1),
            );
            select_meta_target(&mut meta, engine, provider_profile_id.clone());
            meta.updated_at = now;
            meta.last_turn_seq = latest_turn_seq + 1;
            write_shared_session_meta(&meta)?;
            response
        }
        EngineType::Gemini
        | EngineType::OpenCode
        | EngineType::Grok
        | EngineType::Kimi
        | EngineType::Pi
        | EngineType::Dsh
        | EngineType::Omp
        | EngineType::Qoder => {
            return Err(format!(
                "Unsupported shared session engine: {}",
                engine.icon()
            ));
        }
    };
    let prompt_acceptance = if response.get("error").is_some() {
        "rejected"
    } else {
        "accepted"
    };
    if context_acceptance.is_null() {
        if let Some(delivery) = context_delivery.as_ref() {
            if delivery.operation == "prompt-prefix" && prompt_acceptance == "accepted" {
                context_acceptance = json!({
                    "status": if delivery.ack_fidelity == "strong" { "pending" } else { "accepted" },
                    "packageId": delivery.package_id,
                    "sourceChecksum": delivery.source_checksum,
                    "ackFidelity": delivery.ack_fidelity,
                    "evidence": if delivery.ack_fidelity == "strong" {
                        "awaiting-claude-replay-echo"
                    } else {
                        "typed-prompt-acceptance"
                    },
                });
            }
        }
    }

    Ok(json!({
        "engine": engine,
        "sharedSessionId": shared_session_id,
        "threadKind": "shared",
        "threadId": thread_id,
        "nativeThreadId": if provider_profile_id.is_some() {
            meta.bindings_by_target.get(&binding_key).map(|binding| binding.native_thread_id.clone()).unwrap_or_default()
        } else {
            meta.bindings_by_engine.get(&engine).map(|binding| binding.native_thread_id.clone()).unwrap_or_default()
        },
        "providerProfileId": provider_profile_id,
        "bindingKey": binding_key,
        "selectedEngine": meta.selected_engine,
        "result": response.get("result").cloned().unwrap_or_else(|| response.clone()),
        "turn": response.get("turn").cloned().or_else(|| response.get("result").and_then(|value| value.get("turn")).cloned()).unwrap_or(Value::Null),
        "response": response,
        "delivery": json!({
            "promptAcceptance": prompt_acceptance,
            "contextAcceptance": context_acceptance,
        }),
    }))
}


#[cfg(test)]
#[path = "shared_sessions_tests.rs"]
mod tests;
