use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::State;
use uuid::Uuid;
use crate::engine::EngineType;
use crate::shared_context::{PendingDelivery, terminal_binding_update};
use crate::shared_event_log::canonical::assembler::{
    RuntimeFinalSnapshot,
    RuntimeToolCall,
    RuntimeToolResult,
};
use crate::shared_event_log::canonical::sink;
use crate::shared_event_log::canonical::types::{
    ArtifactRef,
    CanonicalFact,
    CanonicalUserInput,
    OutcomeStatus,
    TurnAcceptedFact,
    TurnExecutionSnapshot,
    TurnRequestedFact,
};
use crate::shared_event_log::{
    AppendOutcome,
    BindingStateUpdate,
    deterministic_json_bytes,
    LegacyImportRow,
    SharedEventWriter,
    StoredBindingState,
};
use crate::shared_sessions::{
    ensure_supported_shared_session_engine,
    now_millis,
    parse_shared_session_id,
    read_latest_shared_session_snapshot,
    read_shared_session_meta,
    shared_session_projection_source,
    shared_target_binding_key,
    SharedSelectedTarget,
};
use crate::state::AppState;

use super::binding_state::{
    append_control_fact,
    binding_operation_id_of,
    binding_row_update,
    NativeContextTrust,
    PROVISIONING_CREATING,
    provisioning_json,
    PROVISIONING_PREPARED,
    PROVISIONING_READY,
    PROVISIONING_RECOVERY_REQUIRED,
    provisioning_state_of,
    requested_binding_operation_id,
    require_shared_session_workspace_owner,
    require_writer,
    upsert_binding_row,
};
use super::dispatch_settlement::commit_observed_runtime_settlement;
use super::execution_target::{
    ExecutionTargetInput,
    validate_qoder_distribution_identity,
    validate_resolved_execution_target,
};
use super::receipt::provider_runtime_key_for_target;
use super::{committed_attempt_sequence, shared_session_v2_interrupt_turn};

/// commit_turn 的 outcome 输入。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOutcomeInput {
    pub status: String,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub stop_reason: Option<String>,
}

fn parse_outcome_status(raw: &str) -> Result<OutcomeStatus, String> {
    match raw {
        "completed" => Ok(OutcomeStatus::Completed),
        "failed" => Ok(OutcomeStatus::Failed),
        "cancelled" => Ok(OutcomeStatus::Cancelled),
        "replaced" => Ok(OutcomeStatus::Replaced),
        other => Err(format!("Unknown outcome status: {other}")),
    }
}

// ---------------------------------------------------------------------------
// Durable provisioning（B.4）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BeginTurnStatus {
    Creating,
    RecoveryRequired,
    TargetUnavailable,
}

#[derive(Debug)]
pub struct BeginTurnOutcome {
    pub status: BeginTurnStatus,
    pub reason: Option<String>,
    pub attempt_id: Option<String>,
    pub logical_turn_id: Option<String>,
    pub binding_key: String,
    pub snapshot: Option<TurnExecutionSnapshot>,
}

fn unresolved_session_operation(
    writer: &SharedEventWriter,
    session_id: &str,
) -> Result<Option<(String, String)>, String> {
    let events = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())?;
    let committed_attempts = events
        .iter()
        .filter(|event| event.fact_type == "conversation.turnCommitted")
        .filter_map(|event| event.attempt_id.clone())
        .collect::<std::collections::HashSet<_>>();
    for event in &events {
        let Some(attempt_id) = event.attempt_id.as_deref() else {
            continue;
        };
        if event.fact_type != "conversation.turnRequested"
            || committed_attempts.contains(attempt_id)
        {
            continue;
        }
        let fact = serde_json::from_str::<CanonicalFact>(&event.payload_json)
            .map_err(|error| format!("parse unresolved turnRequested: {error}"))?;
        let CanonicalFact::TurnRequested(requested) = fact else {
            return Err("invalid unresolved turnRequested payload".to_string());
        };
        if requested
            .extra
            .get("squadWorkerBindingKey")
            .and_then(Value::as_str)
            .is_some_and(|value| !value.trim().is_empty())
        {
            continue;
        }
        let target = target_input_from_snapshot(&requested.target)?;
        let engine = ensure_supported_shared_session_engine(target.engine)?;
        let binding_key =
            shared_target_binding_key(engine, target.normalized_provider().as_deref());
        return Ok(Some((binding_key, attempt_id.to_string())));
    }
    Ok(None)
}

fn recover_creating_binding(
    writer: &SharedEventWriter,
    session_id: &str,
    row: &StoredBindingState,
) -> Result<(), String> {
    let engine = serde_json::from_value::<EngineType>(Value::String(row.engine.clone()))
        .map_err(|_| {
            format!(
                "binding {} has unsupported engine '{}'",
                row.binding_key, row.engine
            )
        })
        .and_then(ensure_supported_shared_session_engine)?;
    let durable_binding_key = shared_target_binding_key(engine, row.provider_profile_id.as_deref());
    if durable_binding_key != row.binding_key {
        return Err(format!(
            "binding owner mismatch: key '{}' does not match durable owner '{durable_binding_key}'",
            row.binding_key
        ));
    }
    mark_recovery_core(
        writer,
        session_id,
        &row.binding_key,
        engine,
        row.provider_profile_id.clone(),
        Some("provisioning-crash-window"),
    )
}

/// Dispatch 附图：调用方显式路径优先；否则从 durable TurnRequested.image_refs.locator 回填。
/// 协作编排只在 begin 写入 image_refs，drive 侧不重传图，必须走此 SSOT。
pub(crate) fn resolve_dispatch_images(
    images: Option<Vec<String>>,
    input: &crate::shared_event_log::canonical::types::CanonicalUserInput,
) -> Option<Vec<String>> {
    let from_param: Vec<String> = images
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect();
    if !from_param.is_empty() {
        return Some(from_param);
    }
    let from_refs: Vec<String> = input
        .image_refs
        .as_ref()
        .into_iter()
        .flatten()
        .map(|artifact| artifact.locator.trim().to_string())
        .filter(|path| !path.is_empty())
        .collect();
    if from_refs.is_empty() {
        None
    } else {
        Some(from_refs)
    }
}

/// 用户本地附图路径 → 合法 ArtifactRef（UI projection 用 locator）。
/// sha256 优先文件内容；不可读时用 path bytes，满足 validator 64 hex。
fn user_image_paths_to_artifact_refs(paths: Option<Vec<String>>) -> Option<Vec<ArtifactRef>> {
    let paths = paths?;
    let mut refs = Vec::new();
    for path in paths {
        let locator = path.trim().to_string();
        if locator.is_empty() {
            continue;
        }
        let (sha_hex, size_bytes) = match std::fs::read(&locator) {
            Ok(bytes) => {
                let size = bytes.len() as i64;
                (format!("{:x}", Sha256::digest(&bytes)), Some(size))
            }
            Err(_) => (format!("{:x}", Sha256::digest(locator.as_bytes())), None),
        };
        let media_type = guess_user_image_media_type(&locator);
        let artifact_id = format!(
            "user-image-{}",
            sha_hex.get(..16).unwrap_or(sha_hex.as_str())
        );
        refs.push(ArtifactRef {
            artifact_id,
            media_type,
            size_bytes,
            sha256: sha_hex,
            locator,
            redaction: None,
            extra: Value::Object(Default::default()),
        });
    }
    if refs.is_empty() {
        None
    } else {
        Some(refs)
    }
}

fn guess_user_image_media_type(path: &str) -> String {
    let lower = path.to_ascii_lowercase();
    if lower.ends_with(".png") {
        "image/png".to_string()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".to_string()
    } else if lower.ends_with(".gif") {
        "image/gif".to_string()
    } else if lower.ends_with(".webp") {
        "image/webp".to_string()
    } else if lower.ends_with(".bmp") {
        "image/bmp".to_string()
    } else if lower.ends_with(".svg") {
        "image/svg+xml".to_string()
    } else {
        "image/*".to_string()
    }
}

