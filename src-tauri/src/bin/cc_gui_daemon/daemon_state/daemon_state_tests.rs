use super::*;
use std::{cell::RefCell, rc::Rc};

#[test]
fn pi_external_wakeup_notification_is_allowed_after_pending_tasks_clear() {
    let notification = engine::events::EngineEvent::BackgroundTaskUpdated {
        workspace_id: "ws-1".to_string(),
        tool_id: None,
        task: json!({"id": "task-1", "status": "completed"}),
        source: "notification".to_string(),
    };

    assert!(is_pi_family_external_wakeup_allowed(
        engine::EngineType::Pi,
        "pi-external-follow-up",
        "pi-turn-primary",
        &notification,
        false,
        false,
        false,
    ));
}

#[test]
fn pi_external_wakeup_without_notification_stays_blocked_after_pending_tasks_clear() {
    let unrelated = engine::events::EngineEvent::TextDelta {
        workspace_id: "ws-1".to_string(),
        text: "unrelated".to_string(),
    };

    assert!(!is_pi_family_external_wakeup_allowed(
        engine::EngineType::Pi,
        "pi-external-unrelated",
        "pi-turn-primary",
        &unrelated,
        false,
        false,
        false,
    ));
}

#[test]
fn pi_forwardable_send_turn_accepts_own_primary_and_derived_ids() {
    // 实测 pi 0.84.4：run 内每个工具往返都是一个新原生 turn。本 send 的
    // forwarder 放行 primary 本体与自己 run 的派生 id。
    let mine = "pi-turn-1111";
    assert!(is_pi_forwardable_send_turn(mine, mine, mine));
    assert!(is_pi_forwardable_send_turn(
        mine,
        &format!("{mine}:t1"),
        mine
    ));
    assert!(is_pi_forwardable_send_turn(
        mine,
        &format!("{mine}:t7"),
        mine
    ));
}

#[test]
fn pi_forwardable_send_turn_accepts_own_id_bound_into_foreign_run() {
    // steer 场景：本 send id 被绑定进别的 run（run_owner = 对方 primary），
    // 回复归属本 send 的线程，waiter 也在本 send 手里 ⇒ 必须放行。
    let foreign_run = "pi-turn-aaaa";
    let mine = "pi-turn-1111";
    assert!(is_pi_forwardable_send_turn(foreign_run, mine, mine));
}

#[test]
fn pi_forwardable_send_turn_rejects_foreign_send_runs() {
    // 同 resident 广播串台防护：别的 send 的 run（其 primary/派生 turn）
    // 以及陌生 id 一律拒绝——放行会让 A 的 turn 串进 B 的线程，交错结算
    // 错配后永久丢结算（2026-08-30 响应中卡死实证）。
    let mine = "pi-turn-1111";
    let foreign_send = "pi-turn-aaaa";
    assert!(!is_pi_forwardable_send_turn(
        foreign_send,
        &format!("{foreign_send}:t1"),
        mine
    ));
    assert!(!is_pi_forwardable_send_turn(
        foreign_send,
        foreign_send,
        mine
    ));
    assert!(!is_pi_forwardable_send_turn(mine, "pi-external-1-1", mine));
    // 前缀相似但非本 run 的派生 id 不得误放行。
    assert!(!is_pi_forwardable_send_turn(
        mine,
        &format!("{mine}-9999:t1"),
        mine
    ));
}

#[test]
fn pi_agent_settled_marker_detected_only_for_settled_kind() {
    let marker = engine::events::EngineEvent::Raw {
        workspace_id: "ws-1".to_string(),
        engine: engine::EngineType::Pi,
        data: json!({"source": "pi_rpc", "kind": "agent_settled"}),
    };
    assert!(is_pi_agent_settled_marker(&marker));

    let compaction = engine::events::EngineEvent::Raw {
        workspace_id: "ws-1".to_string(),
        engine: engine::EngineType::Pi,
        data: json!({"source": "pi_rpc", "kind": "compaction_start"}),
    };
    assert!(!is_pi_agent_settled_marker(&compaction));

    let completed = engine::events::EngineEvent::TurnCompleted {
        workspace_id: "ws-1".to_string(),
        result: None,
    };
    assert!(!is_pi_agent_settled_marker(&completed));
}

