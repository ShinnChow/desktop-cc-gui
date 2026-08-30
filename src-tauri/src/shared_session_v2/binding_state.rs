use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;
use crate::engine::EngineType;
use crate::shared_event_log::canonical::types::{CanonicalFact, ControlFact, TurnRequestedFact};
use crate::shared_event_log::{
    BindingStateUpdate,
    SharedEventWriter,
    StoredBindingState,
    StoreError,
};
use crate::shared_sessions::{
    ensure_supported_shared_session_engine,
    now_millis,
    parse_shared_session_id,
    read_shared_session_meta,
};
use crate::state::AppState;

use super::execution_target::{raw_engine_session_id, raw_qoder_session_id};
use super::receipt::provider_runtime_key_for_target;
use super::turn_lifecycle::unresolved_attempt_evidence;
use super::recovery_disposition;

pub(crate) const PROVISIONING_PREPARED: &str = "prepared";
pub(crate) const PROVISIONING_CREATING: &str = "creating";
pub(crate) const PROVISIONING_READY: &str = "ready";
pub(crate) const PROVISIONING_RECOVERY_REQUIRED: &str = "recovery-required";

/// Native context trust for Shared Binding（fix-shared-context-resume-integrity）。
/// `dirty`：不得依赖 native 已持有历史，zero-transfer 时须 rematerialize。
/// `trusted`：允许 destination-owned / accepted cursor 省略交接。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NativeContextTrust {
    Trusted,
    Dirty,
}

impl NativeContextTrust {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Trusted => "trusted",
            Self::Dirty => "dirty",
        }
    }

    fn parse(raw: &str) -> Option<Self> {
        match raw.trim() {
            "trusted" => Some(Self::Trusted),
            "dirty" => Some(Self::Dirty),
            _ => None,
        }
    }
}

/// Compatibility：缺字段时 **fail-closed 为 dirty**。
/// 升级后首次发送会 rematerialize 一次，accept/completed 再写回 trusted。
/// （旧逻辑 ready+native→trusted 会让已坏会话静默继续丢上下文。）
pub(crate) fn read_native_context_trust(row: &StoredBindingState) -> NativeContextTrust {
    if let Some(trust) = row
        .provisioning_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| {
            value
                .get("nativeContextTrust")
                .and_then(Value::as_str)
                .and_then(NativeContextTrust::parse)
        })
    {
        return trust;
    }
    NativeContextTrust::Dirty
}

pub(crate) fn provisioning_json(
    state: &str,
    reason: Option<&str>,
    attempt_id: Option<&str>,
    binding_operation_id: Option<&str>,
    existing: Option<&StoredBindingState>,
    trust_override: Option<NativeContextTrust>,
) -> String {
    let updated_at = now_millis();
    let trust = trust_override.unwrap_or_else(|| {
        existing
            .map(read_native_context_trust)
            .unwrap_or(NativeContextTrust::Dirty)
    });
    json!({
        "state": state,
        "updatedAt": updated_at,
        "startedAt": (state == PROVISIONING_CREATING).then_some(updated_at),
        "reason": reason,
        "attemptId": attempt_id,
        "operationId": binding_operation_id,
        "nativeContextTrust": trust.as_str(),
    })
    .to_string()
}

/// RMW：只改 trust，保留其余 provisioning / cursor / native。
pub(crate) fn set_native_context_trust(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_key: &str,
    trust: NativeContextTrust,
) -> Result<(), String> {
    let existing = writer
        .binding_state(session_id, binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {binding_key} is missing"))?;
    if read_native_context_trust(&existing) == trust {
        return Ok(());
    }
    let engine = serde_json::from_value::<EngineType>(Value::String(existing.engine.clone()))
        .map_err(|_| {
            format!(
                "binding {binding_key} has unsupported engine '{}'",
                existing.engine
            )
        })
        .and_then(ensure_supported_shared_session_engine)?;
    let state = provisioning_state_of(&existing);
    upsert_binding_row(
        writer,
        session_id,
        binding_key,
        engine,
        existing.provider_profile_id.clone(),
        Some(&existing),
        None,
        None,
        provisioning_json(
            &state,
            None,
            None,
            binding_operation_id_of(&existing).as_deref(),
            Some(&existing),
            Some(trust),
        ),
        &existing.availability,
    )
    .map_err(|error| error.to_string())
}

/// 从 durable 行解析 provisioning state；缺省视为 prepared（未开始）。
pub(crate) fn provisioning_state_of(row: &StoredBindingState) -> String {
    row.provisioning_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| {
            value
                .get("state")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| PROVISIONING_PREPARED.to_string())
}

pub(crate) fn binding_operation_id_of(row: &StoredBindingState) -> Option<String> {
    row.provisioning_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<Value>(raw).ok())
        .and_then(|value| {
            value
                .get("operationId")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|operation_id| !operation_id.is_empty())
                .map(str::to_string)
        })
}

