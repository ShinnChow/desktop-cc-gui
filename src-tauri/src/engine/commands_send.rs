//! `engine_send_message` and its per-engine arm implementations, split from `commands.rs`.

use super::*;

pub(crate) async fn engine_send_message_claude(
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
    provider_profile_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    app: AppHandle,
    state: State<'_, AppState>,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let manager = &state.engine_manager;
    let workspace_entry = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .cloned()
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id =
        crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            provider_binding_lookup_session_id.as_deref(),
            "claude",
            provider_profile_id.as_deref(),
        )?;
    let provider_launch_profile = crate::engine::claude::resolve_claude_provider_launch_profile(
        effective_provider_profile_id.as_deref(),
    )?;
    let workspace_path = std::path::PathBuf::from(&workspace_entry.path);
    state
        .runtime_manager
        .record_starting(&workspace_entry, "claude", "engine-send-message")
        .await;

    let session = manager
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

    // Resolve session id according to mode:
    // 1) continue_session=true  -> explicit session_id or tracked session id
    // 2) continue_session=false -> force a fresh unique session id so concurrent
    //    Claude turns never collapse into one shared persisted session.
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
        log::warn!(
            "[engine_send_message] dropped invalid claude model={:?}, fallback to default",
            model
        );
    }
    let dispatch_receipt = build_claude_dispatch_receipt(
        &workspace_id,
        effective_provider_profile_id.as_deref(),
        sanitized_model.as_deref(),
        effort.as_deref(),
    );
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
        crate::session_management::record_engine_provider_binding_core(
            &state.workspaces,
            state.storage_path.as_path(),
            workspace_id.clone(),
            binding_session_id.to_string(),
            "claude".to_string(),
            provider_launch_profile.binding.clone(),
        )
        .await?;
    }
    let auto_session_for_record = auto_session.clone();
    let params = crate::engine::SendMessageParams {
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

    // Generate unique render item ids for Claude's assistant/reasoning lanes.
    // The conversation curtain keeps message/reasoning as separate items.
    // Reusing one id across kinds causes realtime assistant text to be
    // overwritten by reasoning snapshots in the normalized assembler path.
    let turn_id = format!("claude-turn-{}", uuid::Uuid::new_v4());
    let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
    session.register_turn_thread_id(&turn_id, &thread_id);
    let assistant_item_id = format!("claude-item-{}", uuid::Uuid::new_v4());
    let reasoning_item_id = format!("claude-reasoning-{}", uuid::Uuid::new_v4());

    // Subscribe to session events BEFORE spawning send_message
    let mut receiver = session.subscribe();
    let app_clone = app.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let runtime_manager = state.runtime_manager.clone();
    let workspace_entry_for_forwarder = workspace_entry.clone();
    let session_for_forwarder = session.clone();
    let provider_binding_for_forwarder = provider_launch_profile
        .as_ref()
        .map(|profile| profile.binding.clone());
    let provider_binding_storage_path = state.storage_path.clone();
    let provider_binding_workspace_id = workspace_id.clone();
    let native_session_id_for_forwarder = response_session_id
        .clone()
        .or_else(|| provider_binding_lookup_session_id.clone());
    let provider_runtime_key_for_forwarder =
        crate::engine::claude::provider_profile::claude_runtime_key(
            &workspace_id,
            effective_provider_profile_id.as_deref(),
        );

    // Spawn event forwarder: reads from broadcast channel and emits Tauri events.
    tokio::spawn(async move {
        let turn_source = format!("turn:{turn_id_for_forwarder}");
        let stream_source = format!("stream:{turn_id_for_forwarder}");
        let runtime_context = ClaudeForwarderRuntimeContext {
            runtime_manager,
            workspace_entry: workspace_entry_for_forwarder,
            session: session_for_forwarder,
            turn_source,
            stream_source,
        };
        let mut forwarder_state = ClaudeForwarderState::new(
            thread_id,
            assistant_item_id,
            reasoning_item_id,
            turn_id_for_forwarder.clone(),
        );
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
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped))) => {
                    log::warn!(
                        "Claude event forwarder lagged; skipped {} events for turn {}",
                        skipped,
                        turn_id_for_forwarder
                    );
                    continue;
                }
                Err(_) => break, // post-completion grace reached
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let is_post_completion_context_usage = post_completion_grace_deadline.is_some()
                && matches!(
                    &turn_event.event,
                    EngineEvent::UsageUpdate {
                        context_usage_source,
                        ..
                    } if context_usage_source.as_deref() == Some("context_command")
                );
            let is_turn_completed = matches!(turn_event.event, EngineEvent::TurnCompleted { .. });
            let event = turn_event.event;
            if let (
                Some(binding),
                EngineEvent::SessionStarted {
                    session_id,
                    engine: EngineType::Claude,
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
            let stream_timing = turn_event.stream_timing;
            if crate::shared_runtime_coordinator::is_internal_shared_context_replay_event(&event) {
                // Shared context replay 是 checksum ACK transport，不是可见用户消息。
                // coordinator 消费后禁止继续生成 claude/raw UI/history event。
                if let Some(app_state) = app_clone.try_state::<AppState>() {
                    let observation = app_state
                        .shared_runtime_coordinator
                        .ingest_engine_event_scoped(
                            &provider_runtime_key_for_forwarder,
                            EngineType::Claude,
                            Some(&turn_id_for_forwarder),
                            native_session_id_for_forwarder.as_deref(),
                            &event,
                        );
                    crate::event_sink::publish_shared_runtime_observation(&app_state, &observation);
                }
                continue;
            }
            let mut app_server_events = Vec::new();
            let did_finish = handle_claude_forwarder_event(
                event.clone(),
                stream_timing.as_ref(),
                &mut forwarder_state,
                &runtime_context,
                &mut |payload| app_server_events.push(payload),
            )
            .await;
            let shared_observation = app_clone
                .try_state::<AppState>()
                .map(|app_state| {
                    let observation = app_state
                        .shared_runtime_coordinator
                        .ingest_engine_event_with_replay_scoped(
                            &provider_runtime_key_for_forwarder,
                            EngineType::Claude,
                            Some(&turn_id_for_forwarder),
                            native_session_id_for_forwarder.as_deref(),
                            &event,
                            app_server_events.clone(),
                        );
                    crate::event_sink::publish_shared_runtime_observation(&app_state, &observation);
                    observation
                })
                .unwrap_or_default();
            if !shared_observation.ui_fanout_deferred {
                for mut payload in app_server_events {
                    if let Some(owner) = shared_observation.owner.as_ref() {
                        crate::shared_runtime_coordinator::project_app_server_event_to_shared_owner(
                            &mut payload,
                            owner,
                        );
                    }
                    let _ = app_clone.emit("app-server-event", payload);
                }
            }
            if did_finish {
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
    if let (Some(session_id), Some(metadata)) =
        (response_session_id.as_deref(), auto_session_for_record)
    {
        record_auto_session_metadata_if_present(
            &state,
            &workspace_id,
            Some(session_id),
            Some(metadata),
            "claude",
        )
        .await;
    }

    // Spawn the message sender: drives the Claude CLI process
    let session_clone = session.clone();
    let turn_id_clone = turn_id.clone();
    let runtime_manager_for_sender = state.runtime_manager.clone();
    let workspace_entry_for_sender = workspace_entry.clone();
    let app_settings_snapshot = state.app_settings.lock().await.clone();
    let provider_env = provider_launch_profile.map(|profile| profile.env);
    tokio::spawn(async move {
        let send_result = if has_images {
            session_clone
                .send_message_with_app_settings_and_provider_env(
                    params,
                    &turn_id_clone,
                    Some(&app_settings_snapshot),
                    provider_env.as_ref(),
                )
                .await
        } else {
            session_clone
                .send_message_with_app_settings_and_provider_env(
                    params,
                    &turn_id_clone,
                    Some(&app_settings_snapshot),
                    provider_env.as_ref(),
                )
                .await
        };
        if let Err(e) = send_result {
            log::error!("Claude send_message failed: {}", e);
            runtime_manager_for_sender
                .record_failure(
                    &workspace_entry_for_sender,
                    "claude",
                    "engine-send-message",
                    e,
                )
                .await;
        }
    });

    // Return immediately with turn info (frontend will receive streaming events)
    Ok(json!({
        "engine": "claude",
        "sessionId": response_session_id.clone(),
        "result": {
            "sessionId": response_session_id.clone(),
            "modelResolution": model_resolution.clone(),
            "turn": {
                "id": turn_id,
                "status": "started"
            },
        },
        "modelResolution": model_resolution,
        "mossxDispatchReceipt": dispatch_receipt,
        "turn": {
            "id": turn_id,
            "status": "started"
        }
    }))
}

pub(crate) async fn engine_send_message_codex() -> Result<Value, String> {
    // For Codex, delegate to existing send_user_message command
    // The frontend should use the existing command for now
    Ok(json!({
        "delegateTo": "send_user_message",
        "engine": "codex",
    }))
}

pub(crate) async fn engine_send_message_opencode(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    app: AppHandle,
    state: State<'_, AppState>,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let manager = &state.engine_manager;
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| std::path::PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };

    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id =
        crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            provider_binding_lookup_session_id.as_deref(),
            "opencode",
            provider_profile_id.as_deref(),
        )?;
    let provider_launch_profile =
        crate::engine::opencode_provider_profile::resolve_opencode_provider_launch_profile(
            &workspace_id,
            effective_provider_profile_id.as_deref(),
        )?;
    let session = manager
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
        log::warn!(
            "[engine_send_message] dropped invalid opencode model={:?}, fallback to default",
            model
        );
    }
    // Always pass an explicit --model: a broken default model in the
    // user's opencode.json must not fail GUI turns. Managed providers
    // resolve through the injected `ccgui/<model>` refs.
    let model_for_send = if provider_launch_profile.binding.is_some() {
        sanitized_model
            .or_else(|| provider_launch_profile.default_model.clone())
            .map(|value| {
                crate::engine::opencode_provider_profile::qualify_managed_model_ref(&value)
            })
    } else {
        sanitized_model.or_else(|| Some("opencode/big-pickle".to_string()))
    };
    let dispatch_receipt = build_provider_engine_dispatch_receipt(
        EngineType::OpenCode,
        effective_provider_profile_id.as_deref(),
        &provider_launch_profile.runtime_key,
        model_for_send.as_deref(),
        effort.as_deref(),
    );

    let params = crate::engine::SendMessageParams {
        text,
        model: model_for_send.clone(),
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
        crate::session_management::record_engine_provider_binding_core(
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
    let app_clone = app.clone();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let provider_runtime_key_for_forwarder = provider_launch_profile.runtime_key.clone();
    let mut native_session_id_for_forwarder = response_session_id
        .clone()
        .or_else(|| provider_binding_lookup_session_id.clone());
    // Spawn event forwarder (same pattern as Claude forwarder above).
    tokio::spawn(async move {
        loop {
            let turn_event = match receiver.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    log::warn!(
                        "OpenCode event forwarder lagged; skipped {} events for turn {}",
                        skipped,
                        turn_id_for_forwarder
                    );
                    continue;
                }
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let event = turn_event.event;
            let is_terminal = event.is_terminal();

            let mut app_server_events = Vec::new();
            if let Some(payload) = engine_event_to_app_server_event_with_turn_context(
                &event,
                &current_thread_id,
                &item_id_clone,
                Some(&turn_id_for_forwarder),
            ) {
                app_server_events.push(payload);
            }
            fan_out_provider_engine_event(
                &app_clone,
                &provider_runtime_key_for_forwarder,
                EngineType::OpenCode,
                &turn_id_for_forwarder,
                native_session_id_for_forwarder.as_deref(),
                &event,
                app_server_events,
            );

            if let EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty() && session_id != "pending" {
                    if matches!(engine, EngineType::OpenCode) {
                        current_thread_id = format!("opencode:{}", session_id);
                        native_session_id_for_forwarder = Some(session_id.clone());
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
        if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
            log::error!("OpenCode send_message failed: {}", e);
            session_clone.emit_error(&turn_id_clone, e);
        }
    });
    if let (Some(session_id), Some(metadata)) =
        (response_session_id.as_deref(), auto_session.clone())
    {
        record_auto_session_metadata_if_present(
            &state,
            &workspace_id,
            Some(session_id),
            Some(metadata),
            "opencode",
        )
        .await;
    }

    Ok(json!({
        "engine": "opencode",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started"
            },
        },
        "mossxDispatchReceipt": dispatch_receipt,
        "turn": {
            "id": turn_id,
            "status": "started"
        }
    }))
}

