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
use super::repos::*;
use super::discover::*;
use super::usage::*;

/// 缓存命中判定：`fingerprint` 相等 + `<key>` 时间戳在 TTL 内 + 指定字段类型校验。
pub(super) fn cache_hit(
    cached: &Value,
    fingerprint: &str,
    ts_key: &str,
    ttl_ms: i64,
    payload_key: &str,
    want_object: bool,
) -> bool {
    let fresh = cached
        .get(ts_key)
        .and_then(Value::as_f64)
        .map(|ts| now_ms() as f64 - ts < ttl_ms as f64)
        .unwrap_or(false);
    if cached.get("fingerprint").and_then(Value::as_str) != Some(fingerprint) || !fresh {
        return false;
    }
    match cached.get(payload_key) {
        Some(Value::Array(_)) => !want_object,
        Some(v) => want_object && v.is_object(),
        None => false,
    }
}

/// upstream checkUpdates：候选 = `!trashedAt && repoOwner && repoName && sourceSignature`；
/// 按 `"owner/name@branch".toLowerCase()` 分组并发 2 拉 tree；sig 为 null 不写 key。
pub(super) async fn check_updates(force: bool) -> SkillResult<Value> {
    let registry = read_registry();
    let managed: Vec<Value> = registry
        .skills
        .iter()
        .filter(|skill| {
            trashed_at_of(skill).is_none()
                && !js_string(skill.get("repoOwner")).is_empty()
                && !js_string(skill.get("repoName")).is_empty()
                && !js_string(skill.get("sourceSignature")).is_empty()
        })
        .cloned()
        .collect();
    let mut fingerprint_parts: Vec<String> = managed
        .iter()
        .map(|skill| {
            format!(
                "{}@{}",
                js_string(skill.get("id")),
                js_string(skill.get("sourceSignature"))
            )
        })
        .collect();
    fingerprint_parts.sort();
    let fingerprint = fingerprint_parts.join("|");

    if !force {
        if let Some(cached) = read_json(&updates_cache_path()) {
            if cache_hit(
                &cached,
                &fingerprint,
                "checkedAt",
                UPDATE_CACHE_TTL_MS,
                "updates",
                true,
            ) {
                let updates = cached.get("updates").cloned().unwrap_or_else(|| json!({}));
                let checked_at = cached.get("checkedAt").cloned().unwrap_or(Value::Null);
                return Ok(json!({"updates": updates, "checkedAt": checked_at, "cached": true}));
            }
        }
    }

    // 按 repo 分组（保持插入序）。
    let mut groups: Vec<(String, String, String, Vec<Value>)> = Vec::new();
    let mut group_index: HashMap<String, usize> = HashMap::new();
    for skill in &managed {
        let owner = js_string(skill.get("repoOwner"));
        let name = js_string(skill.get("repoName"));
        let branch = {
            let branch = js_string(skill.get("repoBranch"));
            if branch.is_empty() {
                "main".to_string()
            } else {
                branch
            }
        };
        let key = format!("{owner}/{name}@{branch}").to_lowercase();
        let index = match group_index.get(&key) {
            Some(&i) => i,
            None => {
                group_index.insert(key, groups.len());
                groups.push((owner, name, branch, Vec::new()));
                groups.len() - 1
            }
        };
        groups[index].3.push(skill.clone());
    }

    let client = http_client()?;
    let worker_client = client.clone();
    let results = map_with_concurrency(
        groups,
        UPDATE_CHECK_CONCURRENCY,
        move |(owner, name, branch, skills): (String, String, String, Vec<Value>)| {
            let client = worker_client.clone();
            async move {
                let tree = match get_repo_tree(&client, &owner, &name, &branch).await {
                    Ok((_, tree)) => tree,
                    Err(error) => {
                        if error.is_rate_limited() {
                            return Err(error);
                        }
                        // 非 RateLimit 失败静默跳过（该 repo 的 skills 不写 key）。
                        return Ok(Vec::new());
                    }
                };
                let mut updates: Vec<(String, bool)> = Vec::new();
                for skill in &skills {
                    let source = {
                        let source_directory = js_string(skill.get("sourceDirectory"));
                        if source_directory.is_empty() {
                            js_string(skill.get("directory"))
                        } else {
                            source_directory
                        }
                    };
                    if let Some(signature) = source_signature_from_tree(&tree, &source) {
                        updates.push((
                            js_string(skill.get("id")),
                            signature != js_string(skill.get("sourceSignature")),
                        ));
                    }
                }
                Ok(updates)
            }
        },
    )
    .await;

    let mut updates = Map::new();
    for result in results {
        for (id, has_update) in result? {
            updates.insert(id, json!(has_update));
        }
    }
    let checked_at = now_ms();
    write_json(
        &updates_cache_path(),
        &json!({"fingerprint": fingerprint, "checkedAt": checked_at, "updates": Value::Object(updates.clone())}),
    )?;
    Ok(json!({"updates": Value::Object(updates), "checkedAt": checked_at, "cached": false}))
}