pub(crate) fn requested_binding_operation_id(requested: &TurnRequestedFact) -> Option<String> {
    requested
        .extra
        .get("bindingOperationId")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|operation_id| !operation_id.is_empty())
        .map(str::to_string)
}

/// 全行 read-modify-write upsert（upsert SQL 是整行覆盖，必须保留 cursor 等未变字段）。
#[allow(clippy::too_many_arguments)]
pub(crate) fn binding_row_update(
    session_id: &str,
    binding_key: &str,
    engine: EngineType,
    provider_profile_id: Option<String>,
    existing: Option<&StoredBindingState>,
    native_session_id: Option<String>,
    committed_through_sequence: Option<i64>,
    provisioning: String,
    availability: &str,
) -> BindingStateUpdate {
    BindingStateUpdate {
        session_id: session_id.to_string(),
        binding_key: binding_key.to_string(),
        engine: engine.icon().to_string(),
        provider_profile_id,
        native_session_id: native_session_id
            .or_else(|| existing.and_then(|row| row.native_session_id.clone())),
        accepted_through_sequence: existing.and_then(|row| row.accepted_through_sequence),
        committed_through_sequence: committed_through_sequence
            .or_else(|| existing.and_then(|row| row.committed_through_sequence)),
        provisioning_json: Some(provisioning),
        pending_delivery_json: existing.and_then(|row| row.pending_delivery_json.clone()),
        availability: availability.to_string(),
        updated_at: now_millis() as i64,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn upsert_binding_row(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_key: &str,
    engine: EngineType,
    provider_profile_id: Option<String>,
    existing: Option<&StoredBindingState>,
    native_session_id: Option<String>,
    committed_through_sequence: Option<i64>,
    provisioning: String,
    availability: &str,
) -> Result<(), StoreError> {
    writer.upsert_binding_state(&binding_row_update(
        session_id,
        binding_key,
        engine,
        provider_profile_id,
        existing,
        native_session_id,
        committed_through_sequence,
        provisioning,
        availability,
    ))
}

pub(crate) fn append_control_fact(
    writer: &SharedEventWriter,
    session_id: &str,
    control_kind: &str,
    binding_key: Option<&str>,
    reason: Option<&str>,
) -> Result<(), String> {
    let fact = CanonicalFact::Control(ControlFact {
        control_kind: control_kind.to_string(),
        logical_turn_id: None,
        attempt_id: None,
        binding_key: binding_key.map(str::to_string),
        reason: reason.map(str::to_string),
        details: None,
        extra: Value::Object(Default::default()),
    });
    writer
        .append_canonical_fact_at(session_id.to_string(), fact, now_millis() as i64)
        .map_err(|error| error.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// B.3 core：Tx1 begin_turn
// ---------------------------------------------------------------------------

pub(crate) fn require_writer(state: &AppState) -> Result<&SharedEventWriter, String> {
    state
        .shared_event_writer
        .as_ref()
        .ok_or_else(|| "shared event log unavailable".to_string())
}

pub(crate) fn require_shared_session_workspace_owner(
    workspace_id: &str,
    shared_session_id: &str,
) -> Result<(), String> {
    let meta = read_shared_session_meta(workspace_id, shared_session_id).map_err(|error| {
        format!(
            "shared-session-owner-unavailable: session {shared_session_id} is not owned by workspace {workspace_id}: {error}"
        )
    })?;
    validate_shared_session_workspace_owner(
        &meta.id,
        &meta.workspace_id,
        shared_session_id,
        workspace_id,
    )
}

pub(crate) fn validate_shared_session_workspace_owner(
    meta_session_id: &str,
    meta_workspace_id: &str,
    shared_session_id: &str,
    workspace_id: &str,
) -> Result<(), String> {
    if meta_session_id != shared_session_id || meta_workspace_id != workspace_id {
        return Err(format!(
            "shared-session-owner-mismatch: session {shared_session_id} is not owned by workspace {workspace_id}"
        ));
    }
    Ok(())
}

/// Probe（B.4.3）：读取 durable evidence 供前端定性（active / terminal / not-accepted）。
/// 不触碰 runtime，不修改任何状态。
#[tauri::command]
pub(crate) async fn shared_session_v2_probe_binding(
    workspace_id: String,
    thread_id: String,
    binding_key: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;

    let existing = writer
        .binding_state(&shared_session_id, &binding_key)
        .map_err(|error| error.to_string())?;
    let in_flight = unresolved_attempt_evidence(writer, &shared_session_id, Some(&binding_key))?;
    let native_probe = match existing.as_ref() {
        Some(row) if row.engine == EngineType::Claude.icon() => {
            let session = state
                .engine_manager
                .claude_manager
                .get_session_for_provider(&workspace_id, row.provider_profile_id.as_deref())
                .await;
            match session {
                Some(session) => {
                    let runtime_session_id = session.get_session_id().await;
                    let expected_session_id = row
                        .native_session_id
                        .as_deref()
                        .and_then(|value| value.strip_prefix("claude:"))
                        .or(row.native_session_id.as_deref());
                    json!({
                        "status": if runtime_session_id.as_deref() == expected_session_id { "matched" } else { "mismatch" },
                        "runtimeSessionId": runtime_session_id,
                        "activeProcessIds": session.active_process_ids().await,
                    })
                }
                None => json!({ "status": "runtime-missing" }),
            }
        }
        Some(row) if row.engine == EngineType::Codex.icon() => {
            let provider = row.provider_profile_id.as_deref().unwrap_or("__disk__");
            let runtime_key =
                crate::codex::provider_profile::codex_runtime_key(&workspace_id, provider);
            let session = state.sessions.lock().await.get(&runtime_key).cloned();
            match session {
                Some(session) => {
                    let health = session.probe_health(Duration::from_secs(2)).await;
                    json!({
                        "status": if health.is_ok() { "matched" } else { "runtime-unhealthy" },
                        "runtimeKey": runtime_key,
                        "detail": health.err(),
                    })
                }
                None => json!({ "status": "runtime-missing", "runtimeKey": runtime_key }),
            }
        }
        Some(row) if row.engine == EngineType::OpenCode.icon() => {
            let runtime_key = provider_runtime_key_for_target(
                &workspace_id,
                EngineType::OpenCode,
                row.provider_profile_id.as_deref(),
            )?;
            match state
                .engine_manager
                .get_opencode_session_for_runtime(&runtime_key)
                .await
            {
                Some(session) => {
                    let runtime_session_id = session.get_session_id().await;
                    let expected_session_id = row
                        .native_session_id
                        .as_deref()
                        .and_then(|value| raw_engine_session_id(EngineType::OpenCode, value));
                    json!({
                        "status": if runtime_session_id.as_deref() == expected_session_id {
                            "matched"
                        } else if expected_session_id
                            .is_some_and(|value| value.starts_with("opencode-pending-shared-"))
                        {
                            "runtime-created-awaiting-session"
                        } else {
                            "mismatch"
                        },
                        "runtimeKey": runtime_key,
                        "runtimeSessionId": runtime_session_id,
                    })
                }
                None => json!({ "status": "runtime-missing", "runtimeKey": runtime_key }),
            }
        }
        Some(row) if row.engine == EngineType::Kimi.icon() => {
            let runtime_key = provider_runtime_key_for_target(
                &workspace_id,
                EngineType::Kimi,
                row.provider_profile_id.as_deref(),
            )?;
            match state
                .engine_manager
                .get_kimi_session_for_runtime(&runtime_key)
                .await
            {
                Some(session) => {
                    let runtime_session_id = session.get_session_id().await;
                    let expected_session_id = row
                        .native_session_id
                        .as_deref()
                        .and_then(|value| raw_engine_session_id(EngineType::Kimi, value));
                    json!({
                        "status": if runtime_session_id.as_deref() == expected_session_id {
                            "matched"
                        } else if expected_session_id
                            .is_some_and(|value| value.starts_with("kimi-pending-shared-"))
                        {
                            "runtime-created-awaiting-session"
                        } else {
                            "mismatch"
                        },
                        "runtimeKey": runtime_key,
                        "runtimeSessionId": runtime_session_id,
                    })
                }
                None => json!({ "status": "runtime-missing", "runtimeKey": runtime_key }),
            }
        }
        Some(row) if row.engine == EngineType::Grok.icon() => {
            let runtime_key = provider_runtime_key_for_target(
                &workspace_id,
                EngineType::Grok,
                row.provider_profile_id.as_deref(),
            )?;
            match state
                .engine_manager
                .get_grok_session_for_runtime(&runtime_key)
                .await
            {
                Some(session) => {
                    let runtime_session_id = session.get_session_id().await;
                    let expected_session_id = row
                        .native_session_id
                        .as_deref()
                        .and_then(|value| raw_engine_session_id(EngineType::Grok, value));
                    json!({
                        "status": if runtime_session_id.as_deref() == expected_session_id {
                            "matched"
                        } else if expected_session_id
                            .is_some_and(|value| value.starts_with("grok-pending-shared-"))
                        {
                            "runtime-created-awaiting-session"
                        } else {
                            "mismatch"
                        },
                        "runtimeKey": runtime_key,
                        "runtimeSessionId": runtime_session_id,
                    })
                }
                None => json!({ "status": "runtime-missing", "runtimeKey": runtime_key }),
            }
        }
        Some(row) if row.engine == EngineType::Pi.icon() => {
            let runtime_key = provider_runtime_key_for_target(
                &workspace_id,
                EngineType::Pi,
                row.provider_profile_id.as_deref(),
            )?;
            match state
                .engine_manager
                .get_pi_session_for_runtime(&runtime_key)
                .await
            {
                Some(session) => {
                    let runtime_session_id = session.get_session_id().await;
                    let expected_session_id = row
                        .native_session_id
                        .as_deref()
                        .and_then(|value| raw_engine_session_id(EngineType::Pi, value));
                    json!({
                        "status": if runtime_session_id.as_deref() == expected_session_id {
                            "matched"
                        } else if expected_session_id
                            .is_some_and(|value| value.starts_with("pi-pending-shared-"))
                        {
                            "runtime-created-awaiting-session"
                        } else {
                            "mismatch"
                        },
                        "runtimeKey": runtime_key,
                        "runtimeSessionId": runtime_session_id,
                    })
                }
                None => json!({ "status": "runtime-missing", "runtimeKey": runtime_key }),
            }
        }
        Some(row) if row.engine == EngineType::Qoder.icon() => {
            let runtime_key = provider_runtime_key_for_target(
                &workspace_id,
                EngineType::Qoder,
                row.provider_profile_id.as_deref(),
            )?;
            match state
                .engine_manager
                .get_qoder_session_for_runtime(&runtime_key)
                .await
            {
                Some(session) => {
                    let runtime_session_id = session.get_session_id().await;
                    let expected_session_id = match row.native_session_id.as_deref() {
                        Some(value) => {
                            raw_qoder_session_id(value, row.provider_profile_id.as_deref())?
                        }
                        None => None,
                    };
                    let awaiting_session = row.native_session_id.as_deref().is_some_and(|value| {
                        crate::shared_sessions::is_pending_shared_binding_thread_id(
                            EngineType::Qoder,
                            value,
                        )
                    });
                    json!({
                        "status": if runtime_session_id.as_deref() == expected_session_id.as_deref() {
                            "matched"
                        } else if awaiting_session {
                            "runtime-created-awaiting-session"
                        } else {
                            "mismatch"
                        },
                        "runtimeKey": runtime_key,
                        "runtimeSessionId": runtime_session_id,
                    })
                }
                None => json!({ "status": "runtime-missing", "runtimeKey": runtime_key }),
            }
        }
        Some(_) => json!({ "status": "unsupported-engine" }),
        None => json!({ "status": "binding-missing" }),
    };

    Ok(json!({
        "status": "ok",
        "bindingKey": binding_key,
        "provisioningState": existing.as_ref().map(provisioning_state_of),
        "nativeSessionId": existing.as_ref().and_then(|row| row.native_session_id.clone()),
        "committedThroughSequence": existing.as_ref().and_then(|row| row.committed_through_sequence),
        "nativeProbe": native_probe,
        "inFlightAttempts": in_flight
            .iter()
            .map(|evidence| {
                let attempt_id = &evidence.owner.requested.attempt_id;
                json!({
                "attemptId": attempt_id,
                "logicalTurnId": evidence.owner.requested.logical_turn_id,
                "bindingKey": evidence.owner.binding_key,
                "bindingOperationId": evidence.owner.binding_operation_id,
                "accepted": evidence.accepted,
                "deliveryPrepared": evidence.delivery_prepared,
                "pendingPhase": evidence.pending_phase,
                "recoveryDisposition": recovery_disposition(
                    evidence,
                    &state.shared_runtime_coordinator,
                ),
                // Runtime owner 只在内存存在。重启后 durable accepted 仍在、owner 已丢失，
                // frontend 必须进入 recovery-required，不能伪装仍在 running。
                "runtimeObserverOwned": state
                    .shared_runtime_coordinator
                    .owns_attempt(attempt_id),
            })})
            .collect::<Vec<_>>(),
    }))
}

