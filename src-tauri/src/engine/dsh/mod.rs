//! DeepSeek Harness (DSH) native engine adapter.
//!
//! mossx is a second Host RPC client of a single persistent `dsh web`.
//! Keys and provider profiles stay in `$DSH_HOME`. The only settings write
//! is the narrow image-admission claim in `image_admission`.

pub mod events;
pub mod history;
pub mod host;
pub mod image_admission;
pub mod session;
pub mod supervisor;

use super::{EngineFeatures, EngineStatus, EngineType, ModelInfo};
use crate::backend::app_server::build_codex_path_env;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use host::DshHostClient;
use supervisor::{DshHostSnapshot, DshRuntimeSettings};

const DETECTION_TIMEOUT: Duration = Duration::from_secs(10);

pub fn runtime_settings_from_app(settings: &crate::types::AppSettings) -> DshRuntimeSettings {
    runtime_settings_from_app_with_auto_start(settings, settings.dsh_auto_start.unwrap_or(true))
}

/// Explicit settings-page start must be allowed to spawn even when auto-start is off.
pub fn runtime_settings_for_explicit_start(
    settings: &crate::types::AppSettings,
) -> DshRuntimeSettings {
    runtime_settings_from_app_with_auto_start(settings, true)
}

/// Stop an in-flight start or a live local host. Remote origins stay running.
pub async fn cancel_start() -> Result<(), String> {
    supervisor::cancel_start().await
}

pub async fn stop_host(settings: &DshRuntimeSettings) -> Result<(), String> {
    supervisor::stop_host(settings).await
}

fn runtime_settings_from_app_with_auto_start(
    settings: &crate::types::AppSettings,
    auto_start: bool,
) -> DshRuntimeSettings {
    let runtime = DshRuntimeSettings {
        bin_path: settings.dsh_bin.clone(),
        host: settings
            .dsh_host
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("127.0.0.1")
            .to_string(),
        port: settings.dsh_port.unwrap_or(3080),
        auto_start,
    };
    supervisor::remember_endpoint(&runtime.host, runtime.port);
    runtime
}

pub fn runtime_settings_from_bin(custom_bin: Option<&str>) -> DshRuntimeSettings {
    runtime_settings_from_parts(custom_bin, None, None, None)
}

pub fn runtime_settings_from_parts(
    custom_bin: Option<&str>,
    host: Option<&str>,
    port: Option<u16>,
    auto_start: Option<bool>,
) -> DshRuntimeSettings {
    let defaults = DshRuntimeSettings::default();
    DshRuntimeSettings {
        bin_path: custom_bin.map(str::to_string),
        host: host
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(defaults.host.as_str())
            .to_string(),
        port: port.unwrap_or(defaults.port),
        auto_start: auto_start.unwrap_or(defaults.auto_start),
    }
}

pub fn runtime_settings_from_engine_config(
    config: Option<&crate::engine::EngineConfig>,
) -> DshRuntimeSettings {
    let remembered = supervisor::remembered_endpoint();
    runtime_settings_from_parts(
        config.and_then(|item| item.bin_path.as_deref()),
        remembered.as_ref().map(|(host, _)| host.as_str()),
        remembered.as_ref().map(|(_, port)| *port),
        None,
    )
}

pub async fn ensure_ready(
    settings: &DshRuntimeSettings,
) -> Result<(DshHostSnapshot, Arc<DshHostClient>), String> {
    let snapshot = supervisor::ensure_host(settings).await?;
    let client = supervisor::client_for_snapshot(&snapshot)?;
    events::ensure_mux(&client).await;
    Ok((snapshot, client))
}

/// Read-only attach. Never spawn `dsh web`.
pub async fn connect_existing(
    settings: &DshRuntimeSettings,
) -> Result<(DshHostSnapshot, Arc<DshHostClient>), String> {
    let snapshot = supervisor::connect_existing(settings).await?;
    let client = supervisor::client_for_snapshot(&snapshot)?;
    Ok((snapshot, client))
}

