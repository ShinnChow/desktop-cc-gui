use super::*;

impl DaemonState {
    pub(crate) fn allowed_external_skill_roots(
        &self,
        workspaces: &HashMap<String, WorkspaceEntry>,
        workspace_id: &str,
        custom_skill_roots: &[PathBuf],
    ) -> Result<Vec<PathBuf>, String> {
        let entry = workspaces
            .get(workspace_id)
            .ok_or_else(|| format!("Workspace not found: {workspace_id}"))?;
        let parent_entry = entry
            .parent_id
            .as_ref()
            .and_then(|parent_id| workspaces.get(parent_id));

        let mut roots = vec![
            self.data_dir
                .join("workspaces")
                .join(&entry.id)
                .join("skills"),
            PathBuf::from(&entry.path).join(".claude").join("skills"),
            PathBuf::from(&entry.path).join(".codex").join("skills"),
            PathBuf::from(&entry.path).join(".gemini").join("skills"),
            PathBuf::from(&entry.path).join(".agents").join("skills"),
        ];

        if let Some(home) = dirs::home_dir() {
            roots.push(home.join(".claude").join("skills"));
            roots.push(home.join(".gemini").join("skills"));
            roots.push(home.join(".agents").join("skills"));
        }

        if let Some(codex_home) = codex::home::resolve_workspace_codex_home(entry, parent_entry)
            .or_else(codex::home::resolve_default_codex_home)
        {
            roots.push(codex_home.join("skills"));
        }
        roots.extend(custom_skill_roots.iter().cloned());

        roots.sort();
        roots.dedup();
        Ok(roots)
    }

    pub(crate) fn load(config: &DaemonConfig, event_sink: DaemonEventSink) -> Self {
        let storage_path = config.data_dir.join("workspaces.json");
        let settings_path = config.data_dir.join("settings.json");
        let workspaces = read_workspaces(&storage_path).unwrap_or_else(|error| {
            // Quarantine the corrupted file first so a later save never destroys it.
            let _ = backup_corrupted_file(&storage_path, &error);
            HashMap::new()
        });
        let app_settings = read_settings(&settings_path).unwrap_or_else(|error| {
            // Quarantine the corrupted file first so a later save never destroys it.
            // The daemon has no UI surface, so no recovery notice is recorded here.
            let _ = backup_corrupted_file(&settings_path, &error);
            AppSettings::default()
        });
        let active_engine = resolve_supported_daemon_active_engine(
            &app_settings,
            app_settings.default_engine.as_deref(),
        );
        let web_service_runtime = WebServiceRuntime::new(
            config.listen.to_string(),
            config.token.clone(),
            app_settings.web_service_port,
            config.data_dir.clone(),
        );
        if let Err(error) = proxy_core::apply_app_proxy_settings(&app_settings) {
            eprintln!("[proxy] failed to apply persisted proxy settings: {error}");
        }
        let runtime_manager = Arc::new(crate::runtime::RuntimeManager::new(&config.data_dir));
        runtime_manager.orphan_sweep_on_startup(app_settings.runtime_orphan_sweep_on_launch);
        Self {
            data_dir: config.data_dir.clone(),
            workspaces: Mutex::new(workspaces),
            sessions: Mutex::new(HashMap::new()),
            storage_path,
            settings_path,
            app_settings: Mutex::new(app_settings),
            codex_runtime_reload_lock: Mutex::new(()),
            web_service_runtime: Mutex::new(web_service_runtime),
            event_sink,
            codex_login_cancels: Mutex::new(HashMap::new()),
            engine_manager: Arc::new(engine::EngineManager::new()),
            active_engine: Mutex::new(active_engine),
            runtime_manager,
        }
    }

    pub(crate) async fn list_workspaces(&self) -> Vec<WorkspaceInfo> {
        workspaces_core::list_workspaces_core(&self.workspaces, &self.sessions).await
    }

    pub(crate) async fn is_workspace_path_dir(&self, path: String) -> bool {
        workspaces_core::is_workspace_path_dir_core(&path)
    }

    pub(crate) async fn ensure_workspace_path_dir(&self, path: String) -> Result<(), String> {
        workspaces_core::ensure_workspace_path_dir_core(&path)
    }

