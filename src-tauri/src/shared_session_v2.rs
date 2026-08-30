//! Shared Session V2 Send 写路径（Wave 4 / Change B：B.3 Send V2 + B.4 Durable Provisioning）。
//!
//! 事务边界：
//! - Tx1（`shared_session_v2_begin_turn`）：runtime side effect 之前 Commit
//!   `conversation.turnRequested` + `TurnExecutionSnapshot`，并把 durable provisioning
//!   推进到 `creating`。
//! - Tx2（`shared_session_v2_commit_turn`）：`run.settled` 后经既有 assembler/sink 写
//!   `conversation.turnCommitted`（duplicate 幂等），推进 committed cursor，provisioning → ready。
//! - ACK 不确定（`shared_session_v2_mark_recovery`）：provisioning → `recovery-required`，
//!   禁止盲目重建；只有显式 `shared_session_v2_rebuild_binding` 能归档旧 Binding 重建。
//!
//! 结构：`*_core` 纯逻辑（只依赖 `SharedEventWriter`，可集成测试）+ Tauri command 薄封装。
//! 红线：本模块只通过 `SharedEventWriter` 写库（单写者），不直接触 SQLite。

use serde_json::{json, Value};
use tauri::State;
#[cfg(test)]
use uuid::Uuid;
pub use crate::engine::EngineType;
use crate::shared_context::{
    compile_context,
    is_zero_transfer_package,
    prepare_delivery,
    session_needs_history,
    write_artifact,
    CompileContextRequest,
    PrepareDeliveryRequest,
};
#[cfg(test)]
use crate::shared_context::RuntimeContextCapabilities;
#[cfg(test)]
use crate::shared_event_log::canonical::assembler::RuntimeFinalSnapshot;
use crate::shared_event_log::canonical::types::OutcomeStatus;
#[cfg(test)]
use crate::shared_event_log::canonical::types::{
    ArtifactRef, CanonicalFact, CanonicalProviderProfileSource, CanonicalUserInput,
    ReasoningSelection, TurnExecutionSnapshot, TurnRequestedFact,
};
use crate::shared_event_log::SharedEventWriter;
#[cfg(test)]
use crate::shared_event_log::BindingStateUpdate;
use crate::shared_sessions::{now_millis, parse_shared_session_id, shared_target_binding_key};
use crate::state::AppState;

mod binding_state;
mod dispatch_settlement;
mod execution_target;
mod receipt;
mod turn_lifecycle;

pub use dispatch_settlement::validate_prepare_target_core;
pub use execution_target::ExecutionTargetInput;
pub use turn_lifecycle::{
    abandon_unresolved_attempt_core,
    accept_turn_core,
    begin_turn_core,
    BeginTurnOutcome,
    BeginTurnStatus,
    cancel_pre_dispatch_attempt_core,
    commit_turn_core,
    CommitOutcomeInput,
    CommitTurnOutcome,
    mark_recovery_core,
    rebuild_binding_core,
    RebuildBindingOutcome,
};
pub(crate) use binding_state::*;
pub(crate) use dispatch_settlement::*;
pub(crate) use execution_target::*;
pub(crate) use receipt::*;
pub(crate) use turn_lifecycle::*;

#[tauri::command]
pub(crate) async fn shared_session_v2_begin_turn(
    workspace_id: String,
    thread_id: String,
    target: ExecutionTargetInput,
    text: String,
    images: Option<Vec<String>>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    if let Err(reason) = validate_resolved_execution_target(&target) {
        return Ok(json!({
            "status": "target-unavailable",
            "reason": reason,
        }));
    }
    import_legacy_shared_snapshot(writer, &workspace_id, &thread_id, &shared_session_id)?;
    let outcome = begin_turn_core(writer, &shared_session_id, &target, text, images)?;
    Ok(match outcome.status {
        BeginTurnStatus::Creating => json!({
            "status": "creating",
            "attemptId": outcome.attempt_id,
            "logicalTurnId": outcome.logical_turn_id,
            "bindingKey": outcome.binding_key,
            "snapshot": outcome
                .snapshot
                .map(|value| serde_json::to_value(value).ok())
                .flatten(),
        }),
        BeginTurnStatus::RecoveryRequired => json!({
            "status": "recovery-required",
            "bindingKey": outcome.binding_key,
            "reason": outcome.reason,
        }),
        BeginTurnStatus::TargetUnavailable => json!({
            "status": "target-unavailable",
            "reason": outcome.reason,
        }),
    })
}

