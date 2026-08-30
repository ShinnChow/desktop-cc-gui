use super::*;

fn owner(
    attempt_id: &str,
    runtime_turn_id: Option<&str>,
    native_session_id: Option<&str>,
) -> SharedRuntimeAttemptOwner {
    SharedRuntimeAttemptOwner {
        workspace_id: "ws-1".to_string(),
        provider_runtime_key: TEST_PROVIDER_RUNTIME_KEY.to_string(),
        shared_session_id: "session-1".to_string(),
        shared_thread_id: "shared:session-1".to_string(),
        logical_turn_id: format!("logical-{attempt_id}"),
        attempt_id: attempt_id.to_string(),
        binding_key: "codex::managed-a".to_string(),
        binding_operation_id: "binding-operation-1".to_string(),
        engine: EngineType::Codex,
        execution_target_snapshot: TurnExecutionSnapshot {
            engine: "codex".to_string(),
            provider_profile_id: Some("managed-a".to_string()),
            model_catalog_entry_id: Some("catalog-gpt".to_string()),
            model: Some("gpt-runtime".to_string()),
            reasoning: None,
            provider_profile_name_snapshot: Some("Managed A".to_string()),
            provider_profile_source: Some(
                crate::shared_event_log::canonical::types::CanonicalProviderProfileSource::Managed,
            ),
            runtime_capability_fingerprint: Some("runtime-capability-v1".to_string()),
            extra: Value::Object(Default::default()),
        },
        native_session_id: native_session_id.map(str::to_string),
        runtime_turn_id: runtime_turn_id.map(str::to_string),
        context_marker: None,
    }
}

fn claude_owner(
    attempt_id: &str,
    runtime_turn_id: Option<&str>,
    native_session_id: Option<&str>,
) -> SharedRuntimeAttemptOwner {
    let mut owner = owner(attempt_id, runtime_turn_id, native_session_id);
    owner.engine = EngineType::Claude;
    owner.execution_target_snapshot.engine = "claude".to_string();
    owner.binding_key = "claude::managed-a".to_string();
    owner
}

#[test]
fn provider_engine_events_settle_exact_shared_attempts() {
    for engine in [
        EngineType::Kimi,
        EngineType::Grok,
        EngineType::OpenCode,
        EngineType::Pi,
    ] {
        let coordinator = SharedRuntimeCoordinator::default();
        let runtime_turn_id = format!("{}-turn-1", engine_token(engine));
        let native_session_id = format!("{}-session-1", engine_token(engine));
        let mut engine_owner = owner(
            &format!("attempt-{}", engine_token(engine)),
            Some(&runtime_turn_id),
            None,
        );
        engine_owner.engine = engine;
        engine_owner.binding_key = format!("{}::managed-a", engine_token(engine));
        engine_owner.execution_target_snapshot.engine = engine_token(engine).to_string();
        coordinator
            .register_attempt(engine_owner)
            .expect("register provider engine owner");

        coordinator.ingest_engine_event_with_replay_scoped(
            TEST_PROVIDER_RUNTIME_KEY,
            engine,
            Some(&runtime_turn_id),
            None,
            &EngineEvent::SessionStarted {
                workspace_id: "ws-1".to_string(),
                session_id: native_session_id.clone(),
                engine,
                turn_id: Some(runtime_turn_id.clone()),
            },
            Vec::new(),
        );
        coordinator.ingest_engine_event_with_replay_scoped(
            TEST_PROVIDER_RUNTIME_KEY,
            engine,
            Some(&runtime_turn_id),
            Some(&native_session_id),
            &EngineEvent::TextDelta {
                workspace_id: "ws-1".to_string(),
                text: format!("{} response", engine_token(engine)),
            },
            Vec::new(),
        );
        let settled = coordinator
            .ingest_engine_event_with_replay_scoped(
                TEST_PROVIDER_RUNTIME_KEY,
                engine,
                Some(&runtime_turn_id),
                Some(&native_session_id),
                &EngineEvent::TurnCompleted {
                    workspace_id: "ws-1".to_string(),
                    result: Some(json!({ "status": "completed" })),
                },
                Vec::new(),
            )
            .settled
            .expect("provider engine terminal settles owner");

        assert_eq!(settled.owner.engine, engine);
        // local CLIs normalize to `engine:{raw}` so hide set / catalog match.
        let expected_native = format!("{}:{}", engine_token(engine), native_session_id);
        assert_eq!(
            settled.owner.native_session_id.as_deref(),
            Some(expected_native.as_str()),
        );
        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Completed);
    }
}

#[test]
fn qoder_same_raw_session_id_stays_isolated_by_runtime_distribution() {
    let coordinator = SharedRuntimeCoordinator::default();
    let raw_session_id = "same-qoder-session";
    let cases = [
        (
            "attempt-qoder-global",
            "qoder-global-turn",
            "ws-1::qoder::global",
            "__qoder_global__",
            "qoder:__qoder_global__:same-qoder-session",
        ),
        (
            "attempt-qoder-cn",
            "qoder-cn-turn",
            "ws-1::qoder::cn",
            "__qoder_cn__",
            "qoder:__qoder_cn__:same-qoder-session",
        ),
    ];

    for (attempt_id, runtime_turn_id, provider_runtime_key, provider_profile_id, _) in cases {
        let mut qoder_owner = owner(attempt_id, Some(runtime_turn_id), None);
        qoder_owner.engine = EngineType::Qoder;
        qoder_owner.provider_runtime_key = provider_runtime_key.to_string();
        qoder_owner.binding_key = format!("qoder::{provider_profile_id}");
        qoder_owner.execution_target_snapshot.engine = "qoder".to_string();
        qoder_owner.execution_target_snapshot.provider_profile_id =
            Some(provider_profile_id.to_string());
        coordinator
            .register_attempt(qoder_owner)
            .expect("register Qoder owner");
    }

    for (_, runtime_turn_id, provider_runtime_key, _, _) in cases {
        coordinator.ingest_engine_event_with_replay_scoped(
            provider_runtime_key,
            EngineType::Qoder,
            Some(runtime_turn_id),
            None,
            &EngineEvent::SessionStarted {
                workspace_id: "ws-1".to_string(),
                session_id: raw_session_id.to_string(),
                engine: EngineType::Qoder,
                turn_id: Some(runtime_turn_id.to_string()),
            },
            Vec::new(),
        );
    }

    for (_, runtime_turn_id, provider_runtime_key, _, expected_native) in cases {
        let settled = coordinator
            .ingest_engine_event_with_replay_scoped(
                provider_runtime_key,
                EngineType::Qoder,
                Some(runtime_turn_id),
                Some(raw_session_id),
                &EngineEvent::TurnCompleted {
                    workspace_id: "ws-1".to_string(),
                    result: Some(json!({ "status": "completed" })),
                },
                Vec::new(),
            )
            .settled
            .expect("Qoder terminal settles matching distribution");

        assert_eq!(
            settled.owner.native_session_id.as_deref(),
            Some(expected_native),
        );
        assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Completed);
    }
}