/// upstream searchSkillsSh：`q.trim()` 长度 <2 短路；解析 skills.sh 响应。
pub(super) async fn search_skills_sh(
    client: &reqwest::Client,
    query: &str,
    limit: f64,
    offset: f64,
) -> SkillResult<Value> {
    let q = query.trim().to_string();
    // JS length 是 UTF-16 code unit 数，用 encode_utf16 对齐。
    if q.encode_utf16().count() < 2 {
        return Ok(json!({"query": q, "totalCount": 0, "skills": []}));
    }
    let limit = {
        let n = if limit == 0.0 || limit.is_nan() {
            20.0
        } else {
            limit
        };
        n.min(50.0).max(1.0) as i64
    };
    let offset = if offset.is_nan() { 0.0 } else { offset }.max(0.0) as i64;
    let url = format!(
        "https://skills.sh/api/search?q={}&limit={limit}&offset={offset}",
        encode_form_param(&q)
    );
    let data = fetch_json(client, &url).await?;
    let skills: Vec<Value> = data
        .get("skills")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(parse_search_entry).collect())
        .unwrap_or_default();
    let total_count = {
        let count = data.get("count").map(js_f64).unwrap_or(f64::NAN);
        let n = if count == 0.0 || count.is_nan() {
            skills.len() as f64
        } else {
            count
        };
        json_number(n)
    };
    let query_out = {
        let data_query = js_string(data.get("query"));
        if data_query.is_empty() {
            q
        } else {
            data_query
        }
    };
    Ok(json!({"query": query_out, "totalCount": total_count, "skills": skills}))
}

/// upstream searchSkillsSh 的 entry 映射：`source` 按 `/` split 得 owner/repo（含 `.` 丢弃）。
pub(super) fn parse_search_entry(entry: &Value) -> Option<Value> {
    let source = js_string(entry.get("source"));
    let mut parts = source.split('/');
    let owner = parts.next().unwrap_or("").to_string();
    let repo_name = parts.next().unwrap_or("").to_string();
    if owner.is_empty() || repo_name.is_empty() || owner.contains('.') || repo_name.contains('.') {
        return None;
    }
    let key = {
        let id = js_string(entry.get("id"));
        if !id.is_empty() {
            id
        } else {
            let skill_id = js_string(entry.get("skillId"));
            let inner = if !skill_id.is_empty() {
                skill_id
            } else {
                js_string(entry.get("name"))
            };
            format!("{owner}/{repo_name}:{inner}")
        }
    };
    let name = {
        let name = js_string(entry.get("name"));
        if !name.is_empty() {
            name
        } else {
            let skill_id = js_string(entry.get("skillId"));
            if !skill_id.is_empty() {
                skill_id
            } else {
                "Skill".to_string()
            }
        }
    };
    let directory = {
        let skill_id = js_string(entry.get("skillId"));
        if !skill_id.is_empty() {
            skill_id
        } else {
            js_string(entry.get("name"))
        }
    };
    Some(json!({
        "key": key,
        "name": name,
        "description": "",
        "directory": directory,
        "repoOwner": owner,
        "repoName": repo_name,
        "repoBranch": "main",
        "readmeUrl": format!("https://github.com/{owner}/{repo_name}"),
        "installs": json_number(js_number_or(entry.get("installs"), 0.0)),
    }))
}

