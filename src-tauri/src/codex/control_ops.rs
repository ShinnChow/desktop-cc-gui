use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use super::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID;
use super::session_runtime::ensure_codex_session_for_provider;
use super::thread_lifecycle::resolve_thread_provider_profile_id;
use crate::backend::events::AppServerEvent;
use crate::engine::{EngineType, SendMessageParams};
use crate::remote_backend;
use crate::shared::codex_core;
use crate::state::AppState;

fn emit_manual_compaction_event(
    app: &AppHandle,
    workspace_id: String,
    method: &str,
    params: Value,
) {
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id,
            message: json!({
                "method": method,
                "params": params,
            }),
        },
    );
}

async fn compact_claude_thread(
    workspace_id: String,
    thread_id: String,
    provider_profile_id_override: Option<String>,
    state: &AppState,
    app: &AppHandle,
) -> Result<Value, String> {
    let session_id = thread_id
        .strip_prefix("claude:")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("Claude thread id is invalid: {thread_id}"))?
        .to_string();

    let workspace_entry = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .cloned()
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let workspace_path = PathBuf::from(&workspace_entry.path);
    let provider_profile_id = match provider_profile_id_override {
        Some(provider_profile_id) => Some(provider_profile_id),
        None => crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            Some(&session_id),
            "claude",
            None,
        )?,
    };
    let provider_launch_profile = crate::engine::claude::resolve_claude_provider_launch_profile(
        provider_profile_id.as_deref(),
    )?;
    let session = state
        .engine_manager
        .get_claude_session_for_provider(
            &workspace_id,
            &workspace_path,
            provider_profile_id.as_deref(),
        )
        .await;

    emit_manual_compaction_event(
        app,
        workspace_id.clone(),
        "thread/compacting",
        json!({
            "threadId": &thread_id,
            "thread_id": &thread_id,
            "auto": false,
            "manual": true,
        }),
    );

    let turn_id = format!("claude-compact-{}", uuid::Uuid::new_v4());
    let params = SendMessageParams {
        text: "/compact".to_string(),
        images: None,
        continue_session: true,
        session_id: Some(session_id),
        ..Default::default()
    };

    // No outer wall-clock cap: /compact is an LLM summarization over the whole
    // conversation and legitimately takes minutes on a large context. send_message
    // already has a 90s first-event watchdog (claude.rs) guarding a true hang, and
    // the auto-compact path (lifecycle.rs) runs uncapped too — matching it here.
    let app_settings = state.app_settings.lock().await.clone();
    let compact_result = session
        .send_message_with_app_settings_and_provider_env(
            params,
            &turn_id,
            Some(&app_settings),
            provider_launch_profile.as_ref().map(|profile| &profile.env),
        )
        .await;

    match compact_result {
        Ok(result_text) => {
            emit_manual_compaction_event(
                app,
                workspace_id,
                "thread/compacted",
                json!({
                    "threadId": &thread_id,
                    "thread_id": &thread_id,
                    "turnId": &turn_id,
                    "turn_id": &turn_id,
                    "auto": false,
                    "manual": true,
                }),
            );
            Ok(json!({
                "threadId": &thread_id,
                "turnId": &turn_id,
                "text": result_text,
                "status": "completed",
                "engine": "claude",
            }))
        }
        Err(error) => {
            emit_manual_compaction_event(
                app,
                workspace_id,
                "thread/compactionFailed",
                json!({
                    "threadId": &thread_id,
                    "thread_id": &thread_id,
                    "auto": false,
                    "manual": true,
                    "reason": error,
                }),
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn turn_interrupt(
    workspace_id: String,
    thread_id: String,
    turn_id: String,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    // B.5：Shared Thread owner 路由显式携带的 provider 优先；缺省时保持旧解析行为。
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "turn_interrupt",
            json!({ "workspaceId": workspace_id, "threadId": thread_id, "turnId": turn_id, "providerProfileId": provider_profile_id }),
        )
        .await;
    }

    let provider_profile_id = match provider_profile_id {
        Some(provider) => provider,
        None => resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await,
    };
    codex_core::turn_interrupt_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
        thread_id,
        turn_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn thread_compact(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let mut normalized_thread_id = thread_id.trim().to_string();
    if normalized_thread_id.is_empty() {
        return Err("thread_id is required".to_string());
    }

    let shared_route = if normalized_thread_id.starts_with("shared:") {
        let route = crate::shared_session_v2::resolve_shared_compaction_route(
            &state,
            &workspace_id,
            &normalized_thread_id,
        )?;
        if route.has_unresolved_attempt {
            return Err(
                "shared-compaction-busy: Shared Attempt is still active or unresolved".to_string(),
            );
        }
        Some(route)
    } else {
        None
    };

    if remote_backend::is_remote_mode(&*state).await {
        if let Some(route) = shared_route.as_ref() {
            match route.engine {
                EngineType::Codex => {
                    let provider_profile_id = route
                        .provider_profile_id
                        .as_deref()
                        .unwrap_or(CODEX_DISK_PROVIDER_PROFILE_ID);
                    if provider_profile_id != CODEX_DISK_PROVIDER_PROFILE_ID {
                        return Err(format!(
                            "shared-compaction-provider-unavailable: remote daemon cannot compact Codex provider {provider_profile_id}"
                        ));
                    }
                }
                EngineType::Claude => {
                    let provider_profile_id = route
                        .provider_profile_id
                        .as_deref()
                        .unwrap_or(crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID);
                    if provider_profile_id
                        != crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID
                    {
                        return Err(format!(
                            "shared-compaction-provider-unavailable: remote daemon cannot compact Claude provider {provider_profile_id}"
                        ));
                    }
                }
                engine => {
                    return Err(format!(
                        "shared-compaction-unsupported: {} does not support context compaction",
                        engine.icon()
                    ));
                }
            }
            normalized_thread_id = route.native_thread_id.clone();
        }
        return remote_backend::call_remote(
            &*state,
            app,
            "thread_compact",
            json!({ "workspaceId": workspace_id, "threadId": normalized_thread_id }),
        )
        .await;
    }

    let mut shared_codex_provider_profile_id = None;
    if let Some(route) = shared_route {
        match route.engine {
            EngineType::Codex => {
                normalized_thread_id = route.native_thread_id;
                shared_codex_provider_profile_id = Some(
                    route
                        .provider_profile_id
                        .unwrap_or_else(|| CODEX_DISK_PROVIDER_PROFILE_ID.to_string()),
                );
            }
            EngineType::Claude => {
                let provider_profile_id = Some(route.provider_profile_id.unwrap_or_else(|| {
                    crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID.to_string()
                }));
                return compact_claude_thread(
                    workspace_id,
                    route.native_thread_id,
                    provider_profile_id,
                    &state,
                    &app,
                )
                .await;
            }
            engine => {
                return Err(format!(
                    "shared-compaction-unsupported: {} does not support context compaction",
                    engine.icon()
                ));
            }
        }
    } else if normalized_thread_id.starts_with("claude:") {
        return compact_claude_thread(workspace_id, normalized_thread_id, None, &state, &app).await;
    }

    let provider_profile_id = match shared_codex_provider_profile_id {
        Some(provider_profile_id) => provider_profile_id,
        None => {
            resolve_thread_provider_profile_id(&state, &workspace_id, &normalized_thread_id).await
        }
    };
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "thread/compacting",
                "params": {
                    "threadId": normalized_thread_id,
                    "thread_id": normalized_thread_id,
                    "auto": false,
                    "manual": true
                }
            }),
        },
    );

    match codex_core::thread_compact_core(
        &state.sessions,
        workspace_id.clone(),
        Some(provider_profile_id),
        normalized_thread_id.clone(),
    )
    .await
    {
        Ok(result) => Ok(result),
        Err(error) => {
            let _ = app.emit(
                "app-server-event",
                AppServerEvent {
                    workspace_id,
                    message: json!({
                        "method": "thread/compactionFailed",
                        "params": {
                            "threadId": normalized_thread_id,
                            "thread_id": normalized_thread_id,
                            "auto": false,
                            "manual": true,
                            "reason": error
                        }
                    }),
                },
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub(crate) async fn start_review(
    workspace_id: String,
    thread_id: String,
    target: Value,
    delivery: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "start_review",
            json!({
                "workspaceId": workspace_id,
                "threadId": thread_id,
                "target": target,
                "delivery": delivery,
            }),
        )
        .await;
    }

    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    codex_core::start_review_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
        thread_id,
        target,
        delivery,
    )
    .await
}
