//! Read PI CLI session history from `~/.pi/agent/sessions/`.
//!
//! Layout (JetBrains PiHistoryReader-aligned):
//! ```text
//! ~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<sessionId>.jsonl
//! ```
//! First line: `{type:"session", id, cwd, timestamp}`
//! Message lines: `{type:"message", id, message:{role, content}}`
//! Roles: user | assistant | toolResult

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader as AsyncBufReader};
use tokio::time::timeout;

const LOCAL_SESSION_SCAN_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_TITLE_CHARS: usize = 80;
const MAX_TOOL_RESULT_CHARS: usize = 20_000;

fn normalize_session_id(session_id: &str) -> Result<String, String> {
    let normalized = session_id.trim();
    if normalized.is_empty()
        || normalized == "."
        || normalized.contains('/')
        || normalized.contains('\\')
        || normalized.contains("..")
    {
        return Err("[SESSION_NOT_FOUND] Invalid PI session id".to_string());
    }
    Ok(normalized.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionSummary {
    pub session_id: String,
    pub first_message: String,
    pub updated_at: i64,
    pub created_at: i64,
    pub message_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canonical_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attribution_status: Option<String>,
    /// Present when this file was created by fork/clone (`parentSession`
    /// header): the SOURCE session id. Drives sidebar nesting + tree merge.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
    /// "message", "reasoning", or "tool"
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_output: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionUsage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub cache_creation_input_tokens: Option<i64>,
    pub cache_read_input_tokens: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiSessionLoadResult {
    pub messages: Vec<PiSessionMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<PiSessionUsage>,
}

struct SessionHeader {
    session_id: String,
    cwd: Option<String>,
    timestamp_ms: i64,
    /// Fork-derived files record the source file in `parentSession`.
    parent_session_id: Option<String>,
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let truncated: String = value.chars().take(max_chars).collect();
    format!("{truncated}…")
}

fn normalize_windows_path_for_comparison(path: &str) -> String {
    if path.is_empty() {
        return String::new();
    }
    let mut normalized = path.replace('\\', "/");
    if normalized.starts_with("//?/UNC/") {
        normalized = format!("//{}", &normalized["//?/UNC/".len()..]);
    } else if normalized.starts_with("//?/") {
        normalized = normalized["//?/".len()..].to_string();
    }
    while normalized.ends_with('/') && normalized.len() > 1 {
        normalized.pop();
    }
    normalized
}

fn build_path_variants(path: &str) -> Vec<String> {
    let normalized = normalize_windows_path_for_comparison(path.trim());
    if normalized.is_empty() {
        return Vec::new();
    }
    let mut variants = vec![normalized.clone()];
    if normalized.starts_with("/private/") {
        variants.push(normalized["/private".len()..].to_string());
    } else if normalized.starts_with('/') {
        variants.push(format!("/private{normalized}"));
    }
    if normalized.len() >= 2 && normalized.as_bytes()[1] == b':' {
        let mut chars = normalized.chars();
        if let Some(first) = chars.next() {
            variants.push(format!("{}{}", first.to_ascii_lowercase(), chars.as_str()));
        }
        variants.push(normalized.to_ascii_lowercase());
    }
    if normalized.starts_with("//") {
        variants.push(normalized.to_ascii_lowercase());
    }
    variants.sort();
    variants.dedup();
    variants
}

fn build_workspace_path_variants(workspace_path: &Path) -> Vec<String> {
    let workspace_raw = workspace_path.to_string_lossy().to_string();
    let mut workspace_variants = build_path_variants(&workspace_raw);
    if let Ok(canonical_workspace) = std::fs::canonicalize(workspace_path) {
        let canonical_workspace_raw = canonical_workspace.to_string_lossy().to_string();
        workspace_variants.extend(build_path_variants(&canonical_workspace_raw));
    }
    workspace_variants.sort();
    workspace_variants.dedup();
    workspace_variants
}

fn paths_match(candidate: &str, workspace_variants: &[String]) -> bool {
    let candidate_variants = build_path_variants(candidate);
    for left in &candidate_variants {
        for right in workspace_variants {
            if left.eq_ignore_ascii_case(right) {
                return true;
            }
        }
    }
    false
}

fn parse_iso_millis(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|dt| dt.timestamp_millis())
        .or_else(|| {
            value
                .parse::<i64>()
                .ok()
                .map(|n| if n < 1_000_000_000_000 { n * 1000 } else { n })
        })
        .unwrap_or(0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PiUserPromptScan {
    HasUser,
    ScannedEmpty,
    Unknown,
}

fn content_has_media_part(content: Option<&Value>) -> bool {
    let Some(parts) = content.and_then(Value::as_array) else {
        return false;
    };
    parts.iter().any(|part| {
        matches!(
            part.get("type").and_then(Value::as_str),
            Some("image" | "image_url" | "file" | "document")
        )
    })
}

fn first_nonempty_str(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(text) = value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            return Some(text.to_string());
        }
    }
    None
}

fn push_unique_image(out: &mut Vec<String>, value: String) {
    if !value.is_empty() && !out.iter().any(|existing| existing == &value) {
        out.push(value);
    }
}

fn image_data_url(mime: &str, data: &str) -> Option<String> {
    let trimmed = data.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("data:image/") {
        return Some(trimmed.to_string());
    }
    let mime = mime.trim();
    let mime = if mime.to_ascii_lowercase().starts_with("image/") {
        mime
    } else {
        "image/png"
    };
    Some(format!("data:{mime};base64,{trimmed}"))
}

/// Large RPC inline images must not enter the timeline as multi-MB data URLs.
/// Spill above 8KiB encoded payload to a temp file; thumbs still load by path.
fn image_display_ref(mime: &str, data: &str) -> Option<String> {
    const INLINE_LIMIT: usize = 8 * 1024;
    let trimmed = data.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.len() <= INLINE_LIMIT {
        return image_data_url(mime, trimmed);
    }
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(trimmed.split(',').next_back().unwrap_or(trimmed))
        .ok()?;
    let ext = if mime.to_ascii_lowercase().contains("jpeg")
        || mime.to_ascii_lowercase().contains("jpg")
    {
        "jpg"
    } else if mime.to_ascii_lowercase().contains("gif") {
        "gif"
    } else if mime.to_ascii_lowercase().contains("webp") {
        "webp"
    } else {
        "png"
    };
    let dir = std::env::temp_dir().join("mossx-pi-inline-images");
    std::fs::create_dir_all(&dir).ok()?;
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    trimmed.hash(&mut hasher);
    let path = dir.join(format!("{:016x}.{ext}", hasher.finish()));
    if !path.exists() {
        std::fs::write(&path, bytes).ok()?;
    }
    Some(path.to_string_lossy().into_owned())
}

/// RPC-era Pi user turns store screenshots as `{type:"image", data, mimeType}`
/// content blocks with no `<file name>` wrapper. Print-json `@file` history
/// still uses wrappers; those paths win when present. Image blocks are the
/// fallback so reopen/history can show the same thumbs other engines keep.
fn extract_image_content_display_refs(content: Option<&Value>) -> Vec<String> {
    let Some(parts) = content.and_then(Value::as_array) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for part in parts {
        let kind = part.get("type").and_then(Value::as_str).unwrap_or("");
        if kind != "image" && kind != "image_url" {
            continue;
        }
        if let Some(path) = first_nonempty_str(part, &["path", "url", "src"]) {
            push_unique_image(&mut out, path);
            continue;
        }
        if let Some(url) = part
            .pointer("/image_url/url")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|url| !url.is_empty())
        {
            push_unique_image(&mut out, url.to_string());
            continue;
        }
        if let Some(data) = part.get("data").and_then(Value::as_str) {
            let mime = part
                .get("mimeType")
                .or_else(|| part.get("mime_type"))
                .or_else(|| part.get("media_type"))
                .and_then(Value::as_str)
                .unwrap_or("image/png");
            if let Some(url) = image_display_ref(mime, data) {
                push_unique_image(&mut out, url);
            }
            continue;
        }
        if let Some(source) = part.get("source") {
            if let Some(url) = first_nonempty_str(source, &["url", "path"]) {
                push_unique_image(&mut out, url);
                continue;
            }
            if let Some(data) = source.get("data").and_then(Value::as_str) {
                let mime = source
                    .get("media_type")
                    .or_else(|| source.get("mimeType"))
                    .and_then(Value::as_str)
                    .unwrap_or("image/png");
                if let Some(url) = image_display_ref(mime, data) {
                    push_unique_image(&mut out, url);
                }
            }
        }
    }
    out
}

fn split_pi_user_content_for_display(
    raw_text: &str,
    content: Option<&Value>,
) -> (String, Vec<String>) {
    let (legacy_text, legacy_images) =
        crate::engine::cli_image_input::split_pi_prompt_for_display(raw_text);
    let (display_text, wrapper_paths) = if !legacy_images.is_empty() {
        (legacy_text, legacy_images)
    } else {
        crate::engine::cli_image_input::split_pi_file_attachments_for_display(&legacy_text)
    };
    // Wrapper 路径分流：图片进 images（print-json 时代语义——路径优先，
    // content-block base64 不二次投影）；非图片（RPC 时代 <file path="...">
    // 文本附件）以 `@路径` 回到可见正文，禁止进 images（前端无扩展名过滤，
    // 会渲染裂图 chip 并顶掉 content-block 真实图片——2026-08-25 用户报告）。
    let (wrapper_images, file_refs): (Vec<String>, Vec<String>) = wrapper_paths
        .into_iter()
        .partition(|path| crate::engine::cli_image_input::is_image_attachment_path(path));
    let display_text = if file_refs.is_empty() {
        display_text
    } else {
        let refs = file_refs
            .iter()
            .map(|path| format!("@{path}"))
            .collect::<Vec<_>>()
            .join("\n");
        if display_text.is_empty() {
            refs
        } else {
            format!("{display_text}\n{refs}")
        }
    };
    if !wrapper_images.is_empty() {
        return (display_text, wrapper_images);
    }
    (display_text, extract_image_content_display_refs(content))
}

fn extract_text_blocks(content: Option<&Value>) -> String {
    let Some(content) = content else {
        return String::new();
    };
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    let Some(parts) = content.as_array() else {
        return String::new();
    };
    parts
        .iter()
        .filter_map(|part| {
            if let Some(text) = part.as_str() {
                return Some(text.to_string());
            }
            let kind = part.get("type").and_then(Value::as_str).unwrap_or("");
            match kind {
                "text" => part.get("text").and_then(Value::as_str).map(str::to_string),
                "thinking" => part
                    .get("thinking")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                _ => None,
            }
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

fn encode_pi_cwd_dir_name(path: &str) -> String {
    path.replace('\\', "/").replace(['/', ':'], "-")
}

fn find_pi_file_with_suffix(dir: &Path, suffix: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten().take(512) {
        let path = entry.path();
        let name = path.file_name()?.to_string_lossy();
        if name.ends_with(suffix) && path.is_file() {
            return Some(path);
        }
    }
    None
}

/// Locate `*_{sessionId}.jsonl` under the workspace encoded-cwd, then a bounded
/// root scan. Session ids are globally unique; miss must stay unconfirmed.
pub(crate) fn locate_pi_session_file(workspace_path: &Path, session_id: &str) -> Option<PathBuf> {
    locate_pi_session_file_with_home(workspace_path, session_id, None)
}

fn locate_pi_session_file_with_home(
    workspace_path: &Path,
    session_id: &str,
    home_dir: Option<&str>,
) -> Option<PathBuf> {
    let session_id = session_id.trim();
    if session_id.is_empty()
        || session_id.contains('/')
        || session_id.contains('\\')
        || session_id.contains("..")
    {
        return None;
    }
    let suffix = format!("_{session_id}.jsonl");
    let root = resolve_pi_sessions_root(home_dir);
    for variant in build_workspace_path_variants(workspace_path) {
        let encoded = encode_pi_cwd_dir_name(&variant);
        if let Some(found) = find_pi_file_with_suffix(&root.join(encoded), &suffix) {
            return Some(found);
        }
    }
    let Ok(dirs) = std::fs::read_dir(&root) else {
        return None;
    };
    for entry in dirs.flatten().take(128) {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Some(found) = find_pi_file_with_suffix(&path, &suffix) {
            return Some(found);
        }
    }
    None
}

pub(crate) fn scan_pi_jsonl_user_prompt(path: &Path) -> PiUserPromptScan {
    let Ok(file) = std::fs::File::open(path) else {
        return PiUserPromptScan::Unknown;
    };
    let mut reached_eof = true;
    for (index, line) in std::io::BufRead::lines(std::io::BufReader::new(file)).enumerate() {
        if index >= 80 {
            reached_eof = false;
            break;
        }
        let line = match line {
            Ok(line) => line,
            Err(_) => return PiUserPromptScan::Unknown,
        };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let role = value
            .pointer("/message/role")
            .and_then(Value::as_str)
            .unwrap_or("");
        if role != "user" {
            continue;
        }
        let content = value.pointer("/message/content");
        if content_has_media_part(content) {
            return PiUserPromptScan::HasUser;
        }
        let text = extract_text_blocks(content);
        if !text.trim().is_empty() {
            return PiUserPromptScan::HasUser;
        }
    }
    if reached_eof {
        PiUserPromptScan::ScannedEmpty
    } else {
        PiUserPromptScan::Unknown
    }
}

pub fn resolve_pi_sessions_root(home_override: Option<&str>) -> PathBuf {
    if let Ok(override_dir) = std::env::var("PI_CODING_AGENT_SESSION_DIR") {
        let trimmed = override_dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }
    }
    if let Some(home) = home_override.map(str::trim).filter(|v| !v.is_empty()) {
        return PathBuf::from(home).join("sessions");
    }
    if let Ok(agent_dir) = std::env::var("PI_CODING_AGENT_DIR") {
        let trimmed = agent_dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("sessions");
        }
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".pi")
        .join("agent")
        .join("sessions")
}

fn header_from_file_name(file: &Path) -> Option<SessionHeader> {
    let name = file.file_name()?.to_string_lossy();
    if !name.ends_with(".jsonl") {
        return None;
    }
    let stem = &name[..name.len() - ".jsonl".len()];
    let underscore = stem.rfind('_')?;
    if underscore == 0 || underscore + 1 >= stem.len() {
        return None;
    }
    let session_id = stem[underscore + 1..].to_string();
    if session_id.is_empty() {
        return None;
    }
    Some(SessionHeader {
        session_id,
        cwd: None,
        timestamp_ms: 0,
        parent_session_id: None,
    })
}

fn parse_header(value: &Value, file: &Path) -> Option<SessionHeader> {
    let mut session_id = value
        .get("id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    if session_id.is_none() {
        session_id = header_from_file_name(file).map(|h| h.session_id);
    }
    let session_id = session_id?;
    let cwd = value
        .get("cwd")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let timestamp_ms = value
        .get("timestamp")
        .and_then(Value::as_str)
        .map(parse_iso_millis)
        .unwrap_or(0);
    let parent_session_id = value
        .get("parentSession")
        .and_then(Value::as_str)
        .and_then(|path| {
            let name = Path::new(path).file_name()?.to_string_lossy();
            let stem = name.strip_suffix(".jsonl")?;
            let underscore = stem.rfind('_')?;
            let id = stem[underscore + 1..].trim();
            if id.is_empty() {
                None
            } else {
                Some(id.to_string())
            }
        });
    Some(SessionHeader {
        session_id,
        cwd,
        timestamp_ms,
        parent_session_id,
    })
}

async fn file_mtime_ms(path: &Path) -> i64 {
    fs::metadata(path)
        .await
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// 纯附件首条消息的标题标记（对齐 gemini `[image]` 惯例）：
/// 全图片扩展名给 `[图片]`，否则 `[附件]`，多个带 xN。
fn attachment_title_marker(paths: &[String]) -> String {
    let all_images = paths.iter().all(|path| {
        let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        matches!(
            ext.as_str(),
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp"
        )
    });
    let label = if all_images { "[图片" } else { "[附件" };
    if paths.len() > 1 {
        format!("{label} x{}]", paths.len())
    } else {
        format!("{label}]")
    }
}

async fn read_session_summary(file: &Path) -> Option<PiSessionSummary> {
    let file_handle = fs::File::open(file).await.ok()?;
    let mut lines = AsyncBufReader::new(file_handle).lines();
    let mut header: Option<SessionHeader> = None;
    let mut first_user_prompt: Option<String> = None;
    let mut message_count: usize = 0;
    let mut last_ts: i64 = 0;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        if event_type == "session" && header.is_none() {
            header = parse_header(&value, file);
            continue;
        }
        if event_type != "message" {
            continue;
        }
        let Some(message) = value.get("message") else {
            continue;
        };
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        let ts = value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(parse_iso_millis)
            .or_else(|| {
                message.get("timestamp").and_then(|v| v.as_i64()).map(|n| {
                    if n < 1_000_000_000_000 {
                        n * 1000
                    } else {
                        n
                    }
                })
            })
            .unwrap_or(0);
        if ts > last_ts {
            last_ts = ts;
        }
        if role == "user" {
            message_count += 1;
            if first_user_prompt.is_none() {
                let text = extract_text_blocks(message.get("content"));
                // 侧栏标题必须剥 <file name="..."> 附件包装（截图/文件首条消息
                // 会泄漏原始 tag，与其它引擎不一致——2026-08-24 用户报告）；
                // 与 load_pi_session 展示路径同纪律：先 legacy 注入标记，再
                // @file 附件拆分。纯附件消息用 [图片]/[附件] 标记兜底。
                let (visible, attachments) = {
                    let (legacy_text, legacy_images) =
                        crate::engine::cli_image_input::split_pi_prompt_for_display(&text);
                    if !legacy_images.is_empty() {
                        (legacy_text, legacy_images)
                    } else {
                        crate::engine::cli_image_input::split_pi_file_attachments_for_display(
                            &legacy_text,
                        )
                    }
                };
                let title_source = if visible.trim().is_empty() && !attachments.is_empty() {
                    attachment_title_marker(&attachments)
                } else {
                    visible
                };
                if !title_source.trim().is_empty() {
                    first_user_prompt = Some(title_source);
                }
            }
        } else if role == "assistant" {
            message_count += 1;
        }
    }

    let header = header.or_else(|| header_from_file_name(file))?;
    if header.session_id.is_empty() {
        return None;
    }
    let mtime = file_mtime_ms(file).await;
    let created_at = if header.timestamp_ms > 0 {
        header.timestamp_ms
    } else {
        mtime
    };
    let updated_at = if last_ts > 0 { last_ts } else { mtime };
    let first_message = first_user_prompt
        .map(|text| truncate_chars(text.trim(), MAX_TITLE_CHARS))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| {
            let short = if header.session_id.chars().count() > 8 {
                truncate_chars(&header.session_id, 8)
            } else {
                header.session_id.clone()
            };
            format!("PI session {short}")
        });
    let file_size = fs::metadata(file).await.ok().map(|m| m.len());

    Some(PiSessionSummary {
        session_id: header.session_id,
        first_message,
        updated_at,
        created_at,
        message_count,
        file_size_bytes: file_size,
        engine: Some("pi".to_string()),
        canonical_session_id: None,
        attribution_status: None,
        parent_session_id: header.parent_session_id,
    })
}

/// 列表路径专用的有界 summary：只读文件头部（默认 64KB）拿 header + 首条
/// 用户消息 + 消息存在性；updated_at 用 mtime（mtime 即真实最后写入时间，
/// 列表排序语义不变）。read_session_summary 的逐行全量 parse 对 MB 级长会话
/// 是 O(全部会话字节)，3 个并发 scan 就能把 CPU 烧满（2026-08-29 卡死事故
/// sample 实证：codemoss 工作区单个目录就压着 120MB+ 的会话文件）。
/// message_count 降级为「有无消息」标记：空会话清剪只判 ==0，语义保留。
async fn read_session_summary_for_list(
    file: &Path,
    max_head_bytes: u64,
) -> Option<PiSessionSummary> {
    let file_handle = fs::File::open(file).await.ok()?;
    let mut header: Option<SessionHeader> = None;
    let mut first_user_prompt: Option<String> = None;
    let mut has_message = false;
    let mut consumed = 0u64;

    let mut lines = AsyncBufReader::new(file_handle).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        consumed += line.len() as u64 + 1;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        if event_type == "session" && header.is_none() {
            header = parse_header(&value, file);
        } else if event_type == "message" {
            has_message = true;
            if first_user_prompt.is_none() {
                if let Some(message) = value.get("message") {
                    if message.get("role").and_then(Value::as_str) == Some("user") {
                        let text = extract_text_blocks(message.get("content"));
                        // @file 附件拆分。纯附件消息用 [图片]/[附件] 标记兜底。
                        let (visible, attachments) = {
                            let (legacy_text, legacy_images) =
                                crate::engine::cli_image_input::split_pi_prompt_for_display(&text);
                            if !legacy_images.is_empty() {
                                (legacy_text, legacy_images)
                            } else {
                                crate::engine::cli_image_input::split_pi_file_attachments_for_display(
                                    &legacy_text,
                                )
                            }
                        };
                        let title_source = if visible.trim().is_empty() && !attachments.is_empty() {
                            attachment_title_marker(&attachments)
                        } else {
                            visible
                        };
                        if !title_source.trim().is_empty() {
                            first_user_prompt = Some(title_source);
                        }
                    }
                }
            }
        }
        // 拿齐 header 与首条用户消息即可停，避免读进长会话的尾部。
        if header.is_some() && first_user_prompt.is_some() {
            break;
        }
        if consumed >= max_head_bytes {
            break;
        }
    }

    let header = header.or_else(|| header_from_file_name(file))?;
    if header.session_id.is_empty() {
        return None;
    }
    let mtime = file_mtime_ms(file).await;
    let created_at = if header.timestamp_ms > 0 {
        header.timestamp_ms
    } else {
        mtime
    };
    let first_message = first_user_prompt
        .map(|text| truncate_chars(text.trim(), MAX_TITLE_CHARS))
        .filter(|text| !text.is_empty())
        .unwrap_or_else(|| {
            let short = if header.session_id.chars().count() > 8 {
                truncate_chars(&header.session_id, 8)
            } else {
                header.session_id.clone()
            };
            format!("PI session {short}")
        });
    let file_size = fs::metadata(file).await.ok().map(|m| m.len());

    Some(PiSessionSummary {
        session_id: header.session_id,
        first_message,
        updated_at: mtime,
        created_at,
        message_count: if has_message { 1 } else { 0 },
        file_size_bytes: file_size,
        engine: Some("pi".to_string()),
        canonical_session_id: None,
        attribution_status: None,
        parent_session_id: header.parent_session_id,
    })
}

