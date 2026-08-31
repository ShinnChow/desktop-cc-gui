use super::git::*;
use super::*;

impl DaemonState {
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn push_git(
        &self,
        workspace_id: String,
        remote: Option<String>,
        branch: Option<String>,
        force_with_lease: Option<bool>,
        push_tags: Option<bool>,
        run_hooks: Option<bool>,
        push_to_gerrit: Option<bool>,
        topic: Option<String>,
        reviewers: Option<String>,
        cc: Option<String>,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let mut args = vec!["push".to_string()];
        if !run_hooks.unwrap_or(true) {
            args.push("--no-verify".to_string());
        }
        if force_with_lease.unwrap_or(false) {
            args.push("--force-with-lease".to_string());
        }
        if push_tags.unwrap_or(false) {
            args.push("--follow-tags".to_string());
        }

        let target_remote = trim_optional(remote);
        let target_branch = trim_optional(branch).map(|value| normalize_local_branch_ref(&value));
        if push_to_gerrit.unwrap_or(false) {
            let remote_name = target_remote.unwrap_or_else(|| "origin".to_string());
            let branch_name = if let Some(branch_name) = target_branch {
                Some(branch_name)
            } else {
                git_core::run_git_command(&repo_root, &["branch", "--show-current"])
                    .await
                    .ok()
                    .and_then(|raw| trim_optional(Some(raw)))
            }
            .ok_or_else(|| "Branch is required for Gerrit push.".to_string())?;
            let mut refspec = format!("HEAD:refs/for/{branch_name}");
            let mut params = Vec::new();
            if let Some(topic_name) = trim_optional(topic) {
                params.push(format!("topic={topic_name}"));
            }
            for reviewer in csv_values(reviewers) {
                params.push(format!("r={reviewer}"));
            }
            for cc_member in csv_values(cc) {
                params.push(format!("cc={cc_member}"));
            }
            if !params.is_empty() {
                refspec.push('%');
                refspec.push_str(&params.join(","));
            }
            args.push(remote_name);
            args.push(refspec);
        } else {
            if let Some(remote_name) = target_remote {
                args.push(remote_name);
            }
            if let Some(branch_name) = target_branch {
                args.push(format!("HEAD:{branch_name}"));
            }
        }

        git_core::run_git_command_owned(repo_root, args).await?;
        Ok(())
    }

    pub(crate) async fn pull_git(
        &self,
        workspace_id: String,
        remote: Option<String>,
        branch: Option<String>,
        strategy: Option<String>,
        no_commit: Option<bool>,
        no_verify: Option<bool>,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let mut args = vec!["pull".to_string()];
        if let Some(strategy_flag) = trim_optional(strategy) {
            match strategy_flag.as_str() {
                "--rebase" | "--ff-only" | "--no-ff" | "--squash" => args.push(strategy_flag),
                _ => return Err("Unsupported pull strategy option.".to_string()),
            }
        }
        if no_commit.unwrap_or(false) {
            args.push("--no-commit".to_string());
        }
        if no_verify.unwrap_or(false) {
            args.push("--no-verify".to_string());
        }
        if let Some(remote_name) = trim_optional(remote) {
            args.push(remote_name);
            if let Some(branch_name) = trim_optional(branch) {
                args.push(normalize_local_branch_ref(&branch_name));
            }
        } else if let Some(branch_name) = trim_optional(branch) {
            args.push("origin".to_string());
            args.push(normalize_local_branch_ref(&branch_name));
        }
        git_core::run_git_command_owned(repo_root, args).await?;
        Ok(())
    }

    pub(crate) async fn sync_git(
        &self,
        workspace_id: String,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        self.pull_git(
            workspace_id.clone(),
            None,
            None,
            None,
            None,
            None,
            repository_root.clone(),
        )
        .await?;
        self.push_git(
            workspace_id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            repository_root,
        )
        .await?;
        Ok(())
    }

    pub(crate) async fn git_pull(&self, workspace_id: String) -> Result<(), String> {
        self.pull_git(workspace_id, None, None, None, None, None, None)
            .await
    }

    pub(crate) async fn git_push(&self, workspace_id: String) -> Result<(), String> {
        self.push_git(
            workspace_id,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .await
    }

    pub(crate) async fn git_sync(&self, workspace_id: String) -> Result<(), String> {
        self.sync_git(workspace_id, None).await
    }

    pub(crate) async fn git_fetch(
        &self,
        workspace_id: String,
        remote: Option<String>,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        if let Some(remote_name) = trim_optional(remote) {
            git_core::run_git_command(&repo_root, &["fetch", remote_name.as_str()]).await?;
        } else {
            git_core::run_git_command(&repo_root, &["fetch", "--all"]).await?;
        }
        Ok(())
    }

    pub(crate) async fn update_git_branch(
        &self,
        workspace_id: String,
        branch_name: String,
        repository_root: Option<String>,
    ) -> Result<GitBranchUpdateResult, String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let normalized_branch = normalize_local_branch_ref(&branch_name);
        if normalized_branch.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }

        let branch_state = load_local_branch_update_state(&repo_root, normalized_branch.as_str())?;
        if !branch_update_has_upstream(&branch_state) {
            return Ok(no_upstream_branch_update_result(
                branch_state.branch_name.as_str(),
            ));
        }
        if branch_state.is_current {
            git_core::run_git_command(&repo_root, &["pull"]).await?;
            return Ok(branch_update_result(
                branch_state.branch_name.as_str(),
                BRANCH_UPDATE_STATUS_SUCCESS,
                None,
                format!("Updated current branch '{}'.", branch_state.branch_name),
                None,
            ));
        }

        update_non_current_local_branch(&repo_root, branch_state.branch_name.as_str()).await
    }

    pub(crate) async fn cherry_pick_commit(
        &self,
        workspace_id: String,
        commit_hash: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let commit_hash = commit_hash.trim();
        if commit_hash.is_empty() {
            return Err("commit hash is required".to_string());
        }
        git_core::run_git_command(&repo_root, &["cherry-pick", commit_hash]).await?;
        Ok(())
    }

    pub(crate) async fn revert_commit(
        &self,
        workspace_id: String,
        commit_hash: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let commit_hash = commit_hash.trim();
        if commit_hash.is_empty() {
            return Err("commit hash is required".to_string());
        }
        git_core::run_git_command(&repo_root, &["revert", "--no-edit", commit_hash]).await?;
        Ok(())
    }

    pub(crate) async fn reset_git_commit(
        &self,
        workspace_id: String,
        commit_hash: String,
        mode: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let commit_hash = commit_hash.trim();
        if commit_hash.is_empty() {
            return Err("commit hash is required".to_string());
        }
        let mode_flag = match mode.trim().to_ascii_lowercase().as_str() {
            "soft" => "--soft",
            "hard" => "--hard",
            "keep" => "--keep",
            _ => "--mixed",
        };
        git_core::run_git_command(&repo_root, &["reset", mode_flag, commit_hash]).await?;
        Ok(())
    }
}
