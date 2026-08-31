use std::collections::HashMap;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, State};

use super::provider_fork::resolve_codex_provider_history_path;
use super::provider_profile::{resolve_codex_provider_profile, CODEX_DISK_PROVIDER_PROFILE_ID};
use super::rewind;
use super::session_runtime::ensure_codex_session_for_provider;
use super::start_thread_retry::start_thread_with_runtime_retry_for_provider;
use super::thread_listing::{build_unified_codex_thread_page, resolve_provider_scoped_fallback_model};
use crate::local_usage;
use crate::remote_backend;
use crate::session_management::CodexProviderBinding;
use crate::shared::codex_core;
use crate::shared::workspaces_core::disconnect_workspace_session_core;
use crate::state::AppState;

pub(crate) async fn resolve_codex_native_history_path(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
    provider_profile_id: &str,
) -> Result<std::path::PathBuf, String> {
    resolve_codex_provider_history_path(state, workspace_id, thread_id, provider_profile_id).await
}

fn hidden_auto_session_metadata(
    session_purpose: &str,
    owner_feature: &str,
) -> crate::session_management::AutoSessionMetadata {
    crate::session_management::AutoSessionMetadata {
        session_purpose: session_purpose.to_string(),
        visibility: crate::session_management::AutoSessionVisibility::Hidden,
        owner_feature: owner_feature.to_string(),
        auto_archive: Some(true),
        created_by: crate::session_management::AutoSessionCreatedBy::System,
    }
}

pub(crate) async fn record_hidden_codex_helper_thread(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
    session_purpose: &str,
    owner_feature: &str,
) {
    let _ = crate::session_management::record_auto_session_metadata_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id.to_string(),
        thread_id.to_string(),
        hidden_auto_session_metadata(session_purpose, owner_feature),
    )
    .await;
}

pub(crate) async fn resolve_thread_provider_profile_id(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
) -> String {
    let metadata = crate::session_management::read_codex_provider_bindings(
        state.storage_path.as_path(),
        workspace_id,
    )
    .unwrap_or_default();
    codex_provider_binding_lookup_keys(workspace_id, thread_id)
        .into_iter()
        .find_map(|key| metadata.get(&key).cloned())
        .map(|binding| binding.provider_profile_id.clone())
        .unwrap_or_else(|| CODEX_DISK_PROVIDER_PROFILE_ID.to_string())
}

pub(crate) fn codex_provider_binding_lookup_keys(
    workspace_id: &str,
    thread_id: &str,
) -> Vec<String> {
    let workspace_id = workspace_id.trim();
    let thread_id = thread_id.trim();
    let mut keys = Vec::new();
    if thread_id.is_empty() {
        return keys;
    }
    if !workspace_id.is_empty() {
        keys.push(format!("codex:{workspace_id}:{thread_id}"));
        keys.push(format!("codex::{workspace_id}::{thread_id}"));
    }
    keys.push(thread_id.to_string());
    if let Some(raw_thread_id) = thread_id.strip_prefix("codex:") {
        if !raw_thread_id.trim().is_empty() {
            keys.push(raw_thread_id.trim().to_string());
        }
    } else {
        keys.push(format!("codex:{thread_id}"));
    }
    let mut unique_keys = Vec::new();
    for key in keys {
        if !unique_keys.contains(&key) {
            unique_keys.push(key);
        }
    }
    unique_keys
}

pub(crate) async fn record_codex_provider_binding(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
    provider_profile_id: &str,
) {
    let binding = match resolve_codex_provider_profile(Some(provider_profile_id)) {
        Ok(profile) => profile.binding(),
        Err(_) => CodexProviderBinding::disk().unavailable(),
    };
    let _ = crate::session_management::record_codex_provider_binding_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id.to_string(),
        thread_id.to_string(),
        binding,
    )
    .await;
}

pub(crate) async fn record_codex_provider_binding_checked(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
    provider_profile_id: &str,
) -> Result<(), String> {
    let binding = resolve_codex_provider_profile(Some(provider_profile_id))?.binding();
    crate::session_management::record_codex_provider_binding_core(
        &state.workspaces,
        state.storage_path.as_path(),
        workspace_id.to_string(),
        thread_id.to_string(),
        binding,
    )
    .await
}

const DELETE_ARCHIVE_TIMEOUT_MS: u64 = 2_000;

