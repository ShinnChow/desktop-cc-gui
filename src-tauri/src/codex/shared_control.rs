use serde_json::{json, Value};
use tauri::{AppHandle, State};

use crate::backend::app_server::ResumePendingSource;
use crate::engine::EngineType;
use crate::remote_backend;
use crate::shared::codex_core;
use crate::state::AppState;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedControlResponseRoute {
    pub(crate) workspace_id: String,
    pub(crate) engine: EngineType,
    pub(crate) provider_runtime_key: String,
    pub(crate) provider_profile_id: Option<String>,
    pub(crate) native_thread_id: String,
    pub(crate) runtime_turn_id: String,
}

fn normalize_control_identity(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

pub(crate) fn resolve_shared_control_response_route(
    coordinator: &crate::shared_runtime_coordinator::SharedRuntimeCoordinator,
    workspace_id: &str,
    shared_attempt_id: Option<&str>,
    shared_thread_id: Option<&str>,
    provider_runtime_key: Option<&str>,
    provider_profile_id: Option<&str>,
    native_thread_id: Option<&str>,
    runtime_turn_id: Option<&str>,
) -> Result<Option<SharedControlResponseRoute>, String> {
    let has_shared_identity =
        shared_attempt_id.is_some() || shared_thread_id.is_some() || provider_runtime_key.is_some();
    if !has_shared_identity {
        if normalize_control_identity(native_thread_id)
            .as_deref()
            .is_some_and(|thread_id| thread_id.starts_with("shared:"))
        {
            return Err("shared control response is missing its Runtime owner".to_string());
        }
        return Ok(None);
    }
    let attempt_id = normalize_control_identity(shared_attempt_id)
        .ok_or_else(|| "shared control response is missing attemptId".to_string())?;
    let shared_thread_id = normalize_control_identity(shared_thread_id)
        .ok_or_else(|| "shared control response is missing sharedThreadId".to_string())?;
    let provider_runtime_key = normalize_control_identity(provider_runtime_key)
        .ok_or_else(|| "shared control response is missing providerRuntimeKey".to_string())?;
    let native_thread_id = normalize_control_identity(native_thread_id)
        .ok_or_else(|| "shared control response is missing nativeThreadId".to_string())?;
    let runtime_turn_id = normalize_control_identity(runtime_turn_id)
        .ok_or_else(|| "shared control response is missing runtimeTurnId".to_string())?;
    let owner = coordinator
        .owner_for_attempt(&attempt_id)
        .ok_or_else(|| format!("shared control response attempt is not owned: {attempt_id}"))?;
    if owner.workspace_id != workspace_id {
        return Err("shared control response workspace owner mismatch".to_string());
    }
    if owner.shared_thread_id != shared_thread_id {
        return Err("shared control response thread owner mismatch".to_string());
    }
    if owner.provider_runtime_key != provider_runtime_key {
        return Err("shared control response provider Runtime owner mismatch".to_string());
    }
    if owner.native_session_id.as_deref().map(str::trim) != Some(native_thread_id.as_str()) {
        return Err("shared control response native thread owner mismatch".to_string());
    }
    if owner.runtime_turn_id.as_deref() != Some(runtime_turn_id.as_str()) {
        return Err("shared control response Runtime turn owner mismatch".to_string());
    }
    let owner_provider_profile_id = normalize_control_identity(
        owner
            .execution_target_snapshot
            .provider_profile_id
            .as_deref(),
    );
    let provider_profile_id = normalize_control_identity(provider_profile_id);
    if owner_provider_profile_id != provider_profile_id {
        return Err("shared control response Provider Profile owner mismatch".to_string());
    }
    let expected_engine =
        crate::shared_sessions::ensure_supported_shared_session_engine(owner.engine)?.icon();
    if owner.execution_target_snapshot.engine.trim() != expected_engine {
        return Err("shared control response target engine owner mismatch".to_string());
    }
    let expected_runtime_key = crate::shared_session_v2::provider_runtime_key_for_target(
        workspace_id,
        owner.engine,
        owner_provider_profile_id.as_deref(),
    )?;
    if expected_runtime_key != provider_runtime_key {
        return Err("shared control response Provider Runtime key is not canonical".to_string());
    }
    Ok(Some(SharedControlResponseRoute {
        workspace_id: workspace_id.to_string(),
        engine: owner.engine,
        provider_runtime_key,
        provider_profile_id,
        native_thread_id,
        runtime_turn_id,
    }))
}

async fn respond_to_shared_control_request(
    state: &AppState,
    route: &SharedControlResponseRoute,
    request_id: Value,
    result: Value,
) -> Result<(), String> {
    match route.engine {
        EngineType::Claude => {
            let session = state
                .engine_manager
                .claude_manager
                .get_session_for_provider(&route.workspace_id, route.provider_profile_id.as_deref())
                .await
                .ok_or_else(|| {
                    format!(
                        "shared control response Runtime is not connected: {}",
                        route.provider_runtime_key
                    )
                })?;
            if result.get("answers").is_some() {
                if !session.has_pending_user_input(&request_id) {
                    return Err(
                        "shared control response request is not pending on its Claude Runtime"
                            .to_string(),
                    );
                }
                session.respond_to_user_input(request_id, result).await
            } else {
                if !session.has_pending_approval_request(&request_id) {
                    return Err(
                        "shared control response request is not pending on its Claude Runtime"
                            .to_string(),
                    );
                }
                session
                    .respond_to_approval_request(request_id, result)
                    .await
            }
        }
        EngineType::Codex => {
            codex_core::respond_to_server_request_for_runtime_core(
                &state.sessions,
                route.provider_runtime_key.clone(),
                request_id,
                result,
            )
            .await
        }
        _ => Err("shared control response owner uses an unsupported engine".to_string()),
    }
}

#[tauri::command]
pub(crate) async fn respond_to_server_request(
    workspace_id: String,
    request_id: Value,
    result: Value,
    thread_id: Option<String>,
    turn_id: Option<String>,
    provider_profile_id: Option<String>,
    shared_attempt_id: Option<String>,
    shared_thread_id: Option<String>,
    provider_runtime_key: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    let is_user_input_response = result.get("answers").is_some();
    let normalized_thread_id = normalize_control_identity(thread_id.as_deref());
    let normalized_turn_id = normalize_control_identity(turn_id.as_deref());
    let provider_profile_id = normalize_control_identity(provider_profile_id.as_deref());
    let is_local_plan_prompt = request_id
        .as_str()
        .map(|value| value.starts_with("ccgui-plan-"))
        .unwrap_or(false);
    let has_shared_identity =
        shared_attempt_id.is_some() || shared_thread_id.is_some() || provider_runtime_key.is_some();
    if remote_backend::is_remote_mode(&*state).await {
        if has_shared_identity {
            return Err(
                "Shared control responses are unavailable through the remote backend".to_string(),
            );
        }
        remote_backend::call_remote(
            &*state,
            app,
            "respond_to_server_request",
            json!({
                "workspaceId": workspace_id,
                "requestId": request_id,
                "result": result,
                "threadId": normalized_thread_id,
                "turnId": normalized_turn_id,
                "providerProfileId": provider_profile_id,
            }),
        )
        .await?;
        return Ok(());
    }

    let shared_route = resolve_shared_control_response_route(
        &state.shared_runtime_coordinator,
        &workspace_id,
        shared_attempt_id.as_deref(),
        shared_thread_id.as_deref(),
        provider_runtime_key.as_deref(),
        provider_profile_id.as_deref(),
        normalized_thread_id.as_deref(),
        normalized_turn_id.as_deref(),
    )?;
    if let Some(route) = shared_route.as_ref() {
        respond_to_shared_control_request(&state, route, request_id, result).await?;
        if is_user_input_response && route.engine == EngineType::Codex && !is_local_plan_prompt {
            let session = {
                let sessions = state.sessions.lock().await;
                sessions.get(&route.provider_runtime_key).cloned()
            };
            if let Some(session) = session {
                session
                    .start_resume_pending_watch(
                        app,
                        route.native_thread_id.clone(),
                        Some(route.runtime_turn_id.clone()),
                        ResumePendingSource::UserInputResume,
                    )
                    .await;
            }
        }
        return Ok(());
    }

    if let Some(dsh_request) = crate::engine::dsh::parse_control_request(&request_id) {
        let settings = state.app_settings.lock().await.clone();
        let runtime = crate::engine::dsh::runtime_settings_from_app(&settings);
        crate::engine::dsh::respond_to_control(&runtime, dsh_request, &result).await?;
        return Ok(());
    }

    // Native control request keeps the existing request-id routing contract.
    let claude_sessions_for_workspace = state
        .engine_manager
        .claude_manager
        .sessions_for_workspace(&workspace_id)
        .await;
    for session in &claude_sessions_for_workspace {
        if session.has_pending_user_input(&request_id) {
            return session.respond_to_user_input(request_id, result).await;
        }
        if session.has_pending_approval_request(&request_id) {
            return session
                .respond_to_approval_request(request_id, result)
                .await;
        }
    }

    // Late AskUserQuestion: no Claude session still has this ask-* pending.
    // Falling through to Codex only yields "workspace not connected".
    if let Some(ask_request_id) = expired_claude_ask_request_id(
        &request_id,
        !claude_sessions_for_workspace.is_empty(),
        is_user_input_response,
    ) {
        return Err(format!(
            "AskUserQuestion request {ask_request_id} already expired or was answered"
        ));
    }

    let codex_runtime_key =
        codex_core::session_key_for_provider(&workspace_id, provider_profile_id.as_deref());
    codex_core::respond_to_server_request_core(
        &state.sessions,
        workspace_id.clone(),
        provider_profile_id,
        request_id,
        result,
    )
    .await?;

    if is_user_input_response && !is_local_plan_prompt {
        if let Some(thread_id) = normalized_thread_id {
            let session = {
                let sessions = state.sessions.lock().await;
                sessions.get(&codex_runtime_key).cloned()
            };
            if let Some(session) = session {
                session
                    .start_resume_pending_watch(
                        app,
                        thread_id,
                        normalized_turn_id,
                        ResumePendingSource::UserInputResume,
                    )
                    .await;
            }
        }
    }

    Ok(())
}

/// Late Claude AskUserQuestion answer. All three conditions are load-bearing:
/// no Claude session → keep generic connectivity; approval must not match;
/// only `ask-` ids (not `ccgui-plan-blocker:`).
pub(crate) fn expired_claude_ask_request_id(
    request_id: &Value,
    has_claude_session: bool,
    is_user_input_response: bool,
) -> Option<&str> {
    if !has_claude_session || !is_user_input_response {
        return None;
    }
    request_id
        .as_str()
        .filter(|value| value.starts_with("ask-"))
}