#[tauri::command]
pub(crate) async fn shared_session_v2_prepare_context(
    workspace_id: String,
    thread_id: String,
    target: ExecutionTargetInput,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let engine = validate_resolved_execution_target(&target)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let binding_key = shared_target_binding_key(engine, target.normalized_provider().as_deref());
    let binding = writer
        .binding_state(&shared_session_id, &binding_key)
        .map_err(|error| error.to_string())?;
    let package = compile_context(
        &writer
            .events_for_session(&shared_session_id)
            .map_err(|error| error.to_string())?,
        &CompileContextRequest {
            session_id: shared_session_id,
            binding_key,
            destination: serde_json::to_value(&target).map_err(|error| error.to_string())?,
            destination_native_session_id: binding
                .as_ref()
                .and_then(|row| row.native_session_id.clone()),
            from_sequence_exclusive: binding
                .as_ref()
                .and_then(|row| row.accepted_through_sequence),
            through_sequence_inclusive: None,
            exclude_attempt_id: None,
            capabilities: context_capabilities(&target),
            budget_estimated_tokens: None,
        },
    )?;
    let omissions = package
        .manifest
        .omitted
        .iter()
        .filter(|omission| omission.requires_confirmation())
        .map(|omission| format!("{}: {}", omission.category, omission.reason))
        .collect::<Vec<_>>();
    Ok(json!({
        "status": if omissions.is_empty() { "ready" } else { "degraded" },
        "mode": package.manifest.mode,
        "omissions": omissions,
        "manifest": package.manifest,
        "compression": package.compression,
    }))
}