async fn list_all_session_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    let mut cwd_dirs = fs::read_dir(root)
        .await
        .map_err(|e| format!("Failed to read PI sessions root: {e}"))?;
    while let Some(entry) = cwd_dirs
        .next_entry()
        .await
        .map_err(|e| format!("Failed to walk PI sessions root: {e}"))?
    {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.starts_with('.') {
            continue;
        }
        let mut jsonl = fs::read_dir(&path)
            .await
            .map_err(|e| format!("Failed to read PI cwd dir: {e}"))?;
        while let Some(file_entry) = jsonl
            .next_entry()
            .await
            .map_err(|e| format!("Failed to walk PI cwd dir: {e}"))?
        {
            let file_path = file_entry.path();
            if file_path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("jsonl"))
            {
                files.push(file_path);
            }
        }
    }
    Ok(files)
}

/// F1（fix-session-load-bridge-freeze）：raw-string 返回通道。
/// 对象图过 WKWebView 桥按对象数逐个同步转换（2140 条 / ~3MB 实测冻结主线程
/// 6683ms）；字符串成本 O(len)。序列化在 tokio 线程，不占 UI。前端一次 parse。
pub async fn load_pi_session_payload_json(
    workspace_path: &Path,
    session_id: &str,
    home_dir: Option<&str>,
) -> Result<String, String> {
    let result = load_pi_session(workspace_path, session_id, home_dir).await?;
    serde_json::to_string(&result).map_err(|error| error.to_string())
}

