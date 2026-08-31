use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager, State};

pub(crate) mod args;
pub(crate) mod collaboration_policy;
mod commit_message;
mod commit_message_gen;
pub(crate) mod config;
mod control_ops;
mod doctor;
mod doctor_family;
pub(crate) mod home;
pub(crate) mod provider_env;
mod installer;
pub(crate) mod launch_profile;
mod mcp_config;
mod model_selection;
mod provider_fork;
pub(crate) mod provider_profile;
pub(crate) mod rewind;
mod run_metadata;
mod session_runtime;
mod shared_control;
mod start_thread_retry;
mod thread_lifecycle;
mod thread_listing;
pub(crate) mod thread_mode_state;
mod title_metadata;

pub(crate) use self::commit_message_gen::*;
pub(crate) use self::control_ops::*;
pub(crate) use self::doctor_family::*;
pub(crate) use self::shared_control::*;
pub(crate) use self::thread_lifecycle::*;
pub(crate) use self::title_metadata::*;
use self::args::resolve_workspace_codex_args;
pub(crate) use self::doctor::{
    dsh_node_requirement_error, node_satisfies_dsh_requirement, run_claude_doctor_with_settings,
    run_codex_doctor_with_settings, run_dsh_doctor_with_settings, run_grok_doctor_with_settings,
    run_kimi_doctor_with_settings, run_opencode_doctor_with_settings, run_pi_doctor_with_settings,
    run_qoder_doctor_for_profile_with_settings, run_qoder_doctor_with_settings,
};
pub(crate) use self::home::{resolve_default_codex_home, resolve_workspace_codex_home};
pub(crate) use self::installer::{
    build_cli_install_plan_with_backend, resolve_cli_version_status,
    run_cli_installer_with_progress, CliInstallAction, CliInstallBackend, CliInstallEngine,
    CliInstallProgressEvent, CliInstallStrategy,
};
use self::mcp_config::{
    list_global_mcp_servers as list_global_mcp_servers_impl,
    set_global_mcp_server_enabled as set_global_mcp_server_enabled_impl, GlobalMcpServerEntry,
};
use self::model_selection::{normalize_model_id, pick_model_from_model_list_response};

use self::thread_listing::resolve_provider_scoped_fallback_model;
use crate::backend::app_server::{
    spawn_workspace_session_inner_with_settings, CodexAppServerLaunchOptions,
};
pub(crate) use crate::backend::app_server::{ResumePendingSource, WorkspaceSession};
use crate::backend::events::AppServerEvent;
use crate::event_sink::build_event_sink;
use crate::remote_backend;
use crate::shared::codex_core;
use crate::state::AppState;
use crate::types::{AppSettings, WorkspaceEntry};

fn codex_turn_developer_instructions(settings: &AppSettings) -> Option<String> {
    crate::backend::app_server_cli::codex_generated_developer_instructions_for_turn(settings)
}

pub(crate) use self::session_runtime::ensure_codex_session;
pub(crate) use self::session_runtime::{
    attach_hook_safe_fallback_metadata, create_session_runtime_recovering_error,
    ensure_codex_session_for_provider, ensure_codex_session_without_session_hooks_for_provider,
    is_create_session_runtime_recovery_error, is_hook_safe_fallback_trigger,
};
pub(crate) use self::start_thread_retry::start_thread_with_runtime_retry_for_provider;
#[cfg(test)]
use self::start_thread_retry::{
    run_start_thread_with_hook_safe_fallback,
    run_start_thread_with_hook_safe_fallback_and_recovery_probe, run_start_thread_with_retry,
    run_start_thread_with_retry_and_recovery_probe,
};

pub(crate) async fn spawn_workspace_session(
    entry: WorkspaceEntry,
    default_codex_bin: Option<String>,
    codex_args: Option<String>,
    app_handle: AppHandle,
    codex_home: Option<PathBuf>,
) -> Result<Arc<WorkspaceSession>, String> {
    let provider_runtime_key = crate::codex::provider_profile::legacy_codex_runtime_key(&entry.id);
    spawn_workspace_session_with_launch_options(
        entry,
        default_codex_bin,
        codex_args,
        app_handle,
        codex_home,
        provider_runtime_key,
        CodexAppServerLaunchOptions::primary(),
    )
    .await
}

