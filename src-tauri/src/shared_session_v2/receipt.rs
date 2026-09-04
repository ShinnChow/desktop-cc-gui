use serde_json::{json, Value};
use tauri::State;
use crate::engine::EngineType;
use crate::shared_context::{ArtifactReadRequest, read_artifact, scan_orphan_artifacts};
use crate::shared_event_log::canonical::assembler::RuntimeFinalSnapshot;
use crate::shared_event_log::canonical::types::{CanonicalFact, OutcomeStatus};
use crate::shared_event_log::SharedEventWriter;
use crate::shared_sessions::parse_shared_session_id;
use crate::state::AppState;

use super::binding_state::{
    provisioning_state_of,
    require_shared_session_workspace_owner,
    require_writer,
};
use super::dispatch_settlement::commit_observed_runtime_settlement;
use super::execution_target::context_artifact_root;
use super::turn_lifecycle::{
    durable_attempt_owner,
    DurableAttemptOwner,
    unresolved_attempt_evidence,
};
use super::recovery_disposition;

pub(crate) fn runtime_turn_id(response: &Value) -> Option<String> {
    response
        .pointer("/result/turn/id")
        .or_else(|| response.pointer("/turn/id"))
        .or_else(|| response.pointer("/result/turnId"))
        .or_else(|| response.get("turnId"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

pub(crate) fn runtime_response_error(response: &Value) -> Option<String> {
    crate::shared::codex_core::extract_error_message_from_response(response).or_else(|| {
        response
            .pointer("/response/error/message")
            .or_else(|| response.pointer("/response/error"))
            .and_then(|value| value.as_str().map(str::to_string))
    })
}

fn receipt_nullable_string<'a>(receipt: &'a Value, key: &str) -> Result<Option<&'a str>, String> {
    let value = receipt
        .get(key)
        .ok_or_else(|| format!("dispatch receipt missing {key}"))?;
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(Some)
        .ok_or_else(|| format!("dispatch receipt has invalid {key}"))
}

pub(crate) fn provider_runtime_key_for_target(
    workspace_id: &str,
    engine: EngineType,
    provider_profile_id: Option<&str>,
) -> Result<String, String> {
    match engine {
        EngineType::Codex => Ok(crate::shared::codex_core::session_key_for_provider(
            workspace_id,
            provider_profile_id,
        )),
        EngineType::Claude => Ok(crate::engine::claude::provider_profile::claude_runtime_key(
            workspace_id,
            provider_profile_id,
        )),
        EngineType::Kimi => Ok(crate::engine::kimi_provider_profile::kimi_runtime_key(
            workspace_id,
            provider_profile_id
                .unwrap_or(crate::engine::kimi_provider_profile::KIMI_LOCAL_PROVIDER_PROFILE_ID),
        )),
        EngineType::Grok => Ok(crate::engine::grok_provider_profile::grok_runtime_key(
            workspace_id,
            provider_profile_id
                .unwrap_or(crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID),
        )),
        EngineType::OpenCode => Ok(
            crate::engine::opencode_provider_profile::opencode_runtime_key(
                workspace_id,
                provider_profile_id,
            ),
        ),
        engine if engine.is_pi_family() => Ok(
            crate::engine::pi_provider_profile::pi_family_runtime_key(
                engine,
                workspace_id,
                provider_profile_id,
            ),
        ),
        // qoder_runtime_key 内部兼容 None / legacy sentinel → Qoder Global，并为
        // Global/CN 分配彼此隔离的 runtime key。
        EngineType::Qoder => crate::engine::qoder_provider_profile::qoder_runtime_key(
            workspace_id,
            provider_profile_id,
        ),
        _ => Err("dispatch receipt has unsupported Shared engine".to_string()),
    }
}

pub(crate) fn validate_runtime_dispatch_receipt(
    response: &Value,
    owner: &DurableAttemptOwner,
    workspace_id: &str,
) -> Result<Value, String> {
    let receipt = response
        .get("mossxDispatchReceipt")
        .ok_or_else(|| "dispatch receipt is missing".to_string())?;
    if receipt_nullable_string(receipt, "engine")? != Some(owner.engine.icon()) {
        return Err("dispatch receipt engine does not match durable attempt".to_string());
    }
    if receipt_nullable_string(receipt, "providerProfileId")?
        != owner.provider_profile_id.as_deref()
    {
        return Err("dispatch receipt Provider does not match durable attempt".to_string());
    }
    let expected_provider_source = if owner.provider_profile_id.is_some() {
        "managed"
    } else {
        "local"
    };
    if receipt_nullable_string(receipt, "providerProfileSource")? != Some(expected_provider_source)
    {
        return Err("dispatch receipt Provider source does not match durable attempt".to_string());
    }
    if receipt_nullable_string(receipt, "model")? != owner.target.model.as_deref() {
        return Err("dispatch receipt Model does not match durable attempt".to_string());
    }
    if receipt_nullable_string(receipt, "reasoningEffort")?
        != owner.target.reasoning_effort.as_deref()
    {
        return Err("dispatch receipt Reasoning does not match durable attempt".to_string());
    }
    let expected_runtime_key = provider_runtime_key_for_target(
        workspace_id,
        owner.engine,
        owner.provider_profile_id.as_deref(),
    )?;
    if receipt_nullable_string(receipt, "providerRuntimeKey")?
        != Some(expected_runtime_key.as_str())
    {
        return Err(
            "dispatch receipt Provider Runtime key does not match durable attempt".to_string(),
        );
    }
    Ok(receipt.clone())
}

pub(crate) fn typed_dispatch_error(code: &str, error: &str) -> String {
    let prefix = format!("{code}:");
    if error.starts_with(&prefix) {
        error.to_string()
    } else {
        format!("{code}: {error}")
    }
}

pub(crate) fn failed_runtime_snapshot(code: &str, message: &str) -> RuntimeFinalSnapshot {
    RuntimeFinalSnapshot {
        assistant_blocks: vec![],
        assistant_text: None,
        tool_calls: vec![],
        tool_results: vec![],
        artifacts: vec![],
        provider_private_refs: vec![],
        omissions: vec![],
        outcome: OutcomeStatus::Failed,
        error_code: Some(code.to_string()),
        error_message: Some(message.to_string()),
        stop_reason: Some("runtime-rejected".to_string()),
    }
}

pub(crate) fn runtime_terminal_delivery(
    settled: &crate::shared_runtime_coordinator::SettledSharedRuntimeAttempt,
) -> Value {
    let outcome = match settled.final_snapshot.outcome {
        OutcomeStatus::Completed => "completed",
        OutcomeStatus::Failed => "failed",
        OutcomeStatus::Cancelled | OutcomeStatus::Replaced => "cancelled",
    };
    let recovery_reason = (settled.owner.engine == EngineType::Claude
        && settled.final_snapshot.outcome == OutcomeStatus::Failed
        && settled
            .final_snapshot
            .error_message
            .as_deref()
            .is_some_and(crate::shared_runtime_coordinator::is_missing_native_session_error))
    .then_some("native-session-not-found");
    json!({
        "type": "run.settled",
        "outcome": outcome,
        "recoveryReason": recovery_reason,
    })
}

pub(crate) fn committed_terminal_response(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    binding_key: &str,
) -> Result<Option<Value>, String> {
    let committed = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id)
        });
    let Some(event) = committed else {
        return Ok(None);
    };
    let fact = serde_json::from_str::<CanonicalFact>(&event.payload_json)
        .map_err(|error| format!("parse committed terminal for attempt {attempt_id}: {error}"))?;
    let CanonicalFact::TurnCommitted(committed) = fact else {
        return Err(format!(
            "invalid conversation.turnCommitted payload for attempt {attempt_id}"
        ));
    };
    let outcome = match committed.outcome.status {
        OutcomeStatus::Completed => "completed",
        OutcomeStatus::Failed => "failed",
        OutcomeStatus::Cancelled | OutcomeStatus::Replaced => "cancelled",
    };
    let recovery_reason = (committed.outcome.status == OutcomeStatus::Failed
        && committed
            .outcome
            .error_message
            .as_deref()
            .is_some_and(crate::shared_runtime_coordinator::is_missing_native_session_error))
    .then_some("native-session-not-found");
    Ok(Some(json!({
        "status": "committed",
        "duplicate": true,
        "sequence": event.sequence,
        "bindingKey": binding_key,
        "terminal": {
            "type": "run.settled",
            "outcome": outcome,
            "recoveryReason": recovery_reason,
        },
    })))
}

