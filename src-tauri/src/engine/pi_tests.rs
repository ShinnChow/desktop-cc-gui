use super::*;
use serde_json::json;

#[test]
fn resident_map_key_isolates_sessions_and_new_sends() {
    assert_eq!(
        pi_resident_map_key(Some("abc-123"), "t1"),
        "session:abc-123"
    );
    assert_eq!(
        pi_resident_map_key(Some("abc-123"), "t2"),
        "session:abc-123"
    );
    assert_eq!(pi_resident_map_key(None, "t1"), "scratch:t1");
    assert_ne!(
        pi_resident_map_key(None, "t1"),
        pi_resident_map_key(None, "t2")
    );
    assert_ne!(
        pi_resident_map_key(Some("sess-a"), "t"),
        pi_resident_map_key(Some("sess-b"), "t")
    );
    // thread ids with `pi:` prefix are not valid CLI session args — they
    // must not collide with an established session slot.
    assert_eq!(pi_resident_map_key(Some("pi:abc-123"), "t1"), "scratch:t1");
}

#[test]
fn parallel_sends_do_not_share_resident_keys() {
    let a = pi_resident_map_key(Some("sess-a"), "turn-1");
    let b = pi_resident_map_key(Some("sess-b"), "turn-1");
    let new_1 = pi_resident_map_key(None, "turn-1");
    let new_2 = pi_resident_map_key(None, "turn-2");
    assert_ne!(a, b);
    assert_ne!(new_1, new_2);
    assert_ne!(a, new_1);
    // same session + different turns still share the process (steer, not spawn)
    assert_eq!(
        pi_resident_map_key(Some("sess-a"), "turn-1"),
        pi_resident_map_key(Some("sess-a"), "turn-9")
    );
}

#[test]
fn print_json_fallback_busy_only_blocks_same_session() {
    // 新会话（None）从不因 print-json 占用被挡：各自 spawn 全新 JSONL。
    assert!(!print_json_fallback_busy(
        [None, Some("sess-a")].into_iter(),
        None
    ));
    // 同 session 并发 print-json 必须互斥（交叉写同一 session JSONL）。
    assert!(print_json_fallback_busy(
        [Some("sess-a")].into_iter(),
        Some("sess-a")
    ));
    // 不同 session 并行允许。
    assert!(!print_json_fallback_busy(
        [Some("sess-a")].into_iter(),
        Some("sess-b")
    ));
    // 仅有新会话进程时，历史会话不被误挡。
    assert!(!print_json_fallback_busy(
        [None].into_iter(),
        Some("sess-a")
    ));
    // 空占用一律放行。
    assert!(!print_json_fallback_busy(
        std::iter::empty(),
        Some("sess-a")
    ));
}

#[test]
fn fallback_drop_key_matches_rpc_scratch_key() {
    // send_message fallback 释放的 key 必须与 try_send_message_rpc 的
    // scratch_key 同源（pi_resident_map_key(session_id, turn_id)），
    // 否则 session_id=None / 非法 id 时 resident 泄漏。
    assert_eq!(pi_resident_map_key(None, "turn-1"), "scratch:turn-1");
    assert_eq!(
        pi_resident_map_key(Some("pi:x"), "turn-1"),
        "scratch:turn-1"
    );
    assert_eq!(
        pi_resident_map_key(Some("abc-123"), "turn-1"),
        "session:abc-123"
    );
}

#[test]
fn rpc_disabled_latch_blocks_within_cooldown_and_allows_probe_after() {
    let t0 = Instant::now();
    // 未置位：不拦。
    assert!(!rpc_disabled_blocks_spawn(None, t0));
    // 冷却期内：拦（含窗口右端点前 1s）。
    assert!(rpc_disabled_blocks_spawn(
        Some(t0),
        t0 + Duration::from_secs(10)
    ));
    assert!(rpc_disabled_blocks_spawn(
        Some(t0),
        t0 + PI_RPC_DISABLED_RETRY_COOLDOWN - Duration::from_secs(1)
    ));
    // 冷却边界及之后：放行试探。
    assert!(!rpc_disabled_blocks_spawn(
        Some(t0),
        t0 + PI_RPC_DISABLED_RETRY_COOLDOWN
    ));
    assert!(!rpc_disabled_blocks_spawn(
        Some(t0),
        t0 + PI_RPC_DISABLED_RETRY_COOLDOWN * 2
    ));
}