/// Tx3：基于 Tx1 之后的固定 source snapshot 编译 package，先原子保存 artifact，
/// 再原子追加 deliveryPrepared + pending。当前 attempt 自身不进入历史 package。
#[tauri::command]
pub(crate) async fn shared_session_v2_prepare_delivery(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    validate_prepare_target_core(writer, &shared_session_id, &attempt_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;
    let preparation = (|| {
        let binding = writer
            .binding_state(&shared_session_id, &owner.binding_key)
            .map_err(|error| error.to_string())?;
        let events = writer
            .events_for_session(&shared_session_id)
            .map_err(|error| error.to_string())?;
        let source_upper = events
            .iter()
            .find(|event| {
                event.fact_type == "conversation.turnRequested"
                    && event.attempt_id.as_deref() == Some(attempt_id.as_str())
            })
            .map(|event| event.sequence.saturating_sub(1))
            .ok_or_else(|| "turnRequested missing before context prepare".to_string())?;
        let capabilities = context_capabilities(&owner.target);
        let destination =
            serde_json::to_value(&owner.requested.target).map_err(|error| error.to_string())?;
        let incremental_request = CompileContextRequest {
            session_id: shared_session_id.clone(),
            binding_key: owner.binding_key.clone(),
            destination: destination.clone(),
            destination_native_session_id: binding
                .as_ref()
                .and_then(|row| row.native_session_id.clone()),
            from_sequence_exclusive: binding
                .as_ref()
                .and_then(|row| row.accepted_through_sequence),
            through_sequence_inclusive: Some(source_upper),
            exclude_attempt_id: Some(attempt_id.clone()),
            capabilities: capabilities.clone(),
            budget_estimated_tokens: None,
        };
        let mut package = compile_context(&events, &incremental_request)?;
        let trust = binding
            .as_ref()
            .map(read_native_context_trust)
            .unwrap_or(NativeContextTrust::Dirty);
        let mut rematerialized = false;
        // P0：dirty 时只要 needs_history，一律全量 rematerialize。
        // 不可仅看 zero-transfer——失败轮「继续」未 turnAccepted 时增量 package
        // 非空但只有短指令，仍会丢原任务（图1）。
        let needs_history = session_needs_history(&events, &incremental_request)?;
        if trust == NativeContextTrust::Dirty && needs_history {
            package = compile_context(
                &events,
                &CompileContextRequest {
                    session_id: shared_session_id.clone(),
                    binding_key: owner.binding_key.clone(),
                    destination,
                    destination_native_session_id: None,
                    from_sequence_exclusive: None,
                    through_sequence_inclusive: Some(source_upper),
                    exclude_attempt_id: Some(attempt_id.clone()),
                    capabilities: capabilities.clone(),
                    budget_estimated_tokens: None,
                },
            )?;
            rematerialized = true;
            if is_zero_transfer_package(&package) {
                return Err(format!(
                    "empty-context-handoff: needs-history but package empty after rematerialize (binding={}, trust=dirty)",
                    owner.binding_key
                ));
            }
        }
        let prepared_at = now_millis() as i64;
        let artifact = write_artifact(
            context_artifact_root(&state)?,
            &workspace_id,
            &shared_session_id,
            &package,
            prepared_at,
        )?;
        prepare_delivery(
            writer,
            &PrepareDeliveryRequest {
                session_id: shared_session_id.clone(),
                binding_key: owner.binding_key.clone(),
                engine: owner.engine.icon().to_string(),
                provider_profile_id: owner.provider_profile_id.clone(),
                logical_turn_id: owner.requested.logical_turn_id.clone(),
                attempt_id: attempt_id.clone(),
                binding_operation_id: owner.binding_operation_id.clone(),
                package: package.clone(),
                prepared_at,
            },
        )?;
        Ok::<_, String>((package, artifact, rematerialized, trust))
    })();
    let (package, artifact, rematerialized, trust) = preparation.map_err(|error| {
        persist_context_prepare_failure(writer, &shared_session_id, &owner, &error)
    })?;
    Ok(json!({
        "status": if package
            .manifest
            .omitted
            .iter()
            .any(|omission| omission.requires_confirmation())
        {
            "degraded"
        } else {
            "ready"
        },
        "packageId": package.package_id,
        "artifactId": artifact.artifact_id,
        "artifactChecksum": artifact.checksum,
        "sourceChecksum": package.manifest.source_checksum,
        "throughSequenceInclusive": package.manifest.through_sequence_inclusive,
        "mode": package.manifest.mode,
        "operation": package.manifest.mode.operation(),
        "promptPrefix": package.prompt_prefix,
        "importItems": codex_import_items(&package),
        "manifest": package.manifest,
        "compression": package.compression,
        "ackFidelity": if context_capabilities(&owner.target).strong_context_ack { "strong" } else { "weak" },
        "rematerialized": rematerialized,
        "nativeContextTrust": trust.as_str(),
    }))
}

#[tauri::command]
pub(crate) async fn shared_session_v2_commit_turn(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;
    let mut committed = writer
        .events_for_session(&shared_session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id.as_str())
        });
    if committed.is_none() {
        if let Some(settled) = state
            .shared_runtime_coordinator
            .settled_for_attempt(&attempt_id)
        {
            // D13：先持久化，成功后 helper 才清理 Runtime owner/cache。
            // 失败时必须保留 authoritative snapshot，供 probe/commit retry 使用。
            commit_observed_runtime_settlement(&state, settled)?;
            committed = writer
                .events_for_session(&shared_session_id)
                .map_err(|error| error.to_string())?
                .into_iter()
                .find(|event| {
                    event.fact_type == "conversation.turnCommitted"
                        && event.attempt_id.as_deref() == Some(attempt_id.as_str())
                });
        }
    }
    Ok(match committed {
        Some(event) => json!({
            "status": "committed",
            "duplicate": true,
            "sequence": event.sequence,
            "bindingKey": owner.binding_key,
        }),
        None => json!({
            "status": "pending",
            "attemptId": attempt_id,
            "bindingKey": owner.binding_key,
        }),
    })
}