/// F5（fix-session-load-bridge-freeze）：session_id → 候选文件索引（按 root 分桶）。
/// 实测 resolve 全量扫描 117 目录/227MB 与目标会话体量无关（3 条 items 也 1563ms）。
/// 命中后仅做 exists() 校验；miss（新会话/文件被删）触发一次重建，等价旧行为。
#[derive(Clone, Debug)]
struct PiIndexedSessionFile {
    path: PathBuf,
    cwd: Option<String>,
}

#[derive(Default)]
struct PiSessionFileIndexRoot {
    by_session_id: HashMap<String, Vec<PiIndexedSessionFile>>,
}

static PI_SESSION_FILE_INDEX: OnceLock<Mutex<HashMap<PathBuf, PiSessionFileIndexRoot>>> =
    OnceLock::new();

fn pi_session_file_index_map() -> &'static Mutex<HashMap<PathBuf, PiSessionFileIndexRoot>> {
    PI_SESSION_FILE_INDEX.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn read_pi_session_header(file: &Path) -> Option<SessionHeader> {
    let file_handle = fs::File::open(file).await.ok()?;
    let mut lines = AsyncBufReader::new(file_handle).lines();
    let first_line = lines.next_line().await.ok().flatten()?;
    let header = serde_json::from_str::<Value>(first_line.trim())
        .ok()
        .and_then(|value| {
            if value.get("type").and_then(Value::as_str) == Some("session") {
                parse_header(&value, file)
            } else {
                None
            }
        });
    header.or_else(|| header_from_file_name(file))
}

async fn rebuild_pi_session_file_index(root: &Path) -> Result<(), String> {
    let files = list_all_session_files(root).await?;
    let mut by_session_id: HashMap<String, Vec<PiIndexedSessionFile>> = HashMap::new();
    for file in files {
        let Some(header) = read_pi_session_header(&file).await else {
            continue;
        };
        if header.session_id.is_empty() {
            continue;
        }
        by_session_id
            .entry(header.session_id)
            .or_default()
            .push(PiIndexedSessionFile {
                path: file,
                cwd: header.cwd,
            });
    }
    let mut map = pi_session_file_index_map()
        .lock()
        .map_err(|_| "PI session file index poisoned".to_string())?;
    map.insert(root.to_path_buf(), PiSessionFileIndexRoot { by_session_id });
    Ok(())
}

