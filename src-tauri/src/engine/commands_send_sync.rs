//! `engine_send_message_sync` and its per-engine arm implementations, split from `commands.rs`.

use super::*;

pub(crate) async fn engine_send_message_sync_claude(
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
    auto_session: Option<AutoSessionMetadata>,
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
        .get_claude_session(&workspace_id, &workspace_path)
        .await;

    let has_images = has_non_empty_images(&images);
    let normalized_fork_session_id = fork_session_id
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    if fork_session_id.is_some() && normalized_fork_session_id.is_none() {
        return Err("forkSessionId is required for Claude fork session".to_string());
    }
    let continue_session_for_send = continue_session;

    let resolved_session_id = resolve_claude_session_id_for_engine_send(
        normalized_fork_session_id.as_deref(),
        session_id,
        continue_session,
        session.get_session_id().await,
    );

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

    let turn_id = format!("claude-sync-{}", uuid::Uuid::new_v4());
    let send_result = timeout(Duration::from_secs(900), async {
        if has_images {
            session.send_message(params, &turn_id).await
        } else {
            session
                .send_message_with_auto_compact_retry(params, &turn_id)
                .await
        }
    })
    .await
    .map_err(|_| "Claude response timed out".to_string())
    .and_then(|result| result);
    let observed_session_id = if send_result.is_err() {
        session.get_session_id().await
    } else {
        None
    };
    record_claude_auto_session_metadata_for_sync_result(
        &state.workspaces,
        state.storage_path.as_path(),
        &workspace_id,
        send_result.is_ok(),
        response_session_id.as_deref(),
        observed_session_id.as_deref(),
        auto_session,
    )
    .await;
    let response = send_result?;

    Ok(json!({
        "engine": "claude",
        "sessionId": response_session_id,
        "text": response
    }))
}

pub(crate) async fn engine_send_message_sync_opencode(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    agent: Option<String>,
    variant: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
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

    let effective_provider_profile_id = {
        let from_session = crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            session_id.as_deref(),
            "opencode",
            None,
        )?;
        if from_session.is_some() {
            from_session
        } else {
            crate::vendors::read_config()
                .ok()
                .and_then(|config| config.opencode.current)
        }
    };
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
    let model_for_send = sanitized_model.or_else(|| Some("opencode/big-pickle".to_string()));

    let params = crate::engine::SendMessageParams {
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
    let response = timeout(
        Duration::from_secs(900),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| "OpenCode response timed out".to_string())??;
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        let binding_session_id = response_session_id.as_deref().unwrap_or(turn_id.as_str());
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
    record_auto_session_metadata_if_present(
        &state,
        &workspace_id,
        response_session_id.as_deref(),
        auto_session,
        "opencode",
    )
    .await;

    Ok(json!({
        "engine": "opencode",
        "sessionId": response_session_id,
        "text": response
    }))
}

pub(crate) async fn engine_send_message_sync_codex(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    auto_session: Option<AutoSessionMetadata>,
    app: AppHandle,
    state: State<'_, AppState>,
    normalized_custom_spec_root: Option<String>,
) -> Result<Value, String> {
    let response = run_codex_prompt_sync(
        &workspace_id,
        &text,
        model,
        effort,
        access_mode,
        images,
        normalized_custom_spec_root.clone(),
        auto_session.clone(),
        &app,
        &state,
    )
    .await?;

    Ok(json!({
        "engine": "codex",
        "text": response
    }))
}

pub(crate) async fn engine_send_message_sync_gemini(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
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

    let turn_id = format!("gemini-sync-{}", uuid::Uuid::new_v4());
    let response = session
        .send_message_with_timeout(params, &turn_id, Duration::from_secs(900))
        .await?;
    record_auto_session_metadata_if_present(
        &state,
        &workspace_id,
        response_session_id.as_deref(),
        auto_session,
        "gemini",
    )
    .await;

    Ok(json!({
        "engine": "gemini",
        "sessionId": response_session_id,
        "text": response
    }))
}

