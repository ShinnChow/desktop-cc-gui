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

use super::fsutil::*;
use super::scan::*;
use super::registry::*;
use super::http::*;
use super::target_sync::*;
use super::lifecycle::*;
use super::repos::*;
use super::discover::*;
use super::updates_popular::*;
use super::usage::*;

// ===== 常量（与 upstream skills-manager.js / skill-usage.js 对齐） =====

pub(super) const FETCH_TIMEOUT: Duration = Duration::from_secs(20); // upstream FETCH_TIMEOUT_MS
pub(super) const DISCOVER_CONCURRENCY: usize = 4; // upstream DISCOVER_CONCURRENCY
pub(super) const DISCOVER_CACHE_TTL_MS: i64 = 60 * 60 * 1000; // 1 小时
pub(super) const UPDATE_CACHE_TTL_MS: i64 = 60 * 60 * 1000; // 1 小时
pub(super) const UPDATE_CHECK_CONCURRENCY: usize = 2; // upstream UPDATE_CHECK_CONCURRENCY
pub(super) const POPULAR_CACHE_TTL_MS: i64 = 6 * 60 * 60 * 1000; // 6 小时
pub(super) const TRASH_TTL_MS: i64 = 5 * 60 * 1000; // 5 分钟
pub(super) const ACTIVITY_MAX: usize = 500; // upstream ACTIVITY_MAX
pub(super) const ACTIVITY_TRIM_BYTES: u64 = 256 * 1024; // 超过则截尾保留最后 ACTIVITY_MAX 行
pub(super) const USAGE_CACHE_TTL_MS: i64 = 10 * 60 * 1000; // 10 分钟
pub(super) const MAX_LOCAL_SKILL_SCAN_DEPTH: usize = 3; // upstream MAX_LOCAL_SKILL_SCAN_DEPTH
pub(super) const DISCOVER_MAX_SKILLS_PER_REPO: usize = 200; // upstream discover 单 repo 截断 200
pub(super) const POPULAR_SEED_QUERIES: [&str; 12] = [
    "agent", "code", "test", "review", "git", "web", "design", "data", "docs", "python", "api",
    "deploy",
];
pub(super) const HASH_IGNORE: [&str; 4] = [".git", ".DS_Store", "Thumbs.db", ".gitignore"];

// ===== 错误类型：RateLimit 需要在 allSettled 语义里被单独识别并上抛 =====

#[derive(Debug)]
pub(super) enum SkillError {
    /// GitHub / skills.sh 限流（HTTP 429|403），文案必须与 upstream 一致。
    RateLimited(String),
    Other(String),
}

impl SkillError {
    pub(super) fn other(message: impl Into<String>) -> Self {
        Self::Other(message.into())
    }
    pub(super) fn is_rate_limited(&self) -> bool {
        matches!(self, Self::RateLimited(_))
    }
}

impl std::fmt::Display for SkillError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::RateLimited(m) | Self::Other(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for SkillError {}

impl From<std::io::Error> for SkillError {
    fn from(error: std::io::Error) -> Self {
        Self::Other(error.to_string())
    }
}

pub(super) type SkillResult<T> = Result<T, SkillError>;

// ===== 路径解析：SSOT 根目录（可注入）与 8 个 sync target =====

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub(super) fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("/"))
}

/// SSOT 根目录：env `CCGUI_SKILLS_HOME` 覆盖（测试注入点），缺省 `~/.ccgui/skills`。
pub(super) fn skills_root() -> PathBuf {
    if let Some(override_dir) = std::env::var_os("CCGUI_SKILLS_HOME") {
        if !override_dir.is_empty() {
            return PathBuf::from(override_dir);
        }
    }
    home_dir().join(".ccgui").join("skills")
}

pub(super) fn registry_path() -> PathBuf {
    skills_root().join("registry.json")
}
pub(super) fn ssot_dir() -> PathBuf {
    skills_root().join("managed")
}
pub(super) fn trash_dir() -> PathBuf {
    skills_root().join(".trash")
}
pub(super) fn tmp_dir() -> PathBuf {
    skills_root().join("tmp")
}
pub(super) fn discover_cache_path() -> PathBuf {
    skills_root().join("discover-cache.json")
}
pub(super) fn updates_cache_path() -> PathBuf {
    skills_root().join("updates-cache.json")
}
pub(super) fn popular_cache_path() -> PathBuf {
    skills_root().join("popular-cache.json")
}
pub(super) fn activity_path() -> PathBuf {
    skills_root().join("activity.jsonl")
}
pub(super) fn usage_cache_path() -> PathBuf {
    skills_root().join("usage-cache.json")
}

/// 对应 upstream grok-hook.js 的 resolveGrokHome：
/// `$TOKENTRACKER_GROK_HOME` → `$GROK_HOME` → `~/.grok`。
pub(super) fn resolve_grok_home() -> PathBuf {
    if let Ok(value) = std::env::var("TOKENTRACKER_GROK_HOME") {
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }
    if let Ok(value) = std::env::var("GROK_HOME") {
        if !value.is_empty() {
            return PathBuf::from(value);
        }
    }
    home_dir().join(".grok")
}