pub fn begin_turn_core(
    writer: &SharedEventWriter,
    session_id: &str,
    target: &ExecutionTargetInput,
    text: String,
    images: Option<Vec<String>>,
) -> Result<BeginTurnOutcome, String> {
    let engine = match ensure_supported_shared_session_engine(target.engine) {
        Ok(engine) => engine,
        Err(reason) => {
            return Ok(BeginTurnOutcome {
                status: BeginTurnStatus::TargetUnavailable,
                reason: Some(reason),
                attempt_id: None,
                logical_turn_id: None,
                binding_key: String::new(),
                snapshot: None,
            });
        }
    };
    let provider_profile_id = target.normalized_provider();
    if let Err(reason) =
        validate_qoder_distribution_identity(engine, provider_profile_id.as_deref())
    {
        return Ok(BeginTurnOutcome {
            status: BeginTurnStatus::TargetUnavailable,
            reason: Some(reason),
            attempt_id: None,
            logical_turn_id: None,
            binding_key: String::new(),
            snapshot: None,
        });
    }
    let binding_key = shared_target_binding_key(engine, provider_profile_id.as_deref());
    if let Some((pending_binding_key, pending_attempt_id)) =
        unresolved_session_operation(writer, session_id)?
    {
        let pending_binding = writer
            .binding_state(session_id, &pending_binding_key)
            .map_err(|error| error.to_string())?;
        if let Some(row) = pending_binding.as_ref() {
            match provisioning_state_of(row).as_str() {
                PROVISIONING_CREATING => {
                    recover_creating_binding(writer, session_id, row)?;
                    return Ok(BeginTurnOutcome {
                        status: BeginTurnStatus::RecoveryRequired,
                        reason: Some("provisioning-crash-window".to_string()),
                        attempt_id: None,
                        logical_turn_id: None,
                        binding_key: pending_binding_key,
                        snapshot: None,
                    });
                }
                PROVISIONING_RECOVERY_REQUIRED => {
                    return Ok(BeginTurnOutcome {
                        status: BeginTurnStatus::RecoveryRequired,
                        reason: None,
                        attempt_id: None,
                        logical_turn_id: None,
                        binding_key: pending_binding_key,
                        snapshot: None,
                    });
                }
                _ => {}
            }
        }
        return Ok(BeginTurnOutcome {
            status: BeginTurnStatus::RecoveryRequired,
            reason: Some(format!(
                "session has unresolved context delivery for attempt {pending_attempt_id}"
            )),
            attempt_id: None,
            logical_turn_id: None,
            binding_key: pending_binding_key,
            snapshot: None,
        });
    }

    let existing = writer
        .binding_state(session_id, &binding_key)
        .map_err(|error| error.to_string())?;
    if let Some(row) = existing.as_ref() {
        match provisioning_state_of(row).as_str() {
            PROVISIONING_RECOVERY_REQUIRED => {
                return Ok(BeginTurnOutcome {
                    status: BeginTurnStatus::RecoveryRequired,
                    reason: None,
                    attempt_id: None,
                    logical_turn_id: None,
                    binding_key,
                    snapshot: None,
                });
            }
            // 上次 attempt 崩溃在 creating 窗口：fail closed，禁止盲目重建（D6）。
            PROVISIONING_CREATING => {
                recover_creating_binding(writer, session_id, row)?;
                return Ok(BeginTurnOutcome {
                    status: BeginTurnStatus::RecoveryRequired,
                    reason: Some("provisioning-crash-window".to_string()),
                    attempt_id: None,
                    logical_turn_id: None,
                    binding_key,
                    snapshot: None,
                });
            }
            _ => {}
        }
    }

    let snapshot = target.to_snapshot();
    let attempt_id = Uuid::new_v4().to_string();
    let logical_turn_id = Uuid::new_v4().to_string();
    let binding_operation_id = existing
        .as_ref()
        .and_then(binding_operation_id_of)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let binding_has_native_identity = existing
        .as_ref()
        .and_then(|row| row.native_session_id.as_deref())
        .is_some_and(|native_session_id| !native_session_id.trim().is_empty());
    let initial_provisioning_state = if binding_has_native_identity {
        PROVISIONING_READY
    } else {
        PROVISIONING_PREPARED
    };
    let initial_availability = if binding_has_native_identity {
        "ready"
    } else {
        "provisioning"
    };

    // Tx1：User Intent 与 provisioning owner 同一 transaction 落盘，先于任何
    // Runtime side effect。禁止 prepared / turnRequested / creating 三次独立写入，
    // 否则任一中间 crash 都会留下无法按 Attempt 恢复的半状态。
    let requested_at = now_millis() as i64;
    let fact = CanonicalFact::TurnRequested(TurnRequestedFact {
        logical_turn_id: logical_turn_id.clone(),
        attempt_id: attempt_id.clone(),
        retry_of_attempt_id: None,
        input: CanonicalUserInput {
            text: Some(text),
            // Shared 共有路径：用户附图必须 durable，否则 projection 无图 → 双气泡/丢图
            image_refs: user_image_paths_to_artifact_refs(images),
            attachment_refs: None,
            extra: Value::Object(Default::default()),
        },
        target: snapshot.clone(),
        requested_at,
        extra: json!({
            "bindingOperationId": binding_operation_id,
        }),
    });
    let binding = binding_row_update(
        session_id,
        &binding_key,
        engine,
        provider_profile_id,
        existing.as_ref(),
        None,
        None,
        provisioning_json(
            initial_provisioning_state,
            None,
            Some(&attempt_id),
            Some(&binding_operation_id),
            existing.as_ref(),
            // 新 attempt：有 ready native 则沿用 trust；无 native 默认 dirty。
            None,
        ),
        initial_availability,
    );
    writer
        .append_turn_requested_with_binding_at(session_id.to_string(), fact, requested_at, &binding)
        .map_err(|error| error.to_string())?;

    Ok(BeginTurnOutcome {
        status: BeginTurnStatus::Creating,
        reason: None,
        attempt_id: Some(attempt_id),
        logical_turn_id: Some(logical_turn_id),
        binding_key,
        snapshot: Some(snapshot),
    })
}