// OpenSpec change：fix-orphan-turn-during-backend-unavailability（F2）。
#[tokio::test]
async fn send_gate_rpc_spawn_blocked_reads_latch_readonly() {
    let dir = std::env::temp_dir().join(format!("pi-send-gate-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    // 未置位：不拦。
    assert!(!session.rpc_spawn_blocked().await);
    // 置位后冷却期内：拦。
    *session.rpc_disabled_since.lock().await = Some(Instant::now());
    assert!(session.rpc_spawn_blocked().await);
    // 只读语义：查询不改变闩状态（不清闩不自愈）。
    assert!(session.rpc_disabled_since.lock().await.is_some());
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn send_gate_print_json_fallback_blocked_empty_map_is_false() {
    let dir = std::env::temp_dir().join(format!("pi-send-gate-empty-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    // 无活跃子进程：任何 session（含 None / Some）都不 busy。
    assert!(!session.print_json_fallback_blocked(None).await);
    assert!(!session.print_json_fallback_blocked(Some("s1")).await);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn prewarm_resident_rejects_invalid_session_id_without_spawning() {
    let dir = std::env::temp_dir().join(format!("pi-prewarm-invalid-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    // 空 / flag 形态 / 非法字符：直接拒绝，不到 spawn。
    assert!(session.prewarm_resident("").await.is_err());
    assert!(session.prewarm_resident("--model").await.is_err());
    assert!(session.prewarm_resident("bad/id").await.is_err());
    assert!(session.residents.read().await.is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn prewarm_resident_respects_rpc_disabled_latch() {
    let dir = std::env::temp_dir().join(format!("pi-prewarm-latch-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    // 闩冷却期内：合法 session id 同样拒绝（与 ensure_resident 同源 gate），
    // 且不得搅动闩自愈状态。
    *session.rpc_disabled_since.lock().await = Some(Instant::now());
    let error = session
        .prewarm_resident("validsession1")
        .await
        .expect_err("latch must block prewarm");
    assert!(error.contains("pi rpc disabled"));
    assert!(session.rpc_disabled_since.lock().await.is_some());
    assert!(session.residents.read().await.is_empty());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn rpc_prompt_expands_at_file_text_and_images_without_colliding() {
    let dir = std::env::temp_dir().join(format!(
        "pi-rpc-at-file-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let notes = dir.join("notes.md");
    let shot = dir.join("shot.png");
    std::fs::write(&notes, "hello from notes").unwrap();
    std::fs::write(&shot, [0x89, b'P', b'N', b'G']).unwrap();
    let prompt = format!("@{} 总结 @{}", notes.display(), shot.display());
    let expanded = expand_rpc_prompt_attachments(&prompt, None, &dir).expect("expand");
    assert!(
        expanded.text.contains("hello from notes"),
        "text attachment must be inlined: {}",
        expanded.text
    );
    assert!(
        expanded.images.iter().any(|p| p.ends_with("shot.png")),
        "image @file must join images[]: {:?}",
        expanded.images
    );
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn plan_rpc_send_mode_steers_whenever_pi_is_active() {
    assert_eq!(plan_rpc_send_mode(false, false), RpcSendMode::Prompt);
    assert_eq!(plan_rpc_send_mode(true, false), RpcSendMode::Steer);
    // 本地无 run 但 pi 自唤醒 turn 在跑：必须 steer，否则裸 prompt 被
    // pi 以 "already processing" 拒绝（用户可见「会话失败」）。
    assert_eq!(plan_rpc_send_mode(false, true), RpcSendMode::Steer);
    assert_eq!(plan_rpc_send_mode(true, true), RpcSendMode::Steer);
}

#[test]
fn rpc_busy_error_matches_only_pi_already_processing() {
    assert!(is_rpc_busy_error(
        "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message."
    ));
    assert!(!is_rpc_busy_error("No model selected"));
    assert!(!is_rpc_busy_error("OAuth token expired"));
    assert!(!is_rpc_busy_error(""));
}

#[test]
fn orphan_run_ids_are_unique_and_marked() {
    let a = PiRpcRun::new_orphan();
    let b = PiRpcRun::new_orphan();
    assert!(a.orphan && b.orphan);
    assert_ne!(a.main_turn_id, b.main_turn_id);
    assert!(a.main_turn_id.starts_with("pi-external-"));
}

#[test]
fn orphan_run_backfills_last_assistant_text_after_notification() {
    let mut run = PiRpcRun::new_orphan();
    run.saw_tool_activity = true;
    assert!(should_backfill_last_assistant_text(&run));
}

#[test]
fn tool_only_foreground_run_does_not_backfill_stale_text() {
    let (tx, _rx) = oneshot::channel();
    let mut run = PiRpcRun::new("turn-main", tx, None);
    run.saw_tool_activity = true;
    assert!(!should_backfill_last_assistant_text(&run));
}

#[test]
fn orphan_run_adopts_user_turn_for_followups_without_rewriting_prior_stream() {
    let mut run = PiRpcRun::new_orphan();
    let synthetic_id = run.main_turn_id.clone();
    run.response_text.push_str("外部回合正文");
    run.pending_turn_ids.push_back("turn-user-1".to_string());
    assert_eq!(bind_next_native_turn_id(&mut run), "turn-user-1");
    assert!(!run.orphan);
    assert_eq!(run.main_turn_id, "turn-user-1");
    assert_ne!(run.main_turn_id, synthetic_id);
    assert_eq!(bind_next_native_turn_id(&mut run), "turn-user-1:t1");
    assert_eq!(run.response_text, "外部回合正文");
}

#[test]
fn foreground_run_binds_derived_ids_for_followup_native_turns() {
    // 实测 pi 0.84.4：一个 run 内每个工具往返都是一个新原生 turn。
    // 用户自己 run 的后续原生 turn 是前台流，必须派生 `{main}:t{n}`
    // id（daemon 无条件放行），而不是 pi-external-* 合成 id。
    let (tx, _rx) = oneshot::channel();
    let mut run = PiRpcRun::new("pi-turn-primary", tx, None);
    assert!(!run.orphan);
    assert_eq!(bind_next_native_turn_id(&mut run), "pi-turn-primary:t1");
    assert_eq!(bind_next_native_turn_id(&mut run), "pi-turn-primary:t2");
}

#[test]
fn pending_user_turn_id_wins_over_derived_native_id() {
    let (tx, _rx) = oneshot::channel();
    let mut run = PiRpcRun::new("pi-turn-primary", tx, None);
    run.pending_turn_ids.push_back("turn-steer-1".to_string());
    assert_eq!(bind_next_native_turn_id(&mut run), "turn-steer-1");
    assert_eq!(bind_next_native_turn_id(&mut run), "pi-turn-primary:t1");
}

#[test]
fn orphan_run_binds_external_ids_for_followup_native_turns() {
    let mut run = PiRpcRun::new_orphan();
    let first = bind_next_native_turn_id(&mut run);
    let second = bind_next_native_turn_id(&mut run);
    assert!(first.starts_with("pi-external-"));
    assert!(second.starts_with("pi-external-"));
    assert_ne!(first, second);
}

#[test]
fn probe_replay_run1_two_native_turns_commit_per_turn() {
    // 回放 2026-08-30 探针实测序列（run 1）：
    // agent_start → turn_start → assistant#1(text1+bg_run×2) → turn_end
    // → turn_start → assistant#2(text2) → turn_end → agent_end → agent_settled
    let (tx, mut rx) = oneshot::channel();
    let mut run = PiRpcRun::new("pi-turn-primary", tx, None);
    let events = std::cell::RefCell::new(Vec::<(String, EngineEvent)>::new());
    let emit = |turn_id: &str, event: EngineEvent| {
        events.borrow_mut().push((turn_id.to_string(), event));
    };

    // turn 1：thinking/text deltas + message_end 快照（text1）。
    // 首 turn 不走 bind：active_turn_id 就是 main（与 pump 一致）。
    assert_eq!(run.active_turn_id, "pi-turn-primary");
    for delta in ["好的，", "并行启动两个后台任务。"] {
        run.response_text.push_str(delta);
        emit(
            &run.active_turn_id,
            EngineEvent::TextDelta {
                workspace_id: "ws".into(),
                text: delta.into(),
            },
        );
    }
    run.authoritative_text = Some("好的，并行启动两个后台任务。".to_string());
    commit_rpc_turn("ws", &mut run, &emit);
    // turn 2：run 内第二个原生 turn，派生前台 id。
    run.active_turn_id = bind_next_native_turn_id(&mut run);
    assert_eq!(run.active_turn_id, "pi-turn-primary:t1");
    run.response_text.push_str("两个任务已并行启动：");
    run.authoritative_text = Some("两个任务已并行启动：".to_string());
    commit_rpc_turn("ws", &mut run, &emit);

    let events = events.borrow();
    let completed: Vec<(String, String)> = events
        .iter()
        .filter_map(|(id, event)| match event {
            EngineEvent::TurnCompleted { result, .. } => Some((
                id.clone(),
                result
                    .as_ref()
                    .and_then(|r| r.get("text"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
            )),
            _ => None,
        })
        .collect();
    assert_eq!(
        completed,
        vec![
            (
                "pi-turn-primary".to_string(),
                "好的，并行启动两个后台任务。".to_string()
            ),
            (
                "pi-turn-primary:t1".to_string(),
                "两个任务已并行启动：".to_string()
            ),
        ]
    );
    // 主 waiter 在第一个原生 turn 就结算（bg 等待/前台流不阻塞发送边）。
    let settled = rx.try_recv().expect("main waiter settles");
    assert_eq!(settled.as_deref(), Ok("好的，并行启动两个后台任务。"));
}

#[test]
fn commit_rpc_turn_prefers_authoritative_snapshot_and_settles_waiter() {
    let (tx, mut rx) = oneshot::channel();
    let mut run = PiRpcRun::new("turn-main", tx, None);
    run.response_text.push_str("partial");
    run.authoritative_text = Some("complete response".to_string());
    let events = std::cell::RefCell::new(Vec::<(String, EngineEvent)>::new());
    commit_rpc_turn("ws", &mut run, &|turn_id, event| {
        events.borrow_mut().push((turn_id.to_string(), event));
    });
    assert!(matches!(
        &events.borrow()[0],
        (id, EngineEvent::TurnCompleted { result, .. })
            if id == "turn-main"
                && result.as_ref().and_then(|r| r.get("text")).and_then(Value::as_str)
                    == Some("complete response")
    ));
    assert_eq!(
        rx.try_recv().expect("main waiter settles").as_deref(),
        Ok("complete response")
    );
}

#[test]
fn settle_non_orphan_run_keeps_main_text_attached_empty() {
    // 非 orphan same-run steer 语义不回归：main（waiters[0]）取全文，
    // attached 取空文本。
    let (main_tx, _main_rx) = oneshot::channel();
    let mut run = PiRpcRun::new(
        "turn-main",
        main_tx,
        Some("openai-codex/gpt-5.6".to_string()),
    );
    run.response_text.push_str("hello");
    let (tx, _rx) = oneshot::channel();
    run.attached_turn_ids.push("turn-attached".to_string());
    run.waiters.push(("turn-attached".to_string(), tx));
    let events = std::cell::RefCell::new(Vec::<(String, EngineEvent)>::new());
    settle_rpc_run("ws", run, None, &|turn_id, event| {
        events.borrow_mut().push((turn_id.to_string(), event));
    });
    let events = events.borrow();
    assert_eq!(events.len(), 2);
    assert!(matches!(
        &events[0],
        (id, EngineEvent::TurnCompleted { result, .. })
            if id == "turn-main"
            && result.as_ref().and_then(|r| r.get("text")).and_then(Value::as_str) == Some("hello")
    ));
    assert!(matches!(
        &events[1],
        (id, EngineEvent::TurnCompleted { result, .. })
            if id == "turn-attached"
            && result.as_ref().and_then(|r| r.get("text")).and_then(Value::as_str) == Some("")
    ));
}

#[test]
fn rpc_provider_error_after_tool_activity_remains_an_error() {
    let (tx, _rx) = oneshot::channel();
    let mut run = PiRpcRun::new("turn-main", tx, Some("openai-codex/gpt-5.6".to_string()));
    run.saw_tool_activity = true;
    run.stream_error = Some("fetch failed".to_string());
    let events = std::cell::RefCell::new(Vec::<EngineEvent>::new());
    settle_rpc_run("ws", run, None, &|_, event| events.borrow_mut().push(event));
    assert!(matches!(
        events.borrow().first(),
        Some(EngineEvent::TurnError { error, .. }) if error == "fetch failed"
    ));
}

#[test]
fn pi_failure_category_keeps_fetch_and_auth_distinct() {
    assert_eq!(pi_failure_category("fetch failed"), "upstream_transport");
    assert_eq!(pi_failure_category("OAuth token expired"), "authentication");
    assert_eq!(
        pi_failure_category("pi rpc process exited"),
        "local_process_exit"
    );
}

#[test]
fn pi_background_task_failure_detects_exit_one_without_payload_logging() {
    assert!(pi_background_task_failure(&json!({
        "id": "task-1",
        "status": "failed",
        "exitCode": 1,
    })));
    assert!(!pi_background_task_failure(&json!({
        "id": "task-2",
        "status": "completed",
        "exitCode": 0,
    })));
}

#[test]
fn turn_watchdog_silence_budget_covers_compact_and_tick() {
    // auto-compaction 在 turn 收尾可能长时无流式事件：静默预算必须
    // 覆盖 compact 预算，否则 compact 中的 turn 会被误判超时。
    assert!(PI_RPC_TURN_SILENCE_TIMEOUT > crate::engine::pi_rpc::PI_RPC_COMPACT_TIMEOUT);
    assert!(PI_RPC_TURN_WATCHDOG_TICK < PI_RPC_TURN_SILENCE_TIMEOUT);
}

#[test]
fn parses_session_id() {
    let line = json!({"type":"session","id":"abc-123","cwd":"/tmp"});
    match parse_pi_stream_line(&line) {
        PiStreamLine::SessionId(id) => assert_eq!(id, "abc-123"),
        _ => panic!("expected SessionId"),
    }
}

#[test]
fn parses_text_and_thinking_deltas() {
    let text = json!({
        "type":"message_update",
        "assistantMessageEvent":{"type":"text_delta","delta":"hi"}
    });
    match parse_pi_stream_line(&text) {
        PiStreamLine::TextDelta(d) => assert_eq!(d, "hi"),
        _ => panic!("expected TextDelta"),
    }
    let think = json!({
        "type":"message_update",
        "assistantMessageEvent":{"type":"thinking_delta","delta":"plan"}
    });
    match parse_pi_stream_line(&think) {
        PiStreamLine::ThinkingDelta(d) => assert_eq!(d, "plan"),
        _ => panic!("expected ThinkingDelta"),
    }
}

#[test]
fn parses_authoritative_assistant_snapshot_and_turn_boundaries() {
    let snapshot = json!({
        "type": "message_end",
        "message": {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "complete "},
                {"type": "output_text", "text": "response"}
            ]
        }
    });
    match parse_pi_stream_line(&snapshot) {
        PiStreamLine::AssistantSnapshot(text) => assert_eq!(text, "complete response"),
        _ => panic!("expected authoritative assistant snapshot"),
    }
    assert!(matches!(
        parse_pi_stream_line(&json!({"type": "turn_start"})),
        PiStreamLine::TurnStart
    ));
    assert!(matches!(
        parse_pi_stream_line(&json!({"type": "turn_end"})),
        PiStreamLine::TurnEnd
    ));
}

#[test]
fn parses_tool_events() {
    let start = json!({
        "type":"tool_execution_start",
        "toolCallId":"t1",
        "toolName":"bash",
        "args":{"command":"ls"}
    });
    match parse_pi_stream_line(&start) {
        PiStreamLine::ToolStart {
            tool_id,
            tool_name,
            args,
        } => {
            assert_eq!(tool_id, "t1");
            assert_eq!(tool_name, "bash");
            assert_eq!(args, Some(json!({"command":"ls"})));
        }
        _ => panic!("expected ToolStart"),
    }
    let end = json!({
        "type":"tool_execution_end",
        "toolCallId":"t1",
        "isError":false,
        "result":{"content":[{"type":"text","text":"ok"}]}
    });
    match parse_pi_stream_line(&end) {
        PiStreamLine::ToolEnd {
            tool_id,
            content,
            is_error,
        } => {
            assert_eq!(tool_id, "t1");
            assert_eq!(content, "ok");
            assert!(!is_error);
        }
        _ => panic!("expected ToolEnd"),
    }
}

#[test]
fn background_task_tool_list_hits_launch_tools_only() {
    for name in [
        "bg_run",
        "bg_delegate",
        "bg_run_pi_attested",
        "fusion_reason",
        "fusion_investigate",
        "fusion_research",
        "fusion_validate",
    ] {
        assert!(is_pi_background_task_tool(name), "{name} should hit");
    }
    for name in [
        "bg_status",
        "bg_logs",
        "bg_kill",
        "bg_result",
        "bash",
        "read",
        "todo_write",
        "",
    ] {
        assert!(!is_pi_background_task_tool(name), "{name} should miss");
    }
}

#[test]
fn background_task_receipt_prefers_structured_details() {
    // Spike 2026-08-26: bg_run receipt carries the full snapshot at
    // result.details.task.
    let result = json!({
        "content":[{"type":"text","text":"Started background task spike-task (b2e2f48ad)\nStatus: running\nPID: 26137\nOutput: .pi/tasks/session-1-1/b2e2f48ad.output"}],
        "details":{"task":{"id":"b2e2f48ad","name":"spike-task","status":"running","outputPath":".pi/tasks/session-1-1/b2e2f48ad.output","pid":26137}}
    });
    let task = parse_pi_background_task_receipt(Some(&result)).expect("receipt parses");
    assert_eq!(task.get("id").and_then(Value::as_str), Some("b2e2f48ad"));
    assert_eq!(task.get("name").and_then(Value::as_str), Some("spike-task"));
    assert_eq!(
        task.get("outputPath").and_then(Value::as_str),
        Some(".pi/tasks/session-1-1/b2e2f48ad.output")
    );
}

#[test]
fn background_task_receipt_text_fallback_without_details() {
    let result = json!({
        "content":[{"type":"text","text":"Started background task spike-task (b2e2f48ad)\nStatus: running\nPID: 26137\nOutput: .pi/tasks/session-1-1/b2e2f48ad.output\nTerminal notification: enabled."}]
    });
    let task = parse_pi_background_task_receipt(Some(&result)).expect("text receipt parses");
    assert_eq!(task.get("id").and_then(Value::as_str), Some("b2e2f48ad"));
    assert_eq!(task.get("name").and_then(Value::as_str), Some("spike-task"));
    assert_eq!(task.get("status").and_then(Value::as_str), Some("running"));
    assert_eq!(
        task.get("outputPath").and_then(Value::as_str),
        Some(".pi/tasks/session-1-1/b2e2f48ad.output")
    );
    assert_eq!(task.get("pid").and_then(Value::as_u64), Some(26137));
}

#[test]
fn background_task_receipt_parse_failure_degrades_to_none() {
    // 非 bg receipt 文本 / 空结果：None → 调用方降级普通工具卡。
    let alien = json!({"content":[{"type":"text","text":"total 0\ndrwxr-xr-x 2 wheel 64"}]});
    assert!(parse_pi_background_task_receipt(Some(&alien)).is_none());
    assert!(parse_pi_background_task_receipt(None).is_none());
    let empty = json!({"content":[{"type":"text","text":""}]});
    assert!(parse_pi_background_task_receipt(Some(&empty)).is_none());
}

#[test]
fn background_task_notification_stream_line_surfaces_message_start_only() {
    let start = json!({
        "type":"message_start",
        "message":{
            "role":"custom",
            "customType":"background-task-notification",
            "content":"<background-task-notification>\n  <task-id>b2e2f48ad</task-id>\n  <status>completed</status>\n</background-task-notification>",
            "details":{"id":"b2e2f48ad","name":"spike-task","status":"completed","exitCode":0}
        }
    });
    match parse_pi_stream_line(&start) {
        PiStreamLine::BackgroundTaskNotification { details, content } => {
            assert!(content.contains("<task-id>b2e2f48ad</task-id>"));
            let task = parse_pi_background_task_notification(details, &content)
                .expect("details snapshot parses");
            assert_eq!(
                task.get("status").and_then(Value::as_str),
                Some("completed")
            );
            assert_eq!(task.get("exitCode").and_then(Value::as_i64), Some(0));
        }
        _ => panic!("expected BackgroundTaskNotification"),
    }
    // message_end 携带相同 payload：去重为 Other。
    let mut end = start.clone();
    end["type"] = json!("message_end");
    assert!(matches!(parse_pi_stream_line(&end), PiStreamLine::Other));
}

#[test]
fn background_task_notification_extracts_description_without_machine_fields() {
    let content = "<background-task-notification><task-id>x</task-id><status>completed</status><summary>Hello world 5s</summary><exit-code>0</exit-code></background-task-notification>";
    let task =
        parse_pi_background_task_notification(None, content).expect("notification parses");
    assert_eq!(
        task.get("completionText").and_then(Value::as_str),
        Some("Hello world 5s")
    );
    assert!(task.get("task-id").is_none());
    assert!(task.get("exit-code").is_none());
}

#[test]
fn structured_notification_drops_machine_summary_but_keeps_result() {
    let content = "<background-task-notification><task-id>x</task-id><summary>Background task \"Sleep 10s task\" completed</summary><result>content output</result></background-task-notification>";
    let task = parse_pi_background_task_notification(
        Some(json!({
            "id":"x",
            "status":"completed",
            "exitCode":0,
            "completionText":"Background task \"Sleep 10s task\" completed",
            "result":"real output"
        })),
        content,
    )
    .expect("structured notification parses");
    assert_eq!(
        task.get("completionText").and_then(Value::as_str),
        Some("content output")
    );
}

#[test]
fn background_task_notification_content_fallback_without_details() {
    let start = json!({
        "type":"message_start",
        "message":{
            "role":"custom",
            "customType":"background-task-notification",
            "content":"<background-task-notification>\n  <task-id>b_abc</task-id>\n  <task-name>legacy-task</task-name>\n  <status>failed</status>\n  <exit-code>137</exit-code>\n  <output-file>.pi/tasks/session-1-1/b_abc.output</output-file>\n</background-task-notification>"
        }
    });
    match parse_pi_stream_line(&start) {
        PiStreamLine::BackgroundTaskNotification { details, content } => {
            let task = parse_pi_background_task_notification(details, &content)
                .expect("content envelope parses");
            assert_eq!(task.get("id").and_then(Value::as_str), Some("b_abc"));
            assert_eq!(
                task.get("name").and_then(Value::as_str),
                Some("legacy-task")
            );
            assert_eq!(task.get("status").and_then(Value::as_str), Some("failed"));
            assert_eq!(task.get("exitCode").and_then(Value::as_i64), Some(137));
            assert_eq!(
                task.get("outputPath").and_then(Value::as_str),
                Some(".pi/tasks/session-1-1/b_abc.output")
            );
        }
        _ => panic!("expected BackgroundTaskNotification"),
    }
}

#[test]
fn non_notification_custom_messages_stay_other() {
    let line = json!({
        "type":"message_start",
        "message":{"role":"custom","customType":"some-other-extension","content":"hi"}
    });
    assert!(matches!(parse_pi_stream_line(&line), PiStreamLine::Other));
}

#[test]
fn parses_auth_error_on_message_start() {
    let line = json!({
        "type":"message_start",
        "message":{
            "role":"assistant",
            "errorMessage":"401 Invalid bearer token"
        }
    });
    match parse_pi_stream_line(&line) {
        PiStreamLine::AssistantError(err) => assert!(err.contains("401")),
        _ => panic!("expected AssistantError"),
    }
}

#[test]
fn parses_live_print_json_turn_without_dropping_text() {
    // Captured from `pi --print --mode json` 0.84.1 on this machine:
    // session → thinking deltas → one text_delta "pong" → turn_end.
    let events = [
        json!({"type":"session","id":"01a0073b-b1da-77a1-a9e3-390cf2c88680"}),
        json!({
            "type":"message_update",
            "assistantMessageEvent":{"type":"thinking_delta","delta":"The user wants "}
        }),
        json!({
            "type":"message_update",
            "assistantMessageEvent":{"type":"text_delta","delta":"pong"}
        }),
        json!({"type":"turn_end"}),
        json!({"type":"agent_end"}),
        json!({"type":"agent_settled"}),
    ];

    let parsed: Vec<PiStreamLine> = events.iter().map(parse_pi_stream_line).collect();
    assert!(matches!(
        &parsed[0],
        PiStreamLine::SessionId(id) if id == "01a0073b-b1da-77a1-a9e3-390cf2c88680"
    ));
    assert!(matches!(
        &parsed[1],
        PiStreamLine::ThinkingDelta(delta) if delta == "The user wants "
    ));
    assert!(matches!(
        &parsed[2],
        PiStreamLine::TextDelta(delta) if delta == "pong"
    ));
    assert!(matches!(parsed[3], PiStreamLine::TurnEnd));
    assert!(matches!(parsed[4], PiStreamLine::Other));
    assert!(matches!(parsed[5], PiStreamLine::Other));
}

#[test]
fn model_and_thinking_flags_filter_defaults() {
    assert_eq!(resolve_model_flag(Some("auto")), None);
    assert_eq!(
        resolve_model_flag(Some("anthropic/claude-sonnet-5")),
        Some("anthropic/claude-sonnet-5".to_string())
    );
    assert_eq!(
        resolve_thinking_flag(Some("high")),
        Some("high".to_string())
    );
    assert_eq!(resolve_thinking_flag(Some("nope")), None);
}

#[test]
fn pick_thinking_level_uses_model_allowlist() {
    let available = vec!["off".to_string(), "high".to_string()];
    assert_eq!(
        pick_thinking_level(Some("high"), Some(available.as_slice())),
        Some("high".to_string())
    );
    assert_eq!(
        pick_thinking_level(Some("xhigh"), Some(available.as_slice())),
        None
    );
    assert_eq!(
        pick_thinking_level(Some("xhigh"), None),
        Some("xhigh".to_string())
    );
}

#[test]
fn split_provider_model_only_first_segment_is_provider() {
    assert_eq!(
        split_provider_model("kimi-coding/k3"),
        Some(("kimi-coding".to_string(), "k3".to_string()))
    );
    // openrouter 等模型 id 自带斜杠：只有首段是 provider。
    assert_eq!(
        split_provider_model("openrouter/openai/gpt-4o"),
        Some(("openrouter".to_string(), "openai/gpt-4o".to_string()))
    );
    assert_eq!(split_provider_model("k3"), None);
    assert_eq!(split_provider_model("/k3"), None);
    assert_eq!(split_provider_model("kimi-coding/"), None);
}

#[test]
fn model_reconcile_plan_matrix() {
    // 未显式指定（auto/default）：不动 resident。
    assert_eq!(
        plan_rpc_model_reconcile(None, None),
        RpcModelReconcile::Skip
    );
    assert_eq!(
        plan_rpc_model_reconcile(None, Some(("minimax-cn", "MiniMax-M3"))),
        RpcModelReconcile::Skip
    );
    // resident 已是目标模型：no-op。
    assert_eq!(
        plan_rpc_model_reconcile(Some("kimi-coding/k3"), Some(("kimi-coding", "k3"))),
        RpcModelReconcile::Match
    );
    // 漂移（裸 spawn 钉死 config 默认模型 / 用户切模型）：set_model。
    assert_eq!(
        plan_rpc_model_reconcile(Some("kimi-coding/k3"), Some(("minimax-cn", "MiniMax-M3"))),
        RpcModelReconcile::Set {
            provider: "kimi-coding".to_string(),
            model_id: "k3".to_string()
        }
    );
    // resident state 缺 model（未刷新）：也要 set_model 纠正。
    assert_eq!(
        plan_rpc_model_reconcile(Some("deepseek/deepseek-v4-flash"), None),
        RpcModelReconcile::Set {
            provider: "deepseek".to_string(),
            model_id: "deepseek-v4-flash".to_string()
        }
    );
    // 裸 id：与 resident 同 id 即匹配；不同则无法精确对账，仅 warn。
    assert_eq!(
        plan_rpc_model_reconcile(Some("k3"), Some(("kimi-coding", "k3"))),
        RpcModelReconcile::Match
    );
    assert_eq!(
        plan_rpc_model_reconcile(Some("k3"), Some(("minimax-cn", "MiniMax-M3"))),
        RpcModelReconcile::BareMismatch("k3".to_string())
    );
    assert_eq!(
        plan_rpc_model_reconcile(Some("k3"), None),
        RpcModelReconcile::BareMismatch("k3".to_string())
    );
}

fn command_args(cmd: &Command) -> Vec<String> {
    cmd.as_std()
        .get_args()
        .map(|arg| arg.to_string_lossy().to_string())
        .collect()
}

#[test]
fn build_command_attaches_images_as_at_file_args_before_prompt() {
    let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let image = dir.join("shot one.png");
    std::fs::write(&image, b"fake-png").unwrap();
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    let params = SendMessageParams {
        text: "look at this".to_string(),
        images: Some(vec![image.to_string_lossy().to_string()]),
        ..Default::default()
    };

    let cmd = session.build_command(&params).expect("build_command");
    let args = command_args(&cmd);

    let at_arg = format!("@{}", image.display());
    let at_pos = args
        .iter()
        .position(|arg| arg == &at_arg)
        .expect("missing @file arg");
    let prompt_pos = args
        .iter()
        .rposition(|arg| arg.contains("look at this"))
        .expect("missing prompt arg");
    assert!(at_pos < prompt_pos, "@file arg must precede the prompt");
    let prompt = &args[prompt_pos];
    assert!(!prompt.contains("mossx:pi-image-attachments"));
    assert!(!prompt.contains("read tool"));

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn build_command_without_images_has_no_at_file_args() {
    let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    let params = SendMessageParams {
        text: "plain".to_string(),
        ..Default::default()
    };

    let cmd = session.build_command(&params).expect("build_command");
    let args = command_args(&cmd);
    assert!(!args.iter().any(|arg| arg.starts_with('@')));

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn build_command_fails_when_all_images_unresolvable() {
    let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    let params = SendMessageParams {
        text: "look".to_string(),
        images: Some(vec![dir.join("missing.png").to_string_lossy().to_string()]),
        ..Default::default()
    };

    let error = session
        .build_command(&params)
        .expect_err("unresolvable images must fail before spawn");
    assert!(error.contains("none of the attached images"));

    let _ = std::fs::remove_dir_all(dir);
}

fn make_workspace_with_files(files: &[&str]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("pi-cmd-test-{}", uuid::Uuid::new_v4()));
    for relative in files {
        let path = dir.join(relative);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(&path, b"payload").unwrap();
    }
    dir
}

#[test]
fn build_command_extracts_leading_at_file_reference_to_argv() {
    let dir = make_workspace_with_files(&["design.md"]);
    let file = dir.join("design.md");
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    let params = SendMessageParams {
        text: format!("@{} 总结一下", file.display()),
        ..Default::default()
    };

    let cmd = session.build_command(&params).expect("build_command");
    let args = command_args(&cmd);

    let at_arg = format!("@{}", file.display());
    let at_pos = args
        .iter()
        .position(|arg| arg == &at_arg)
        .expect("missing @file arg");
    let prompt_pos = args
        .iter()
        .rposition(|arg| arg.contains("总结一下"))
        .expect("missing prompt arg");
    assert!(at_pos < prompt_pos, "@file arg must precede the prompt");
    let prompt = &args[prompt_pos];
    assert!(
        !prompt.contains("design.md"),
        "extracted token must leave the prompt"
    );
    assert!(!prompt.starts_with('@'), "prompt must not start with '@'");

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn build_command_resolves_at_reference_with_spaces_greedily() {
    let dir = make_workspace_with_files(&["shot one.png"]);
    let file = dir.join("shot one.png");
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    let params = SendMessageParams {
        text: format!("看下 @{} 这张图", file.display()),
        ..Default::default()
    };

    let cmd = session.build_command(&params).expect("build_command");
    let args = command_args(&cmd);

    let at_arg = format!("@{}", file.display());
    assert!(
        args.iter().any(|arg| arg == &at_arg),
        "spaced path must resolve as one @file arg: {args:?}"
    );
    let prompt = args.last().expect("prompt arg");
    assert!(prompt.contains("看下"), "prompt keeps surrounding text");
    assert!(prompt.contains("这张图"), "prompt keeps trailing text");
    assert!(!prompt.contains("shot one.png"));

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn build_command_resolves_relative_at_reference_against_workspace() {
    let dir = make_workspace_with_files(&["docs/a.md"]);
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    let params = SendMessageParams {
        text: "@docs/a.md 读一下".to_string(),
        ..Default::default()
    };

    let cmd = session.build_command(&params).expect("build_command");
    let args = command_args(&cmd);

    let at_arg = format!("@{}", dir.join("docs/a.md").display());
    assert!(args.iter().any(|arg| arg == &at_arg), "args: {args:?}");

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn build_command_keeps_folder_reference_as_plain_text() {
    let dir = make_workspace_with_files(&["sub/placeholder.txt"]);
    let folder = dir.join("sub");
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    let params = SendMessageParams {
        text: format!("@{} 这两个设计移到 docs", folder.display()),
        ..Default::default()
    };

    let cmd = session.build_command(&params).expect("build_command");
    let args = command_args(&cmd);

    let folder_at = format!("@{}", folder.display());
    assert!(
        !args.iter().any(|arg| arg == &folder_at),
        "folder must not become an @file arg"
    );
    let prompt = args.last().expect("prompt arg");
    assert!(prompt.contains(&folder.display().to_string()));
    assert!(
        !prompt.starts_with('@'),
        "leading unresolvable @ token must be space-guarded: {prompt:?}"
    );

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn build_command_keeps_missing_path_and_mention_as_plain_text() {
    let dir = make_workspace_with_files(&[]);
    let missing = dir.join("missing.md");
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    let params = SendMessageParams {
        text: format!("@teammate 帮忙看下 @{}", missing.display()),
        ..Default::default()
    };

    let cmd = session.build_command(&params).expect("build_command");
    let args = command_args(&cmd);

    assert!(
        !args.iter().any(|arg| arg.starts_with('@')),
        "unresolvable tokens must not produce @file args: {args:?}"
    );
    let prompt = args.last().expect("prompt arg");
    assert!(prompt.contains("@teammate"));
    assert!(prompt.contains("missing.md"));
    assert!(!prompt.starts_with('@'));

    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn build_command_dedupes_reference_against_image_attachment() {
    let dir = make_workspace_with_files(&["a.png"]);
    let file = dir.join("a.png");
    let session = PiSession::new("ws".to_string(), dir.clone(), None);
    let params = SendMessageParams {
        text: format!("@{} 看看", file.display()),
        images: Some(vec![file.to_string_lossy().to_string()]),
        ..Default::default()
    };

    let cmd = session.build_command(&params).expect("build_command");
    let args = command_args(&cmd);

    let at_arg = format!("@{}", file.display());
    let count = args.iter().filter(|arg| *arg == &at_arg).count();
    assert_eq!(count, 1, "same path must appear exactly once: {args:?}");

    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test]
async fn interrupt_unknown_turn_is_idempotent() {
    let session = PiSession::new("ws".to_string(), std::env::temp_dir(), None);
    session.interrupt_turn("missing").await.expect("idempotent");
    assert!(session.interrupted_turns.lock().await.is_empty());
}