#[tauri::command]
pub(crate) async fn start_thread(
    workspace_id: String,
    auto_session: Option<crate::session_management::AutoSessionMetadata>,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "start_thread",
            json!({
                "workspaceId": workspace_id,
                "autoSession": auto_session,
                "providerProfileId": provider_profile_id
            }),
        )
        .await;
    }

    let normalized_provider_profile_id =
        codex_core::normalize_provider_profile_id(provider_profile_id.as_deref());
    let resolved_model = resolve_provider_scoped_fallback_model(
        &state,
        &workspace_id,
        &normalized_provider_profile_id,
    )
    .await?;
    let response = start_thread_with_runtime_retry_for_provider(
        &workspace_id,
        resolved_model,
        Some(normalized_provider_profile_id.clone()),
        &state,
        &app,
    )
    .await?;
    if let Some(thread_id) = crate::shared::codex_core::extract_thread_id_from_response(&response) {
        record_codex_provider_binding(
            &state,
            &workspace_id,
            &thread_id,
            &normalized_provider_profile_id,
        )
        .await;
    }
    if let Some(metadata) = auto_session {
        if let Some(thread_id) =
            crate::shared::codex_core::extract_thread_id_from_response(&response)
        {
            let _ = crate::session_management::record_auto_session_metadata_core(
                &state.workspaces,
                state.storage_path.as_path(),
                workspace_id,
                thread_id,
                metadata,
            )
            .await;
        }
    }
    Ok(response)
}

#[tauri::command]
pub(crate) async fn resume_thread(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "resume_thread",
            json!({ "workspaceId": workspace_id, "threadId": thread_id }),
        )
        .await;
    }

    // Ensure Codex session exists before resuming thread
    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;

    codex_core::resume_thread_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
        thread_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn fork_thread(
    workspace_id: String,
    thread_id: String,
    message_id: Option<String>,
    provider_profile_id: Option<String>,
    target_user_turn_index: Option<u32>,
    target_user_message_text: Option<String>,
    target_user_message_occurrence: Option<u32>,
    local_user_message_count: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "fork_thread",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "messageId": message_id,
                "providerProfileId": provider_profile_id,
                "targetUserTurnIndex": target_user_turn_index,
                "targetUserMessageText": target_user_message_text,
                "targetUserMessageOccurrence": target_user_message_occurrence,
                "localUserMessageCount": local_user_message_count
            }),
        )
        .await;
    }

    let parent_provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    let selected_provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| parent_provider_profile_id.clone());
    let _selected_provider_profile =
        resolve_codex_provider_profile(Some(&selected_provider_profile_id))?;
    if selected_provider_profile_id != parent_provider_profile_id {
        return Err(
            "cross-provider-fork-moved-to-continuation: use 使用其他 Provider 继续".to_string(),
        );
    }
    ensure_codex_session_for_provider(&workspace_id, &parent_provider_profile_id, &state, &app)
        .await?;
    let resolved_message_id = rewind::resolve_fork_message_id(
        &state.sessions,
        workspace_id.clone(),
        thread_id.clone(),
        message_id,
        target_user_turn_index,
        target_user_message_text,
        target_user_message_occurrence,
        local_user_message_count,
        Some(parent_provider_profile_id.clone()),
    )
    .await?;
    let response = codex_core::fork_thread_core(
        &state.sessions,
        workspace_id.clone(),
        Some(parent_provider_profile_id.clone()),
        thread_id.clone(),
        resolved_message_id,
    )
    .await?;
    if let Some(child_thread_id) =
        crate::shared::codex_core::extract_thread_id_from_response(&response)
    {
        record_codex_provider_binding(
            &state,
            &workspace_id,
            &child_thread_id,
            &selected_provider_profile_id,
        )
        .await;
        return Ok(response);
    }
    Ok(response)
}

#[tauri::command]
pub(crate) async fn rewind_codex_thread(
    workspace_id: String,
    thread_id: String,
    message_id: Option<String>,
    target_user_turn_index: u32,
    target_user_message_text: Option<String>,
    target_user_message_occurrence: Option<u32>,
    local_user_message_count: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "rewind_codex_thread",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "messageId": message_id,
                "targetUserTurnIndex": target_user_turn_index,
                "targetUserMessageText": target_user_message_text,
                "targetUserMessageOccurrence": target_user_message_occurrence,
                "localUserMessageCount": local_user_message_count
            }),
        )
        .await;
    }

    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    let rewind_response = rewind::rewind_thread_from_message(
        &state.sessions,
        &state.workspaces,
        workspace_id.clone(),
        Some(provider_profile_id.clone()),
        thread_id,
        message_id,
        target_user_turn_index,
        target_user_message_text,
        target_user_message_occurrence,
        local_user_message_count,
    )
    .await?;

    let rewound_thread_id = rewind_response
        .get("thread")
        .and_then(|thread| thread.get("id"))
        .or_else(|| rewind_response.get("threadId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "codex rewind response missing child thread id".to_string())?;

    record_codex_provider_binding(
        &state,
        &workspace_id,
        &rewound_thread_id,
        &provider_profile_id,
    )
    .await;

    if provider_profile_id == CODEX_DISK_PROVIDER_PROFILE_ID {
        disconnect_workspace_session_core(
            &state.sessions,
            Some(&state.runtime_manager),
            &workspace_id,
        )
        .await;
        ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app)
            .await?;
    }
    codex_core::resume_thread_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
        rewound_thread_id,
    )
    .await?;

    Ok(rewind_response)
}