/// Squad Worker 专用 Tx1。它复用 Shared V2 lifecycle，但使用 run/node scoped Binding，
/// 因此不参与主对话的 linear unresolved-attempt guard。
#[allow(clippy::too_many_arguments)]
pub(crate) fn begin_squad_worker_turn_core(
    writer: &SharedEventWriter,
    session_id: &str,
    target: &ExecutionTargetInput,
    text: String,
    // 仅首段协作节点可带图；后续段传 None
    images: Option<Vec<String>>,
    run_id: &str,
    node_id: &str,
    worker_role: &str,
    permission_class: &str,
    expose_final: bool,
    context_identity: Value,
    attempt_id: String,
    logical_turn_id: String,
) -> Result<BeginTurnOutcome, String> {
    let engine = validate_resolved_execution_target(target)?;
    let provider_profile_id = target.normalized_provider();
    let base_binding_key = shared_target_binding_key(engine, provider_profile_id.as_deref());
    let binding_key = format!("squad:{run_id}:{node_id}:{base_binding_key}");
    let existing = writer
        .binding_state(session_id, &binding_key)
        .map_err(|error| error.to_string())?;
    if let Some(row) = existing.as_ref() {
        match provisioning_state_of(row).as_str() {
            PROVISIONING_RECOVERY_REQUIRED => {
                return Ok(BeginTurnOutcome {
                    status: BeginTurnStatus::RecoveryRequired,
                    reason: Some("squad-worker-binding-recovery-required".to_string()),
                    attempt_id: None,
                    logical_turn_id: None,
                    binding_key,
                    snapshot: None,
                });
            }
            PROVISIONING_CREATING => {
                mark_recovery_core(
                    writer,
                    session_id,
                    &binding_key,
                    engine,
                    provider_profile_id,
                    Some("squad-worker-provisioning-crash-window"),
                )?;
                return Ok(BeginTurnOutcome {
                    status: BeginTurnStatus::RecoveryRequired,
                    reason: Some("squad-worker-provisioning-crash-window".to_string()),
                    attempt_id: None,
                    logical_turn_id: None,
                    binding_key,
                    snapshot: None,
                });
            }
            _ => {}
        }
    }

    let snapshot = target.to_snapshot();
    let binding_operation_id = existing
        .as_ref()
        .and_then(binding_operation_id_of)
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let binding_has_native_identity = existing
        .as_ref()
        .and_then(|row| row.native_session_id.as_deref())
        .is_some_and(|native_session_id| !native_session_id.trim().is_empty());
    let initial_provisioning_state = if binding_has_native_identity {
        PROVISIONING_READY
    } else {
        PROVISIONING_PREPARED
    };
    let initial_availability = if binding_has_native_identity {
        "ready"
    } else {
        "provisioning"
    };
    let requested_at = now_millis() as i64;
    let fact = CanonicalFact::TurnRequested(TurnRequestedFact {
        logical_turn_id: logical_turn_id.clone(),
        attempt_id: attempt_id.clone(),
        retry_of_attempt_id: None,
        input: CanonicalUserInput {
            text: Some(text),
            image_refs: user_image_paths_to_artifact_refs(images),
            attachment_refs: None,
            extra: Value::Object(Default::default()),
        },
        target: snapshot.clone(),
        requested_at,
        extra: json!({
            "bindingOperationId": binding_operation_id,
            "squadWorkerBindingKey": binding_key,
            "squadRunId": run_id,
            "squadNodeId": node_id,
            "squadWorkerRole": worker_role,
            "squadPermissionClass": permission_class,
            "squadExposeFinal": expose_final,
            "squadContextIdentity": context_identity,
        }),
    });
    let binding = binding_row_update(
        session_id,
        &binding_key,
        engine,
        provider_profile_id,
        existing.as_ref(),
        None,
        None,
        provisioning_json(
            initial_provisioning_state,
            None,
            Some(&attempt_id),
            Some(&binding_operation_id),
            existing.as_ref(),
            None,
        ),
        initial_availability,
    );
    writer
        .append_canonical_fact_with_binding_at(session_id.to_string(), fact, requested_at, &binding)
        .map_err(|error| error.to_string())?;

    Ok(BeginTurnOutcome {
        status: BeginTurnStatus::Creating,
        reason: None,
        attempt_id: Some(attempt_id),
        logical_turn_id: Some(logical_turn_id),
        binding_key,
        snapshot: Some(snapshot),
    })
}

// ---------------------------------------------------------------------------
// B.3 core：typed prompt ACK → turnAccepted
// ---------------------------------------------------------------------------

pub(crate) fn requested_fact_for_attempt(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
) -> Result<TurnRequestedFact, String> {
    let fact = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnRequested"
                && event.attempt_id.as_deref() == Some(attempt_id)
        })
        .ok_or_else(|| format!("no matching turnRequested for attempt {attempt_id}"))
        .and_then(|event| {
            serde_json::from_str::<CanonicalFact>(&event.payload_json)
                .map_err(|error| format!("parse turnRequested payload: {error}"))
        })?;
    match fact {
        CanonicalFact::TurnRequested(requested) => Ok(requested),
        _ => Err(format!(
            "invalid turnRequested payload for attempt {attempt_id}"
        )),
    }
}

#[derive(Debug, Clone)]
pub(crate) struct DurableAttemptOwner {
    pub(crate) requested: TurnRequestedFact,
    pub(crate) target: ExecutionTargetInput,
    pub(crate) engine: EngineType,
    pub(crate) provider_profile_id: Option<String>,
    pub(crate) binding_key: String,
    pub(crate) binding_operation_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedAttemptInterruptRoute {
    pub(crate) attempt_id: String,
    pub(crate) engine: EngineType,
    pub(crate) provider_profile_id: Option<String>,
    pub(crate) binding_key: String,
    pub(crate) native_thread_id: String,
    pub(crate) runtime_turn_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SharedCompactionRoute {
    pub(crate) engine: EngineType,
    pub(crate) provider_profile_id: Option<String>,
    pub(crate) native_thread_id: String,
    pub(crate) has_unresolved_attempt: bool,
}

pub(crate) fn resolve_shared_compaction_route(
    state: &AppState,
    workspace_id: &str,
    thread_id: &str,
) -> Result<SharedCompactionRoute, String> {
    let writer = require_writer(state)?;
    let shared_session_id = parse_shared_session_id(thread_id)?;
    require_shared_session_workspace_owner(workspace_id, &shared_session_id)?;
    resolve_shared_compaction_route_core(writer, &shared_session_id, || {
        resolve_durable_shared_compaction_target(writer, &shared_session_id)
    })
}

pub(crate) fn resolve_durable_shared_compaction_target(
    writer: &SharedEventWriter,
    shared_session_id: &str,
) -> Result<(EngineType, Option<String>), String> {
    let stored_target = writer
        .session_target(shared_session_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            format!(
                "shared-compaction-target-unavailable: session {shared_session_id} has no durable V2 Target"
            )
        })?;
    let target: SharedSelectedTarget =
        serde_json::from_str(&stored_target.selected_target_json).map_err(|error| {
            format!(
                "shared-compaction-target-invalid: session {shared_session_id} durable Target is invalid: {error}"
            )
        })?;
    let engine = ensure_supported_shared_session_engine(target.engine)
        .map_err(|error| format!("shared-compaction-target-unavailable: {error}"))?;
    let provider_profile_id = target
        .provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok((engine, provider_profile_id))
}

pub(crate) fn resolve_shared_compaction_route_core<F>(
    writer: &SharedEventWriter,
    shared_session_id: &str,
    resolve_selected_target: F,
) -> Result<SharedCompactionRoute, String>
where
    F: FnOnce() -> Result<(EngineType, Option<String>), String>,
{
    let unresolved = unresolved_attempt_evidence(writer, &shared_session_id, None)?;
    if unresolved.len() > 1 {
        return Err(format!(
            "shared-compaction-owner-ambiguous: session {shared_session_id} has {} unresolved attempts",
            unresolved.len()
        ));
    }

    let (engine, provider_profile_id, binding_key, binding_operation_id) =
        if let Some(evidence) = unresolved.first() {
            (
                evidence.owner.engine,
                evidence.owner.provider_profile_id.clone(),
                evidence.owner.binding_key.clone(),
                Some(evidence.owner.binding_operation_id.as_str()),
            )
        } else {
            let (engine, provider_profile_id) = resolve_selected_target()?;
            (
                engine,
                provider_profile_id.clone(),
                shared_target_binding_key(engine, provider_profile_id.as_deref()),
                None,
            )
        };

    if !matches!(engine, EngineType::Codex | EngineType::Claude) {
        return Err(format!(
            "shared-compaction-unsupported: {} does not support context compaction",
            engine.icon()
        ));
    }

    let binding = writer
        .binding_state(&shared_session_id, &binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| {
            format!("shared-compaction-binding-unavailable: binding {binding_key} is missing")
        })?;
    if binding.engine != engine.icon()
        || binding.provider_profile_id.as_deref() != provider_profile_id.as_deref()
    {
        return Err(format!(
            "shared-compaction-owner-mismatch: binding {binding_key} does not match durable Target"
        ));
    }
    if let Some(expected_operation_id) = binding_operation_id {
        let actual_operation_id = binding_operation_id_of(&binding).unwrap_or_default();
        if actual_operation_id != expected_operation_id {
            return Err(format!(
                "shared-compaction-owner-mismatch: binding generation changed for {binding_key}"
            ));
        }
    }
    if binding.availability != "ready" {
        return Err(format!(
            "shared-compaction-binding-unavailable: binding {binding_key} is {}",
            binding.availability
        ));
    }
    let provisioning_state = provisioning_state_of(&binding);
    if provisioning_state != PROVISIONING_READY {
        return Err(format!(
            "shared-compaction-binding-unavailable: binding {binding_key} provisioning state is {provisioning_state}"
        ));
    }
    let native_thread_id = binding
        .native_session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            format!(
                "shared-compaction-binding-unavailable: binding {binding_key} has no native session"
            )
        })?;

    Ok(SharedCompactionRoute {
        engine,
        provider_profile_id,
        native_thread_id,
        has_unresolved_attempt: !unresolved.is_empty(),
    })
}