#[test]
fn claude_raw_result_settles_shared_attempt_before_process_cleanup() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(claude_owner(
            "attempt-claude-result",
            Some("run-claude-result"),
            Some("claude:native-claude-result"),
        ))
        .expect("register");

    coordinator.ingest_engine_event(
        EngineType::Claude,
        Some("run-claude-result"),
        Some("claude:native-claude-result"),
        &EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "你好".to_string(),
        },
    );
    let result_observation = coordinator.ingest_engine_event(
        EngineType::Claude,
        Some("run-claude-result"),
        Some("claude:native-claude-result"),
        &EngineEvent::Raw {
            workspace_id: "ws-1".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "result",
                "subtype": "success",
                "is_error": false,
                "terminal_reason": "completed",
                "stop_reason": "end_turn",
                "result": "你好"
            }),
        },
    );
    let settled = result_observation
        .settled
        .expect("Claude result must settle the Shared attempt immediately");

    assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Completed);
    assert_eq!(
        settled.final_snapshot.stop_reason.as_deref(),
        Some("completed")
    );
    assert_eq!(
        settled.final_snapshot.assistant_blocks,
        vec![CanonicalBlock::Text {
            text: "你好".to_string(),
        }]
    );

    let cleanup_completion = coordinator.ingest_engine_event(
        EngineType::Claude,
        Some("run-claude-result"),
        Some("claude:native-claude-result"),
        &EngineEvent::TurnCompleted {
            workspace_id: "ws-1".to_string(),
            result: Some(json!({ "text": "你好" })),
        },
    );
    assert!(
        cleanup_completion.settled.is_none(),
        "late cleanup completion must not settle or duplicate the Shared turn again"
    );
}

#[test]
fn claude_raw_error_result_settles_shared_attempt_as_failed() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(claude_owner(
            "attempt-claude-error-result",
            Some("run-claude-error-result"),
            Some("claude:native-claude-error-result"),
        ))
        .expect("register");

    let settled = coordinator
        .ingest_engine_event(
            EngineType::Claude,
            Some("run-claude-error-result"),
            Some("claude:native-claude-error-result"),
            &EngineEvent::Raw {
                workspace_id: "ws-1".to_string(),
                engine: EngineType::Claude,
                data: json!({
                    "type": "result",
                    "subtype": "error_during_execution",
                    "is_error": true,
                    "api_error_status": "rate_limited",
                    "result": "provider request failed"
                }),
            },
        )
        .settled
        .expect("failed Claude result must settle the Shared attempt");

    assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
    assert_eq!(
        settled.final_snapshot.error_code.as_deref(),
        Some("rate_limited")
    );
    assert_eq!(
        settled.final_snapshot.error_message.as_deref(),
        Some("provider request failed")
    );
    assert!(settled.final_snapshot.assistant_blocks.is_empty());
}

#[test]
fn claude_non_result_raw_event_does_not_settle_shared_attempt() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(claude_owner(
            "attempt-claude-raw-progress",
            Some("run-claude-raw-progress"),
            Some("claude:native-claude-raw-progress"),
        ))
        .expect("register");

    let observation = coordinator.ingest_engine_event(
        EngineType::Claude,
        Some("run-claude-raw-progress"),
        Some("claude:native-claude-raw-progress"),
        &EngineEvent::Raw {
            workspace_id: "ws-1".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "system",
                "subtype": "thinking_tokens",
                "estimated_tokens": 3
            }),
        },
    );

    assert!(observation.settled.is_none());
    assert!(coordinator
        .settled_for_attempt("attempt-claude-raw-progress")
        .is_none());
}

#[test]
fn codex_terminal_preserves_rich_blocks_tools_artifacts_and_failure() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-1", Some("run-1"), Some("native-1")))
        .expect("register");

    let events = [
        json!({
            "method": "item/reasoning/textDelta",
            "params": {"threadId": "native-1", "turnId": "run-1", "delta": "think "}
        }),
        json!({
            "method": "item/agentMessage/delta",
            "params": {"threadId": "native-1", "turnId": "run-1", "delta": "answer"}
        }),
        json!({
            "method": "item/started",
            "params": {
                "threadId": "native-1",
                "turnId": "run-1",
                "item": {
                    "id": "tool-1",
                    "type": "commandExecution",
                    "tool": "exec",
                    "arguments": {"cmd": "pwd"}
                }
            }
        }),
        json!({
            "method": "item/completed",
            "params": {
                "threadId": "native-1",
                "turnId": "run-1",
                "item": {
                    "id": "tool-1",
                    "type": "commandExecution",
                    "tool": "exec",
                    "output": "ok",
                    "artifactRef": {
                        "artifactId": "artifact-1",
                        "mediaType": "text/plain",
                        "sizeBytes": 2,
                        "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "locator": "artifact://artifact-1"
                    }
                }
            }
        }),
        json!({
            "method": "turn/error",
            "params": {
                "threadId": "native-1",
                "turnId": "run-1",
                "code": "provider_rejected",
                "message": "provider rejected request"
            }
        }),
    ];
    let mut terminal = None;
    for event in events {
        let observation = coordinator.ingest_codex_event("ws-1", &event);
        terminal = terminal.or(observation.settled);
    }
    let settled = terminal.expect("settled");
    assert_eq!(settled.owner.attempt_id, "attempt-1");
    assert_eq!(settled.final_snapshot.assistant_blocks.len(), 2);
    assert!(matches!(
        settled.final_snapshot.assistant_blocks[0],
        CanonicalBlock::Reasoning { .. }
    ));
    assert!(matches!(
        settled.final_snapshot.assistant_blocks[1],
        CanonicalBlock::Text { .. }
    ));
    assert_eq!(settled.final_snapshot.tool_calls.len(), 1);
    assert_eq!(settled.final_snapshot.tool_results.len(), 1);
    assert_eq!(settled.final_snapshot.artifacts.len(), 1);
    assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
    assert_eq!(
        settled.final_snapshot.error_code.as_deref(),
        Some("provider_rejected")
    );
    assert_eq!(
        settled.final_snapshot.error_message.as_deref(),
        Some("provider rejected request")
    );
}

#[test]
#[test]
fn codex_command_execution_argv_array_is_joined_into_summary() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-argv", Some("run-argv"), Some("native-argv")))
        .expect("register");
    let events = [
        json!({
            "method": "item/started",
            "params": {
                "threadId": "native-argv",
                "turnId": "run-argv",
                "item": {
                    "id": "cmd-1",
                    "type": "commandExecution",
                    "command": ["cat", "README.md"],
                    "cwd": "/repo",
                    "status": "inProgress"
                }
            }
        }),
        json!({
            "method": "item/completed",
            "params": {
                "threadId": "native-argv",
                "turnId": "run-argv",
                "item": {
                    "id": "cmd-1",
                    "type": "commandExecution",
                    "command": ["cat", "README.md"],
                    "cwd": "/repo",
                    "status": "completed",
                    "aggregatedOutput": "# Title\n"
                }
            }
        }),
        json!({
            "method": "item/agentMessage/delta",
            "params": {"threadId": "native-argv", "turnId": "run-argv", "delta": "ok"}
        }),
        json!({
            "method": "turn/completed",
            "params": {
                "threadId": "native-argv",
                "turnId": "run-argv",
                "status": "completed"
            }
        }),
    ];
    let mut settled = None;
    for event in events {
        let observation = coordinator.ingest_codex_event("ws-1", &event);
        settled = settled.or(observation.settled);
    }
    let settled = settled.expect("settled");
    assert_eq!(settled.final_snapshot.tool_calls.len(), 1);
    let summary = settled.final_snapshot.tool_calls[0]
        .arguments_summary
        .as_deref()
        .unwrap_or("");
    assert!(
        summary.contains("cat") && summary.contains("README.md"),
        "argv[] command must be joined into summary, got: {summary}"
    );
}