/// ACK 不确定（超时/崩溃/未知）：provisioning → recovery-required，禁止盲目重建。
#[tauri::command]
pub(crate) async fn shared_session_v2_mark_recovery(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;
    let already_committed = writer
        .events_for_session(&shared_session_id)
        .map_err(|error| error.to_string())?
        .iter()
        .any(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id.as_str())
        });
    if already_committed {
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "bindingKey": owner.binding_key,
        }));
    }
    if let Some(settled) = state
        .shared_runtime_coordinator
        .settled_for_attempt(&attempt_id)
    {
        let committed = commit_observed_runtime_settlement(&state, settled)?;
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "bindingKey": committed.binding_key,
            "sequence": committed.sequence,
        }));
    }
    let binding = writer
        .binding_state(&shared_session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&binding, &owner)?;
    let unresolved = unresolved_attempt_evidence(writer, &shared_session_id, None)?;
    let evidence = unresolved
        .iter()
        .find(|evidence| evidence.owner.requested.attempt_id == attempt_id)
        .ok_or_else(|| format!("recovery-owner-missing: attempt {attempt_id} is not unresolved"))?;
    if let Some(active) = active_recovery_response(
        writer,
        &state.shared_runtime_coordinator,
        &workspace_id,
        &thread_id,
        evidence,
    )? {
        return Ok(active);
    }
    mark_recovery_core(
        writer,
        &shared_session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id,
        reason.as_deref(),
    )?;
    Ok(json!({
        "status": "recovery-required",
        "attemptId": attempt_id,
        "bindingKey": owner.binding_key,
    }))
}

/// 用户在 actual package 确认阶段取消：此时 Runtime side effect 尚未开始。
/// 只允许消费 exact prepared Attempt；任何已注册 Runtime owner 都 fail closed。
#[tauri::command]
pub(crate) async fn shared_session_v2_cancel_attempt(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    reason: Option<String>,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;
    if let Some(committed) = writer
        .events_for_session(&shared_session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id.as_str())
        })
    {
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "bindingKey": owner.binding_key,
            "sequence": committed.sequence,
        }));
    }
    if state.shared_runtime_coordinator.owns_attempt(&attempt_id) {
        return Err(format!(
            "pre-dispatch-cancel-refused: Runtime owner already exists for attempt {attempt_id}"
        ));
    }
    let reason = reason
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("user-cancelled-before-dispatch");
    let committed =
        cancel_pre_dispatch_attempt_core(writer, &shared_session_id, &attempt_id, reason)?;
    Ok(json!({
        "status": "cancelled",
        "attemptId": attempt_id,
        "bindingKey": committed.binding_key,
        "sequence": committed.sequence,
    }))
}

/// Shared V2 control plane：只接收 durable attempt identity。
///
/// Engine / Provider / Binding / native Thread / runtime Turn 全部从
/// `turnRequested` + `SharedRuntimeCoordinator` 的同一 owner 解析。任何 owner 缺失或
/// 不一致都 fail closed；禁止回退 active Engine、当前 Picker 或 workspace-wide interrupt。
pub(crate) fn committed_attempt_sequence(
    writer: &SharedEventWriter,
    shared_session_id: &str,
    attempt_id: &str,
) -> Result<Option<i64>, String> {
    Ok(writer
        .events_for_session(shared_session_id)
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|event| {
            event.fact_type == "conversation.turnCommitted"
                && event.attempt_id.as_deref() == Some(attempt_id)
        })
        .map(|event| event.sequence))
}