pub(crate) fn resolve_shared_attempt_interrupt_route(
    writer: &SharedEventWriter,
    coordinator: &crate::shared_runtime_coordinator::SharedRuntimeCoordinator,
    workspace_id: &str,
    thread_id: &str,
    attempt_id: &str,
) -> Result<SharedAttemptInterruptRoute, String> {
    let shared_session_id = parse_shared_session_id(thread_id)?;
    let durable_owner = durable_attempt_owner(writer, &shared_session_id, attempt_id)?;
    let runtime_owner = coordinator.owner_for_attempt(attempt_id).ok_or_else(|| {
        format!("shared-control-owner-unavailable: runtime owner missing for attempt {attempt_id}")
    })?;
    let expected_provider_runtime_key = provider_runtime_key_for_target(
        workspace_id,
        durable_owner.engine,
        durable_owner.provider_profile_id.as_deref(),
    )?;
    if runtime_owner.workspace_id != workspace_id
        || runtime_owner.provider_runtime_key != expected_provider_runtime_key
        || runtime_owner.shared_thread_id != thread_id
        || runtime_owner.shared_session_id != shared_session_id
        || runtime_owner.attempt_id != attempt_id
        || runtime_owner.logical_turn_id != durable_owner.requested.logical_turn_id
        || runtime_owner.binding_key != durable_owner.binding_key
        || runtime_owner.binding_operation_id != durable_owner.binding_operation_id
        || runtime_owner.engine != durable_owner.engine
        || runtime_owner.execution_target_snapshot != durable_owner.requested.target
    {
        return Err(format!(
            "shared-control-owner-mismatch: durable/runtime owner mismatch for attempt {attempt_id}"
        ));
    }
    let native_thread_id = runtime_owner
        .native_session_id
        .as_deref()
        .map(str::trim)
        .filter(|identity| !identity.is_empty())
        .ok_or_else(|| {
            format!(
                "shared-control-owner-unavailable: native thread identity missing for attempt {attempt_id}"
            )
        })?
        .to_string();
    let runtime_turn_id = runtime_owner
        .runtime_turn_id
        .as_deref()
        .map(str::trim)
        .filter(|identity| !identity.is_empty())
        .ok_or_else(|| {
            format!(
                "shared-control-owner-unavailable: runtime turn identity missing for attempt {attempt_id}"
            )
        })?
        .to_string();
    Ok(SharedAttemptInterruptRoute {
        attempt_id: attempt_id.to_string(),
        engine: durable_owner.engine,
        provider_profile_id: durable_owner.provider_profile_id,
        binding_key: durable_owner.binding_key,
        native_thread_id,
        runtime_turn_id,
    })
}

pub(crate) fn target_input_from_snapshot(
    snapshot: &TurnExecutionSnapshot,
) -> Result<ExecutionTargetInput, String> {
    let engine = serde_json::from_value::<EngineType>(Value::String(snapshot.engine.clone()))
        .map_err(|_| {
            format!(
                "target-unavailable: unsupported engine '{}'",
                snapshot.engine
            )
        })?;
    Ok(ExecutionTargetInput {
        engine,
        provider_profile_id: snapshot.provider_profile_id.clone(),
        model_catalog_entry_id: snapshot.model_catalog_entry_id.clone(),
        model: snapshot.model.clone(),
        reasoning_effort: snapshot
            .reasoning
            .as_ref()
            .map(|reasoning| reasoning.effort.clone()),
        provider_profile_name_snapshot: snapshot.provider_profile_name_snapshot.clone(),
        provider_profile_source: snapshot.provider_profile_source,
        runtime_capability_fingerprint: snapshot.runtime_capability_fingerprint.clone(),
    })
}

pub(crate) fn durable_attempt_owner(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
) -> Result<DurableAttemptOwner, String> {
    let requested = requested_fact_for_attempt(writer, session_id, attempt_id)?;
    let target = target_input_from_snapshot(&requested.target)?;
    let engine = ensure_supported_shared_session_engine(target.engine)
        .map_err(|error| format!("target-unavailable: {error}"))?;
    let provider_profile_id = target.normalized_provider();
    let binding_key = requested
        .extra
        .get("squadWorkerBindingKey")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| shared_target_binding_key(engine, provider_profile_id.as_deref()));
    // Legacy V2 facts 没有 generation。只在 durable row 仍是同一旧 Binding 时
    // 兼容读取；重建后新 row 会持有新的 operationId，后续新 Attempt 都显式冻结。
    let binding_operation_id = requested_binding_operation_id(&requested)
        .or_else(|| {
            writer
                .binding_state(session_id, &binding_key)
                .ok()
                .flatten()
                .as_ref()
                .and_then(binding_operation_id_of)
        })
        .unwrap_or_else(|| format!("legacy:{}", requested.attempt_id));
    Ok(DurableAttemptOwner {
        requested,
        target,
        engine,
        provider_profile_id,
        binding_key,
        binding_operation_id,
    })
}

pub(crate) fn scoped_attempt_access_mode(
    owner: &DurableAttemptOwner,
    requested: Option<String>,
) -> Result<Option<String>, String> {
    let is_squad = owner
        .requested
        .extra
        .get("squadWorkerBindingKey")
        .and_then(Value::as_str)
        .is_some_and(|value| !value.trim().is_empty());
    if !is_squad {
        return Ok(requested);
    }
    match owner
        .requested
        .extra
        .get("squadPermissionClass")
        .and_then(Value::as_str)
    {
        Some("read-only") => Ok(Some("read-only".to_string())),
        Some("current-workspace") => Ok(Some("squad-current-workspace".to_string())),
        _ => Err("squad-permission-invalid: durable permission class is missing".to_string()),
    }
}

pub(crate) fn validate_durable_attempt_target(owner: &DurableAttemptOwner) -> Result<(), String> {
    validate_resolved_execution_target(&owner.target)
        .map(|_| ())
        .map_err(|error| format!("target-unavailable: {error}"))
}

pub(crate) fn require_attempt_binding_generation(
    binding: &StoredBindingState,
    owner: &DurableAttemptOwner,
) -> Result<(), String> {
    let current_operation_id = binding_operation_id_of(binding).unwrap_or_else(|| {
        // Legacy rows and their legacy TurnRequested are one generation until an
        // explicit rebuild writes a real operationId.
        format!("legacy:{}", owner.requested.attempt_id)
    });
    if current_operation_id != owner.binding_operation_id {
        return Err(format!(
            "stale-runtime-terminal: binding generation changed for attempt {}",
            owner.requested.attempt_id
        ));
    }
    Ok(())
}

