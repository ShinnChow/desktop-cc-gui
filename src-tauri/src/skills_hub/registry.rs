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
use super::http::*;
use super::target_sync::*;
use super::lifecycle::*;
use super::repos::*;
use super::discover::*;
use super::updates_popular::*;
use super::usage::*;

// ===== registry 读写与 trash purge =====

pub(super) struct Registry {
    pub(super) repos: Vec<Value>,
    pub(super) skills: Vec<Value>,
}

/// upstream DEFAULT_REPOS。
pub(super) fn default_repos() -> Vec<Value> {
    vec![
        json!({"owner": "anthropics", "name": "skills", "branch": "main", "enabled": true}),
        json!({"owner": "ComposioHQ", "name": "awesome-claude-skills", "branch": "master", "enabled": true}),
        json!({"owner": "cexll", "name": "myclaude", "branch": "master", "enabled": true}),
        json!({"owner": "JimLiu", "name": "baoyu-skills", "branch": "main", "enabled": true}),
    ]
}

/// upstream readRegistry：文件缺失/解析失败 → 默认；repos 非数组 → DEFAULT_REPOS；
/// skills 非数组 → []。
pub(super) fn read_registry() -> Registry {
    if let Some(value) = read_json(&registry_path()) {
        if value.is_object() {
            let repos = value
                .get("repos")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_else(default_repos);
            let skills = value
                .get("skills")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            return Registry { repos, skills };
        }
    }
    Registry {
        repos: default_repos(),
        skills: Vec::new(),
    }
}

pub(super) fn save_registry(registry: &Registry) -> SkillResult<()> {
    write_json(
        &registry_path(),
        &json!({"repos": &registry.repos, "skills": &registry.skills}),
    )
}

/// 条目的 trashedAt（JS truthy 语义：非零数字才算 trashed）。
pub(super) fn trashed_at_of(skill: &Value) -> Option<f64> {
    skill
        .get("trashedAt")
        .and_then(Value::as_f64)
        .filter(|n| *n != 0.0)
}

/// upstream purgeExpiredTrash：trashedAt 距今 ≥ TRASH_TTL_MS → 删 trash 目录 + registry
/// 删条目；整体 best-effort。
pub(super) fn purge_expired_trash() {
    let now = now_ms();
    let mut registry = read_registry();
    let mut dirty = false;
    registry.skills.retain(|skill| {
        let Some(trashed_at) = trashed_at_of(skill) else {
            return true;
        };
        if now as f64 - trashed_at < TRASH_TTL_MS as f64 {
            return true;
        }
        if let Some(trashed_directory) = skill.get("trashedDirectory").and_then(Value::as_str) {
            if !trashed_directory.is_empty() {
                remove_path(&trash_dir().join(trashed_directory));
            }
        }
        dirty = true;
        false
    });
    if dirty {
        let _ = save_registry(&registry);
    }
}

// ===== activity 日志（best-effort，永不阻塞 mutation） =====

/// upstream appendActivity：`{ts, ...event}` 单行 JSON 追加（0o600）；
/// 超过 256KB 截尾保留最后 500 行；整体吞错。
pub(super) fn append_activity(event: Value) {
    let _ = (|| -> std::io::Result<()> {
        ensure_dir(&skills_root())?;
        let mut record = Map::new();
        record.insert("ts".to_string(), json!(now_ms()));
        if let Value::Object(map) = event {
            record.extend(map);
        }
        let line = serde_json::to_string(&Value::Object(record)).unwrap_or_default();
        append_line_private(&activity_path(), &format!("{line}\n"))?;
        let size = fs::metadata(&activity_path())
            .map(|meta| meta.len())
            .unwrap_or(0);
        if size > ACTIVITY_TRIM_BYTES {
            if let Some(raw) = read_text(&activity_path()) {
                let lines: Vec<&str> = raw.split('\n').filter(|l| !l.is_empty()).collect();
                let kept = &lines[lines.len().saturating_sub(ACTIVITY_MAX)..];
                write_file_private(&activity_path(), &format!("{}\n", kept.join("\n")))?;
            }
        }
        Ok(())
    })();
}

/// upstream readActivity：取末尾 limit 行（clamp [1,500]，0 → 100），解析失败的行丢弃，最新在前。
pub(super) fn read_activity(limit: i64) -> Vec<Value> {
    let want = (if limit == 0 { 100 } else { limit }).clamp(1, ACTIVITY_MAX as i64) as usize;
    let Some(raw) = read_text(&activity_path()) else {
        return Vec::new();
    };
    let lines: Vec<&str> = raw.split('\n').filter(|l| !l.is_empty()).collect();
    lines[lines.len().saturating_sub(want)..]
        .iter()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .rev()
        .collect()
}
