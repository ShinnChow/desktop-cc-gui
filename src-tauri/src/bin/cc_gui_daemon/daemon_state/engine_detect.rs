use super::*;

impl DaemonState {
    pub(crate) async fn detect_engines(&self) -> Vec<engine::EngineStatus> {
        self.detect_engines_cached(false, None).await
    }

    pub(crate) async fn detect_engines_cached(
        &self,
        force: bool,
        engines: Option<&[engine::EngineType]>,
    ) -> Vec<engine::EngineStatus> {
        self.sync_engine_configs().await;
        let settings = self.app_settings.lock().await.clone();
        let disabled_engines = engine::detection_disabled_engines(&settings);
        self.engine_manager
            .detect_engines_cached(
                force,
                engines,
                settings.gemini_enabled,
                &disabled_engines,
                None,
            )
            .await
    }

    pub(crate) async fn get_active_engine(&self) -> engine::EngineType {
        *self.active_engine.lock().await
    }

    pub(crate) async fn switch_engine(
        &self,
        engine_type: engine::EngineType,
    ) -> Result<(), String> {
        self.sync_engine_configs().await;
        let settings = self.app_settings.lock().await.clone();
        if !engine::engine_enabled_in_settings(&settings, engine_type) {
            return Err(engine::engine_disabled_diagnostic(engine_type)
                .unwrap_or("Engine is disabled in CLI validation settings")
                .to_string());
        }
        let statuses = self
            .engine_manager
            // 显式 switch 的安装校验不走检测黑名单：开关只控制可见性/检测范围，
            // 不阻断对已配置引擎的显式切换。
            .detect_engines_with_gates(settings.gemini_enabled, &[], None)
            .await;
        let installed = statuses
            .iter()
            .find(|entry| entry.engine_type == engine_type)
            .map(|entry| entry.installed)
            .unwrap_or(false);
        if !installed {
            return Err(format!("{:?} is not installed", engine_type));
        }
        {
            let mut active = self.active_engine.lock().await;
            *active = engine_type;
        }
        self.engine_manager.set_active_engine(engine_type).await?;
        Ok(())
    }

    pub(crate) async fn get_engine_status(
        &self,
        engine_type: engine::EngineType,
    ) -> Option<engine::EngineStatus> {
        self.sync_engine_configs().await;
        let settings = self.app_settings.lock().await.clone();
        let disabled_engines = engine::detection_disabled_engines(&settings);
        if disabled_engines.contains(&engine_type) {
            return None;
        }
        if let Some(status) = self.engine_manager.get_engine_status(engine_type).await {
            return Some(status);
        }
        // 缓存缺失：轻量单引擎重探（B3 cached per-engine）。
        let statuses = self
            .engine_manager
            .detect_engines_cached(
                false,
                Some(&[engine_type]),
                settings.gemini_enabled,
                &disabled_engines,
                None,
            )
            .await;
        statuses
            .into_iter()
            .find(|entry| entry.engine_type == engine_type)
    }

    pub(crate) async fn get_engine_models(
        &self,
        engine_type: engine::EngineType,
        provider_profile_id: Option<&str>,
    ) -> Result<Vec<engine::ModelInfo>, String> {
        let settings = self.app_settings.lock().await.clone();
        if !engine::engine_enabled_in_settings(&settings, engine_type) {
            return Ok(Vec::new());
        }
        if let Some(models) =
            engine::status::get_provider_scoped_engine_models(engine_type, provider_profile_id)?
        {
            return Ok(models);
        }
        match engine_type {
            engine::EngineType::OpenCode => {
                let config = self
                    .engine_manager
                    .get_engine_config(engine::EngineType::OpenCode)
                    .await;
                let custom_bin = config
                    .as_ref()
                    .and_then(|cfg| cfg.bin_path.as_ref())
                    .map(|value| value.as_str());
                let fresh_models = engine::status::load_opencode_models(custom_bin)
                    .await
                    .unwrap_or_default();

                if !fresh_models.is_empty() {
                    return Ok(fresh_models);
                }

                Ok(self
                    .get_engine_status(engine_type)
                    .await
                    .map(|status| status.models)
                    .unwrap_or_default())
            }
            engine::EngineType::Qoder => {
                let qoder_distribution_settings =
                    engine::qoder_provider_profile::QoderDistributionSettings::from_app_settings(
                        &settings,
                    );
                let launch_profile =
                    engine::qoder_provider_profile::resolve_qoder_provider_launch_profile(
                        "model-catalog",
                        provider_profile_id,
                        &qoder_distribution_settings,
                    )?;
                // Distribution catalogs are independent. Never reuse the
                // engine-level Global cache for a Qoder CN selector.
                let status = engine::status::detect_qoder_distribution_status(
                    launch_profile.distribution,
                    launch_profile.bin_path.as_deref(),
                    launch_profile
                        .home_dir
                        .as_deref()
                        .and_then(|path| path.to_str()),
                )
                .await;
                Ok(status.models)
            }
            _ => Ok(self
                .get_engine_status(engine_type)
                .await
                .map(|status| status.models)
                .unwrap_or_default()),
        }
    }

    pub(crate) async fn workspace_path_for_engine(
        &self,
        workspace_id: &str,
    ) -> Result<PathBuf, String> {
        let workspaces = self.workspaces.lock().await;
        workspaces
            .get(workspace_id)
            .map(|entry| PathBuf::from(&entry.path))
            .ok_or_else(|| "Workspace not found".to_string())
    }

    pub(crate) async fn record_auto_session_metadata_if_present(
        &self,
        workspace_id: &str,
        session_id: Option<&str>,
        metadata: Option<session_management::AutoSessionMetadata>,
        engine_prefix: &str,
    ) {
        let (Some(session_id), Some(metadata)) = (session_id, metadata) else {
            return;
        };
        if let Err(error) = session_management::record_auto_session_metadata_core(
            &self.workspaces,
            self.storage_path.as_path(),
            workspace_id.to_string(),
            prefixed_session_id(engine_prefix, session_id),
            metadata,
        )
        .await
        {
            log::warn!(
                "[daemon.auto_session] failed to record metadata for workspace {} session {}: {}",
                workspace_id,
                session_id,
                error
            );
        }
    }
}