#[test]
fn codex_apply_patch_custom_tool_call_is_captured_as_tool_exchange() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-ap", Some("run-ap"), Some("native-ap")))
        .expect("register");
    let patch = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch\n";
    let events = [
        json!({
            "method": "item/started",
            "params": {
                "threadId": "native-ap",
                "turnId": "run-ap",
                "item": {
                    "id": "call-ap",
                    "type": "custom_tool_call",
                    "name": "apply_patch",
                    "input": patch,
                    "status": "inProgress"
                }
            }
        }),
        json!({
            "method": "item/completed",
            "params": {
                "threadId": "native-ap",
                "turnId": "run-ap",
                "item": {
                    "id": "call-ap",
                    "type": "custom_tool_call",
                    "name": "apply_patch",
                    "input": patch,
                    "status": "completed",
                    "output": "Success. Updated the following files:\nM src/a.ts"
                }
            }
        }),
        json!({
            "method": "item/agentMessage/delta",
            "params": {"threadId": "native-ap", "turnId": "run-ap", "delta": "ok"}
        }),
        json!({
            "method": "turn/completed",
            "params": {
                "threadId": "native-ap",
                "turnId": "run-ap",
                "status": "completed"
            }
        }),
    ];
    let mut settled = None;
    for event in events {
        let observation = coordinator.ingest_codex_event("ws-1", &event);
        settled = settled.or(observation.settled);
    }
    let settled = settled.expect("settled");
    assert_eq!(settled.final_snapshot.tool_calls.len(), 1);
    assert_eq!(
        settled.final_snapshot.tool_calls[0].tool_name,
        "apply_patch"
    );
    let summary = settled.final_snapshot.tool_calls[0]
        .arguments_summary
        .as_deref()
        .unwrap_or("");
    assert!(
        summary.contains("Begin Patch") && summary.contains("src/a.ts"),
        "apply_patch input must be packed for history, got: {summary}"
    );
}

#[test]
fn codex_file_change_item_preserves_changes_in_tool_arguments_summary() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-fc", Some("run-fc"), Some("native-fc")))
        .expect("register");

    let events = [
        json!({
            "method": "item/started",
            "params": {
                "threadId": "native-fc",
                "turnId": "run-fc",
                "item": {
                    "id": "fc-1",
                    "type": "fileChange",
                    "status": "inProgress",
                    "changes": [{
                        "path": "src/keep.ts",
                        "kind": "update",
                        "diff": "--- a\n+++ b\n@@\n-old\n+new"
                    }]
                }
            }
        }),
        json!({
            "method": "item/completed",
            "params": {
                "threadId": "native-fc",
                "turnId": "run-fc",
                "item": {
                    "id": "fc-1",
                    "type": "fileChange",
                    "status": "completed",
                    "changes": [{
                        "path": "src/keep.ts",
                        "kind": "update",
                        "diff": "--- a\n+++ b\n@@\n-old\n+new"
                    }]
                }
            }
        }),
        json!({
            "method": "item/agentMessage/delta",
            "params": {"threadId": "native-fc", "turnId": "run-fc", "delta": "done"}
        }),
        json!({
            "method": "turn/completed",
            "params": {
                "threadId": "native-fc",
                "turnId": "run-fc",
                "status": "completed"
            }
        }),
    ];
    let mut settled = None;
    for event in events {
        let observation = coordinator.ingest_codex_event("ws-1", &event);
        settled = settled.or(observation.settled);
    }
    let settled = settled.expect("settled");
    assert_eq!(settled.final_snapshot.tool_calls.len(), 1);
    let summary = settled.final_snapshot.tool_calls[0]
        .arguments_summary
        .as_deref()
        .unwrap_or("");
    assert!(
        summary.contains("src/keep.ts") && summary.contains("changes"),
        "fileChange changes[] must be packed into arguments_summary for history projection, got: {summary}"
    );
    assert_eq!(
        settled.final_snapshot.tool_calls[0]
            .tool_name
            .to_ascii_lowercase(),
        "filechange"
    );
}

#[test]
fn codex_non_retry_error_settles_failed_before_transport_completion() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner(
            "attempt-provider-rejected",
            Some("run-provider-rejected"),
            Some("native-provider-rejected"),
        ))
        .expect("register");

    let failed = coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "error",
            "params": {
                "threadId": "native-provider-rejected",
                "turnId": "run-provider-rejected",
                "willRetry": false,
                "error": {
                    "code": "invalid_prompt",
                    "message": "unknown model 'gpt-5.6-sol'"
                }
            }
        }),
    );
    let settled = failed.settled.expect("non-retry error must settle");
    assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
    assert_eq!(
        settled.final_snapshot.error_code.as_deref(),
        Some("invalid_prompt")
    );
    assert_eq!(
        settled.final_snapshot.error_message.as_deref(),
        Some("unknown model 'gpt-5.6-sol'")
    );

    let duplicate_completion = coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "turn/completed",
            "params": {
                "threadId": "native-provider-rejected",
                "turnId": "run-provider-rejected"
            }
        }),
    );
    assert!(duplicate_completion.settled.is_none());
    assert_eq!(
        coordinator
            .settled_for_attempt("attempt-provider-rejected")
            .expect("settlement retained")
            .final_snapshot
            .outcome,
        OutcomeStatus::Failed
    );
}

#[test]
fn codex_retrying_error_remains_non_terminal() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner(
            "attempt-provider-retry",
            Some("run-provider-retry"),
            Some("native-provider-retry"),
        ))
        .expect("register");

    let observation = coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "error",
            "params": {
                "threadId": "native-provider-retry",
                "turnId": "run-provider-retry",
                "willRetry": true,
                "error": {
                    "code": "rate_limited",
                    "message": "retrying"
                }
            }
        }),
    );

    assert!(observation.settled.is_none());
    assert!(coordinator
        .settled_for_attempt("attempt-provider-retry")
        .is_none());
}

#[test]
fn codex_failed_terminal_without_code_gets_canonical_fallback() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner(
            "attempt-codex-no-code",
            Some("run-codex-no-code"),
            Some("native-codex-no-code"),
        ))
        .expect("register");

    let settled = coordinator
        .ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {
                    "threadId": "native-codex-no-code",
                    "turnId": "run-codex-no-code",
                    "status": "failed",
                    "message": "provider returned no error code"
                }
            }),
        )
        .settled
        .expect("settled");

    assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
    assert_eq!(
        settled.final_snapshot.error_code.as_deref(),
        Some(UNCLASSIFIED_RUNTIME_FAILURE_CODE)
    );

    let fact = crate::shared_event_log::canonical::assembler::assemble_turn_committed(
        settled.owner.logical_turn_id,
        settled.owner.attempt_id,
        "input-codex-no-code".to_string(),
        settled.owner.execution_target_snapshot,
        settled.final_snapshot,
        1,
    )
    .expect("assemble terminal fact");
    crate::shared_event_log::canonical::validator::validate_fact(
        &crate::shared_event_log::canonical::types::CanonicalFact::TurnCommitted(fact),
    )
    .expect("fallback terminal must satisfy canonical contract");
}

#[test]
fn engine_failed_terminal_without_code_gets_canonical_fallback() {
    let coordinator = SharedRuntimeCoordinator::default();
    let mut claude_owner = owner(
        "attempt-engine-no-code",
        Some("run-engine-no-code"),
        Some("native-engine-no-code"),
    );
    claude_owner.engine = EngineType::Claude;
    claude_owner.execution_target_snapshot.engine = "claude".to_string();
    claude_owner.binding_key = "claude::managed-a".to_string();
    coordinator
        .register_attempt(claude_owner)
        .expect("register");

    let settled = coordinator
        .ingest_engine_event(
            EngineType::Claude,
            Some("run-engine-no-code"),
            Some("native-engine-no-code"),
            &EngineEvent::TurnCompleted {
                workspace_id: "ws-1".to_string(),
                result: Some(json!({
                    "status": "failed",
                    "message": "runtime returned no error code"
                })),
            },
        )
        .settled
        .expect("settled");

    assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
    assert_eq!(
        settled.final_snapshot.error_code.as_deref(),
        Some(UNCLASSIFIED_RUNTIME_FAILURE_CODE)
    );
}