pub(crate) fn pending_delivery_for_owner(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
) -> Result<(StoredBindingState, PendingDelivery), String> {
    let binding = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    if binding.engine != owner.engine.icon()
        || binding.provider_profile_id != owner.provider_profile_id
    {
        return Err(format!(
            "binding owner mismatch for attempt {}",
            owner.requested.attempt_id
        ));
    }
    require_attempt_binding_generation(&binding, owner)?;
    let pending = binding
        .pending_delivery_json
        .as_deref()
        .ok_or_else(|| {
            format!(
                "pending context delivery missing for attempt {}",
                owner.requested.attempt_id
            )
        })
        .and_then(|raw| serde_json::from_str::<PendingDelivery>(raw).map_err(|e| e.to_string()))?;
    if pending.attempt_id != owner.requested.attempt_id
        || pending.client_turn_id != owner.requested.logical_turn_id
        || pending
            .binding_operation_id
            .as_deref()
            .is_some_and(|operation_id| operation_id != owner.binding_operation_id)
    {
        return Err(format!(
            "pending delivery owner mismatch for attempt {}",
            owner.requested.attempt_id
        ));
    }
    Ok((binding, pending))
}

pub(crate) fn accept_turn_for_attempt_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    native_session_id: &str,
    native_turn_id: Option<String>,
) -> Result<(), String> {
    let owner = durable_attempt_owner(writer, session_id, attempt_id)?;
    let native_session_id = native_session_id.trim();
    if native_session_id.is_empty() {
        return Err("typed prompt ACK missing native session identity".to_string());
    }
    let existing = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&existing, &owner)?;
    let accepted_at = now_millis() as i64;
    let binding = binding_row_update(
        session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id.clone(),
        Some(&existing),
        Some(native_session_id.to_string()),
        None,
        provisioning_json(
            PROVISIONING_READY,
            None,
            Some(attempt_id),
            Some(&owner.binding_operation_id),
            Some(&existing),
            None,
        ),
        "ready",
    );
    writer
        .append_canonical_fact_with_binding_at(
            session_id.to_string(),
            CanonicalFact::TurnAccepted(TurnAcceptedFact {
                logical_turn_id: owner.requested.logical_turn_id.clone(),
                attempt_id: attempt_id.to_string(),
                client_turn_id: owner.requested.logical_turn_id.clone(),
                binding_key: owner.binding_key.clone(),
                native_session_id: native_session_id.to_string(),
                native_turn_id,
                accepted_at,
                extra: json!({
                    "bindingOperationId": owner.binding_operation_id,
                }),
            }),
            accepted_at,
            &binding,
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub fn accept_turn_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    logical_turn_id: &str,
    target: &ExecutionTargetInput,
    native_session_id: &str,
) -> Result<(), String> {
    let requested = requested_fact_for_attempt(writer, session_id, attempt_id)
        .map_err(|error| format!("turnAccepted {error}"))?;
    if requested.logical_turn_id != logical_turn_id || requested.target != target.to_snapshot() {
        return Err(format!(
            "turnAccepted owner mismatch for attempt {attempt_id}"
        ));
    }
    accept_turn_for_attempt_core(writer, session_id, attempt_id, native_session_id, None)
}

// ---------------------------------------------------------------------------
// B.3 core：Tx2 commit_turn（settled → assembler/sink → turnCommitted，幂等）
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub struct CommitTurnOutcome {
    pub duplicate: bool,
    pub sequence: Option<i64>,
    pub binding_key: String,
}

