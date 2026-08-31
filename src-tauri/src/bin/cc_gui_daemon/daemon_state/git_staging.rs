use super::git::*;
use super::*;

impl DaemonState {
    pub(crate) async fn stage_git_file(
        &self,
        workspace_id: String,
        path: String,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let paths = crate::git_utils::git_action_paths_for_file(
            &repo_root,
            &path,
            crate::git_utils::GitStatusLayer::Workdir,
        );
        if paths.is_empty() {
            return Err("path is required".to_string());
        }
        for path in paths {
            git_core::run_git_command(&repo_root, &["add", "-A", "--", &path]).await?;
        }
        Ok(())
    }

    pub(crate) async fn stage_git_all(
        &self,
        workspace_id: String,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        git_core::run_git_command(&repo_root, &["add", "-A"]).await?;
        Ok(())
    }

    pub(crate) async fn unstage_git_file(
        &self,
        workspace_id: String,
        path: String,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let paths = crate::git_utils::git_action_paths_for_file(
            &repo_root,
            &path,
            crate::git_utils::GitStatusLayer::Index,
        );
        if paths.is_empty() {
            return Err("path is required".to_string());
        }
        for path in paths {
            git_core::run_git_command(&repo_root, &["restore", "--staged", "--", &path]).await?;
        }
        Ok(())
    }

    pub(crate) async fn unstage_git_all(
        &self,
        workspace_id: String,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        git_core::run_git_command(&repo_root, &["restore", "--staged", "--", "."]).await?;
        Ok(())
    }

    pub(crate) async fn unstage_git_paths(
        &self,
        workspace_id: String,
        paths: Vec<String>,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let expanded = expand_daemon_git_action_paths(
            &repo_root,
            &paths,
            crate::git_utils::GitStatusLayer::Index,
        );
        run_daemon_git_command_with_paths(&repo_root, &["restore", "--staged", "--"], &expanded)
            .await
    }

    pub(crate) async fn revert_git_file(
        &self,
        workspace_id: String,
        path: String,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let paths = crate::git_utils::git_action_paths_for_file(
            &repo_root,
            &path,
            crate::git_utils::GitStatusLayer::Workdir,
        );
        if paths.is_empty() {
            return Err("path is required".to_string());
        }
        for path in paths {
            // Unstaged discard restores the working tree from the index, not HEAD.
            if git_core::run_git_command(&repo_root, &["restore", "--worktree", "--", &path])
                .await
                .is_err()
            {
                git_core::run_git_command(&repo_root, &["clean", "-f", "--", &path]).await?;
            }
        }
        Ok(())
    }

    pub(crate) async fn revert_git_paths(
        &self,
        workspace_id: String,
        paths: Vec<String>,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let expanded = expand_daemon_git_action_paths(
            &repo_root,
            &paths,
            crate::git_utils::GitStatusLayer::Workdir,
        );
        if expanded.is_empty() {
            return Err("path is required".to_string());
        }
        let _ = run_daemon_git_command_with_paths(
            &repo_root,
            &["restore", "--worktree", "--"],
            &expanded,
        )
        .await;
        // Match single-file semantics: clean only when needed, and never fail the batch
        // solely because a tracked path is not cleanable.
        for path in &expanded {
            let _ = git_core::run_git_command(&repo_root, &["clean", "-f", "--", path]).await;
        }
        Ok(())
    }

    pub(crate) async fn revert_git_all(
        &self,
        workspace_id: String,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        git_core::run_git_command(
            &repo_root,
            &["restore", "--staged", "--worktree", "--", "."],
        )
        .await?;
        git_core::run_git_command(&repo_root, &["clean", "-f", "-d"]).await?;
        Ok(())
    }

    pub(crate) async fn commit_git(
        &self,
        workspace_id: String,
        message: String,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let message = message.trim();
        if message.is_empty() {
            return Err("message is required".to_string());
        }
        git_core::run_git_command(&repo_root, &["commit", "-m", message]).await?;
        Ok(())
    }
}
