use serde_json::{json, Value};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;
use crate::engine::EngineType;
use crate::shared_context::{
    accept_delivery,
    AcceptDeliveryRequest,
    ArtifactReadRequest,
    mark_delivery_sent,
    MarkDeliverySentRequest,
    read_artifact,
};
use crate::shared_event_log::canonical::types::{CanonicalFact, OutcomeStatus};
use crate::shared_event_log::SharedEventWriter;
use crate::shared_sessions::{now_millis, parse_shared_session_id};
use crate::state::AppState;

use super::binding_state::{
    NativeContextTrust,
    PROVISIONING_CREATING,
    provisioning_json,
    PROVISIONING_READY,
    require_shared_session_workspace_owner,
    require_writer,
    set_native_context_trust,
    upsert_binding_row,
};
use super::execution_target::{
    codex_import_items,
    collaboration_mode_for_attempt,
    context_artifact_root,
    context_capabilities,
    raw_claude_session_id,
    raw_engine_session_id,
    raw_qoder_session_id,
};
use super::receipt::{
    failed_runtime_snapshot,
    provider_runtime_key_for_target,
    runtime_response_error,
    runtime_terminal_delivery,
    runtime_turn_id,
    typed_dispatch_error,
    validate_runtime_dispatch_receipt,
};
use super::turn_lifecycle::{
    accept_turn_for_attempt_core,
    commit_runtime_snapshot_core,
    CommitTurnOutcome,
    durable_attempt_owner,
    DurableAttemptOwner,
    mark_recovery_core,
    pending_delivery_for_owner,
    require_attempt_binding_generation,
    resolve_dispatch_images,
    scoped_attempt_access_mode,
    validate_durable_attempt_target,
};

pub(crate) fn persist_context_prepare_failure(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    error: &str,
) -> String {
    // empty-context-handoff 必须保持主前缀，供 FE includes/startsWith 分类；
    // 不可被 context-prepare-failed 吞掉。
    let typed = if error.starts_with("empty-context-handoff:") {
        error.to_string()
    } else if error.contains("empty-context-handoff:") {
        format!("empty-context-handoff: {error}")
    } else if error.starts_with("context-prepare-failed:") {
        error.to_string()
    } else {
        format!("context-prepare-failed: {error}")
    };
    match settle_known_dispatch_failure(writer, session_id, owner, None, &typed) {
        Ok(()) => typed,
        Err(persist_error) => {
            format!("{typed}; canonical-failure-persistence: {persist_error}")
        }
    }
}

/// `begin_turn` 已冻结 snapshot 后的 prepare-time revalidation。
///
/// Provider/model catalog 可能在 Tx1 与 Context compile 之间变化。此时尚无 Runtime
/// side effect，必须幂等落 failed terminal，不能留下 unresolved attempt 或误标
/// recovery-required。
pub fn validate_prepare_target_core(
    writer: &SharedEventWriter,
    session_id: &str,
    attempt_id: &str,
) -> Result<(), String> {
    let owner = durable_attempt_owner(writer, session_id, attempt_id)?;
    validate_durable_attempt_target(&owner)
        .map_err(|error| persist_context_prepare_failure(writer, session_id, &owner, &error))
}

fn settle_known_dispatch_failure(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    native_session_id: Option<&str>,
    typed_error: &str,
) -> Result<(), String> {
    let code = typed_error
        .split_once(':')
        .map(|(prefix, _)| prefix)
        .unwrap_or("target-unavailable");
    commit_runtime_snapshot_core(
        writer,
        session_id,
        &owner.requested.attempt_id,
        failed_runtime_snapshot(code, typed_error),
        if owner.engine == EngineType::Claude {
            // Generated Claude session id is only requested identity until an
            // exact Runtime event/Turn ACK proves ownership.
            None
        } else {
            native_session_id
        },
    )?;
    Ok(())
}

fn mark_ambiguous_dispatch(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    reason: &str,
) -> Result<(), String> {
    mark_recovery_core(
        writer,
        session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id.clone(),
        Some(reason),
    )
}

fn persist_not_accepted_dispatch(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    native_session_id: Option<&str>,
    code: &str,
    error: &str,
) -> String {
    let typed = typed_dispatch_error(code, error);
    let existing_terminal = writer
        .events_for_session(session_id)
        .map_err(|error| error.to_string())
        .and_then(|events| {
            events
                .into_iter()
                .find(|event| {
                    event.fact_type == "conversation.turnCommitted"
                        && event.attempt_id.as_deref() == Some(owner.requested.attempt_id.as_str())
                })
                .map(|event| {
                    serde_json::from_str::<CanonicalFact>(&event.payload_json)
                        .map_err(|error| format!("parse existing turnCommitted payload: {error}"))
                })
                .transpose()
        });
    let persisted = match existing_terminal {
        Ok(Some(CanonicalFact::TurnCommitted(fact)))
            if matches!(
                fact.outcome.status,
                OutcomeStatus::Failed | OutcomeStatus::Cancelled | OutcomeStatus::Replaced
            ) =>
        {
            // Runtime terminal 与 command response 可能并发到达。已有 authoritative
            // negative terminal 时复用它，禁止追加不同 errorCode 的第二份事实。
            Ok(())
        }
        Ok(_) => {
            settle_known_dispatch_failure(writer, session_id, owner, native_session_id, &typed)
        }
        Err(error) => Err(error),
    };
    match persisted {
        Ok(()) => typed,
        Err(persist_error) => format!("{typed}; canonical-failure-persistence: {persist_error}"),
    }
}