pub(crate) async fn engine_send_message_gemini(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    app: AppHandle,
    state: State<'_, AppState>,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let manager = &state.engine_manager;
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| std::path::PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };

    let session = manager
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
        log::warn!(
            "[engine_send_message] dropped invalid gemini model={:?}, fallback to default",
            model
        );
    }

    let params = crate::engine::SendMessageParams {
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
    let app_clone = app.clone();
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
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped))) => {
                    log::warn!(
                        "Gemini event forwarder lagged; skipped {} events for turn {}",
                        skipped,
                        turn_id_for_forwarder
                    );
                    continue;
                }
                Err(_) => break,
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let event = turn_event.event;
            let is_terminal = event.is_terminal();
            let render_lane = match &event {
                EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                EngineEvent::ToolStarted { .. }
                | EngineEvent::ToolCompleted { .. }
                | EngineEvent::ToolInputUpdated { .. }
                | EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                _ => GeminiRenderLane::Other,
            };
            let routed_item_id =
                next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

            if let EngineEvent::TextDelta { text, .. } = &event {
                render_state.saw_text_delta = true;
                accumulated_agent_text.push_str(text);
            }

            if let EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                let completed_text = if should_prefer_turn_result_text(result.as_ref()) {
                    fallback_text
                } else if accumulated_agent_text.trim().is_empty() {
                    fallback_text
                } else {
                    accumulated_agent_text.clone()
                };
                // Always emit agentMessage item/completed so project-memory
                // fusion (onAgentMessageCompleted) runs even after TextDelta.
                // Use text-lane id so the frontend upserts the streamed bubble.
                if !completed_text.trim().is_empty() {
                    let completion_item_id =
                        gemini_agent_completion_item_id(&render_state, &item_id_clone);
                    let synthetic = AppServerEvent {
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
                    };
                    let _ = app_clone.emit("app-server-event", synthetic);
                }
            }

            if let Some(payload) = engine_event_to_app_server_event_with_turn_context(
                &event,
                &current_thread_id,
                &routed_item_id,
                Some(&turn_id_for_forwarder),
            ) {
                let _ = app_clone.emit("app-server-event", payload);
            }

            if let EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty() && session_id != "pending" {
                    if matches!(engine, EngineType::Gemini) {
                        current_thread_id = format!("gemini:{}", session_id);
                    }
                }
            }

            if is_terminal {
                if matches!(event, EngineEvent::TurnCompleted { .. }) {
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
        if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
            log::error!("Gemini send_message failed: {}", e);
        }
    });
    if let (Some(session_id), Some(metadata)) =
        (response_session_id.as_deref(), auto_session.clone())
    {
        record_auto_session_metadata_if_present(
            &state,
            &workspace_id,
            Some(session_id),
            Some(metadata),
            "gemini",
        )
        .await;
    }

    Ok(json!({
        "engine": "gemini",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started"
            },
        },
        "turn": {
            "id": turn_id,
            "status": "started"
        }
    }))
}