pub async fn detect_dsh_status(settings: &DshRuntimeSettings) -> EngineStatus {
    let custom_bin = settings.bin_path.as_deref();
    let bin_path = resolve_bin_path(custom_bin);
    let bin = bin_path
        .as_ref()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| crate::backend::app_server::resolve_launchable_cli_binary("dsh"));
    let path_env = build_codex_path_env(custom_bin);
    let (installed, version, error) = probe_cli_version_local(&bin, path_env.as_ref()).await;
    if !installed {
        return not_installed(error);
    }

    let home_dir = dsh_home_dir();
    let origin = host::origin_from_host_port(&settings.host, settings.port);
    let (models, host_error) = match supervisor::probe_describe(&origin).await {
        Ok(describe) => match DshHostClient::new(origin.clone()) {
            Ok(client) => match load_model_infos_with_describe(&client, Some(&describe)).await {
                Ok(models) => (models, None),
                Err(error) => (Vec::new(), Some(error)),
            },
            Err(error) => (Vec::new(), Some(error)),
        },
        Err(_) => (
            Vec::new(),
            Some(format!(
                "DSH CLI is installed but host is not running at {origin}"
            )),
        ),
    };
    let default_model = models
        .iter()
        .find(|model| model.default)
        .map(|model| model.id.clone());

    EngineStatus {
        engine_type: EngineType::Dsh,
        auth_state: crate::engine::AuthState::default(),
        installed: true,
        version,
        bin_path: Some(bin),
        home_dir: home_dir.map(|path| path.to_string_lossy().to_string()),
        models,
        default_model,
        features: EngineFeatures::dsh(),
        error: host_error,
    }
}

pub async fn load_dsh_models(settings: &DshRuntimeSettings) -> Result<Vec<ModelInfo>, String> {
    // Catalog / doctor / picker must never spawn `dsh web`.
    let (_snapshot, client) = connect_existing(settings).await?;
    load_model_infos(&client).await
}

pub async fn load_model_infos(client: &DshHostClient) -> Result<Vec<ModelInfo>, String> {
    load_model_infos_with_describe(client, None).await
}

async fn load_model_infos_with_describe(
    client: &DshHostClient,
    describe: Option<&Value>,
) -> Result<Vec<ModelInfo>, String> {
    let catalog = session::load_models(client).await?;
    Ok(flatten_llm_models_with_describe(&catalog, describe))
}

pub struct DshSendOutcome {
    pub native_session_id: String,
    pub thread_id: String,
    pub turn_id: String,
    pub item_id: String,
    pub turn_waiter: events::DshTurnWaiter,
}

