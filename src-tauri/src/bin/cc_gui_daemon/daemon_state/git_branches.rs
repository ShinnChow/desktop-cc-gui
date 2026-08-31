use super::git::*;
use super::*;

impl DaemonState {
    pub(crate) async fn list_git_branches(
        &self,
        workspace_id: String,
        repository_root: Option<String>,
    ) -> Result<Value, String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        if !crate::git_utils::path_has_git_repository_marker(&repo_root) {
            return Ok(json!({
                "branches": [],
                "localBranches": [],
                "remoteBranches": [],
                "currentBranch": null,
                "repositoryState": "not_git_repository",
                "diagnostic": {
                    "kind": "neutral_non_repository",
                    "reason": "missing_git_marker",
                    "workspaceId": workspace_id,
                    "pathKind": "workspace_path"
                }
            }));
        }
        let repo = open_repository_at_root(&repo_root)?;
        let current_branch = repo
            .head()
            .ok()
            .filter(|head| head.is_branch())
            .and_then(|head| head.shorthand().map(|name| name.to_string()));

        let mut branches = Vec::<BranchInfo>::new();
        let mut local_branches = Vec::<GitBranchListItem>::new();
        let local_refs = repo
            .branches(Some(git2::BranchType::Local))
            .map_err(|error| error.to_string())?;
        for branch_result in local_refs {
            let (branch, _) = branch_result.map_err(|error| error.to_string())?;
            let name = branch.name().ok().flatten().unwrap_or("").to_string();
            if name.is_empty() {
                continue;
            }
            let local_oid = branch.get().target();
            let last_commit = local_oid
                .and_then(|oid| repo.find_commit(oid).ok())
                .map(|commit| commit.time().seconds())
                .unwrap_or(0);
            let mut ahead = 0usize;
            let mut behind = 0usize;
            let mut upstream = None;
            if let Ok(upstream_branch) = branch.upstream() {
                let upstream_ref = upstream_branch.get();
                upstream = upstream_ref
                    .shorthand()
                    .map(|name| name.to_string())
                    .or_else(|| upstream_ref.name().map(|name| name.to_string()));
                if let (Some(local_oid), Some(upstream_oid)) = (local_oid, upstream_ref.target()) {
                    if let Ok((ahead_count, behind_count)) =
                        repo.graph_ahead_behind(local_oid, upstream_oid)
                    {
                        ahead = ahead_count;
                        behind = behind_count;
                    }
                }
            }

            branches.push(BranchInfo {
                name: name.clone(),
                last_commit,
            });
            local_branches.push(GitBranchListItem {
                name: name.clone(),
                is_current: current_branch.as_deref() == Some(name.as_str()),
                is_remote: false,
                remote: None,
                last_commit,
                head_sha: local_oid.map(|oid| oid.to_string()),
                ahead,
                behind,
                upstream,
            });
        }
        branches.sort_by(|left, right| right.last_commit.cmp(&left.last_commit));
        local_branches.sort_by(|left, right| left.name.cmp(&right.name));

        let mut remote_branches = Vec::<GitBranchListItem>::new();
        let remote_refs = repo
            .branches(Some(git2::BranchType::Remote))
            .map_err(|error| error.to_string())?;
        for branch_result in remote_refs {
            let (branch, _) = branch_result.map_err(|error| error.to_string())?;
            let name = branch.name().ok().flatten().unwrap_or("").to_string();
            if name.is_empty() || name.ends_with("/HEAD") {
                continue;
            }
            let (remote, _) =
                parse_remote_branch(&name).unwrap_or_else(|| ("origin".to_string(), name.clone()));
            let last_commit = branch
                .get()
                .target()
                .and_then(|oid| repo.find_commit(oid).ok())
                .map(|commit| commit.time().seconds())
                .unwrap_or(0);
            remote_branches.push(GitBranchListItem {
                name,
                is_current: false,
                is_remote: true,
                remote: Some(remote),
                last_commit,
                head_sha: branch.get().target().map(|oid| oid.to_string()),
                ahead: 0,
                behind: 0,
                upstream: None,
            });
        }
        remote_branches.sort_by(|left, right| left.name.cmp(&right.name));