pub(crate) async fn engine_send_message_sync_kimi(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
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

    // 与 async send 对齐：无 session 绑定时回落到 vendors.kimi.current，
    // 让 commit-message 等 helper 也能吃到 managed provider 的 API key。
    let effective_provider_profile_id = {
        let from_session = crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            session_id.as_deref(),
            "kimi",
            None,
        )?;
        if from_session.is_some() {
            from_session
        } else {
            crate::vendors::read_config()
                .ok()
                .and_then(|config| config.kimi.current)
        }
    };
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
    let runtime_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

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

    let turn_id = format!("kimi-sync-{}", uuid::Uuid::new_v4());
    let response = timeout(
        Duration::from_secs(900),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| "Kimi response timed out".to_string())??;
    let response_session_id = session.get_session_id().await;
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        let binding_session_id = response_session_id.as_deref().unwrap_or(turn_id.as_str());
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
    record_auto_session_metadata_if_present(
        &state,
        &workspace_id,
        response_session_id.as_deref(),
        auto_session,
        "kimi",
    )
    .await;

    Ok(json!({
        "engine": "kimi",
        "sessionId": response_session_id,
        "text": response
    }))
}

pub(crate) async fn engine_send_message_sync_pi(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
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

    let effective_provider_profile_id =
        crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            session_id.as_deref(),
            "pi",
            None,
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
    let runtime_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

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

    let turn_id = format!("pi-sync-{}", uuid::Uuid::new_v4());
    let response = timeout(
        Duration::from_secs(900),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| "PI response timed out".to_string())??;
    let response_session_id = session.get_session_id().await;
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        let binding_session_id = response_session_id.as_deref().unwrap_or(turn_id.as_str());
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
    record_auto_session_metadata_if_present(
        &state,
        &workspace_id,
        response_session_id.as_deref(),
        auto_session,
        "pi",
    )
    .await;

    Ok(json!({
        "engine": "pi",
        "sessionId": response_session_id,
        "text": response
    }))
}

