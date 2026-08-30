use super::*;

impl DaemonState {
    pub(crate) async fn start_thread(
        &self,
        workspace_id: String,
        auto_session: Option<session_management::AutoSessionMetadata>,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let _provider_profile_id = normalize_daemon_disk_provider_profile(provider_profile_id)?;
        let response = run_daemon_disk_start_thread_with_readiness(
            &workspace_id,
            || self.ensure_codex_session_for_workspace(&workspace_id),
            || codex_core::start_thread_core(&self.sessions, workspace_id.clone(), None, None),
            |thread_id| {
                codex_core::confirm_thread_ready_after_start_core(
                    &self.sessions,
                    workspace_id.clone(),
                    None,
                    thread_id,
                )
            },
        )
        .await?;
        let thread_id = codex_core::extract_thread_id_from_response(&response);
        self.record_auto_session_metadata_if_present(
            &workspace_id,
            thread_id.as_deref(),
            auto_session,
            "codex",
        )
        .await;
        Ok(response)
    }

    pub(crate) async fn resume_thread(
        &self,
        workspace_id: String,
        thread_id: String,
    ) -> Result<Value, String> {
        codex_core::resume_thread_core(&self.sessions, workspace_id, None, thread_id).await
    }

    pub(crate) async fn fork_thread(
        &self,
        workspace_id: String,
        thread_id: String,
        message_id: Option<String>,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let _provider_profile_id = normalize_daemon_disk_provider_profile(provider_profile_id)?;
        codex_core::fork_thread_core(&self.sessions, workspace_id, None, thread_id, message_id)
            .await
    }

    pub(crate) async fn rewind_codex_thread(
        &self,
        workspace_id: String,
        thread_id: String,
        message_id: Option<String>,
        target_user_turn_index: u32,
        target_user_message_text: Option<String>,
        target_user_message_occurrence: Option<u32>,
        local_user_message_count: Option<u32>,
    ) -> Result<Value, String> {
        self.ensure_codex_session_for_workspace(&workspace_id)
            .await?;
        let rewind_response = crate::codex::rewind::rewind_thread_from_message(
            &self.sessions,
            &self.workspaces,
            workspace_id.clone(),
            None,
            thread_id,
            message_id,
            target_user_turn_index,
            target_user_message_text,
            target_user_message_occurrence,
            local_user_message_count,
        )
        .await?;

        let rewound_thread_id = rewind_response
            .get("thread")
            .and_then(|thread| thread.get("id"))
            .or_else(|| rewind_response.get("threadId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
            .ok_or_else(|| "codex rewind response missing child thread id".to_string())?;

        workspaces_core::disconnect_workspace_session_core(
            &self.sessions,
            Some(&self.runtime_manager),
            &workspace_id,
        )
        .await;
        self.ensure_codex_session_for_workspace(&workspace_id)
            .await?;
        codex_core::resume_thread_core(&self.sessions, workspace_id, None, rewound_thread_id)
            .await?;

        Ok(rewind_response)
    }

    pub(crate) async fn list_threads(
        &self,
        workspace_id: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, String> {
        let live_result = tokio::time::timeout(
            Duration::from_millis(LIST_THREADS_LIVE_TIMEOUT_MS),
            codex_core::list_threads_core(
                &self.sessions,
                workspace_id.clone(),
                None,
                cursor.clone(),
                limit,
            ),
        )
        .await
        .map_err(|_| {
            format!(
                "live thread/list timed out after {}ms",
                LIST_THREADS_LIVE_TIMEOUT_MS
            )
        })
        .and_then(|value| value);

        match live_result {
            Ok(response) => Ok(response),
            Err(live_error) => {
                log::debug!(
                    "[daemon:list_threads] Live Codex thread list unavailable for {}: {}",
                    workspace_id,
                    live_error
                );
                let requested_limit = limit.unwrap_or(50).clamp(1, 200) as usize;
                let requested_offset = parse_codex_daemon_local_thread_cursor(cursor.as_deref());
                let requested_scan_limit = requested_offset
                    .saturating_add(requested_limit)
                    .saturating_add(1)
                    .max(1);
                let local_result = tokio::time::timeout(
                    Duration::from_millis(CODEX_DAEMON_LOCAL_THREAD_LIST_TIMEOUT_MS),
                    local_usage::list_codex_session_previews_for_workspace(
                        &self.workspaces,
                        &workspace_id,
                        requested_scan_limit,
                    ),
                )
                .await;
                let (workspace_path, local_sessions) = match local_result {
                    Ok(Ok(value)) => value,
                    Ok(Err(local_error)) => {
                        if local_error
                            .to_ascii_lowercase()
                            .contains("workspace not found")
                        {
                            return Err(local_error);
                        }
                        log::debug!(
                            "[daemon:list_threads] Local Codex thread fallback unavailable for {}: {}",
                            workspace_id,
                            local_error
                        );
                        return Ok(build_codex_daemon_empty_thread_response(
                            CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE,
                        ));
                    }
                    Err(_) => {
                        log::debug!(
                            "[daemon:list_threads] Local Codex thread fallback timed out for {} after {}ms",
                            workspace_id,
                            CODEX_DAEMON_LOCAL_THREAD_LIST_TIMEOUT_MS
                        );
                        return Ok(build_codex_daemon_empty_thread_response(
                            CODEX_DAEMON_LOCAL_THREAD_LIST_PARTIAL_SOURCE,
                        ));
                    }
                };
                let folder_id_by_session_id =
                    session_management::read_workspace_session_folder_assignments(
                        self.storage_path.as_path(),
                        &workspace_id,
                    )
                    .unwrap_or_default();
                Ok(build_codex_daemon_local_thread_response(
                    &workspace_path,
                    local_sessions,
                    cursor.as_deref(),
                    limit,
                    &folder_id_by_session_id,
                ))
            }
        }
    }

    pub(crate) async fn opencode_session_list(
        &self,
        workspace_id: String,
    ) -> Result<Vec<OpenCodeSessionEntry>, String> {
        let settings = self.app_settings.lock().await.clone();
        if !engine::engine_enabled_in_settings(&settings, engine::EngineType::OpenCode) {
            return Err(
                engine::engine_disabled_diagnostic(engine::EngineType::OpenCode)
                    .unwrap_or("OpenCode CLI is disabled in CLI validation settings")
                    .to_string(),
            );
        }
        let workspace_path = {
            let workspaces = self.workspaces.lock().await;
            workspaces
                .get(&workspace_id)
                .map(|workspace| PathBuf::from(&workspace.path))
                .ok_or_else(|| "Workspace not found".to_string())?
        };
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::OpenCode)
            .await;
        let mut cmd = build_opencode_command(config.as_ref())?;
        cmd.current_dir(&workspace_path);
        cmd.arg("session");
        cmd.arg("list");
        cmd.arg("--format");
        cmd.arg("json");
        let output = cmd
            .output()
            .await
            .map_err(|error| format!("Failed to execute opencode session list: {error}"))?;
        if !output.status.success() {
            let stderr = strip_ansi_codes(&String::from_utf8_lossy(&output.stderr));
            return Err(format!("opencode session list failed: {}", stderr.trim()));
        }
        let stdout = String::from_utf8_lossy(&output.stdout);
        let raw = parse_opencode_session_list(&stdout);
        // Prefer the engine helper when available; daemon-local parse already
        // returns directory fields from JSON so re-apply the same ownership filter.
        Ok(raw
            .into_iter()
            .filter(|entry| {
                entry
                    .directory
                    .as_deref()
                    .map(|directory| {
                        crate::local_usage::path_matches_workspace(directory, &workspace_path)
                    })
                    .unwrap_or(false)
            })
            .collect())
    }

    pub(crate) async fn list_claude_sessions(
        &self,
        workspace_path: String,
        limit: Option<usize>,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Claude)
            .await;
        let sessions =
            engine::claude_history::list_claude_sessions_with_config(&path, limit, config.as_ref())
                .await?;
        serde_json::to_value(sessions).map_err(|error| error.to_string())
    }

    pub(crate) async fn load_claude_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Claude)
            .await;
        let result = engine::claude_history::load_claude_session_with_config(
            &path,
            &session_id,
            config.as_ref(),
        )
        .await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    pub(crate) async fn load_codex_session(
        &self,
        workspace_id: String,
        session_id: String,
    ) -> Result<Value, String> {
        local_usage::load_codex_session_for_workspace(&self.workspaces, workspace_id, session_id)
            .await
    }

