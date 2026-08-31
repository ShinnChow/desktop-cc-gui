use super::*;

impl DaemonState {
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn engine_send_message_sync(
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
        session_id: Option<String>,
        fork_session_id: Option<String>,
        agent: Option<String>,
        variant: Option<String>,
        custom_spec_root: Option<String>,
        auto_session: Option<session_management::AutoSessionMetadata>,
        dsh_agent_preset: Option<String>,
    ) -> Result<Value, String> {
        self.sync_engine_configs().await;
        if text.trim().is_empty() {
            return Err("Prompt text cannot be empty".to_string());
        }
        let active_engine = self.get_active_engine().await;
        let effective_engine = engine.unwrap_or(active_engine);
        let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root);
        // Snapshot AppSettings so engine send paths can apply the current
        // curated-skill transport policy without reading settings mid-turn.
        let settings = self.app_settings.lock().await.clone();
        engine::ensure_engine_enabled(&settings, effective_engine)?;

        match effective_engine {
            engine::EngineType::Codex => Err(
                "engine_send_message_sync for codex is not supported in daemon mode".to_string(),
            ),
            engine::EngineType::Claude => {
                engine_send_message_sync_claude(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::OpenCode => {
                engine_send_message_sync_opencode(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Gemini => {
                engine_send_message_sync_gemini(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Kimi => {
                engine_send_message_sync_kimi(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Pi => {
                engine_send_message_sync_pi(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Qoder => {
                engine_send_message_sync_qoder(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Grok => {
                engine_send_message_sync_grok(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
                    auto_session,
                    dsh_agent_preset,
                    settings,
                    normalized_custom_spec_root,
                )
                .await
            }
            engine::EngineType::Dsh => {
                engine_send_message_sync_dsh(
                    self,
                    workspace_id,
                    text,
                    model,
                    effort,
                    disable_thinking,
                    access_mode,
                    images,
                    continue_session,
                    session_id,
                    fork_session_id,
                    agent,
                    variant,
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
async fn engine_send_message_sync_claude(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let session = state
        .engine_manager
        .get_claude_session(&workspace_id, &workspace_path)
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
    } else if session_id.is_some() {
        session_id
    } else if continue_session {
        session.get_session_id().await
    } else {
        None
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
    let response_session_id = resolved_session_id.clone();
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
    let turn_id = format!("claude-sync-{}", uuid::Uuid::new_v4());
    let response = tokio::time::timeout(std::time::Duration::from_secs(900), async {
        if has_images {
            session
                .send_message_with_app_settings(params, &turn_id, Some(&settings))
                .await
        } else {
            session
                .send_message_with_auto_compact_retry_with_app_settings(
                    params,
                    &turn_id,
                    Some(&settings),
                )
                .await
        }
    })
    .await
    .map_err(|_| "Claude response timed out".to_string())??;
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
        "sessionId": response_session_id,
        "text": response,
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_sync_opencode(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let session = state
        .engine_manager
        .get_or_create_opencode_session(&workspace_id, &workspace_path)
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
    let model_for_send = sanitized_model.or_else(|| Some("opencode/big-pickle".to_string()));
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
    let turn_id = format!("opencode-sync-{}", uuid::Uuid::new_v4());
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(900),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| "OpenCode response timed out".to_string())??;
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
        "text": response,
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_sync_gemini(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
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
    let turn_id = format!("gemini-sync-{}", uuid::Uuid::new_v4());
    let response = session
        .send_message_with_timeout(params, &turn_id, std::time::Duration::from_secs(900))
        .await?;
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
        "text": response,
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_sync_kimi(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let session = state
        .engine_manager
        .get_or_create_kimi_session(&workspace_id, &workspace_path)
        .await;
    let resolved_session_id = resolve_kimi_session_id_for_engine_send(
        continue_session,
        session_id,
        session.get_session_id().await,
    );
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
    let turn_id = format!("kimi-sync-{}", uuid::Uuid::new_v4());
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(900),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| "Kimi response timed out".to_string())??;
    let response_session_id = session.get_session_id().await;
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
        "text": response,
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_sync_pi(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let provider_launch_profile =
        engine::pi_provider_profile::resolve_pi_provider_launch_profile(&workspace_id, None, None)?;
    let session = state
        .engine_manager
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
    let turn_id = format!("pi-sync-{}", uuid::Uuid::new_v4());
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(900),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| "PI response timed out".to_string())??;
    let response_session_id = session.get_session_id().await;
    state
        .record_auto_session_metadata_if_present(
            &workspace_id,
            response_session_id.as_deref(),
            auto_session,
            "pi",
        )
        .await;
    Ok(json!({
        "engine": "pi",
        "sessionId": response_session_id,
        "text": response,
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_sync_qoder(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let effective_provider_profile_id = session_management::resolve_engine_provider_profile_id(
        state.storage_path.as_path(),
        &workspace_id,
        session_id.as_deref(),
        "qoder",
        None,
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
    let turn_id = format!("qoder-sync-{}", uuid::Uuid::new_v4());
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(900),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| "Qoder response timed out".to_string())??;
    let response_session_id = session.get_session_id().await;
    if let (Some(session_id), Some(binding)) = (
        response_session_id.as_deref(),
        provider_launch_profile.binding.as_ref(),
    ) {
        session_management::record_engine_provider_binding_core(
            &state.workspaces,
            state.storage_path.as_path(),
            workspace_id.clone(),
            session_id.to_string(),
            "qoder".to_string(),
            binding.clone(),
        )
        .await?;
    }
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
        "text": response,
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_sync_grok(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let session = state
        .engine_manager
        .get_or_create_grok_session(&workspace_id, &workspace_path)
        .await;
    let resolved_session_id = resolve_grok_session_id_for_engine_send(
        continue_session,
        session_id,
        session.get_session_id().await,
    );
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
    let turn_id = format!("grok-sync-{}", uuid::Uuid::new_v4());
    let response = tokio::time::timeout(
        std::time::Duration::from_secs(900),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| "Grok response timed out".to_string())??;
    let response_session_id = session.get_session_id().await;
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
        "text": response,
    }))
}

#[allow(clippy::too_many_arguments)]
#[allow(unused_variables)]
async fn engine_send_message_sync_dsh(
    state: &DaemonState,
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    disable_thinking: Option<bool>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    auto_session: Option<session_management::AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    settings: AppSettings,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let workspace_path = state.workspace_path_for_engine(&workspace_id).await?;
    let runtime = engine::dsh::runtime_settings_from_app(&settings);
    let resume_id = session_id.as_deref();
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
    let (_snapshot, client) = engine::dsh::ensure_ready(&runtime).await?;
    let response = engine::dsh::collect_turn_text(
        &client,
        &outcome.native_session_id,
        outcome.turn_waiter,
        std::time::Duration::from_secs(900),
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
        "text": response,
    }))
}
