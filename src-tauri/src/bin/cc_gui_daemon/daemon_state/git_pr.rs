use super::git::*;
use super::*;

impl DaemonState {
    pub(crate) async fn get_git_push_preview(
        &self,
        workspace_id: String,
        remote: String,
        branch: String,
        limit: Option<usize>,
        repository_root: Option<String>,
    ) -> Result<GitPushPreviewResponse, String> {
        let repo_root = self
            .git_repo_root_for_scope(&workspace_id, repository_root.as_deref())
            .await?;
        let target_remote = remote.trim();
        if target_remote.is_empty() {
            return Err("Remote is required for push preview.".to_string());
        }
        let normalized_target_branch = normalize_remote_target_branch(target_remote, &branch);
        if normalized_target_branch.is_empty() {
            return Err("Target branch is required for push preview.".to_string());
        }
        let repo = open_repository_at_root(&repo_root)?;
        let source_oid = repo
            .head()
            .ok()
            .and_then(|head| head.target())
            .ok_or_else(|| "HEAD does not point to a commit.".to_string())?;
        let source_branch = git_core::run_git_command(&repo_root, &["branch", "--show-current"])
            .await
            .ok()
            .and_then(|value| trim_optional(Some(value)))
            .unwrap_or_else(|| "HEAD".to_string());
        let target_ref = format!("refs/remotes/{target_remote}/{normalized_target_branch}");
        let target_oid = repo.refname_to_id(&target_ref).ok();

        let max_items = limit.unwrap_or(120).clamp(1, 500);
        let mut revwalk = repo.revwalk().map_err(|error| error.to_string())?;
        revwalk
            .set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)
            .map_err(|error| error.to_string())?;
        revwalk
            .push(source_oid)
            .map_err(|error| error.to_string())?;
        if let Some(oid) = target_oid {
            revwalk.hide(oid).map_err(|error| error.to_string())?;
        }

        let mut commits = Vec::<GitHistoryCommit>::new();
        let mut has_more = false;
        for oid_result in revwalk {
            if commits.len() >= max_items {
                has_more = true;
                break;
            }
            let oid = oid_result.map_err(|error| error.to_string())?;
            let commit = repo.find_commit(oid).map_err(|error| error.to_string())?;
            let sha = commit.id().to_string();
            commits.push(GitHistoryCommit {
                short_sha: sha.chars().take(7).collect(),
                sha,
                summary: commit.summary().unwrap_or("").to_string(),
                message: commit.message().unwrap_or("").to_string(),
                author: commit.author().name().unwrap_or("").to_string(),
                author_email: commit.author().email().unwrap_or("").to_string(),
                timestamp: commit.time().seconds(),
                parents: commit
                    .parents()
                    .map(|parent| parent.id().to_string())
                    .collect(),
                refs: Vec::new(),
                file_path: None,
            });
        }

