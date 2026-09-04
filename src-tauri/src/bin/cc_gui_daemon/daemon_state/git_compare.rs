use super::git::*;
use super::*;

impl DaemonState {
    pub(crate) async fn get_git_branch_compare_commits(
        &self,
        workspace_id: String,
        target_branch: String,
        current_branch: String,
        limit: Option<usize>,
    ) -> Result<GitBranchCompareCommitSets, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let target_branch = target_branch.trim().to_string();
        let current_branch = current_branch.trim().to_string();
        if target_branch.is_empty() || current_branch.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        if target_branch == current_branch {
            return Ok(GitBranchCompareCommitSets {
                target_only_commits: Vec::new(),
                current_only_commits: Vec::new(),
            });
        }
        let max_items = limit.unwrap_or(200).clamp(1, 500);
        let target_only_raw = git_core::run_git_command(
            &repo_root,
            &[
                "log",
                "--format=%H%x1f%an%x1f%ae%x1f%ct%x1f%s%x1f%B%x1e",
                &target_branch.to_string(),
                &format!("^{current_branch}"),
                "-n",
                &max_items.to_string(),
            ],
        )
        .await
        .unwrap_or_default();
        let current_only_raw = git_core::run_git_command(
            &repo_root,
            &[
                "log",
                "--format=%H%x1f%an%x1f%ae%x1f%ct%x1f%s%x1f%B%x1e",
                &current_branch.to_string(),
                &format!("^{target_branch}"),
                "-n",
                &max_items.to_string(),
            ],
        )
        .await
        .unwrap_or_default();