#[test]
fn daemon_active_engine_normalizes_legacy_gemini_to_supported_fallback() {
    let mut settings = AppSettings::default();
    settings.gemini_enabled = true;
    settings.default_engine = Some("gemini".to_string());

    assert_eq!(
        resolve_supported_daemon_active_engine(&settings, settings.default_engine.as_deref()),
        engine::EngineType::Codex
    );
}

fn codex_summary(session_id: &str, timestamp: i64) -> crate::types::LocalUsageSessionSummary {
    crate::types::LocalUsageSessionSummary {
        session_id: session_id.to_string(),
        timestamp,
        cwd: Some("/repo".to_string()),
        model: "gpt-5".to_string(),
        summary: Some(format!("Session {session_id}")),
        ..Default::default()
    }
}

#[test]
fn daemon_codex_local_thread_response_marks_live_unavailable() {
    let sessions = vec![codex_summary("s1", 20), codex_summary("s2", 10)];
    let response =
        build_codex_daemon_local_thread_response("/repo", sessions, None, Some(1), &HashMap::new());
    let result = response.get("result").and_then(Value::as_object).unwrap();
    let data = result.get("data").and_then(Value::as_array).unwrap();

    assert_eq!(
        result.get("partialSource").and_then(Value::as_str),
        Some(CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE)
    );
    assert_eq!(data.len(), 1);
    assert_eq!(data[0].get("id").and_then(Value::as_str), Some("s1"));
    assert_eq!(
        data[0].get("partialSource").and_then(Value::as_str),
        Some(CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE)
    );
    assert_eq!(
        result.get("nextCursor").and_then(Value::as_str),
        Some("codex-daemon-local:1")
    );
}

#[test]
fn daemon_codex_local_thread_entry_preserves_parent_session_id() {
    let mut session = codex_summary("child-session", 20);
    session.parent_session_id = Some("parent-session".to_string());

    let response = build_codex_daemon_local_thread_response(
        "/repo",
        vec![session],
        None,
        Some(1),
        &HashMap::new(),
    );
    let entry = &response["result"]["data"][0];

    assert_eq!(
        entry.get("parentSessionId").and_then(Value::as_str),
        Some("parent-session")
    );
}

#[test]
fn daemon_codex_empty_thread_response_still_marks_partial_source() {
    let response =
        build_codex_daemon_empty_thread_response(CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE);
    let result = response.get("result").and_then(Value::as_object).unwrap();

    assert_eq!(
        result.get("data").and_then(Value::as_array).unwrap().len(),
        0
    );
    assert!(result.get("nextCursor").unwrap().is_null());
    assert_eq!(
        result.get("partialSource").and_then(Value::as_str),
        Some(CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE)
    );
}

#[test]
fn daemon_provider_profile_rejects_managed_ids() {
    assert_eq!(normalize_daemon_disk_provider_profile(None).unwrap(), None);
    assert_eq!(
        normalize_daemon_disk_provider_profile(Some("  ".to_string())).unwrap(),
        None
    );
    assert_eq!(
        normalize_daemon_disk_provider_profile(Some(
            codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID.to_string(),
        ))
        .unwrap(),
        Some(codex::provider_profile::CODEX_DISK_PROVIDER_PROFILE_ID.to_string())
    );
    let error =
        normalize_daemon_disk_provider_profile(Some("managed-provider".to_string())).unwrap_err();
    assert!(error.contains("provider-scoped runtime is unavailable in daemon mode"));
}