fn pick_indexed_session_file(
    index_map: &HashMap<PathBuf, PiSessionFileIndexRoot>,
    root: &Path,
    session_id: &str,
    workspace_variants: &[String],
    allow_cwd_mismatch_fallback: bool,
) -> Option<PathBuf> {
    let root_index = index_map.get(root)?;
    let candidates = root_index.by_session_id.get(session_id)?;
    let mut fallback: Option<&PiIndexedSessionFile> = None;
    for candidate in candidates {
        if let Some(cwd) = candidate.cwd.as_deref() {
            if paths_match(cwd, workspace_variants) {
                return Some(candidate.path.clone());
            }
        }
        if allow_cwd_mismatch_fallback && fallback.is_none() {
            fallback = Some(candidate);
        }
    }
    fallback.map(|candidate| candidate.path.clone())
}

async fn resolve_session_file(
    root: &Path,
    session_id: &str,
    workspace_path: &Path,
    allow_cwd_mismatch_fallback: bool,
) -> Result<Option<PathBuf>, String> {
    let workspace_variants = build_workspace_path_variants(workspace_path);
    {
        let index_map = pi_session_file_index_map()
            .lock()
            .map_err(|_| "PI session file index poisoned".to_string())?;
        if let Some(path) = pick_indexed_session_file(
            &index_map,
            root,
            session_id,
            &workspace_variants,
            allow_cwd_mismatch_fallback,
        ) {
            if path.exists() {
                return Ok(Some(path));
            }
        }
    }
    rebuild_pi_session_file_index(root).await?;
    let index_map = pi_session_file_index_map()
        .lock()
        .map_err(|_| "PI session file index poisoned".to_string())?;
    let resolved = pick_indexed_session_file(
        &index_map,
        root,
        session_id,
        &workspace_variants,
        allow_cwd_mismatch_fallback,
    );
    match resolved {
        Some(path) if path.exists() => Ok(Some(path)),
        _ => Ok(None),
    }
}

/// Resolve a session id to its JSONL file path (for RPC `switch_session`).
/// Allows cwd-mismatch fallback: the resident must be able to align to any
/// session of this workspace profile, even when cwd metadata drifts.
pub async fn resolve_pi_session_file_by_id(
    home_dir: Option<&str>,
    session_id: &str,
    workspace_path: &Path,
) -> Result<Option<PathBuf>, String> {
    if let Some(path) = locate_pi_session_file_with_home(workspace_path, session_id, home_dir) {
        return Ok(Some(path));
    }
    let root = resolve_pi_sessions_root(home_dir);
    resolve_session_file(&root, session_id, workspace_path, true).await
}

/// One entry of a fork-derived session file, projected for tree merge.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiDerivedLaneEntry {
    pub id: String,
    pub parent_id: Option<String>,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub timestamp: Option<String>,
    pub role: Option<String>,
    pub text: String,
}

/// A fork-derived session (`parentSession` == the viewed file): a lane of
/// the conversation family that lives in its own file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiDerivedLane {
    pub session_id: String,
    pub session_file: String,
    pub entries: Vec<PiDerivedLaneEntry>,
}

/// Parse all entries of a session file (skip the `session` header line).
/// Read-only (红线 21); unparseable lines are skipped.
pub async fn parse_pi_session_entries(file: &Path) -> Result<Vec<PiDerivedLaneEntry>, String> {
    let handle = fs::File::open(file)
        .await
        .map_err(|error| format!("failed to open pi session file {}: {error}", file.display()))?;
    let mut lines = AsyncBufReader::new(handle).lines();
    let mut entries = Vec::new();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let entry_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if entry_type == "session" {
            continue;
        }
        let Some(id) = value.get("id").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        let parent_id = value
            .get("parentId")
            .and_then(Value::as_str)
            .map(str::to_string);
        let (role, text) = match value.get("message") {
            Some(message) => (
                message
                    .get("role")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                // 树行只展示单行预览：长工具输出/长正文截断，防止会话族
                // 合并响应过 IPC 时膨胀（红线 21 只读，不改 vendor 文件）。
                truncate_chars(&extract_text_blocks(message.get("content")), 500),
            ),
            None => (None, String::new()),
        };
        entries.push(PiDerivedLaneEntry {
            id,
            parent_id,
            entry_type,
            timestamp: value
                .get("timestamp")
                .and_then(Value::as_str)
                .map(str::to_string),
            role,
            text,
        });
    }
    Ok(entries)
}

/// One member of a fork/clone session family (`parentSession` chain).
#[derive(Debug, Clone)]
pub struct PiSessionFamilyMember {
    pub session_id: String,
    pub session_file: PathBuf,
    pub is_root: bool,
}

/// Resolve the full fork family of `current_file`: walk the `parentSession`
/// chain up to the root, then collect every file in the same directory whose
/// own chain reaches that root. This powers the "family tree" view: after
/// jumping into a branch, the main line stays visible (not truncated).
pub async fn resolve_pi_session_family(
    current_file: &Path,
) -> Result<Vec<PiSessionFamilyMember>, String> {
    let Some(dir) = current_file.parent() else {
        return Ok(Vec::new());
    };
    let mut entries = match fs::read_dir(dir).await {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };
    // id → (file, parent_id)
    let mut by_id: std::collections::HashMap<String, (PathBuf, Option<String>)> =
        std::collections::HashMap::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let path = entry.path();
        let is_jsonl = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext == "jsonl")
            .unwrap_or(false);
        if !is_jsonl {
            continue;
        }
        let Ok(file) = fs::File::open(&path).await else {
            continue;
        };
        let mut lines = AsyncBufReader::new(file).lines();
        let Ok(Some(first_line)) = lines.next_line().await else {
            continue;
        };
        let Ok(header_value) = serde_json::from_str::<Value>(first_line.trim()) else {
            continue;
        };
        if header_value.get("type").and_then(Value::as_str) != Some("session") {
            continue;
        }
        let Some(header) = parse_header(&header_value, &path) else {
            continue;
        };
        by_id.insert(
            header.session_id.clone(),
            (path.clone(), header.parent_session_id),
        );
    }
    // current file's own id
    let Some((current_id, _)) = by_id
        .iter()
        .find(|(_, (path, _))| path == current_file)
        .map(|(id, (path, parent))| (id.clone(), (path.clone(), parent.clone())))
    else {
        return Ok(Vec::new());
    };
    // walk up to root (guard against cycles)
    let mut root_id = current_id.clone();
    for _ in 0..64 {
        let Some((_, Some(parent))) = by_id.get(&root_id) else {
            break;
        };
        root_id = parent.clone();
    }
    // members: every id whose ancestor chain reaches root_id
    let reaches_root = |start: &str| {
        let mut id = start.to_string();
        for _ in 0..64 {
            if id == root_id {
                return true;
            }
            let Some((_, Some(parent))) = by_id.get(&id) else {
                return false;
            };
            id = parent.clone();
        }
        false
    };
    let mut members: Vec<PiSessionFamilyMember> = by_id
        .iter()
        .filter(|(id, _)| reaches_root(id))
        .map(|(id, (path, _))| PiSessionFamilyMember {
            session_id: id.clone(),
            session_file: path.clone(),
            is_root: *id == root_id,
        })
        .collect();
    members.sort_by(|a, b| a.session_file.cmp(&b.session_file));
    Ok(members)
}

/// List fork-derived session files of `current_session_file` and parse their
/// entries for tree merge. Read-only (红线 21). Errors per-file are skipped:
/// one corrupted derived file must not blank the whole tree.
pub async fn list_pi_derived_lanes(
    current_session_file: &Path,
) -> Result<Vec<PiDerivedLane>, String> {
    let family = resolve_pi_session_family(current_session_file).await?;
    let mut lanes = Vec::new();
    for member in family {
        // 家族全图：除 root 外的所有成员都作为 lane 返回（含 current 自身
        // ——跳入分支后 current 也是家族的一条 lane，主线来自 root）。
        if member.is_root {
            continue;
        }
        let Ok(entries) = parse_pi_session_entries(&member.session_file).await else {
            continue;
        };
        lanes.push(PiDerivedLane {
            session_id: member.session_id,
            session_file: member.session_file.to_string_lossy().to_string(),
            entries,
        });
    }
    Ok(lanes)
}