#[tauri::command]
pub(crate) async fn shared_session_v2_interrupt_turn(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    if let Some(sequence) = committed_attempt_sequence(writer, &shared_session_id, &attempt_id)? {
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "sequence": sequence,
        }));
    }
    let route = resolve_shared_attempt_interrupt_route(
        writer,
        &state.shared_runtime_coordinator,
        &workspace_id,
        &thread_id,
        &attempt_id,
    )?;

    state
        .shared_runtime_coordinator
        .mark_cancel_intent(&attempt_id)?;
    let interrupt_result: Result<(), String> = async {
        match route.engine {
            EngineType::Codex => {
                crate::shared::codex_core::turn_interrupt_core(
                    &state.sessions,
                    workspace_id.clone(),
                    route.provider_profile_id.clone(),
                    route.native_thread_id.clone(),
                    route.runtime_turn_id.clone(),
                )
                .await
                .map(|_| ())
            }
            EngineType::Claude => {
                let session = state
                    .engine_manager
                    .claude_manager
                    .get_session_for_provider(
                        &workspace_id,
                        route.provider_profile_id.as_deref(),
                    )
                    .await
                    .ok_or_else(|| {
                        format!(
                            "shared-control-owner-unavailable: Claude runtime missing for attempt {}",
                            route.attempt_id
                        )
                    })?;
                if !session.has_active_turn(&route.runtime_turn_id).await {
                    return Err(format!(
                        "shared-control-owner-unavailable: Claude runtime turn missing for attempt {}",
                        route.attempt_id
                    ));
                }
                session.interrupt_turn(&route.runtime_turn_id).await
            }
            EngineType::OpenCode => {
                let runtime_key = provider_runtime_key_for_target(
                    &workspace_id,
                    route.engine,
                    route.provider_profile_id.as_deref(),
                )?;
                let session = state
                    .engine_manager
                    .get_opencode_session_for_runtime(&runtime_key)
                    .await
                    .ok_or_else(|| {
                        format!(
                            "shared-control-owner-unavailable: OpenCode runtime missing for attempt {}",
                            route.attempt_id
                        )
                    })?;
                session.interrupt_turn(&route.runtime_turn_id).await
            }
            EngineType::Kimi => {
                let runtime_key = provider_runtime_key_for_target(
                    &workspace_id,
                    route.engine,
                    route.provider_profile_id.as_deref(),
                )?;
                let session = state
                    .engine_manager
                    .get_kimi_session_for_runtime(&runtime_key)
                    .await
                    .ok_or_else(|| {
                        format!(
                            "shared-control-owner-unavailable: Kimi runtime missing for attempt {}",
                            route.attempt_id
                        )
                    })?;
                session.interrupt_turn(&route.runtime_turn_id).await
            }
            EngineType::Grok => {
                let runtime_key = provider_runtime_key_for_target(
                    &workspace_id,
                    route.engine,
                    route.provider_profile_id.as_deref(),
                )?;
                let session = state
                    .engine_manager
                    .get_grok_session_for_runtime(&runtime_key)
                    .await
                    .ok_or_else(|| {
                        format!(
                            "shared-control-owner-unavailable: Grok runtime missing for attempt {}",
                            route.attempt_id
                        )
                    })?;
                session.interrupt_turn(&route.runtime_turn_id).await
            }
            EngineType::Pi => {
                let runtime_key = provider_runtime_key_for_target(
                    &workspace_id,
                    route.engine,
                    route.provider_profile_id.as_deref(),
                )?;
                let session = state
                    .engine_manager
                    .get_pi_session_for_runtime(&runtime_key)
                    .await
                    .ok_or_else(|| {
                        format!(
                            "shared-control-owner-unavailable: Pi runtime missing for attempt {}",
                            route.attempt_id
                        )
                    })?;
                session.interrupt_turn(&route.runtime_turn_id).await
            }
            EngineType::Qoder => {
                let runtime_key = provider_runtime_key_for_target(
                    &workspace_id,
                    route.engine,
                    route.provider_profile_id.as_deref(),
                )?;
                let session = state
                    .engine_manager
                    .get_qoder_session_for_runtime(&runtime_key)
                    .await
                    .ok_or_else(|| {
                        format!(
                            "shared-control-owner-unavailable: Qoder runtime missing for attempt {}",
                            route.attempt_id
                        )
                    })?;
                session.interrupt_turn(&route.runtime_turn_id).await
            }
            unsupported => Err(format!(
                "target-unavailable: unsupported Shared interrupt engine {}",
                unsupported.icon()
            )),
        }
    }
    .await;
    if let Err(error) = interrupt_result {
        state
            .shared_runtime_coordinator
            .clear_cancel_intent(&attempt_id);
        return Err(error);
    }

    Ok(json!({
        "status": "interrupted",
        "attemptId": route.attempt_id,
        "engine": route.engine,
        "bindingKey": route.binding_key,
        "nativeThreadId": route.native_thread_id,
        "runtimeTurnId": route.runtime_turn_id,
    }))
}