#[tauri::command]
pub(crate) async fn list_threads(
    workspace_id: String,
    cursor: Option<String>,
    limit: Option<u32>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "list_threads",
            json!({ "workspaceId": workspace_id, "cursor": cursor, "limit": limit }),
        )
        .await;
    }

    let has_session = {
        let sessions = state.sessions.lock().await;
        sessions.contains_key(&workspace_id)
    };
    build_unified_codex_thread_page(&state, &workspace_id, cursor, limit, has_session).await
}

#[tauri::command]
pub(crate) async fn delete_codex_session(
    workspace_id: String,
    session_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "delete_codex_session",
            json!({ "workspaceId": workspace_id, "sessionId": session_id }),
        )
        .await;
    }

    let normalized_session_id = session_id.trim().to_string();
    if normalized_session_id.is_empty() {
        return Err("session_id is required".to_string());
    }
    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &normalized_session_id).await;

    let archive_result = codex_core::archive_thread_best_effort_core(
        &state.sessions,
        workspace_id.clone(),
        Some(provider_profile_id.clone()),
        normalized_session_id.clone(),
        Duration::from_millis(DELETE_ARCHIVE_TIMEOUT_MS),
    )
    .await;
    if let Err(error) = &archive_result {
        log::debug!(
            "[delete_codex_session] Best-effort archive skipped for workspace {} session {}: {}",
            workspace_id,
            normalized_session_id,
            error
        );
    }

    let deleted_count = local_usage::delete_codex_session_for_workspace(
        &state.workspaces,
        &workspace_id,
        &normalized_session_id,
    )
    .await?;

    let session = {
        let sessions = state.sessions.lock().await;
        let session_key =
            codex_core::session_key_for_provider(&workspace_id, Some(&provider_profile_id));
        sessions.get(&session_key).cloned()
    };
    if let Some(session) = session {
        session
            .clear_thread_effective_mode(&normalized_session_id)
            .await;
    }

    Ok(json!({
        "deleted": deleted_count > 0,
        "deletedCount": deleted_count,
        "method": "filesystem",
        "archivedBeforeDelete": archive_result.is_ok(),
    }))
}

#[tauri::command]
pub(crate) async fn delete_codex_sessions(
    workspace_id: String,
    session_ids: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "delete_codex_sessions",
            json!({ "workspaceId": workspace_id, "sessionIds": session_ids }),
        )
        .await;
    }

    let normalized_session_ids = session_ids
        .into_iter()
        .map(|session_id| session_id.trim().to_string())
        .filter(|session_id| !session_id.is_empty())
        .collect::<Vec<_>>();
    if normalized_session_ids.is_empty() {
        return Ok(json!({ "results": [] }));
    }

    for session_id in &normalized_session_ids {
        if session_id.contains('/') || session_id.contains('\\') || session_id.contains("..") {
            return Err("invalid session_id".to_string());
        }
    }

    let mut archive_results = HashMap::new();
    for session_id in &normalized_session_ids {
        let provider_profile_id =
            resolve_thread_provider_profile_id(&state, &workspace_id, session_id).await;
        let archive_result = codex_core::archive_thread_best_effort_core(
            &state.sessions,
            workspace_id.clone(),
            Some(provider_profile_id),
            session_id.clone(),
            Duration::from_millis(DELETE_ARCHIVE_TIMEOUT_MS),
        )
        .await;
        if let Err(error) = &archive_result {
            log::debug!(
                "[delete_codex_sessions] Best-effort archive skipped for workspace {} session {}: {}",
                workspace_id,
                session_id,
                error
            );
        }
        archive_results.insert(session_id.clone(), archive_result.is_ok());
    }

    let delete_results = local_usage::delete_codex_sessions_for_workspace(
        &state.workspaces,
        &workspace_id,
        &normalized_session_ids,
    )
    .await?;

    for result in &delete_results {
        if result.deleted {
            let provider_profile_id =
                resolve_thread_provider_profile_id(&state, &workspace_id, &result.session_id).await;
            let session = {
                let sessions = state.sessions.lock().await;
                let session_key =
                    codex_core::session_key_for_provider(&workspace_id, Some(&provider_profile_id));
                sessions.get(&session_key).cloned()
            };
            if let Some(session) = session {
                session
                    .clear_thread_effective_mode(&result.session_id)
                    .await;
            }
        }
    }

    let serialized_results = delete_results
        .into_iter()
        .map(|result| {
            json!({
                "sessionId": result.session_id,
                "deleted": result.deleted,
                "deletedCount": result.deleted_count,
                "method": "filesystem",
                "archivedBeforeDelete": archive_results
                    .get(&result.session_id)
                    .copied()
                    .unwrap_or(false),
                "error": result.error,
            })
        })
        .collect::<Vec<_>>();

    Ok(json!({ "results": serialized_results }))
}