pub async fn send_user_turn(
    settings: &DshRuntimeSettings,
    app: Option<tauri::AppHandle>,
    mossx_workspace_id: &str,
    workspace_path: &std::path::Path,
    text: &str,
    model: Option<&str>,
    effort: Option<&str>,
    images: Option<&[String]>,
    resume_id: Option<&str>,
    continue_session: bool,
    agent_preset: Option<&str>,
    access_mode: Option<&str>,
) -> Result<DshSendOutcome, String> {
    if let Some(handle) = app.as_ref() {
        events::set_app_handle(handle.clone()).await;
    }
    let (snapshot, client) = ensure_ready(settings).await?;
    let workspace = session::create_workspace(&client, workspace_path).await?;
    let dsh_workspace_id = session::workspace_id_from_create(&workspace)?;

    let resume_id = resume_id.map(str::trim).filter(|value| !value.is_empty());
    let agent_preset = agent_preset
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let native_session_id = if continue_session {
        match resume_id {
            Some(value) if session::is_pending_thread(value) => {
                session::create_session(&client, &dsh_workspace_id, None, agent_preset).await?
            }
            Some(value) => session::session_id_from_thread(value),
            None => session::create_session(&client, &dsh_workspace_id, None, agent_preset).await?,
        }
    } else {
        session::create_session(&client, &dsh_workspace_id, None, agent_preset).await?
    };

    let thread_id = session::thread_id_for_session(&native_session_id);
    let turn_id = format!("dsh-turn-{}", uuid::Uuid::new_v4());
    let item_id = format!("dsh-item-{}", uuid::Uuid::new_v4());
    if let Some(app) = app.as_ref() {
        let announce_thread = resume_id
            .filter(|value| session::is_pending_thread(value))
            .unwrap_or(thread_id.as_str());
        if let Some(payload) =
            crate::engine::events::engine_event_to_app_server_event_with_turn_context(
                &crate::engine::events::EngineEvent::SessionStarted {
                    workspace_id: mossx_workspace_id.to_string(),
                    session_id: native_session_id.clone(),
                    engine: EngineType::Dsh,
                    turn_id: Some(turn_id.clone()),
                },
                announce_thread,
                &item_id,
                Some(turn_id.as_str()),
            )
        {
            use tauri::Emitter;
            let _ = app.emit("app-server-event", payload);
        }
    }
    events::bind_session(
        &native_session_id,
        events::DshSessionBinding {
            workspace_id: mossx_workspace_id.to_string(),
            thread_id: thread_id.clone(),
            turn_id: Some(turn_id.clone()),
            item_id: Some(item_id.clone()),
        },
    )
    .await;

    let selected = if let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) {
        let Some((provider, model_id)) = session::split_model_selection(model, None) else {
            return Err(format!(
                "DSH model must be a provider/model catalog id, got `{model}`"
            ));
        };
        if session::is_reserved_mossx_dsh_provider(&provider) {
            return Err(format!(
                "DSH model provider `{provider}` is reserved by mossx and has no DSH adapter"
            ));
        }
        session::select_model(&client, &native_session_id, &provider, &model_id, effort).await?;
        Some((provider, model_id))
    } else {
        image_admission::selection_from_describe(&snapshot.describe)
    };

    let prompt_images = session::load_prompt_images(images, workspace_path)?;
    if !prompt_images.is_empty() {
        let Some((provider, model_id)) = selected else {
            return Err(
                "DSH image input needs a selected provider/model before mossx can declare vision"
                    .to_string(),
            );
        };
        image_admission::ensure_image_admission(&client, &provider, &model_id).await?;
    }

    // Permission preset is a live session switch, independent of Agent
    // Preset. Create still pins the host default (usually workspace-write
    // + ask); auto mode must overwrite it before the first tool call.
    // Skip the switch while a turn is still open: /permission injects into
    // the live agent inbox and can flip ask/never under in-flight tools.
    if session::should_set_permission_preset(
        continue_session,
        events::session_has_open_turn(&native_session_id).await,
    ) {
        session::set_permission_preset(&client, &native_session_id, access_mode).await?;
    }

    // Subscribe immediately before prompt so this turn's `turn/end` cannot
    // race past the waiter. Do not inspect history first: a resumed
    // session already has a previous `turn/end`.
    let turn_waiter = events::subscribe_turn_end(&native_session_id).await;
    session::prompt(&client, &native_session_id, text, &prompt_images).await?;
    Ok(DshSendOutcome {
        native_session_id,
        thread_id,
        turn_id,
        item_id,
        turn_waiter,
    })
}

pub async fn collect_turn_text(
    client: &DshHostClient,
    session_id: &str,
    waiter: events::DshTurnWaiter,
    timeout: Duration,
) -> Result<String, String> {
    // The waiter is subscribed before `session.prompt`, so it cannot miss
    // this turn's `turn/end`. Do not inspect history first: a resumed
    // session already has a previous `turn/end` and would return stale text.
    waiter.await_end(timeout).await?;
    latest_assistant_text(client, session_id)
        .await?
        .ok_or_else(|| "DSH turn completed without assistant text".to_string())
}

async fn latest_assistant_text(
    client: &DshHostClient,
    session_id: &str,
) -> Result<Option<String>, String> {
    let loaded = history::load_dsh_session(client, session_id).await?;
    Ok(loaded
        .messages
        .iter()
        .rev()
        .find(|message| message.kind == "message" && message.role == "assistant")
        .map(|message| message.text.clone())
        .filter(|text| !text.is_empty()))
}

pub async fn interrupt_workspace(
    settings: &DshRuntimeSettings,
    workspace_id: &str,
) -> Result<(), String> {
    let session_ids = events::session_ids_for_workspace(workspace_id).await;
    if session_ids.is_empty() {
        return Ok(());
    }
    let (_snapshot, client) = ensure_ready(settings).await?;
    let mut errors = Vec::new();
    for session_id in session_ids {
        if let Err(error) = session::cancel(&client, &session_id).await {
            errors.push(format!("{session_id}: {error}"));
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "failed to cancel {} DSH session(s): {}",
            errors.len(),
            errors.join("; ")
        ))
    }
}

