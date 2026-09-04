use super::*;
use super::command_build::ClaudeProviderSettingsOverride;


impl ClaudeSession {
    pub(super) fn push_stream_diagnostic_sample(sample: &mut String, text: &str) {
        if sample.len() >= CLAUDE_STREAM_DIAGNOSTIC_SAMPLE_LIMIT {
            return;
        }
        let remaining = CLAUDE_STREAM_DIAGNOSTIC_SAMPLE_LIMIT - sample.len();
        if text.len() <= remaining {
            sample.push_str(text);
            return;
        }

        let mut end = 0;
        for (index, _) in text.char_indices() {
            if index > remaining {
                break;
            }
            end = index;
        }
        if end == 0 {
            return;
        }
        sample.push_str(&text[..end]);
    }

    /// Mid-turn 空闲看门狗判定（纯函数，可单测）。
    /// pending AskUserQuestion 期间恒 Wait（用户驱动的合法静音）；
    /// idle 未达硬上限 Wait；达到则 Kill（代理断流/CLI 卡死）。
    /// OpenSpec change：add-claude-mid-turn-stream-idle-watchdog。
    pub(crate) fn claude_mid_turn_idle_action(
        idle: Duration,
        has_pending_user_input: bool,
        hard_cap: Duration,
    ) -> MidTurnIdleAction {
        if has_pending_user_input {
            return MidTurnIdleAction::Wait;
        }
        if idle >= hard_cap {
            MidTurnIdleAction::Kill
        } else {
            MidTurnIdleAction::Wait
        }
    }

    pub(super) fn build_stream_mid_turn_idle_timeout_error(idle: Duration, diagnostic_sample: &str) -> String {
        let base = format!(
            "Claude stream went silent mid-turn for {}s (hard cap {}s); likely proxy stall or hung CLI",
            idle.as_secs(),
            CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP.as_secs()
        );
        let sample = diagnostic_sample.trim();
        if sample.is_empty() {
            return format!("{base}. No stdout/stderr diagnostics were observed.");
        }
        format!("{base}. Diagnostic sample:\n{}", sample)
    }

    pub(super) fn build_stream_no_event_timeout_error(diagnostic_sample: &str) -> String {
        let base = format!(
            "Claude stream-json startup timed out after {}s without a valid stream event",
            CLAUDE_STREAM_FIRST_EVENT_TIMEOUT.as_secs()
        );
        let sample = diagnostic_sample.trim();
        if sample.is_empty() {
            return format!("{base}. No stdout/stderr diagnostics were observed.");
        }
        format!("{base}. Diagnostic sample:\n{}", sample)
    }

    pub(super) fn build_process_exit_error(
        status: std::process::ExitStatus,
        error_output: &str,
        diagnostic_sample: &str,
        use_stream_json_input: bool,
        include_hook_events: bool,
        access_mode: Option<&str>,
    ) -> String {
        let detail = error_output.trim();
        if !detail.is_empty() {
            return detail.to_string();
        }

        let sample = diagnostic_sample.trim();
        let diagnostic_detail = if sample.is_empty() {
            "No stdout/stderr diagnostics were observed.".to_string()
        } else {
            format!("Diagnostic sample:\n{sample}")
        };

        format!(
            "Claude exited with status: {status}. Diagnostics: input_format={}, include_hook_events={}, permission_mode={}. {diagnostic_detail}",
            if use_stream_json_input { "stream-json" } else { "argv" },
            include_hook_events,
            access_mode.unwrap_or("current"),
        )
    }

    pub(super) fn stream_diagnostic_sample_snapshot(sample: &Arc<StdMutex<String>>) -> String {
        sample.lock().map(|value| value.clone()).unwrap_or_default()
    }

    /// 成功 terminal result 判定：`is_error == true` 或 subtype 以 `error` 开头一律不算成功；
    /// 缺省 subtype / `success` 视为成功（fix-turn-false-failure-retry-storm）。
    pub(super) fn is_success_result_event(event: &Value) -> bool {
        if event.get("is_error").and_then(|v| v.as_bool()) == Some(true) {
            return false;
        }
        if let Some(subtype) = event.get("subtype").and_then(|v| v.as_str()) {
            if subtype.starts_with("error") {
                return false;
            }
        }
        true
    }

    pub(super) fn is_valid_claude_stream_event(event: &Value) -> bool {
        matches!(
            event.get("type").and_then(|value| value.as_str()),
            Some(
                "stream_event"
                    | "system"
                    | "assistant"
                    | "assistant_message_delta"
                    | "message_delta"
                    | "text_delta"
                    | "output_text_delta"
                    | "assistant_message"
                    | "message"
                    | "user"
                    | "result"
                    | "reasoning_delta"
                    | "thinking_delta"
                    | "error"
                    | "tool_use"
                    | "tool_result"
            )
        )
    }

