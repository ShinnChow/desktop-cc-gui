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
use super::repos::*;
use super::discover::*;
use super::updates_popular::*;
use super::usage::*;

// ===== mutations：install / uninstall / restore / set_targets / import_local / delete_local =====

/// upstream installSkill：GitHub tree → tmp 下载 → rename 进 SSOT → registry → sync targets。
pub(super) async fn install_skill(
    skill_input: &Value,
    target_ids: &[String],
) -> SkillResult<Value> {
    let skill_name_input = js_string(skill_input.get("name"));
    let skill_description_input = js_string(skill_input.get("description"));
    let directory_input = js_string(skill_input.get("directory"));
    let repo_owner = js_string(skill_input.get("repoOwner"));
    let repo_name = js_string(skill_input.get("repoName"));
    let repo_branch = {
        let branch = js_string(skill_input.get("repoBranch"));
        if branch.is_empty() {
            "main".to_string()
        } else {
            branch
        }
    };
    if repo_owner.is_empty() || repo_name.is_empty() {
        return Err(SkillError::other("Missing GitHub repository information"));
    }
    let source_dir = sanitize_relative_path(&directory_input);
    // GitHub 来源的 skill 即使 sourceDirectory 嵌套也沿用扁平 installName。
    let install_name = source_dir.as_deref().and_then(install_name_from_directory);
    let (source_dir, install_name) = match (source_dir, install_name) {
        (Some(dir), Some(name)) => (dir, name),
        _ => return Err(SkillError::other("Invalid skill directory")),
    };

    let mut registry = read_registry();
    let new_repo = format!("{repo_owner}/{repo_name}").to_lowercase();
    let conflict = registry
        .skills
        .iter()
        .find(|entry| {
            let dir = js_string(entry.get("directory"));
            let repo = format!(
                "{}/{}",
                js_string(entry.get("repoOwner")),
                js_string(entry.get("repoName"))
            )
            .to_lowercase();
            eq_ignore_case(&dir, &install_name) && repo != new_repo
        })
        .map(|entry| {
            (
                js_string(entry.get("repoOwner")),
                js_string(entry.get("repoName")),
            )
        });
    if let Some((owner, name)) = conflict {
        return Err(SkillError::other(format!(
            "Skill directory \"{install_name}\" is already managed by {owner}/{name}"
        )));
    }

    let client = http_client()?;
    let (branch, tree) = get_repo_tree(&client, &repo_owner, &repo_name, &repo_branch).await?;
    let prefix = format!("{source_dir}/");
    let files: Vec<&Value> = tree
        .iter()
        .filter(|entry| {
            entry.get("type").and_then(Value::as_str) == Some("blob")
                && entry
                    .get("path")
                    .and_then(Value::as_str)
                    .map(|path| path == source_dir || path.starts_with(&prefix))
                    .unwrap_or(false)
        })
        .collect();
    if !files.iter().any(|entry| {
        entry
            .get("path")
            .and_then(Value::as_str)
            .map(is_skill_md_path)
            .unwrap_or(false)
    }) {
        return Err(SkillError::other(
            "SKILL.md not found in selected directory",
        ));
    }

    let dest = managed_skill_path(&install_name)?;
    let temp = tmp_dir().join(format!("{install_name}-{}", now_ms()));
    remove_path(&temp);
    ensure_dir(&temp)?;
    // 逐文件串行下载；任何失败清理 tmp 后上抛。
    let download = async {
        for entry in &files {
            let path = entry.get("path").and_then(Value::as_str).unwrap_or("");
            let relative = if path == source_dir {
                Path::new(path)
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            } else {
                path[source_dir.len() + 1..].to_string()
            };
            let Some(safe_relative) = sanitize_relative_path(&relative) else {
                continue;
            };
            let out = temp.join(&safe_relative);
            if let Some(parent) = out.parent() {
                ensure_dir(parent)?;
            }
            let text = fetch_text(
                &client,
                &github_raw_url(&repo_owner, &repo_name, &branch, path),
            )
            .await?;
            fs::write(&out, text)?;
        }
        remove_path(&dest);
        if let Some(parent) = dest.parent() {
            ensure_dir(parent)?;
        }
        fs::rename(&temp, &dest)?;
        Ok::<(), SkillError>(())
    };
    if let Err(error) = download.await {
        remove_path(&temp);
        return Err(error);
    }

    // 从落盘 SKILL.md（优先大写，其次 skill.md）重读 name/description。
    let marker = find_skill_marker(&dest);
    let skill_md = marker.and_then(|m| read_text(&m)).unwrap_or_default();
    let fallback_name = if skill_name_input.is_empty() {
        install_name.clone()
    } else {
        skill_name_input.clone()
    };
    let metadata = read_skill_metadata(&skill_md, &fallback_name);
    let description = if metadata.description.is_empty() {
        skill_description_input.clone()
    } else {
        metadata.description
    };
    let selected_targets: Vec<String> = target_ids
        .iter()
        .filter(|id| target_by_id(id).is_some())
        .cloned()
        .collect();

    let id = format!("{repo_owner}/{repo_name}:{source_dir}");
    let mut installed = Map::new();
    installed.insert("id".to_string(), json!(id));
    installed.insert("key".to_string(), json!(id));
    installed.insert("name".to_string(), json!(metadata.name));
    installed.insert("description".to_string(), json!(description));
    installed.insert("directory".to_string(), json!(install_name));
    installed.insert("sourceDirectory".to_string(), json!(source_dir));
    // readmeUrl 恒用大写 SKILL.md（与 upstream 一致）。
    installed.insert(
        "readmeUrl".to_string(),
        json!(github_doc_url(
            &repo_owner,
            &repo_name,
            &branch,
            &format!("{source_dir}/SKILL.md")
        )),
    );
    installed.insert("repoOwner".to_string(), json!(repo_owner));
    installed.insert("repoName".to_string(), json!(repo_name));
    installed.insert("repoBranch".to_string(), json!(branch));
    installed.insert("installedAt".to_string(), json!(now_ms()));
    installed.insert("contentHash".to_string(), json!(hash_directory(&dest)));
    if let Some(signature) = source_signature_from_tree(&tree, &source_dir) {
        installed.insert("sourceSignature".to_string(), json!(signature));
    }
    installed.insert("targets".to_string(), json!(&selected_targets));

    registry.skills.retain(|entry| {
        entry.get("id").and_then(Value::as_str) != Some(id.as_str())
            && !eq_ignore_case(&js_string(entry.get("directory")), &install_name)
    });
    registry.skills.push(Value::Object(installed.clone()));
    save_registry(&registry)?;

    for target_id in &selected_targets {
        sync_skill_to_target(&install_name, target_id)?;
    }
    append_activity(json!({
        "action": "install",
        "name": installed.get("name").cloned().unwrap_or(Value::Null),
        "directory": install_name,
        "targets": &selected_targets,
        "source": format!("{repo_owner}/{repo_name}"),
    }));
    let mut skill = installed;
    skill.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(skill)}))
}