pub async fn interrupt_turn(settings: &DshRuntimeSettings, turn_id: &str) -> Result<(), String> {
    let Some(session_id) = events::session_id_for_turn(turn_id).await else {
        return Ok(());
    };
    let (_snapshot, client) = ensure_ready(settings).await?;
    session::cancel(&client, &session_id).await?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DshControlKind {
    Approval {
        rpc_id: String,
        session_id: String,
        approval_id: String,
    },
    Question {
        rpc_id: String,
        session_id: String,
    },
}

pub fn encode_approval_request_id(rpc_id: &str, session_id: &str, approval_id: &str) -> Value {
    Value::String(
        json!({
            "kind": "dsh-approval",
            "rpcId": rpc_id,
            "sessionId": session_id,
            "approvalId": approval_id,
        })
        .to_string(),
    )
}

pub fn encode_question_request_id(rpc_id: &str, session_id: &str) -> Value {
    Value::String(
        json!({
            "kind": "dsh-question",
            "rpcId": rpc_id,
            "sessionId": session_id,
        })
        .to_string(),
    )
}

pub fn parse_control_request(request_id: &Value) -> Option<DshControlKind> {
    let value = match request_id {
        Value::String(raw) => serde_json::from_str::<Value>(raw).ok()?,
        Value::Object(_) => request_id.clone(),
        _ => return None,
    };
    let rpc_id = value
        .get("rpcId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())?
        .to_string();
    let session_id = value
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())?
        .to_string();
    match value.get("kind").and_then(Value::as_str) {
        Some("dsh-question") => Some(DshControlKind::Question { rpc_id, session_id }),
        Some("dsh-approval") | None => {
            let approval_id = value
                .get("approvalId")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())?
                .to_string();
            Some(DshControlKind::Approval {
                rpc_id,
                session_id,
                approval_id,
            })
        }
        _ => None,
    }
}

pub async fn respond_to_control(
    settings: &DshRuntimeSettings,
    request: DshControlKind,
    result: &Value,
) -> Result<(), String> {
    let (_snapshot, client) = ensure_ready(settings).await?;
    match request {
        DshControlKind::Approval {
            rpc_id,
            session_id,
            approval_id,
        } => {
            let accepted = result.get("decision").and_then(Value::as_str) == Some("accept");
            client
                .respond(
                    &rpc_id,
                    json!({
                        "sessionId": session_id,
                        "approvalId": approval_id,
                        "outcome": if accepted { "allowed-once" } else { "rejected" },
                    }),
                )
                .await?;
        }
        DshControlKind::Question { rpc_id, session_id } => {
            let questions = events::pending_questions(&rpc_id).await;
            let outcome = if is_dsh_question_cancel(result) {
                client
                    .respond_error(&rpc_id, "cancelled", "the user cancelled ask_user_question")
                    .await
            } else {
                client
                    .respond(
                        &rpc_id,
                        json!({
                            "sessionId": session_id,
                            "answer": {
                                "answers": map_question_answers(result, questions.as_ref()),
                            },
                        }),
                    )
                    .await
            };
            match outcome {
                Ok(_) => events::forget_pending_questions(&rpc_id).await,
                Err(error) => {
                    // Host already dropped the waiter. Keep the template on
                    // bad-response / transport errors so a retry can still
                    // emit answers in the original question order.
                    if error.contains("not-pending") {
                        events::forget_pending_questions(&rpc_id).await;
                    }
                    return Err(error);
                }
            }
        }
    }
    Ok(())
}

pub async fn fork_session(
    settings: &DshRuntimeSettings,
    session_id: &str,
) -> Result<String, String> {
    let (_snapshot, client) = ensure_ready(settings).await?;
    session::fork(&client, session_id).await
}

