use super::*;

impl DaemonState {
    pub(crate) async fn get_app_settings(&self) -> AppSettings {
        settings_core::get_app_settings_core(&self.app_settings).await
    }

    pub(crate) async fn codex_doctor(
        &self,
        codex_bin: Option<String>,
        codex_args: Option<String>,
    ) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        crate::codex::run_codex_doctor_with_settings(codex_bin, codex_args, &settings).await
    }

    pub(crate) async fn codex_preview_launch_profile(
        &self,
        codex_bin: Option<String>,
        codex_args: Option<String>,
        workspace_id: Option<String>,
        use_workspace_draft: bool,
    ) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        if let Some(workspace_id) = workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let workspaces = self.workspaces.lock().await.clone();
            return crate::codex::launch_profile::preview_workspace_codex_launch_profile(
                workspace_id,
                codex_bin,
                codex_args,
                use_workspace_draft,
                &workspaces,
                &settings,
            );
        }
        Ok(
            crate::codex::launch_profile::preview_global_codex_launch_profile(
                codex_bin, codex_args, &settings,
            ),
        )
    }

    pub(crate) async fn claude_doctor(&self, claude_bin: Option<String>) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        crate::codex::run_claude_doctor_with_settings(claude_bin, &settings).await
    }

    pub(crate) async fn kimi_doctor(&self, kimi_bin: Option<String>) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        crate::codex::run_kimi_doctor_with_settings(kimi_bin, &settings).await
    }

    pub(crate) async fn grok_doctor(&self, grok_bin: Option<String>) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        crate::codex::run_grok_doctor_with_settings(grok_bin, &settings).await
    }

    pub(crate) async fn opencode_doctor(
        &self,
        opencode_bin: Option<String>,
    ) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        crate::codex::run_opencode_doctor_with_settings(opencode_bin, &settings).await
    }

    pub(crate) async fn dsh_doctor(&self, dsh_bin: Option<String>) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        crate::codex::run_dsh_doctor_with_settings(dsh_bin, &settings).await
    }

    pub(crate) async fn qoder_doctor(
        &self,
        qoder_bin: Option<String>,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        crate::codex::run_qoder_doctor_for_profile_with_settings(
            qoder_bin,
            provider_profile_id,
            &settings,
        )
        .await
    }

    pub(crate) async fn qoder_auth_status(
        &self,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        let distribution =
            engine::qoder_provider_profile::qoder_distribution_from_provider_profile_id(
                provider_profile_id.as_deref(),
            )?;
        let path = engine::qoder_auth::resolve_qoder_auth_file_for_distribution(distribution)?;
        let status =
            engine::qoder_auth::qoder_auth_status_from_path_for_distribution(path, distribution)
                .await?;
        serde_json::to_value(status).map_err(|error| error.to_string())
    }

    pub(crate) async fn qoder_auth_set_pat(
        &self,
        key: String,
        provider_profile_id: Option<String>,
    ) -> Result<(), String> {
        let distribution =
            engine::qoder_provider_profile::qoder_distribution_from_provider_profile_id(
                provider_profile_id.as_deref(),
            )?;
        let path = engine::qoder_auth::resolve_qoder_auth_file_for_distribution(distribution)?;
        engine::qoder_auth::set_qoder_pat(&path, &key).await
    }

    pub(crate) async fn qoder_auth_delete_pat(
        &self,
        provider_profile_id: Option<String>,
    ) -> Result<(), String> {
        let distribution =
            engine::qoder_provider_profile::qoder_distribution_from_provider_profile_id(
                provider_profile_id.as_deref(),
            )?;
        let path = engine::qoder_auth::resolve_qoder_auth_file_for_distribution(distribution)?;
        engine::qoder_auth::delete_qoder_pat(&path).await
    }

    pub(crate) async fn ensure_dsh_host(&self) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        let runtime = engine::dsh::runtime_settings_for_explicit_start(&settings);
        let snapshot = engine::dsh::ensure_ready(&runtime).await?.0;
        Ok(json!({
            "origin": snapshot.origin,
            "host": snapshot.host,
            "port": snapshot.port,
            "ownership": snapshot.ownership,
            "describe": snapshot.describe,
        }))
    }

    pub(crate) async fn cancel_dsh_host(&self) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        let runtime = engine::dsh::runtime_settings_from_app(&settings);
        engine::dsh::stop_host(&runtime).await?;
        Ok(json!({ "ok": true }))
    }

    pub(crate) async fn cli_install_plan(
        &self,
        engine: crate::codex_installer::CliInstallEngine,
        action: crate::codex_installer::CliInstallAction,
        strategy: crate::codex_installer::CliInstallStrategy,
    ) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        let plan = crate::codex::build_cli_install_plan_with_backend(
            engine,
            action,
            strategy,
            crate::codex::CliInstallBackend::Remote,
            &settings,
        )
        .await;
        serde_json::to_value(plan).map_err(|err| err.to_string())
    }

    pub(crate) async fn cli_version_status(
        &self,
        engine: crate::codex_installer::CliInstallEngine,
    ) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        let status = crate::codex::resolve_cli_version_status(engine, &settings).await;
        serde_json::to_value(status).map_err(|err| err.to_string())
    }

    pub(crate) async fn cli_install_run(
        &self,
        engine: crate::codex_installer::CliInstallEngine,
        action: crate::codex_installer::CliInstallAction,
        strategy: crate::codex_installer::CliInstallStrategy,
        run_id: Option<String>,
    ) -> Result<Value, String> {
        let settings = self.app_settings.lock().await.clone();
        let event_sink = self.event_sink.clone();
        let progress_sink =
            std::sync::Arc::new(move |mut event: crate::codex::CliInstallProgressEvent| {
                event.backend = crate::codex::CliInstallBackend::Remote;
                if let Ok(value) = serde_json::to_value(event) {
                    event_sink.emit_cli_installer_event(value);
                }
            });
        let mut result = crate::codex::run_cli_installer_with_progress(
            engine,
            action,
            strategy,
            &settings,
            run_id,
            Some(progress_sink),
        )
        .await?;
        result.backend = crate::codex::CliInstallBackend::Remote;
        serde_json::to_value(result).map_err(|err| err.to_string())
    }

    pub(crate) fn get_codex_unified_exec_external_status(
        &self,
    ) -> Result<crate::types::CodexUnifiedExecExternalStatus, String> {
        settings_core::get_codex_unified_exec_external_status_core()
    }

    pub(crate) fn restore_codex_unified_exec_official_default(
        &self,
    ) -> Result<crate::types::CodexUnifiedExecExternalStatus, String> {
        settings_core::restore_codex_unified_exec_official_default_core()
    }

    pub(crate) fn set_codex_unified_exec_official_override(
        &self,
        enabled: bool,
    ) -> Result<crate::types::CodexUnifiedExecExternalStatus, String> {
        settings_core::set_codex_unified_exec_official_override_core(enabled)
    }

    pub(crate) async fn update_app_settings(
        &self,
        settings: AppSettings,
    ) -> Result<AppSettings, String> {
        let requested_default_engine = settings.default_engine.clone();
        let previous = self.app_settings.lock().await.clone();
        let updated = settings_core::update_app_settings_core(
            settings,
            &self.app_settings,
            &self.settings_path,
        )
        .await?;
        if settings_core::app_settings_change_requires_codex_restart(&previous, &updated) {
            let client_version = env!("CARGO_PKG_VERSION").to_string();
            if let Err(error) = settings_core::restart_codex_sessions_for_app_settings_change_core(
                &self.workspaces,
                &self.sessions,
                &self.app_settings,
                None,
                |entry, default_bin, codex_args, codex_home| {
                    spawn_with_client(
                        self.event_sink.clone(),
                        client_version.clone(),
                        entry,
                        default_bin,
                        codex_args,
                        codex_home,
                    )
                },
            )
            .await
            {
                let rollback_error = settings_core::restore_app_settings_core(
                    &previous,
                    &self.app_settings,
                    &self.settings_path,
                )
                .await
                .err();
                let message = match rollback_error {
                    Some(rollback_error) => {
                        format!("{error} (rollback failed: {rollback_error})")
                    }
                    None => error,
                };
                return Err(message);
            }
        }
        {
            let mut web_service_runtime = self.web_service_runtime.lock().await;
            web_service_runtime.set_default_port(updated.web_service_port);
        }
        {
            let mut active = self.active_engine.lock().await;
            if requested_default_engine.is_some()
                || !engine::engine_enabled_in_settings(&updated, *active)
            {
                *active = resolve_supported_daemon_active_engine(
                    &updated,
                    requested_default_engine
                        .as_deref()
                        .or(updated.default_engine.as_deref()),
                );
            }
        }
        // Keep daemon-mode Qoder Global/CN launch descriptors in step with
        // persisted settings before a history/catalog request can observe the
        // previous config roots or CN binary.
        self.sync_engine_configs().await;
        Ok(updated)
    }

    pub(crate) async fn reload_codex_runtime_config(
        &self,
    ) -> Result<CodexRuntimeReloadResult, String> {
        let _reload_guard = self.codex_runtime_reload_lock.lock().await;
        let restarted_sessions = {
            let sessions = self.sessions.lock().await;
            sessions.len()
        };
        if restarted_sessions == 0 {
            return Ok(CodexRuntimeReloadResult {
                status: "applied".to_string(),
                stage: "noop".to_string(),
                restarted_sessions: 0,
                message: Some("No connected Codex sessions to reload.".to_string()),
            });
        }

        let client_version = env!("CARGO_PKG_VERSION").to_string();
        settings_core::restart_codex_sessions_for_app_settings_change_core(
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            None,
            |entry, default_bin, codex_args, codex_home| {
                spawn_with_client(
                    self.event_sink.clone(),
                    client_version.clone(),
                    entry,
                    default_bin,
                    codex_args,
                    codex_home,
                )
            },
        )
        .await?;

        Ok(CodexRuntimeReloadResult {
            status: "applied".to_string(),
            stage: "swapped".to_string(),
            restarted_sessions,
            message: None,
        })
    }

    pub(crate) async fn sync_engine_configs(&self) {
        let settings = self.app_settings.lock().await.clone();
        self.engine_manager
            .set_engine_config(
                engine::EngineType::Claude,
                engine::EngineConfig {
                    bin_path: settings.claude_bin.clone(),
                    home_dir: None,
                    custom_args: None,
                    default_model: None,
                },
            )
            .await;
        self.engine_manager
            .set_engine_config(
                engine::EngineType::Codex,
                engine::EngineConfig {
                    bin_path: settings.codex_bin.clone(),
                    home_dir: None,
                    custom_args: settings.codex_args.clone(),
                    default_model: None,
                },
            )
            .await;
        self.engine_manager
            .set_engine_config(
                engine::EngineType::OpenCode,
                engine::EngineConfig {
                    bin_path: settings.opencode_bin.clone(),
                    home_dir: None,
                    custom_args: None,
                    default_model: None,
                },
            )
            .await;
        self.engine_manager
            .set_engine_config(
                engine::EngineType::Dsh,
                engine::EngineConfig {
                    bin_path: settings.dsh_bin.clone(),
                    home_dir: None,
                    custom_args: None,
                    default_model: None,
                },
            )
            .await;
        self.engine_manager
            .set_engine_config(
                engine::EngineType::Qoder,
                engine::EngineConfig {
                    bin_path: settings.qoder_bin.clone(),
                    home_dir: settings.qoder_config_dir.clone(),
                    custom_args: None,
                    default_model: None,
                },
            )
            .await;
        self.engine_manager
            .set_qoder_distribution_settings(
                engine::qoder_provider_profile::QoderDistributionSettings::from_app_settings(
                    &settings,
                ),
            )
            .await;
        let _ = engine::dsh::runtime_settings_from_app(&settings);
    }
}