pub async fn list_pi_sessions(
    workspace_path: &Path,
    limit: Option<usize>,
    home_dir: Option<&str>,
) -> Result<Vec<PiSessionSummary>, String> {
    let scan = async {
        let root = resolve_pi_sessions_root(home_dir);
        let workspace_variants = build_workspace_path_variants(workspace_path);
        let files = list_all_session_files(&root).await?;
        let mut sessions = Vec::new();
        for file in files {
            // 廉价 cwd 预过滤：先只读 header 行。read_session_summary 会逐行
            // parse 整个 jsonl（长会话 MB 级），对全机器几千个会话文件全量
            // 扫描会把 CPU 烧满数分钟（2026-08-29 创建会话卡死事故 sample
            // 实证，3 个并发 scan 叠加）。cwd 不匹配的文件到此为止。
            let file_handle = match fs::File::open(&file).await {
                Ok(handle) => handle,
                Err(_) => continue,
            };
            let mut lines = AsyncBufReader::new(file_handle).lines();
            let first_line = lines.next_line().await.ok().flatten();
            let first_value: Option<Value> = first_line
                .as_deref()
                .and_then(|line| serde_json::from_str(line.trim()).ok());
            if let Some(cwd) = first_value
                .as_ref()
                .and_then(|value| value.get("cwd"))
                .and_then(Value::as_str)
            {
                if !paths_match(cwd, &workspace_variants) {
                    continue;
                }
            }
            let Some(summary) = read_session_summary_for_list(&file, 64 * 1024).await else {
                continue;
            };
            sessions.push(summary);
        }
        sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        if let Some(limit) = limit {
            sessions.truncate(limit);
        }
        Ok::<_, String>(sessions)
    };
    timeout(LOCAL_SESSION_SCAN_TIMEOUT, scan)
        .await
        .map_err(|_| "PI session scan timed out".to_string())?
}

fn convert_assistant_message(
    message: &Value,
    entry_id: Option<&str>,
    counter_base: &mut usize,
    timestamp: Option<String>,
) -> Vec<PiSessionMessage> {
    let mut out = Vec::new();
    let Some(parts) = message.get("content").and_then(Value::as_array) else {
        return out;
    };
    let mut text_buf = String::new();
    let mut think_buf = String::new();
    for part in parts {
        let kind = part.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "text" => {
                if let Some(text) = part.get("text").and_then(Value::as_str) {
                    if !text.is_empty() {
                        if !text_buf.is_empty() {
                            text_buf.push('\n');
                        }
                        text_buf.push_str(text);
                    }
                }
            }
            "thinking" => {
                if let Some(text) = part.get("thinking").and_then(Value::as_str) {
                    if !text.is_empty() {
                        if !think_buf.is_empty() {
                            think_buf.push('\n');
                        }
                        think_buf.push_str(text);
                    }
                }
            }
            "toolCall" => {
                if !think_buf.is_empty() {
                    *counter_base += 1;
                    let id = entry_id
                        .map(|e| format!("{e}-think-{counter_base}"))
                        .unwrap_or_else(|| format!("pi-think-{counter_base}"));
                    out.push(PiSessionMessage {
                        id,
                        role: "assistant".to_string(),
                        text: std::mem::take(&mut think_buf),
                        images: None,
                        timestamp: timestamp.clone(),
                        kind: "reasoning".to_string(),
                        tool_type: None,
                        title: None,
                        tool_input: None,
                        tool_output: None,
                    });
                }
                if !text_buf.is_empty() {
                    *counter_base += 1;
                    let id = entry_id
                        .map(|e| format!("{e}-text-{counter_base}"))
                        .unwrap_or_else(|| format!("pi-text-{counter_base}"));
                    out.push(PiSessionMessage {
                        id,
                        role: "assistant".to_string(),
                        text: std::mem::take(&mut text_buf),
                        images: None,
                        timestamp: timestamp.clone(),
                        kind: "message".to_string(),
                        tool_type: None,
                        title: None,
                        tool_input: None,
                        tool_output: None,
                    });
                }
                *counter_base += 1;
                let tool_id = part
                    .get("id")
                    .and_then(Value::as_str)
                    .filter(|v| !v.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("pi-tool-{counter_base}"));
                let name = part
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|v| !v.is_empty())
                    .unwrap_or("tool")
                    .to_string();
                let input = part.get("arguments").cloned();
                out.push(PiSessionMessage {
                    id: tool_id,
                    role: "assistant".to_string(),
                    text: String::new(),
                    images: None,
                    timestamp: timestamp.clone(),
                    kind: if crate::engine::pi::is_pi_background_task_tool(&name) {
                        "backgroundTask".to_string()
                    } else {
                        "tool".to_string()
                    },
                    tool_type: Some(name),
                    title: None,
                    tool_input: input,
                    tool_output: None,
                });
            }
            _ => {}
        }
    }
    if !think_buf.is_empty() {
        *counter_base += 1;
        let id = entry_id
            .map(|e| format!("{e}-think-{counter_base}"))
            .unwrap_or_else(|| format!("pi-think-{counter_base}"));
        out.push(PiSessionMessage {
            id,
            role: "assistant".to_string(),
            text: think_buf,
            images: None,
            timestamp: timestamp.clone(),
            kind: "reasoning".to_string(),
            tool_type: None,
            title: None,
            tool_input: None,
            tool_output: None,
        });
    }
    if !text_buf.is_empty() {
        *counter_base += 1;
        let id = entry_id
            .map(|e| format!("{e}-text-{counter_base}"))
            .unwrap_or_else(|| format!("pi-text-{counter_base}"));
        out.push(PiSessionMessage {
            id,
            role: "assistant".to_string(),
            text: text_buf,
            images: None,
            timestamp,
            kind: "message".to_string(),
            tool_type: None,
            title: None,
            tool_input: None,
            tool_output: None,
        });
    }
    out
}

pub async fn load_pi_session(
    workspace_path: &Path,
    session_id: &str,
    home_dir: Option<&str>,
) -> Result<PiSessionLoadResult, String> {
    let session_id = normalize_session_id(session_id)?;
    let root = resolve_pi_sessions_root(home_dir);
    let Some(file) = resolve_session_file(&root, &session_id, workspace_path, true).await? else {
        return Err(format!(
            "[SESSION_NOT_FOUND] PI session not found: {session_id}"
        ));
    };

    let file_handle = fs::File::open(&file)
        .await
        .map_err(|e| format!("Failed to open PI session: {e}"))?;
    let mut lines = AsyncBufReader::new(file_handle).lines();
    let mut messages = Vec::new();
    let mut counter: usize = 0;
    let mut usage: Option<PiSessionUsage> = None;

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let entry_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        // pi-background-tasks 终态唤醒在历史里持久化为 custom_message 条目
        //（spike 2026-08-26：content XML + details 结构化 snapshot 全保留）。
        // 投影为 backgroundTaskNotification 消息，前端消费它折叠任务卡；
        // 通知本身不成行、不算用户提问。
        let is_custom_notification = entry_type == "custom_message"
            && value.get("customType").and_then(Value::as_str)
                == Some(crate::engine::pi::PI_BACKGROUND_TASK_NOTIFICATION_CUSTOM_TYPE);
        if entry_type != "message" && !is_custom_notification {
            continue;
        }
        if is_custom_notification {
            let details = value
                .get("details")
                .cloned()
                .filter(|candidate| candidate.is_object());
            let content = value.get("content").and_then(Value::as_str).unwrap_or("");
            if let Some(task) =
                crate::engine::pi::parse_pi_background_task_notification(details, content)
            {
                counter += 1;
                messages.push(PiSessionMessage {
                    id: value
                        .get("id")
                        .and_then(Value::as_str)
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("pi-bg-notify-{counter}")),
                    role: "assistant".to_string(),
                    text: String::new(),
                    images: None,
                    timestamp: value
                        .get("timestamp")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    kind: "backgroundTaskNotification".to_string(),
                    tool_type: None,
                    title: None,
                    tool_input: None,
                    tool_output: Some(task),
                });
            }
            continue;
        }
        let Some(message) = value.get("message") else {
            continue;
        };
        let role = message.get("role").and_then(Value::as_str).unwrap_or("");
        let entry_id = value.get("id").and_then(Value::as_str);
        let timestamp = value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(str::to_string);
        match role {
            "user" => {
                let raw_text = extract_text_blocks(message.get("content"));
                // Legacy marker → `@file` `<file name>` wrappers → RPC image
                // content blocks (print-json paths win when present so we do
                // not double-project the inlined base64).
                let (display_text, images) =
                    split_pi_user_content_for_display(&raw_text, message.get("content"));
                if display_text.trim().is_empty() && images.is_empty() {
                    continue;
                }
                counter += 1;
                messages.push(PiSessionMessage {
                    id: entry_id
                        .map(str::to_string)
                        .unwrap_or_else(|| format!("pi-user-{counter}")),
                    role: "user".to_string(),
                    text: display_text,
                    images: (!images.is_empty()).then_some(images),
                    timestamp,
                    kind: "message".to_string(),
                    tool_type: None,
                    title: None,
                    tool_input: None,
                    tool_output: None,
                });
            }
            "assistant" => {
                if let Some(u) = message.get("usage") {
                    usage = Some(PiSessionUsage {
                        input_tokens: u.get("input").and_then(Value::as_i64),
                        output_tokens: u.get("output").and_then(Value::as_i64),
                        cache_creation_input_tokens: u.get("cacheWrite").and_then(Value::as_i64),
                        cache_read_input_tokens: u.get("cacheRead").and_then(Value::as_i64),
                    });
                }
                let converted =
                    convert_assistant_message(message, entry_id, &mut counter, timestamp);
                messages.extend(converted);
            }
            "toolResult" => {
                counter += 1;
                let call_id = message
                    .get("toolCallId")
                    .and_then(Value::as_str)
                    .filter(|v| !v.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("pi-tool-{counter}"));
                let content = truncate_chars(
                    &extract_text_blocks(message.get("content")),
                    MAX_TOOL_RESULT_CHARS,
                );
                let is_error = message
                    .get("isError")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                // bg 启动工具的 toolResult 携带结构化 receipt snapshot
                //（details.task，spike 2026-08-26）：升级为 backgroundTask
                // 条目，前端用它把任务卡重建为运行中/待折叠态。
                let tool_name = message
                    .get("toolName")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let receipt_task =
                    if !is_error && crate::engine::pi::is_pi_background_task_tool(tool_name) {
                        message
                            .get("details")
                            .and_then(|details| details.get("task"))
                            .filter(|task| task.get("id").and_then(Value::as_str).is_some())
                            .cloned()
                    } else {
                        None
                    };
                let is_background_task = receipt_task.is_some();
                messages.push(PiSessionMessage {
                    id: format!("{call_id}-result"),
                    role: "tool".to_string(),
                    text: content.clone(),
                    images: None,
                    timestamp,
                    kind: if is_background_task {
                        "backgroundTask".to_string()
                    } else {
                        "tool".to_string()
                    },
                    tool_type: Some(if is_error {
                        "error".to_string()
                    } else {
                        "result".to_string()
                    }),
                    title: None,
                    tool_input: None,
                    tool_output: Some(receipt_task.unwrap_or(Value::String(content))),
                });
            }
            _ => {}
        }
    }

    Ok(PiSessionLoadResult { messages, usage })
}

