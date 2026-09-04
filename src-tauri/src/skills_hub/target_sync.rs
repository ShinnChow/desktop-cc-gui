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
use super::lifecycle::*;
use super::repos::*;
use super::discover::*;
use super::updates_popular::*;
use super::usage::*;

// ===== classify / scan / sync / remove / installed 列表 =====

/// 单个 (skill, target) 的磁盘三态（upstream classifyTargetSkill 的多目录版核心）：
/// 任一 baseDir 下存在（symlink 可 resolve 或实体）→ "synced"（短路）；
/// 否则若候选是悬空 symlink → "orphan"；否则 "off"。
pub(super) fn classify_in_dirs(directory: &str, base_dirs: &[PathBuf]) -> &'static str {
    let mut state = "off";
    for base_dir in base_dirs {
        let Some(candidate) = target_skill_path(base_dir, directory) else {
            continue;
        };
        if candidate.exists() {
            return "synced";
        }
        if is_symlink(&candidate) {
            state = "orphan";
        }
    }
    state
}

pub(super) fn classify_target_skill(directory: &str, target_id: &str) -> &'static str {
    let Some(target) = target_by_id(target_id) else {
        return "off";
    };
    classify_in_dirs(directory, &target_dirs(target))
}

/// upstream scanTargetSkill：任一 baseDir 下候选存在（含 symlink）即 true。
pub(super) fn scan_target_skill(directory: &str, target_id: &str) -> bool {
    let Some(target) = target_by_id(target_id) else {
        return false;
    };
    target_dirs(target).iter().any(|base_dir| {
        target_skill_path(base_dir, directory)
            .map(|candidate| candidate.exists() || is_symlink(&candidate))
            .unwrap_or(false)
    })
}

/// upstream syncSkillToTarget：SSOT → target 的 symlink，任何失败回退整目录递归 copy。
pub(super) fn sync_skill_to_target(directory: &str, target_id: &str) -> SkillResult<()> {
    let target = target_by_id(target_id)
        .ok_or_else(|| SkillError::other(format!("Unsupported target: {target_id}")))?;
    let source = managed_skill_path(directory)?;
    if !source.exists() {
        return Err(SkillError::other(format!(
            "Managed skill not found: {directory}"
        )));
    }
    for base_dir in target_dirs(target) {
        let dest = target_skill_path(&base_dir, directory)
            .ok_or_else(|| SkillError::other(format!("Invalid skill directory: {directory}")))?;
        assert_not_nested(&source, &dest)?;
        if let Some(parent) = dest.parent() {
            ensure_dir(parent)?;
        }
        remove_path(&dest);
        if symlink_dir(&source, &dest).is_err() {
            copy_dir(&source, &dest)?;
        }
    }
    Ok(())
}

/// upstream removeSkillFromTarget：removePath + 逐级清理空祖先到 baseDir。
pub(super) fn remove_skill_from_target(directory: &str, target_id: &str) {
    let Some(target) = target_by_id(target_id) else {
        return;
    };
    for base_dir in target_dirs(target) {
        let Some(target_path) = target_skill_path(&base_dir, directory) else {
            continue;
        };
        remove_path(&target_path);
        if let Some(parent) = target_path.parent() {
            remove_empty_ancestors(parent, &base_dir);
        }
    }
}

/// 在 registry skills 中按 `id == id || key == id` 查找（upstream 多个 mutation 共用）。
pub(super) fn find_skill_position(skills: &[Value], id: &str) -> Option<usize> {
    skills.iter().position(|entry| {
        entry.get("id").and_then(Value::as_str) == Some(id)
            || entry.get("key").and_then(Value::as_str) == Some(id)
    })
}