pub(crate) async fn engine_send_message_kimi(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    app: AppHandle,
    state: State<'_, AppState>,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let manager = &state.engine_manager;
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| std::path::PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id =
        crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            provider_binding_lookup_session_id.as_deref(),
            "kimi",
            provider_profile_id.as_deref(),
        )?;
    let provider_launch_profile =
        crate::engine::kimi_provider_profile::resolve_kimi_provider_launch_profile(
            &workspace_id,
            effective_provider_profile_id.as_deref(),
        )?;
    let session = manager
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
    let runtime_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let dispatch_receipt = build_provider_engine_dispatch_receipt(
        EngineType::Kimi,
        effective_provider_profile_id.as_deref(),
        &provider_launch_profile.runtime_key,
        runtime_model.as_deref(),
        effort.as_deref(),
    );

    let params = crate::engine::SendMessageParams {
        text,
        model: runtime_model,
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
        crate::session_management::record_engine_provider_binding_core(
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
    let app_clone = app.clone();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let mut accumulated_agent_text = String::new();
    let provider_binding_for_forwarder = provider_launch_profile.binding.clone();
    let provider_binding_storage_path = state.storage_path.clone();
    let provider_binding_workspace_id = workspace_id.clone();
    let provider_runtime_key_for_forwarder = provider_launch_profile.runtime_key.clone();
    let mut native_session_id_for_forwarder = response_session_id
        .clone()
        .or_else(|| provider_binding_lookup_session_id.clone());
    tokio::spawn(async move {
        let mut render_state = GeminiRenderRoutingState::default();
        loop {
            let turn_event = match receiver.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    log::warn!(
                        "Kimi event forwarder lagged; skipped {} events for turn {}",
                        skipped,
                        turn_id_for_forwarder
                    );
                    continue;
                }
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let event = turn_event.event;
            if let (
                Some(binding),
                EngineEvent::SessionStarted {
                    session_id,
                    engine: EngineType::Kimi,
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
            let is_terminal = event.is_terminal();
            let render_lane = match &event {
                EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                EngineEvent::ToolStarted { .. }
                | EngineEvent::ToolCompleted { .. }
                | EngineEvent::ToolInputUpdated { .. }
                | EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                _ => GeminiRenderLane::Other,
            };
            let routed_item_id =
                next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

            if let EngineEvent::TextDelta { text, .. } = &event {
                render_state.saw_text_delta = true;
                accumulated_agent_text.push_str(text);
            }

            let mut app_server_events = Vec::new();
            if let EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                let completed_text = if should_prefer_turn_result_text(result.as_ref()) {
                    fallback_text
                } else if accumulated_agent_text.trim().is_empty() {
                    fallback_text
                } else {
                    accumulated_agent_text.clone()
                };
                // Use text-lane id so the frontend upserts the streamed bubble.
                if !completed_text.trim().is_empty() {
                    let completion_item_id =
                        gemini_agent_completion_item_id(&render_state, &item_id_clone);
                    let synthetic = AppServerEvent {
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
                    };
                    app_server_events.push(synthetic);
                }
            }

            if let Some(payload) = engine_event_to_app_server_event_with_turn_context(
                &event,
                &current_thread_id,
                &routed_item_id,
                Some(&turn_id_for_forwarder),
            ) {
                app_server_events.push(payload);
            }
            fan_out_provider_engine_event(
                &app_clone,
                &provider_runtime_key_for_forwarder,
                EngineType::Kimi,
                &turn_id_for_forwarder,
                native_session_id_for_forwarder.as_deref(),
                &event,
                app_server_events,
            );

            if let EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty() && session_id != "pending" {
                    if matches!(engine, EngineType::Kimi) {
                        current_thread_id = format!("kimi:{}", session_id);
                        native_session_id_for_forwarder = Some(session_id.clone());
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
        if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
            log::error!("Kimi send_message failed: {}", e);
        }
    });
    if let (Some(session_id), Some(metadata)) =
        (response_session_id.as_deref(), auto_session.clone())
    {
        record_auto_session_metadata_if_present(
            &state,
            &workspace_id,
            Some(session_id),
            Some(metadata),
            "kimi",
        )
        .await;
    }

    Ok(json!({
        "engine": "kimi",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started"
            },
        },
        "mossxDispatchReceipt": dispatch_receipt,
        "turn": {
            "id": turn_id,
            "status": "started"
        }
    }))
}

pub(crate) async fn engine_send_message_pi(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    app: AppHandle,
    state: State<'_, AppState>,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let manager = &state.engine_manager;
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| std::path::PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id =
        crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            provider_binding_lookup_session_id.as_deref(),
            "pi",
            provider_profile_id.as_deref(),
        )?;
    let provider_launch_profile =
        crate::engine::pi_provider_profile::resolve_pi_provider_launch_profile(
            &workspace_id,
            effective_provider_profile_id.as_deref(),
            None,
        )?;
    let session = manager
        .get_or_create_pi_session_for_runtime(
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
    let runtime_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let dispatch_receipt = build_provider_engine_dispatch_receipt(
        EngineType::Pi,
        effective_provider_profile_id.as_deref(),
        &provider_launch_profile.runtime_key,
        runtime_model.as_deref(),
        effort.as_deref(),
    );

    let params = crate::engine::SendMessageParams {
        text,
        model: runtime_model,
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

    // OpenSpec change：fix-orphan-turn-during-backend-unavailability（F2）。
    // Send gate 双证据快速失败：RPC spawn disabled latch 冷却期内 AND
    // print-json fallback 被同 session 占用。此时 dispatch 大概率无人
    // 认领（引擎持续不可用，如 dev 重启窗口），不返回 started 让前端
    // 孤儿等待；返回结构化 error 走既有 rpcError 路径（不进入 turn
    // 状态机）。单证据（仅 latch 或仅 busy）照常放行——存活 resident
    // 复用与 fallback 各自有自愈路径。
    if session.rpc_spawn_blocked().await
        && session
            .print_json_fallback_blocked(response_session_id.as_deref())
            .await
    {
        log::warn!(
            "[engine_send_message] pi send gate rejected: rpc cooldown + fallback busy (workspace={workspace_id}, session={:?})",
            response_session_id
        );
        return Ok(json!({
            "error": {
                "message": "PI engine is unavailable (rpc cooldown and fallback busy); please retry",
                "code": "pi_engine_unavailable",
            }
        }));
    }

    let turn_id = format!("pi-turn-{}", uuid::Uuid::new_v4());
    let thread_id = thread_id.unwrap_or_else(|| turn_id.clone());
    let binding_session_id = response_session_id
        .as_deref()
        .or(provider_binding_lookup_session_id.as_deref())
        .unwrap_or(thread_id.as_str());
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        crate::session_management::record_engine_provider_binding_core(
            &state.workspaces,
            state.storage_path.as_path(),
            workspace_id.clone(),
            binding_session_id.to_string(),
            "pi".to_string(),
            binding.clone(),
        )
        .await?;
    }
    let item_id = format!("pi-item-{}", uuid::Uuid::new_v4());

    let mut receiver = session.subscribe();
    let app_clone = app.clone();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let mut accumulated_agent_text = String::new();
    let provider_binding_for_forwarder = provider_launch_profile.binding.clone();
    let provider_binding_storage_path = state.storage_path.clone();
    let provider_binding_workspace_id = workspace_id.clone();
    let provider_runtime_key_for_forwarder = provider_launch_profile.runtime_key.clone();
    let mut native_session_id_for_forwarder = response_session_id
        .clone()
        .or_else(|| provider_binding_lookup_session_id.clone());
    tokio::spawn(async move {
        let mut render_state = GeminiRenderRoutingState::default();
        // PI 专属门控状态——与 cc_gui_daemon 的 PI forwarder（daemon_state.rs）
        // 同一套语义，两份拷贝必须同步演进（dev 模式引擎跑在 app 进程内，
        // 走的是这份；安装版走 daemon 那份。2026-08-30 实测：仅改 daemon
        // 导致 dev 全程验证失效）。
        let mut pending_background_tasks = HashSet::<String>::new();
        let mut background_task_aliases = HashMap::<String, String>::new();
        let mut active_external_wakeup_turn_ids = HashSet::<String>::new();
        let mut pending_external_wakeup = false;
        let mut primary_run_settled = false;
        let mut active_forwarded_turn_id = turn_id_for_forwarder.clone();
        loop {
            let turn_event = match receiver.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    log::warn!(
                        "PI event forwarder lagged; skipped {} events for turn {}",
                        skipped,
                        turn_id_for_forwarder
                    );
                    continue;
                }
            };
            let is_external_turn = turn_event.turn_id.starts_with("pi-external-");
            let is_known_external_wakeup =
                active_external_wakeup_turn_ids.contains(&turn_event.turn_id);
            let is_external_wakeup = is_pi_external_wakeup_allowed(
                &turn_event.turn_id,
                &turn_id_for_forwarder,
                &turn_event.event,
                !pending_background_tasks.is_empty(),
                pending_external_wakeup,
                is_known_external_wakeup,
            );
            // run 归属判定（run_owner 戳）：只转发本 send 自己 run 的
            // 原生 turn（primary / {primary}:t{n} 派生）与本 send id 被
            // 绑定进其他 run 的 steer turn。别的 send 的 run（含其唤醒/
            // 派生 turn）一律拒绝——放行会串台到本 send 的线程，前端单
            // activeTurnId 结算守卫错配后永久丢结算（2026-08-30 实证）。
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
            if is_external_wakeup && !is_known_external_wakeup {
                // pending_external_wakeup 保持到 run settle 标记处复位：
                // 唤醒 run 自身也是多原生 turn 的（最终汇总在同一个 run
                // 的下一个原生 turn 里）。
                active_external_wakeup_turn_ids.insert(turn_event.turn_id.clone());
            }

            let event = turn_event.event;
            let event_turn_id = turn_event.turn_id.as_str();
            if event_turn_id != active_forwarded_turn_id {
                active_forwarded_turn_id = event_turn_id.to_string();
                // 每个 PI follow-up 都是独立的 assistant turn：保留单调
                // item 计数，只重置 lane 局部状态，避免第二轮锚到第一轮。
                render_state.last_render_lane = GeminiRenderLane::Other;
                render_state.active_text_item_id = None;
                render_state.saw_text_delta = false;
                accumulated_agent_text.clear();
            }
            match &event {
                EngineEvent::TurnStarted { .. } => {
                    // 新 run / 新原生 turn 开始：解除 settled 标记。
                    primary_run_settled = false;
                }
                EngineEvent::Raw { .. } if is_pi_agent_settled_marker(&event) => {
                    primary_run_settled = true;
                    // run 彻底 settle：唤醒窗口关闭。后续后台任务回收后
                    // 的下一个唤醒 run 会重新置 true。
                    pending_external_wakeup = false;
                }
                EngineEvent::BackgroundTaskStarted { tool_id, .. } => {
                    pending_background_tasks.insert(tool_id.clone());
                }
                EngineEvent::BackgroundTaskUpdated {
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
                        // receipt 通常同时带 tool ID 与后台 task ID；后续
                        // notification 可能只有 task ID。切换 canonical
                        // task ID 并保留别名用于终态回收。
                        if let Some(tool_id) = tool_id {
                            pending_background_tasks.remove(tool_id);
                            background_task_aliases.insert(task_id.to_string(), tool_id.clone());
                        }
                        pending_background_tasks.insert(task_id.to_string());
                    }
                }
                _ => {}
            }
            if let (
                Some(binding),
                EngineEvent::SessionStarted {
                    session_id,
                    engine: EngineType::Pi,
                    ..
                },
            ) = (provider_binding_for_forwarder.as_ref(), &event)
            {
                if !session_id.is_empty() && session_id != "pending" {
                    session_management::schedule_engine_provider_binding_record(
                        provider_binding_storage_path.clone(),
                        provider_binding_workspace_id.clone(),
                        session_id.clone(),
                        "pi".to_string(),
                        binding.clone(),
                    );
                }
            }
            let is_terminal = event.is_terminal();
            let render_lane = match &event {
                EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                EngineEvent::ToolStarted { .. }
                | EngineEvent::ToolCompleted { .. }
                | EngineEvent::ToolInputUpdated { .. }
                | EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                _ => GeminiRenderLane::Other,
            };
            let routed_item_id =
                next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

            if let EngineEvent::ToolStarted { .. } = &event {
                accumulated_agent_text.clear();
            }

            if let EngineEvent::TextDelta { text, .. } = &event {
                render_state.saw_text_delta = true;
                accumulated_agent_text.push_str(text);
            }

            let mut app_server_events = Vec::new();
            if let EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                let completed_text = if render_state.saw_text_delta {
                    accumulated_agent_text.clone()
                } else {
                    fallback_text
                };
                // Use text-lane id so the frontend upserts the streamed bubble.
                if !completed_text.trim().is_empty() {
                    let completion_item_id = render_state
                        .active_text_item_id
                        .clone()
                        .unwrap_or_else(|| format!("{item_id_clone}:pi-turn-{event_turn_id}"));
                    let synthetic = AppServerEvent {
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
                    };
                    app_server_events.push(synthetic);
                }
            }

            if let Some(mut payload) = engine_event_to_app_server_event_with_turn_context(
                &event,
                &current_thread_id,
                &routed_item_id,
                Some(event_turn_id),
            ) {
                // Text/reasoning/tool 事件历史上不带 turnId；外部 PI
                // follow-up 在原 turn settle 之后到达，前端需要每个事件
                // 携带 turn 身份才能通过终态守卫。
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
                app_server_events.push(payload);
            }
            fan_out_provider_engine_event(
                &app_clone,
                &provider_runtime_key_for_forwarder,
                EngineType::Pi,
                &turn_id_for_forwarder,
                native_session_id_for_forwarder.as_deref(),
                &event,
                app_server_events,
            );

            if let EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty() && session_id != "pending" {
                    if matches!(engine, EngineType::Pi) {
                        current_thread_id = format!("pi:{}", session_id);
                        native_session_id_for_forwarder = Some(session_id.clone());
                    }
                }
            }

            if is_terminal && is_external_turn {
                // pending_external_wakeup 保持 true 直到 run settle
                // 标记处复位（唤醒 run 自身多原生 turn）。
                active_external_wakeup_turn_ids.remove(&turn_event.turn_id);
            }
            // break 必须等 pump 的 agent_settled 生命周期标记：第一个
            // 原生 turn 的 TurnCompleted 后 run 内通常还有后续原生 turn
            // （普通多轮工具对话的常态）；后台唤醒的下一个 run 会复位
            // 标记。pending 任务全部回收且 run 彻底 settle 才断开。
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
    // OpenSpec change：fix-orphan-turn-during-backend-unavailability（F3）。
    // detached send 失败/panic 必须有事件兜底：send_message 内部失败路径
    // 已 emit_error；panic（如 in-flight dev 代码缺陷）若不 catch 会静默
    // 吞掉，turn 永远无回执 → 前端孤儿（F1 看门狗之外的后端侧兜底）。
    tokio::spawn(async move {
        drive_detached_pi_send(
            &turn_id_clone,
            |turn_id, error| session_clone.emit_error(turn_id, error),
            session_clone.send_message(params, &turn_id_clone),
        )
        .await;
    });
    if let (Some(session_id), Some(metadata)) =
        (response_session_id.as_deref(), auto_session.clone())
    {
        record_auto_session_metadata_if_present(
            &state,
            &workspace_id,
            Some(session_id),
            Some(metadata),
            "pi",
        )
        .await;
    }

    Ok(json!({
        "engine": "pi",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started"
            },
        },
        "mossxDispatchReceipt": dispatch_receipt,
        "turn": {
            "id": turn_id,
            "status": "started"
        }
    }))
}

