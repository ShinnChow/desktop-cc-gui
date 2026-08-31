use super::*;

impl DaemonState {
    pub(crate) async fn list_workspace_sessions(
        &self,
        workspace_id: String,
        query: Option<session_management::WorkspaceSessionCatalogQuery>,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<session_management::WorkspaceSessionCatalogPage, String> {
        session_management::list_workspace_sessions_core(
            &self.workspaces,
            &self.sessions,
            &self.engine_manager,
            self.storage_path.as_path(),
            workspace_id,
            query,
            cursor,
            limit,
        )
        .await
    }

    pub(crate) async fn list_shared_sessions(
        &self,
        workspace_id: String,
    ) -> Result<Vec<crate::shared_sessions::SharedSessionSummary>, String> {
        {
            let workspaces = self.workspaces.lock().await;
            if !workspaces.contains_key(&workspace_id) {
                return Err("workspace not found".to_string());
            }
        }

        let event_log_path = self
            .storage_path
            .parent()
            .map(|parent| parent.join("shared-event-log-v2.sqlite3"));
        crate::shared_sessions::list_workspace_shared_sessions(
            &workspace_id,
            None,
            event_log_path.as_deref(),
        )
    }

    pub(crate) async fn list_global_codex_sessions(
        &self,
        query: Option<session_management::WorkspaceSessionCatalogQuery>,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<session_management::WorkspaceSessionCatalogPage, String> {
        session_management::list_global_codex_sessions_core(
            &self.engine_manager,
            &self.workspaces,
            self.storage_path.as_path(),
            query,
            cursor,
            limit,
        )
        .await
    }

    pub(crate) async fn list_project_related_codex_sessions(
        &self,
        workspace_id: String,
        query: Option<session_management::WorkspaceSessionCatalogQuery>,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<session_management::WorkspaceSessionCatalogPage, String> {
        session_management::list_project_related_sessions_core(
            &self.workspaces,
            &self.engine_manager,
            self.storage_path.as_path(),
            workspace_id,
            Some(session_management::force_codex_related_query(query)),
            cursor,
            limit,
        )
        .await
    }

    pub(crate) async fn list_project_related_sessions(
        &self,
        workspace_id: String,
        query: Option<session_management::WorkspaceSessionCatalogQuery>,
        cursor: Option<String>,
        limit: Option<u32>,
    ) -> Result<session_management::WorkspaceSessionCatalogPage, String> {
        session_management::list_project_related_sessions_core(
            &self.workspaces,
            &self.engine_manager,
            self.storage_path.as_path(),
            workspace_id,
            query,
            cursor,
            limit,
        )
        .await
    }

    pub(crate) async fn list_workspace_session_archive_evidence(
        &self,
        workspace_id: String,
    ) -> Result<session_management::WorkspaceSessionArchiveEvidence, String> {
        session_management::list_workspace_session_archive_evidence_core(
            &self.workspaces,
            self.storage_path.as_path(),
            workspace_id,
        )
        .await
    }

    pub(crate) async fn get_workspace_session_projection_summary(
        &self,
        workspace_id: String,
        query: Option<session_management::WorkspaceSessionCatalogQuery>,
    ) -> Result<session_management::WorkspaceSessionProjectionSummary, String> {
        session_management::get_workspace_session_projection_summary_core(
            &self.workspaces,
            &self.engine_manager,
            self.storage_path.as_path(),
            workspace_id,
            query,
        )
        .await
    }

    pub(crate) async fn delete_workspace_sessions(
        &self,
        workspace_id: String,
        session_ids: Vec<String>,
    ) -> Result<session_management::WorkspaceSessionBatchMutationResponse, String> {
        session_management::delete_workspace_sessions_core(
            &self.workspaces,
            &self.sessions,
            &self.engine_manager,
            self.storage_path.as_path(),
            workspace_id,
            session_ids,
        )
        .await
    }

    pub(crate) async fn list_thread_titles(
        &self,
        workspace_id: String,
    ) -> Result<HashMap<String, String>, String> {
        thread_titles_core::list_thread_titles_core(&self.workspaces, workspace_id).await
    }

    pub(crate) async fn set_thread_title(
        &self,
        workspace_id: String,
        thread_id: String,
        title: String,
    ) -> Result<String, String> {
        thread_titles_core::upsert_thread_title_core(
            &self.workspaces,
            workspace_id,
            thread_id,
            title,
        )
        .await
    }

    pub(crate) async fn rename_thread_title_key(
        &self,
        workspace_id: String,
        old_thread_id: String,
        new_thread_id: String,
    ) -> Result<(), String> {
        thread_titles_core::rename_thread_title_core(
            &self.workspaces,
            workspace_id,
            old_thread_id,
            new_thread_id,
        )
        .await
    }

    pub(crate) async fn respond_to_server_request(
        &self,
        workspace_id: String,
        request_id: Value,
        result: Value,
        provider_profile_id: Option<String>,
    ) -> Result<Value, String> {
        if let Some(dsh_request) = crate::engine::dsh::parse_control_request(&request_id) {
            let settings = self.app_settings.lock().await.clone();
            let runtime = crate::engine::dsh::runtime_settings_from_app(&settings);
            crate::engine::dsh::respond_to_control(&runtime, dsh_request, &result).await?;
            return Ok(json!({ "ok": true }));
        }
        if request_id.is_string() {
            for session in self
                .engine_manager
                .claude_manager
                .sessions_for_workspace(&workspace_id)
                .await
            {
                if session.has_pending_user_input(&request_id) {
                    session.respond_to_user_input(request_id, result).await?;
                    return Ok(json!({ "ok": true }));
                }
                if session.has_pending_approval_request(&request_id) {
                    session
                        .respond_to_approval_request(request_id, result)
                        .await?;
                    return Ok(json!({ "ok": true }));
                }
            }
        }
        codex_core::respond_to_server_request_core(
            &self.sessions,
            workspace_id,
            provider_profile_id,
            request_id,
            result,
        )
        .await?;
        Ok(json!({ "ok": true }))
    }

    pub(crate) async fn remember_approval_rule(
        &self,
        workspace_id: String,
        command: Vec<String>,
    ) -> Result<Value, String> {
        codex_core::remember_approval_rule_core(&self.workspaces, workspace_id, command).await
    }

    pub(crate) async fn get_config_model(&self, workspace_id: String) -> Result<Value, String> {
        codex_core::get_config_model_core(&self.workspaces, workspace_id).await
    }
}
