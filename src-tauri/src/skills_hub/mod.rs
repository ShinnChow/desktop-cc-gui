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

mod core;
mod fsutil;
mod scan;
mod registry;
mod http;
mod target_sync;
mod lifecycle;
mod repos;
mod discover;
mod updates_popular;
mod usage;

pub(crate) use core::*;
pub(crate) use fsutil::*;
pub(crate) use scan::*;
pub(crate) use registry::*;
pub(crate) use http::*;
pub(crate) use target_sync::*;
pub(crate) use lifecycle::*;
pub(crate) use repos::*;
pub(crate) use discover::*;
pub(crate) use updates_popular::*;
pub(crate) use usage::*;

// ===== Tauri commands（对应 local-api.js 的 GET/POST 分发） =====

/// query 的 `force` 仅字符串 "1" 生效（对齐 upstream `get("force") === "1"`）。
fn param_force(params: &Value) -> bool {
    params.get("force").and_then(Value::as_str) == Some("1")
}

/// payload 里的字符串数组参数；key 缺失/非数组 → None（调用方决定默认值）。
fn string_array_param(payload: &Value, key: &str) -> Option<Vec<String>> {
    payload.get(key).and_then(Value::as_array).map(|arr| {
        arr.iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect()
    })
}

/// Skills Hub 查询端点（upstream GET /functions/tokentracker-skills）。
#[tauri::command]
pub(crate) async fn skills_hub_query(mode: String, params: Value) -> Result<Value, String> {
    let mode = if mode.is_empty() {
        "installed"
    } else {
        mode.as_str()
    };
    match mode {
        "installed" => tokio::task::spawn_blocking(
            || json!({"targets": target_list(), "skills": list_installed_skills()}),
        )
        .await
        .map_err(|e| format!("skills task failed: {e}")),
        "repos" => Ok(json!({"repos": list_repos()})),
        "discover" => discover_skills(param_force(&params))
            .await
            .map_err(|e| e.to_string()),
        "search" => {
            let q = js_string(params.get("q"));
            let limit = js_number_or(params.get("limit"), 20.0);
            let offset = js_number_or(params.get("offset"), 0.0);
            let client = http_client().map_err(|e| e.to_string())?;
            search_skills_sh(&client, &q, limit, offset)
                .await
                .map_err(|e| e.to_string())
        }
        "popular" => {
            let limit = js_number_or(params.get("limit"), 60.0);
            fetch_popular_skills_sh(param_force(&params), limit)
                .await
                .map_err(|e| e.to_string())
        }
        "updates" => check_updates(param_force(&params))
            .await
            .map_err(|e| e.to_string()),
        "activity" => {
            let limit = js_number_or(params.get("limit"), 50.0) as i64;
            Ok(json!({"activity": read_activity(limit)}))
        }
        "skill_usage" => {
            let force = param_force(&params);
            tokio::task::spawn_blocking(move || skill_usage_query(force))
                .await
                .map_err(|e| format!("skills task failed: {e}"))
        }
        _ => Err("Unknown skills mode".to_string()),
    }
}

/// Skills Hub 变更端点（upstream POST /functions/tokentracker-skills）。
#[tauri::command]
pub(crate) async fn skills_hub_mutate(action: String, payload: Value) -> Result<Value, String> {
    match action.as_str() {
        "install" => {
            let skill = payload.get("skill").cloned().unwrap_or(Value::Null);
            let targets = string_array_param(&payload, "targets")
                .unwrap_or_else(|| vec!["claude".to_string(), "codex".to_string()]);
            install_skill(&skill, &targets)
                .await
                .map_err(|e| e.to_string())
        }
        "uninstall" => uninstall_skill(&js_string(payload.get("id"))).map_err(|e| e.to_string()),
        "restore" => restore_skill(&js_string(payload.get("id"))).map_err(|e| e.to_string()),
        "set_targets" => {
            let targets = string_array_param(&payload, "targets").unwrap_or_default();
            set_skill_targets(&js_string(payload.get("id")), &targets).map_err(|e| e.to_string())
        }
        "import_local" => {
            let targets = string_array_param(&payload, "targets").unwrap_or_default();
            import_local_skill(&js_string(payload.get("directory")), &targets)
                .map_err(|e| e.to_string())
        }
        "delete_local" => {
            let targets = string_array_param(&payload, "targets").unwrap_or_default();
            delete_local_skill(&js_string(payload.get("directory")), &targets)
                .map_err(|e| e.to_string())
        }
        "add_repo" => {
            add_repo(payload.get("repo").unwrap_or(&Value::Null)).map_err(|e| e.to_string())
        }
        "remove_repo" => remove_repo(
            &js_string(payload.get("owner")),
            &js_string(payload.get("name")),
        )
        .map_err(|e| e.to_string()),
        _ => Err("Unknown skills action".to_string()),
    }
}

#[cfg(test)]
#[path = "../skills_hub_tests.rs"]
mod tests;