fn persist_binding_recovery_and_cleanup(
    state: &AppState,
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    native_session_id: Option<&str>,
) -> String {
    const RECOVERY_REASON: &str = "native-session-not-found";
    let typed = persist_not_accepted_dispatch(
        writer,
        session_id,
        owner,
        native_session_id,
        "binding-recovery-required",
        RECOVERY_REASON,
    );
    let recovery_error = mark_recovery_core(
        writer,
        session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id.clone(),
        Some(RECOVERY_REASON),
    )
    .err();
    state
        .shared_runtime_coordinator
        .remove_attempt(&owner.requested.attempt_id);
    match recovery_error {
        Some(error) => format!("{typed}; binding-recovery-persistence: {error}"),
        None => typed,
    }
}

fn persist_not_accepted_dispatch_and_cleanup(
    state: &AppState,
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    native_session_id: Option<&str>,
    code: &str,
    error: &str,
) -> String {
    let typed =
        persist_not_accepted_dispatch(writer, session_id, owner, native_session_id, code, error);
    state
        .shared_runtime_coordinator
        .remove_attempt(&owner.requested.attempt_id);
    typed
}

fn persist_ambiguous_dispatch(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    error: &str,
) -> String {
    let typed = typed_dispatch_error("ambiguous-runtime", error);
    match mark_ambiguous_dispatch(writer, session_id, owner, &typed) {
        Ok(()) => typed,
        Err(persist_error) => format!("{typed}; canonical-failure-persistence: {persist_error}"),
    }
}

pub(crate) fn commit_settled_runtime_attempt(
    writer: &SharedEventWriter,
    settled: crate::shared_runtime_coordinator::SettledSharedRuntimeAttempt,
) -> Result<CommitTurnOutcome, String> {
    commit_runtime_snapshot_core(
        writer,
        &settled.owner.shared_session_id,
        &settled.owner.attempt_id,
        settled.final_snapshot,
        settled.owner.native_session_id.as_deref(),
    )
}

pub(crate) fn commit_observed_runtime_settlement(
    state: &AppState,
    settled: crate::shared_runtime_coordinator::SettledSharedRuntimeAttempt,
) -> Result<CommitTurnOutcome, String> {
    let writer = require_writer(state)?;
    let owner = settled.owner.clone();
    let binding_recovery_required = owner.engine == EngineType::Claude
        && settled.final_snapshot.outcome == OutcomeStatus::Failed
        && settled
            .final_snapshot
            .error_message
            .as_deref()
            .is_some_and(crate::shared_runtime_coordinator::is_missing_native_session_error);
    match commit_settled_runtime_attempt(writer, settled) {
        Ok(committed) => {
            if binding_recovery_required {
                mark_recovery_core(
                    writer,
                    &owner.shared_session_id,
                    &owner.binding_key,
                    owner.engine,
                    owner.execution_target_snapshot.provider_profile_id.clone(),
                    Some("native-session-not-found"),
                )
                .map_err(|error| format!("binding-recovery-persistence: {error}"))?;
            }
            state
                .shared_runtime_coordinator
                .remove_attempt(&owner.attempt_id);
            Ok(committed)
        }
        Err(error) => {
            // Explicit recovery/rebuild already terminalized this generation.
            // A late Runtime final is diagnostic evidence only; it must not poison
            // the replacement Binding generation.
            if error.starts_with("stale-runtime-terminal:")
                || error.starts_with("stale-runtime-terminal ")
            {
                state
                    .shared_runtime_coordinator
                    .remove_attempt(&owner.attempt_id);
                return Err(error);
            }
            let provider_profile_id = writer
                .binding_state(&owner.shared_session_id, &owner.binding_key)
                .ok()
                .flatten()
                .and_then(|binding| binding.provider_profile_id);
            let _ = mark_recovery_core(
                writer,
                &owner.shared_session_id,
                &owner.binding_key,
                owner.engine,
                provider_profile_id,
                Some("canonical-terminal-commit-failed"),
            );
            Err(error)
        }
    }
}

fn persist_materialized_binding(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    native_session_id: &str,
) -> Result<(), String> {
    let existing = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&existing, owner)?;
    let identity_acknowledged = owner.engine == EngineType::Codex;
    let provisioning_state = if identity_acknowledged {
        PROVISIONING_READY
    } else {
        PROVISIONING_CREATING
    };
    let availability = if identity_acknowledged {
        "ready"
    } else {
        "provisioning"
    };
    upsert_binding_row(
        writer,
        session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id.clone(),
        Some(&existing),
        Some(native_session_id.to_string()),
        None,
        provisioning_json(
            provisioning_state,
            None,
            Some(&owner.requested.attempt_id),
            Some(&owner.binding_operation_id),
            Some(&existing),
            None,
        ),
        availability,
    )
    .map_err(|error| error.to_string())
}