#[tauri::command]
pub(crate) async fn shared_context_retrieve_artifact(
    workspace_id: String,
    thread_id: String,
    artifact_id: String,
    checksum: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let artifact = read_artifact(
        context_artifact_root(&state)?,
        &ArtifactReadRequest {
            workspace_id,
            session_id: shared_session_id,
            artifact_id,
            checksum,
        },
    )?;
    serde_json::to_value(artifact).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn shared_context_scan_orphans(
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    // ponytail: report-only maintenance path，按 artifact 读取 session events；
    // artifact 量显著增长后可升级为一次性 packageId index。
    let paths = scan_orphan_artifacts(context_artifact_root(&state)?, |artifact| {
        writer
            .events_for_session(&artifact.session_id)
            .ok()
            .is_some_and(|events| {
                events.iter().any(|event| {
                    if event.fact_type != "context.deliveryPrepared" {
                        return false;
                    }
                    serde_json::from_str::<Value>(&event.payload_json)
                        .ok()
                        .and_then(|payload| {
                            payload
                                .get("packageId")
                                .and_then(Value::as_str)
                                .map(|package_id| package_id == artifact.package.package_id)
                        })
                        .unwrap_or(false)
                })
            })
    })?;
    Ok(json!({
        "status": "report-only",
        "paths": paths,
    }))
}

#[tauri::command]
pub(crate) async fn shared_session_v2_await_turn_terminal(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;

    if let Some(committed) =
        committed_terminal_response(writer, &shared_session_id, &attempt_id, &owner.binding_key)?
    {
        return Ok(committed);
    }

    let settlement = state
        .shared_runtime_coordinator
        .wait_for_settlement(&attempt_id)
        .await;

    if let Some(settled) = settlement {
        if let Err(commit_error) = commit_observed_runtime_settlement(&state, settled) {
            // 另一 critical sink 可能已经抢先完成幂等 commit/remove。
            if let Some(committed) = committed_terminal_response(
                writer,
                &shared_session_id,
                &attempt_id,
                &owner.binding_key,
            )? {
                return Ok(committed);
            }
            return Err(commit_error);
        }
    }

    committed_terminal_response(writer, &shared_session_id, &attempt_id, &owner.binding_key)?
        .ok_or_else(|| {
            format!(
                "ambiguous-runtime: attempt {attempt_id} owner ended without durable conversation.turnCommitted"
            )
        })
}

/// 重启恢复（B.6.5）：返回 durable evidence，前端据此恢复 running/settling/recovery-required，
/// 而不是落回 idle。只读。
#[tauri::command]
pub(crate) async fn shared_session_v2_turn_state(
    workspace_id: String,
    thread_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;

    let events = writer
        .events_for_session(&shared_session_id)
        .map_err(|error| error.to_string())?;
    let in_flight = unresolved_attempt_evidence(writer, &shared_session_id, None)?;
    let mut binding_keys = std::collections::HashSet::new();
    binding_keys.extend(
        in_flight
            .iter()
            .map(|evidence| evidence.owner.binding_key.clone()),
    );
    for event in &events {
        if let Ok(payload) = serde_json::from_str::<Value>(&event.payload_json) {
            if let Some(binding_key) = payload.get("bindingKey").and_then(Value::as_str) {
                binding_keys.insert(binding_key.to_string());
            }
        }
    }

    let mut bindings = Vec::new();
    for binding_key in binding_keys {
        if let Some(row) = writer
            .binding_state(&shared_session_id, &binding_key)
            .map_err(|error| error.to_string())?
        {
            bindings.push(json!({
                "bindingKey": row.binding_key,
                "provisioningState": provisioning_state_of(&row),
                "availability": row.availability,
            }));
        }
    }

    Ok(json!({
        "status": "ok",
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
                "runtimeObserverOwned": state
                    .shared_runtime_coordinator
                    .owns_attempt(attempt_id),
            })})
            .collect::<Vec<_>>(),
        "bindings": bindings,
    }))
}