    pub(crate) async fn hydrate_claude_deferred_image(
        &self,
        workspace_path: String,
        locator: Value,
    ) -> Result<Value, String> {
        let locator = serde_json::from_value(locator)
            .map_err(|error| format!("Invalid Claude deferred image locator: {error}"))?;
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Claude)
            .await;
        let result = engine::claude_history::hydrate_claude_deferred_image_with_config(
            &path,
            locator,
            config.as_ref(),
        )
        .await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    pub(crate) async fn fork_claude_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Claude)
            .await;
        let forked_session_id = engine::claude_history::fork_claude_session_with_config(
            &path,
            &session_id,
            config.as_ref(),
        )
        .await?;
        Ok(json!({
            "thread": {
                "id": format!("claude:{}", forked_session_id)
            },
            "sessionId": forked_session_id
        }))
    }

    pub(crate) async fn fork_claude_session_from_message(
        &self,
        workspace_path: String,
        session_id: String,
        message_id: String,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Claude)
            .await;
        let forked_session_id =
            engine::claude_history::fork_claude_session_from_message_with_config(
                &path,
                &session_id,
                &message_id,
                config.as_ref(),
            )
            .await?;
        Ok(json!({
            "thread": {
                "id": format!("claude:{}", forked_session_id)
            },
            "sessionId": forked_session_id
        }))
    }

    pub(crate) async fn delete_claude_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<(), String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Claude)
            .await;
        engine::claude_history::delete_claude_session_with_config(
            &path,
            &session_id,
            config.as_ref(),
        )
        .await
    }

    pub(crate) async fn list_gemini_sessions(
        &self,
        workspace_path: String,
        limit: Option<usize>,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Gemini)
            .await;
        let sessions = engine::gemini_history::list_gemini_sessions(
            &path,
            limit,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await?;
        serde_json::to_value(sessions).map_err(|error| error.to_string())
    }

    pub(crate) async fn load_gemini_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Gemini)
            .await;
        let result = engine::gemini_history::load_gemini_session(
            &path,
            &session_id,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    pub(crate) async fn delete_gemini_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<(), String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Gemini)
            .await;
        engine::gemini_history::delete_gemini_session(
            &path,
            &session_id,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await
    }

    pub(crate) async fn list_kimi_sessions(
        &self,
        workspace_path: String,
        limit: Option<usize>,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Kimi)
            .await;
        let sessions = engine::kimi_history::list_kimi_sessions(
            &path,
            limit,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await?;
        serde_json::to_value(sessions).map_err(|error| error.to_string())
    }

    pub(crate) async fn load_kimi_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Kimi)
            .await;
        let result = engine::kimi_history::load_kimi_session(
            &path,
            &session_id,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    pub(crate) async fn delete_kimi_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<(), String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Kimi)
            .await;
        engine::kimi_history::delete_kimi_session(
            &path,
            &session_id,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await
    }
}
