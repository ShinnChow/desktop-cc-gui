use super::*;

impl DaemonState {
    pub(crate) async fn engine_send_message(
        &self,
        workspace_id: String,
        text: String,
        engine: Option<engine::EngineType>,
        model: Option<String>,
        effort: Option<String>,
        disable_thinking: Option<bool>,
        access_mode: Option<String>,
        images: Option<Vec<String>>,
        continue_session: bool,
        thread_id: Option<String>,
        session_id: Option<String>,
        fork_session_id: Option<String>,
        agent: Option<String>,
        variant: Option<String>,
        provider_profile_id: Option<String>,
        custom_spec_root: Option<String>,
        auto_session: Option<session_management::AutoSessionMetadata>,
        dsh_agent_preset: Option<String>,
    ) -> Result<Value, String> {
        self.sync_engine_configs().await;
        let active_engine = self.get_active_engine().await;
        let effective_engine = engine.unwrap_or(active_engine);
        let settings = self.app_settings.lock().await.clone();
        engine::ensure_engine_enabled(&settings, effective_engine)?;
        let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root);

        match effective_engine {
            engine::EngineType::Codex => {
                engine_send_message_codex(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    thread_id,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    provider_profile_id,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Claude => {
                engine_send_message_claude(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    thread_id,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    provider_profile_id,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::OpenCode => {
                engine_send_message_opencode(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    thread_id,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    provider_profile_id,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Gemini => {
                engine_send_message_gemini(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    thread_id,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    provider_profile_id,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Kimi => {
                engine_send_message_kimi(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    thread_id,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    provider_profile_id,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine @ (engine::EngineType::Pi | engine::EngineType::Omp) => {
                engine_send_message_pi_family(
                    self,
                    engine,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    thread_id,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    provider_profile_id,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Qoder => {
                engine_send_message_qoder(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    thread_id,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    provider_profile_id,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Grok => {
                engine_send_message_grok(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    thread_id,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    provider_profile_id,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Dsh => {
                engine_send_message_dsh(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    thread_id,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    provider_profile_id,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_codex(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let target_thread_id = thread_id
        .ok_or_else(|| "threadId is required for codex engine_send_message".to_string())?;
    state
        .send_user_message(
            workspace_id,
            target_thread_id,
            text,
            model,
            effort,
            access_mode,
            images,
            None,
            None,
            normalized_custom_spec_root,
        )
        .await
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_claude(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id = session_management::resolve_engine_provider_profile_id(
        state.storage_path.as_path(),
        &workspace_id,
        provider_binding_lookup_session_id.as_deref(),
        "claude",
        provider_profile_id.as_deref(),
    )?;
    let provider_launch_profile = engine::claude::resolve_claude_provider_launch_profile(
        effective_provider_profile_id.as_deref(),
    )?;
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let session = state
        .engine_manager
        .get_claude_session_for_provider(
            &workspace_id,
            &workspace_path,
            effective_provider_profile_id.as_deref(),
        )
        .await;
    let has_images = images
        .as_ref()
        .is_some_and(|entries| entries.iter().any(|entry| !entry.trim().is_empty()));
    let normalized_fork_session_id = fork_session_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if fork_session_id.is_some() && normalized_fork_session_id.is_none() {
        return Err("forkSessionId is required for Claude fork session".to_string());
    }
    let continue_session_for_send = continue_session;
    let resolved_session_id = if normalized_fork_session_id.is_some() {
        None
    } else if continue_session {
        if session_id.is_some() {
            session_id
        } else {
            session.get_session_id().await
        }
    } else {
        Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
    };

    let sanitized_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .and_then(|value| {
            if is_valid_claude_model_for_passthrough(value) {
                Some(value.to_string())
            } else {
                None
            }
        });
    if model.is_some() && sanitized_model.is_none() {
        eprintln!(
            "[engine_send_message] dropped invalid claude model={:?}, fallback to default",
            model
        );
    }
    let model_resolution = json!({
        "requestedModel": model.as_deref(),
        "runtimeModel": sanitized_model.as_deref(),
        "willPassToCli": sanitized_model.is_some(),
        "fallbackReason": if model.is_some() && sanitized_model.is_none() {
            Some("invalid-shape")
        } else if model.is_none() {
            Some("not-requested")
        } else {
            None
        },
    });

    let response_session_id = resolved_session_id.clone();
    if let Some(provider_launch_profile) = provider_launch_profile.as_ref() {
        let binding_session_id = response_session_id
            .as_deref()
            .or(provider_binding_lookup_session_id.as_deref())
            .ok_or_else(|| "Claude provider binding requires a session identity".to_string())?;
        session_management::record_engine_provider_binding_core(
            &state.workspaces,
            state.storage_path.as_path(),
            workspace_id.clone(),
            binding_session_id.to_string(),
            "claude".to_string(),
            provider_launch_profile.binding.clone(),
        )
        .await?;
    }
    let params = engine::SendMessageParams {
        text,
        model: sanitized_model,
        effort,
        disable_thinking: disable_thinking.unwrap_or(false),
        access_mode,
        images,
        continue_session: continue_session_for_send,
        session_id: resolved_session_id,
        fork_session_id: normalized_fork_session_id,
        agent: None,
        variant: None,
        collaboration_mode: None,
        custom_spec_root: normalized_custom_spec_root.clone(),
    };

    let turn_id = format!("claude-turn-{}", uuid::Uuid::new_v4());
    let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
    let assistant_item_id = format!("claude-item-{}", uuid::Uuid::new_v4());
    let reasoning_item_id = format!("claude-reasoning-{}", uuid::Uuid::new_v4());

    let mut receiver = session.subscribe();
    let event_sink = state.event_sink.clone();
    let agent_event_bus = state.engine_manager.agent_event_bus();
    let mut current_thread_id = thread_id.clone();
    let assistant_item_id_clone = assistant_item_id.clone();
    let reasoning_item_id_clone = reasoning_item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let mut accumulated_agent_text = String::new();
    let provider_binding_for_forwarder = provider_launch_profile
        .as_ref()
        .map(|profile| profile.binding.clone());
    let provider_binding_storage_path = state.storage_path.clone();
    let provider_binding_workspace_id = workspace_id.clone();
    tokio::spawn(async move {
        let mut post_completion_grace_deadline: Option<tokio::time::Instant> = None;
        loop {
            let recv_result = if let Some(grace_deadline) = post_completion_grace_deadline {
                tokio::time::timeout_at(grace_deadline, receiver.recv()).await
            } else {
                Ok(receiver.recv().await)
            };
            let turn_event = match recv_result {
                Ok(Ok(event)) => event,
                Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => {
                    continue;
                }
                Err(_) => break,
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let is_post_completion_context_usage = post_completion_grace_deadline.is_some()
                && matches!(
                    &turn_event.event,
                    engine::events::EngineEvent::UsageUpdate {
                        context_usage_source,
                        ..
                    } if context_usage_source.as_deref() == Some("context_command")
                );
            let event = turn_event.event;
            agent_event_bus.publish_engine_event(
                engine::EngineType::Claude,
                &current_thread_id,
                None,
                &turn_id_for_forwarder,
                Some(&turn_id_for_forwarder),
                &event,
            );
            let is_terminal = event.is_terminal();
            let is_turn_completed =
                matches!(event, engine::events::EngineEvent::TurnCompleted { .. });
            if let (
                Some(binding),
                engine::events::EngineEvent::SessionStarted {
                    session_id,
                    engine: engine::EngineType::Claude,
                    ..
                },
            ) = (provider_binding_for_forwarder.as_ref(), &event)
            {
                if !session_id.is_empty() && session_id != "pending" {
                    session_management::schedule_engine_provider_binding_record(
                        provider_binding_storage_path.clone(),
                        provider_binding_workspace_id.clone(),
                        session_id.clone(),
                        "claude".to_string(),
                        binding.clone(),
                    );
                }
            }

            if let engine::events::EngineEvent::TextDelta { text, .. } = &event {
                accumulated_agent_text.push_str(text);
            }

            if let engine::events::EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                let completed_text = if accumulated_agent_text.trim().is_empty() {
                    fallback_text
                } else {
                    accumulated_agent_text.clone()
                };
                if !completed_text.trim().is_empty() {
                    event_sink.emit_app_server_event(AppServerEvent {
                        workspace_id: event.workspace_id().to_string(),
                        message: json!({
                            "method": "item/completed",
                            "params": {
                                "threadId": &current_thread_id,
                                "item": {
                                    "id": &assistant_item_id_clone,
                                    "type": "agentMessage",
                                    "text": completed_text,
                                    "status": "completed",
                                }
                            }
                        }),
                    });
                }
            }

            // Frontend compatibility sink: projection happens only after private bus ingress.
            if let Some(payload) =
                engine::events::engine_event_to_app_server_event_with_turn_context(
                    &event,
                    &current_thread_id,
                    engine::events::resolve_claude_realtime_item_id(
                        &event,
                        &assistant_item_id_clone,
                        &reasoning_item_id_clone,
                    ),
                    Some(&turn_id_for_forwarder),
                )
            {
                event_sink.emit_app_server_event(payload);
            }

            if let engine::events::EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty() && session_id != "pending" {
                    match engine {
                        engine::EngineType::Claude => {
                            current_thread_id = format!("claude:{}", session_id);
                        }
                        engine::EngineType::OpenCode => {
                            current_thread_id = format!("opencode:{}", session_id);
                        }
                        engine::EngineType::Gemini => {
                            current_thread_id = format!("gemini:{}", session_id);
                        }
                        engine::EngineType::Kimi => {
                            current_thread_id = format!("kimi:{}", session_id);
                        }
                        engine::EngineType::Pi => {
                            current_thread_id = format!("pi:{}", session_id);
                        }
                        engine::EngineType::Omp => {
                            current_thread_id = format!("omp:{}", session_id);
                        }
                        engine::EngineType::Grok => {
                            current_thread_id = format!("grok:{}", session_id);
                        }
                        engine::EngineType::Dsh => {
                            current_thread_id = format!("dsh:{}", session_id);
                        }
                        engine::EngineType::Qoder => {
                            // Claude runtime 没有 Qoder distribution owner，不能
                            // 在此处伪造会丢失分发信息的 Qoder identity。
                            log::warn!("[claude] ignored unexpected Qoder SessionStarted event");
                        }
                        engine::EngineType::Codex => {}
                    }
                }
            }

            if is_terminal {
                if is_turn_completed {
                    post_completion_grace_deadline = Some(
                        tokio::time::Instant::now()
                            + std::time::Duration::from_millis(
                                CLAUDE_POST_COMPLETION_USAGE_GRACE_MS,
                            ),
                    );
                    continue;
                }
                break;
            }
            if is_post_completion_context_usage {
                break;
            }
        }
    });

    let session_clone = session.clone();
    let turn_id_clone = turn_id.clone();
    let settings_for_send = settings.clone();
    let provider_env = provider_launch_profile.map(|profile| profile.env);
    tokio::spawn(async move {
        let send_result = if has_images {
            session_clone
                .send_message_with_app_settings_and_provider_env(
                    params,
                    &turn_id_clone,
                    Some(&settings_for_send),
                    provider_env.as_ref(),
                )
                .await
        } else {
            session_clone
                .send_message_with_auto_compact_retry_with_launch_context(
                    params,
                    &turn_id_clone,
                    Some(&settings_for_send),
                    provider_env.as_ref(),
                )
                .await
        };
        if let Err(error) = send_result {
            eprintln!("Claude send_message failed: {error}");
        }
    });
    state
        .record_auto_session_metadata_if_present(
            &workspace_id,
            response_session_id.as_deref(),
            auto_session,
            "claude",
        )
        .await;

    Ok(json!({
        "engine": "claude",
        "sessionId": response_session_id.clone(),
        "result": {
            "sessionId": response_session_id,
            "modelResolution": model_resolution.clone(),
            "turn": {
                "id": turn_id,
                "status": "started",
            }
        },
        "modelResolution": model_resolution,
        "turn": {
            "id": turn_id,
            "status": "started",
        }
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_opencode(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id = session_management::resolve_engine_provider_profile_id(
        state.storage_path.as_path(),
        &workspace_id,
        provider_binding_lookup_session_id.as_deref(),
        "opencode",
        provider_profile_id.as_deref(),
    )?;
    let provider_launch_profile =
        engine::opencode_provider_profile::resolve_opencode_provider_launch_profile(
            &workspace_id,
            effective_provider_profile_id.as_deref(),
        )?;
    let session = state
        .engine_manager
        .get_or_create_opencode_session_for_runtime(
            &workspace_id,
            &workspace_path,
            &provider_launch_profile.runtime_key,
            provider_launch_profile.config_content.clone(),
        )
        .await;
    let resolved_session_id = if continue_session {
        if session_id.is_some() {
            session_id
        } else {
            session.get_session_id().await
        }
    } else {
        Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
    };
    let response_session_id = resolved_session_id.clone();
    let sanitized_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .and_then(|value| {
            if is_likely_legacy_claude_model_id(value) {
                None
            } else {
                Some(value.to_string())
            }
        });
    if model.is_some() && sanitized_model.is_none() {
        eprintln!(
            "[engine_send_message] dropped invalid opencode model={:?}, fallback to default",
            model
        );
    }
    // Always pass an explicit --model: a broken default model in
    // the user's opencode.json must not fail GUI turns. Managed
    // providers resolve through the injected `ccgui/<model>` refs.
    let model_for_send = if provider_launch_profile.binding.is_some() {
        sanitized_model
            .or_else(|| provider_launch_profile.default_model.clone())
            .map(|value| engine::opencode_provider_profile::qualify_managed_model_ref(&value))
    } else {
        sanitized_model.or_else(|| Some("opencode/big-pickle".to_string()))
    };
    let params = engine::SendMessageParams {
        text,
        model: model_for_send,
        effort,
        disable_thinking: false,
        access_mode,
        images,
        continue_session,
        session_id: resolved_session_id,
        fork_session_id: None,
        agent,
        variant,
        collaboration_mode: None,
        custom_spec_root: normalized_custom_spec_root.clone(),
    };

    let turn_id = format!("opencode-turn-{}", uuid::Uuid::new_v4());
    let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
    let binding_session_id = response_session_id
        .as_deref()
        .or(provider_binding_lookup_session_id.as_deref())
        .unwrap_or(thread_id.as_str());
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        session_management::record_engine_provider_binding_core(
            &state.workspaces,
            state.storage_path.as_path(),
            workspace_id.clone(),
            binding_session_id.to_string(),
            "opencode".to_string(),
            binding.clone(),
        )
        .await?;
    }
    let item_id = format!("opencode-item-{}", uuid::Uuid::new_v4());

    let mut receiver = session.subscribe();
    let event_sink = state.event_sink.clone();
    let agent_event_bus = state.engine_manager.agent_event_bus();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    tokio::spawn(async move {
        loop {
            let turn_event = match receiver.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    continue;
                }
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let event = turn_event.event;
            agent_event_bus.publish_engine_event(
                engine::EngineType::OpenCode,
                &current_thread_id,
                None,
                &turn_id_for_forwarder,
                Some(&turn_id_for_forwarder),
                &event,
            );
            let is_terminal = event.is_terminal();

            if let Some(payload) =
                engine::events::engine_event_to_app_server_event_with_turn_context(
                    &event,
                    &current_thread_id,
                    &item_id_clone,
                    Some(&turn_id_for_forwarder),
                )
            {
                event_sink.emit_app_server_event(payload);
            }

            if let engine::events::EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty()
                    && session_id != "pending"
                    && matches!(engine, engine::EngineType::OpenCode)
                {
                    current_thread_id = format!("opencode:{}", session_id);
                }
            }

            if is_terminal {
                break;
            }
        }
    });

    let session_clone = session.clone();
    let turn_id_clone = turn_id.clone();
    tokio::spawn(async move {
        if let Err(error) = session_clone.send_message(params, &turn_id_clone).await {
            eprintln!("OpenCode send_message failed: {error}");
            session_clone.emit_error(&turn_id_clone, error);
        }
    });
    state
        .record_auto_session_metadata_if_present(
            &workspace_id,
            response_session_id.as_deref(),
            auto_session,
            "opencode",
        )
        .await;

    Ok(json!({
        "engine": "opencode",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started",
            }
        },
        "turn": {
            "id": turn_id,
            "status": "started",
        }
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_gemini(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let session = state
        .engine_manager
        .get_or_create_gemini_session(&workspace_id, &workspace_path)
        .await?;
    let resolved_session_id = if continue_session {
        if session_id.is_some() {
            session_id
        } else {
            session.get_session_id().await
        }
    } else {
        Some(session_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string()))
    };
    let response_session_id = resolved_session_id.clone();
    let sanitized_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .and_then(|value| {
            if is_likely_foreign_model_for_gemini(value) {
                None
            } else {
                Some(value.to_string())
            }
        });
    if model.is_some() && sanitized_model.is_none() {
        eprintln!(
            "[engine_send_message] dropped invalid gemini model={:?}, fallback to default",
            model
        );
    }

    let params = engine::SendMessageParams {
        text,
        model: sanitized_model,
        effort,
        disable_thinking: false,
        access_mode,
        images,
        continue_session,
        session_id: resolved_session_id,
        fork_session_id: None,
        agent: None,
        variant: None,
        collaboration_mode: None,
        custom_spec_root: normalized_custom_spec_root.clone(),
    };

    let turn_id = format!("gemini-turn-{}", uuid::Uuid::new_v4());
    let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
    let item_id = format!("gemini-item-{}", uuid::Uuid::new_v4());

    let mut receiver = session.subscribe();
    let event_sink = state.event_sink.clone();
    let agent_event_bus = state.engine_manager.agent_event_bus();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let mut accumulated_agent_text = String::new();
    tokio::spawn(async move {
        let mut render_state = GeminiRenderRoutingState::default();
        let mut post_completion_grace_deadline: Option<tokio::time::Instant> = None;
        loop {
            let recv_result = if let Some(grace_deadline) = post_completion_grace_deadline {
                tokio::time::timeout_at(grace_deadline, receiver.recv()).await
            } else {
                Ok(receiver.recv().await)
            };
            let turn_event = match recv_result {
                Ok(Ok(event)) => event,
                Ok(Err(tokio::sync::broadcast::error::RecvError::Closed)) => break,
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => {
                    continue;
                }
                Err(_) => break,
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let event = turn_event.event;
            agent_event_bus.publish_engine_event(
                engine::EngineType::Gemini,
                &current_thread_id,
                None,
                &turn_id_for_forwarder,
                Some(&turn_id_for_forwarder),
                &event,
            );
            let is_terminal = event.is_terminal();
            let render_lane = match &event {
                engine::events::EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                engine::events::EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                engine::events::EngineEvent::ToolStarted { .. }
                | engine::events::EngineEvent::ToolCompleted { .. }
                | engine::events::EngineEvent::ToolInputUpdated { .. }
                | engine::events::EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                _ => GeminiRenderLane::Other,
            };
            let routed_item_id =
                next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

            if let engine::events::EngineEvent::TextDelta { text, .. } = &event {
                render_state.saw_text_delta = true;
                accumulated_agent_text.push_str(text);
            }

            if let engine::events::EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                let completed_text = if accumulated_agent_text.trim().is_empty() {
                    fallback_text
                } else {
                    accumulated_agent_text.clone()
                };
                // Always emit agentMessage item/completed (Claude-parity) so
                // project-memory fusion runs after TextDelta streaming.
                if !completed_text.trim().is_empty() {
                    let completion_item_id =
                        gemini_agent_completion_item_id(&render_state, &item_id_clone);
                    event_sink.emit_app_server_event(AppServerEvent {
                        workspace_id: event.workspace_id().to_string(),
                        message: json!({
                            "method": "item/completed",
                            "params": {
                                "threadId": &current_thread_id,
                                "item": {
                                    "id": completion_item_id,
                                    "type": "agentMessage",
                                    "text": completed_text,
                                    "status": "completed",
                                }
                            }
                        }),
                    });
                }
            }

            if let Some(payload) =
                engine::events::engine_event_to_app_server_event_with_turn_context(
                    &event,
                    &current_thread_id,
                    &routed_item_id,
                    Some(&turn_id_for_forwarder),
                )
            {
                event_sink.emit_app_server_event(payload);
            }

            if let engine::events::EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty()
                    && session_id != "pending"
                    && matches!(engine, engine::EngineType::Gemini)
                {
                    current_thread_id = format!("gemini:{}", session_id);
                }
            }

            if is_terminal {
                if matches!(event, engine::events::EngineEvent::TurnCompleted { .. }) {
                    post_completion_grace_deadline = Some(
                        tokio::time::Instant::now()
                            + std::time::Duration::from_millis(
                                GEMINI_POST_COMPLETION_REASONING_GRACE_MS,
                            ),
                    );
                    continue;
                }
                break;
            }
        }
    });

    let session_clone = session.clone();
    let turn_id_clone = turn_id.clone();
    tokio::spawn(async move {
        if let Err(error) = session_clone.send_message(params, &turn_id_clone).await {
            eprintln!("Gemini send_message failed: {error}");
        }
    });
    state
        .record_auto_session_metadata_if_present(
            &workspace_id,
            response_session_id.as_deref(),
            auto_session,
            "gemini",
        )
        .await;

    Ok(json!({
        "engine": "gemini",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started",
            }
        },
        "turn": {
            "id": turn_id,
            "status": "started",
        }
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_kimi(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id = session_management::resolve_engine_provider_profile_id(
        state.storage_path.as_path(),
        &workspace_id,
        provider_binding_lookup_session_id.as_deref(),
        "kimi",
        provider_profile_id.as_deref(),
    )?;
    let provider_launch_profile =
        engine::kimi_provider_profile::resolve_kimi_provider_launch_profile(
            &workspace_id,
            effective_provider_profile_id.as_deref(),
        )?;
    let session = state
        .engine_manager
        .get_or_create_kimi_session_for_runtime(
            &workspace_id,
            &workspace_path,
            &provider_launch_profile.runtime_key,
            provider_launch_profile.home_dir.as_deref(),
        )
        .await;
    let resolved_session_id = resolve_kimi_session_id_for_engine_send(
        continue_session,
        session_id,
        session.get_session_id().await,
    );
    let response_session_id = resolved_session_id.clone();
    let sanitized_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    let params = engine::SendMessageParams {
        text,
        model: sanitized_model,
        effort,
        disable_thinking: false,
        access_mode,
        images,
        continue_session,
        session_id: resolved_session_id,
        fork_session_id: None,
        agent: None,
        variant: None,
        collaboration_mode: None,
        custom_spec_root: normalized_custom_spec_root.clone(),
    };

    let turn_id = format!("kimi-turn-{}", uuid::Uuid::new_v4());
    let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
    let binding_session_id = response_session_id
        .as_deref()
        .or(provider_binding_lookup_session_id.as_deref())
        .unwrap_or(thread_id.as_str());
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        session_management::record_engine_provider_binding_core(
            &state.workspaces,
            state.storage_path.as_path(),
            workspace_id.clone(),
            binding_session_id.to_string(),
            "kimi".to_string(),
            binding.clone(),
        )
        .await?;
    }
    let item_id = format!("kimi-item-{}", uuid::Uuid::new_v4());

    let mut receiver = session.subscribe();
    let event_sink = state.event_sink.clone();
    let agent_event_bus = state.engine_manager.agent_event_bus();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let mut accumulated_agent_text = String::new();
    let provider_binding_for_forwarder = provider_launch_profile.binding.clone();
    let provider_binding_storage_path = state.storage_path.clone();
    let provider_binding_workspace_id = workspace_id.clone();
    tokio::spawn(async move {
        let mut render_state = GeminiRenderRoutingState::default();
        loop {
            let turn_event = match receiver.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    continue;
                }
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let event = turn_event.event;
            agent_event_bus.publish_engine_event(
                engine::EngineType::Kimi,
                &current_thread_id,
                None,
                &turn_id_for_forwarder,
                Some(&turn_id_for_forwarder),
                &event,
            );
            let is_terminal = event.is_terminal();
            if let (
                Some(binding),
                engine::events::EngineEvent::SessionStarted {
                    session_id,
                    engine: engine::EngineType::Kimi,
                    ..
                },
            ) = (provider_binding_for_forwarder.as_ref(), &event)
            {
                if !session_id.is_empty() && session_id != "pending" {
                    session_management::schedule_engine_provider_binding_record(
                        provider_binding_storage_path.clone(),
                        provider_binding_workspace_id.clone(),
                        session_id.clone(),
                        "kimi".to_string(),
                        binding.clone(),
                    );
                }
            }
            let render_lane = match &event {
                engine::events::EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                engine::events::EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                engine::events::EngineEvent::ToolStarted { .. }
                | engine::events::EngineEvent::ToolCompleted { .. }
                | engine::events::EngineEvent::ToolInputUpdated { .. }
                | engine::events::EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                _ => GeminiRenderLane::Other,
            };
            let routed_item_id =
                next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

            if let engine::events::EngineEvent::TextDelta { text, .. } = &event {
                render_state.saw_text_delta = true;
                accumulated_agent_text.push_str(text);
            }

            if let engine::events::EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                let completed_text = if accumulated_agent_text.trim().is_empty() {
                    fallback_text
                } else {
                    accumulated_agent_text.clone()
                };
                // Always emit agentMessage item/completed (Claude-parity) so
                // project-memory fusion runs after TextDelta streaming.
                if !completed_text.trim().is_empty() {
                    let completion_item_id =
                        gemini_agent_completion_item_id(&render_state, &item_id_clone);
                    event_sink.emit_app_server_event(AppServerEvent {
                        workspace_id: event.workspace_id().to_string(),
                        message: json!({
                            "method": "item/completed",
                            "params": {
                                "threadId": &current_thread_id,
                                "item": {
                                    "id": completion_item_id,
                                    "type": "agentMessage",
                                    "text": completed_text,
                                    "status": "completed",
                                }
                            }
                        }),
                    });
                }
            }

            if let Some(payload) =
                engine::events::engine_event_to_app_server_event_with_turn_context(
                    &event,
                    &current_thread_id,
                    &routed_item_id,
                    Some(&turn_id_for_forwarder),
                )
            {
                event_sink.emit_app_server_event(payload);
            }

            if let engine::events::EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty()
                    && session_id != "pending"
                    && matches!(engine, engine::EngineType::Kimi)
                {
                    current_thread_id = format!("kimi:{}", session_id);
                }
            }

            if is_terminal {
                break;
            }
        }
    });

    let session_clone = session.clone();
    let turn_id_clone = turn_id.clone();
    tokio::spawn(async move {
        if let Err(error) = session_clone.send_message(params, &turn_id_clone).await {
            eprintln!("Kimi send_message failed: {error}");
        }
    });
    state
        .record_auto_session_metadata_if_present(
            &workspace_id,
            response_session_id.as_deref(),
            auto_session,
            "kimi",
        )
        .await;

    Ok(json!({
        "engine": "kimi",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started",
            }
        },
        "turn": {
            "id": turn_id,
            "status": "started",
        }
    }))
}

/// pi 族共享发送路径（add-omp-engine，与 app 侧 commands_send.rs 同形同步）。
#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_pi_family(
    state: &DaemonState,
    engine: engine::EngineType,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id = session_management::resolve_engine_provider_profile_id(
        state.storage_path.as_path(),
        &workspace_id,
        provider_binding_lookup_session_id.as_deref(),
        engine.icon(),
        provider_profile_id.as_deref(),
    )?;
    let provider_launch_profile =
        engine::pi_provider_profile::resolve_pi_family_provider_launch_profile(
            engine,
            &workspace_id,
            effective_provider_profile_id.as_deref(),
            None,
        )?;
    let session = state
        .engine_manager
        .get_or_create_pi_family_session_for_runtime(
            engine,
            &workspace_id,
            &workspace_path,
            &provider_launch_profile.runtime_key,
            provider_launch_profile.home_dir.as_deref(),
        )
        .await;
    let resolved_session_id = resolve_pi_session_id_for_engine_send(
        continue_session,
        session_id,
        session.get_session_id().await,
    );
    let response_session_id = resolved_session_id.clone();
    let sanitized_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    let params = engine::SendMessageParams {
        text,
        model: sanitized_model,
        effort,
        disable_thinking: false,
        access_mode,
        images,
        continue_session,
        session_id: resolved_session_id,
        fork_session_id: None,
        agent: None,
        variant: None,
        collaboration_mode: None,
        custom_spec_root: normalized_custom_spec_root.clone(),
    };

    let turn_id = format!("{}-turn-{}", engine.icon(), uuid::Uuid::new_v4());
    let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
    let binding_session_id = response_session_id
        .as_deref()
        .or(provider_binding_lookup_session_id.as_deref())
        .unwrap_or(thread_id.as_str());
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        session_management::record_engine_provider_binding_core(
            &state.workspaces,
            state.storage_path.as_path(),
            workspace_id.clone(),
            binding_session_id.to_string(),
            engine.icon().to_string(),
            binding.clone(),
        )
        .await?;
    }
    let item_id = format!("{}-item-{}", engine.icon(), uuid::Uuid::new_v4());

    let mut receiver = session.subscribe();
    let event_sink = state.event_sink.clone();
    let agent_event_bus = state.engine_manager.agent_event_bus();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let engine_for_forwarder = engine;
    let mut accumulated_agent_text = String::new();
    let provider_binding_for_forwarder = provider_launch_profile.binding.clone();
    let provider_binding_storage_path = state.storage_path.clone();
    let provider_binding_workspace_id = workspace_id.clone();
    tokio::spawn(async move {
        let mut render_state = GeminiRenderRoutingState::default();
        let mut pending_background_tasks = HashSet::<String>::new();
        let mut background_task_aliases = HashMap::<String, String>::new();
        let mut active_external_wakeup_turn_ids = HashSet::<String>::new();
        let mut pending_external_wakeup = false;
        // pump 在 agent_settled 时发出的生命周期标记：本 run 彻底
        // settle（无重试/无排队 continuation）。break 必须等它——
        // 第一个原生 turn 的 TurnCompleted 之后 run 内通常还有
        // 后续原生 turn（普通多轮工具对话的常态）。
        let mut primary_run_settled = false;
        let mut active_forwarded_turn_id = turn_id_for_forwarder.clone();
        loop {
            let turn_event = match receiver.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    continue;
                }
            };
            let is_external_turn = turn_event
                .turn_id
                .starts_with(&format!("{}-external-", engine_for_forwarder.icon()));
            let is_known_external_wakeup =
                active_external_wakeup_turn_ids.contains(&turn_event.turn_id);
            let is_external_wakeup = is_pi_family_external_wakeup_allowed(
                engine_for_forwarder,
                &turn_event.turn_id,
                &turn_id_for_forwarder,
                &turn_event.event,
                !pending_background_tasks.is_empty(),
                pending_external_wakeup,
                is_known_external_wakeup,
            );
            // run 归属判定（run_owner 戳）：只转发本 send 自己
            // run 的原生 turn（primary / {primary}:t{n} 派生）与
            // 本 send id 被绑定进其他 run 的 steer turn。别的 send
            // 的 run（含其唤醒/派生 turn）一律拒绝——放行会串台到
            // 本 send 的线程，前端单 activeTurnId 结算守卫错配后
            // 永久丢结算（2026-08-30 响应中卡死实证）。
            let is_my_run_turn = is_pi_forwardable_send_turn(
                &turn_event.run_owner,
                &turn_event.turn_id,
                &turn_id_for_forwarder,
            );
            let is_lifecycle_marker = is_pi_agent_settled_marker(&turn_event.event);
            if turn_event.turn_id != turn_id_for_forwarder
                && !is_my_run_turn
                && !is_external_wakeup
                && !is_lifecycle_marker
            {
                continue;
            }
            // `pending_external_wakeup` 只在 run settle 标记处复位：
            // 唤醒 run 自身也是多原生 turn 的（实测 06:40 会话——
            // 「汇报如下」turn 拉了 bg_logs 后，最终报告在同一个
            // run 的下一个原生 turn）。若在首个外部 turn 终态就
            // 复位，同 run 的后续 turn 会因「无 pending 任务 /
            // 未登记」被门控丢弃，尾部最终报告丢失。
            if is_external_wakeup && !is_known_external_wakeup {
                active_external_wakeup_turn_ids.insert(turn_event.turn_id.clone());
            }

            let event = turn_event.event;
            // Every accepted event keeps the native PI turn id. This
            // includes an attached follow-up user turn; collapsing it
            // to the primary id merges the second realtime segment into
            // the first one and makes the history/realtime anchors drift.
            let event_turn_id = turn_event.turn_id.as_str();
            if let engine::events::EngineEvent::ToolStarted { .. } = &event {
                accumulated_agent_text.clear();
            }
            if event_turn_id != active_forwarded_turn_id {
                active_forwarded_turn_id = event_turn_id.to_string();
                // Each PI follow-up is a distinct assistant turn. Keep the
                // monotonic item counters so its text/reasoning cannot
                // upsert into the previous follow-up bubble, while resetting
                // only the lane-local state for the new turn.
                render_state.last_render_lane = GeminiRenderLane::Other;
                render_state.active_text_item_id = None;
                render_state.active_reasoning_item_id = None;
                render_state.saw_text_delta = false;
                accumulated_agent_text.clear();
            }
            match &event {
                engine::events::EngineEvent::TurnStarted { .. } => {
                    // 新 run / 新原生 turn 开始：解除 settled 标记，
                    // 后台任务唤醒会紧跟 settled 之后开新 run。
                    primary_run_settled = false;
                }
                engine::events::EngineEvent::Raw { .. } if is_pi_agent_settled_marker(&event) => {
                    primary_run_settled = true;
                    // run 彻底 settle：唤醒窗口关闭。若此后还有
                    // 后台任务未回收，下一个唤醒 run 的通知事件会
                    // 重新置 true。
                    pending_external_wakeup = false;
                }
                engine::events::EngineEvent::BackgroundTaskStarted { tool_id, .. } => {
                    pending_background_tasks.insert(tool_id.clone());
                }
                engine::events::EngineEvent::BackgroundTaskUpdated {
                    tool_id,
                    task,
                    source,
                    ..
                } => {
                    if source == "notification" {
                        pending_external_wakeup = true;
                    }
                    let task_id = task.get("id").and_then(Value::as_str);
                    let status = task
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .trim()
                        .to_ascii_lowercase();
                    let is_terminal_background_status = matches!(
                        status.as_str(),
                        "completed" | "failed" | "killed" | "cancelled" | "canceled"
                    );
                    if is_terminal_background_status {
                        if let Some(tool_id) = tool_id {
                            pending_background_tasks.remove(tool_id);
                        }
                        if let Some(task_id) = task_id {
                            pending_background_tasks.remove(task_id);
                            if let Some(tool_id) = background_task_aliases.remove(task_id) {
                                pending_background_tasks.remove(&tool_id);
                            }
                        }
                    } else if let Some(task_id) = task_id {
                        // receipt 通常同时带 tool ID 与后台 task ID；
                        // 后续 notification 可能只有 task ID。切换到
                        // canonical task ID，并保留别名用于终态回收。
                        if let Some(tool_id) = tool_id {
                            pending_background_tasks.remove(tool_id);
                            background_task_aliases.insert(task_id.to_string(), tool_id.clone());
                        }
                        pending_background_tasks.insert(task_id.to_string());
                    }
                }
                _ => {}
            }
            agent_event_bus.publish_engine_event(
                engine_for_forwarder,
                &current_thread_id,
                None,
                event_turn_id,
                Some(event_turn_id),
                &event,
            );
            let is_terminal = event.is_terminal();
            if let (
                Some(binding),
                engine::events::EngineEvent::SessionStarted {
                    session_id,
                    engine: event_engine,
                    ..
                },
            ) = (provider_binding_for_forwarder.as_ref(), &event)
            {
                // 与原 `engine: EngineType::Pi` 字面 pattern 同语义：只认本
                // send 引擎的 SessionStarted（防跨引擎串绑）。
                if *event_engine == engine_for_forwarder
                    && !session_id.is_empty()
                    && session_id != "pending"
                {
                    session_management::schedule_engine_provider_binding_record(
                        provider_binding_storage_path.clone(),
                        provider_binding_workspace_id.clone(),
                        session_id.clone(),
                        engine_for_forwarder.icon().to_string(),
                        binding.clone(),
                    );
                }
            }
            let render_lane = match &event {
                engine::events::EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                engine::events::EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                engine::events::EngineEvent::ToolStarted { .. }
                | engine::events::EngineEvent::ToolCompleted { .. }
                | engine::events::EngineEvent::ToolInputUpdated { .. }
                | engine::events::EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                _ => GeminiRenderLane::Other,
            };
            let routed_item_id =
                next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

            if let engine::events::EngineEvent::TextDelta { text, .. } = &event {
                render_state.saw_text_delta = true;
                accumulated_agent_text.push_str(text);
            }

            if let engine::events::EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                // PI `TurnCompleted.result.text` is sourced from the
                // authoritative `message_end` snapshot. Streamed deltas
                // can be a prefix when the final follow-up turn races the
                // forwarder, so never let the accumulator overwrite it.
                // 本 turn 流出过正文 ⇒ 只落最后一段(可能为空);
                // 纯工具 turn 回退 result 文本(同样为空)。
                let completed_text = if render_state.saw_text_delta {
                    accumulated_agent_text.clone()
                } else {
                    fallback_text
                };
                if !completed_text.trim().is_empty() {
                    // 完成稿必须 upsert 进已流式的文本气泡：turn
                    // 以工具收尾时 Tool lane 会清空
                    // active_text_item_id，凭空造新 id 会把同一段
                    // 正文渲染第二遍（重复叙述）。回退到最后文本段。
                    let completion_item_id =
                        gemini_agent_completion_item_id(&render_state, &item_id_clone);
                    event_sink.emit_app_server_event(AppServerEvent {
                        workspace_id: event.workspace_id().to_string(),
                        message: json!({
                            "method": "item/completed",
                            "params": {
                                "threadId": &current_thread_id,
                                "turnId": event_turn_id,
                                "item": {
                                    "id": completion_item_id,
                                    "type": "agentMessage",
                                    "text": completed_text,
                                    "status": "completed",
                                }
                            }
                        }),
                    });
                }
            }

            if let Some(mut payload) =
                engine::events::engine_event_to_app_server_event_with_turn_context(
                    &event,
                    &current_thread_id,
                    &routed_item_id,
                    Some(event_turn_id),
                )
            {
                // Text/reasoning/tool events historically omit turnId from
                // their item payload. External PI follow-up runs arrive after
                // the original turn is settled, so the frontend needs the
                // follow-up identity on every event to pass the terminal guard.
                if let Some(params) = payload
                    .message
                    .get_mut("params")
                    .and_then(Value::as_object_mut)
                {
                    params.insert(
                        "turnId".to_string(),
                        Value::String(event_turn_id.to_string()),
                    );
                }
                event_sink.emit_app_server_event(payload);
            }

            if let engine::events::EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty()
                    && session_id != "pending"
                    && *engine == engine_for_forwarder
                    && engine.is_pi_family()
                {
                    current_thread_id = format!("{}:{}", engine.icon(), session_id);
                }
            }

            if is_terminal && is_external_turn {
                // pending_external_wakeup 保持 true 直到 run
                // settle 标记：唤醒 run 内的后续原生 turn 仍需
                // 门控放行（最终汇总在同一个 run 的下一个
                // 原生 turn 里）。
                active_external_wakeup_turn_ids.remove(&turn_event.turn_id);
            }
            // break 必须等 pump 的 agent_settled 生命周期标记：
            // 第一个原生 turn 的 TurnCompleted 后 run 内通常还有
            // 后续原生 turn；而后台任务唤醒的下一个 run 也会重置
            // 该标记。pending 任务全部回收且 run 彻底 settle 才
            // 允许断开。
            if primary_run_settled
                && pending_background_tasks.is_empty()
                && active_external_wakeup_turn_ids.is_empty()
            {
                break;
            }
        }
    });

    let session_clone = session.clone();
    let turn_id_clone = turn_id.clone();
    tokio::spawn(async move {
        if let Err(error) = session_clone.send_message(params, &turn_id_clone).await {
            eprintln!("pi-family send_message failed: {error}");
        }
    });
    state
        .record_auto_session_metadata_if_present(
            &workspace_id,
            response_session_id.as_deref(),
            auto_session,
            engine.icon(),
        )
        .await;

    Ok(json!({
        "engine": engine.icon(),
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started",
            }
        },
        "turn": {
            "id": turn_id,
            "status": "started",
        }
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_qoder(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id = session_management::resolve_engine_provider_profile_id(
        state.storage_path.as_path(),
        &workspace_id,
        provider_binding_lookup_session_id.as_deref(),
        "qoder",
        provider_profile_id.as_deref(),
    )?;
    let qoder_distribution_settings =
        engine::qoder_provider_profile::QoderDistributionSettings::from_app_settings(&settings);
    let provider_launch_profile =
        engine::qoder_provider_profile::resolve_qoder_provider_launch_profile(
            &workspace_id,
            effective_provider_profile_id.as_deref(),
            &qoder_distribution_settings,
        )?;
    let session = state
        .engine_manager
        .get_or_create_qoder_session_for_runtime(
            &workspace_id,
            &workspace_path,
            &provider_launch_profile,
        )
        .await;
    let resolved_session_id = resolve_qoder_session_id_for_engine_send(
        continue_session,
        session_id,
        session.get_session_id().await,
        Some(provider_launch_profile.distribution.provider_profile_id()),
    )?;
    let response_session_id = resolved_session_id.clone();
    let sanitized_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    let params = engine::SendMessageParams {
        text,
        model: sanitized_model,
        effort,
        disable_thinking: false,
        access_mode,
        images,
        continue_session,
        session_id: resolved_session_id,
        fork_session_id: None,
        agent: None,
        variant: None,
        collaboration_mode: None,
        custom_spec_root: normalized_custom_spec_root.clone(),
    };

    let turn_id = format!("qoder-turn-{}", uuid::Uuid::new_v4());
    let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
    let binding_session_id = response_session_id
        .as_deref()
        .or(provider_binding_lookup_session_id.as_deref())
        .unwrap_or(thread_id.as_str());
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        session_management::record_engine_provider_binding_core(
            &state.workspaces,
            state.storage_path.as_path(),
            workspace_id.clone(),
            binding_session_id.to_string(),
            "qoder".to_string(),
            binding.clone(),
        )
        .await?;
    }
    let item_id = format!("qoder-item-{}", uuid::Uuid::new_v4());

    let mut receiver = session.subscribe();
    let event_sink = state.event_sink.clone();
    let agent_event_bus = state.engine_manager.agent_event_bus();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let mut accumulated_agent_text = String::new();
    let provider_binding_for_forwarder = provider_launch_profile.binding.clone();
    let provider_binding_storage_path = state.storage_path.clone();
    let provider_binding_workspace_id = workspace_id.clone();
    let qoder_provider_profile_id_for_forwarder =
        provider_launch_profile.distribution.provider_profile_id();
    tokio::spawn(async move {
        let mut render_state = GeminiRenderRoutingState::default();
        loop {
            let turn_event = match receiver.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    continue;
                }
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let event = turn_event.event;
            agent_event_bus.publish_engine_event(
                engine::EngineType::Qoder,
                &current_thread_id,
                None,
                &turn_id_for_forwarder,
                Some(&turn_id_for_forwarder),
                &event,
            );
            let is_terminal = event.is_terminal();
            if let (
                Some(binding),
                engine::events::EngineEvent::SessionStarted {
                    session_id,
                    engine: engine::EngineType::Qoder,
                    ..
                },
            ) = (provider_binding_for_forwarder.as_ref(), &event)
            {
                if !session_id.is_empty() && session_id != "pending" {
                    session_management::schedule_engine_provider_binding_record(
                        provider_binding_storage_path.clone(),
                        provider_binding_workspace_id.clone(),
                        session_id.clone(),
                        "qoder".to_string(),
                        binding.clone(),
                    );
                }
            }
            let render_lane = match &event {
                engine::events::EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                engine::events::EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                engine::events::EngineEvent::ToolStarted { .. }
                | engine::events::EngineEvent::ToolCompleted { .. }
                | engine::events::EngineEvent::ToolInputUpdated { .. }
                | engine::events::EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                _ => GeminiRenderLane::Other,
            };
            let routed_item_id =
                next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

            if let engine::events::EngineEvent::TextDelta { text, .. } = &event {
                render_state.saw_text_delta = true;
                accumulated_agent_text.push_str(text);
            }

            if let engine::events::EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                let completed_text = if accumulated_agent_text.trim().is_empty() {
                    fallback_text
                } else {
                    accumulated_agent_text.clone()
                };
                if !completed_text.trim().is_empty() {
                    let completion_item_id =
                        gemini_agent_completion_item_id(&render_state, &item_id_clone);
                    event_sink.emit_app_server_event(AppServerEvent {
                        workspace_id: event.workspace_id().to_string(),
                        message: json!({
                            "method": "item/completed",
                            "params": {
                                "threadId": &current_thread_id,
                                "item": {
                                    "id": completion_item_id,
                                    "type": "agentMessage",
                                    "text": completed_text,
                                    "status": "completed",
                                }
                            }
                        }),
                    });
                }
            }

            if let Some(payload) =
                engine::events::engine_event_to_app_server_event_with_turn_context(
                    &event,
                    &current_thread_id,
                    &routed_item_id,
                    Some(&turn_id_for_forwarder),
                )
            {
                event_sink.emit_app_server_event(payload);
            }

            if let engine::events::EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty()
                    && session_id != "pending"
                    && matches!(engine, engine::EngineType::Qoder)
                {
                    match engine::qoder_provider_profile::canonical_qoder_native_session_id(
                        session_id,
                        Some(qoder_provider_profile_id_for_forwarder),
                    ) {
                        Ok(identity) => current_thread_id = identity,
                        Err(error) => eprintln!(
                            "[qoder] ignored invalid SessionStarted identity for {}: {error}",
                            qoder_provider_profile_id_for_forwarder,
                        ),
                    }
                }
            }

            if is_terminal {
                break;
            }
        }
    });

    let session_clone = session.clone();
    let turn_id_clone = turn_id.clone();
    tokio::spawn(async move {
        if let Err(error) = session_clone.send_message(params, &turn_id_clone).await {
            eprintln!("Qoder send_message failed: {error}");
        }
    });
    let metadata_session_id = response_session_id.as_deref().and_then(|session_id| {
        match engine::qoder_provider_profile::canonical_qoder_native_session_id(
            session_id,
            Some(provider_launch_profile.distribution.provider_profile_id()),
        ) {
            Ok(identity) => Some(identity),
            Err(error) => {
                log::warn!(
                    "[qoder] skipped auto-session metadata for invalid identity: {}",
                    error
                );
                None
            }
        }
    });
    state
        .record_auto_session_metadata_if_present(
            &workspace_id,
            metadata_session_id.as_deref(),
            auto_session,
            "qoder",
        )
        .await;

    Ok(json!({
        "engine": "qoder",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started",
            }
        },
        "turn": {
            "id": turn_id,
            "status": "started",
        }
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_grok(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id = session_management::resolve_engine_provider_profile_id(
        state.storage_path.as_path(),
        &workspace_id,
        provider_binding_lookup_session_id.as_deref(),
        "grok",
        provider_profile_id.as_deref(),
    )?;
    let provider_launch_profile =
        engine::grok_provider_profile::resolve_grok_provider_launch_profile(
            &workspace_id,
            effective_provider_profile_id.as_deref(),
        )?;
    let session = state
        .engine_manager
        .get_or_create_grok_session_for_runtime(
            &workspace_id,
            &workspace_path,
            &provider_launch_profile.runtime_key,
            provider_launch_profile.home_dir.as_deref(),
        )
        .await;
    let resolved_session_id = resolve_grok_session_id_for_engine_send(
        continue_session,
        session_id,
        session.get_session_id().await,
    );
    let response_session_id = resolved_session_id.clone();
    let sanitized_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    let params = engine::SendMessageParams {
        text,
        model: sanitized_model,
        effort,
        disable_thinking: false,
        access_mode,
        images,
        continue_session,
        session_id: resolved_session_id,
        fork_session_id: None,
        agent: None,
        variant: None,
        collaboration_mode: None,
        custom_spec_root: normalized_custom_spec_root.clone(),
    };

    let turn_id = format!("grok-turn-{}", uuid::Uuid::new_v4());
    let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
    let binding_session_id = response_session_id
        .as_deref()
        .or(provider_binding_lookup_session_id.as_deref())
        .unwrap_or(thread_id.as_str());
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        session_management::record_engine_provider_binding_core(
            &state.workspaces,
            state.storage_path.as_path(),
            workspace_id.clone(),
            binding_session_id.to_string(),
            "grok".to_string(),
            binding.clone(),
        )
        .await?;
    }
    let item_id = format!("grok-item-{}", uuid::Uuid::new_v4());

    let mut receiver = session.subscribe();
    let event_sink = state.event_sink.clone();
    let agent_event_bus = state.engine_manager.agent_event_bus();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let mut accumulated_agent_text = String::new();
    let provider_binding_for_forwarder = provider_launch_profile.binding.clone();
    let provider_binding_storage_path = state.storage_path.clone();
    let provider_binding_workspace_id = workspace_id.clone();
    tokio::spawn(async move {
        let mut render_state = GeminiRenderRoutingState::default();
        loop {
            let turn_event = match receiver.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                    continue;
                }
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let event = turn_event.event;
            agent_event_bus.publish_engine_event(
                engine::EngineType::Grok,
                &current_thread_id,
                None,
                &turn_id_for_forwarder,
                Some(&turn_id_for_forwarder),
                &event,
            );
            let is_terminal = event.is_terminal();
            if let (
                Some(binding),
                engine::events::EngineEvent::SessionStarted {
                    session_id,
                    engine: engine::EngineType::Grok,
                    ..
                },
            ) = (provider_binding_for_forwarder.as_ref(), &event)
            {
                if !session_id.is_empty() && session_id != "pending" {
                    session_management::schedule_engine_provider_binding_record(
                        provider_binding_storage_path.clone(),
                        provider_binding_workspace_id.clone(),
                        session_id.clone(),
                        "grok".to_string(),
                        binding.clone(),
                    );
                }
            }
            let render_lane = match &event {
                engine::events::EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                engine::events::EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                engine::events::EngineEvent::ToolStarted { .. }
                | engine::events::EngineEvent::ToolCompleted { .. }
                | engine::events::EngineEvent::ToolInputUpdated { .. }
                | engine::events::EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                _ => GeminiRenderLane::Other,
            };
            let routed_item_id =
                next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

            if let engine::events::EngineEvent::TextDelta { text, .. } = &event {
                render_state.saw_text_delta = true;
                accumulated_agent_text.push_str(text);
            }

            if let engine::events::EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                let completed_text = if accumulated_agent_text.trim().is_empty() {
                    fallback_text
                } else {
                    accumulated_agent_text.clone()
                };
                // Always emit agentMessage item/completed (Claude-parity) so
                // project-memory fusion runs after TextDelta streaming.
                if !completed_text.trim().is_empty() {
                    let completion_item_id =
                        gemini_agent_completion_item_id(&render_state, &item_id_clone);
                    event_sink.emit_app_server_event(AppServerEvent {
                        workspace_id: event.workspace_id().to_string(),
                        message: json!({
                            "method": "item/completed",
                            "params": {
                                "threadId": &current_thread_id,
                                "item": {
                                    "id": completion_item_id,
                                    "type": "agentMessage",
                                    "text": completed_text,
                                    "status": "completed",
                                }
                            }
                        }),
                    });
                }
            }

            if let Some(payload) =
                engine::events::engine_event_to_app_server_event_with_turn_context(
                    &event,
                    &current_thread_id,
                    &routed_item_id,
                    Some(&turn_id_for_forwarder),
                )
            {
                event_sink.emit_app_server_event(payload);
            }

            if let engine::events::EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty()
                    && session_id != "pending"
                    && matches!(engine, engine::EngineType::Grok)
                {
                    current_thread_id = format!("grok:{}", session_id);
                }
            }

            if is_terminal {
                break;
            }
        }
    });

    let session_clone = session.clone();
    let turn_id_clone = turn_id.clone();
    tokio::spawn(async move {
        if let Err(error) = session_clone.send_message(params, &turn_id_clone).await {
            eprintln!("Grok send_message failed: {error}");
        }
    });
    state
        .record_auto_session_metadata_if_present(
            &workspace_id,
            response_session_id.as_deref(),
            auto_session,
            "grok",
        )
        .await;

    Ok(json!({
        "engine": "grok",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started",
            }
        },
        "turn": {
            "id": turn_id,
            "status": "started",
        }
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_dsh(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let runtime = engine::dsh::runtime_settings_from_app(&settings);
    let resume_id = session_id.as_deref().or(thread_id.as_deref());
    let outcome = engine::dsh::send_user_turn(
        &runtime,
        None,
        &workspace_id,
        &workspace_path,
        &text,
        model.as_deref(),
        effort.as_deref(),
        images.as_deref(),
        resume_id,
        continue_session,
        dsh_agent_preset.as_deref(),
        access_mode.as_deref(),
    )
    .await?;
    state
        .record_auto_session_metadata_if_present(
            &workspace_id,
            Some(outcome.native_session_id.as_str()),
            auto_session,
            "dsh",
        )
        .await;
    Ok(json!({
        "engine": "dsh",
        "sessionId": outcome.thread_id,
        "result": {
            "turn": {
                "id": outcome.turn_id,
                "status": "started",
            }
        },
        "turn": {
            "id": outcome.turn_id,
            "status": "started",
        }
    }))
}
