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
use super::registry::*;
use super::http::*;
use super::target_sync::*;
use super::lifecycle::*;
use super::repos::*;
use super::discover::*;
use super::updates_popular::*;
use super::usage::*;

// ===== frontmatter / marker / 本地扫描 =====

/// upstream readYamlField：inline（可带一层引号）+ block scalar（`|`/`>`，可带 `+`/`-`）。
pub(super) fn read_yaml_field(yaml: &str, key: &str) -> String {
    let lines: Vec<&str> = yaml.split('\n').collect();
    for (i, line) in lines.iter().enumerate() {
        let indent = line.chars().take_while(|c| c.is_whitespace()).count();
        let trimmed_start = line.trim_start();
        // header 形如 `^(\s*)key:[ \t]*(.*)$`：key 后必须紧跟冒号。
        let Some(after_key) = trimmed_start.strip_prefix(key) else {
            continue;
        };
        let Some(after_colon) = after_key.strip_prefix(':') else {
            continue;
        };
        let inline = after_colon.trim_start_matches([' ', '\t']).trim();
        if matches!(inline, ">" | "|" | ">+" | ">-" | "|+" | "|-") {
            // block scalar：收集后续缩进更深的行，dedent 结束。
            let mut collected: Vec<String> = Vec::new();
            for next in &lines[i + 1..] {
                if next.trim().is_empty() {
                    collected.push(String::new());
                    continue;
                }
                if next.chars().take_while(|c| c.is_whitespace()).count() <= indent {
                    break; // dedent 结束
                }
                collected.push(next.trim().to_string());
            }
            return collected.join(" ");
        }
        // 剥一层首尾引号。
        let mut out = inline;
        if out.starts_with('"') || out.starts_with('\'') {
            out = &out[1..];
        }
        if (out.ends_with('"') || out.ends_with('\'')) && !out.is_empty() {
            out = &out[..out.len() - 1];
        }
        return out.to_string();
    }
    String::new()
}

/// 对应 upstream 的 `/^---\s*\n([\s\S]*?)\n---/` frontmatter 提取。
pub(super) fn extract_frontmatter(raw: &str) -> Option<&str> {
    let rest = raw.strip_prefix("---")?;
    // `\s*\n`：前导空白 run 内必须有 `\n`（取 run 中最后一个 `\n` 之后）。
    let ws_len: usize = rest
        .char_indices()
        .take_while(|(_, c)| c.is_whitespace())
        .map(|(i, c)| i + c.len_utf8())
        .last()
        .unwrap_or(0);
    let newline = rest[..ws_len].rfind('\n')?;
    let content = &rest[newline + 1..];
    let end = content.find("\n---")?;
    Some(&content[..end])
}

pub(super) struct SkillMetadata {
    pub(super) name: String,
    pub(super) description: String,
}

/// upstream readSkillMetadata：frontmatter 优先，name fallback，description 折叠空白。
pub(super) fn read_skill_metadata(markdown: &str, fallback_name: &str) -> SkillMetadata {
    let source = extract_frontmatter(markdown).unwrap_or(markdown);
    let name_field = read_yaml_field(source, "name");
    let name = if !name_field.is_empty() {
        name_field
    } else if !fallback_name.is_empty() {
        fallback_name.to_string()
    } else {
        "Skill".to_string()
    };
    let description = read_yaml_field(source, "description")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    SkillMetadata {
        name: name.trim().to_string(),
        description,
    }
}

/// upstream findSkillMarker：SKILL.md（优先大写）或 skill.md，stat 为 file 才算。
pub(super) fn find_skill_marker(dir: &Path) -> Option<PathBuf> {
    for name in ["SKILL.md", "skill.md"] {
        let candidate = dir.join(name);
        if fs::metadata(&candidate)
            .map(|meta| meta.is_file())
            .unwrap_or(false)
        {
            return Some(candidate);
        }
    }
    None
}

