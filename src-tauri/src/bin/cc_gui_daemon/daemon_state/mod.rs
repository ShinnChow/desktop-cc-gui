use super::*;
use engine::grok::resolve_grok_session_id_for_engine_send;
use engine::kimi::resolve_kimi_session_id_for_engine_send;
use engine::pi::{
    is_pi_agent_settled_marker, is_pi_background_notification_event,
    is_pi_family_external_wakeup_allowed, is_pi_forwardable_send_turn,
    resolve_pi_session_id_for_engine_send,
};
use engine::qoder::resolve_qoder_session_id_for_engine_send;
use std::collections::HashSet;
use tokio::time::Duration;
mod file_access;
mod git;
mod git_branches;
mod git_compare;
mod git_pr;
mod git_staging;
mod git_sync;
mod runtime_helpers;
mod session_folders;
mod thread_title_generation;

const DELETE_ARCHIVE_TIMEOUT_MS: u64 = 2_000;
const LIST_THREADS_LIVE_TIMEOUT_MS: u64 = 1_500;
const CLAUDE_POST_COMPLETION_USAGE_GRACE_MS: u64 = 35_000;

fn codex_turn_developer_instructions(settings: &crate::types::AppSettings) -> Option<String> {
    crate::backend::app_server_cli::codex_generated_developer_instructions_for_turn(settings)
}

fn normalize_daemon_disk_provider_profile(
    provider_profile_id: Option<String>,
) -> Result<Option<String>, String> {
    let Some(provider_profile_id) = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    if provider_profile_id == codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID {
        return Ok(Some(provider_profile_id));
    }
    Err(format!(
        "Codex provider-scoped runtime is unavailable in daemon mode for provider {provider_profile_id}; use desktop runtime or select disk .codex provider."
    ))
}

fn resolve_supported_daemon_active_engine(
    settings: &AppSettings,
    configured_engine: Option<&str>,
) -> engine::EngineType {
    parse_engine_type_string(configured_engine)
        .filter(|engine_type| engine::engine_enabled_in_settings(settings, *engine_type))
        .unwrap_or(engine::EngineType::Codex)
}

async fn run_daemon_disk_start_thread_with_readiness<
    FEnsure,
    FEnsureFuture,
    FStart,
    FStartFuture,
    FConfirm,
    FConfirmFuture,
>(
    workspace_id: &str,
    mut ensure_runtime: FEnsure,
    mut start_thread: FStart,
    mut confirm_thread_ready: FConfirm,
) -> Result<Value, String>
where
    FEnsure: FnMut() -> FEnsureFuture,
    FEnsureFuture: std::future::Future<Output = Result<(), String>>,
    FStart: FnMut() -> FStartFuture,
    FStartFuture: std::future::Future<Output = Result<Value, String>>,
    FConfirm: FnMut(String) -> FConfirmFuture,
    FConfirmFuture: std::future::Future<Output = Result<(), String>>,
{
    ensure_runtime().await?;
    let first_attempt = start_thread().await;
    let response = match first_attempt {
        Ok(response) => Ok(response),
        Err(error) if is_create_session_runtime_recovery_error(&error) => {
            log::warn!(
                "[daemon.start_thread] retrying after runtime disconnect for workspace {}: {}",
                workspace_id,
                error
            );
            ensure_runtime().await?;
            match start_thread().await {
                Ok(response) => Ok(response),
                Err(retry_error) if is_create_session_runtime_recovery_error(&retry_error) => {
                    log::warn!(
                        "[daemon.start_thread] runtime disconnect retry exhausted for workspace {}: {}",
                        workspace_id,
                        retry_error
                    );
                    Err(create_session_runtime_recovering_error())
                }
                Err(retry_error) => Err(retry_error),
            }
        }
        Err(error) => Err(error),
    }?;

    if let Some(thread_id) = codex_core::extract_thread_id_from_response(&response) {
        confirm_thread_ready(thread_id).await?;
    }
    Ok(response)
}

mod codex_local_threads;
use codex_local_threads::{
    build_codex_daemon_empty_thread_response, build_codex_daemon_local_thread_response,
    parse_codex_daemon_local_thread_cursor, prefixed_session_id,
    CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE, CODEX_DAEMON_LOCAL_THREAD_LIST_TIMEOUT_MS,
};
use runtime_helpers::{
    create_session_runtime_recovering_error, is_create_session_runtime_recovery_error,
    is_valid_claude_model_for_passthrough,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CodexRuntimeReloadResult {
    status: String,
    stage: String,
    restarted_sessions: usize,
    message: Option<String>,
}

mod codex_ops;
mod engine_detect;
mod engine_send;
mod engine_send_sync;
mod interrupt_web_file;
mod session_history;
mod session_listing;
mod settings_doctor;
mod workspaces;

#[cfg(test)]
mod daemon_state_tests;