pub(crate) fn recovery_disposition(
    evidence: &UnresolvedAttemptEvidence,
    coordinator: &crate::shared_runtime_coordinator::SharedRuntimeCoordinator,
) -> &'static str {
    let attempt_id = &evidence.owner.requested.attempt_id;
    if coordinator.settled_for_attempt(attempt_id).is_some() {
        "terminal"
    } else if evidence.accepted && coordinator.owns_attempt(attempt_id) {
        "active"
    } else if !evidence.accepted
        && (!evidence.delivery_prepared || evidence.pending_phase.as_deref() == Some("prepared"))
    {
        "not-accepted"
    } else {
        "unknown"
    }
}

fn active_recovery_response(
    writer: &SharedEventWriter,
    coordinator: &crate::shared_runtime_coordinator::SharedRuntimeCoordinator,
    workspace_id: &str,
    thread_id: &str,
    evidence: &UnresolvedAttemptEvidence,
) -> Result<Option<Value>, String> {
    let attempt_id = &evidence.owner.requested.attempt_id;
    if !evidence.accepted || !coordinator.owns_attempt(attempt_id) {
        return Ok(None);
    }
    let route = resolve_shared_attempt_interrupt_route(
        writer,
        coordinator,
        workspace_id,
        thread_id,
        attempt_id,
    )?;
    Ok(Some(json!({
        "status": "active",
        "attemptId": route.attempt_id,
        "bindingKey": route.binding_key,
        "nativeThreadId": route.native_thread_id,
        "runtimeTurnId": route.runtime_turn_id,
        "executionTargetSnapshot": evidence.owner.requested.target,
    })))
}

/// Attempt-first recovery mutation。Probe 只是 UI 动作名；Backend 必须重新读取
/// durable evidence，并且只在强证据下落 Terminal Fact 后返回可解锁状态。
#[tauri::command]
pub(crate) async fn shared_session_v2_recover_attempt(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let evidence = unresolved_attempt_evidence(writer, &shared_session_id, None)?
        .into_iter()
        .find(|evidence| evidence.owner.requested.attempt_id == attempt_id);
    let Some(evidence) = evidence else {
        let already_committed = writer
            .events_for_session(&shared_session_id)
            .map_err(|error| error.to_string())?
            .iter()
            .any(|event| {
                event.fact_type == "conversation.turnCommitted"
                    && event.attempt_id.as_deref() == Some(attempt_id.as_str())
            });
        return if already_committed {
            Ok(json!({
                "status": "terminal-committed",
                "attemptId": attempt_id,
            }))
        } else {
            Err(format!("recovery-owner-missing: attempt {attempt_id}"))
        };
    };
    let binding_key = evidence.owner.binding_key.clone();
    if let Some(settled) = state
        .shared_runtime_coordinator
        .settled_for_attempt(&attempt_id)
    {
        let committed = commit_observed_runtime_settlement(&state, settled)?;
        return Ok(json!({
            "status": "terminal-committed",
            "attemptId": attempt_id,
            "bindingKey": committed.binding_key,
            "sequence": committed.sequence,
        }));
    }
    if let Some(active) = active_recovery_response(
        writer,
        &state.shared_runtime_coordinator,
        &workspace_id,
        &thread_id,
        &evidence,
    )? {
        return Ok(active);
    }
    if recovery_disposition(&evidence, &state.shared_runtime_coordinator) == "not-accepted" {
        let committed = commit_runtime_snapshot_core(
            writer,
            &shared_session_id,
            &attempt_id,
            recovery_terminal_snapshot(OutcomeStatus::Cancelled, "probe-not-accepted"),
            None,
        )?;
        state.shared_runtime_coordinator.remove_attempt(&attempt_id);
        return Ok(json!({
            "status": "not-accepted-committed",
            "attemptId": attempt_id,
            "bindingKey": committed.binding_key,
            "sequence": committed.sequence,
        }));
    }
    Ok(json!({
        "status": "unknown",
        "attemptId": attempt_id,
        "bindingKey": binding_key,
        "pendingPhase": evidence.pending_phase,
    }))
}