pub(crate) async fn engine_send_message_sync_qoder(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    fork_session_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
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

    let effective_provider_profile_id =
        crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            session_id.as_deref(),
            "qoder",
            None,
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
    let runtime_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

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

    let turn_id = format!("qoder-sync-{}", uuid::Uuid::new_v4());
    let response = timeout(
        Duration::from_secs(900),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| "Qoder response timed out".to_string())??;
    let response_session_id = session.get_session_id().await;
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        let binding_session_id = response_session_id.as_deref().unwrap_or(turn_id.as_str());
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
    let metadata_session_id = response_session_id.as_deref().and_then(|session_id| {
        match crate::engine::qoder_provider_profile::canonical_qoder_native_session_id(
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
    record_auto_session_metadata_if_present(
        &state,
        &workspace_id,
        metadata_session_id.as_deref(),
        auto_session,
        "qoder",
    )
    .await;

    Ok(json!({
        "engine": "qoder",
        "sessionId": response_session_id,
        "text": response
    }))
}

pub(crate) async fn engine_send_message_sync_grok(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
    session_id: Option<String>,
    auto_session: Option<AutoSessionMetadata>,
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

    // 根因：旧 sync 路径走 bare get_or_create_grok_session（无 provider home），
    // 导致 managed Grok API key 不会被注入，commit-message 出现 401 Unauthorized。
    let effective_provider_profile_id = {
        let from_session = crate::session_management::resolve_engine_provider_profile_id(
            state.storage_path.as_path(),
            &workspace_id,
            session_id.as_deref(),
            "grok",
            None,
        )?;
        if from_session.is_some() {
            from_session
        } else {
            crate::vendors::read_config()
                .ok()
                .and_then(|config| config.grok.current)
        }
    };
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
    let runtime_model = model
        .as_ref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .or_else(|| {
            // managed provider 时若未显式传 model，用 provider 配置的默认 model
            effective_provider_profile_id
                .as_deref()
                .and_then(|profile_id| {
                    crate::engine::grok_provider_profile::resolve_grok_provider_model_config(
                        profile_id,
                    )
                    .ok()
                    .flatten()
                    .map(|provider| provider.model)
                    .filter(|value| !value.trim().is_empty())
                })
        });

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

    let turn_id = format!("grok-sync-{}", uuid::Uuid::new_v4());
    let response = timeout(
        Duration::from_secs(900),
        session.send_message(params, &turn_id),
    )
    .await
    .map_err(|_| "Grok response timed out".to_string())??;
    let response_session_id = session.get_session_id().await;
    if let Some(binding) = provider_launch_profile.binding.as_ref() {
        let binding_session_id = response_session_id.as_deref().unwrap_or(turn_id.as_str());
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
    record_auto_session_metadata_if_present(
        &state,
        &workspace_id,
        response_session_id.as_deref(),
        auto_session,
        "grok",
    )
    .await;

    Ok(json!({
        "engine": "grok",
        "sessionId": response_session_id,
        "text": response
    }))
}

pub(crate) async fn engine_send_message_sync_dsh(
    workspace_id: String,
    text: String,
    model: Option<String>,
    effort: Option<String>,
    access_mode: Option<String>,
    images: Option<Vec<String>>,
    continue_session: bool,
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
    let resume_id = session_id.as_deref();
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
    let (_snapshot, client) = crate::engine::dsh::ensure_ready(&runtime).await?;
    let response = crate::engine::dsh::collect_turn_text(
        &client,
        &outcome.native_session_id,
        outcome.turn_waiter,
        Duration::from_secs(900),
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
        "text": response
    }))
}

/// Send a message and wait for the final plain-text response from the selected engine.
#[tauri::command]
pub async fn engine_send_message_sync(
    workspace_id: String,
    text: String,
    engine: Option<EngineType>,
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
    auto_session: Option<AutoSessionMetadata>,
    dsh_agent_preset: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    if text.trim().is_empty() {
        return Err("Prompt text cannot be empty".to_string());
    }
    let settings = read_app_settings_snapshot(&state).await;

    if remote_backend::is_remote_mode(&*state).await {
        let remote_engine = validate_remote_requested_engine(&settings, engine)?;
        let (method, params) = remote_engine_send_message_sync_request(
            workspace_id,
            text,
            remote_engine,
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
            custom_spec_root,
            auto_session,
            dsh_agent_preset,
        );
        return remote_backend::call_remote(&*state, app, method, params).await;
    }

    let manager = &state.engine_manager;
    let active_engine = manager.get_active_engine().await;
    let effective_engine = resolve_enabled_engine_for_send(&settings, engine, active_engine)?;
    // Capability gate follows EngineFeatures; all current engines allow images.
    require_image_support(effective_engine, &images)?;
    let normalized_custom_spec_root = normalize_custom_spec_root(custom_spec_root.as_deref());

    match effective_engine {
        EngineType::Claude => {
            engine_send_message_sync_claude(
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
                auto_session,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::OpenCode => {
            engine_send_message_sync_opencode(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                session_id,
                agent,
                variant,
                auto_session,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Codex => {
            engine_send_message_sync_codex(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                auto_session,
                app,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Gemini => {
            engine_send_message_sync_gemini(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                session_id,
                auto_session,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Kimi => {
            engine_send_message_sync_kimi(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                session_id,
                auto_session,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Pi => {
            engine_send_message_sync_pi(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                session_id,
                auto_session,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Qoder => {
            engine_send_message_sync_qoder(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                session_id,
                fork_session_id,
                auto_session,
                state,
                settings,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Grok => {
            engine_send_message_sync_grok(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
                session_id,
                auto_session,
                state,
                normalized_custom_spec_root,
            )
            .await
        }
        EngineType::Dsh => {
            engine_send_message_sync_dsh(
                workspace_id,
                text,
                model,
                effort,
                access_mode,
                images,
                continue_session,
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