        Ok(GitPushPreviewResponse {
            source_branch,
            target_remote: target_remote.to_string(),
            target_branch: normalized_target_branch,
            target_ref,
            target_found: target_oid.is_some(),
            has_more,
            commits,
        })
    }

    pub(crate) async fn get_git_pr_workflow_defaults(
        &self,
        workspace_id: String,
    ) -> Result<GitPrWorkflowDefaults, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo = open_repository_at_root(&repo_root)?;
        let head_branch = git_core::run_git_command(&repo_root, &["branch", "--show-current"])
            .await
            .ok()
            .and_then(|value| trim_optional(Some(value)))
            .unwrap_or_default();
        let origin_repo = git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"])
            .await
            .ok()
            .and_then(|url| crate::git_utils::parse_github_repo(&url));
        let upstream_repo =
            git_core::run_git_command(&repo_root, &["remote", "get-url", "upstream"])
                .await
                .ok()
                .and_then(|url| crate::git_utils::parse_github_repo(&url))
                .or(origin_repo.clone())
                .unwrap_or_default();
        let base_branch = infer_remote_head_branch(&repo, "upstream")
            .or_else(|| infer_remote_head_branch(&repo, "origin"))
            .unwrap_or_else(|| "main".to_string());
        let head_owner = origin_repo
            .as_ref()
            .and_then(|repo_name| parse_repo_owner(repo_name))
            .or_else(|| parse_repo_owner(&upstream_repo))
            .unwrap_or_default();
        let title = repo
            .head()
            .ok()
            .and_then(|head| head.peel_to_commit().ok())
            .and_then(|commit| {
                commit
                    .summary()
                    .map(str::trim)
                    .filter(|summary| !summary.is_empty())
                    .map(ToOwned::to_owned)
            })
            .unwrap_or_else(|| format!("chore(git): create pr for {head_branch}"));
        let body = format!(
            "## Summary\n- Compare `{head_branch}` against `{base_branch}`\n\n## Validation\n- [ ] Local checks passed"
        );
        let comment_body = parse_repo_owner(&upstream_repo)
            .map(|owner| format!("@{owner} 麻烦审批，已完成验证。"))
            .unwrap_or_else(|| "@maintainer 麻烦审批，已完成验证。".to_string());
        let disabled_reason = if head_branch.trim().is_empty() {
            Some("Current branch is unavailable (detached HEAD or no local branch).".to_string())
        } else if upstream_repo.trim().is_empty() {
            Some("No GitHub remote detected. Configure upstream/origin remote first.".to_string())
        } else if head_owner.trim().is_empty() {
            Some("Cannot infer fork owner from origin remote URL.".to_string())
        } else {
            None
        };
        Ok(GitPrWorkflowDefaults {
            upstream_repo,
            base_branch,
            head_owner,
            head_branch,
            title,
            body,
            comment_body,
            can_create: disabled_reason.is_none(),
            disabled_reason,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn create_git_pr_workflow(
        &self,
        workspace_id: String,
        upstream_repo: String,
        base_branch: String,
        head_owner: String,
        head_branch: String,
        title: String,
        body: Option<String>,
        comment_after_create: Option<bool>,
        comment_body: Option<String>,
        allow_large_range: Option<bool>,
        confirmed_range_fingerprint: Option<String>,
    ) -> Result<GitPrWorkflowResult, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let upstream_repo = upstream_repo.trim().to_string();
        let base_branch = base_branch.trim().to_string();
        let head_owner = head_owner.trim().to_string();
        let head_branch = head_branch.trim().to_string();
        let title = title.trim().to_string();
        if upstream_repo.is_empty()
            || base_branch.is_empty()
            || head_owner.is_empty()
            || head_branch.is_empty()
            || title.is_empty()
        {
            return Err("Missing required PR workflow fields.".to_string());
        }

        let fetch_command = format!("git fetch upstream {base_branch}");
        if let Err(reason) = git_core::run_git_command_owned_non_interactive(
            repo_root.clone(),
            vec![
                "fetch".to_string(),
                "upstream".to_string(),
                base_branch.clone(),
            ],
        )
        .await
        {
            return Ok(build_pr_precheck_failure(reason, &fetch_command));
        }
        let base_ref = format!("upstream/{base_branch}");
        let revision_output = match git_core::run_git_command_owned_non_interactive(
            repo_root.clone(),
            vec![
                "rev-parse".to_string(),
                base_ref.clone(),
                "HEAD".to_string(),
            ],
        )
        .await
        {
            Ok(output) => output,
            Err(reason) => {
                return Ok(build_pr_precheck_failure(
                    reason,
                    "git rev-parse upstream/<base> HEAD",
                ));
            }
        };
        let Some(range_fingerprint) =
            git_pr_range_gate::parse_pr_range_fingerprint(&revision_output)
        else {
            return Ok(build_pr_precheck_failure(
                "Unable to resolve the current PR range fingerprint.".to_string(),
                "git rev-parse upstream/<base> HEAD",
            ));
        };
        let range_ref = format!("{base_ref}...HEAD");
        let range_output = match git_core::run_git_command_owned_non_interactive(
            repo_root.clone(),
            vec!["diff".to_string(), "--name-only".to_string(), range_ref],
        )
        .await
        {
            Ok(output) => output,
            Err(reason) => {
                return Ok(build_pr_precheck_failure(
                    reason,
                    "git diff --name-only upstream/<base>...HEAD",
                ));
            }
        };
        let changed_paths = range_output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>();
        match git_pr_range_gate::evaluate_pr_range_gate(
            &changed_paths,
            allow_large_range.unwrap_or(false),
            confirmed_range_fingerprint.as_deref(),
            &range_fingerprint,
        ) {
            git_pr_range_gate::PrRangeGateDecision::Pass { .. } => {}
            git_pr_range_gate::PrRangeGateDecision::ConfirmationRequired {
                category,
                reason,
                range_gate,
            } => {
                return Ok(GitPrWorkflowResult {
                    ok: false,
                    status: "failed".to_string(),
                    message: reason.clone(),
                    error_category: Some(category),
                    next_action_hint: Some(
                        "Review the large PR range, then confirm once to continue.".to_string(),
                    ),
                    pr_url: None,
                    pr_number: None,
                    existing_pr: None,
                    retry_command: None,
                    range_gate: Some(range_gate),
                    stages: vec![GitPrWorkflowStage {
                        key: "precheck".to_string(),
                        status: "failed".to_string(),
                        detail: reason,
                        command: Some("git diff --name-only upstream/<base>...HEAD".to_string()),
                        stdout: None,
                        stderr: None,
                    }],
                });
            }
            git_pr_range_gate::PrRangeGateDecision::Blocked { category, reason } => {
                return Ok(GitPrWorkflowResult {
                    ok: false,
                    status: "failed".to_string(),
                    message: reason.clone(),
                    error_category: Some(category),
                    next_action_hint: Some(
                        "Fix branch base/range first, then retry PR workflow.".to_string(),
                    ),
                    pr_url: None,
                    pr_number: None,
                    existing_pr: None,
                    retry_command: None,
                    range_gate: None,
                    stages: vec![GitPrWorkflowStage {
                        key: "precheck".to_string(),
                        status: "failed".to_string(),
                        detail: reason,
                        command: Some("git diff --name-only upstream/<base>...HEAD".to_string()),
                        stdout: None,
                        stderr: None,
                    }],
                });
            }
        }

        let body_text = trim_optional(body).unwrap_or_default();
        let head_ref = format!("{head_owner}:{head_branch}");
        let mut args = vec![
            "pr".to_string(),
            "create".to_string(),
            "--repo".to_string(),
            upstream_repo.clone(),
            "--base".to_string(),
            base_branch.clone(),
            "--head".to_string(),
            head_ref.clone(),
            "--title".to_string(),
            title.clone(),
        ];
        if body_text.is_empty() {
            args.push("--fill".to_string());
        } else {
            args.push("--body".to_string());
            args.push(body_text.clone());
        }
        let output = crate::utils::async_command("gh")
            .args(args.iter().map(String::as_str))
            .current_dir(&repo_root)
            .output()
            .await
            .map_err(|error| format!("Failed to run gh: {error}"))?;

        if !output.status.success() {
            let detail = parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "GitHub CLI command failed.",
            );
            return Ok(GitPrWorkflowResult {
                ok: false,
                status: "failed".to_string(),
                message: detail.clone(),
                error_category: Some("gh_pr_create".to_string()),
                next_action_hint: Some("Check gh auth/repo permissions, then retry.".to_string()),
                pr_url: None,
                pr_number: None,
                existing_pr: None,
                retry_command: Some(format!(
                    "gh pr create --repo {} --base {} --head {} --title {:?}",
                    upstream_repo, base_branch, head_ref, title
                )),
                range_gate: None,
                stages: vec![GitPrWorkflowStage {
                    key: "create-pr".to_string(),
                    status: "failed".to_string(),
                    detail: "Create pull request".to_string(),
                    command: Some("gh pr create".to_string()),
                    stdout: Some(String::from_utf8_lossy(&output.stdout).to_string()),
                    stderr: Some(String::from_utf8_lossy(&output.stderr).to_string()),
                }],
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let mut stages = vec![GitPrWorkflowStage {
            key: "create-pr".to_string(),
            status: "ok".to_string(),
            detail: "Create pull request".to_string(),
            command: Some("gh pr create".to_string()),
            stdout: Some(stdout.clone()),
            stderr: Some(String::from_utf8_lossy(&output.stderr).to_string()),
        }];

        let pr_url = extract_pr_url(&stdout);
        let pr_number = pr_url.as_deref().and_then(extract_pr_number);

        if comment_after_create.unwrap_or(false) {
            if let (Some(number), Some(comment_text)) = (pr_number, trim_optional(comment_body)) {
                let comment_output = crate::utils::async_command("gh")
                    .args([
                        "pr",
                        "comment",
                        &number.to_string(),
                        "--repo",
                        &upstream_repo,
                        "--body",
                        &comment_text,
                    ])
                    .current_dir(&repo_root)
                    .output()
                    .await
                    .map_err(|error| format!("Failed to run gh: {error}"))?;
                let comment_ok = comment_output.status.success();
                stages.push(GitPrWorkflowStage {
                    key: "comment".to_string(),
                    status: if comment_ok {
                        "ok".to_string()
                    } else {
                        "failed".to_string()
                    },
                    detail: "Comment on pull request".to_string(),
                    command: Some("gh pr comment".to_string()),
                    stdout: Some(String::from_utf8_lossy(&comment_output.stdout).to_string()),
                    stderr: Some(String::from_utf8_lossy(&comment_output.stderr).to_string()),
                });
            }
        }

        Ok(GitPrWorkflowResult {
            ok: true,
            status: "ok".to_string(),
            message: "Pull request created.".to_string(),
            error_category: None,
            next_action_hint: None,
            pr_url,
            pr_number,
            existing_pr: None,
            retry_command: None,
            range_gate: None,
            stages,
        })
    }

    pub(crate) async fn get_github_issues(
        &self,
        workspace_id: String,
    ) -> Result<GitHubIssuesResponse, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo_name = git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"])
            .await
            .ok()
            .and_then(|url| crate::git_utils::parse_github_repo(&url))
            .ok_or_else(|| "Unable to resolve GitHub repository from origin remote.".to_string())?;
        let output = crate::utils::async_command("gh")
            .args([
                "issue",
                "list",
                "--repo",
                &repo_name,
                "--limit",
                "50",
                "--json",
                "number,title,url,updatedAt",
            ])
            .current_dir(&repo_root)
            .output()
            .await
            .map_err(|error| format!("Failed to run gh: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "GitHub CLI command failed.",
            ));
        }
        let issues: Vec<GitHubIssue> =
            serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        Ok(GitHubIssuesResponse {
            total: issues.len(),
            issues,
        })
    }

    pub(crate) async fn get_github_pull_requests(
        &self,
        workspace_id: String,
    ) -> Result<GitHubPullRequestsResponse, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo_name = git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"])
            .await
            .ok()
            .and_then(|url| crate::git_utils::parse_github_repo(&url))
            .ok_or_else(|| "Unable to resolve GitHub repository from origin remote.".to_string())?;
        let output = crate::utils::async_command("gh")
            .args([
                "pr",
                "list",
                "--repo",
                &repo_name,
                "--state",
                "open",
                "--limit",
                "50",
                "--json",
                "number,title,url,updatedAt,createdAt,body,headRefName,baseRefName,isDraft,author",
            ])
            .current_dir(&repo_root)
            .output()
            .await
            .map_err(|error| format!("Failed to run gh: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "GitHub CLI command failed.",
            ));
        }
        let pull_requests: Vec<GitHubPullRequest> =
            serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        Ok(GitHubPullRequestsResponse {
            total: pull_requests.len(),
            pull_requests,
        })
    }

    pub(crate) async fn get_github_pull_request_diff(
        &self,
        workspace_id: String,
        pr_number: u64,
    ) -> Result<Vec<GitHubPullRequestDiff>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo_name = git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"])
            .await
            .ok()
            .and_then(|url| crate::git_utils::parse_github_repo(&url))
            .ok_or_else(|| "Unable to resolve GitHub repository from origin remote.".to_string())?;
        let output = crate::utils::async_command("gh")
            .args([
                "pr",
                "diff",
                &pr_number.to_string(),
                "--repo",
                &repo_name,
                "--color",
                "never",
            ])
            .current_dir(&repo_root)
            .output()
            .await
            .map_err(|error| format!("Failed to run gh: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "GitHub CLI command failed.",
            ));
        }
        Ok(parse_pr_diff_text(&String::from_utf8_lossy(&output.stdout)))
    }

    pub(crate) async fn get_github_pull_request_comments(
        &self,
        workspace_id: String,
        pr_number: u64,
    ) -> Result<Vec<GitHubPullRequestComment>, String> {
        let repo_root = self.git_repo_root(&workspace_id).await?;
        let repo_name = git_core::run_git_command(&repo_root, &["remote", "get-url", "origin"])
            .await
            .ok()
            .and_then(|url| crate::git_utils::parse_github_repo(&url))
            .ok_or_else(|| "Unable to resolve GitHub repository from origin remote.".to_string())?;
        let comments_endpoint =
            format!("/repos/{repo_name}/issues/{pr_number}/comments?per_page=30");
        let jq_filter = r#"[.[] | {id, body, createdAt: .created_at, url: .html_url, author: (if .user then {login: .user.login} else null end)}]"#;
        let output = crate::utils::async_command("gh")
            .args(["api", &comments_endpoint, "--jq", jq_filter])
            .current_dir(&repo_root)
            .output()
            .await
            .map_err(|error| format!("Failed to run gh: {error}"))?;
        if !output.status.success() {
            return Err(parse_git_error_detail(
                &output.stdout,
                &output.stderr,
                "GitHub CLI command failed.",
            ));
        }
        let comments: Vec<GitHubPullRequestComment> =
            serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
        Ok(comments)
    }
}