    pub(super) async fn fail_stream_no_event_timeout(
        &self,
        turn_id: &str,
        diagnostic_sample: Arc<StdMutex<String>>,
        mut stderr_handle: tokio::task::JoinHandle<String>,
    ) -> Result<String, String> {
        let mut child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id)
        };
        if let Some(mut child_proc) = child.take() {
            if let Err(error) = self.terminate_child_process(turn_id, &mut child_proc).await {
                log::warn!(
                    "[claude] failed to terminate stream-timeout child for turn={}: {}",
                    turn_id,
                    error
                );
            }
        }
        tokio::select! {
            _ = &mut stderr_handle => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {
                stderr_handle.abort();
            }
        }
        let error_msg = Self::build_stream_no_event_timeout_error(
            &Self::stream_diagnostic_sample_snapshot(&diagnostic_sample),
        );
        self.emit_pending_ask_user_question_resume_failure(turn_id, &error_msg);
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnError {
                workspace_id: self.workspace_id.clone(),
                error: error_msg.clone(),
                code: Some("claude_stream_no_event_timeout".to_string()),
            },
        );
        self.clear_turn_ephemeral_state(turn_id);
        Err(error_msg)
    }

    /// Mid-turn 断流硬上限：kill 子进程并发 TurnError。镜像 fail_stream_no_event_timeout。
    /// OpenSpec change：add-claude-mid-turn-stream-idle-watchdog。
    pub(super) async fn fail_stream_mid_turn_idle_timeout(
        &self,
        turn_id: &str,
        idle: Duration,
        diagnostic_sample: Arc<StdMutex<String>>,
        mut stderr_handle: tokio::task::JoinHandle<String>,
    ) -> Result<String, String> {
        let mut child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id)
        };
        if let Some(mut child_proc) = child.take() {
            if let Err(error) = self.terminate_child_process(turn_id, &mut child_proc).await {
                log::warn!(
                    "[claude] failed to terminate mid-turn-idle child for turn={}: {}",
                    turn_id,
                    error
                );
            }
        }
        tokio::select! {
            _ = &mut stderr_handle => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {
                stderr_handle.abort();
            }
        }
        let error_msg = Self::build_stream_mid_turn_idle_timeout_error(
            idle,
            &Self::stream_diagnostic_sample_snapshot(&diagnostic_sample),
        );
        self.emit_pending_ask_user_question_resume_failure(turn_id, &error_msg);
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnError {
                workspace_id: self.workspace_id.clone(),
                error: error_msg.clone(),
                code: Some("claude_stream_mid_turn_idle_timeout".to_string()),
            },
        );
        self.clear_turn_ephemeral_state(turn_id);
        Err(error_msg)
    }

    pub(super) fn emit_stream_no_valid_event_error(&self, turn_id: &str, diagnostic_sample: &str) -> String {
        let error_msg = if diagnostic_sample.trim().is_empty() {
            "Claude stream-json ended without a valid stream event.".to_string()
        } else {
            format!(
                "Claude stream-json ended without a valid stream event. Diagnostic sample:\n{}",
                diagnostic_sample.trim()
            )
        };
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnError {
                workspace_id: self.workspace_id.clone(),
                error: error_msg.clone(),
                code: Some("claude_stream_no_valid_event".to_string()),
            },
        );
        error_msg
    }

    pub(super) fn flush_buffered_text_delta(
        &self,
        turn_id: &str,
        pending_text_delta: &mut BufferedClaudeTextDelta,
    ) {
        let Some(emission) = pending_text_delta.take_with_timing() else {
            return;
        };
        self.emit_turn_event_with_stream_timing(
            turn_id,
            EngineEvent::TextDelta {
                workspace_id: self.workspace_id.clone(),
                text: emission.text,
            },
            Some(
                emission
                    .stream_startup_timing
                    .unwrap_or_default()
                    .to_stream_timing(emission.stdout_received_at_ms, unix_timestamp_ms()),
            ),
        );
    }

    pub(super) async fn fail_send_setup_and_terminate_child(
        &self,
        turn_id: &str,
        child: &mut Child,
        error_msg: String,
    ) -> Result<String, String> {
        if let Err(error) = self.terminate_child_process(turn_id, child).await {
            log::debug!(
                "[claude] failed to terminate setup-failed child process (turn={}): {}",
                turn_id,
                error
            );
        }
        self.clear_turn_ephemeral_state(turn_id);
        Err(error_msg)
    }

    pub(super) async fn send_message_attempt(
        &self,
        params: SendMessageParams,
        turn_id: &str,
        include_hook_events: bool,
        app_settings: Option<&crate::types::AppSettings>,
        provider_env: Option<&BTreeMap<String, String>>,
        profile: ClaudeCommandProfile,
    ) -> Result<String, String> {
        if self.is_disposed() {
            let error_msg = "Claude session disposed; refusing to start new process".to_string();
            self.emit_turn_event(
                turn_id,
                EngineEvent::TurnError {
                    workspace_id: self.workspace_id.clone(),
                    error: error_msg.clone(),
                    code: None,
                },
            );
            self.clear_turn_ephemeral_state(turn_id);
            return Err(error_msg);
        }

        // Reset cumulative text tracker for the new turn only.
        if let Ok(mut map) = self.last_emitted_text_by_turn.lock() {
            map.remove(turn_id);
        }

        if let Err(error_msg) = Self::normalized_fork_session_id(&params) {
            self.emit_turn_event(
                turn_id,
                EngineEvent::TurnError {
                    workspace_id: self.workspace_id.clone(),
                    error: error_msg.clone(),
                    code: None,
                },
            );
            self.clear_turn_ephemeral_state(turn_id);
            return Err(error_msg);
        }

        let use_stream_json_input = Self::should_use_stream_json_input(&params);
        let activation_hint_file = if profile.is_context_bootstrap() {
            None
        } else {
            match native_skill_mirror::sync_windows_curated_skill_mirror(
                self.home_dir.as_deref(),
                app_settings,
                cfg!(windows),
            ) {
                Ok(path) => path,
                Err(error_msg) => {
                    self.emit_turn_event(
                        turn_id,
                        EngineEvent::TurnError {
                            workspace_id: self.workspace_id.clone(),
                            error: error_msg.clone(),
                            code: Some("claude_curated_skill_mirror_failed".to_string()),
                        },
                    );
                    self.clear_turn_ephemeral_state(turn_id);
                    return Err(error_msg);
                }
            }
        };

        let provider_settings_override = match ClaudeProviderSettingsOverride::create(provider_env)
        {
            Ok(settings_override) => settings_override,
            Err(error_msg) => {
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: error_msg.clone(),
                        code: Some("claude_provider_settings_override_failed".to_string()),
                    },
                );
                self.clear_turn_ephemeral_state(turn_id);
                return Err(error_msg);
            }
        };
        let provider_settings_path = provider_settings_override
            .as_ref()
            .map(ClaudeProviderSettingsOverride::path);
        let mut cmd = self.build_command_with_profile(
            &params,
            use_stream_json_input,
            include_hook_events,
            app_settings,
            activation_hint_file.as_deref(),
            provider_env,
            provider_settings_path,
            profile,
        );
        Self::configure_spawn_command(&mut cmd);

        // Spawn the process
        let mut stream_startup_timing = ClaudeStreamStartupTiming {
            process_spawn_started_at_ms: Some(unix_timestamp_ms()),
            ..ClaudeStreamStartupTiming::default()
        };
        let mut child = match cmd.spawn() {
            Ok(child) => child,
            Err(e) => {
                let error_msg = format!("Failed to spawn claude: {}", e);
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: error_msg.clone(),
                        code: None,
                    },
                );
                self.clear_turn_ephemeral_state(turn_id);
                return Err(error_msg);
            }
        };
        stream_startup_timing.process_spawned_at_ms = Some(unix_timestamp_ms());

        // If stream-json input is enabled, write the message content to stdin.
        // This path is required for image payloads and multiline text prompts.
        if use_stream_json_input {
            if let Some(mut stdin) = child.stdin.take() {
                stream_startup_timing.stdin_write_started_at_ms = Some(unix_timestamp_ms());
                let message = match build_message_content(&params) {
                    Ok(value) => value,
                    Err(error) => {
                        drop(stdin);
                        return self
                            .fail_send_setup_and_terminate_child(
                                turn_id,
                                &mut child,
                                format!("Failed to build message: {}", error),
                            )
                            .await;
                    }
                };
                let message_str = match serde_json::to_string(&message) {
                    Ok(value) => value,
                    Err(error) => {
                        drop(stdin);
                        return self
                            .fail_send_setup_and_terminate_child(
                                turn_id,
                                &mut child,
                                format!("Failed to serialize message: {}", error),
                            )
                            .await;
                    }
                };

                if let Err(error) = stdin.write_all(message_str.as_bytes()).await {
                    drop(stdin);
                    return self
                        .fail_send_setup_and_terminate_child(
                            turn_id,
                            &mut child,
                            format!("Failed to write to stdin: {}", error),
                        )
                        .await;
                }
                if let Err(error) = stdin.write_all(b"\n").await {
                    drop(stdin);
                    return self
                        .fail_send_setup_and_terminate_child(
                            turn_id,
                            &mut child,
                            format!("Failed to write newline: {}", error),
                        )
                        .await;
                }
                // Drop stdin to signal EOF
                drop(stdin);
                stream_startup_timing.stdin_closed_at_ms = Some(unix_timestamp_ms());
            } else {
                return self
                    .fail_send_setup_and_terminate_child(
                        turn_id,
                        &mut child,
                        "Failed to capture stdin for stream-json mode".to_string(),
                    )
                    .await;
            }
        } else {
            // For non-image messages, drop stdin immediately so the CLI
            // doesn't hang waiting for EOF.
            drop(child.stdin.take());
            stream_startup_timing.stdin_closed_at_ms = Some(unix_timestamp_ms());
        }

        let stdout = match child.stdout.take() {
            Some(value) => value,
            None => {
                return self
                    .fail_send_setup_and_terminate_child(
                        turn_id,
                        &mut child,
                        "Failed to capture stdout".to_string(),
                    )
                    .await;
            }
        };

        let stderr = match child.stderr.take() {
            Some(value) => value,
            None => {
                return self
                    .fail_send_setup_and_terminate_child(
                        turn_id,
                        &mut child,
                        "Failed to capture stderr".to_string(),
                    )
                    .await;
            }
        };

        // Store child for interruption (per turn)
        let mut spawned_child = Some(child);
        {
            let mut active = self.active_processes.lock().await;
            if !self.is_disposed() {
                if let Some(child) = spawned_child.take() {
                    active.insert(turn_id.to_string(), child);
                }
            }
        }
        if let Some(mut child) = spawned_child.take() {
            let _ = self.terminate_child_process(turn_id, &mut child).await;
            let error_msg =
                "Claude session disposed during startup; terminated pending child process"
                    .to_string();
            self.emit_turn_event(
                turn_id,
                EngineEvent::TurnError {
                    workspace_id: self.workspace_id.clone(),
                    error: error_msg.clone(),
                    code: None,
                },
            );
            self.clear_turn_ephemeral_state(turn_id);
            return Err(error_msg);
        }

        // Emit session started event
        self.emit_turn_event(
            turn_id,
            EngineEvent::SessionStarted {
                workspace_id: self.workspace_id.clone(),
                session_id: "pending".to_string(),
                engine: EngineType::Claude,
                turn_id: Some(turn_id.to_string()),
            },
        );

        // Emit turn started event
        stream_startup_timing.turn_started_at_ms = Some(unix_timestamp_ms());
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnStarted {
                workspace_id: self.workspace_id.clone(),
                turn_id: turn_id.to_string(),
            },
        );

        // Read stdout line by line
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut response_text = String::new();
        let mut saw_text_delta = false;
        let mut new_session_id: Option<String> = None;
        let mut error_output = String::new();
        let mut stream_runtime_error: Option<String> = None;
        let mut stream_error_event_emitted = false;
        let mut saw_valid_stream_event = false;
        // 成功 terminal result（is_error != true 且 subtype 非 error*）已到达的 turn，
        // 进程非零退出不得否决结算（fix-turn-false-failure-retry-storm）。
        let mut saw_success_result = false;
        let first_event_deadline = Instant::now() + CLAUDE_STREAM_FIRST_EVENT_TIMEOUT;
        let stream_diagnostic_sample = Arc::new(StdMutex::new(String::new()));
        let text_delta_coalesce_window = if cfg!(windows) {
            Duration::from_millis(CLAUDE_TEXT_DELTA_COALESCE_WINDOW_MS)
        } else {
            Duration::ZERO
        };
        let mut pending_text_delta = BufferedClaudeTextDelta::default();
        // Timestamp of the final `result` event. Once seen, the turn is
        // logically complete and we only wait for the CLI to exit; that wait is
        // bounded by CLAUDE_POST_RESULT_GRACE (see below) so lingering MCP
        // children / Stop hooks that inherit the stdio pipes cannot keep the UI
        // stuck on "generating" forever — unless structured background-task
        // blockers are active (issue #983 / backgroundTaskId).
        let mut result_seen_at: Option<Instant> = None;
        // When Some, post-result EOF wait is bounded by this absolute deadline.
        // D3b: first result with empty blockers → result_seen + GRACE;
        // blockers clear after WaitBgTasks → full re-arm from clearance.
        let mut post_result_grace_deadline: Option<Instant> = None;
        // Turn-scoped structured backgroundTaskId set (settlement blockers).
        // Bash background shells (#983) only. Agent/Task async-launch subagents use
        // `pending_agent_task_ids` below instead; the two waits have different risk
        // models and must not share one set/timer.
        let mut active_background_task_ids: HashSet<String> = HashSet::new();
        // Turn-scoped Agent/Task `task_started` ids seen before `result`. Bounds the
        // pre-result wait (see CLAUDE_BG_TASK_MAX_WAIT) instead of the post-result
        // WaitBgTasks path #983 deliberately leaves unbounded.
        let mut pending_agent_task_ids: HashSet<String> = HashSet::new();
        // Armed the first time `pending_agent_task_ids` becomes non-empty, and RESET
        // on every received stream line thereafter. Idle bound, not absolute: a
        // subagent that is still producing activity never hits it. Cleared when the
        // set empties so a later still-pre-result task_started can re-arm.
        let mut pending_agent_task_deadline: Option<Instant> = None;
        // Set when we stop waiting because the post-result grace elapsed, OR because
        // the pre-result pending-task idle-wait elapsed. The turn is settled as a
        // success and the exit-status failure checks are skipped for the process we
        // force-kill.
        let mut settled_by_grace = false;
        // Specifically the pre-result pending-task idle-wait. Used only to synthesize
        // a visible notice if `response_text` would otherwise be silently empty.
        let mut settled_by_pending_task_max_wait = false;

        // Spawn stderr reader
        let stderr_reader = BufReader::new(stderr);
        let _workspace_id_clone = self.workspace_id.clone();
        let stderr_diagnostic_sample = Arc::clone(&stream_diagnostic_sample);
        let mut stderr_handle = tokio::spawn(async move {
            let mut lines = stderr_reader.lines();
            let mut stderr_text = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                stderr_text.push_str(&line);
                stderr_text.push('\n');
                if let Ok(mut sample) = stderr_diagnostic_sample.lock() {
                    ClaudeSession::push_stream_diagnostic_sample(&mut sample, &line);
                    ClaudeSession::push_stream_diagnostic_sample(&mut sample, "\n");
                }
            }
            stderr_text
        });

        // Process stdout events
        let mut session_id_emitted = false;
        // Mid-turn 看门狗静音计时（收到任意一行即刷新）。
        let mut last_stream_event_at = Instant::now();
        loop {
            if pending_text_delta.has_expired(text_delta_coalesce_window) {
                self.flush_buffered_text_delta(turn_id, &mut pending_text_delta);
                continue;
            }

            let next_line = if pending_text_delta.is_empty() {
                if saw_valid_stream_event {
                    if result_seen_at.is_some() {
                        // Turn is logically done (`result` seen).
                        // - active structured background blockers → WaitBgTasks
                        //   (no grace tree-kill; issue #983)
                        // - otherwise GraceWaitEof bounded by post_result_grace_deadline
                        if !active_background_task_ids.is_empty() {
                            lines.next_line().await
                        } else {
                            let deadline = post_result_grace_deadline
                                .get_or_insert_with(|| Instant::now() + CLAUDE_POST_RESULT_GRACE);
                            let remaining = deadline.saturating_duration_since(Instant::now());
                            match tokio::time::timeout(remaining, lines.next_line()).await {
                                Ok(result) => result,
                                Err(_) => {
                                    if can_force_kill_for_grace(
                                        true,
                                        active_background_task_ids.is_empty(),
                                        true,
                                    ) {
                                        settled_by_grace = true;
                                        break;
                                    }
                                    // Blockers appeared mid-timeout window; continue WaitBgTasks.
                                    continue;
                                }
                            }
                        }
                    } else if pending_agent_task_ids.is_empty() {
                        // Mid-turn 看门狗：历史上此处无界，中转代理断流（无 EOF）
                        // 会让 turn 永远挂起。按 STEP 步进检查，硬上限内仅 warn。
                        match tokio::time::timeout(
                            CLAUDE_STREAM_MID_TURN_IDLE_STEP,
                            lines.next_line(),
                        )
                        .await
                        {
                            Ok(result) => result,
                            Err(_) => {
                                let has_pending_user_input = self
                                    .pending_user_inputs
                                    .lock()
                                    .map(|map| map.contains_key(turn_id))
                                    .unwrap_or(false);
                                let idle = last_stream_event_at.elapsed();
                                match Self::claude_mid_turn_idle_action(
                                    idle,
                                    has_pending_user_input,
                                    CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP,
                                ) {
                                    MidTurnIdleAction::Wait => {
                                        if !has_pending_user_input {
                                            log::warn!(
                                                "[claude] mid-turn stream idle {}s (hard cap {}s) turn={}; sample={}",
                                                idle.as_secs(),
                                                CLAUDE_STREAM_MID_TURN_IDLE_HARD_CAP.as_secs(),
                                                turn_id,
                                                Self::stream_diagnostic_sample_snapshot(&stream_diagnostic_sample)
                                            );
                                        }
                                        continue;
                                    }
                                    MidTurnIdleAction::Kill => {
                                        self.flush_buffered_text_delta(
                                            turn_id,
                                            &mut pending_text_delta,
                                        );
                                        return self
                                            .fail_stream_mid_turn_idle_timeout(
                                                turn_id,
                                                idle,
                                                Arc::clone(&stream_diagnostic_sample),
                                                stderr_handle,
                                            )
                                            .await;
                                    }
                                }
                            }
                        }
                    } else {
                        // A pending Agent/Task subagent is outstanding pre-result.
                        // Bound the wait; see CLAUDE_BG_TASK_MAX_WAIT.
                        let deadline = pending_agent_task_deadline
                            .get_or_insert_with(|| Instant::now() + CLAUDE_BG_TASK_MAX_WAIT);
                        let remaining = deadline.saturating_duration_since(Instant::now());
                        match tokio::time::timeout(remaining, lines.next_line()).await {
                            Ok(result) => result,
                            Err(_) => {
                                if pending_agent_task_ids.is_empty() {
                                    continue;
                                }
                                log::warn!(
                                    "[claude] pending Agent/Task idle max-wait ({:?}) elapsed with {} task(s) still pending turn={}; force-settling",
                                    CLAUDE_BG_TASK_MAX_WAIT,
                                    pending_agent_task_ids.len(),
                                    turn_id
                                );
                                settled_by_grace = true;
                                settled_by_pending_task_max_wait = true;
                                break;
                            }
                        }
                    }
                } else {
                    let wait_duration = first_event_deadline
                        .checked_duration_since(Instant::now())
                        .unwrap_or(Duration::ZERO);
                    match tokio::time::timeout(wait_duration, lines.next_line()).await {
                        Ok(result) => result,
                        Err(_) => {
                            return self
                                .fail_stream_no_event_timeout(
                                    turn_id,
                                    Arc::clone(&stream_diagnostic_sample),
                                    stderr_handle,
                                )
                                .await;
                        }
                    }
                }
            } else if let Some(wait_duration) =
                pending_text_delta.remaining_window(text_delta_coalesce_window)
            {
                let mut wait_duration = if saw_valid_stream_event {
                    wait_duration
                } else {
                    let remaining_startup = first_event_deadline
                        .checked_duration_since(Instant::now())
                        .unwrap_or(Duration::ZERO);
                    wait_duration.min(remaining_startup)
                };
                // Share grace policy with the empty-buffer branch (Windows coalesce).
                if result_seen_at.is_some() && active_background_task_ids.is_empty() {
                    let deadline = post_result_grace_deadline
                        .get_or_insert_with(|| Instant::now() + CLAUDE_POST_RESULT_GRACE);
                    wait_duration =
                        wait_duration.min(deadline.saturating_duration_since(Instant::now()));
                } else if result_seen_at.is_none() && !pending_agent_task_ids.is_empty() {
                    let deadline = pending_agent_task_deadline
                        .get_or_insert_with(|| Instant::now() + CLAUDE_BG_TASK_MAX_WAIT);
                    wait_duration =
                        wait_duration.min(deadline.saturating_duration_since(Instant::now()));
                }
                match tokio::time::timeout(wait_duration, lines.next_line()).await {
                    Ok(result) => result,
                    Err(_) => {
                        if result_seen_at.is_some()
                            && active_background_task_ids.is_empty()
                            && post_result_grace_deadline.is_some_and(|d| Instant::now() >= d)
                            && can_force_kill_for_grace(true, true, true)
                        {
                            self.flush_buffered_text_delta(turn_id, &mut pending_text_delta);
                            settled_by_grace = true;
                            break;
                        }
                        if result_seen_at.is_none()
                            && !pending_agent_task_ids.is_empty()
                            && pending_agent_task_deadline.is_some_and(|d| Instant::now() >= d)
                        {
                            self.flush_buffered_text_delta(turn_id, &mut pending_text_delta);
                            log::warn!(
                                "[claude] pending Agent/Task idle max-wait ({:?}) elapsed with {} task(s) still pending turn={}; force-settling",
                                CLAUDE_BG_TASK_MAX_WAIT,
                                pending_agent_task_ids.len(),
                                turn_id
                            );
                            settled_by_grace = true;
                            settled_by_pending_task_max_wait = true;
                            break;
                        }
                        if saw_valid_stream_event {
                            self.flush_buffered_text_delta(turn_id, &mut pending_text_delta);
                            continue;
                        }
                        return self
                            .fail_stream_no_event_timeout(
                                turn_id,
                                Arc::clone(&stream_diagnostic_sample),
                                stderr_handle,
                            )
                            .await;
                    }
                }
            } else {
                self.flush_buffered_text_delta(turn_id, &mut pending_text_delta);
                continue;
            };

            let Some(line) = (match next_line {
                Ok(Some(line)) => Some(line),
                Ok(None) => None,
                Err(error) => {
                    self.flush_buffered_text_delta(turn_id, &mut pending_text_delta);
                    if stream_runtime_error.is_none() {
                        stream_runtime_error =
                            Some(format!("Failed to read Claude stream output: {}", error));
                    }
                    None
                }
            }) else {
                break;
            };

            if line.trim().is_empty() {
                continue;
            }
            last_stream_event_at = Instant::now();
            let line_received_at_ms = unix_timestamp_ms();
            if stream_startup_timing.first_stdout_line_at_ms.is_none() {
                stream_startup_timing.first_stdout_line_at_ms = Some(line_received_at_ms);
            }

            match parse_claude_stream_json_line(&line) {
                Ok(event) => {
                    // Idle-reset the pending Agent/Task max-wait: any successfully parsed
                    // stream line while a task is pending is evidence the process is alive.
                    if result_seen_at.is_none() && !pending_agent_task_ids.is_empty() {
                        pending_agent_task_deadline =
                            Some(Instant::now() + CLAUDE_BG_TASK_MAX_WAIT);
                    }
                    // Structured background-task settlement blockers (issue #983).
                    if let Some(bg_id) = extract_background_task_id(&event) {
                        let before_len = active_background_task_ids.len();
                        if try_register_background_task_id(&mut active_background_task_ids, &bg_id)
                        {
                            if before_len != active_background_task_ids.len() {
                                log::info!(
                                    "[claude] registered backgroundTaskId blocker turn={} id={} active={}",
                                    turn_id,
                                    bg_id,
                                    active_background_task_ids.len()
                                );
                            }
                            // Late id after result: suppress grace kill (enter WaitBgTasks).
                            if result_seen_at.is_some() {
                                post_result_grace_deadline = None;
                            }
                        } else if before_len >= stream_helpers::CLAUDE_BG_TASK_SET_MAX {
                            log::warn!(
                                "[claude] backgroundTaskId budget full turn={} rejected_id_len={}",
                                turn_id,
                                bg_id.len()
                            );
                        }
                    }
                    // Agent/Task pending-task tracking: independent of
                    // active_background_task_ids, only bounds the pre-result wait.
                    if result_seen_at.is_none() {
                        if let Some(agent_task_id) = extract_task_started_id(&event) {
                            let before_len = pending_agent_task_ids.len();
                            if try_register_background_task_id(
                                &mut pending_agent_task_ids,
                                &agent_task_id,
                            ) {
                                if before_len != pending_agent_task_ids.len() {
                                    log::info!(
                                        "[claude] registered pending Agent/Task turn={} id={} pending={}",
                                        turn_id,
                                        agent_task_id,
                                        pending_agent_task_ids.len()
                                    );
                                }
                            } else if before_len >= stream_helpers::CLAUDE_BG_TASK_SET_MAX {
                                log::warn!(
                                    "[claude] pending Agent/Task budget full turn={} rejected_id_len={}",
                                    turn_id,
                                    agent_task_id.len()
                                );
                            }
                        }
                    }
                    if let Some(release_id) = extract_terminal_task_release_id(&event) {
                        // extract_terminal_task_release_id only yields terminal statuses;
                        // pass a terminal status so the shared release helper accepts it.
                        let was_non_empty = !active_background_task_ids.is_empty();
                        if try_release_background_task_id(
                            &mut active_background_task_ids,
                            &release_id,
                            "completed",
                        ) {
                            log::info!(
                                "[claude] released backgroundTaskId blocker turn={} id={} remaining={}",
                                turn_id,
                                release_id,
                                active_background_task_ids.len()
                            );
                            // D3b: last blocker cleared while still post-result → full re-arm grace.
                            if was_non_empty
                                && active_background_task_ids.is_empty()
                                && result_seen_at.is_some()
                            {
                                post_result_grace_deadline =
                                    Some(Instant::now() + CLAUDE_POST_RESULT_GRACE);
                                log::info!(
                                    "[claude] re-armed post-result grace after blockers cleared turn={}",
                                    turn_id
                                );
                            }
                        }
                        if try_release_background_task_id(
                            &mut pending_agent_task_ids,
                            &release_id,
                            "completed",
                        ) {
                            log::info!(
                                "[claude] released pending Agent/Task turn={} id={} pending={}",
                                turn_id,
                                release_id,
                                pending_agent_task_ids.len()
                            );
                            if pending_agent_task_ids.is_empty() {
                                pending_agent_task_deadline = None;
                            }
                        }
                    }
                    if result_seen_at.is_none()
                        && event.get("type").and_then(|v| v.as_str()) == Some("result")
                    {
                        if Self::is_success_result_event(&event) {
                            saw_success_result = true;
                        }
                        result_seen_at = Some(Instant::now());
                        if active_background_task_ids.is_empty() {
                            post_result_grace_deadline =
                                Some(Instant::now() + CLAUDE_POST_RESULT_GRACE);
                        } else {
                            post_result_grace_deadline = None;
                            log::info!(
                                "[claude] result seen with {} background blocker(s); suppressing post-result grace kill turn={}",
                                active_background_task_ids.len(),
                                turn_id
                            );
                        }
                    }
                    if Self::is_valid_claude_stream_event(&event) {
                        if stream_startup_timing
                            .first_valid_stream_event_at_ms
                            .is_none()
                        {
                            stream_startup_timing.first_valid_stream_event_at_ms =
                                Some(line_received_at_ms);
                        }
                        saw_valid_stream_event = true;
                        self.emit_pending_ask_user_question_resume_success(turn_id);
                    } else if !saw_valid_stream_event {
                        if let Ok(mut sample) = stream_diagnostic_sample.lock() {
                            Self::push_stream_diagnostic_sample(&mut sample, &line);
                            Self::push_stream_diagnostic_sample(&mut sample, "\n");
                        }
                    }
                    // If Claude only emits a final result without streaming deltas,
                    // synthesize a text delta so the frontend still renders a reply.
                    if !saw_text_delta {
                        if let Some(event_type) = event.get("type").and_then(|v| v.as_str()) {
                            if event_type == "result" {
                                if let Some(text) = extract_result_text(&event) {
                                    if !text.trim().is_empty() {
                                        saw_text_delta = true;
                                        if stream_startup_timing.first_text_delta_at_ms.is_none() {
                                            stream_startup_timing.first_text_delta_at_ms =
                                                Some(line_received_at_ms);
                                        }
                                        response_text.push_str(&text);
                                        pending_text_delta
                                            .push_with_timing(&text, Some(line_received_at_ms));
                                        pending_text_delta
                                            .set_stream_startup_timing(&stream_startup_timing);
                                    }
                                }
                            }
                        }
                    }

                    // Extract session ID if present and emit event with real session_id
                    // Check both snake_case (session_id) and camelCase (sessionId) field names
                    let sid = event
                        .get("session_id")
                        .or_else(|| event.get("sessionId"))
                        .and_then(|v| v.as_str());
                    if let Some(sid) = sid {
                        if !sid.is_empty() && sid != "pending" && !session_id_emitted {
                            new_session_id = Some(sid.to_string());
                            self.set_session_id(Some(sid.to_string())).await;
                            session_id_emitted = true;
                            // Emit SessionStarted with real session_id so frontend can update thread ID
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::SessionStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    session_id: sid.to_string(),
                                    engine: EngineType::Claude,
                                    turn_id: Some(turn_id.to_string()),
                                },
                            );
                        }
                    }

                    // Convert and emit event
                    if let Some(unified_event) = self.convert_event(turn_id, &event) {
                        if let EngineEvent::TurnError { ref error, .. } = unified_event {
                            if stream_runtime_error.is_none() {
                                stream_runtime_error = Some(error.clone());
                            }
                            if Self::is_prompt_too_long_error(error) {
                                self.flush_buffered_text_delta(turn_id, &mut pending_text_delta);
                                continue;
                            }
                            stream_error_event_emitted = true;
                        }

                        // Collect text for final response
                        if let EngineEvent::TextDelta { ref text, .. } = unified_event {
                            response_text.push_str(text);
                            saw_text_delta = true;
                            if stream_startup_timing.first_text_delta_at_ms.is_none() {
                                stream_startup_timing.first_text_delta_at_ms =
                                    Some(line_received_at_ms);
                            }
                            pending_text_delta.push_with_timing(text, Some(line_received_at_ms));
                            pending_text_delta.set_stream_startup_timing(&stream_startup_timing);
                            continue;
                        }

                        self.flush_buffered_text_delta(turn_id, &mut pending_text_delta);
                        // Only incomplete asks enter kill+resume wait; completed
                        // lifecycle events (timeout / re-settled replay) must not block.
                        let is_user_input_request = matches!(
                            &unified_event,
                            EngineEvent::RequestUserInput {
                                completed: false,
                                ..
                            }
                        );

                        self.emit_turn_event_with_stream_timing(
                            turn_id,
                            unified_event,
                            Some(
                                stream_startup_timing.to_stream_timing(
                                    Some(line_received_at_ms),
                                    unix_timestamp_ms(),
                                ),
                            ),
                        );

                        if self.has_pending_approval_request_for_turn(turn_id) {
                            match self
                                .handle_file_approval_resume(
                                    turn_id,
                                    &params,
                                    &new_session_id,
                                    include_hook_events,
                                    provider_settings_path,
                                )
                                .await
                            {
                                Ok(Some(new_lines)) => {
                                    lines = new_lines;
                                    continue;
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    self.emit_turn_event(
                                        turn_id,
                                        EngineEvent::TurnError {
                                            workspace_id: self.workspace_id.clone(),
                                            error: error.clone(),
                                            code: None,
                                        },
                                    );
                                    self.clear_turn_ephemeral_state(turn_id);
                                    return Err(error);
                                }
                            }
                        }

                        // When AskUserQuestion is detected, delegate to the
                        // dedicated handler which waits for user input, kills the
                        // current CLI, and restarts with --resume.
                        if is_user_input_request {
                            match self
                                .handle_ask_user_question_resume(
                                    turn_id,
                                    &params,
                                    &new_session_id,
                                    include_hook_events,
                                    provider_settings_path,
                                )
                                .await
                            {
                                Ok(Some(new_lines)) => {
                                    lines = new_lines;
                                    continue;
                                }
                                Ok(None) => {}
                                Err(error) => {
                                    self.emit_turn_event(
                                        turn_id,
                                        EngineEvent::TurnError {
                                            workspace_id: self.workspace_id.clone(),
                                            error: error.clone(),
                                            code: None,
                                        },
                                    );
                                    self.clear_turn_ephemeral_state(turn_id);
                                    return Err(error);
                                }
                            }
                        }
                    }
                }
                Err(_e) => {
                    let trimmed = line.trim();
                    if is_claude_stream_control_line(trimmed) {
                        continue;
                    }
                    // Non-JSON output, might be error
                    error_output.push_str(&line);
                    error_output.push('\n');
                    if let Ok(mut sample) = stream_diagnostic_sample.lock() {
                        Self::push_stream_diagnostic_sample(&mut sample, &line);
                        Self::push_stream_diagnostic_sample(&mut sample, "\n");
                    }
                    if stream_runtime_error.is_none() && looks_like_claude_runtime_error(trimmed) {
                        stream_runtime_error = Some(trimmed.to_string());
                    }
                }
            }
        }

        self.flush_buffered_text_delta(turn_id, &mut pending_text_delta);

        // Wait for process to complete
        let mut child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id)
        };
        let status = if let Some(mut child_proc) = child.take() {
            if settled_by_grace {
                // Post-result grace elapsed: the turn already produced `result`,
                // and the process only lingers because MCP children / Stop hooks
                // inherited its stdio pipes. Kill the whole process group so every
                // pipe write end closes (unblocking the stderr reader below) and no
                // descendants leak, then reap. The killed exit status is expected,
                // so it is NOT treated as a failure (see the `settled_by_grace`
                // guard on the status checks).
                self.force_kill_process_group(&mut child_proc).await;
                let _ = child_proc.wait().await;
                None
            } else {
                child_proc.wait().await.ok()
            }
        } else {
            None
        };

        // Get stderr, but bound the drain: if a descendant escaped the CLI's
        // process group (setsid) and still holds the inherited stderr write end
        // open, the reader task never sees EOF and `force_kill_process_group`
        // cannot reach it. stderr is diagnostic-only, so abort the reader rather
        // than hang the turn on "generating…" forever — TurnCompleted must still
        // fire (see CLAUDE_POST_RESULT_STDERR_DRAIN).
        let stderr_text =
            match tokio::time::timeout(CLAUDE_POST_RESULT_STDERR_DRAIN, &mut stderr_handle).await {
                Ok(joined) => joined.unwrap_or_default(),
                Err(_) => {
                    stderr_handle.abort();
                    String::new()
                }
            };
        if !stderr_text.trim().is_empty() {
            error_output.push_str(&stderr_text);
        }

        // Update session ID
        if let Some(sid) = new_session_id {
            self.set_session_id(Some(sid)).await;
        }

        // Check for errors - emit TurnError whenever the process exits with
        // a non-zero status, regardless of whether partial output was received.
        // Previously this only triggered when response_text was empty, which
        // caused silent failures when the CLI produced partial output before crashing.
        if let Some(status) = status {
            if !status.success() {
                if saw_success_result {
                    // Turn 在流内已逻辑完成（成功 result）：退出码只作诊断，不否决结算。
                    // 典型来源：Windows / 中转渠道 / hooks 环境下 CLI 成功轮次后非零退出。
                    let stderr_sample = error_output.trim();
                    let stderr_sample: &str = if stderr_sample.chars().count() > 400 {
                        // 截断防爆日志
                        "(stderr sample truncated)"
                    } else {
                        stderr_sample
                    };
                    log::warn!(
                        "[claude] turn={} saw success result but process exited non-zero ({}); settling as completed. stderr_sample={}",
                        turn_id,
                        status,
                        stderr_sample
                    );
                } else {
                    let error_msg = Self::build_process_exit_error(
                        status,
                        &error_output,
                        &Self::stream_diagnostic_sample_snapshot(&stream_diagnostic_sample),
                        use_stream_json_input,
                        include_hook_events,
                        params.access_mode.as_deref(),
                    );

                    if include_hook_events && Self::is_unknown_include_hook_events_error(&error_msg)
                    {
                        self.clear_turn_ephemeral_state(turn_id);
                        return Err(error_msg);
                    }

                    log::error!("Claude process failed: {}", error_msg);
                    self.emit_pending_ask_user_question_resume_failure(turn_id, &error_msg);

                    if Self::is_prompt_too_long_error(&error_msg) {
                        self.clear_turn_ephemeral_state(turn_id);
                        return Err(Self::mark_retryable_prompt_too_long_error(&error_msg));
                    }

                    if let Some(mode_blocked_event) =
                        self.build_mode_blocked_signal_from_error(turn_id, &error_msg)
                    {
                        self.emit_turn_event(turn_id, mode_blocked_event);
                    }

                    self.emit_turn_event(
                        turn_id,
                        EngineEvent::TurnError {
                            workspace_id: self.workspace_id.clone(),
                            error: error_msg.clone(),
                            code: None,
                        },
                    );

                    self.clear_turn_ephemeral_state(turn_id);
                    return Err(error_msg);
                }
            }
        } else if !settled_by_grace {
            // Process handle was taken by interrupt() or missing.
            // (A grace-settled turn also reports no status because we force-kill
            // it above; that path is a success and skips these failure checks.)
            // Check the interrupted flag to distinguish user-initiated interrupts
            // from unexpected process disappearance.
            let was_interrupted = self.interrupted.swap(false, Ordering::SeqCst);
            if was_interrupted {
                log::info!("Turn {} was interrupted by user", turn_id);
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: "Session stopped.".to_string(),
                        code: None,
                    },
                );
                self.clear_turn_ephemeral_state(turn_id);
                return Err("Session stopped.".to_string());
            }
            // Not a user interrupt — treat as unexpected termination
            if response_text.is_empty() {
                let error_msg = "Claude process terminated unexpectedly".to_string();
                log::error!("{}", error_msg);
                self.emit_pending_ask_user_question_resume_failure(turn_id, &error_msg);
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: error_msg.clone(),
                        code: None,
                    },
                );
                self.clear_turn_ephemeral_state(turn_id);
                return Err(error_msg);
            }
        }

        // Claude may emit an in-stream error while still exiting with code 0.
        // In that case we must not mark the turn as completed successfully.
        if let Some(stream_error) = stream_runtime_error {
            let error_msg = if !error_output.trim().is_empty() {
                let stderr_text = error_output.trim();
                format!("{}\n{}", stream_error, stderr_text)
            } else {
                stream_error
            };
            log::error!("Claude stream reported runtime error: {}", error_msg);
            self.emit_pending_ask_user_question_resume_failure(turn_id, &error_msg);
            if Self::is_prompt_too_long_error(&error_msg) {
                self.clear_turn_ephemeral_state(turn_id);
                return Err(Self::mark_retryable_prompt_too_long_error(&error_msg));
            }
            if !stream_error_event_emitted {
                self.emit_turn_event(
                    turn_id,
                    EngineEvent::TurnError {
                        workspace_id: self.workspace_id.clone(),
                        error: error_msg.clone(),
                        code: None,
                    },
                );
            }
            self.clear_turn_ephemeral_state(turn_id);
            return Err(error_msg);
        }

        if !saw_valid_stream_event {
            let diagnostic_sample =
                Self::stream_diagnostic_sample_snapshot(&stream_diagnostic_sample);
            let error_msg = self.emit_stream_no_valid_event_error(turn_id, &diagnostic_sample);
            self.emit_pending_ask_user_question_resume_failure(turn_id, &error_msg);
            self.clear_turn_ephemeral_state(turn_id);
            return Err(error_msg);
        }

        // A pending-task idle max-wait force-kill must never look identical to
        // an ordinary empty-but-successful turn.
        if settled_by_pending_task_max_wait && response_text.trim().is_empty() {
            response_text = format!(
                "[A background subagent did not report back within {:?} and was abandoned. Its work may be incomplete or lost.]",
                CLAUDE_BG_TASK_MAX_WAIT
            );
        }

        // Emit turn completed
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnCompleted {
                workspace_id: self.workspace_id.clone(),
                result: Some(serde_json::json!({
                    "text": response_text,
                })),
            },
        );

        self.clear_turn_ephemeral_state(turn_id);
        Ok(response_text)
    }
}