    pub(crate) async fn add_workspace(
        &self,
        path: String,
        codex_bin: Option<String>,
        client_version: String,
    ) -> Result<WorkspaceInfo, String> {
        let client_version = client_version.clone();
        workspaces_core::add_workspace_core(
            path,
            codex_bin,
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            &self.storage_path,
            move |entry, default_bin, codex_args, codex_home| {
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
    }

    pub(crate) async fn add_worktree(
        &self,
        parent_id: String,
        branch: String,
        base_ref: Option<String>,
        publish_to_origin: bool,
        client_version: String,
    ) -> Result<WorkspaceInfo, String> {
        let client_version = client_version.clone();
        workspaces_core::add_worktree_core(
            parent_id,
            branch,
            base_ref,
            publish_to_origin,
            &self.data_dir,
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            &self.storage_path,
            worktree_core::sanitize_worktree_name,
            worktree_core::unique_worktree_path_strict,
            |root, branch_name| {
                let root = root.clone();
                let branch_name = branch_name.to_string();
                async move { git_core::git_branch_exists(&root, &branch_name).await }
            },
            Some(|root: &PathBuf, branch_name: &str| {
                let root = root.clone();
                let branch_name = branch_name.to_string();
                async move { git_core::git_find_remote_tracking_branch_local(&root, &branch_name).await }
            }),
            |root, args| {
                workspaces_core::run_git_command_unit(root, args, git_core::run_git_command_owned)
            },
            move |entry, default_bin, codex_args, codex_home| {
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
    }

    pub(crate) async fn worktree_setup_status(
        &self,
        workspace_id: String,
    ) -> Result<WorktreeSetupStatus, String> {
        workspaces_core::worktree_setup_status_core(&self.workspaces, &workspace_id, &self.data_dir)
            .await
    }

    pub(crate) async fn worktree_setup_mark_ran(&self, workspace_id: String) -> Result<(), String> {
        workspaces_core::worktree_setup_mark_ran_core(
            &self.workspaces,
            &workspace_id,
            &self.data_dir,
        )
        .await
    }

    pub(crate) async fn remove_workspace(&self, id: String) -> Result<(), String> {
        let cleanup_ids = {
            let workspaces = self.workspaces.lock().await;
            let mut ids = vec![id.clone()];
            if workspaces
                .get(&id)
                .is_some_and(|workspace| !workspace.kind.is_worktree())
            {
                ids.extend(
                    workspaces
                        .values()
                        .filter(|workspace| workspace.parent_id.as_deref() == Some(id.as_str()))
                        .map(|workspace| workspace.id.clone()),
                );
            }
            ids
        };
        workspaces_core::remove_workspace_core(
            id,
            &self.workspaces,
            &self.sessions,
            &self.storage_path,
            |root, args| {
                workspaces_core::run_git_command_unit(root, args, git_core::run_git_command_owned)
            },
            git_core::is_missing_worktree_error,
            |path| {
                std::fs::remove_dir_all(path)
                    .map_err(|err| format!("Failed to remove worktree folder: {err}"))
            },
            true,
            true,
        )
        .await?;
        let mut cleanup_errors = Vec::new();
        for workspace_id in cleanup_ids {
            if let Err(error) = self
                .engine_manager
                .remove_gemini_session(&workspace_id)
                .await
            {
                cleanup_errors.push(format!("{workspace_id}: {error}"));
            }
        }
        if !cleanup_errors.is_empty() {
            return Err(format!(
                "workspace removed but Gemini cleanup failed: {}",
                cleanup_errors.join("; ")
            ));
        }
        Ok(())
    }

    pub(crate) async fn remove_worktree(&self, id: String) -> Result<(), String> {
        workspaces_core::remove_worktree_core(
            id.clone(),
            &self.workspaces,
            &self.sessions,
            &self.storage_path,
            |root, args| {
                workspaces_core::run_git_command_unit(root, args, git_core::run_git_command_owned)
            },
            git_core::is_missing_worktree_error,
            |path| {
                std::fs::remove_dir_all(path)
                    .map_err(|err| format!("Failed to remove worktree folder: {err}"))
            },
        )
        .await?;
        self.engine_manager
            .remove_gemini_session(&id)
            .await
            .map_err(|error| {
                format!("worktree removed but Gemini cleanup failed for {id}: {error}")
            })?;
        Ok(())
    }

    pub(crate) async fn rename_worktree(
        &self,
        id: String,
        branch: String,
        client_version: String,
    ) -> Result<WorkspaceInfo, String> {
        let client_version = client_version.clone();
        workspaces_core::rename_worktree_core(
            id,
            branch,
            &self.data_dir,
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            &self.storage_path,
            |entry| Ok(PathBuf::from(entry.path.clone())),
            |root, name| {
                let root = root.clone();
                let name = name.to_string();
                async move {
                    git_core::unique_branch_name_live(&root, &name, None)
                        .await
                        .map(|(branch_name, _was_suffixed)| branch_name)
                }
            },
            worktree_core::sanitize_worktree_name,
            |root, name, current| {
                worktree_core::unique_worktree_path_for_rename(root, name, current)
            },
            |root, args| {
                workspaces_core::run_git_command_unit(root, args, git_core::run_git_command_owned)
            },
            move |entry, default_bin, codex_args, codex_home| {
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
    }

    pub(crate) async fn rename_worktree_upstream(
        &self,
        id: String,
        old_branch: String,
        new_branch: String,
    ) -> Result<(), String> {
        workspaces_core::rename_worktree_upstream_core(
            id,
            old_branch,
            new_branch,
            &self.workspaces,
            |entry| Ok(PathBuf::from(entry.path.clone())),
            |root, branch_name| {
                let root = root.clone();
                let branch_name = branch_name.to_string();
                async move { git_core::git_branch_exists(&root, &branch_name).await }
            },
            |root, branch_name| {
                let root = root.clone();
                let branch_name = branch_name.to_string();
                async move { git_core::git_find_remote_for_branch_live(&root, &branch_name).await }
            },
            |root, remote| {
                let root = root.clone();
                let remote = remote.to_string();
                async move { git_core::git_remote_exists(&root, &remote).await }
            },
            |root, remote, branch_name| {
                let root = root.clone();
                let remote = remote.to_string();
                let branch_name = branch_name.to_string();
                async move {
                    git_core::git_remote_branch_exists_live(&root, &remote, &branch_name).await
                }
            },
            |root, args| {
                workspaces_core::run_git_command_unit(root, args, git_core::run_git_command_owned)
            },
        )
        .await
    }

    pub(crate) async fn update_workspace_settings(
        &self,
        id: String,
        settings: WorkspaceSettings,
        client_version: String,
    ) -> Result<WorkspaceInfo, String> {
        let client_version = client_version.clone();
        workspaces_core::update_workspace_settings_core(
            id,
            settings,
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            &self.storage_path,
            |workspaces, workspace_id, next_settings| {
                apply_workspace_settings_update(workspaces, workspace_id, next_settings)
            },
            move |entry, default_bin, codex_args, codex_home| {
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
    }

    pub(crate) async fn update_workspace_codex_bin(
        &self,
        id: String,
        codex_bin: Option<String>,
    ) -> Result<WorkspaceInfo, String> {
        workspaces_core::update_workspace_codex_bin_core(
            id,
            codex_bin,
            &self.workspaces,
            &self.sessions,
            &self.storage_path,
        )
        .await
    }

    pub(crate) async fn connect_workspace(
        &self,
        id: String,
        client_version: String,
        recovery_source: Option<String>,
    ) -> Result<(), String> {
        self.connect_workspace_inner(id, client_version, recovery_source, false)
            .await
    }

    pub(crate) async fn connect_codex_workspace_session(
        &self,
        id: String,
        client_version: String,
        recovery_source: Option<String>,
    ) -> Result<(), String> {
        self.connect_workspace_inner(id, client_version, recovery_source, true)
            .await
    }

    async fn connect_workspace_inner(
        &self,
        id: String,
        client_version: String,
        recovery_source: Option<String>,
        force_codex_session: bool,
    ) -> Result<(), String> {
        {
            let sessions = self.sessions.lock().await;
            if sessions.contains_key(&id) {
                return Ok(());
            }
        }

        let active_engine = *self.active_engine.lock().await;
        {
            let workspaces = self.workspaces.lock().await;
            let entry = workspaces
                .get(&id)
                .ok_or_else(|| "workspace not found".to_string())?;
            let should_connect_codex_session =
                force_codex_session || active_engine == engine::EngineType::Codex;
            if !workspaces_core::workspace_requires_persistent_session(entry)
                && !should_connect_codex_session
            {
                // Claude/Gemini/OpenCode do not require a persistent workspace session
                // unless the current operation explicitly needs a Codex app-server.
                return Ok(());
            }
        }

        let client_version = client_version.clone();
        let recovery_source = recovery_source.unwrap_or_else(|| "explicit-connect".to_string());
        let automatic_recovery = recovery_source != "explicit-connect";
        workspaces_core::connect_workspace_core(
            id,
            &self.workspaces,
            &self.sessions,
            &self.app_settings,
            Some(&self.runtime_manager),
            &recovery_source,
            automatic_recovery,
            move |entry, default_bin, codex_args, codex_home| {
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
    }
}