/// upstream uninstallSkill：全部 target 摘除后 SSOT 移入 .trash（5 分钟可 restore），
/// rename 失败或 SSOT 缺失则彻底删除。
pub(super) fn uninstall_skill(id: &str) -> SkillResult<Value> {
    let mut registry = read_registry();
    let Some(position) = find_skill_position(&registry.skills, id) else {
        return Err(SkillError::other("Managed skill not found"));
    };
    let skill = registry.skills[position].clone();
    let directory = js_string(skill.get("directory"));
    let entry_id = skill.get("id").and_then(Value::as_str).map(str::to_string);
    let ssot_path = managed_skill_path(&directory)?;
    for target in TARGETS.iter() {
        remove_skill_from_target(&directory, target.id);
    }
    let skill_name = skill.get("name").cloned().unwrap_or(Value::Null);
    if ssot_path.exists() {
        ensure_dir(&trash_dir())?;
        let stamp = now_ms();
        let trash_name = format!("{}-{stamp}", base64url_no_pad(&directory));
        let trash_path = trash_dir().join(&trash_name);
        if fs::rename(&ssot_path, &trash_path).is_ok() {
            if let Some(parent) = ssot_path.parent() {
                remove_empty_ancestors(parent, &ssot_dir());
            }
            let mut trashed = skill.as_object().cloned().unwrap_or_default();
            trashed.insert("trashedAt".to_string(), json!(stamp));
            trashed.insert("trashedDirectory".to_string(), json!(trash_name));
            trashed.insert(
                "previousTargets".to_string(),
                skill.get("targets").cloned().unwrap_or_else(|| json!([])),
            );
            trashed.insert("targets".to_string(), json!([]));
            registry
                .skills
                .retain(|entry| entry.get("id").and_then(Value::as_str) != entry_id.as_deref());
            registry.skills.push(Value::Object(trashed));
            save_registry(&registry)?;
            purge_expired_trash();
            append_activity(
                json!({"action": "uninstall", "name": skill_name, "directory": directory}),
            );
            return Ok(json!({
                "ok": true,
                "trashed": true,
                "restoreId": skill.get("id").cloned().unwrap_or(Value::Null),
                "ttlMs": TRASH_TTL_MS,
            }));
        }
        // rename 失败：回退彻底删除。
        remove_path(&ssot_path);
        if let Some(parent) = ssot_path.parent() {
            remove_empty_ancestors(parent, &ssot_dir());
        }
    }
    registry
        .skills
        .retain(|entry| entry.get("id").and_then(Value::as_str) != entry_id.as_deref());
    save_registry(&registry)?;
    append_activity(json!({"action": "uninstall", "name": skill_name, "directory": directory}));
    Ok(json!({"ok": true, "trashed": false}))
}