fn is_dsh_question_cancel(result: &Value) -> bool {
    if result.get("decision").and_then(Value::as_str) == Some("cancel") {
        return true;
    }
    let skipped = result
        .get("skippedQuestionIds")
        .and_then(Value::as_array)
        .is_some_and(|ids| !ids.is_empty());
    if !skipped {
        return false;
    }
    // DSH answers one ask() as a whole batch. A full skip / dismiss / timeout
    // without a recommended option must cancel the waiter instead of posting an
    // empty selected[] list that Host rejects as a short batch.
    result
        .get("answers")
        .and_then(Value::as_object)
        .is_none_or(|answers| {
            answers.values().all(|value| {
                value
                    .get("answers")
                    .and_then(Value::as_array)
                    .is_none_or(|items| {
                        items
                            .iter()
                            .all(|item| item.as_str().is_none_or(|text| text.trim().is_empty()))
                    })
            })
        })
}

fn question_ids_from_template(questions: Option<&Value>) -> Vec<String> {
    questions
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    item.get("id")
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_question_answers(result: &Value, questions: Option<&Value>) -> Vec<Value> {
    let answers = result.get("answers").and_then(Value::as_object);
    let mut ids = question_ids_from_template(questions);
    if ids.is_empty() {
        if let Some(answers) = answers {
            ids = answers.keys().cloned().collect();
        }
    }
    ids.into_iter()
        .map(|id| {
            let raw = answers.and_then(|map| map.get(&id));
            let selected_raw = raw
                .and_then(|value| value.get("answers"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut selected = Vec::new();
            let mut custom = None;
            for item in selected_raw {
                let Some(text) = item
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
                else {
                    continue;
                };
                if let Some(note) = text.strip_prefix("user_note:") {
                    let note = note.trim();
                    if !note.is_empty() {
                        custom = Some(note.to_string());
                    }
                    continue;
                }
                selected.push(json!(text));
            }
            let mut mapped = json!({
                "id": id,
                "selected": selected,
            });
            if let Some(custom) = custom {
                mapped["custom"] = json!(custom);
            }
            mapped
        })
        .collect()
}

pub fn flatten_llm_models(catalog: &Value) -> Vec<ModelInfo> {
    flatten_llm_models_with_describe(catalog, None)
}

pub fn flatten_llm_models_with_describe(
    catalog: &Value,
    describe: Option<&Value>,
) -> Vec<ModelInfo> {
    let preferred = describe.and_then(|value| {
        let provider = value.get("provider").and_then(Value::as_str)?;
        let model = value.get("model").and_then(Value::as_str)?;
        Some((provider.to_string(), model.to_string()))
    });
    let groups = catalog
        .get("groups")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut models = Vec::new();
    for group in groups.iter() {
        let provider = group
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string();
        let group_name = group
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(provider.as_str())
            .to_string();
        let group_models = group
            .get("models")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for model in group_models.iter() {
            let model_id = model
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string();
            if model_id.is_empty() {
                continue;
            }
            let model_name = model
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(model_id.as_str());
            let id = format!("{provider}/{model_id}");
            let marked_default = model.get("default").and_then(Value::as_bool) == Some(true)
                || preferred
                    .as_ref()
                    .is_some_and(|(preferred_provider, preferred_model)| {
                        preferred_provider == &provider && preferred_model == &model_id
                    });
            let mut info = ModelInfo::new(id, format!("{group_name} / {model_name}"))
                .with_runtime_model(model_id)
                .with_provider(provider.clone())
                .with_protocol("dsh-host-rpc")
                .with_provenance("dsh:llm.models")
                .with_source("runtime")
                .with_description(
                    model
                        .get("description")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string(),
                );
            if marked_default {
                info = info.as_default();
            }
            let reasoning = model.get("reasoning");
            let supported_reasoning_efforts: Vec<String> = reasoning
                .and_then(|value| value.get("efforts"))
                .and_then(Value::as_array)
                .map(|efforts| {
                    let mut seen = std::collections::HashSet::new();
                    efforts
                        .iter()
                        .filter_map(|entry| {
                            entry
                                .get("id")
                                .and_then(Value::as_str)
                                .map(str::trim)
                                .filter(|value| !value.is_empty())
                                .map(str::to_string)
                        })
                        .filter(|value| seen.insert(value.clone()))
                        .collect()
                })
                .unwrap_or_default();
            let default_reasoning_effort = reasoning
                .and_then(|value| value.get("defaultEffort"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if !supported_reasoning_efforts.is_empty() || default_reasoning_effort.is_some() {
                info = info.with_reasoning(supported_reasoning_efforts, default_reasoning_effort);
            }
            models.push(info);
        }
    }
    if !models.iter().any(|model| model.default) {
        if let Some(first) = models.first_mut() {
            *first = first.clone().as_default();
        }
    }
    models
}

pub(crate) fn dsh_home_dir() -> Option<PathBuf> {
    std::env::var_os("DSH_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".dsh")))
}

fn resolve_bin_path(custom_bin: Option<&str>) -> Option<PathBuf> {
    if let Some(custom) = custom_bin.filter(|value| !value.trim().is_empty()) {
        let resolved = crate::backend::app_server::resolve_launchable_cli_binary(custom);
        let path = PathBuf::from(&resolved);
        if path.exists() {
            return Some(path);
        }
    }
    crate::backend::app_server::find_cli_binary("dsh", None)
}

async fn probe_cli_version_local(
    bin: &str,
    path_env: Option<&String>,
) -> (bool, Option<String>, Option<String>) {
    let version_result = timeout(DETECTION_TIMEOUT, async {
        let mut cmd = build_async_command(bin);
        if let Some(path) = path_env {
            cmd.env("PATH", path);
        }
        cmd.arg("--version");
        cmd.output().await
    })
    .await;

    match version_result {
        Ok(Ok(output)) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let version = if stdout.is_empty() {
                None
            } else {
                Some(stdout.lines().next().unwrap_or(&stdout).trim().to_string())
            };
            (true, version, None)
        }
        Ok(Ok(output)) => {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            (false, None, Some(stderr))
        }
        Ok(Err(error)) => (false, None, Some(error.to_string())),
        Err(_) => (false, None, Some("dsh --version timed out".to_string())),
    }
}

fn build_async_command(bin: &str) -> Command {
    #[cfg(windows)]
    {
        let bin_lower = bin.to_lowercase();
        if bin_lower.ends_with(".cmd") || bin_lower.ends_with(".bat") {
            let mut cmd = crate::utils::async_command("cmd");
            cmd.arg("/c");
            cmd.arg(bin);
            return cmd;
        }
    }
    crate::utils::async_command(bin)
}

fn not_installed(error: Option<String>) -> EngineStatus {
    EngineStatus {
        engine_type: EngineType::Dsh,
        auth_state: crate::engine::AuthState::default(),
        installed: false,
        version: None,
        bin_path: None,
        home_dir: dsh_home_dir().map(|path| path.to_string_lossy().to_string()),
        models: Vec::new(),
        default_model: None,
        features: EngineFeatures::dsh(),
        error: error.or_else(|| Some("dsh CLI is not installed".to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn flattens_provider_model_pairs() {
        let catalog = json!({
            "groups": [{
                "id": "deepseek-official",
                "name": "DeepSeek",
                "models": [
                    { "id": "deepseek-v4-flash", "name": "V4 Flash" },
                    { "id": "deepseek-v4-pro", "name": "V4 Pro" }
                ]
            }],
            "failures": []
        });
        let models = flatten_llm_models(&catalog);
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].id, "deepseek-official/deepseek-v4-flash");
        assert_eq!(models[0].model, "deepseek-v4-flash");
        assert_eq!(models[0].provider.as_deref(), Some("deepseek-official"));
        assert!(models[0].default);
        assert!(!models[1].default);
    }

    #[test]
    fn flattens_host_reasoning_efforts() {
        let catalog = json!({
            "groups": [{
                "id": "deepseek-official",
                "name": "DeepSeek",
                "models": [{
                    "id": "deepseek-v4-flash",
                    "name": "DeepSeek-V4-Flash",
                    "reasoning": {
                        "efforts": [
                            { "id": "off", "name": "Off" },
                            { "id": "low", "name": "Low" },
                            { "id": "high", "name": "High" },
                            { "id": "max", "name": "Max" }
                        ],
                        "defaultEffort": "high"
                    }
                }, {
                    "id": "deepseek-v4-pro",
                    "name": "DeepSeek-V4-Pro"
                }]
            }]
        });
        let models = flatten_llm_models(&catalog);
        assert_eq!(models.len(), 2);
        assert_eq!(
            models[0].supported_reasoning_efforts,
            vec!["off", "low", "high", "max"]
        );
        assert_eq!(models[0].default_reasoning_effort.as_deref(), Some("high"));
        assert!(models[1].supported_reasoning_efforts.is_empty());
        assert!(models[1].default_reasoning_effort.is_none());
    }

    #[test]
    fn prefers_host_describe_current_model() {
        let catalog = json!({
            "groups": [{
                "id": "deepseek-official",
                "name": "DeepSeek",
                "models": [
                    { "id": "deepseek-v4-flash", "name": "V4 Flash" },
                    { "id": "deepseek-v4-pro", "name": "V4 Pro" }
                ]
            }, {
                "id": "grok",
                "name": "Grok",
                "models": [
                    { "id": "grok-4.6", "name": "Grok 4.6" }
                ]
            }]
        });
        let describe = json!({ "provider": "grok", "model": "grok-4.6" });
        let models = flatten_llm_models_with_describe(&catalog, Some(&describe));
        assert!(!models[0].default);
        assert!(models
            .iter()
            .any(|model| model.id == "grok/grok-4.6" && model.default));
    }

    #[test]
    fn encodes_and_parses_approval_control_request() {
        let encoded = encode_approval_request_id("rpc-1", "session-1", "approval-1");
        match parse_control_request(&encoded) {
            Some(DshControlKind::Approval {
                rpc_id,
                session_id,
                approval_id,
            }) => {
                assert_eq!(rpc_id, "rpc-1");
                assert_eq!(session_id, "session-1");
                assert_eq!(approval_id, "approval-1");
            }
            other => panic!("unexpected control request: {other:?}"),
        }
    }

    #[test]
    fn maps_accept_decision_to_allowed_once_payload() {
        let answers = map_question_answers(
            &json!({
                "answers": {
                    "q1": { "answers": ["yes"] }
                }
            }),
            None,
        );
        assert_eq!(answers.len(), 1);
        assert_eq!(answers[0]["id"], "q1");
        assert_eq!(answers[0]["selected"][0], "yes");
    }

    #[test]
    fn maps_question_answers_in_template_order_and_keeps_notes() {
        let answers = map_question_answers(
            &json!({
                "answers": {
                    "q-b": { "answers": ["B", "user_note: extra"] },
                    "q-a": { "answers": ["A"] }
                }
            }),
            Some(&json!([
                { "id": "q-a", "question": "first" },
                { "id": "q-b", "question": "second" }
            ])),
        );
        assert_eq!(answers.len(), 2);
        assert_eq!(answers[0]["id"], "q-a");
        assert_eq!(answers[0]["selected"][0], "A");
        assert_eq!(answers[1]["id"], "q-b");
        assert_eq!(answers[1]["selected"][0], "B");
        assert_eq!(answers[1]["custom"], "extra");
    }

    #[test]
    fn full_skip_cancels_dsh_question() {
        assert!(is_dsh_question_cancel(&json!({
            "answers": {},
            "skippedQuestionIds": ["q-a", "q-b"]
        })));
        assert!(!is_dsh_question_cancel(&json!({
            "answers": {
                "q-a": { "answers": ["A"] }
            },
            "skippedQuestionIds": ["q-b"]
        })));
    }

    #[test]
    fn explicit_start_overrides_disabled_auto_start() {
        let settings = crate::types::AppSettings {
            dsh_host: Some("10.0.0.8".to_string()),
            dsh_port: Some(4090),
            dsh_auto_start: Some(false),
            ..crate::types::AppSettings::default()
        };
        let send_path = runtime_settings_from_app(&settings);
        let explicit = runtime_settings_for_explicit_start(&settings);
        assert!(!send_path.auto_start);
        assert!(explicit.auto_start);
        assert_eq!(explicit.host, "10.0.0.8");
        assert_eq!(explicit.port, 4090);
    }
}
