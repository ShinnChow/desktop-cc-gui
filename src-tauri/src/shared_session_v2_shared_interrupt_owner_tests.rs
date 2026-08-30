use super::*;
use crate::shared_event_log::{open, OpenOutcome, SessionTargetUpdate};
use crate::shared_runtime_coordinator::{SharedRuntimeAttemptOwner, SharedRuntimeCoordinator};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn open_test_writer(tag: &str) -> (PathBuf, SharedEventWriter) {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let root = std::env::temp_dir().join(format!(
        "mossx-shared-interrupt-{tag}-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir_all(&root).expect("create test root");
    let writer = match open(&root.join("shared-events.db")).expect("open store") {
        OpenOutcome::Ready(writer) => writer,
        OpenOutcome::ReadOnlyRecovery { reason, .. } => {
            panic!("unexpected recovery store: {reason}")
        }
    };
    (root, writer)
}

fn target(engine: EngineType, provider: &str) -> ExecutionTargetInput {
    ExecutionTargetInput {
        engine,
        provider_profile_id: Some(provider.to_string()),
        model_catalog_entry_id: Some(format!("{provider}-catalog-model")),
        model: Some(match engine {
            EngineType::Claude => "claude-sonnet-4-5".to_string(),
            EngineType::Codex => "gpt-5-codex".to_string(),
            EngineType::Kimi => "kimi-k2".to_string(),
            EngineType::Grok => "ccgui/grok-4.5".to_string(),
            EngineType::OpenCode => "ccgui/opencode-model".to_string(),
            EngineType::Pi => "auto".to_string(),
            EngineType::Qoder => "qmodel_38max".to_string(),
            EngineType::Gemini | EngineType::Dsh => "unsupported".to_string(),
        }),
        reasoning_effort: Some("medium".to_string()),
        provider_profile_name_snapshot: Some(provider.to_string()),
        provider_profile_source: Some(CanonicalProviderProfileSource::Managed),
        runtime_capability_fingerprint: None,
    }
}

fn assert_route(engine: EngineType, provider: &str) {
    let session_id = format!("interrupt-{provider}");
    let shared_thread_id = format!("shared:{session_id}");
    let (root, writer) = open_test_writer(provider);
    let begin = begin_turn_core(
        &writer,
        &session_id,
        &target(engine, provider),
        "hello".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let logical_turn_id = begin.logical_turn_id.expect("logical turn");
    let binding_key = begin.binding_key;
    let snapshot = begin.snapshot.expect("snapshot");
    let binding_operation_id = durable_attempt_owner(&writer, &session_id, &attempt_id)
        .expect("durable owner")
        .binding_operation_id;
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(SharedRuntimeAttemptOwner {
            workspace_id: "ws-1".to_string(),
            provider_runtime_key: provider_runtime_key_for_target(
                "ws-1",
                engine,
                Some(provider),
            )
            .expect("provider runtime key"),
            shared_session_id: session_id,
            shared_thread_id: shared_thread_id.clone(),
            logical_turn_id,
            attempt_id: attempt_id.clone(),
            binding_key: binding_key.clone(),
            binding_operation_id,
            engine,
            execution_target_snapshot: snapshot,
            native_session_id: Some(format!("native-{provider}")),
            runtime_turn_id: Some(format!("run-{provider}")),
            context_marker: None,
        })
        .expect("register owner");

    let route = resolve_shared_attempt_interrupt_route(
        &writer,
        &coordinator,
        "ws-1",
        &shared_thread_id,
        &attempt_id,
    )
    .expect("resolve route");
    assert_eq!(route.engine, engine);
    assert_eq!(route.provider_profile_id.as_deref(), Some(provider));
    assert_eq!(route.binding_key, binding_key);
    // 与 SharedRuntimeCoordinator::normalize_native_session_identity 对齐：
    // Qoder 额外带 distribution；其余 CLI 使用 engine: 前缀；Codex/Gemini/Dsh 保持 raw。
    let expected_native_thread_id = match engine {
        EngineType::Claude
        | EngineType::Kimi
        | EngineType::Pi
        | EngineType::Grok
        | EngineType::OpenCode => {
            format!("{}:native-{provider}", engine.icon())
        }
        EngineType::Qoder => format!("qoder:{provider}:native-{provider}"),
        EngineType::Codex | EngineType::Gemini | EngineType::Dsh => {
            format!("native-{provider}")
        }
    };
    assert_eq!(route.native_thread_id, expected_native_thread_id);
    assert_eq!(route.runtime_turn_id, format!("run-{provider}"));

    coordinator.remove_attempt(&attempt_id);
    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn active_recovery_returns_exact_accepted_owner_envelope() {
    let session_id = "recovery-active-owner";
    let shared_thread_id = format!("shared:{session_id}");
    let provider = "provider-active";
    let active_target = target(EngineType::Codex, provider);
    let (root, writer) = open_test_writer("recovery-active-owner");
    let begin = begin_turn_core(
        &writer,
        session_id,
        &active_target,
        "hello".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let logical_turn_id = begin.logical_turn_id.expect("logical turn");
    let binding_key = begin.binding_key;
    let snapshot = begin.snapshot.expect("snapshot");
    let binding_operation_id = durable_attempt_owner(&writer, session_id, &attempt_id)
        .expect("durable owner")
        .binding_operation_id;
    accept_turn_core(
        &writer,
        session_id,
        &attempt_id,
        &logical_turn_id,
        &active_target,
        "native-active",
    )
    .expect("accept");
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(SharedRuntimeAttemptOwner {
            workspace_id: "ws-1".to_string(),
            provider_runtime_key: provider_runtime_key_for_target(
                "ws-1",
                EngineType::Codex,
                Some(provider),
            )
            .expect("provider runtime key"),
            shared_session_id: session_id.to_string(),
            shared_thread_id: shared_thread_id.clone(),
            logical_turn_id,
            attempt_id: attempt_id.clone(),
            binding_key: binding_key.clone(),
            binding_operation_id,
            engine: EngineType::Codex,
            execution_target_snapshot: snapshot,
            native_session_id: Some("native-active".to_string()),
            runtime_turn_id: Some("run-active".to_string()),
            context_marker: None,
        })
        .expect("register owner");
    let evidence = unresolved_attempt_evidence(&writer, session_id, None)
        .expect("read evidence")
        .into_iter()
        .find(|evidence| evidence.owner.requested.attempt_id == attempt_id)
        .expect("unresolved accepted attempt");

    assert_eq!(recovery_disposition(&evidence, &coordinator), "active");
    let response =
        active_recovery_response(&writer, &coordinator, "ws-1", &shared_thread_id, &evidence)
            .expect("resolve active recovery")
            .expect("active response");
    assert_eq!(
        response.get("attemptId").and_then(Value::as_str),
        Some(attempt_id.as_str())
    );
    assert_eq!(
        response.get("bindingKey").and_then(Value::as_str),
        Some(binding_key.as_str())
    );
    assert_eq!(
        response.get("nativeThreadId").and_then(Value::as_str),
        Some("native-active")
    );
    assert_eq!(
        response.get("runtimeTurnId").and_then(Value::as_str),
        Some("run-active")
    );
    assert_eq!(
        response
            .pointer("/executionTargetSnapshot/providerProfileId")
            .and_then(Value::as_str),
        Some(provider)
    );

    coordinator.remove_attempt(&attempt_id);
    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn preaccepted_runtime_owner_is_not_reported_active() {
    let session_id = "recovery-preaccepted-owner";
    let shared_thread_id = format!("shared:{session_id}");
    let provider = "provider-preaccepted";
    let (root, writer) = open_test_writer("recovery-preaccepted-owner");
    let begin = begin_turn_core(
        &writer,
        session_id,
        &target(EngineType::Codex, provider),
        "hello".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let binding_operation_id = durable_attempt_owner(&writer, session_id, &attempt_id)
        .expect("durable owner")
        .binding_operation_id;
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(SharedRuntimeAttemptOwner {
            workspace_id: "ws-1".to_string(),
            provider_runtime_key: provider_runtime_key_for_target(
                "ws-1",
                EngineType::Codex,
                Some(provider),
            )
            .expect("provider runtime key"),
            shared_session_id: session_id.to_string(),
            shared_thread_id: shared_thread_id.clone(),
            logical_turn_id: begin.logical_turn_id.expect("logical turn"),
            attempt_id: attempt_id.clone(),
            binding_key: begin.binding_key,
            binding_operation_id,
            engine: EngineType::Codex,
            execution_target_snapshot: begin.snapshot.expect("snapshot"),
            native_session_id: Some("native-preaccepted".to_string()),
            runtime_turn_id: Some("run-preaccepted".to_string()),
            context_marker: None,
        })
        .expect("register owner");
    let evidence = unresolved_attempt_evidence(&writer, session_id, None)
        .expect("read evidence")
        .into_iter()
        .find(|evidence| evidence.owner.requested.attempt_id == attempt_id)
        .expect("unresolved attempt");

    assert_ne!(recovery_disposition(&evidence, &coordinator), "active");
    assert!(active_recovery_response(
        &writer,
        &coordinator,
        "ws-1",
        &shared_thread_id,
        &evidence,
    )
    .expect("resolve recovery")
    .is_none());

    coordinator.remove_attempt(&attempt_id);
    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn shared_compaction_selected_target_comes_from_v2_store() {
    let session_id = "compaction-v2-target";
    let (root, writer) = open_test_writer("compaction-v2-target");
    writer
        .upsert_session_target(&SessionTargetUpdate {
            session_id: session_id.to_string(),
            schema_version: 2,
            selected_target_json: json!({
                "engine": "claude",
                "providerProfileId": "provider-v2"
            })
            .to_string(),
            updated_at: 1,
        })
        .expect("persist V2 Target");

    let (engine, provider_profile_id) =
        resolve_durable_shared_compaction_target(&writer, session_id)
            .expect("resolve durable target");
    assert_eq!(engine, EngineType::Claude);
    assert_eq!(provider_profile_id.as_deref(), Some("provider-v2"));

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn shared_compaction_route_prefers_unresolved_attempt_owner() {
    let session_id = "compaction-active-attempt";
    let (root, writer) = open_test_writer("compaction-active-attempt");
    let active_target = target(EngineType::Codex, "provider-active");
    let begin = begin_turn_core(
        &writer,
        session_id,
        &active_target,
        "hello".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let logical_turn_id = begin.logical_turn_id.expect("logical turn");
    accept_turn_core(
        &writer,
        session_id,
        &attempt_id,
        &logical_turn_id,
        &active_target,
        "native-active",
    )
    .expect("accept");

    let route = resolve_shared_compaction_route_core(&writer, session_id, || {
        panic!("selected Target must not override an unresolved Attempt owner")
    })
    .expect("resolve compaction route");
    assert_eq!(route.engine, EngineType::Codex);
    assert_eq!(
        route.provider_profile_id.as_deref(),
        Some("provider-active")
    );
    assert_eq!(route.native_thread_id, "native-active");
    assert!(route.has_unresolved_attempt);

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn shared_compaction_route_uses_selected_target_after_commit() {
    let session_id = "compaction-selected-target";
    let (root, writer) = open_test_writer("compaction-selected-target");
    let selected_target = target(EngineType::Codex, "provider-selected");
    let begin = begin_turn_core(
        &writer,
        session_id,
        &selected_target,
        "hello".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let logical_turn_id = begin.logical_turn_id.expect("logical turn");
    accept_turn_core(
        &writer,
        session_id,
        &attempt_id,
        &logical_turn_id,
        &selected_target,
        "native-selected",
    )
    .expect("accept");
    commit_turn_core(
        &writer,
        session_id,
        &attempt_id,
        &logical_turn_id,
        &selected_target,
        None,
        &CommitOutcomeInput {
            status: "completed".to_string(),
            error_code: None,
            error_message: None,
            stop_reason: None,
        },
        None,
    )
    .expect("commit");

    let route = resolve_shared_compaction_route_core(&writer, session_id, || {
        Ok((EngineType::Codex, Some("provider-selected".to_string())))
    })
    .expect("resolve selected route");
    assert_eq!(route.engine, EngineType::Codex);
    assert_eq!(route.native_thread_id, "native-selected");
    assert!(!route.has_unresolved_attempt);

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn shared_compaction_route_preserves_selected_claude_provider() {
    let session_id = "compaction-selected-claude";
    let (root, writer) = open_test_writer("compaction-selected-claude");
    let selected_target = target(EngineType::Claude, "provider-managed");
    let begin = begin_turn_core(
        &writer,
        session_id,
        &selected_target,
        "hello".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let logical_turn_id = begin.logical_turn_id.expect("logical turn");
    accept_turn_core(
        &writer,
        session_id,
        &attempt_id,
        &logical_turn_id,
        &selected_target,
        "claude:native-managed",
    )
    .expect("accept");
    commit_turn_core(
        &writer,
        session_id,
        &attempt_id,
        &logical_turn_id,
        &selected_target,
        None,
        &CommitOutcomeInput {
            status: "completed".to_string(),
            error_code: None,
            error_message: None,
            stop_reason: None,
        },
        None,
    )
    .expect("commit");

    let route = resolve_shared_compaction_route_core(&writer, session_id, || {
        Ok((EngineType::Claude, Some("provider-managed".to_string())))
    })
    .expect("resolve selected Claude route");
    assert_eq!(route.engine, EngineType::Claude);
    assert_eq!(
        route.provider_profile_id.as_deref(),
        Some("provider-managed")
    );
    assert_eq!(route.native_thread_id, "claude:native-managed");
    assert!(!route.has_unresolved_attempt);

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn shared_compaction_route_rejects_unsupported_engine_before_runtime_lookup() {
    let session_id = "compaction-unsupported";
    let (root, writer) = open_test_writer("compaction-unsupported");

    let error = resolve_shared_compaction_route_core(&writer, session_id, || {
        Ok((EngineType::Kimi, Some("provider-kimi".to_string())))
    })
    .expect_err("unsupported engine must fail closed");
    assert!(error.contains("shared-compaction-unsupported"));

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn shared_interrupt_route_isolates_same_engine_provider_owners() {
    assert_route(EngineType::Claude, "provider-a");
    assert_route(EngineType::Claude, "provider-b");
    assert_route(EngineType::Codex, "provider-codex");
    assert_route(EngineType::Kimi, "provider-kimi");
    assert_route(EngineType::Grok, "provider-grok");
    assert_route(EngineType::OpenCode, "provider-opencode");
    assert_route(EngineType::Pi, "provider-pi");
}

#[test]
fn qoder_shared_interrupt_routes_isolate_global_and_cn_owners() {
    let global_profile_id =
        crate::engine::qoder_provider_profile::QODER_GLOBAL_PROVIDER_PROFILE_ID;
    let cn_profile_id = crate::engine::qoder_provider_profile::QODER_CN_PROVIDER_PROFILE_ID;
    assert_ne!(
        shared_target_binding_key(EngineType::Qoder, Some(global_profile_id)),
        shared_target_binding_key(EngineType::Qoder, Some(cn_profile_id)),
    );
    assert_ne!(
        provider_runtime_key_for_target("ws-1", EngineType::Qoder, Some(global_profile_id))
            .expect("Global runtime key"),
        provider_runtime_key_for_target("ws-1", EngineType::Qoder, Some(cn_profile_id))
            .expect("CN runtime key"),
    );
    assert_route(EngineType::Qoder, global_profile_id);
    assert_route(EngineType::Qoder, cn_profile_id);
}

#[test]
fn qoder_unknown_distribution_is_rejected_before_turn_requested_is_written() {
    let session_id = "qoder-unknown-distribution";
    let (root, writer) = open_test_writer(session_id);

    let outcome = begin_turn_core(
        &writer,
        session_id,
        &target(EngineType::Qoder, "provider-qoder"),
        "hello".to_string(),
        None,
    )
    .expect("begin must return target-unavailable rather than write");

    assert_eq!(outcome.status, BeginTurnStatus::TargetUnavailable);
    assert!(outcome
        .reason
        .as_deref()
        .is_some_and(|reason| reason.contains("QODER_DISTRIBUTION")));
    assert!(outcome.binding_key.is_empty());
    assert!(writer
        .events_for_session(session_id)
        .expect("read durable events")
        .is_empty());
    assert!(writer
        .binding_state(
            session_id,
            &shared_target_binding_key(EngineType::Qoder, Some("provider-qoder")),
        )
        .expect("read durable binding")
        .is_none());

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn committed_attempt_is_detected_without_a_live_runtime_owner() {
    let session_id = "interrupt-already-committed";
    let (root, writer) = open_test_writer("already-committed");
    let selected_target = target(EngineType::Claude, "provider-committed");
    let begin = begin_turn_core(
        &writer,
        session_id,
        &selected_target,
        "hello".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let logical_turn_id = begin.logical_turn_id.expect("logical turn");
    commit_turn_core(
        &writer,
        session_id,
        &attempt_id,
        &logical_turn_id,
        &selected_target,
        None,
        &CommitOutcomeInput {
            status: "failed".to_string(),
            error_code: Some("test-terminal".to_string()),
            error_message: Some("terminal already committed".to_string()),
            stop_reason: None,
        },
        None,
    )
    .expect("commit terminal");

    assert!(committed_attempt_sequence(&writer, session_id, &attempt_id)
        .expect("query commit")
        .is_some());

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn durable_terminal_response_projects_committed_outcome_without_runtime_owner() {
    let session_id = "await-terminal-committed";
    let (root, writer) = open_test_writer("await-terminal-committed");
    let selected_target = target(EngineType::Claude, "provider-committed");
    let begin = begin_turn_core(
        &writer,
        session_id,
        &selected_target,
        "hello".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let logical_turn_id = begin.logical_turn_id.expect("logical turn");
    let binding_key = begin.binding_key;
    commit_turn_core(
        &writer,
        session_id,
        &attempt_id,
        &logical_turn_id,
        &selected_target,
        None,
        &CommitOutcomeInput {
            status: "failed".to_string(),
            error_code: Some("test-terminal".to_string()),
            error_message: Some("terminal already committed".to_string()),
            stop_reason: None,
        },
        None,
    )
    .expect("commit terminal");

    let response = committed_terminal_response(&writer, session_id, &attempt_id, &binding_key)
        .expect("query durable terminal")
        .expect("committed response");
    assert_eq!(
        response.get("status").and_then(Value::as_str),
        Some("committed")
    );
    assert_eq!(
        response
            .pointer("/terminal/outcome")
            .and_then(Value::as_str),
        Some("failed")
    );
    assert_eq!(
        response.get("bindingKey").and_then(Value::as_str),
        Some(binding_key.as_str())
    );

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn shared_interrupt_route_rejects_runtime_owner_target_drift() {
    let session_id = "interrupt-drift";
    let shared_thread_id = format!("shared:{session_id}");
    let (root, writer) = open_test_writer("owner-drift");
    let begin = begin_turn_core(
        &writer,
        session_id,
        &target(EngineType::Codex, "provider-a"),
        "hello".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let binding_operation_id = durable_attempt_owner(&writer, session_id, &attempt_id)
        .expect("durable owner")
        .binding_operation_id;
    let mut poisoned_snapshot = begin.snapshot.expect("snapshot");
    poisoned_snapshot.provider_profile_id = Some("provider-b".to_string());
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(SharedRuntimeAttemptOwner {
            workspace_id: "ws-1".to_string(),
            provider_runtime_key: provider_runtime_key_for_target(
                "ws-1",
                EngineType::Codex,
                Some("provider-b"),
            )
            .expect("provider runtime key"),
            shared_session_id: session_id.to_string(),
            shared_thread_id: shared_thread_id.clone(),
            logical_turn_id: begin.logical_turn_id.expect("logical turn"),
            attempt_id: attempt_id.clone(),
            binding_key: "codex:provider-b".to_string(),
            binding_operation_id,
            engine: EngineType::Codex,
            execution_target_snapshot: poisoned_snapshot,
            native_session_id: Some("native-b".to_string()),
            runtime_turn_id: Some("run-b".to_string()),
            context_marker: None,
        })
        .expect("register poisoned owner");

    let error = resolve_shared_attempt_interrupt_route(
        &writer,
        &coordinator,
        "ws-1",
        &shared_thread_id,
        &attempt_id,
    )
    .expect_err("owner drift must fail closed");
    assert!(error.contains("shared-control-owner-mismatch"));

    coordinator.remove_attempt(&attempt_id);
    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn abandon_unresolved_attempt_commits_cancelled_and_clears_recovery() {
    let session_id = "abandon-unresolved";
    let provider = "provider-abandon";
    let (root, writer) = open_test_writer("abandon-unresolved");
    let begin = begin_turn_core(
        &writer,
        session_id,
        &target(EngineType::Codex, provider),
        "hello".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let binding_key = begin.binding_key.clone();
    mark_recovery_core(
        &writer,
        session_id,
        &binding_key,
        EngineType::Codex,
        Some(provider.to_string()),
        Some("test-ambiguous"),
    )
    .expect("mark recovery");
    assert_eq!(
        provisioning_state_of(
            &writer
                .binding_state(session_id, &binding_key)
                .expect("read binding")
                .expect("binding exists")
        ),
        PROVISIONING_RECOVERY_REQUIRED
    );

    let committed = abandon_unresolved_attempt_core(
        &writer,
        session_id,
        &attempt_id,
        "user-abandon-unresolved",
    )
    .expect("abandon");
    assert_eq!(committed.binding_key, binding_key);
    assert!(unresolved_attempt_evidence(&writer, session_id, None)
        .expect("evidence")
        .is_empty());
    assert_ne!(
        provisioning_state_of(
            &writer
                .binding_state(session_id, &binding_key)
                .expect("read binding")
                .expect("binding exists")
        ),
        PROVISIONING_RECOVERY_REQUIRED
    );

    // begin 不应再被旧 recovery 挡住。
    let next = begin_turn_core(
        &writer,
        session_id,
        &target(EngineType::Codex, provider),
        "again".to_string(),
        None,
    )
    .expect("begin after abandon");
    assert_eq!(next.status, BeginTurnStatus::Creating);

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn rebuild_binding_core_settles_single_unresolved() {
    let session_id = "rebuild-single-unresolved";
    let provider = "provider-multi";
    let (root, writer) = open_test_writer("rebuild-single-unresolved");
    let first = begin_turn_core(
        &writer,
        session_id,
        &target(EngineType::Codex, provider),
        "one".to_string(),
        None,
    )
    .expect("begin first");
    let binding_key = first.binding_key.clone();
    let rebuilt = rebuild_binding_core(&writer, session_id, &binding_key).expect("rebuild");
    assert_eq!(rebuilt.replaced_attempt_ids.len(), 1);
    let binding = writer
        .binding_state(session_id, &binding_key)
        .expect("read")
        .expect("binding");
    assert_eq!(
        read_native_context_trust(&binding),
        NativeContextTrust::Dirty,
        "rebuild must mark trust dirty"
    );

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn rebuild_binding_core_allows_squad_worker_key() {
    // Squad worker keys are first-class; rebuild must clear recovery-required
    // without durable-key mismatch refusal.
    let session_id = "rebuild-squad-worker-key";
    let provider = "provider-squad";
    let (root, writer) = open_test_writer("rebuild-squad-worker-key");
    let squad_key = format!("squad:run-1:node-plan:claude:{provider}");
    mark_recovery_core(
        &writer,
        session_id,
        &squad_key,
        EngineType::Claude,
        Some(provider.to_string()),
        Some("squad-worker-binding-recovery-required"),
    )
    .expect("mark squad recovery");
    let rebuilt = rebuild_binding_core(&writer, session_id, &squad_key).expect("rebuild squad");
    assert!(rebuilt.replaced_attempt_ids.is_empty());
    let binding = writer
        .binding_state(session_id, &squad_key)
        .expect("read")
        .expect("binding");
    assert_eq!(
        provisioning_state_of(&binding),
        PROVISIONING_PREPARED,
        "squad rebuild must return provisioning to prepared"
    );

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn mark_recovery_and_failed_terminal_mark_native_context_trust_dirty() {
    let session_id = "trust-dirty-on-failure";
    let provider = "provider-trust";
    let (root, writer) = open_test_writer("trust-dirty-on-failure");
    let begin = begin_turn_core(
        &writer,
        session_id,
        &target(EngineType::Claude, provider),
        "原任务正文".to_string(),
        None,
    )
    .expect("begin");
    let attempt_id = begin.attempt_id.expect("attempt");
    let binding_key = begin.binding_key.clone();

    // 先标 trusted，模拟曾成功 accept。
    set_native_context_trust(
        &writer,
        session_id,
        &binding_key,
        NativeContextTrust::Trusted,
    )
    .expect("set trusted");
    assert_eq!(
        read_native_context_trust(
            &writer
                .binding_state(session_id, &binding_key)
                .expect("read")
                .expect("binding")
        ),
        NativeContextTrust::Trusted
    );

    mark_recovery_core(
        &writer,
        session_id,
        &binding_key,
        EngineType::Claude,
        Some(provider.to_string()),
        Some("runtime-delivery-ambiguous"),
    )
    .expect("mark recovery");
    assert_eq!(
        read_native_context_trust(
            &writer
                .binding_state(session_id, &binding_key)
                .expect("read")
                .expect("binding")
        ),
        NativeContextTrust::Dirty
    );

    // 失败 terminal 也保持 dirty。
    commit_runtime_snapshot_core(
        &writer,
        session_id,
        &attempt_id,
        RuntimeFinalSnapshot {
            assistant_blocks: vec![],
            assistant_text: None,
            tool_calls: vec![],
            tool_results: vec![],
            artifacts: vec![],
            provider_private_refs: vec![],
            omissions: vec![],
            outcome: OutcomeStatus::Failed,
            error_code: Some("503".to_string()),
            error_message: Some("No available accounts".to_string()),
            stop_reason: None,
        },
        Some("claude:native-trust"),
    )
    .expect("failed terminal");
    assert_eq!(
        read_native_context_trust(
            &writer
                .binding_state(session_id, &binding_key)
                .expect("read")
                .expect("binding")
        ),
        NativeContextTrust::Dirty
    );

    writer.shutdown().expect("shutdown writer");
    std::fs::remove_dir_all(root).expect("remove test root");
}

#[test]
fn dirty_zero_transfer_needs_history_detects_original_task() {
    // 编译层：destination-owned 清空 transfer 后，session_needs_history 仍为 true。
    use crate::shared_context::{
        is_zero_transfer_package, session_needs_history, CompileContextRequest,
        RuntimeContextCapabilities,
    };
    use crate::shared_event_log::{Fidelity, StoredEvent};

    let stored =
        |sequence: i64, event_id: &str, fact_type: &str, attempt: &str, payload: Value| {
            StoredEvent {
                session_id: "s-needs".to_string(),
                sequence,
                event_id: event_id.to_string(),
                fact_type: fact_type.to_string(),
                logical_turn_id: Some(format!("turn-{sequence}")),
                attempt_id: Some(attempt.to_string()),
                dedupe_key: None,
                payload_json: payload.to_string(),
                payload_checksum: format!("sha256:{event_id}"),
                fidelity: Fidelity::Canonical,
                committed_at: sequence,
            }
        };
    let events = vec![
        stored(
            1,
            "req-1",
            "conversation.turnRequested",
            "attempt-1",
            json!({"input": {"text": "原任务正文请实现登录"}}),
        ),
        stored(
            2,
            "acc-1",
            "conversation.turnAccepted",
            "attempt-1",
            json!({"bindingKey": "claude:provider-a"}),
        ),
    ];
    let caps = RuntimeContextCapabilities {
        native_delta: false,
        structured_history_import: false,
        native_clone: false,
        user_channel_transcript: true,
        tool_history: false,
        image_history: false,
        strong_context_ack: true,
    };
    let owned = compile_context(
        &events,
        &CompileContextRequest {
            session_id: "s-needs".to_string(),
            binding_key: "claude:provider-a".to_string(),
            destination: json!({"engine": "claude"}),
            destination_native_session_id: Some("claude:native-1".to_string()),
            from_sequence_exclusive: None,
            through_sequence_inclusive: None,
            exclude_attempt_id: None,
            capabilities: caps.clone(),
            budget_estimated_tokens: None,
        },
    )
    .expect("owned compile");
    assert!(
        is_zero_transfer_package(&owned),
        "destination-owned should empty transfer"
    );
    let needs = session_needs_history(
        &events,
        &CompileContextRequest {
            session_id: "s-needs".to_string(),
            binding_key: "claude:provider-a".to_string(),
            destination: json!({"engine": "claude"}),
            destination_native_session_id: Some("claude:native-1".to_string()),
            from_sequence_exclusive: None,
            through_sequence_inclusive: None,
            exclude_attempt_id: None,
            capabilities: caps,
            budget_estimated_tokens: None,
        },
    )
    .expect("needs");
    assert!(needs, "full rematerialize must see original task");
    let rematerialized = compile_context(
        &events,
        &CompileContextRequest {
            session_id: "s-needs".to_string(),
            binding_key: "claude:provider-a".to_string(),
            destination: json!({"engine": "claude"}),
            destination_native_session_id: None,
            from_sequence_exclusive: None,
            through_sequence_inclusive: None,
            exclude_attempt_id: None,
            capabilities: RuntimeContextCapabilities {
                native_delta: false,
                structured_history_import: false,
                native_clone: false,
                user_channel_transcript: true,
                tool_history: false,
                image_history: false,
                strong_context_ack: true,
            },
            budget_estimated_tokens: None,
        },
    )
    .expect("rematerialize");
    assert!(!is_zero_transfer_package(&rematerialized));
    assert!(rematerialized
        .prompt_prefix
        .contains("原任务正文请实现登录"));
}

#[test]
fn dirty_non_zero_continue_only_package_still_needs_full_rematerialize() {
    // 图1 P0：accepted 之后有未 Accepted 的「继续」turnRequested → 增量 package 非空
    // 但缺原任务；dirty 时仍必须判定 needs_history 并全量 rematerialize。
    use crate::shared_context::{
        is_zero_transfer_package, session_needs_history, CompileContextRequest,
        RuntimeContextCapabilities,
    };
    use crate::shared_event_log::{Fidelity, StoredEvent};

    let stored =
        |sequence: i64, event_id: &str, fact_type: &str, attempt: &str, payload: Value| {
            StoredEvent {
                session_id: "s-continue-only".to_string(),
                sequence,
                event_id: event_id.to_string(),
                fact_type: fact_type.to_string(),
                logical_turn_id: Some(format!("turn-{sequence}")),
                attempt_id: Some(attempt.to_string()),
                dedupe_key: None,
                payload_json: payload.to_string(),
                payload_checksum: format!("sha256:{event_id}"),
                fidelity: Fidelity::Canonical,
                committed_at: sequence,
            }
        };
    let events = vec![
        stored(
            1,
            "req-orig",
            "conversation.turnRequested",
            "attempt-orig",
            json!({"input": {"text": "原任务：实现登录并写测试"}}),
        ),
        stored(
            2,
            "acc-orig",
            "conversation.turnAccepted",
            "attempt-orig",
            json!({"bindingKey": "claude:provider-a"}),
        ),
        // 失败轮：只有 turnRequested「继续」，无 turnAccepted → 不 destination-owned
        stored(
            3,
            "req-c1",
            "conversation.turnRequested",
            "attempt-c1",
            json!({"input": {"text": "继续"}}),
        ),
        stored(
            4,
            "req-c2",
            "conversation.turnRequested",
            "attempt-c2",
            json!({"input": {"text": "继续"}}),
        ),
    ];
    let caps = RuntimeContextCapabilities {
        native_delta: false,
        structured_history_import: false,
        native_clone: false,
        user_channel_transcript: true,
        tool_history: false,
        image_history: false,
        strong_context_ack: true,
    };
    // 模拟 accepted_through=2 后的增量 compile（当前 attempt-c3 排除）
    let incremental = compile_context(
        &events,
        &CompileContextRequest {
            session_id: "s-continue-only".to_string(),
            binding_key: "claude:provider-a".to_string(),
            destination: json!({"engine": "claude"}),
            destination_native_session_id: Some("claude:native-1".to_string()),
            from_sequence_exclusive: Some(2),
            through_sequence_inclusive: Some(4),
            exclude_attempt_id: Some("attempt-c3".to_string()),
            capabilities: caps.clone(),
            budget_estimated_tokens: None,
        },
    )
    .expect("incremental");
    assert!(
        !is_zero_transfer_package(&incremental),
        "continue-only package is non-empty"
    );
    assert!(
        !incremental.prompt_prefix.contains("原任务"),
        "incremental must NOT contain original task"
    );
    assert!(
        incremental.prompt_prefix.contains("继续"),
        "incremental only has continues"
    );
    let needs = session_needs_history(
        &events,
        &CompileContextRequest {
            session_id: "s-continue-only".to_string(),
            binding_key: "claude:provider-a".to_string(),
            destination: json!({"engine": "claude"}),
            destination_native_session_id: Some("claude:native-1".to_string()),
            from_sequence_exclusive: Some(2),
            through_sequence_inclusive: Some(4),
            exclude_attempt_id: Some("attempt-c3".to_string()),
            capabilities: caps.clone(),
            budget_estimated_tokens: None,
        },
    )
    .expect("needs");
    assert!(needs, "full history still needed");
    let full = compile_context(
        &events,
        &CompileContextRequest {
            session_id: "s-continue-only".to_string(),
            binding_key: "claude:provider-a".to_string(),
            destination: json!({"engine": "claude"}),
            destination_native_session_id: None,
            from_sequence_exclusive: None,
            through_sequence_inclusive: Some(4),
            exclude_attempt_id: Some("attempt-c3".to_string()),
            capabilities: caps,
            budget_estimated_tokens: None,
        },
    )
    .expect("full rematerialize");
    assert!(full.prompt_prefix.contains("原任务：实现登录并写测试"));
    assert!(full.prompt_prefix.contains("继续"));
}

#[test]
fn missing_native_context_trust_field_defaults_dirty() {
    let (_, writer) = open_test_writer("legacy-trust-default");
    let session_id = "legacy-trust-session";
    let binding_key = "claude:legacy";
    writer
        .upsert_binding_state(&BindingStateUpdate {
            session_id: session_id.to_string(),
            binding_key: binding_key.to_string(),
            engine: "claude".to_string(),
            provider_profile_id: Some("legacy".to_string()),
            native_session_id: Some("claude:native-legacy".to_string()),
            accepted_through_sequence: Some(3),
            committed_through_sequence: Some(3),
            // 无 nativeContextTrust 字段
            provisioning_json: Some(json!({"state": "ready", "updatedAt": 1}).to_string()),
            pending_delivery_json: None,
            availability: "ready".to_string(),
            updated_at: 1,
        })
        .expect("upsert");
    let row = writer
        .binding_state(session_id, binding_key)
        .expect("read")
        .expect("row");
    assert_eq!(
        read_native_context_trust(&row),
        NativeContextTrust::Dirty,
        "legacy missing field must fail-closed to dirty"
    );
    writer.shutdown().expect("shutdown");
}