#[test]
fn exact_runtime_turn_wins_over_reused_native_session() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-a", Some("run-a"), Some("native-1")))
        .expect("register a");
    coordinator
        .register_attempt(owner("attempt-b", Some("run-b"), Some("native-1")))
        .expect("register b");

    let terminal = coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "turn/completed",
            "params": {"threadId": "native-1", "turnId": "run-a"}
        }),
    );
    assert_eq!(
        terminal
            .settled
            .as_ref()
            .map(|settled| settled.owner.attempt_id.as_str()),
        Some("attempt-a")
    );
    assert!(coordinator.settled_for_attempt("attempt-b").is_none());
}

#[test]
fn missing_runtime_identity_falls_back_to_native_session() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-1", None, Some("native-1")))
        .expect("register");

    let terminal = coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "turn/completed",
            "params": {"threadId": "native-1"}
        }),
    );
    assert_eq!(
        terminal
            .settled
            .as_ref()
            .map(|settled| settled.owner.attempt_id.as_str()),
        Some("attempt-1")
    );
}

#[test]
fn early_runtime_events_replay_after_exact_binding() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-1", None, None))
        .expect("register");
    coordinator
        .hold_native_session("attempt-1", "native-1")
        .expect("hold");
    let early = coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "item/agentMessage/delta",
            "params": {"threadId": "native-1", "turnId": "run-1", "delta": "early"}
        }),
    );
    assert!(early.ui_fanout_deferred);
    assert_eq!(
        early.ui_fanout_defer_reason,
        Some(SharedRuntimeUiFanoutDeferReason::AwaitingOwnerIdentity)
    );
    assert_eq!(early.deferred_queue_depth, 1);
    assert_eq!(early.unowned_overflow_drop_count, 0);
    coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "turn/completed",
            "params": {"threadId": "native-1", "turnId": "run-1"}
        }),
    );

    coordinator
        .bind_runtime_turn("attempt-1", Some("run-1"), Some("native-1"))
        .expect("bind");
    let barrier_deferred = coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "item/agentMessage/delta",
            "params": {"threadId": "native-1", "turnId": "run-1", "delta": "barrier"}
        }),
    );
    assert!(barrier_deferred.ui_fanout_deferred);
    assert_eq!(
        barrier_deferred.ui_fanout_defer_reason,
        Some(SharedRuntimeUiFanoutDeferReason::ReplayBarrier)
    );
    assert!(barrier_deferred.deferred_queue_depth >= 1);
    let batch = coordinator
        .drain_replay_barrier("attempt-1")
        .expect("drain");
    let settled = batch
        .deliveries
        .iter()
        .find_map(|delivery| delivery.observation.settled.clone())
        .expect("replayed terminal");
    assert!(matches!(
        settled.final_snapshot.assistant_blocks.as_slice(),
        [CanonicalBlock::Text { text }] if text == "early"
    ));
}

#[test]
fn unowned_queue_overflow_reports_bounded_attribution() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-overflow", None, None))
        .expect("register");
    coordinator
        .hold_native_session("attempt-overflow", "native-overflow")
        .expect("hold");

    let mut latest = SharedRuntimeObservation::default();
    for index in 0..=MAX_UNOWNED_EVENTS {
        latest = coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "item/agentMessage/delta",
                "params": {
                    "threadId": "native-overflow",
                    "turnId": "run-overflow",
                    "delta": format!("chunk-{index}")
                }
            }),
        );
    }

    assert!(latest.ui_fanout_deferred);
    assert_eq!(
        latest.ui_fanout_defer_reason,
        Some(SharedRuntimeUiFanoutDeferReason::AwaitingOwnerIdentity)
    );
    assert_eq!(latest.deferred_queue_depth, MAX_UNOWNED_EVENTS);
    assert_eq!(latest.unowned_overflow_drop_count, 1);
}

#[test]
fn terminal_buffered_before_runtime_binding_is_returned_by_bind() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-bind", None, None))
        .expect("register identity-less owner");
    coordinator
        .hold_native_session("attempt-bind", "native-bind")
        .expect("hold");
    coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "native-bind",
                "turnId": "run-bind",
                "delta": "early final"
            }
        }),
    );
    coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "item/reasoning/textDelta",
            "params": {
                "threadId": "native-bind",
                "turnId": "run-bind",
                "delta": "early reasoning"
            }
        }),
    );
    coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "turn/completed",
            "params": {"threadId": "native-bind", "turnId": "run-bind"}
        }),
    );

    coordinator
        .bind_runtime_turn("attempt-bind", Some("run-bind"), Some("native-bind"))
        .expect("bind");
    let batch = coordinator
        .drain_replay_barrier("attempt-bind")
        .expect("drain");
    assert!(!batch.barrier_cleared);
    let settled = batch
        .deliveries
        .iter()
        .find_map(|delivery| delivery.observation.settled.clone())
        .expect("early terminal must be returned");
    assert_eq!(settled.owner.attempt_id, "attempt-bind");
    assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Completed);
    assert!(matches!(
        settled.final_snapshot.assistant_blocks.as_slice(),
        [
            CanonicalBlock::Text { text },
            CanonicalBlock::Reasoning { text: reasoning }
        ] if text == "early final" && reasoning == "early reasoning"
    ));
    let replay = batch
        .deliveries
        .into_iter()
        .flat_map(|delivery| delivery.app_server_events)
        .collect::<Vec<_>>();
    assert_eq!(replay.len(), 3);
    assert_eq!(replay[0].message["params"]["threadId"], "shared:session-1");
    assert_eq!(
        replay[0].message["params"]["sharedOwner"]["executionTargetSnapshot"]["model"],
        "gpt-runtime"
    );
    assert_eq!(replay[1].message["method"], "item/reasoning/textDelta");
    assert_eq!(replay[2].message["method"], "turn/completed");
    assert!(
        coordinator
            .drain_replay_barrier("attempt-bind")
            .expect("clear barrier")
            .barrier_cleared
    );
}

#[test]
fn replay_barrier_orders_early_and_live_ingress_before_atomic_release() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-order", None, None))
        .expect("register");
    coordinator
        .hold_native_session("attempt-order", "native-order")
        .expect("hold");
    coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "native-order",
                "turnId": "run-order",
                "delta": "early-1"
            }
        }),
    );
    coordinator
        .bind_runtime_turn("attempt-order", Some("run-order"), Some("native-order"))
        .expect("bind");

    let queued_observation = coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "native-order",
                "turnId": "run-order",
                "delta": "live-2"
            }
        }),
    );
    assert!(queued_observation.owner.is_none());

    let first = coordinator
        .drain_replay_barrier("attempt-order")
        .expect("first drain");
    assert!(!first.barrier_cleared);
    let first_deltas = first
        .deliveries
        .iter()
        .filter_map(|delivery| {
            delivery
                .app_server_events
                .first()
                .and_then(|event| event.message.pointer("/params/delta"))
                .and_then(Value::as_str)
        })
        .collect::<Vec<_>>();
    assert_eq!(first_deltas, vec!["early-1", "live-2"]);
    assert!(first
        .deliveries
        .iter()
        .all(|delivery| delivery.observation.owner.is_some()));
    assert!(first
        .deliveries
        .iter()
        .all(|delivery| delivery.observation.agent_event.is_some()));

    coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "native-order",
                "turnId": "run-order",
                "delta": "during-drain-3"
            }
        }),
    );
    let second = coordinator
        .drain_replay_barrier("attempt-order")
        .expect("second drain");
    assert_eq!(second.deliveries.len(), 1);
    assert_eq!(
        second.deliveries[0].app_server_events[0].message["params"]["delta"],
        "during-drain-3"
    );
    assert!(!second.barrier_cleared);

    assert!(
        coordinator
            .drain_replay_barrier("attempt-order")
            .expect("atomic release")
            .barrier_cleared
    );
    let direct = coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "native-order",
                "turnId": "run-order",
                "delta": "direct-4"
            }
        }),
    );
    assert_eq!(
        direct.owner.as_ref().map(|owner| owner.attempt_id.as_str()),
        Some("attempt-order")
    );
}