/// upstream restoreSkill：trash 窗口内 rename 回 SSOT 并按 previousTargets 重新 symlink。
pub(super) fn restore_skill(id: &str) -> SkillResult<Value> {
    let mut registry = read_registry();
    let Some(index) = find_skill_position(&registry.skills, id) else {
        return Err(SkillError::other("Nothing to restore"));
    };
    let skill = registry.skills[index].clone();
    let Some(trashed_at) = trashed_at_of(&skill) else {
        return Err(SkillError::other("Nothing to restore"));
    };
    if now_ms() as f64 - trashed_at > TRASH_TTL_MS as f64 {
        return Err(SkillError::other("Restore window expired"));
    }
    let directory = js_string(skill.get("directory"));
    let trash_path = trash_dir().join(js_string(skill.get("trashedDirectory")));
    let ssot_path = managed_skill_path(&directory)?;
    if !trash_path.exists() {
        return Err(SkillError::other("Trashed copy is missing"));
    }
    if let Some(parent) = ssot_path.parent() {
        ensure_dir(parent)?;
    }
    remove_path(&ssot_path);
    fs::rename(&trash_path, &ssot_path)?;
    let targets: Vec<String> = skill
        .get("previousTargets")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let mut restored = skill.as_object().cloned().unwrap_or_default();
    restored.insert("targets".to_string(), json!(&targets));
    restored.remove("trashedAt");
    restored.remove("trashedDirectory");
    restored.remove("previousTargets");
    registry.skills[index] = Value::Object(restored.clone());
    save_registry(&registry)?;
    for target_id in &targets {
        sync_skill_to_target(&directory, target_id)?;
    }
    append_activity(json!({
        "action": "restore",
        "name": restored.get("name").cloned().unwrap_or(Value::Null),
        "directory": directory,
        "targets": &targets,
    }));
    restored.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(restored)}))
}

/// upstream setSkillTargets：对新开 target sync、对关闭 target remove。
pub(super) fn set_skill_targets(id: &str, target_ids: &[String]) -> SkillResult<Value> {
    let mut registry = read_registry();
    let Some(index) = find_skill_position(&registry.skills, id) else {
        return Err(SkillError::other("Managed skill not found"));
    };
    let skill = registry.skills[index].clone();
    let directory = js_string(skill.get("directory"));
    let selected: Vec<String> = target_ids
        .iter()
        .filter(|tid| target_by_id(tid).is_some())
        .cloned()
        .collect();
    for target in TARGETS.iter() {
        if selected.iter().any(|tid| tid == target.id) {
            sync_skill_to_target(&directory, target.id)?;
        } else {
            remove_skill_from_target(&directory, target.id);
        }
    }
    let mut updated = skill.as_object().cloned().unwrap_or_default();
    updated.insert("targets".to_string(), json!(&selected));
    registry.skills[index] = Value::Object(updated.clone());
    save_registry(&registry)?;
    append_activity(json!({
        "action": "set_targets",
        "name": updated.get("name").cloned().unwrap_or(Value::Null),
        "directory": directory,
        "targets": &selected,
    }));
    updated.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(updated)}))
}

/// upstream findLocalSkillSource：在某 target 下找到含 marker 的源目录。
pub(super) fn find_local_skill_source(directory: &str) -> Option<(PathBuf, String)> {
    let source_dir = sanitize_local_skill_path(directory)?;
    for target in TARGETS.iter() {
        for base_dir in target_dirs(target) {
            let Some(skill_path) = target_skill_path(&base_dir, &source_dir) else {
                continue;
            };
            if find_skill_marker(&skill_path).is_some() {
                return Some((skill_path, target.id.to_string()));
            }
        }
    }
    None
}

