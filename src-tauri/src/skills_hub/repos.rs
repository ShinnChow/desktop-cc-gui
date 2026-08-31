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
use super::http::*;
use super::target_sync::*;
use super::lifecycle::*;
use super::discover::*;
use super::updates_popular::*;
use super::usage::*;

// ===== repos 管理 =====

/// upstream normalizeRepo。
pub(super) fn normalize_repo(repo: &Value) -> Value {
    let owner = js_string(repo.get("owner")).trim().to_string();
    let name = js_string(repo.get("name")).trim().to_string();
    let branch = {
        let branch = js_string(repo.get("branch")).trim().to_string();
        if branch.is_empty() {
            "main".to_string()
        } else {
            branch
        }
    };
    let enabled = repo.get("enabled").and_then(Value::as_bool).unwrap_or(true);
    json!({"owner": owner, "name": name, "branch": branch, "enabled": enabled})
}

/// upstream OWNER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/。
pub(super) fn owner_name_valid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > 100 || !bytes[0].is_ascii_alphanumeric() {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|b| b.is_ascii_alphanumeric() || *b == b'.' || *b == b'_' || *b == b'-')
}

pub(super) fn list_repos() -> Vec<Value> {
    read_registry().repos.iter().map(normalize_repo).collect()
}

pub(super) fn invalidate_discover_cache() {
    let _ = fs::remove_file(discover_cache_path());
}

/// 按 `"owner/name"` 小写去重（upstream addRepo/removeRepo 共用）。
pub(super) fn retain_repos_not(repos: &mut Vec<Value>, key: &str) {
    repos.retain(|entry| {
        format!(
            "{}/{}",
            js_string(entry.get("owner")),
            js_string(entry.get("name"))
        )
        .to_lowercase()
            != key
    });
}

/// upstream addRepo：校验 → 去重 → push → 失效 discover 缓存。
pub(super) fn add_repo(repo_input: &Value) -> SkillResult<Value> {
    let repo = normalize_repo(repo_input);
    let owner = js_string(repo.get("owner"));
    let name = js_string(repo.get("name"));
    let branch = js_string(repo.get("branch"));
    if owner.is_empty() || name.is_empty() {
        return Err(SkillError::other("Repository owner and name are required"));
    }
    if !owner_name_valid(&owner) || !owner_name_valid(&name) {
        return Err(SkillError::other(
            "Repository owner and name may only contain letters, digits, '.', '_', or '-'",
        ));
    }
    if !owner_name_valid(&branch) {
        return Err(SkillError::other(
            "Repository branch contains unsupported characters",
        ));
    }
    let mut registry = read_registry();
    retain_repos_not(
        &mut registry.repos,
        &format!("{owner}/{name}").to_lowercase(),
    );
    registry.repos.push(repo.clone());
    save_registry(&registry)?;
    invalidate_discover_cache();
    Ok(json!({"ok": true, "repo": repo}))
}

/// upstream removeRepo。
pub(super) fn remove_repo(owner: &str, name: &str) -> SkillResult<Value> {
    let mut registry = read_registry();
    retain_repos_not(
        &mut registry.repos,
        &format!("{owner}/{name}").to_lowercase(),
    );
    save_registry(&registry)?;
    invalidate_discover_cache();
    Ok(json!({"ok": true}))
}
