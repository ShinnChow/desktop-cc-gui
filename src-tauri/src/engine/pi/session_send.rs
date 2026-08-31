use super::*;

// ponytail: pi's NDJSON stream has no terminal "result" event, so turn end is
// detected by stdout EOF. A lingering grandchild (e.g. a bash tool daemon)
// that inherited the stdout pipe would keep the write end open and block EOF
// forever — the claude.rs "turn stuck generating" root cause. Poll child exit
// and stop reading after a grace. Ceiling: the orphan itself is not killed
// (pi, like kimi/grok, spawns without setpgid, so there is no process group to
// killpg); upgrade path = pre_exec setpgid + group kill if this ever bites.
pub(crate) const PI_STDOUT_EXIT_POLL: Duration = Duration::from_millis(250);

pub(crate) const PI_POST_EXIT_GRACE: Duration = Duration::from_secs(5);

pub(crate) const PI_STDERR_JOIN_TIMEOUT: Duration = Duration::from_secs(5);

impl PiSession {
    pub(crate) fn build_command(&self, params: &SendMessageParams) -> Result<Command, String> {
        let bin = self.resolve_bin_path();

        let mut cmd = crate::backend::app_server::build_command_for_binary(&bin);
        cmd.current_dir(&self.workspace_path);
        // Custom args go first so the protocol flags below (--print/--mode/--session-id)
        // always win over user configuration in last-wins CLI parsing.
        if let Some(args) = self.custom_args.as_ref() {
            for arg in args.split_whitespace() {
                cmd.arg(arg);
            }
        }
        cmd.arg("--print");
        cmd.arg("--mode");
        cmd.arg("json");

        if let Some(model) = resolve_model_flag(params.model.as_deref()) {
            cmd.arg("--model");
            cmd.arg(model);
        }

        if params.continue_session {
            if let Some(session_id) = params
                .session_id
                .as_ref()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .filter(|value| is_valid_pi_session_id_arg(value))
            {
                cmd.arg("--session-id");
                cmd.arg(session_id);
            }
        }

        if let Some(thinking) = resolve_thinking_flag(params.effort.as_deref()) {
            cmd.arg("--thinking");
            cmd.arg(thinking);
        }

        let image_files = crate::engine::cli_image_input::resolve_existing_image_files(
            params.images.as_deref(),
            &self.workspace_path,
        )?;
        // Pi print mode natively attaches `@file` arguments as image content
        // blocks (deterministic, processed by pi's file processor); keep the
        // prompt itself free of any injected marker or read-tool instruction.
        // `@<path>` reference tokens embedded in the prompt text get the same
        // transport: pi's argv parser treats ANY arg starting with `@` as a
        // file arg, and the whole prompt is one argv element, so a prompt
        // starting with `@` would otherwise turn the entire message into one
        // fake file path and exit(1) with "File not found".
        let mut at_args = crate::engine::cli_image_input::pi_image_file_args(&image_files);
        let extraction = extract_at_file_references(&params.text, &self.workspace_path);
        for reference_arg in extraction.file_args {
            if !at_args.contains(&reference_arg) {
                at_args.push(reference_arg);
            }
        }
        for at_arg in at_args {
            cmd.arg(at_arg);
        }
        let prompt_text = extraction.text;
        // Positional prompt; avoid a leading '-' being parsed as a flag and a
        // leading '@' (unresolvable reference token) being parsed as a file arg.
        let safe_text = if prompt_text.starts_with('-') || prompt_text.starts_with('@') {
            format!(" {prompt_text}")
        } else {
            prompt_text
        };
        cmd.arg(&safe_text);

        if let Some(home) = self.home_dir.as_ref() {
            cmd.env("PI_CODING_AGENT_DIR", home);
            // Sessions default under agent_dir/sessions; keep home aligned.
            cmd.env("HOME", home);
        }

        cmd.stdin(Stdio::null());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        Ok(cmd)
    }