pub(crate) async fn spawn_workspace_session_with_launch_options(
    entry: WorkspaceEntry,
    default_codex_bin: Option<String>,
    codex_args: Option<String>,
    app_handle: AppHandle,
    codex_home: Option<PathBuf>,
    provider_runtime_key: String,
    launch_options: CodexAppServerLaunchOptions,
) -> Result<Arc<WorkspaceSession>, String> {
    let client_version = app_handle.package_info().version.to_string();
    let app_settings_snapshot = {
        let state = app_handle.state::<AppState>();
        let settings = state.app_settings.lock().await.clone();
        settings
    };
    let (auto_compaction_threshold_percent, auto_compaction_enabled) = (
        f64::from(app_settings_snapshot.codex_auto_compaction_threshold_percent),
        app_settings_snapshot.codex_auto_compaction_enabled,
    );
    let event_sink = build_event_sink(app_handle);
    // Box 到堆，避免 spawn 深链内联出超大栈帧（Windows 主线程默认仅 1MB）。
    Box::pin(spawn_workspace_session_inner_with_settings(
        entry,
        default_codex_bin,
        codex_args,
        codex_home,
        client_version,
        auto_compaction_threshold_percent,
        auto_compaction_enabled,
        event_sink,
        launch_options,
        provider_runtime_key,
        app_settings_snapshot,
    ))
    .await
}

#[tauri::command]
pub(crate) async fn list_global_mcp_servers() -> Result<Vec<GlobalMcpServerEntry>, String> {
    list_global_mcp_servers_impl().await
}

#[tauri::command]
pub(crate) async fn set_global_mcp_server_enabled(
    name: String,
    source: String,
    enabled: bool,
) -> Result<(), String> {
    set_global_mcp_server_enabled_impl(name, source, enabled).await
}

#[tauri::command]
pub(crate) async fn list_mcp_server_status(
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
            "list_mcp_server_status",
            json!({ "workspaceId": workspace_id, "cursor": cursor, "limit": limit }),
        )
        .await;
    }

    codex_core::list_mcp_server_status_core(&state.sessions, workspace_id, None, cursor, limit)
        .await
}