pub async fn delete_pi_session(
    workspace_path: &Path,
    session_id: &str,
    home_dir: Option<&str>,
) -> Result<(), String> {
    let session_id = normalize_session_id(session_id)?;
    let root = resolve_pi_sessions_root(home_dir);
    // session id 全局唯一（UUID），cwd 只是归属提示：list/load 都放宽匹配，
    // delete 必须同样放宽，否则 header 缺 cwd 的会话「能列出却删不掉」，
    // 前端把 SESSION_NOT_FOUND 当成功吞下后文件残留，重启 rescan 即复活。
    let Some(file) = resolve_session_file(&root, &session_id, workspace_path, true).await? else {
        return Err(format!(
            "[SESSION_NOT_FOUND] PI session not found: {session_id}"
        ));
    };
    fs::remove_file(&file)
        .await
        .map_err(|e| format!("Failed to delete PI session: {e}"))?;
    if let Some(parent) = file.parent() {
        if let Ok(mut entries) = fs::read_dir(parent).await {
            let mut empty = true;
            while let Ok(Some(_)) = entries.next_entry().await {
                empty = false;
                break;
            }
            if empty {
                let _ = fs::remove_dir(parent).await;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[tokio::test]
    async fn lists_and_loads_pi_session_jsonl() {
        let dir = std::env::temp_dir().join(format!(
            "pi-history-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let sessions = dir.join("sessions");
        let cwd_dir = sessions.join("--tmp-project--");
        std::fs::create_dir_all(&cwd_dir).expect("mkdir");
        let session_id = "019fe705-27fd-712e-a1be-f972ef3773f3";
        let file = cwd_dir.join(format!("2026-08-09T14-55-02-653Z_{session_id}.jsonl"));
        let project = dir.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let mut handle = std::fs::File::create(&file).expect("create");
        writeln!(
            handle,
            r#"{{"type":"session","version":3,"id":"{session_id}","timestamp":"2026-08-09T14:55:02.653Z","cwd":"{}"}}"#,
            project.display()
        )
        .unwrap();
        writeln!(
            handle,
            r#"{{"type":"message","id":"m1","timestamp":"2026-08-09T14:55:02.745Z","message":{{"role":"user","content":[{{"type":"text","text":"hello pi"}}]}}}}"#
        )
        .unwrap();
        writeln!(
            handle,
            r#"{{"type":"message","id":"m2","timestamp":"2026-08-09T14:55:22.105Z","message":{{"role":"assistant","content":[{{"type":"thinking","thinking":"hi"}},{{"type":"text","text":"pong"}}],"usage":{{"input":10,"output":2}}}}}}"#
        )
        .unwrap();

        let agent_dir = dir.to_string_lossy().to_string();
        let list = list_pi_sessions(&project, Some(10), Some(&agent_dir))
            .await
            .expect("list");
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].session_id, session_id);
        assert!(list[0].first_message.contains("hello"));

        let loaded = load_pi_session(&project, session_id, Some(&agent_dir))
            .await
            .expect("load");
        assert_eq!(loaded.messages.len(), 3); // user + reasoning + text
        assert_eq!(loaded.messages[0].role, "user");
        assert_eq!(loaded.messages[1].kind, "reasoning");
        assert_eq!(loaded.messages[2].text, "pong");
        assert_eq!(loaded.usage.as_ref().unwrap().input_tokens, Some(10));

        delete_pi_session(&project, session_id, Some(&agent_dir))
            .await
            .expect("delete");
        assert!(!file.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn load_pi_session_projects_background_task_entries() {
        // Spike 2026-08-26 形态：bg_run toolCall + toolResult（details.task
        // 结构化 receipt）+ custom_message 终态通知。历史链路必须把三者投影
        // 为 backgroundTask / backgroundTaskNotification 条目，通知不成行、
        // 不算用户提问。
        let dir = std::env::temp_dir().join(format!(
            "pi-history-bg-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let sessions = dir.join("sessions");
        let cwd_dir = sessions.join("--tmp-project--");
        std::fs::create_dir_all(&cwd_dir).expect("mkdir");
        let session_id = "019fe705-27fd-712e-a1be-f972ef3773f4";
        let file = cwd_dir.join(format!("2026-08-09T14-55-02-653Z_{session_id}.jsonl"));
        let project = dir.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let mut handle = std::fs::File::create(&file).expect("create");
        writeln!(
            handle,
            r#"{{"type":"session","version":3,"id":"{session_id}","timestamp":"2026-08-09T14:55:02.653Z","cwd":"{}"}}"#,
            project.display()
        )
        .unwrap();
        writeln!(
            handle,
            r#"{{"type":"message","id":"m1","timestamp":"2026-08-09T14:55:02.745Z","message":{{"role":"user","content":[{{"type":"text","text":"run a bg task"}}]}}}}"#
        )
        .unwrap();
        writeln!(
            handle,
            r#"{{"type":"message","id":"m2","timestamp":"2026-08-09T14:55:10.000Z","message":{{"role":"assistant","content":[{{"type":"toolCall","id":"tool_bg1","name":"bg_run","arguments":{{"name":"spike-task","command":"sleep 3"}}}}]}}}}"#
        )
        .unwrap();
        writeln!(
            handle,
            r#"{{"type":"message","id":"m3","timestamp":"2026-08-09T14:55:10.500Z","message":{{"role":"toolResult","toolCallId":"tool_bg1","toolName":"bg_run","content":[{{"type":"text","text":"Started background task spike-task (b2e2f48ad)"}}],"details":{{"task":{{"id":"b2e2f48ad","name":"spike-task","status":"running","outputPath":".pi/tasks/session-1-1/b2e2f48ad.output"}}}},"isError":false}}}}"#
        )
        .unwrap();
        writeln!(
            handle,
            r#"{{"type":"custom_message","customType":"background-task-notification","content":"<background-task-notification>\n  <task-id>b2e2f48ad</task-id>\n  <status>completed</status>\n</background-task-notification>","display":true,"details":{{"id":"b2e2f48ad","name":"spike-task","status":"completed","exitCode":0}},"id":"m4","timestamp":"2026-08-09T14:55:14.000Z"}}"#
        )
        .unwrap();
        drop(handle);

        let agent_dir = dir.to_string_lossy().to_string();
        let loaded = load_pi_session(&project, session_id, Some(&agent_dir))
            .await
            .expect("load");
        assert_eq!(loaded.messages.len(), 4); // user + call + result + notification
        assert_eq!(loaded.messages[0].role, "user");
        let call = &loaded.messages[1];
        assert_eq!(call.kind, "backgroundTask");
        assert_eq!(call.tool_type.as_deref(), Some("bg_run"));
        let result = &loaded.messages[2];
        assert_eq!(result.kind, "backgroundTask");
        let snapshot = result.tool_output.as_ref().expect("receipt snapshot");
        assert_eq!(
            snapshot.get("id").and_then(Value::as_str),
            Some("b2e2f48ad")
        );
        let notification = &loaded.messages[3];
        assert_eq!(notification.kind, "backgroundTaskNotification");
        let task = notification
            .tool_output
            .as_ref()
            .expect("notification task");
        assert_eq!(
            task.get("status").and_then(Value::as_str),
            Some("completed")
        );
        assert_eq!(task.get("exitCode").and_then(Value::as_i64), Some(0));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn deletes_pi_session_with_foreign_or_missing_cwd() {
        // 回归：header cwd 与 workspace 不匹配（或缺失）的会话能被 list/load
        // 命中，delete 也必须能删掉，否则前端吞下 SESSION_NOT_FOUND 后文件
        // 残留，重启 rescan 会让已删会话复活。
        let dir = std::env::temp_dir().join(format!(
            "pi-history-delete-fallback-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let sessions = dir.join("sessions");
        let cwd_dir = sessions.join("--somewhere-else--");
        std::fs::create_dir_all(&cwd_dir).expect("mkdir");
        let session_id = "019fe705-27fd-712e-a1be-f972ef3773f3";
        let file = cwd_dir.join(format!("2026-08-09T14-55-02-653Z_{session_id}.jsonl"));
        let project = dir.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let mut handle = std::fs::File::create(&file).expect("create");
        writeln!(
            handle,
            r#"{{"type":"session","version":3,"id":"{session_id}","timestamp":"2026-08-09T14:55:02.653Z","cwd":"/somewhere/else"}}"#
        )
        .unwrap();

        let agent_dir = dir.to_string_lossy().to_string();
        delete_pi_session(&project, session_id, Some(&agent_dir))
            .await
            .expect("delete must fall back to the globally-unique session id");
        assert!(!file.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn loads_at_file_era_user_message_with_images() {
        let dir = std::env::temp_dir().join(format!(
            "pi-history-atfile-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let sessions = dir.join("sessions");
        let cwd_dir = sessions.join("--tmp-project--");
        std::fs::create_dir_all(&cwd_dir).expect("mkdir");
        let session_id = "019fe705-27fd-712e-a1be-f972ef3773f4";
        let file = cwd_dir.join(format!("2026-08-14T05-00-00-000Z_{session_id}.jsonl"));
        let project = dir.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let mut handle = std::fs::File::create(&file).expect("create");
        writeln!(
            handle,
            r#"{{"type":"session","version":3,"id":"{session_id}","timestamp":"2026-08-14T05:00:00.000Z","cwd":"{}"}}"#,
            project.display()
        )
        .unwrap();
        // `@file`-era user turn: <file name> wrappers + user text in the text
        // block, plus a base64 image content block that must NOT be projected.
        writeln!(
            handle,
            r#"{{"type":"message","id":"m1","timestamp":"2026-08-14T05:00:01.000Z","message":{{"role":"user","content":[{{"type":"text","text":"<file name=\"/abs/one.png\"></file>\n<file name=\"/abs/two.png\">[Image resized to 1024x768.]</file>\ncompare these"}},{{"type":"image","data":"aGVsbG8=","mimeType":"image/png"}}]}}}}"#
        )
        .unwrap();
        // Legacy injection-era turn must keep parsing too.
        writeln!(
            handle,
            r#"{{"type":"message","id":"m2","timestamp":"2026-08-14T05:01:00.000Z","message":{{"role":"user","content":[{{"type":"text","text":"legacy text\n\n<!-- mossx:pi-image-attachments -->\nThe user attached the following image file(s). You MUST call the read tool on each absolute path below before answering questions about visual content.\n1. /abs/legacy.png\n"}}]}}}}"#
        )
        .unwrap();

        let agent_dir = dir.to_string_lossy().to_string();
        let loaded = load_pi_session(&project, session_id, Some(&agent_dir))
            .await
            .expect("load");
        assert_eq!(loaded.messages.len(), 2);

        let at_file_turn = &loaded.messages[0];
        assert_eq!(at_file_turn.text, "compare these");
        assert_eq!(
            at_file_turn.images,
            Some(vec!["/abs/one.png".to_string(), "/abs/two.png".to_string()])
        );
        assert!(!at_file_turn.text.contains("aGVsbG8="));

        let legacy_turn = &loaded.messages[1];
        assert_eq!(legacy_turn.text, "legacy text");
        assert_eq!(
            legacy_turn.images,
            Some(vec!["/abs/legacy.png".to_string()])
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn loads_rpc_era_user_message_images_from_content_blocks() {
        let dir = std::env::temp_dir().join(format!(
            "pi-history-rpc-image-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let sessions = dir.join("sessions");
        let cwd_dir = sessions.join("--tmp-project--");
        std::fs::create_dir_all(&cwd_dir).expect("mkdir");
        let session_id = "019fe705-27fd-712e-a1be-f972ef3773f5";
        let file = cwd_dir.join(format!("2026-08-24T21-00-00-000Z_{session_id}.jsonl"));
        let project = dir.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let mut handle = std::fs::File::create(&file).expect("create");
        writeln!(
            handle,
            r#"{{"type":"session","version":3,"id":"{session_id}","timestamp":"2026-08-24T21:00:00.000Z","cwd":"{}"}}"#,
            project.display()
        )
        .unwrap();
        // RPC prompt/steer: image content block + user text, no <file name> wrapper.
        writeln!(
            handle,
            r#"{{"type":"message","id":"m-rpc","timestamp":"2026-08-24T21:00:01.000Z","message":{{"role":"user","content":[{{"type":"image","data":"aGVsbG8=","mimeType":"image/png"}},{{"type":"text","text":"这是啥"}}]}}}}"#
        )
        .unwrap();
        writeln!(
            handle,
            r#"{{"type":"message","id":"m-rpc-empty","timestamp":"2026-08-24T21:00:02.000Z","message":{{"role":"user","content":[{{"type":"image","source":{{"type":"base64","media_type":"image/jpeg","data":"AAAA"}}}},{{"type":"text","text":""}}]}}}}"#
        )
        .unwrap();

        let agent_dir = dir.to_string_lossy().to_string();
        let loaded = load_pi_session(&project, session_id, Some(&agent_dir))
            .await
            .expect("load");
        assert_eq!(loaded.messages.len(), 2);

        let captioned = &loaded.messages[0];
        assert_eq!(captioned.text, "这是啥");
        assert_eq!(
            captioned.images,
            Some(vec!["data:image/png;base64,aGVsbG8=".to_string()])
        );
        assert!(!captioned.text.contains("<file name="));

        let image_only = &loaded.messages[1];
        assert_eq!(image_only.text, "");
        assert_eq!(
            image_only.images,
            Some(vec!["data:image/jpeg;base64,AAAA".to_string()])
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn loads_rpc_era_text_file_wrapper_without_leaking_body() {
        // 2026-08-25 用户报告：RPC 时代 <file path="...">正文</file> 包装不被剥离，
        // 整段文件正文泄漏进消息气泡。修复后：包装剥离、md 路径以 @ref 回正文、
        // content-block 真实图片不丢。
        let dir = std::env::temp_dir().join(format!(
            "pi-history-rpc-file-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let sessions = dir.join("sessions");
        let cwd_dir = sessions.join("--tmp-project--");
        std::fs::create_dir_all(&cwd_dir).expect("mkdir");
        let session_id = "019fe705-27fd-712e-a1be-f972ef3773f6";
        let file = cwd_dir.join(format!("2026-08-25T08-00-00-000Z_{session_id}.jsonl"));
        let project = dir.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let mut handle = std::fs::File::create(&file).expect("create");
        writeln!(
            handle,
            r#"{{"type":"session","version":3,"id":"{session_id}","timestamp":"2026-08-25T08:00:00.000Z","cwd":"{}"}}"#,
            project.display()
        )
        .unwrap();
        // RPC prompt with image content block + `<file path>` text attachment wrapper.
        writeln!(
            handle,
            r#"{{"type":"message","id":"m-rpc-file","timestamp":"2026-08-25T08:00:01.000Z","message":{{"role":"user","content":[{{"type":"image","data":"aGVsbG8=","mimeType":"image/png"}},{{"type":"text","text":"重写发布记录\n\n<file path=\"/abs/CHANGELOG.md\">\n# Changelog\n---\n</file>"}}]}}}}"#
        )
        .unwrap();

        let agent_dir = dir.to_string_lossy().to_string();
        let loaded = load_pi_session(&project, session_id, Some(&agent_dir))
            .await
            .expect("load");
        assert_eq!(loaded.messages.len(), 1);

        let turn = &loaded.messages[0];
        assert!(!turn.text.contains("<file"));
        assert!(!turn.text.contains("# Changelog"));
        assert!(turn.text.contains("重写发布记录"));
        assert!(turn.text.contains("@/abs/CHANGELOG.md"));
        assert_eq!(
            turn.images,
            Some(vec!["data:image/png;base64,aGVsbG8=".to_string()])
        );

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn large_rpc_image_spills_to_temp_file_small_stays_data_url() {
        let small = image_display_ref("image/png", "AAAA").expect("small");
        assert!(
            small.starts_with("data:image/png;base64,"),
            "tiny payload stays inline: {small}"
        );
        let encoded = {
            use base64::Engine as _;
            base64::engine::general_purpose::STANDARD.encode(vec![0u8; 7000])
        };
        assert!(encoded.len() > 8 * 1024);
        let spilled = image_display_ref("image/png", &encoded).expect("large");
        assert!(
            !spilled.starts_with("data:"),
            "large payload must not be a data URL: {spilled}"
        );
        assert!(
            std::path::Path::new(&spilled).exists(),
            "spilled path must exist: {spilled}"
        );
    }
}

#[cfg(test)]
mod title_attachment_tests {
    use super::*;
    use std::io::Write;

    async fn write_session(
        dir: &std::path::Path,
        session_id: &str,
        first_user_text: &str,
    ) -> std::path::PathBuf {
        let sessions = dir.join("sessions");
        let cwd_dir = sessions.join("--tmp-project--");
        std::fs::create_dir_all(&cwd_dir).expect("mkdir");
        let file = cwd_dir.join(format!("2026-08-24T01-00-00-000Z_{session_id}.jsonl"));
        let project = dir.join("project");
        std::fs::create_dir_all(&project).unwrap();
        let mut handle = std::fs::File::create(&file).expect("create");
        writeln!(
            handle,
            r#"{{"type":"session","version":3,"id":"{session_id}","timestamp":"2026-08-24T01:00:00.000Z","cwd":"{}"}}"#,
            project.display()
        )
        .unwrap();
        writeln!(
            handle,
            r#"{{"type":"message","id":"m1","timestamp":"2026-08-24T01:00:01.000Z","message":{{"role":"user","content":[{{"type":"text","text":{}}}]}}}}"#,
            serde_json::to_string(first_user_text).unwrap()
        )
        .unwrap();
        file
    }

    #[tokio::test]
    async fn title_strips_file_attachment_wrapper_and_keeps_text() {
        let dir = std::env::temp_dir().join(format!(
            "pi-title-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let file = write_session(
            &dir,
            "019fe705-27fd-712e-a1be-f972ef3773aa",
            "<file name=\"/Users/me/二期文档/设计报告.md\"></file>\n分析这份文档",
        )
        .await;
        let summary = read_session_summary(&file).await.expect("summary");
        assert_eq!(summary.first_message, "分析这份文档");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn title_strips_rpc_era_path_wrapper_and_keeps_text() {
        let dir = std::env::temp_dir().join(format!(
            "pi-title-rpc-path-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let file = write_session(
            &dir,
            "019fe705-27fd-712e-a1be-f972ef3773f7",
            "重写发布记录\n\n<file path=\"/abs/CHANGELOG.md\">\n# Changelog\n</file>",
        )
        .await;
        let summary = read_session_summary(&file).await.expect("summary");
        // 标题只取用户文本（@ref 回填仅 load 展示路径；design D4）。
        assert_eq!(summary.first_message, "重写发布记录");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn title_falls_back_to_marker_for_attachment_only_message() {
        let dir = std::env::temp_dir().join(format!(
            "pi-title-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        let file = write_session(
            &dir,
            "019fe705-27fd-712e-a1be-f972ef3773ab",
            "<file name=\"/Users/me/截图/paste.png\"></file>\n",
        )
        .await;
        let summary = read_session_summary(&file).await.expect("summary");
        assert_eq!(summary.first_message, "[图片]");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

/// F5（fix-session-load-bridge-freeze）：resolve_session_file 内存索引。
/// 实测 3 条 items 的 pi 会话切换也需 1563ms——每次 resolve 全量扫描 117 个
/// 会话目录逐文件 open+read first line，与目标会话体量无关。索引按 root 分桶
/// 缓存 session_id → 候选文件（保留扫描顺序与 cwd 匹配/fallback 语义），
/// miss 触发一次重建（等价于旧行为），命中后不再逐文件打开。
#[cfg(test)]
mod session_file_index_tests {
    use super::*;
    use std::io::Write;

    async fn write_session_file(
        root: &std::path::Path,
        cwd_name: &str,
        session_id: &str,
        cwd: &std::path::Path,
    ) -> PathBuf {
        let cwd_dir = root.join(cwd_name);
        std::fs::create_dir_all(&cwd_dir).expect("mkdir");
        let file = cwd_dir.join(format!("2026-08-28T01-00-00-000Z_{session_id}.jsonl"));
        let mut handle = std::fs::File::create(&file).expect("create");
        writeln!(
            handle,
            r#"{{"type":"session","version":3,"id":"{session_id}","timestamp":"2026-08-28T01:00:00.000Z","cwd":"{}"}}"#,
            cwd.display()
        )
        .unwrap();
        writeln!(
            handle,
            r#"{{"type":"message","id":"m1","timestamp":"2026-08-28T01:00:01.000Z","message":{{"role":"user","content":[{{"type":"text","text":"hi"}}]}}}}"#
        )
        .unwrap();
        file
    }

    fn unique_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pi-index-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("mkdir");
        dir
    }

    #[tokio::test]
    async fn resolves_repeat_lookups_via_index_and_finds_new_files() {
        let dir = unique_dir("repeat");
        let root = dir.join("sessions");
        let project = dir.join("project");
        std::fs::create_dir_all(&project).expect("mkdir project");
        let file_a = write_session_file(&root, "--proj--", "019fe705-index-0001", &project).await;

        // 首查：建索引并命中
        let resolved = resolve_session_file(&root, "019fe705-index-0001", &project, true)
            .await
            .expect("resolve")
            .expect("hit");
        assert_eq!(resolved, file_a);

        // 索引建立后新增会话文件 → miss 触发一次重建仍能找到
        let file_b = write_session_file(&root, "--proj--", "019fe705-index-0002", &project).await;
        let resolved_b = resolve_session_file(&root, "019fe705-index-0002", &project, true)
            .await
            .expect("resolve")
            .expect("hit-new");
        assert_eq!(resolved_b, file_b);

        // 旧会话再查（索引复用路径）
        let resolved_again = resolve_session_file(&root, "019fe705-index-0001", &project, true)
            .await
            .expect("resolve")
            .expect("hit-again");
        assert_eq!(resolved_again, file_a);

        // 不存在的 id → None
        let missing = resolve_session_file(&root, "019fe705-index-ffff", &project, true)
            .await
            .expect("resolve");
        assert!(missing.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn payload_json_channel_round_trips() {
        let dir = unique_dir("payload-json");
        let root = dir.join("sessions");
        let project = dir.join("project");
        std::fs::create_dir_all(&project).expect("mkdir project");
        write_session_file(&root, "--proj--", "019fe705-index-json", &project).await;

        let payload_json = load_pi_session_payload_json(
            &project,
            "019fe705-index-json",
            Some(dir.to_string_lossy().as_ref()),
        )
        .await
        .expect("payload");
        let parsed: Value = serde_json::from_str(&payload_json).expect("parse");
        let messages = parsed
            .get("messages")
            .and_then(Value::as_array)
            .expect("messages array");
        assert_eq!(messages.len(), 1); // 单条 user message 投影
                                       // fixture 无 usage 条目：skip_serializing_if 下该字段缺省
        let usage = parsed.get("usage");
        assert!(usage.is_none() || usage.unwrap().is_object());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn fallback_semantics_preserved_with_index() {
        let dir = unique_dir("fallback");
        let root = dir.join("sessions");
        let other_project = dir.join("other-project");
        std::fs::create_dir_all(&other_project).expect("mkdir");
        let file =
            write_session_file(&root, "--drifted--", "019fe705-index-drift", &other_project).await;
        let workspace = dir.join("workspace");
        std::fs::create_dir_all(&workspace).expect("mkdir ws");

        // allow=true：cwd 漂移时返回 fallback 文件
        let with_fallback = resolve_session_file(&root, "019fe705-index-drift", &workspace, true)
            .await
            .expect("resolve")
            .expect("fallback");
        assert_eq!(with_fallback, file);

        // allow=false：cwd 不匹配即 None
        let strict = resolve_session_file(&root, "019fe705-index-drift", &workspace, false)
            .await
            .expect("resolve");
        assert!(strict.is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