    pub async fn send_message(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        match self.try_send_message_rpc(&params, turn_id).await {
            Ok(text) => return Ok(text),
            Err(PiRpcSendError::Fallback(reason)) => {
                log::warn!(
                    "[pi/send] turn={} rpc unavailable, falling back to print-json: {}",
                    turn_id,
                    reason
                );
                // 释放本次发送实际占用的 resident。key 必须与
                // try_send_message_rpc 的 scratch_key 同源：session_id=None /
                // 非法 id 时 resident 在 scratch:{turn_id} 槽，旧逻辑只 drop
                // session:{id} 会让新会话 resident 泄漏。
                let resident_key = pi_resident_map_key(params.session_id.as_deref(), turn_id);
                self.drop_resident_by_key(&resident_key).await;
            }
            Err(PiRpcSendError::Failed(error)) => {
                self.emit_error(turn_id, error.clone());
                return Err(error);
            }
            Err(PiRpcSendError::Settled(error)) => {
                // 终态已随 run 结算发出（turn timeout 路径），禁止重发。
                return Err(error);
            }
        }
        // print-json fallback 是 spawn-per-turn：同会话并发进程会交叉写同一
        // session JSONL。融合（fusion）在矩阵升 supported 后可能打到这条
        // 路径——此时必须拒绝而不是假装 steer，让消息留在队列里。
        // 互斥粒度是「同一 session」而不是全 workspace：不同 session / 新会话
        // 各自写不同 JSONL，必须允许并行。
        {
            let print_json_busy = {
                let active = self.active_processes.lock().await;
                print_json_fallback_busy(
                    active.values().map(|process| process.session_id.as_deref()),
                    params.session_id.as_deref(),
                )
            };
            // session_id=None 的新发送没有可对账的本会话 resident（scratch 槽
            // 刚在上方释放），无需查 rpc run；scratch:commands 是树/fork 面板
            // 共享槽，与本次发送无关。
            let rpc_busy = match params.session_id.as_deref() {
                Some(session_id) => self.rpc_has_active_run_for(Some(session_id)).await,
                None => false,
            };
            if print_json_busy || rpc_busy {
                let error = "PI session is busy (rpc unavailable, print-json fallback cannot steer); the message stays queued.".to_string();
                self.emit_error(turn_id, error.clone());
                return Err(error);
            }
        }
        self.send_message_print_json(params, turn_id).await
    }