/// upstream listInstalledSkills：先 purge trash，再 managed + unmanaged 合并按 name 排序。
pub(super) fn list_installed_skills() -> Vec<Value> {
    purge_expired_trash();
    let registry = read_registry();
    let mut managed: Vec<Value> = Vec::new();
    for skill in &registry.skills {
        if trashed_at_of(skill).is_some() {
            continue;
        }
        let directory = js_string(skill.get("directory"));
        let intended: HashSet<String> = skill
            .get("targets")
            .and_then(Value::as_array)
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        let mut target_states = Map::new();
        let mut targets: Vec<Value> = Vec::new();
        for target in TARGETS.iter() {
            let mut state = classify_target_skill(&directory, target.id);
            // registry 意图包含但磁盘丢失 → orphan。
            if state == "off" && intended.contains(target.id) {
                state = "orphan";
            }
            target_states.insert(target.id.to_string(), json!(state));
            if state == "synced" {
                targets.push(json!(target.id));
            }
        }
        let mut entry = skill.as_object().cloned().unwrap_or_default();
        entry.insert("managed".to_string(), json!(true));
        entry.insert("targets".to_string(), Value::Array(targets));
        entry.insert("targetStates".to_string(), Value::Object(target_states));
        managed.push(Value::Object(entry));
    }

    let managed_dirs: HashSet<String> = managed
        .iter()
        .map(|skill| js_string(skill.get("directory")).to_lowercase())
        .collect();

    // unmanaged：扫描全部 8 个 target 的本地 skill，跨 target 按 directory 小写合并。
    let mut unmanaged: Vec<Value> = Vec::new();
    let mut unmanaged_index: HashMap<String, usize> = HashMap::new();
    for target in TARGETS.iter() {
        for base_dir in target_dirs(target) {
            for directory in scan_skill_directories(&base_dir) {
                if directory.is_empty() || managed_dirs.contains(&directory.to_lowercase()) {
                    continue;
                }
                let Some(marker) = find_skill_marker(&base_dir.join(&directory)) else {
                    continue;
                };
                let markdown = read_text(&marker).unwrap_or_default();
                let fallback =
                    install_name_from_directory(&directory).unwrap_or_else(|| directory.clone());
                let metadata = read_skill_metadata(&markdown, &fallback);
                let key = directory.to_lowercase();
                let index = match unmanaged_index.get(&key) {
                    Some(&i) => i,
                    None => {
                        let target_states: Map<String, Value> = TARGETS
                            .iter()
                            .map(|t| (t.id.to_string(), json!("off")))
                            .collect();
                        unmanaged.push(json!({
                            "id": format!("local:{directory}"),
                            "key": format!("local:{directory}"),
                            "name": metadata.name,
                            "description": metadata.description,
                            "directory": directory,
                            "readmeUrl": Value::Null,
                            "repoOwner": Value::Null,
                            "repoName": Value::Null,
                            "repoBranch": Value::Null,
                            "installedAt": Value::Null,
                            "managed": false,
                            "targets": [],
                            "targetStates": Value::Object(target_states),
                            "targetPaths": {},
                        }));
                        unmanaged_index.insert(key, unmanaged.len() - 1);
                        unmanaged.len() - 1
                    }
                };
                let entry = &mut unmanaged[index];
                if let Some(targets) = entry.get_mut("targets").and_then(Value::as_array_mut) {
                    if !targets.iter().any(|t| t.as_str() == Some(target.id)) {
                        targets.push(json!(target.id));
                    }
                }
                if let Some(states) = entry.get_mut("targetStates").and_then(Value::as_object_mut) {
                    states.insert(target.id.to_string(), json!("synced"));
                }
                if let Some(paths) = entry.get_mut("targetPaths").and_then(Value::as_object_mut) {
                    // 只记录首个命中的 target 路径。
                    paths
                        .entry(target.id.to_string())
                        .or_insert_with(|| json!(base_dir.join(&directory).to_string_lossy()));
                }
            }
        }
    }

    managed.extend(unmanaged);
    // codepoint 排序（upstream localeCompare 的计划内偏差）；Rust sort_by 稳定。
    managed.sort_by(|a, b| js_string(a.get("name")).cmp(&js_string(b.get("name"))));
    managed
}