/// 用户显式重建：归档旧 Binding（durable 留痕），新 Native Session 重新 provisioning。
/// Shared Session Identity 不变；committed cursor 清空（新 binding 未消费任何历史）。
#[tauri::command]
pub(crate) async fn shared_session_v2_rebuild_binding(
    workspace_id: String,
    thread_id: String,
    binding_key: String,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let unresolved = unresolved_attempt_evidence(writer, &shared_session_id, Some(&binding_key))?;
    if unresolved.len() > 1 {
        return Err(format!(
            "recovery-owner-ambiguous: binding {binding_key} has {} unresolved attempts",
            unresolved.len()
        ));
    }
    if let Some(evidence) = unresolved.first() {
        let attempt_id = &evidence.owner.requested.attempt_id;
        if let Some(settled) = state
            .shared_runtime_coordinator
            .settled_for_attempt(attempt_id)
        {
            commit_observed_runtime_settlement(&state, settled)?;
        } else if state.shared_runtime_coordinator.owns_attempt(attempt_id) {
            // 结构化前缀供前端映射 i18n；message 保留兼容旧 startsWith 解析。
            return Err(format!(
                "recovery-active: attempt {attempt_id} is still owned by Runtime; Probe/Stop before rebuild"
            ));
        }
    }
    let rebuilt = rebuild_binding_core(writer, &shared_session_id, &binding_key)?;
    for attempt_id in &rebuilt.replaced_attempt_ids {
        state.shared_runtime_coordinator.remove_attempt(attempt_id);
    }

    Ok(json!({
        "status": PROVISIONING_PREPARED,
        "bindingKey": binding_key,
        "nativeThreadId": Value::Null,
        "archivedNativeSessionId": rebuilt.archived_native_session_id,
        "replacedAttemptIds": rebuilt.replaced_attempt_ids,
        "bindingOperationId": rebuilt.binding_operation_id,
    }))
}

#[cfg(test)]
#[path = "shared_session_v2_execution_target_contract_tests.rs"]
mod execution_target_contract_tests;
#[cfg(test)]
#[path = "shared_session_v2_resolve_dispatch_images_tests.rs"]
mod resolve_dispatch_images_tests;
#[cfg(test)]
#[path = "shared_session_v2_shared_session_workspace_owner_tests.rs"]
mod shared_session_workspace_owner_tests;
#[cfg(test)]
#[path = "shared_session_v2_runtime_dispatch_receipt_tests.rs"]
mod runtime_dispatch_receipt_tests;
#[cfg(test)]
#[path = "shared_session_v2_legacy_import_tests.rs"]
mod legacy_import_tests;
#[cfg(test)]
#[path = "shared_session_v2_shared_interrupt_owner_tests.rs"]
mod shared_interrupt_owner_tests;
#[cfg(test)]
#[path = "shared_session_v2_native_continuation_import_tests.rs"]
mod native_continuation_import_tests;