    pub(crate) async fn send_message_print_json(
        &self,
        params: SendMessageParams,
        turn_id: &str,
    ) -> Result<String, String> {
        let turn_started_at = std::time::Instant::now();
        let requested_model = params
            .model
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("<auto>");
        log::info!(
            "[pi/send] turn={} workspace={} model={} continue_session={}",
            turn_id,
            self.workspace_id,
            requested_model,
            params.continue_session,
        );

        let mut command = match self.build_command(&params) {
            Ok(command) => command,
            Err(error) => {
                let error_msg = format!("Failed to build pi command: {error}");
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let error_msg = format!("Failed to spawn pi: {error}");
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let spawn_ms = turn_started_at.elapsed().as_millis();

        let stdout = match child.stdout.take() {
            Some(stdout) => stdout,
            None => {
                let error_msg = "Failed to capture stdout".to_string();
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };
        let stderr = match child.stderr.take() {
            Some(stderr) => stderr,
            None => {
                let error_msg = "Failed to capture stderr".to_string();
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        };

        {
            let mut active = self.active_processes.lock().await;
            active.insert(
                turn_id.to_string(),
                ActivePiChildProcess::new(child, params.session_id.clone()),
            );
        }

        self.emit_turn_event(
            turn_id,
            EngineEvent::SessionStarted {
                workspace_id: self.workspace_id.clone(),
                session_id: "pending".to_string(),
                engine: EngineType::Pi,
                turn_id: Some(turn_id.to_string()),
            },
        );
        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnStarted {
                workspace_id: self.workspace_id.clone(),
                turn_id: turn_id.to_string(),
            },
        );

        let stderr_reader = BufReader::new(stderr);
        let stderr_task = tokio::spawn(async move {
            let mut lines = stderr_reader.lines();
            let mut text = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                text.push_str(&line);
                text.push('\n');
            }
            text
        });

        let mut response_text = String::new();
        let mut authoritative_response_text: Option<String> = None;
        let mut saw_tool_activity = false;
        let mut tool_names_by_id: HashMap<String, String> = HashMap::new();
        let mut tool_inputs_by_id: HashMap<String, Option<Value>> = HashMap::new();
        let mut error_output = String::new();
        let mut session_started_emitted = false;
        let mut new_session_id: Option<String> = None;
        let mut stream_error: Option<String> = None;
        let mut first_stdout_line_ms: Option<u128> = None;
        let mut stdout_line_count: usize = 0;

        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        let mut child_exited_at: Option<std::time::Instant> = None;

        loop {
            let line = tokio::select! {
                line = lines.next_line() => match line {
                    Ok(Some(line)) => line,
                    Ok(None) => break,
                    Err(error) => {
                        // A read error is not EOF: keep the diagnostic so the
                        // turn settles as failed instead of silently succeeding.
                        if !error_output.is_empty() {
                            error_output.push('\n');
                        }
                        error_output.push_str(&format!("[pi stdout read error] {error}"));
                        break;
                    }
                },
                _ = tokio::time::sleep(PI_STDOUT_EXIT_POLL) => {
                    if child_exited_at.is_none() {
                        let mut active = self.active_processes.lock().await;
                        match active.get_mut(turn_id) {
                            Some(process) => {
                                if matches!(process.child.try_wait(), Ok(Some(_))) {
                                    child_exited_at = Some(std::time::Instant::now());
                                }
                            }
                            // Removed externally (interrupt): stop reading; the
                            // killer owns the child handle from here.
                            None => break,
                        }
                    }
                    if child_exited_at.is_some_and(|at| at.elapsed() >= PI_POST_EXIT_GRACE) {
                        log::warn!(
                            "[pi/send] turn={} stdout EOF grace elapsed after child exit; stop reading",
                            turn_id
                        );
                        break;
                    }
                    continue;
                }
            };
            let line = line.trim().to_string();
            if line.is_empty() {
                continue;
            }
            stdout_line_count += 1;
            if first_stdout_line_ms.is_none() {
                first_stdout_line_ms = Some(turn_started_at.elapsed().as_millis());
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(event) => match parse_pi_stream_line(&event) {
                    PiStreamLine::SessionId(session_id) => {
                        if !session_started_emitted {
                            session_started_emitted = true;
                            new_session_id = Some(session_id.clone());
                            self.set_session_id(Some(session_id.clone())).await;
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::SessionStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    session_id,
                                    engine: EngineType::Pi,
                                    turn_id: Some(turn_id.to_string()),
                                },
                            );
                        }
                    }
                    PiStreamLine::TextDelta(delta) => {
                        response_text.push_str(&delta);
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::TextDelta {
                                workspace_id: self.workspace_id.clone(),
                                text: delta,
                            },
                        );
                    }
                    PiStreamLine::AssistantSnapshot(text) => {
                        authoritative_response_text = Some(text);
                    }
                    PiStreamLine::ThinkingDelta(delta) => {
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::ReasoningDelta {
                                workspace_id: self.workspace_id.clone(),
                                text: delta,
                            },
                        );
                    }
                    PiStreamLine::ToolStart {
                        tool_id,
                        tool_name,
                        args,
                    } => {
                        saw_tool_activity = true;
                        tool_names_by_id.insert(tool_id.clone(), tool_name.clone());
                        tool_inputs_by_id.insert(tool_id.clone(), args.clone());
                        if is_pi_background_task_tool(&tool_name) {
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::BackgroundTaskStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    tool_id,
                                    tool_name,
                                    input: args,
                                },
                            );
                        } else {
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::ToolStarted {
                                    workspace_id: self.workspace_id.clone(),
                                    tool_id,
                                    tool_name,
                                    input: args,
                                },
                            );
                        }
                    }
                    PiStreamLine::ToolEnd {
                        tool_id,
                        content,
                        is_error,
                    } => {
                        saw_tool_activity = true;
                        let tool_name = tool_names_by_id.get(&tool_id).cloned();
                        let receipt_task = if tool_name
                            .as_deref()
                            .map(is_pi_background_task_tool)
                            .unwrap_or(false)
                            && !is_error
                        {
                            parse_pi_background_task_receipt(event.get("result"))
                        } else {
                            None
                        };
                        if let Some(task) = receipt_task {
                            log_pi_background_task_failure(
                                params.model.as_deref(),
                                "print-json",
                                &task,
                                !response_text.trim().is_empty(),
                                saw_tool_activity,
                            );
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::BackgroundTaskUpdated {
                                    workspace_id: self.workspace_id.clone(),
                                    tool_id: Some(tool_id),
                                    task,
                                    source: "receipt".to_string(),
                                },
                            );
                            continue;
                        }
                        let wrapped_output = match tool_inputs_by_id.get(&tool_id).cloned() {
                            Some(Some(input_value)) => Some(json!({
                                "_input": input_value,
                                "_output": content,
                            })),
                            _ => Some(Value::String(content.clone())),
                        };
                        self.emit_turn_event(
                            turn_id,
                            EngineEvent::ToolCompleted {
                                workspace_id: self.workspace_id.clone(),
                                tool_id,
                                tool_name,
                                output: wrapped_output,
                                error: is_error.then_some(content),
                            },
                        );
                    }
                    PiStreamLine::BackgroundTaskNotification { details, content } => {
                        saw_tool_activity = true;
                        if let Some(task) = parse_pi_background_task_notification(details, &content)
                        {
                            log_pi_background_task_failure(
                                params.model.as_deref(),
                                "print-json",
                                &task,
                                !response_text.trim().is_empty(),
                                saw_tool_activity,
                            );
                            self.emit_turn_event(
                                turn_id,
                                EngineEvent::BackgroundTaskUpdated {
                                    workspace_id: self.workspace_id.clone(),
                                    tool_id: None,
                                    task,
                                    source: "notification".to_string(),
                                },
                            );
                        }
                    }
                    PiStreamLine::AssistantError(error) => {
                        stream_error = Some(error);
                    }
                    PiStreamLine::TurnStart
                    | PiStreamLine::TurnEnd
                    | PiStreamLine::Usage(_)
                    | PiStreamLine::Other => {}
                },
                Err(_) => {
                    error_output.push_str(&line);
                    error_output.push('\n');
                }
            }
        }

        if let Some(text) = authoritative_response_text
            .as_deref()
            .filter(|text| !text.trim().is_empty())
        {
            response_text = text.to_string();
        }
        let stdout_eof_ms = turn_started_at.elapsed().as_millis();
        let mut child = {
            let mut active = self.active_processes.lock().await;
            active.remove(turn_id).map(ActivePiChildProcess::into_child)
        };
        let status = if let Some(mut process) = child.take() {
            match tokio::time::timeout(PI_POST_EXIT_GRACE, process.wait()).await {
                Ok(result) => result.ok(),
                Err(_) => {
                    log::warn!("[pi/send] turn={} child wait timed out; killing", turn_id);
                    let _ = process.start_kill();
                    None
                }
            }
        } else {
            None
        };
        let stderr_text = match tokio::time::timeout(PI_STDERR_JOIN_TIMEOUT, stderr_task).await {
            Ok(joined) => joined.unwrap_or_default(),
            Err(_) => {
                log::warn!(
                    "[pi/send] turn={} stderr reader did not finish within timeout; abandoning",
                    turn_id
                );
                String::new()
            }
        };
        if !stderr_text.trim().is_empty() {
            error_output.push_str(&stderr_text);
        }
        let completed_ms = turn_started_at.elapsed().as_millis();
        let status_success = status.as_ref().is_some_and(|value| value.success());
        log::info!(
            "[pi/send][timing] turn={} spawn_ms={} first_stdout_line_ms={:?} stdout_eof_ms={} completed_ms={} stdout_lines={} status_success={} response_chars={}",
            turn_id,
            spawn_ms,
            first_stdout_line_ms,
            stdout_eof_ms,
            completed_ms,
            stdout_line_count,
            status_success,
            response_text.chars().count(),
        );

        let was_interrupted = self.interrupted_turns.lock().await.remove(turn_id);
        if let Some(error) = stream_error {
            log_pi_failure_envelope(
                params.model.as_deref(),
                "print-json",
                "foreground",
                &error,
                None,
                !response_text.trim().is_empty(),
                saw_tool_activity,
            );
            self.emit_error(turn_id, error.clone());
            return Err(error);
        }
        if let Some(status) = status {
            if !status.success() {
                let error_msg = if was_interrupted {
                    "Session stopped.".to_string()
                } else if !error_output.trim().is_empty() {
                    error_output.trim().to_string()
                } else {
                    format!("PI exited with status: {status}")
                };
                self.emit_error(turn_id, error_msg.clone());
                return Err(error_msg);
            }
        } else if was_interrupted {
            let error_msg = "Session stopped.".to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }

        if response_text.trim().is_empty() && !error_output.trim().is_empty() && !saw_tool_activity
        {
            let error_msg = error_output.trim().to_string();
            self.emit_error(turn_id, error_msg.clone());
            return Err(error_msg);
        }

        if response_text.trim().is_empty() && !saw_tool_activity {
            let diagnostic = "PI exited without assistant output.".to_string();
            self.emit_error(turn_id, diagnostic.clone());
            return Err(diagnostic);
        }

        if let Some(session_id) = new_session_id {
            self.set_session_id(Some(session_id)).await;
        }

        self.emit_turn_event(
            turn_id,
            EngineEvent::TurnCompleted {
                workspace_id: self.workspace_id.clone(),
                result: Some(json!({
                    "text": response_text,
                })),
            },
        );

        Ok(response_text)
    }
}