pub(crate) fn commit_runtime_snapshot_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    final_snapshot: RuntimeFinalSnapshot,
    native_session_id: Option<&str>,
) -> Result<CommitTurnOutcome, String> {
    let owner = durable_attempt_owner(writer, session_id, attempt_id)
        .map_err(|error| format!("run.settled {error}"))?;
    let existing_binding = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&existing_binding, &owner)?;
    let events = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())?;
    let accepted = events
        .iter()
        .find(|event| {
            event.fact_type == "conversation.turnAccepted"
                && event.attempt_id.as_deref() == Some(attempt_id)
        })
        .map(|event| {
            serde_json::from_str::<CanonicalFact>(&event.payload_json)
                .map_err(|error| format!("parse turnAccepted payload: {error}"))
        })
        .transpose()?
        .and_then(|fact| match fact {
            CanonicalFact::TurnAccepted(accepted) => Some(accepted),
            _ => None,
        });
    if final_snapshot.outcome == OutcomeStatus::Completed && accepted.is_none() {
        return Err(format!(
            "run.settled arrived before typed prompt ACK for attempt {attempt_id}"
        ));
    }
    let effective_native_session_id = native_session_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            accepted
                .as_ref()
                .map(|accepted| accepted.native_session_id.clone())
        });

    // 同一 authoritative terminal snapshot 可安全重放；不同 snapshot 必须 fail loud。
    if let Some(existing) = events.iter().find(|event| {
        event.fact_type == "conversation.turnCommitted"
            && event.attempt_id.as_deref() == Some(attempt_id)
    }) {
        let existing_fact = serde_json::from_str::<CanonicalFact>(&existing.payload_json)
            .map_err(|error| format!("parse existing turnCommitted payload: {error}"))?;
        let CanonicalFact::TurnCommitted(existing_fact) = existing_fact else {
            return Err(format!(
                "invalid turnCommitted payload for attempt {attempt_id}"
            ));
        };
        let replay = crate::shared_event_log::canonical::assembler::assemble_turn_committed(
            owner.requested.logical_turn_id.clone(),
            attempt_id.to_string(),
            format!("input:{attempt_id}"),
            owner.requested.target.clone(),
            final_snapshot,
            existing_fact.committed_at,
        )
        .map_err(|error| format!("{}: {}", error.context, error.detail))?;
        if replay != existing_fact {
            let prefix = if matches!(
                existing_fact.outcome.status,
                OutcomeStatus::Cancelled | OutcomeStatus::Replaced
            ) {
                "stale-runtime-terminal"
            } else {
                "turnCommitted semantic conflict"
            };
            return Err(format!(
                "{prefix} for attempt {attempt_id}: authoritative terminal snapshot changed"
            ));
        }
        return Ok(CommitTurnOutcome {
            duplicate: true,
            sequence: Some(existing.sequence),
            binding_key: owner.binding_key,
        });
    }

    let committed_at = now_millis() as i64;
    let binding_has_native_identity = effective_native_session_id.is_some()
        || accepted.is_some()
        || provisioning_state_of(&existing_binding) == PROVISIONING_READY;
    let terminal_provisioning_state = if binding_has_native_identity {
        PROVISIONING_READY
    } else {
        PROVISIONING_PREPARED
    };
    let terminal_availability = if binding_has_native_identity {
        "ready"
    } else {
        "provisioning"
    };
    // 失败 / 取消 / 替换：native 历史不可再盲信 → dirty。
    // completed：证明 native resume / 本轮交付可用 → trusted。
    let terminal_trust = match final_snapshot.outcome {
        OutcomeStatus::Failed | OutcomeStatus::Cancelled | OutcomeStatus::Replaced => {
            Some(NativeContextTrust::Dirty)
        }
        OutcomeStatus::Completed => Some(NativeContextTrust::Trusted),
    };
    let provisioning = provisioning_json(
        terminal_provisioning_state,
        None,
        Some(attempt_id),
        Some(&owner.binding_operation_id),
        Some(&existing_binding),
        terminal_trust,
    );
    let pending = existing_binding
        .pending_delivery_json
        .as_deref()
        .map(serde_json::from_str::<PendingDelivery>)
        .transpose()
        .map_err(|error| error.to_string())?;
    if pending
        .as_ref()
        .is_some_and(|pending| pending.attempt_id != attempt_id)
    {
        return Err("terminal commit does not own pending context delivery".to_string());
    }
    let mut terminal_binding = if pending
        .as_ref()
        .is_some_and(|pending| pending.phase == "accepted-awaiting-commit")
    {
        terminal_binding_update(
            &existing_binding,
            attempt_id,
            effective_native_session_id.clone(),
            Some(provisioning.clone()),
            committed_at,
        )?
        .ok_or_else(|| "accepted delivery missing terminal binding update".to_string())?
    } else {
        binding_row_update(
            session_id,
            &owner.binding_key,
            owner.engine,
            owner.provider_profile_id.clone(),
            Some(&existing_binding),
            effective_native_session_id.clone(),
            existing_binding.committed_through_sequence,
            provisioning.clone(),
            terminal_availability,
        )
    };
    if pending.is_some() {
        // A known negative/recovery terminal before ACK consumes only this Attempt's
        // pending intent. It must not advance the context cursor.
        terminal_binding.pending_delivery_json = None;
    }
    if !binding_has_native_identity {
        // Claude's locally generated requested session id is not an identity ACK.
        // A known terminal before Runtime ownership must not make the next Attempt
        // resume a Native Session that may never have existed.
        terminal_binding.native_session_id = None;
    }
    let append = sink::commit_turn_with_binding(
        writer,
        session_id.to_string(),
        owner.requested.logical_turn_id.clone(),
        attempt_id.to_string(),
        format!("input:{attempt_id}"),
        owner.requested.target.clone(),
        final_snapshot,
        committed_at,
        &terminal_binding,
    )
    .map_err(|error| format!("{}: {}", error.context, error.detail))?;
    let (duplicate, sequence) = match append {
        AppendOutcome::Inserted { sequence, .. } => (false, Some(sequence)),
        AppendOutcome::Duplicate { existing_sequence } => (true, Some(existing_sequence)),
    };

    Ok(CommitTurnOutcome {
        duplicate,
        sequence,
        binding_key: owner.binding_key,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn commit_turn_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    logical_turn_id: &str,
    target: &ExecutionTargetInput,
    assistant_text: Option<String>,
    outcome: &CommitOutcomeInput,
    native_session_id: Option<String>,
) -> Result<CommitTurnOutcome, String> {
    let requested = requested_fact_for_attempt(writer, session_id, attempt_id)
        .map_err(|error| format!("run.settled {error}"))?;
    if requested.logical_turn_id != logical_turn_id || requested.target != target.to_snapshot() {
        return Err(format!(
            "run.settled owner mismatch for attempt {attempt_id}"
        ));
    }
    let final_snapshot = RuntimeFinalSnapshot {
        assistant_blocks: vec![],
        assistant_text,
        tool_calls: Vec::<RuntimeToolCall>::new(),
        tool_results: Vec::<RuntimeToolResult>::new(),
        artifacts: vec![],
        provider_private_refs: vec![],
        omissions: vec![],
        outcome: parse_outcome_status(&outcome.status)?,
        error_code: outcome.error_code.clone(),
        error_message: outcome.error_message.clone(),
        stop_reason: outcome.stop_reason.clone(),
    };
    commit_runtime_snapshot_core(
        writer,
        session_id,
        attempt_id,
        final_snapshot,
        native_session_id.as_deref(),
    )
}

// ---------------------------------------------------------------------------
// B.4 core：recovery / rebuild
// ---------------------------------------------------------------------------

pub fn mark_recovery_core(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_key: &str,
    engine: EngineType,
    provider_profile_id: Option<String>,
    reason: Option<&str>,
) -> Result<(), String> {
    let provider_profile_id = provider_profile_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let existing = writer
        .binding_state(session_id, binding_key)
        .map_err(|error| error.to_string())?;
    upsert_binding_row(
        writer,
        session_id,
        binding_key,
        engine,
        provider_profile_id,
        existing.as_ref(),
        None,
        None,
        provisioning_json(
            PROVISIONING_RECOVERY_REQUIRED,
            reason,
            None,
            existing
                .as_ref()
                .and_then(binding_operation_id_of)
                .as_deref(),
            existing.as_ref(),
            Some(NativeContextTrust::Dirty),
        ),
        "recovery-required",
    )
    .map_err(|error| error.to_string())?;
    append_control_fact(
        writer,
        session_id,
        "binding.recovery-required",
        Some(binding_key),
        reason,
    )
}

#[derive(Debug)]
pub struct RebuildBindingOutcome {
    pub archived_native_session_id: Option<String>,
    pub replaced_attempt_ids: Vec<String>,
    pub binding_operation_id: String,
}

pub(crate) fn recovery_terminal_snapshot(outcome: OutcomeStatus, stop_reason: &str) -> RuntimeFinalSnapshot {
    RuntimeFinalSnapshot {
        assistant_blocks: vec![],
        assistant_text: None,
        tool_calls: vec![],
        tool_results: vec![],
        artifacts: vec![],
        provider_private_refs: vec![],
        omissions: vec![],
        outcome,
        error_code: None,
        error_message: None,
        stop_reason: Some(stop_reason.to_string()),
    }
}

pub fn cancel_pre_dispatch_attempt_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    reason: &str,
) -> Result<CommitTurnOutcome, String> {
    let owner = durable_attempt_owner(writer, session_id, attempt_id)?;
    let binding = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&binding, &owner)?;
    let pending: PendingDelivery = serde_json::from_str(
        binding
            .pending_delivery_json
            .as_deref()
            .ok_or_else(|| "pre-dispatch cancellation requires prepared delivery".to_string())?,
    )
    .map_err(|error| error.to_string())?;
    if pending.attempt_id != attempt_id || pending.phase != "prepared" {
        return Err(format!(
            "pre-dispatch cancellation owner/phase mismatch for attempt {attempt_id}: {}",
            pending.phase
        ));
    }
    commit_runtime_snapshot_core(
        writer,
        session_id,
        attempt_id,
        recovery_terminal_snapshot(OutcomeStatus::Cancelled, reason),
        None,
    )
}