#[test]
fn replay_barrier_filters_duplicate_terminal() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-terminal", None, None))
        .expect("register");
    coordinator
        .bind_runtime_turn(
            "attempt-terminal",
            Some("run-terminal"),
            Some("native-terminal"),
        )
        .expect("bind");
    let terminal = json!({
        "method": "turn/error",
        "params": {
            "threadId": "native-terminal",
            "turnId": "run-terminal",
            "code": "runtime_error",
            "message": "failed"
        }
    });
    coordinator.ingest_codex_event("ws-1", &terminal);
    coordinator.ingest_codex_event("ws-1", &terminal);

    let batch = coordinator
        .drain_replay_barrier("attempt-terminal")
        .expect("drain");
    assert_eq!(
        batch
            .deliveries
            .iter()
            .filter(|delivery| delivery.observation.settled.is_some())
            .count(),
        1
    );
    assert_eq!(
        batch
            .deliveries
            .iter()
            .flat_map(|delivery| delivery.app_server_events.iter())
            .filter(|event| event.message["method"] == "turn/error")
            .count(),
        1
    );
}

#[test]
fn duplicate_terminal_settles_once() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-1", Some("run-1"), Some("native-1")))
        .expect("register");
    let event = json!({
        "method": "turn/completed",
        "params": {"threadId": "native-1", "turnId": "run-1"}
    });
    assert!(coordinator
        .ingest_codex_event("ws-1", &event)
        .settled
        .is_some());
    assert!(coordinator
        .ingest_codex_event("ws-1", &event)
        .settled
        .is_none());
    assert!(coordinator.settled_for_attempt("attempt-1").is_some());
    assert!(coordinator.settled_for_attempt("attempt-1").is_some());
    coordinator.remove_attempt("attempt-1");
    assert!(coordinator.settled_for_attempt("attempt-1").is_none());
}

#[test]
fn codex_nested_replaced_completion_preserves_replaced_outcome() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner(
            "attempt-replaced",
            Some("run-replaced"),
            Some("native-replaced"),
        ))
        .expect("register");

    let event = json!({
        "method": "turn/completed",
        "params": {
            "threadId": "native-replaced",
            "turn": {
                "id": "run-replaced",
                "status": "replaced"
            }
        }
    });
    let settled = coordinator
        .ingest_codex_event("ws-1", &event)
        .settled
        .expect("nested replaced terminal");

    assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Replaced);
}

#[test]
fn completion_outcome_falls_through_supported_nested_aliases() {
    let params = json!({
        "turn": {"id": "run-replaced"},
        "result": {"status": "replaced"}
    });

    assert_eq!(completion_outcome(Some(&params)), OutcomeStatus::Replaced);
}

#[test]
fn claude_equivalent_full_observations_and_terminal_fallback_are_canonicalized_once() {
    let coordinator = SharedRuntimeCoordinator::default();
    let mut claude_owner = owner("attempt-claude-dedup", Some("run-1"), Some("native-1"));
    claude_owner.engine = EngineType::Claude;
    claude_owner.execution_target_snapshot.engine = "claude".to_string();
    claude_owner.binding_key = "claude::managed-a".to_string();
    coordinator
        .register_attempt(claude_owner)
        .expect("register");

    let reasoning =
        "This is one complete reasoning observation that must only be persisted once.";
    let answer =
        "这是一个足够长的完整回答，用来验证 Claude Shared 的重复 observation 只会持久化一次。";
    for text in [reasoning, reasoning] {
        coordinator.ingest_engine_event(
            EngineType::Claude,
            Some("run-1"),
            Some("native-1"),
            &EngineEvent::ReasoningDelta {
                workspace_id: "ws-1".to_string(),
                text: text.to_string(),
            },
        );
    }
    for text in [answer, answer] {
        coordinator.ingest_engine_event(
            EngineType::Claude,
            Some("run-1"),
            Some("native-1"),
            &EngineEvent::TextDelta {
                workspace_id: "ws-1".to_string(),
                text: text.to_string(),
            },
        );
    }

    let settled = coordinator
        .ingest_engine_event(
            EngineType::Claude,
            Some("run-1"),
            Some("native-1"),
            &EngineEvent::TurnCompleted {
                workspace_id: "ws-1".to_string(),
                result: Some(json!({"text": format!("{answer}{answer}")})),
            },
        )
        .settled
        .expect("settled");

    assert_eq!(
        settled.final_snapshot.assistant_blocks,
        vec![
            CanonicalBlock::Reasoning {
                text: reasoning.to_string(),
            },
            CanonicalBlock::Text {
                text: answer.to_string(),
            },
        ]
    );
}

#[test]
fn codex_equivalent_deltas_keep_existing_append_semantics() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner(
            "attempt-codex-append",
            Some("run-1"),
            Some("native-1"),
        ))
        .expect("register");
    let answer = "This long Codex delta is intentionally sent twice to preserve its semantics.";
    for _ in 0..2 {
        coordinator.ingest_codex_event(
            "ws-1",
            &json!({
                "method": "item/agentMessage/delta",
                "params": {"threadId": "native-1", "turnId": "run-1", "delta": answer}
            }),
        );
    }
    let settled = coordinator
        .ingest_codex_event(
            "ws-1",
            &json!({
                "method": "turn/completed",
                "params": {"threadId": "native-1", "turnId": "run-1"}
            }),
        )
        .settled
        .expect("settled");

    assert!(matches!(
        settled.final_snapshot.assistant_blocks.as_slice(),
        [CanonicalBlock::Text { text }] if text == &format!("{answer}{answer}")
    ));
}

#[test]
fn partial_delta_is_monotonically_completed_by_full_terminal_text() {
    let coordinator = SharedRuntimeCoordinator::default();
    let mut claude_owner = owner("attempt-1", Some("run-1"), Some("native-1"));
    claude_owner.engine = EngineType::Claude;
    claude_owner.execution_target_snapshot.engine = "claude".to_string();
    claude_owner.binding_key = "claude::managed-a".to_string();
    coordinator
        .register_attempt(claude_owner)
        .expect("register");

    coordinator.ingest_engine_event(
        EngineType::Claude,
        Some("run-1"),
        Some("native-1"),
        &EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "partial".to_string(),
        },
    );
    let settled = coordinator
        .ingest_engine_event(
            EngineType::Claude,
            Some("run-1"),
            Some("native-1"),
            &EngineEvent::TurnCompleted {
                workspace_id: "ws-1".to_string(),
                result: Some(json!({"text": "partial complete"})),
            },
        )
        .settled
        .expect("settled");

    assert!(matches!(
        settled.final_snapshot.assistant_blocks.as_slice(),
        [CanonicalBlock::Text { text }] if text == "partial complete"
    ));
}

#[test]
fn unrelated_terminal_text_does_not_overwrite_streamed_text() {
    let coordinator = SharedRuntimeCoordinator::default();
    let mut claude_owner = owner("attempt-1", Some("run-1"), Some("native-1"));
    claude_owner.engine = EngineType::Claude;
    claude_owner.execution_target_snapshot.engine = "claude".to_string();
    claude_owner.binding_key = "claude::managed-a".to_string();
    coordinator
        .register_attempt(claude_owner)
        .expect("register");

    coordinator.ingest_engine_event(
        EngineType::Claude,
        Some("run-1"),
        Some("native-1"),
        &EngineEvent::TextDelta {
            workspace_id: "ws-1".to_string(),
            text: "streamed partial".to_string(),
        },
    );
    let settled = coordinator
        .ingest_engine_event(
            EngineType::Claude,
            Some("run-1"),
            Some("native-1"),
            &EngineEvent::TurnCompleted {
                workspace_id: "ws-1".to_string(),
                result: Some(json!({"text": "independent final"})),
            },
        )
        .settled
        .expect("settled");

    assert!(matches!(
        settled.final_snapshot.assistant_blocks.as_slice(),
        [
            CanonicalBlock::Text { text: streamed },
            CanonicalBlock::Text { text: terminal }
        ] if streamed == "streamed partial" && terminal == "independent final"
    ));
}