#[tauri::command]
pub(crate) async fn send_user_message(
    workspace_id: String,
    thread_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    collaboration_mode: Option<Value>,
    preferred_language: Option<String>,
    custom_spec_root: Option<String>,
    resume_source: Option<String>,
    resume_turn_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let normalized_model = normalize_model_id(model);
    let selected_mode = collaboration_mode
        .as_ref()
        .and_then(|value| {
            if let Some(text) = value.as_str() {
                return Some(text.to_string());
            }
            value
                .as_object()
                .and_then(|object| object.get("mode").or_else(|| object.get("id")))
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .map(|mode| {
            let normalized = mode.trim().to_lowercase();
            if normalized == "default" {
                "code".to_string()
            } else {
                normalized
            }
        })
        .filter(|mode| mode == "plan" || mode == "code");

    if remote_backend::is_remote_mode(&*state).await {
        let images = images.map(|paths| {
            paths
                .into_iter()
                .map(remote_backend::normalize_path_for_remote)
                .collect::<Vec<_>>()
        });
        let mut payload = Map::new();
        payload.insert("workspaceId".to_string(), json!(workspace_id));
        payload.insert("threadId".to_string(), json!(thread_id));
        payload.insert("text".to_string(), json!(text));
        payload.insert("model".to_string(), json!(normalized_model));
        payload.insert("effort".to_string(), json!(effort));
        payload.insert("accessMode".to_string(), json!(access_mode));
        payload.insert("images".to_string(), json!(images));
        payload.insert("preferredLanguage".to_string(), json!(preferred_language));
        payload.insert("resumeSource".to_string(), json!(resume_source));
        payload.insert("resumeTurnId".to_string(), json!(resume_turn_id));
        if let Some(spec_root) = custom_spec_root.clone() {
            if !spec_root.trim().is_empty() {
                payload.insert("customSpecRoot".to_string(), json!(spec_root));
            }
        }
        if let Some(mode) = collaboration_mode {
            if !mode.is_null() {
                payload.insert("collaborationMode".to_string(), mode);
            }
        }
        return remote_backend::call_remote(
            &*state,
            app,
            "send_user_message",
            Value::Object(payload),
        )
        .await;
    }

    let provider_profile_id =
        resolve_thread_provider_profile_id(&state, &workspace_id, &thread_id).await;
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    let effective_model = if normalized_model.is_some() {
        normalized_model
    } else {
        resolve_provider_scoped_fallback_model(&state, &workspace_id, &provider_profile_id).await?
    };
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
        Some(provider_profile_id.clone()),
        thread_id.clone(),
        text,
        effective_model,
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

    if resume_source.as_deref() == Some("queue-fusion-cutover") {
        let session = {
            let sessions = state.sessions.lock().await;
            let session_key =
                codex_core::session_key_for_provider(&workspace_id, Some(&provider_profile_id));
            sessions.get(&session_key).cloned()
        };
        if let Some(session) = session {
            session
                .start_resume_pending_watch(
                    app.clone(),
                    thread_id.clone(),
                    None,
                    ResumePendingSource::QueueFusionCutover {
                        previous_turn_id: resume_turn_id
                            .map(|value| value.trim().to_string())
                            .filter(|value| !value.is_empty()),
                    },
                )
                .await;
        }
    }

    let session = {
        let sessions = state.sessions.lock().await;
        let session_key =
            codex_core::session_key_for_provider(&workspace_id, Some(&provider_profile_id));
        sessions.get(&session_key).cloned()
    };
    let (effective_runtime_mode, fallback_reason) = if let Some(session) = session {
        let runtime_mode = session
            .get_thread_effective_mode(&thread_id)
            .await
            .unwrap_or_else(|| "code".to_string());
        let fallback_reason = if selected_mode.is_some() && !session.collaboration_mode_supported()
        {
            Some("collaboration_mode_capability_unsupported_prompt_fallback")
        } else {
            None
        };
        (runtime_mode, fallback_reason)
    } else {
        ("code".to_string(), None)
    };
    let effective_ui_mode = if effective_runtime_mode == "plan" {
        "plan"
    } else {
        "default"
    };
    let selected_ui_mode = match selected_mode.as_deref() {
        Some("plan") => "plan",
        Some("code") => "default",
        _ => effective_ui_mode,
    };
    let _ = app.emit(
        "app-server-event",
        AppServerEvent {
            workspace_id: workspace_id.clone(),
            message: json!({
                "method": "collaboration/modeResolved",
                "params": {
                    "threadId": thread_id.clone(),
                    "thread_id": thread_id,
                    "selectedUiMode": selected_ui_mode,
                    "selected_ui_mode": selected_ui_mode,
                    "effectiveRuntimeMode": effective_runtime_mode.clone(),
                    "effective_runtime_mode": effective_runtime_mode,
                    "effectiveUiMode": effective_ui_mode,
                    "effective_ui_mode": effective_ui_mode,
                    "fallbackReason": fallback_reason,
                    "fallback_reason": fallback_reason
                }
            }),
        },
    );

    Ok(response)
}

#[tauri::command]
pub(crate) async fn collaboration_mode_list(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "collaboration_mode_list",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    match codex_core::collaboration_mode_list_core(&state.sessions, workspace_id.clone()).await {
        Ok(response) => Ok(response),
        Err(error) if error == "workspace not connected" => {
            log::debug!(
                "[codex:collaboration_mode_list] passive collaborationMode/list skipped runtime acquisition for {}: {}",
                workspace_id,
                error
            );
            Ok(json!({
                "data": [],
                "degraded": true,
                "runtimeAvailable": false,
                "reason": "workspace not connected",
            }))
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn model_list(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "model_list",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    match codex_core::model_list_core(&state.sessions, workspace_id.clone()).await {
        Ok(response) => Ok(response),
        Err(error) if error == "workspace not connected" => {
            log::debug!(
                "[codex:model_list] passive model/list skipped runtime acquisition for {}: {}",
                workspace_id,
                error
            );
            Ok(json!({
                "data": [],
                "degraded": true,
                "runtimeAvailable": false,
                "reason": "workspace not connected",
            }))
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn discover_codex_models(
    workspace_id: String,
    provider_profile_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "discover_codex_models",
            json!({
                "workspaceId": workspace_id,
                "providerProfileId": provider_profile_id,
            }),
        )
        .await;
    }

    let provider_profile_id =
        codex_core::normalize_provider_profile_id(provider_profile_id.as_deref());
    ensure_codex_session_for_provider(&workspace_id, &provider_profile_id, &state, &app).await?;
    codex_core::model_list_for_provider_core(
        &state.sessions,
        workspace_id,
        Some(provider_profile_id),
    )
    .await
}

#[tauri::command]
pub(crate) async fn account_rate_limits(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "account_rate_limits",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    match codex_core::account_rate_limits_core(&state.sessions, workspace_id.clone()).await {
        Ok(response) => Ok(response),
        Err(error) if error == "workspace not connected" => {
            log::debug!(
                "[codex:account_rate_limits] passive account/rateLimits read skipped runtime acquisition for {}: {}",
                workspace_id,
                error
            );
            Ok(json!({
                "rateLimits": null,
                "degraded": true,
                "runtimeAvailable": false,
                "reason": "workspace not connected",
            }))
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub(crate) async fn account_read(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "account_read",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::account_read_core(&state.sessions, &state.workspaces, workspace_id).await
}

#[tauri::command]
pub(crate) async fn codex_login(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_login",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::codex_login_core(
        &state.workspaces,
        &state.app_settings,
        &state.codex_login_cancels,
        workspace_id,
    )
    .await
}

#[tauri::command]
pub(crate) async fn codex_login_cancel(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_login_cancel",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::codex_login_cancel_core(&state.codex_login_cancels, workspace_id).await
}

#[tauri::command]
pub(crate) async fn skills_list(
    workspace_id: String,
    custom_skill_roots: Option<Vec<String>>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let custom_skill_roots_for_remote = custom_skill_roots.clone().unwrap_or_default();
        return remote_backend::call_remote(
            &*state,
            app,
            "skills_list",
            json!({
                "workspaceId": workspace_id,
                "customSkillRoots": custom_skill_roots_for_remote,
            }),
        )
        .await;
    }

    // Local mode: try local file scanning first
    let custom_skill_roots_vec = custom_skill_roots.unwrap_or_default();
    let resource_dir = app.path().resource_dir().ok();
    match crate::skills::skills_list_local_for_workspace(
        &*state,
        &workspace_id,
        custom_skill_roots_vec.clone(),
        resource_dir,
    )
    .await
    {
        Ok(entries) => {
            let skills_json: Vec<Value> = entries
                .into_iter()
                .map(crate::skills::skill_entry_to_json)
                .collect();
            Ok(json!(skills_json))
        }
        Err(crate::skills::SkillScanError::WorkspaceNotFound(_)) => {
            Err("workspace not found".to_string())
        }
        Err(err) => {
            log::warn!(
                "Local skills scan failed for workspace {}: {}, falling back to Codex CLI",
                workspace_id,
                err
            );
            codex_core::skills_list_core(&state.sessions, workspace_id, custom_skill_roots_vec)
                .await
        }
    }
}

#[tauri::command]
pub(crate) async fn remember_approval_rule(
    workspace_id: String,
    command: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    codex_core::remember_approval_rule_core(&state.workspaces, workspace_id, command).await
}

#[tauri::command]
pub(crate) async fn get_config_model(
    workspace_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "get_config_model",
            json!({ "workspaceId": workspace_id }),
        )
        .await;
    }

    codex_core::get_config_model_core(&state.workspaces, workspace_id).await
}

#[cfg(test)]
#[path = "codex_tests.rs"]
mod tests;
