//! TokenTracker skills 后端的逐语义 Rust 移植（有意的单文件模块，对照上游单文件 `skills-manager.js`）。
//!
//! 上游对照：
//! - `TokenTracker/src/lib/skills-manager.js`：registry / install / discover / updates / trash /
//!   activity / targets sync 等全部核心逻辑。
//! - `TokenTracker/src/lib/skill-usage.js`：`~/.claude/projects/**/*.jsonl` 的 Skill 调用统计。
//! - `TokenTracker/src/lib/local-api.js` 的 `/functions/tokentracker-skills` 端点（GET/POST 分发），
//!   对应本文件底部的 [`skills_hub_query`] / [`skills_hub_mutate`]。
//!
//! 与 upstream 的故意偏差（仅 4 条）：
//! 1. SSOT 根目录为 `~/.ccgui/skills`（可用 env `CCGUI_SKILLS_HOME` 覆盖，便于测试隔离），upstream
//!    是 `~/.tokentracker/skills`；子布局一致（managed/ .trash/ tmp/ registry.json discover-cache.json
//!    updates-cache.json popular-cache.json activity.jsonl usage-cache.json）。
//! 2. skill_usage 响应不输出 cost 与 models（定价表不移植）。
//! 3. 排序使用 Rust codepoint 序（`Ord`），upstream 用 `String.localeCompare`（本地化排序）。
//! 4. 不移植 local-auth token / loopback origin 校验（Tauri IPC 天然可信）。
//!
//! 注：registry 条目的 sourceSignature 为 null 时省略该字段——这是移植契约的规定行为
//! （upstream 会写出 `"sourceSignature": null`），不属于额外偏差。

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use super::core::*;
use super::fsutil::*;
use super::scan::*;
use super::registry::*;
use super::target_sync::*;
use super::lifecycle::*;
use super::repos::*;
use super::discover::*;
use super::updates_popular::*;
use super::usage::*;

// ===== 网络层：UA tokentracker-skills + Accept + 20s 超时，429/403 → RateLimit =====

pub(super) fn http_client() -> SkillResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("tokentracker-skills")
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| SkillError::other(format!("Failed to build HTTP client: {e}")))
}

pub(super) fn rate_limit_error(status: reqwest::StatusCode) -> SkillError {
    let msg = format!(
        "GitHub rate-limited this request (HTTP {}). Try again later.",
        status.as_u16()
    );
    SkillError::RateLimited(msg)
}

pub(super) async fn fetch_checked(response: reqwest::Response) -> SkillResult<reqwest::Response> {
    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS || status == reqwest::StatusCode::FORBIDDEN
    {
        return Err(rate_limit_error(status));
    }
    if !status.is_success() {
        return Err(SkillError::other(format!("HTTP {}", status.as_u16())));
    }
    Ok(response)
}

/// upstream fetchJson（Accept: application/vnd.github+json）。
pub(super) async fn fetch_json(client: &reqwest::Client, url: &str) -> SkillResult<Value> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| SkillError::other(format!("request failed: {e}")))?;
    fetch_checked(response)
        .await?
        .json::<Value>()
        .await
        .map_err(|e| SkillError::other(format!("invalid JSON response: {e}")))
}

/// upstream fetchText（Accept: text/plain）。
pub(super) async fn fetch_text(client: &reqwest::Client, url: &str) -> SkillResult<String> {
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "text/plain")
        .send()
        .await
        .map_err(|e| SkillError::other(format!("request failed: {e}")))?;
    fetch_checked(response)
        .await?
        .text()
        .await
        .map_err(|e| SkillError::other(format!("failed to read response body: {e}")))
}

/// upstream getRepoTree：branch 回退链 [配置 branch（除非 =~ /^head$/i）, main, master]
/// 去重逐个尝试；全部失败抛最后一个错误。
pub(super) async fn get_repo_tree(
    client: &reqwest::Client,
    owner: &str,
    name: &str,
    branch: &str,
) -> SkillResult<(String, Vec<Value>)> {
    let mut branches: Vec<String> = Vec::new();
    if !branch.is_empty() && !eq_ignore_case(branch, "head") {
        branches.push(branch.to_string());
    }
    for fallback in ["main", "master"] {
        if !branches.iter().any(|b| b == fallback) {
            branches.push(fallback.to_string());
        }
    }
    let mut last_error: Option<SkillError> = None;
    for candidate in &branches {
        let url = format!(
            "https://api.github.com/repos/{owner}/{name}/git/trees/{}?recursive=1",
            encode_uri_component(candidate)
        );
        match fetch_json(client, &url).await {
            Ok(data) => {
                if let Some(tree) = data.get("tree").and_then(Value::as_array) {
                    return Ok((candidate.clone(), tree.clone()));
                }
            }
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| SkillError::other(format!("Unable to read {owner}/{name}"))))
}

/// upstream mapWithConcurrency：固定 limit 的 worker 池，结果按输入顺序对齐。
/// （upstream 用 Promise.all，任一 reject 整体 reject；这里收集全部结果由调用方决定，
/// 等价于 allSettled + 调用方首个错误上抛。）
pub(super) async fn map_with_concurrency<T, R, F, Fut>(
    items: Vec<T>,
    limit: usize,
    worker: F,
) -> Vec<Result<R, SkillError>>
where
    T: Send + 'static,
    R: Send + 'static,
    F: Fn(T) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = Result<R, SkillError>> + Send + 'static,
{
    let count = items.len();
    let worker = Arc::new(worker);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(limit.max(1)));
    let mut set: tokio::task::JoinSet<(usize, Result<R, SkillError>)> = tokio::task::JoinSet::new();
    for (index, item) in items.into_iter().enumerate() {
        // 先拿 permit 再 spawn，等价于上游的 pool of N runners。
        let Ok(permit) = semaphore.clone().acquire_owned().await else {
            break;
        };
        let worker = Arc::clone(&worker);
        set.spawn(async move {
            let _permit = permit;
            let result = worker(item).await;
            (index, result)
        });
    }
    let mut results: Vec<Option<Result<R, SkillError>>> = Vec::new();
    results.resize_with(count, || None);
    while let Some(joined) = set.join_next().await {
        if let Ok((index, result)) = joined {
            results[index] = Some(result);
        }
    }
    results
        .into_iter()
        .map(|slot| slot.unwrap_or_else(|| Err(SkillError::other("concurrent worker failed"))))
        .collect::<Vec<_>>()
}