/// upstream scanSkillDirectories：深度 ≤3 递归，不进 symlink 目录、跳过 `.` 开头项，
/// 含 SKILL.md/skill.md 的目录记为 skill（返回相对路径）。
pub(super) fn scan_skill_directories(root_dir: &Path) -> Vec<String> {
    fn walk(dir: &Path, rel_dir: &str, depth: usize, found: &mut Vec<String>) {
        let Ok(read_dir) = fs::read_dir(dir) else {
            return;
        };
        let mut entries: Vec<_> = read_dir.filter_map(|entry| entry.ok()).collect();
        // codepoint 排序（upstream localeCompare 的计划内偏差）。
        entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
        for entry in entries {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if !file_type.is_dir() && !file_type.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.is_empty() || name.starts_with('.') {
                continue;
            }
            let rel = if rel_dir.is_empty() {
                name.clone()
            } else {
                format!("{rel_dir}/{name}")
            };
            let full = entry.path();
            if find_skill_marker(&full).is_some() {
                found.push(rel);
                continue;
            }
            // symlink group folder 不递归（保持扫描在 target skills 树内）。
            if file_type.is_dir() && depth + 1 < MAX_LOCAL_SKILL_SCAN_DEPTH {
                walk(&full, &rel, depth + 1, found);
            }
        }
    }
    let mut found = Vec::new();
    walk(root_dir, "", 0, &mut found);
    found
}

// ===== contentHash / sourceSignature =====

#[cfg(unix)]
pub(super) fn exec_bit_of(meta: &fs::Metadata) -> u8 {
    use std::os::unix::fs::PermissionsExt;
    if meta.permissions().mode() & 0o111 != 0 {
        1
    } else {
        0
    }
}

#[cfg(not(unix))]
pub(super) fn exec_bit_of(_meta: &fs::Metadata) -> u8 {
    0
}

/// upstream hashDirectory：按 name 排序递归，文件条目为
/// `"<rel>\0<execBit>\0" + 文件字节 + "\0"`；目录不进 hash；stat 失败跳过、
/// 读失败跳过内容但仍加尾部 NUL。
pub(super) fn hash_directory(dir: &Path) -> String {
    fn walk(base: &Path, rel_dir: &str, hasher: &mut Sha256) {
        let abs_dir = if rel_dir.is_empty() {
            base.to_path_buf()
        } else {
            base.join(rel_dir)
        };
        let Ok(read_dir) = fs::read_dir(&abs_dir) else {
            return;
        };
        let mut entries: Vec<_> = read_dir.filter_map(|entry| entry.ok()).collect();
        entries.sort_by(|a, b| a.file_name().cmp(&b.file_name()));
        for entry in entries {
            let name = entry.file_name().to_string_lossy().into_owned();
            if HASH_IGNORE.contains(&name.as_str()) {
                continue;
            }
            let rel = if rel_dir.is_empty() {
                name.clone()
            } else {
                format!("{rel_dir}/{name}")
            };
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                walk(base, &rel, hasher);
            } else if file_type.is_file() {
                let abs = base.join(&rel);
                let Ok(meta) = fs::metadata(&abs) else {
                    continue;
                };
                let exec_bit = exec_bit_of(&meta);
                hasher.update(format!("{rel}\0{exec_bit}\0"));
                if let Ok(bytes) = fs::read(&abs) {
                    hasher.update(&bytes);
                }
                hasher.update(b"\0");
            }
        }
    }
    let mut hasher = Sha256::new();
    walk(dir, "", &mut hasher);
    format!("{:x}", hasher.finalize())
}

/// upstream sourceSignatureFromTree：tree 中 sourceDir 前缀内 blob 的
/// `"<path>:<sha>"` 排序后 `"\n".join` 的 sha256 hex；无匹配 → None。
pub(super) fn source_signature_from_tree(tree: &[Value], source_dir: &str) -> Option<String> {
    if source_dir.is_empty() {
        return None;
    }
    let prefix = format!("{source_dir}/");
    let mut rels: Vec<String> = tree
        .iter()
        .filter_map(|entry| {
            if entry.get("type").and_then(Value::as_str) != Some("blob") {
                return None;
            }
            let sha = entry
                .get("sha")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())?;
            let path = entry.get("path").and_then(Value::as_str).unwrap_or("");
            if path == source_dir || path.starts_with(&prefix) {
                Some(format!("{path}:{sha}"))
            } else {
                None
            }
        })
        .collect();
    if rels.is_empty() {
        return None;
    }
    rels.sort();
    let mut hasher = Sha256::new();
    hasher.update(rels.join("\n"));
    Some(format!("{:x}", hasher.finalize()))
}