pub(super) fn is_dir(path: &Path) -> bool {
    fs::metadata(path)
        .map(|meta| meta.is_dir())
        .unwrap_or(false)
}

/// 对应 upstream antigravity-paths.js 的 resolveAntigravitySkillDirs。
pub(super) fn resolve_antigravity_skill_dirs() -> Vec<PathBuf> {
    if let Ok(value) = std::env::var("TOKENTRACKER_ANTIGRAVITY_HOME") {
        let trimmed = value.trim();
        if !trimmed.is_empty() {
            return vec![PathBuf::from(trimmed).join("skills")];
        }
    }
    let home = std::env::var_os("HOME")
        .filter(|v| !v.is_empty())
        .or_else(|| std::env::var_os("USERPROFILE").filter(|v| !v.is_empty()))
        .map(PathBuf::from)
        .unwrap_or_else(home_dir);
    let gemini_home = home.join(".gemini");
    let main_skills = gemini_home.join("antigravity").join("skills");
    let ide_skills = gemini_home.join("antigravity-ide").join("skills");
    let mut dirs = Vec::new();
    if is_dir(&gemini_home.join("antigravity")) {
        dirs.push(main_skills.clone());
    }
    if is_dir(&gemini_home.join("antigravity-ide")) {
        dirs.push(ide_skills);
    }
    if dirs.is_empty() {
        vec![main_skills]
    } else {
        dirs
    } // 都不存在时回退 main，保证 targetList 稳定
}

/// 8 个 sync target 的目录种类；目录在调用时按 env/home 动态解析。
pub(super) enum TargetKind {
    Claude,
    Codex,
    Grok,
    Antigravity,
    Gemini,
    Opencode,
    Hermes,
    Agents,
}

pub(super) struct Target {
    pub(super) id: &'static str,
    pub(super) label: &'static str,
    pub(super) visible: bool, // visible=false 不进 targetList，但参与全部 sync/scan/classify
    pub(super) kind: TargetKind,
}

/// 与 upstream TARGETS 顺序固定一致。
pub(super) static TARGETS: [Target; 8] = [
    Target {
        id: "claude",
        label: "Claude",
        visible: true,
        kind: TargetKind::Claude,
    },
    Target {
        id: "codex",
        label: "Codex",
        visible: true,
        kind: TargetKind::Codex,
    },
    Target {
        id: "grok",
        label: "Grok",
        visible: true,
        kind: TargetKind::Grok,
    },
    Target {
        id: "antigravity",
        label: "Antigravity",
        visible: true,
        kind: TargetKind::Antigravity,
    },
    Target {
        id: "gemini",
        label: "Gemini",
        visible: true,
        kind: TargetKind::Gemini,
    },
    Target {
        id: "opencode",
        label: "OpenCode",
        visible: true,
        kind: TargetKind::Opencode,
    },
    Target {
        id: "hermes",
        label: "Hermes",
        visible: true,
        kind: TargetKind::Hermes,
    },
    Target {
        id: "agents",
        label: "Agents",
        visible: false,
        kind: TargetKind::Agents,
    },
];

pub(super) fn target_by_id(id: &str) -> Option<&'static Target> {
    TARGETS.iter().find(|target| target.id == id)
}

/// 对应 upstream targetDirs：单目录 target 返回 1 个，多目录 target（Antigravity）返回多个。
pub(super) fn target_dirs(target: &Target) -> Vec<PathBuf> {
    let home = home_dir();
    match target.kind {
        TargetKind::Claude => vec![home.join(".claude").join("skills")],
        TargetKind::Codex => vec![home.join(".codex").join("skills")],
        TargetKind::Grok => vec![resolve_grok_home().join("skills")],
        TargetKind::Antigravity => resolve_antigravity_skill_dirs(),
        TargetKind::Gemini => vec![home.join(".gemini").join("skills")],
        TargetKind::Opencode => vec![home.join(".config").join("opencode").join("skills")],
        TargetKind::Hermes => vec![home.join(".hermes").join("skills")],
        TargetKind::Agents => vec![home.join(".agents").join("skills")],
    }
}

/// 对应 upstream targetPrimaryDir（多目录 target 取第一个用于 UI 展示）。
pub(super) fn target_primary_dir(target: &Target) -> PathBuf {
    target_dirs(target).into_iter().next().unwrap_or_default()
}

/// 对应 upstream targetList：仅 visible target。
pub(super) fn target_list() -> Vec<Value> {
    TARGETS
        .iter()
        .filter(|target| target.visible)
        .map(|t| json!({"id": t.id, "label": t.label, "path": target_primary_dir(t).to_string_lossy()}))
        .collect()
}
