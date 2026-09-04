use super::*;

impl DaemonState {
    pub(crate) async fn list_grok_sessions(
        &self,
        workspace_path: String,
        limit: Option<usize>,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Grok)
            .await;
        let sessions = engine::grok_history::list_grok_sessions(
            &path,
            limit,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await?;
        serde_json::to_value(sessions).map_err(|error| error.to_string())
    }

    pub(crate) async fn load_grok_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Grok)
            .await;
        let result = engine::grok_history::load_grok_session(
            &path,
            &session_id,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    pub(crate) async fn delete_grok_session(
        &self,
        workspace_path: String,
        session_id: String,
    ) -> Result<(), String> {
        let path = PathBuf::from(workspace_path);
        let config = self
            .engine_manager
            .get_engine_config(engine::EngineType::Grok)
            .await;
        engine::grok_history::delete_grok_session(
            &path,
            &session_id,
            config.as_ref().and_then(|item| item.home_dir.as_deref()),
        )
        .await
    }

    /// pi 族共享解析（add-omp-engine，与 app 侧 commands_pi_rpc.rs 同形同步）。
    async fn resolve_pi_family_session_for_rpc(
        &self,
        engine: engine::EngineType,
        workspace_id: &str,
        provider_profile_id: Option<&str>,
    ) -> Result<std::sync::Arc<engine::pi::PiSession>, String> {
        let workspace_path = {
            let workspaces = self.workspaces.lock().await;
            workspaces
                .get(workspace_id)
                .map(|entry| std::path::PathBuf::from(&entry.path))
                .ok_or_else(|| "Workspace not found".to_string())?
        };
        let effective_provider_profile_id = session_management::resolve_engine_provider_profile_id(
            self.storage_path.as_path(),
            workspace_id,
            None,
            engine.icon(),
            provider_profile_id,
        )?;
        let provider_launch_profile =
            engine::pi_provider_profile::resolve_pi_family_provider_launch_profile(
                engine,
                workspace_id,
                effective_provider_profile_id.as_deref(),
                None,
            )?;
        Ok(self
            .engine_manager
            .get_or_create_pi_family_session_for_runtime(
                engine,
                workspace_id,
                &workspace_path,
                &provider_launch_profile.runtime_key,
                provider_launch_profile.home_dir.as_deref(),
            )
            .await)
    }

    async fn resolve_pi_session_for_rpc(
        &self,
        workspace_id: &str,
        provider_profile_id: Option<&str>,
    ) -> Result<std::sync::Arc<engine::pi::PiSession>, String> {
        self.resolve_pi_family_session_for_rpc(
            engine::EngineType::Pi,
            workspace_id,
            provider_profile_id,
        )
        .await
    }

    pub(crate) async fn pi_get_session_stats(
        &self,
        workspace_id: String,
        session_id: Option<String>,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let session = self
            .resolve_pi_session_for_rpc(&workspace_id, provider_profile_id.as_deref())
            .await?;
        let client = session
            .rpc_client_for_commands(session_id.as_deref())
            .await?;
        client.get_session_stats().await
    }

    pub(crate) async fn pi_compact(
        &self,
        workspace_id: String,
        session_id: Option<String>,
        custom_instructions: Option<String>,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let session = self
            .resolve_pi_session_for_rpc(&workspace_id, provider_profile_id.as_deref())
            .await?;
        session
            .with_exclusive_rpc_command(session_id.as_deref(), |client| async move {
                client.compact(custom_instructions.as_deref()).await
            })
            .await
    }

    /// omp RPC 命令面（add-omp-engine）：omp 无 fork/tree，仅 stats/compact。
    pub(crate) async fn omp_get_session_stats(
        &self,
        workspace_id: String,
        session_id: Option<String>,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let session = self
            .resolve_pi_family_session_for_rpc(
                engine::EngineType::Omp,
                &workspace_id,
                provider_profile_id.as_deref(),
            )
            .await?;
        let client = session
            .rpc_client_for_commands(session_id.as_deref())
            .await?;
        client.get_session_stats().await
    }

    pub(crate) async fn omp_compact(
        &self,
        workspace_id: String,
        session_id: Option<String>,
        custom_instructions: Option<String>,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let session = self
            .resolve_pi_family_session_for_rpc(
                engine::EngineType::Omp,
                &workspace_id,
                provider_profile_id.as_deref(),
            )
            .await?;
        session
            .with_exclusive_rpc_command(session_id.as_deref(), |client| async move {
                client.compact(custom_instructions.as_deref()).await
            })
            .await
    }

    pub(crate) async fn pi_fork(
        &self,
        workspace_id: String,
        session_id: Option<String>,
        entry_id: String,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let session = self
            .resolve_pi_session_for_rpc(&workspace_id, provider_profile_id.as_deref())
            .await?;
        session
            .with_exclusive_rpc_command(session_id.as_deref(), |client| async move {
                let pre_state = client.get_state().await?;
                let pre_file = pre_state
                    .get("sessionFile")
                    .and_then(Value::as_str)
                    .map(str::to_string);
                let data = client.fork(&entry_id).await?;
                if let Some(path) = pre_file {
                    client.switch_session(&path).await?;
                }
                Ok(data)
            })
            .await
    }

    pub(crate) async fn pi_get_session_tree(
        &self,
        workspace_id: String,
        session_id: Option<String>,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let session = self
            .resolve_pi_session_for_rpc(&workspace_id, provider_profile_id.as_deref())
            .await?;
        let client = session
            .rpc_client_for_commands(session_id.as_deref())
            .await?;
        client.get_tree().await
    }

    pub(crate) async fn pi_get_fork_messages(
        &self,
        workspace_id: String,
        session_id: Option<String>,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let session = self
            .resolve_pi_session_for_rpc(&workspace_id, provider_profile_id.as_deref())
            .await?;
        let client = session
            .rpc_client_for_commands(session_id.as_deref())
            .await?;
        client.get_fork_messages().await
    }

    pub(crate) async fn list_qoder_sessions(
        &self,
        workspace_path: String,
        limit: Option<usize>,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let settings = self.app_settings.lock().await.clone();
        let launch_profile = engine::qoder_provider_profile::resolve_qoder_provider_launch_profile(
            &path.to_string_lossy(),
            provider_profile_id.as_deref(),
            &engine::qoder_provider_profile::QoderDistributionSettings::from_app_settings(
                &settings,
            ),
        )?;
        let sessions = engine::qoder_history::list_qoder_sessions_for_launch_profile(
            &path,
            limit,
            &launch_profile,
        )
        .await?;
        serde_json::to_value(sessions).map_err(|error| error.to_string())
    }

    pub(crate) async fn load_qoder_session(
        &self,
        workspace_path: String,
        session_id: String,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let path = PathBuf::from(workspace_path);
        let settings = self.app_settings.lock().await.clone();
        let launch_profile = engine::qoder_provider_profile::resolve_qoder_provider_launch_profile(
            &path.to_string_lossy(),
            provider_profile_id.as_deref(),
            &engine::qoder_provider_profile::QoderDistributionSettings::from_app_settings(
                &settings,
            ),
        )?;
        let result = engine::qoder_history::load_qoder_session_for_launch_profile(
            &path,
            &session_id,
            &launch_profile,
        )
        .await?;
        serde_json::to_value(result).map_err(|error| error.to_string())
    }

    pub(crate) async fn delete_qoder_session(
        &self,
        workspace_path: String,
        session_id: String,
        provider_profile_id: Option<String>,
    ) -> Result<(), String> {
        let path = PathBuf::from(workspace_path);
        let settings = self.app_settings.lock().await.clone();
        let launch_profile = engine::qoder_provider_profile::resolve_qoder_provider_launch_profile(
            &path.to_string_lossy(),
            provider_profile_id.as_deref(),
            &engine::qoder_provider_profile::QoderDistributionSettings::from_app_settings(
                &settings,
            ),
        )?;
        engine::qoder_history::delete_qoder_session_for_launch_profile(
            &path,
            &session_id,
            &launch_profile,
        )
        .await
    }

    pub(crate) async fn list_mcp_server_status(
        &self,
        workspace_id: String,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<Value, String> {
        codex_core::list_mcp_server_status_core(&self.sessions, workspace_id, None, cursor, limit)
            .await
    }

    pub(crate) async fn delete_codex_session(
        &self,
        workspace_id: String,
        session_id: String,
    ) -> Result<Value, String> {
        let normalized_session_id = session_id.trim().to_string();
        if normalized_session_id.is_empty() {
            return Err("session_id is required".to_string());
        }

        let archive_result = codex_core::archive_thread_best_effort_core(
            &self.sessions,
            workspace_id.clone(),
            None,
            normalized_session_id.clone(),
            Duration::from_millis(DELETE_ARCHIVE_TIMEOUT_MS),
        )
        .await;
        if let Err(error) = &archive_result {
            log::debug!(
                "[daemon delete_codex_session] Best-effort archive skipped for workspace {} session {}: {}",
                workspace_id,
                normalized_session_id,
                error
            );
        }

        let deleted_count = local_usage::delete_codex_session_for_workspace(
            &self.workspaces,
            &workspace_id,
            &normalized_session_id,
        )
        .await?;

        let session = {
            let sessions = self.sessions.lock().await;
            sessions.get(&workspace_id).cloned()
        };
        if let Some(session) = session {
            session
                .clear_thread_effective_mode(&normalized_session_id)
                .await;
        }

        Ok(json!({
            "deleted": deleted_count > 0,
            "deletedCount": deleted_count,
            "method": "filesystem",
            "archivedBeforeDelete": archive_result.is_ok(),
        }))
    }

    pub(crate) async fn delete_codex_sessions(
        &self,
        workspace_id: String,
        session_ids: Vec<String>,
    ) -> Result<Value, String> {
        let normalized_session_ids = session_ids
            .into_iter()
            .map(|session_id| session_id.trim().to_string())
            .filter(|session_id| !session_id.is_empty())
            .collect::<Vec<_>>();
        if normalized_session_ids.is_empty() {
            return Ok(json!({ "results": [] }));
        }

        for session_id in &normalized_session_ids {
            if session_id.contains('/') || session_id.contains('\\') || session_id.contains("..") {
                return Err("invalid session_id".to_string());
            }
        }

        let mut archive_results = HashMap::new();
        for session_id in &normalized_session_ids {
            let archive_result = codex_core::archive_thread_best_effort_core(
                &self.sessions,
                workspace_id.clone(),
                None,
                session_id.clone(),
                Duration::from_millis(DELETE_ARCHIVE_TIMEOUT_MS),
            )
            .await;
            if let Err(error) = &archive_result {
                log::debug!(
                    "[daemon delete_codex_sessions] Best-effort archive skipped for workspace {} session {}: {}",
                    workspace_id,
                    session_id,
                    error
                );
            }
            archive_results.insert(session_id.clone(), archive_result.is_ok());
        }

        let delete_results = local_usage::delete_codex_sessions_for_workspace(
            &self.workspaces,
            &workspace_id,
            &normalized_session_ids,
        )
        .await?;

        let session = {
            let sessions = self.sessions.lock().await;
            sessions.get(&workspace_id).cloned()
        };
        if let Some(session) = session {
            for result in &delete_results {
                if result.deleted {
                    session
                        .clear_thread_effective_mode(&result.session_id)
                        .await;
                }
            }
        }

        Ok(json!({
            "results": delete_results
                .into_iter()
                .map(|result| {
                    json!({
                        "sessionId": result.session_id,
                        "deleted": result.deleted,
                        "deletedCount": result.deleted_count,
                        "method": "filesystem",
                        "archivedBeforeDelete": archive_results
                            .get(&result.session_id)
                            .copied()
                            .unwrap_or(false),
                        "error": result.error,
                    })
                })
                .collect::<Vec<_>>(),
        }))
    }

    pub(crate) async fn send_user_message(
        &self,
        workspace_id: String,
        thread_id: String,
        text: String,
        model: Option<String>,
        effort: Option<String>,
        access_mode: Option<String>,
        images: Option<Vec<String>>,
        collaboration_mode: Option<Value>,
        preferred_language: Option<String>,
        custom_spec_root: Option<String>,
    ) -> Result<Value, String> {
        self.ensure_codex_session_for_workspace(&workspace_id)
            .await?;
        let (mode_enforcement_enabled, extra_developer_instructions) = {
            let settings = self.app_settings.lock().await;
            (
                settings.codex_mode_enforcement_enabled,
                codex_turn_developer_instructions(&settings),
            )
        };
        codex_core::send_user_message_core(
            &self.sessions,
            workspace_id,
            None,
            thread_id,
            text,
            model,
            effort,
            access_mode,
            images,
            collaboration_mode,
            preferred_language,
            custom_spec_root,
            mode_enforcement_enabled,
            extra_developer_instructions,
        )
        .await
    }

    pub(crate) async fn turn_interrupt(
        &self,
        workspace_id: String,
        thread_id: String,
        turn_id: String,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        codex_core::turn_interrupt_core(
            &self.sessions,
            workspace_id,
            provider_profile_id,
            thread_id,
            turn_id,
        )
        .await
    }

    pub(crate) async fn thread_compact(
        &self,
        workspace_id: String,
        thread_id: String,
    ) -> Result<Value, String> {
        if thread_id.trim().starts_with("shared:") {
            return Err(
                "shared-compaction-route-required: daemon refuses unresolved Shared logical ids"
                    .to_string(),
            );
        }
        if thread_id.trim().starts_with("claude:") {
            return self.compact_claude_thread(workspace_id, thread_id).await;
        }
        codex_core::thread_compact_core(&self.sessions, workspace_id, None, thread_id).await
    }

    pub(crate) async fn start_review(
        &self,
        workspace_id: String,
        thread_id: String,
        target: Value,
        delivery: Option<String>,
    ) -> Result<Value, String> {
        codex_core::start_review_core(
            &self.sessions,
            workspace_id,
            None,
            thread_id,
            target,
            delivery,
        )
        .await
    }

    pub(crate) async fn model_list(&self, workspace_id: String) -> Result<Value, String> {
        match codex_core::model_list_core(&self.sessions, workspace_id.clone()).await {
            Ok(response) => Ok(response),
            Err(error) if error == "workspace not connected" => {
                log::debug!(
                    "[daemon:model_list] passive model/list skipped runtime acquisition for {}: {}",
                    workspace_id,
                    error
                );
                Ok(json!({
                    "data": [],
                    "degraded": true,
                    "runtimeAvailable": false,
                    "reason": "workspace not connected",
                }))
            }
            Err(error) => Err(error),
        }
    }

    pub(crate) async fn discover_codex_models(
        &self,
        workspace_id: String,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let provider_profile_id = normalize_daemon_disk_provider_profile(provider_profile_id)?;
        self.ensure_codex_session_for_workspace(&workspace_id)
            .await?;
        codex_core::model_list_for_provider_core(&self.sessions, workspace_id, provider_profile_id)
            .await
    }

    pub(crate) async fn collaboration_mode_list(
        &self,
        workspace_id: String,
    ) -> Result<Value, String> {
        match codex_core::collaboration_mode_list_core(&self.sessions, workspace_id.clone()).await {
            Ok(response) => Ok(response),
            Err(error) if error == "workspace not connected" => {
                log::debug!(
                    "[daemon:collaboration_mode_list] passive collaborationMode/list skipped runtime acquisition for {}: {}",
                    workspace_id,
                    error
                );
                Ok(json!({
                    "data": [],
                    "degraded": true,
                    "runtimeAvailable": false,
                    "reason": "workspace not connected",
                }))
            }
            Err(error) => Err(error),
        }
    }

    pub(crate) async fn account_rate_limits(&self, workspace_id: String) -> Result<Value, String> {
        match codex_core::account_rate_limits_core(&self.sessions, workspace_id.clone()).await {
            Ok(response) => Ok(response),
            Err(error) if error == "workspace not connected" => {
                log::debug!(
                    "[daemon:account_rate_limits] passive account/rateLimits read skipped runtime acquisition for {}: {}",
                    workspace_id,
                    error
                );
                Ok(json!({
                    "rateLimits": null,
                    "degraded": true,
                    "runtimeAvailable": false,
                    "reason": "workspace not connected",
                }))
            }
            Err(error) => Err(error),
        }
    }

    pub(crate) async fn account_read(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::account_read_core(&self.sessions, &self.workspaces, workspace_id).await
    }

    pub(crate) async fn codex_login(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::codex_login_core(
            &self.workspaces,
            &self.app_settings,
            &self.codex_login_cancels,
            workspace_id,
        )
        .await
    }

    pub(crate) async fn codex_login_cancel(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::codex_login_cancel_core(&self.codex_login_cancels, workspace_id).await
    }

    pub(crate) async fn skills_list(
        &self,
        workspace_id: String,
        custom_skill_roots: Vec<String>,
    ) -> Result<Value, String> {
        let workspaces = self.workspaces.lock().await;
        let app_settings_snapshot = self.app_settings.lock().await.clone();
        match skills::skills_list_local_core_with_settings(
            &self.settings_path,
            &workspaces,
            &workspace_id,
            custom_skill_roots.clone(),
            Some(&app_settings_snapshot),
            None,
        )
        .await
        {
            Ok(entries) => {
                let skills_json: Vec<Value> = entries
                    .into_iter()
                    .map(skills::skill_entry_to_json)
                    .collect();
                Ok(json!(skills_json))
            }
            Err(skills::SkillScanError::WorkspaceNotFound(_)) => {
                Err("workspace not found".to_string())
            }
            Err(err) => {
                log::warn!(
                    "Daemon local skills scan failed for workspace {}: {}, falling back to Codex CLI",
                    workspace_id,
                    err
                );
                codex_core::skills_list_core(&self.sessions, workspace_id, custom_skill_roots).await
            }
        }
    }
}