#[test]
fn stale_native_event_is_not_replayed_after_exact_runtime_binding() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-new", None, None))
        .expect("register");

    coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "turn/completed",
            "params": {"threadId": "native-1", "turnId": "run-old"}
        }),
    );

    let replayed = coordinator
        .bind_runtime_turn("attempt-new", Some("run-new"), Some("native-1"))
        .expect("bind");
    assert!(replayed.is_none());
    assert!(coordinator.settled_for_attempt("attempt-new").is_none());
}

#[test]
fn coordinator_ownership_is_not_rehydrated_after_restart() {
    let coordinator = SharedRuntimeCoordinator::default();
    assert!(!coordinator.owns_attempt("attempt-1"));
    coordinator
        .register_attempt(owner("attempt-1", Some("run-1"), Some("native-1")))
        .expect("register");
    assert!(coordinator.owns_attempt("attempt-1"));

    let restarted = SharedRuntimeCoordinator::default();
    assert!(!restarted.owns_attempt("attempt-1"));
}

#[tokio::test]
async fn settlement_wait_is_exact_attempt_scoped_and_survives_early_terminal() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-a", Some("run-a"), Some("native-a")))
        .expect("register attempt a");
    coordinator
        .register_attempt(owner("attempt-b", Some("run-b"), Some("native-b")))
        .expect("register attempt b");

    coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "turn/completed",
            "params": {
                "threadId": "native-b",
                "turnId": "run-b"
            }
        }),
    );
    tokio::time::timeout(
        std::time::Duration::from_millis(5),
        coordinator.wait_for_settlement("attempt-a"),
    )
    .await
    .expect_err("attempt b terminal must leave attempt a pending");
    assert!(coordinator.owns_attempt("attempt-a"));

    coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "turn/completed",
            "params": {
                "threadId": "native-a",
                "turnId": "run-a"
            }
        }),
    );
    let settled = coordinator
        .wait_for_settlement("attempt-a")
        .await
        .expect("settlement retained");
    assert_eq!(settled.owner.attempt_id, "attempt-a");
}

#[tokio::test]
async fn settlement_wait_returns_none_after_critical_sink_removes_owner() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner(
            "attempt-removed",
            Some("run-removed"),
            Some("native-removed"),
        ))
        .expect("register");
    coordinator.remove_attempt("attempt-removed");

    assert!(coordinator
        .wait_for_settlement("attempt-removed")
        .await
        .is_none());
}

#[tokio::test]
async fn settlement_wait_wakes_all_observers_for_the_same_attempt() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner(
            "attempt-multi-waiter",
            Some("run-multi-waiter"),
            Some("native-multi-waiter"),
        ))
        .expect("register");
    let first_coordinator = coordinator.clone();
    let first_waiter = tokio::spawn(async move {
        first_coordinator
            .wait_for_settlement("attempt-multi-waiter")
            .await
    });
    let second_coordinator = coordinator.clone();
    let second_waiter = tokio::spawn(async move {
        second_coordinator
            .wait_for_settlement("attempt-multi-waiter")
            .await
    });
    tokio::task::yield_now().await;

    coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "turn/completed",
            "params": {
                "threadId": "native-multi-waiter",
                "turnId": "run-multi-waiter"
            }
        }),
    );

    for waiter in [first_waiter, second_waiter] {
        let settled = tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .expect("all observers must wake")
            .expect("waiter task")
            .expect("settlement");
        assert_eq!(settled.owner.attempt_id, "attempt-multi-waiter");
    }
}

#[tokio::test]
async fn claude_replay_echo_acknowledges_exact_context_marker() {
    let coordinator = SharedRuntimeCoordinator::default();
    let mut claude_owner = owner("attempt-1", Some("run-1"), Some("native-1"));
    claude_owner.engine = EngineType::Claude;
    claude_owner.execution_target_snapshot.engine = "claude".to_string();
    claude_owner.binding_key = "claude::managed-a".to_string();
    claude_owner.context_marker = Some(SharedRuntimeContextMarker {
        package_id: "package-1".to_string(),
        source_checksum: "checksum-1".to_string(),
    });
    coordinator
        .register_attempt(claude_owner)
        .expect("register");

    let replay_event = EngineEvent::Raw {
        workspace_id: "ws-1".to_string(),
        engine: EngineType::Claude,
        data: json!({
            "type": "user",
            "isReplay": true,
            "message": {
                "role": "user",
                "content": "MOSSX_CONTEXT_PACKAGE:package-1:checksum-1"
            }
        }),
    };
    assert!(is_internal_shared_context_replay_event(&replay_event));
    let observation = coordinator.ingest_engine_event(
        EngineType::Claude,
        Some("run-1"),
        Some("native-1"),
        &replay_event,
    );
    assert!(observation.agent_event.is_none());

    let ack = coordinator
        .wait_for_context_ack("attempt-1", std::time::Duration::from_millis(10))
        .await
        .expect("context ack");
    assert_eq!(ack.package_id, "package-1");
    assert_eq!(ack.source_checksum, "checksum-1");
    assert_eq!(
        coordinator.take_context_ack("attempt-1").expect("take ack"),
        ack
    );
}

#[tokio::test]
async fn replay_barrier_applies_context_ack_without_waiting_for_visible_drain() {
    let coordinator = SharedRuntimeCoordinator::default();
    let mut claude_owner = owner("attempt-ack-barrier", None, None);
    claude_owner.engine = EngineType::Claude;
    claude_owner.execution_target_snapshot.engine = "claude".to_string();
    claude_owner.binding_key = "claude::managed-a".to_string();
    claude_owner.context_marker = Some(SharedRuntimeContextMarker {
        package_id: "package-barrier".to_string(),
        source_checksum: "checksum-barrier".to_string(),
    });
    coordinator
        .register_attempt(claude_owner)
        .expect("register");
    coordinator
        .hold_native_session("attempt-ack-barrier", "native-ack")
        .expect("hold native binding before runtime side effect");

    // Runtime replay echo 可以抢在 send response / bind 之前到达。此时先进入
    // held unowned queue；bind 搬运时必须立即 apply，不能等 visible drain。
    let observation = coordinator.ingest_engine_event(
        EngineType::Claude,
        Some("run-ack"),
        Some("native-ack"),
        &EngineEvent::Raw {
            workspace_id: "ws-1".to_string(),
            engine: EngineType::Claude,
            data: json!({
                "type": "user",
                "isReplay": true,
                "message": {
                    "role": "user",
                    "content": "MOSSX_CONTEXT_PACKAGE:package-barrier:checksum-barrier"
                }
            }),
        },
    );
    assert!(observation.owner.is_none());
    coordinator
        .bind_runtime_turn("attempt-ack-barrier", Some("run-ack"), Some("native-ack"))
        .expect("bind");
    let ack = coordinator
        .wait_for_context_ack("attempt-ack-barrier", std::time::Duration::from_millis(10))
        .await
        .expect("barrier must not delay context ack");
    assert_eq!(ack.package_id, "package-barrier");
    assert!(
        coordinator
            .drain_replay_barrier("attempt-ack-barrier")
            .expect("empty visible drain")
            .barrier_cleared
    );
}