/// upstream fetchPopularSkillsSh：12 个种子查询并发 4，按 key 小写合并保留 installs 大者，
/// installs 降序，截 200 写缓存（6h TTL）。
pub(super) async fn fetch_popular_skills_sh(force: bool, limit: f64) -> SkillResult<Value> {
    let cap = {
        let n = if limit == 0.0 || limit.is_nan() {
            60.0
        } else {
            limit
        };
        n.min(200.0).max(1.0) as i64 as usize
    };
    if !force {
        if let Some(cached) = read_json(&popular_cache_path()) {
            let fresh = cached
                .get("generatedAt")
                .and_then(Value::as_f64)
                .map(|generated_at| now_ms() as f64 - generated_at < POPULAR_CACHE_TTL_MS as f64)
                .unwrap_or(false);
            if fresh {
                if let Some(skills) = cached.get("skills").and_then(Value::as_array) {
                    let sliced: Vec<Value> = skills.iter().take(cap).cloned().collect();
                    let generated_at = cached.get("generatedAt").cloned().unwrap_or(Value::Null);
                    return Ok(
                        json!({"skills": sliced, "cached": true, "generatedAt": generated_at}),
                    );
                }
            }
        }
    }
    let client = http_client()?;
    let worker_client = client.clone();
    let lists = map_with_concurrency(
        POPULAR_SEED_QUERIES
            .iter()
            .map(|q| q.to_string())
            .collect::<Vec<_>>(),
        DISCOVER_CONCURRENCY,
        move |q: String| {
            let client = worker_client.clone();
            async move {
                match search_skills_sh(&client, &q, 30.0, 0.0).await {
                    Ok(data) => Ok(data
                        .get("skills")
                        .and_then(Value::as_array)
                        .cloned()
                        .unwrap_or_default()),
                    Err(error) => {
                        if error.is_rate_limited() {
                            Err(error)
                        } else {
                            // 非 RateLimit 失败当空列表。
                            Ok(Vec::new())
                        }
                    }
                }
            }
        },
    )
    .await;

    let mut index_of: HashMap<String, usize> = HashMap::new();
    let mut merged: Vec<Value> = Vec::new();
    for list in lists {
        for skill in list? {
            let key = {
                let key = js_string(skill.get("key"));
                if !key.is_empty() {
                    key
                } else {
                    format!(
                        "{}/{}:{}",
                        js_string(skill.get("repoOwner")),
                        js_string(skill.get("repoName")),
                        js_string(skill.get("directory"))
                    )
                }
            }
            .to_lowercase();
            let installs = skill.get("installs").map(js_f64).unwrap_or(0.0);
            match index_of.get(&key) {
                Some(&index) => {
                    let previous = merged[index].get("installs").map(js_f64).unwrap_or(0.0);
                    if installs > previous {
                        merged[index] = skill;
                    }
                }
                None => {
                    index_of.insert(key, merged.len());
                    merged.push(skill);
                }
            }
        }
    }
    merged.sort_by(|a, b| {
        let ai = a.get("installs").map(js_f64).unwrap_or(0.0);
        let bi = b.get("installs").map(js_f64).unwrap_or(0.0);
        bi.partial_cmp(&ai).unwrap_or(std::cmp::Ordering::Equal)
    });
    merged.truncate(200);
    write_json(
        &popular_cache_path(),
        &json!({"generatedAt": now_ms(), "skills": &merged}),
    )?;
    let sliced: Vec<Value> = merged.into_iter().take(cap).collect();
    Ok(json!({"skills": sliced, "cached": false, "generatedAt": now_ms()}))
}