fn mark_binding_materialization_started(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
) -> Result<(), String> {
    let existing = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&existing, owner)?;
    if existing
        .native_session_id
        .as_deref()
        .is_some_and(|native_session_id| !native_session_id.trim().is_empty())
    {
        return Ok(());
    }
    upsert_binding_row(
        writer,
        session_id,
        &owner.binding_key,
        owner.engine,
        owner.provider_profile_id.clone(),
        Some(&existing),
        None,
        None,
        provisioning_json(
            PROVISIONING_CREATING,
            None,
            Some(&owner.requested.attempt_id),
            Some(&owner.binding_operation_id),
            Some(&existing),
            None,
        ),
        "provisioning",
    )
    .map_err(|error| error.to_string())
}

async fn materialize_attempt_binding(
    workspace_id: &str,
    session_id: &str,
    owner: &DurableAttemptOwner,
    writer: &SharedEventWriter,
    state: &AppState,
    app: &AppHandle,
) -> Result<String, String> {
    let existing_binding = writer
        .binding_state(session_id, &owner.binding_key)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("binding {} is missing", owner.binding_key))?;
    require_attempt_binding_generation(&existing_binding, owner)?;
    let existing = existing_binding
        .native_session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if existing.is_none() {
        // CAS-like durable transition before native-session creation. A crash after
        // this point is ambiguous and must be recovered; a `prepared` row proves
        // that no materialization side effect started.
        mark_binding_materialization_started(writer, session_id, owner)?;
    }
    let native_session_id = match owner.engine {
        EngineType::Codex => {
            if let Some(thread_id) = existing {
                let provider_runtime_id = owner
                    .provider_profile_id
                    .as_deref()
                    .unwrap_or(crate::codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID);
                crate::codex::ensure_codex_session_for_provider(
                    workspace_id,
                    provider_runtime_id,
                    state,
                    app,
                )
                .await?;
                let resumed = crate::shared::codex_core::resume_thread_core(
                    &state.sessions,
                    workspace_id.to_string(),
                    owner.provider_profile_id.clone(),
                    thread_id.clone(),
                )
                .await?;
                if let Some(error) = runtime_response_error(&resumed) {
                    return Err(error);
                }
                thread_id
            } else {
                let started = crate::codex::start_thread_with_runtime_retry_for_provider(
                    workspace_id,
                    owner.target.model.clone(),
                    owner.provider_profile_id.clone(),
                    state,
                    app,
                )
                .await?;
                crate::shared::codex_core::extract_thread_id_from_response(&started).ok_or_else(
                    || {
                        "ambiguous-runtime: Codex binding start ACK missing thread identity"
                            .to_string()
                    },
                )?
            }
        }
        EngineType::Claude => {
            if let Some(model) = owner.target.model.as_deref() {
                if !crate::engine::is_valid_claude_model_for_passthrough(model) {
                    return Err(format!(
                        "target-unavailable: runtime model '{model}' cannot be passed to Claude CLI"
                    ));
                }
            }
            // 兼容 foundation 回归期间写入的 raw UUID；canonical identity 始终
            // 规范化为 `claude:<uuid>`，不能把 raw existing 误判成“无 Binding”。
            let raw_session_id = existing
                .as_deref()
                .and_then(raw_claude_session_id)
                .map(str::to_string)
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            format!("claude:{raw_session_id}")
        }
        // Grok 支持 `-s` 预分配：与 Claude 一样 materialize 时写入 established
        // `grok:{uuid}`，首轮 create 复用该 id，避免 pending 与落盘 id 分叉导致
        // Hidden Binding 无法从 sidebar hide set 匹配。
        EngineType::Grok => {
            let raw_session_id = existing
                .as_deref()
                .filter(|value| {
                    crate::shared_sessions::binding_uses_established_native_thread(
                        EngineType::Grok,
                        value,
                    )
                })
                .and_then(|value| raw_engine_session_id(EngineType::Grok, value))
                .map(str::to_string)
                .unwrap_or_else(|| Uuid::new_v4().to_string());
            format!("grok:{raw_session_id}")
        }
        // Kimi / OpenCode / Pi 真实 id 由 CLI 事后回写；首轮可暂存 pending，
        // settlement 后 rebind 到 `engine:{raw}`。若已有 established 前缀 id 则复用。
        EngineType::Kimi | EngineType::OpenCode | EngineType::Pi => {
            if let Some(existing_id) = existing.as_deref().filter(|value| {
                crate::shared_sessions::binding_uses_established_native_thread(owner.engine, value)
            }) {
                existing_id.to_string()
            } else if let Some(existing_id) = existing.as_deref().filter(|value| {
                !crate::shared_sessions::is_pending_shared_binding_thread_id(owner.engine, value)
            }) {
                // 兼容历史 raw id：规范化为 engine 前缀。
                let raw = raw_engine_session_id(owner.engine, existing_id)
                    .unwrap_or(existing_id)
                    .to_string();
                format!("{}:{raw}", owner.engine.icon())
            } else {
                crate::shared_sessions::engine_binding_thread_id(
                    owner.engine,
                    Uuid::new_v4().to_string().as_str(),
                )
            }
        }
        EngineType::Qoder => {
            let existing_id = existing.as_deref().filter(|value| {
                !crate::shared_sessions::is_pending_shared_binding_thread_id(
                    EngineType::Qoder,
                    value,
                )
            });
            match existing_id {
                Some(existing_id) => {
                    crate::engine::qoder_provider_profile::canonical_qoder_native_session_id(
                        existing_id,
                        owner.provider_profile_id.as_deref(),
                    )?
                }
                None => crate::shared_sessions::engine_binding_thread_id(
                    EngineType::Qoder,
                    Uuid::new_v4().to_string().as_str(),
                ),
            }
        }
        _ => {
            return Err(format!(
                "target-unavailable: unsupported Shared engine {}",
                owner.engine.icon()
            ));
        }
    };
    persist_materialized_binding(writer, session_id, owner, native_session_id.as_str())?;
    Ok(native_session_id)
}