/// upstream importLocalSkill：把本地 skill 复制（非 symlink）进 SSOT 并登记 `local:<dir>`。
pub(super) fn import_local_skill(directory: &str, target_ids: &[String]) -> SkillResult<Value> {
    let Some(source_dir) = sanitize_local_skill_path(directory) else {
        return Err(SkillError::other("Invalid skill directory"));
    };
    let mut registry = read_registry();
    let existing = registry
        .skills
        .iter()
        .find(|entry| eq_ignore_case(&js_string(entry.get("directory")), &source_dir))
        .cloned();
    if let Some(existing) = existing {
        let existing_id = js_string(existing.get("id"));
        let existing_key = js_string(existing.get("key"));
        let id_or_key = if existing_id.is_empty() {
            existing_key
        } else {
            existing_id
        };
        if !id_or_key.starts_with("local:") {
            return Err(SkillError::other(format!(
                "Skill directory \"{source_dir}\" is already managed by another installed skill"
            )));
        }
        if target_ids.is_empty() {
            let mut skill = existing.as_object().cloned().unwrap_or_default();
            let targets = existing
                .get("targets")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            skill.insert("managed".to_string(), json!(true));
            skill.insert("targets".to_string(), Value::Array(targets));
            return Ok(json!({"ok": true, "skill": Value::Object(skill)}));
        }
        return set_skill_targets(&js_string(existing.get("id")), target_ids);
    }

    let Some((source_path, _target_id)) = find_local_skill_source(&source_dir) else {
        return Err(SkillError::other("Local skill not found"));
    };
    let dest = managed_skill_path(&source_dir)?;
    copy_dir(&source_path, &dest)?;
    let marker = find_skill_marker(&dest);
    let markdown = marker.and_then(|m| read_text(&m)).unwrap_or_default();
    let fallback = install_name_from_directory(&source_dir).unwrap_or_default();
    let metadata = read_skill_metadata(&markdown, &fallback);
    let discovered: Vec<String> = TARGETS
        .iter()
        .filter(|t| scan_target_skill(&source_dir, t.id))
        .map(|t| t.id.to_string())
        .collect();
    let selected: Vec<String> = (if target_ids.is_empty() {
        discovered
    } else {
        target_ids.to_vec()
    })
    .into_iter()
    .filter(|tid| target_by_id(tid).is_some())
    .collect();

    let local_id = format!("local:{source_dir}");
    let mut skill = Map::new();
    skill.insert("id".to_string(), json!(local_id));
    skill.insert("key".to_string(), json!(local_id));
    skill.insert("name".to_string(), json!(metadata.name));
    skill.insert("description".to_string(), json!(metadata.description));
    skill.insert("directory".to_string(), json!(source_dir));
    skill.insert("sourceDirectory".to_string(), json!(source_dir));
    skill.insert("readmeUrl".to_string(), Value::Null);
    skill.insert("repoOwner".to_string(), Value::Null);
    skill.insert("repoName".to_string(), Value::Null);
    skill.insert("repoBranch".to_string(), Value::Null);
    skill.insert("installedAt".to_string(), json!(now_ms()));
    skill.insert("contentHash".to_string(), json!(hash_directory(&dest)));
    skill.insert("targets".to_string(), json!(&selected));
    registry.skills.push(Value::Object(skill.clone()));
    save_registry(&registry)?;
    for target in TARGETS.iter() {
        if selected.iter().any(|tid| tid == target.id) {
            sync_skill_to_target(&source_dir, target.id)?;
        } else {
            remove_skill_from_target(&source_dir, target.id);
        }
    }
    append_activity(json!({
        "action": "import",
        "name": skill.get("name").cloned().unwrap_or(Value::Null),
        "directory": source_dir,
        "targets": &selected,
    }));
    skill.insert("managed".to_string(), json!(true));
    Ok(json!({"ok": true, "skill": Value::Object(skill)}))
}

/// upstream deleteLocalSkill：从指定（缺省全部）target 删除本地 skill。
pub(super) fn delete_local_skill(directory: &str, target_ids: &[String]) -> SkillResult<Value> {
    let Some(install_name) = sanitize_local_skill_path(directory) else {
        return Err(SkillError::other("Invalid skill directory"));
    };
    let selected: Vec<String> = if target_ids.is_empty() {
        TARGETS.iter().map(|target| target.id.to_string()).collect()
    } else {
        target_ids.to_vec()
    };
    for target_id in &selected {
        remove_skill_from_target(&install_name, target_id);
    }
    append_activity(
        json!({"action": "delete_local", "directory": install_name, "targets": &selected}),
    );
    Ok(json!({"ok": true}))
}