pub(crate) async fn engine_send_message_qoder(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    app: AppHandle,
    state: State<'_, AppState>,
    settings: crate::types::AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let manager = &state.engine_manager;
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| std::path::PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id =
        crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            provider_binding_lookup_session_id.as_deref(),
            "qoder",
            provider_profile_id.as_deref(),
        )?;
    let qoder_distribution_settings =
        crate::engine::qoder_provider_profile::QoderDistributionSettings::from_app_settings(
            &settings,
        );
    let provider_launch_profile =
        crate::engine::qoder_provider_profile::resolve_qoder_provider_launch_profile(
            &workspace_id,
            effective_provider_profile_id.as_deref(),
            &qoder_distribution_settings,
        )?;
    let session = manager
        .get_or_create_qoder_session_for_runtime(
            &workspace_id,
            &workspace_path,
            &provider_launch_profile,
        )
        .await;

    let normalized_fork_session_id = crate::engine::qoder::normalize_qoder_fork_session_id(
        fork_session_id.as_deref(),
        Some(provider_launch_profile.distribution.provider_profile_id()),
    )?;
    let resolved_session_id = if normalized_fork_session_id.is_some() {
        None
    } else {
        crate::engine::qoder::resolve_qoder_session_id_for_engine_send(
            continue_session,
            session_id,
            session.get_session_id().await,
            Some(provider_launch_profile.distribution.provider_profile_id()),
        )?
    };
    let response_session_id = resolved_session_id.clone();
    let runtime_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let dispatch_receipt = build_provider_engine_dispatch_receipt(
        EngineType::Qoder,
        effective_provider_profile_id.as_deref(),
        &provider_launch_profile.runtime_key,
        runtime_model.as_deref(),
        effort.as_deref(),
    );

    // Qoder ACP runs headless with bypassPermissions (design §2); the
    // composer access-mode selector stays disabled for qoder (kimi-parity).
    let params = crate::engine::SendMessageParams {
        text,
        model: runtime_model,
        effort,
        disable_thinking: false,
        access_mode,
        images,
        continue_session,
        session_id: resolved_session_id,
        fork_session_id: normalized_fork_session_id,
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
        .unwrap_or(turn_id.as_str());
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        crate::session_management::record_engine_provider_binding_core(
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
    let app_clone = app.clone();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let mut accumulated_agent_text = String::new();
    let provider_binding_for_forwarder = provider_launch_profile.binding.clone();
    let provider_binding_storage_path = state.storage_path.clone();
    let provider_binding_workspace_id = workspace_id.clone();
    let provider_runtime_key_for_forwarder = provider_launch_profile.runtime_key.clone();
    let qoder_provider_profile_id_for_forwarder =
        provider_launch_profile.distribution.provider_profile_id();
    let mut native_session_id_for_forwarder = response_session_id
        .clone()
        .or_else(|| provider_binding_lookup_session_id.clone());
    tokio::spawn(async move {
        let mut render_state = GeminiRenderRoutingState::default();
        loop {
            let turn_event = match receiver.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    log::warn!(
                        "Qoder event forwarder lagged; skipped {} events for turn {}",
                        skipped,
                        turn_id_for_forwarder
                    );
                    continue;
                }
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let event = turn_event.event;
            if let (
                Some(binding),
                EngineEvent::SessionStarted {
                    session_id,
                    engine: EngineType::Qoder,
                    ..
                },
            ) = (provider_binding_for_forwarder.as_ref(), &event)
            {
                if !session_id.is_empty() && session_id != "pending" {
                    crate::session_management::schedule_engine_provider_binding_record(
                        provider_binding_storage_path.clone(),
                        provider_binding_workspace_id.clone(),
                        session_id.clone(),
                        "qoder".to_string(),
                        binding.clone(),
                    );
                }
            }
            let is_terminal = event.is_terminal();
            let render_lane = match &event {
                EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                EngineEvent::ToolStarted { .. }
                | EngineEvent::ToolCompleted { .. }
                | EngineEvent::ToolInputUpdated { .. }
                | EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                _ => GeminiRenderLane::Other,
            };
            let routed_item_id =
                next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

            if let EngineEvent::TextDelta { text, .. } = &event {
                render_state.saw_text_delta = true;
                accumulated_agent_text.push_str(text);
            }

            let mut app_server_events = Vec::new();
            if let EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                let completed_text = if should_prefer_turn_result_text(result.as_ref()) {
                    fallback_text
                } else if accumulated_agent_text.trim().is_empty() {
                    fallback_text
                } else {
                    accumulated_agent_text.clone()
                };
                if !completed_text.trim().is_empty() {
                    let completion_item_id =
                        gemini_agent_completion_item_id(&render_state, &item_id_clone);
                    let synthetic = AppServerEvent {
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
                    };
                    app_server_events.push(synthetic);
                }
            }

            if let Some(payload) = engine_event_to_app_server_event_with_turn_context(
                &event,
                &current_thread_id,
                &routed_item_id,
                Some(&turn_id_for_forwarder),
            ) {
                app_server_events.push(payload);
            }
            fan_out_provider_engine_event(
                &app_clone,
                &provider_runtime_key_for_forwarder,
                EngineType::Qoder,
                &turn_id_for_forwarder,
                native_session_id_for_forwarder.as_deref(),
                &event,
                app_server_events,
            );

            if let EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty() && session_id != "pending" {
                    if matches!(engine, EngineType::Qoder) {
                        match crate::engine::qoder_provider_profile::canonical_qoder_native_session_id(
                            session_id,
                            Some(qoder_provider_profile_id_for_forwarder),
                        ) {
                            Ok(identity) => current_thread_id = identity,
                            Err(error) => log::warn!(
                                "[qoder] ignored invalid SessionStarted identity for {}: {}",
                                qoder_provider_profile_id_for_forwarder,
                                error
                            ),
                        }
                        native_session_id_for_forwarder = Some(session_id.clone());
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
        if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
            log::error!("Qoder send_message failed: {}", e);
        }
    });
    if let (Some(session_id), Some(metadata)) =
        (response_session_id.as_deref(), auto_session.clone())
    {
        match crate::engine::qoder_provider_profile::canonical_qoder_native_session_id(
            session_id,
            Some(provider_launch_profile.distribution.provider_profile_id()),
        ) {
            Ok(metadata_session_id) => {
                record_auto_session_metadata_if_present(
                    &state,
                    &workspace_id,
                    Some(metadata_session_id.as_str()),
                    Some(metadata),
                    "qoder",
                )
                .await;
            }
            Err(error) => log::warn!(
                "[qoder] skipped auto-session metadata for invalid identity: {}",
                error
            ),
        }
    }

    Ok(json!({
        "engine": "qoder",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started"
            },
        },
        "mossxDispatchReceipt": dispatch_receipt,
        "turn": {
            "id": turn_id,
            "status": "started"
        }
    }))
}