/// 显式重建的 durable 部分：先把该 Binding 的唯一未决 Attempt 结算为
/// `replaced`，再在同一 transaction 归档旧 identity、切换 Binding generation。
/// late terminal 因 generation/terminal conflict 只能作为 stale evidence，不能复活旧行。
pub fn rebuild_binding_core(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_key: &str,
) -> Result<RebuildBindingOutcome, String> {
    let existing = writer
        .binding_state(session_id, binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {binding_key} is missing"))?;
    let engine = serde_json::from_value::<EngineType>(Value::String(existing.engine.clone()))
        .map_err(|_| {
            format!(
                "binding {binding_key} has unsupported engine '{}'",
                existing.engine
            )
        })
        .and_then(ensure_supported_shared_session_engine)?;
    let provider_profile_id = existing.provider_profile_id.clone();
    // Squad worker binding key is first-class (`squad:{run}:{node}:{engine}:{provider}`).
    // Main durable path still requires key == engine:provider to prevent identity mix-ups.
    let is_squad_binding = binding_key.starts_with("squad:");
    if !is_squad_binding {
        let durable_binding_key = shared_target_binding_key(engine, provider_profile_id.as_deref());
        if durable_binding_key != binding_key {
            return Err(format!(
                "binding owner mismatch: key '{binding_key}' does not match durable owner '{durable_binding_key}'"
            ));
        }
    }
    let archived_native_session_id = existing.native_session_id.clone();
    // Squad worker turns are excluded from main unresolved evidence; filter is still safe.
    let unresolved = unresolved_attempt_evidence(writer, session_id, Some(binding_key))?;
    if unresolved.len() > 1 {
        return Err(format!(
            "recovery-owner-ambiguous: binding {binding_key} has {} unresolved attempts",
            unresolved.len()
        ));
    }
    let binding_operation_id = Uuid::new_v4().to_string();
    let rebuilt_at = now_millis() as i64;
    let rebuilt_binding = BindingStateUpdate {
        session_id: session_id.to_string(),
        binding_key: binding_key.to_string(),
        engine: engine.icon().to_string(),
        provider_profile_id,
        native_session_id: None,
        accepted_through_sequence: None,
        committed_through_sequence: None,
        provisioning_json: Some(
            json!({
                "state": PROVISIONING_PREPARED,
                "updatedAt": rebuilt_at,
                "rebuiltAt": rebuilt_at,
                "operationId": binding_operation_id,
                "archivedNativeSessionId": archived_native_session_id,
                "nativeContextTrust": NativeContextTrust::Dirty.as_str(),
            })
            .to_string(),
        ),
        pending_delivery_json: None,
        availability: "provisioning".to_string(),
        updated_at: rebuilt_at,
    };
    let mut replaced_attempt_ids = Vec::new();
    if let Some(evidence) = unresolved.first() {
        require_attempt_binding_generation(&existing, &evidence.owner)?;
        let attempt_id = evidence.owner.requested.attempt_id.clone();
        sink::commit_turn_with_binding(
            writer,
            session_id.to_string(),
            evidence.owner.requested.logical_turn_id.clone(),
            attempt_id.clone(),
            format!("input:{attempt_id}"),
            evidence.owner.requested.target.clone(),
            recovery_terminal_snapshot(OutcomeStatus::Replaced, "binding-rebuilt"),
            rebuilt_at,
            &rebuilt_binding,
        )
        .map_err(|error| format!("{}: {}", error.context, error.detail))?;
        replaced_attempt_ids.push(attempt_id);
    } else {
        writer
            .upsert_binding_state(&rebuilt_binding)
            .map_err(|error| error.to_string())?;
    }

    append_control_fact(
        writer,
        session_id,
        "binding.rebuilt",
        Some(binding_key),
        Some("explicit-user-rebuild"),
    )?;
    Ok(RebuildBindingOutcome {
        archived_native_session_id,
        replaced_attempt_ids,
        binding_operation_id,
    })
}

// ---------------------------------------------------------------------------
// Probe / turn_state（只读 evidence，供 B.4.3 定性与 B.6.5 重启恢复）
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub(crate) struct UnresolvedAttemptEvidence {
    pub(crate) owner: DurableAttemptOwner,
    pub(crate) accepted: bool,
    pub(crate) delivery_prepared: bool,
    pub(crate) pending_phase: Option<String>,
}

pub(crate) fn unresolved_attempt_evidence(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_filter: Option<&str>,
) -> Result<Vec<UnresolvedAttemptEvidence>, String> {
    let events = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())?;
    let mut requested: Vec<String> = Vec::new();
    let mut seen_requested = std::collections::HashSet::new();
    let mut committed = std::collections::HashSet::new();
    let mut accepted = std::collections::HashSet::new();
    let mut delivery_prepared = std::collections::HashSet::new();
    for event in &events {
        let Some(attempt_id) = event.attempt_id.clone() else {
            continue;
        };
        match event.fact_type.as_str() {
            "conversation.turnRequested" => {
                let squad_worker = serde_json::from_str::<Value>(&event.payload_json)
                    .ok()
                    .and_then(|payload| {
                        payload
                            .get("squadWorkerBindingKey")
                            .and_then(Value::as_str)
                            .map(|value| !value.trim().is_empty())
                    })
                    .unwrap_or(false);
                if squad_worker {
                    continue;
                }
                if seen_requested.insert(attempt_id.clone()) {
                    requested.push(attempt_id);
                }
            }
            "conversation.turnAccepted" => {
                accepted.insert(attempt_id);
            }
            "context.deliveryPrepared" => {
                delivery_prepared.insert(attempt_id);
            }
            "conversation.turnCommitted" => {
                committed.insert(attempt_id);
            }
            _ => {}
        }
    }
    let mut result = Vec::new();
    for attempt_id in requested {
        if committed.contains(&attempt_id) {
            continue;
        }
        let owner = durable_attempt_owner(writer, session_id, &attempt_id)?;
        if binding_filter.is_some_and(|binding_key| binding_key != owner.binding_key) {
            continue;
        }
        let pending_phase = writer
            .binding_state(session_id, &owner.binding_key)
            .map_err(|error| error.to_string())?
            .and_then(|binding| binding.pending_delivery_json)
            .and_then(|raw| serde_json::from_str::<PendingDelivery>(&raw).ok())
            .filter(|pending| pending.attempt_id == attempt_id)
            .map(|pending| pending.phase);
        result.push(UnresolvedAttemptEvidence {
            owner,
            accepted: accepted.contains(&attempt_id),
            delivery_prepared: delivery_prepared.contains(&attempt_id),
            pending_phase,
        });
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Tauri commands（薄封装）
// ---------------------------------------------------------------------------

fn legacy_snapshot_fingerprint(path: &std::path::Path, items: &[Value]) -> Result<String, String> {
    let identity = json!({
        "sourcePath": path.to_string_lossy(),
        "items": items,
    });
    let bytes = deterministic_json_bytes(&identity).map_err(|error| error.to_string())?;
    let digest = Sha256::digest(bytes);
    Ok(format!(
        "sha256:{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

/// 在 Tx1 前把 Shared 自己的 V0 snapshot 幂等导入为 presentation-only facts。
///
/// 这是 Shared storage → Shared Event Log 的 compatibility handoff；不读取 Native CLI
/// history。Canonical logical Turn 在 Projector/ContextCompiler 中拥有更高优先级，所以
/// 历史 snapshot 即使包含已经 canonicalized 的 Turn，也只能补正文，不能覆盖 Target。
pub(crate) fn import_legacy_shared_snapshot(
    writer: &SharedEventWriter,
    workspace_id: &str,
    thread_id: &str,
    shared_session_id: &str,
) -> Result<(), String> {
    let (_, source_path) = shared_session_projection_source(workspace_id, thread_id)?;
    let Some(snapshot) = read_latest_shared_session_snapshot(workspace_id, shared_session_id)?
    else {
        return Ok(());
    };
    if snapshot.items.is_empty() {
        return Ok(());
    }
    let meta = read_shared_session_meta(workspace_id, shared_session_id)?;
    let selected_engine = meta
        .selected_target
        .as_ref()
        .map(|target| target.engine)
        .unwrap_or(EngineType::Claude);
    import_legacy_snapshot_items(
        writer,
        shared_session_id,
        &source_path,
        &snapshot.items,
        selected_engine,
        i64::try_from(now_millis()).unwrap_or(i64::MAX),
    )
}

pub(crate) fn import_legacy_snapshot_items(
    writer: &SharedEventWriter,
    shared_session_id: &str,
    source_path: &std::path::Path,
    items: &[Value],
    selected_engine: EngineType,
    imported_at: i64,
) -> Result<(), String> {
    let source_fingerprint = legacy_snapshot_fingerprint(source_path, items)?;
    if writer
        .legacy_import(shared_session_id)
        .map_err(|error| error.to_string())?
        .is_some_and(|marker| {
            marker.status == "completed" && marker.source_fingerprint == source_fingerprint
        })
    {
        return Ok(());
    }

    for fact in
        crate::shared_event_log::canonical::shadow_v0::map_v0_snapshot_to_presentation_only_facts(
            items,
            selected_engine.icon(),
            imported_at,
        )
    {
        writer
            .append_presentation_only_fact(shared_session_id, fact)
            .map_err(|error| error.to_string())?;
    }
    writer
        .upsert_legacy_import(&LegacyImportRow {
            session_id: shared_session_id.to_string(),
            source_path: source_path.to_string_lossy().into_owned(),
            source_fingerprint: source_fingerprint.clone(),
            imported_through_marker: Some(format!(
                "snapshot-items:{}:{source_fingerprint}",
                items.len()
            )),
            status: "completed".to_string(),
            imported_at: Some(imported_at),
        })
        .map_err(|error| error.to_string())
}

/// 用户显式「放弃本轮」：把唯一未决 Attempt durable 结算为 cancelled，
/// 并在无更多 unresolved 时清除 binding 的 recovery-required，使会话可重新发送。
///
/// Fail-closed：
/// - Runtime 仍 own attempt 且 `force_stop=false` → 拒绝（须先 Stop）
/// - 多 owner → ambiguous 拒绝
/// - 已 committed → 幂等返回 terminal-committed
pub fn abandon_unresolved_attempt_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
    stop_reason: &str,
) -> Result<CommitTurnOutcome, String> {
    let committed = commit_runtime_snapshot_core(
        writer,
        session_id,
        attempt_id,
        recovery_terminal_snapshot(OutcomeStatus::Cancelled, stop_reason),
        None,
    )?;
    clear_binding_recovery_if_idle(writer, session_id, &committed.binding_key)?;
    Ok(committed)
}

/// 当 binding 无 unresolved attempt 且 provisioning=recovery-required 时，
/// 回落 prepared（无 native）或 ready（有 native），避免「attempt 已结算但仍锁 begin」。
fn clear_binding_recovery_if_idle(
    writer: &SharedEventWriter,
    session_id: &str,
    binding_key: &str,
) -> Result<(), String> {
    let remaining = unresolved_attempt_evidence(writer, session_id, Some(binding_key))?;
    if !remaining.is_empty() {
        return Ok(());
    }
    let existing = match writer
        .binding_state(session_id, binding_key)
        .map_err(|error| error.to_string())?
    {
        Some(row) => row,
        None => return Ok(()),
    };
    if provisioning_state_of(&existing) != PROVISIONING_RECOVERY_REQUIRED {
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
    let has_native = existing
        .native_session_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let next_state = if has_native {
        PROVISIONING_READY
    } else {
        PROVISIONING_PREPARED
    };
    let availability = if has_native { "ready" } else { "provisioning" };
    upsert_binding_row(
        writer,
        session_id,
        binding_key,
        engine,
        existing.provider_profile_id.clone(),
        Some(&existing),
        None,
        None,
        // abandon 后即使保留 native，也不得盲信历史 → dirty。
        provisioning_json(
            next_state,
            Some("recovery-cleared-after-abandon"),
            None,
            binding_operation_id_of(&existing).as_deref(),
            Some(&existing),
            Some(NativeContextTrust::Dirty),
        ),
        availability,
    )
    .map_err(|error| error.to_string())?;
    append_control_fact(
        writer,
        session_id,
        "binding.recovery-cleared",
        Some(binding_key),
        Some("user-abandon-unresolved"),
    )?;
    Ok(())
}

/// 用户显式放弃未决 Attempt（durable cancel）。可选 `force_stop`：在 Runtime own 时先 interrupt。
///
/// 可完成出口合同（OpenSpec recovery exit / § interrupt capability missing）：
/// - `force_stop=false` 且 Runtime own → 拒绝（须先 Stop 或显式 force）
/// - `force_stop=true` → best-effort interrupt；**interrupt 失败也必须 durable cancel + 清 coordinator**
///   （否则停不掉时「跳过本轮」会永久锁死会话）
#[tauri::command]
pub(crate) async fn shared_session_v2_abandon_unresolved_attempt(
    workspace_id: String,
    thread_id: String,
    attempt_id: Option<String>,
    force_stop: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let force_stop = force_stop.unwrap_or(false);

    let unresolved = unresolved_attempt_evidence(writer, &shared_session_id, None)?;
    let attempt_id = match attempt_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(requested) => {
            if !unresolved
                .iter()
                .any(|evidence| evidence.owner.requested.attempt_id == requested)
            {
                // 幂等：若已 terminal-committed，返回已提交。
                if let Some(sequence) =
                    committed_attempt_sequence(writer, &shared_session_id, requested)?
                {
                    return Ok(json!({
                        "status": "terminal-committed",
                        "attemptId": requested,
                        "sequence": sequence,
                    }));
                }
                return Err(format!(
                    "recovery-owner-missing: attempt {requested} is not unresolved"
                ));
            }
            requested.to_string()
        }
        None => {
            if unresolved.is_empty() {
                return Ok(json!({
                    "status": "clear",
                    "reason": "no-unresolved-attempt",
                }));
            }
            if unresolved.len() > 1 {
                return Err(format!(
                    "recovery-owner-ambiguous: session has {} unresolved attempts",
                    unresolved.len()
                ));
            }
            unresolved[0].owner.requested.attempt_id.clone()
        }
    };

    if let Some(sequence) = committed_attempt_sequence(writer, &shared_session_id, &attempt_id)? {
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "sequence": sequence,
        }));
    }

    let owned = state.shared_runtime_coordinator.owns_attempt(&attempt_id);
    let mut interrupt_warning: Option<String> = None;
    if owned {
        if !force_stop {
            return Err(format!(
                "recovery-active-requires-stop: attempt {attempt_id} is still owned by Runtime; Stop before abandon or pass forceStop"
            ));
        }
        // force_stop：best-effort interrupt。失败不阻断 durable abandon（可完成出口）。
        // 迟到 terminal 由 generation/terminal 冲突吸收，不得复活已 cancel 的 attempt。
        match shared_session_v2_interrupt_turn(
            workspace_id.clone(),
            thread_id.clone(),
            attempt_id.clone(),
            state.clone(),
        )
        .await
        {
            Ok(_) => {}
            Err(error) => {
                interrupt_warning = Some(error);
            }
        }
        // 不立即 remove_attempt —— 先检查 settled_for_attempt，
        // 以防 interrupt 与真实完成竞态导致 settled 证据被误删。
    }

    // 必须在 remove_attempt 之前读取：remove_attempt 会清掉 settled_by_attempt。
    // 场景：interrupt 调用时，后端恰好刚完成并写入 settled 证据，
    // 此时不应丢弃该证据（否则会丢失已完成的助手回复）。
    if let Some(settled) = state
        .shared_runtime_coordinator
        .settled_for_attempt(&attempt_id)
    {
        // 清理 coordinator 跟踪（不再需要）
        state.shared_runtime_coordinator.remove_attempt(&attempt_id);
        let committed = commit_observed_runtime_settlement(&state, settled)?;
        clear_binding_recovery_if_idle(writer, &shared_session_id, &committed.binding_key)?;
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "bindingKey": committed.binding_key,
            "sequence": committed.sequence,
            "interruptWarning": interrupt_warning,
        }));
    }

    // 未 settled：强制清 coordinator 跟踪（含 force_stop 且 interrupt 失败），再 durable cancel。
    // 否则 Runtime own 会永久挡住 rebuild，跳过也无法解锁。
    state.shared_runtime_coordinator.remove_attempt(&attempt_id);

    let committed = abandon_unresolved_attempt_core(
        writer,
        &shared_session_id,
        &attempt_id,
        if interrupt_warning.is_some() {
            "user-abandon-unresolved-force-after-interrupt-fail"
        } else {
            "user-abandon-unresolved"
        },
    )?;
    // abandon_unresolved_attempt_core 不负责 coordinator；最终再清一次（幂等）。
    state.shared_runtime_coordinator.remove_attempt(&attempt_id);

    Ok(json!({
        "status": "cancelled-committed",
        "attemptId": attempt_id,
        "bindingKey": committed.binding_key,
        "sequence": committed.sequence,
        "duplicate": committed.duplicate,
        "interruptWarning": interrupt_warning,
        "forcedAfterInterruptFailure": interrupt_warning.is_some(),
    }))
}