#[tokio::test(flavor = "current_thread")]
async fn daemon_disk_start_confirms_ready_before_returning() {
    let events = Rc::new(RefCell::new(Vec::<String>::new()));
    let result = run_daemon_disk_start_thread_with_readiness(
        "ws-1",
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("ensure".to_string());
                Ok(())
            }
        },
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("start".to_string());
                Ok(json!({ "result": { "threadId": "thread-1" } }))
            }
        },
        |thread_id| {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push(format!("confirm:{thread_id}"));
                Ok(())
            }
        },
    )
    .await
    .unwrap();

    assert_eq!(
        codex_core::extract_thread_id_from_response(&result).as_deref(),
        Some("thread-1")
    );
    assert_eq!(
        events.borrow().as_slice(),
        ["ensure", "start", "confirm:thread-1"]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn daemon_disk_start_propagates_ready_confirmation_failure() {
    let events = Rc::new(RefCell::new(Vec::<String>::new()));
    let error = run_daemon_disk_start_thread_with_readiness(
        "ws-1",
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("ensure".to_string());
                Ok(())
            }
        },
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("start".to_string());
                Ok(json!({ "result": { "threadId": "thread-1" } }))
            }
        },
        |thread_id| {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push(format!("confirm:{thread_id}"));
                Err("thread/resume failed".to_string())
            }
        },
    )
    .await
    .unwrap_err();

    assert_eq!(error, "thread/resume failed");
    assert_eq!(
        events.borrow().as_slice(),
        ["ensure", "start", "confirm:thread-1"]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn daemon_disk_start_retries_stopping_runtime_before_confirming() {
    let events = Rc::new(RefCell::new(Vec::<String>::new()));
    let start_count = Rc::new(RefCell::new(0_u8));
    let result = run_daemon_disk_start_thread_with_readiness(
        "ws-1",
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("ensure".to_string());
                Ok(())
            }
        },
        || {
            let events = Rc::clone(&events);
            let start_count = Rc::clone(&start_count);
            async move {
                let mut count = start_count.borrow_mut();
                *count += 1;
                events.borrow_mut().push(format!("start:{count}"));
                if *count == 1 {
                    Err("[RUNTIME_ENDED] stopped after manual_shutdown".to_string())
                } else {
                    Ok(json!({ "result": { "threadId": "thread-2" } }))
                }
            }
        },
        |thread_id| {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push(format!("confirm:{thread_id}"));
                Ok(())
            }
        },
    )
    .await
    .unwrap();

    assert_eq!(
        codex_core::extract_thread_id_from_response(&result).as_deref(),
        Some("thread-2")
    );
    assert_eq!(
        events.borrow().as_slice(),
        ["ensure", "start:1", "ensure", "start:2", "confirm:thread-2"]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn daemon_disk_start_retries_broken_pipe_before_confirming() {
    let events = Rc::new(RefCell::new(Vec::<String>::new()));
    let start_count = Rc::new(RefCell::new(0_u8));
    let result = run_daemon_disk_start_thread_with_readiness(
        "ws-1",
        || {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push("ensure".to_string());
                Ok(())
            }
        },
        || {
            let events = Rc::clone(&events);
            let start_count = Rc::clone(&start_count);
            async move {
                let mut count = start_count.borrow_mut();
                *count += 1;
                events.borrow_mut().push(format!("start:{count}"));
                if *count == 1 {
                    Err("Broken pipe (os error 32)".to_string())
                } else {
                    Ok(json!({ "result": { "threadId": "thread-2" } }))
                }
            }
        },
        |thread_id| {
            let events = Rc::clone(&events);
            async move {
                events.borrow_mut().push(format!("confirm:{thread_id}"));
                Ok(())
            }
        },
    )
    .await
    .unwrap();

    assert_eq!(
        codex_core::extract_thread_id_from_response(&result).as_deref(),
        Some("thread-2")
    );
    assert_eq!(
        events.borrow().as_slice(),
        ["ensure", "start:1", "ensure", "start:2", "confirm:thread-2"]
    );
}

#[tokio::test(flavor = "current_thread")]
async fn daemon_disk_start_redacts_persistent_broken_pipe() {
    let error = run_daemon_disk_start_thread_with_readiness(
        "ws-1",
        || async { Ok(()) },
        || async { Err("Broken pipe (os error 32)".to_string()) },
        |_| async { Ok(()) },
    )
    .await
    .unwrap_err();

    assert!(error.starts_with("[SESSION_CREATE_RUNTIME_RECOVERING]"));
    assert!(!error.to_ascii_lowercase().contains("broken pipe"));
    assert!(!error.contains("os error 32"));
}
