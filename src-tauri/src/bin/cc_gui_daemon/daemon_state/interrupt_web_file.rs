use super::*;

impl DaemonState {
    pub(crate) async fn engine_interrupt(&self, workspace_id: String) -> Result<(), String> {
        self.sync_engine_configs().await;
        let active_engine = self.get_active_engine().await;
        match active_engine {
            engine::EngineType::Claude => {
                self.engine_manager
                    .claude_manager
                    .interrupt_workspace_sessions(&workspace_id)
                    .await
            }
            engine::EngineType::Codex => Ok(()),
            engine::EngineType::OpenCode => {
                self.engine_manager
                    .interrupt_opencode_sessions(&workspace_id, None)
                    .await
            }
            engine::EngineType::Gemini => {
                if let Some(session) = self.engine_manager.get_gemini_session(&workspace_id).await {
                    session.interrupt().await?;
                }
                Ok(())
            }
            engine::EngineType::Kimi => {
                self.engine_manager
                    .interrupt_kimi_sessions(&workspace_id, None)
                    .await
            }
            engine::EngineType::Pi => {
                self.engine_manager
                    .interrupt_pi_sessions(&workspace_id, None)
                    .await
            }
            engine::EngineType::Omp => {
                self.engine_manager
                    .interrupt_omp_sessions(&workspace_id, None)
                    .await
            }
            engine::EngineType::Qoder => {
                self.engine_manager
                    .interrupt_qoder_sessions(&workspace_id, None)
                    .await
            }
            engine::EngineType::Grok => {
                self.engine_manager
                    .interrupt_grok_sessions(&workspace_id, None)
                    .await
            }
            engine::EngineType::Dsh => {
                let settings = self.app_settings.lock().await.clone();
                engine::dsh::interrupt_workspace(
                    &engine::dsh::runtime_settings_from_app(&settings),
                    &workspace_id,
                )
                .await
            }
        }
    }

    pub(crate) async fn engine_interrupt_turn(
        &self,
        workspace_id: String,
        turn_id: String,
        engine: Option<engine::EngineType>,
        provider_profile_id: Option<String>,
    ) -> Result<(), String> {
        self.sync_engine_configs().await;
        let active_engine = self.get_active_engine().await;
        let target_engine = engine.unwrap_or(active_engine);
        match target_engine {
            engine::EngineType::Claude => {
                let provider_profile_id = provider_profile_id
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty());
                let session = if provider_profile_id.is_some() {
                    let provider_session = self
                        .engine_manager
                        .claude_manager
                        .get_session_for_provider(&workspace_id, provider_profile_id)
                        .await;
                    match provider_session {
                        Some(session) if session.has_active_turn(&turn_id).await => Some(session),
                        _ => None,
                    }
                } else {
                    self.engine_manager
                        .claude_manager
                        .session_for_turn(&workspace_id, &turn_id)
                        .await
                };
                if let Some(session) = session {
                    session.interrupt_turn(&turn_id).await?;
                }
                Ok(())
            }
            engine::EngineType::Codex => Ok(()),
            engine::EngineType::OpenCode => {
                self.engine_manager
                    .interrupt_opencode_sessions(&workspace_id, Some(&turn_id))
                    .await
            }
            engine::EngineType::Gemini => {
                if let Some(session) = self.engine_manager.get_gemini_session(&workspace_id).await {
                    session.interrupt_turn(&turn_id).await?;
                }
                Ok(())
            }
            engine::EngineType::Kimi => {
                self.engine_manager
                    .interrupt_kimi_sessions(&workspace_id, Some(&turn_id))
                    .await
            }
            engine::EngineType::Pi => {
                self.engine_manager
                    .interrupt_pi_sessions(&workspace_id, Some(&turn_id))
                    .await
            }
            engine::EngineType::Omp => {
                self.engine_manager
                    .interrupt_omp_sessions(&workspace_id, Some(&turn_id))
                    .await
            }
            engine::EngineType::Qoder => {
                self.engine_manager
                    .interrupt_qoder_session_for_profile(
                        &workspace_id,
                        provider_profile_id.as_deref(),
                        Some(&turn_id),
                    )
                    .await
            }
            engine::EngineType::Grok => {
                self.engine_manager
                    .interrupt_grok_sessions(&workspace_id, Some(&turn_id))
                    .await
            }
            engine::EngineType::Dsh => {
                let settings = self.app_settings.lock().await.clone();
                engine::dsh::interrupt_turn(
                    &engine::dsh::runtime_settings_from_app(&settings),
                    &turn_id,
                )
                .await
            }
        }
    }

    pub(crate) async fn start_web_server(
        &self,
        port: Option<u16>,
        token: Option<String>,
    ) -> Result<Value, String> {
        let fallback_port = {
            let settings = self.app_settings.lock().await;
            settings.web_service_port
        };
        let mut web_service_runtime = self.web_service_runtime.lock().await;
        let status = web_service_runtime
            .start(port.or(Some(fallback_port)), token)
            .await?;
        serde_json::to_value(status).map_err(|err| err.to_string())
    }

    pub(crate) async fn stop_web_server(&self) -> Result<Value, String> {
        let mut web_service_runtime = self.web_service_runtime.lock().await;
        let status = web_service_runtime.stop().await;
        serde_json::to_value(status).map_err(|err| err.to_string())
    }

    pub(crate) async fn get_web_server_status(&self) -> Result<Value, String> {
        let mut web_service_runtime = self.web_service_runtime.lock().await;
        let status = web_service_runtime.status();
        serde_json::to_value(status).map_err(|err| err.to_string())
    }

    pub(crate) async fn file_read(
        &self,
        scope: file_policy::FileScope,
        kind: file_policy::FileKind,
        workspace_id: Option<String>,
    ) -> Result<file_io::TextFileResponse, String> {
        files_core::file_read_core(&self.workspaces, scope, kind, workspace_id).await
    }

    pub(crate) async fn file_write(
        &self,
        scope: file_policy::FileScope,
        kind: file_policy::FileKind,
        workspace_id: Option<String>,
        content: String,
    ) -> Result<(), String> {
        files_core::file_write_core(&self.workspaces, scope, kind, workspace_id, content).await
    }
}