#[test]
fn cancel_intent_reclassifies_runtime_turn_error_as_cancelled() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner(
            "attempt-cancel",
            Some("run-cancel"),
            Some("native-cancel"),
        ))
        .expect("register");
    coordinator
        .mark_cancel_intent("attempt-cancel")
        .expect("mark cancel");

    let settled = coordinator
        .ingest_engine_event(
            EngineType::Codex,
            Some("run-cancel"),
            Some("native-cancel"),
            &EngineEvent::TurnError {
                workspace_id: "ws-1".to_string(),
                error: "interrupted by user".to_string(),
                code: None,
            },
        )
        .settled
        .expect("settled");
    assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Cancelled);
    assert_eq!(
        settled.final_snapshot.stop_reason.as_deref(),
        Some("interrupted")
    );
    assert_eq!(settled.final_snapshot.error_code, None);
}

#[test]
fn clearing_failed_cancel_intent_preserves_runtime_failure() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner(
            "attempt-cancel-failed",
            Some("run-cancel-failed"),
            Some("native-cancel-failed"),
        ))
        .expect("register");
    coordinator
        .mark_cancel_intent("attempt-cancel-failed")
        .expect("mark cancel");
    coordinator.clear_cancel_intent("attempt-cancel-failed");

    let settled = coordinator
        .ingest_engine_event(
            EngineType::Codex,
            Some("run-cancel-failed"),
            Some("native-cancel-failed"),
            &EngineEvent::TurnError {
                workspace_id: "ws-1".to_string(),
                error: "provider failed".to_string(),
                code: Some("provider_error".to_string()),
            },
        )
        .settled
        .expect("settled");
    assert_eq!(settled.final_snapshot.outcome, OutcomeStatus::Failed);
    assert_eq!(
        settled.final_snapshot.error_code.as_deref(),
        Some("provider_error")
    );
}

#[test]
fn provider_runtime_scope_isolates_identical_native_and_turn_ids() {
    let coordinator = SharedRuntimeCoordinator::default();
    let mut provider_a = owner("attempt-provider-a", Some("turn-1"), Some("native-1"));
    provider_a.provider_runtime_key = "codex::ws-1::provider-a".to_string();
    provider_a.binding_key = "codex::provider-a".to_string();
    provider_a.execution_target_snapshot.provider_profile_id = Some("provider-a".to_string());
    let mut provider_b = owner("attempt-provider-b", Some("turn-1"), Some("native-1"));
    provider_b.provider_runtime_key = "codex::ws-1::provider-b".to_string();
    provider_b.binding_key = "codex::provider-b".to_string();
    provider_b.execution_target_snapshot.provider_profile_id = Some("provider-b".to_string());

    coordinator
        .register_attempt(provider_a)
        .expect("provider A owner");
    coordinator
        .register_attempt(provider_b)
        .expect("provider B owner with same native identities");

    let text_event = |text: &str| {
        json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "native-1",
                "turnId": "turn-1",
                "delta": text,
            }
        })
    };
    let completed_event = json!({
        "method": "turn/completed",
        "params": {
            "threadId": "native-1",
            "turnId": "turn-1",
            "status": "completed",
        }
    });

    let observation_a = coordinator.ingest_codex_event_scoped(
        "codex::ws-1::provider-a",
        "ws-1",
        &text_event("answer-a"),
    );
    let observation_b = coordinator.ingest_codex_event_scoped(
        "codex::ws-1::provider-b",
        "ws-1",
        &text_event("answer-b"),
    );
    assert_eq!(
        observation_a
            .owner
            .as_ref()
            .map(|owner| owner.attempt_id.as_str()),
        Some("attempt-provider-a")
    );
    assert_eq!(
        observation_b
            .owner
            .as_ref()
            .map(|owner| owner.attempt_id.as_str()),
        Some("attempt-provider-b")
    );

    let settled_a = coordinator
        .ingest_codex_event_scoped("codex::ws-1::provider-a", "ws-1", &completed_event)
        .settled
        .expect("provider A settled");
    let settled_b = coordinator
        .ingest_codex_event_scoped("codex::ws-1::provider-b", "ws-1", &completed_event)
        .settled
        .expect("provider B settled");
    assert_eq!(settled_a.owner.attempt_id, "attempt-provider-a");
    assert_eq!(settled_b.owner.attempt_id, "attempt-provider-b");
    assert_eq!(
        settled_a.final_snapshot.assistant_blocks,
        vec![CanonicalBlock::Text {
            text: "answer-a".to_string(),
        }]
    );
    assert_eq!(
        settled_b.final_snapshot.assistant_blocks,
        vec![CanonicalBlock::Text {
            text: "answer-b".to_string(),
        }]
    );
}

#[test]
fn claude_raw_native_identity_is_canonical_and_provider_scoped() {
    let coordinator = SharedRuntimeCoordinator::default();
    let claude_owner = |attempt_id: &str, provider: &str| {
        let mut value = owner(attempt_id, Some("turn-1"), Some("claude:session-1"));
        value.engine = EngineType::Claude;
        value.provider_runtime_key = format!("claude::ws-1::{provider}");
        value.binding_key = format!("claude::{provider}");
        value.execution_target_snapshot.engine = "claude".to_string();
        value.execution_target_snapshot.provider_profile_id = Some(provider.to_string());
        value
    };
    coordinator
        .register_attempt(claude_owner("attempt-claude-a", "provider-a"))
        .expect("provider A owner");
    coordinator
        .register_attempt(claude_owner("attempt-claude-b", "provider-b"))
        .expect("provider B owner");

    for (provider, text) in [("provider-a", "answer-a"), ("provider-b", "answer-b")] {
        let observation = coordinator.ingest_engine_event_scoped(
            &format!("claude::ws-1::{provider}"),
            EngineType::Claude,
            Some("turn-1"),
            Some("session-1"),
            &EngineEvent::TextDelta {
                workspace_id: "ws-1".to_string(),
                text: text.to_string(),
            },
        );
        assert_eq!(
            observation
                .owner
                .as_ref()
                .and_then(|owner| owner.native_session_id.as_deref()),
            Some("claude:session-1")
        );
    }

    let settled_a = coordinator
        .ingest_engine_event_scoped(
            "claude::ws-1::provider-a",
            EngineType::Claude,
            Some("turn-1"),
            Some("session-1"),
            &EngineEvent::TurnCompleted {
                workspace_id: "ws-1".to_string(),
                result: Some(json!({"status": "completed"})),
            },
        )
        .settled
        .expect("provider A settled");
    let settled_b = coordinator
        .ingest_engine_event_scoped(
            "claude::ws-1::provider-b",
            EngineType::Claude,
            Some("turn-1"),
            Some("session-1"),
            &EngineEvent::TurnCompleted {
                workspace_id: "ws-1".to_string(),
                result: Some(json!({"status": "completed"})),
            },
        )
        .settled
        .expect("provider B settled");

    assert_eq!(settled_a.owner.attempt_id, "attempt-claude-a");
    assert_eq!(settled_b.owner.attempt_id, "attempt-claude-b");
    assert_eq!(
        settled_a.owner.native_session_id.as_deref(),
        Some("claude:session-1")
    );
    assert_eq!(
        settled_b.owner.native_session_id.as_deref(),
        Some("claude:session-1")
    );
}