        Ok(json!({
            "branches": branches,
            "localBranches": local_branches,
            "remoteBranches": remote_branches,
            "currentBranch": current_branch,
            "repositoryState": "git_repository"
        }))
    }

    pub(crate) async fn checkout_git_branch(
        &self,
        workspace_id: String,
        name: String,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        match git_core::run_git_command(&repo_root, &["checkout", trimmed]).await {
            Ok(_) => Ok(()),
            Err(first_error) => {
                if trimmed.contains('/') {
                    let local = trimmed.split('/').next_back().unwrap_or(trimmed);
                    git_core::run_git_command(
                        &repo_root,
                        &["checkout", "-b", local, "--track", trimmed],
                    )
                    .await
                    .map(|_| ())
                    .map_err(|_| first_error)
                } else {
                    Err(first_error)
                }
            }
        }
    }

    pub(crate) async fn create_git_branch(
        &self,
        workspace_id: String,
        name: String,
        repository_root: Option<String>,
    ) -> Result<(), String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let name = normalize_local_branch_ref(&name);
        if name.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        git_core::run_git_command(&repo_root, &["checkout", "-b", &name]).await?;
        Ok(())
    }

    pub(crate) async fn create_git_branch_from_branch(
        &self,
        workspace_id: String,
        name: String,
        source_branch: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let name = normalize_local_branch_ref(&name);
        let source_branch = source_branch.trim().to_string();
        if name.is_empty() || source_branch.is_empty() {
            return Err("Branch name and source branch are required.".to_string());
        }
        git_core::run_git_command(
            &repo_root,
            &["checkout", "-b", &name, source_branch.as_str()],
        )
        .await?;
        Ok(())
    }

    pub(crate) async fn create_git_branch_from_commit(
        &self,
        workspace_id: String,
        name: String,
        commit_hash: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let name = normalize_local_branch_ref(&name);
        let commit_hash = commit_hash.trim().to_string();
        if name.is_empty() || commit_hash.is_empty() {
            return Err("Branch name and commit hash are required.".to_string());
        }
        git_core::run_git_command(&repo_root, &["checkout", "-b", &name, commit_hash.as_str()])
            .await?;
        Ok(())
    }

    pub(crate) async fn delete_git_branch(
        &self,
        workspace_id: String,
        name: String,
        force: Option<bool>,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let name = normalize_local_branch_ref(&name);
        if name.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        let flag = if force.unwrap_or(false) { "-D" } else { "-d" };
        git_core::run_git_command(&repo_root, &["branch", flag, &name]).await?;
        Ok(())
    }

    pub(crate) async fn rename_git_branch(
        &self,
        workspace_id: String,
        old_name: String,
        new_name: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let old_name = normalize_local_branch_ref(&old_name);
        let new_name = normalize_local_branch_ref(&new_name);
        if old_name.is_empty() || new_name.is_empty() {
            return Err("Both old and new branch names are required.".to_string());
        }
        git_core::run_git_command(&repo_root, &["branch", "-m", &old_name, &new_name]).await?;
        Ok(())
    }

    pub(crate) async fn merge_git_branch(
        &self,
        workspace_id: String,
        name: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let branch_name = name.trim();
        if branch_name.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        git_core::run_git_command(&repo_root, &["merge", branch_name]).await?;
        Ok(())
    }

    pub(crate) async fn rebase_git_branch(
        &self,
        workspace_id: String,
        onto_branch: String,
    ) -> Result<(), String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let branch_name = onto_branch.trim();
        if branch_name.is_empty() {
            return Err("Target branch cannot be empty.".to_string());
        }
        git_core::run_git_command(&repo_root, &["rebase", branch_name]).await?;
        Ok(())
    }
}