pub(crate) async fn engine_send_message_grok(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    provider_profile_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    app: AppHandle,
    state: State<'_, AppState>,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let manager = &state.engine_manager;
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| std::path::PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let provider_binding_lookup_session_id = session_id
        .as_deref()
        .or(thread_id.as_deref())
        .map(str::to_string);
    let effective_provider_profile_id =
        crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            provider_binding_lookup_session_id.as_deref(),
            "grok",
            provider_profile_id.as_deref(),
        )?;
    let provider_launch_profile =
        crate::engine::grok_provider_profile::resolve_grok_provider_launch_profile(
            &workspace_id,
            effective_provider_profile_id.as_deref(),
        )?;
    let session = manager
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
    let runtime_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let dispatch_receipt = build_provider_engine_dispatch_receipt(
        EngineType::Grok,
        effective_provider_profile_id.as_deref(),
        &provider_launch_profile.runtime_key,
        runtime_model.as_deref(),
        effort.as_deref(),
    );

    let params = crate::engine::SendMessageParams {
        text,
        model: runtime_model,
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
        crate::session_management::record_engine_provider_binding_core(
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
    let app_clone = app.clone();
    let mut current_thread_id = thread_id.clone();
    let item_id_clone = item_id.clone();
    let turn_id_for_forwarder = turn_id.clone();
    let mut accumulated_agent_text = String::new();
    let provider_binding_for_forwarder = provider_launch_profile.binding.clone();
    let provider_binding_storage_path = state.storage_path.clone();
    let provider_binding_workspace_id = workspace_id.clone();
    let provider_runtime_key_for_forwarder = provider_launch_profile.runtime_key.clone();
    let mut native_session_id_for_forwarder = response_session_id
        .clone()
        .or_else(|| provider_binding_lookup_session_id.clone());
    tokio::spawn(async move {
        let mut render_state = GeminiRenderRoutingState::default();
        loop {
            let turn_event = match receiver.recv().await {
                Ok(event) => event,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    log::warn!(
                        "Grok event forwarder lagged; skipped {} events for turn {}",
                        skipped,
                        turn_id_for_forwarder
                    );
                    continue;
                }
            };
            if turn_event.turn_id != turn_id_for_forwarder {
                continue;
            }

            let event = turn_event.event;
            if let (
                Some(binding),
                EngineEvent::SessionStarted {
                    session_id,
                    engine: EngineType::Grok,
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
            let is_terminal = event.is_terminal();
            let render_lane = match &event {
                EngineEvent::TextDelta { .. } => GeminiRenderLane::Text,
                EngineEvent::ReasoningDelta { .. } => GeminiRenderLane::Reasoning,
                EngineEvent::ToolStarted { .. }
                | EngineEvent::ToolCompleted { .. }
                | EngineEvent::ToolInputUpdated { .. }
                | EngineEvent::ToolOutputDelta { .. } => GeminiRenderLane::Tool,
                _ => GeminiRenderLane::Other,
            };
            let routed_item_id =
                next_gemini_routed_item_id(&mut render_state, render_lane, &item_id_clone);

            if let EngineEvent::TextDelta { text, .. } = &event {
                render_state.saw_text_delta = true;
                accumulated_agent_text.push_str(text);
            }

            let mut app_server_events = Vec::new();
            if let EngineEvent::TurnCompleted { result, .. } = &event {
                let fallback_text = extract_turn_result_text(result.as_ref()).unwrap_or_default();
                let completed_text = if should_prefer_turn_result_text(result.as_ref()) {
                    fallback_text
                } else if accumulated_agent_text.trim().is_empty() {
                    fallback_text
                } else {
                    accumulated_agent_text.clone()
                };
                // Use text-lane id so the frontend upserts the streamed bubble.
                if !completed_text.trim().is_empty() {
                    let completion_item_id =
                        gemini_agent_completion_item_id(&render_state, &item_id_clone);
                    let synthetic = AppServerEvent {
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
                    };
                    app_server_events.push(synthetic);
                }
            }

            if let Some(payload) = engine_event_to_app_server_event_with_turn_context(
                &event,
                &current_thread_id,
                &routed_item_id,
                Some(&turn_id_for_forwarder),
            ) {
                app_server_events.push(payload);
            }
            fan_out_provider_engine_event(
                &app_clone,
                &provider_runtime_key_for_forwarder,
                EngineType::Grok,
                &turn_id_for_forwarder,
                native_session_id_for_forwarder.as_deref(),
                &event,
                app_server_events,
            );

            if let EngineEvent::SessionStarted {
                session_id, engine, ..
            } = &event
            {
                if !session_id.is_empty() && session_id != "pending" {
                    if matches!(engine, EngineType::Grok) {
                        current_thread_id = format!("grok:{}", session_id);
                        native_session_id_for_forwarder = Some(session_id.clone());
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
        if let Err(e) = session_clone.send_message(params, &turn_id_clone).await {
            log::error!("Grok send_message failed: {}", e);
        }
    });
    if let (Some(session_id), Some(metadata)) =
        (response_session_id.as_deref(), auto_session.clone())
    {
        record_auto_session_metadata_if_present(
            &state,
            &workspace_id,
            Some(session_id),
            Some(metadata),
            "grok",
        )
        .await;
    }

    Ok(json!({
        "engine": "grok",
        "sessionId": response_session_id,
        "result": {
            "turn": {
                "id": turn_id,
                "status": "started"
            },
        },
        "mossxDispatchReceipt": dispatch_receipt,
        "turn": {
            "id": turn_id,
            "status": "started"
        }
    }))
}

pub(crate) async fn engine_send_message_dsh(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    thread_id: Option<String>,
    session_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
    settings: crate::types::AppSettings,
) -> Result<Value, String> {
    let workspace_path = {
        let workspaces = state.workspaces.lock().await;
        workspaces
            .get(&workspace_id)
            .map(|w| std::path::PathBuf::from(&w.path))
            .ok_or_else(|| "Workspace not found".to_string())?
    };
    let runtime = crate::engine::dsh::runtime_settings_from_app(&settings);
    let resume_id = session_id.as_deref().or(thread_id.as_deref());
    let outcome = crate::engine::dsh::send_user_turn(
        &runtime,
        Some(app.clone()),
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
    record_auto_session_metadata_if_present(
        &state,
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
                "status": "started"
            },
        },
        "turn": {
            "id": outcome.turn_id,
            "status": "started"
        }
    }))
}

/// Send a message using the active engine
/// For Claude: spawns async tasks for streaming events to the frontend
/// via app-server-event, returns immediately with turn ID.
#[tauri::command]
pub async fn engine_send_message(
    workspace_id: String,
    text: String,
    engine: Option<EngineType>,
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
    auto_session: Option<AutoSessionMetadata>,
    skill_invocations: Option<Vec<crate::types::SkillInvocation>>,
    dsh_agent_preset: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    let requested_engine = engine;
    if let Some(invocations) = skill_invocations.as_ref().filter(|list| !list.is_empty()) {
        // 契约通道已落地：接收并记录，引擎侧消费属后续协议演进。
        log::debug!(
            "[engine_send_message] skill_invocations received: count={} names={:?}",
            invocations.len(),
            invocations
                .iter()
                .map(|invocation| invocation.name.as_str())
                .collect::<Vec<_>>()
        );
    }
    let settings = read_app_settings_snapshot(&state).await;

    if remote_backend::is_remote_mode(&*state).await {
        let remote_engine = validate_remote_requested_engine(&settings, requested_engine)?;
        let images = images.map(|paths| {
            paths
                .into_iter()
                .map(remote_backend::normalize_path_for_remote)
                .collect::<Vec<_>>()
        });
        return remote_backend::call_remote(
            &*state,
            app,
            "engine_send_message",
            json!({
                "workspaceId": workspace_id,
                "text": text,
                "engine": remote_engine,
                "model": model,
                "effort": effort,
                "disableThinking": disable_thinking.unwrap_or(false),
                "accessMode": access_mode,
                "images": images,
                "continueSession": continue_session,
                "threadId": thread_id,
                "sessionId": session_id,
                "forkSessionId": fork_session_id,
                "agent": agent,
                "variant": variant,
                "providerProfileId": provider_profile_id,
                "customSpecRoot": custom_spec_root,
                "autoSession": auto_session,
                "skillInvocations": skill_invocations,
                "dshAgentPreset": dsh_agent_preset,
            }),
        )
        .await;
    }

    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let effective_engine =
        resolve_enabled_engine_for_send(&settings, requested_engine, active_engine)?;
    // Capability gate follows EngineFeatures; all current engines allow images.
    require_image_support(effective_engine, &images)?;
    log::info!(
        "[engine_send_message] engine={:?} active_engine={:?} workspace_id={} model={:?} continue_session={} thread_id={:?} session_id={:?} fork_session_id={:?} agent={:?} variant={:?} provider_profile_id={:?} dsh_agent_preset={:?}",
        effective_engine,
        active_engine,
        workspace_id,
        model,
        continue_session,
        thread_id,
        session_id,
        fork_session_id,
        agent,
        variant,
        provider_profile_id,
        dsh_agent_preset
    );
    if let Some(explicit_engine) = requested_engine {
        if explicit_engine != active_engine {
            log::warn!(
                "[engine_send_message] explicit engine {:?} overrides active engine {:?}",
                explicit_engine,
                active_engine
            );
        }
    }
    let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root.as_deref());

    match effective_engine {
        EngineType::Claude => {
            engine_send_message_claude(
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
                provider_profile_id,
                auto_session,
                app,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Codex => engine_send_message_codex().await,
        EngineType::OpenCode => {
            engine_send_message_opencode(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                thread_id,
                session_id,
                agent,
                variant,
                provider_profile_id,
                auto_session,
                app,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Gemini => {
            engine_send_message_gemini(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                thread_id,
                session_id,
                auto_session,
                app,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Kimi => {
            engine_send_message_kimi(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                thread_id,
                session_id,
                provider_profile_id,
                auto_session,
                app,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Pi => {
            engine_send_message_pi(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                thread_id,
                session_id,
                provider_profile_id,
                auto_session,
                app,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Qoder => {
            engine_send_message_qoder(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                thread_id,
                session_id,
                fork_session_id,
                provider_profile_id,
                auto_session,
                app,
                state,
                settings,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Grok => {
            engine_send_message_grok(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                thread_id,
                session_id,
                provider_profile_id,
                auto_session,
                app,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Dsh => {
            engine_send_message_dsh(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                thread_id,
                session_id,
                auto_session,
                dsh_agent_preset,
                app,
                state,
                settings,
            )
            .await
        }
    }
}
