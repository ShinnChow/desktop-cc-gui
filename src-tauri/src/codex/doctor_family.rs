use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use super::doctor::{
    run_claude_doctor_with_settings, run_codex_doctor_with_settings, run_dsh_doctor_with_settings,
    run_grok_doctor_with_settings, run_kimi_doctor_with_settings,
    run_opencode_doctor_with_settings, run_pi_doctor_with_settings,
};
use super::{
    build_cli_install_plan_with_backend, resolve_cli_version_status,
    run_cli_installer_with_progress, run_qoder_doctor_for_profile_with_settings, CliInstallAction,
    CliInstallBackend, CliInstallEngine, CliInstallProgressEvent, CliInstallStrategy,
};
use super::launch_profile;
use crate::remote_backend;
use crate::state::AppState;

#[tauri::command]
pub(crate) async fn codex_doctor(
    codex_bin: Option<String>,
    codex_args: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let codex_bin = codex_bin.map(remote_backend::normalize_path_for_remote);
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_doctor",
            json!({ "codexBin": codex_bin, "codexArgs": codex_args }),
        )
        .await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_codex_doctor_with_settings(codex_bin, codex_args, &settings).await
}

#[tauri::command]
pub(crate) async fn codex_preview_launch_profile(
    codex_bin: Option<String>,
    codex_args: Option<String>,
    workspace_id: Option<String>,
    use_workspace_draft: Option<bool>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let codex_bin = codex_bin.map(remote_backend::normalize_path_for_remote);
        return remote_backend::call_remote(
            &*state,
            app,
            "codex_preview_launch_profile",
            json!({
                "codexBin": codex_bin,
                "codexArgs": codex_args,
                "workspaceId": workspace_id,
                "useWorkspaceDraft": use_workspace_draft.unwrap_or(false),
            }),
        )
        .await;
    }

    let settings = state.app_settings.lock().await.clone();
    if let Some(workspace_id) = workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let workspaces = state.workspaces.lock().await.clone();
        return launch_profile::preview_workspace_codex_launch_profile(
            workspace_id,
            codex_bin,
            codex_args,
            use_workspace_draft.unwrap_or(false),
            &workspaces,
            &settings,
        );
    }

    Ok(launch_profile::preview_global_codex_launch_profile(
        codex_bin, codex_args, &settings,
    ))
}

pub(crate) fn remote_claude_doctor_request(claude_bin: Option<String>) -> (&'static str, Value) {
    (
        "claude_doctor",
        json!({
            "claudeBin": claude_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

pub(crate) fn remote_kimi_doctor_request(kimi_bin: Option<String>) -> (&'static str, Value) {
    (
        "kimi_doctor",
        json!({
            "kimiBin": kimi_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

pub(crate) fn remote_grok_doctor_request(grok_bin: Option<String>) -> (&'static str, Value) {
    (
        "grok_doctor",
        json!({
            "grokBin": grok_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

pub(crate) fn remote_opencode_doctor_request(
    opencode_bin: Option<String>,
) -> (&'static str, Value) {
    (
        "opencode_doctor",
        json!({
            "opencodeBin": opencode_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

pub(crate) fn remote_pi_doctor_request(pi_bin: Option<String>) -> (&'static str, Value) {
    (
        "pi_doctor",
        json!({
            "piBin": pi_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

pub(crate) fn remote_qoder_doctor_request(
    qoder_bin: Option<String>,
    provider_profile_id: Option<String>,
) -> (&'static str, Value) {
    (
        "qoder_doctor",
        json!({
            "qoderBin": qoder_bin.map(remote_backend::normalize_path_for_remote),
            "providerProfileId": provider_profile_id,
        }),
    )
}

pub(crate) fn remote_dsh_doctor_request(dsh_bin: Option<String>) -> (&'static str, Value) {
    (
        "dsh_doctor",
        json!({
            "dshBin": dsh_bin.map(remote_backend::normalize_path_for_remote),
        }),
    )
}

#[tauri::command]
pub(crate) async fn opencode_doctor(
    opencode_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_opencode_doctor_request(opencode_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_opencode_doctor_with_settings(opencode_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn dsh_doctor(
    dsh_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_dsh_doctor_request(dsh_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_dsh_doctor_with_settings(dsh_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn kimi_doctor(
    kimi_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_kimi_doctor_request(kimi_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_kimi_doctor_with_settings(kimi_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn pi_doctor(
    pi_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_pi_doctor_request(pi_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_pi_doctor_with_settings(pi_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn qoder_doctor(
    qoder_bin: Option<String>,
    provider_profile_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_qoder_doctor_request(qoder_bin, provider_profile_id);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_qoder_doctor_for_profile_with_settings(qoder_bin, provider_profile_id, &settings).await
}

#[tauri::command]
pub(crate) async fn grok_doctor(
    grok_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_grok_doctor_request(grok_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_grok_doctor_with_settings(grok_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn claude_doctor(
    claude_bin: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        let (method, params) = remote_claude_doctor_request(claude_bin);
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let settings = state.app_settings.lock().await.clone();
    run_claude_doctor_with_settings(claude_bin, &settings).await
}

#[tauri::command]
pub(crate) async fn cli_version_status(
    engine: CliInstallEngine,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "cli_version_status",
            json!({ "engine": engine }),
        )
        .await
        .map_err(|error| {
            if error.contains("unknown method") || error.contains("unsupported") {
                "Remote daemon does not support CLI version status RPC. Update the daemon or switch backend mode to local.".to_string()
            } else {
                error
            }
        });
    }

    let settings = state.app_settings.lock().await.clone();
    let status = resolve_cli_version_status(engine, &settings).await;
    serde_json::to_value(status).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn cli_install_plan(
    engine: CliInstallEngine,
    action: CliInstallAction,
    strategy: CliInstallStrategy,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "cli_install_plan",
            json!({ "engine": engine, "action": action, "strategy": strategy }),
        )
        .await
        .map_err(|error| {
            if error.contains("unknown method") || error.contains("unsupported") {
                "Remote daemon does not support CLI installer RPC. Update the daemon or switch backend mode to local.".to_string()
            } else {
                error
            }
        });
    }

    let settings = state.app_settings.lock().await.clone();
    let plan = build_cli_install_plan_with_backend(
        engine,
        action,
        strategy,
        CliInstallBackend::Local,
        &settings,
    )
    .await;
    serde_json::to_value(plan).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn cli_install_run(
    engine: CliInstallEngine,
    action: CliInstallAction,
    strategy: CliInstallStrategy,
    run_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if remote_backend::is_remote_mode(&*state).await {
        return remote_backend::call_remote(
            &*state,
            app,
            "cli_install_run",
            json!({ "engine": engine, "action": action, "strategy": strategy, "runId": run_id }),
        )
        .await
        .map_err(|error| {
            if error.contains("unknown method") || error.contains("unsupported") {
                "Remote daemon does not support CLI installer RPC. Update the daemon or switch backend mode to local.".to_string()
            } else {
                error
            }
        });
    }

    let settings = state.app_settings.lock().await.clone();
    let event_app = app.clone();
    let progress_sink = std::sync::Arc::new(move |event: CliInstallProgressEvent| {
        let _ = event_app.emit("cli-installer-event", event);
    });
    let result = run_cli_installer_with_progress(
        engine,
        action,
        strategy,
        &settings,
        run_id,
        Some(progress_sink),
    )
    .await?;
    serde_json::to_value(result).map_err(|error| error.to_string())
}