fn accept_context_for_attempt_core(
    writer: &SharedEventWriter,
    session_id: &str,
    owner: &DurableAttemptOwner,
    package_id: &str,
    native_session_id: &str,
    native_request_id: Option<String>,
) -> Result<(), String> {
    accept_delivery(
        writer,
        &AcceptDeliveryRequest {
            session_id: session_id.to_string(),
            binding_key: owner.binding_key.clone(),
            logical_turn_id: owner.requested.logical_turn_id.clone(),
            attempt_id: owner.requested.attempt_id.clone(),
            binding_operation_id: owner.binding_operation_id.clone(),
            package_id: package_id.to_string(),
            native_session_id: Some(native_session_id.to_string()),
            native_request_id,
            accepted_at: now_millis() as i64,
        },
    )
}

/// V2 actual-send boundary：IPC 只携带 durable attempt identity、artifact identity
/// 与非 Target 的 operational options。Engine/Provider/Model/Reasoning/Text 均从
/// `conversation.turnRequested` 读取；Binding 只读写 SQLite shared_binding_state。
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn shared_session_v2_dispatch_turn(
    workspace_id: String,
    thread_id: String,
    attempt_id: String,
    artifact_id: String,
    artifact_checksum: String,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    collaboration_mode: Option<Value>,
    preferred_language: Option<String>,
    custom_spec_root: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Value, String> {
    let writer = require_writer(&state)?;
    let shared_session_id = parse_shared_session_id(&thread_id)?;
    require_shared_session_workspace_owner(&workspace_id, &shared_session_id)?;
    let owner = durable_attempt_owner(writer, &shared_session_id, &attempt_id)?;
    let access_mode = scoped_attempt_access_mode(&owner, access_mode)?;
    validate_durable_attempt_target(&owner).map_err(|error| {
        persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            None,
            "target-unavailable",
            &error,
        )
    })?;
    let (binding_before_dispatch, pending) =
        pending_delivery_for_owner(writer, &shared_session_id, &owner).map_err(|error| {
            persist_not_accepted_dispatch_and_cleanup(
                &state,
                writer,
                &shared_session_id,
                &owner,
                None,
                "target-unavailable",
                &error,
            )
        })?;
    if pending.phase != "prepared" {
        return Err(persist_ambiguous_dispatch(
            writer,
            &shared_session_id,
            &owner,
            &format!(
                "attempt {attempt_id} delivery phase is '{}'; probe before retry",
                pending.phase
            ),
        ));
    }
    let artifact = read_artifact(
        context_artifact_root(&state)?,
        &ArtifactReadRequest {
            workspace_id: workspace_id.clone(),
            session_id: shared_session_id.clone(),
            artifact_id: artifact_id.clone(),
            checksum: artifact_checksum,
        },
    )
    .map_err(|error| {
        persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            None,
            "target-unavailable",
            &error,
        )
    })?;
    if artifact.artifact_id != artifact_id
        || artifact.package.package_id != pending.package_id
        || artifact.package.manifest.source_checksum != pending.source_checksum
        || artifact.package.manifest.mode.operation() != pending.operation
    {
        return Err(persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            None,
            "target-unavailable",
            &format!("context artifact owner mismatch for attempt {attempt_id}"),
        ));
    }
    let capabilities = context_capabilities(&owner.target);
    let had_native_binding = binding_before_dispatch
        .native_session_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let provider_runtime_key = provider_runtime_key_for_target(
        &workspace_id,
        owner.engine,
        owner.provider_profile_id.as_deref(),
    )
    .map_err(|error| {
        persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            None,
            "target-unavailable",
            &error,
        )
    })?;
    let initial_owner = crate::shared_runtime_coordinator::SharedRuntimeAttemptOwner {
        workspace_id: workspace_id.clone(),
        provider_runtime_key,
        shared_session_id: shared_session_id.clone(),
        shared_thread_id: thread_id.clone(),
        logical_turn_id: owner.requested.logical_turn_id.clone(),
        attempt_id: attempt_id.clone(),
        binding_key: owner.binding_key.clone(),
        binding_operation_id: owner.binding_operation_id.clone(),
        engine: owner.engine,
        execution_target_snapshot: owner.requested.target.clone(),
        // D8：复用 native Binding 时，上一 turn 的迟到事件也携带同一 native id。
        // send response 给出本次 runtimeTurnId 前不得注册 native fallback；否则迟到
        // terminal 可能被错误归给新 attempt。先缓存 unowned event，拿到 exact turn id
        // 后再一次性 bind + replay。
        native_session_id: None,
        runtime_turn_id: None,
        context_marker: (capabilities.strong_context_ack
            && pending.operation == "prompt-prefix"
            && !artifact.package.prompt_prefix.trim().is_empty())
        .then(
            || crate::shared_runtime_coordinator::SharedRuntimeContextMarker {
                package_id: pending.package_id.clone(),
                source_checksum: pending.source_checksum.clone(),
            },
        ),
    };
    if let Some(settled) = state
        .shared_runtime_coordinator
        .register_attempt(initial_owner)
        .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?
    {
        let terminal = runtime_terminal_delivery(&settled);
        let committed = commit_observed_runtime_settlement(&state, settled)?;
        return Ok(json!({
            "status": "accepted",
            "attemptId": attempt_id,
            "logicalTurnId": owner.requested.logical_turn_id,
            "engine": owner.engine,
            "providerProfileId": owner.provider_profile_id,
            "model": owner.target.model,
            "reasoningEffort": owner.target.reasoning_effort,
            "bindingKey": committed.binding_key,
            "nativeThreadId": binding_before_dispatch.native_session_id,
            "runtimeTurnId": Value::Null,
            "alreadySettled": true,
            "response": Value::Null,
            "delivery": {
                "promptAcceptance": "accepted",
                "contextAcceptance": {
                    "status": "accepted",
                    "packageId": pending.package_id,
                    "sourceChecksum": pending.source_checksum,
                    "ackFidelity": if capabilities.strong_context_ack { "strong" } else { "weak" },
                    "evidence": "runtime-terminal-replay",
                },
                "terminal": terminal,
            },
        }));
    }
    let needs_codex_provisioning_hold = owner.engine == EngineType::Codex && !had_native_binding;
    if needs_codex_provisioning_hold {
        state
            .shared_runtime_coordinator
            .hold_native_provisioning(&attempt_id)
            .map_err(|error| {
                persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error)
            })?;
    }
    let native_session_id = match materialize_attempt_binding(
        &workspace_id,
        &shared_session_id,
        &owner,
        writer,
        &state,
        &app,
    )
    .await
    {
        Ok(native_session_id) => native_session_id,
        Err(error) => {
            if needs_codex_provisioning_hold {
                // exact identity 未返回，隐藏这次 provisioning 窗口内的早到
                // thread/started；durable Binding 已进入显式 recovery。
                let _ = state
                    .shared_runtime_coordinator
                    .finish_native_provisioning(&attempt_id);
            }
            return Err(persist_ambiguous_dispatch(
                writer,
                &shared_session_id,
                &owner,
                &error,
            ));
        }
    };
    if let Err(error) = state
        .shared_runtime_coordinator
        .hold_native_session(&attempt_id, &native_session_id)
    {
        if needs_codex_provisioning_hold {
            let _ = state
                .shared_runtime_coordinator
                .finish_native_provisioning(&attempt_id);
        }
        return Err(persist_ambiguous_dispatch(
            writer,
            &shared_session_id,
            &owner,
            &error,
        ));
    }
    if needs_codex_provisioning_hold {
        for event in state
            .shared_runtime_coordinator
            .finish_native_provisioning(&attempt_id)
            .map_err(|error| {
                persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error)
            })?
        {
            let _ = app.emit("app-server-event", event);
        }
    }
    let delivery_request_id = format!("shared-delivery:{attempt_id}");
    mark_delivery_sent(
        writer,
        &MarkDeliverySentRequest {
            session_id: shared_session_id.clone(),
            binding_key: owner.binding_key.clone(),
            attempt_id: attempt_id.clone(),
            binding_operation_id: owner.binding_operation_id.clone(),
            native_session_id: native_session_id.clone(),
            native_request_id: delivery_request_id.clone(),
            sent_at: now_millis() as i64,
        },
    )
    .map_err(|error| {
        persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            Some(&native_session_id),
            "target-unavailable",
            &error,
        )
    })?;
    let no_context_transfer_required =
        artifact.package.delta.is_empty() && artifact.package.prompt_prefix.trim().is_empty();
    let mut context_evidence = if no_context_transfer_required {
        "no-context-transfer-required"
    } else {
        "typed-prompt-acceptance"
    };
    if pending.operation == "context-import" {
        if owner.engine != EngineType::Codex {
            let error =
                "target-unavailable: context-import is not supported by the selected Runtime";
            return Err(persist_not_accepted_dispatch_and_cleanup(
                &state,
                writer,
                &shared_session_id,
                &owner,
                Some(&native_session_id),
                "target-unavailable",
                error,
            ));
        }
        if !no_context_transfer_required {
            crate::shared::codex_core::inject_thread_items_core(
                &state.sessions,
                &workspace_id,
                owner.provider_profile_id.as_deref(),
                &native_session_id,
                codex_import_items(&artifact.package),
            )
            .await
            .map_err(|error| {
                persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error)
            })?;
            context_evidence = "thread/inject_items-jsonrpc-success";
        }
        accept_context_for_attempt_core(
            writer,
            &shared_session_id,
            &owner,
            &pending.package_id,
            &native_session_id,
            (!no_context_transfer_required).then(|| delivery_request_id.clone()),
        )?;
        // 非零交接 accept 后可再信任 native 省略。
        if !no_context_transfer_required {
            set_native_context_trust(
                writer,
                &shared_session_id,
                &owner.binding_key,
                NativeContextTrust::Trusted,
            )?;
        }
    }

    // 附图：调用方参数优先；缺省时从 durable TurnRequested.image_refs 回填。
    // 协作 driveAttempt 只传 attemptId、不重复传图，必须走这条 SSOT。
    let images = resolve_dispatch_images(images, &owner.requested.input);
    let has_images = images.as_ref().is_some_and(|paths| !paths.is_empty());
    let user_text = owner
        .requested
        .input
        .text
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            if has_images {
                // 纯图轮：引擎侧至少需要占位文案，避免 silent empty prompt
                Some("（请根据附图回答）".to_string())
            } else {
                None
            }
        })
        .ok_or_else(|| {
            persist_ambiguous_dispatch(
                writer,
                &shared_session_id,
                &owner,
                "durable attempt has empty user text after context delivery started",
            )
        })?;
    let outbound_text = if pending.operation == "prompt-prefix"
        && !artifact.package.prompt_prefix.trim().is_empty()
    {
        format!(
            "{}\n\nCurrent user request:\n{}",
            artifact.package.prompt_prefix.trim(),
            user_text
        )
    } else {
        user_text
    };

    let response = match owner.engine {
        EngineType::Codex => {
            let (mode_enforcement_enabled, extra_developer_instructions) = {
                let settings = state.app_settings.lock().await;
                (
                    settings.codex_mode_enforcement_enabled,
                    crate::backend::app_server_cli::codex_generated_developer_instructions_for_turn(
                        &settings,
                    ),
                )
            };
            crate::shared::codex_core::send_user_message_core(
                &state.sessions,
                workspace_id.clone(),
                owner.provider_profile_id.clone(),
                native_session_id.clone(),
                outbound_text,
                owner.target.model.clone(),
                owner.target.reasoning_effort.clone(),
                access_mode,
                images,
                collaboration_mode_for_attempt(collaboration_mode, &owner.target),
                preferred_language,
                custom_spec_root,
                mode_enforcement_enabled,
                extra_developer_instructions,
            )
            .await
        }
        EngineType::Claude => {
            let raw_session_id = native_session_id
                .strip_prefix("claude:")
                .unwrap_or(native_session_id.as_str())
                .to_string();
            // `None` 在通用 Native send 中表示“允许从 session catalog 回退”。
            // Shared 的 durable local/default Target 不是缺省值，必须显式传 local
            // sentinel，防止旧 session metadata 把本轮悄悄切回 managed Provider。
            let runtime_provider_profile_id = owner.provider_profile_id.clone().or_else(|| {
                Some(crate::engine::claude::CLAUDE_LOCAL_PROVIDER_PROFILE_ID.to_string())
            });
            crate::engine::engine_send_message(
                workspace_id.clone(),
                outbound_text,
                Some(EngineType::Claude),
                owner.target.model.clone(),
                owner.target.reasoning_effort.clone(),
                disable_thinking,
                access_mode,
                images,
                had_native_binding,
                Some(native_session_id.clone()),
                Some(raw_session_id),
                None,
                None,
                None,
                runtime_provider_profile_id,
                custom_spec_root,
                None,
                None,
                None,
                app.clone(),
                state.clone(),
            )
            .await
        }
        EngineType::Kimi | EngineType::Grok | EngineType::OpenCode | EngineType::Pi | EngineType::Qoder => {
            let runtime_provider_profile_id = owner.provider_profile_id.clone().or_else(|| {
                Some(
                    match owner.engine {
                        EngineType::Kimi => {
                            crate::engine::kimi_provider_profile::KIMI_LOCAL_PROVIDER_PROFILE_ID
                        }
                        EngineType::Grok => {
                            crate::engine::grok_provider_profile::GROK_LOCAL_PROVIDER_PROFILE_ID
                        }
                        EngineType::OpenCode => {
                            crate::engine::opencode_provider_profile::OPENCODE_LOCAL_PROVIDER_PROFILE_ID
                        }
                        EngineType::Pi => {
                            crate::engine::pi_provider_profile::PI_LOCAL_PROVIDER_PROFILE_ID
                        }
                        EngineType::Qoder => {
                            crate::engine::qoder_provider_profile::QODER_GLOBAL_PROVIDER_PROFILE_ID
                        }
                        _ => unreachable!("new Shared engine branch is exhaustively matched"),
                    }
                    .to_string(),
                )
            });
            // 对齐 Claude：established identity 始终把 raw session id 传给 runtime。
            // Grok 首轮 continue=false 仍带 pre-assigned id（`-s`）；Kimi/OpenCode/Pi
            // pending 时 raw 可能是 pending 占位，runtime 自行忽略/新建。
            let established = crate::shared_sessions::binding_uses_established_native_thread(
                owner.engine,
                &native_session_id,
            );
            let runtime_session_id = if owner.engine == EngineType::Qoder {
                raw_qoder_session_id(
                    &native_session_id,
                    runtime_provider_profile_id.as_deref(),
                )?
            } else {
                raw_engine_session_id(owner.engine, &native_session_id)
                    .filter(|raw| {
                        !crate::shared_sessions::is_pending_shared_binding_thread_id(
                            owner.engine,
                            raw,
                        )
                    })
                    .map(str::to_string)
            };
            let continue_session = had_native_binding && established;
            crate::engine::engine_send_message(
                workspace_id.clone(),
                outbound_text,
                Some(owner.engine),
                owner.target.model.clone(),
                owner.target.reasoning_effort.clone(),
                disable_thinking,
                access_mode,
                images,
                continue_session,
                Some(native_session_id.clone()),
                // Grok materialize 已预分配 `grok:{uuid}`：首轮 continue=false 仍传 raw 走 `-s`。
                // 禁止把 pending 占位塞给 runtime。Kimi/OpenCode 仅 established 后 resume。
                if owner.engine == EngineType::Grok {
                    runtime_session_id
                } else {
                    runtime_session_id.filter(|_| established)
                },
                None,
                None,
                None,
                runtime_provider_profile_id,
                custom_spec_root,
                None,
                None,
                None,
                app.clone(),
                state.clone(),
            )
            .await
        }
        _ => Err(format!(
            "target-unavailable: unsupported Shared engine {}",
            owner.engine.icon()
        )),
    }
    .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?;

    if let Some(error) = runtime_response_error(&response) {
        if owner.engine == EngineType::Claude
            && crate::shared_runtime_coordinator::is_missing_native_session_error(&error)
        {
            return Err(persist_binding_recovery_and_cleanup(
                &state,
                writer,
                &shared_session_id,
                &owner,
                Some(&native_session_id),
            ));
        }
        return Err(persist_not_accepted_dispatch_and_cleanup(
            &state,
            writer,
            &shared_session_id,
            &owner,
            Some(&native_session_id),
            "target-provider-rejected",
            &error,
        ));
    }
    let dispatch_receipt = validate_runtime_dispatch_receipt(&response, &owner, &workspace_id)
        .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?;
    if owner.engine == EngineType::Claude {
        if let Some(requested_model) = owner.target.model.as_deref() {
            let runtime_model = response
                .pointer("/modelResolution/runtimeModel")
                .or_else(|| response.pointer("/result/modelResolution/runtimeModel"))
                .and_then(Value::as_str);
            if runtime_model != Some(requested_model) {
                return Err(persist_ambiguous_dispatch(
                    writer,
                    &shared_session_id,
                    &owner,
                    &format!(
                        "Claude runtime model ACK mismatch; requested '{requested_model}', received '{}'",
                        runtime_model.unwrap_or("<missing>")
                    ),
                ));
            }
        }
    }
    let native_turn_id = runtime_turn_id(&response).ok_or_else(|| {
        persist_ambiguous_dispatch(
            writer,
            &shared_session_id,
            &owner,
            "Runtime ACK missing exact turn identity",
        )
    })?;
    state
        .shared_runtime_coordinator
        .bind_runtime_turn(&attempt_id, Some(&native_turn_id), Some(&native_session_id))
        .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?;

    if pending.operation == "prompt-prefix" {
        if capabilities.strong_context_ack && !artifact.package.prompt_prefix.trim().is_empty() {
            let wait_outcome = state
                .shared_runtime_coordinator
                .wait_for_context_ack_or_settlement(&attempt_id, Duration::from_secs(30))
                .await
                .map_err(|error| {
                    persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error)
                })?;
            let ack = match wait_outcome {
                crate::shared_runtime_coordinator::SharedRuntimeContextWaitOutcome::Acknowledged(
                    ack,
                ) => ack,
                crate::shared_runtime_coordinator::SharedRuntimeContextWaitOutcome::Settled(
                    settled,
                ) => {
                    let outcome = settled.final_snapshot.outcome;
                    let detail = settled
                        .final_snapshot
                        .error_message
                        .clone()
                        .unwrap_or_else(|| {
                            "Runtime terminated before Shared context ACK".to_string()
                        });
                    let binding_recovery_required = owner.engine == EngineType::Claude
                        && outcome == OutcomeStatus::Failed
                        && crate::shared_runtime_coordinator::is_missing_native_session_error(
                            &detail,
                        );
                    commit_observed_runtime_settlement(&state, settled)?;
                    if binding_recovery_required {
                        return Err(
                            "binding-recovery-required: native-session-not-found".to_string(),
                        );
                    }
                    return Err(match outcome {
                        OutcomeStatus::Failed => {
                            format!("target-provider-rejected: {detail}")
                        }
                        OutcomeStatus::Cancelled | OutcomeStatus::Replaced => {
                            format!("target-unavailable: {detail}")
                        }
                        OutcomeStatus::Completed => format!(
                            "ambiguous-runtime: Runtime completed before Shared context ACK: {detail}"
                        ),
                    });
                }
            };
            if ack.package_id != pending.package_id
                || ack.source_checksum != pending.source_checksum
            {
                return Err(persist_ambiguous_dispatch(
                    writer,
                    &shared_session_id,
                    &owner,
                    "Claude context echo ACK owner mismatch",
                ));
            }
            context_evidence = "claude-replay-echo-checksum";
        }
        accept_context_for_attempt_core(
            writer,
            &shared_session_id,
            &owner,
            &pending.package_id,
            &native_session_id,
            Some(native_turn_id.clone()),
        )
        .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?;
        if !no_context_transfer_required {
            if let Err(error) = set_native_context_trust(
                writer,
                &shared_session_id,
                &owner.binding_key,
                NativeContextTrust::Trusted,
            ) {
                return Err(persist_ambiguous_dispatch(
                    writer,
                    &shared_session_id,
                    &owner,
                    &error,
                ));
            }
        }
    }
    accept_turn_for_attempt_core(
        writer,
        &shared_session_id,
        &attempt_id,
        &native_session_id,
        Some(native_turn_id.clone()),
    )
    .map_err(|error| persist_ambiguous_dispatch(writer, &shared_session_id, &owner, &error))?;

    // durable prompt/context accept 完成后才能开放 Shared UI。循环 drain 时
    // barrier 始终保持：每个 ingress 先发布 authoritative observation，再发
    // projected AppServerEvent；一次空 drain 才在 coordinator lock 内原子放行
    // 后续实时 fan-out。
    let mut early_terminal = None;
    loop {
        let batch = state
            .shared_runtime_coordinator
            .drain_replay_barrier(&attempt_id)?;
        for event in batch.native_app_server_events {
            let _ = app.emit("app-server-event", event);
        }
        for delivery in batch.deliveries {
            if early_terminal.is_none() {
                early_terminal = delivery
                    .observation
                    .settled
                    .as_ref()
                    .map(runtime_terminal_delivery);
            }
            crate::event_sink::publish_shared_runtime_observation(&state, &delivery.observation);
            for event in delivery.app_server_events {
                let _ = app.emit("app-server-event", event);
            }
        }
        if batch.barrier_cleared {
            break;
        }
    }
    let acknowledged_provider_profile_id = dispatch_receipt
        .get("providerProfileId")
        .cloned()
        .unwrap_or(Value::Null);
    let acknowledged_model = dispatch_receipt
        .get("model")
        .cloned()
        .unwrap_or(Value::Null);
    let acknowledged_reasoning_effort = dispatch_receipt
        .get("reasoningEffort")
        .cloned()
        .unwrap_or(Value::Null);

    Ok(json!({
        "status": "accepted",
        "attemptId": attempt_id,
        "logicalTurnId": owner.requested.logical_turn_id,
        "engine": owner.engine,
        "providerProfileId": acknowledged_provider_profile_id,
        "model": acknowledged_model,
        "reasoningEffort": acknowledged_reasoning_effort,
        "bindingKey": owner.binding_key,
        "nativeThreadId": native_session_id,
        "runtimeTurnId": native_turn_id,
        "alreadySettled": early_terminal.is_some(),
        "result": response.get("result").cloned().unwrap_or_else(|| response.clone()),
        "turn": response
            .get("turn")
            .cloned()
            .or_else(|| response.pointer("/result/turn").cloned())
            .unwrap_or(Value::Null),
        "response": response,
        "dispatchReceipt": dispatch_receipt,
        "delivery": {
            "promptAcceptance": "accepted",
            "contextAcceptance": {
                "status": "accepted",
                "packageId": pending.package_id,
                "sourceChecksum": pending.source_checksum,
                "ackFidelity": if capabilities.strong_context_ack { "strong" } else { "weak" },
                "evidence": context_evidence,
            },
            "terminal": early_terminal,
        },
    }))
}