#[test]
fn codex_provisioning_holds_first_thread_until_shared_binding() {
    let coordinator = SharedRuntimeCoordinator::default();
    coordinator
        .register_attempt(owner("attempt-provision", None, None))
        .expect("register");
    coordinator
        .hold_native_provisioning("attempt-provision")
        .expect("hold provisioning");

    let early = coordinator.ingest_codex_event(
        "ws-1",
        &json!({
            "method": "thread/started",
            "params": {"thread": {"id": "native-provision"}}
        }),
    );
    assert!(early.ui_fanout_deferred);

    coordinator
        .hold_native_session("attempt-provision", "native-provision")
        .expect("hold exact native session");
    assert!(coordinator
        .finish_native_provisioning("attempt-provision")
        .expect("finish provisioning")
        .is_empty());
    coordinator
        .bind_runtime_turn(
            "attempt-provision",
            Some("run-provision"),
            Some("native-provision"),
        )
        .expect("bind exact runtime");
    let batch = coordinator
        .drain_replay_barrier("attempt-provision")
        .expect("drain");
    let projected = batch
        .deliveries
        .iter()
        .flat_map(|delivery| delivery.app_server_events.iter())
        .find(|event| event.message["method"] == "thread/started")
        .expect("projected thread/started");
    assert_eq!(projected.message["params"]["threadId"], "shared:session-1");
    assert_eq!(
        projected.message["params"]["nativeThreadId"],
        "native-provision"
    );
}

#[test]
fn projected_missing_claude_session_has_typed_recovery_reason() {
    let mut claude_owner = owner(
        "attempt-missing-session",
        Some("run-missing-session"),
        Some("claude:missing-session"),
    );
    claude_owner.engine = EngineType::Claude;
    claude_owner.execution_target_snapshot.engine = "claude".to_string();
    let mut event = AppServerEvent {
        workspace_id: "ws-1".to_string(),
        message: json!({
            "method": "turn/error",
            "params": {
                "threadId": "missing-session",
                "error": "No conversation found with session ID: missing-session"
            }
        }),
    };

    project_app_server_event_to_shared_owner(&mut event, &claude_owner);

    assert_eq!(
        event.message["params"]["sharedRecoveryReason"],
        "native-session-not-found"
    );
}

#[test]
fn projection_rewrites_shared_owner_before_ui_fanout() {
    let owner = owner("attempt-1", Some("run-1"), Some("native-1"));
    let mut event = AppServerEvent {
        workspace_id: "ws-1".to_string(),
        message: json!({
            "method": "item/reasoning/textDelta",
            "params": {
                "threadId": "native-1",
                "turnId": "run-1",
                "delta": "thinking"
            }
        }),
    };
    project_app_server_event_to_shared_owner(&mut event, &owner);
    assert_eq!(event.message["params"]["threadId"], "shared:session-1");
    assert_eq!(event.message["params"]["nativeThreadId"], "native-1");
    assert_eq!(event.message["params"]["sharedOwner"]["engine"], "codex");
    assert_eq!(
        event.message["params"]["sharedOwner"]["executionTargetSnapshot"]
            ["modelCatalogEntryId"],
        "catalog-gpt"
    );
    assert_eq!(
        event.message["params"]["sharedOwner"]["executionTargetSnapshot"]["model"],
        "gpt-runtime"
    );
    assert_eq!(
        event.message["params"]["sharedOwner"]["executionTargetSnapshot"]["reasoning"],
        Value::Null
    );
    assert_eq!(
        event.message["params"]["sharedOwner"]["attemptId"],
        "attempt-1"
    );
}

#[test]
fn projection_force_aligns_request_user_input_turn_id_to_runtime_turn() {
    // Claude historically set requestUserInput.turnId to the assistant item
    // id. Shared control-owner resolution requires params.turnId ==
    // sharedOwner.runtimeTurnId; force-align so the dialog is not dropped.
    let owner = owner(
        "attempt-ask",
        Some("runtime-turn-ask"),
        Some("claude:native-ask"),
    );
    let mut event = AppServerEvent {
        workspace_id: "ws-1".to_string(),
        message: json!({
            "method": "item/tool/requestUserInput",
            "id": "ask-req-shared",
            "params": {
                "threadId": "claude:native-ask",
                "turnId": "assistant-item-stale",
                "itemId": "askuserquestion-ask-req-shared",
                "questions": [{
                    "id": "q-0",
                    "header": "Pick",
                    "question": "Which option?"
                }],
                "completed": false
            }
        }),
    };

    project_app_server_event_to_shared_owner(&mut event, &owner);

    assert_eq!(event.message["params"]["threadId"], "shared:session-1");
    assert_eq!(
        event.message["params"]["nativeThreadId"],
        "claude:native-ask"
    );
    assert_eq!(
        event.message["params"]["turnId"], "runtime-turn-ask",
        "control events must overwrite stale assistant-item turnId"
    );
    assert_eq!(event.message["params"]["turn_id"], "runtime-turn-ask");
    assert_eq!(
        event.message["params"]["sharedOwner"]["runtimeTurnId"],
        "runtime-turn-ask"
    );
    assert_eq!(
        event.message["params"]["itemId"], "askuserquestion-ask-req-shared",
        "ask card item id must stay request-scoped"
    );
}

#[test]
fn projection_does_not_overwrite_non_control_existing_turn_id() {
    let owner = owner(
        "attempt-delta",
        Some("runtime-turn-delta"),
        Some("native-delta"),
    );
    let mut event = AppServerEvent {
        workspace_id: "ws-1".to_string(),
        message: json!({
            "method": "item/agentMessage/delta",
            "params": {
                "threadId": "native-delta",
                "turnId": "pre-existing-turn",
                "delta": "hello"
            }
        }),
    };

    project_app_server_event_to_shared_owner(&mut event, &owner);

    assert_eq!(
        event.message["params"]["turnId"], "pre-existing-turn",
        "non-control events keep existing turnId via or_insert"
    );
    assert_eq!(
        event.message["params"]["sharedOwner"]["runtimeTurnId"],
        "runtime-turn-delta"
    );
}

#[test]
fn attempt_owner_rejects_execution_target_rewrite() {
    let coordinator = SharedRuntimeCoordinator::default();
    let durable = owner("attempt-immutable", Some("run-immutable"), Some("native-1"));
    coordinator
        .register_attempt(durable.clone())
        .expect("register durable owner");

    let mut poisoned = durable;
    poisoned.execution_target_snapshot.model =
        Some("poisoned-current-picker-model".to_string());

    assert!(coordinator
        .register_attempt(poisoned)
        .expect_err("target rewrite must fail")
        .contains("owner mismatch"));
}

/// 验证 remove_attempt 会清掉 settled_by_attempt。
/// 这是 abandon 竞态修复的前置契约：必须在 remove 之前读 settled，
/// 否则 interrupt 与 completion 竞态时会丢失已完成的助手回复。
#[test]
fn remove_attempt_clears_settled_evidence() {
    let coordinator = SharedRuntimeCoordinator::default();
    let attempt_owner = owner(
        "attempt-settled-race",
        Some("run-settled"),
        Some("native-settled"),
    );
    coordinator
        .register_attempt(attempt_owner.clone())
        .expect("register");

    // 模拟 interrupt 与 completion 竞态：settled 证据已写入 coordinator。
    let settled = SettledSharedRuntimeAttempt {
        owner: attempt_owner.clone(),
        final_snapshot: RuntimeFinalSnapshot {
            assistant_blocks: vec![],
            assistant_text: None,
            tool_calls: vec![],
            tool_results: vec![],
            artifacts: vec![],
            provider_private_refs: vec![],
            omissions: vec![],
            outcome: OutcomeStatus::Completed,
            error_code: None,
            error_message: None,
            stop_reason: None,
        },
    };
    coordinator
        .inner
        .lock()
        .unwrap()
        .settled_by_attempt
        .insert("attempt-settled-race".to_string(), settled);

    // remove 前 settled 可读。
    assert!(
        coordinator
            .settled_for_attempt("attempt-settled-race")
            .is_some(),
        "settled evidence MUST be readable before remove_attempt"
    );

    // remove 后 settled 被清掉。
    coordinator.remove_attempt("attempt-settled-race");
    assert!(
        coordinator
            .settled_for_attempt("attempt-settled-race")
            .is_none(),
        "settled evidence MUST be cleared after remove_attempt — \
         callers must read settled BEFORE remove"
    );
}