        let parse_commits = |raw: &str| -> Vec<GitHistoryCommit> {
            raw.split('\x1e')
                .filter_map(|record| {
                    let record = record.trim();
                    if record.is_empty() {
                        return None;
                    }
                    let mut parts = record.split('\x1f');
                    let sha = parts.next()?.trim().to_string();
                    let author = parts.next().unwrap_or("").trim().to_string();
                    let author_email = parts.next().unwrap_or("").trim().to_string();
                    let timestamp = parts
                        .next()
                        .and_then(|v| v.trim().parse::<i64>().ok())
                        .unwrap_or(0);
                    let summary = parts.next().unwrap_or("").trim().to_string();
                    let message = parts.next().unwrap_or("").trim().to_string();
                    Some(GitHistoryCommit {
                        short_sha: sha.chars().take(7).collect(),
                        sha,
                        summary,
                        message,
                        author,
                        author_email,
                        timestamp,
                        parents: Vec::new(),
                        refs: Vec::new(),
                        file_path: None,
                    })
                })
                .collect()
        };
        Ok(GitBranchCompareCommitSets {
            target_only_commits: parse_commits(&target_only_raw),
            current_only_commits: parse_commits(&current_only_raw),
        })
    }

    pub(crate) async fn get_git_branch_diff_between_branches(
        &self,
        workspace_id: String,
        from_branch: String,
        to_branch: String,
    ) -> Result<Vec<GitCommitDiff>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let from_branch = from_branch.trim().to_string();
        let to_branch = to_branch.trim().to_string();
        if from_branch.is_empty() || to_branch.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        if from_branch == to_branch {
            return Ok(Vec::new());
        }
        let output = crate::utils::async_command(
            crate::utils::resolve_git_binary()
                .map_err(|error| format!("Failed to run git: {error}"))?,
        )
        .args([
            "diff",
            "--name-status",
            "--find-renames",
            from_branch.as_str(),
            to_branch.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", crate::utils::git_env_path())
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "Git diff command failed.",
            ));
        }
        let mut results = Vec::<GitCommitDiff>::new();
        for raw_line in String::from_utf8_lossy(&output.stdout).lines() {
            let line = raw_line.trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split('\t');
            let raw_status = parts.next().unwrap_or("").trim();
            if raw_status.is_empty() {
                continue;
            }
            let status = raw_status.chars().next().unwrap_or('M').to_string();
            let path = if raw_status.starts_with('R') || raw_status.starts_with('C') {
                parts.nth(1)
            } else {
                parts.next()
            };
            let Some(path) = path else {
                continue;
            };
            if path.trim().is_empty() {
                continue;
            }
            results.push(GitCommitDiff {
                path: normalize_git_path(path),
                status,
                diff: String::new(),
                is_binary: false,
                is_image: false,
                old_image_data: None,
                new_image_data: None,
                old_image_mime: None,
                new_image_mime: None,
            });
        }
        Ok(results)
    }

    pub(crate) async fn get_git_branch_file_diff_between_branches(
        &self,
        workspace_id: String,
        from_branch: String,
        to_branch: String,
        path: String,
    ) -> Result<GitCommitDiff, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let from_branch = from_branch.trim().to_string();
        let to_branch = to_branch.trim().to_string();
        let normalized_path = normalize_git_path(&path);
        if from_branch.is_empty() || to_branch.is_empty() || normalized_path.trim().is_empty() {
            return Err("Invalid branch or path.".to_string());
        }
        let output = crate::utils::async_command(
            crate::utils::resolve_git_binary()
                .map_err(|error| format!("Failed to run git: {error}"))?,
        )
        .args([
            "diff",
            "--no-color",
            "--find-renames",
            from_branch.as_str(),
            to_branch.as_str(),
            "--",
            normalized_path.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", crate::utils::git_env_path())
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "Git diff command failed.",
            ));
        }
        let mut entries = parse_patch_diff_entries(&String::from_utf8_lossy(&output.stdout));
        if let Some(entry) = entries.pop() {
            return Ok(entry);
        }
        Ok(GitCommitDiff {
            path: normalized_path,
            status: "M".to_string(),
            diff: String::new(),
            is_binary: false,
            is_image: false,
            old_image_data: None,
            new_image_data: None,
            old_image_mime: None,
            new_image_mime: None,
        })
    }

    pub(crate) async fn get_git_worktree_diff_against_branch(
        &self,
        workspace_id: String,
        branch: String,
    ) -> Result<Vec<GitCommitDiff>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let branch_name = branch.trim().to_string();
        if branch_name.is_empty() {
            return Err("Branch name cannot be empty.".to_string());
        }
        let output = crate::utils::async_command(
            crate::utils::resolve_git_binary()
                .map_err(|error| format!("Failed to run git: {error}"))?,
        )
        .args([
            "diff",
            "--name-status",
            "--find-renames",
            branch_name.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", crate::utils::git_env_path())
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "Git diff command failed.",
            ));
        }
        let mut results = Vec::<GitCommitDiff>::new();
        for raw_line in String::from_utf8_lossy(&output.stdout).lines() {
            let line = raw_line.trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split('\t');
            let raw_status = parts.next().unwrap_or("").trim();
            if raw_status.is_empty() {
                continue;
            }
            let status = raw_status.chars().next().unwrap_or('M').to_string();
            let path = if raw_status.starts_with('R') || raw_status.starts_with('C') {
                parts.nth(1)
            } else {
                parts.next()
            };
            let Some(path) = path else {
                continue;
            };
            if path.trim().is_empty() {
                continue;
            }
            results.push(GitCommitDiff {
                path: normalize_git_path(path),
                status,
                diff: String::new(),
                is_binary: false,
                is_image: false,
                old_image_data: None,
                new_image_data: None,
                old_image_mime: None,
                new_image_mime: None,
            });
        }
        Ok(results)
    }

    pub(crate) async fn get_git_worktree_file_diff_against_branch(
        &self,
        workspace_id: String,
        branch: String,
        path: String,
    ) -> Result<GitCommitDiff, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let branch_name = branch.trim().to_string();
        let normalized_path = normalize_git_path(&path);
        if branch_name.is_empty() || normalized_path.trim().is_empty() {
            return Err("Invalid branch or path.".to_string());
        }
        let output = crate::utils::async_command(
            crate::utils::resolve_git_binary()
                .map_err(|error| format!("Failed to run git: {error}"))?,
        )
        .args([
            "diff",
            "--no-color",
            "--find-renames",
            branch_name.as_str(),
            "--",
            normalized_path.as_str(),
        ])
        .current_dir(&repo_root)
        .env("PATH", crate::utils::git_env_path())
        .output()
        .await
        .map_err(|error| format!("Failed to run git: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "Git diff command failed.",
            ));
        }
        let mut entries = parse_patch_diff_entries(&String::from_utf8_lossy(&output.stdout));
        if let Some(entry) = entries.pop() {
            return Ok(entry);
        }
        Ok(GitCommitDiff {
            path: normalized_path,
            status: "M".to_string(),
            diff: String::new(),
            is_binary: false,
            is_image: false,
            old_image_data: None,
            new_image_data: None,
            old_image_mime: None,
            new_image_mime: None,
        })
    }
}
